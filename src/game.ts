// Game orchestration: fixed-timestep loop with accumulator and render
// interpolation (spec §7.1), camera, input, HUD, editor, game-over flow.

import { Camera } from './render/camera';
import { drawDynamic, drawStatic } from './render/draw';
import { DT, NODE_BOX_RADIUS } from './sim/constants';
import { generateMap } from './sim/mapgen';
import type { NodeId } from './sim/network';
import { World } from './sim/sim';
import { TimeSpaceDiagram } from './ui/diagram';
import { buildHud, updateHud, type HudElements } from './ui/hud';
import { attachInput } from './ui/input';
import { SignalEditor } from './ui/signalEditor';

const MAX_STEPS_PER_FRAME = 8; // drop sim speed before frame rate

export class Game {
  world: World;
  cam = new Camera();
  private hud: HudElements;
  editor: SignalEditor;
  diagram: TimeSpaceDiagram;
  corridor: NodeId[] = [];
  private linkMode = false;
  private heatmap = false;
  private banner!: HTMLElement;
  private heatBtn!: HTMLButtonElement;
  private staticCanvas: HTMLCanvasElement;
  private dynamicCanvas: HTMLCanvasElement;
  private staticCtx: CanvasRenderingContext2D;
  private dynamicCtx: CanvasRenderingContext2D;
  private overlay: HTMLElement;
  private seedTag: HTMLElement;
  private hint: HTMLElement;
  private speed = 1;
  private accumulator = 0;
  private lastFrame = 0;
  private seed: number;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(private root: HTMLElement, seed: number) {
    this.seed = seed;
    this.world = new World(generateMap(seed).net, seed);

    this.staticCanvas = document.createElement('canvas');
    this.dynamicCanvas = document.createElement('canvas');
    root.append(this.staticCanvas, this.dynamicCanvas);
    this.staticCtx = this.staticCanvas.getContext('2d')!;
    this.dynamicCtx = this.dynamicCanvas.getContext('2d')!;

    this.hud = buildHud(root, (m) => (this.speed = m));
    this.editor = new SignalEditor(root, this.world);
    this.diagram = new TimeSpaceDiagram(root, this.world);
    this.diagram.onRelink = () => this.enterLinkMode();
    this.buildFabs();

    this.seedTag = document.createElement('div');
    this.seedTag.id = 'seed-tag';
    this.seedTag.textContent = `seed ${seed}`;
    root.appendChild(this.seedTag);

    this.hint = document.createElement('div');
    this.hint.id = 'hint';
    this.hint.textContent = 'Tap a traffic light to retime it';
    root.appendChild(this.hint);
    setTimeout(() => (this.hint.style.opacity = '0'), 8000);

    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay hidden';
    root.appendChild(this.overlay);

    attachInput(this.dynamicCanvas, this.cam, {
      onTap: (x, y) => this.handleTap(x, y),
    });

    window.addEventListener('resize', () => this.resize(true));
    this.resize(false);
    this.cam.fit(window.innerWidth, window.innerHeight);

    requestAnimationFrame((t) => {
      this.lastFrame = t;
      requestAnimationFrame((tt) => this.frame(tt));
    });
  }

