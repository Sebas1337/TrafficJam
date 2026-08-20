// The simulation core (spec §7). One IDM equation drives everything via
// phantom leaders: real leaders, red lights, stop lines, yields, and
// downstream queue tails are all "a virtual stopped leader at distance d".
// Spillback (§7.4) is the load-bearing rule: no car enters an intersection
// box without room on the far side.

import {
  CAR_LENGTH,
  DEMAND_BASE,
  DEMAND_CAP,
  DEMAND_DOUBLE_EVERY,
  DT,
  FRUSTRATION_DRAIN_FAST,
  FRUSTRATION_DRAIN_SLOW,
  FRUSTRATION_FILL_RATE,
  FRUSTRATION_QUEUE_RATE,
  FRUSTRATION_STOP_THRESHOLD,
  GAP_ACCEPT_CROSS,
  GAP_ACCEPT_MERGE,
  IDM_ACCEL,
  IDM_COMFORT_BRAKE,
  IDM_DELTA,
  IDM_EMERGENCY_BRAKE,
  IDM_HEADWAY,
  MIN_GAP,
  PED_BASE_RATE,
  PED_START_TIME,
  PED_WAIT_LIMIT,
  PORTAL_QUEUE_LIMIT,
  REWARD_BASE,
  REWARD_BONUS,
  START_MONEY,
} from './constants';
import { mulberry32, randInt, type Rng } from './rng';
import type {
  CarId,
  ConnId,
  Lane,
  LaneId,
  Network,
  NodeId,
  TurnConnection,
} from './network';
import { connPointAt } from './network';
import { buildAllRouteTrees, type RouteTree } from './routing';
import {
  cycleTime,
  makeProgram,
  movementState,
  programPed,
  programSplit,
  type SignalProgram,
} from './signals';
import type { Vec2 } from './vec';
import { lerp } from './vec';

export interface Car {
  id: CarId;
  origin: NodeId;
  destination: NodeId; // portal node id
  lane: LaneId | null;
  turn: ConnId | null;
  s: number; // metres along current lane/connection (front bumper)
  v: number; // m/s
  desiredSpeed: number;
  spawnTime: number;
  stoppedTime: number;
  freeFlowTime: number; // unimpeded travel time for the spawn route
  hasStopped: boolean; // full stop achieved near the stop line (stop signs)
  // Previous render pose, for interpolation.
  px: number;
  py: number;
  ph: number;
}

export interface Metrics {
  delivered: number;
  lost: number; // despawned without reaching their destination
  recentDeliveries: number[];
  activeCars: number;
  queuedAtPortals: number;
  pedsWaiting: number;
  frustration: number;
  simTime: number;
  totalDelay: number;
  totalFreeFlow: number; // sum of delivered cars' free-flow times
  totalActual: number; // sum of delivered cars' actual travel times
}

export type DemandFn = (world: World, dt: number) => void;

export class World {
  net: Network;
  cars = new Map<CarId, Car>();
  routeTrees: Map<NodeId, RouteTree>;
  time = 0;
  over = false;
  /** When false, frustration still accumulates but never ends the run. */
  failureEnabled = true;
  money = START_MONEY;
  /** Peds per minute per signal; 'auto' ramps in endless mode. */
  pedRate: number | 'auto' = 0;
  metrics: Metrics = {
    delivered: 0,
    lost: 0,
    recentDeliveries: [],
    activeCars: 0,
    queuedAtPortals: 0,
    pedsWaiting: 0,
    frustration: 0,
    simTime: 0,
    totalDelay: 0,
    totalFreeFlow: 0,
    totalActual: 0,
  };
  demand: DemandFn;
  portalQueues = new Map<NodeId, NodeId[]>();
  private rng: Rng;
  private nextCarId = 1;
  private freeFlowCache = new Map<string, number>();
  private pedDrain = new Map<NodeId, number>();
  private pedAcc = 0;

  constructor(net: Network, seed: number, demand?: DemandFn) {
    this.net = net;
    this.rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    this.routeTrees = buildAllRouteTrees(net);
    this.demand = demand ?? defaultDemand;
    for (const p of net.portals) this.portalQueues.set(p, []);
  }

  // ---------------------------------------------------------------- economy

