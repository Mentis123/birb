# G-REALISM-PLUMAGE — feathers that catch the light

**Date:** 2026-09-23. **Base:** `e252ca1`. **Branch:** `realism/plumage`.
**Decision:** SHIP ON BY DEFAULT behind `?plumage=0` (a `toggle` on the Flags
tab's Bird group). No frozen oracle is touched; one new test file
(`tests/plumage.test.js`, 19 tests) makes `tests/oracle-manifest.test.js`
report the manifest stale until integration regenerates it — that is the
only red in `npm test`.

## The brief, and the number that set it

At the chase camera the bird is ~140 px tall, and the authored feather detail
maps measured within noise at that distance: texture does not survive the
minification. The SHAPE of a highlight does. So the v3 bird's two feather
materials were rebuilt on three's physical model and given a sky to reflect.

The Standard wing said why it could not go further on its own: metalness was
held at 0.34 because *"there is no envMap on the shipping path — past about
that, three's metal has nothing to reflect and the wing goes DARK between
highlights"*. There is one now.

## What shipped

`src/flight/plumage.js` (pure tables and functions, THREE injected) and a
compact wiring in `index.html`:

- **Both feather materials are `MeshPhysicalMaterial`, dielectric keratin**
  (metalness 0, IOR 1.56, F0 0.048). The contour (body/head/beak) carries
  **sheen** — the Charlie lobe three uses for fibre — in a pale lilac lifted
  from the body's own violet, sheen roughness 0.45. The vane (wings/tail)
  carries a **thin-film** (three's Belcour & Barla 2017): 265 nm of n = 1.8
  over keratin.
- **The film lives on the bronze feathers only.** The vane material also
  carries the teal primaries and the red tail root, and a gold film over them
  turned the red orange and the teal olive in the first capture. The shader
  masks `material.iridescence` by the vertex colour's bronzeness (red the
  largest channel, green 20-40% of the way to yellow, real saturation);
  `bronzeFilmWeight()` is the JS reference and the test runs the palette
  through it: every bronze and secondary > 0.95, red/teal/violet < 0.05.
- **A bird-only environment map**: the biome's sky gradient, baked with the
  `?ibl` path's own `buildEquirectSky` into a 64x32 float equirect and
  prefiltered with PMREM **once per biome switch** (and once when the bird is
  built, because the first `setEnvironment()` runs before the bird exists).
  `scene.environment` is never touched. One generator and one render target
  for the session: later bakes render into the first target
  (`fromEquirectangular(source, target)`), so a switch allocates nothing.
- **The env is aimed at the local up every frame.** The bake's zenith is world
  +Y and three samples an env map in world space, so an un-rotated bird on
  the equator would reflect the horizon on its back. `update()` writes the
  rotation that takes the radial up to +Y into both materials' own
  `envMapRotation` Euler (two angles, no roll — the gradient has no azimuth,
  so any such rotation is correct), zero allocation. three NEGATES the Euler
  before building the shader's matrix ("accommodate left-handed frame"), so
  the angles are written negated; a unit test runs three's own arithmetic on
  13 up vectors and a control shows the un-negated angles miss by 0.77-0.93.
- **The sky is counted once.** The HemisphereLight already IS this game's sky
  irradiance, tuned per biome; an env map adds its own on top. The bird's
  shader moves the hemisphere irradiance into the physical IBL slot
  (`iblIrradiance`) right after `#include <lights_fragment_maps>` and drops the
  env map's own diffuse: the hemisphere lights the bird as before, but
  energy-conserved against the specular, film and sheen, and it feeds the
  sheen's indirect lobe; the env map contributes only its reflection.
- **The diffuse energy is preserved.** A metalness of 0.34 took 34% of the
  wing's diffuse away and a dielectric gets it all back, so each material's
  `color` (which multiplies the vertex colours) is `1 - old metalness`: 0.66
  on the pionus wing, 0.88 on the body — the energy-preserving conversion, and
  it keeps every vertex colour's hue.
- **`specularIntensity` 0.5, roughness 0.55 (wing) / 0.7 (body)**: a feather
  is barbs with gaps between them, not a sheet of keratin, and barbules
  scatter rather than mirror. **Emissive lift 0.34 → 0.14.**
- **The hand-made patches still chain and compile** (rim, feather sheen, the
  authored detail/normal maps) — the physical shader shares three's chunk
  names, and the plumage patch extends the program cache key
  (`birb-rim-v1-sheen|plumage-v1`). Their STRENGTHS move: the rim to 0.6x
  (0.42 → 0.252) and the feather-sheen band to 0x, because the physical
  Fresnel and sheen are the rim now and the film is the colour shift the band
  imitated.
- `?bird=v1` / `?bird=v2` are untouched: they are A/B builds, frozen at what
  they were judged as, and an env map on them would change their lighting.

Draw calls and triangles are unchanged (9 calls / 1,518 tris in every sheet
tile): two materials changed type, nothing was added.

### Anisotropy — deliberately not used

A feather's anisotropic highlight runs across its BARBS, and the barbs leave
the rachis toward the tip on both sides — a chevron, mirrored across the
shaft. three takes the anisotropy direction from one tangent frame per
surface (the UV's u axis rotated by one angle), and every v3 feather plate
carries a single UV frame, so any direction chosen is right on one vane and
mirrored-wrong on the other. A correct direction needs per-vane UVs or a
direction map; neither exists. A highlight stretched the wrong way on half of
every feather is not realism.

## The film, and why 265 nm

`thinFilmReflectance()` is three's `evalIridescence` transcribed (including
its spherical-Gaussian Schlick, not `pow(1 - c, 5)` — the first transcription
used the textbook form and was wrong), agreeing to 0 difference with a second
transcription made from the GLSL, and the test pins the claim through it.
Hue of the film's reflectance by view cosine, n = 1.8 over keratin:

| cos(view) | 1 | 0.8 | 0.6 | 0.45 | 0.34 (chase) | 0.25 | 0.15 |
|---|---|---|---|---|---|---|---|
| 250 nm (first cut) | 34 | 57 | 91 | 114 | 132 | 151 | 159 |
| **265 nm (shipped)** | **13** | **34** | **54** | **72** | **84** | **93** | **100** |
| 280 nm | 340 | 14 | 33 | 44 | 50 | 54 | 59 |

250 nm went lime at the chase camera, which read as the khaki the palette's
own comment warns about ("a bronze greyed toward green is not a duller
bronze, it is a different colour"); 280 nm never leaves orange. 265 nm is
copper face-on, gold at mid angles, yellow at the chase camera's ~20-degree
view and runs on toward yellow-green at grazing. A lower-index film
(n 1.4-1.5) travels further in hue but its saturation collapses to 0.04 by
grazing — the "green" would be white. **The shift is TOWARD green, and at
grazing it is yellow-green, not green**; in the forest the teal sky it
reflects pushes it greener, in the canyons the peach sky keeps it gold.

## The measurement — and why the bird sheet could not make it

The brief's method is `tools/birb-bird-sheet.mjs` run twice. It was, and its
numbers are below, but **it is not an A/B**: the first plumage=0-vs-plumage=0
pair measured tiles up to 35% apart in luminance and 49 degrees apart in hue.
Four separate causes, each found by a control that failed, each fixed in the
new `tools/birb-plumage-ab.mjs`:

1. **Tap-to-Start asks for NATIVE fullscreen on desktop** and Chromium
   refuses a synthetic click most of the time — not every time. Granted, the
   canvas lays out at 460x396 and that boot frames the bird smaller and
   higher. Leaving fullscreen afterwards is worse (388x334); a stub that
   RESOLVES skips the game's CSS-fullscreen fallback (388x269). The tool
   refuses every request before load, which is the path the good boots took.
2. **`setSunTime()` with the cycle paused never moves the light.** The key
   light is re-aimed and re-tinted inside the loop only while the cycle is
   enabled, so `setSunTime(t); setSunEnabled(false)` in one call leaves the
   light at the boot's `Math.random() * 600` hour. That alone put a control
   pair 10-20% apart in every view. Set the time, run 3 frames enabled, then
   pause. (The bird sheet does exactly the one-call version.)
3. **The world is seeded per boot**, and a teleport into a cloud or crown
   collider is a knockdown: one control boot photographed a bird tumbling to
   the ground. Pin `worldSeed(16160)`, rebuild, stand the bird 70 above the
   ground, and boot `flight=classic` (the stunt model sinks while frozen).
4. **One mask per view**: the harness's own "not studio grey" rule applied
   per run moves pixels in and out of the set as the shading changes, so the
   tool ORs every run's mask and measures all runs on the same pixels.

With those, the control (a second plumage=0 boot) reads **−0.1% mean
luminance, 0.4 degrees per-pixel hue, chroma x1.00** against the first.

### Forest, pinned A/B (A = `?plumage=0`, B = default, A2 = control)

Mean LINEAR luminance over the union mask; per-pixel hue = chroma-weighted
mean |CIELAB hue shift| over pixels with C* >= 8 in both (the bird is five
colours at once, so the hue of its MEAN colour is near grey and says nothing).

| view | A lin | B lin | ΔL | per-pixel \|Δhue\| | chroma | control ΔL |
|---|---|---|---|---|---|---|
| front | 0.1368 | 0.1651 | +20.7% | 13.7° | x0.93 | 0.0% |
| back | 0.1843 | 0.1410 | −23.5% | 10.5° | x1.41 | +0.1% |
| left-profile | 0.0699 | 0.0754 | +8.0% | 3.5° | x0.94 | −0.2% |
| top | 0.0513 | 0.0617 | +20.2% | 4.0° | x0.99 | −0.1% |
| **three-quarter-rear-chase** | 0.0908 | 0.1162 | **+28.0%** | 8.5° | x1.08 | −0.1% |
| **chase-left** | 0.1029 | 0.1287 | **+25.1%** | 7.7° | x1.10 | −0.4% |
| **chase-high** | 0.1570 | 0.1634 | **+4.1%** | 16.1° | x1.13 | +0.2% |
| edge-on-wing | 0.0762 | 0.0764 | +0.2% | 3.6° | x0.90 | −0.5% |
| below | 0.0256 | 0.0263 | +2.5% | 6.1° | x0.97 | +0.4% |
| flap-top-of-stroke | 0.0641 | 0.0788 | +22.9% | 10.4° | x1.11 | −0.1% |
| flap-mid-downstroke | 0.0614 | 0.0652 | +6.1% | 8.6° | x1.10 | −0.3% |
| **mean** | 0.0928 | 0.0998 | **+7.6%** | **8.4°** | **x1.06** | **−0.1% / 0.4° / x1.00** |

Other biomes, same tool (no control boot): **canyons +3.9%, 8.1°, x1.09;
city −5.8%, 5.9°, x1.15.** Mean luminance is inside the ±15% budget in all
three. The spread per view is real and not noise: the back view loses the
rim it was mostly made of (−23.5%), the chase views gain the sky the wing now
reflects (+25-28% linear, which is ΔL* +2.1-2.3 — 32.1 → 34.4 at the chase).
The hue moves most at chase-high (16°), where the bronze covert turns golden
under the key light; the red tail root and teal primaries hold their hue
(top view 4°).

### The brief's own method: tools/birb-bird-sheet.mjs, twice

`--query plumage=0` then default, tiles measured with the same union-mask
rule: mean **+14.9%**, per tile −32.3% (edge-on) to +113.6% (top), hue
shifts to 71°. Looking at the two sheets explains it — the key light comes
from a different hour in each boot (trap 2), so the edge-on body is lit
lavender in one and navy in the other. These numbers measure the harness,
not the plumage; they are reported because the brief asked for them. Both
sheets exit 0 with all ten tiles intact, 9 calls / 1,518 tris each.

### What the sweep taught (B-only runs against the pinned A)

| change from the first cut | mean ΔL | note |
|---|---|---|
| first cut (film everywhere, spec 1, rough 0.4/0.6, band x0.45) | +54.8% | wing washed pale mint, red tail pink |
| same with envMapIntensity 0 | −7.2% | **the reflection was ~60 points of it** |
| + albedo = 1 − old metalness | +44.8% | |
| + wing roughness 0.55, band off | +31.1% | |
| + specularIntensity 0.5, body roughness 0.7 | +17.8% | |
| + film masked to bronze | +6.8% | red and teal hold |
| rim 0.6x → 0.8x / 1.0x | +19.8% / +31.8% | **rim: ~12 points per 0.084** |
| film 250 → 265 nm (shipped) | +7.6% | bronze kept at the chase camera |

Two lessons worth keeping. **Under this game's bright pastel sky a dark
glossy bird is mostly reflection**: the env map did not add a highlight, it
added most of the bird. And **the rim is the most sensitive knob on the
bird** — an additive fresnel on something that is mostly silhouette.

## Checks

- `tools/realism-checks/plumage-physical.mjs` (own boot, `plumage=1`):
  physical materials, film denser than keratin, sheen, dielectric, env bound,
  the sky counted once; `plumage().zenith` = (0, 1, 0) at the north pole, the
  equator and the south pole; then ON THE GPU — a white-above/black-below sky
  and its inverse with the env's own diffuse routed in (hemisphere 0), the
  bird's back photographed from above at all three latitudes: the back must
  be 2x brighter under white-above, and the equator/south contrast at least
  0.6x the north's (a world-frame env on the equator lights the back from the
  side and the pair comes out nearly equal). Then the probe restores the
  materials exactly and a biome switch must rebake the sky once.
- `tools/realism-checks/plumage-off.mjs` (`plumage=0`): the Standard bird
  exactly as shipped at e252ca1 — types, metalness, roughness, lift, rim and
  sheen strengths, no env map, no plumage patch.
- `tests/plumage.test.js` (19): the flag and the Flags-tab reader agree; the
  table is keratin; the albedo is 1 − old metalness and its hex decodes back;
  the film's hue path (copper → gold → yellow-green, monotonic); the bronze
  mask on the real palette; the env rotation through three's own arithmetic
  plus its un-negated control; the patch's anchor, chain, cache key,
  idempotence and loud failure; the env's bake/re-bake/dispose.
- `__BIRB.plumage(opts)` (`?debug=1`): the live materials, the env state and
  the zenith; `set` tunes any parameter live (the sweep above ran on it) and
  `sky` bakes a caller's sky. `__BIRB.birdStudio(true, { world: true })` holds
  the bird still in front of the real world for context captures.

## Verification (this branch, SwiftShader)

| what | result |
|---|---|
| `node tools/birb-realism.mjs --only plumage-physical,plumage-off` | **28/28**, both boots 0 console errors/warnings. Back contrast white-above minus black-above: N 0.156 / E 0.154 / S 0.146 linear |
| same check against a mutation (env left in the world frame) | **caught, 5 failures**: all three zenith checks, the south back inverted (0.046 vs 0.116), latitude contrast N 0.159 / E 0.086 / S −0.070 |
| `node tools/birb-shaders.mjs` (Ultra, all four biomes, bird on the default path) | all shaders compile in 4 environments, exit 0 |
| `node tools/birb-modes.mjs` | all 5 modes ok in forest, exit 0 (no warnings) |
| `node tools/birb-bird-sheet.mjs` x2 (`plumage=0` / default) | both exit 0, ten tiles each, 9 calls / 1,518 tris in every tile |
| boots `?pionus=0`, `?bird=v1`, `?plumage=0`, default | 0 console errors/warnings each; blue bird physical with no film, v1 untouched (no plumage, no env) |
| `node --test tests/plumage.test.js` | 19/19 |
| `npm test` | 747 pass, 210 skipped, **2 fail — both `tests/oracle-manifest.test.js`, both naming only the new `tests/plumage.test.js`** (expected until integration regenerates the manifest) |
| `BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js` | 4/4 (the new module is in `sw.js` CORE_ASSETS) |
| `sha256sum -c tools/oracle-manifest.txt` | 0 — no frozen file touched |

Reproduce the A/B: `node tools/birb-plumage-ab.mjs --out <dir>` (A =
`?plumage=0`, B = default, A2 = the control; `--env canyons`, `--world` for
the bird in front of the real world, `--set '<json>'` to tune B live,
`--baseline <dir>` to reuse an A).

## Not verified

- **No phone.** SwiftShader is not a device. The physical program with sheen
  + iridescence + a CUBE_UV env is a heavier fragment shader than the
  Standard one it replaces — on ~140 px of screen — and adds program variants
  compiled at boot (plus PMREM's equirect and blur programs, once). None of
  that has a device number. If the tier starts shedding where it did not,
  `?plumage=0` is the control.
- PMREM renders into half-float targets and samples a FloatType equirect
  with NEAREST filtering (DataTexture's default), the same path `?ibl` takes;
  not seen on iOS.
- **Integration interplay**: the realism/planet-light package re-aims the
  HemisphereLight at the local up and may let the dome's colours follow the
  sun. The bird routes whatever the hemisphere delivers, so the first is
  inherited for free; the second is not — the bird's env bakes the biome's
  static `definition.sky`, so a sun-driven dome palette would need
  `birbPlumageEnv.setSky()` called when it changes (it is a PMREM render:
  on a sun step, not per frame).
- Found and NOT fixed (it would change the `?plumage=0` path): the rim colour
  is retinted from the biome's sky only on a biome SWITCH, and the first
  `setEnvironment()` runs before the bird is built — so on a plain boot the
  rim is the constructor's cyan `0x9fe8ff`, not the forest's sky.
- The underside of the wing, seen from below, now reflects the ground colour
  through the film (olive where it was near-black). The chase camera never
  sees it; nobody has judged it.
