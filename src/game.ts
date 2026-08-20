// Game orchestration: fixed-timestep loop, camera/input, tool modes
// (inspect / build), undo, economy hooks, menu + campaign flow, autosave.

import { Camera } from './render/camera';
import { drawDynamic, drawStatic, type RoadDraft } from './render/draw';
import {
  DT,
  GRID_CELL,
  MIN_ROAD_LEN,
  NODE_BOX_RADIUS,
  ROAD_COST_PER_M,
} from './sim/constants';
import { addRoad, type Anchor } from './sim/editnet';
import { generateMap } from './sim/mapgen';
import type { EdgeId, NodeId } from './sim/network';
import { serializeWorld, restoreWorld, type SaveV1 } from './sim/persist';
import { defaultDemand, scaledDemand, World } from './sim/sim';
import { segmentsIntersect, type Vec2 } from './sim/vec';
import { LEVELS } from './levels';
import {
  clearEndlessSave,
  loadEndlessSave,
  loadStars,
  storeEndlessSave,
  storeStars,
} from './storage';
import { TimeSpaceDiagram } from './ui/diagram';
import { buildHud, updateHud, type HudElements } from './ui/hud';
import { attachInput } from './ui/input';
import { Inspector } from './ui/inspector';
import { Menu } from './ui/menu';

const MAX_STEPS_PER_FRAME = 8;
const UNDO_DEPTH = 20;

type RunMode = { kind: 'endless' } | { kind: 'level'; index: number };

export class Game {
  world: World;
  cam = new Camera();
  private hud: HudElements;
  inspector: Inspector;
  diagram: TimeSpaceDiagram;
  menu: Menu;
  corridor: NodeId[] = [];
  private run: RunMode = { kind: 'endless' };
  private tool: 'inspect' | 'build' = 'inspect';
  private linkMode = false;
  private heatmap = false;
  private draft: {
    anchorA: Anchor;
    posA: Vec2;
    anchorB: Anchor | null;
    preview: RoadDraft;
  } | null = null;
  private undoStack: Array<{ save: SaveV1; corridor: NodeId[] }> = [];
  private banner!: HTMLElement;
  private heatBtn!: HTMLButtonElement;
  private buildBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private toolsEl!: HTMLElement;
  private staticCanvas: HTMLCanvasElement;
  private dynamicCanvas: HTMLCanvasElement;
  private staticCtx: CanvasRenderingContext2D;
  private dynamicCtx: CanvasRenderingContext2D;
  private overlayDone = false;
  private seedTag: HTMLElement;
  speed = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private seed: number;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private lastAutosave = 0;

