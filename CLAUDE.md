# CLAUDE.md — Birb Mobile

> **2026-09-10 realism research and executive direction:**
> [docs/realism/README.md](docs/realism/README.md) is the next-phase decision
> record, reviewed against main `f3f7c17`. Build the ambitious forest-river
> reference slice with a rebuilt bird, coherent surfaces/light and reversible
> profiles, then qualify it on the owner's **iPhone 16 Pro / Chrome
> 152.0.7977.64**. Root-game authored assets and selective visual rebuilds are
> approved in that plan; sibling-app contracts are unchanged. The existing
> performance contract/oracles remain binding unless explicitly amended.
> The profile JSON is a proposal, not a current runtime import. No phone
> performance or thermal certification is claimed by the research package.

> **THE BIRD FLIES LIKE A STUNT PLANE NOW, AND IT IS THE DEFAULT**
> (2026-09-19): [docs/realism/STUNT_FLIGHT_PLAN.md](docs/realism/STUNT_FLIGHT_PLAN.md)
> is the design, [docs/perf/gates/G-STUNT-0.md](docs/perf/gates/G-STUNT-0.md)
> is what shipped and what was measured. The owner called the triggered rolls
> "weird triggered animation" and asked for a total rewrite.
> `src/flight/bird-flight-stunt.js` extends `BirdFlight` (so parallel
> transport and the carve-down floor keep ONE definition): stick x is a **roll
> rate** with cubic expo, stick y is an **unlimited pitch rate**, and the
> BOOST pill is a **pad** — tap to boost exactly as before, drag for rudder
> (about the BIRD'S OWN up, which is what a rudder is) and throttle.
> **Nothing turns the bird except the lift vector**; there is no auto-yaw from
> bank, which is the one omission that separates this from v2 and the reason a
> knife edge can hold a heading at all. `src/flight/aerobatics.js` and its
> test are DELETED; `?flight=v2` still reaches the bank-to-turn experiment.
>
> **`assist` aside, the whole feel comes from four terms, and three of them
> exist because the first version measured wrong.**
>
> **The hammerhead was unreachable until the trim became aerodynamic.**
> Hands-off, the pitch trim dragged the nose back to the horizon at a flat
> 0.5 rad/s whatever the airspeed, so the bird was always level again before
> the energy model could bleed it below stall: measured, the speed bottomed at
> **6.30 against a 5.5 stall** and the wing never stopped flying. Scaling both
> idle stabilisers by AUTHORITY (`clamp(speed/cruise, 0.35, 1.2)`) and lifting
> `gSpeed` to 7.5 takes it to **4.45 at full power and 3.85 at idle throttle**.
> That one change IS the hammerhead — pull to the vertical, let go, and the
> terms do it, with no move list, no trigger and no dwell. **A stabiliser that
> works at any airspeed is an autopilot, not a wing.**
>
> **The v70 pure-rate refutation is answered without a rail.** G-FLIGHT-V2
> measured that a LINEAR roll rate rolls the bird onto its back at the raw
> 0.6-0.8 an ordinary hard turn reads on this stick. Three terms answer it and
> none is a mode boundary: cubic expo (half stick is 34% of the rate);
> righting that runs **only with the whole stick idle**, so a bank you put in
> stays in (v70 scaled it by `1 - |x|`, so every intermediate bank decayed
> under the thumb and the only cure was more stick); and a roll rate that
> eases under pull, which turns a diagonal stick from a corkscrew into a
> banked turn. v2's 0.97 rail is gone — it was a hidden mode boundary only a
> thumb pressed to the plastic ever reached.
>
> **A half-loop check that CONSUMED the accumulator made a full loop
> undetectable forever.** The trick detector (`src/flight/stunt-detector.js`,
> which names the figure after the fact because nothing decides in advance any
> more) tested for a half turn before a full one and zeroed at PI — and a loop
> necessarily passes through PI on its way to 2PI. Full turns fire on
> completion and reset while the axis keeps running; half turns are classified
> only once the axis has been quiet, which is what the end of a figure
> actually looks like. It reads the controller's own **rotation deltas**, never
> bank and pitch angles: both of those have singularities exactly where the
> interesting figures live.
>
> **`classic` had no pitch clamp, and only the live page could see it.** The
> constructor set `maxPitch = PI` unconditionally, so the Classic toggle ran
> v1's `update()` against a ceiling that was not there — a bird that CAN loop
> under classic looks like a bird flying normally until somebody loops it. The
> unit suite and the eye both missed it; `tools/birb-stunt.mjs` caught it by
> reading the probe after a live switch. **The ceiling belongs to the law, not
> to the object.**
>
> **Lift and sink are what make a knife edge a manoeuvre rather than a pose.**
> `lift = (speed/cruise)^2 * (bodyUp . up)` — 1 level at cruise, zero in a
> knife edge, NEGATIVE inverted — and `sink = gSink * (1 - lift)` applied to
> POSITION along the negative radial, never to the orientation. That gap
> between where the bird looks and where it goes is the whole thing. It cannot
> break the gravity-less-floor invariant because it only ever pushes DOWN, and
> there is a test that proves it rather than asserting it. Note the knock-on:
> the stunt bird SINKS, so a harness that flies it near the ground lands it —
> the first run of `tools/birb-stunt.mjs` had six checks fail for reasons that
> had nothing to do with what they tested, because one silent landing zeroed
> the stick and released the camera hold.
>
> **The frozen harnesses are pinned to `&flight=classic`** (gate decision in
> G-STUNT-0, the same precedent as `&quality=amazing` under R5): `birb-walk`,
> `birb-modes` and `birb-quality` were all written against v1's flight
> behaviour. `tools/birb-stunt.mjs` is the one that boots with **no flight
> flag**, because its first assertion is that the PRODUCTION DEFAULT is the
> stunt model — a harness passing `?flight=stunt` would still pass on a build
> whose default had silently reverted. Also: the tracked `node_modules/three/index.js`
> stub gained `Vector3.add`, `cross` and `distanceTo`, which real three has
> always had.
>
> **Still unmeasured: the phone.** Every number above is the unit suite or
> SwiftShader. Classic is two taps away in the gear menu, which is what makes
> a default nobody has flown on glass an acceptable one.

> **AND THEN IT STALLED TOO MUCH TO BE FUN — both causes were the tuning**
> (2026-09-19, later): [docs/perf/gates/G-STUNT-1.md](docs/perf/gates/G-STUNT-1.md).
> The owner, flying the shipped build: *"it stalls way too much when trying to
> fly up and it's no longer a fun relaxing experience."*
>
> **`gSpeed` was raised to 7.5 to make ONE figure reachable and it broke
> ordinary flight.** With a linear `sin(pitch)` bleed, a 45-degree climb
> settles at **5.11 against a 5.5 stall** — so the wing stopped flying on a
> climb anybody makes without thinking. The hammerhead needed a vertical to
> fall below stall; the way to get one is SHAPE, not magnitude. The climb half
> of the term is **cubed** now (`climbExp` 3.0, dives stay linear, `gSpeed`
> 6.5): a 45-degree climb settles at 8.45 and only past about 70 degrees does
> the wing stop. **A global parameter tuned against a stunt is a parameter
> tuned against the wrong thing.**
>
> **The subtler half: a pure RATE has no resting point.** Held for ten
> seconds, stick 0.3 up took the bird to 90 degrees and stalled it, and stick
> 0.3 sideways rolled a full 365 degrees and shed 34 units of altitude — so a
> lazy turn was a slow barrel roll. Both axes now carry a **saturating
> stability term**: beyond a comfort angle the bird is pushed back toward it
> at a rate CLAMPED so a firm input still wins. Held angles — 0.3 stick is 38
> degrees of climb / 24 of bank, 0.7 is 59 / 66, 0.85+ loops or rolls. **This
> is not v2's rail**: v2 switched mode at a hard 0.97 threshold, this is a
> saturation that is continuous in the stick, and it is what an elevator
> overpowering an aircraft's own stability actually does. Both terms switch
> off once the bird is committed (past the vertical, past `rightingLimit`), so
> a loop still closes and inverted flight is still holdable. **The bank
> ceiling is 91 degrees deliberately — a knife edge has to be a bank you can
> HOLD, or it is not a manoeuvre.** The first value capped it at 72 and the
> knife edge silently became unreachable; a probe caught that, no test did.
>
> **Everything sank all the time**, too: with no deadband, a bird at 90% of
> cruise sank 0.76 units/s and a 30-degree bank sank 0.54, so relaxed flight
> nagged at the player's altitude for no manoeuvre they would call one.
> `sinkSlack` 0.15 makes gentle attitudes free and leaves the knife edge at
> 3.4 and inverted at 8.
>
> **The hammerhead is now flown with the THROTTLE BACK**, which is how one is
> actually flown and is what the pad exists for: full power 5.67 (no stall),
> idle 3.85 (stalls). A hard pull at full power is a CLIMB, and there is a
> test that says so.
>
> Ten seconds of relaxed flight, measured: hands-off holds altitude exactly, a
> gentle climb gains 46 units, a gentle turn holds 24 degrees of bank and
> loses nothing. Before, the same turn lost 34 and the same climb stalled.
> `tests/bird-flight-stunt.test.js` gained a **relaxed flight** section at
> both sites that any future climb-penalty raise has to fail first; seven
> older checks were rewritten because they encoded the old law's inputs, two
> of them made tuning-independent on the way (the roll measures SWEPT angle
> from the controller's own deltas, not the bank at a fixed second).

> **AN ELEVATOR DOES NOT ROLL YOU — and until 2026-09-20 it did**:
> [docs/perf/gates/G-STUNT-3.md](docs/perf/gates/G-STUNT-3.md). *"I still
> can't seem to even just fly direction on that knife edge — I want to roll 90
> degrees then pull back to hard bank along the horizon."* G-STUNT-2 made a
> RELEASED knife edge hold, and it does; this is the half that breaks the
> moment the player pulls.
>
> **`_pitchBy` rotates about the BIRD'S OWN X axis, which is the local radial
> only when the nose is exactly on the horizon.** Off by a few degrees and the
> bird rotates about a tilted axis — it CONES, and the bank sweeps by exactly
> TWICE the offset: 2° off swings it 4.1°, 6° swings 12.0°, **11° swings 22.0°
> — from −79 to −101, i.e. through the knife edge and out the far side into
> inverted**, where lift goes negative and the sink jumps 3.4 → 4.8. On the
> live page the bank and pitch traced a clean out-of-phase sinusoid pair,
> which is the signature of a body coning about a fixed tilted axis. **And a
> thumb cannot deliver 0°**, which is why this read as "I can't fly a
> direction" rather than as a tuning note.
>
> **Nothing resisted it because every stabiliser is gated off exactly there**:
> `_bankSoftStep` lives inside `if (sx)` (needs a roll input), `_rightingStep`
> needs the whole stick idle, `_pitchSoftStep` needs an upright bird. Rolling
> hard and then pulling satisfies none of the three.
>
> `_flatTurnStep` samples the bank before the pitch command and rolls back out
> whatever the elevator moved — swing **0.0° at every offset from 0 to 20°**.
> It cannot fight the player, because the roll command is applied earlier in
> `tick` and is outside the measurement. **Faded to nothing between 55° and
> 80° of pitch, and that is load-bearing**: bank is degenerate when the nose
> points at the sky (it jumps by 180° as the pitch passes 90°), and a loop, a
> hammerhead and the stall all pass through there.
>
> **A load factor was built, measured and REFUTED.** `lift × (1 + gLoad·|pull|)`
> is real aerodynamics and looked like the other half of "along the horizon";
> over a 6 s turn it moved altitude +19 → +26 at 60° of bank and **−19 → −19
> at 88°** (zero by construction — the cosine is zero at any G), while the
> speed the climb bleeds cancelled most of the rest. Removed. **The coning was
> the whole bug, and a change whose effect is inside its own noise is not a
> fix.** The turn already holds height where it should: 75° of bank at a
> 0.3–0.5 pull sweeps 135–201° in six seconds for +2 to +11 units.

> **A knife edge you let go of stays on the wing** (2026-09-19):
> [docs/perf/gates/G-STUNT-2.md](docs/perf/gates/G-STUNT-2.md). *"If I roll
> 90 degrees left then put the stick in neutral, I should stay pitched
> sideways, then pulling back should have me basically turning around to
> that side."* The idle righting ran for any bank under 120°, so a released
> knife edge rolled itself level (measured **‑89.6° → ‑1.2° in 3 s**) and the
> pull that should have been a flat turn went nose-up 14°. It **fades to zero
> between 35° and 55°** now (`rightingBand` / `rightingFade`, continuous, not
> a rail): a lazy tilt still tidies itself, and any bank past that is held
> hands-off at any angle — the same knife edge reads **‑89.6° → ‑89.6°**, and
> a half-stick pull on it swings the heading 44° with the pitch at 0.3°.
> Inverted-then-pull-to-dive already worked (`rightingLimit`) and has a test
> now. Three tests were ADDED to the frozen stunt suite under that gate,
> none weakened.

> **Cockpit view is a setting, and it deliberately does NOT use the FPV rig
> that was already there** (2026-09-19). *"Add a setting for fpv v 3rd."*
> Chase cam / Cockpit is a gear-menu toggle persisted to `birbCameraView`,
> with `?camera=fpv|chase` for a one-off boot (not persisted) and
> `__BIRB.setCameraView()` / `__BIRB.cameraView()` for harnesses.
>
> **`cameraState`'s FPV rig levels its roll against WORLD +Y**, which is
> correct within sight of the north pole and progressively wrong everywhere
> else on a planet — the same class of bug as the walk bob writing
> `position.y`, and the turret branch's own comment already says so, which is
> why the turret does not use it either. Flight FPV therefore places the
> camera at the bird wearing the **bird's own quaternion**, so the horizon
> rolls with the aircraft anywhere on the sphere. The decisive measurement is
> in `tools/birb-stunt.mjs`: in a held bank the camera's up sits **58.7
> degrees off the local radial against 58.7 degrees of bank** — equal to a
> tenth of a degree. A rig that levelled itself would read near zero there and
> would otherwise look completely plausible in a still.
>
> The bird model is hidden in cockpit view through the same
> `syncAvatarVisibility` the perch uses (`birbAnchor.visible`), so the two
> cannot disagree, and the toggle is blocked while nested — the nest already
> owns the camera, and the turret is an FPV of its own.

> **The pitch axis pulls back for nose up** (2026-09-19, later still): *"let's
> have the up down on the stick be reversed so it's like an actual plane
> stick."* A control column is not a direction pad — pulling it toward you
> raises the nose, because it moves an elevator and not the horizon — and on a
> thumbstick "toward you" is DOWN. `?pitchinvert=0` restores the direct sense
> and it is a switch on the Flags tab. **Inverted INSIDE the controller, never
> at the input pipeline**: `inputState.y` is also how the bird walks backwards
> on the ground, how the turret aims while nested, and what the classic model
> pitches with, so negating it upstream would have reversed all three. Two
> follow-ons that would each have read as a bug: `bird-visual.js` tilts the
> model by `input.y`, so it is handed `pitchSign` or a pull-up lifts the bird
> while tipping its beak down; and the unit suite asks for a `pull` or a
> `push` **by intent rather than by sign**, so flipping the default cannot
> quietly turn the loop check into a dive check that still passes.
> `tools/birb-stunt.mjs` READS the sign off the probe and asserts the shipping
> value, rather than assuming either.

> **"Hitting start doesn't start" — and the shape of the page makes that the
> DEFAULT failure** (2026-09-19). Not reproduced in the build: production
> served the right `BIRB_BUILD`, all three new modules returned 200, the
> no-flag boot was clean with zero console errors, and `birb-default`,
> `birb-stunt` and 924 unit tests were green. What the hunt DID find is
> structural and worth more than the incident.
>
> **Tap-to-Start is wired at index.html:3222. `startGameLoop` is assigned at
> 14069.** So the button goes live near the START of the module script and
> the thing it calls only exists at the END of it — and `startGame()` already
> has a "scene still loading" branch that disables the button and writes
> **Loading…**. Put together: ANY throw in the eleven thousand lines between
> those two points — most plausibly a dynamic `import()` a stale service
> worker cannot serve — leaves a live button that says Loading… forever, with
> nothing on screen to say why, and a reload lands on the same worker and
> does it again. **A dead module script does not look like a crash here; it
> looks like a game that is still loading.**
>
> Hence the **boot watchdog**, a CLASSIC script above the module one (same
> reasoning as the service-worker auto-reload: a dead module must not be able
> to stop it). The module calls `window.__birbBootOk()` on the line above the
> `startGameLoop` assignment — the right anchor, because that assignment
> existing IS what Tap-to-Start needs. If it never arrives, a banner offers
> one tap that unregisters every worker, deletes every cache and reloads with
> a cache-busting query. **Two timers, not one**: at 25 s it shows only if
> something actually threw (a failed import sets `reason`), and a 60 s
> backstop covers a silent hang — because showing "did not load" over a game
> that is merely loading on a cold cache is its own bug. Verified by serving
> a 404 for `bird-flight-stunt.js`, which is exactly what a stale worker with
> no copy of a new module produces: banner appears unprompted, names the
> failed import, and one tap comes back booted.

> **2026-09-06 visual/nesting update:** Read
> [docs/VISUAL_UPGRADE_BRIEF.md](docs/VISUAL_UPGRADE_BRIEF.md) for the standalone
> direction, implementation map, mobile constraints and unfinished roadmap.
> It supersedes older notes below about hiding all props while nested and
> deliberately placing nests at fractional heights inside champion structures.
> Nesting now preserves scenery; perches occupy actual modest-height crowns/roofs.
> That plan was then executed: see
> [docs/VISUAL_UPGRADE_BUILD_PLAN.md](docs/VISUAL_UPGRADE_BUILD_PLAN.md) §13 for
> what shipped and what did not. Two things there matter most for future work.
> **The root game now has a capture harness** — `node tools/birb-shot.mjs
> --start --out shot.png` for one frame and `node tools/birb-sheet.mjs --out
> sheet.png` for all four biomes in flight and perch views. Both need
> `npm install --no-save playwright https-proxy-agent` (in ONE command; a
> second `--no-save` install prunes the first) followed by `git checkout --
> node_modules/three/index.js`. **Spatial instance sectors were measured and
> rejected** — draw calls rose past the 100 budget for a 17-22% triangle
> saving, because this world's props are deliberately scattered evenly and
> sector culling only rejects the far hemisphere. Do not rebuild it blind.
> The perch camera rests at a horizon-derived pitch, not level: on a
> radius-120 planet a 40-unit crown puts the horizon 41 degrees below level,
> and every nest in every biome used to open on empty sky.
>
> **Adaptive quality now actually runs.** It never had: the FPS sampler sat
> behind `if (!fpsMetric) return;` and `[data-metric="fps"]` is not in the
> document, so the tier manager's only call site was unreachable and DPR never
> dropped on a struggling phone. The thresholds (55 to downshift, 58 to
> restore) were tuned against a system that could not run, so a device may now
> shed resolution where it never did — watch for that before assuming a
> regression. `tools/birb-sheet.mjs` pins tier 0 so art review is not done
> against degraded output.
>
> **A rendering world is not a working world**, and this repo has now proved
> it the expensive way. Initial environment setup catches its own exception
> and only `console.warn`s, so a throw part way through it leaves the terrain
> built and looking completely normal while nest points, collectibles and
> rocket collision targets were never created. That shipped to production on
> 2026-09-06 and no check caught it: unit tests do not load `index.html`, the
> screenshot harness exited zero because a frame rendered, and the contact
> sheet switches environment first, which re-runs the failed setup
> successfully. Hence `.github/workflows/browser-health.yml`, which runs the
> real page on every push and asserts the systems exist on the plain-start
> path, plus `tools/birb-modes.mjs`, which drives all five modes and treats
> console **warnings** as failures. Never add a check that only proves
> something painted.
>
> **Sixth pass shipped: water, weather, light shafts — and a bloom pass that
> had never run.** See `docs/VISUAL_UPGRADE_BUILD_PLAN.md` §16. Four things
> from it are worth knowing before touching any of this.
>
> **Bloom was gated off on every iPhone ever made.** `isLowEnd = isMobile &&
> (navigator.hardwareConcurrency || 4) <= 4`, and iOS Safari does not expose
> `hardwareConcurrency` at all — `undefined || 4` is 4. The post-processing
> pass written for this game had never once executed on the device the game is
> built for, and every capture taken while tuning it was taken with it off.
> Shedding is the adaptive tier's job now. Separately, the composite was
> missing `#include <colorspace_fragment>`, so the whole game rendered dark
> whenever the pass ran: mean pixel 90 against 146 for the same frame with
> bloom off. **A feature gated on a capability probe is not shipped until you
> have proof the probe returns what you think it does.**
>
> **Saturated colours cannot cross a luminance threshold by getting brighter.**
> The bright pass thresholds the TONE-MAPPED frame and Neutral tone mapping
> preserves hue, so a forest ring at three times its brightness still lands at
> 0.79 against a 0.78 knee and contributes nothing. Lifting it toward white as
> well as up is what works — and is what a real emissive does. Same reason the
> sun disc is now HDR and about five times its real angular size.
>
> **Water floods from the SMOOTH continental field, never the full terrain.**
> The detail noise has features about twenty units across and the ground mesh
> is 96x64 on mobile; flood from the full field and most "lakes" are noise
> pits the mesh never resolved, so the ground draws over its own water. That
> shipped first and looked exactly like water that failed to render — as did
> the separate bug where the quad winding was reversed and `FrontSide` culled
> every lake. Diagnose this class by swapping the material for flat magenta
> with `depthTest: false`: it separates "never rasterised" from "drew and lost
> the depth test", which staring at the render cannot. Water is also a FLOOR
> (`terrainFloorDir` maxes against sea level, which is negative, so the
> gravity-less-floor invariant holds).
>
> **`tools/birb-modes.mjs` printed "all 5 modes ok" on a run that was exiting
> 1.** The console was full of `useProgram: program not valid` from a shader
> that would not compile; the summary line only consulted the per-mode checks.
> A log whose tail says "ok" on a failing run is worse than no log. Fixed —
> and note the same trap in reverse: `renderer.info.render` resets on every
> `render()` call, so with bloom on the whole world reported as one draw call
> and one triangle until `stats()` started reading the pass's own snapshot.
>
> New debug hooks (all `?debug=1`): `setBloom({view:1})` renders the bright
> buffer so you can see what actually crosses the knee; `terrainHistogram()`,
> `goToWater()`, `faceSun()`, `waterFlag()`, `water()`, `weather()`.
> `tools/birb-shot.mjs --after` runs JS after the settle, so a pose it sets is
> the pose photographed.

> **Seventh pass: the ground got a legibility pass, and a prop turned out to be
> a flying doughnut** (§17). Started from a fresh contact sheet, not the
> roadmap, and the sheet settled it: the city — the one biome that had had a
> legibility pass — was the best frame on it and the other three were a flat
> colour each. `src/environment/ground-detail.js` gives each biome procedural
> ground at zero draw calls. **The geometric normal is free and it is the whole
> trick**: `normalize(cross(dFdx(P), dFdy(P)))` is the FACET normal, which
> suits flat-shaded low-poly terrain exactly, and snow-on-flats/rock-on-faces
> turned the mountain from a uniform pale mass into a ridge with form using a
> term that has no noise in it at all. Two traps recorded there: **the canyon
> strata had to band the GROUND, not just the walls** (banding by radius is
> right, but a canyon floor's radius barely changes across a view, so not one
> band ever appeared on it), and the first tints were about 0.1 apart per
> channel — measurably present, visually absent.
>
> **The canyons' "arches" were complete tori laid flat and floating 10-25 units
> in the sky**, scaled to sixteen units across, with nothing holding them up.
> An arch is a HALF torus on its own two feet; colliders belong on the LEGS
> (one at the centre makes an arch a wall with a picture of a hole on it) and
> the perch on the crown. `__BIRB.goToProp(name, i, back, lift)` exists because
> of this — nine arches on a planet are pure luck to have in frame, and **a
> prop you cannot reliably photograph is a prop nobody reviews.**
>
> **Wingtip ribbons** (`src/effects/ribbon-trail.js`) on boost and hard bank.
> Camera-facing, because a band in a fixed plane of the bird is invisible
> edge-on. **A trail's length must be bounded by ARC LENGTH**: fading by buffer
> position makes it (points x per-frame travel), which is 5 units at 60fps and
> 70 in a 2fps harness, and fading by age does not rescue it because `update`
> clamps delta to 50ms to survive a stall. Its tier gate is `< 2` deliberately:
> two draw calls is not what a struggling phone is struggling with, and a
> feature gated so tightly the shipping device never satisfies it does not
> ship. New capture hooks: `__BIRB.boost(on)`, `__BIRB.goToProp()`.
>
> **The slalom's tunnel came out** (§16.17). **The whole Run came out on
> 2026-09-13 — see the inside-out-bird note below — so this is history, not a
> map of the code. The transferable lessons still hold for any course built
> on this sphere.** It was a seven-unit lane walled by
> trees, roofed with arch ribs, wrapped in a backdrop tube and signed three ways
> — six systems competing for the same seven units against a two-unit bird — and
> the tell had been sitting in the tooling for a session: `goToSlalom` needed a
> `lift` argument because a camera at the player's own altitude sat INSIDE the
> wall. That is not a framing bug, it is the course reporting it has no room in
> it. It is an open aerial run now. Four numbers matter and each was found by a
> capture. **Gate spacing and swing must both beat the gate DIAMETER** — at 4-6
> units apart against a 12.8-unit ring the gates render as a tangle, and swung
> ±6.5 they nest concentrically looking down the course and the weave vanishes.
> **Anchor the course to the SPHERE, not the ground**: the terrain carves down
> 46 units while the gravity-less bird holds a near-constant altitude, so
> `groundR + 15` plunges out of the flight band into valleys — and into the
> canopy of trees rooted on the rim above them. **Forest trees are 14-58 units
> tall**, so a course under ~30 has conifers standing inside its gates. And **a
> marker fence is the tunnel again at a wider radius** — thirty pylons became
> one beacon per gate.
>
> **The biomes got a legibility pass** (§16.13). The city shipped as grey
> boxes in a field; it now has procedural lit windows and a street grid with
> lamps, both derived from the fragment's own position — no geometry, no
> texture, no draw calls — plus dusk lighting, because a lit window only reads
> against a dark street. The canyons have sedimentary strata banded by RADIUS
> so the layers stay level on every wall. The flock is a loose skein of birds
> that sweeps across the direction the player is FACING; anchored to a fixed
> bearing instead, a tight group is inside a portrait phone's field of view
> about nine per cent of the time.
>
> **`tools/birb-shaders.mjs` runs in CI and is the guard that matters here.**
> A shader that fails to compile does not render wrong — Three logs the error
> and draws NOTHING for that material, so the page still paints and the
> screenshot harness still exits zero. Two whole systems shipped invisible
> that way in one session (the weather: a variable named `half`, reserved in
> GLSL ES; the city's entire ground: a varying declared twice by two
> injections that both wanted it). Related traps in the same family: writing
> to `diffuseColor` at `<opaque_fragment>` changes nothing, because Lambert
> has already folded it into the lighting; and any FLAT additive term lifts a
> dark material far more than a bright one, which is how a sun rim turned the
> city's 0.09-linear asphalt into pale snow.

> **Reviewing art on the phone: `?goto=` and `?env=`** (2026-09-11). Every
> landmark in this game is one object on a 754-unit planet, and the review
> loop is "open the URL on your phone and look". `birbmobile.vercel.app/?goto=stone-arch`
> flies you there before the first frame and names what it did in a toast;
> `?env=forest|canyons|mountain|city` switches biome first, since landmarks are
> per-biome. An unknown id lists what this biome actually has. These are
> PRODUCTION paths, not `?debug=1` hooks — a seek reachable only from a desktop
> console does not help the one person who has to sign the art off. Each
> landmark carries its own `viewDistance`: one stand-off cannot serve a 74-unit
> broadcast mast and an 18-unit summit arch, and at the old flat 34 the mast
> filled the frame as a black wall. `applyStartupLocation` runs in a
> `requestAnimationFrame`, NOT inline — `?env=` rebuilds the whole world
> synchronously and this is called straight from the Tap-to-Start listener, so
> inline it froze the title screen under your thumb (measured: the harness's
> 5s click timeout expired).
>
> **The forest's stone arch was a flat ribbon on the ground** — the canyon-arch
> defect from §17, reproduced here and shipped. `TorusGeometry`'s ring lies in
> the XY plane, so rotating local Y onto `up` already stands the arc up; the
> extra `PI/2` about local X laid it flat, and it read as a low stone curb you
> fly over without noticing. It is a 17-unit half torus on its own two feet now,
> and the colliders follow the ARC (a post at ±R is only on the stone at h = 0 —
> nine units up the arch has already curved 2.5 units inward, so vertical
> colliders guarded air beside a leg you could fly straight through). Two
> things cost a round each and are worth keeping. **Levelling a 34-unit span
> to its lowest foot buries the arch**: one of three terrain samples landed in a
> pit and put the whole thing 20 units under the hill — pick the SITE instead,
> scanning for flat ground. And **scan in surface UNITS, not in `(angle,
> bearing)`**: `angle` is arc from the valley anchor, so the same ±0.22 wobble
> moves 26 units on one and 5 on the other — it walked the arch onto the
> giant-tree site and the capture opened inside a canopy.
>
> `__BIRB.bbox(name, localPoints)` is why both were found in minutes rather
> than argued from the source: it reports each named local point's height above
> its own ground. The source was right about the geometry and wrong about what
> was on screen, twice. `tools/birb-shot.mjs` gained `--query` for the same
> reason — flags used to be smuggled in via `--page index.html?bark=1`, which
> appends a SECOND `?debug=1` and leaves `__BIRB` undefined while the flag's own
> regex still matched, so the capture looked like it proved the flagged path.

> **The sandstone arch read as a wooden bridge, and the numbers said so
> before the eye did** (2026-09-11). Two authored albedos, one scene, and
> nobody had ever compared them to each other: the bark's mean colour is
> `#6f655e` and the stone's is `#6c6359` — **6.6 sRGB units apart**. Each file
> passes `tools/asset-check.mjs` on its own, and no structural check has any
> opinion about the OTHER texture in the same frame. The stone's tint was
> near-white on the reasoning that the art had been graded to the procedural
> material's own tone, which was true and was the wrong target, because that
> tone was itself a brown. It is a solved lift to a pale limestone now
> (`#b5a58c`, tint 3.062/3.000/2.647) — chosen against measured clipping,
> 0.51% of pixels against `#c2ab86`'s 1.68% — and `authored-textures.test.js`
> asserts the two materials render **101.6 sRGB units apart** and that the arch
> is the lighter of the two. It fails at 43.1 on what shipped.
>
> **The second half of "it looks like wood" was the grain direction.** The
> stone albedo is horizontal bedding (variance across its rows is 6.7x the
> variance across its columns), `TorusGeometry` runs u along the arc, so the
> bands ran LENGTHWISE down a standing leg — which is exactly how bark fissures
> run. The arch's uv attribute is swapped at build time so they ring the tube
> as level strata. Same principle the canyon walls already use, banding on
> RADIUS so layers stay level.
>
> **A GL error naming a size limit needs both halves of the comparison.** A
> real browser reported `glRenderbufferStorage: Desired resource size is
> greater than max renderbuffer size`, followed by bursts of `Framebuffer is
> incomplete: Attachment has zero size` — which is one failure, not two: a
> rejected renderbuffer keeps its previous 0x0 size and every draw into that
> framebuffer then fails. NOT reproducible here (SwiftShader,
> `MAX_RENDERBUFFER_SIZE` 8192, largest size this game ever requested measured
> at 612x1258, zero GL errors), so `bloom-pass.js` now clamps rather than
> trusts. Note the trap the clamp exists for: **`Math.max(1, NaN)` is NaN**, so
> `Math.max(1, Math.floor(width * ratio))` hands GL a non-finite size the moment
> `ratio` is undefined — and a device-toolbar toggle is enough to do that.
> `__BIRB.glLimits()` reports the device's limits beside what is actually being
> asked for, because that report is unanswerable with only one side of it.

> **The authored skies landed and are the shipping default** (2026-09-11).
> Four 1024x512 equirect panoramas, one per biome, on the sky dome. The
> decision was not close: captured side by side, the canyons' upper half
> without them is a flat beige wash with nothing in it at all, and with them
> it has cirrus, a violet-to-orange gradient and depth. `?skytex=0` turns them
> off and `?skytex=0.5` half-mixes, so the comparison stays reproducible.
> The dome's own procedural sun disc still draws on top — the panoramas were
> commissioned with "no sun disc" precisely so the sun can stay aligned with
> the real keyLight instead of being baked at a fixed spot.
>
> **A texture is not loaded when TextureLoader returns it, and switching a
> material on at call time is switching it to an EMPTY texture.** The sky
> raised `uSkyMix` to 1 the moment it asked for the file, so for the length of
> the download the dome sampled a blank — and the entire upper half of the
> screen rendered **solid black**. Invisible on a dev box off localhost, and
> several seconds of void on a phone on a cold connection. Reproduced by
> holding the PNG in flight with a Playwright route delay, which is the only
> way this class of bug is ever seen before a user sees it: the mix is raised
> from `onLoad` now, and the gradient holds until the image decodes. The same
> request also carries a TOKEN — the dome survives an environment switch, so
> a forest sky still downloading when the player jumps to the city would
> otherwise land and paint itself over the city.
>
> `sw.js` precaches the FOREST sky only. Its own note about bark says why:
> a shipping default that is not in `CORE_ASSETS` renders wrong on the first
> offline load with no warning. The other three are 1.4 MB of install weight
> for biomes most sessions never open, and `cacheFirst` picks each up the
> first time its biome is visited online.

> **Every authored texture is now the shipping default** (2026-09-11). Bark on
> the landmark trunk, the fallen log and every instanced forest trunk; sandstone
> on the arch; the four skies. `?bark=0`, `?stone=0`, `?skytex=0` and
> `?authored=0` opt out — the escape hatches stay because the A/B is how each of
> these was judged, and a comparison you cannot re-run is one nobody re-runs.
>
> **The black-slab bug was real, and it was the same bug three times.** Held in
> flight by a Playwright route delay, `?bark=1` rendered EVERY TRUNK IN THE
> FOREST as a solid black slab — word for word the defect `barkMat`'s own
> comment in `spherical-world.js` was written to memorialise, arriving by a
> completely different route. A Texture is not an image: `TextureLoader.load`
> returns the object immediately and fills `image` in later, so assigning `map`
> at call time defines `USE_MAP` against an empty upload for the whole
> download. `commitWhenDecoded` in `authored-textures.js` is the one shared fix
> — bark, stone and sky all wait for EVERY image in their set before swapping
> anything. Not each as it lands: a normalMap attached over a still-procedural
> albedo is a different wrong frame, not fewer wrong frames.
>
> The disposer had to learn the same thing. It now cancels a pending swap and
> restores **only what was actually changed**, because an environment switch
> mid-download would otherwise write the saved `previous` over a material
> nothing had touched, and a load landing afterwards would paint a disposed
> texture onto a world that had already been rebuilt.
>
> **Budgets, measured at a fixed pose twice each**: 64-69 draw calls with the
> textures on, 65-69 with them off — the difference is frustum noise, not cost.
> Standing in a champion grove is the tight view at 93-96 calls and 79.4k
> triangles, and it measures 93 with every authored texture DISABLED, so that
> pressure is the grove, not the art. `sw.js` (v56) precaches bark but not
> stone: bark is every trunk in the default biome, the arch is one object on a
> 754-unit planet, and with the decode gate in place a missing texture now
> leaves the procedural material standing rather than rendering wrong.

> **The mountain's pines got bark for free, and two harness flakes turned out
> to be clocks** (2026-09-11). The pine trunks are the same instanced unit
> cylinder as the forest's, and `bark_pine_*` is already in the service
> worker's core cache — so a second biome gained an authored surface with no
> new asset and no new download. Two details make it work rather than
> almost-work. **`addInstancedUvScale` had to learn `unitRadius`**: it derived
> the circumference as `2*PI*instanceScaleX`, which is only right because the
> forest's unit cylinder has a bottom radius of exactly 1.0. The pine's is 0.6,
> so its bark would have tiled 1.67x too finely and read as a different, finer
> material on a tree meant to match. **And the tint is NOT the forest's.**
> Reproducing `pineTrunkMat`'s own 0x33422f exactly lands the trunk at
> luminance 0.048 against the forest trunk's 0.162 — the black slab, for the
> third time by a third route. `PINE_BARK_TINT` targets #7a7264: the forest
> trunk's VALUE so it cannot read as a hole, desaturated and cool so the
> mountain keeps its own palette.
>
> **"forest: landing never reached NESTED" was a clock, not a collider.** The
> contact sheet reported it after 90 seconds and CLAUDE.md's own nesting note
> makes a blocked approach the obvious suspect. Instrumented, the bird was
> moving the whole time at a steady ~20 units per two-second sample and landed
> in 22 s in a freshly booted browser. The landing auto-fly advances PER FRAME,
> so at three frames a second it crawls against the wall clock.
> `forceNest(null)` already closed the gap before landing and said so in its
> comment; the INDEXED path never got that fix, and the sheet calls
> `forceNest(0)`. Both share one body now — 22 s to 3 s.
>
> **Playwright's 5 s click budget was the other clock.** `birb-quality.mjs`
> failed about one run in three with a TimeoutError on Tap-to-Start and ZERO
> assertions run, which reads exactly like a product regression. Measured: the
> click handler itself is **2.6 ms** — there is no hitch under the player's
> thumb — but the two frames after it cost 2.1 s compiling the world's shaders,
> and Playwright's action budget covers the page settling around a click, not
> just its dispatch. The click now shares the caller's timeout. **Before
> treating a harness timeout as a regression, measure the handler and the
> frames after it separately** — they are different numbers with different
> meanings.

> **The bird rebuild is planned, not built** (2026-09-13, morning — Phase 0 shipped that afternoon, see the entry after this one):
> [docs/realism/BIRD_PLAN.md](docs/realism/BIRD_PLAN.md). The number that
> sets its order: measured with the new `__BIRB.birdStats()`, the bird is
> **44 meshes = 44 draw calls — 65% of the 68 scene calls at spawn** — and
> 11,780 triangles on an object about 140 px tall (the body alone is a
> `SphereGeometry(0.5, 36, 28)`, 2,016 triangles drawn as a 60-pixel egg). So
> Phase 0 is merge-and-decimate, not art: ≤ 8 calls, ≤ 4,000 tris, same
> silhouette, plus a **rig-contract test**. The rig drives the model by NAME —
> `leftWing`/`rightWing`/`tail`/`leftFoot`/`rightFoot`, `userData.baseRotation`,
> `userData.tipFeather` (which also anchors the ribbon trail), and the right
> wing mirrored with `scale.z = -1` — and that contract is exactly why the
> shipped `birb.glb` lost its A/B: one mesh, no nodes, no skin, 1.37 MB of
> baked JPEG. It cannot flap. An authored bird without the rig is a statue.
> Also worth knowing before spending fidelity: **the bird is invisible at the
> perch** (`birbAnchor.visible = mode !== FPV`), so its only customer is the
> chase camera from behind and above. Routes are procedural v2 → authored
> feather textures through this week's pipeline → a rigged-GLB go/no-go
> gated by the contract test, in that order.

> **Ultracode pass: the bird rebuilt to budget, five biome surfaces authored,
> and a granite tint refuted by capture** (2026-09-13). Two agent fleets ran
> in parallel under `docs/ULTRACODE_REALISM_PLAN.md`'s ownership rules (bird:
> `index.html` plus new `src/flight`/`tests`/`tools` files; textures:
> `src/environment/*`, `sw.js`, `assets/`), each with adversarial Opus
> verifiers. What follows is what they found and what survived integration.
>
> **Phase 0 of the bird plan shipped: 44 → 8 draw calls, 11,780 → 3,408
> triangles, 14 → 3 materials, same silhouette.** Whole-frame draw calls at
> spawn fell 64 → 27 in an apples-to-apples A/B where only `index.html`
> differed. Parts are baked by their TRS into vertex-coloured merged
> geometry; `tipFeather`/`secondaryFeather` are real empties so the ribbon
> still anchors; `src/flight/bird-contract.js` + `tests/bird-contract.test.js`
> pin the rig contract, and `?glb=1` now falls back with a warning when a GLB
> fails it (the shipped `birb.glb` does: all five named nodes missing). Two
> things a verifier caught that green tests did not. The contract module was
> imported UNCONDITIONALLY on the boot path and was not in `sw.js`
> `CORE_ASSETS`, so the first offline launch after a cache bump died on a
> dynamic import — `BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js`
> is the oracle plain `npm test` skips, and it is worth running by hand
> whenever a `src/` module is added. And the first Phase 0 evidence sheet had
> EMPTY `back` and `left-profile` tiles, from `freeze()` and `birdStudio()`
> landing on different frames; `tools/birb-bird-sheet.mjs` now counts
> non-background pixels per tile and exits 1 below a floor. **A sheet that
> cannot fail is not evidence.**
>
> **Phase 1 is a flagged candidate, not the default: `?bird=v2`** (8 calls,
> 2,202 tris, contract green, ten tiles intact). Its two verifiers never ran
> (session limit), so it was measured and eyeballed at integration only, and
> the sheets side by side say: sound, and not obviously better — the
> feather-plate wings are thinner than the Phase 0 cones at chase distance
> and the lofted body reads as a smooth capsule where Phase 0 kept a pale
> belly. That is exactly the question the blind paired A/B on the phone is
> for; until it runs, Phase 0 ships. `node tools/birb-bird-sheet.mjs --query
> bird=v2` reproduces the comparison.
>
> **Five authored surfaces landed, all on by default with an opt-out**
> (`?canyon=0`, `?granite=0`, `?snow=0`, `?concrete=0`, `?ground=0`, or
> `?authored=0` for the lot): sandstone on both canyon spire materials,
> granite on the mountain peaks with snow on their caps, concrete on all
> three city facades, and a triplanar ground map on the forest sphere. Every
> swap is decode-gated through `commitWhenDecoded` and every disposer restores
> only what it changed. Two lessons cost a round each. **`addInstancedUvScale`
> grew a box path**: the cylinder-circumference formula on a `BoxGeometry`
> tiles a facade by a number that means nothing, so the box branch chooses
> its repeat from the object-space normal. **A sphere's UVs are unusable for
> ground** (pinched at the poles, stretched at the equator), so
> `ground-detail.js` samples the map triplanar, blended by the facet normal it
> already computes — three samples, zero draw calls. `tools/asset-check.mjs`
> now models residency PER BIOME (worst biome 20.0 MB of a 24 MB ceiling): the
> 1024² deliveries were downscaled to 512² because the directory summed to
> 42.7 MB and no biome ever has all of it resident. The 24 must not be raised.
>
> **A5 in the quality board is measuring the clock, and a red main found it**
> (2026-09-13, after the merge — FINDING, patch proposed, NOT applied; see
> [docs/perf/gates/G-A5-DRIFT.md](docs/perf/gates/G-A5-DRIFT.md)). Browser
> Health failed on main at `58e240a` with "A5: scene draw calls did not fall"
> and PASSED on the SAME COMMIT on the branch four seconds earlier, which is
> most of the diagnosis. The assertion compares two medians with a strict
> `zero < one` and its whole signal is the weather's ONE draw call, while
> `__BIRB.freeze(true)` freezes only the BIRD (it sets flight speed to 0).
> Measured with the pose frozen, sun off, tier pinned: after a 40-frame
> warm-up, four consecutive 15-frame windows had medians **34, 32, 28, 29** —
> six draw calls of drift against one of signal, not a startup transient, and
> still four in the drone-free Ring Rush, so the drones are not the whole of
> it. The drift trends DOWN, and density 0 is always the later window, which
> is exactly why the check usually passes and occasionally does not. The fix
> (interleave the two densities, counterbalance the order, wait on frames
> rather than milliseconds) measures 12/12 green with both A5 mutations still
> caught — but `tools/lib/quality-captures.mjs` is hash-frozen in
> `tools/oracle-manifest.txt` under R5, so it is written up as a gate decision
> rather than applied. **When a check's signal is one unit and its window is
> seconds long, it is not measuring what it names unless something proves the
> rest of the frame held still.**

> **v3 IS THE BIRD, and the feather sheets had never once run** (2026-09-13,
> evening). `?bird=v3` is gone as a flag — it is the default; `?bird=v1` builds
> the Phase 0 bird and `?bird=v2` the one-plate candidate, for the A/B.
>
> **The shader patch anchored on the wrong thing and silently disabled itself
> on every device.** `installFeatherDetail` looked for
> `diffuseColor *= sampledDiffuseColor;` — the BODY of three's map_fragment
> chunk — but at `onBeforeCompile` time the fragment shader still contains the
> literal `#include <map_fragment>`; three expands its includes afterwards. So
> the guard fired every time and the sheets were never applied at all. Found
> on the owner's phone console, not here. Worse, the unit test FAKED an
> already-expanded shader, so it was green against a string three never
> passes. **A fake that is more convenient than the real input tests the
> fake.** It anchors on the include now and replaces it with a self-contained
> block, which also stops caring what three does inside the chunk.
>
> **The body was a football because it was a tube of revolution.** Circular
> sections, widest at mid-length, tapering symmetrically. Three things fixed
> it and all three live in the row table: the mass moved FORWARD onto a keel
> about a third back from the throat; the sections became eggs (`rT`/`rB`,
> separate radii above and below the section centre, blended smoothly so the
> silhouette does not crease at the equator); and a NECK row pinches to half
> the throat's radius with the head FORWARD of it rather than stacked on top —
> the previous version moved x by 0.13 while y climbed 0.37, which is what
> makes a head read as a ball on a ball. Also: primaries at 1.26 long by 0.23
> of chord are 5.5:1, which renders as pale threads; they are 4:1 and
> overlapping now. The tail was nine feathers fanned across 0.10 of width — a
> spike, not a fan — and the rump had no uppertail coverts, which is the whole
> of "his butt and legs and tail are still funny".
>
> **Graphics quality is a setting now**: Ultra / Amazing / Okay / Light in the
> gear menu, persisted to localStorage. A preset PINS the adaptive tier (or
> unpins it, which is Amazing) and Ultra additionally raises the DPR CEILING to
> 2.4. Note which way round that is: the ceiling is the most the renderer may
> ask for and the tier still drops to 1.0 and 0.85 underneath it on measured
> FPS, so Ultra cannot pin a struggling phone at a resolution it cannot hold.
> `applyQualityPreset` calls `updateRendererSize(true)` because pinning a tier
> that is already current changes nothing and a ceiling change is not a tier
> change — without the force, Ultra would not reach the renderer until the next
> real resize, which on a phone is never.

> **The bird got a joint, the sky got a horizon, and the feather sheets are
> detail maps** (2026-09-13, later). Three things, each with a number.
>
> **`?bird=v3` is a bird with a WRIST.** Each wing is an arm group (coverts
> over secondaries) with a `hand` group nested at the wrist carrying seven
> splayed primaries, because the twist and lagging hand added to the rig
> measured 0.32-0.54/255 on v2's one-plate wing: a plate has no thickness,
> so the flap's realism was gated on the FORM. 9 draw calls / 1,414 tris,
> contract green; the extra call over Phase 0's eight is the two hands.
> Proportion came from capture, three rounds: span 1.02 against a 1.21 body
> read as a FISH (a songbird is ~2; it is 1.73 now); eyes as r=0.092 balls at
> z=0.132 stood 0.065 proud of a 0.197 head half-width and showed from BEHIND
> on the owner's phone as a face looking back — they are flattened lenses on
> the front-sides now; feet hung like landing gear. **Axis trap:**
> `birdStats().worldSize` is reported under the orientation offset (+X built
> → -Z forward), so `.x` is the SPAN and `.z` the length; read the other way
> the wings appear never to change while they triple. Phase 0 still ships
> until the blind phone A/B.
>
> **The authored sky stood on end at the equator.** This is a sphere, so up
> is radial; the dome's gradient measured elevation against `uSkyUp` but the
> panorama was sampled with three's WORLD-frame equirect (`asin(dir.y)`), so
> its horizon stayed at world y = 0 while the player's went round the planet.
> Reproduced at `__BIRB.teleport(1,0,0)`: the cloud band ran top to bottom.
> It samples in the local tangent frame now (`equirectUvLocal` in
> sky-environment.js is the JS reference the GLSL mirrors, five tests); at
> the pole it reduces exactly to the classic formula. **Two halves of one
> shader must agree on which way is up.**
>
> **The feather sheets are clamped DETAIL maps, not albedo, and the measure-
> ment is why.** Solved as albedo (tint = 1/mean) they clip 24% of the body
> and 54% of the belly against a 1.5% budget — their 1st-99th range is only
> ~3x, so half of every sheet is above its own mean by construction — and
> the belly/wingtips clip at 53.7% at EVERY strength, dead flat, because
> those vertex colours carry blue at exactly 255. That is the palette. The
> shader applies `min(1, mix(1, albedo x tint, 0.8))` (nothing can clip on
> any vertex colour; detail is the shadow between vanes), decode-gated on all
> four images, chained under the rim light's own onBeforeCompile, `?feathers=0`
> and `?feathernormals=0` for the A/B, v3 only (its UVs tile in surface units;
> the atlas v2 built assumed a bird-shaped image `asset-check` will never
> accept). First capture at 4 tiles/unit minified the
> 512 sheet 8-20x into mush (detail x0.85-1.29); it is 1.8 now.
>
> **CORRECTED 2026-09-13 (evening): the "darkens the bird 18-49%" reading was
> an artefact of comparing two separate browser boots.** Re-measured against
> a CONTROL — two boots with the sheets ON in both — the control's own
> luminance spread is 0.1-3.2% and its mean absolute pixel difference 1.2-3.4
> of 255, which is the same size as everything that had been attributed to
> the feathers. Boot-to-boot, the bird's world orientation at freeze differs,
> so the key light lands at a different angle; `pinTier(0)`, `setSunEnabled
> (false)`, `setSunTime`, `setBloom({enabled:false})`, `freeze(true)`,
> `restorePose({position, quaternion})` and `flapPhase()` together pin most
> of it and the residual (idle flutter, tail sway — both sub-degree, both
> enough to shift a silhouette by a pixel) still floors the method at about
> 2/255. **A difference you cannot separate from your own control is not a
> measurement.**
>
> What the sheets actually do, measured with the same control: at a 1.05-unit
> stand-off the body carries **+40.8% high-frequency detail** against
> feathers=0 (control +4.2%) and the back +18.8% (control -9.4%) — visibly
> scalloped contour feathers across the breast and flank. At the 4.2-unit
> chase stand-off the game actually uses, the difference is -3.8% detail
> against a -2.4% control: **indistinguishable from noise.** Luminance moves
> under 3.4% at every distance, so they do not darken the bird meaningfully
> either. The sheets are real, they are on, and at play distance you cannot
> see them — the limit is the bird's ~140 px on screen against a 512 sheet at
> 1.8 tiles/unit, which is a TILING RATE problem (fewer, larger feathers),
> not a strength problem. Reproduce with the deterministic A/B described
> above; `?feathers=0` is the off side.

> **The bird was inside out, and the slalom was two yellow towers**
> (2026-09-13, evening). Both found by the owner flying the shipped build on
> his phone; both were one-line diagnoses once something MEASURED them.
>
> **Three complaints — eyes and beak visible from the back, feet showing
> through the belly — were ONE inverted winding.** `buildBody()` lathes the v3
> hull ring by ring and pushed `(a, c, b)`. At the top of a ring that is
> `(+Z) x (+X)` reversed, i.e. INWARD, and `contourMat` is `FrontSide`, so the
> renderer culled the near surface and drew the interior of the far side —
> putting the beak, the eye lenses and the tucked feet, every one of them a
> correctly-wound separate mesh, in plain view through the bird's own back.
> Both caps were wound to agree with it, so both flip flags swapped too.
> **Staring at a render cannot tell "never rasterised" from "drew facing
> away"; evaluating the cross product at one known vertex is four lines and is
> decisive.**
>
> **An eye must be PROUD of its own section and INSIDE the one behind it.**
> Fixing the winding did not hide the eyes: a lens flush with its section does
> not read as an eye, so the only thing that can hide it from the rear is a
> section further back that is wider still. Measured, the lens reached z 0.229
> against a best rear cover of 0.212 — visible by 0.017, exactly the two black
> marks on the crown. The head is wider than it is deep now (rZ 0.225 ->
> 0.248, which is also true of a songbird): cover 0.240 against an eye at
> 0.222, hidden by 0.017 and still 0.007 proud of its own ring.
>
> **The foot tuck was a constant the builder never got to set.** `buildFoot`
> ends with `rotation.set(0, 0, -1.35)` and it never survived a frame — the
> pose loop ASSIGNS `rotation.z` from a shared `footTuck = -0.85`, leaving the
> toes 0.128 below the belly as two prongs of landing gear. At -2.20 the drop
> is 0.008 and the toes just break the belly feathers by the rump; past -2.30
> they vanish into the hull. It rides on the foot group as `userData.tuck`
> now, because v1/v2's legs are longer and one angle cannot serve both.
>
> **The "weird yellow tower pole things" were the slalom's gold finish arch** —
> two 42-unit neon pillars built into EVERY environment unconditionally,
> whether or not anyone had opened a mini-game. The whole Run is deleted:
> module, `sw.js` entry, `SLALOM_ANCHOR`, the `goToSlalom` hook and the
> `window.playRingSynthChime` bridge that existed only for its ring-gates
> (Ring Rush calls the local function and is unaffected). **What it cost is
> the part worth keeping**: same poses, tier 0 pinned, before -> after —
> forest flight 33 -> 26 calls and 64.9k -> 59.3k tris, canyons 32 -> 29,
> mountain 29 -> 24, city 34 -> 27. Five to seven draw calls and up to 6.8k
> triangles in every biome, permanently, for a course most sessions never fly.
> A feature "added to every environment" is not paid for when it is used; it
> is paid for always.

> **The organic pass: Waves A and B shipped, C/D planned** (2026-09-13, late):
> [docs/realism/ORGANIC_PASS_PLAN.md](docs/realism/ORGANIC_PASS_PLAN.md), §11
> and §12 for what they actually did.
> The owner asked for less blocky leaves and a smoother ground that keeps its
> sharp rocks. Two measurements set the plan's shape. **The forest's 285
> canopies are 24k of its 58k triangles**, so "more segments" is +24k and off
> the table — leafiness has to come from shading (smooth normals, then an
> alpha-tested world-noise rim that cuts a lacy edge out of the solid crown
> at zero geometry cost). And **the ground already has smooth normals**:
> `displaceSphereGeometry` calls `computeVertexNormals()` and `flatShading:
> true` throws them away, on the ground and on thirty-three other materials.
> The owner's "smooth soil, pointy rocks" is one shading rule, not two
> meshes: blend the smooth normal toward the FACET normal by the slope mask
> `ground-detail.js` already computes, so soil rolls and rock faces fracture
> on the same draw call. The trap is that `ground-detail.js` derives its slope
> from the facet normal on purpose and must switch sources with the shading,
> or material boundaries snap per triangle across a smooth hill. Wave A of
> the plan costs zero triangles and zero draw calls; the mountain (35k tris,
> six-sided cone pines) is where the cheap geometry goes; shadows are a
> five-minute phone measurement, not a plan item, because the lever exists
> and no device number does — it is **"Real shadows (shadow map)"** on the
> **Ultra** tab of the three-finger quality panel, which works on production
> without `?debug=1` (that is what assertion A1 exists to prove). Do not reach
> for MAX REALISM to test it: G-ASCEND found its partner BACK TO SHIPPING
> DEFAULT is not reversible.
>
> **Wave A shipped and is the default**, behind `?smooth=0` / `__BIRB.smooth()`:
> the ground and eight soft materials (canopies, shrubs, ferns, the gold crown,
> pine crowns, snow caps, both clouds) shade smooth while every rock, boulder,
> scree, spire, peak, cliff and building keeps its facets; trees lean 1-3° off
> radial unless they host a nest; rocks got three independent axes and sit
> into the ground. **The canyons are where the rule is visible**: the plateau
> top rolls and the wall below the rim fractures, on one mesh and one draw
> call. Two things it taught. **The escape hatch had to be engineered to be a
> true before** — the first splice emitted a shader one blank line longer than
> the one it claims to reproduce, which is cosmetic in GLSL and worthless as
> evidence, so the flat path is now diffed against HEAD's own output. And a
> **radial fan of spokes across the snowfield was in BOTH frames**: the
> teleport target sat within 18 degrees of the sphere's +Y pole, where all 128
> meridians converge. A capture near a UV pole says nothing about shading.
> Trunks were deliberately left flat — bark is not crystalline, but the
> authored bark tints were solved against the flat material's measured
> luminance, so it is a re-measurement, not a flip.

> **Wave B: the leaves, snow on what faces up, and soil you can see the grain
> of** (2026-09-13). `?leaves=0`, `?snowline=0`, `?groundbump=0`.
>
> **A crown's outline is what makes it read as solid, and adding segments
> cannot fix that at any price this frame can pay** — 285 canopies are already
> 41% of the forest's triangles. So the ragged edge is CUT OUT of the existing
> mesh: world-space noise thresholded near the silhouette, fed to three's own
> alpha test. Two traps in one feature. **The obvious `normal.z` silhouette
> term cannot compile there** — three's fragment order puts
> `<alphatest_fragment>` BEFORE `<normal_fragment_begin>`, and `vNormal` is
> compiled away entirely under FLAT_SHADED, so anything built on it dies under
> `?smooth=0`, the one path the A/B needs. And **a FACET normal cannot cut a
> silhouette on a low-poly mesh**: it is constant across a facet, a lathe
> canopy has seven, and the capture showed one clean straight edge with the
> opposite third of the crown dissolved. `ensureWorldNormalVarying` carries
> the interpolated normal and is per-material correct for free — three's
> polyhedra are non-indexed, so on a boulder `objectNormal` already IS the
> facet normal while on a lathe it is smooth.
>
> **Two latent bugs came out; only one announced itself.** `addFoliageWind`
> ASSIGNED `onBeforeCompile` and set a CONSTANT cache key, so any patch already
> on a foliage material was erased silently — nothing had caught it because the
> only other patch there chains and happened to run second. And
> `addAtmosphere` guarded its `varying` DECLARATION while replacing
> `<begin_vertex>` unconditionally, so a second patch wanting the same world
> position declared `birbWorldPos` twice: **140 compile failures**, caught by
> `tools/birb-shaders.mjs` and by nothing else, because three draws nothing for
> a failed material and the page still paints. One guarded helper now.
>
> **Snow settles by `dot(N, normalize(worldPos))`** — radial up, never world
> +Y — written at `<color_fragment>`, and a boulder goes from a uniform dark
> polyhedron to snow on its up-facing planes with bare rock on the sides. A
> conifer flank sits ~72 degrees off up, so the 0.45 floor the rock materials
> use puts no snow on a pine at all; theirs opens to 0.10.
>
> **The ground bump's strength was ten times off because the units are not
> three's.** `perturbNormalArb` expects a height map's gradient; here the
> height is the albedo's LUMINANCE, which changes ~0.01 per pixel, so at the
> 0.35 a bump map would want the frame is pixel-identical to no bump — which
> looks exactly like the feature not being wired. One capture at 20x proved it
> was (mean channel difference 25/255), then the sweep read 0.35 invisible, 5
> right, 9 noisy, 20 static. Strength and fade are solved as a PAIR from "~5 at
> a perch, ~1 by flight altitude": rate ln(5)/21, strength 5·e^(4·rate). The
> triplanar sample is hoisted and shared, so it is still three `texture2D`
> calls and a test counts them.
>
> **The cost this could not measure is B1's.** An alpha-tested material loses
> early-Z and the canopies are the biggest instanced meshes in the frame; under
> SwiftShader at 1 fps that number is meaningless. If the phone's adaptive tier
> starts dropping where it did not, gate the erosion on `tier < 2` like the
> ribbons. `?leaves=0` is the control.

> **The bird on its feet: a pose nothing had ever driven** (2026-09-13,
> late). The owner asked for wings tucked and a walk animation on the ground.
> Both already existed in the source. Neither had ever run.
>
> **`perchBlend` targeted `isNested` alone**, so the fold, the pulled-in span
> and the dropped tail could only happen in a nest — and **the bird is
> INVISIBLE at the perch** (`birbAnchor.visible = mode !== FPV`). So the perch
> pose had shipped for months, was unit-tested in `bird-pose.js`, and had
> never been seen by anyone. A bird walking on the ground held the full
> spread-wing glide. It now targets `isNested || isGroundedVisual`.
>
> **A tuck is TWO rotations and the pose only had one.** `fold` is dihedral —
> it drops the wing toward the flank — and a wing that is still standing
> straight out sideways just becomes a wide V pointing at the ground.
> `perchPose` gained `sweep`, the ONLY term in the whole rig that writes
> `rotation.y`, which lays the folded wing back ALONG the body so the
> primaries trail past the tail. Solved by capture at four fixed poses, not
> chosen: 0.95 fold / 0 sweep hangs the wing plate below the belly line and
> the rear view is two thin blades either side of the body; 0.50 / 0.80 swings
> it back out again, because past ~0.7 rad of sweep the wing points astern
> rather than lying on the bird. 0.70 / 0.65 absorbs it into the silhouette
> from every angle the chase camera can reach.
>
> **The walk bob moved along WORLD +Y** — `birbAnchor.position.y += sin(...)`
> — on a planet where up is radial. Correct within sight of the north pole
> and a progressively sideways shuffle everywhere else. Same rule the ground
> shader, the flight floor and Wave B's snow term all already follow.
>
> **`tools/birb-walk.mjs` is the guard, and it is in CI.** It lands the bird
> through a real ground collision and then asserts the pose and the controls:
> wings fold and sweep (and mirror), span pulls in, a bird with no input does
> not drift, forward moves it and swings the feet, the feet settle when the
> stick is released, reverse comes back, steering moves it. Mutation-tested by
> reverting the `perchBlend` fix — three failures, each naming the defect.
> `__BIRB.birdPose()` is what made any of it checkable: without it, "the wings
> tuck when grounded" is a claim about source rather than about the bird on
> screen. **Frames, never milliseconds** — the walk advances per frame and
> this harness runs at a few frames a second under SwiftShader.

> **The bank had no bank in it, the dive had a spiral in it, and the bird is a
> Bronze-winged Pionus now** (2026-09-13, night). All three reported from the
> phone; all three measured before anything was changed.
>
> **"Banks left both wings go straight, banks right both wings go down."**
> The bank dip was written with the two wings OPPOSITE-signed, which under the
> right wing's `scale.z = -1` is a symmetric FLAP, not a roll. A bank is the
> one motion in the whole rig that is not mirror-symmetric, so it is the one
> term that must be SAME-signed. Measured with the new `birdPose().leftTip` /
> `.rightTip` (each wingtip in the BIRD'S OWN frame, which is the only frame
> where "that wing is high" means anything): at five stick positions the two
> tips were equal **to four decimal places** — zero bank, all of the amplitude
> going into a phantom flap that then stacked with the correctly-symmetric
> `glideSweep`, adding one way and cancelling the other. That is the report,
> exactly. Fixed, it measures antisymmetric: bank -1.31 / +1.31 at full stick
> either way, collective dip the same -0.12 in both. **A rotation.x pair does
> not tell you which wing is up; evaluating the tip position does.**
>
> **A held dive spiralled and looped out of itself because yaw turned about
> the BIRD'S up.** Correct for an aircraft in open sky, wrong on a planet: at
> 60-70 degrees nose-down the bird's own up points backward along the ground,
> so a yaw input is a world-space ROLL — and roll was never corrected, because
> `_applyZenAutoLevelRoll` ran only in Zen AND only on a near-centred stick,
> which is exactly when roll does not accumulate. Measured holding (x 0.25,
> y -1) from 200 units up: roll 0.5 -> **40 degrees**, heading through more
> than a full turn, pitch carried from -70 round to **+55 — the bird pulled
> out of its own dive and started climbing.** Yawing about the PLANET'S up
> instead: roll **0.0 throughout**, the full -80 held for the whole run, a
> smooth constant-rate descending turn. With no yaw input the two are
> identical, which is the property that makes it safe. `?levelturn=0` is the
> before; `docs/perf/gates/G-FLIGHT-LEVEL.md` has the table. `maxPitch` is 80
> degrees now, not 72 — and deliberately not 90, where the tangent-plane
> heading is undefined and auto-level has no sign to work with.
> `__BIRB.flightProbe()` reports pitch, roll and heading against the local
> radial, which is what made any of this arguable from numbers.
>
> **Aerobatics are still off the table and this is what it would take:** the
> pitch clamp lifted entirely, an explicit roll input (roll is currently
> cosmetic — `bird-visual.js` rolls the MODEL, not the flight frame), a chase
> camera that survives inversion, and a ground floor that behaves when the
> bird is upside down. The controller is quaternion-based 6DOF underneath, so
> it is work, not a rewrite.
>
> **The bird is a Bronze-winged Pionus** (`?pionus=0` for the old blue).
> Bronze mantle and coverts, dusky violet body, dark blue-green flight
> feathers, a pink-white chin band, and the Pionus signature red. Two things
> worth keeping. **The red went on the TAIL ROOT, not the undertail coverts
> where the real bird carries it** — this bird is only ever seen from the
> chase camera, behind and above, and a marking on the underside is a marking
> nobody will ever see; banded along each tail feather's own length it flashes
> from exactly the angle the player is watching from. And **the first
> iridescence washed the whole wing to grey against a bright sky**: a fresnel
> that grows monotonically to the silhouette stacks with `addRimLight`, which
> already owns the silhouette, and a feather plate seen near edge-on is almost
> ALL silhouette. `addFeatherSheen`'s band now PEAKS across the surface and
> returns to zero at the edge, which is also what a structural colour actually
> does. It multiplies the light rather than adding a flat term, and it extends
> the program cache key — `addRimLight` returns a CONSTANT key, so a sheened
> wing and a rim-only body would otherwise share one compiled program.
>
> Also: `node_modules/three/index.js`, the repo's tracked hand-written stub,
> gained `Quaternion.conjugate`/`invert`. Bringing a world axis into the
> bird's frame needs the inverse and the stub lacked a method three has always
> had — two existing flight tests failed on it before it was added.

> **"An airplane more than a bird" — and MEASURE THE RENDER, NOT THE
> CONSTANTS** (2026-09-13, night). The wing planform is a table now
> (`WING_PROFILES`, `?wing=v3|slim|parrot|stocky`), default `parrot`.
>
> The first diagnosis was wrong and worth recording. Computing aspect ratio
> (span squared over area) from the feather plates' own width constants gives
> **9.1** — glider territory, a tidy story, and false: the plates FAN and
> OVERLAP, so the wing's real chord is far deeper than any single plate.
> Measured off a top-down capture instead (span and chord in pixels, sampled
> at three stations along each wing), the shipped wing is **AR 6.3** — already
> inside the range a parrot occupies. A plan built on the 9.1 would have cut
> the span about twice as hard as it needed cutting.
>
> **The pointed tip was most of the aircraft read, not the slenderness.**
> Primary length rose monotonically outward (0.74 -> 1.00), so the OUTERMOST
> feather was the longest and the wing swept to a dart. A round wing's longest
> primary sits about a third of the way out and the tips curve back in from
> there; `round` switches that length from a ramp to a hump, and in the
> top-down tile it is the first thing you see change. Measured across the four
> profiles: span 3.55/3.40/3.15/2.89, AR 6.3/5.7/5.1/4.6, and **1,518
> triangles in every one of them** — planform is free. `stocky` (4.6) goes too
> far: the wings start to read as too small for the body rather than as a
> stocky parrot's. `parrot` (5.1) also hands the bronze coverts most of the
> wing's area, which is the point of a bronze-WINGED bird.
>
> One trap the change introduced and closed: `tipFeather` (the ribbon trail's
> anchor, and what `birdPose().leftTip` reports) was taken from the LAST
> primary in the loop. With a rounded tip that is the SHORTEST one, so the
> anchor would have jumped a third of the hand inboard. It tracks the
> furthest-reaching primary now.

> **Aerobatics shipped, ULTRA IS THE DEFAULT, and REAL SHADOWS ARE ON**
> (2026-09-13, night). `src/flight/aerobatics.js` +
> `tests/aerobatics.test.js`. `__BIRB.aero(move, dir)` and
> `__BIRB.aeroState()` drive and report it.
>
> **THE TRIGGER LIVES AT THE EDGES OF THE STICK, and the first one did not.**
> It shipped as a double tap on the BOOST pill and the owner's first words
> back were "I'm not getting how this double-tap boost thing works — or
> isn't". That is the only test a trigger has to pass. It is now: pin the
> stick hard over and HOLD and the bank becomes a roll; pin it hard up and the
> climb goes over the top. Both are the continuation of something the player
> was already doing, so there is nothing to discover — the move is what
> happens when you ask for more of what you have got. Two numbers make it
> work. `edge` is **0.94**, because a virtual stick reads 0.6-0.8 through an
> ordinary hard turn and a move that fires there reads as a bug, not a
> feature — measured live, a 0.8 stick held for ten seconds never fires.
> `dwell` is **0.55 s**, which is long enough that the climb has already hit
> the 80-degree pitch ceiling and the bank has already reached full
> deflection: in both cases the aircraft has visibly run out of the ordinary
> control before the extraordinary one takes over. Holding the rail keeps
> asking, so a sustained full bank rolls about every 1.7 s — the move's own
> cooldown, not the trigger, is what paces that.
>
> **They are COMMITTED moves, not free 6DOF, and that is the design not a
> shortcut.** Free inverted flight would have to answer for the nesting state
> machine, the landing check, and a ground floor that is a MINIMUM RADIUS with
> no opinion about which way up the bird is. A move that starts, runs on rails
> for about a second and hands back a level bird never opens those questions.
> There is also no spare input on this screen — one stick, one pill, both
> already under a thumb.
>
> **The angle profile is an integrated raised cosine, and the reason is that a
> move which does not CLOSE is invisible in every frame and permanent.** Rate
> `turns * 2PI * (1 - cos(2PI t))` is zero at both ends and its integral is
> exactly `turns * 2PI`. Deltas are DIFFERENCED from a swept total rather than
> integrated from the rate, so frame rate cannot lose or gain angle — tested
> at 120/60/30 fps and at a 5-second hitch, all closing to within 1e-6.
> Measured on the real page: both moves return the bird to **-0.047 degrees of
> roll**, and the loop's radius goes 206.2 -> 210.7 -> 206.2.
>
> **`aerobaticActive` suspending every stabiliser is the load-bearing half.**
> A loop cannot exist while an 80-degree pitch ceiling is enforced — it is a
> 360-degree pitch by definition — and the auto-level, the roll leveller and
> the player's own stick would each undo the move as fast as it is made. The
> move also runs BEFORE `tick()`, because `tick()` ends by enforcing that
> clamp against the orientation it finds.
>
> **The roll direction was reversed, and the loop's camera went "wild,
> maybe backwards" — three facts settled it** (2026-09-13, later still).
> Forward is local -Z, so a POSITIVE rotation about +Z carries the right wing
> (+X) UP: `aerobatic()` un-negated rolled a hard right bank to the LEFT,
> straight against the visual bank the model was already holding the other
> way. Negated now, with a test that checks which way the right wing tip
> actually goes. **The visual bank is muted during a move** — the stick is
> pinned (that is the trigger), so `bird-visual.js` would otherwise add a
> full 63-degree bank on top of a frame that is already rolling.
>
> **`src/camera/follow-camera.js` IS NOT THE LIVE CHASE CAMERA.** The game
> runs `BirdCamera` (`src/flight/bird-camera.js`, "FLIGHT PORT" in
> index.html); cameraState's follow rig is parked at spawn on this path —
> read back through a whole loop, its position never moved. The first camera
> hold was wired into that parked rig, reached it (weight and distance read
> back correctly), and changed nothing on screen. `__BIRB.cameraHold()` now
> reports the LIVE rig's hold beside the parked one so this cannot be
> mistaken twice. **A hold that arrives at the wrong rig is
> indistinguishable from one that does not work, unless you read it back
> from the rig that renders.**
>
> `BirdCamera` stands behind the bird along the bird's own FORWARD, and in a
> loop that forward points up, then backwards, then down — so the camera
> swung underneath the bird and out the far side. Under a hold it stands off
> along the LEVEL heading the move began with (re-projected onto the tangent
> plane each frame), 2x further back for a loop (radius ~3.5 at cruise is
> smaller than the 5-unit stand-off, so at 1x the bird went over the top
> almost directly above the lens), full weight for the whole move with 0.15 s
> in / 0.25 s out ramps — a sin(PI t) ramp left the frame half-following the
> tumble for most of the move. Measured on the live rig: **10.00 behind,
> 4.00 up, 0.00 side, look angle -18.4 degrees, constant from t=0.09 to
> 0.85** while the bird's pitch ran +48 -> +80 -> over the top -> back. Up
> is already radial in that rig, which is why the barrel roll needed nothing
> from it and always read against a level horizon.
>
> **Ultra is now the shipping default** (`QUALITY_PRESETS[0]`: tier PINNED at
> 0, DPR ceiling 2.4), at the owner's explicit call. Know what the pin costs
> before moving it back: `adaptiveTier.pin(0)` takes the tier away from the
> controller that measures frame rate, so a device that cannot hold full
> resolution no longer sheds it — it just runs slow. Two taps in the gear menu
> undo it, which is what makes it an acceptable default and would not make it
> an acceptable hard-coding. `QUALITY_STORAGE_KEY` moved to `birbQuality2` in
> the same change: a preference stored under the old key would have silently
> defeated the new default for every returning player.
>
> **Real shadow maps are ON at the Ultra preset** — `PCF at 2048`, 20 shadow
> casters, verified at boot with `__BIRB.setShadows({})` reporting
> `{enabled: true, type: 1, mapSize: 2048, casterCount: 20}` without anything
> touching the panel. Captured at a champion tree with a low sun, the
> difference is not subtle: the canopy and trunk get their shaded sides back
> and the grove reads as having form instead of being flatly lit.
>
> Two things about how it is wired. It hangs off the PRESET rather than its
> own hidden default, so one tap to Amazing drops the resolution pin AND the
> shadows together — which is what someone whose phone is struggling actually
> wants to do, and it means the escape hatch is the control they already know.
> And it routes through `qualitySettings.request`, because CONTRACT §7.1 says
> shadow state changes by that path and no other; a boot-time poke at
> `shadowsSetEnabled` is the per-frame-writer failure A10 exists to catch.
>
> **PCF, not the workbench's VSM.** VSM is the softest of the four filters and
> is what MAX REALISM reaches for, but it wants float targets and a blur pass
> and has never been measured on a phone. PCF at the highest map size is a
> real shadow that renders correctly everywhere. VSM is still one tap away on
> the Ultra tab. Still not flipped: anisotropy and densities past 1.0.
>
> **The shadow cost was NOT cleanly measured** and the reason is worth
> keeping: `--after` captures drift, so the frustum differs between the two
> shots and the draw counts came back 25-vs-31 one way and 44-vs-30 the other.
> Do not quote either. A real number needs the pose pinned the way the feather
> A/B pins it (`restorePose` + `freeze` + `setSunTime` + `pinTier`).

> **A level bird cannot land, and it is not v2's fault** (2026-09-14, in
> [G-FLIGHT-V2](docs/perf/gates/G-FLIGHT-V2.md)). `_floorAt` and
> `checkGroundCollision` sample the SAME terrain function and add the SAME
> 0.6 bird radius, and `tick()` clamps to the floor before the landing check
> reads the position — so a flying bird sits at exactly `aboveGround` 0.600
> and the strict `<` is settled by float rounding. `setAltitude` below the
> surface does not help; the clamp lifts it back in one frame. Measured: a
> level bird grounded on about one run in three inside 60 frames, and
> `tools/birb-walk.mjs` is reliable only because it polls 120. Landing today
> is the knockdown or the nest; a glide onto flat ground meets an invisible
> floor. Left alone deliberately — a landing band changes v1 for every mode
> and has to respect the gravity-less-floor invariant — so the v2 tool
> asserts what is reachable and its own business: upright, unhurried contact
> must never read as a CRASH (which is exactly the boost bug the review
> found). **When two systems share a boundary exactly, `<` is a coin toss.**

