// Slice-1 map generation: a portrait "spine town" — one vertical main street
// with 2-3 signalised cross-street junctions and a portal at every road end.
//
// Deliberate simplification of spec §6 (logged in docs/PROGRESS.md), reshaped
// after the first phone playtest: a 4-6 signal grid at full-map zoom rendered
// at ~0.6 px/m on a 390 px screen — too small, too much at once. The spine
// layout doubles the scale, reads instantly in portrait, and is naturally a
// corridor (which is what slice 2 coordinates). The organic generator arrives
// when bigger maps matter (slice 3). Validation and retry semantics match §6:
// pure function of seed, reject-and-retry.

import { CYCLE_DEFAULT, MAP_H, MAP_W, PORTAL_LABELS } from './constants';
import { mulberry32, randInt, randRange, type Rng } from './rng';
import { NetworkBuilder, classifyTurn, type Network, type NodeId } from './network';
import { makeProgram } from './signals';
import { v } from './vec';

export interface GeneratedMap {
  net: Network;
  seed: number;
}

const CROSS_MARGIN = 75; // min distance of a cross street from the map edge
const MIN_SEP = 130; // min spacing between cross streets
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
  const nH = 2 + randInt(rng, 2); // 2 or 3 signalised junctions
  const ys = spread(rng, nH, CROSS_MARGIN, MAP_H - CROSS_MARGIN, MIN_SEP);
  if (!ys) return null;
  // Main street somewhere through the middle third, so both cross-street
  // sides have room.
  const mainX = randRange(rng, MAP_W * 0.35, MAP_W * 0.65);

  const b = new NetworkBuilder();
  const crossings: NodeId[] = ys.map((y) => b.addNode(v(mainX, y), 'intersection'));

  // Portals: both ends of the main street, plus the boundary end of each
  // cross street. Cross streets alternate sides so the town isn't lopsided.
  interface PortalDef {
    pos: { x: number; y: number };
    attach: NodeId;
    node?: NodeId;
    cls: 'arterial' | 'local';
  }
  const defs: PortalDef[] = [
    { pos: v(mainX, 0), attach: crossings[0], cls: 'arterial' },
    { pos: v(mainX, MAP_H), attach: crossings[nH - 1], cls: 'arterial' },
  ];
  const firstSide = randInt(rng, 2);
  for (let j = 0; j < nH; j++) {
    const left = (j + firstSide) % 2 === 0;
    defs.push({ pos: v(left ? 0 : MAP_W, ys[j]), attach: crossings[j], cls: 'local' });
  }
  for (const d of defs) d.node = b.addNode(v(d.pos.x, d.pos.y), 'portal');

  // Main street spine.
  b.addEdge(defs[0].node!, crossings[0], 'arterial');
  for (let j = 0; j + 1 < nH; j++) b.addEdge(crossings[j], crossings[j + 1], 'arterial');
  b.addEdge(crossings[nH - 1], defs[1].node!, 'arterial');
  // Cross streets.
  for (let k = 2; k < defs.length; k++) b.addEdge(defs[k].attach, defs[k].node!, defs[k].cls);

  // Label portals A, B, C… clockwise from north.
  const cx = MAP_W / 2;
  const cy = MAP_H / 2;
  const sorted = [...defs].sort(
    (a, bb) =>
      clockwiseFromNorth(a.pos.x - cx, a.pos.y - cy) -
      clockwiseFromNorth(bb.pos.x - cx, bb.pos.y - cy),
  );
  sorted.forEach((d, i) => {
    b.nodes[d.node!].portal = PORTAL_LABELS[i];
  });

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
  // Spine town: 2-3 signals, one portal per road end (2 + one per signal).
  const signals = net.nodes.filter((n) => n.control.type === 'signal').length;
  if (signals < 2 || signals > 3) return false;
  if (net.portals.length !== signals + 2) return false;
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
