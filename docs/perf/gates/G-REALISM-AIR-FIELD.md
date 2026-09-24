# G-REALISM-AIR-FIELD — air with structure: thermals, ridge lift, gusts

**Date:** 2026-09-23. **Branch:** `realism/air-field` off `e252ca1`.
**Flag:** `air` (Flags tab, toggle, **ON by default**); `?air=0` is the true
before. `?airtune=key:value,...` overrides any number in
`AIR_FIELD_DEFAULTS` at boot, the same convention as `?stunttune=`.
**Decision:** SHIP behind the toggle, pending the phone. Nothing here has
been flown on glass.

## What it is for

Until this package the air over the planet was a vacuum with a sink rate:
the stunt model's `sinkRate()` is what is left of gravity when the WING is not
carrying the bird, and nothing else moved it. The owner's words that set the
current tuning were *"it stalls way too much ... it's no longer a fun relaxing
experience"* (G-STUNT-1). Rising air is the relaxed way up: fly level through
a sunlit thermal with your hands off the stick and the bird is carried.

## What shipped

- **`src/flight/air-field.js`** — pure (no THREE, no DOM), zero allocation in
  `update()` and `sample()`. One field per biome, three readers: the flight
  (how fast the air rises here), the scenery (how hard the wind blows the
  canopies this frame) and the pose (is a gust hitting the wings).
  - **Thermals — Allen 2006** (NASA Dryden, AIAA 2006-1510, Appendix B),
    line for line: mean updraft `w = w*·(z/zi)^(1/3)·(1 − 1.1 z/zi)`, outer
    radius `r2 = max(10 m, 0.102·(z/zi)^(1/3)·(1 − 0.25 z/zi)·zi)`, r1/r2
    from r2, the bell from the paper's own shape table, the sinking ring at
    the edge of the upper half, and a sink between thermals. Heights map by
    `zi` = 60 world units (zero lift at 0.909 zi, **exactly zero at and above
    zi**); radii by `unitsPerMetre` against a 1200 m layer, because a
    thermal squashed into a 60-unit flight band would be two units wide.
    Eight sites per biome, seeded from the biome name (`hashSeed('air-field:
    forest')`), never on water, spaced 0.8 rad (96 units of arc) apart,
    chosen on exposed, convex ground — the forest's own tree line dwarfs
    and thins trees on the high ground, so high ground IS the low-canopy
    ground, and it is decided by the terrain, which is deterministic. Each
    thermal's **heat is its own slope's insolation under the live key light**
    (`w* ∝ H^(1/3)`), re-read every frame: a slope facing the sun lifts, one
    facing away is plain environment.
  - **Ridge lift — Bohrer et al. 2012**: `w = U·sin(θ)·cos(α − β)`, written
    as `(V·∇h)/sqrt(1 + |∇h|²)`, from finite differences of the SAME
    `sampleTerrainHeight` the flight floor uses. The prevailing wind turns
    about an axis that itself precesses (a 1200 s veer, a 170 s breath), so
    it lives in the local tangent plane everywhere and is divergence-free on
    the sphere. Decays as `e^(−z/12)`, gone by `zi`.
  - **Gusts — Dryden-like**: one first-order filtered noise per axis
    (along, cross, vertical), discretised exactly for any frame time
    (`a = e^(−dt/τ)`, `τ = L/U`), so the statistics do not depend on frame
    rate (tested at 1/120 and 1/30 s: within 20% of σ). **Visual only.**