> **The walk gate measured a hill and called it a takeoff** (2026-09-14):
> [docs/perf/gates/G-WALK-SLOPE.md](docs/perf/gates/G-WALK-SLOPE.md).
> Browser Health failed with "the bird left the surface while walking: radius
> 105.857 -> 108.608" on a tree whose every change was v2-gated or inert
> under v1 — and three re-runs on that same tree passed, landing at
> 104.96-105.01. The failing run LANDED 0.85 higher and walked uphill: the
> check compared RAW RADIUS, and on carved rolling terrain a 2.75-unit rise
> over 2.45 units of travel is a 48-degree slope, not flight. `birdPose()`
> reports `aboveGround` now, sampled through the same `sampleTerrainHeight`
> the flight floor and the landing check use, and the harness compares
> CLEARANCE (and fails loudly if the field is missing, rather than passing
> vacuously). **The quantity a check's own failure message names is the one
> it has to measure** — and the landing spot is still unseeded, which is the
> variance this removes a verdict from rather than removes.

> **The first load after every deploy was a broken one, and it looked like a
> plumage bug** (2026-09-14). The owner's console at the title screen:
> `Uncaught TypeError: pionusPlumageRequested is not a function` inside
> `createProceduralBirbV3`, and the module script dead before Tap to Start.
> Nothing about plumage: `sw.js` served the SHELL network-first (a navigation)
> and the MODULES stale-while-revalidate, so a fresh `index.html` from the new
> deploy drove the previous build's cached `visual-style.js`, which predated
> the export. It healed only when the new worker finished installing and the
> update banner reloaded the page seconds later — and the auto-reload lives in
> a separate classic `<script>` precisely so a dead module script cannot
> stop it, which is the only reason this was one broken load and not a
> permanent one. Modules are network-first now (`networkFirstModule`, falling
> back to the one core cache offline), so shell and modules come from the same
> deploy by construction; Vercel serves them `must-revalidate`, so online it
> is an If-None-Match round trip, not a re-download. `tests/sw-modules.test.js`
> pins the strategy. **A cache strategy that is right for a file can be wrong
> for a SET of files that must agree with each other.**
>
> **The aerobatics trigger was too eager, from the phone** ("the barrel rolls
> and dives and stuff are too sensitive / trigger too soon"): `STICK_EDGE`
> is 0.97 / 1.0 s / 1.4 s from 0.94 / 0.55 s. Half a second at the rail is
> inside an ordinary committed turn, and a pinned dive is the most common
> thing anyone does with altitude, so the loop UNDER — which fires from
> exactly that — has its own longer dwell; `progress()` measures against
> whichever applies, so the wind-up still reads as "asking". v2's rail moved
> to 0.97 with it: it is the same stick.

> **Flight v2 — proper flight, behind `?flight=v2`** (2026-09-13, night):
> [docs/realism/FLIGHT_V2_PLAN.md](docs/realism/FLIGHT_V2_PLAN.md) is the
> brief, [docs/perf/gates/G-FLIGHT-V2.md](docs/perf/gates/G-FLIGHT-V2.md)
> the measurements. The owner's verdict on the committed aerobatics: "klugy
> workarounds instead of proper flight like an airplane or bird. Why can't
> we have proper flight?" We can; the reasons recorded against it were about
> work, not physics. What made v1 feel scripted is the INPUT MAPPING on a
> controller that is already quaternion 6DOF: stick x is yaw with a cosmetic
> bank painted on the model, pitch is clamped at 80°, speed is constant, so
> a roll or a loop could only ever be a canned move with a trigger, a dwell,
> a wind-up and a camera hold. `src/flight/bird-flight-v2.js` (extends
> BirdFlight, so the terrain floor and parallel transport have one
> definition) replaces the mapping. **Attitude below the rail, rate at it**:
> push the stick part way and the bird holds that bank (up to 70°) and turns
> from it (`turnGain * sin(bank)` about the radial, 127°/s at the maximum
> against v1's 135); centre it and the wings level; pin it to the rail
> (0.94, the edge the old trigger measured) and it keeps rolling. Pull part
> way and it holds that climb; pull to the rail and it goes over the top.
> Speed is ENERGY — a dive gains, a climb bleeds, drag returns it to
> cruise. Everything scripted is off under v2; the chase camera holds the
> tangent velocity heading with radial up; inverted or fast-and-nose-down
> ground contact is the existing knockdown, upright and slow still lands.
>
> **The first cut was a pure RATE on both axes and an adversarial review
> refuted it with reproductions before the phone saw it.** The only
> sustainable bank was below shaped stick 0.29 (raw 0.40), and an ordinary
> hard turn on this stick is raw 0.6–0.8 — so the first hard turn asked for
> would have rolled the bird onto its back; a held pitch had a trim band of
> 12% of the stick; the `sin(2p)` stability was zero at the vertical and a
> teleported nose-up bird hung there with the camera heading frozen; and the
> crash rule fired on a level upright bird for 0.68 s after every boost
> (target 26.4 → 11 in one frame, speed still 19). A green oracle is not a
> good mapping; the review is what turned "rolls forever" from a feel note
> into a number. Measured on the sim clock (`flightProbe().simTime` — a
> harness that counted frames × 0.05 read a 0.85 s roll that was 2.05):
> rail roll 2.35 s, righting from inverted 1.38 s, loops 3.3–3.7 s at a
> 12–15 unit span with speed 7.4–14.4 through them, held bank at raw
> 0.25 / 0.33 = 11° / 16.5° (the input pipeline's deadzone and expo shape
> the stick before the controller sees it). `?v2tune=bankGain:3,turnGain:1.6`
> overrides any of the fourteen `FLIGHT_V2_DEFAULTS` at boot without a
> deploy, reported back by `flightProbe().tuning`; a full-stick dive is a
> push-over (120° in a second), so the evidence tool dives at half stick.
> `tools/birb-flight-v2.mjs` (21 checks) is in Browser Health; `?flight=v2`
> is one tap on the panel's Flags tab. v1 stays the default until both have
> been flown.

> **ULTRA IS THE OLD MAX REALISM, the panel is a preset strip, and the
> harnesses boot at the baseline** (2026-09-13, night):
> [docs/perf/gates/G-ULTRA-DEFAULT.md](docs/perf/gates/G-ULTRA-DEFAULT.md).
> The owner pressed MAX REALISM, said it looked better, and asked for the
> best view on by default. The Ultra preset had been a SUBSET of that button
> (tier 0, DPR ceiling 2.4, PCF 2048) and he could see the difference. A
> preset is a complete visual state now: `applyQualityPreset` starts from
> `resetVisualOverridesToShipping()` — the true before — and applies the
> preset's own lever list through `qualitySettings.request`; Ultra's list
> IS the MAX set (post Full, VSM 2048, 4x MSAA, anisotropy at the device
> max, terrain High, decorative 1) and Amazing/Okay/Light are the baseline
> plus a tier pin. **Native DPR is reached through the tier's CEILING
> (`dprCap: Infinity`), never a `dpr` override**: an override takes the ratio
> away from the tier, and the frozen A3 oracle's self-check (pin 0, pin 1,
> expect the drawing buffer to move) would read false on every fresh boot.
> `?quality=ultra|amazing|okay|light` boots a preset by URL, not remembered.
>
> **Under SwiftShader an Ultra frame is 2.6 s; Amazing is 0.13 s.** Measured
> lever by lever and no single one owns it (DPR 3 -> 1.7 saves 1.1 s, then
> shadows, post and MSAA about 0.4 s each), so the harnesses cannot run at
> the default and the preset was not weakened to suit them. Three frozen
> boot lines (`birb-modes`, `birb-walk`, `birb-quality`) gained
> `&quality=amazing` under R5 — which RESTORES the state every quality
> oracle was frozen against, since the old shipping default was exactly
> Amazing — and `tools/birb-default.mjs` is the one Browser Health step that
> boots with no flag and proves the production default is Ultra at its
> ceiling, reversible, with the tier still owning the ratio.
> `tools/birb-shaders.mjs` stays at Ultra on purpose (the VSM depth and
> multisample programs exist only there) and waits for RENDERED frames per
> biome now: its old 2200 ms wait was shorter than one Ultra frame, which
> would have reported "ok" for materials never submitted. **The phone is
> unmeasured**: the tier is pinned at Ultra, so nothing sheds if the iPhone
> cannot hold it; Amazing is one tap away in the gear menu or the panel.
>
> **The three-finger panel was rebuilt for a thumb.** Every target is 44 px,
> selects with four options or fewer are rows of buttons, toggles are
> switches, the four presets sit in the header of every tab with the live
> fps and draw-call line, and a **Flags** tab (`src/ui/boot-flags.js`, unit
> tested) renders every boot-time A/B (`?smooth=0`, `?feathers=0`,
> `?wing=`, `?bird=`, `?levelturn=0`, the authored-texture opt-outs...) as a
> switch that RELOADS with the flag in the URL — `?goto`/`?env`/`?debug`
> survive the reload. The oracle's selectors are untouched
> (`#birb-dev-quality-panel`, `.bqp-tab` text, `.bqp-control` +
> `.bqp-control-label` text, `input[type=range]`, `.bqp-stale-banner`) and
> `decorativeDensity` is still on the Performance tab after "Weather
> density". Also fixed on the way: the panel size never persisted, because
> `win` was never declared and the ReferenceError was swallowed by its own
> try/catch.

> **The roll's freeze, the loop's radius and the loop under** (2026-09-13,
> night): [docs/perf/gates/G-AERO-FEEL.md](docs/perf/gates/G-AERO-FEEL.md).
> "Freezes position on the wing tilt before it rolls" was the 0.55 s dwell
> at a bank that had already saturated, followed by the visual bank being
> MUTED the frame the move fired — a 63-degree bank unwinding against a
> sweep still easing in from zero. The bank is kept through the move now (a
> constant offset, continuous at both ends), and the dwell is motion:
> `AERO_WINDUP` deepens the bank past its ceiling (63 -> 88 degrees) in
> proportion to the hold, hands it over intact, and unwinds it against the
> angle SWEPT, so the apparent rotation is bounded never to reverse.
> Measured with `flightProbe().rollFullDeg + visualBankDeg`: monotonic from
> the first frame on the rail. Roll duration 0.95 -> 1.3 s.
>
> **"Almost pivoting on its own axis" was the raised cosine.** Radius is
> speed over angular rate and the raised cosine's peak rate is twice its
> average; at cruise that was a 1.75-unit circle. `sweptAngle` takes an
> `ease` per move now — a trapezoid with raised-cosine ends whose integral
> is still exactly `turns * 2PI`, and `ease 0.5` is the old profile to the
> last bit (the roll keeps it). The loop is 2.6 s at `ease 0.22` and flies
> at 1.5x cruise: measured diameter 11.7 against about 3.5. **Pin the stick
> DOWN and the dive goes under** — `moveFromStick(0, -1)` is a loop with
> direction -1, gated at `minAltitudeDown` 24 because it descends by the
> whole diameter before it climbs (measured dip 13.5).

> **The granite tint was solved, refuted and re-solved — by capture, not by
> taste.** The first solve lifted the peaks to 1.73x their procedural
> luminance to clear 60 sRGB units from the pine bark, and a pinned-pose
> capture measured the SNOW CAP losing 39% of its contrast against the
> granite it physically sits on (128.4 units → 78.8): snow is already at its
> clipping ceiling and cannot answer by getting brighter. `GRANITE_TINT` now
> targets `#5c6372`, 0.87x the procedural peak, and
> `tests/authored-textures.test.js` guards the snow:granite ratio. The
> pine-vs-granite gap is 36.3 and has its own test with a measured floor,
> because the authored pine bark already sat 34.9 from the PROCEDURAL peak
> before any granite existed — the procedural pair only read 98.7 because the
> procedural pine trunk was the near-black slab. **A separation rule a
> material was never going to satisfy is not a rule that material broke.**
> Also fixed on the way through: the sky panorama was never disposed on an
> environment switch, so every lap of the four biomes leaked four 1024x512
> textures.

> **First real-device pass** (§16.15). Three findings from an iPhone running
> the shipped build. **The flock is deleted** — playtest could not tell what
> the chevrons in the sky were, after two rounds of trying to make them read.
> **`PointsMaterial` with `sizeAttenuation` has no upper size bound**, so an
> ambient mote or spark drifting within a metre of the camera draws hundreds
> of pixels across as a pale disc over the scenery; `clampPointSize` injects
> `gl_PointSize = min(...)` after Three attenuates it, because a smaller
> `size` would shrink the particle at every distance instead. **The mobile DPR
> cap is 1.7, up from 1.2** — on a `devicePixelRatio` 3 phone the old cap
> rendered at 40% of the panel's linear resolution, and no amount of shading
> work compensates for that. It is safe to raise because it is a ceiling the
> adaptive tier still drops to 1.0 and 0.85 on measured frame rate. Budgets
> after all of it: 62-65 draw calls, 76-77k triangles, every biome.

> **The drones and the slalom gates got a pass** (§16.16). **The slalom is
> deleted as of 2026-09-13; `energy-ring.js` still serves the drones and the
> Ring Rush rings, and everything below still applies to them.** Both were flat
> colours on primitives with `transparent` + `AdditiveBlending` + opacity under
> one, and **additive light on a bright sky is grey** — which is how the
> checkpoint gates, the most important things to see on that course, rendered
> as concrete lifebuoys. `src/effects/energy-ring.js` is the shared fix: an
> OPAQUE ring with an HDR colour has a silhouette against any sky and the
> bloom supplies the glow. Its `base` brightness is asserted in tests to stay
> between 0.25 and 0.6, because both extremes were tried — a 50/50 duty cycle
> at full brightness is a barber's pole, and a near-black ring is a
> readability regression wearing an art department's clothes. The drone body
> is a dark carbon shell now, with seams along the octahedron's own edges:
> a regular octahedron satisfies |x|+|y|+|z| = r, so `min(|x|,|y|,|z|)` IS the
> distance to the nearest edge, free. All shader-side, because drones move
> independently and cannot be instanced. New capture hooks: `__BIRB.solo()`,
> `goToDrone()`, `goToSlalom()`.

> **Next round is planned, not built:** `docs/VISUAL_UPGRADE_BUILD_PLAN.md` §14.
> Ranked by what this session measured. The headline: one enum (tone mapping)
> was the largest visual change of the whole session, and every geometry or
> overlay effort failed. Item 1 (a ground shader pass: valley mist, cloud
> shadows, macro noise) is the highest-value thing left and needs no phone.
> **Fifth pass shipped the big build** (§15): an atmosphere fragment pass
> (drifting cloud shadows, valley mist, macro tint) at zero draw calls, a
> ten-minute sun cycle, hand-written half-res bloom as ONE merged pass, an
> asymmetric wing beat with burst-and-glide cadence, and a distant flock.
> Mobile now measures 61-70 draw calls and under 70k triangles with
> everything on. Two traps recorded there: an instanced prop's world position
> is NOT `modelMatrix * transformed` (the instance matrix lands in
> `<project_vertex>`, after `<begin_vertex>`), and mist driven by depth alone
> is not aerial perspective — it must also fall off with view distance.
>
> Platform research for September 2026 is in `docs/CUTTING_EDGE_2026.md`:
> WebGPU is real but an enabler not an upgrade; iOS caps rAF at 60 Hz; and
> iOS 26.5 cut the switch-based haptics trick to single ticks.

> Context for AI assistants and Vibe Academy builders. Read this first.

## This Is a Birb Labs Artefact

Birb Mobile is a **breakable toy** — a real, shipped, playable game that also serves as a learning artefact inside Vibe Academy. It exists so people can inspect real code, run it, break it, rebuild it, and learn from it.

**Play it:** https://birbmobile.vercel.app
**Repo:** git@github.com:Mentis123/birb.git
**Ecosystem:** Part of the Vibe ecosystem (vibeacademy.com.au)

### Sibling artefacts (Birb Labs showcase)

Birb Mobile is one of three showcase artefacts for Birb Labs inside Vibe Academy. All three share the same splash treatment: primary image splash with animated conic-gradient border → Vibe Academy attribution splash → game.

1. **Birb Mobile** — birbmobile.vercel.app (3D flight, this repo)
2. **Rogue Mobile** — roguemobile.vercel.app / yagamentis.vercel.app/rogue (turn-based roguelike)
3. **Frosty Spider** — (Next.js spider solitaire)

All three link their Vibe Academy CTA to `https://www.vibeacademy.com.au/`. Never `atmanacademy.io` — that domain is retired.

### Game state (2026-04-20)

Major overhaul session. Birb Mobile now ships the full **Birb Labs Artefact Treatment** — three-page entry flow (Splash → Vibe → Title) matching Rogue Mobile and Marco Mobile. See canonical spec at `vibeacademy-brain/wiki/brand/birb-labs-artefact-treatment.md`.

**Shipped this session:**
- Splash / Vibe / Title page flow with hero image + drifting feathers + cyan sparks on the Title page; "?" help and ⚙ settings in corners
- Render loop **fully deferred** — nothing runs behind splashes; `<main hidden>` until Tap-to-Start
- Procedural bird redesigned (chibi silhouette, layered-cone wings, big eyes, prominent beak) with `leftWing` / `rightWing` / `leftFoot` / `rightFoot` named groups preserved
- Flap animation (symmetric, right wing flap is negated to counter the scale.z=-1 mirror) + walk cycle (body bob + alternating foot tilt, only when GROUNDED && input.active)
- Committed knockdown — no Self Arrest. Fall ramps 1× → 3× over 3s, tree-impact shake + thud, Fly launches with outward impulse
- Realign quaternion on launch so yaw still feels right after a tumble
- Drones rescaled for 4× world (body 3.6, ring 5.4), slowed 20%, altitude moved into bird's flight layer
- Ring Rush: r 0.6 → 2.5, count 10 → 18, fibonacci replaced with arc-ribbon across near hemisphere
- Solid colliders at cruise altitude for trees/spires/mountains/towers + new cloud colliders — you can crash into things now
- Drone-bird collision triggers the knockdown instead of a subtle freeze
- Hide host tree + nearby props while nested so horizon is clear
- Mode-aware minimap (Zen = compass+nest, Ring Rush = rings only, etc.)

**Known / pending:**
- ~~Minimap is too zoomed-out per playtest~~ — **fixed** (mode-aware `visibleRadius` 65–95 shipped)
- Task 6 playtest pass on Drone Hunter + Turret Defense tuning still open
- ~~Eruda debug still present in `index.html`~~ — **removed**

**Sibling siblings:**
- Rogue Mobile (`Mentis123/yagamentis`) — full treatment
- Marco Mobile (`Mentis123/marcomobile`) — full treatment
- Frosty Spider (`Mentis123/FrostySpider`) — treatment alignment pending

**Density / immersion pass (2026-05-31):** all four on-sphere environments densified for a fuller, more layered, exploration-feel world (terrain had been thinned for the 60fps mobile lift, which read as sparse). More trees/spires/peaks/buildings + new instanced prop layers (forest ferns + emergent snags, canyon needle-spires, mountain scree + champion-pine nests, city rooftop clutter + street pylons), taller champions/verticality, and ~2x nests across every biome. Drones are 50% bigger again (body 3.6→5.4, ring 5.4→8.1, collisionRadius 6.6→9.9) and +50% on desktop (12) / held at 8 on mobile. Forest + mountain **clouds refactored from 80/54 separate puff meshes to one InstancedMesh each** (cloud colliders preserved) — reclaims the desktop draw-call headroom that funds the pass. New props are InstancedMesh + collider-free; the remote's cruise-altitude colliders (tree/spire/peak/tower/pine canopies, solid clouds) are kept. Mobile structural counts gated to a middle tier (denser than the thinned base, lighter than desktop). Budgets hold: <100 draw calls, <80k tris, 60fps, per-env. See `src/environment/spherical-world.js` builders + `src/nesting/drone-system.js`.

**Evaluation + polish pass (2026-06-10):** a four-domain multi-agent codebase evaluation shipped as `CODEBASE_EVALUATION.md` — read it before any structural work; it has the prioritized roadmap, a consolidated zero-alloc audit, and a do-NOT-fix list of deliberate trade-offs. Fixes shipped from it: `prefers-reduced-motion` no longer pauses the game (it gates decorative motion only — shake/FOV kicks/speed lines via `reducedMotionState`); Ring Rush win condition + HUD now track the real spawned ring count (was 10 vs 18); turret drone AI loop de-allocated; SW update reload deferred during active runs; Tap-to-Start shows "Loading…" on slow networks. Visual suite shipped: sky-dome sun disc + halo aimed at the env keyLight, camera-anchored sky gradient, twinkling stars, mobile ring shimmer, speed-sense FOV, cinematic vignette. Retention: share button on results (and the results "Best:" line actually displays now — it was being clobbered), personal bests on mode cards, per-mode onboarding hints, og/twitter social cards. **Doc corrections:** the legacy controller is `src/controls/simple-flight-controller.js` (`free-flight-controller.js` does not exist); the `src/performance/` directory is currently UNWIRED dead code (index.html reimplements adaptive quality inline); `src/controls/flight-controls.js` is constructed but its input-shaping methods are no-ops on `BirdFlight` — the live touch path is `src/flight/touch-input.js` → `bird-flight.js`.

**Capabilities + retention pass (2026-06-11):** researched real 2026 mobile-browser limits and adopted what's free: **Screen Wake Lock** during play (iOS 16.4+, re-acquired on tab return); **screenshot sharing** — the results Share button now attaches a fresh-rendered canvas JPEG via Web Share Level 2 (iOS 15+) with text-only fallback; **iOS haptics bridge** — `triggerHaptic` falls back to clicking a hidden `<input type="checkbox" switch>` (native tick since iOS 18) since `navigator.vibrate` remains Android-only; **real PWA icons** (pure-Python-painted 192/512 maskable + 180 apple-touch-icon in `icons/`, manifest updated) so install-to-home-screen finally looks right; **daily flight streak** chip on the title page (localStorage, extends on consecutive-day play). Found but NOT adopted: **WebGPU is now Baseline** (Safari 26+, all majors) — a future `WebGPURenderer` migration is the big graphics unlock but needs a real device-tested branch, not a blind merge.

**Distribution follow-up (2026-05-31):** the first pass only made the clusters denser, but the world still *read* as sparse — on a radius-120 sphere the horizon is ~44u away while groves/ridges/blocks sit ~125u apart, so most views land in an empty gap (see the player screenshot that prompted this). Fix: a **global evenly-distributed scatter layer** of the primary prop in every biome (forest trees 150 mobile / 240 desktop, canyon spires 70/120, mountain pines 110/180, city buildings 120/200), each pushed into the SAME instanced arrays as the clustered props → zero new draw calls, just more instances. Clusters still give dense pockets + nests; the scatter guarantees props are always in view. Applies on mobile too (the user is mobile-first), kept under the fill-rate budget since no new transparent surfaces are added.

**Terrain topology + zoning (2026-05-31):** added a broad low-frequency "continental" noise layer (`terrainDisplacement` / `TERRAIN_PROFILES.continentScale/continentAmplitude`) that carves **deep valleys/canyons DOWNWARD** from the base radius (forest −24, canyon −38, mountain −46 at the extremes). `placeOnSphere` is now terrain-aware via a module-level `_activeTerrainProfile` set in `createSphericalWorld`, so props (and the sphere mesh, via the shared `terrainDisplacement`) sit on the rolling ground. **Why downward-only:** `checkGroundCollision` is the *landing/grounded* mechanic (index.html sets GROUNDED state on a hit) and `bird-flight.js` clamps the bird to a *minimum* radius — so upward terrain rising into the cruise band would force-ground the bird. Carving only downward means the bird (cruising just above base radius) flies OVER and sees INTO the valleys with no grounding/clipping; the "highlands" are the tall instanced peaks/trees. **Fly-INTO-valleys (2026-05-31, shipped):** the bird can now descend into the canyons, not just fly over them. The flight model has NO gravity — the bird holds altitude inertially and the `sphereRadius` clamp in `bird-flight.js` is purely a *floor*. So the floor was made terrain-aware: `BirdFlight._floorAt = sphereRadius + Math.min(0, terrainHeightAt(dir))`, fed by an injected `sampleTerrainHeight` sampler (exported from spherical-world.js, reads the live `_activeTerrainProfile`). `checkGroundCollision` (landing) and `forceGroundedPose` (walking) use the **same** smooth floor (`terrainFloorDir` = continental-only, no detail jitter), so all three agree and the bird isn't trapped. **`Math.min(0,…)` is load-bearing:** with no gravity, a floor that rose above baseline would ratchet the cruising bird upward — so the floor only ever dips into valleys, never rises (rises stay visual via the detail mesh + tall props). No spawn pop (spawn 123 > floor ≤120), no false grounding, zero per-frame alloc. Verified by a 4-lens adversarial workflow (floor consistency, ratcheting/spawn/grounding, alloc/perf/env-switch, math/edge-cases) — all pass. Also: forest/pine scatter now zones by elevation (lush dense valleys → sparse dwarfed ridge tops via a terrain-height tree line), and scatter counts bumped (~25%).

**Rolling-world restore (2026-06-02):** a perceived regression — "the nice tree distribution and canyons are gone." Investigation: NOT a git revert; all terrain/scatter code was present and tree counts had even gone *up*. The real cause was a *feel* regression from two later commits. `fa16a15` ("solid ground, no fly-through") added the outer `Math.min(0, cont + detail)` clamp — correct and load-bearing (mesh == floor, floor ≤ baseline), but it turned the base radius into a hard CEILING, flattening the symmetric detail noise that used to read as rolling relief into a dead-flat plateau. `57a2f15` ("cliff-face shaping") then steepened the remaining carves via `tanh` (FACE_STEEPNESS 2.7) into sharp, isolated mesas, so the world read as a flat plain with rare pits, and — because most of the surface now sat at the flat plateau (`depth ≈ 0`) — the scatter's elevation zoning dwarfed/thinned trees almost everywhere (lush full-size trees survived only in the rare deep canyons). **Fix (keeps the ≤0 floor invariant, no fly-through/ratchet regression):** since we *cannot* raise terrain above baseline, rolling is faked by carving DOWN across most of the surface — new `CONTINENT_BIAS` (0.35) shifts the continental field negative so the average ground sinks into rolling lowlands and only the highest peaks reach the baseline ceiling; this also re-exposes the detail roughness (only visible where carved below baseline) across the whole map. `FACE_STEEPNESS` softened 2.7 → 1.4 (rolling faces, not cliffs), carve clamped to `[-1,0]` so the bias overshoot can't exceed amplitude. Scatter tree-lines widened to span the deeper range (forest exposure /12 → /24, thin >0.75 → >0.82; pine /16 → /30, thin >0.7 → >0.78) so trees stay lush across the rolling terrain and only true ridge crests thin. **Do NOT "fix" `CONTINENT_BIAS` away** thinking it's a bug — it's the deliberate trade that restores the rolling look within the gravity-less-floor constraint.

### Birb Gauntlet — unlisted sibling at `/gauntlet` (2026-08-01)

**Birb Gauntlet** is a stylised arcade bird-*racing* game living in this
repo at `gauntlet/`, deployed with the main site to **birbmobile.vercel.app/gauntlet**.
It is unlisted: `noindex`, linked from nowhere. Four birds, three laps, one
glowing ribbon circling a miniature planet.

**Full Birb Mobile port shipped (2026-08-01).** Five modes now, all built from
one world and one bird: Casual (the default — free flight with ambient drones
AND nesting, and it cannot fail), Gauntlet Race, Ring Rush, Drone Hunter and
Turret Defense. The spine is `gauntlet/src/game/modes.js` — a **capability-flag
descriptor table** (`course/laps/rivals/drones/nesting/rings/timed/canFail/
gentle/scoreKind`). Nothing in the loop branches on a mode ID; a new mode is a
table entry, not a sweep through `index.html`. Things worth knowing before you
change any of it:

- **Ring Rush's win condition reads the spawner**, never a constant.
  `run.ringsTotal = rings.count`. Birb Mobile shipped 18 rings checked against
  a hardcoded 10 and the mode could not be completed.
- **A time is only a record if the run completed** (`completed` guard in
  `finishRun`). Lower-is-better plus an early exit is a two-second best that
  nothing can ever beat.
- **Turret Defense's wave one waits for the player to be on the gun**, and
  `WAVE_SPEED_MUL` is solved for, not chosen: at the ported 1.25 a wave crossed
  its stand-off in 3.2s against a 2.0s rocket cooldown, so the first capture of
  the mode lost all three lives without a shot fired. 0.45 + a 1.15 rad
  stand-off gives ~15s and seven or eight shots.
- **Drone Hunter's ram only counts above `HUNT_STRIKE_SPEED01` (0.5).** Hunt
  drones close on you, so without the gate a player who never touches the stick
  scores — measured: 3 kills / 450 points in 8 seconds of doing nothing.
- **The turret reuses the boost pill as FIRE** and the stick as aim, so the
  player keeps the button they already dragged to their thumb. The aim rig
  needs `driveCamera: true` or `viewQuaternion` is never written and the FPV
  camera stares at the terrain.
- `nesting.update()` runs BEFORE `flight.tick()` and `drivesFlight` gates it —
  two systems writing one position is a bird that vibrates between the nest and
  the sky.

`window.__GAUNTLET_STATS()` now returns run state alongside the frame stats, so
a harness capture is evidence of what the MODE did, not just what rendered.

It is deliberately **airtight against Birb Mobile**: nothing in `gauntlet/` imports
from the parent `src/`, nothing outside imports from inside it, and `sw.js` now
explicitly bypasses `/gauntlet`. That last one is a correctness fix, not tidiness —
the SW's `networkFirst` caches every navigation response under the key
`./index.html`, so a single visit to `/gauntlet` would have overwritten Birb
Mobile's offline shell and booted the wrong game on the next offline launch.

Own stack, own rules: vanilla ES modules + pinned CDN Three, **zero external
assets** (every mesh, texture, sound and even the splash art is generated in
code), own virtual joystick (no nipplejs), seeded RNG throughout. Read
`gauntlet/ARCHITECTURE.md` before touching it.

Two constraints worth knowing:
- **Terrain carves downward only** (`gauntlet/src/core/terrain.js` guarantees
  `surfaceHeight <= continentalHeight <= 0`). Same gravity-less-floor problem
  Birb Mobile hit: a floor that could rise above baseline ratchets a cruising
  bird upward forever. Height above baseline is expressed with collider-free
  instanced props.
- **Stepped lighting amplifies high-frequency normals.** The ridge function is
  squared to kill a normal crease that threw white band-noise shards across
  the terrain, and the light rig uses an **AmbientLight, not a
  HemisphereLight** — MeshToonMaterial quantises only the direct term, so a
  normal-varying fill paints a smooth gradient straight over the hard bands and
  the whole cel look silently dies.

**Three-finger QR (2026-08-02).** Birb Labs demo convention: three fingers
held and released pops a QR of the production URL so a bystander can scan it
off your phone (`Q` on desktop). Three is the first touch count the game itself
can never produce — one is the stick, two is stick+boost. The QR is generated
in code (`gauntlet/src/ui/qr.js`, byte mode / ECC M / versions 1-10) because the
artefact ships zero external assets and this has to work offline. That encoder
was verified module-for-module against the `qrcode` npm package during
development, which caught two bugs that produce a symbol that LOOKS right and
does not scan: the two format-info copies were transposed, and version >= 7
reserved the version-info blocks without ever writing them. Both are pinned by
tests. The URL is PINNED to production, not `location.href` — a localhost or
preview URL is useless to the person scanning it.

Verify visual work with `node tools/gauntlet-shot.mjs` — it exits non-zero on any
page or console error, so a captured PNG proves the code ran. Isolation probes
live in `gauntlet/dev/`. Note: the harness needs
`npm install --no-save playwright three-real@npm:three@0.183.2` followed by
`git checkout -- node_modules/three/index.js`, because any npm install prunes
the hand-written Three test stub this repo tracks there and silently breaks
`npm test`.

### Bronze — unlisted sibling at `/sculpture` (2026-08-02)

A **3D study of the bronze group outside The Women's** (Royal Women's Hospital,
Parkville), living at `sculpture/` and deployed to
**birbmobile.vercel.app/sculpture**. Unlisted: `noindex`, linked from nowhere.
Drag to orbit, pinch to zoom, two fingers to pan, double-tap to reset.
Three-finger QR as usual.

