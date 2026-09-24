# G-REALISM-CLOUD-VOLUME — clouds with volume, at mesh cost, and the shadows those clouds cast

**Date:** 2026-09-23. **Base:** `e252ca1`, reviewed and then merged with
the integrated realism wave 1 (`d47fc7e`). **Branch:** `realism/cloud-volume`.
**Flag:** `?cloudvol=0` restores the before exactly (Flags tab, "Clouds with
volume + real cloud shadows"). **Default: ON.**
**Decision:** shipped as a toggle, on by default: every check below measured
it, the captures read as clouds, and the one cost this box can see is on the
desktop path, not the phone's. The phone is unmeasured.

## Review and wave-1 integration (2026-09-23, later)

An adversarial review of `4fda698` on its own, a merge of wave 1 (planet
light, the atmosphere model, horizon and bird shadows, physical plumage), and
the wiring between them. Commits: `95e5a2b` review fixes, `b85cca2` the
merge, `505a217` the wiring, then this document. The builder's sections below
this one describe `4fda698`; where they disagree, this section is current.

### What the review found

| # | Severity | Finding | Fixed |
|---|---|---|---|
| 1 | major | **The cloud shadow darkened every direct light, not the sun.** It multiplied `reflectedLight.directDiffuse`, the SUM of every directional, point and spot light, so under a cloud the rim (0.48) and fill (0.38) — which come from other parts of the sky — lost the same 88% as the key (1.25). | yes — the sun's own `IncidentLight` colour is scaled inside three's light loop (`getDirectionalLightInfo` wrapped for the length of `<lights_fragment_begin>`), the light matched by DIRECTION, so the Ultra shadow light standing in for the key is matched too |
| 2 | major | **Merged as built, it would have stacked on the horizon shadow** as a second, differently-shaped term: a summed-direct multiply after the horizon's per-light visibility, a second sky multiply, and a sun rim that saw only the horizon. | yes — the cloud uses horizon-shadow.js's contract by name (`birbSunVis` / `birbSkyVis` / `birbSunView`) and, where that patch is on the material, only multiplies into it: one wrapper, one sky multiply, the sun lost once by the product, the rim reading the product |
| 3 | minor | The occlusion was unclamped: `atmosphere` is a live lighting lever (`setLighting` takes any finite number) and past 1/0.88 the sun went negative. Not a NaN here — Neutral tone mapping's toe maps a negative channel to a positive one (measured below) — but wrong light, and a raw negative in the bloom path's linear target. | yes — clamped to [0, 1], in the shader and its JS mirror |
| 4 | minor | NaN-capable operations: `normalize` of the sun, the view ray and the puff centre; the Henyey-Greenstein denominator (zero at g = 1 into the sun); divisions by the density, lumped and shadow-sphere radii; the in-cloud fog colour into the sRGB `pow`. | yes — `birbCloudUnit` (zero for zero) for every unit vector, every divisor floored, the fog colour floored; a test counts zero bare `normalize(` in both patches |
| 5 | minor | `ensureWorldVarying` existed twice, the package's copy with LOOSER regex guards than the exact-string original — two guards that can disagree are how a varying gets declared twice. | yes — one definition: visual-style.js exports it (wave 1 made the identical change, so the merge took it cleanly) |
| 6 | minor | The in-cloud fog was 60% a CONSTANT pale grey, so under the atmosphere model the inside of a cloud stayed noon-white in a world gone orange. | yes — captured with the atmosphere's own bases, scaled by the mist's ratio |
| 7 | minor | The bird was made the puffs' focus through a fire-and-forget `import()` with no catch, racing the bird's attach. | yes — imported with the other modules at boot |
| 8 | minor | `?cloudvol=0` matched as a prefix (`cloudvol=05` would turn it off). | yes — `(?:&|$)` |
| 9 | minor | Post-merge the shadow checks read their spot with a STALE sun: planet light defines the sun in the bird's own frame, so a placement computed before the bird got there used a sun the next frame does not render with (it reported 62.7 degrees at a cycle time whose sun is 19.5), and a stand-off 40 units up could sit in a canopy's collider or inside a puff. | yes — spots come from converged placements; `goToCloudShadow` picks a stand-off no collider and no puff claims; both shadow checks assert the bird is still flying |
| 10 | minor | `__BIRB.holdMotion` (this package: the Pause button) and `__BIRB.hold` (wave 1: the clock held, the chase camera snapped) both exist. | no — different semantics, each used by its own checks |
| 11 | minor | A transparent object drawn after the clouds (ribbons and weather motes, renderOrder 3) shows through a cloud in front of it, because the puffs write no depth. Water is opaque and draws first, so lakes are right. | no — noted |

### The black block

The builder saw one 22x21 px black block at the bottom edge of one 800x600
desktop capture (and a 72 px black band in one `?cloudvol=0` boot). One NaN
pixel in the bloom's scene target makes exactly that block after the half-res
blur, so it was hunted with a DETECTOR rather than by eye
(`nan-sweep.mjs`, session scratch): a `shaderSource` hook wraps every fragment
shader the page compiles so that a NaN output paints a fixed magenta and an
Inf a fixed cyan, both surviving the bloom composite.

- **The detector is proven, not assumed.** A NaN written into one cloud
  uniform paints 23,450 px of the clouds magenta; the same frame after
  `clouds({ reset: true })` paints none.
- **The package's own shaders produced none, even before the fixes.** On
  `4fda698`: 90 desktop shots (800x600: the whole forest set — chase,
  straight down at the ground at three pitches, six clouds from the side,
  toward the sun and from behind at two distances, the ground under each
  cloud's shadow, inside a puff — and the first 27 of the mountain's) and 33
  phone shots (both biomes, the same kinds of pose): 0 NaN px, 0 Inf px.
- **Negative light is not the NaN.** Finding 3 could drive the sun negative,
  and three's sRGB output transform takes a `pow` that is NaN for a negative —
  but Neutral tone mapping runs first, and its toe (`x - 6.25 x^2` for a
  channel under 0.08) maps a negative channel to a positive one. Measured: the
  canyon sine field at `atmosphere` 5 (a large negative region) paints 0 NaN.
- **SwiftShader's `pow` of a negative base is finite.** Each `pow(1.0 -
  |N.V|, k)` in the shared code goes one ulp negative where a surface faces
  the camera exactly: the atmosphere's sun rim, the landmark pool's fresnel,
  the bird's rim light and the feather sheen (visual-style.js :123, :632,
  :703, :777 on this tree). Rewritten to a runtime-negative base they painted
  0 NaN px under SwiftShader (the same rewrite to `sqrt(-1)` painted
  150,394), so they cannot be the SwiftShader block the builder saw. They ARE
  latent on a GPU whose `pow` returns NaN for a negative base (a fast-math
  `pow` is `exp2(y * log2(x))`), and the bird's rim sits on the bird in the
  middle of every chase frame. `max(x, 0.0)` fixes each one; it is listed for
  the owner rather than applied here because it would move EVERY material's
  shader off `d47fc7e`'s bytes, `?cloudvol=0` included, and belongs in its
  own commit.
- **After the fixes**: the sweep was NOT re-run — the reviewer was stopped by a session limit before it could be. What stands after the fixes is the construction below, not a capture.

Every NaN-capable operation in this package's GLSL is now guarded (finding
4), so the volume and shadow shaders are NaN-free for finite uniforms by
construction. The block the builder saw is not reproduced, and nothing in
this package is left that could make it.

### Composed with wave 1

Measured on the merged tree by two new realism checks —
`cloud-volume-compose` (the Amazing boot) and `cloud-volume-atmos-off`
(`?atmos=0`) — at 390x844, seed 16160, `flight=classic`, every pose held and
every clock stopped before a frame is taken.

**Where the patches go.** `createSphericalWorld`'s atmosphere loop chains the
horizon patch first, the cloud shadow second, the atmosphere last, which is
also the order their injections run. The horizon declares `birbSunVis` /
`birbSkyVis` / `birbSunView`, its light-loop wrapper and its sky multiply;
the cloud finds `float birbSunVis` and only MULTIPLIES its visibility into the
two globals, after the horizon has set them and before the light loop reads
them; the atmosphere's sun rim reads the product. With `?horizon=0&
birdshadow=0` there is no horizon patch and the cloud brings the same contract
itself (its own wrapper, the same 0.9999 cosine). Unit-tested against the
REAL `addHorizonShadow` in all three of its configurations: one set of
globals, one wrapper, one macro span, one sky multiply, both reading
`visualUniforms.sunDir`.

**One sun, found by direction.** `__BIRB.horizon().lights` lists every
visible directional light and whether it shines from the sun (the rule the
wrapper uses): at the Amazing boot exactly one, the key; with shadow maps on
exactly one, the shadow light, with the key hidden (planet light's one-sun
fix).

**The cloud takes the sun, once, and nothing else.** One cloud-shadowed patch
of dry forest ground (cloud 1, sun 61.9 degrees, analytic sun visibility
0.156), the camera 40 units up, tone mapping off so the frame is linear and
the sky share off so only the sun term moves; frames with the shadow on, off
and on again, then (shadow off) with the key and with key, rim and fill
switched off, in 16 px cells:

| | Amazing | shadow maps on (key hidden) |
|---|---|---|
| light removed at the spot / the sun's own light there | **0.841** | **0.842** |
| the analytic occlusion there (the JS mirror of the shader) | 0.844 | 0.844 |
| worst (removed - sun) over every sunlit cell | -0.0044 | -0.0048 |
| control (on vs on again) | 0.0000 | 0.0000 |
| rim + fill at the spot, as a share of the sun's light | 15.2% | 13.0% |
| extra light the pre-merge law would have removed over the frame | 23.9% | 22.2% |

So the removal is the sun's light times the analytic occlusion to within
0.003, it is never more than the sun's own contribution, and it is the same
with the key light and with the shadow light that stands in for it. The
builder's shadow check on the same tree: the core takes **40.2%** of the light
(49.8% under the all-direct law), 63.5% of the frame darker by 5%+, 648
penumbra cells to 276 umbra, centred at (0.44, 0.55); real clouds shadow 1.8%
of the sunlit ground against the sine field's 50.8%.

**The horizon bake splats no cloud** — clouds are not terrain, and its
allow-list plus its transparent exclusion already keep them out: the splat
reads `forest-canopies-0:103, forest-canopies-1:96, forest-canopies-2:87`.

**Colour follows the atmosphere.** The cloud's sun colour and sky light are
three's own light uniforms, which the atmosphere model rewrites, so the cloud
needed no wiring to follow it. Cloud 1 from the side, its own linear colour
recovered from a shown/hidden pair and the flat-magenta alpha (44-48k px),
at the cycle's lowest raised sun (19.5 degrees, t = 0 s) and its highest
(58.4 degrees, t = 300 s):

| | low sun | high sun | R/B low vs high | luminance low vs high |
|---|---|---|---|---|
| atmosphere model on | 0.615 / 0.578 / 0.437 | 0.644 / 0.703 / 0.628 | **1.407 vs 1.025** | 0.576 vs 0.685 |
| `?atmos=0` | 0.614 / 0.620 / 0.517 | 0.673 / 0.703 / 0.595 | 1.187 vs 1.132 | 0.611 vs 0.689 |

The clouds warm and dim at a low sun with everything else, and under the
model by far more than under the old warmth heuristic.

The in-cloud fog was the one thing that did not follow. It is now captured
with the atmosphere's own bases (`captureLightBases` calls
`captureCloudFogBase`) and scaled per channel by the mist's ratio — the ratio
the atmosphere applies to the fog and the mist. Low sun over high sun, per
channel: scene fog **1.068 / 0.876 / 0.703**, valley mist 1.068 / 0.876 /
0.703, in-cloud fog 1.068 / 0.876 / 0.703; under `?atmos=0` the in-cloud fog
holds at 1.000 / 1.000 / 1.000.

**The bird.** It takes a cloud's shadow on its SUN light, and the same sky
share, like the ground under it — `addCloudShadow(m, THREE, { fog: false })`
on its lit materials in index.html's attach, chained after the rim, sheen and
plumage patches (the plumage's IBL move is untouched; the feather detail
chains after it) — so a bird under or inside a cloud is not the one sunlit
thing in the shade. It gets NO in-cloud fog: the puffs' face choice exists to
keep the bird clear inside a cloud, and a fog would undo that. It still casts
its ellipsoid shadow, which multiplies with a cloud's like every other pair.
Measured inside a puff (the bird check's pose): the sun's analytic visibility
at the bird **0.322**, the bird's own pixels **33.1% darker** in linear
luminance than the same frame without the cloud's shadow (0.1143 vs 0.1708).
`?cloudvol=0` leaves the bird exactly as it was.

### Post-merge numbers

Not filled by the reviewer (stopped by a session limit during re-verification). The integrated tree was verified by the integrator instead: see the "REALISM WAVE 2" entry in CLAUDE.md for the suite results.


## What was there

The forest and the mountain each had one `InstancedMesh` of
`IcosahedronGeometry(1, 1)` puffs (80 triangles each) under a
`MeshLambertMaterial`. On a phone: 4 clouds x 1 puff, OPAQUE, with
`addLeafEdge`'s alpha-tested noise rim — the builder's own comment says they
"read as floating rocks", and a capture agrees: a grey polyhedron with a
bitten outline. On desktop: 20 x 4 (forest) and 18 x 3 (mountain) at a flat
0.6-0.7 opacity, which capture as grey glass pebbles. Every cloud keeps a
solid collider.

The cloud SHADOWS on the ground were `addAtmosphere`'s two crossed sine
fields at 0.42, scrolling over every surface of every biome — with no relation
to where any cloud was.

## What shipped

`src/environment/cloud-volume.js` (+ `tests/cloud-volume.test.js`, 24 tests).
The same mesh, the same single draw call, the same colliders; the fragment
shader integrates the cloud instead of shading the hull.

- **Density** per puff is `1 - r^2` inside 0.78 of the hull's circumradius,
  and its optical depth along the view chord is a closed form (Inigo Quilez's
  sphere density; Epic's Robo Recall fog volumes; matejlou 2025). The unit
  suite checks it against brute-force integration from inside and outside the
  sphere, because a closed form that is subtly wrong looks exactly as soft as
  one that is right. `alpha = 1 - exp(-5 tau)`: 0.99 through the centre, zero
  at the rim by construction. An `|sin|` lump field on the direction of each
  ray's closest approach turns the soap bubble into a cumulus turret.
- **Light** is the same integral again toward the SUN: Beer for
  self-shadowing, a powder term (Schneider 2015, Nubis) when the sun is behind
  you, a two-lobe Henyey-Greenstein whose forward lobe is the silver lining,
  and a flatter less-extinguished second octave for multiple scattering
  (without it every cloud was mid-grey). Sky light comes down the chord
  toward RADIAL up and ground bounce up the chord toward radial down. Part of
  each depth is taken through the puff's whole cloud — one sphere per cloud,
  handed to each puff as a per-instance attribute (`cloudOwn`) — so a cluster
  shades as one body. Irradiance is three's own light uniforms, so a cloud
  tracks the sun cycle with no per-frame code.
- **Transparent, depthWrite off, double-sided, `forceSinglePass`** on both
  desktop and phone; the phone's alpha-test erosion is dropped when on.
  `forceSinglePass` is load-bearing: three draws a transparent DoubleSide
  material in two passes otherwise.
- **Back to front.** The mesh's own `onBeforeRender` re-sorts its puffs every
  frame (see Traps).
- **The phone gets 3 puffs per cloud, not 1** (`MOBILE_EXTRA_PUFFS = 2`,
  `extraCloudPuffs`). As a volume one puff is a soft ball. The extras come
  from a PRIVATE generator seeded by the cloud's centre, never from the
  world's stream — one extra draw there would move every prop placed after
  the clouds, and `?cloudvol=0` would no longer rebuild the same world. A
  test replaces `Math.random` with a thrower while they are made, and the
  cloud centres and landmark list read identically in both boots.
- **Real cloud shadows.** One sphere per cloud (volume-weighted centroid of
  its puffs, radius 0.85 of the reach) goes to every lit world material in a
  shared uniform array (at most 20). Each fragment integrates the SAME density
  along its ray to the sun and takes the occlusion off the SUN's light (as
  first built: off all direct light — see the review below), and 35% of it
  off the sky light. The sine field is switched off for exactly
  those materials by `addAtmosphere`'s existing `cloudStrength: 0` — a
  uniform, the same program (a test diffs the two shaders). Canyons and city
  have no clouds and keep the sine field.
- **Inside a cloud** the chord starts at the camera, and the camera's
  immersion (deepest normalised density of any puff, smoothstepped) fades a
  fog onto the world materials, because a tree inside a puff is in FRONT of
  the puff's back faces and the volume alone cannot veil it.

New debug hooks (`?debug=1`): `clouds(tune)` (state, live tuning, `flat`,
`visible`, `sort`, `focus`, `reset`, `list`), `goToCloud(i | 'nearest',
{ back, view: 'side'|'sun'|'away', lift, inside: rho })`, `goToCloudShadow(i)`,
`holdMotion(on)` (the Pause button: every clock stops, frames keep
rendering), `birdScreen()`, `birdVisible(on)`, `cloudShadowCoverage(n)`.

## Measured

All in one SwiftShader boot per flag (390x844, `quality=amazing`, tier 0
pinned, `flight=classic`, seed 16160, sun held), every A/B inside one boot
and one pose, re-posed every frame until the shot and then every clock
stopped, with the first state repeated as the control. `node
tools/birb-realism.mjs --only cloud-volume-look,cloud-volume-off,cloud-volume-shadow,cloud-volume-inside,cloud-volume-bird`
reproduces all of it: **42/42**, zero console errors or warnings in either
boot.

| | `?cloudvol=0` (the before) | volume (default) |
|---|---|---|
| alpha 90% -> 10% across the silhouette | **3 px** (3.4% of an 88 px radius) | **37 px** (33.6% of a 110 px radius) |
| footprint partly transparent | **0.4%** of 58,048 px | **48.4%** of 56,997 px |
| control (same frame twice) | 0.03% of coverage moved | 0.00% |
| cloud draw calls (mesh shown vs hidden) | 1 | **1** (19 vs 18) |
| cloud triangles, phone | 320 (4 x 80) | **960** (12 x 80) |
| cloud triangles, desktop | 6,400 forest / 4,320 mountain | unchanged |
| `birdStats()` | 9 meshes, 1,518 tris | unchanged |

Coverage is measured with the puffs painted flat magenta at their true alpha
(`clouds({ flat: true })`): green is exactly 0 in the cloud's own colour, so
`1 - G(shown) / G(hidden)` is the alpha whatever is behind the cloud. A white
veil over a pale sky is invisible to a plain difference; this is not.

**The shadow**, on dry ground under forest cloud 1 with the sun 65.8 degrees
up, looking down from 40 units, shot with the shadow at full strength, at 0,
and at full again: the core takes **49.8%** of the light away, 65.0% of the
frame is darker by 5%+, 667 penumbra cells to 317 umbra (soft, not a disc),
centred at (0.61, 0.59) of the frame where the sun ray from the cloud meets
the ground; the control pair moves 0.00% at the 99th percentile.

**Back to front.** In build order, 5 of the 11 neighbouring puff pairs of the
phone forest drew nearer-first at the look pose: **11,289 px change by
11.1/255** when the sort is switched on (control 176 px). What it looked like
is the "dark puff in front": a puff at the back of the cluster, lit darker
because the cluster shades it, painted OVER the sunlit one in front of it.
The readback counts inversions from the instance matrices themselves: **0**
after the sort, on every boot.

**Flying in.** The camera walked along one collider-free line into a puff,
sky-band coverage at each step (d in density radii from the centre):

| d | 2.00 | 1.80 | 1.62 | 1.50 | 1.40 | 1.32 | 1.26 | 1.18 | 1.08 | 0.95 | 0.80 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| first cut (hull fade)* | 61.8 | 74.3 | **42.9** | **20.4** | **35.2** | 43.4 | 60.1 | 80.7 | 93.5 | 94.0 | 94.0 |
| shipped | 52.6 | 66.8 | 78.3 | 84.0 | 87.4 | 89.3 | 90.4 | 91.6 | 92.6 | 93.4 | 93.8 |
| world fog, shipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.385 | 0.85 |

\* measured before the pose was held exactly, so each step sits up to ~2
units deeper than its label; a 54-point dip is not that. The check now fails
on any step-to-step fall over 5 points; the shipped walk never falls (0.0),
and the bird is still flying at every step.

**The bird in a cloud.** Bird 0.90 R from the centre of a 15.7-radius puff
(inside the hull, outside the density), chase camera 1.21 R out, the bird's
own pixels masked by a shown/hidden pair. Coverage of the bird: **97.0%** with
the camera alone choosing the face (the bird vanishes), **0.4%** with the
bird as focus, **0.2%** at the shipping margin; the ring just around the bird
is 76.2% covered, so the bird is visibly IN the cloud.

**Cost.** The per-mesh toggle above is the number; whole-frame draw calls at
a fixed pose move by a few between boots with the drones. SwiftShader frame
times (a CPU rasteriser: relative only, never a device number), interleaved
default / off / off / default over two rounds at three fixed poses:

| | default | `?cloudvol=0` |
|---|---|---|
| phone forest (4 clouds, 12 puffs) | 167-200 ms | 117-150 ms (round 1), 217-300 ms (round 2) |
| desktop mountain (18 clouds, 54 puffs), away from a cloud | 317-350 ms | 217-233 ms |
| desktop mountain, 28 units from a cloud | 450-467 ms | 233-267 ms |

On the phone path the two rounds disagree in sign: no difference outside
this machine's load (two other builders' browsers on the same four cores).
On the desktop path it is real: every lit fragment walks 18 cloud spheres for
its shadow, and close to a cloud the frame is 54 blended puffs. The first cut
also walked EVERY cloud sphere per CLOUD fragment for the cluster term — 40
chords per fragment on the desktop forest — and the per-instance `cloudOwn`
sphere replaced that (desktop mountain close-up 517 ms before it, 450-467 ms
after, in separate runs). On a phone the shadow loop is 4 spheres.

**`?cloudvol=0` is the true before.** Every GLSL source the page hands WebGL
across all four biomes, base tree against this tree with the flag off
(`sha256` of each source, three runs): 1 / 0, 2 / 0 and 0 / 2 sources were
one-sided (base-only / this-only). The last two runs' pairs are the SAME two
hashes on opposite sides — a drone body and an energy-ring variant, compiled
on whichever frame a drone first entered view; the first run's single
base-only source (16,823 characters) was not dumped. A base-against-base
control run differs by five sources of the same kind. The world builds
identically: the cloud centres and the landmark list read the same in both
boots, and nothing on the volume path draws from the world stream.

**Harnesses** on the final tree: `tools/birb-shaders.mjs` all four biomes
compile (first attempt); `tools/birb-modes.mjs` all five modes ok (first
attempt). Earlier in the day, under a load average of ~10, `birb-shaders`
timed out twice in `startGame`'s 30 s boot wait before passing, and
`birb-modes` failed turret_defense's 20 s nest wait once — and the BASE tree
failed it identically in the same window, then both passed on the next run.

## Traps

**A hull fade hid a pop by making a dip.** The first cut drew front faces
outside the hull's circumsphere and back faces inside it, and faded each puff
to nothing near the hull so the switch could not pop — and a cloud you flew
at dissolved in front of you (74% of the sky band -> 20% -> 94%) before it
closed round you. The fade was never needed for the sky: every ray that meets
a convex hull crosses exactly one front and one back face, and the chord is
integrated FROM THE CAMERA on either, so the veil is identical. The face only
decides what an opaque thing INSIDE the hull gets — the front face veils it
with the whole chord, including the cloud behind it; the back face leaves it
clear. So back faces now take over within 4 world units of the hull for the
camera OR THE BIRD (`setCloudFocusObject(birbAnchor)`, one line in
`index.html`): in that band the bird is still outside the hull, where both
faces draw it identically, so the hand-over cannot pop it, and a bird flying
through a puff is never swallowed by the density behind it.

**Three sorts transparent OBJECTS, not instances.** Twelve (phone) or eighty
(desktop) blended puffs in ONE mesh composite in build order. The mesh's own
`onBeforeRender` re-sorts them back to front with an insertion sort (one
comparison per puff on a frame where nothing swapped) and rewrites the
instance matrices — and the `cloudOwn` attribute with them — only when the
order changed, bit-identical to what the builders compose (a test asserts
it). The new order uploads with the next frame, because three has already
sent this frame's instance buffer by the time any `onBeforeRender` runs.
**Every per-instance buffer has to move together**: the capture hook that
switches the sort off first flagged only the matrices for upload, so for
that one A/B frame the puffs sat in build order while `cloudOwn` still held
the sorted order — puffs lit through ANOTHER cloud's sphere — and the A/B
read 45,469 px changed instead of 11,289. A test now checks both flags.

**`freeze()` does not hold the bird** — the main loop re-asserts cruise speed
every frame, and its own comment says so. The first bird check waited 24
frames for the chase camera to settle; the bird flew INTO the cloud at 11
units/s and was knocked down by the collider, the camera ended up inside the
hull, every mode read "unveiled", and the A/B could not fail. Every cloud
check now re-poses every frame until the shot (`holdPose` in
`cloud-volume-lib.mjs`), stops every clock, asserts the bird is still FLYING,
and the bird check asserts the geometry it claims (bird 0.90 R, camera 1.21 R)
before measuring anything.

**The in-cloud fog lands after `<colorspace_fragment>`**, where the fragment
is already in the OUTPUT colour space (sRGB on screen, linear into the bloom
target) — exactly where three's own fog lands, and three converts its fog
colour on the CPU for that reason. The uniform is linear, so the shader takes
it through `linearToOutputTexel`.

**A direct-only shadow is invisible here.** At a 69-degree sun the direct
term is about 23% of the forest floor's light; an 82%-opaque cloud taking only
the direct light darkened the ground 19%. A cloud overhead hides part of the
sky too, so 35% of the occlusion comes off the sky light.

**`ensureWorldVarying` existed twice** (it was private in
`visual-style.js`), the copy's guards regex-LOOSE where the original's are
exact strings. Resolved in the review: visual-style.js exports its own (the
same one-word change wave 1 made for the horizon patch) and this module
imports it. A test compiles the patches on one material in both orders and
counts one declaration and one write.

## The trade, stated

There are **4 clouds on a phone and 20 on desktop, on a whole planet**, and
the sine field put drifting shadow on every surface of every view. With real
shadows most views have none, and none of them drift (the clouds do not move;
the shadows move with the sun). Measured over 2,697 evenly spread sunlit
points of the seeded phone forest (`__BIRB.cloudShadowCoverage()`): the real
clouds shadow **1.6%** of the sunlit ground (mean loss 0.9% of the DIRECT
light); the sine field they replace darkened **56.8%** of it by more than 5%,
**10.8% of all its light on average**. So with volume on, the forest and
mountain ground is on average about a tenth brighter than it was, and far
more uniformly lit — which is what four clouds in a clear sky do. That is what
"shadows cast by the real clouds" means; if the owner misses the motion, the
answer is more or moving clouds, not the sine field back.

## NOT verified

- **The phone.** No device number exists. The volume adds per-fragment work
  to every lit world fragment (a loop over up to 4 spheres on a phone, 20 on
  desktop) and to every cloud fragment (three sphere chords plus two through
  its cloud, three Henyey-Greenstein terms, six sines); the clouds are
  transparent, so close up a cloud is blended overdraw that used to be one
  opaque layer on the phone. If the adaptive tier starts shedding where it
  did not, `?cloudvol=0` is the control.
- **Objects inside a hull other than the bird** (a pine top or a peak poking
  into a puff) switch from veiled to clear when the camera or the bird comes
  within 4 units of that puff. Not captured.
- **The desktop path** (80 forest puffs, 20 shadow spheres) was captured and
  compiled but not put through the pixel checks, which run at phone size.
- **Two capture artefacts at the 800x600 desktop viewport, one per path**: a
  22x21 px black block at the bottom edge in one volume boot, and a 72 px
  black band along the bottom in one `?cloudvol=0` boot. Neither reproduced:
  the same seven poses shot again twice per path, five frames each, have no
  black pixel at all. Recorded because an isolated black block is also what a
  single NaN pixel looks like after the bloom's blur. (Hunted with a proven
  NaN detector in the review above: not this package.)
- **Added in the review, also unmeasured on the phone:** the sun-only wrapper
  is one dot product per directional light (three or four) on every lit world
  fragment and on the bird; the bird's cloud shadow is the same four-sphere
  loop (twenty on desktop) on a ~140 px object.
