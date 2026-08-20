// Runtime network editing (slice 3) and intersection control changes
// (slice 4). All ops mutate the network then call rebuildTopology(), which
// re-derives everything derived: node kinds, lane geometry, connections,
// signal programs (preserving player knobs), and route trees.
//
// Car policy during rebuilds, chosen for simplicity and honesty:
// - cars on removed lanes are despawned and counted as "lost"
// - cars inside intersection boxes (on connections) are despawned as lost —
//   connection ids do not survive a rebuild
// - cars on surviving lanes stay, with s rescaled to the lane's new length

import { SPEED_ARTERIAL, SPEED_LOCAL, UPGRADE_EDGE_COST } from './constants';
import { movementsByAxis } from './mapgen';
import {
  buildConnections,
  computeLaneGeometry,
  defaultAllowedTurns,
  type EdgeId,
  type Lane,
  type NodeId,
  type RoadEdge,
} from './network';
import { makeProgram, programPed, programSplit } from './signals';
import type { World } from './sim';
import { dist, v, type Vec2 } from './vec';

export type Anchor =
  | { kind: 'node'; node: NodeId }
  | { kind: 'edge'; edge: EdgeId; t: number } // fraction along the edge
  | { kind: 'point'; pos: Vec2 };

/** Add a road between two anchors. Returns the new edge id, or null. */
export function addRoad(world: World, a: Anchor, b: Anchor): EdgeId | null {
  const net = world.net;
  const nodeA = resolveAnchor(world, a);
  const nodeB = resolveAnchor(world, b);
  if (nodeA === null || nodeB === null || nodeA === nodeB) return null;
  if (net.nodes[nodeA].kind === 'portal' || net.nodes[nodeB].kind === 'portal') return null;

  const builderLike = makeAdder(net);
  const id = builderLike.addEdge(nodeA, nodeB, 'local', 1, true);
  rebuildTopology(world);
  return id;
}

/** Remove an edge (tombstone). Refuses edges that touch a portal. */
export function removeEdge(world: World, edgeId: EdgeId): boolean {
  const net = world.net;
  const edge = net.edges[edgeId];
  if (!edge || edge.dead) return false;
  if (net.nodes[edge.from].kind === 'portal' || net.nodes[edge.to].kind === 'portal') return false;
  edge.dead = true;
  for (const laneId of [...edge.forward, ...edge.backward]) net.lanes[laneId].dead = true;
  rebuildTopology(world);
  return true;
}

/** Upgrade a road: 2 lanes each way + arterial speed. */
export function upgradeEdge(world: World, edgeId: EdgeId): boolean {
  const net = world.net;
  const edge = net.edges[edgeId];
  if (!edge || edge.dead || edge.forward.length >= 2) return false;
  edge.class = 'arterial';
  edge.speedLimit = SPEED_ARTERIAL;
  const adder = makeAdder(net);
  edge.forward.push(adder.addLaneTo(edge, 1, 1, 2));
  edge.backward.push(adder.addLaneTo(edge, -1, 1, 2));
  // Existing rightmost lanes get restricted turn sets.
  for (const laneId of [edge.forward[0], edge.backward[0]]) {
    net.lanes[laneId].allowedTurns = defaultAllowedTurns(0, 2);
  }
  net.lanes[edge.forward[1]].allowedTurns = defaultAllowedTurns(1, 2);
  net.lanes[edge.backward[1]].allowedTurns = defaultAllowedTurns(1, 2);
  rebuildTopology(world);
  return true;
}

export const upgradeCost = (): number => UPGRADE_EDGE_COST;

export type ControlKind = 'uncontrolled' | 'stop' | 'signal' | 'roundabout';

/** Change an intersection's control type (slice 4). */
export function setControl(world: World, nodeId: NodeId, kind: ControlKind): boolean {
  const net = world.net;
  const node = net.nodes[nodeId];
  if (node.kind !== 'intersection') return false;
  if (kind === 'signal') {
    const { ns, ew } = movementsByAxis(net, nodeId);
    if (ns.length === 0 || ew.length === 0) return false;
    node.control = { type: 'signal', program: makeProgram(ns, ew, 60, 0.5, 0) };
  } else if (kind === 'stop') {
    node.control = { type: 'stop', stoppedApproaches: minorApproaches(net.lanes, net.edges, nodeId) };
  } else if (kind === 'roundabout') {
    // Yield-based roundabout: circulating-priority behaviour approximated in
    // the sim's gap acceptance; explicit ring geometry is deferred.
    node.control = { type: 'roundabout', ringEdges: [] };
  } else {
    node.control = { type: 'uncontrolled' };
  }
  return true;
}

