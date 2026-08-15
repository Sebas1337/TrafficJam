# TrafficJam — Progress Tracker

Two systems, deliberately non-overlapping — keep it that way or they will drift:

- **GitHub issues** are the checklist of record. One issue per slice, with its
  scope, tasks, and acceptance criteria. Tick boxes there.
- **This file** holds what issues are bad at: current state at a glance, the
  decision log, and known issues. No task checklists here.

| Slice | Issue | Status |
|---|---|---|
| 1 — Time the lights | [#1](https://github.com/Sebas1337/TrafficJam/issues/1) | not started |
| 2 — Green waves | [#2](https://github.com/Sebas1337/TrafficJam/issues/2) | blocked by #1 |
| 3 — Build | [#3](https://github.com/Sebas1337/TrafficJam/issues/3) | blocked by #1 |
| 4 — Intersection variety | [#4](https://github.com/Sebas1337/TrafficJam/issues/4) | blocked by #3 |
| 5 — Lanes | [#5](https://github.com/Sebas1337/TrafficJam/issues/5) | blocked by #3 |
| 6 — Campaign | [#6](https://github.com/Sebas1337/TrafficJam/issues/6) | blocked by #4, #5 |
| 7 — Pedestrians | [#7](https://github.com/Sebas1337/TrafficJam/issues/7) | blocked by #2 |

---

## Current state

| | |
|---|---|
| **Slice in progress** | — none — |
| **Next up** | Slice 1 ([#1](https://github.com/Sebas1337/TrafficJam/issues/1)) |
| **Live build** | *(not yet deployed)* |
| **Last updated** | 2026-08-15 — planning only, no code yet |

**What exists today:** design documentation only (`GAME_SPEC.md`,
`BUILD_PROMPT.md`, this file) and the seven slice issues. No application code.

---

## Decision log

Design forks resolved during planning and implementation, newest first, so
future sessions don't re-litigate them. One line each: the decision, and why.

| Date | Slice | Decision |
|---|---|---|
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

*(none yet)*
