# TrafficJam — Progress Tracker

Two systems, deliberately non-overlapping — keep it that way or they will drift:

- **GitHub issues** are the checklist of record. One issue per slice, with its
  scope, tasks, and acceptance criteria. Tick boxes there.
- **This file** holds what issues are bad at: current state at a glance, the
  decision log, and known issues. No task checklists here.

| Slice | Issue | Status |
|---|---|---|
| 1 — Time the lights | [#1](https://github.com/Sebas1337/TrafficJam/issues/1) | ✅ shipped, human-accepted |
| 2 — Green waves | [#2](https://github.com/Sebas1337/TrafficJam/issues/2) | built, awaiting phone verification |
| 3 — Build | [#3](https://github.com/Sebas1337/TrafficJam/issues/3) | blocked by #1 |
| 4 — Intersection variety | [#4](https://github.com/Sebas1337/TrafficJam/issues/4) | blocked by #3 |
| 5 — Lanes | [#5](https://github.com/Sebas1337/TrafficJam/issues/5) | blocked by #3 |
| 6 — Campaign | [#6](https://github.com/Sebas1337/TrafficJam/issues/6) | blocked by #4, #5 |
| 7 — Pedestrians | [#7](https://github.com/Sebas1337/TrafficJam/issues/7) | blocked by #2 |

---

## Current state

| | |
|---|---|
| **Slice in progress** | Slice 2 ([#2](https://github.com/Sebas1337/TrafficJam/issues/2)) — built, awaiting human phone verification |
| **Next up** | Slice 2 acceptance pass on a real phone, then slice 3 "Build" |
| **Live build** | https://sebas1337.github.io/TrafficJam/ (Pages enabled; auto-deploys on every push) |
| **Last updated** | 2026-08-15 — slice 2 implementation complete, 16/16 tests green |

**What exists today:** slice 1 (accepted by the user on a real phone) plus the
full slice-2 feature set: corridor linking (tap signals in order), the
full-screen time–space diagram with distance rows, green bands over two
cycles, both-direction progression lines and a live now-marker, direct
manipulation (drag band → offset, drag trailing edge → split, pinch/± →
common cycle), band-efficiency readout for both directions, auto-tune per
direction, a congestion heatmap toggle, and numbered corridor badges on the
map. Test 7 (green wave) proves tuned offsets measurably beat zero offsets.
Verified over CDP: link → diagram → auto-tune lifts ↓ wave 19%→43% (and
honestly drops ↑ to 0%). **Slice-2 acceptance boxes on issue #2 await the
user's phone pass.**

---

## Decision log

Design forks resolved during planning and implementation, newest first, so
future sessions don't re-litigate them. One line each: the decision, and why.

| Date | Slice | Decision |
|---|---|---|
| 2026-08-15 | 2 | Linking a corridor normalizes all its signals to a common cycle length (the first signal's) — coordination is only meaningful on a shared cycle, and this makes offsets the single tuning knob. Reopening the diagram re-normalizes if the player diverged cycles via the per-signal sheet. |
| 2026-08-15 | 2 | Auto-tune aligns green *centres* (not starts) along the progression line, keeping the first signal in travel order fixed. Free in slice 2; gets a price when the economy lands (slice 3). |
| 2026-08-15 | 2 | Progression lines anchor to the first signal's green centre, so dragging S1's band steers the whole wave — "align everything to signal 1" is the mental model. Both directions drawn (solid ↓, dashed ↑) so the two-way trade-off is visible. |
| 2026-08-15 | 2 | Corridor state lives in the Game (UI layer), not the sim — the sim only ever sees signal programs. Cleared on restart. |
| 2026-08-15 | 1 | **Playtest feedback round 1:** map relaid out as a portrait "spine town" — one vertical main street, 2-3 signalised cross junctions, portal at every road end (4-5 portals), 320×480 m. The earlier 4-6 signal grid rendered at ~0.6 px/m on a phone: too small, too much at once. Renderer also gained minimum on-screen sizes for cars, roads, and signal heads. |
| 2026-08-15 | 1 | **Playtest feedback round 1:** signal editor gained a live phase timeline (↑↓/←→ strips coloured across one cycle + a moving now-marker) after feedback that the sliders were opaque. Doubles as the visual language for the slice-2 time–space diagram. |
| 2026-08-15 | 1 | Map generation simplified from spec §6 (organic subdivision) to a seeded corridor layout; the organic generator arrives with slice 3 when player-built roads make bigger maps matter. |
| 2026-08-15 | 1 | Single lane per direction everywhere. The data model carries lane arrays (spec §5) so slice 5 widens rather than rewrites. |
| 2026-08-15 | 1 | Permissive left turns: lefts yield to opposing through traffic via a gap check, and box entry requires all conflicting connections empty. Protected left phases can come with turn lanes (slice 5). |
| 2026-08-15 | 1 | `World.failureEnabled` flag added: fixtures/tests that engineer long jams need frustration not to end the run. Campaign/sandbox will reuse it. |
| 2026-08-15 | 1 | Frustration rates retuned (fill 0.022/s, queue 0.012/s) after a CDP soak test showed game over in 41 s of jam — too twitchy to fight back against. |
| 2026-08-15 | 1 | Determinism lint implemented as a vitest source-scan (no eslint), keeping the dev-dependency invariant (vite/typescript/vitest only). Node builtins for tests typed via a local ambient declaration instead of @types/node, same reason. |
| 2026-08-15 | plan | GitHub issues own the per-slice checklists; this file owns state, decisions, and known issues. Avoids two drifting task lists. |
| 2026-08-15 | plan | Slice 1 has no road building — retiming a fixed map is a complete game, and it proves the sim feels good before an editor is layered on. |
| 2026-08-15 | plan | Spillback lands in slice 1 despite sounding advanced; without it signal timing barely matters and slice 1 is a screensaver. |
| 2026-08-15 | plan | Deployment is slice 1 step 1, not a final step — the point is playing on a phone. |
| 2026-08-15 | plan | Cars commit to their route at spawn; aggressive re-routing would let the sim quietly fix the player's mistakes. |
| 2026-08-15 | plan | Signal phase is derived from `(simTime + offset) % cycleLength`, never stored — makes coordination stateless and slice 2 nearly free. |
| 2026-08-15 | plan | Pedestrians deferred to slice 7, after corridors, so a pedestrian phase reads as a trade-off against your green wave rather than an isolated system. |

---

## Known issues / deferred

Anything knowingly left broken or unfinished. Empty is a valid state — an
inaccurate empty is not.

- **Pages needs a one-time manual enable** (see Live build above). The CI
  token cannot create the Pages site (`configure-pages` returned "Resource not
  accessible by integration") and gh-pages auto-enable did not trigger. The
  `gh-pages` branch is built and pushed on every CI run; once enabled, every
  future deploy is automatic.
- **Demand/frustration balance is untested by feel.** Constants (§4 demand,
  frustration rates) are tuned from headless soak tests, not play. Expect a
  balance pass after the first real phone sessions.
- **The slice-1 map holds well under 150 cars organically** (small spine
  town). The "60 fps with 150 cars" criterion was verified by injecting 160
  cars as a perf fixture; organic play won't reach that count. Fine for
  slice 1; bigger maps come with slice 3.
- **Render interpolation uses the previous tick's pose** — at 4× speed with a
  full step backlog, cars can visibly skip. Invisible at 1×/2×.
- **`enforceNoOverlap` is a hard clamp** guaranteeing the collision invariant
  even where Euler integration overshoots; in extreme jams it can very
  occasionally read as a small "snap". Cosmetic only.
