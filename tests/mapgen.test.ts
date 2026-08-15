// Test 3 (spec §14): generator soundness. 1000 seeds all produce valid,
// fully connected maps.

import { describe, expect, it } from 'vitest';
import { generateMap, validate, fullyConnected } from '../src/sim/mapgen';

describe('map generator', () => {
  it('1000 seeds produce valid, fully connected maps', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const { net } = generateMap(seed);
      expect(validate(net), `seed ${seed} failed validation`).toBe(true);
      expect(fullyConnected(net), `seed ${seed} not connected`).toBe(true);
      expect(net.portals.length).toBe(3);
      const signals = net.nodes.filter((n) => n.control.type === 'signal').length;
      expect(signals).toBeGreaterThanOrEqual(4);
      expect(signals).toBeLessThanOrEqual(6);
    }
  });

  it('is deterministic: same seed, same map', () => {
    const a = generateMap(7).net;
    const b = generateMap(7).net;
    expect(JSON.stringify(a.nodes.map((n) => n.pos))).toBe(
      JSON.stringify(b.nodes.map((n) => n.pos)),
    );
    expect(a.lanes.length).toBe(b.lanes.length);
    expect(a.connections.length).toBe(b.connections.length);
  });
});
