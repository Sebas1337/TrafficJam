// The inspect sheet: tap an intersection to change its control type and (for
// signals) tune timing + crosswalk; tap a road to upgrade or demolish it.
// All structural changes go through the game-provided runAction hook, which
// handles money and the undo stack. Works while paused — by design.

import {
  CYCLE_MAX,
  CYCLE_MIN,
  DEMOLISH_REFUND,
  PED_PHASE_SECONDS,
  ROAD_COST_PER_M,
  ROUNDABOUT_COST,
  SIGNAL_COST,
  STOP_COST,
  UPGRADE_EDGE_COST,
} from '../sim/constants';
import { setControl, upgradeEdge, removeEdge, type ControlKind } from '../sim/editnet';
import type { EdgeId, NodeId } from '../sim/network';
import { cycleTime, programPed } from '../sim/signals';
import type { SignalProgram } from '../sim/signals';
import type { World } from '../sim/sim';

const GREEN = '#2fd274';
const YELLOW = '#f5c445';
const RED = '#3a4553';
const PED = '#8fb7ff';

/** Game-side hook: charge `cost` (negative = refund), snapshot for undo, run. */
export type RunAction = (cost: number, apply: () => boolean) => boolean;

export class Inspector {
  private sheet: HTMLElement;
  private body: HTMLElement;
  private title: HTMLElement;
  node: NodeId | null = null;
  edge: EdgeId | null = null;
  private world: World;
  runAction: RunAction = (_c, apply) => apply();
  onChange: (() => void) | null = null;
  /** Campaign levels can lock control-type changes (timing stays editable). */
  controlsLocked = false;
  private marker: HTMLElement | null = null;
  private confirmArmed = false;