> **Read `sculpture/ARCHITECTURE.md` before touching any of it**, and
> `sculpture/LIKENESS.md` for where it currently stands. Between them they carry
> the module map, the build pipeline, the invariants that must not be undone,
> the verification protocol, the current score and the phased plan to finish.
> The summary below is the short version.
>
> **For `/img2threejsMAX` work, read the repository-shared skill at
> `.claude/skills/img2threejs-max/SKILL.md`.** Its scripts, contracts and
> reference guidance are part of the workflow. The zero-production-asset rule
> below is immutable; reference imagery is evidence, never a runtime dependency.
>
> **Staleness warning:** parts of this section's narrative predate the
> 2026-08-04 six-relief reconstruction and still describe four freestanding
> figures on a crowded diagonal. Where they disagree,
> `sculpture/ARCHITECTURE.md` and `sculpture/validation/phase-5-closeout.md`
> are authoritative: the object is ONE folded casting of six alternating
> positive/negative reliefs.

Own stack, same house rules as Gauntlet: pinned CDN Three, vanilla ES modules,
no build step, **zero production assets** — the running sculpture imports no
images, meshes, fonts or textures and is generated in code. The committed
reference and validation images are evidence only and are never imported by the
page. That is not purism: every proportion is a NUMBER in a table
(`SHELL_PROFILE`, `TORSO_PROFILE`, `FRONT_OPENING`) that can be tuned against a
photograph, which is the whole workflow for getting a likeness.

