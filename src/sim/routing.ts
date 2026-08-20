// Routing (spec §7.6): per-destination shortest-path trees over the lane
// graph, computed with Dijkstra on the reversed graph. Cost = travel time +
// turn penalties + half the cycle length at signals. Cars commit at spawn:
// they follow the tree, they do not re-plan around congestion (deliberate —
// aggressive re-routing would let the sim fix the player's mistakes).

import type { ConnId, LaneId, Network, NodeId, TurnKind } from './network';

export interface RouteTree {
  dest: NodeId; // portal node
  /** next connection to take from each lane (undefined at tree leaves/dest) */
  next: (ConnId | undefined)[];
  /** total cost from the start of each lane (Infinity if unreachable) */
  cost: number[];
}

const TURN_PENALTY: Record<TurnKind, number> = {
  left: 4,
  through: 0,
  right: 1,
  uturn: 60,
};

export function buildRouteTree(net: Network, dest: NodeId): RouteTree {
  const n = net.lanes.length;
  const cost = new Array<number>(n).fill(Infinity);
  const next = new Array<ConnId | undefined>(n).fill(undefined);

  // Reversed adjacency: for each out-lane, which connections feed it.
  const feeding: ConnId[][] = net.lanes.map(() => []);
  for (const c of net.connections) feeding[c.outLane].push(c.id);

  // Terminal lanes end at the destination portal.
  const queue: Array<{ lane: LaneId; c: number }> = [];
  for (const lane of net.lanes) {
    if (lane.dead) continue;
    if (lane.toNode === dest) {
      cost[lane.id] = laneTime(net, lane.id);
      queue.push({ lane: lane.id, c: cost[lane.id] });
    }
  }

  // Dijkstra (small graphs in slice 1; a binary heap can come later if maps grow).
  const done = new Set<LaneId>();
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].c < queue[bi].c) bi = i;
    const { lane } = queue.splice(bi, 1)[0];
    if (done.has(lane)) continue;
    done.add(lane);

    for (const cid of feeding[lane]) {
      const conn = net.connections[cid];
      const from = conn.inLane;
      const node = net.nodes[conn.node];
      const signalPenalty =
        node.control.type === 'signal' ? node.control.program.cycleLength / 2 : 0;
      const c =
        cost[lane] + laneTime(net, from) + TURN_PENALTY[conn.kind] + signalPenalty;
      if (c < cost[from]) {
        cost[from] = c;
        next[from] = cid;
        queue.push({ lane: from, c });
      }
    }
  }

  return { dest, next, cost };
}

function laneTime(net: Network, laneId: LaneId): number {
  const lane = net.lanes[laneId];
  return lane.length / net.edges[lane.edge].speedLimit;
}

/** Route trees for every portal, keyed by portal node id. */
export function buildAllRouteTrees(net: Network): Map<NodeId, RouteTree> {
  const trees = new Map<NodeId, RouteTree>();
  for (const p of net.portals) trees.set(p, buildRouteTree(net, p));
  return trees;
}
