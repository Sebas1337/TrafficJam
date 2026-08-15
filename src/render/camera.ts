// World (metres, y-down) <-> screen (CSS px) transform. All metre→pixel
// conversion in the game happens through this class (spec invariant: sim is
// metres/seconds; pixels are a render concern).

import { MAP_H, MAP_W } from '../sim/constants';

export class Camera {
  x = MAP_W / 2; // world point at the viewport centre
  y = MAP_H / 2;
  scale = 1; // px per metre
  viewW = 1;
  viewH = 1;
  changed = true;

  fit(viewW: number, viewH: number): void {
    this.viewW = viewW;
    this.viewH = viewH;
    this.scale = Math.min(viewW / (MAP_W + 60), viewH / (MAP_H + 60));
    this.x = MAP_W / 2;
    this.y = MAP_H / 2;
    this.changed = true;
  }

  resize(viewW: number, viewH: number): void {
    this.viewW = viewW;
    this.viewH = viewH;
    this.changed = true;
  }

  toScreenX(wx: number): number {
    return (wx - this.x) * this.scale + this.viewW / 2;
  }
  toScreenY(wy: number): number {
    return (wy - this.y) * this.scale + this.viewH / 2;
  }
  toWorldX(sx: number): number {
    return (sx - this.viewW / 2) / this.scale + this.x;
  }
  toWorldY(sy: number): number {
    return (sy - this.viewH / 2) / this.scale + this.y;
  }

  pan(dxPx: number, dyPx: number): void {
    this.x -= dxPx / this.scale;
    this.y -= dyPx / this.scale;
    this.clamp();
    this.changed = true;
  }

  /** Zoom by factor around a screen point. */
  zoom(factor: number, sx: number, sy: number): void {
    const minScale = Math.min(this.viewW / (MAP_W + 200), this.viewH / (MAP_H + 200));
    const next = Math.max(minScale, Math.min(8, this.scale * factor));
    const wx = this.toWorldX(sx);
    const wy = this.toWorldY(sy);
    this.scale = next;
    // Keep the anchor point stationary on screen.
    this.x = wx - (sx - this.viewW / 2) / this.scale;
    this.y = wy - (sy - this.viewH / 2) / this.scale;
    this.clamp();
    this.changed = true;
  }

  private clamp(): void {
    const margin = 100;
    this.x = Math.max(-margin, Math.min(MAP_W + margin, this.x));
    this.y = Math.max(-margin, Math.min(MAP_H + margin, this.y));
  }
}