**The reference photos were upside down**, and that mattered more than it
sounds. All four arrive with EXIF orientation 3; `ImageOps.exif_transpose`
alone is the correct fix, and an extra flip double-corrects and mirrors the
signage — which is how you can tell you have got it wrong. The first plan for
this scene was written against the un-rotated images and described a completely
different sculpture (hooded figures with flared cloaks). Upright crops live in
`sculpture/reference/` and every modelling decision is made against those.

Two structural lessons already paid for, do not undo them:

- **The robe and the hood are ONE swept shell**, not a body with a cowl around
  it. Modelled as two pieces, the cowl's radius sits barely outside the body's,
  so a front-on camera sees only its two vertical edges and the figures read as
  people standing between a pair of rails.
- **The cloak opens at the HIP, not the shoulder.** The torso inside is bare and
  fully modelled. Closing the robe at chest height turns four women into four
  bottles.

**Reference set (2026-08-02).** Mentis's four photos in `sculpture/reference/`
plus seven Google Maps community photos used TRANSIENTLY for measurement and
deliberately NOT committed — they are other people's copyrighted images, and
only the landmarks extracted from them feed the model. Those seven changed the
structure materially and the findings are recorded here so they survive:

- The work is **Michael Meszaros, 2008**, commissioned via the Harold Mitchell
  Foundation for the hospital's opening. Maps lists it as "Women's Sculpture".
