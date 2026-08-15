// Test 5 (spec §14): routing returns a connected, traversable lane path
// between every portal pair, on many generated maps.

import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/sim/mapgen';
import { buildAllRouteTrees } from '../src/sim/routing';

describe('routing', () => {
  it('every portal pair has a traversable route (50 seeds)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { net } = generateMap(seed);
      const trees = buildAllRouteTrees(net);
      for (const origin of net.portals) {
        for (const dest of net.portals) {
          if (origin === dest) continue;
          const tree = trees.get(dest)!;
          const startLane = net.lanes.find((l) => l.fromNode === origin)!;
          expect(tree.cost[startLane.id], `seed ${seed}: no route`).toBeLessThan(Infinity);

          // Walk the tree; every hop must be a real connection linking
          // consecutive lanes, and it must terminate at the destination.
          let lane = startLane;
          let hops = 0;
          for (;;) {
            const cid = tree.next[lane.id];
            if (cid === undefined) break;
            const conn = net.connections[cid];
            expect(conn.inLane).toBe(lane.id);
            lane = net.lanes[conn.outLane];
            expect(++hops).toBeLessThan(200);
          }
          expect(lane.toNode, `seed ${seed}: route ends off-destination`).toBe(dest);
        }
      }
    }
  });
});
