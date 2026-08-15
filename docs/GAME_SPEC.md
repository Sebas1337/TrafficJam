# TrafficJam — Game Design & Technical Specification

> Reference document. The implementing agent should read this in full before writing code.
> The paste-ready build prompt lives in [`BUILD_PROMPT.md`](./BUILD_PROMPT.md).

---

## 1. Vision

A top-down traffic management game for phones. You are handed a randomly generated
town with a road skeleton and 3–6 entry/exit portals labelled **A, B, C…**. Cars
spawn at portals, each with another portal as its destination, and demand grows
relentlessly. You keep the town moving by **building roads, upgrading intersections,
placing traffic signals, and — the core mechanic — coordinating those signals into
green waves.**

**The hook:** most traffic games let you place lights. This one lets you *time* them
against each other on a time–space diagram, so a car can cross five intersections
without stopping. That is the skill ceiling and the thing worth marketing.

**Failure is emergent, not scripted.** Queues spill back through intersections and
lock the grid. Players lose to gridlock they built themselves.

---

## 2. Design pillars

1. **Legible causality.** The player must always be able to see *why* traffic is
   stuck. Congestion heatmaps, queue visualisation, and a "worst intersection"
   pointer are core features, not polish.
2. **Timing over tarmac.** Building more road is expensive and often the wrong
   answer. The cheap, clever fix is retiming. The economy must enforce this.
3. **Phone-first, not phone-ported.** Every interaction works one-thumb, in
   portrait, while paused. Editing while paused is a first-class mode.
4. **Deterministic and reproducible.** Same seed + same actions = same run. This
   makes maps shareable and the simulation testable.

---

## 3. Technology & constraints

| Concern | Decision |
|---|---|
| Language | TypeScript, `strict: true`, no `any` in sim code |
| Build | Vite |
| Rendering | HTML Canvas 2D, layered (static + dynamic) — no game engine |
| UI chrome | Plain DOM/CSS over the canvas (menus, panels, tool bar) |
| State | Hand-rolled; no React/Vue. The sim owns the truth, UI reads it |
| Dependencies | Zero runtime deps. Dev deps: vite, typescript, vitest |
| Delivery | PWA — manifest + service worker, installable to homescreen |
| Hosting | Static; deployable to GitHub Pages (`base` configured) |
| Backend | None. All state in `localStorage` |
| Target | 60 fps with 300 active cars on a mid-range 2021 Android phone |

**Why no engine:** the simulation, routing, and rendering are all bespoke. Phaser
would add weight and constrain the render layer without removing meaningful work.

---

## 4. Units and physical constants

All simulation math is in **metres and seconds**. Rendering converts to pixels.
Constants live in one `constants.ts` file; nothing may hardcode these inline.

```
GRID_CELL          = 20 m         // one map cell
CAR_LENGTH         = 4.5 m
MIN_GAP (s0)       = 2.0 m        // jam spacing = 6.5 m => ~3 cars per cell
LANE_WIDTH         = 3.2 m

SPEED_LOCAL        = 8.3 m/s      // 30 km/h
SPEED_ARTERIAL     = 13.9 m/s     // 50 km/h

IDM_ACCEL (a)      = 1.5 m/s^2
IDM_COMFORT_BRAKE  = 2.0 m/s^2
IDM_HEADWAY (T)    = 1.2 s
IDM_DELTA          = 4
IDM_EMERGENCY_BRAKE= 6.0 m/s^2    // hard cap, used only to prevent overlap

YELLOW             = 3.0 s
ALL_RED            = 1.5 s
CYCLE_MIN / MAX    = 40 s / 120 s   (default 60 s)
MIN_GREEN          = 6.0 s

GAP_ACCEPT_CROSS   = 5.0 s        // unsignalised crossing movement
GAP_ACCEPT_MERGE   = 3.5 s        // merging / right turn
PROGRESSION_FACTOR = 0.85         // green-wave design speed = 0.85 x limit

SIM_HZ             = 60           // fixed timestep, dt = 1/60 s
```

---

## 5. Data model

### 5.1 Network graph