  constructor(parent: HTMLElement, world: World) {
    this.world = world;
    this.sheet = document.createElement('div');
    this.sheet.id = 'sheet';
    this.sheet.innerHTML = `
      <div class="grab"></div>
      <button class="close" aria-label="Close">✕</button>
      <header><h2>Inspect</h2></header>
      <div class="sheet-body"></div>`;
    parent.appendChild(this.sheet);
    this.title = this.sheet.querySelector('h2')!;
    this.body = this.sheet.querySelector('.sheet-body')!;
    this.sheet.querySelector('.close')!.addEventListener('click', () => this.close());
    let startY = 0;
    this.sheet.addEventListener('pointerdown', (e) => (startY = e.clientY));
    this.sheet.addEventListener('pointerup', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.clientY - startY > 70 && tag !== 'INPUT' && tag !== 'BUTTON') this.close();
    });
  }

  setWorld(world: World): void {
    this.world = world;
    this.close();
  }

  get isOpen(): boolean {
    return this.node !== null || this.edge !== null;
  }

  close(): void {
    this.node = null;
    this.edge = null;
    this.marker = null;
    this.confirmArmed = false;
    this.sheet.classList.remove('open');
    this.onChange?.();
  }

  // ------------------------------------------------------------ intersection

  open(node: NodeId): void {
    this.edge = null;
    this.node = node;
    this.confirmArmed = false;
    this.render();
    this.sheet.classList.add('open');
  }

  openEdge(edge: EdgeId): void {
    this.node = null;
    this.edge = edge;
    this.confirmArmed = false;
    this.render();
    this.sheet.classList.add('open');
  }

  /** Re-render the sheet body for the current selection. */
  render(): void {
    if (this.node !== null) this.renderNode();
    else if (this.edge !== null) this.renderEdge();
  }

  private renderNode(): void {
    const node = this.world.net.nodes[this.node!];
    const control = node.control;
    const idx =
      this.world.net.nodes.filter((n) => n.control.type === 'signal' && n.id <= node.id).length;
    this.title.textContent = control.type === 'signal' ? `Signal ${idx}` : 'Intersection';

    const chip = (kind: ControlKind, label: string, cost: number): string => {
      const active = control.type === kind;
      return `<button class="ctl ${active ? 'active' : ''}" data-ctl="${kind}" ${active ? 'disabled' : ''}>
        ${label}${cost > 0 && !active ? `<small>$${cost}</small>` : ''}</button>`;
    };
    let html = this.controlsLocked
      ? ''
      : `
      <div class="ctl-row">
        ${chip('uncontrolled', 'Open', 0)}
        ${chip('stop', 'Stop', STOP_COST)}
        ${chip('signal', 'Signal', SIGNAL_COST)}
        ${chip('roundabout', 'Round', ROUNDABOUT_COST)}
      </div>`;

    if (control.type === 'signal') {
      const knobs = this.world.signalKnobs(node.id)!;
      html += `
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
        <input type="range" data-k="cycle" min="${CYCLE_MIN}" max="${CYCLE_MAX}" step="5" value="${knobs.cycle}" />
        <output>${knobs.cycle}s</output>
      </div>
      <div class="slider-row">
        <div class="lbl"><label>Green share</label><small>↑↓ ⟷ ←→</small></div>
        <input type="range" data-k="split" min="20" max="80" step="1" value="${Math.round(knobs.split * 100)}" />
        <output>${Math.round(knobs.split * 100)}% ↑↓</output>
      </div>
      <div class="slider-row">
        <div class="lbl"><label>Offset</label><small>shifts the schedule</small></div>
        <input type="range" data-k="offset" min="0" max="${knobs.cycle - 1}" step="1" value="${Math.round(knobs.offset) % knobs.cycle}" />
        <output>${Math.round(knobs.offset)}s</output>
      </div>
      <label class="toggle-row">
        <input type="checkbox" data-ped ${knobs.ped > 0 ? 'checked' : ''} />
        <span>Crosswalk phase <small>+${PED_PHASE_SECONDS}s all-red for pedestrians${node.pedsWaiting > 0 ? ` · ${node.pedsWaiting} waiting` : ''}</small></span>
      </label>`;
    }
    this.body.innerHTML = html;
    this.marker = this.body.querySelector('[data-marker]');

    for (const btn of this.body.querySelectorAll<HTMLButtonElement>('[data-ctl]')) {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.ctl as ControlKind;
        const cost = kind === 'stop' ? STOP_COST : kind === 'signal' ? SIGNAL_COST : kind === 'roundabout' ? ROUNDABOUT_COST : 0;
        const nodeId = this.node!;
        this.runAction(cost, () => setControl(this.world, nodeId, kind));
        this.render();
        this.onChange?.();
      });
    }
    for (const input of this.body.querySelectorAll<HTMLInputElement>('[data-k]')) {
      input.addEventListener('input', () => this.applyKnobs());
    }
    this.body.querySelector<HTMLInputElement>('[data-ped]')?.addEventListener('change', () => {
      this.applyKnobs();
      this.render();
    });
    if (control.type === 'signal') this.renderStrips(this.world.signalProgram(node.id)!);
  }

  private applyKnobs(): void {
    if (this.node === null) return;
    const get = (k: string): HTMLInputElement | null =>
      this.body.querySelector<HTMLInputElement>(`[data-k="${k}"]`);
    const cycleEl = get('cycle');
    const splitEl = get('split');
    const offsetEl = get('offset');
    const pedEl = this.body.querySelector<HTMLInputElement>('[data-ped]');
    if (!cycleEl || !splitEl || !offsetEl) return;
    const cycle = Number(cycleEl.value);
    offsetEl.max = String(cycle - 1);
    this.world.setSignal(this.node, {
      cycle,
      split: Number(splitEl.value) / 100,
      offset: Number(offsetEl.value),
      ped: pedEl?.checked ? PED_PHASE_SECONDS : 0,
    });
    cycleEl.nextElementSibling!.textContent = `${cycle}s`;
    splitEl.nextElementSibling!.textContent = `${splitEl.value}% ↑↓`;
    offsetEl.nextElementSibling!.textContent = `${offsetEl.value}s`;
    const program = this.world.signalProgram(this.node);
    if (program) this.renderStrips(program);
    this.onChange?.();
  }

  private renderStrips(p: SignalProgram): void {
    const ns = this.body.querySelector<HTMLElement>('[data-ns]');
    const ew = this.body.querySelector<HTMLElement>('[data-ew]');
    if (!ns || !ew) return;
    const c = p.cycleLength;
    const [ph0, ph1] = p.phases;
    const ped = programPed(p);
    const d0 = ph0.green + ph0.yellow + ph0.allRed;
    const seg = (w: number, color: string): string =>
      `<div style="flex:0 0 ${(100 * w) / c}%;background:${color}"></div>`;
    const pedSeg = ped > 0 ? seg(ped, PED) : '';
    ns.innerHTML =
      seg(ph0.green, GREEN) +
      seg(ph0.yellow, YELLOW) +
      seg(c - ph0.green - ph0.yellow - ped, RED) +
      pedSeg;
    ew.innerHTML =
      seg(d0, RED) +
      seg(ph1.green, GREEN) +
      seg(ph1.yellow, YELLOW) +
      seg(c - d0 - ph1.green - ph1.yellow - ped, RED) +
      pedSeg;
  }

  // ------------------------------------------------------------------ road

  private renderEdge(): void {
    const edge = this.world.net.edges[this.edge!];
    this.title.textContent = 'Road';
    const lanes = edge.forward.length;
    const refund = Math.round(edge.length * ROAD_COST_PER_M * DEMOLISH_REFUND);
    this.body.innerHTML = `
      <p class="road-info">${edge.class} · ${lanes} lane${lanes > 1 ? 's' : ''} each way · ${Math.round(edge.length)} m</p>
      <div class="ctl-row">
        ${lanes < 2 ? `<button class="ctl" data-upgrade>Widen<small>$${UPGRADE_EDGE_COST}</small></button>` : ''}
        <button class="ctl danger" data-demolish>Demolish<small>+$${refund}</small></button>
      </div>`;
    this.body.querySelector('[data-upgrade]')?.addEventListener('click', () => {
      const id = this.edge!;
      this.runAction(UPGRADE_EDGE_COST, () => upgradeEdge(this.world, id));
      this.render();
      this.onChange?.();
    });
    this.body.querySelector('[data-demolish]')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      if (!this.confirmArmed) {
        this.confirmArmed = true;
        btn.textContent = 'Tap again to confirm';
        setTimeout(() => {
          this.confirmArmed = false;
          if (this.edge !== null) this.render();
        }, 2200);
        return;
      }
      const id = this.edge!;
      const ok = this.runAction(-refund, () => removeEdge(this.world, id));
      if (ok) this.close();
      else this.render();
      this.onChange?.();
    });
  }

  /** Live now-marker on the phase strips; called every frame while open. */
  tick(): void {
    if (this.node === null || !this.marker) return;
    const program = this.world.signalProgram(this.node);
    if (!program) return;
    const x = cycleTime(program, this.world.time) / program.cycleLength;
    this.marker.style.left = `${(x * 100).toFixed(2)}%`;
  }
}
