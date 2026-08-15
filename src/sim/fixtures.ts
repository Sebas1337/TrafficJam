// Hand-built networks for tests: small, exact, and independent of the
// map generator.

import { NetworkBuilder, type Network, type NodeId } from './network';
import { movementsByAxis } from './mapgen';
import { makeProgram } from './signals';
import { v } from './vec';

export interface CorridorFixture {
  net: Network;
  west: NodeId; // portal A
  east: NodeId; // portal B
  signals: NodeId[]; // west to east
}

/**
 * A straight west→east corridor: portal A — S1 — S2 — … — Sn — portal B,
 * with a stub north road at each signal so a two-phase program exists.
 * `edgeLen` is the centre-to-centre spacing between signals.
 */
export function buildCorridor(nSignals: number, edgeLen: number): CorridorFixture {
  const b = new NetworkBuilder();
  const y = 200;
  const west = b.addNode(v(0, y), 'portal', 'A');
  const signals: NodeId[] = [];
  for (let i = 0; i < nSignals; i++) {
    signals.push(b.addNode(v(120 + i * edgeLen, y), 'intersection'));
  }
  const east = b.addNode(v(120 + nSignals * edgeLen, y), 'portal', 'B');

  // North stubs give each intersection a cross street (and a second phase).
  const stubs: NodeId[] = [];
  for (let i = 0; i < nSignals; i++) {
    stubs.push(b.addNode(v(120 + i * edgeLen, y - 150), 'portal', String.fromCharCode(67 + i)));
  }

  let prev = west;
  for (const s of signals) {
    b.addEdge(prev, s, 'arterial');
    prev = s;
  }
  b.addEdge(prev, east, 'arterial');
  for (let i = 0; i < nSignals; i++) b.addEdge(signals[i], stubs[i], 'local');

  const net = b.build();
  for (const s of signals) {
    const { ns, ew } = movementsByAxis(net, s);
    net.nodes[s].control = { type: 'signal', program: makeProgram(ns, ew, 60, 0.5, 0) };
  }
  return { net, west, east, signals };
}