```ts
type NodeId = number; type EdgeId = number; type LaneId = number;

interface RoadNode {
  id: NodeId;
  pos: Vec2;                    // metres, world space
  kind: 'intersection' | 'bend' | 'portal' | 'dead_end';
  portal?: PortalLabel;         // 'A' | 'B' | 'C' | ...
  control: IntersectionControl;
  edges: EdgeId[];              // ordered clockwise by bearing
}

interface RoadEdge {
  id: EdgeId;
  from: NodeId; to: NodeId;
  class: 'arterial' | 'local';
  length: number;               // metres
  speedLimit: number;           // m/s
  forward: LaneId[];            // index 0 = rightmost lane
  backward: LaneId[];
}

interface Lane {
  id: LaneId; edge: EdgeId; dir: 1 | -1;
  index: number;                // 0 = rightmost
  allowedTurns: TurnKind[];     // for turn-lane restrictions
  cars: CarId[];                // sorted by s descending (head of queue first)
}

// A movement through an intersection: one incoming lane -> one outgoing lane.
interface TurnConnection {
  id: number; node: NodeId;
  inLane: LaneId; outLane: LaneId;
  kind: 'left' | 'through' | 'right' | 'uturn';
  path: Vec2[];                 // bezier-sampled path through the box
  length: number;
  conflicts: number[];          // ids of TurnConnections it crosses
  priority: number;             // higher wins at unsignalised nodes
}
```

`IntersectionControl` is a discriminated union:

```ts
type IntersectionControl =
  | { type: 'uncontrolled' }                       // priority by road class
  | { type: 'stop'; stoppedApproaches: LaneId[] }  // minor approaches stop
  | { type: 'signal'; program: SignalProgram }
  | { type: 'roundabout'; ringEdges: EdgeId[] };
```

### 5.2 Signals

```ts
interface SignalProgram {
  cycleLength: number;        // seconds, CYCLE_MIN..CYCLE_MAX
  offset: number;             // seconds, 0..cycleLength — THE coordination knob
  phases: SignalPhase[];      // sum of durations === cycleLength
}
interface SignalPhase {
  movements: number[];        // TurnConnection ids that get green
  green: number; yellow: number; allRed: number;
}
```

**Critical design decision:** the current phase is *derived*, never stored:

```ts
phaseAt(program, simTime) =>
  resolve((simTime + program.offset) % program.cycleLength)
```

This makes coordination stateless, makes offsets instantly meaningful, and makes
the whole signal system trivially serialisable and testable.

### 5.3 Cars

```ts
interface Car {
  id: CarId;
  origin: PortalLabel; destination: PortalLabel;
  route: EdgeId[];            // remaining path
  lane: LaneId | null;        // null while traversing a TurnConnection
  turn: number | null;        // TurnConnection id while in an intersection box
  s: number;                  // metres along current lane/connection
  v: number;                  // m/s
  desiredSpeed: number;       // driver variation: limit * N(1.0, 0.08)
  spawnTime: number;
  stoppedTime: number;        // accumulated, drives frustration
  freeFlowTime: number;       // computed at spawn, for the delay metric
}
```

---

## 6. Map generation

Seeded, validated, reproducible. Seed string format `TJ-XXXX-N` maps to a 32-bit
integer feeding a `mulberry32` PRNG. **No `Math.random()` anywhere in sim or
generation code** — enforced by a lint rule.

**Algorithm:**

1. Pick map extent — default 40 × 30 cells (800 m × 600 m).
2. Place **3–6 portals** on the boundary. Enforce a minimum separation along the
   perimeter so portals aren't clustered. Label A, B, C… clockwise from north.
3. **Arterial skeleton:** connect portal pairs with 2–4 arterial corridors. Route
   each with A* over the cell grid using a cost function that mildly rewards
   reusing existing arterials (creating shared corridors and thus real
   intersections) and penalises sharp turns. Arterials get 2 lanes each way.
4. **Local streets:** recursively subdivide the blocks bounded by arterials.
   Split a block with a street if its area exceeds a threshold; jitter the split
   position. 1 lane each way. Prune stubs shorter than 2 cells.
5. **Cleanup:** merge collinear degree-2 nodes into `bend`s, remove dead ends
   that serve nothing, collapse intersections closer than 25 m.
6. **Assign initial controls:** arterial×arterial → `signal`; arterial×local →
   `stop` on the local approaches; local×local → `uncontrolled`.
