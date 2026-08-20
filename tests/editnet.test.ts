// Test 8 (spec §14) + slice 3/4 mechanics: route repair when a road is
// deleted mid-route, network editing invariants, control variety, and
// save/load round-tripping.

import { describe, expect, it } from 'vitest';
import { NetworkBuilder } from '../src/sim/network';
import { addRoad, removeEdge, setControl, upgradeEdge } from '../src/sim/editnet';
import { serializeWorld, restoreWorld } from '../src/sim/persist';
import { buildCorridor } from '../src/sim/fixtures';
import { generateMap } from '../src/sim/mapgen';
import { runHeadless } from '../src/sim/headless';
import { World } from '../src/sim/sim';
import { v } from '../src/sim/vec';
import { assertInvariants } from './helpers';

/**
 * A—X—W—B short route plus an X—Y—Z—W detour. The deletable shortcut X—W
 * touches no portal, so removing it leaves the detour as the only route.
 */
function buildDetourNet() {
  const b = new NetworkBuilder();
  const A = b.addNode(v(0, 200), 'portal', 'A');
  const X = b.addNode(v(180, 200), 'intersection');
  const W = b.addNode(v(460, 200), 'intersection');
  const B = b.addNode(v(640, 200), 'portal', 'B');
  const Y = b.addNode(v(180, 400), 'intersection');
  const Z = b.addNode(v(460, 400), 'intersection');
  b.addEdge(A, X, 'arterial');
  const shortcut = b.addEdge(X, W, 'arterial');
  b.addEdge(W, B, 'arterial');
  b.addEdge(X, Y, 'local');
  b.addEdge(Y, Z, 'local');
  b.addEdge(Z, W, 'local');
  return { net: b.build(), A, X, B, shortcut };
}

describe('route repair (test 8)', () => {
  it('cars re-route seamlessly when their road is deleted and a detour exists', () => {
    const { net, A, B, shortcut } = buildDetourNet();
    const world = new World(net, 1, () => {});
    world.failureEnabled = false;
    expect(world.spawnCar(A, B)).toBe(true);

    // Let the car get onto A—X, then delete the shortcut it was routed over.
    runHeadless(world, 5, (w) => assertInvariants(w));
    expect(world.cars.size).toBe(1);
    expect(removeEdge(world, shortcut)).toBe(true);

    // The car must still arrive — via the detour — without any crash.
    runHeadless(world, 180, (w) => assertInvariants(w));
    expect(world.metrics.delivered).toBe(1);
    expect(world.metrics.lost).toBe(0);
  });

  it('cars despawn gracefully when no route remains', () => {
    const { net, west, east, signals } = buildCorridor(2, 120);
    const world = new World(net, 1, () => {});
    world.failureEnabled = false;
    expect(world.spawnCar(west, east)).toBe(true);
    runHeadless(world, 3, (w) => assertInvariants(w));

    // Sever the corridor between the two signals: no path A→B remains.
    const middle = net.edges.find(
      (e) =>
        !e.dead &&
        ((e.from === signals[0] && e.to === signals[1]) ||
          (e.from === signals[1] && e.to === signals[0])),
    )!;
    expect(removeEdge(world, middle.id)).toBe(true);

    runHeadless(world, 120, (w) => assertInvariants(w));
    expect(world.cars.size).toBe(0);
    expect(world.metrics.delivered).toBe(0);
    expect(world.metrics.lost).toBeGreaterThanOrEqual(1);
  });
});

describe('network editing', () => {
  it('building a road creates a usable route and survives the invariants', () => {
    const { net, A, X, B } = buildDetourNet();
    const world = new World(net, 1, () => {});
    world.failureEnabled = false;
    // New direct-ish road from X toward B's approach node via a fresh point.
    const edge = addRoad(world, { kind: 'node', node: X }, { kind: 'point', pos: v(350, 300) });
    expect(edge).not.toBeNull();
    world.spawnCar(A, B);
    runHeadless(world, 60, (w) => assertInvariants(w));
    expect(world.metrics.delivered + world.cars.size).toBeGreaterThan(0);
  });

  it('upgrading an edge doubles its lanes and keeps cars flowing', () => {
    const { net, west, east, signals } = buildCorridor(2, 150);
    const world = new World(net, 7, (w) => {
      if (Math.round(w.time * 60) % 120 === 0) w.enqueueSpawn(west, east);
    });
    world.failureEnabled = false;
    const main = net.edges.find((e) => e.from === signals[0] && e.to === signals[1])!;
    expect(upgradeEdge(world, main.id)).toBe(true);
    expect(net.edges[main.id].forward.length).toBe(2);
    runHeadless(world, 200, (w) => assertInvariants(w));
    expect(world.metrics.delivered).toBeGreaterThan(10);
  });

  it('stop signs and roundabouts keep traffic moving without collisions', () => {
    for (const kind of ['stop', 'roundabout', 'uncontrolled'] as const) {
      const { net, west, east, signals } = buildCorridor(2, 150);
      const world = new World(net, 3, (w) => {
        if (Math.round(w.time * 60) % 150 === 0) w.enqueueSpawn(west, east);
      });
      world.failureEnabled = false;
      for (const s of signals) expect(setControl(world, s, kind)).toBe(true);
      runHeadless(world, 240, (w) => assertInvariants(w));
      expect(world.metrics.delivered, `${kind} delivered nothing`).toBeGreaterThan(10);
    }
  });
});

describe('save/load', () => {
  it('round-trips a played, edited world', () => {
    const { net } = generateMap(5);
    const world = new World(net, 5);
    world.failureEnabled = false;
    runHeadless(world, 60, (w) => assertInvariants(w));
    const sig = net.nodes.find((n) => n.control.type === 'signal')!;
    world.setSignal(sig.id, { cycle: 80, split: 0.65, offset: 21, ped: 8 });

    const save = serializeWorld(world, 5, [sig.id]);
    const json = JSON.stringify(save);
    const restored = restoreWorld(JSON.parse(json));

    expect(restored.money).toBeCloseTo(world.money);
    expect(restored.time).toBeCloseTo(world.time);
    const knobs = restored.signalKnobs(sig.id)!;
    expect(knobs.cycle).toBe(80);
    expect(knobs.offset).toBeCloseTo(21);
    expect(knobs.ped).toBe(8);
    expect(knobs.split).toBeCloseTo(0.65, 1);

    // The restored world must actually run.
    runHeadless(restored, 60, (w) => assertInvariants(w));
    expect(restored.metrics.delivered + restored.cars.size).toBeGreaterThan(0);
  });
});
