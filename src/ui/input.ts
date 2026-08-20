// Touch/mouse input (spec §9): one-finger drag pans, pinch zooms, short taps
// select. Tool drags (road building) only begin when the active tool claims
// the pointer-down via onToolStart — otherwise navigation wins, so pan/zoom
// never conflict with tools.

import type { Camera } from '../render/camera';

export interface InputCallbacks {
  onTap: (screenX: number, screenY: number) => void;
  /** Return true to claim this pointer for a tool drag (no panning). */
  onToolStart?: (screenX: number, screenY: number) => boolean;
  onToolMove?: (screenX: number, screenY: number) => void;
  onToolEnd?: (screenX: number, screenY: number) => void;
}

export function attachInput(el: HTMLElement, cam: Camera, cb: InputCallbacks): void {
  interface P {
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    startT: number;
  }
  const pointers = new Map<number, P>();
  let pinchDist = 0;
  let moved = false;
  let toolPointer: number | null = null;

  el.addEventListener('pointerdown', (e) => {
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer; capture is optional.
    }
    pointers.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startT: performance.now(),
    });
    if (pointers.size === 1) {
      moved = false;
      if (cb.onToolStart?.(e.clientX, e.clientY)) toolPointer = e.pointerId;
    }
    if (pointers.size === 2) {
      // A second finger always means navigation: cancel any tool drag.
      if (toolPointer !== null) {
        cb.onToolEnd?.(NaN, NaN);
        toolPointer = null;
      }
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 8) moved = true;

    if (toolPointer === e.pointerId) {
      cb.onToolMove?.(e.clientX, e.clientY);
      return;
    }
    if (pointers.size === 1) {
      cam.pan(dx, dy);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (pinchDist > 0) cam.zoom(d / pinchDist, cx, cy);
      pinchDist = d;
      cam.pan(dx / 2, dy / 2);
    }
  });

  const end = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (toolPointer === e.pointerId) {
      toolPointer = null;
      cb.onToolEnd?.(e.clientX, e.clientY);
      return;
    }
    if (!p) return;
    const dt = performance.now() - p.startT;
    if (!moved && dt < 350 && pointers.size === 0) cb.onTap(p.x, p.y);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', (e) => {
    if (toolPointer === e.pointerId) {
      toolPointer = null;
      cb.onToolEnd?.(NaN, NaN);
    }
    pointers.delete(e.pointerId);
  });

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam.zoom(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
    },
    { passive: false },
  );
}
