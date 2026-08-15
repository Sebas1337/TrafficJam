// The signal timing editor (slice 1's core interaction): tap an intersection,
// get a bottom sheet with cycle / split / offset sliders — and a live phase
// timeline that shows exactly what each slider does: two strips (↑↓ and ←→)
// coloured green/yellow/red across one cycle, with a moving "now" marker.
// Works while paused — that is a design requirement, not a nicety.

import { CYCLE_MAX, CYCLE_MIN } from '../sim/constants';
import type { NodeId } from '../sim/network';
import { cycleTime } from '../sim/signals';
import type { SignalProgram } from '../sim/signals';
import type { World } from '../sim/sim';

const GREEN = '#2fd274';
const YELLOW = '#f5c445';
const RED = '#3a4553';

export class SignalEditor {
  private sheet: HTMLElement;
  private title: HTMLElement;
  private nsStrip: HTMLElement;
  private ewStrip: HTMLElement;
  private marker: HTMLElement;
  private cycle: HTMLInputElement;
  private split: HTMLInputElement;
  private offset: HTMLInputElement;
  private outCycle: HTMLElement;
  private outSplit: HTMLElement;
  private outOffset: HTMLElement;
  node: NodeId | null = null;
  private world: World;
  onChange: (() => void) | null = null;

  constructor(parent: HTMLElement, world: World) {
    this.world = world;
    this.sheet = document.createElement('div');
    this.sheet.id = 'sheet';
    this.sheet.innerHTML = `
      <div class="grab"></div>
      <button class="close" aria-label="Close">✕</button>
      <header>
        <h2>Signal</h2>
        <span class="caption">One cycle: ↑↓ gets green, then ←→. The line is now.</span>
      </header>
      <div class="phase-view">
        <div class="dirs"><span>↑↓</span><span>←→</span></div>
        <div class="strips">
          <div class="strip" data-ns></div>
          <div class="strip" data-ew></div>
          <div class="marker" data-marker></div>
        </div>
      </div>
      <div class="slider-row">
        <div class="lbl"><label>Cycle</label><small>length of one loop</small></div>
        <input type="range" data-cycle min="${CYCLE_MIN}" max="${CYCLE_MAX}" step="5" />
        <output data-out-cycle></output>
      </div>
      <div class="slider-row">
        <div class="lbl"><label>Green share</label><small>↑↓ ⟷ ←→</small></div>
        <input type="range" data-split min="20" max="80" step="1" />
        <output data-out-split></output>
      </div>
      <div class="slider-row">
        <div class="lbl"><label>Offset</label><small>shifts the schedule</small></div>
        <input type="range" data-offset min="0" max="59" step="1" />
        <output data-out-offset></output>
      </div>`;
    parent.appendChild(this.sheet);

    const q = <T extends HTMLElement>(sel: string): T => this.sheet.querySelector(sel) as T;
    this.title = q('h2');
    this.nsStrip = q('[data-ns]');
    this.ewStrip = q('[data-ew]');
    this.marker = q('[data-marker]');
    this.cycle = q('[data-cycle]');
    this.split = q('[data-split]');
    this.offset = q('[data-offset]');
    this.outCycle = q('[data-out-cycle]');
    this.outSplit = q('[data-out-split]');
    this.outOffset = q('[data-out-offset]');

    q('.close').addEventListener('click', () => this.close());
    for (const input of [this.cycle, this.split, this.offset]) {
      input.addEventListener('input', () => this.apply());
    }
    // Swipe-down (not on a slider) closes.
    let startY = 0;
    this.sheet.addEventListener('pointerdown', (e) => (startY = e.clientY));
    this.sheet.addEventListener('pointerup', (e) => {
      if (e.clientY - startY > 70 && (e.target as HTMLElement).tagName !== 'INPUT') this.close();
    });
  }

  setWorld(world: World): void {
    this.world = world;
    this.close();
  }

  open(node: NodeId): void {
    const knobs = this.world.signalKnobs(node);
    if (!knobs) return;
    this.node = node;
    const idx = this.world.net.nodes.filter(
      (n) => n.control.type === 'signal' && n.id <= node,
    ).length;
    this.title.textContent = `Signal ${idx}`;
    this.cycle.value = String(knobs.cycle);
    this.split.value = String(Math.round(knobs.split * 100));
    this.offset.max = String(knobs.cycle - 1);
    this.offset.value = String(Math.round(knobs.offset) % knobs.cycle);
    this.refresh();
    this.sheet.classList.add('open');
  }

  close(): void {
    this.node = null;
    this.sheet.classList.remove('open');
    this.onChange?.();
  }

  get isOpen(): boolean {
    return this.node !== null;
  }

  private apply(): void {
    if (this.node === null) return;
    const cycle = Number(this.cycle.value);
    this.offset.max = String(cycle - 1);
    this.world.setSignal(this.node, {
      cycle,
      split: Number(this.split.value) / 100,
      offset: Number(this.offset.value),
    });
    this.refresh();
    this.onChange?.();
  }

  private refresh(): void {
    this.outCycle.textContent = `${this.cycle.value}s`;
    this.outSplit.textContent = `${this.split.value}% ↑↓`;
    this.outOffset.textContent = `${this.offset.value}s`;
    if (this.node !== null) {
      const program = this.world.signalProgram(this.node);
      if (program) this.renderStrips(program);
    }
  }

  /** Paint the two phase strips for one full cycle. */
  private renderStrips(p: SignalProgram): void {
    const c = p.cycleLength;
    const [ph0, ph1] = p.phases;
    const d0 = ph0.green + ph0.yellow + ph0.allRed;
    const seg = (w: number, color: string) =>
      `<div style="flex:0 0 ${(100 * w) / c}%;background:${color}"></div>`;
    this.nsStrip.innerHTML =
      seg(ph0.green, GREEN) + seg(ph0.yellow, YELLOW) + seg(c - ph0.green - ph0.yellow, RED);
    this.ewStrip.innerHTML =
      seg(d0, RED) +
      seg(ph1.green, GREEN) +
      seg(ph1.yellow, YELLOW) +
      seg(c - d0 - ph1.green - ph1.yellow, RED);
  }

  /** Move the "now" marker; called every frame while open. */
  tick(): void {
    if (this.node === null) return;
    const program = this.world.signalProgram(this.node);
    if (!program) return;
    const x = cycleTime(program, this.world.time) / program.cycleLength;
    this.marker.style.left = `${(x * 100).toFixed(2)}%`;
  }
}