  spend(amount: number): boolean {
    if (this.money < amount) return false;
    this.money -= amount;
    return true;
  }

  addMoney(amount: number): void {
    this.money += amount;
  }

  // ---------------------------------------------------------------- stepping

  step(): void {
    if (this.over) return;
    const dt = DT;
    this.time += dt;
    this.metrics.simTime = this.time;

    this.demand(this, dt);
    this.drainPortalQueues();
    this.stepPedestrians(dt);

    for (const car of this.cars.values()) {
      const pose = this.carPose(car);
      car.px = pose.pos.x;
      car.py = pose.pos.y;
      car.ph = pose.heading;
    }
    for (const car of this.cars.values()) this.integrate(car, dt);
    this.enforceNoOverlap();

    for (const conn of this.net.connections) this.exitConnection(conn);
    for (const lane of this.net.lanes) {
      if (!lane.dead) this.exitLane(lane);
    }

    this.updateFrustration(dt);
    this.metrics.activeCars = this.cars.size;
    const cutoff = this.time - 60;
    const rd = this.metrics.recentDeliveries;
    while (rd.length && rd[0] < cutoff) rd.shift();
  }

  // ------------------------------------------------------------------- cars

  spawnCar(origin: NodeId, destination: NodeId): boolean {
    const lane = this.net.lanes.find((l) => !l.dead && l.fromNode === origin);
    if (!lane) return false;
    const tree = this.routeTrees.get(destination);
    if (!tree || tree.cost[lane.id] === Infinity) return false;
    if (!this.roomAtStart(lane)) return false;

    const id = this.nextCarId++;
    const limit = this.net.edges[lane.edge].speedLimit;
    const car: Car = {
      id,
      origin,
      destination,
      lane: lane.id,
      turn: null,
      s: CAR_LENGTH,
      v: Math.min(limit * 0.6, 6),
      desiredSpeed: limit * (0.92 + this.rng() * 0.16),
      spawnTime: this.time,
      stoppedTime: 0,
      freeFlowTime: this.freeFlowTime(lane.id, destination),
      hasStopped: false,
      px: 0,
      py: 0,
      ph: 0,
    };
    const pose = this.carPose(car);
    car.px = pose.pos.x;
    car.py = pose.pos.y;
    car.ph = pose.heading;
    this.cars.set(id, car);
    lane.cars.push(id);
    return true;
  }

  enqueueSpawn(origin: NodeId, destination: NodeId): void {
    if (!this.spawnCar(origin, destination)) {
      this.portalQueues.get(origin)?.push(destination);
    }
  }

  /** Unimpeded travel time from a lane start to a destination portal. */
  private freeFlowTime(laneId: LaneId, dest: NodeId): number {
    const key = `${laneId}:${dest}`;
    const hit = this.freeFlowCache.get(key);
    if (hit !== undefined) return hit;
    const tree = this.routeTrees.get(dest);
    let t = 0;
    let lane: Lane | undefined = this.net.lanes[laneId];
    for (let hops = 0; lane && hops < 100; hops++) {
      t += lane.length / this.net.edges[lane.edge].speedLimit;
      const cid: ConnId | undefined = tree?.next[lane.id];
      if (cid === undefined) break;
      const conn: TurnConnection = this.net.connections[cid];
      t += conn.length / conn.maxSpeed;
      lane = this.net.lanes[conn.outLane];
    }
    this.freeFlowCache.set(key, t);
    return t;
  }

  private drainPortalQueues(): void {
    let queued = 0;
    for (const [portal, q] of this.portalQueues) {
      while (q.length > 0 && this.spawnCar(portal, q[0])) q.shift();
      queued += q.length;
    }
    this.metrics.queuedAtPortals = queued;
  }

  private roomAtStart(lane: Lane): boolean {
    const tailId = lane.cars[lane.cars.length - 1];
    if (tailId === undefined) return lane.length > CAR_LENGTH + MIN_GAP;
    const tail = this.cars.get(tailId)!;
    return tail.s - CAR_LENGTH >= CAR_LENGTH + MIN_GAP;
  }