- **`src/flight/bird-flight-stunt.js`** — an optional injected
  `airSampler(x, y, z) -> w`. Null is the default and is the exact before.
  The air moves POSITION along the radial, never the orientation, applied
  after the sink and before the floor clamp (which keeps the last word and
  is untouched), gated exactly like the sink: never while the speed is
  commanded (walking, falling, `freeze`, the nest's hand). Classic never
  sees it (its `update()` is v1's). `lastAir` reports what was applied.
- **`index.html`** — the field is rebuilt in `setEnvironment` (the thermals
  sit on THIS biome's terrain), stepped every frame just before
  `flight.tick()` with the key light's direction, injected into the stunt
  flight, and read once more at the bird for everyone downstream:
  `airState {updraft, thermal, ridge, gust, gustSide, gustAlong, wind}`.
  The foliage wind uniform is `density × windVisual` (1.0 at the mean wind,
  more in a gust, less in a lull or a calm eye, bounded 0.2-2.2).
  Hooks (`?debug=1`): `__BIRB.air(attach)` (the in-page A/B:
  `air(false)` detaches the field from the FLIGHT only),
  `__BIRB.airAt(x, y, z, aboveGround)` (the air anywhere, without moving
  the bird), `__BIRB.goToThermal(i, aboveGround)`, and `flightProbe().air`.
- **`src/environment/spherical-world.js`** — the mountain's pine crowns
  sway in the same wind: `addFoliageWind(pineCanopyMat)`, FIRST in the chain,
  which is the exact order `tests/organic-foliage.test.js` already composes
  for that material (wind, then snow, then the leaf edge). `?air=0` leaves
  the pines as still as they were.
- **Checks**: `tests/air-field.test.js` (28), and
  `tools/realism-checks/air-field-a-thermal.mjs` +
  `air-field-b-still.mjs` (the second boots `?air=0`).

## Measured

### The stunt law with no sampler is the base commit's, to the bit

A 14-second replay through every term of the law — rolls, a push, a
rudder-and-pitch combination, idle throttle, a boost, a pull, a commanded
speed and its handover, a hard roll — at the pole and on the equator, with
terrain the bird hits (**305 frames on the floor at the pole, 174 on the
equator**). Run against `git show e252ca1:src/flight/bird-flight-stunt.js`
and this branch, compared every frame: **6,720 values per site, 0
different** with no sampler and **0 different** with a sampler that returns
still air. The test pins one row per second against that golden.

### A thermal carries a hands-off level bird; the control does not move

Live page, SwiftShader, `quality=amazing`, forest, sun time frozen at 0,
the strongest lit thermal, 18 units over its ground, 40 frames of
hands-off level flight. The same pose is flown three times:

| run | height change | |
|---|---|---|
| air on | **+4.25** in 1.95 s of sim time | core 2.66 u/s, r2 38.8 |
| same boot, `__BIRB.air(false)` | +0.042 | the control |
| separate boot, `?air=0` | +0.041 | the flag's off path |

The applied air read 2.5 (the ceiling) at the core and 1.54 as the bird
flew out through the bell. Above the layer: `setAltitude(220)` reads exactly
0 applied and 0 sampled on every frame, which is what keeps
`tools/birb-stunt.mjs` (every figure flown at 220) untouched.

### The Allen column, as mapped (unit thermal)

| z (units above ground) | z/zi | core (u/s) | r2 (units) |
|---|---|---|---|
| 3 | 0.05 | 1.88 | 20 |
| 10 | 0.17 | 2.36 | 29 |
| 13.6 | 0.227 | **2.39 (peak)** | 32 |
| 15 | 0.25 | 2.38 | 33 |
| 20 | 0.33 | 2.27 | 35 |
| 30 | 0.5 | 1.83 | 38 |
| 40 | 0.67 | 1.19 | 40 |
| 54 | 0.9 | 0.05 | 41 |
| 57 | 0.95 | −0.23 (the cap) | 41 |
| ≥ 60 | ≥ 1 | **0, exactly** | — |

The analytic peak of the paper's mean profile is z/zi = 1/4.4 = 0.227; the
test asserts the core peaks between 0.2 and 0.3.

### The thermal was re-sized against the stunt law's own turning circle

The inherited width (`unitsPerMetre` 0.36, r2 = 26 at fifteen up) was
justified as "a thermal a relaxed 40-degree turn can stay inside". That was
never measured, and it does not hold. Measured on `BirdFlightStunt`, a
banked pull settles into:

| bank | pull | turn radius | pitch it settles at |
|---|---|---|---|
| 30-75° | 0.3 | 29-31 | 38° |
| 60° | 0.4 | 27 | 42° |
| 60° | 0.5 | 24 | 46° |
| 60° | 0.6 | 19 | 52° |

Every one of those is a CLIMBING spiral — +2.3 to +4.3 u/s in still air,
speed bleeding to 7.5-9.6 — because under this law a sustained pull is a
climb whatever the bank. So what a thermal adds to a circle is on top of a
climb the turn already makes; where it is felt on its own is hands-off,
level flight, which is the case the realism check flies.

Averaged round a circle centred on a thermal (unit thermal, the sink as
solved below, about half the thermals lit), 10 / 15 / 20 / 30 units up:

| circle radius | at 0.36 | at **0.45** (shipped) |
|---|---|---|
| 16 | 0.90 / 1.18 / 1.29 / 1.18 | 1.42 / 1.65 / 1.69 / 1.46 |
| 20 | 0.39 / 0.64 / 0.78 / 0.79 | **0.90 / 1.18 / 1.28 / 1.18** |
| 24 | 0.06 / 0.25 / 0.38 / 0.46 | **0.47 / 0.73 / 0.87 / 0.87** |
| 28 | −0.04 / 0.00 / 0.10 / 0.20 | 0.17 / 0.38 / 0.52 / 0.58 |

At 0.36 the circle the stunt law actually flies rode the thermal's rim.
**0.45 with eight thermals instead of ten** keeps the planet's share under
thermals at 16% (was 13%) so the sink between them stays gentle.

### Mass balance: the paper's sink, and the one the field solves

Allen's `we = −At·w̄·(1 − swd)/(A − At)` balances the paper's model on the
paper's terms (a thermal's flux taken as its mean updraft over a mean-radius
disk). Evaluated the way this field evaluates it — the bell's real flux
(about 13% more), no sink inside r1, the stretch to the rim, dead thermals
as plain environment, on a sphere — it left a planet-wide mean of
**−0.017 u/s** at half the layer on flat ground, **−0.033** at 30 up on the
unit suite's synthetic terrain and **−0.023 to −0.037** at 30 up on the real
terrain (table below). So the field integrates one unit thermal per height
once at build time and solves `we = −Σ F0 / (4πr² − Σ_lit a)` exactly:

| | planet mean, flat ground | synthetic terrain, 30 up |
|---|---|---|
| paper's sink | −0.017 | −0.033 |
| solved sink | **within ±0.001 at 5-50 up, lit or dark** | −0.009 |

Both balance tests fail with the paper's sink put back (mutation-tested).
`allenUpdraftAt` still IS the paper, for the tests that read it as written.

The sink between thermals with that balance, at the antipode of a lit
thermal (flat ground, unit thermals, half of them lit): **−0.05 u/s** — a
fifteenth of the 0.76 G-STUNT-1 removed.

### Ridge lift on the real terrain

Live page, 3,000 directions per height, `__BIRB.airAt`, all four biomes.
Mean |ridge| at 1 / 3 / 6 / 10 / 20 / 30 units up:

| biome | | | | | | |
|---|---|---|---|---|---|---|
| forest | 0.57 | 0.48 | 0.37 | 0.27 | 0.12 | 0.05 |
| canyons | 0.65 | 0.55 | 0.43 | 0.31 | 0.13 | 0.06 |
| mountain | 0.71 | 0.60 | 0.47 | 0.33 | 0.15 | 0.06 |
| city | 0.43 | 0.37 | 0.29 | 0.20 | 0.09 | 0.04 |

and the signed mean within ±0.003 in every cell: the lee pays for the
windward. At six units up about a fifth of the mountain lifts faster than
0.5 u/s and a fifth sinks faster than 0.5.

### The thermals on the real terrain

Same boot, sun time 0, the planet mean of the THERMAL term (thermals plus
the sink between them) at 10 / 20 / 30 units up, eight thermals at 0.45:

| biome | lit at t=0 | paper's sink | solved sink |
|---|---|---|---|
| forest | 3 of 8 | +0.000 / −0.015 / −0.025 | −0.003 / −0.003 / −0.003 |
| canyons | 4 of 8 | +0.002 / −0.012 / −0.023 | −0.005 / −0.005 / −0.004 |
| mountain | 2 of 8 | −0.008 / −0.019 / −0.024 | −0.009 / −0.009 / −0.007 |
| city | 5 of 8 | −0.009 / −0.027 / −0.037 | −0.002 / −0.002 / −0.001 |

The share of the planet where the air rises faster than 0.5 u/s, 20 and 30
up: 3.7 / 3.3% (forest), 4.3 / 3.7% (canyons), 2.3 / 1.9% (mountain),
4.3 / 3.5% (city) — the thermal cores, which is what there is to find.

### Gusts move the trees and the pines, and never the bird

The wind uniform over 40 frames at the tier-2 density the harness runs at
(0.35): **0.104-0.264**, with the decorative-density lever reading back 0.35
on every frame. In a separate boot, 60 frames at spawn: 0.26-0.57. The unit
suite proves the vertical air is bit-identical with the gust filters on and
off, at 20 points on every 25th frame of 600.

### Harnesses, on the final tree

| check | result |
|---|---|
| `npm test` | 968 tests: 756 pass, 210 skipped, 2 fail — both in `tests/oracle-manifest.test.js`, both "the new `tests/air-field.test.js` is not pinned yet"; integration regenerates the manifest |
| `BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js` | 4 / 4 |
| `sha256sum -c tools/oracle-manifest.txt` | 0 (no frozen file touched) |
| `tools/birb-realism.mjs --only air-field-thermal,air-field-still` | 21 / 21, two boots, both consoles clean |
| `tools/birb-stunt.mjs` | 41 / 41 |
| `tools/birb-walk.mjs` | ok |
| `tools/birb-modes.mjs` | all 5 modes ok |
| `tools/birb-quality.mjs --check A10` | pass: all 7 routed quantities held the panel's request two frames later |
| `tools/birb-default.mjs` | ok: the production default (Ultra, air on) boots with no console noise and stays reversible |
| `tools/birb-shaders.mjs` | every program compiles in all 4 environments at Ultra, the mountain's wind-patched pines included |

## Traps, and what each cost

- **The frozen A10 oracle reads `decorativeDensity` back two frames later
  and requires it unchanged** — and `quality().effective.decorativeDensity
  .effective` used to BE `visualUniforms.wind.value`, which a gust now moves
  every frame. The lever's effective value is now `windDensityEffective`,
  the very variable the per-frame writer computes from the tier and the
  panel, so a request reverted by an unrouted writer (what A10 exists to
  catch) still shows there. The gust multiplies it into the uniform
  afterwards: weather, not a quality lever. Under `?air=0` the two are the
  same number, as before.
- **The width was a rationale, not a measurement** (above). A thermal you
  can soar in is one the aircraft's own turning circle fits inside, so the
  thermal was sized against the stunt law's measured circle.
- **The paper's sink is not balanced for the paper's own bell** (above).
  A 0.02-0.04 u/s net sink is invisible in any single frame and is exactly
  the kind of everywhere-bias this planet has paid for before.
- **Near the floor the field is deliberately one-sided.** Sinking air fades
  to nothing between the floor's own 0.6 clearance and 4.0, so it can bring
  a bird down toward the ground but never press it into the floor, where
  the landing check is a coin toss (CLAUDE.md, "A level bird cannot land").
  Rising air is not faded. The price, measured on the live page: the planet
  mean of the air actually applied is **+0.21 to +0.34 u/s** one unit up
  (city..mountain), +0.04 to +0.06 at three, and −0.001 to −0.009 from six
  up. It is a cushion confined to the lowest few units, not the
  everywhere-upward ratchet the floor invariant forbids — but it is a bias,
  and it is stated here rather than discovered.
- **A damped lee is a ratchet.** `leeFactor` 1.0 is Bohrer's signed
  formula and the only value that conserves mass. "A gentler lee" (0.35,
  `?airtune=leeFactor:0.35`) measured on the live page, 3,000 points per
  height: a planet mean of **+0.12 to +0.20 u/s at three up and +0.07 to
  +0.11 at ten** (city..mountain), against −0.003 to +0.001 signed — a slow
  lift under every bird that flies low, which is the everywhere-upward push
  the gravity-less floor was built never to make. The unit suite keeps both
  the balanced and the ratcheting value under test so the choice cannot
  silently flip.
- **With the base's world-fixed sun, half the planet's thermals are dark.**
  At sun time 0 the forest had 3 of 8 lit, the canyons 4, the mountain 2,
  the city 5. That is the physics of the key light as it is on `e252ca1`
  (sun-local measures it 19-58 degrees BELOW the horizon at the south pole);
  the field reads `keyLight.position` every frame, so a sun that follows the
  bird lights the thermals near the bird with no change here.

## Review completed (2026-09-24)

The adversarial review of this package was stopped by a session limit
after its two fixes (`5c17480`: a malformed `?airtune=` cannot kill the
boot; the thermal check always re-attaches the field) and the wave-1 wiring
(`cb7740d`). A second review finished it on main `d28da11` (report id
`air-cloud-review`, branch `realism/review-air-cloud`). SwiftShader and
Node only; nothing here is a phone number.

**The floor, under the air, on the live page** —
`tools/realism-checks/air-field-c-floor.mjs` (new; the frozen harnesses that
prove landing, walking and nesting boot `&flight=classic`, and the classic
law never reads the sampler, so on their own they say nothing about the
air). It flies the SHIPPING stunt model with the field attached:

| question | measured |
|---|---|
| sinkiest air 4 units up, 900-point scan of the forest | −1.43 u/s (ceiling −1.5) |
| 8 hands-off low passes through the six sinkiest spots (4 up level, 3 up nose-down 0.25 rad) | 71 frames with the air pushing down; lowest clearance while flying **0.600**; **0** frames below the floor's 0.6 |
| a gentle push (stick 0.35) down through the 3 strongest cores from 4 up, with the air and detached | reaches the ground in exactly the cases the still-air control does (1 of 3 both ways; the other two cores never met the ground in 40 frames with the air detached either — the stunt law's pitch comfort, not the air) |
| upright bird, one real ground contact (`probeGround`) in a core | GROUNDED (core reading 0.67-0.69 u/s) |
| walking 18 frames in that core | GROUNDED throughout, air applied **exactly 0** every frame, clearance 0.6 → 0.6 |
| `forceNest` with the air attached | NESTED; air 0 while nested; radius unchanged to 1e-3 over 12 frames |
| knocked down (FALLING) in a 2.0 u/s core | air applied 0 on every falling frame |
| environment switch forest → mountain → forest | field rebuilt each time, the SAME sampler stays attached, mountain has its own thermals, the forest gets identical ones back, clock restarts (22.4 s → 0.2 s) |
| teleport out of a core (`setAltitude(120)`) | the next frame applies the new place's air: 1.99 → 0 |

`tools/birb-walk.mjs` and `tools/birb-modes.mjs` (classic, as frozen): walk
ok, all 5 modes ok.

**State that needs no reset.** The field's own state is weather — time,
the wind's veer, the three gust filters — and is global by design: a
teleport or `restorePose` does not reset it and should not. What is
per-position is re-read every frame: the stunt law samples at the frame's
start position, `lastAir`/`lastAirRise` are written on every stunt update
(zero while commanded), `aeroPoseInput.gust` and `.airLift` are zeroed at
the top of every frame and set only when a climb was actually measured (a
teleport skips them), and flight audio subtracts the air's step only under
the stunt law. A live switch to classic leaves a stale `lastAirRise` on
the controller, and both readers gate on `isStunt`, so nothing reads it.

**Zero per-frame allocation.** `update()` + `sample()` + `verticalGust()`
driven 2,000,000 times in Node (`--expose-gc`): 0.88 bytes per iteration of
young-generation churn and **99 KB retained after GC** — V8 boxing doubles
held in closure slots, not an object per call; 2.3 µs per update+sample
pair against the synthetic terrain. The per-frame index.html path adds no
allocation (typed reads and scalar writes). `thermalAt()`'s default `out`
object and `gustComponents()`'s array allocate, and are called only from
`__BIRB` debug hooks.

**`?air=0` is the true before.** Unit: with no sampler the stunt law
matches `e252ca1` bit for bit (6,720 values per site, 0 different) and a
sampler returning NaN/±Infinity/undefined is still air; the air, cloud and
boost-trim suites are 71/71. Live (`air-field-still`, its own `?air=0`
boot): nothing built or attached, the thermal pose holds (+0.040 in 40
frames against +2.43 with the air), the controller applied no air on any
frame, the foliage uniform IS the decorative density every frame, the
mountain pines carry no wind patch.

**The gust flick is bounded** by construction (`clamp(±gustMax)`, 0.22
rad, `num()` guards on every input) and live: entering a core flicks the
wings +0.137 rad and they settle back (0.012 → 0.013); the pose's gust is
the carried air plus the layer turbulence to 0.0009 every frame; the
published gusts stay in −1..1.

**Hostile read — nothing blocking or major.** No NaN path: `sample()`
returns 0 for any non-finite height (`!(agl < zi)`) and a final
`Number.isFinite` guard; `update()` ignores a non-finite or non-positive
`dt`; the stunt law ignores a non-finite sampler value. Two things for the
owner, neither a defect: rising air is not tapered at the floor, so a bird
skimming the floor in a core or over a windward slope is lifted off it
(the documented cushion) — landing there is by descending, which the table
shows still works; and each frame now takes five terrain samples twice for
the air (flight + visuals) plus the aero-pose's one, unmeasured on the
phone.

**Suite totals on the review branch** (the two new checks included):

| check | result |
|---|---|
| `node tools/birb-realism.mjs`, full, run 1 | 348/351 — all three failures in the two NEW checks (fixed; see the cloud gate) |
| `node tools/birb-realism.mjs`, full, run 2 (final) | **350/351**, 14 boots, every console clean. The one failure is the pre-existing `shadows-darken` control pair (0.0619 vs 0.0758 against a 2% band, frame mean half its usual 0.13-0.15); re-run with the two new checks ahead of it in the same boot: 0.1273 vs 0.1277, 31/31. Not held still by `stillAir` and placed over unseeded props with drones about — a flake of the check, reported rather than retuned |
| `air-field-floor` + `cloud-volume-ridge` alone | 29/29 |
| `npm test` | 1,193 tests: 983 pass, 210 skipped, 0 fail |
| `BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js` | 4/4 |
| `sha256sum -c tools/oracle-manifest.txt` | 0 failures |
| `tools/birb-modes.mjs` / `birb-walk.mjs` / `birb-stunt.mjs` | all 5 modes ok / walk ok / 41/41 |
| `tools/birb-quality.mjs --check all` | 12/12. A9 failed in the first board run and once alone, then passed 3/3 alone and in a second full board — while the BASE `34c66c4` (the air merged, the clouds not yet) failed it 3/3 in the same window. A replay of its capture reads identically on this tree, on `?cloudvol=0` and on the base (sun off screen on the first sampled frame, shafts on from the second): the capture waits 50 ms of wall clock between aiming and sampling, so it is a clock under load, not the air or the clouds |
| `tools/birb-shaders.mjs` | every program compiles in all 4 environments at Ultra (the first attempt timed out in `startGame`'s 30 s boot wait under a load of ~12; alone it passed) |

## Not verified

- **The phone.** Every number above is the unit suite or SwiftShader.
  Whether a 2.5 u/s core *feels* like being carried, and whether the gust's
  sway reads as wind rather than jitter, needs the owner's thumb and eye.
- **Thermals are invisible.** Nothing on screen says where one is: no
  cumulus over the top, no circling hawks, no dust. A cue is the obvious next
  step and it is scenery, outside this package.
- **The pose package's wing flick** is meant to read `airState.gust`; it is
  published and bounded (−1..1) here, and nothing consumes it yet.
- **The chase camera** follows the pose's `velocity`, which includes the sink
  but not the air (kept out so the stunt law's `_getPose` is untouched). In a
  thermal the camera sees the bird rise rather than anticipating it.
- **Cost on the device.** Two samples a frame (the flight's, then the
  visuals'), each five terrain samples; building a biome's field (480
  candidate sites, five terrain samples each, plus the 23k-evaluation
  balance table) is 6.5 ms warm and 50 ms cold in Node on this machine, once
  per environment switch. A sample is 0.8 µs plus its terrain lookups.
  Neither was measured on a phone.