  private resize(keepView: boolean): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const c of [this.staticCanvas, this.dynamicCanvas]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.staticCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.dynamicCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (keepView) this.cam.resize(w, h);
  }

  private hitSignal(x: number, y: number): NodeId | null {
    // Generous hit radius (spec §9): larger of 30 px or the box itself.
    const hitPx = Math.max(30, NODE_BOX_RADIUS * this.cam.scale * 1.6);
    let best: NodeId | null = null;
    let bestD = Infinity;
    for (const n of this.world.net.nodes) {
      if (n.control.type !== 'signal') continue;
      const d = Math.hypot(this.cam.toScreenX(n.pos.x) - x, this.cam.toScreenY(n.pos.y) - y);
      if (d < hitPx && d < bestD) {
        best = n.id;
        bestD = d;
      }
    }
    return best;
  }

  private handleTap(x: number, y: number): void {
    const hit = this.hitSignal(x, y);
    if (this.linkMode) {
      if (hit !== null && !this.corridor.includes(hit)) {
        this.corridor.push(hit);
        this.updateBanner();
      }
      return;
    }
    if (hit !== null) this.editor.open(hit);
    else if (this.editor.isOpen) this.editor.close();
  }

  // ------------------------------------------------------- corridor linking

  private buildFabs(): void {
    const fabs = document.createElement('div');
    fabs.id = 'fabs';
    fabs.innerHTML = `
      <button data-heat aria-label="Congestion heatmap">▦</button>
      <button data-corridor aria-label="Green wave">📈</button>`;
    this.root.appendChild(fabs);
    this.heatBtn = fabs.querySelector('[data-heat]')!;
    this.heatBtn.addEventListener('click', () => {
      this.heatmap = !this.heatmap;
      this.heatBtn.classList.toggle('active', this.heatmap);
    });
    fabs.querySelector('[data-corridor]')!.addEventListener('click', () => {
      if (this.linkMode) return;
      if (this.corridor.length >= 2) this.diagram.open(this.corridor);
      else this.enterLinkMode();
    });

    this.banner = document.createElement('div');
    this.banner.id = 'banner';
    this.banner.className = 'hidden';
    this.root.appendChild(this.banner);
  }

  enterLinkMode(): void {
    this.linkMode = true;
    this.corridor = [];
    this.editor.close();
    this.banner.classList.remove('hidden');
    this.updateBanner();
  }

  private updateBanner(): void {
    const n = this.corridor.length;
    this.banner.innerHTML = `
      <span>${n === 0 ? 'Tap the signals along one street, in driving order' : `${n} linked — keep tapping or press Done`}</span>
      <button data-done ${n < 2 ? 'disabled' : ''}>Done</button>
      <button data-cancel class="ghost">Cancel</button>`;
    this.banner.querySelector('[data-done]')!.addEventListener('click', () => {
      this.linkMode = false;
      this.banner.classList.add('hidden');
      this.diagram.open(this.corridor);
    });
    this.banner.querySelector('[data-cancel]')!.addEventListener('click', () => {
      this.linkMode = false;
      this.corridor = [];
      this.banner.classList.add('hidden');
    });
  }

  /** Debug/test hook: link a corridor and open the diagram directly. */
  openCorridorWith(nodes: NodeId[]): void {
    this.corridor = [...nodes];
    this.diagram.open(this.corridor);
  }

  private frame(t: number): void {
    const dtReal = Math.min((t - this.lastFrame) / 1000, 0.25);
    this.lastFrame = t;

    if (!this.world.over) {
      this.accumulator += dtReal * this.speed;
      let steps = 0;
      while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
        this.world.step();
        this.accumulator -= DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // shed backlog
    }

    if (this.cam.changed) {
      drawStatic(this.staticCtx, this.world.net, this.cam);
      this.cam.changed = false;
    }
    const alpha = this.speed > 0 ? Math.min(this.accumulator / DT, 1) : 1;
    drawDynamic(this.dynamicCtx, this.world, this.cam, alpha, {
      selectedNode: this.editor.node,
      corridor: this.corridor,
      heatmap: this.heatmap,
    });

    updateHud(
      this.hud,
      this.world.throughputPerMin(),
      this.world.metrics.delivered,
      this.world.time,
      this.world.metrics.frustration,
    );
    this.editor.tick();
    this.diagram.tick();

    if (this.world.over && this.overlay.classList.contains('hidden')) this.showGameOver();

    requestAnimationFrame((tt) => this.frame(tt));
  }

  private showGameOver(): void {
    const m = this.world.metrics;
    const mins = Math.floor(m.simTime / 60);
    const secs = Math.floor(m.simTime % 60);
    this.overlay.innerHTML = `
      <h1>Gridlock!</h1>
      <div class="big">${m.delivered}</div>
      <p>cars delivered in ${mins}:${secs.toString().padStart(2, '0')} before the town seized up.</p>
      <button data-retry>Retry this town</button>
      <button data-new class="secondary">New town</button>`;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelector('[data-retry]')!.addEventListener('click', () => this.restart(this.seed));
    this.overlay
      .querySelector('[data-new]')!
      .addEventListener('click', () => this.restart((this.seed * 1664525 + 1013904223) >>> 0));
  }

  private restart(seed: number): void {
    this.seed = seed;
    this.world = new World(generateMap(seed).net, seed);
    this.editor.setWorld(this.world);
    this.diagram.setWorld(this.world);
    this.corridor = [];
    this.linkMode = false;
    this.banner.classList.add('hidden');
    this.overlay.classList.add('hidden');
    this.seedTag.textContent = `seed ${seed}`;
    this.speed = 1;
    this.accumulator = 0;
    for (const b of this.hud.speedButtons) {
      b.classList.toggle('active', b.dataset.speed === '1');
    }
    this.cam.fit(window.innerWidth, window.innerHeight);
  }
}
