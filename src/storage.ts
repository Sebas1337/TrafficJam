// localStorage persistence (spec §13). Keys namespaced tj.*; all access is
// wrapped so private-mode/quota failures degrade to "no save" rather than
// crashing the game.

import type { SaveV1 } from './sim/persist';

const ENDLESS_KEY = 'tj.endless.v1';
const STARS_KEY = 'tj.stars.v1';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: play on without saves */
  }
}

export function loadEndlessSave(): SaveV1 | null {
  const save = read<SaveV1>(ENDLESS_KEY);
  return save && save.v === 1 ? save : null;
}

export function storeEndlessSave(save: SaveV1): void {
  write(ENDLESS_KEY, save);
}

export function clearEndlessSave(): void {
  try {
    localStorage.removeItem(ENDLESS_KEY);
  } catch {
    /* ignore */
  }
}

export function loadStars(): Record<string, number> {
  return read<Record<string, number>>(STARS_KEY) ?? {};
}

export function storeStars(levelId: string, stars: number): void {
  const all = loadStars();
  if ((all[levelId] ?? 0) < stars) {
    all[levelId] = stars;
    write(STARS_KEY, all);
  }
}
