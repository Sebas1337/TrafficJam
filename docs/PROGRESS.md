# TrafficJam — Progress Tracker

**This file is the single source of truth for what is built and what is next.**
Every session must read it before starting work and update it before finishing.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and verified on a phone

---

## Current state

| | |
|---|---|
| **Slice in progress** | — none — |
| **Next up** | Slice 1: "Time the lights" |
| **Live build** | *(not yet deployed)* |
| **Last updated** | 2026-08-15 — planning only, no code yet |

**What exists today:** design documentation only (`GAME_SPEC.md`,
`BUILD_PROMPT.md`, this file). No application code.

---

## Slice 1 — "Time the lights"

> Fixed signalised map. The whole game is retiming signals to keep traffic
> moving. See spec §15 for scope boundaries and the out-of-scope list.

**Foundation**
- [ ] Vite + TypeScript scaffold, `strict` on
- [ ] Constants module (spec §4) — nothing hardcoded inline
- [ ] Seeded `mulberry32` PRNG; lint rule banning `Math.random`/`Date.now` in `src/sim/**`
- [ ] Fixed 60 Hz timestep loop with accumulator + render interpolation
- [ ] Layered canvas (static + dynamic), pan and pinch-zoom
- [ ] **Deployed to GitHub Pages** *(do this while the app still renders nothing)*

**World**
- [ ] Network data model (spec §5)
- [ ] Map generator with validation and retry (spec §6)
- [ ] Road, intersection, and portal-label rendering
- [ ] Dijkstra routing with turn penalties

**Simulation**
- [ ] Car spawning at portals with A/B/C destinations
- [ ] IDM car following with phantom leaders
- [ ] Movement through turn connections
- [ ] Signal phase derivation — `(simTime + offset) % cycleLength`
- [ ] Signal head rendering, stop-line phantoms, yellow dilemma-zone handling
- [ ] **Spillback** — no entry to a box without room on the far side

**Game**
- [ ] Tap-an-intersection timing editor: cycle, split, offset
- [ ] Escalating demand model
- [ ] Throughput readout and metrics
- [ ] Frustration meter, game over, restart
- [ ] Pause + 1×/2×/4× speed, with full editing while paused

**Ship**
- [ ] PWA manifest + service worker, verified offline
- [ ] Performance pass — 60 fps at 150 cars on a real phone
- [ ] README: how to run, test, deploy

**Tests** *(spec §14)*
- [ ] 1. Collision invariant *(add as soon as cars move, not at the end)*
- [ ] 2. No negative speeds, no NaN positions
- [ ] 3. Generator soundness across 1000 seeds
- [ ] 4. Signal phase math across offset wraparound
- [ ] 5. Routing returns traversable paths
- [ ] 6. Spillback/deadlock forms and clears

**Acceptance — verified by a human on a real phone**
- [ ] Installs to homescreen and runs offline
- [ ] Cars visibly drive A→B→C
- [ ] Tapping a signal and changing its split **moves the throughput number**
- [ ] The map can gridlock and the run can be lost
- [ ] 60 fps with 150 cars

---

## Slice 2 — "Green waves"
- [ ] Corridor linking (tap signals in sequence)
- [ ] Full-screen time–space diagram with green bands and progression line
- [ ] Direct manipulation: drag band → offset, drag edge → split
- [ ] Band efficiency readout, both directions
- [ ] Congestion heatmap toggle
- [ ] Test 7: green wave measurably beats zero offsets
- [ ] Acceptance: a player can fix a corridor's offsets and watch a car cross
      three signals without stopping

## Slice 3 — "Build"
- [ ] Road drawing with grid and node snapping
- [ ] Currency, costs, delay-scaled rewards
- [ ] Lane upgrades, demolish with refund
- [ ] Undo stack, 20 deep
- [ ] Save/load with versioned schema + autosave
- [ ] Test 8: route repair when a road is deleted mid-route

## Slice 4 — "Intersection variety"
- [ ] Stop signs and priority roads
- [ ] Gap acceptance for unsignalised movements
- [ ] Roundabouts
- [ ] Control-type cycling as a paid upgrade

## Slice 5 — "Lanes"
- [ ] Turn lanes and turn pockets
- [ ] MOBIL lane changing
- [ ] Multi-lane arterials

## Slice 6 — "Campaign"
- [ ] JSON level format
- [ ] 15 levels per spec §11
- [ ] Tutorial overlays, star thresholds, after-action stats

## Slice 7 — "Pedestrians"
- [ ] Crosswalks and pedestrian demand
- [ ] Pedestrian phase competing for green time

---

## Decision log

Design forks resolved during implementation go here, newest first, so future
sessions don't re-litigate them. One line each: the decision, and why.

| Date | Slice | Decision |
|---|---|---|
| 2026-08-15 | plan | Slice 1 has no road building — retiming a fixed map is a complete game, and it proves the sim feels good before an editor is layered on. |
| 2026-08-15 | plan | Spillback lands in slice 1 despite sounding advanced; without it signal timing barely matters. |
| 2026-08-15 | plan | Deployment is slice 1 step 1, not a final step. |
| 2026-08-15 | plan | Cars commit to their route at spawn; aggressive re-routing would let the sim fix the player's mistakes. |

---

## Known issues / deferred

Anything knowingly left broken or unfinished. Empty is a valid state — but an
inaccurate empty is not.

*(none yet)*
