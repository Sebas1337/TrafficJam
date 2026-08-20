# TrafficJam — Progress Tracker

Two systems, deliberately non-overlapping — keep it that way or they will drift:

- **GitHub issues** are the checklist of record. One issue per slice, with its
  scope, tasks, and acceptance criteria. Tick boxes there.
- **This file** holds what issues are bad at: current state at a glance, the
  decision log, and known issues. No task checklists here.

| Slice | Issue | Status |
|---|---|---|
| 1 — Time the lights | [#1](https://github.com/Sebas1337/TrafficJam/issues/1) | ✅ shipped, human-accepted |
| 2 — Green waves | [#2](https://github.com/Sebas1337/TrafficJam/issues/2) | ✅ shipped, human-accepted |
| 3 — Build | [#3](https://github.com/Sebas1337/TrafficJam/issues/3) | built ("exists" pass), awaiting phone verification |
| 4 — Intersection variety | [#4](https://github.com/Sebas1337/TrafficJam/issues/4) | built — roundabouts are yield-based, no ring geometry yet |
| 5 — Lanes | [#5](https://github.com/Sebas1337/TrafficJam/issues/5) | partial — 2-lane widening + entry lane choice; **no MOBIL mid-edge lane changing** |
| 6 — Campaign | [#6](https://github.com/Sebas1337/TrafficJam/issues/6) | built — 15 levels, teach cards, stars; thresholds untuned |
| 7 — Pedestrians | [#7](https://github.com/Sebas1337/TrafficJam/issues/7) | built — counter-based peds, walk phase, diagram slots |

> **2026-08-15, per the user:** strategy switched from one-polished-slice-at-a-
> time to breadth-first — "first make it exist, then we make it better."
> Slices 3–7 shipped together in simplified form; the table above and the
> Known-issues list say exactly where the simplifications are.

---

## Current state

| | |
|---|---|
| **Slice in progress** | 3–7 all built in "exists" form; polish passes pending |
| **Next up** | Phone playtest across the new systems, then targeted "make it better" passes |
| **Live build** | https://sebas1337.github.io/TrafficJam/ (Pages enabled; auto-deploys on every push) |
| **Last updated** | 2026-08-15 — slices 3–7 shipped breadth-first, 22/22 tests green |

**What exists today:** slices 1–2 (user-accepted) plus the breadth-first pass
over 3–7. Economy (money, delay-scaled rewards, TTI); build tool with
node/edge/grid snapping, cost preview, splitting roads at junctions; widen
and demolish with refunds; 20-deep undo; stop signs, priority-by-class,
yield-based roundabouts; 2-lane arterials with per-lane turn permissions and
entry-time lane choice; main menu, 15-level campaign with teach cards, star
ratings and after-action stats; endless autosave/continue; pedestrians
queueing at signals with an optional walk phase that appears as blue slots in
the time–space diagram; auto-tune now costs $150. 22/22 tests green
including route repair, control variety, and a save/load round-trip.

---

## Decision log

Design forks resolved during planning and implementation, newest first, so
future sessions don't re-litigate them. One line each: the decision, and why.

| Date | Slice | Decision |
|---|---|---|
| 2026-08-15 | 3–7 | Breadth-first "make it exist" pass at the user's direction; simplifications logged under Known issues rather than silently shipped. |
| 2026-08-15 | 3 | Edges/lanes tombstone (never deleted) so ids stay stable; connections rebuild wholesale after edits, signal knobs survive via re-derivation. Cars in boxes or on removed lanes despawn as "lost"; undo restores topology+money but keeps the clock and despawns cars. |
| 2026-08-15 | 4 | Roundabouts are yield-to-occupied-box approximations, not ring geometry — still shows the low-demand-good / high-demand-bad capacity profile. Ring edges deferred. |
| 2026-08-15 | 5 | Lane model: cars pick a lane at edge entry (route cost + queue balance, turn permissions per lane index); MOBIL mid-edge lane changing deferred — highest-risk change for the collision invariant. |
| 2026-08-15 | 6 | Stars are self-normalizing (delivered ÷ spawned) so thresholds survive demand retuning; surviving a level guarantees 1★. |
| 2026-08-15 | 7 | Peds are per-signal counters, not simulated agents: they queue, cross during a fixed walk phase (derived-phase invariant kept — no actuated skipping), and feed frustration when ignored. |
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

**From the slices 3–7 breadth-first pass (the "make it better" backlog):**

- **No MOBIL lane changing** (slice 5's headline feature). Cars commit to a
  lane at edge entry; no mid-edge changes, no turn pockets. Issue #5 stays
  partially open.
- **Roundabouts have no ring geometry** — they're yield-based intersection
  behaviour with a circle glyph. Issue #4's "no special-case code path"
  acceptance is not honestly met yet.
- **Campaign star thresholds and level difficulty are untuned** — set by
  formula, not play. Expect several levels to be too easy or unfair.
- **Tutorial system is text cards**, not interactive step-by-step overlays.
- **Undo despawns all cars** (topology restore can't preserve them);
  clock/score are kept. Jarring but functional.
- **Building while cars are mid-box loses those cars** (counted as "lost").
- **Peds are counters, not agents** — no walking figures on crosswalks
  beyond the walk-phase animation dots.
- **New roads are always 1-lane local** — class is chosen for you; widen
  afterwards for arterial.

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
