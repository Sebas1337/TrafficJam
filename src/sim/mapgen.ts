// Slice-1 map generation: seeded corridor grid with boundary portals.
//
// Deliberate simplification of spec §6 (logged in docs/PROGRESS.md): instead
// of organic arterial routing + block subdivision, slice 1 generates 2-3
// vertical and 2-3 horizontal arterial corridors whose crossings are the
// signalised intersections (4-6 of them, per the slice-1 target). The full
// organic generator arrives when bigger maps matter (slice 3). Validation and
// retry semantics match §6: pure function of seed, reject-and-retry.

import { CYCLE_DEFAULT, MAP_H, MAP_W, PORTAL_LABELS } from './constants';
import { mulberry32, randInt, randRange, type Rng } from './rng';
import { NetworkBuilder, classifyTurn, type Network, type NodeId } from './network';
import { makeProgram } from './signals';
import { v } from './vec';

export interface GeneratedMap {
  net: Network;
  seed: number;
}

const MARGIN = 50;
const MIN_SEP_V = 140; // min spacing between vertical corridors
const MIN_SEP_H = 120;
const MAX_ATTEMPTS = 50;

export function generateMap(seed: number): GeneratedMap {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = mulberry32((seed + attempt * 1013904223) >>> 0);
    const net = tryGenerate(rng);
    if (net && validate(net)) return { net, seed };
  }
  throw new Error(`map generation failed for seed ${seed}`);
}

function tryGenerate(rng: Rng): Network | null {
  // Corridor counts whose product (signal count) lands in 4..6.
  const options: Array<[number, number]> = [
    [2, 2],
    [2, 3],
    [3, 2],
  ];
  const [nV, nH] = options[randInt(rng, options.length)];

  const xs = spread(rng, nV, MARGIN, MAP_W - MARGIN, MIN_SEP_V);
  const ys = spread(rng, nH, MARGIN, MAP_H - MARGIN, MIN_SEP_H);
  if (!xs || !ys) return null;

  const b = new NetworkBuilder();

  // Crossing nodes.
  const cross: NodeId[][] = [];
  for (let i = 0; i < nV; i++) {
    cross.push([]);
    for (let j = 0; j < nH; j++) {
      cross[i].push(b.addNode(v(xs[i], ys[j]), 'intersection'));
    }
  }

  // Portal candidates: the boundary ends of each corridor.
  interface Candidate {
    pos: { x: number; y: number };
    attach: () => NodeId; // inner node the portal stub connects to
  }
  const candidates: Candidate[] = [];
  for (let i = 0; i < nV; i++) {
    candidates.push({ pos: v(xs[i], 0), attach: () => cross[i][0] });
    candidates.push({ pos: v(xs[i], MAP_H), attach: () => cross[i][nH - 1] });
  }
  for (let j = 0; j < nH; j++) {
    candidates.push({ pos: v(0, ys[j]), attach: () => cross[0][j] });
    candidates.push({ pos: v(MAP_W, ys[j]), attach: () => cross[nV - 1][j] });
  }

  // Pick 3 well-separated portals, then label A, B, C clockwise from north.
  const picked: Candidate[] = [];
  const pool = [...candidates];
  while (picked.length < 3 && pool.length > 0) {
    const c = pool.splice(randInt(rng, pool.length), 1)[0];
    const tooClose = picked.some(
      (p) => Math.hypot(p.pos.x - c.pos.x, p.pos.y - c.pos.y) < 220,
    );
    if (!tooClose) picked.push(c);
  }
  if (picked.length < 3) return null;

  const cx = MAP_W / 2;
  const cy = MAP_H / 2;
  picked.sort((a, bb) => clockwiseFromNorth(a.pos.x - cx, a.pos.y - cy) - clockwiseFromNorth(bb.pos.x - cx, bb.pos.y - cy));

  const portalNodes: NodeId[] = [];
  const portalAttach = new Map<NodeId, NodeId>();
  picked.forEach((c, idx) => {
    const n = b.addNode(v(c.pos.x, c.pos.y), 'portal', PORTAL_LABELS[idx]);
    portalNodes.push(n);
    portalAttach.set(n, c.attach());
  });

  // Corridor edges between consecutive crossings.
  for (let i = 0; i < nV; i++) {
    for (let j = 0; j + 1 < nH; j++) b.addEdge(cross[i][j], cross[i][j + 1], 'arterial');
  }
  for (let j = 0; j < nH; j++) {
    for (let i = 0; i + 1 < nV; i++) b.addEdge(cross[i][j], cross[i + 1][j], 'arterial');
  }
  // Portal stubs.
  for (const p of portalNodes) b.addEdge(portalAttach.get(p)!, p, 'arterial');

  const net = b.build();
  assignSignals(net, rng);
  return net;
}

