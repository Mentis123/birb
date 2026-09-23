# G-REALISM-ANALYTIC-SHADOWS — shadows without shadow maps

**Date:** 2026-09-23. **Branch:** `realism/analytic-shadows`, based on
`e252ca1`. **Decision:** SHIP, both halves ON by default, each behind its own
boot flag (`?horizon=0`, `?birdshadow=0`) whose off side is the true before:
no bake, no driver, no patch, the shader byte-identical to `e252ca1`. No
frozen oracle was touched; the three new test files make
`tests/oracle-manifest.test.js` report the manifest stale, which is the
expected and only failure (`npm test`: 981 tests, 769 pass, 210 skipped,
2 fail, both of them that).

**Not measured: the phone.** Every number below is this machine's Chromium
on SwiftShader. No frame-time, thermal or upload-hitch number exists for the
iPhone 16 Pro, and none is claimed.

## What was missing

Real shadow maps exist only at Ultra: a 110x110-unit orthographic map round
the bird whose casters are the bird and ~20 cone proxies at the nest hosts,
with the ground as the only receiver. **Below Ultra nothing in this world
cast anything.** A 40-unit ridge between a valley and a 20-degree sun left
the valley floor exactly as bright as the ridge top; a grove of 40-unit
trees left no mark on the grass it stood in; and the bird's only shadow was
`contact-shadow.js`, a disc laid straight down the radial whatever the sun
was doing. Even at Ultra the 285 forest canopies, the peaks, the spires and
the city were not casters, and the terrain relief never was.

## What shipped

### 1. A horizon map of the whole planet, baked once per world

