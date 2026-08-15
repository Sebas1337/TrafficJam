// Seeded PRNG (spec §14). The only source of randomness allowed in the sim.

export type Rng = () => number;

/** mulberry32: fast 32-bit seeded PRNG, returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick an integer in [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Uniform float in [lo, hi). */
export function randRange(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}
