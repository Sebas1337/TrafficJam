// Rendering (spec §12): two layers. The static layer (roads, markings,
// portals) redraws only when the camera changes; the dynamic layer (cars,
// signal heads) redraws every frame with interpolation.

import {
  CAR_LENGTH,
  LANE_WIDTH,
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
  ctx.fillRect(cam.toScreenX(-30), cam.toScreenY(-30), (60 + 600) * cam.scale, (60 + 440) * cam.scale);

  // Fatten roads at low zoom so the network stays readable on a phone.
  const roadW = Math.max(6, LANE_WIDTH * 2 * cam.scale);

  // Road bodies.
  ctx.lineCap = 'round';
  for (const e of net.edges) {
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
    const f = net.lanes[e.forward[0]];
    // Centre line runs between the two directions: lane start minus offset.
    const off = { x: f.start.x - f.direction.y * 0, y: f.start.y };
    void off;
    const a = net.nodes[e.from].pos;
    const b = net.nodes[e.to].pos;
    line(ctx, cam, a.x, a.y, b.x, b.y);
  }
  ctx.setLineDash([]);

  // Stop lines at signalised approaches.
  ctx.strokeStyle = '#cfd4dc';
  ctx.lineWidth = Math.max(1, 0.4 * cam.scale);
  for (const lane of net.lanes) {
    const node = net.nodes[lane.toNode];
    if (node.control.type !== 'signal') continue;
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
    const r = Math.max(14, 9 * cam.scale);
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

export function drawDynamic(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  alpha: number,
  selectedNode: NodeId | null,
): void {
  ctx.clearRect(0, 0, cam.viewW, cam.viewH);
  drawSignalHeads(ctx, world, cam);
  if (selectedNode !== null) drawSelection(ctx, world, cam, selectedNode);
  drawCars(ctx, world, cam, alpha);
}

function drawCars(ctx: CanvasRenderingContext2D, world: World, cam: Camera, alpha: number): void {
  const w = 2.0 * cam.scale;
  const l = CAR_LENGTH * cam.scale;
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
    const r = Math.max(2.5, 1.1 * cam.scale);
    ctx.fillStyle = '#20242b';
    ctx.beginPath();
    ctx.arc(sx, sy, r + Math.max(1, 0.35 * cam.scale), 0, Math.PI * 2);
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
