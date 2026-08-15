// Determinism lint (spec §14): Math.random and Date.now are banned from
// src/sim/**. Enforced as a test so it needs no extra tooling.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SIM_DIR = join(new URL('../src/sim', import.meta.url).pathname);
const BANNED = ['Math.random', 'Date.now', 'new Date('];

describe('sim determinism lint', () => {
  it('src/sim/** contains no banned nondeterminism', () => {
    for (const file of readdirSync(SIM_DIR)) {
      if (!file.endsWith('.ts')) continue;
      const src = readFileSync(join(SIM_DIR, file), 'utf8');
      for (const token of BANNED) {
        expect(src.includes(token), `${file} uses ${token}`).toBe(false);
      }
    }
  });
});
