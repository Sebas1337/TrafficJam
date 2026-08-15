// The simulation core (spec §7). One IDM equation drives everything via
// phantom leaders: real leaders, red lights, stop lines, and downstream queue
// tails are all "a virtual stopped leader at distance d". Spillback (§7.4) is
// the load-bearing rule: no car enters an intersection box without room on
// the far side.

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
  IDM_ACCEL,
  IDM_COMFORT_BRAKE,
  IDM_DELTA,
  IDM_EMERGENCY_BRAKE,
  IDM_HEADWAY,
  MIN_GAP,
  PORTAL_QUEUE_LIMIT,
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
import { makeProgram, movementState, programSplit, type SignalProgram } from './signals';
import type { Vec2 } from './vec';
import { add, lerp, scale } from './vec';

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
  // Previous render pose, for interpolation.
  px: number;
  py: number;
  ph: number; // heading (rad)
}

export interface Metrics {
  delivered: number;
  recentDeliveries: number[]; // sim times, pruned to the last 60 s
  activeCars: number;
  queuedAtPortals: number;
  frustration: number; // 0..1
  simTime: number;
  totalDelay: number; // accumulated stopped-time of delivered cars
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
  metrics: Metrics = {
    delivered: 0,
    recentDeliveries: [],
    activeCars: 0,
    queuedAtPortals: 0,
    frustration: 0,
    simTime: 0,
    totalDelay: 0,
  };
  demand: DemandFn;
  portalQueues = new Map<NodeId, NodeId[]>(); // portal -> queued destinations
  private rng: Rng;
  private nextCarId = 1;
  private spawnAccumulator = 0;

  constructor(net: Network, seed: number, demand?: DemandFn) {
    this.net = net;
    this.rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    this.routeTrees = buildAllRouteTrees(net);
    this.demand = demand ?? defaultDemand;
    for (const p of net.portals) this.portalQueues.set(p, []);
  }

  // ---------------------------------------------------------------- stepping

  step(): void {
    if (this.over) return;
    const dt = DT;
    this.time += dt;
    this.metrics.simTime = this.time;

    this.demand(this, dt);
    this.drainPortalQueues();

    // Snapshot render poses, then accelerate + integrate every car.
    for (const car of this.cars.values()) {
      const pose = this.carPose(car);
      car.px = pose.pos.x;
      car.py = pose.pos.y;
      car.ph = pose.heading;
    }
    for (const car of this.cars.values()) this.integrate(car, dt);
    this.enforceNoOverlap();

    // Transitions: connections first (frees box space), then lane exits.
    for (const conn of this.net.connections) this.exitConnection(conn);
    for (const lane of this.net.lanes) this.exitLane(lane);

    this.updateFrustration(dt);
    this.metrics.activeCars = this.cars.size;
    const cutoff = this.time - 60;
    const rd = this.metrics.recentDeliveries;
    while (rd.length && rd[0] < cutoff) rd.shift();
  }

  // ------------------------------------------------------------------- cars