`src/environment/horizon-map.js` (pure, deterministic, no THREE) answers the
question a shadow map answers — *can this point see the sun?* — for every sun
direction at once. For each texel of a **512x256 equirect grid** over the
sphere (the ground mesh's own `SphereGeometry` convention, +Y pole at v = 0)
it stores the elevation of the highest thing on the skyline in **8
azimuths**, marched along great circles out to **84 units** on a geometric
step (1.3 units, x1.17: dense near the eye, where a canopy edge is decided).
Every elevation is **curvature exact** against the texel's own radial up —
`tan(e) = (r_s cos b - r_e) / (r_s sin b)` — so the far side of the planet
drops away as it does from a real hill. Angles pack into two RGBA8 textures at
0.7 degrees a step, well inside the penumbra.

The occluder field is the terrain plus the tall props **splatted as solids on
their own footprints**: every forest canopy, pine crown, peak, spire, needle,
corridor and cliff wall, and city tower, each with the top-envelope profile of
its own unit geometry (`LatheGeometry` follows its outline, a cone is a cone,
a box is flat). Two eye heights read that one field: the **ground** set looks
out from the terrain (what the ground material reads, so the forest floor is
shaded by its trees) and the **prop** set from the occluder envelope (so a
canopy top reads its own skyline rather than the inside of its own column).
An R8 envelope texture lets a prop fragment well above the envelope — a snag
top, the upper storeys of a wall whose footprint is next door — shed a
skyline that was not measured where it stands.

The bake runs in a **module worker** (`horizon-worker.js`); the main thread
keeps only the height fill and the splat. If the worker cannot start or
fails, the same bake runs on the main thread in 6 ms slices. Until it lands
the patch is inert (strength 0); it then fades in over 0.8 s of game clock.

### 2. The sun's light, attenuated where three already attenuates it

`src/environment/horizon-shadow.js` patches every lit, opaque world material
(`addHorizonShadow`, chained, called BEFORE `addAtmosphere` in the same
loop). Per fragment: the equirect uv and East/North from the fragment's world
direction, the sun's azimuth and elevation in that frame, a tent blend of the
two azimuths either side of it (two texture reads), and
`lit = smoothstep(h - 0.05, h + 0.05, sunElevation)`.

**The visibility is applied INSIDE three's light loop**, by wrapping
`getDirectionalLightInfo` for the one light whose direction is the sun's
(`dot > 0.9999`). The brief asked for a subtraction at `<opaque_fragment>` of
the key light's Lambert term recomputed from `directionalLights[0]`; three
facts made that the wrong place:

- **Index 0 is not a stable name for the sun.** Three sorts shadow casters
  first, so with maps on `directionalLights[0]` is the shadow light — and on
  `e252ca1` the key light is still lit beside it, TWO sun-aligned lights
  (the double sun the planet-light package removes by hiding the key while
  maps are on). Matching by direction shadows every light that shines from
  the sun, in all three states, without knowing which one it is.
- **A subtraction after the loop cannot compose with the shadow map.** Three
  has already multiplied the shadow light by its own map inside the loop, so
  subtracting `(1 - lit)` of an UNSHADOWED recomputation removes light the map
  had already removed. Multiplying the same `IncidentLight.color` the map
  multiplies makes the two a product, which is exactly right: a point in
  both shadows is in shadow once.
- **It shadows the specular too.** A Lambert-only subtraction leaves the
  sun's highlight glinting on a surface the sun cannot reach.

The unit suite pins the wrapper (it replaces `getDirectionalLightInfo` only
around `<lights_fragment_begin>`, and only for a light matched by direction);
`analytic-shadows-maps` proves on the live page that with maps on
`directionalLights[0]` is the shadow light, that it is matched as the sun, and
that the ridge still shadows the ground the map is already shadowing.

The same eight angles give **sky visibility** — the mean of `cos^2` of the
skyline is the cosine-weighted share of the dome left open — which scales
`reflectedLight.indirectDiffuse` just ahead of `<aomap_fragment>`, where three
applies its own AO. Its strength is **0.65**, not 1 (and not the 0.8 it first
shipped at): an occluding hill is itself lit and returns part of the sky it
blocks, and a canopy splatted as a solid column blocks more of the sky than a
crown with gaps in it does. At 0.8 a dense grove's floor under a high sun went
from lit green to a grey-green that was mostly mist.

`addAtmosphere`'s sun rim now multiplies by the same visibility (a rim in a
ridge's shadow is a rim the sun is not lighting) — emitted only when the patch
ran first, so without it `visual-style.js` emits byte-identical GLSL, which a
test diffs.

### 3. The bird casts its shadow along the sun

`src/effects/bird-shadow.js`: the body and both wings as three ellipsoids read
off the live rig every frame (body from the model's AABB in anchor space
excluding the wing subtrees; each wing from shoulder to `tipFeather`, chord
across the bird's own up), zero allocation. Each fragment moves itself and the
sun ray into each ellipsoid's unit-sphere space and takes Quilez's plausible
sphere soft shadow — miss distance over distance along the ray, smoothstepped —
converted back to **world** units first, so the penumbra is an angle: sharp
where a wingtip nearly touches the ground, soft with height, with no blur to
tune. It fades out 12 to 20 units from the bird (the per-fragment early-out),
and **stands down on any fragment that already receives the real shadow map**
(`receiveShadow` under `USE_SHADOWMAP`), because with maps on the bird is a
caster and the ground has its shadow already.

**The contact disc stays**, as the brief directed: it is the straight-down
ALTITUDE cue, and the bird usually cruises 10-30 units over the actual ground,
beyond the ellipsoids' reach. Near the ground both show; at a high sun they
overlap, at a low one the sun shadow lands off to the side. If the owner reads
that as two shadows, the hand-over is one line in the contact-shadow block
(scale the disc's opacity by `1 -` the sun shadow's presence at the bird's
altitude); it was deliberately not done here.

## Flags, levers, hooks

| | default | off side |
|---|---|---|
| `?horizon=0` | ON | no bake, no textures, no horizon GLSL: the before |
| `?birdshadow=0` | ON | no driver, no ellipsoid GLSL: the before |

Both are switches in the Flags tab (Shading group). With both off no material
carries the patch at all (`__BIRB.horizonPatched()` reads 0 — a check asserts
it). Runtime A/B without a recompile: `__BIRB.horizon(s)` and
`__BIRB.birdShadow(s)`, where 0 is the old light pixel for pixel.
`__BIRB.horizon()` also reports the bake (mode, timings, props splatted) and
which visible directional lights the shader will treat as the sun, with
`index0` naming what `directionalLights[0]` is this frame.

For the checks: `__BIRB.horizonFind({ want: 'shadow' | 'canopy' | 'lit' })`
reads the baked map and CONFIRMS each hit by marching the analytic terrain
alone, so a check photographs a shadow it did not have to hope for;
`__BIRB.hold(on)` stops the simulation clock while rendering continues and
snaps the chase rig onto the held pose; `__BIRB.project(x,y,z)` is the pixel a
world point lands on.

## Measured

Bake, this machine, one boot per biome (main thread / worker, ms):

| biome | fill | splat | props splatted | worker bake | post-to-landed |
|---|---|---|---|---|---|
| forest | 23.0-24.8 | 11.8-14.6 (27 once, beside `npm test`) | 280-292 | 312-420 | — |
| canyons | 30.1 | 5.3 | 167 | 243 | 1824 |
| mountain | 19.7 | 4.0 | 271 | 271 | 1148 |
| city | 13.6 | 1.9 | 287 | 320 | 1743 |

**World build: +16 to +39 ms on the main thread** (fill + splat; 52 once,
with the unit suite running beside it). The ~1 MB structured clone to the
worker and the 2.2 MB texture upload when the bake lands are not in that
number. "Post-to-landed" is wall clock through an environment switch, when
the main thread is busy compiling the new world's programs and handles the
worker's message late; with the 0.8 s fade that is about two to three
seconds before the shadows arrive, which is why they fade rather than pop.
The bake's first version ran 295 ms on the main thread; reciprocal-radius
and precomputed-weight rewrites took it to ~225-265, and the worker took it
off the thread entirely.

Memory: **2,228,224 bytes of GPU texture** (four RGBA8 512x256 + one R8), the
same bytes again in JS as the DataTextures' `image.data`, plus a 131 KB prop
mask kept for `horizonFind`. **Zero draw calls, zero triangles.** Per lit
fragment: two texture reads (a third, the envelope, on props), a few dozen
ALU ops, and for the bird a distance early-out before three ellipsoid tests.

Visual A/B, `tools/birb-realism.mjs`, pose held with `hold()`, lever
on / off / on / off in one box so every measurement carries its own control
(every control pair passed its 0.2-0.4% tolerance, and agreed to four
decimals wherever the check prints it):

| darkening, on vs off | this branch | planet-light trial merge |
|---|---|---|
| ridge shadow on open dry ground (sun 15.8-19.5 deg under a 19.4-24.0 deg skyline) | 26.8%, 31.4%, 47.9% | 38.0% |
| canopy shadow the terrain alone would light | 29.1%, 44.3%, 51.0% | 46.3% |
| the bird's shadow where it lands (darkest 7x7 window) | 46.7%, 46.0% | 50.5% (13 px box) |
| ridge shadow with Ultra's maps on | 35.0%, 33.0%, 40.5%, 42.8% | 29.7% |
| the ellipsoids with maps on | 0.00%, 0.00% (most-darkened window) | 0.0% (box) |

Each number is a separate boot, in order; the last on this branch is the
final 31/31 run. Props are unseeded, so the spots differ between boots. The
bird's first two numbers with a fixed box, 25.6% and 12.6%, are the trap
recorded below, not the shadow. `turning the horizon on brightens no pixel`
holds on all 73,044 measured (the minimap's moving markers are excluded: they
were the only pixels that ever changed the other way). Captures of canyons,
mountain and city show pine shadows on the snowfield and shaded spire flanks;
the city at dusk barely moves, because its key light is dim.

Unit tests: 41 across `horizon-map` (19), `horizon-shadow` (13) and
`bird-shadow` (9). Mutation-tested: mirroring the march direction fails 2,
flipping the North frame's sign fails 2, taking the penumbra in the
ellipsoid's scaled space fails 3, reverting the anti-aliased splat to
all-or-nothing fails 1.

Also green on this branch: `BIRB_PERF_IMPL=1 node --test
tests/build-identity.test.js` (the new modules are in `sw.js` `CORE_ASSETS`),
`tools/birb-shaders.mjs` in all four biomes, `tools/birb-modes.mjs`,
`tools/birb-walk.mjs`, and zero console warnings on every boot.

## What cost a round

**`freeze()` does not hold a frame.** It zeroes the speed, and the controller
keeps flying the bird on (~0.45 units a frame under SwiftShader), so a
cockpit camera looking straight down drifts off its patch between the on and
off shots. `__BIRB.hold()` stops the clock instead — and has to SNAP the chase
rig, because with delta 0 `BirdCamera`'s damping factor is 0 and it would
stay wherever it was; under the stunt rig it also re-seeds the held level
heading, which is stale after a `restorePose`.

**The first ridge measurements were of a lake and of mist.** A spot in the
map's shadow can be under water (water is a `ShaderMaterial` and is not
patched: a lake inside a ridge's shadow stays bright, which is mostly right
for a surface whose look is its reflection) or deep enough in a valley that
the atmosphere's mist dominates the frame. The finder excludes water and prop
footprints and demands a 5x5 block of shadow; the camera looks straight down
from 14 units.

**A soft shadow taken in the ellipsoid's scaled space is several times too
wide across the wing.** `d/t` in unit-sphere space is an angle only for a
sphere; for a wing 0.05 of its length thick, the thin axis stretched the
penumbra until the wing's shadow was a smear. The miss and the distance go
back to world units before the ratio; a test with a thin and a fat ellipsoid
pins it.

**One grounded bird failed three checks.** Seven units up a 20-degree sun ray
is 2.4 units above the spot and 6.6 across it, and on one boot the ground
under the BIRD was high enough for the landing check to ground it. GROUNDED
survives every later `restorePose`, and `forceGroundedPose` then pinned the
next check's cockpit camera to the ground: bird 0.0%, the maps check's
control pairs NaN. Found on the trial merge with `realism/planet-light` and
reproduced here alone. The placement now walks up the ray until the bird
clears the ground under itself by 2.5 units, verifies it is still flying
where it was put, and taps Fly before each check and in `restore()`.

**A fixed box measured the shadow's edge.** The spot is on the sun ray through
the bird's ANCHOR; the body ellipsoid's centre sits a few tenths off it and
the rendered ground is a tessellation of the sampled one, so a 6 px box read
12.6% on one boot and 50% on another, same code. The check now takes the
7x7 window the first pair darkens most within 24 px and reads the second pair
there as the control; the maps check asserts the MOST darkened window is
nothing, which is stronger than one box.

**Every canopy stood on a staircase.** A texel is 1.47 units; a hard in/out
footprint put 1.5-unit steps round every crown, and a shadow is that outline
projected along the sun. The splat now raises an edge texel by its coverage.

## What a heightfield cannot say, and so does not

A horizon map knows one height per texel: "solid from the ground up to
here". So **clouds and arches are not occluders** (it would stand a cloud on a
60-unit pillar), and neither are the forest's three **130-unit landmark
trees**: their crowns start 45 units up, and splatted as columns they would
black out a 50-unit disc of open ground under each one. Under an ordinary
canopy the same model is close enough — the ground under a crown IS in its
shade — but it overestimates how much sky a grove floor loses, which is part
of why the sky term is 0.65. Shadows reach 84 units, which a 20-degree sun
behind a 30-unit ridge fills; a lower sun's longer shadows are cut there.

