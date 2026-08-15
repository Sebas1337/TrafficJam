// Network graph (spec §5): nodes, edges, lanes, turn connections.
// The model carries the full-game shape (lane arrays, control union, explicit
// turns) even though slice 1 uses single-lane roads and signals only.

import {
  LANE_WIDTH,
  NODE_BOX_RADIUS,
  SPEED_ARTERIAL,
  SPEED_LOCAL,
  LATERAL_ACCEL,
} from './constants';
import type { Vec2 } from './vec';
import { add, dist, norm, rightNormal, scale, sub, segmentsIntersect, lerp } from './vec';
import type { SignalProgram } from './signals';

export type NodeId = number;
export type EdgeId = number;
export type LaneId = number;
export type ConnId = number;
export type CarId = number;

export type TurnKind = 'left' | 'through' | 'right' | 'uturn';
export type PortalLabel = string;

export type IntersectionControl =
  | { type: 'uncontrolled' }
  | { type: 'stop'; stoppedApproaches: LaneId[] }
  | { type: 'signal'; program: SignalProgram }
  | { type: 'roundabout'; ringEdges: EdgeId[] };

export interface RoadNode {
  id: NodeId;
  pos: Vec2;
  kind: 'intersection' | 'bend' | 'portal' | 'dead_end';
  portal?: PortalLabel;
  control: IntersectionControl;
  edges: EdgeId[];
}

export interface RoadEdge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  class: 'arterial' | 'local';
  length: number;
  speedLimit: number;
  forward: LaneId[]; // travel from -> to; index 0 = rightmost
  backward: LaneId[]; // travel to -> from
}

export interface Lane {
  id: LaneId;
  edge: EdgeId;
  dir: 1 | -1; // 1 = forward (from->to)
  index: number;
  allowedTurns: TurnKind[];
  // Geometry (slice 1: straight lanes).
  start: Vec2;
  end: Vec2;
  direction: Vec2; // unit
  length: number;
  fromNode: NodeId; // node at s = 0
  toNode: NodeId; // node at s = length
  // Simulation state.
  cars: CarId[]; // sorted by s descending (front of queue first)
  reserved: number; // cars on connections heading into this lane
}

export interface TurnConnection {
  id: ConnId;
  node: NodeId;
  inLane: LaneId;
  outLane: LaneId;
  kind: TurnKind;
  path: Vec2[]; // sampled bezier through the box
  cumLen: number[]; // cumulative length at each path point
  length: number;
  maxSpeed: number; // curvature-derived cap
  conflicts: ConnId[]; // connections whose paths cross or merge with this one
  priority: number;
  cars: CarId[]; // sorted by s descending
}

export interface Network {
  nodes: RoadNode[];
  edges: RoadEdge[];
  lanes: Lane[];
  connections: TurnConnection[];
  /** connections leaving each lane, by lane id */
  connsFromLane: ConnId[][];
  portals: NodeId[]; // sorted by label
}

const PATH_SAMPLES = 16;

export class NetworkBuilder {
  nodes: RoadNode[] = [];
  edges: RoadEdge[] = [];
  lanes: Lane[] = [];

  addNode(pos: Vec2, kind: RoadNode['kind'], portal?: PortalLabel): NodeId {
    const id = this.nodes.length;
    this.nodes.push({ id, pos, kind, portal, control: { type: 'uncontrolled' }, edges: [] });
    return id;
  }

  addEdge(from: NodeId, to: NodeId, cls: 'arterial' | 'local'): EdgeId {
    const id = this.edges.length;
    const a = this.nodes[from].pos;
    const b = this.nodes[to].pos;
    const edge: RoadEdge = {
      id,
      from,
      to,
      class: cls,
      length: dist(a, b),
      speedLimit: cls === 'arterial' ? SPEED_ARTERIAL : SPEED_LOCAL,
      forward: [],
      backward: [],
    };
    this.edges.push(edge);
    this.nodes[from].edges.push(id);
    this.nodes[to].edges.push(id);
    // Slice 1: one lane per direction. The arrays exist so slice 5 can widen.
    edge.forward.push(this.addLane(edge, 1));
    edge.backward.push(this.addLane(edge, -1));
    return id;
  }

  private addLane(edge: RoadEdge, dir: 1 | -1): LaneId {
    const id = this.lanes.length;
    const a = this.nodes[edge.from].pos;
    const b = this.nodes[edge.to].pos;
    const [p, q] = dir === 1 ? [a, b] : [b, a];
    const d = norm(sub(q, p));
    const offset = scale(rightNormal(d), LANE_WIDTH / 2);
    const fromNode = dir === 1 ? edge.from : edge.to;
    const toNode = dir === 1 ? edge.to : edge.from;
    const trimFrom = this.trimAt(fromNode);
    const trimTo = this.trimAt(toNode);
    const start = add(add(p, scale(d, trimFrom)), offset);
    const end = add(add(q, scale(d, -trimTo)), offset);
    this.lanes.push({
      id,
      edge: edge.id,
      dir,
      index: 0,
      allowedTurns: ['left', 'through', 'right'],
      start,
      end,
      direction: d,
      length: dist(start, end),
      fromNode,
      toNode,
      cars: [],
      reserved: 0,
    });
    return id;
  }