7. **Validate.** Reject and regenerate (max 50 attempts) unless:
   - every portal reaches every other portal (BFS on the lane graph);
   - total road length is within a target band;
   - at least one arterial corridor carries ≥ 3 signals (so green waves are
     *possible* — a map with no corridor is a boring map);
   - no portal is a pure dead-end with a single 1-lane approach.

Generation must be a pure function: `generateMap(seed: number) => Network`.

---

## 7. Simulation

### 7.1 Loop

Fixed timestep with an accumulator; rendering interpolates between the last two
sim states. Speed multipliers (1×/2×/4×) run N sim steps per rendered frame, hard
capped so a slow device drops sim speed rather than frame rate.

Per tick, in order:
1. Advance signal time (derived — nothing to update, just `simTime += dt`).
2. Spawn cars from portal queues per the demand model.
3. For every car: compute acceleration, integrate, handle lane/connection
   transitions.
4. Resolve intersection entry (gap acceptance / spillback checks).
5. Retire cars that reached their destination portal; bank reward.
6. Update metrics (throughput, delay, queue lengths, frustration).

### 7.2 Car following — IDM

Every car computes acceleration from a single leader:

```
s*  = s0 + max(0, v*T + (v * Δv) / (2 * sqrt(a * b)))
dv/dt = a * (1 - (v / v0)^IDM_DELTA - (s* / gap)^2)
```

**The key implementation trick — phantom leaders.** A red light, a stop line, a
yield decision, a car ahead in the intersection box, and the tail of the queue on
the *next* lane are all expressed as *a virtual stopped leader at distance d*.
The car then runs one uniform equation. This keeps the sim tiny and correct.

Each car's effective acceleration is the **minimum** over all active constraints:
its real leader, the stop-line phantom, the spillback phantom, and a curvature
speed cap while traversing a turn connection.

### 7.3 Intersections

**Signalised.** A movement is green if its `TurnConnection` id is in the current
phase's `movements`. Yellow → a car stops if it can do so at ≤ comfort brake,
otherwise proceeds (correct dilemma-zone behaviour). Red → phantom leader at the
stop line.

**Unsignalised (stop / uncontrolled / roundabout).** Gap acceptance: a car may
enter only if, for every conflicting `TurnConnection` with higher priority, the
time-to-arrival of the nearest approaching car exceeds the gap threshold. `stop`
control additionally requires a full stop (v < 0.3 m/s) before evaluating.

**Roundabouts** reuse this machinery: the ring is a set of one-way edges,
circulating traffic has priority, entering traffic yields with
`GAP_ACCEPT_MERGE`. No special-case code path.

### 7.4 Spillback — the gridlock rule

> A car may not enter an intersection box unless the target lane beyond it has
> free space of at least `CAR_LENGTH + MIN_GAP` behind its current tail.

This one rule is what produces genuine gridlock: green lights that cars cannot
use because the far side is full, queues propagating backwards through the
network, and blocked boxes deadlocking a ring of intersections. **It must be in
milestone 1.** Without it, the game has no teeth and no reason for the player to
think about coordination.

### 7.5 Lane changing (M2)