- **The hood is a hollow open plate**, not a tube. It rises behind the head with
  a visible rim and a dark interior you can see into from three-quarter angles.
- **The figures are flat slabs.** Depth is about half the width; the cloak is a
  PANEL.
- **The cloak stands BEHIND the woman and the whole front is open.** This is the
  single most expensive thing that was got wrong. `ref-c-under.jpg` silhouettes
  the group against sky and settles it: the cloak covers her back, curls a little
  round her sides, rises into a hollow collar-arch behind her head, and that is
  all it does. Her face, throat, shoulders, breasts and belly are in open air in
  front of it. So the opening runs to about **1.5 rad EACH SIDE at chest height**
  — roughly 170° of the circle simply is not there — and the cloak's axis sits
  ~0.15m behind the spine up top, closing to the body's axis only at the hem.
  Modelled with a 0.55 rad opening and a shared axis, the shell is a near-complete
  tube with a slot in it: the body was fully and correctly modelled the whole
  time and **not one square millimetre of it was visible**. The group rendered as
  four ghosts for four passes.
- **The group is a crowded diagonal**, not a zigzag: nearest figure front-left,
  each of the other three further back and further right, all facing roughly the
  same way and turning a little more to the right as they go back. The earlier
  "folded screen" reading makes a decorative arrangement of panels; the
  photographs read as four women standing close.