  /** Despawn a car that cannot (or will not) complete its trip. */
  loseCar(carId: CarId): void {
    const car = this.cars.get(carId);
    if (!car) return;
    if (car.lane !== null) {
      const lane = this.net.lanes[car.lane];
      const i = lane.cars.indexOf(carId);
      if (i >= 0) lane.cars.splice(i, 1);
    }
    if (car.turn !== null) {
      const conn = this.net.connections[car.turn];
      const i = conn.cars.indexOf(carId);
      if (i >= 0) conn.cars.splice(i, 1);
      const out = this.net.lanes[conn.outLane];
      out.reserved = Math.max(0, out.reserved - 1);
    }
    this.cars.delete(carId);
    this.metrics.lost++;
  }

  /** Rebuild route trees after a network edit; clears route-derived caches. */
  rebuildRouteTrees(): void {
    this.routeTrees = buildAllRouteTrees(this.net);
    this.freeFlowCache.clear();
  }

  // ----------------------------------------------------------------- physics

  private integrate(car: Car, dt: number): void {
    const a = this.acceleration(car);
    car.v = Math.max(0, car.v + a * dt);
    car.s += car.v * dt;
    if (car.v < 0.5) car.stoppedTime += dt;
    if (car.lane !== null && car.v < 0.3) {
      const lane = this.net.lanes[car.lane];
      if (lane.length - car.s < 15) car.hasStopped = true;
    }
  }

  /** IDM with phantom leaders: min acceleration over all active constraints. */
  private acceleration(car: Car): number {
    const constraints: Array<{ gap: number; vLead: number }> = [];
    let v0 = car.desiredSpeed;

    if (car.turn !== null) {
      const conn = this.net.connections[car.turn];
      v0 = Math.min(v0, conn.maxSpeed);
      const leader = this.leaderOf(conn.cars, car);
      if (leader) {
        constraints.push({ gap: leader.s - CAR_LENGTH - car.s, vLead: leader.v });
      }
      const out = this.net.lanes[conn.outLane];
      const tail = this.tailInfo(out);
      constraints.push({ gap: conn.length - car.s + tail.rear, vLead: tail.v });
    } else if (car.lane !== null) {
      const lane = this.net.lanes[car.lane];
      v0 = Math.min(v0, this.net.edges[lane.edge].speedLimit);
      const leader = this.leaderOf(lane.cars, car);
      if (leader) {
        constraints.push({ gap: leader.s - CAR_LENGTH - car.s, vLead: leader.v });
      } else {
        const conn = this.nextConn(car, lane);
        const distToLine = lane.length - car.s;
        if (conn === null) {
          // Portal or dead end ahead: free exit.
        } else if (!this.canEnter(car, lane, conn)) {
          constraints.push({ gap: distToLine + MIN_GAP, vLead: 0 });
        } else {
          const boxTail = this.tailOnConnection(conn);
          if (boxTail) {
            constraints.push({ gap: distToLine + boxTail.s - CAR_LENGTH, vLead: boxTail.v });
          } else {
            const out = this.net.lanes[conn.outLane];
            const tail = this.tailInfo(out);
            constraints.push({ gap: distToLine + conn.length + tail.rear, vLead: tail.v });
          }
          if (conn.maxSpeed < v0) {
            v0 = Math.min(
              v0,
              Math.sqrt(conn.maxSpeed ** 2 + 2 * IDM_COMFORT_BRAKE * Math.max(distToLine, 0)),
            );
          }
        }
      }
    }

    let a = IDM_ACCEL * (1 - Math.pow(car.v / Math.max(v0, 0.1), IDM_DELTA));
    for (const c of constraints) {
      a = Math.min(a, idmInteraction(car.v, v0, c.gap, c.vLead));
    }
    return Math.max(a, -IDM_EMERGENCY_BRAKE);
  }

  private leaderOf(list: CarId[], car: Car): Car | null {
    const i = list.indexOf(car.id);
    return i > 0 ? this.cars.get(list[i - 1])! : null;
  }

  private tailOnConnection(conn: TurnConnection): Car | null {
    const id = conn.cars[conn.cars.length - 1];
    return id === undefined ? null : this.cars.get(id)!;
  }