MOBIL-style: change lane if it is safe (the prospective follower's induced
braking stays below a threshold) and the incentive (own acceleration gain, plus
politeness factor × others' gain) exceeds a bias. Mandatory changes — getting
into the correct turn lane before an intersection — override the incentive term
and grow more urgent as the intersection approaches.

### 7.6 Routing

- For each destination portal, precompute a shortest-path tree over the lane
  graph with Dijkstra. Cost = `length / speedLimit` + turn penalties
  (left turn +4 s, through +0 s, right +1 s) + a signal penalty of half the
  cycle length. Turn penalties matter — without them routes look robotic.
- Recompute (debounced ~250 ms) whenever the player edits the network.
- Cars take a route at spawn and **commit to it**. Optional mild re-routing:
  at a decision node, re-evaluate only if the intended next lane's queue exceeds
  a threshold. Default: **off in campaign, low in endless.** This is deliberate —
  aggressive re-routing makes the sim self-heal and robs the player of agency.
- If the player deletes a road a car is routed over, the car re-routes from its
  current node; if no route exists it drives to the nearest portal and exits.

### 7.7 Demand model

- A demand profile defines spawn rate per origin→destination pair over time.
- Endless: start ~6 cars/min total; ramp geometrically. Every ~90 s either
  unlock a new OD pair or raise an existing pair's weight. Periodic "rush hour"
  events multiply one corridor's demand for 45 s, announced 10 s ahead so the
  player can pre-empt.
- Cars queue at a portal if it is full; a portal queue over `N` is a fail signal.

---

## 8. Signal coordination — the marquee feature

### 8.1 Model

A **corridor** is an ordered list of signalised nodes the player has linked. For
each consecutive pair the game knows the along-corridor distance. The suggested
offset is `distance / (PROGRESSION_FACTOR × speedLimit)`, and the player can
override it freely. Corridors can be tuned in one direction or balanced for both
(the two-way case is genuinely hard and is where the skill ceiling lives).

### 8.2 The time–space diagram

A dedicated **full-screen** panel — not a cramped overlay.

- **Y axis:** distance along the corridor, each signal a horizontal band row.
- **X axis:** time, showing two full cycles so wraparound is visible.
- **Green bands:** drawn per signal for the through movement.
- **Progression line:** a diagonal representing a car travelling at the design
  speed. Green wave achieved when that line passes through every band.
- **Direct manipulation:** drag a band horizontally → changes that signal's
  offset. Drag its edge → changes the split. Pinch the whole diagram → changes
  the common cycle length.
- **Band efficiency readout:** the percentage of the cycle during which a car can
  traverse the whole corridor unimpeded, in each direction.
- An **auto-tune** button solves offsets for one direction. It should be
  available but *cost in-game currency*, so it's a hint rather than a bypass.

This screen is the game's identity. Budget real design time for it.

---

## 9. Player tools & mobile UX

**Layout.** Portrait-primary, landscape supported. Canvas fills the screen. A
bottom tool bar (thumb reach) holds modes; a top strip shows money, throughput,
frustration meter, clock, and speed controls. Respect safe-area insets.

**Universal gestures**, active in every mode: one-finger drag on empty space
pans; pinch zooms; two-finger drag pans. Tool actions must never conflict with
these — a tool action begins only on a touch that starts on a valid target.

**Modes:**

| Mode | Behaviour |
|---|---|
| **Inspect** (default) | Tap anything for a detail sheet. Tap a signal → quick timing card (cycle, split, offset sliders). |
| **Build road** | Drag from an existing node or edge. Snaps to the 20 m grid and to nearby nodes. Live cost preview; illegal geometry drawn red. Releasing commits. |
| **Upgrade** | Tap a road → add/remove a lane, add a turn lane. Tap an intersection → cycle control type (uncontrolled → stop → signal → roundabout), each with a price. |
| **Corridor** | Tap signals in order to build a corridor, then open the time–space diagram. |
| **Demolish** | Tap to remove with a partial refund. Long-press to confirm — never a single-tap destructive action. |

**Non-negotiables:**
- **Full editing while paused.** Players plan calmly, then unpause. This is the
  single most important mobile affordance in the game.
- **Undo stack**, minimum 20 actions deep, for every build/demolish/retiming
  action. Fat fingers are guaranteed.
- Touch targets ≥ 44 px. Intersection tap radius generously larger than its
  drawn size.
- Every panel dismissible by swipe-down and by an explicit close button.

**Diagnostics the player can toggle:**
- **Congestion heatmap** — roads tinted by density or mean delay.
- **Queue bars** — a numeric queue length at each approach.
- **Worst intersection** pointer with its delay contribution.
- **Trip trails** — trace one car's whole journey (great for spotting a bad route).

---

## 10. Economy, scoring, failure

**Currency.** Earned per delivered car, scaled by how little that car was delayed:

```
reward = BASE + BONUS * clamp(freeFlowTime / actualTime, 0, 1)
```

This directly ties income to the objective — a jammed network is not just ugly,
it is *poor*.

**Costs.** Road per 20 m tile; lane upgrade; turn lane; stop sign (cheap);
signal (expensive); roundabout (very expensive); auto-tune (moderate).
Demolition refunds ~50%.

**Primary score:** total cars delivered.
**Secondary stats:** Travel Time Index (`actual / free-flow`, the real-world
metric), mean delay per car, peak queue length, longest green-wave streak.

**Failure (endless).** A frustration meter, not instant death. Cars accumulate
frustration while stopped; portal queues over capacity add to it. The meter
drains when flow is healthy. Game over when it fills — so the player gets a
visible, recoverable warning, and a comeback is possible.

---

## 11. Modes

**Endless.** Random seed (or entered seed), escalating demand, run until the
frustration meter fills. Leaderboard-style local high scores per seed.

**Campaign.** ~15 hand-authored levels, data-driven from JSON (fixed seed +
objectives + budget + star thresholds), each teaching one concept:

| Levels | Teaches |
|---|---|
| 1–3 | Reading flow, placing a first signal, connecting a missing link |
| 4–6 | Splits; when a stop sign beats a signal |
| 7–9 | **Corridors and green waves** — the core teach, given three levels |
| 10–12 | Turn lanes, roundabouts, rescuing a gridlocked map |
| 13–15 | Combined hard scenarios, two-way corridor balancing |

Three-star thresholds on cars delivered and Travel Time Index. Levels unlock
sequentially; stars unlock nothing (no grind gates).

---

## 12. Rendering & performance

- **Two canvases.** Static layer (roads, markings, buildings, labels) redrawn
  only on network edit or zoom change. Dynamic layer (cars, signal heads,
  overlays) every frame.
- Cars are simple rounded rects, coloured by **destination**: A `#E8912A`,
  B `#3B82F6`, C `#14B8A6`, D `#A855F7`, E `#EC4899`, F `#84CC16` — plus a
  letter badge, so it reads without relying on colour alone.
- Signal heads render as small three-dot fixtures; at low zoom, collapse to a
  single coloured dot.
- Cap `devicePixelRatio` at 2. Cull off-screen cars from the draw loop.
- Interpolate car positions between sim ticks for smoothness.
- Budget: ≤ 8 ms/frame for sim + render at 300 cars.

---

## 13. Persistence & PWA

- `localStorage` keys namespaced `tj.*`: settings, campaign progress and stars,
  per-seed high scores, and one in-progress endless run.
- Save format is versioned with an explicit `schemaVersion` and a migration path.
- Serialise the network, RNG state, sim time, economy, and signal programs. Cars
  may be discarded on save and respawned on load — do not fight to persist them.
- Autosave every 30 s and on `visibilitychange` (phones kill tabs aggressively —
  this matters).
- Manifest: name, icons (192/512, maskable), `display: standalone`,
  `orientation: portrait-primary`, theme colour.
- Service worker precaches the app shell for full offline play.

---

## 14. Testing & determinism

Determinism is a feature, not a nicety — it's what makes this testable.

- Seeded PRNG everywhere; a lint rule bans `Math.random` and `Date.now` from
  `src/sim/**`.
- **Headless harness:** `runHeadless(network, demand, seconds)` steps the sim
  with no rendering and returns metrics. This is the backbone of the test suite.

Required tests, tagged with the slice that introduces them (§15):

| # | Test | Slice |
|---|---|---|
| 1 | **Collision invariant** — across 1000 sim-seconds on several seeds, no two cars on the same lane ever overlap. *The single most valuable test in the project.* | 1 |
| 2 | **No negative speeds**, no NaN positions, ever. | 1 |
| 3 | **Generator soundness** — 1000 seeds all produce fully connected maps passing every validation rule. | 1 |
| 4 | **Signal phase math** — phase lookup correct across offset wraparound and at exact boundaries. | 1 |
| 5 | **Routing** — returns a connected, traversable lane path. | 1 |
| 6 | **Spillback/deadlock** — a saturated ring network does deadlock (proving the rule bites) and clears once a signal is retimed. | 1 |
| 7 | **Green wave** — on a fixture corridor, correctly offset signals produce measurably lower mean delay than zero-offset ones. *This asserts the core mechanic actually works.* | 2 |
| 8 | **Route repair** — a car whose road is deleted mid-route re-routes or exits gracefully. | 3 |

Once a test is introduced it stays green forever. Test 1 in particular must be
added the moment cars start moving, not retrofitted — a sim that silently lets
cars overlap looks fine and is wrong.

---

## 15. Roadmap — incremental slices

The project ships in small slices. **Every slice ends with a working, deployed
build the player can open on their phone.** No slice may begin until the
previous one is playable and its tests are green.

Two rules govern the slicing:

- **Deployment is in slice 1, not at the end.** The whole point is playing it on
  a phone; a build that only runs on localhost is not a deliverable.
- **A slice adds one idea.** If a slice needs a paragraph to describe what it
  adds, it is two slices.

### Slice 1 — "Time the lights" *(the first playable game)*

The map is fixed and already signalised. The entire game is retiming those
signals to keep traffic moving.

**In:** Vite/TS scaffold · fixed-timestep loop · canvas layers · pan/zoom ·
seeded map generation with portals A/B/C · routing · IDM car following ·
signalised intersections · **spillback** · tap-a-signal timing editor (cycle,
split, offset) · demand ramp · throughput readout · frustration meter and fail
state · pause/1×/2×/4× · installable PWA deployed to GitHub Pages ·
headless harness + collision invariant + generator soundness + phase math tests.

**Out:** road building, economy/currency, corridor UI, time–space diagram,
stop signs, roundabouts, turn lanes, lane changing, campaign, save/load.

**Map size for this slice:** 16 × 24 cells (320 m × 480 m), portrait-oriented:
one vertical main street with 2–3 signalised cross-street junctions and a
portal at every road end (4–5 portals). Revised down from a 4–6 signal grid
after the first phone playtest — whole-town zoom must stay readable on a
390 px-wide screen without pinching.

**Acceptance:** install to homescreen, start a run offline, watch cars drive
A→B→C, tap a signal, change its split, see throughput move, let it gridlock,
lose. 60 fps with 150 cars.

> **Why spillback is in slice 1 despite sounding advanced:** without it, queues
> never block intersections, timing barely matters, and slice 1 is a screensaver
> rather than a game. It is roughly 20 lines and it is the reason the game works.

### Slice 2 — "Green waves"
Corridor linking · the full-screen time–space diagram with direct manipulation ·
band efficiency readout · congestion heatmap · the green wave test.
*This is the hook — it gets its own slice and its own polish pass.*

### Slice 3 — "Build"
Road drawing with grid snapping · currency and costs · lane upgrades · demolish ·
undo stack · save/load with versioned schema.

### Slice 4 — "Intersection variety"
Stop signs · priority roads · gap acceptance · roundabouts · cycling an
intersection's control type as a paid upgrade.

### Slice 5 — "Lanes"
Turn lanes and turn pockets · MOBIL lane changing · multi-lane arterials.

### Slice 6 — "Campaign"
JSON-authored levels · the 15-level progression from §11 · tutorial overlays ·
three-star thresholds · after-action stats screen.

### Slice 7 — "Pedestrians"
Crosswalks · pedestrian demand · a pedestrian phase competing for green time.
*This lands well here: once corridors exist, a pedestrian phase eating into your
green band is a genuinely interesting trade-off rather than just another system.*

### Later
Buses or emergency vehicles with signal priority · seed sharing · ghost replays ·
sound · weather or time-of-day demand patterns.

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| Time–space diagram too fiddly on a phone | It owns slice 2 entirely, so it gets a real design pass. If direct manipulation fails on a thumb, fall back to per-signal offset sliders with the diagram as read-only visualisation. |
| Sim perf collapses above ~200 cars | Spatial partition per lane (cars already sorted by `s`), cull rendering, and cap sim steps per frame before frame rate. Profile at 300 cars from slice 1. |
| Gridlock feels unfair / unrecoverable | Frustration meter drains on recovery; add a costly "clear the box" emergency action so a deadlock is a setback, not an instant loss. |
| Road drawing is imprecise with a thumb | Snap aggressively to grid and existing nodes; show the committed geometry before release; always undoable. |
| Scope creep across slices | Every slice is independently shippable and playable on a phone. A slice may not begin until the previous one is deployed and green. When a slice runs long, cut its polish — never its tests. |
| Later slices need refactors that break earlier ones | Expected and fine. The sim's data model (§5) is designed for the full feature set from day one even though slice 1 uses a fraction of it — lanes are arrays, controls are a union, turns are explicit — so adding roundabouts or turn lanes extends the model rather than rewriting it. |
