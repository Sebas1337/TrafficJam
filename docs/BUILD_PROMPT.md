# TrafficJam — Build Prompt (Slice 1)

The project ships in incremental slices (spec §15). Each slice gets its own
prompt; this is the first. Paste the block below into a fresh agent session in
this repository.

---

## The prompt

> Build **slice 1** of *TrafficJam*, a mobile-first traffic management game, in
> this repository.
>
> Read `docs/PROGRESS.md` first to see current state, then `docs/GAME_SPEC.md` in
> full before writing any code — the spec is authoritative and defines the
> constants, data model, algorithms, and tests. This prompt is the summary and
> the scope boundary.
>
> **Update `docs/PROGRESS.md` as you go** — tick items as they are genuinely
> done, keep the current-state table accurate, and log any design decisions you
> make. The next slice is built in a fresh session that knows only what that file
> says.
>
> ### Slice 1 is "Time the lights"
> The map is generated and already signalised. **The entire game is retiming
> those signals to keep traffic moving.** That is a complete game and it is all
> you are building this session.
>
> **In scope:** Vite + TypeScript scaffold · fixed-timestep sim loop · layered
> canvas with pan/zoom · seeded map generation with 3 portals (A/B/C) ·
> Dijkstra routing with turn penalties · IDM car following · signalised
> intersections · **spillback** · tap-a-signal timing editor (cycle length,
> split, offset) · escalating demand · throughput readout · frustration meter
> and game-over · pause and 1×/2×/4× speed · installable PWA deployed to GitHub
> Pages · tests 1–6 from spec §14.
>
> **Explicitly out of scope — do not build these:** road drawing, currency or
> costs, corridor linking, the time–space diagram, stop signs, roundabouts, turn
> lanes, lane changing, campaign levels, save/load. They are slices 2–7. If you
> finish early, improve polish and performance inside this scope rather than
> starting the next slice.
>
> ### Stack
> TypeScript (`strict`), Vite, HTML Canvas 2D with separate static and dynamic
> layers, plain DOM/CSS for UI panels. **No game engine, no UI framework, zero
> runtime dependencies.** Dev deps limited to vite, typescript, vitest.
>
> ### The five things that must be right
> 1. **IDM car following with the phantom-leader trick** — a red light, a stop
>    line, and a downstream queue tail are all expressed as a virtual stopped
>    leader, so one equation drives every situation (spec §7.2). A car's
>    acceleration is the minimum over all active constraints.
> 2. **Spillback** — a car may not enter an intersection box unless the target
>    lane beyond it has room. This is what makes gridlock emergent, it is why
>    timing matters, and it is roughly 20 lines. Without it slice 1 is a
>    screensaver rather than a game. Do not defer it.
> 3. **Derived signal phase** — never store the current phase. Compute it as
>    `(simTime + offset) % cycleLength`. This keeps coordination stateless and
>    makes slice 2 nearly free.
> 4. **Determinism** — seeded `mulberry32`, fixed 60 Hz timestep with an
>    accumulator, render interpolation. `Math.random` and `Date.now` banned from
>    `src/sim/**`; enforce with a lint rule.
> 5. **Deployment in this slice, not later** — the point is playing it on a
>    phone. A build that only runs on localhost is not a deliverable.
>
> ### Mobile UX for this slice
> Portrait-first. Top strip: throughput, frustration meter, clock, speed
> controls. Tapping an intersection opens a bottom sheet with cycle/split/offset
> sliders and a live preview of the phase. Pan and pinch-zoom always available
> and never in conflict with taps. **Full editing while paused.** Touch targets
> ≥ 44 px, with a tap radius on intersections generously larger than the drawn
> marker. Respect safe-area insets.
>
> ### Build order — keep it runnable at every step
> 1. Scaffold, constants, seeded RNG, fixed-timestep loop, canvas layers,
>    pan/zoom. Deploy this to GitHub Pages immediately, even showing nothing —
>    get the pipeline working while it is trivial.
> 2. Network data model and map generator with validation (§6). Render roads and
>    portal labels.
> 3. Routing and car spawning at portals.
> 4. IDM movement along lanes and through turn connections. **Add the collision
>    invariant test here and keep it green from this point forward.**
> 5. Signals: phase derivation, rendering signal heads, stop-line phantoms.
> 6. **Spillback.**
> 7. The signal timing editor UI.
> 8. Demand ramp, metrics, frustration meter, game over, restart.
> 9. PWA manifest and service worker, offline play, performance pass.
>
> ### Definition of done
> On a real phone: install to homescreen, start a run offline, watch cars drive
> A→B→C, tap a signal, change its split and offset, **see the throughput number
> respond**, let the map gridlock, and lose. 60 fps with 150 cars. Tests 1–6 from
> spec §14 green. `README.md` documents how to run, test, and deploy.
>
> Commit in logical increments with clear messages. Work on the branch
> `claude/traffic-game-prompt-design-332qd1` and push when slice 1 is playable.
> If you hit a design fork the spec does not settle, pick the option that best
> serves the pillars in §2, log it in the `docs/PROGRESS.md` decision log, and
> keep moving — do not stall, and do not expand scope to resolve it.
>
> Finish by updating `docs/PROGRESS.md`: tick what is genuinely verified, set the
> current-state table, and record anything left broken under "Known issues".

---

## Notes on why the prompt is shaped this way

- **The out-of-scope list is as long as the in-scope list.** With an agent
  building autonomously, naming what *not* to build is what actually holds a
  slice boundary. "Build slice 1" alone reliably produces slice 1 plus half of
  slices 2 and 3, none of it finished.
- **It names the traps, not just the features.** Spillback, derived phase, and
  phantom leaders are the three things most likely to be skipped or implemented
  badly, and each is load-bearing. Four lines here saves a rewrite.
- **Deploy is step 1.** Getting GitHub Pages working while the app renders
  nothing takes ten minutes; getting it working at the end of a long session,
  around a finished game, never does.
- **The collision invariant arrives at step 4, not step 9.** A sim that silently
  lets cars overlap will look plausible and be wrong.
- **Done is defined by an observable player action** — "see the throughput number
  respond when you change the split." Not "signal timing is implemented." The
  first is testable by a human in ten seconds; the second is a claim.
