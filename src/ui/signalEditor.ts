// The signal timing editor (slice 1's core interaction): tap an intersection,
// get a bottom sheet with cycle / split / offset sliders and a live phase
// readout. Works while paused — that is a design requirement, not a nicety.

import { CYCLE_MAX, CYCLE_MIN } from '../sim/constants';
import type { NodeId } from '../sim/network';
import { cycleTime, movementState } from '../sim/signals';
import type { World } from '../sim/sim';

export class SignalEditor {
  private sheet: HTMLElement;
  private title: HTMLElement;
  private nsChip: HTMLElement;
  private ewChip: HTMLElement;
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
        <div class="phase-chips">
          <span class="chip" data-ns>N–S</span>
          <span class="chip" data-ew>E–W</span>
        </div>
      </header>
      <div class="slider-row">
        <label>Cycle</label>
        <input type="range" data-cycle min="${CYCLE_MIN}" max="${CYCLE_MAX}" step="5" />
        <output data-out-cycle></output>
      </div>
      <div class="slider-row">
        <label>N–S green</label>
        <input type="range" data-split min="20" max="80" step="1" />
        <output data-out-split></output>
      </div>
      <div class="slider-row">
        <label>Offset</label>
        <input type="range" data-offset min="0" max="59" step="1" />
        <output data-out-offset></output>
      </div>`;
    parent.appendChild(this.sheet);

    const q = <T extends HTMLElement>(sel: string): T => this.sheet.querySelector(sel) as T;
    this.title = q('h2');
    this.nsChip = q('[data-ns]');
    this.ewChip = q('[data-ew]');
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
    // Swipe-down on the grab bar closes.
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
    this.refreshOutputs();
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
    this.refreshOutputs();
    this.onChange?.();
  }

  private refreshOutputs(): void {
    this.outCycle.textContent = `${this.cycle.value}s`;
    this.outSplit.textContent = `${this.split.value}%`;
    this.outOffset.textContent = `${this.offset.value}s`;
  }

  /** Live phase chips; called every frame while open. */
  tick(): void {
    if (this.node === null) return;
    const program = this.world.signalProgram(this.node);
    if (!program) return;
    const nsMov = program.phases[0].movements[0];
    const ewMov = program.phases[1].movements[0];
    const t = this.world.time;
    const ns = nsMov !== undefined ? movementState(program, nsMov, t) : 'red';
    const ew = ewMov !== undefined ? movementState(program, ewMov, t) : 'red';
    this.nsChip.className = `chip ${ns === 'red' ? '' : ns}`.trim();
    this.ewChip.className = `chip ${ew === 'red' ? '' : ew}`.trim();
    const x = Math.floor(cycleTime(program, t));
    this.nsChip.textContent = `N–S ${ns === 'green' ? '●' : '○'}`;
    this.ewChip.textContent = `E–W ${ew === 'green' ? '●' : '○'}`;
    this.title.setAttribute('data-cycle-pos', `${x}`);
  }
}