## Not verified, and the next steps

- **The phone.** Two to three extra texture reads on every lit fragment at
  Ultra's native DPR, the 2.2 MB upload the frame the bake lands, and the
  bake itself on an A18 Pro are all unmeasured. `?horizon=0` / `?birdshadow=0`
  are the cost A/B; `__BIRB.horizon(0)` skips the texture reads (uniform
  branch) without a recompile. If the adaptive tier starts dropping where it
  did not, gate the horizon on `tier < 2` like the ribbons.
- **iOS's module-worker path.** Safari has had module workers since 15, and
  none of this was run on it. If a worker cannot start, the bake falls back
  to 6 ms main-thread slices: verified here by serving a 404 for
  `horizon-worker.js` — mode `sliced`, reason `worker failed to start`,
  landed and faded in 6.0 s after the post under SwiftShader, console clean —
  and a unit test pins that slicing changes no byte of the result.
- **The bird is not shadowed.** It flies fully lit through a valley the
  terrain has put in shade. The fix is the same visibility sampled once per
  frame at the bird (the JS mirror, `sunVisibility`, already exists) and fed
  to the bird's materials — which the plumage package owns, so it is left for
  after that merge rather than patched into materials another branch is
  rebuilding.
- **Integration with `realism/planet-light`** was trial-merged in this
  worktree (`git merge --no-commit`, then aborted): the merge is automatic,
  every planet-light check and the ridge, canopy and off checks passed on the
  merged tree, and the bird and maps checks passed 14/14 once the placement
  fix above was in — including the maps-on state, where planet-light hides
  the key light and the shadow light is the only sun. Under planet-light the
  sun is re-derived from the bird's own horizon frame every frame and copied
  into `visualUniforms.sunDir`, which is the uniform object this patch reads,
  so nothing here had to change for it.

