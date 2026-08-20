// Network graph (spec §5): nodes, edges, lanes, turn connections.
// Supports runtime editing (slice 3): edges/lanes are tombstoned (`dead`)
// rather than removed so ids stay stable, and connections are derived data
// that can be rebuilt wholesale after any topology change.

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
  pedsWaiting: number; // slice 7: pedestrians queued to cross here
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
  dead: boolean;
  playerBuilt: boolean; // affects demolition refunds
}

export interface Lane {
  id: LaneId;
  edge: EdgeId;
  dir: 1 | -1;
  index: number; // 0 = rightmost
  allowedTurns: TurnKind[];
  start: Vec2;
  end: Vec2;
  direction: Vec2; // unit
  length: number;
  fromNode: NodeId;
  toNode: NodeId;
  dead: boolean;
  cars: CarId[]; // sorted by s descending (front of queue first)
  reserved: number;
}

export interface TurnConnection {
  id: ConnId;
  node: NodeId;
  inLane: LaneId;
  outLane: LaneId;
  kind: TurnKind;
  path: Vec2[];
  cumLen: number[];
  length: number;
  maxSpeed: number;
  conflicts: ConnId[];
  priority: number;
  cars: CarId[];
}

export interface Network {
  nodes: RoadNode[];
  edges: RoadEdge[];
  lanes: Lane[];
  connections: TurnConnection[];
  connsFromLane: ConnId[][];
  portals: NodeId[];
}

const PATH_SAMPLES = 16;

// ---------------------------------------------------------------- geometry

export function nodeTrim(node: RoadNode): number {
  return node.kind === 'intersection' ? NODE_BOX_RADIUS : 0;
}

/** Recompute one lane's geometry from current node positions/kinds. */
export function computeLaneGeometry(nodes: RoadNode[], edge: RoadEdge, lane: Lane): void {
  const a = nodes[edge.from].pos;
  const b = nodes[edge.to].pos;
  const [p, q] = lane.dir === 1 ? [a, b] : [b, a];
  const d = norm(sub(q, p));
  const offset = scale(rightNormal(d), LANE_WIDTH * (0.5 + lane.index));
  const fromNode = lane.dir === 1 ? edge.from : edge.to;
  const toNode = lane.dir === 1 ? edge.to : edge.from;
  const trimFrom = nodeTrim(nodes[fromNode]);
  const trimTo = nodeTrim(nodes[toNode]);
  lane.start = add(add(p, scale(d, trimFrom)), offset);
  lane.end = add(add(q, scale(d, -trimTo)), offset);
  lane.direction = d;
  lane.fromNode = fromNode;
  lane.toNode = toNode;
  lane.length = Math.max(dist(lane.start, lane.end), 1);
}

/** Turn permissions by lane position: rightmost turns right, leftmost left. */
export function defaultAllowedTurns(index: number, count: number): TurnKind[] {
  if (count <= 1) return ['left', 'through', 'right'];
  if (index === 0) return ['through', 'right'];
  if (index === count - 1) return ['left', 'through'];
  return ['through'];
}

// ----------------------------------------------------------------- builder

export class NetworkBuilder {
  nodes: RoadNode[] = [];
  edges: RoadEdge[] = [];
  lanes: Lane[] = [];

  addNode(pos: Vec2, kind: RoadNode['kind'], portal?: PortalLabel): NodeId {
    const id = this.nodes.length;
    this.nodes.push({
      id,
      pos,
      kind,
      portal,
      control: { type: 'uncontrolled' },
      edges: [],
      pedsWaiting: 0,
    });
    return id;
  }

  addEdge(
    from: NodeId,
    to: NodeId,
    cls: 'arterial' | 'local',
    lanesPerDir = 1,
    playerBuilt = false,
  ): EdgeId {
    const id = this.edges.length;
    const edge: RoadEdge = {
      id,
      from,
      to,
      class: cls,
      length: dist(this.nodes[from].pos, this.nodes[to].pos),
      speedLimit: cls === 'arterial' ? SPEED_ARTERIAL : SPEED_LOCAL,
      forward: [],
      backward: [],
      dead: false,
      playerBuilt,
    };
    this.edges.push(edge);
    this.nodes[from].edges.push(id);
    this.nodes[to].edges.push(id);
    for (let i = 0; i < lanesPerDir; i++) {
      edge.forward.push(this.addLane(edge, 1, i, lanesPerDir));
      edge.backward.push(this.addLane(edge, -1, i, lanesPerDir));
    }
    return id;
  }

  private addLane(edge: RoadEdge, dir: 1 | -1, index: number, count: number): LaneId {
    const id = this.lanes.length;
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
    this.lanes.push(lane);
    computeLaneGeometry(this.nodes, edge, lane);
    return id;
  }

  build(): Network {
    // Geometry once more, now that all nodes/kinds are final.
    for (const lane of this.lanes) computeLaneGeometry(this.nodes, this.edges[lane.edge], lane);
    const { connections, connsFromLane } = buildConnections(this.nodes, this.edges, this.lanes);
    const portals = this.nodes
      .filter((n) => n.kind === 'portal')
      .sort((a, b) => (a.portal ?? '').localeCompare(b.portal ?? ''))
      .map((n) => n.id);
    return { nodes: this.nodes, edges: this.edges, lanes: this.lanes, connections, connsFromLane, portals };
  }
}

// ------------------------------------------------------------- connections

/** (Re)build all turn connections from live lanes. Derived data. */
export function buildConnections(
  nodes: RoadNode[],
  edges: RoadEdge[],
  lanes: Lane[],
): { connections: TurnConnection[]; connsFromLane: ConnId[][] } {
  const connections: TurnConnection[] = [];
  const connsFromLane: ConnId[][] = lanes.map(() => []);

  for (const node of nodes) {
    if (node.kind === 'portal' || node.kind === 'dead_end') continue;
    const incoming = lanes.filter((l) => !l.dead && l.toNode === node.id);
    const liveEdges = node.edges.filter((e) => !edges[e].dead);
    if (liveEdges.length < 2) continue;

    for (const inLane of incoming) {
      for (const edgeId of liveEdges) {
        if (edgeId === inLane.edge) continue;
        const edge = edges[edgeId];
        const outLanes = (edge.from === node.id ? edge.forward : edge.backward)
          .map((id) => lanes[id])
          .filter((l) => !l.dead && l.fromNode === node.id);
        if (outLanes.length === 0) continue;
        const kind = classifyTurn(inLane.direction, outLanes[0].direction);
        if (kind === 'uturn') continue;
        if (!inLane.allowedTurns.includes(kind)) continue;
        // One connection per (inLane, outEdge): pick the natural target lane.
        const targets =
          kind === 'through'
            ? [outLanes[Math.min(inLane.index, outLanes.length - 1)]]
            : kind === 'right'
              ? [outLanes[0]]
              : [outLanes[outLanes.length - 1]];
        for (const outLane of targets) {
          const conn = makeConnection(connections.length, node, inLane, outLane, kind, edges);
          connections.push(conn);
          connsFromLane[inLane.id].push(conn.id);
        }
      }
    }
  }

  computeConflicts(connections);
  return { connections, connsFromLane };
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
        if (a.inLane === b.inLane) continue;
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
