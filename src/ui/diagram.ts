// The time–space diagram (spec §8.2) — the game's marquee screen.
//
// Full-screen overlay. Y is distance along the corridor (one row per signal),
// X is time across two full cycles. Green bands show each signal's corridor
// green; diagonal lines are cars at design speed; a sweeping marker is "now".
// Direct manipulation: drag a band to change that signal's offset, drag its
// trailing edge to change the split, pinch (or ± buttons) for the common
// cycle. Auto-tune aligns one direction and is honest about the other.

import {
  autoTune,
  bandEfficiency,
  corridorInfo,
  normalizeCycles,
  type CorridorDir,
  type CorridorInfo,
} from '../sim/corridor';
import { CYCLE_MAX, CYCLE_MIN, YELLOW } from '../sim/constants';
import type { NodeId } from '../sim/network';
import { movementGreenWindow } from '../sim/signals';
import type { World } from '../sim/sim';

const GREEN = '#2fd274';
const GREEN_DIM = '#1f7a48';
const AMBER = '#f5c445';
const ROW_BG = '#2a3340';
const BAND_H = 34;

interface DragState {
  pointerId: number;
  row: number;
  mode: 'offset' | 'split';
  startX: number;
  startOffset: number;
  startSplit: number;
  moved: boolean;
}

export class TimeSpaceDiagram {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private effEl: HTMLElement;
  private cycleEl: HTMLElement;
  private world: World;
  private info: CorridorInfo | null = null;
  private drag: DragState | null = null;
  private pinch: { d0: number; c0: number } | null = null;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  onRelink: (() => void) | null = null;

