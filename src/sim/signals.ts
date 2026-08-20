// Signal programs (spec §5.2, §8). The load-bearing invariant:
// current phase is DERIVED from (simTime + offset) % cycleLength, never stored.

import { ALL_RED, CYCLE_MAX, CYCLE_MIN, MIN_GREEN, YELLOW } from './constants';
import type { ConnId } from './network';

export interface SignalPhase {
  movements: ConnId[]; // TurnConnection ids that get green
  green: number;
  yellow: number;
  allRed: number;
}

export interface SignalProgram {
  cycleLength: number;
  offset: number; // seconds — THE coordination knob
  phases: SignalPhase[];
}

export type LightState = 'green' | 'yellow' | 'red';

interface PhaseWindow {
  movements: ConnId[];
  greenStart: number;
  greenEnd: number;
  yellowEnd: number;
  phaseEnd: number;
}

// Programs are replaced (not mutated) on edit, so a WeakMap cache is safe.
const windowCache = new WeakMap<SignalProgram, PhaseWindow[]>();

function windows(p: SignalProgram): PhaseWindow[] {
  let w = windowCache.get(p);
  if (w) return w;
  w = [];
  let t = 0;
  for (const ph of p.phases) {
    w.push({
      movements: ph.movements,
      greenStart: t,
      greenEnd: t + ph.green,
      yellowEnd: t + ph.green + ph.yellow,
      phaseEnd: t + ph.green + ph.yellow + ph.allRed,
    });
    t += ph.green + ph.yellow + ph.allRed;
  }
  windowCache.set(p, w);
  return w;
}

/** Time position within the cycle. */
export function cycleTime(p: SignalProgram, simTime: number): number {
  const c = p.cycleLength;
  let x = (simTime + p.offset) % c;
  if (x < 0) x += c;
  return x;
}

/** Light state for one movement at a given sim time. Derived, never stored. */
export function movementState(p: SignalProgram, movement: ConnId, simTime: number): LightState {
  const x = cycleTime(p, simTime);
  for (const w of windows(p)) {
    if (x >= w.greenStart && x < w.phaseEnd) {
      if (!w.movements.includes(movement)) return 'red';
      if (x < w.greenEnd) return 'green';
      if (x < w.yellowEnd) return 'yellow';
      return 'red';
    }
  }
  return 'red';
}

/** Cycle-local green window [start, end) for a movement, or null if never green. */
export function movementGreenWindow(
  p: SignalProgram,
  movement: ConnId,
): { start: number; end: number } | null {
  for (const w of windows(p)) {
    if (w.movements.includes(movement)) return { start: w.greenStart, end: w.greenEnd };
  }
  return null;
}

/** Seconds until this movement next turns green (0 if green now). */
export function timeToGreen(p: SignalProgram, movement: ConnId, simTime: number): number {
  if (movementState(p, movement, simTime) === 'green') return 0;
  const x = cycleTime(p, simTime);
  let best = Infinity;
  for (const w of windows(p)) {
    if (!w.movements.includes(movement)) continue;
    const dt = w.greenStart - x;
    best = Math.min(best, dt >= 0 ? dt : dt + p.cycleLength);
  }
  return best;
}

/**
 * Build a program from the player-facing knobs: cycle length, split (share of
 * the *vehicle* time given to phase 0), offset, and an optional pedestrian
 * walk phase (all movements red) appended at the end of the cycle.
 */
export function makeProgram(
  phase0Movements: ConnId[],
  phase1Movements: ConnId[],
  cycleLength: number,
  split: number,
  offset: number,
  pedSeconds = 0,
): SignalProgram {
  const cycle = clamp(cycleLength, CYCLE_MIN, CYCLE_MAX);
  const lost = YELLOW + ALL_RED;
  const vehicle = cycle - pedSeconds;
  const minShare = (MIN_GREEN + lost) / vehicle;
  const s = clamp(split, minShare, 1 - minShare);
  const d0 = vehicle * s;
  const d1 = vehicle - d0;
  const phases: SignalPhase[] = [
    { movements: phase0Movements, green: d0 - lost, yellow: YELLOW, allRed: ALL_RED },
    { movements: phase1Movements, green: d1 - lost, yellow: YELLOW, allRed: ALL_RED },
  ];
  if (pedSeconds > 0) phases.push({ movements: [], green: pedSeconds, yellow: 0, allRed: 0 });
  return {
    cycleLength: cycle,
    offset: ((offset % cycle) + cycle) % cycle,
    phases,
  };
}

/** Player-facing split derived back from the phases (vehicle time only). */
export function programSplit(p: SignalProgram): number {
  const ph = p.phases[0];
  const vehicle = p.cycleLength - programPed(p);
  return (ph.green + ph.yellow + ph.allRed) / vehicle;
}

/** Seconds of pedestrian walk phase in the program (0 if none). */
export function programPed(p: SignalProgram): number {
  const ped = p.phases[2];
  return ped ? ped.green + ped.yellow + ped.allRed : 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