## Lineage

- Max, *Horizon mapping: shadows for bump-mapped surfaces*, The Visual
  Computer 4 (1988) — the representation.
- Timonen & Westerholm, *Scalable Height Field Self-Shadowing*, Eurographics
  2010 ([pdf](http://wili.cc/research/hfshadow/hfshadow.pdf)) — horizons for a
  whole height field in linear time; the brief's pointer for the bake.
- Fritsch et al., HPG 2025
  ([diglib](https://diglib.eg.org/items/5c49e826-6f07-448c-be0e-b98c36f46202))
  — Fourier-compressed planetary horizon maps: the same idea on a curved
  planet, which is this geometry. Eight bytes a texel is enough at 512x256;
  their compression is the route if the map ever needs more azimuths.
- Iwanicki, *Lighting Technology of The Last of Us*, SIGGRAPH 2013
  ([ACM](https://dl.acm.org/doi/abs/10.1145/2504459.2504484)) — characters
  as ellipsoids for soft occlusion and shadow.
- Unreal Engine, [Capsule Shadows](https://dev.epicgames.com/documentation/en-us/unreal-engine/capsule-shadows-overview-in-unreal-engine)
  — the same trade for skinned characters, shipping.
- Quilez, sphere soft shadow — the closed-form penumbra evaluated per
  ellipsoid here.
