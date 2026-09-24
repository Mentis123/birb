# G-REALISM-AUTO-EXPOSURE — exposure like an eye (opt-in)

**Date:** 2026-09-24. **Branch:** `realism/auto-exposure`, one WIP commit
(`fc3569b`, interrupted by a session limit) on `d47fc7e`, then main `d28da11`
(realism wave 2) merged in without conflicts and the build finished on top.
**Decision:** SHIP OPT-IN, two selects on the Flags tab (Exposure → "Eye
adaptation (auto-exposure)" `?autoexp=1`, "Local tone mapping (exposure
fusion)" `?localtm=1`), both default Off. With neither flag the post pass is
what it was: no stage is built, no pass is added, and the composite is
compiled from the untouched `COMPOSITE_FRAG` string — the same string object,
which `bloomPass.compositePristine` reports and `auto-exposure-off` asserts
on the live page (5 render passes, the shipping list). No frozen oracle was
touched (`sha256sum -c tools/oracle-manifest.txt`: 0 failures); the new
`tests/exposure.test.js` makes `tests/oracle-manifest.test.js` report the
manifest stale, which is the expected and only failure (RESULTS below).

**Not measured: the phone.** Every number below is this machine's Chromium on
SwiftShader (390x844, DPR 1, Amazing preset with tier 0 pinned so the post
pass runs) or the unit suite. No frame-time, bandwidth or thermal number
exists for the iPhone 16 Pro, and none is claimed.

## Why

A fixed per-biome exposure (`toneMappingExposure` 1.008-1.254) was right for
one view of each biome. Since the first realism wave the frame's brightness
genuinely moves: the atmosphere model scales key and sky with the LOCAL sun
elevation, Ultra hides the key while the shadow light is the sun (shadowed
ground is really dark now), the horizon map puts whole valleys in skyline
shadow at every preset, and wave 2's cloud volumes shade the ground. Measured
at the harness's poses with the eye OFF, the authored frame runs from a mean
of **15.8/255** (the chase camera up against a canyon spire) through **84.4**
(the forest floor under a low sun) to **172.0** (60 units up facing the
sun) — one fixed stop for all of it.

## What shipped

`src/effects/exposure.js` (new, in `sw.js` `CORE_ASSETS` because
`bloom-pass.js` imports it statically), hooked into `src/effects/bloom-pass.js`
(the hand-written post pass) between the bloom blur and the composite.

### 1. Eye adaptation (`?autoexp=1`)

* **Meter** — the HDR `sceneTarget` (linear, before bloom and the tone curve)
  drawn into a 64x64 RGBA16F target: four taps per cell of
  `clamp(log2(max(L, 2^-12)), -12, 12)` weighted centre-heavy
  (`0.25 + gauss(sigma 0.28)` — a camera's averaging meter, never blind at the
  corners). Three's mip generation IS the reduction: the 1x1 level holds
  mean(w log L) and mean(w), so their ratio is the weighted log-average
  luminance. No `readPixels`; nothing leaves the GPU.
* **Adapt** — one fragment into a 1x1 RGBA32F ping-pong (RGBA16F if the
  device lacks `EXT_color_buffer_float`): target
  `EV = clamp(0.7 x (key - measured), -1.5, +1.5)`, approached exponentially
  (Pattanaik et al. 2000) at `alpha = 1 - exp(-dt / tau)`, **tau 0.5 s when
  the scene got brighter, 1.1 s when it got darker**, dt from the frame's own
  clock and clamped to 0.25 s. `exp(-a)exp(-b) = exp(-(a+b))`, so the path is
  the same at any frame rate; alpha is in [0, 1), so it cannot overshoot.
  Strength 0.7: an eye keeps some of the difference (a dark valley should
  still look like a valley).
* **Apply** — the composite multiplies `c` (scene + bloom + shafts) by
  `2^EV` before the vignette and `<tonemapping_fragment>`, so the eye and the
  biome's authored `toneMappingExposure` multiply into one exposure.
* **Calibration** — `key` is per biome (`EXPOSURE_KEYS`): the metered log2
  luminance of that biome's REFERENCE VIEW, so at a typical view the EV is 0
  and the authored look is the centre of the range, not something the eye
  overrides. Table below.
* **Resets** — a biome switch is a cut: the new key, and the first frame
  SNAPS to its target (no forest adaptation carried into the city). A frame
  that skips the post pass (tier shed, or the panel's post Off) showed the
  AUTHORED exposure, so when the pass comes back the eye RESTARTS from EV 0
  and adapts — a stale EV would light the frame wrongly for a second, a snap
  would pop. A resize changes nothing for the eye: the meter and the state
  are resolution-independent.

### 2. Local tone mapping (`?localtm=1`) — exposure fusion

Mertens, Kautz & Van Reeth 2007, as Bart Wronski (2022, "Local tone mapping
using exposure fusion") adapts it to a real-time pipeline, at QUARTER
resolution:

* **Exposures** (W/4 x H/4 RGBA16F + mips): three SYNTHETIC exposures of the
  one HDR frame, -0.25 / 0 / +2.5 stops about the frame's own exposure
  (authored x the eye's EV, if on), pushed through the display model the
  composite applies (Neutral for grey + sRGB), stored as **log2** of the
  display values; alpha holds the block's mean log2 luminance (the guide).
* **Weights** (same size + mips): Mertens' well-exposedness (Gaussian about
  0.5, sigma 0.2 below / 0.25 above), the base exposure's weight doubled so a
  well-exposed region stays as authored, normalised to sum to 1.
* **Collapse** (same size): the Laplacian pyramid blend evaluated directly
  per texel from the mip chains —
  `sum_{l<B} W_l . (Y_l - Y_{l+1}) + Y0_B` — over the levels finer than
  0.35 of the frame (6 of 8 at 97x211), with the BASE exposure's residual
  above that, so the fusion is local and the global brightness stays the eye
  adaptation's business. Out: the local exposure in stops,
  `clamp(1.5 x gain, 0, +1.5)` — **lift only**.
* **Guide** (same size): a 3x3 linear fit `EV = a log L + b` (He, Sun & Tang
  2013 guided upsampling); the composite evaluates it with the FULL-resolution
  luminance, so the exposure changes exactly where the frame's own edges are
  and costs the composite one bilinear fetch.

### Passes, resolution, memory

| flag | pass | target | resolution |
|---|---|---|---|
| autoexp | meter | RGBA16F + mips | 64x64 |
| autoexp | adapt | RGBA32F, ping-pong x2 | 1x1 |
| localtm | exposures | RGBA16F + mips | W/4 x H/4 |
| localtm | weights | RGBA16F + mips | W/4 x H/4 |
| localtm | collapse | RGBA16F | W/4 x H/4 |
| localtm | guide | RGBA16F | W/4 x H/4 |

Render passes per post-pass frame, measured on the live page with
`__BIRB.frameTotals().passes`: **5** off (scene, bright, 2 blur, composite;
+3 while shafts draw), **7** with `autoexp`, **9** with `localtm`, **11**
with both. Render-target memory (`__BIRB.exposure().memoryBytes`): the eye
**~43 KiB** at any resolution; the fusion **746 KiB** at 390x844 (789 KiB
with both, measured), and by the same formula **about 7.0 MB** at an iPhone
16 Pro's native 1179x2556 (fusion 294x639) — that is the Ultra default's
resolution, and the number to weigh first if the fusion is ever a default.
Zero allocation per frame: `render()` assigns numbers and draws.

## Calibration (the keys)

16 reference views per biome — 8 spots x 2 level headings, 30 units over the
ground, nose 0.1 rad down, seed 16160, sun at t = 165 s (42.0-42.1 degrees
local, the atmosphere model's authored elevation) — metered by the live
shader. The key is the MEDIAN (mean of the middle two), because one view can
stare into a wall: canyons' darkest view is the chase camera up against a
spire that fills the frame.

| biome | key (log2) | median | mean | min | max |
|---|---|---|---|---|---|
| forest | **-2.43** | -2.435 | -2.468 | -3.527 | -1.609 |
| canyons | **-2.55** | -2.551 | -3.100 | -6.931 | -2.219 |
| mountain | **-2.14** | -2.142 | -2.259 | -3.765 | -1.923 |
| city | **-3.53** | -3.530 | -3.775 | -6.112 | -3.230 |

The WIP commit's keys (-2.30 / -2.48 / -2.06 / -3.49) were measured on
`d47fc7e`; after merging wave 2 every biome metered **0.04-0.13 stops
darker** (clouds with volume are on by default there), so they were
re-measured. `tools/realism-checks/auto-exposure-calibration.mjs` re-meters
the same 16 views live and fails if a key is more than 0.3 off its median —
a later palette or lighting change that moves a biome's typical brightness
fails there instead of silently turning the eye into a global exposure
shift. Its first run (separate boot, air detached and gusts held):
medians **-2.379 / -2.553 / -2.139 / -3.525** against the keys — EV at the
median view -0.036 / +0.002 / -0.001 / -0.003. (The forest's 0.056 spread
between the two sessions is its reproducibility: the calibration session
left the air field attached, the check detaches it.)

## Measurements (live page, one boot per flag set, held poses)

Every A/B is inside one boot and one held pose (`hold(true)` stops every
clock but the eye's): the eye/fusion switched off at runtime (the composite
then multiplies by exactly 2^0 / adds exactly 0 stops — the authored frame),
and the first state photographed again as the control. The control moved
**0.00** in every pair (held frames repeat bit-for-bit), so every difference
below is the feature. Luminance is sRGB 0-255 over the frame minus the HUD's
corners.

**Eye adaptation** (`auto-exposure-adapt`, forest key -2.43):

| pose | metered | EV | mean off -> on | linear mean |
|---|---|---|---|---|
| dark: 6 up, nose 0.8 down, low sun (t = 0) | -3.085 | **+0.458** | 84.4 -> 103.1 (**+22.2%**) | 0.101 -> 0.151 |
| bright: 60 up facing the sun (t = 165) | -1.321 | **-0.776** | 172.0 -> 130.4 (**-24.2%**) | 0.431 -> 0.237 |
| canyons darkest reference view | -6.919 | **+1.500** (clamp) | 15.8 -> 30.6 | 0.009 -> 0.022 |

The gap between the dark and the bright view falls **87.6 -> 27.2**.
Bright -> dark without a cut (the sun moved, not the world), EV per sampled
frame: -0.776 -> -0.093, 0.246, 0.346, 0.376, 0.384, 0.386, 0.387 ...
(target 0.387; dt 0.25 s per SwiftShader frame, the clamp) — monotone,
worst overshoot 0.0000. Tier 1 pinned (post pass shed) then tier 0 again:
the first read-back after restore was EV **0.073** against a stale 0.361 —
restarted from the authored exposure. A switch to the city took key -3.53 and
snapped to its target (EV 0.970 = target).

**Local tone mapping** (`auto-exposure-local`, forest, low sun, 10 up facing
it — dark canopies against a bright sky):

| view | p10 off -> on | p50 | p99 |
|---|---|---|---|
| backlit 0 | 60.5 -> 69.0 (**+14.1%**) | +0.8% | 198.3 -> 198.5 (+0.1%) |
| backlit 1 | 61.3 -> 71.0 (**+15.9%**) | +0.5% | 214.8 -> 214.8 (0.0%) |
| backlit 2 | 70.9 -> 76.1 (**+7.3%**) | +1.8% | 222.0 -> 222.6 (+0.2%) |

Looked at, not just counted: in backlit 0 the right-hand canopy's underside
opens up to show its leaf detail while the sunset sky, the cloud band and the
bird are unchanged; no halo round the canopy (the lift-only floor is why —
below). After a viewport resize to 360x760 the fusion re-sized to 90x190 and
the frame rendered.

**Both** (`auto-exposure-both`): at the dark pose, off 84.4 / adapted 103.1 /
adapted + fused 103.9 — the fusion synthesises its exposures from the ADAPTED
frame, so the two stack instead of fighting, and on a uniformly dark frame
local TM (which is relative) correctly adds almost nothing. Debug views
(`__BIRB.exposure({ debug: 1|2|3 })`, the local / global / total stops as
grey) render.

**Default** (`auto-exposure-off`, no flag): no eye, composite pristine, 5
passes. Every boot above: 0 console errors or warnings.

## Traps (each one would have shipped wrong)

* **log2(0) is -Infinity, and one -Infinity is the whole average.** A black
  texel (a pupil, a crevice, the clear colour) would drive the EV to +Inf and
  the HalfFloat composite to Inf/NaN — which spreads through the bloom blur as
  a black block. Floor and ceiling in log2 (-12, +12), and a NaN/Inf scrub on
  every luminance before it reaches a log or a mip.
* **HalfFloat cannot hold the adaptation state.** At 60 fps a 1.1 s time
  constant closes 1.5% of the gap per frame; half-float spacing near 1 is
  0.002, so the last tenth of a stop would never close. The state is RGBA32F
  (falls back to half where `EXT_color_buffer_float` is missing — then the
  approach stalls ~0.01 stop short, which is invisible).
* **Fusing display values reverses at an edge.** A dark region's fine
  pyramid levels take their step from the brightest exposure, in which the
  sky beside it is brightest — so the shadow side went DOWN (a canopy pushed
  to the clamp on the live page, in the WIP build's exploration). Fused in the LOG domain the Laplacian of
  exposure k minus the base's is log(Y_k / Y_0), large in the shadows and
  small in the highlights. Pinned by a unit test so nobody simplifies the
  log back out.
* **The fusion's darkening half is a halo.** Beside a dark canopy the coarse
  weights prefer the shadows exposure, in which the sky's step up from the
  canopy is smaller — so the sky next to every backlit tree was pulled down
  (below -0.3 stops raw on the unit suite's synthetic backlit frame, which
  asserts it; -1.2 at the worst texel in the WIP build's own exploration on
  `d47fc7e`, not re-measured here). Darkening a bright
  frame is the eye adaptation's job; the local exposure is floored at 0.
* **Fusing the whole pyramid moves the frame globally** (textbook Mertens):
  the residual shifts the mean — p50 +24% and p99 +10.7% on a backlit view in
  the WIP build's exploration on `d47fc7e` (not re-measured here; the unit
  suite pins the direction on its synthetic frame). Only levels finer than
  0.35 of the frame are fused.
* **A stale adaptation after a tier restore.** Without the restart the eye
  reappeared at whatever it had adapted to before the shed, over a frame that
  had been showing the authored exposure.
* **The keys drift with the world.** Calibrated on one build, off by up to
  0.13 stops on the next — hence the live calibration check.
* **Reading the state back must not stall.** `__BIRB.exposure()` reads the
  1x1 target with `readRenderTargetPixelsAsync` (a pixel-pack buffer and a
  fence) — never the frame loop — so Chrome logs no "GPU stall due to
  ReadPixels" warning, which the realism runner would fail.
* **A patch that no-ops ships the feature invisible** (`installFeatherDetail`
  did exactly that). `patchComposite` throws if any of its three anchors is
  missing from the real `COMPOSITE_FRAG`, and the test applies it to that
  exported string, not a copy.

## RESULTS

| check | result |
|---|---|
| `node --test tests/exposure.test.js` | **27/27** |
| `npm test` | 1220 tests, 1008 pass, 210 skipped, **2 fail** — both `tests/oracle-manifest.test.js` naming the new `tests/exposure.test.js` (the expected staleness) |
| `BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js` | **4/4** |
| `sha256sum -c tools/oracle-manifest.txt` | **0 failures** |
| `node tools/birb-realism.mjs --only 'auto-exposure-*'` | **50/50** (off 4, adapt 19, calibration 4, local 11, both 8, and 4 boots with a clean console); run twice, every number above within 0.03 EV / 0.7% of p10 between the runs (backlit 0: +14.1% then +13.4%) |
| `node tools/birb-modes.mjs` | **all 5 modes ok** |
| `node tools/birb-default.mjs` | **ok** (production default is Ultra at its ceiling, and reversible) |
| `node tools/birb-quality.mjs --check all` | **11/12 — A9 FAILS** in every `all` run on this branch (5 of 5); `--check A9` alone **passes** |

**A9 is not made green here, and it is not this feature's behaviour.** A9
("shafts off collapses 8 -> 5") needs the sun on screen for its "before"
sample. In the `all` sequence the bird is GROUNDED by the time A9 runs, on
main as well as here (instrumented copy: `recovery: "grounded"`,
`aboveGround 0.600`, speed 0 on both trees — the landing coin toss CLAUDE.md
records under "A level bird cannot land"). `faceSun()` then sets a heading
the grounded pose does not keep, so whether the sun is in frame depends on
WHERE the bird came down, which depends on the route the earlier checks flew
in wall-clock time. On main `d28da11` it came down at heading 89 deg with the
sun at uv (0.50, 0.44); on this branch at heading -148 with the sun behind.
The capture also reads `sunUv` in the same evaluate as `faceSun()`, so its
own re-aim loop always reads 0 and never retries. Bisected on a copy of this
tree: main's `index.html` passes; main's `index.html` plus ONLY the two
guarded, never-executed-at-tier-0 lines (`if (bloomPass && bloomPass.eye)
...skipFrame()` / `...setEnvironment()`) fails; 29 lines of comments added to
main's file pass; the same failing tree passes when extra `evaluate` calls
are inserted before the sample. Timing decides it, not the pass: the flags
are off in that boot, the composite is pristine, and A7 (5 passes with rays
off) and A8 pass. On main the same `all` run failed A5 once in four
(G-A5-DRIFT's known clock). `tools/birb-quality.mjs` is hash-frozen (R5), so
the fix — wait for a rendered frame after `faceSun()`, and take the sample
airborne — is a gate decision for the oracle's owner, not this branch.

## What is NOT verified

* **The phone.** No iPhone 16 Pro frame time, bandwidth or thermal number
  for either half. The eye is two tiny passes; the fusion is four
  quarter-resolution passes and ~7 MB at native resolution. Unknown on
  device.
* **Chrome-on-iOS float render targets.** The state falls back to RGBA16F
  without `EXT_color_buffer_float`; that path compiles here only by
  construction, never by a device.
* **Adaptation in real flight.** The harness HOLDS poses; the eye's
  behaviour over a minute of free flight (does it pump when the bird rolls
  from sky to ground?) has been reasoned about (centre weighting, a 0.5/1.1 s
  eye, strength 0.7) but not flown or seen on glass.
* **The keys at other sun times.** They are calibrated at the authored sun
  elevation; at dusk the whole world meters darker and the eye lifts it
  (within 1.5 stops) — which is the point, and also the thing to look at on
  the phone before either flag becomes a default.
* **Taste.** Whether the lifted canopies and the damped sky read as better
  is the blind paired A/B on the phone's job.