  private trimAt(node: NodeId): number {
    // Portals and dead ends keep the full length; intersections get a box.
    const k = this.nodes[node].kind;
    return k === 'intersection' ? NODE_BOX_RADIUS : 0;
  }

  /** Finalise: build turn connections at every node, compute conflicts. */
  build(): Network {
    const connections: TurnConnection[] = [];
    const connsFromLane: ConnId[][] = this.lanes.map(() => []);

    for (const node of this.nodes) {
      if (node.kind !== 'intersection' && node.kind !== 'bend') continue;
      const incoming = this.lanesEndingAt(node.id);
      const outgoing = this.lanesStartingAt(node.id);
      for (const inLane of incoming) {
        for (const outLane of outgoing) {
          if (outLane.edge === inLane.edge) continue; // no U-turns
          const kind = classifyTurn(inLane.direction, outLane.direction);
          if (kind === 'uturn') continue;
          const conn = makeConnection(connections.length, node, inLane, outLane, kind, this.edges);
          connections.push(conn);
          connsFromLane[inLane.id].push(conn.id);
        }
      }
    }

    computeConflicts(connections);

    const portals = this.nodes
      .filter((n) => n.kind === 'portal')
      .sort((a, b) => (a.portal ?? '').localeCompare(b.portal ?? ''))
      .map((n) => n.id);

    return {
      nodes: this.nodes,
      edges: this.edges,
      lanes: this.lanes,
      connections,
      connsFromLane,
      portals,
    };
  }

  lanesEndingAt(node: NodeId): Lane[] {
    return this.lanes.filter((l) => l.toNode === node);
  }
  lanesStartingAt(node: NodeId): Lane[] {
    return this.lanes.filter((l) => l.fromNode === node);
  }
}

/** Signed-angle turn classification. y-down world: positive cross = right turn. */
export function classifyTurn(inDir: Vec2, outDir: Vec2): TurnKind {
  const cross = inDir.x * outDir.y - inDir.y * outDir.x;
  const d = inDir.x * outDir.x + inDir.y * outDir.y;
  if (d > 0.7) return 'through';
  if (d < -0.7) return 'uturn';
  return cross > 0 ? 'right' : 'left';
}

function makeConnection(
  id: ConnId,
  node: RoadNode,
  inLane: Lane,
  outLane: Lane,
  kind: TurnKind,
  edges: RoadEdge[],
): TurnConnection {
  // Quadratic bezier from the in-lane end to the out-lane start via the node.
  const p0 = inLane.end;
  const p2 = outLane.start;
  const ctrl = node.pos;
  const path: Vec2[] = [];
  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const t = i / PATH_SAMPLES;
    const a = lerp(p0, ctrl, t);
    const b = lerp(ctrl, p2, t);
    path.push(lerp(a, b, t));
  }
  const cumLen: number[] = [0];
  for (let i = 1; i < path.length; i++) cumLen.push(cumLen[i - 1] + dist(path[i - 1], path[i]));
  const length = Math.max(cumLen[cumLen.length - 1], 0.1);

  const limit = edges[inLane.edge].speedLimit;
  let maxSpeed = limit;
  if (kind !== 'through') {
    // Approximate turn radius from the chord and the 90° sweep.
    const radius = dist(p0, p2) / Math.SQRT2;
    maxSpeed = Math.min(limit, Math.max(2.5, Math.sqrt(LATERAL_ACCEL * radius)));
  }

  return {
    id,
    node: node.id,
    inLane: inLane.id,
    outLane: outLane.id,
    kind,
    path,
    cumLen,
    length,
    maxSpeed,
    conflicts: [],
    priority: kind === 'through' ? 2 : kind === 'right' ? 1 : 0,
    cars: [],
  };
}

function computeConflicts(conns: TurnConnection[]): void {
  const byNode = new Map<NodeId, TurnConnection[]>();
  for (const c of conns) {
    const list = byNode.get(c.node) ?? [];
    list.push(c);
    byNode.set(c.node, list);
  }
  for (const group of byNode.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.inLane === b.inLane) continue; // same approach: follow, don't conflict
        const merge = a.outLane === b.outLane;
        if (merge || pathsCross(a, b)) {
          a.conflicts.push(b.id);
          b.conflicts.push(a.id);
        }
      }
    }
  }
}

function pathsCross(a: TurnConnection, b: TurnConnection): boolean {
  // Coarse but robust: test the sampled polylines segment-by-segment,
  // skipping the very ends (shared box entry/exit corners shouldn't count).
  for (let i = 1; i < a.path.length - 2; i++) {
    for (let j = 1; j < b.path.length - 2; j++) {
      if (segmentsIntersect(a.path[i], a.path[i + 1], b.path[j], b.path[j + 1])) return true;
    }
  }
  return false;
}

/** Position and tangent at arc length s along a connection path. */
export function connPointAt(conn: TurnConnection, s: number): { pos: Vec2; dir: Vec2 } {
  const cl = conn.cumLen;
  const clamped = Math.max(0, Math.min(s, conn.length));
  let i = 1;
  while (i < cl.length - 1 && cl[i] < clamped) i++;
  const segLen = cl[i] - cl[i - 1];
  const t = segLen > 1e-9 ? (clamped - cl[i - 1]) / segLen : 0;
  const pos = lerp(conn.path[i - 1], conn.path[i], t);
  const dir = norm(sub(conn.path[i], conn.path[i - 1]));
  return { pos, dir };
}
