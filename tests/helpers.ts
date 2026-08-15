import { CAR_LENGTH } from '../src/sim/constants';
import type { World } from '../src/sim/sim';

/**
 * Assert the collision invariant + sanity checks for the current tick.
 * Plain throws instead of expect(): this runs ~10^7 times per test file,
 * and assertion-library overhead would dominate the suite's runtime.
 */
export function assertInvariants(world: World): void {
  const check = (list: number[], where: string): void => {
    for (let i = 0; i < list.length; i++) {
      const car = world.cars.get(list[i])!;
      if (!Number.isFinite(car.s) || !Number.isFinite(car.v)) {
        throw new Error(`t=${world.time.toFixed(2)} ${where}: car ${car.id} non-finite state`);
      }
      if (car.v < 0) {
        throw new Error(`t=${world.time.toFixed(2)} ${where}: car ${car.id} negative speed ${car.v}`);
      }
      if (i > 0) {
        const ahead = world.cars.get(list[i - 1])!;
        if (ahead.s - CAR_LENGTH - car.s < -1e-6) {
          throw new Error(
            `t=${world.time.toFixed(2)} ${where}: overlap — car ${ahead.id} (s=${ahead.s.toFixed(2)}) vs car ${car.id} (s=${car.s.toFixed(2)})`,
          );
        }
      }
    }
  };
  for (const l of world.net.lanes) check(l.cars, `lane ${l.id}`);
  for (const c of world.net.connections) check(c.cars, `conn ${c.id}`);
}