/** Minor approaches = local-class lanes; if uniform class, all approaches stop. */
export function minorApproaches(lanes: Lane[], edges: RoadEdge[], nodeId: NodeId): number[] {
  const incoming = lanes.filter((l) => !l.dead && l.toNode === nodeId);
  const minors = incoming.filter((l) => edges[l.edge].class === 'local');
  return (minors.length > 0 ? minors : incoming).map((l) => l.id);
}

/**
 * Re-derive everything after a topology change. Preserves signal knobs
 * (cycle/split/offset/ped) across the connection-id churn.
 */
export function rebuildTopology(world: World): void {
  const net = world.net;

  // 1. Capture signal knobs before connection ids are invalidated.
  const knobs = new Map<NodeId, { cycle: number; split: number; offset: number; ped: number }>();
  for (const node of net.nodes) {
    if (node.control.type === 'signal') {
      const p = node.control.program;
      knobs.set(node.id, {
        cycle: p.cycleLength,
        split: programSplit(p),
        offset: p.offset,
        ped: programPed(p),
      });
    }
  }

  // 2. Node kinds from live degree.
  for (const node of net.nodes) {
    if (node.kind === 'portal') continue;
    const live = node.edges.filter((e) => !net.edges[e].dead).length;
    node.kind = live >= 2 ? 'intersection' : 'dead_end';
  }

  // 3. Cars inside boxes are despawned (connection ids won't survive).
  for (const conn of net.connections) {
    for (const carId of conn.cars) world.loseCar(carId);
    conn.cars = [];
  }
  const laneReserved = new Map<number, number>();
  for (const lane of net.lanes) laneReserved.set(lane.id, 0);

  // 4. Lane geometry; rescale car positions onto new lengths.
  for (const lane of net.lanes) {
    if (lane.dead) {
      for (const carId of [...lane.cars]) world.loseCar(carId);
      lane.cars = [];
      continue;
    }
    const oldLen = lane.length;
    computeLaneGeometry(net.nodes, net.edges[lane.edge], lane);
    if (Math.abs(oldLen - lane.length) > 0.01) {
      const f = lane.length / oldLen;
      for (const carId of lane.cars) {
        const car = world.cars.get(carId)!;
        car.s = Math.min(car.s * f, lane.length);
      }
    }
    lane.reserved = laneReserved.get(lane.id) ?? 0;
  }

  // 5. Connections + conflicts.
  const { connections, connsFromLane } = buildConnections(net.nodes, net.edges, net.lanes);
  net.connections = connections;
  net.connsFromLane = connsFromLane;

  // 6. Controls: refresh signal programs; drop controls that no longer fit.
  for (const node of net.nodes) {
    if (node.kind !== 'intersection') {
      node.control = { type: 'uncontrolled' };
      continue;
    }
    if (node.control.type === 'signal') {
      const k = knobs.get(node.id)!;
      const { ns, ew } = movementsByAxis(net, node.id);
      node.control =
        ns.length > 0 && ew.length > 0
          ? { type: 'signal', program: makeProgram(ns, ew, k.cycle, k.split, k.offset, k.ped) }
          : { type: 'uncontrolled' };
    } else if (node.control.type === 'stop') {
      node.control = {
        type: 'stop',
        stoppedApproaches: minorApproaches(net.lanes, net.edges, node.id),
      };
    }
  }

  // 7. Routes.
  world.rebuildRouteTrees();
}

// ------------------------------------------------------------------ helpers

function resolveAnchor(world: World, a: Anchor): NodeId | null {
  const net = world.net;
  if (a.kind === 'node') return a.node;
  if (a.kind === 'point') {
    const adder = makeAdder(net);
    return adder.addNode(a.pos);
  }
  return splitEdge(world, a.edge, a.t);
}

