# TrafficJam

A mobile-first traffic management game. Top-down randomly generated town, cars
driving between labelled portals (A/B/C…), and a player keeping traffic flowing
by building roads and — the core mechanic — coordinating traffic signal timing
into green waves.

## Read these first, in this order

1. **`docs/PROGRESS.md`** — what is built, what is next, and why past decisions
   were made. Always read this before starting work.
2. **`docs/GAME_SPEC.md`** — the authoritative design and technical spec:
   constants, data model, algorithms, tests, roadmap.
3. **`docs/BUILD_PROMPT.md`** — the prompt for the slice currently being built.

## How this project is built

The game ships in **small incremental slices** (spec §15). Each slice ends with a
working build that is playable on a phone and deployed. **Do not start the next
slice until the current one's acceptance criteria pass.**

Each slice's prompt carries an explicit out-of-scope list. Respect it — finishing
one slice completely beats starting three.

## Session rules

- **Before starting:** read `docs/PROGRESS.md` and work only on the current slice.
- **Before finishing:** update `docs/PROGRESS.md` — tick what you completed, set
  the current-state table, and add any design decisions to the decision log.
  Record anything knowingly left broken under "Known issues / deferred".
- **Be accurate.** Only tick an acceptance checkbox when it is genuinely verified.
  An optimistic tracker is worse than no tracker, because the next session builds
  on top of it.
- Commit in logical increments. Push to the working branch named in the prompt.

## Invariants — do not break these

These are load-bearing and easy to violate by accident:

- **Determinism.** Seeded `mulberry32` everywhere; fixed 60 Hz timestep.
  `Math.random` and `Date.now` are banned from `src/sim/**`.
- **Signal phase is derived, never stored:** `(simTime + offset) % cycleLength`.
- **Spillback:** a car may not enter an intersection box unless there is room on
  the far side. This is what makes gridlock emergent.
- **Phantom leaders:** red lights, stop lines, yields, and downstream queue tails
  are all modelled as a virtual stopped leader, so one IDM equation drives
  everything.
- **Units are metres and seconds** in all sim code. Conversion to pixels happens
  only at the render layer.
- **Zero runtime dependencies.** Dev deps limited to vite, typescript, vitest.
- **The collision invariant test stays green.** Cars must never overlap.

## Commands

*(populated once the scaffold exists)*