  constructor(parent: HTMLElement, world: World) {
    this.world = world;
    this.root = document.createElement('div');
    this.root.id = 'diagram';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <header>
        <h2>Green wave</h2>
        <span class="caption">Drag a band sideways to retime that signal. Drag its right edge to stretch the green. Make the diagonal lines cross only green.</span>
        <button class="close" aria-label="Close">✕</button>
      </header>
      <div class="eff" data-eff></div>
      <canvas></canvas>
      <footer>
        <div class="group">
          <button data-cyc="-5" aria-label="Shorter cycle">−</button>
          <span data-cycle>60s</span>
          <button data-cyc="5" aria-label="Longer cycle">+</button>
        </div>
        <button data-tune="down">Auto ↓</button>
        <button data-tune="up">Auto ↑</button>
        <button data-relink class="ghost">Re-link</button>
      </footer>`;
    parent.appendChild(this.root);

    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.effEl = this.root.querySelector('[data-eff]')!;
    this.cycleEl = this.root.querySelector('[data-cycle]')!;

    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    this.root.querySelector('[data-relink]')!.addEventListener('click', () => {
      this.close();
      this.onRelink?.();
    });
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-cyc]')) {
      btn.addEventListener('click', () => this.bumpCycle(Number(btn.dataset.cyc)));
    }
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-tune]')) {
      btn.addEventListener('click', () => {
        if (!this.info) return;
        autoTune(this.world, this.info, btn.dataset.tune as CorridorDir);
        this.refreshStats();
      });
    }
    this.attachPointer();
  }

  setWorld(world: World): void {
    this.world = world;
    this.close();
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(nodes: NodeId[]): void {
    normalizeCycles(this.world, nodes);
    this.info = corridorInfo(this.world.net, nodes);
    this.root.classList.remove('hidden');
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.refreshStats();
  }

  close(): void {
    this.root.classList.add('hidden');
    this.info = null;
    this.drag = null;
    this.pinch = null;
  }

  // ------------------------------------------------------------------ layout

  private pad = { l: 46, r: 12, t: 26, b: 14 };

  private plotW(): number {
    return this.canvas.width / this.dpr - this.pad.l - this.pad.r;
  }
  private plotH(): number {
    return this.canvas.height / this.dpr - this.pad.t - this.pad.b;
  }
  private rowY(i: number): number {
    const info = this.info!;
    const t = info.total > 0 ? info.cumDist[i] / info.total : 0;
    return this.pad.t + BAND_H / 2 + t * (this.plotH() - BAND_H);
  }
  private cycle(): number {
    return this.world.signalProgram(this.info!.nodes[0])?.cycleLength ?? 60;
  }
  private xOf(t: number): number {
    return this.pad.l + (t / (2 * this.cycle())) * this.plotW();
  }

  /** Absolute-time start of the corridor green band for row i, in [0, C). */
  private bandStart(i: number): { start: number; len: number } | null {
    const info = this.info!;
    const program = this.world.signalProgram(info.nodes[i]);
    const m = info.downMovements[i] ?? info.upMovements[i];
    if (!program || m === null) return null;
    const win = movementGreenWindow(program, m);
    if (!win) return null;
    const C = program.cycleLength;
    const start = (((win.start - program.offset) % C) + C) % C;
    return { start, len: win.end - win.start };
  }

  // ------------------------------------------------------------------- draw

  /** Full redraw; called every frame while open (rows ≤ a handful, cheap). */
  tick(): void {
    if (!this.info) return;
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const C = this.cycle();
    ctx.clearRect(0, 0, w, h);

    // Time ticks every 10 s.
    ctx.fillStyle = '#5b6879';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let t = 0; t <= 2 * C; t += 10) {
      const x = this.xOf(t);
      ctx.fillRect(x, this.pad.t - 6, 1, 4);
      if (t % 30 === 0) ctx.fillText(`${t}`, x, this.pad.t - 10);
    }

    // Rows: background (red time), green band, yellow tail — two cycle copies.
    for (let i = 0; i < this.info.nodes.length; i++) {
      const y = this.rowY(i) - BAND_H / 2;
      ctx.fillStyle = ROW_BG;
      ctx.fillRect(this.pad.l, y, this.plotW(), BAND_H);
      const band = this.bandStart(i);
      if (band) {
        for (const k of [-1, 0, 1]) {
          const s = band.start + k * C;
          this.rect(ctx, s, y, band.len, BAND_H, GREEN);
          this.rect(ctx, s + band.len, y, YELLOW, BAND_H, AMBER);
          this.rect(ctx, s + C, y, band.len, BAND_H, GREEN);
          this.rect(ctx, s + C + band.len, y, YELLOW, BAND_H, AMBER);
        }
      }
      // Label.
      ctx.fillStyle = '#aeb9c9';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`S${i + 1}`, 8, this.rowY(i) + 4);
    }

    this.drawProgressionLines(ctx, 'down');
    this.drawProgressionLines(ctx, 'up');

    // Now marker.
    const now = this.world.time % (2 * C);
    ctx.strokeStyle = '#f2f6fc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.xOf(now), this.pad.t - 4);
    ctx.lineTo(this.xOf(now), h - this.pad.b);
    ctx.stroke();
  }

  /** Clip-safe band rectangle in time coordinates. */
  private rect(
    ctx: CanvasRenderingContext2D,
    tStart: number,
    y: number,
    tLen: number,
    hh: number,
    color: string,
  ): void {
    const C2 = 2 * this.cycle();
    const a = Math.max(0, tStart);
    const b = Math.min(C2, tStart + tLen);
    if (b <= a) return;
    ctx.fillStyle = color;
    ctx.fillRect(this.xOf(a), y, this.xOf(b) - this.xOf(a), hh);
  }

  private drawProgressionLines(ctx: CanvasRenderingContext2D, dir: CorridorDir): void {
    const info = this.info!;
    if (info.total <= 0) return;
    const C = this.cycle();
    const firstRow = dir === 'down' ? 0 : info.nodes.length - 1;
    const band = this.bandStart(firstRow);
    if (!band) return;
    const anchor = band.start + band.len / 2;
    const travel = info.total / info.designSpeed;
    const y0 = this.rowY(dir === 'down' ? 0 : info.nodes.length - 1);
    const y1 = this.rowY(dir === 'down' ? info.nodes.length - 1 : 0);

    ctx.strokeStyle = dir === 'down' ? '#f2f6fc' : '#8fb7ff';
    ctx.globalAlpha = dir === 'down' ? 0.45 : 0.35;
    ctx.lineWidth = 2;
    ctx.setLineDash(dir === 'down' ? [] : [5, 5]);
    for (let k = -2; k <= 2; k++) {
      const t0 = anchor + k * C;
      ctx.beginPath();
      ctx.moveTo(this.xOf(t0), y0);
      ctx.lineTo(this.xOf(t0 + travel), y1);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ interaction

  private attachPointer(): void {
    const active = new Map<number, { x: number; y: number }>();

    this.canvas.addEventListener('pointerdown', (e) => {
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointers */
      }
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      active.set(e.pointerId, { x, y });

      if (active.size === 2) {
        const [a, b] = [...active.values()];
        this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), c0: this.cycle() };
        this.drag = null;
        return;
      }
      if (!this.info) return;
      const row = this.hitRow(y);
      if (row === null) return;
      const knobs = this.world.signalKnobs(this.info.nodes[row]);
      const band = this.bandStart(row);
      if (!knobs || !band) return;
      const nearEnd = [0, 1].some((k) => {
        const edge = this.xOf(((band.start + band.len) % this.cycle()) + k * this.cycle());
        return Math.abs(x - edge) < 18;
      });
      this.drag = {
        pointerId: e.pointerId,
        row,
        mode: nearEnd ? 'split' : 'offset',
        startX: x,
        startOffset: knobs.offset,
        startSplit: knobs.split,
        moved: false,
      };
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const prev = active.get(e.pointerId);
      if (prev) active.set(e.pointerId, { x, y });

      if (this.pinch && active.size === 2) {
        const [a, b] = [...active.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const c = Math.round((this.pinch.c0 * (d / this.pinch.d0)) / 5) * 5;
        this.setCycleAll(Math.max(CYCLE_MIN, Math.min(CYCLE_MAX, c)));
        return;
      }
      if (!this.drag || !this.info || e.pointerId !== this.drag.pointerId) return;
      const dt = ((x - this.drag.startX) / this.plotW()) * 2 * this.cycle();
      if (Math.abs(x - this.drag.startX) > 4) this.drag.moved = true;
      const node = this.info.nodes[this.drag.row];
      const C = this.cycle();
      if (this.drag.mode === 'offset') {
        const offset = (((this.drag.startOffset - dt) % C) + C) % C;
        this.world.setSignal(node, { cycle: C, split: this.drag.startSplit, offset });
      } else {
        // Dragging the band's trailing edge: grow/shrink this movement's green.
        const program = this.world.signalProgram(node);
        const m = this.info.downMovements[this.drag.row] ?? this.info.upMovements[this.drag.row];
        if (!program || m === null) return;
        const inPhase0 = program.phases[0].movements.includes(m);
        const delta = (dt / C) * (inPhase0 ? 1 : -1);
        const split = Math.max(0.2, Math.min(0.8, this.drag.startSplit + delta));
        this.world.setSignal(node, {
          cycle: C,
          split,
          offset: this.drag.startOffset,
        });
      }
      this.refreshStats();
    });

    const end = (e: PointerEvent): void => {
      active.delete(e.pointerId);
      if (active.size < 2) this.pinch = null;
      if (this.drag && e.pointerId === this.drag.pointerId) this.drag = null;
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  private hitRow(y: number): number | null {
    if (!this.info) return null;
    for (let i = 0; i < this.info.nodes.length; i++) {
      if (Math.abs(y - this.rowY(i)) <= BAND_H / 2 + 8) return i;
    }
    return null;
  }

  private bumpCycle(delta: number): void {
    this.setCycleAll(Math.max(CYCLE_MIN, Math.min(CYCLE_MAX, this.cycle() + delta)));
  }

  private setCycleAll(cycle: number): void {
    if (!this.info || cycle === this.cycle()) return;
    for (const n of this.info.nodes) {
      const k = this.world.signalKnobs(n);
      if (k) this.world.setSignal(n, { cycle, split: k.split, offset: k.offset % cycle });
    }
    this.refreshStats();
  }

  private refreshStats(): void {
    if (!this.info) return;
    this.cycleEl.textContent = `${this.cycle()}s`;
    const down = Math.round(bandEfficiency(this.world, this.info, 'down') * 100);
    const up = Math.round(bandEfficiency(this.world, this.info, 'up') * 100);
    const cls = (v: number): string => (v >= 45 ? 'good' : v >= 20 ? 'mid' : 'bad');
    this.effEl.innerHTML =
      `<span class="${cls(down)}">↓ wave ${down}%</span>` +
      `<span class="${cls(up)}">↑ wave ${up}%</span>`;
  }
}
