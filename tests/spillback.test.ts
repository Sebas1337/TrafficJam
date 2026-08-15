// Test 6 (spec §14): spillback bites, and clears when a signal is retimed.
//
// Fixture: portal A — S1 — S2 — portal B, short middle edge. S2 is jammed
// shut for the corridor (its program gives the through movement no green),
// so the middle edge fills. The assertion with teeth: cars at S1 hold at the
// stop line EVEN ON GREEN because there is no room on the far side — S1's
// box stays empty. Retime S2 and the corridor drains.

import { describe, expect, it } from 'vitest';
import { buildCorridor } from '../src/sim/fixtures';
import { movementsByAxis } from '../src/sim/mapgen';
import { makeProgram, movementState } from '../src/sim/signals';
import { World } from '../src/sim/sim';
import { runHeadless } from '../src/sim/headless';
import { assertInvariants } from './helpers';

describe('spillback', () => {
  it('blocks entry on green when the far side is full, then clears on retime', () => {
    const { net, west, east, signals } = buildCorridor(2, 120);
    const [s1, s2] = signals;

    // S1: corridor effectively always green (tiny cross-street share).
    const m1 = movementsByAxis(net, s1);
    net.nodes[s1].control = {
      type: 'signal',
      program: makeProgram(m1.ew, m1.ns, 120, 0.9, 0),
    };
    // S2: corridor gets NO green at all — both phases serve the cross street.
    const m2 = movementsByAxis(net, s2);
    net.nodes[s2].control = {
      type: 'signal',
      program: makeProgram(m2.ns, m2.ns, 60, 0.5, 0),
    };

    // Steady eastbound demand, nothing else. Failure is disabled: the test
    // engineers a 2-minute total jam, which would (correctly) end a real run.
    const world = new World(net, 1, (w) => {
      if (Math.round(w.time * 60) % 90 === 0) w.enqueueSpawn(west, east);
    });
    world.failureEnabled = false;

    // Phase 1: let the middle edge fill and spill back to S1.
    runHeadless(world, 120, (w) => assertInvariants(w));

    const middleLane = net.lanes.find(
      (l) => l.fromNode === s1 && l.toNode === s2,
    )!;
    const upstreamLane = net.lanes.find(
      (l) => l.fromNode === west && l.toNode === s1,
    )!;

    // The middle edge is saturated and a queue has spilled upstream of S1.
    expect(middleLane.cars.length).toBeGreaterThanOrEqual(10);
    expect(upstreamLane.cars.length).toBeGreaterThanOrEqual(5);
    expect(world.metrics.delivered).toBe(0);

    // The rule bites: even WHILE S1's through movement is green, its box
    // stays empty — cars refuse to enter because the far side is full.
    // (Step to a mid-green moment first; asserting at an exact phase
    // boundary is a coin flip on floating-point time.)
    const s1Through = net.connections.find(
      (c) => c.node === s1 && c.inLane === upstreamLane.id && c.kind === 'through',
    )!;
    const s1Box = net.connections.filter((c) => c.node === s1);
    let sawGreen = false;
    for (let i = 0; i < 121 * 60 && !sawGreen; i++) {
      world.step();
      if (movementState(world.signalProgram(s1)!, s1Through.id, world.time) === 'green') {
        sawGreen = true;
        expect(s1Box.every((c) => c.cars.length === 0)).toBe(true);
      }
    }
    expect(sawGreen).toBe(true);
    expect(world.metrics.delivered).toBe(0);

    // Phase 2: retime S2 to give the corridor green. The jam must clear.
    net.nodes[s2].control = {
      type: 'signal',
      program: makeProgram(m2.ew, m2.ns, 60, 0.8, 0),
    };
    const before = middleLane.cars.length;
    runHeadless(world, 120, (w) => assertInvariants(w));

    expect(world.metrics.delivered).toBeGreaterThan(20);
    expect(middleLane.cars.length).toBeLessThan(before);
  });
});
