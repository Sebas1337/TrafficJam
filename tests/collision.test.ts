// Test 1 (spec §14): the collision invariant. Across 1000 sim-seconds on
// several seeds, no two cars on the same lane or connection ever overlap.
// Test 2 rides along: no negative speeds, no NaN positions, ever.

import { describe, it } from 'vitest';
import { createWorld, runHeadless } from '../src/sim/headless';
import { assertInvariants } from './helpers';

const SEEDS = [1, 42, 4471];

describe('collision invariant', () => {
  for (const seed of SEEDS) {
    it(`no overlaps, no negative speeds, no NaNs — seed ${seed}, 1000 s`, () => {
      const world = createWorld(seed);
      runHeadless(world, 1000, (w) => assertInvariants(w));
    });
  }
});