- **Every figure carries a story** and this is the subject of the sculpture, not
  decoration: one is heavily pregnant, one cradles a swaddled newborn with both
  forearms under it, one is the clinician with a stethoscope round her neck.
  Modelling four identical women loses the point of the piece. Note that
  *building* them is not the same as their *reading*: the first versions were
  all present in the field and measurably in the mesh, and none of them was
  findable in a render. The bundle sat at the womb, was round, and blended at
  k = 0.032, so it was indistinguishable from the pregnant figure's belly; it
  reads only once it moves up to the forearms, goes oblong across the body, and
  keeps a hard seam (k = 0.016) — a crease is wrong for anatomy and right for an
  object being held. The stethoscope's bell stood 19mm off the chest, which is a
  bump you cannot find; cast bronze tubing is fat and hangs in front of her.
- **The heads are intentionally non-uniform.** The nearest figure is a bare,
  plain rounded block. The rear-facing figure has a complete face on the
  opposite side and turns as one body/cowl/head unit. Two figures carry a
  coiled top-knot. Do not restore one identical cap to all four - that was a
  major reason the heads once read as interchangeable.
- The faces are planar with a **long nose ridge running from the brow**, hollow
  triangular eye sockets and a wide flat mouth.

**The likeness gate has two halves and neither is sufficient alone.**

`node tools/sculpture-proportions.mjs` is the measurable half — landmark heights
and spans as fractions of the figure's crown-to-ground height. Pixel IoU against
the photos was tried and abandoned on evidence: luminance thresholding, centre
flood fill and a blue-vs-neutral colour test each leaked into the winter trees or
dropped the sunlit robe, because the bronze is dark against dark trees, dark
mullions and its own shadow. A landmark is locatable in a cluttered photo where
an outline is not. `sculpture/LIKENESS.md` is the other half: 41 binary checks
each citing the photograph that settles it, scored by eye. 90% is 37 of 41.

**`node tools/sculpture-sheet.mjs` is how you score it** — it renders every
matched camera pose in ONE browser boot and composites each render beside the
reference photograph it was matched to. Building it should have been the first
thing done on this model, not the seventh: ninety renders had been judged by
comparing the model against a *memory* of the photo, and the first side-by-side
pair exposed a hem 40% too wide inside a minute. Poses live in
`tools/sculpture-views.mjs` and use the CROP's field of view, not the photo's.

**When the gate and the eye disagree, re-measure.** This has now happened twice
and the tell was identical both times — green gate, worse render. First, the
table was read off ref-c where the nearest figure is turned away, so the mass at
the top is her hood but the face below belongs to a figure further back; the
model was solved to match it exactly and got visibly worse. Second, the table
normalised by the top of the COWL, which varies per figure by design, so it
measured different figures against different rulers — and `headHeight` came out
wrong by 45%. **Normalise by the crown**: it is the one landmark every figure has
and every photograph shows. Re-measured on two figures independently, the head is
0.175 of the figure and the model had been building it at 0.130.

Verify with `node tools/sculpture-shot.mjs` for a single angle (same harness
contract as Gauntlet: non-zero exit on any page or console error).
`sculpture/dev/probe-parts.html` renders any subset of a single figure
(`?only=body,head,feet`) — **rendering the body without the cloak in front of it
is the only way to tell "the torso is wrong" from "the torso is hidden"**, and
this model was debugged the wrong way round for several passes before that probe
existed. When something looks like a lighting bug, turn one thing off or swap the
material rather than tuning: `MeshNormalMaterial` found a clipped neck in one
render after three passes of chasing it as light.

### Three things that look like lighting problems and are not

Each of these cost a round of material tuning before being identified, and each
was found by an A/B that turned one thing off rather than by adjusting numbers.

1. **`material.shadowSide` must be `FrontSide`.** Three defaults a FrontSide
   material's shadow pass to `BackSide`, which is correct for watertight solids
   and wrong here: a figure is a merge of an open-topped cloak sheet, a
   surface-nets body, a head and two feet, so the "far side" the depth pass
   writes is not a valid occluder for its own front. Every figure shadowed its
   own chest and the whole group above waist height rendered in ambient only.
   Toggling `castShadow` off on the figures is what proved it was the depth pass.
2. **The patina's occlusion term must use a FIXED radius, not the geometry's own
   extent.** Normalising by max radius was fine until the cloaks grew trains: one
   vertex a metre out rescaled everything, every point on the torso landed near
   r = 0, and the bodies were flooded with crevice black. The figures went flat
   in the same commit the trains appeared, which is the tell.
3. **Light intensity and albedo are one knob, turned opposite ways.** Three's
   lights are plain irradiance multipliers, so a 0.17 bronze under a 3.0 sun
   tone-maps to a 0.7 grey and the group renders as plaster no matter how dark
   the vertex colours get. Dark patina *and* low intensities (sun ~1.7, hemi
   ~0.6) is the pair that lands on bronze.

Also, on blending: **the blend radius must be well under the protrusion.** It is
the one rule of modelling with `smin`, it is broken by default, and it is broken
silently — a bust standing 0.02 proud of the chest wall blended at k = 0.10 is
not a soft bust, it is no bust at all. The first SDF pass lost the bust, the
belly, the swaddled bundle, the brow, the nose and the lips to exactly this.

And one more of the same family: **every `surfaceNets` sampling box must clear
its contents' caps.** The mesher leaves a torn open rim wherever the box cuts
through geometry. The body box topped out at y = 2.13 while the neck capsule's
cap reaches 2.167, and the resulting slab read as a dark trapezoidal visor across
every face — hunted as a lighting bug, then a shadow bug, then a facial-geometry
bug, before one normal-material render found it.

### State, and how to pick it up (2026-08-03)

**Phase 4 has passed its second visual-acceptance correction at 35 of 41; the
proportion gate is green at 0 of 12.** The current nine-view evidence is
sculpture/validation/phase-4-detail-correction.png and the complete record is
sculpture/validation/phase-4-closeout.md. The earlier Phase 4 sheets remain
provenance, not current sign-off. Later close-ups proved that a green numeric
gate is necessary and not sufficient: it has been green and visually wrong more
than once. The revised gated plan is at the end of
sculpture/ARCHITECTURE.md.

**Phase 1 (mass) is done.** Every span was ~20% too narrow, the head ~35% too
small, the bust too high, and the hem read 0.56 of figure height against the
photograph's 0.39 — that last one entirely because the train scaled the ring's
RADIUS and so pushed the hem sideways as well as backward, while the base profile
measured correct to within 0.007. It is a displacement now.

**Phase 2 (cast section and the stride) is done.** The dark V up the front of
every figure was structural, not cosmetic: the cloak closed into a tube below the
hip, and a cloak that closes has to close somewhere. It never closes in the
photographs — she wears a long skirt, and the cloak is a panel hanging behind it
— so the skirt is now part of the body field, running to the paving, and the
opening holds its full height. Every free edge carries a rounded bead built into
one closed cross-section; hems rake clear of a leading foot; each column shears
forward of vertical; no two figures agree on stride, rake, lean or head angle.
The original feet were too small, while the first corrections then read as
detached pebbles or long paddles. The current planted foot is a narrower
root/instep/forefoot/toe form unioned directly into the robe field; no separate
shoe or exposed leg is rendered.

**Phase 3 (the heads) is done, and cost more than the other two together.** The
head is a rounded BLOCK — flat front, flat sides, domed top — not an ovoid; built
as an egg a face has nowhere flat to sit and every feature slides off. The
nearest head is bare/plain. The rear-facing figure has a complete face on
the opposite side and rotates as one body/cowl/head unit instead of twisting at
the neck. Two figures carry coiled top-knots. The lesson worth keeping is that
**thin features do not survive
surface nets, and it fails silently**: the mesher averages one vertex per cell,
so a form three or four cells thick vanishes — while the field measures correct
AND a max-z sweep of the mesh still finds the stray slivers, so every number
agrees the brow is there and no render shows it. A `MeshNormalMaterial` pass is
what settles it. Four other hypotheses were tested and discarded first; two of
them were real bugs worth fixing and neither was the cause.

