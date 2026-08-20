// Rendering (spec §12): two layers. The static layer (roads, markings,
// portals) redraws only when the camera changes; the dynamic layer (cars,
// signal heads) redraws every frame with interpolation.

import {
  CAR_LENGTH,
  LANE_WIDTH,
  MAP_H,
  MAP_W,
  NODE_BOX_RADIUS,
  PORTAL_COLORS,
  PORTAL_LABELS,
} from '../sim/constants';
import type { Network, NodeId } from '../sim/network';
import { movementState, type LightState } from '../sim/signals';
import type { World, Car } from '../sim/sim';
import type { Camera } from './camera';

const ROAD_COLOR = '#353c46';
const ROAD_EDGE = '#4a5361';
const CENTER_LINE = '#8a8f66';
const BG = '#141a14';
const BLOCK = '#1b231b';

export function portalColor(net: Network, portalNode: NodeId): string {
  const label = net.nodes[portalNode].portal ?? 'A';
  return PORTAL_COLORS[PORTAL_LABELS.indexOf(label)] ?? PORTAL_COLORS[0];
}

export function drawStatic(ctx: CanvasRenderingContext2D, net: Network, cam: Camera): void {
  ctx.clearRect(0, 0, cam.viewW, cam.viewH);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, cam.viewW, cam.viewH);

  // Town footprint.
  ctx.fillStyle = BLOCK;
  ctx.fillRect(
    cam.toScreenX(-30),
    cam.toScreenY(-30),
    (60 + MAP_W) * cam.scale,
    (60 + MAP_H) * cam.scale,
  );

  // Fatten roads at low zoom so the network stays readable on a phone.
  const widthOf = (lanesTotal: number): number =>
    Math.max(8, LANE_WIDTH * lanesTotal * cam.scale);

  // Road bodies.
  ctx.lineCap = 'round';
  for (const e of net.edges) {
    if (e.dead) continue;
    const roadW = widthOf(e.forward.length + e.backward.length);
    const a = net.nodes[e.from].pos;
    const b = net.nodes[e.to].pos;
    ctx.strokeStyle = ROAD_EDGE;
    ctx.lineWidth = roadW + 2 * cam.scale * 0.4;
    line(ctx, cam, a.x, a.y, b.x, b.y);
    ctx.strokeStyle = ROAD_COLOR;
    ctx.lineWidth = roadW;
    line(ctx, cam, a.x, a.y, b.x, b.y);
  }
  // Intersection boxes (drawn as filled squares over the joins).
  for (const n of net.nodes) {
    if (n.kind !== 'intersection') continue;
    const r = NODE_BOX_RADIUS * cam.scale;
    ctx.fillStyle = ROAD_COLOR;
    ctx.fillRect(cam.toScreenX(n.pos.x) - r, cam.toScreenY(n.pos.y) - r, r * 2, r * 2);
  }
  // Centre lines (skip inside boxes via lane trims).
  ctx.strokeStyle = CENTER_LINE;
  ctx.lineWidth = Math.max(1, 0.25 * cam.scale);
  ctx.setLineDash([3 * cam.scale, 4 * cam.scale]);
  for (const e of net.edges) {
    if (e.dead) continue;
    const a = net.nodes[e.from].pos;
    const b = net.nodes[e.to].pos;
    line(ctx, cam, a.x, a.y, b.x, b.y);
  }
  ctx.setLineDash([]);

  // Stop lines at signalised and stop-controlled approaches.
  ctx.strokeStyle = '#cfd4dc';
  ctx.lineWidth = Math.max(1, 0.4 * cam.scale);
  for (const lane of net.lanes) {
    if (lane.dead) continue;
    const node = net.nodes[lane.toNode];
    if (node.control.type !== 'signal' && node.control.type !== 'stop') continue;
    const d = lane.direction;
    const n = { x: -d.y, y: d.x };
    const cx = lane.end.x;
    const cy = lane.end.y;
    line(
      ctx,
      cam,
      cx + n.x * (LANE_WIDTH / 2),
      cy + n.y * (LANE_WIDTH / 2),
      cx - n.x * (LANE_WIDTH / 2),
      cy - n.y * (LANE_WIDTH / 2),
    );
  }

  // Portals: coloured disc + label.
  for (const p of net.portals) {
    const node = net.nodes[p];
    const color = portalColor(net, p);
    const sx = cam.toScreenX(node.pos.x);
    const sy = cam.toScreenY(node.pos.y);
    const r = Math.max(16, 9 * cam.scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10151c';
    ctx.font = `bold ${Math.round(r * 1.1)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.portal ?? '?', sx, sy + r * 0.05);
  }
}

export interface RoadDraft {
  a: { x: number; y: number };
  b: { x: number; y: number };
  legal: boolean;
  cost: number;
}

export interface DynamicUi {
  selectedNode: NodeId | null;
  corridor: NodeId[];
  heatmap: boolean;
  draft: RoadDraft | null;
}

export function drawDynamic(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  alpha: number,
  ui: DynamicUi,
): void {
  ctx.clearRect(0, 0, cam.viewW, cam.viewH);
  if (ui.heatmap) drawHeatmap(ctx, world, cam);
  drawControlGlyphs(ctx, world, cam);
  drawSignalHeads(ctx, world, cam);
  drawPedestrians(ctx, world, cam);
  if (ui.selectedNode !== null) drawSelection(ctx, world, cam, ui.selectedNode);
  drawCars(ctx, world, cam, alpha);
  if (ui.corridor.length > 0) drawCorridorBadges(ctx, world, cam, ui.corridor);
  if (ui.draft) drawDraft(ctx, cam, ui.draft);
}

/** Road-building preview: dashed line + cost bubble, red when illegal. */
function drawDraft(ctx: CanvasRenderingContext2D, cam: Camera, draft: RoadDraft): void {
  const ax = cam.toScreenX(draft.a.x);
  const ay = cam.toScreenY(draft.a.y);
  const bx = cam.toScreenX(draft.b.x);
  const by = cam.toScreenY(draft.b.y);
  ctx.strokeStyle = draft.legal ? '#2fd274' : '#f4553f';
  ctx.lineWidth = Math.max(6, 6 * cam.scale * 0.5);
  ctx.setLineDash([10, 8]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.setLineDash([]);
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2 - 18;
  ctx.font = 'bold 13px system-ui, sans-serif';
  const label = draft.legal ? `$${draft.cost}` : '✕';
  const w = ctx.measureText(label).width + 14;
  ctx.fillStyle = '#10151cdd';
  ctx.beginPath();
  ctx.roundRect(mx - w / 2, my - 12, w, 22, 8);
  ctx.fill();
  ctx.fillStyle = draft.legal ? '#2fd274' : '#f4553f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, mx, my);
}

/** Stop signs and roundabout rings at non-signal intersections. */
function drawControlGlyphs(ctx: CanvasRenderingContext2D, world: World, cam: Camera): void {
  const net = world.net;
  for (const node of net.nodes) {
    if (node.control.type === 'roundabout') {
      const sx = cam.toScreenX(node.pos.x);
      const sy = cam.toScreenY(node.pos.y);
      ctx.strokeStyle = '#cfd4dc';
      ctx.lineWidth = Math.max(2.5, 1.4 * cam.scale);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(6, 4.5 * cam.scale), 0, Math.PI * 2);
      ctx.stroke();
    } else if (node.control.type === 'stop') {
      for (const laneId of node.control.stoppedApproaches) {
        const lane = net.lanes[laneId];
        if (lane.dead) continue;
        const n = { x: -lane.direction.y, y: lane.direction.x };
        const sx = cam.toScreenX(lane.end.x + n.x * 3.2);
        const sy = cam.toScreenY(lane.end.y + n.y * 3.2);
        ctx.fillStyle = '#d23b3b';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(3, 1.4 * cam.scale), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Waiting-count badges and crossing dots during walk phases. */
function drawPedestrians(ctx: CanvasRenderingContext2D, world: World, cam: Camera): void {
  for (const node of world.net.nodes) {
    if (node.control.type !== 'signal') continue;
    const sx = cam.toScreenX(node.pos.x);
    const sy = cam.toScreenY(node.pos.y);
    if (world.pedWalkActive(node.control.program)) {
      // A few dots shuttling across the box while the walk phase runs.
      const r = Math.max(10, NODE_BOX_RADIUS * cam.scale * 0.8);
      for (let i = 0; i < 3; i++) {
        const t = (world.time * 0.55 + i * 0.33) % 1;
        const along = (t * 2 - 1) * r;
        ctx.fillStyle = '#e8edf4';
        ctx.beginPath();
        ctx.arc(sx + along, sy + (i - 1) * 4, Math.max(2, 0.8 * cam.scale), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (node.pedsWaiting > 0) {
      const bx = sx - Math.max(14, NODE_BOX_RADIUS * cam.scale);
      const by = sy - Math.max(14, NODE_BOX_RADIUS * cam.scale);
      ctx.fillStyle = '#8fb7ff';
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#10151c';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(node.pedsWaiting), bx, by + 0.5);
    }
  }
}

/** Congestion heatmap (spec §9): lanes tinted by how far below the limit
 * their traffic is moving. Empty lanes stay untinted. */
function drawHeatmap(ctx: CanvasRenderingContext2D, world: World, cam: Camera): void {
  const net = world.net;
  ctx.lineCap = 'round';
  for (const lane of net.lanes) {
    if (lane.cars.length === 0) continue;
    let meanV = 0;
    for (const id of lane.cars) meanV += world.cars.get(id)!.v;
    meanV /= lane.cars.length;
    const limit = net.edges[lane.edge].speedLimit;
    const c = Math.max(0, Math.min(1, 1 - meanV / limit));
    const r = Math.round(47 + (244 - 47) * c);
    const g = Math.round(210 + (85 - 210) * c);
    const b = Math.round(116 + (63 - 116) * c);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
    ctx.lineWidth = Math.max(6, LANE_WIDTH * 1.6 * cam.scale);
    ctx.beginPath();
    ctx.moveTo(cam.toScreenX(lane.start.x), cam.toScreenY(lane.start.y));
    ctx.lineTo(cam.toScreenX(lane.end.x), cam.toScreenY(lane.end.y));
    ctx.stroke();
  }
}

/** Numbered badges on linked signals so the diagram's S1/S2/S3 map back. */
function drawCorridorBadges(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  corridor: NodeId[],
): void {
  corridor.forEach((nodeId, i) => {
    const node = world.net.nodes[nodeId];
    const sx = cam.toScreenX(node.pos.x) + Math.max(14, NODE_BOX_RADIUS * cam.scale);
    const sy = cam.toScreenY(node.pos.y) - Math.max(14, NODE_BOX_RADIUS * cam.scale);
    ctx.fillStyle = '#f2f6fc';
    ctx.beginPath();
    ctx.arc(sx, sy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10151c';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${i + 1}`, sx, sy + 0.5);
  });
}

