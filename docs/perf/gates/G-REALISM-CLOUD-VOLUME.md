# G-REALISM-CLOUD-VOLUME — clouds with volume, at mesh cost, and the shadows those clouds cast

**Date:** 2026-09-23. **Base:** `e252ca1`. **Branch:** `realism/cloud-volume`.
**Flag:** `?cloudvol=0` restores the before exactly (Flags tab, "Clouds with
volume + real cloud shadows"). **Default: ON.**
**Decision:** shipped as a toggle, on by default: every check below measured
it, the captures read as clouds, and the one cost this box can see is on the
desktop path, not the phone's. The phone is unmeasured.

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
  along its ray to the sun and takes the occlusion off the DIRECT light, and
  35% of it off the sky light. The sine field is switched off for exactly
  those materials by `addAtmosphere`'s existing `cloudStrength: 0` — a
  uniform, the same program (a test diffs the two shaders). `visual-style.js`
  is not edited. Canyons and city have no clouds and keep the sine field.
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

**`ensureWorldVarying` exists twice now** (it is private in
`visual-style.js`, which another package owns). Both emit the same
declaration and write; this copy's guards are regex-LOOSE, so a declaration
in another spelling still counts as present. A test compiles the two patches
on one material in both orders and counts one declaration and one write.

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
  single NaN pixel looks like after the bloom's blur.