  private tailInfo(lane: Lane): { rear: number; v: number } {
    const tailId = lane.cars[lane.cars.length - 1];
    if (tailId === undefined) return { rear: lane.length + 100, v: 0 };
    const tail = this.cars.get(tailId)!;
    return { rear: tail.s - CAR_LENGTH, v: tail.v };
  }

  private enforceNoOverlap(): void {
    const containers: Array<CarId[]> = [];
    for (const l of this.net.lanes) if (!l.dead && l.cars.length > 1) containers.push(l.cars);
    for (const c of this.net.connections) if (c.cars.length > 1) containers.push(c.cars);
    for (const list of containers) {
      for (let i = 1; i < list.length; i++) {
        const ahead = this.cars.get(list[i - 1])!;
        const car = this.cars.get(list[i])!;
        const maxS = ahead.s - CAR_LENGTH - 0.05;
        if (car.s > maxS) {
          car.s = Math.max(maxS, 0);
          car.v = Math.min(car.v, ahead.v);
        }
      }
    }
  }

  // ------------------------------------------------------------ intersections

  /**
   * Next connection for this car from this lane. Follows the route tree,
   * balancing across sibling connections (same node, same turn kind) into
   * parallel lanes by static cost + queue length. Falls back to any live
   * connection when the network was edited out from under the route.
   */
  nextConn(car: Car, lane: Lane): TurnConnection | null {
    const tree = this.routeTrees.get(car.destination);
    const cid = tree?.next[lane.id];
    if (cid === undefined) {
      const opts = this.net.connsFromLane[lane.id];
      return opts.length > 0 ? this.net.connections[opts[0]] : null;
    }
    const chosen = this.net.connections[cid];
    let best = chosen;
    let bestCost = this.connChoiceCost(tree!, chosen);
    for (const otherId of this.net.connsFromLane[lane.id]) {
      if (otherId === cid) continue;
      const other = this.net.connections[otherId];
      if (other.node !== chosen.node || other.kind !== chosen.kind) continue;
      const cost = this.connChoiceCost(tree!, other);
      if (cost < bestCost) {
        best = other;
        bestCost = cost;
      }
    }
    return best;
  }

  private connChoiceCost(tree: RouteTree, conn: TurnConnection): number {
    const base = tree.cost[conn.outLane];
    if (base === undefined || base === Infinity) return Infinity;
    return base + 1.5 * this.net.lanes[conn.outLane].cars.length;
  }

  /**
   * May this car cross the stop line into the box right now?
   * Signals: green/yellow-commit/red. All controls: spillback, conflicting-
   * connection occupancy, entry space. Unsignalised (slice 4): stop signs
   * require a full stop; minor/left movements need an accepted gap;
   * roundabouts run on occupancy + curved-path speeds (yield-to-box).
   */
  private canEnter(car: Car, lane: Lane, conn: TurnConnection): boolean {
    const node = this.net.nodes[conn.node];
    const control = node.control;

    if (control.type === 'signal') {
      const st = movementState(control.program, conn.id, this.time);
      if (st === 'red') return false;
      if (st === 'yellow') {
        const d = lane.length - car.s;
        const stoppingDist = (car.v * car.v) / (2 * IDM_COMFORT_BRAKE);
        if (stoppingDist <= d) return false;
      }
    }

    // Spillback (spec §7.4).
    const out = this.net.lanes[conn.outLane];
    const tail = this.tailInfo(out);
    const effectiveRear = Math.min(tail.rear, out.length) - out.reserved * (CAR_LENGTH + MIN_GAP);
    if (effectiveRear < CAR_LENGTH + MIN_GAP) return false;

    // Box conflicts.
    for (const cid of conn.conflicts) {
      if (this.net.connections[cid].cars.length > 0) return false;
    }

    // Entry space on the connection itself.
    const boxTail = this.tailOnConnection(conn);
    if (boxTail && boxTail.s - CAR_LENGTH < CAR_LENGTH + MIN_GAP) return false;

    if (control.type === 'signal') {
      if (conn.kind === 'left' && !this.leftGapAccepted(conn)) return false;
      return true;
    }

    // Unsignalised (slice 4).
    if (control.type === 'stop') {
      if (control.stoppedApproaches.includes(lane.id) && !car.hasStopped) return false;
    }
    const isRoundabout = control.type === 'roundabout';
    const myClass = this.net.edges[lane.edge].class;
    const isMinor =
      control.type === 'stop'
        ? control.stoppedApproaches.includes(lane.id)
        : myClass === 'local';
    if (!isRoundabout && (isMinor || conn.kind === 'left')) {
      const threshold = conn.kind === 'right' ? GAP_ACCEPT_MERGE : GAP_ACCEPT_CROSS;
      if (!this.gapAccepted(conn, lane, threshold)) return false;
    }
    if (conn.kind === 'left' && !this.leftGapAccepted(conn)) return false;
    return true;
  }

