// Test 7 (spec §14): the core mechanic works. On a fixture corridor whose
// signal spacing puts zero-offset arrivals mid-red, auto-tuned offsets must
// measurably beat zero offsets on mean delay — proving green waves are real,
// not just implemented.

import { describe, expect, it } from 'vitest';
import { autoTune, bandEfficiency, corridorInfo } from '../src/sim/corridor';
import { buildCorridor } from '../src/sim/fixtures';
import { runHeadless } from '../src/sim/headless';
import { World } from '../src/sim/sim';
import { assertInvariants } from './helpers';

// 350 m spacing at design speed 11.8 m/s ≈ 29.6 s travel ≈ half the 60 s
// cycle: with zero offsets every hop lands mid-red. Worst reasonable case.
const SPACING = 350;

function run(offsets: number[] | 'tuned'): { meanDelay: number; delivered: number; eff: number } {
  const { net, west, east, signals } = buildCorridor(3, SPACING);
  const world = new World(net, 1, (w) => {
    if (Math.round(w.time * 60) % 240 === 0) w.enqueueSpawn(west, east); // 15/min
  });
  world.failureEnabled = false;

  const info = corridorInfo(net, signals);
  if (offsets === 'tuned') {
    autoTune(world, info, 'down');
  } else {
    signals.forEach((s, i) => {
      const k = world.signalKnobs(s)!;
      world.setSignal(s, { cycle: k.cycle, split: k.split, offset: offsets[i] });
    });
  }
  const eff = bandEfficiency(world, info, 'down');
  runHeadless(world, 300, (w) => assertInvariants(w));
  const m = world.metrics;
  return {
    meanDelay: m.delivered > 0 ? m.totalDelay / m.delivered : Infinity,
    delivered: m.delivered,
    eff,
  };
}

describe('green wave (core mechanic)', () => {
  it('auto-tuned offsets measurably beat zero offsets', () => {
    const zero = run([0, 0, 0]);
    const tuned = run('tuned');

    // The tuned corridor must have a real progression band...
    expect(tuned.eff).toBeGreaterThan(0.3);
    expect(zero.eff).toBeLessThan(0.05);
    // ...and it must show up in what players feel: delay and throughput.
    // (Even a perfect wave pays the first-signal stop, so the mean can't go
    // to zero — assert a large relative AND absolute improvement.)
    expect(tuned.delivered).toBeGreaterThanOrEqual(zero.delivered);
    expect(tuned.meanDelay).toBeLessThan(zero.meanDelay * 0.75);
    expect(zero.meanDelay - tuned.meanDelay).toBeGreaterThan(10);
  });

  it('efficiency math is direction-aware', () => {
    const { net, signals } = buildCorridor(3, SPACING);
    const world = new World(net, 1);
    const info = corridorInfo(net, signals);
    autoTune(world, info, 'down');
    const down = bandEfficiency(world, info, 'down');
    const up = bandEfficiency(world, info, 'up');
    // Tuning one direction at ~C/2 hop spacing generally sacrifices the other.
    expect(down).toBeGreaterThan(up);
  });
});
