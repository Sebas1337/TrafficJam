// Main menu + campaign level select + level intro card + end-of-run stats.
// Plain DOM overlays; the Game drives transitions through the callbacks.

import { LEVELS, type LevelConfig } from '../levels';

export interface RunStats {
  title: string;
  delivered: number;
  simTime: number;
  meanDelay: number;
  tti: number;
  stars: number | null; // null = endless (no stars)
  won: boolean;
}

export class Menu {
  private root: HTMLElement;
  onContinue: (() => void) | null = null;
  onEndless: (() => void) | null = null;
  onLevel: ((index: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'overlay hidden';
    parent.appendChild(this.root);
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  showHome(canContinue: boolean): void {
    this.root.innerHTML = `
      <h1>TrafficJam</h1>
      <p>Keep the town moving. Time the lights, build the streets, beat the gridlock.</p>
      ${canContinue ? '<button data-continue>Continue town</button>' : ''}
      <button data-endless ${canContinue ? 'class="secondary"' : ''}>New endless town</button>
      <button data-campaign class="secondary">Campaign</button>`;
    this.root.classList.remove('hidden');
    this.root.querySelector('[data-continue]')?.addEventListener('click', () => this.onContinue?.());
    this.root.querySelector('[data-endless]')!.addEventListener('click', () => this.onEndless?.());
    this.root
      .querySelector('[data-campaign]')!
      .addEventListener('click', () => this.showLevels(loadStarsSafe()));
  }

  showLevels(stars: Record<string, number>): void {
    const rows = LEVELS.map((lvl, i) => {
      const got = stars[lvl.id] ?? 0;
      const unlocked = i === 0 || (stars[LEVELS[i - 1].id] ?? 0) >= 1;
      const starStr = '★'.repeat(got) + '☆'.repeat(3 - got);
      return `<button class="level-row ${unlocked ? '' : 'locked'}" data-level="${i}" ${unlocked ? '' : 'disabled'}>
        <span class="num">${i + 1}</span>
        <span class="name">${lvl.name}</span>
        <span class="stars">${unlocked ? starStr : '🔒'}</span>
      </button>`;
    }).join('');
    this.root.innerHTML = `
      <h1>Campaign</h1>
      <div class="level-list">${rows}</div>
      <button data-back class="secondary">Back</button>`;
    this.root.classList.remove('hidden');
    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.showHome(true));
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-level]')) {
      btn.addEventListener('click', () => this.onLevel?.(Number(btn.dataset.level)));
    }
  }

  /** Level intro card. Resolves when the player hits Start. */
  showIntro(level: LevelConfig, index: number, onStart: () => void): void {
    this.root.innerHTML = `
      <span class="level-tag">Level ${index + 1}</span>
      <h1>${level.name}</h1>
      <p>${level.teach}</p>
      <button data-start>Start</button>`;
    this.root.classList.remove('hidden');
    this.root.querySelector('[data-start]')!.addEventListener('click', () => {
      this.hide();
      onStart();
    });
  }

  showStats(
    stats: RunStats,
    actions: Array<{ label: string; secondary?: boolean; fn: () => void }>,
  ): void {
    const mins = Math.floor(stats.simTime / 60);
    const secs = Math.floor(stats.simTime % 60);
    const starStr =
      stats.stars === null ? '' : `<div class="big stars-line">${'★'.repeat(stats.stars)}${'☆'.repeat(3 - stats.stars)}</div>`;
    this.root.innerHTML = `
      <h1>${stats.title}</h1>
      ${starStr}
      <div class="stat-grid">
        <div><b>${stats.delivered}</b><span>delivered</span></div>
        <div><b>${mins}:${secs.toString().padStart(2, '0')}</b><span>survived</span></div>
        <div><b>${stats.meanDelay.toFixed(0)}s</b><span>avg delay</span></div>
        <div><b>${stats.tti.toFixed(2)}×</b><span>travel time index</span></div>
      </div>
      <div data-actions></div>`;
    const wrap = this.root.querySelector('[data-actions]')!;
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      if (a.secondary) btn.className = 'secondary';
      btn.addEventListener('click', a.fn);
      wrap.appendChild(btn);
    }
    this.root.classList.remove('hidden');
  }
}

function loadStarsSafe(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('tj.stars.v1') ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}