/** n positions in [lo, hi] with jitter and minimum separation. */
function spread(rng: Rng, n: number, lo: number, hi: number, minSep: number): number[] | null {
  const span = hi - lo;
  if (span < (n - 1) * minSep) return null;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const slotLo = lo + (span * i) / n;
    const slotHi = lo + (span * (i + 1)) / n;
    xs.push(randRange(rng, slotLo + span * 0.08, slotHi - span * 0.08));
  }
  for (let i = 1; i < n; i++) if (xs[i] - xs[i - 1] < minSep) return null;
  return xs;
}

function clockwiseFromNorth(dx: number, dy: number): number {
  // y-down world: north is -y. atan2 measured clockwise from north.
  const a = Math.atan2(dx, -dy);
  return a < 0 ? a + Math.PI * 2 : a;
}

/** Give every intersection a two-phase signal program (NS / EW). */
export function assignSignals(net: Network, rng: Rng): void {
  for (const node of net.nodes) {
    if (node.kind !== 'intersection') continue;
    const { ns, ew } = movementsByAxis(net, node.id);
    if (ns.length === 0 || ew.length === 0) continue;
    const cycle = CYCLE_DEFAULT;
    // Random initial offsets: the town's timing starts uncoordinated on
    // purpose — improving it is the game.
    const offset = Math.floor(rng() * cycle);
    node.control = { type: 'signal', program: makeProgram(ns, ew, cycle, 0.5, offset) };
  }
}

/** Group a node's turn connections by approach axis (via the in-lane bearing). */
export function movementsByAxis(net: Network, node: NodeId): { ns: number[]; ew: number[] } {
  const ns: number[] = [];
  const ew: number[] = [];
  for (const c of net.connections) {
    if (c.node !== node) continue;
    const d = net.lanes[c.inLane].direction;
    (Math.abs(d.y) > Math.abs(d.x) ? ns : ew).push(c.id);
  }
  return { ns, ew };
}

export function validate(net: Network): boolean {
  if (net.portals.length !== 3) return false;
  const signals = net.nodes.filter((n) => n.control.type === 'signal').length;
  if (signals < 4 || signals > 6) return false;
  for (const e of net.edges) if (e.length < 40) return false;
  return fullyConnected(net);
}

/** Every portal must reach every other portal over the lane/connection graph. */
export function fullyConnected(net: Network): boolean {
  for (const from of net.portals) {
    const reached = new Set<NodeId>();
    const startLanes = net.lanes.filter((l) => l.fromNode === from);
    const seen = new Set<number>();
    const stack = startLanes.map((l) => l.id);
    while (stack.length) {
      const laneId = stack.pop()!;
      if (seen.has(laneId)) continue;
      seen.add(laneId);
      const lane = net.lanes[laneId];
      reached.add(lane.toNode);
      for (const cid of net.connsFromLane[laneId]) {
        stack.push(net.connections[cid].outLane);
      }
    }
    for (const other of net.portals) {
      if (other !== from && !reached.has(other)) return false;
    }
  }
  return true;
}

// Re-export for fixtures/tests that hand-build networks.
export { classifyTurn };
