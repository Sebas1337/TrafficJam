// Save/load (spec §13). Serializes the network topology (including player
// edits), signal knobs, economy and clock — cars are deliberately discarded
// and respawn from demand after load. Versioned schema.

import { NetworkBuilder, type Network } from './network';
import { minorApproaches } from './editnet';
import { makeProgram } from './signals';
import { movementsByAxis } from './mapgen';
import { World, type DemandFn } from './sim';

export interface SaveV1 {
  v: 1;
  seed: number;
  time: number;
  money: number;
  frustration: number;
  delivered: number;
  lost: number;
  nodes: Array<{
    x: number;
    y: number;
    kind: string;
    portal?: string;
    control: string; // 'uncontrolled' | 'stop' | 'roundabout' | 'signal'
    knobs?: { cycle: number; split: number; offset: number; ped: number };
    peds: number;
  }>;
  edges: Array<{
    from: number;
    to: number;
    cls: string;
    lanes: number;
    dead: boolean;
    player: boolean;
  }>;
  corridor: number[];
}

export function serializeWorld(world: World, seed: number, corridor: number[]): SaveV1 {
  const net = world.net;
  return {
    v: 1,
    seed,
    time: world.time,
    money: world.money,
    frustration: world.metrics.frustration,
    delivered: world.metrics.delivered,
    lost: world.metrics.lost,
    nodes: net.nodes.map((n) => ({
      x: n.pos.x,
      y: n.pos.y,
      kind: n.kind,
      portal: n.portal,
      control: n.control.type,
      knobs: world.signalKnobs(n.id) ?? undefined,
      peds: n.pedsWaiting,
    })),
    edges: net.edges.map((e) => ({
      from: e.from,
      to: e.to,
      cls: e.class,
      lanes: e.forward.length,
      dead: e.dead,
      player: e.playerBuilt,
    })),
    corridor,
  };
}

/** Rebuild a Network (and controls) from a save. Node ids are preserved. */
export function restoreNetwork(save: SaveV1): Network {
  const b = new NetworkBuilder();
  for (const n of save.nodes) {
    b.addNode({ x: n.x, y: n.y }, n.kind as 'intersection', n.portal);
  }
  for (const e of save.edges) {
    if (e.dead) {
      // Keep edge-id alignment by adding then tombstoning.
      const id = b.addEdge(e.from, e.to, e.cls as 'local', e.lanes, e.player);
      b.edges[id].dead = true;
      for (const laneId of [...b.edges[id].forward, ...b.edges[id].backward]) {
        b.lanes[laneId].dead = true;
      }
    } else {
      b.addEdge(e.from, e.to, e.cls as 'local', e.lanes, e.player);
    }
  }
  const net = b.build();
  // Live-degree pass mirrors rebuildTopology's node-kind rule.
  for (const node of net.nodes) {
    if (node.kind === 'portal') continue;
    const live = node.edges.filter((eid) => !net.edges[eid].dead).length;
    node.kind = live >= 2 ? 'intersection' : 'dead_end';
  }
  save.nodes.forEach((n, id) => {
    const node = net.nodes[id];
    node.pedsWaiting = n.peds;
    if (node.kind !== 'intersection') return;
    if (n.control === 'signal' && n.knobs) {
      const { ns, ew } = movementsByAxis(net, id);
      if (ns.length > 0 && ew.length > 0) {
        node.control = {
          type: 'signal',
          program: makeProgram(ns, ew, n.knobs.cycle, n.knobs.split, n.knobs.offset, n.knobs.ped),
        };
      }
    } else if (n.control === 'stop') {
      node.control = { type: 'stop', stoppedApproaches: minorApproaches(net.lanes, net.edges, id) };
    } else if (n.control === 'roundabout') {
      node.control = { type: 'roundabout', ringEdges: [] };
    }
  });
  return net;
}

export function restoreWorld(save: SaveV1, demand?: DemandFn): World {
  const net = restoreNetwork(save);
  const world = new World(net, save.seed, demand);
  world.time = save.time;
  world.money = save.money;
  world.metrics.frustration = save.frustration;
  world.metrics.delivered = save.delivered;
  world.metrics.lost = save.lost;
  world.metrics.simTime = save.time;
  return world;
}