/** Split an edge at fraction t, transplanting cars. Returns the new node. */
export function splitEdge(world: World, edgeId: EdgeId, t: number): NodeId | null {
  const net = world.net;
  const edge = net.edges[edgeId];
  if (!edge || edge.dead) return null;
  const a = net.nodes[edge.from].pos;
  const b = net.nodes[edge.to].pos;
  const f = Math.max(0.15, Math.min(0.85, t));
  const pos = v(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
  if (dist(a, pos) < 30 || dist(b, pos) < 30) return null;

  const adder = makeAdder(net);
  const mid = adder.addNode(pos);
  const lanesPerDir = edge.forward.length;
  const e1 = adder.addEdge(edge.from, mid, edge.class, lanesPerDir, edge.playerBuilt);
  const e2 = adder.addEdge(mid, edge.to, edge.class, lanesPerDir, edge.playerBuilt);
  net.edges[e1].speedLimit = edge.speedLimit;
  net.edges[e2].speedLimit = edge.speedLimit;

  // Transplant cars proportionally, preserving order.
  const move = (oldLaneId: number, firstId: EdgeId, secondId: EdgeId): void => {
    const oldLane = net.lanes[oldLaneId];
    const first = net.edges[firstId];
    const second = net.edges[secondId];
    const pick = (e: RoadEdge): Lane => {
      const ids = oldLane.dir === 1 ? e.forward : e.backward;
      // After a split, "forward" on both halves points the same world
      // direction as the original edge, so dir is preserved.
      return net.lanes[ids[Math.min(oldLane.index, ids.length - 1)]];
    };
    for (const carId of oldLane.cars) {
      const car = world.cars.get(carId)!;
      const frac = car.s / oldLane.length;
      const target = frac < f ? pick(first) : pick(second);
      const local = frac < f ? frac / f : (frac - f) / (1 - f);
      car.s = Math.max(0.5, Math.min(local * target.length, target.length));
      car.lane = target.id;
      target.cars.push(carId);
    }
    oldLane.cars = [];
  };
  // Order matters: front cars first so target lists stay sorted by s desc.
  for (const laneId of [...edge.forward, ...edge.backward]) {
    // For dir=-1 lanes the "first" half in travel order is e2.
    const lane = net.lanes[laneId];
    if (lane.dir === 1) move(laneId, e1, e2);
    else move(laneId, e2, e1);
  }

  edge.dead = true;
  for (const laneId of [...edge.forward, ...edge.backward]) net.lanes[laneId].dead = true;
  return mid;
}

/** Minimal mutation interface mirroring NetworkBuilder against a live net. */
function makeAdder(net: World['net']): {
  addNode: (pos: Vec2) => NodeId;
  addEdge: (
    from: NodeId,
    to: NodeId,
    cls: 'arterial' | 'local',
    lanesPerDir: number,
    playerBuilt: boolean,
  ) => EdgeId;
  addLaneTo: (edge: RoadEdge, dir: 1 | -1, index: number, count: number) => number;
} {
  const addNode = (pos: Vec2): NodeId => {
    const id = net.nodes.length;
    net.nodes.push({
      id,
      pos,
      kind: 'dead_end',
      control: { type: 'uncontrolled' },
      edges: [],
      pedsWaiting: 0,
    });
    return id;
  };
  const addLaneTo = (edge: RoadEdge, dir: 1 | -1, index: number, count: number): number => {
    const id = net.lanes.length;
    const lane: Lane = {
      id,
      edge: edge.id,
      dir,
      index,
      allowedTurns: defaultAllowedTurns(index, count),
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      length: 1,
      fromNode: dir === 1 ? edge.from : edge.to,
      toNode: dir === 1 ? edge.to : edge.from,
      dead: false,
      cars: [],
      reserved: 0,
    };
    net.lanes.push(lane);
    computeLaneGeometry(net.nodes, edge, lane);
    return id;
  };
  const addEdge = (
    from: NodeId,
    to: NodeId,
    cls: 'arterial' | 'local',
    lanesPerDir: number,
    playerBuilt: boolean,
  ): EdgeId => {
    const id = net.edges.length;
    const edge: RoadEdge = {
      id,
      from,
      to,
      class: cls,
      length: dist(net.nodes[from].pos, net.nodes[to].pos),
      speedLimit: cls === 'arterial' ? SPEED_ARTERIAL : SPEED_LOCAL,
      forward: [],
      backward: [],
      dead: false,
      playerBuilt,
    };
    net.edges.push(edge);
    net.nodes[from].edges.push(id);
    net.nodes[to].edges.push(id);
    for (let i = 0; i < lanesPerDir; i++) {
      edge.forward.push(addLaneTo(edge, 1, i, lanesPerDir));
      edge.backward.push(addLaneTo(edge, -1, i, lanesPerDir));
    }
    return id;
  };
  return { addNode, addEdge, addLaneTo };
}