function drawCars(ctx: CanvasRenderingContext2D, world: World, cam: Camera, alpha: number): void {
  // Floor the on-screen size: cars must stay readable fully zoomed out.
  const l = Math.max(9, CAR_LENGTH * cam.scale);
  const w = l * 0.46;
  const showBadge = cam.scale > 2.2;
  for (const car of world.cars.values()) {
    const pose = world.carPose(car);
    const x = car.px + (pose.pos.x - car.px) * alpha;
    const y = car.py + (pose.pos.y - car.py) * alpha;
    const h = interpAngle(car.ph, pose.heading, alpha);
    const sx = cam.toScreenX(x);
    const sy = cam.toScreenY(y);
    if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(h);
    ctx.fillStyle = portalColor(world.net, car.destination);
    roundRect(ctx, -l / 2, -w / 2, l, w, Math.min(3, w * 0.3));
    ctx.fill();
    ctx.restore();

    if (showBadge) {
      ctx.fillStyle = '#0e1116';
      ctx.font = `bold ${Math.max(8, 1.6 * cam.scale)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(world.net.nodes[car.destination].portal ?? '', sx, sy);
    }
  }
}

const LIGHT_COLORS: Record<LightState, string> = {
  green: '#2fd274',
  yellow: '#f5c445',
  red: '#f4553f',
};

function drawSignalHeads(ctx: CanvasRenderingContext2D, world: World, cam: Camera): void {
  const net = world.net;
  for (const lane of net.lanes) {
    if (lane.dead) continue;
    const node = net.nodes[lane.toNode];
    if (node.control.type !== 'signal') continue;
    // Head state: the through movement from this lane (or the first movement).
    const conns = net.connsFromLane[lane.id].map((id) => net.connections[id]);
    const atNode = conns.filter((c) => c.node === node.id);
    if (atNode.length === 0) continue;
    const through = atNode.find((c) => c.kind === 'through') ?? atNode[0];
    const st = movementState(node.control.program, through.id, world.time);

    const d = lane.direction;
    const n = { x: -d.y, y: d.x };
    // Just right of the stop line.
    const px = lane.end.x + n.x * (LANE_WIDTH * 0.95);
    const py = lane.end.y + n.y * (LANE_WIDTH * 0.95);
    const sx = cam.toScreenX(px);
    const sy = cam.toScreenY(py);
    const r = Math.max(4, 1.2 * cam.scale);
    ctx.fillStyle = '#20242b';
    ctx.beginPath();
    ctx.arc(sx, sy, r + Math.max(1.5, 0.35 * cam.scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = LIGHT_COLORS[st];
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  nodeId: NodeId,
): void {
  const node = world.net.nodes[nodeId];
  const sx = cam.toScreenX(node.pos.x);
  const sy = cam.toScreenY(node.pos.y);
  const r = (NODE_BOX_RADIUS + 4) * cam.scale;
  ctx.strokeStyle = '#e8f0ff';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function line(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cam.toScreenX(x1), cam.toScreenY(y1));
  ctx.lineTo(cam.toScreenX(x2), cam.toScreenY(y2));
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function interpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
