// Test 4 (spec §14): signal phase math across offset wraparound and at
// exact boundaries. Phase is derived from (simTime + offset) % cycleLength.

import { describe, expect, it } from 'vitest';
import { makeProgram, movementState, timeToGreen, programSplit } from '../src/sim/signals';

const NS = [10, 11];
const EW = [20, 21];

describe('signal phase derivation', () => {
  const p = makeProgram(NS, EW, 60, 0.5, 0);
  // Phase 0: green [0, 25.5), yellow [25.5, 28.5), all-red [28.5, 30)
  // Phase 1: green [30, 55.5), yellow [55.5, 58.5), all-red [58.5, 60)

  it('splits the cycle correctly', () => {
    expect(programSplit(p)).toBeCloseTo(0.5);
    expect(p.phases[0].green).toBeCloseTo(25.5);
  });

  it('walks green → yellow → red at exact boundaries', () => {
    expect(movementState(p, NS[0], 0)).toBe('green');
    expect(movementState(p, NS[0], 25.499)).toBe('green');
    expect(movementState(p, NS[0], 25.5)).toBe('yellow');
    expect(movementState(p, NS[0], 28.499)).toBe('yellow');
    expect(movementState(p, NS[0], 28.5)).toBe('red');
    expect(movementState(p, NS[0], 30)).toBe('red');
    expect(movementState(p, EW[0], 30)).toBe('green');
    expect(movementState(p, EW[0], 15)).toBe('red');
  });

  it('wraps across the cycle', () => {
    expect(movementState(p, NS[0], 60)).toBe('green');
    expect(movementState(p, NS[0], 6000)).toBe('green');
    expect(movementState(p, EW[0], 6031)).toBe('green');
  });

  it('applies offsets, including wraparound offsets', () => {
    const q = makeProgram(NS, EW, 60, 0.5, 55);
    // x = (t + 55) % 60 → at t = 5, x = 0 → NS green.
    expect(movementState(q, NS[0], 5)).toBe('green');
    // at t = 0, x = 55 → phase 1 yellow window [55.5, 58.5)? x=55 → green EW.
    expect(movementState(q, EW[0], 0)).toBe('green');
    expect(movementState(q, NS[0], 0)).toBe('red');
  });

  it('reports time to green', () => {
    expect(timeToGreen(p, NS[0], 0)).toBe(0);
    expect(timeToGreen(p, EW[0], 0)).toBeCloseTo(30);
    expect(timeToGreen(p, NS[0], 30)).toBeCloseTo(30);
  });

  it('clamps split so both phases keep minimum green', () => {
    const q = makeProgram(NS, EW, 40, 0.05, 0);
    expect(q.phases[0].green).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(q.phases[1].green).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(
      q.phases.reduce((s, ph) => s + ph.green + ph.yellow + ph.allRed, 0),
    ).toBeCloseTo(40);
  });
});
