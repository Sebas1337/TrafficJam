// Corridor coordination math (spec §8). Pure functions over the network and
// signal programs — the time–space diagram UI is a thin view over these.
//
// A corridor is an ordered list of signalised nodes the player has linked.
// Coordination is only meaningful on a common cycle length, so linking
// normalizes cycles; offsets stay per-signal and are THE tuning knob.

import { PROGRESSION_FACTOR, SPEED_ARTERIAL } from './constants';
import type { ConnId, Network, NodeId } from './network';
import { movementGreenWindow } from './signals';
import type { World } from './sim';
import { dist, norm, sub, type Vec2 } from './vec';

export type CorridorDir = 'down' | 'up'; // down = nodes[0] -> nodes[last]

export interface CorridorInfo {
  nodes: NodeId[];
  cumDist: number[]; // distance of each node from nodes[0]
  total: number;
  designSpeed: number; // m/s, PROGRESSION_FACTOR x slowest span limit
  downMovements: (ConnId | null)[]; // through movement at each node, travelling down
  upMovements: (ConnId | null)[];
}

export function corridorInfo(net: Network, nodes: NodeId[]): CorridorInfo {
  const pos = nodes.map((n) => net.nodes[n].pos);
  const cumDist: number[] = [0];
  for (let i = 1; i < nodes.length; i++) cumDist.push(cumDist[i - 1] + dist(pos[i - 1], pos[i]));
  const total = cumDist[cumDist.length - 1];

  const hop = (i: number): Vec2 => norm(sub(pos[Math.min(i + 1, pos.length - 1)], pos[Math.min(i, pos.length - 2)]));

  let minLimit = SPEED_ARTERIAL;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const lane = net.lanes.find(
      (l) =>
        (l.fromNode === nodes[i] && l.toNode === nodes[i + 1]) ||
        (l.fromNode === nodes[i + 1] && l.toNode === nodes[i]),
    );
    if (lane) minLimit = Math.min(minLimit, net.edges[lane.edge].speedLimit);
  }

  const throughFor = (node: NodeId, dir: Vec2): ConnId | null => {
    for (const c of net.connections) {
      if (c.node !== node || c.kind !== 'through') continue;
      const d = net.lanes[c.inLane].direction;
      if (d.x * dir.x + d.y * dir.y > 0.7) return c.id;
    }
    return null;
  };

  return {
    nodes,
    cumDist,
    total,
    designSpeed: PROGRESSION_FACTOR * minLimit,
    downMovements: nodes.map((n, i) => throughFor(n, hop(i))),
    upMovements: nodes.map((n, i) => {
      const h = hop(i);
      return throughFor(n, { x: -h.x, y: -h.y });
    }),
  };
}

/** Force every corridor signal onto a common cycle. Returns that cycle. */
export function normalizeCycles(world: World, nodes: NodeId[]): number {
  const first = world.signalKnobs(nodes[0]);
  if (!first) return 60;
  for (const n of nodes.slice(1)) {
    const k = world.signalKnobs(n);
    if (k && k.cycle !== first.cycle) {
      world.setSignal(n, { cycle: first.cycle, split: k.split, offset: k.offset % first.cycle });
    }
  }
  return first.cycle;
}

/** Travel distance to node i when driving the corridor in `dir`. */
function travelDist(info: CorridorInfo, i: number, dir: CorridorDir): number {
  return dir === 'down' ? info.cumDist[i] : info.total - info.cumDist[i];
}

/**
 * Band efficiency: the share of the cycle during which a car entering the
 * corridor at design speed clears EVERY signal without stopping (spec §8.2).
 */
export function bandEfficiency(world: World, info: CorridorInfo, dir: CorridorDir): number {
  const movements = dir === 'down' ? info.downMovements : info.upMovements;
  const programs = info.nodes.map((n) => world.signalProgram(n));
  const wins: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < info.nodes.length; i++) {
    const p = programs[i];
    const m = movements[i];
    if (!p || m === null) return 0;
    const w = movementGreenWindow(p, m);
    if (!w) return 0;
    wins.push(w);
  }
  const C = programs[0]!.cycleLength;
  const N = 240;
  let ok = 0;
  for (let k = 0; k < N; k++) {
    const tau = (k / N) * C;
    let pass = true;
    for (let i = 0; i < info.nodes.length && pass; i++) {
      const t = tau + travelDist(info, i, dir) / info.designSpeed;
      const x = (((t + programs[i]!.offset) % C) + C) % C;
      pass = x >= wins[i].start && x < wins[i].end;
    }
    if (pass) ok++;
  }
  return ok / N;
}

/**
 * Auto-tune (spec §8.2): keep the first signal (in travel order) fixed and
 * offset the rest so a car leaving its green-centre at design speed hits
 * every downstream green-centre. One direction only — the other direction's
 * efficiency is whatever falls out, which is the real trade-off.
 */
export function autoTune(world: World, info: CorridorInfo, dir: CorridorDir): void {
  const movements = dir === 'down' ? info.downMovements : info.upMovements;
  const order = [...info.nodes.keys()];
  if (dir === 'up') order.reverse();

  const base = order[0];
  const baseProgram = world.signalProgram(info.nodes[base]);
  const baseMovement = movements[base];
  if (!baseProgram || baseMovement === null) return;
  const baseWin = movementGreenWindow(baseProgram, baseMovement);
  if (!baseWin) return;
  const C = baseProgram.cycleLength;
  const mod = (x: number): number => ((x % C) + C) % C;

  // Absolute time at which the base signal's green-centre occurs.
  const t0 = mod((baseWin.start + baseWin.end) / 2 - baseProgram.offset);
  const baseDist = travelDist(info, base, dir);

  for (const i of order.slice(1)) {
    const node = info.nodes[i];
    const program = world.signalProgram(node);
    const m = movements[i];
    if (!program || m === null) continue;
    const win = movementGreenWindow(program, m);
    const knobs = world.signalKnobs(node);
    if (!win || !knobs) continue;
    const travel = (travelDist(info, i, dir) - baseDist) / info.designSpeed;
    const mid = (win.start + win.end) / 2;
    // Want ((t0 + travel) + offset) % C === mid.
    const offset = mod(mid - t0 - travel);
    world.setSignal(node, { cycle: C, split: knobs.split, offset });
  }
}
