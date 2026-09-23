# G-REALISM-PLANET-LIGHT — one sun and one sky for a planet

**Date:** 2026-09-23. **Base:** `e252ca1` (the realism-check runner).
**Branch:** `realism/planet-light`. **Flags:** `?planetsun=0`, `?atmos=0`
(both ON by default, both on the panel's Flags tab under **Light**). The
doubled sun under shadows is fixed with no flag — it was a defect, not a look.
**Decision:** SHIP, flagged. No frozen oracle was edited.

Three things were wrong with the light rig, and all three were the same
mistake: the rig was written for a flat world whose up is +Y, and this world
is a sphere whose up is wherever you are standing.

## 1. The sun counted twice whenever shadows were on (no flag)

The shadow light is a separate `DirectionalLight` that follows the bird so its
fitted frustum covers ground the player can see. Every frame it copied the key
light's direction, colour **and full intensity** — while the key light stayed
lit. So with shadows on the scene had two suns: lit ground got double the
sunlight and a shadow could only ever remove half of it. Shadows are ON at the
shipping Ultra preset, so this was the default look.

`shadowsSetEnabled` (the ONE place shadow state changes, CONTRACT §7.1) now
sets `keyLight.visible = !shadowsEnabled`. The key keeps being computed — the
sky's sun disc, the water glint, the terrain sun rim (`visualUniforms.sunColor`)
and the shadow light itself all read it — it just lights nothing while the
shadow light is the sun.

`tools/realism-checks/shadows-darken.mjs`, same pose restored before each shot,
linear luminance of rows 50-98%, shadows off / on / off again:

| build | off | ON | off again | ON vs off |
|---|---|---|---|---|
| base `e252ca1` | 0.1883 | **0.2196** | 0.1880 | **+16.7%** |
| this branch, boot 1 | 0.1649 | **0.1646** | 0.1644 | **−0.03%** (the off pair's own spread: 0.3%) |
| this branch, boot 2 | 0.1397 | **0.1392** | 0.1384 | **+0.04%** (spread 0.9%) |
| this branch, boot 3 | 0.1396 | **0.1409** | 0.1379 | **+1.5%** (spread 1.2%) |

The off pair is the method's own noise — cloud shadows drift, weather moves,
and the unseeded world puts different things at the spot on every boot — and
every ON reading sits within about one spread of it, where the base's ON sat
16.7% above an off pair that agreed to 0.2%.
(The builds' "off" levels differ because the sun is somewhere else: on the
base the equatorial test spot had a world-fixed sun 72° up; here it has the
cycle's 19.5°.) The frozen quality oracles are green on this branch: `node
tools/birb-quality.mjs --check all` → A1–A12 `pass`, exit 0 (A6 still prints
the pre-existing `matchesExpectedRed: false` note recorded in G-ASCEND).

## 2. The sun set over half the planet (`?planetsun`, default on)

`sun-cycle.js` describes the sun in a horizon frame — x = cos(az)cos(e),
y = sin(e), z = sin(az)cos(e) — and promises it never sets. Those numbers were
copied straight into WORLD space, which is a horizon frame only at the +Y pole.
Measured on the base with `sun-local.mjs`:

| spot | t=0 | t=150 | t=300 | t=450 |
|---|---|---|---|---|
| north pole | 20.6° | 40.7° | 57.3° | 37.2° |
| equator +X | 71.6° | 2.0° | **-30.4°** | **-0.6°** |
| equator -X | **-69.3°** | 2.1° | 32.7° | **-0.7°** |
| south pole | **-17.7°** | **-37.8°** | **-60.2°** | **-40.0°** |

Five of sixteen in the designed 19-58° band. On this branch, sixteen of
sixteen: 19.0-19.9 / 39.0-39.4 / 58.0-58.9 / 38.5-39.0. (The half-degree
spread is the check's, not the sun's: the frozen bird drifts during the settle
frames and `sun-local` measures against the requested spot. `__BIRB.lightRig()`,
which measures against the bird's own up, reads **19.481° and 58.442°** at the
north pole, the equator and the south pole alike; the cycle says 19.48 and
58.44.)

**How.** `src/environment/sun-frame.js` keeps a tangent frame (East, Up, North)
at the bird and PARALLEL-TRANSPORTS it: each frame East and North are rotated by
the minimal rotation that carries last frame's up onto this frame's up, then
re-orthonormalised (N -= (N·U)U, normalise, E = U × N). The key, the
counter-rotating rim and the authored fill are all mapped through it **every
frame, clock or no clock** — the direction depends on where the bird is, so a
paused cycle holds the HOUR, not the world direction. Parallel transport is the
one choice that keeps the sun still in the sky while you fly: along any great
circle the sun keeps its elevation and its bearing to your path (the unit test
flies one and measures both). A frame built from `cross(worldAxis, up)` would
instead swing the sun round whenever that axis passed overhead.

- **A jump is not flight.** More than 10° of up in one update (a teleport,
  `restorePose`, an environment switch) rebuilds the frame from the canonical
  pole frame (E=+X, U=+Y, N=+Z) by the minimal rotation +Y→U, so the same place
  always gets the same sky whatever route a harness took. At the exact south
  pole that rotation has no axis; the fallback is a half turn about +X.
- **The spawn is the pole, and at the pole the mapping is the identity, bit
  for bit** (tested with `===`). The first frame of every session is exactly
  the old one.
- **The price is holonomy, and it is the right price.** Fly a closed loop and
  the frame comes home turned by the solid angle it enclosed (tested: a 30°
  small circle comes back turned by 2π(1−cos 30°)), so the sun's AZIMUTH depends
  on the route. Its elevation never does, and elevation is what sun-cycle.js
  promises.
- **The HemisphereLight's sky/ground axis is its POSITION**, which was the
  default (0, 1, 0) forever: at the south pole its "sky" colour lit the
  ground-facing sides of everything (`hemiUpDot` −0.999 with the flag off).
  It is set to the local up every frame (1.000 at north, equator and south).
- **The core glow light is hidden**, not deleted (`applyLightingPreset` still
  writes it). A PointLight ~2.5 units from the planet's centre with a 12-15
  unit range is ~118 units under the ground; three's distance falloff is
  exactly 0 past the cutoff, so hiding it changes no pixel and drops
  `NUM_POINT_LIGHTS` from every lit program.
- `sunCycleInto` / `sunWarmthInto` are allocation-free twins of
  `sunDirectionAt` / `sunWarmth`, pinned bit-for-bit against them by test,
  because the planet path runs every frame and the originals return fresh
  objects.

**Behaviour change worth knowing:** under `?planetsun`, `setSunTime()` while the
cycle is paused takes effect on the next frame. ASSERTIONS.md's A9 trap #1
("setSunTime() is INERT while the cycle is disabled") no longer applies; the
recipe it prescribes (enable, set, one frame, disable) still works unchanged,
and `pinCheckpoint({ sunTime })` now actually pins the sun time — before, after
an environment switch it left the key at the biome's authored direction.

## 3. The sky did not know where the sun was (`?atmos`, default on)

On the base the sky rendered pixel-identical with the sun 75° up and 27° below
the horizon, and the only light that answered to the sun's height was the key,
through a hand-tuned warmth heuristic.

`src/environment/atmosphere-model.js` is a compact CPU model of a real
atmosphere with Hillaire 2020 (EGSR) / Bruneton 2017 Earth parameters —
Rayleigh β (5.802, 13.558, 33.1)e-6/m over 8 km; Mie 3.996e-6 scattering /
4.40e-6 extinction over 1.2 km, Cornette-Shanks g = 0.8; ozone (0.650, 1.881,
0.085)e-6/m in a tent at 25 ± 15 km; ground 6360 km, top 6460 km. Single
scattering is ray-marched against a 32×16 transmittance table built once
(Bruneton's parameterisation); multiple scattering is Hillaire's closed form
Ψ_ms = L₂ / (1 − f_ms), evaluated at four heights for the current sun. Each
evaluation fills: the sun's transmittance, the zenith, the horizon (3° up)
toward / across / away from the sun and its azimuthal mean, and the sky
irradiance on a horizontal surface.

**It is used only as a RATIO**, `model(e_now) / model(e_ref)`, around each
biome's authored palette, where e_ref is the elevation of that biome's authored
key light (41.9° forest, 46.5° canyons, 42.3° mountain, 41.2° city). At e_ref
every ratio is exactly 1 (tested with `===`) and the frame is the authored one.
Birb's planet is 120 units across; the Earth model supplies how light CHANGES
with the sun's height and the art supplies what it looks like — which is also
why the solar spectrum is left white: it cancels. Ratios pass a luminance clamp
[0.5, 1.6] (hue kept) and a channel clamp [0.35, 1.9]; nothing inside the
cycle's own range reaches either (tested) — they are a net for `?planetsun=0`,
where the local sun can sit on the horizon.

The ratios, forest (e_ref 41.9°), at the cycle's lowest and highest sun:

| | 19.5° (t=0) | 58.4° (t=300) |
|---|---|---|
| sun (key light) | 0.92 / 0.82 / 0.68 | 1.02 / 1.04 / 1.09 |
| zenith | 0.66 / 0.63 / 0.62 | 1.30 / 1.27 / 1.24 |
| horizon toward sun | 1.58 / 1.18 / 0.90 | 0.91 / 0.95 / 1.00 |
| horizon across | 0.78 / 0.72 / 0.65 | 1.11 / 1.13 / 1.15 |
| horizon away | 0.97 / 0.89 / 0.77 | 0.96 / 0.98 / 1.03 |
| sky irradiance | 0.81 / 0.76 / 0.72 | 1.10 / 1.11 / 1.13 |

The across-the-sun horizon is the darkest at low sun: that is Rayleigh's phase
minimum at 90° from the sun, the same band that polarises a real sky.

**What it drives:** the key colour (replacing the warmth heuristic; intensity
is the authored one), the HemisphereLight's sky colour (× irradiance), the fog
and the valley mist (× horizon mean), the lakes' sky colour (× horizon mean),
the sky dome, and the dome's sun disc (× the sun's transmittance). Measured
live: the forest key goes [0.920, 0.606, 0.279] at low sun → [1.018, 0.770,
0.442] at high sun, blue/red 0.303 → 0.434.

**The dome** gets one tint in its shader — only compiled in when the dome is
built with `atmosphere: true`, so under `?atmos=0` the shader string is
byte-for-byte the base's (diffed: fragment, vertex and uniform list all
identical). The horizon tint carries the sun's azimuth as
a + b·cos φ + c·cos² φ through the model's three horizon samples (exact at 0,
90 and 180°) and blends to the zenith tint by elevation^2.5 — which is how the
model's own ratio moves between 3° and 90° at both ends of the cycle (flat to
about 30°, then falling to the zenith value). It multiplies the base colour
after the panorama mix, so gradient and panorama are tinted by one path, and
before the self-limiting glows read their headroom. At identity it is exactly
1.0, not 0.99999994: `a + (b + c·cp)·cp` with b = c = 0 is `a + 0`. The
gradient's own colour uniforms are deliberately NOT modulated in place:
`getMidColor()` is the authored base that fog, mist, water and the bird's rim
are all derived from, and a tint cannot be azimuthal as a uniform.

**Measured with a control** (`planet-light-sky` / `planet-light-sky-off`): the
sky band (rows 2-28%, left 60% — the minimap is DOM and its drone markers
move) at the equator looking along the frame's North — 90° off the sun's
azimuth at both t=0 and t=300, so the disc stays out of frame and the panorama
in view is the same pixels both times — rendered SKY-ONLY
(`__BIRB.skyOnly()`, camera layer 31: nothing but the dome draws):

| boot | `?atmos` on: low → high sun | `?atmos=0` control |
|---|---|---|
| A (minimap still in the band) | 148.9 → 180.2, **+19.0%** | 171.8 → 171.4, **−0.2%** |
| B (minimap cropped out) | 170.4 → 206.0, **+18.9%** | 195.7 → 195.7, **−0.0%** |

The absolute level differs between boots because the chase camera converges
to a slightly different pitch after a different preceding check; within a
boot the pair shares one camera, and the ratio is the measurement.

**What it looks like** — the forest at the equator, world seed pinned (16160),
same pose in two boots, `?atmos` on vs `?atmos=0` (the planet sun on in both),
mean sRGB of the sky band (rows 2-25%) and the ground band (rows 60-95%):

| view | sun | sky on | sky `atmos=0` | ground on | ground `atmos=0` |
|---|---|---|---|---|---|
| toward the sun | 19.5° | L181, b/r 0.71 | L171, b/r 0.91 | L110, b/r 0.96 | L112, b/r 1.20 |
| toward the sun | 58.4° | L152, b/r 1.14 | L155, b/r 1.08 | L118 | L117 |
| across the sun | 19.5° | L112, b/r 1.02 | L128, b/r 1.12 | L102, b/r 0.91 | L111, b/r 1.07 |
| across the sun | 58.4° | L136 | L130 | L120 | L117 |

In words: at golden hour the sunward half of the sky turns golden-peach and
brightens, the rest of the sky dims and warms, and the ground takes the warm
light; at noon the sky is a few percent brighter and bluer than authored. The
other three biomes were captured too, but their two boots did not frame the
same scene (the camera and HUD state differed after the environment switch),
so no on/off number is quoted for them — the within-boot and fixed-view
measurements above are the ones that hold.

**Cost.** Construction (the transmittance table) 3.5 ms warm / 15 ms cold in
Node on this machine; one evaluation 0.4 ms warm / 1.4 ms cold. It is
refreshed only when the local sun elevation has moved 0.23° (and at most every
0.25 s, unless the sun jumped 2°, e.g. `setSunTime` or a teleport under
`?planetsun=0`): the cycle's elevation moves at most 0.2°/s, so that is one
evaluation every ~1.2 s at the steepest part of the cycle and far fewer at
either end. The key's colour is re-applied only on a refresh, so the warmth
path's per-frame writes are gone. Zero allocation per frame, including inside
an evaluation (every array is owned by the model or by a pre-built output). The
default resolution agrees with a run at 4× every count to within 1.9% on every
ratio (tested at < 3%).

## Traps

- **A fixed VIEW is not a fixed SCENE on an unseeded world.** The realism
  runner does not pin the world seed, so the trees, clouds and spires at a
  given spot differ from boot to boot. The first version of `planet-light-sky`
  measured the rendered frame at a fixed local view: on one boot the band was
  pure sky and the `?atmos=0` control read **0.0%**; on the next a lit tree
  stood in it and the same control read **−5.8%** and failed — with the
  atmosphere on, the same pair read +19.0% and +12.8% on those two boots. The
  sky is now measured sky-only (`__BIRB.skyOnly()`), and the ratio holds from
  boot to boot: +19.0% / +18.9% with the atmosphere, −0.2% / −0.0% without.
  Any check that names "the sky" in its message has to measure only the sky.
- **`sun-local`'s sky check is green on this branch, sometimes for the wrong
  reason.** It faces AWAY from the sun, and under `?planetsun` the sun's
  azimuth at t=0 and t=300 differs by 180° in the local frame, so its two
  shots look at opposite halves of the world, through whatever the unseeded
  world put there. On one boot the high-sun frame's band was a tree canopy in
  front of the camera: 150.1 → 36.3 ("122%"), a green crown and not a sky. On
  another it was sky: 150.2 → 168.8 (+11.7%). Green both times; evidence only
  the second time. `planet-light-sky` and its control are the measurement to
  quote. Recommended fix for the integrator (not applied — not this package's
  file): measure it sky-only at a fixed local view, as `planet-light-lib.mjs`'s
  `skyAtFixedView` does.
- **Other writers of the key and the hemisphere.** Grade candidates and
  `setLighting()` nudge key INTENSITY (overwritten by the running cycle every
  frame on the base as well — unchanged) and the hemisphere COLOUR; the latter
  would have been silently reverted by the next atmosphere refresh, so
  `applyLightingSettings` moves the atmosphere's base with it (one line).
- **The model's clamp is not an error path.** `evaluate(e)` clamps to
  [0.02 rad, π/2]: a model asked about a set sun answers "black", which is
  correct and useless. Under `?planetsun` it never gets near it.
- **A realism check that boots a flag must say so in `query`.** The runner
  groups by it and fails any boot with a console warning, which is how the
  `?atmos=0` and `?planetsun=0&atmos=0` paths are proved to compile and run.

## Checks

`tools/realism-checks/planet-light-*.mjs` (`-lib` is the shared measurement,
no default export):

- `planet-light-rig` — both flags on by default; glow hidden; hemisphere axis
  local (dot > 0.99) at north, equator and south, low and high sun; elevation
  = the cycle's; key redder (b/r 0.303 vs 0.434) and dimmer at low sun; the
  dome's zenith tint and the irradiance follow the sun; shadows on → key dark,
  off → key lit; a pole-to-pole teleport resets the frame.
- `planet-light-sky` / `planet-light-sky-off` — the controlled sky pair above,
  sky-only.
- `planet-light-off` — `?planetsun=0&atmos=0` is the before: glow on,
  hemisphere on world +Y (−0.999 at the south pole), sun world-fixed and
  −17.2° below the south pole's horizon — plus ONE sun under shadows.

New `?debug=1` hooks: `__BIRB.lightRig()` (the rig read back against the
bird's own horizon — elevation, hemisphere axis, key/shadow visibility, colours,
the dome's tint, the frame and the atmosphere's current ratios) and
`__BIRB.skyOnly(on)` (render only the sky dome; `false` restores the camera's
layer mask).

Run: `node tools/birb-realism.mjs --only
sun-local,shadows-darken,planet-light-rig,planet-light-sky,planet-light-sky-off,planet-light-off`
→ 51/51.

Unit tests (new, unpinned until the integrator regenerates the manifest):

- `tests/sun-frame.test.js` — identity at the pole bit for bit; a great circle
  keeps elevation (< 1e-9 rad) and bearing to the path (< 1e-6); a small circle
  comes home turned by its enclosed solid angle; resets on a jump and only then;
  orthonormal after 10k random steps; the south-pole fallback; `sunCycleInto` /
  `sunWarmthInto` bit-equal to the originals.
- `tests/atmosphere-model.test.js` — the published parameters; the sun reddens
  and dims monotonically as it drops; the sky's direction of change; ratio
  exactly 1 at e_ref; finite and bounded over 0.30-1.10 rad; no allocation
  (output identity); within 3% of a 4×-finer run.
- `tests/sky-dome-atmosphere.test.js` — the untinted dome is the tinted one
  minus exactly the tint (a relation, not a hash, so a later change to the
  gradient does not trip it — mutation-tested by leaking a `color *= vec3(1.0)`
  into the untinted path, which it catches); identity is exactly 1.0; the
  three horizon samples and the zenith land where the model put them. The GLSL
  is mirrored in the test and the mirror is pinned against the source lines.

## Not verified

- **No phone number exists.** Everything above is SwiftShader or Node. The
  model's construction (15 ms cold in Node) runs at boot on the phone's CPU and
  is unmeasured there; so is one evaluation.
- **The magnitude is physics, not taste.** At the lowest sun the zenith is at
  0.66 of its authored brightness and the ambient at 0.76: that is what a real
  sky does at 19°, and it may read too dark on glass at golden hour. If it
  does, `RATIO_BOUNDS` is the knob (or a strength exponent on the ratios);
  `?atmos=0` is one tap on the Flags tab.
- **Shadows now take away all of the sun** instead of half of it, so shadowed
  ground under Ultra's VSM is darker than it has ever been on the phone. That
  is the fix, and it is also the first time anyone will see real-contrast
  shadows on glass.
- Not driven by the atmosphere: the hemisphere GROUND colour (bounce), the
  rim and fill lights, the bird's rim colour, the weather particles, the
  desktop-only cloud shell and the `?ibl=1` environment map (built once per
  biome from the authored sky).
- The sun's azimuth is route-dependent (holonomy, above). Nobody has flown a
  long loop on a phone and looked for it.