**Phase 4A (arms and negative space) is done, including the reopened detail
correction.** The four figures use distinct reference-led arm paths. The carried
infant is a separate fine closed swaddle on a curved support; the clinician's
instrument is two separate curved tubes with ringed terminals. A7 and F4 pass.

**Phase 4B (surface and bronze) is done.** Stronger existing displacement,
two-scale vertical runoff, warmer bronze values and a colder environment make
the hand-worked casting legible at group distance. `G2`, `G3` and `G5` pass.

**Performance remains a final ship gate.** The corrected scene is 514,780
triangles, 6 draw calls and 4 figures. The nine-view local Chromium matrix
reported roughly 44-60 FPS under SwiftShader with no page or console errors,
but that software-rendered result is not a real-iPhone result and is not a
reason to rewrite the geometry blindly. An iPhone 12-or-newer load and orbit test
is still outstanding; if the real device also struggles, test a lower mobile
renderer-DPR cap before changing mesh resolution.

### Birb AR — unlisted sibling at `/ar` (2026-08-07)

**Birb AR** is a "magic window" AR prototype: point your phone at the room, a
Birb Mobile screen appears floating in it, you drag/pinch it into place, tap
**GO!**, and Gauntlet's free-flight game plays on that screen while the
thumbstick and BOOST pill sit on the phone glass over the camera feed.

`/ar` is a **redirect** (`vercel.json`) to the pre-existing capital-`AR/`
directory, which is now a hub linking Birb AR, the original 2025 **AR Shooter**
(preserved untouched at `/AR/game.html`) and its camera/gyro/3D test pages.
**Never create a lowercase `ar/` directory** — it collides with `AR/` on
case-insensitive filesystems and breaks checkout on macOS and Windows.

The app itself lives at `gauntlet/ar/` and is routed to from the hub. It is
inside `gauntlet/` deliberately: it imports planet, sky, bird, flight, chase
camera, feathers and the joystick from `/gauntlet/src/`, and ARCHITECTURE.md
rule 1 forbids anything OUTSIDE `gauntlet/` importing from inside it. Putting
the page in there keeps the invariant instead of relaxing it.

Things that cost a debugging round and must not be undone:

- **`/AR` and `/ar` are in `sw.js`'s `SIBLING_ARTEFACTS` bypass.** They were not,
  and that was a live bug: `networkFirst()` writes EVERY navigation response to
  the cache key `./index.html`, so visiting `/AR/game.html` overwrote Birb
  Mobile's offline shell with the shooter — and a flaky load of `/AR/*` served
  Birb Mobile's HTML at the `/AR/` URL, where its relative `./src/` imports all
  404 and the page renders blank. Both directions read as "it doesn't load".
- **The screen spawns where the phone is ALREADY pointing, on the first frame
  that has a real gyro reading.** Azimuth 0 is a fixed world direction and the
  device's heading at launch is arbitrary, so a fixed spawn puts the screen
  anywhere in the room — including behind you. Computing it in `startAR()` does
  not work either: that runs before the first rAF and before the first
  `deviceorientation` event, so the quaternion is still identity. It is deferred
  via `pendingFace`.
- **The screen is PORTRAIT (9:16), and so is the render target.** It shipped
  16:10 landscape first and that was wrong three ways. The AR illusion needs the
  room visible AROUND the screen, so it can only occupy ~62% of the view — on a
  portrait phone that is 242 CSS px of width, and a 16:10 plane inside it is
  151px tall, a postage stamp you cannot fly on. Portrait buys ~430px of height
  from the same width, near 3x the area. It also frees the bottom third of the
  phone for the stick and boost pill, which in landscape had nowhere to sit but
  on top of the game. And Gauntlet is itself composed for portrait (its captures
  are 390x844), so a landscape render target was off-design as well.
- **Default distance is solved from the field of view, not hardcoded, on BOTH
  axes.** The same screen subtends very different angles portrait vs landscape.
  Fitting width alone was right only while the screen was landscape; a portrait
  screen on a portrait phone is height-constrained, and a width-only fit put its
  top and bottom off the ends of the view. `framingDistance()` solves both and
  takes the further.
- **The bezel is two textures, swapped — not one texture tinted.** The corner
  ticks are painted cyan into the bitmap, so the old "not placing" state (tint
  the material white) left them at full strength and the placement affordance
  was on permanently, including mid-flight.
- **`renderer.info.render` resets on every `render()` call.** The AR page renders
  twice — game into a `WebGLRenderTarget`, then the composite over the camera
  feed — so reading it after the composite reports 3 draw calls for a frame that
  really costs 23. `gameView.frameStats` is captured between the passes.
- **The render target's texture needs `SRGBColorSpace`** or the game renders
  visibly darker through the screen than it does at `/gauntlet`.
- **Each pass sets its own clear colour.** The composite clears transparent so
  the camera shows through; the game pass must clear opaque sky or the room
  shows through its own horizon seam.

**Birb AR Shooter** (`/gauntlet/ar/shooter/`) is the second app on the hub: drones
close in on your room from every bearing, you aim by moving the phone and tap to
launch rockets. It reuses `ar-camera.js` / `ar-gyro.js` and adds `drones.js`
(room-space swarm, 2 InstancedMeshes), `weapons.js` (rockets + explosion
particles, 2 more) and a fully synthesised `audio.js`. Four draw calls total.
Its own hard-won details:

- **Gauntlet's `nesting/drones.js` is NOT reusable here** and trying is a trap:
  those drones orbit a planet, take up from `normalize(pos)` and are placed
  against nests and terrain. Here the world is a living room and the player is
  a fixed point. Same silhouette, new module.
- **Rockets home, gently (7.6° cone, capped turn rate), on purpose.** You are
  aiming by waving a phone at a weaving target with no stick and no mouse. Pure
  ballistics tested as frustrating rather than skilful — every near miss read as
  the game's fault. It shipped at 15.2° and that was too generous (playtest:
  "the homing helps too much"), so it was halved. Note the two scales when
  tuning it: halving the cone halves the AIM ACCURACY demanded of the player,
  but quarters the hit rate of an unaimed shot, because solid angle goes as the
  square. The blind-fire harness score fell 4x for a 2x change.
- **The reticle's lock light reads `WEAPON_TUNING.homingCone`, never a
  literal.** It promises "a rocket fired now will steer onto that drone", so a
  hardcoded threshold silently becomes a lie the moment the cone is retuned —
  as it did, going gold ~2° wider than the homing would actually assist.
- **Wave 1 spawns within ±0.55 rad of where you are already looking**, widening
  ~0.6 rad per wave. At the first value (±0.95) most of wave one spawned outside
  a portrait phone's ~31° horizontal FOV, so the game opened on an empty wall
  and read as broken. The off-screen gold arrow that points at the nearest drone
  exists for the same reason and is not optional in a 360° shooter.
- **`SVGElement` has no `hidden` IDL property** — it does not inherit from
  `HTMLElement`. `svg.hidden = false` sets a stray JS property, leaves the
  attribute (and `display:none`) alone, and the reticle never appears. It is
  wrapped in a div.
- Verify play, not just paint: `node tools/ar-shot.mjs --page
  gauntlet/ar/shooter/index.html --fire 14` taps the trigger for 14s and reports
  the score, which is the only way to prove rocket → hit → kill → score works.

**Platform ceiling, not a TODO:** iOS Safari still exposes no WebXR `immersive-ar`
and no ARKit, so tracking is **rotation-only** — the screen holds its direction
as you look around but does not respond to you walking. Android Chrome does have
`immersive-ar` + hit-test, and an ARKit-backed web shell (App Clip style) would
convert this exact codebase to true 6-DoF anchoring. See `docs/AR-SPEC.md` §7 for
the native-port ladder.

Verify with `node tools/ar-shot.mjs [--go]`. It fakes a camera
(`--use-fake-device-for-media-stream`), grants the permission, synthesises
`deviceorientation`, clicks through the gate, and asserts on `window.__AR_STATS`
— a zero exit means the gyro produced a reading, the stream went live and
something actually rendered, not just that a PNG appeared.

### Icon3D — unlisted sibling at `/icon3d` (2026-09-07)

**Icon3D** turns an SVG icon into a 3D extruded object in code, the way
Blender's SVG importer plus an extrude does. Files live at `icon3d/`; it is
served at **birbmobile.vercel.app/svg** (a `vercel.json` REWRITE, so the short
URL stays in the address bar) and at `/icon3d`. Both paths are in `sw.js`'s
`SIBLING_ARTEFACTS` — the rewrite means the browser navigates to `/svg`, so
listing only `/icon3d` would leave the QR's own URL unprotected. Unlisted:
`noindex`, linked from nowhere.
It started as "the Copilot icon, like the Blender build, but code only" and
ships two marks (the September 2023 rainbow ribbon and the flatter August 2026
redesign) in **two readings**: **Ribbon**, one continuous strip of material
that rolls over at four lines and twists — what the artwork depicts, and the
default — and **Plates**, the flat extruded cut-outs an SVG importer makes.
Drag to orbit, pinch to zoom, pills for Ribbon/Plates, Colour/Clay, 2023/2026,
plus **GLB** (baked textures, opens in Blender) and **SVG** (a real vector
drawing of the view you are looking at). Three-finger QR as usual.

> **Read `icon3d/ARCHITECTURE.md` before touching it.** Same house rules as
> Gauntlet and Bronze: airtight against the rest of the repo, core Three only
> and pinned, zero assets. An icon is a JS table of `d` strings and gradient
> definitions transcribed verbatim from the source vector, not an SVG file.

Things that cost a round, or would have:

- **The reference was the 2023 mark, not the current one.** Every icon
  library still serves the 2023 sash shape; Wikipedia serves its exact Figma
  export, and the 2026 vector is only on Commons. Confirmed by rendering both,
  not by name — the 2026 one has no folds.
- **Gradients are evaluated per pixel in the fragment shader**, from the SVG's
  own `gradientTransform`, stops and stop-opacity. Vertex colours on an
  extruded cap's few big triangles cannot reproduce a radial sweep. The GLSL is
  emitted from the same table the JS reference evaluator reads, and the gate
  measures them against each other: 0.25/255 mean error.
- **`bevelOffset = -bevelSize`**, or the bevel grows the plate outside its
  outline and pieces that share an edge in the SVG collide.
- **Each piece needs its own `customProgramCacheKey`**; identical
  `onBeforeCompile` closures share a compiled program and every plate gets the
  first gradient.
- **Holes are decided by nesting depth and orientation, for both fill rules.**
  Three's `ShapePath.toShapes` decides by winding alone and fills in the hole
  of an evenodd export whose rings run the same way.
- **The gate has an independent oracle.** Silhouette IoU is measured against
  the browser's own `Path2D` fill of the same path data (0.9985–0.9995 per
  piece); the export bake is rendered and compared too, which is the only
  check that can see a vertically mirrored texture.
- **The ribbon's rulings stay in the picture plane; only their ENDS carry
  depth.** Front-on the depths vanish and the projection is the artwork; from
  any other angle the depths are the whole object. Rotating the ruling out of
  plane instead — a helicoidal twist, or leaning it until the width is truly
  constant — is geometrically purer and looks wrong: 0.76 IoU and a strap that
  projects as a bow-tie, or a strap that explodes into an 18-unit fan where the
  drawn ruling is 1.4 units.
- **A strap's outline is mostly clip.** Its tips lie on a band's outline (≤0.17
  units) and are occlusion, not material; the V notch and the sliver that
  overshoots the transition line are tuck allowance hidden under a band.
  Leaving the tuck in the edge costs 15 points of IoU because it eats half the
  arc length.
- **The gate's floor depends on the builder** — 0.985 for plates, 0.86 for the
  ribbon — and both numbers are printed. Relaxing it for both would hide a
  regression; relaxing it for one and reporting the value describes the model.
- **A raster is not a Visio object.** The SVG export projects the real meshes
  and emits paths, one group per component, with the brand gradients still
  gradients under a fitted `gradientTransform`. `up` is `view × right`; the
  other order mirrors the whole drawing and reads as a colour bug.
- **`ExtrudeGeometry`'s inset bevel grows a burr at a cusp** — the band's
  razor tip, where two edges meet at ~0° and the bevel vector is an arbitrary
  clamped direction. `clampToOutline` pulls those vertices back; the tolerance
  scales with the outline's extent, because float32 rounds a 513-unit viewBox
  ten times coarser than a 48-unit one.

Verify with `node tools/icon3d-shot.mjs --page icon3d/index.html --out shot.png
--query three=local --gate` (needs `npm install --no-save playwright
three-real@npm:three@0.183.2` then `git checkout -- node_modules/three/index.js`).
`/icon3d` is in `sw.js`'s `SIBLING_ARTEFACTS`; the reason is under Gauntlet.

### Baby Blender — the iPad app, not a web artefact (2026-09-05)

**Baby Blender** is the one thing in this repo that is not a web page. It is a
native iPadOS app: sculpt and paint a protected fixed-topology model with the
Pencil, then export something a game engine can open. It lives in
`humanoid/` (Swift package, builds and tests on Linux) and `humanoid/app`
(XcodeGen spec for the iPad shell).

**Read `docs/PRD-humanoid-creator-v0.1.md` before touching any of it**, and
`docs/humanoid-creator-validation/REPORT.md` for the research the plan rests on.
Both keep their old filenames; the product was named Baby Blender on 2026-09-05.

Two document types, one engine:

- **Clay** — a pre-subdivided rounded cube, no rig, exports a static mesh.
  **Ships first.**
- **Humanoid** — 51 bones, T-posed, exports an avatar Unity maps as a Humanoid
  for the normal VRChat flow.

Things that will cost a round if you undo them:

- **Topology is immutable.** No remeshing, no subdivide, no vertex is ever
  created or destroyed. That is what lets every adjacency, symmetry-pair and
  seam-partner table be generated offline and the runtime use flat arrays
  instead of a half-edge mesh. Clay being *pre*-subdivided is the whole trick;
  a literal 8-vertex cube would be unsculptable.
- **`rig` is optional, not empty.** A zero-bone skeleton for Clay would put
  `if boneCount > 0` through the skinning, export and validation paths, and
  every one of those is a silent failure waiting to happen.
- **`build_template.py`'s T-pose report is tautological** — it measures
  head-to-tail of bones it just aimed, so it reads 0.00 degrees whatever the
  body did. `tools/check_template.py` is the real oracle: it shares no code with
  the baker, re-derives from the written bytes, and measures head to CHILD head,
  which is what Unity's `AvatarAutoMapper` actually scores. It found four
  defects the report structurally could not see.
- **Keep all eight stages of `tools/verify.sh` green while Clay is built.** The
  humanoid work is finished and unattended, which is exactly how code rots.

**Engine state (2026-09-06):** sculpt, paint, picking, tables and the document
with undo are all built and tested headless — 133 tests, eight verify stages.
Three things in there are non-obvious and were each found by a failing test:
brushes address WELDED positions (a UV seam stores one point two or three times,
and moving one copy tears the surface); a paint stroke carries its leftover
distance ACROSS segments (resampling each segment alone double-stamps the joins,
so a stroke delivered as 50 events came out 10x darker than the same path as 2);
and `MeshTables` keys its weld map on the quantised coordinate TRIPLE, never a
hash of it (a hash welded 3,750 vertices down to 2,024, fusing unrelated parts
of the surface).

**First device run, and the editor rebuild (2026-09-08):** the app compiled and
ran on the iPad first time; everything the Linux tests covered worked. The three
things that did not are now fixed, and the whole story — diagnosis, sourced
platform research, measured numbers, what shipped — is in
`humanoid/docs/Editor_Feel_Plan.md` and `humanoid/docs/Performance_Research.md`.
**Read both before touching the editor loop.** The short version:

- **"Sometimes it goes inside out" was never winding.** Inflate, Deflate, Smooth
  and Paint did nothing until pen-up and then stamped ONE DAB PER PENCIL EVENT at
  a per-gesture amount, so a held pen extruded a spike that folded through
  itself. Reproduced headless in `SculptStrokeTests`, where the surface stops
  being raycastable. Strokes are resampled to a dab per quarter radius now, and
  a stroke advances by POINTER travel — measured by the surface instead, Inflate
  partly measures its own output.
- **Paint bled across the atlas because a disc in UV space always will.** The
  brush is a sphere in world space now (`SurfacePaint`), with the texels each
  triangle owns precomputed — legal because topology and UVs are immutable.
- **The lag was scheduling, not maths.** Every sculpt op is under 0.2 ms; the
  whole chain simply ran per event at up to 240 Hz. Input is queued and drained
  once per frame now.

Four performance traps recorded there, each of which cost a measured pass:
dilating every triangle's texel footprint (not just island edges) made the paint
map own 195% of the texture and was SLOWER than the naive painter; three signed
`Int` divisions by 255 cost more than all the geometry above them; four nested
`withUnsafeBufferPointer` closures defeated the type checker, and a body the
compiler cannot type is one it does not optimise; and **`@testable import`
numbers are not release numbers** — it compiles the library with
`-enable-testing`, which hid several fold of this loop's cost.

Benching: `swift build -c release && ./.build/release/humanoid-cli bench` is the
authority (it opens with a control loop that calibrates the machine, so nothing
gets called slow without a baseline). `BABY_BLENDER_BENCH=1 swift test -c release
--filter BenchmarkTests` still covers the sculpt path, where the difference does
not signify. Three-finger tap in the app shows the on-device readout.

**Second device run (2026-09-19): the cube rendered and orbited; the Pencil
did nothing, two fingers fought, and the whole run was a Debug build.**
Diagnosis and the fixes are in `humanoid/docs/Device_Pass_2.md` (§7 is what
shipped) — read it before touching `SculptView`, `EditorModel` or `Camera`.

**`isPaused = false` does nothing once `enableSetNeedsDisplay` is true.**
Apple's MetalKit header says enabling it "will also pause the MTKView's
internal render loop and updates will instead be event driven", so the
viewport's "go continuous during a stroke" switch was dead. Pencil samples
queued and were only applied when an unrelated finger moved the camera; the
hover ring never appeared and the flick never coasted, all from the same line.
The multi-second "Hang detected" reports are most plausibly that queue dumped
into one debug-build frame. `onActivity` flips BOTH properties now, and
anything that queues a sample also calls `requestDraw`. **A queue is not a
loop; it has to poke one.** Two more silent no-ops went with it: a stroke that
started a millimetre off the model was dead for its whole length, and nothing
on screen said that fingers move the camera.

**One recogniser, not three.** A `UIPanGestureRecognizer` capped at one touch
does NOT fail when a second finger lands — it keeps tracking the first — so
with simultaneous recognition on, a two-finger drag was an orbit AND a pan AND
a pinch at once. `NavigationGesture` counts its own touches and re-reads its
reference centroid on every 1↔2 transition.