  spawnCar(origin: NodeId, destination: NodeId): boolean {
    const lane = this.net.lanes.find((l) => l.fromNode === origin);
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
      px: 0,
      py: 0,
      ph: 0,
    };
    const pose = this.carPose(car);
    car.px = pose.pos.x;
    car.py = pose.pos.y;
    car.ph = pose.heading;
    this.cars.set(id, car);
    lane.cars.push(id); // s is minimal, so appending keeps the sort
    return true;
  }

  enqueueSpawn(origin: NodeId, destination: NodeId): void {
    if (!this.spawnCar(origin, destination)) {
      this.portalQueues.get(origin)?.push(destination);
    }
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

  // ----------------------------------------------------------------- physics

  private integrate(car: Car, dt: number): void {
    const a = this.acceleration(car);
    car.v = Math.max(0, car.v + a * dt);
    car.s += car.v * dt;
    if (car.v < 0.5) car.stoppedTime += dt;
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
      // Downstream tail phantom (spillback continues to bind inside the box).
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
        // Front of the lane: stop line unless cleared to enter the box.
        const conn = this.nextConn(car, lane);
        const distToLine = lane.length - car.s;
        if (conn === null) {
          // Destination portal ahead: free exit, no constraint.
        } else if (!this.canEnter(car, lane, conn)) {
          constraints.push({ gap: distToLine + MIN_GAP, vLead: 0 });
        } else {
          // Cleared: keep spacing through the box to the connection tail
          // (or on to the out-lane tail if the box is empty).
          const boxTail = this.tailOnConnection(conn);
          if (boxTail) {
            constraints.push({
              gap: distToLine + boxTail.s - CAR_LENGTH,
              vLead: boxTail.v,
            });
          } else {
            const out = this.net.lanes[conn.outLane];
            const tail = this.tailInfo(out);
            constraints.push({
              gap: distToLine + conn.length + tail.rear,
              vLead: tail.v,
            });
          }
          // Brake smoothly toward the turn's curvature cap.
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

  /** Rear position + speed of the last car on a lane (as seen from s = 0). */
  private tailInfo(lane: Lane): { rear: number; v: number } {
    const tailId = lane.cars[lane.cars.length - 1];
    if (tailId === undefined) return { rear: lane.length + 100, v: 0 };
    const tail = this.cars.get(tailId)!;
    return { rear: tail.s - CAR_LENGTH, v: tail.v };
  }

  /** Hard guarantee: cars on the same lane/connection never overlap. */
  private enforceNoOverlap(): void {
    const containers: Array<CarId[]> = [];
    for (const l of this.net.lanes) if (l.cars.length > 1) containers.push(l.cars);
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

  nextConn(car: Car, lane: Lane): TurnConnection | null {
    const tree = this.routeTrees.get(car.destination);
    const cid = tree?.next[lane.id];
    return cid === undefined ? null : this.net.connections[cid];
  }

  /**
   * May this car cross the stop line into the box right now?
   * Checks, in order: signal state (with yellow dilemma-zone commitment),
   * spillback room on the far side, conflicting-connection occupancy, a
   * permissive-left gap check, and entry space on the connection itself.
   */
  private canEnter(car: Car, lane: Lane, conn: TurnConnection): boolean {
    const node = this.net.nodes[conn.node];

    if (node.control.type === 'signal') {
      const st = movementState(node.control.program, conn.id, this.time);
      if (st === 'red') return false;
      if (st === 'yellow') {
        // Stop if a comfortable stop is possible; otherwise committed.
        const d = lane.length - car.s;
        const stoppingDist = (car.v * car.v) / (2 * IDM_COMFORT_BRAKE);
        if (stoppingDist <= d) return false;
      }
    }

    // Spillback (spec §7.4): room on the far side, counting inbound
    // reservations from cars already in the box.
    const out = this.net.lanes[conn.outLane];
    const tail = this.tailInfo(out);
    const effectiveRear = Math.min(tail.rear, out.length) - out.reserved * (CAR_LENGTH + MIN_GAP);
    if (effectiveRear < CAR_LENGTH + MIN_GAP) return false;

    // Box conflicts: never enter across an occupied conflicting movement.
    for (const cid of conn.conflicts) {
      if (this.net.connections[cid].cars.length > 0) return false;
    }

    // Permissive left: yield to opposing through traffic arriving soon.
    if (conn.kind === 'left' && !this.leftGapAccepted(conn)) return false;

    // Space at the connection entry itself.
    const boxTail = this.tailOnConnection(conn);
    if (boxTail && boxTail.s - CAR_LENGTH < CAR_LENGTH + MIN_GAP) return false;

    return true;
  }

  private leftGapAccepted(conn: TurnConnection): boolean {
    const inLane = this.net.lanes[conn.inLane];
    const d = inLane.direction;
    for (const other of this.net.lanes) {
      if (other.toNode !== conn.node || other.id === conn.inLane) continue;
      // Opposing approach: travel direction roughly opposite ours.
      if (d.x * other.direction.x + d.y * other.direction.y > -0.5) continue;
      for (const carId of other.cars) {
        const c2 = this.cars.get(carId)!;
        const next = this.nextConn(c2, other);
        if (!next || next.kind === 'left') continue; // opposing lefts yield too
        const eta = (other.length - c2.s) / Math.max(c2.v, 0.5);
        if (eta < GAP_ACCEPT_CROSS) return false;
        break; // only the nearest opposing car matters
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
      // Reached a portal (or a dead end — routing prevents the latter).
      this.deliver(car, lane);
      return;
    }
    // Authoritative, sequential re-check at the moment of crossing.
    if (this.canEnter(car, lane, conn)) {
      const overflow = car.s - lane.length;
      lane.cars.shift();
      conn.cars.push(car.id);
      this.net.lanes[conn.outLane].reserved++;
      car.lane = null;
      car.turn = conn.id;
      car.s = Math.min(overflow, conn.length);
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

  private deliver(car: Car, lane: Lane): void {
    lane.cars.shift();
    this.cars.delete(car.id);
    this.metrics.delivered++;
    this.metrics.recentDeliveries.push(this.time);
    this.metrics.totalDelay += car.stoppedTime;
  }

  // ---------------------------------------------------------------- meters

  private updateFrustration(dt: number): void {
    const active = this.cars.size;
    let stopped = 0;
    for (const c of this.cars.values()) if (c.v < 0.5) stopped++;
    const f = active > 4 ? stopped / active : 0;

    const overThreshold = Math.max(0, f - FRUSTRATION_STOP_THRESHOLD) / (1 - FRUSTRATION_STOP_THRESHOLD);
    const queuePressure = Math.min(1, this.metrics.queuedAtPortals / PORTAL_QUEUE_LIMIT);
    const pressure = overThreshold * FRUSTRATION_FILL_RATE + queuePressure * FRUSTRATION_QUEUE_RATE;
    const drain = f < 0.2 && queuePressure < 0.3 ? FRUSTRATION_DRAIN_FAST : FRUSTRATION_DRAIN_SLOW;

    const m = this.metrics;
    m.frustration = Math.min(1, Math.max(0, m.frustration + (pressure - drain) * dt));
    if (m.frustration >= 1 && this.failureEnabled) this.over = true;
  }

  throughputPerMin(): number {
    return this.metrics.recentDeliveries.length;
  }

  // ----------------------------------------------------------------- signals

  /** Replace a node's signal program (editor entry point). */
  setSignal(nodeId: NodeId, opts: { cycle: number; split: number; offset: number }): void {
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
      ),
    };
  }

  signalKnobs(nodeId: NodeId): { cycle: number; split: number; offset: number } | null {
    const node = this.net.nodes[nodeId];
    if (node.control.type !== 'signal') return null;
    const p = node.control.program;
    return { cycle: p.cycleLength, split: programSplit(p), offset: p.offset };
  }

  signalProgram(nodeId: NodeId): SignalProgram | null {
    const node = this.net.nodes[nodeId];
    return node.control.type === 'signal' ? node.control.program : null;
  }

  // ---------------------------------------------------------------- geometry

  /** World pose of a car's centre (for rendering). */
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