  /** Yield to major-approach traffic arriving within `threshold` seconds. */
  private gapAccepted(conn: TurnConnection, myLane: Lane, threshold: number): boolean {
    const node = this.net.nodes[conn.node];
    for (const other of this.net.lanes) {
      if (other.dead || other.toNode !== conn.node || other.id === myLane.id) continue;
      if (other.edge === myLane.edge) continue;
      // Only yield to approaches that are not themselves minor/stopped.
      if (node.control.type === 'stop' && node.control.stoppedApproaches.includes(other.id)) {
        continue;
      }
      if (
        node.control.type === 'uncontrolled' &&
        this.net.edges[other.edge].class === 'local' &&
        this.net.edges[myLane.edge].class === 'local'
      ) {
        continue; // local-vs-local: occupancy order decides
      }
      const frontId = other.cars[0];
      if (frontId === undefined) continue;
      const c2 = this.cars.get(frontId)!;
      const eta = (other.length - c2.s) / Math.max(c2.v, 0.5);
      if (eta < threshold) return false;
    }
    return true;
  }

  private leftGapAccepted(conn: TurnConnection): boolean {
    const inLane = this.net.lanes[conn.inLane];
    const d = inLane.direction;
    for (const other of this.net.lanes) {
      if (other.dead || other.toNode !== conn.node || other.id === conn.inLane) continue;
      if (d.x * other.direction.x + d.y * other.direction.y > -0.5) continue;
      for (const carId of other.cars) {
        const c2 = this.cars.get(carId)!;
        const next = this.nextConn(c2, other);
        if (!next || next.kind === 'left') continue;
        const eta = (other.length - c2.s) / Math.max(c2.v, 0.5);
        if (eta < GAP_ACCEPT_CROSS) return false;
        break;
      }
    }
    return true;
  }

  // ------------------------------------------------------------- transitions

  private exitLane(lane: Lane): void {
    const frontId = lane.cars[0];
    if (frontId === undefined) return;
    const car = this.cars.get(frontId)!;
    if (car.s < lane.length) return;

    const conn = this.nextConn(car, lane);
    if (conn === null) {
      this.finishTrip(car, lane);
      return;
    }
    if (this.canEnter(car, lane, conn)) {
      const overflow = car.s - lane.length;
      lane.cars.shift();
      conn.cars.push(car.id);
      this.net.lanes[conn.outLane].reserved++;
      car.lane = null;
      car.turn = conn.id;
      car.s = Math.min(overflow, conn.length);
      car.hasStopped = false;
    } else {
      car.s = lane.length;
      car.v = 0;
    }
  }

  private exitConnection(conn: TurnConnection): void {
    const frontId = conn.cars[0];
    if (frontId === undefined) return;
    const car = this.cars.get(frontId)!;
    if (car.s < conn.length) return;

    const out = this.net.lanes[conn.outLane];
    const overflow = car.s - conn.length;
    const tail = this.tailInfo(out);
    conn.cars.shift();
    out.reserved = Math.max(0, out.reserved - 1);
    out.cars.push(car.id);
    car.turn = null;
    car.lane = out.id;
    car.s = Math.min(overflow, Math.max(tail.rear - MIN_GAP, 0.1));
  }