**The camera is pivot plus a view-plane offset now**, and the split is what
makes the three gestures independent: orbit turns around `pivot`, pan moves
`offset`, and `setPivot` moves the orbit centre with the eye **bit-identical**,
so two fingers landing can re-centre the orbit invisibly (Nomad's rule).
`pan` takes PIXELS — the old form normalised x by the width and y by the
height while scaling both by the vertical extent, so on a landscape iPad the
model tracked the fingers vertically and lagged them horizontally. Mutation-
tested: restoring it reads **77.14 against 120**, which is 120 over the
1400x900 aspect ratio. Pinch is anchored between the fingers. Every rule is
stated through the new `project()`, the exact inverse of the picking ray —
**a camera rule you cannot phrase as "this point lands here" is not tested.**

**Grab is captured at the start of the gesture** (`Sculpt.GrabSet`): it re-
picked the surface every frame, so a drag that pulls the surface out from
under itself ended up holding a different set than it started with. Every
frame now places the captured set at the TOTAL displacement, so sixty frames
land where one call would to 1e-12 and undo returns exactly.

**Also:** `camera` and `document` are no longer `@Published` (between them they
rebuilt the SwiftUI toolbar at up to 120 Hz); a **Release scheme ships in
`project.yml`**, because Xcode's Run button builds Debug and no number from a
Debug run with the debugger attached is a number about the app; `os_signpost`
intervals and a HUD queue-depth counter make the next report arrive with
numbers. **Unmeasured on the iPad: all of it** — 224 core tests and
`verify.sh` PASS is what exists, and the acceptance checklist is
Device_Pass_2 §6.

**Third device run (2026-09-20): "the pencil wasn't working then did",
Inflate barely moved the surface, paint did nothing — and the console still
said `BabyBlender.debug.dylib`.** `docs/Device_Pass_2.md` §8. The Debug build
explains the latency and the `Hang detected` lines, and **"System gesture gate
timed out" is a symptom of a blocked main thread, not a gesture bug** — the
gate waits on the main thread and a 0.9 s hang misses its window. Three real
defects came out anyway.

**`beginStroke()` opened with `guard !strokeOpen else { return }`, so ONE
stroke whose `.ended` never arrived blocked every stroke for the rest of the
session** — no arm, no undo group, no paint stroke, while the Pencil went on
reporting. Ends do go missing: a touch cancelled during a hang may never
deliver one, and `editingTouch` is a weak reference to a `UITouch` UIKit is
free to recycle. A new touch-down force-closes the stranded stroke, the view
releases a touch whose phase has already ended, and a five-second watchdog
catches the rest. **A guard that protects a state machine from re-entry also
traps it there.**

**Inflate was weak twice over.** `radiusPoints` is in screen POINTS and
`metresPerPixel` is per DRAWABLE pixel and nothing converted between them, so
a "46 point" brush was 23 points on every 2x iPad — and Inflate's
displacement scales with the radius, so that halved the effect too.
`inflatePerDab` was then too small on its own: measured, one 50 mm pass at
full strength moved the clay **3.28 mm**, under 1.5% of the model's width.
0.04 -> 0.09 (gain 0.36, ceiling 0.125) takes it to 7.5 mm, and there is a
FLOOR test now as well as the convergence ceiling — the old value fails it.
**A gain ceiling alone is satisfied by a brush that does nothing.**

**Paint froze instead of painting.** `beginPaintStroke` builds the paint map
on demand on the MAIN THREAD, which is the 2,919 ms the console reports, so
painting in the first few seconds was a three-second freeze with the stroke
lost. It refuses to build it now, says so in a toast (`status` existed and
nothing had ever displayed it) and arms the moment the background build
lands, mid-gesture.

**Two costs removed on the way, both pure waste:** `Document.sculpt` scanned
every welded position per dab centre to compute a generous superset of what
`Sculpt.apply` already returns, and `Sculpt.dab` snapshotted all 3,750
positions per dab when only Smooth reads across weld groups. Redundant
raycasts are skipped too — a sample under two drawable pixels from the last
is folded into the next WITHOUT advancing the travel, so the path is
unchanged. **Also corrected: this repo's own acceptance checklist said
"Inflate held still raises the surface", which asks for the 2026-09-08 spike
bug back.** Dabs are spaced along the PATH; a stationary pointer emits none,
by design.

Unity/VRChat state: the FBX imports and Unity builds a Humanoid Avatar from it
on the first attempt. Unity's auto-mapper leaves **Chest unmapped**, which Unity
tolerates and VRChat's `AnalyzeIK` does not — assign it by hand for now. Mirror
handedness and the SDK panel are still unverified.

## What This Is

A mobile-first 3D bird flight game built with Three.js. A bird flies on a spherical world — you control it with touch (virtual joystick), collect rings, shoot rockets from nests, and fight drones. Four game modes: Casual free flight, Ring Rush (timed collection), Drone Hunter (60s survival), Turret Defense (wave-based).

**Target platform:** iOS Safari (iPhone 12+), Android Chrome, desktop for testing.
**Deploy:** Vercel static hosting. Push to main → auto-deploys.

## Who Made This

**Mentis** (Adam Rappaport) — call him Mentis, not Adam.

## Default Interaction Mode

**Assume the user is a Vibe Academy student** unless they indicate otherwise. This means:

- **Teach, don't just do.** Walk through changes step by step. Explain *why*, not just *what*.
- **Ask what they want to learn.** Before diving into code, understand their experience level and what they're trying to get out of this.
- **Point them to the right starting place.** Use the "Notes for Vibe Academy" section below to suggest tasks matched to their level.
- **Let them drive.** Offer options rather than making choices for them. The goal is learning, not shipping.
- **Keep it fun.** This is a game. The vibe should be playful and encouraging.

**To exit student mode:** If the user says "admin", "Mentis", or otherwise implies they're the project owner, switch to direct execution mode — just make the changes, skip the teaching, and focus on shipping.

## House Rules

1. **Never test locally unless you must** — push to git, Vercel auto-deploys at birbmobile.vercel.app
2. **Git remote uses SSH** — `git@github.com:Mentis123/birb.git`
3. **Mobile-first always** — touch devices are primary, desktop is for testing only
4. **Zero-allocation game loop** — reuse objects with `_` prefix, never allocate in update()
5. **No build step** — this is vanilla JS with ES6 imports from CDN. No webpack, no bundler.
6. **Preserve the fun** — this is a game. Changes should make it more delightful, not more complex.

## Product Intent

Birb Mobile should feel **playful, responsive, and alive**. The bird should feel good to fly. The turret should feel heavy and satisfying. The rings should feel rewarding to collect. Performance must hold 60fps on mid-range mobile.

**Non-goals:** Realistic flight simulation, desktop-first design, unnecessary abstractions that make learning harder, framework dependencies.

## Architecture Overview

**Stack:** Three.js (WebGL), vanilla JavaScript (ES6 modules), HTML5 Audio, nipplejs (virtual joystick). No frameworks, no build tools.

**Entry point:** `index.html` — single-file game (~5600 lines). Imports modular systems from `src/`.

```
index.html (main game loop, scene setup, state coordination)
├── src/flight/          Flight physics, bird visuals, touch input
├── src/controls/        Input aggregation, joystick, thumbstick UI
├── src/camera/          Follow cam, FPV cam, mode switching
├── src/nesting/         Nest landing, turret aiming, rockets, drones
├── src/environment/     Spherical world, sky dome, collectibles, trails
├── src/effects/         Particles, screen shake
├── sound/               Audio assets (mp3)
├── basic/               Minimal reference implementation
├── AR/                  Experimental AR branch (not integrated)
└── docs/                Technical documentation
```

**Data flow:**
```
Touch Input → flight-controls.js → bird-flight.js → Three.js Render
                                        ↓
                                 position + quaternion
                                        ↓
                              camera, collectibles, drones
```

**Key CDN imports:**
- `three@0.183.2` from esm.sh
- `nipplejs@0.10.1` from esm.sh
- GLTFLoader from Three.js examples

## Key Files

| File | What It Does |
|------|-------------|
| `index.html` | Main game — scene, loop, UI, audio, all systems coordinated |
| `src/flight/bird-flight.js` | Current flight controller (vector-based) |
| `src/controls/simple-flight-controller.js` | Legacy flight controller (kept as reference, unwired) |
| `src/flight/touch-input.js` | **Live** touch input path (raw clamp → `bird-flight.js`) |
| `src/flight/flight-recovery.js` | FLYING/FALLING/GROUNDED state machine core — states enum, config, fall-ramp/launch-boost timer math + `createFlightRecovery()` factory (side effects injected as callbacks; no THREE/DOM; unit-tested) |
| `src/game/game-modes.js` | Game-mode core — `GAME_MODES` enum, mini-game state shape/reset, win/lose conditions (Ring Rush rings, Drone Hunter 60s, Turret lives + 2+wave curve), combo/scoring + best-score math (no THREE/DOM; unit-tested) |
| `src/controls/flight-controls.js` | Input shaping (deadzone/expo/smoothing) — wired but its shaping methods are no-ops on `BirdFlight`; see CODEBASE_EVALUATION.md |
| `src/camera/follow-camera.js` | Third-person chase camera with damping |
| `src/nesting/nesting-system.js` | Nest landing/takeoff state machine |
| `src/nesting/aim-rig.js` | Turret aiming with spring-damper inertia |
| `src/nesting/rocket.js` | Projectile system with arc trajectory |
| `src/nesting/drone-system.js` | Enemy drone spawning and AI |
| `src/environment/spherical-world.js` | Sphere + collision system |
| `src/environment/water.js` | Standing water — lakes/tarns/pools/harbour (unit-tested) |
| `src/environment/weather.js` | Per-biome snow/pollen/dust/drizzle, all shader-side (unit-tested) |
| `src/environment/city-windows.js` | Procedural lit windows + street grid for the city |
| `src/effects/wake.js` | Ripples under a bird flying low over water (unit-tested) |
| `src/effects/bloom-pass.js` | Bloom + light shafts + vignette + speed smear, one pass |
| `src/environment/collectibles.js` | Ring collection with proximity detection |
| `src/environment/collider-grid.js` | Spatial-hash collision broad-phase (unit-tested) |
| `src/ui/minimap.js` | Minimap radar (extracted from index.html; pure helpers unit-tested) |
| `docs/ULTRACODE_REALISM_PLAN.md` | How to run the realism backlog with an agent fleet: the tiering law + art corollary, the 16-wave plan, the cost model, and the blind paired forced-choice check that is the only thing able to catch a green stage that did not improve the game |
| `docs/realism/AUTHORED_ASSETS.md` | The authored-asset contract + the brief an external image agent (Codex) works from. Root Birb only — the siblings keep their zero-asset rules |
| `tools/asset-check.mjs` | Structural acceptance for authored textures (tiling, baked light, colour space by suffix, POT, budget). Runs in CI over `assets/`; empty root exits 0 |
| `CODEBASE_EVALUATION.md` | Four-domain evaluation: scorecard, findings, prioritized roadmap |
| `gauntlet/ARCHITECTURE.md` | Birb Gauntlet (`/gauntlet`) — read before touching it |
| `sculpture/ARCHITECTURE.md` | Bronze (`/sculpture`) — module map, invariants, verification, plan |
| `sculpture/LIKENESS.md` | Bronze — the 41-check rubric and the current score |
| `KNOWN_ISSUES.md` | Bug tracker with detailed fix attempts |
| `FLIGHT_CONTROLS_PLAN.md` | 4-phase flight system redesign plan |
| `TURRET_RESEARCH.md` | Gun feel research, spring-damper physics |
| `docs/PRD-game-modes.md` | Game mode specifications |
| `basic/index.html` | Minimal reference implementation (single-file) |

## Flight Direction — ✅ RESOLVED

The spherical flight direction bug — where the bird flew in a fixed world direction regardless of facing — was the longest-running issue in this project (Dec 2025 – Jan 2026). It is now **fixed and working in production.**

The active controller (`src/flight/bird-flight.js`) uses vector-based forward direction tracking with parallel transport and sphere re-projection. The legacy `src/controls/simple-flight-controller.js` is kept as reference only.

See `KNOWN_ISSUES.md` Issue 5 for the investigation history.

## Key Technical Patterns

**Zero-allocation game loop:** All vectors and quaternions pre-allocated in constructors with `_` prefix. No `new Vector3()` in update(). Target: <1ms GC per frame on mobile.

**iOS audio:** Web Audio API doesn't work on iOS Safari. Use HTML Audio elements with a `Set` reference pool to prevent garbage collection clipping sounds.

**Control feel tuning:**
```
Forward speed: 3.5-7 m/s    Yaw rate: 135°/sec
Pitch rate: 108°/sec         Max bank: 65°
Joystick deadzone: 0.15      Expo curve: 0.32
Input smoothing: 0.3
```

**Turret feel:** Spring-damper system (C0=8.0 stiffness, C1=6.0 damping). Heavy, inertial, momentum carry-through on release. See `TURRET_RESEARCH.md`.

**Performance budget:** 60fps, <100 draw calls, <80k triangles, <50MB heap, <16ms frame time.

**Mobile rendering:** DPR capped at 1.4 (mobile) / 1.8 (desktop). Adaptive quality via performance manager.

## Environment Variables

None — this is a static site with no backend.

## How to Run

```bash
# Local (for testing only — prefer pushing to Vercel)
python3 -m http.server 8000
# Open http://localhost:8000 on mobile or desktop
```

For mobile testing: use Edge DevTools device emulation, or access via local network IP on phone.

## Safe Change Zones

**Safe to edit:**
- Copy/text in UI overlays (in `index.html` HTML section)
- Visual styling (CSS in `index.html`)
- Tuning constants (speeds, rates, deadzones in controllers)
- Sound effects (swap mp3 files in `sound/`)
- Particle effects and visual juice
- Game mode balancing (scoring, timers, spawn rates)

**Edit carefully:**
- `src/flight/` — flight physics affect everything
- `src/nesting/nesting-system.js` — state machine is delicate
- `src/controls/flight-controls.js` — input pipeline affects feel
- Camera systems — bad changes cause motion sickness

**Never touch without explicit permission:**
- Three.js import URLs (version pinned for stability)
- Performance manager thresholds (tuned for mobile)
- The `_` prefixed pre-allocated objects (zero-allocation pattern)

## Common Tasks

| Task | Where to Look |
|------|--------------|
| Tweak flight feel | `src/flight/bird-flight.js` — speed, rates, damping |
| Adjust turret feel | `src/nesting/aim-rig.js` — spring-damper constants |
| Add a sound effect | `sound/` folder + audio system in `index.html` (~line 1198) |
| Change game mode balancing | `index.html` game mode sections + `docs/PRD-game-modes.md` |
| Improve mobile controls | `src/flight/touch-input.js` (live path) + `src/flight/bird-flight.js` — the shaping in `src/controls/flight-controls.js` is currently inert |
| Add visual effect | `src/effects/particles.js` or `src/effects/screen-shake.js` |
| Fix a camera issue | `src/camera/follow-camera.js` or `fpv-camera.js` |
| Performance optimization | Adaptive quality is inline in `index.html` (search `__birbPerfDebug`); collision broad-phase in `src/environment/collider-grid.js` |

## Code Conventions

- **Three.js quaternion:** `premultiply` = apply first, `multiply` = apply after
- **Euler order:** `'YXZ'` (yaw around Y, then pitch around X)
- **Object reuse:** `_` prefix for pre-allocated scratch objects (e.g., `_tempVec`, `_tempQuat`)
- **No `new` in update loops** — ever
- **ES6 modules** from CDN — no bundler, no build step
- **Squared distance** for proximity checks (avoid `Math.sqrt`)

## Known Issues

1. ~~Spherical flight direction bug~~ — **RESOLVED.** Fixed in `src/flight/bird-flight.js`. See `KNOWN_ISSUES.md` for history.
2. ~~Eruda debug console in `index.html`~~ — **RESOLVED.** Already removed.
3. iOS audio full duration testing incomplete
4. ~~`src/performance/` dead code~~ — **RESOLVED (2026-06-11).** The ~3,500-line never-imported directory (plus `ambient-particles.js`, `speed-trail.js`) was deleted; git history retains it. Live adaptive quality is inline in `index.html`; the collision broad-phase shipped as `src/environment/collider-grid.js` (tested), superseding `optimized-collision.js`.

See `KNOWN_ISSUES.md` for detailed history and fix attempts.

---

## Notes for Vibe Academy

This is a **breakable toy** — a real, playable game you can pull down, modify, and make your own. The whole point is to get your hands in it. Below are things to try, roughly ordered from "I've never touched code" to "I want a real challenge."

### First Steps (Do These First)

1. **Play it** — open birbmobile.vercel.app on your phone. Fly around. Try all four game modes (Casual, Ring Rush, Drone Hunter, Turret Defense). Get a feel for what it does.
2. **Clone and run it** — `git clone git@github.com:Mentis123/birb.git`, then `python3 -m http.server 8000` and open it in your browser. You're now running the game locally.
3. **Open `basic/index.html`** — this is the stripped-down version. Read it top to bottom. It's the simplest possible flight game — one file, no complexity. This is your Rosetta Stone.

### Things to Try: Reskin & Retheme

These are visual/audio changes — low risk, high reward, instant gratification.

- **Change the world colour** — find the sky dome setup in `src/environment/sky-dome.js`. Change the sky gradient. Make it sunset orange. Make it alien green. Push it and see your world on Vercel.
- **Swap the music** — drop a new mp3 into `sound/` and update the ambient music reference in `index.html` (search for `ambient-forest`). Your world, your soundtrack.
- **Change the ring collect sound** — replace `sound/ring-collect.mp3` with any short sound effect. A coin ding? A whoosh? A voice saying "nice"?
- **Modify the rocket explosion** — in `index.html`, find the explosion particle effect. Change the colour, the size, the count. Make it fireworks. Make it confetti.
- **Restyle the UI** — the game mode selector, the score display, the splash screen — it's all CSS in `index.html`. Retheme it. Dark mode? Neon? Retro?

### Things to Try: Tweak the Feel

These change how the game *feels*. Small numbers, big impact. Great way to understand game design.

- **Make the bird faster** — in `src/flight/bird-flight.js`, find the speed constants. Double them. Now halve them. Which feels better? Why?
- **Change how tight the turns are** — find `YAW_RATE` and `PITCH_RATE`. Crank them up for an arcade feel. Lower them for a floaty glider.
- **Adjust the camera** — in `src/camera/follow-camera.js`, change the offset distance. Pull the camera way back for a cinematic feel. Push it close for intensity.
- **Make the turret snappier or heavier** — in `src/nesting/aim-rig.js`, the spring-damper constants (`C0` and `C1`) control how the turret feels. Higher C0 = snappier. Higher C1 = more damped. Try extremes.
- **Change the drone speed** — in `src/nesting/drone-system.js`, find how fast drones approach. Make them terrifying. Make them lazy.

### Things to Try: Modify Game Modes

Now you're changing what the game actually *does*.

- **Change Ring Rush rules** — find the Ring Rush setup in `index.html`. Change the ring count from 10 to 25. Add a speed multiplier. Change the timer.
- **Make Drone Hunter harder** — increase spawn rates, make drones faster, reduce the time limit. Or make it easier — more time, slower drones, more ammo.
- **Invent a new scoring rule** — what if you got bonus points for collecting rings while banking? Or a combo multiplier for consecutive hits?
- **Add a new collectible** — use `src/environment/collectibles.js` as a template. Create speed boost pickups, shield orbs, or ammo crates scattered on the sphere.

### Things to Try: Add Features

Real features. Real shipping. Real learning.

- **Add haptic feedback** — use the Vibration API (`navigator.vibrate(50)`) to add a buzz when you fire a rocket or collect a ring. Mobile-only, but very satisfying.
- **Add a new particle effect** — feathers when you graze the ground? Sparks on near-misses? Look at `src/effects/particles.js` for the pattern.
- **Build a simple HUD element** — altitude meter, speed gauge, compass direction. Pure HTML/CSS overlaid on the canvas.
- **Add a new sound layer** — wind intensity that changes with speed, a heartbeat at low health, a crowd cheer on high scores.

### The Big Challenge

- **Study how the spherical flight bug was solved** — the bird used to fly in a fixed world direction regardless of facing. Read `KNOWN_ISSUES.md` Issue 5 for the investigation saga, then study the fix in `src/flight/bird-flight.js`. This is a masterclass in quaternions, spherical geometry, and vector-based direction tracking on curved surfaces.

### What You'll Learn Along the Way

- **Three.js** — how 3D scenes work in the browser (scene, camera, renderer, game loop)
- **Game feel** — why numbers matter, how small tweaks change everything
- **Mobile development** — touch controls, performance budgets, iOS quirks
- **Physics** — quaternions, spherical geometry, spring-damper systems
- **Audio** — web audio on iOS, sound pools, volume mixing
- **Shipping** — from code change to deployed, playable game that others can try

---

## First Suggestions for Claude

If you're an AI assistant working on this repo:

1. **Default to student mode.** Assume the user is a Vibe Academy learner. Teach, explain, offer choices. See "Default Interaction Mode" above.
2. **Read `KNOWN_ISSUES.md` and `FLIGHT_CONTROLS_PLAN.md`** before touching flight code
3. **Good quick wins:** Remove eruda console, clean up debug UI, improve mobile CSS
4. **Good improvement:** Add screen shake intensity options, improve ring spawn variety
5. **Always test on mobile** — desktop behaviour is not representative
6. **Preserve zero-allocation** — never add `new` calls inside the game loop
