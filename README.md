# TrafficJam

A mobile-first traffic management game. Top-down randomly generated town, cars
driving between labelled portals (A/B/C), and you keeping the traffic flowing —
for now by retiming the traffic signals; later by building the network itself.

**Slice 1 — "Time the lights":** the map is generated and already signalised.
The entire game is retiming those signals (cycle, split, offset) to keep
traffic moving as demand ramps up. Queues spill back through intersections;
gridlock is emergent, and it ends your run via the frustration meter.

## Play

Live at **https://sebas1337.github.io/TrafficJam/** (deployed by GitHub Actions
to the gh-pages branch). Add `?seed=12345` to the URL to play a specific town. Install to your
homescreen for offline play (PWA).

- **Drag / pinch** — pan and zoom
- **Tap a signal** — open the timing editor (works while paused)
- **⏸ / 1× / 2× / 4×** — pause and speed controls

## Develop

```bash
npm install
npm run dev       # local dev server
npm test          # vitest suite (collision invariant, generator, phase math…)
npm run build     # typecheck + production build to dist/
npm run preview   # serve the production build
npm run icons     # regenerate PWA icons (output is committed)
```

Zero runtime dependencies; dev deps are vite, typescript, vitest only.

## Project docs

- `docs/PROGRESS.md` — current state, decision log, slice tracker
- `docs/GAME_SPEC.md` — the authoritative design/technical spec
- `docs/BUILD_PROMPT.md` — the build prompt for the current slice
- GitHub issues #1–#7 — per-slice checklists (issue #1 is this slice)

## Architecture notes

- `src/sim/**` — deterministic simulation. Metres/seconds only, seeded
  `mulberry32` randomness only (`Math.random`/`Date.now` banned by a test),
  fixed 60 Hz timestep. IDM car following where red lights, stop lines and
  downstream queue tails are all "phantom leaders". Signal phase is derived
  from `(simTime + offset) % cycleLength`, never stored. Spillback rule: no
  car enters an intersection box without room on the far side.
- `src/render/**` — camera (the only metre→pixel boundary) and two canvas
  layers: static (roads; redrawn on camera change) and dynamic (cars, signal
  heads; every frame, interpolated).
- `src/ui/**` — DOM HUD, gesture input, signal editor bottom sheet.
- `tests/**` — runs headless via `runHeadless()`; no browser needed.
