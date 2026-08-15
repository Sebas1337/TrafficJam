// Headless harness (spec §14): step the sim with no rendering. The backbone
// of the test suite and of any future balancing scripts.

import { SIM_HZ } from './constants';
import { generateMap } from './mapgen';
import { World, type DemandFn } from './sim';

export function createWorld(seed: number, demand?: DemandFn): World {
  const { net } = generateMap(seed);
  return new World(net, seed, demand);
}

export interface HeadlessResult {
  delivered: number;
  activeCars: number;
  frustration: number;
  simTime: number;
  totalDelay: number;
}

/**
 * Run `seconds` of simulation. `onStep` fires after every tick — tests use it
 * to assert invariants (collisions, NaNs, negative speeds) at full resolution.
 */
export function runHeadless(
  world: World,
  seconds: number,
  onStep?: (world: World, tick: number) => void,
): HeadlessResult {
  const ticks = Math.round(seconds * SIM_HZ);
  for (let i = 0; i < ticks; i++) {
    world.step();
    onStep?.(world, i);
  }
  return {
    delivered: world.metrics.delivered,
    activeCars: world.metrics.activeCars,
    frustration: world.metrics.frustration,
    simTime: world.metrics.simTime,
    totalDelay: world.metrics.totalDelay,
  };
}