  constructor(private root: HTMLElement, seed: number, autostart: boolean) {
    this.seed = seed;
    this.world = new World(generateMap(seed).net, seed);
    this.world.pedRate = 'auto';

    this.staticCanvas = document.createElement('canvas');
    this.dynamicCanvas = document.createElement('canvas');
    root.append(this.staticCanvas, this.dynamicCanvas);
    this.staticCtx = this.staticCanvas.getContext('2d')!;
    this.dynamicCtx = this.dynamicCanvas.getContext('2d')!;

    this.hud = buildHud(root, (m) => (this.speed = m));
    this.inspector = new Inspector(root, this.world);
    this.inspector.runAction = (cost, apply) => this.runAction(cost, apply);
    this.inspector.onChange = () => (this.cam.changed = true);
    this.diagram = new TimeSpaceDiagram(root, this.world);
    this.diagram.onRelink = () => this.enterLinkMode();
    this.buildFabs();

    this.seedTag = document.createElement('div');
    this.seedTag.id = 'seed-tag';
    root.appendChild(this.seedTag);

    this.menu = new Menu(root);
    this.menu.onContinue = () => {
      const save = loadEndlessSave();
      if (save) this.startEndless(save.seed, save);
    };
    this.menu.onEndless = () => this.startEndless(((Date.now() % 999983) + 1) >>> 0, null);
    this.menu.onLevel = (i) => this.startLevel(i);

    attachInput(this.dynamicCanvas, this.cam, {
      onTap: (x, y) => this.handleTap(x, y),
      onToolStart: (x, y) => this.toolStart(x, y),
      onToolMove: (x, y) => this.toolMove(x, y),
      onToolEnd: (x, y) => this.toolEnd(x, y),
    });

    window.addEventListener('resize', () => this.resize(true));
    this.resize(false);
    this.cam.fit(window.innerWidth, window.innerHeight);

    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.autosave(true);
    });

    if (autostart) this.startEndless(seed, null);
    else this.menu.showHome(loadEndlessSave() !== null);

    requestAnimationFrame((t) => {
      this.lastFrame = t;
      requestAnimationFrame((tt) => this.frame(tt));
    });
  }

  // ------------------------------------------------------------------ runs

  private levelConfig() {
    return this.run.kind === 'level' ? LEVELS[this.run.index] : null;
  }

  startEndless(seed: number, save: SaveV1 | null): void {
    this.seed = seed;
    this.run = { kind: 'endless' };
    const world = save ? restoreWorld(save, defaultDemand) : new World(generateMap(seed).net, seed);
    world.pedRate = 'auto';
    this.replaceWorld(world);
    this.corridor = save
      ? save.corridor.filter((n) => world.net.nodes[n]?.control.type === 'signal')
      : [];
    this.speed = 1;
    this.beginRunUi(`town ${seed}`);
  }

  startLevel(index: number): void {
    const cfg = LEVELS[index];
    this.run = { kind: 'level', index };
    this.seed = cfg.seed;
    const world = new World(generateMap(cfg.seed).net, cfg.seed, scaledDemand(cfg.demandScale));
    world.money = cfg.money;
    world.pedRate = cfg.pedRate;
    this.replaceWorld(world);
    this.corridor = [];
    this.speed = 0; // paused behind the intro card
    this.beginRunUi(`level ${index + 1} · ${cfg.name}`);
    this.menu.showIntro(cfg, index, () => (this.speed = 1));
  }

  private beginRunUi(tag: string): void {
    this.menu.hide();
    this.overlayDone = false;
    this.undoStack = [];
    this.setTool('inspect');
    this.linkMode = false;
    this.banner.classList.add('hidden');
    this.heatmap = false;
    this.heatBtn.classList.remove('active');
    this.seedTag.textContent = tag;
    const cfg = this.levelConfig();
    this.toolsEl.classList.toggle('hidden', cfg?.buildLocked ?? false);
    this.inspector.controlsLocked = cfg?.controlsLocked ?? false;
    for (const b of this.hud.speedButtons) {
      b.classList.toggle('active', b.dataset.speed === (this.speed === 0 ? '0' : '1'));
    }
    this.cam.fit(window.innerWidth, window.innerHeight);
    this.updateUndoButton();
  }

  private replaceWorld(world: World): void {
    this.world = world;
    this.inspector.setWorld(world);
    this.diagram.setWorld(world);
    this.cam.changed = true;
  }

  // -------------------------------------------------------------- economy

  /** Charge (or refund) and snapshot for undo; rolls nothing back on apply
   * failure because ops validate before mutating. */
  runAction(cost: number, apply: () => boolean): boolean {
    if (cost > 0 && this.world.money < cost) {
      this.flashSeedTag('not enough funds');
      return false;
    }
    const snap = { save: serializeWorld(this.world, this.seed, this.corridor), corridor: [...this.corridor] };
    if (!apply()) return false;
    if (cost !== 0) this.world.money -= cost;
    this.undoStack.push(snap);
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.afterStructuralChange();
    return true;
  }

  private undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) return;
    const keep = {
      time: this.world.time,
      delivered: this.world.metrics.delivered,
      lost: this.world.metrics.lost,
      frustration: this.world.metrics.frustration,
    };
    const cfg = this.levelConfig();
    const world = restoreWorld(
      snap.save,
      cfg ? scaledDemand(cfg.demandScale) : defaultDemand,
    );
    world.pedRate = cfg ? cfg.pedRate : 'auto';
    world.time = keep.time;
    world.metrics.simTime = keep.time;
    world.metrics.delivered = keep.delivered;
    world.metrics.lost = keep.lost;
    world.metrics.frustration = keep.frustration;
    this.replaceWorld(world);
    this.corridor = snap.corridor.filter((n) => world.net.nodes[n]?.control.type === 'signal');
    this.afterStructuralChange();
  }

  private afterStructuralChange(): void {
    this.corridor = this.corridor.filter(
      (n) => this.world.net.nodes[n]?.control.type === 'signal',
    );
    if (this.corridor.length < 2 && this.diagram.isOpen) this.diagram.close();
    this.cam.changed = true;
    this.updateUndoButton();
  }

  private updateUndoButton(): void {
    this.undoBtn.disabled = this.undoStack.length === 0;
  }

  private flashSeedTag(msg: string): void {
    const old = this.seedTag.textContent;
    this.seedTag.textContent = msg;
    this.seedTag.classList.add('flash');
    setTimeout(() => {
      this.seedTag.textContent = old;
      this.seedTag.classList.remove('flash');
    }, 1500);
  }

  private autosave(force = false): void {
    if (this.run.kind !== 'endless' || this.world.over) return;
    if (!force && performance.now() - this.lastAutosave < 30000) return;
    this.lastAutosave = performance.now();
    storeEndlessSave(serializeWorld(this.world, this.seed, this.corridor));
  }

  // ------------------------------------------------------------- build tool

  private setTool(tool: 'inspect' | 'build'): void {
    this.tool = tool;
    this.buildBtn.classList.toggle('active', tool === 'build');
    if (tool === 'build') this.inspector.close();
    this.draft = null;
  }

  private findAnchor(x: number, y: number): { anchor: Anchor; pos: Vec2 } | null {
    const net = this.world.net;
    // Nodes first (excluding portals).
    let bestNode: NodeId | null = null;
    let bestD = 26;
    for (const n of net.nodes) {
      if (n.kind === 'portal') continue;
      if (!n.edges.some((e) => !net.edges[e].dead)) continue;
      const d = Math.hypot(this.cam.toScreenX(n.pos.x) - x, this.cam.toScreenY(n.pos.y) - y);
      if (d < bestD) {
        bestNode = n.id;
        bestD = d;
      }
    }
    if (bestNode !== null) {
      return { anchor: { kind: 'node', node: bestNode }, pos: net.nodes[bestNode].pos };
    }
    // Then edges.
    const hit = this.hitEdge(x, y);
    if (hit) {
      const e = net.edges[hit.edge];
      const a = net.nodes[e.from].pos;
      const b = net.nodes[e.to].pos;
      return {
        anchor: { kind: 'edge', edge: hit.edge, t: hit.t },
        pos: { x: a.x + (b.x - a.x) * hit.t, y: a.y + (b.y - a.y) * hit.t },
      };
    }
    return null;
  }

  private hitEdge(x: number, y: number): { edge: EdgeId; t: number } | null {
    const net = this.world.net;
    const wx = this.cam.toWorldX(x);
    const wy = this.cam.toWorldY(y);
    const maxDist = Math.max(14 / this.cam.scale, 8);
    let best: { edge: EdgeId; t: number } | null = null;
    let bestD = maxDist;
    for (const e of net.edges) {
      if (e.dead) continue;
      const a = net.nodes[e.from].pos;
      const b = net.nodes[e.to].pos;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      const t = Math.max(0, Math.min(1, ((wx - a.x) * abx + (wy - a.y) * aby) / len2));
      const px = a.x + abx * t;
      const py = a.y + aby * t;
      const d = Math.hypot(wx - px, wy - py);
      if (d < bestD) {
        best = { edge: e.id, t };
        bestD = d;
      }
    }
    return best;
  }

  private toolStart(x: number, y: number): boolean {
    if (this.tool !== 'build' || this.menuVisible()) return false;
    const found = this.findAnchor(x, y);
    if (!found) return false; // empty space: let navigation pan
    this.draft = {
      anchorA: found.anchor,
      posA: found.pos,
      anchorB: null,
      preview: { a: found.pos, b: found.pos, legal: false, cost: 0 },
    };
    return true;
  }

  private toolMove(x: number, y: number): void {
    if (!this.draft) return;
    const snapped = this.findAnchor(x, y);
    let posB: Vec2;
    let anchorB: Anchor;
    if (snapped) {
      posB = snapped.pos;
      anchorB = snapped.anchor;
    } else {
      posB = {
        x: Math.round(this.cam.toWorldX(x) / GRID_CELL) * GRID_CELL,
        y: Math.round(this.cam.toWorldY(y) / GRID_CELL) * GRID_CELL,
      };
      anchorB = { kind: 'point', pos: posB };
    }
    const { legal, cost } = this.draftLegality(this.draft.anchorA, anchorB, this.draft.posA, posB);
    this.draft.anchorB = anchorB;
    this.draft.preview = { a: this.draft.posA, b: posB, legal, cost };
  }

  private toolEnd(_x: number, _y: number): void {
    const draft = this.draft;
    this.draft = null;
    if (!draft || !draft.anchorB || !draft.preview.legal) return;
    const { anchorA, anchorB } = draft;
    this.runAction(draft.preview.cost, () => addRoad(this.world, anchorA, anchorB) !== null);
  }

  private draftLegality(
    a: Anchor,
    b: Anchor,
    posA: Vec2,
    posB: Vec2,
  ): { legal: boolean; cost: number } {
    const net = this.world.net;
    const len = Math.hypot(posB.x - posA.x, posB.y - posA.y);
    const cost = Math.round(len * ROAD_COST_PER_M);
    if (len < MIN_ROAD_LEN) return { legal: false, cost };
    if (cost > this.world.money) return { legal: false, cost };
    if (a.kind === 'edge' && b.kind === 'edge' && a.edge === b.edge) return { legal: false, cost };
    if (a.kind === 'node' && b.kind === 'node' && a.node === b.node) return { legal: false, cost };
    // No crossing existing roads: junctions come from snapping, not overlap.
    const touches = (e: { from: NodeId; to: NodeId; id: EdgeId }): boolean => {
      const ids: Array<NodeId | null> = [
        a.kind === 'node' ? a.node : null,
        b.kind === 'node' ? b.node : null,
      ];
      if (ids.includes(e.from) || ids.includes(e.to)) return true;
      if (a.kind === 'edge' && a.edge === e.id) return true;
      if (b.kind === 'edge' && b.edge === e.id) return true;
      return false;
    };
    for (const e of net.edges) {
      if (e.dead || touches(e)) continue;
      if (segmentsIntersect(posA, posB, net.nodes[e.from].pos, net.nodes[e.to].pos)) {
        return { legal: false, cost };
      }
    }
    return { legal: true, cost };
  }

  // ----------------------------------------------------------------- input

  private menuVisible(): boolean {
    return this.root.querySelector('.overlay:not(.hidden)') !== null;
  }

  private hitNode(x: number, y: number, signalsOnly: boolean): NodeId | null {
    const hitPx = Math.max(30, NODE_BOX_RADIUS * this.cam.scale * 1.6);
    let best: NodeId | null = null;
    let bestD = Infinity;
    for (const n of this.world.net.nodes) {
      if (signalsOnly ? n.control.type !== 'signal' : n.kind !== 'intersection') continue;
      const d = Math.hypot(this.cam.toScreenX(n.pos.x) - x, this.cam.toScreenY(n.pos.y) - y);
      if (d < hitPx && d < bestD) {
        best = n.id;
        bestD = d;
      }
    }
    return best;
  }

  private handleTap(x: number, y: number): void {
    if (this.menuVisible()) return;
    if (this.linkMode) {
      const hit = this.hitNode(x, y, true);
      if (hit !== null && !this.corridor.includes(hit)) {
        this.corridor.push(hit);
        this.updateBanner();
      }
      return;
    }
    if (this.tool !== 'inspect') return;
    const node = this.hitNode(x, y, false);
    if (node !== null) {
      this.inspector.open(node);
      return;
    }
    const edge = this.hitEdge(x, y);
    if (edge !== null) {
      this.inspector.openEdge(edge.edge);
      return;
    }
    if (this.inspector.isOpen) this.inspector.close();
  }

  // ------------------------------------------------------- corridor linking

  private buildFabs(): void {
    this.toolsEl = document.createElement('div');
    this.toolsEl.id = 'tools';
    this.toolsEl.innerHTML = `<button data-build aria-label="Build roads">🛣</button>`;
    this.root.appendChild(this.toolsEl);
    this.buildBtn = this.toolsEl.querySelector('[data-build]')!;
    this.buildBtn.addEventListener('click', () =>
      this.setTool(this.tool === 'build' ? 'inspect' : 'build'),
    );

    const fabs = document.createElement('div');
    fabs.id = 'fabs';
    fabs.innerHTML = `
      <button data-menu aria-label="Menu">☰</button>
      <button data-undo aria-label="Undo" disabled>↩</button>
      <button data-heat aria-label="Congestion heatmap">▦</button>
      <button data-corridor aria-label="Green wave">📈</button>`;
    this.root.appendChild(fabs);
    this.heatBtn = fabs.querySelector('[data-heat]')!;
    this.undoBtn = fabs.querySelector('[data-undo]')!;
    this.heatBtn.addEventListener('click', () => {
      this.heatmap = !this.heatmap;
      this.heatBtn.classList.toggle('active', this.heatmap);
    });
    this.undoBtn.addEventListener('click', () => this.undo());
    fabs.querySelector('[data-menu]')!.addEventListener('click', () => {
      this.autosave(true);
      this.speed = 0;
      this.menu.showHome(this.run.kind !== 'endless' && loadEndlessSave() !== null);
    });
    fabs.querySelector('[data-corridor]')!.addEventListener('click', () => {
      if (this.linkMode || this.menuVisible()) return;
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
    this.inspector.close();
    this.setTool('inspect');
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

  // ------------------------------------------------------------------ loop

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

  private frame(t: number): void {
    const dtReal = Math.min((t - this.lastFrame) / 1000, 0.25);
    this.lastFrame = t;

    if (!this.world.over && !this.menuVisible()) {
      this.accumulator += dtReal * this.speed;
      let steps = 0;
      while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
        this.world.step();
        this.accumulator -= DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
      this.autosave();
    }

    if (this.cam.changed) {
      drawStatic(this.staticCtx, this.world.net, this.cam);
      this.cam.changed = false;
    }
    const alpha = this.speed > 0 ? Math.min(this.accumulator / DT, 1) : 1;
    drawDynamic(this.dynamicCtx, this.world, this.cam, alpha, {
      selectedNode: this.inspector.node,
      corridor: this.corridor,
      heatmap: this.heatmap,
      draft: this.draft?.preview ?? null,
    });

    updateHud(
      this.hud,
      this.world.throughputPerMin(),
      this.world.money,
      this.world.time,
      this.world.metrics.frustration,
    );
    this.inspector.tick();
    this.diagram.tick();

    this.checkRunEnd();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  // -------------------------------------------------------------- run ends

  private checkRunEnd(): void {
    if (this.overlayDone) return;
    const cfg = this.levelConfig();
    const timeUp = cfg !== null && this.world.time >= cfg.duration;
    if (!this.world.over && !timeUp) return;
    this.overlayDone = true;
    this.diagram.close();
    this.inspector.close();

    const m = this.world.metrics;
    const spawned = m.delivered + m.lost + m.activeCars + m.queuedAtPortals;
    const frac = m.delivered / Math.max(spawned, 1);
    const meanDelay = m.delivered > 0 ? m.totalDelay / m.delivered : 0;

    if (cfg === null) {
      clearEndlessSave();
      this.menu.showStats(
        {
          title: 'Gridlock!',
          delivered: m.delivered,
          simTime: m.simTime,
          meanDelay,
          tti: this.world.travelTimeIndex(),
          stars: null,
          won: false,
        },
        [
          { label: 'Retry this town', fn: () => this.startEndless(this.seed, null) },
          {
            label: 'New town',
            secondary: true,
            fn: () => this.startEndless((this.seed * 1664525 + 1013904223) >>> 0, null),
          },
          { label: 'Menu', secondary: true, fn: () => this.menu.showHome(false) },
        ],
      );
      return;
    }

    const won = timeUp && !this.world.over;
    const stars = won ? (frac >= cfg.starFractions[2] ? 3 : frac >= cfg.starFractions[1] ? 2 : 1) : 0;
    if (won) storeStars(cfg.id, stars);
    const index = this.run.kind === 'level' ? this.run.index : 0;
    const actions: Array<{ label: string; secondary?: boolean; fn: () => void }> = [];
    if (won && index + 1 < LEVELS.length) {
      actions.push({ label: 'Next level', fn: () => this.startLevel(index + 1) });
    }
    actions.push({ label: won ? 'Replay' : 'Retry', secondary: won, fn: () => this.startLevel(index) });
    actions.push({
      label: 'Levels',
      secondary: true,
      fn: () => this.menu.showLevels(loadStars()),
    });
    this.menu.showStats(
      {
        title: won ? `${cfg.name} — complete!` : 'Gridlock!',
        delivered: m.delivered,
        simTime: m.simTime,
        meanDelay,
        tti: this.world.travelTimeIndex(),
        stars: won ? stars : 0,
        won,
      },
      actions,
    );
  }
}
