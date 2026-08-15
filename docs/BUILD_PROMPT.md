# TrafficJam — Build Prompt

Paste the block below into a fresh agent session in this repository. It is
self-contained enough to start from, and points at `docs/GAME_SPEC.md` for the
detail it deliberately omits.

---

## The prompt

> Build **TrafficJam**, a mobile-first traffic management game, in this repository.
> Read `docs/GAME_SPEC.md` in full before writing any code — it is the
> authoritative specification and defines constants, data model, algorithms, and
> acceptance criteria. This prompt is the summary and the marching orders.
>
> **Scope for this session: Milestone 1 only** (§15 of the spec). M1 is defined
> to be independently shippable — a complete, playable game. Do not begin any
> M2/M3 feature until every M1 acceptance criterion passes. If you find yourself
> running short, cut polish, never cut the test suite or the spillback rule.
>
> ### What it is
> Top-down view of a randomly generated town. Cars spawn at 3–6 labelled
> entry/exit portals (A, B, C…) and each drives to a different portal. Demand
> ramps up over time. The player keeps traffic flowing by building roads,
> upgrading intersections, placing traffic signals, and — the core mechanic —
> **coordinating signal timing into green waves** via a time–space diagram.
>
> ### Stack
> TypeScript (`strict`), Vite, HTML Canvas 2D with a layered static/dynamic
> setup, plain DOM/CSS for UI panels. **No game engine, no UI framework, zero
> runtime dependencies.** Dev deps limited to vite, typescript, vitest. Ship as
> an installable PWA (manifest + service worker, offline-capable), statically
> hostable on GitHub Pages.
>
> ### Non-negotiable mechanics
> 1. **IDM car following** with the phantom-leader trick — red lights, stop
>    lines, yield decisions, and downstream queue tails are all expressed as a
>    virtual stopped leader, so one equation drives everything (spec §7.2).
> 2. **Spillback**: a car may not enter an intersection box unless there is room
>    for it on the far side. This is what makes gridlock emergent. It is the most
>    important rule in the game — do not defer it.
> 3. **Derived signal phase**: never store the current phase. Compute it as
>    `(simTime + offset) % cycleLength`. This makes coordination stateless and
>    trivially testable.
> 4. **Corridors and the time–space diagram**: the player links signals into a
>    corridor and tunes offsets on a full-screen time–space diagram with green
>    bands and a progression line, by direct manipulation. This is the game's
>    identity — give it real design effort, and prototype it early rather than
>    leaving it to the end.
> 5. **Determinism**: seeded `mulberry32` PRNG, fixed 60 Hz timestep with an
>    accumulator, render interpolation. `Math.random` and `Date.now` are banned
>    from `src/sim/**` — enforce with a lint rule.
>
> ### Mobile UX requirements
> Portrait-first. Bottom tool bar within thumb reach. Pan/pinch always available
> and never in conflict with tool actions. **Full editing while paused.** An undo
> stack at least 20 deep. Touch targets ≥ 44 px. Long-press to confirm anything
> destructive. Safe-area insets respected. A congestion heatmap toggle, because
> the player must always be able to see *why* traffic is stuck.
>
> ### Build order
> Work in this sequence, keeping the game runnable at every step:
> 1. Project scaffold, constants, seeded RNG, fixed-timestep loop, canvas layers,
>    pan/zoom.
> 2. Network data model + map generator with validation (§6). Render roads.
> 3. Routing (Dijkstra with turn penalties) and car spawning at portals.
> 4. IDM movement along lanes and through turn connections. **Add the collision
>    invariant test here and keep it green from this point on.**
> 5. Intersections: signals, stop control, gap acceptance — then **spillback**.
> 6. Player tools: inspect, build road, upgrade, demolish, with undo and costs.
> 7. Signal editing (cycle/split/offset), then corridors, then the time–space
>    diagram.
> 8. Economy, metrics, frustration meter, fail state, endless demand ramp.
> 9. Heatmap and diagnostics.
> 10. Save/load, PWA, GitHub Pages config.
> 11. Full test suite (§14), performance pass at 300 cars.
>
> ### Testing
> Build the headless simulation harness early — `runHeadless(network, demand,
> seconds)` returning metrics with no rendering. All seven required tests in
> spec §14 must pass, in particular: the collision invariant, generator
> soundness over 1000 seeds, and the **green wave test** proving that correctly
> offset signals measurably reduce mean delay versus zero offsets. That last one
> is what proves the core mechanic actually works rather than merely existing.
>
> ### Definition of done
> On a real phone: install to homescreen, start an endless run offline, watch
> cars flow A→B→C, build a road, place a signal, link two signals into a
> corridor, fix the offset and *see throughput measurably improve*, then jam the
> map and lose. 60 fps with 300 cars. All tests green. `README.md` documents how
> to run, test, and deploy.
>
> Commit in logical increments as you go with clear messages. Work on the
> branch `claude/traffic-game-prompt-design-332qd1` and push when M1 is complete.
> If you hit a genuine design fork the spec does not settle, choose the option
> that best serves the design pillars in §2, note the decision in the README,
> and keep moving — do not stall.

---

## Notes on why the prompt is shaped this way

- **It names the traps, not just the features.** Spillback, derived phase, and
  the phantom-leader trick are the three things an agent is most likely to
  implement badly or skip, and each is load-bearing. Calling them out by name
  costs four lines and saves a rewrite.
- **The build order keeps the thing runnable.** Every step ends with something
  you can look at on a phone, which is what makes a long autonomous run
  recoverable if it drifts.
- **The collision invariant is introduced at step 4, not step 11.** A sim that
  silently lets cars overlap will look fine and be wrong; catching that early is
  worth more than any other single test.
- **The green wave test is the acceptance criterion for the core mechanic.**
  It's the difference between shipping a feature and shipping a *game about*
  that feature.
- **M1 is scoped to be shippable alone.** The most likely failure mode for a
  one-shot build of this size is 60% of six systems and nothing playable.