  private finishTrip(car: Car, lane: Lane): void {
    lane.cars.shift();
    this.cars.delete(car.id);
    const node = this.net.nodes[lane.toNode];
    if (node.kind === 'portal' && lane.toNode === car.destination) {
      const actual = Math.max(this.time - car.spawnTime, 0.1);
      this.metrics.delivered++;
      this.metrics.recentDeliveries.push(this.time);
      this.metrics.totalDelay += car.stoppedTime;
      this.metrics.totalFreeFlow += car.freeFlowTime;
      this.metrics.totalActual += actual;
      const quality = Math.max(0, Math.min(1, car.freeFlowTime / actual));
      this.money += REWARD_BASE + REWARD_BONUS * quality;
    } else {
      // Wrong portal or a dead end after a network edit.
      this.metrics.lost++;
    }
  }

  // ------------------------------------------------------------- pedestrians

  private stepPedestrians(dt: number): void {
    const signals = this.net.nodes.filter((n) => n.control.type === 'signal');
    let rate = typeof this.pedRate === 'number' ? this.pedRate : 0;
    if (this.pedRate === 'auto') {
      rate =
        this.time < PED_START_TIME
          ? 0
          : PED_BASE_RATE * Math.min(3, Math.pow(2, (this.time - PED_START_TIME) / 300));
    }
    if (rate > 0 && signals.length > 0) {
      this.pedAcc += ((rate * signals.length) / 60) * dt;
      while (this.pedAcc >= 1) {
        this.pedAcc -= 1;
        const node = signals[randInt(this.rng, signals.length)];
        node.pedsWaiting = Math.min(node.pedsWaiting + 1, 30);
      }
    }

    let total = 0;
    for (const node of signals) {
      if (node.control.type !== 'signal') continue;
      const program = node.control.program;
      if (node.pedsWaiting > 0 && this.pedWalkActive(program)) {
        const acc = (this.pedDrain.get(node.id) ?? 0) + 2 * dt; // 2 peds/s cross
        let whole = Math.floor(acc);
        this.pedDrain.set(node.id, acc - whole);
        while (whole-- > 0 && node.pedsWaiting > 0) node.pedsWaiting--;
      }
      total += node.pedsWaiting;
    }
    this.metrics.pedsWaiting = total;
  }

  /** Is this program's pedestrian walk phase active right now? */
  pedWalkActive(program: SignalProgram): boolean {
    const ped = programPed(program);
    if (ped <= 0) return false;
    return cycleTime(program, this.time) >= program.cycleLength - ped;
  }

  // ---------------------------------------------------------------- meters

  private updateFrustration(dt: number): void {
    const active = this.cars.size;
    let stopped = 0;
    for (const c of this.cars.values()) if (c.v < 0.5) stopped++;
    const f = active > 4 ? stopped / active : 0;

    const overThreshold =
      Math.max(0, f - FRUSTRATION_STOP_THRESHOLD) / (1 - FRUSTRATION_STOP_THRESHOLD);
    const queuePressure = Math.min(1, this.metrics.queuedAtPortals / PORTAL_QUEUE_LIMIT);
    const signalCount = Math.max(
      1,
      this.net.nodes.filter((n) => n.control.type === 'signal').length,
    );
    const pedPressure = Math.min(1, this.metrics.pedsWaiting / (PED_WAIT_LIMIT * signalCount));
    const pressure =
      overThreshold * FRUSTRATION_FILL_RATE +
      queuePressure * FRUSTRATION_QUEUE_RATE +
      pedPressure * FRUSTRATION_QUEUE_RATE * 0.7;
    const drain =
      f < 0.2 && queuePressure < 0.3 && pedPressure < 0.3
        ? FRUSTRATION_DRAIN_FAST
        : FRUSTRATION_DRAIN_SLOW;

    const m = this.metrics;
    m.frustration = Math.min(1, Math.max(0, m.frustration + (pressure - drain) * dt));
    if (m.frustration >= 1 && this.failureEnabled) this.over = true;
  }

  throughputPerMin(): number {
    return this.metrics.recentDeliveries.length;
  }

  /** Travel Time Index of delivered trips: actual / free-flow (1.0 = perfect). */
  travelTimeIndex(): number {
    return this.metrics.totalFreeFlow > 0
      ? this.metrics.totalActual / this.metrics.totalFreeFlow
      : 1;
  }

  // ----------------------------------------------------------------- signals

  setSignal(
    nodeId: NodeId,
    opts: { cycle: number; split: number; offset: number; ped?: number },
  ): void {
    const node = this.net.nodes[nodeId];
    if (node.control.type !== 'signal') return;
    const old = node.control.program;
    node.control = {
      type: 'signal',
      program: makeProgram(
        old.phases[0].movements,
        old.phases[1].movements,
        opts.cycle,
        opts.split,
        opts.offset,
        opts.ped ?? programPed(old),
      ),
    };
  }

  signalKnobs(
    nodeId: NodeId,
  ): { cycle: number; split: number; offset: number; ped: number } | null {
    const node = this.net.nodes[nodeId];
    if (node.control.type !== 'signal') return null;
    const p = node.control.program;
    return { cycle: p.cycleLength, split: programSplit(p), offset: p.offset, ped: programPed(p) };
  }

  signalProgram(nodeId: NodeId): SignalProgram | null {
    const node = this.net.nodes[nodeId];
    return node.control.type === 'signal' ? node.control.program : null;
  }

  // ---------------------------------------------------------------- geometry

  carPose(car: Car): { pos: Vec2; heading: number } {
    const mid = car.s - CAR_LENGTH / 2;
    if (car.turn !== null) {
      const conn = this.net.connections[car.turn];
      const { pos, dir } = connPointAt(conn, mid);
      return { pos, heading: Math.atan2(dir.y, dir.x) };
    }
    const lane = this.net.lanes[car.lane!];
    const t = Math.max(0, Math.min(1, mid / Math.max(lane.length, 0.01)));
    return {
      pos: lerp(lane.start, lane.end, t),
      heading: Math.atan2(lane.direction.y, lane.direction.x),
    };
  }
}

// ---------------------------------------------------------------------------

function idmInteraction(v: number, v0: number, gap: number, vLead: number): number {
  const g = Math.max(gap, 0.01);
  const dv = v - vLead;
  const sStar =
    MIN_GAP +
    Math.max(0, v * IDM_HEADWAY + (v * dv) / (2 * Math.sqrt(IDM_ACCEL * IDM_COMFORT_BRAKE)));
  return IDM_ACCEL * (1 - Math.pow(v / Math.max(v0, 0.1), IDM_DELTA) - (sStar / g) ** 2);
}

/** Default endless-mode demand: geometric ramp, uniform OD pairs. */
export function defaultDemand(world: World, dt: number): void {
  const anyWorld = world as World & { _demandAcc?: number; _demandRng?: Rng };
  anyWorld._demandRng ??= mulberry32(0xc0ffee);
  anyWorld._demandAcc ??= 0;
  const ratePerMin = Math.min(
    DEMAND_CAP,
    DEMAND_BASE * Math.pow(2, world.time / DEMAND_DOUBLE_EVERY),
  );
  anyWorld._demandAcc += (ratePerMin / 60) * dt;
  while (anyWorld._demandAcc >= 1) {
    anyWorld._demandAcc -= 1;
    const rng = anyWorld._demandRng;
    const portals = world.net.portals;
    const origin = portals[randInt(rng, portals.length)];
    let dest = portals[randInt(rng, portals.length)];
    while (dest === origin) dest = portals[randInt(rng, portals.length)];
    world.enqueueSpawn(origin, dest);
  }
}

/** Demand scaled by a fixed multiplier (campaign levels). */
export function scaledDemand(scale: number): DemandFn {
  return (world, dt) => {
    const anyWorld = world as World & { _demandAcc?: number; _demandRng?: Rng };
    anyWorld._demandRng ??= mulberry32(0xc0ffee);
    anyWorld._demandAcc ??= 0;
    const ratePerMin = Math.min(
      DEMAND_CAP,
      scale * DEMAND_BASE * Math.pow(2, world.time / DEMAND_DOUBLE_EVERY),
    );
    anyWorld._demandAcc += (ratePerMin / 60) * dt;
    while (anyWorld._demandAcc >= 1) {
      anyWorld._demandAcc -= 1;
      const rng = anyWorld._demandRng;
      const portals = world.net.portals;
      const origin = portals[randInt(rng, portals.length)];
      let dest = portals[randInt(rng, portals.length)];
      while (dest === origin) dest = portals[randInt(rng, portals.length)];
      world.enqueueSpawn(origin, dest);
    }
  };
}
