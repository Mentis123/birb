# The organic pass — smooth soil, pointy rocks, leafy crowns

**Status: PLANNED, NOT BUILT.** Written 2026-09-13 after the inside-out-bird
fix and the slalom removal shipped (`54332ef`, `db87a94`). The owner asked for
less blocky leaves, a smoother ground that still has sharp rocks, and whatever
else is cheap and clever now that the frame has headroom. This is the plan for
whichever session executes it. It assumes the reader has not seen the
conversation that produced it.

**Mode:** owner-authorised, direct execution. Push each wave to `main` behind
a capture; do not open a PR.

---

## 0. The whole plan in one table

Ranked by what it does on screen per unit of what it costs, using numbers
measured on the shipping build (§1), not on what sounds good. The first wave
costs **nothing** — zero draw calls, zero triangles — and is where most of the
change is.

| # | Item | Reads as | Cost | Effort | Gate |
|---|---|---|---|---|---|
| A1 | Smooth-shade the ground; blend to the FACET normal on steep slopes | soil and grass go soft, rock faces stay crystalline — on one mesh | 0 | half a day | sheet + phone |
| A2 | Smooth-shade canopies, pine cones, snow caps, clouds | crowns become rounded masses, clouds stop being floating rocks | 0 | an hour | sheet |
| A3 | Random 1–3° lean on every non-nest tree | a forest that grew, not one that was planted with a plumb line | 0 | an hour | modes (landing) |
| A4 | Rocks: non-uniform scale, sunk deeper | rocks in the soil, not dice on a tablecloth | 0 | half an hour | sheet |
| A5 | Halve the per-vertex ground mottle | expected tuning once A1 lands | 0 | minutes | sheet |
| B1 | Silhouette erosion on canopies and clouds (alpha-tested world noise at the rim) | **leaves.** A lacy edge instead of a solid outline | fragment discard on ~40% of canopy pixels | a day | sheet + blind A/B |
| B2 | Snow on upward faces: pine crowns, boulders, scree, peaks | snow-laden conifers, the mountain finally reads as cold | 0 | half a day | sheet |
| B3 | Bump the forest ground from the derivative of the albedo it already samples | dirt with relief at the perch view | 0 samples | half a day | nest tile |
| C1 | Tiered pines: three stacked 8-cones merged into one instanced geometry | "that is a conifer", from any distance | **+7.8k tris**, mountain only | half a day | sheet + budget |
| C2 | Ferns and shrubs as two crossed quads with a procedural frond mask | plants, and **fewer** triangles than the d20s they replace | −1.2k tris | a day | sheet |
| C3 | Trunk root flare | trees stand IN the ground | +4.7k tris, forest | half a day | sheet + bark UV |
| C4 | Ground `high` resolution preset — ONLY if the horizon still steps after A1 | smoother valley rims | **+17k tris** forest → ~76k | one line | budget |
| D1 | Shadows, via the panel that already exists | the largest single realism jump available — **if the phone holds 60** | unmeasured | 5-minute phone test first | **phone** |
| D2 | Back-lit leaf glow toward the sun | canopies light up from behind | a few ALU per canopy pixel | half a day | sheet |

Rejected with the number attached, §7. Traps the executor will otherwise
pay for, §8. Order and gates, §9.

---

## 1. What is actually on screen, measured

Two crops from the shipping contact sheet (`tools/birb-sheet.mjs`, tier 0
pinned) settled the diagnosis before any code was read.

**Forest, flight tile, ground.** A hard lit/unlit crease runs diagonally across
one ground facet, with the authored triplanar soil texture continuing across
it unbroken. That is the entire "pointy ground": the texture is fine, the
LIGHTING snaps per triangle. The mesh is a `SphereGeometry(120, 112, 72)` on
mobile — 15,904 triangles over a 754-unit circumference, about 6.7 units of
arc per facet — displaced by detail noise whose features are ~20 units
across. A rolling hill spans three facets, so it renders as a three-sided
polygon.

**Mountain, flight tile.** Paper-craft. The snow field is a handful of large
flat facets; the pines are six-sided cones (`ConeGeometry(1, 1, 6)`); the snow
caps are the same cone. Nothing on the mountain has a curved surface anywhere.

### 1.1 The census (`__BIRB.goToProp(name).count`, mobile path)

| layer | instances | geometry | tris each | tris total | share of frame |
|---|---|---|---|---|---|
| `forest-canopies-{0,1,2}` | 82 + 114 + 89 = **285** | `LatheGeometry(7 pts, 7 segs)` | 84 | **23,940** | **41%** of 58.1k |
| `forest-trunks` | 294 | `CylinderGeometry(…, 8)` | 32 | 9,408 | 16% |
| `sphere-ground` (mobile) | 1 | `SphereGeometry(112×72)` | 15,904 | 15,904 | 27% |
| bird (v3) | 1 | | 1,518 | 1,518 | 3% |
| `forest-shrubs` | 77 | `Icosahedron(1, 0)` | 20 | 1,540 | |
| `forest-ferns` | 36 | `Icosahedron(1, 0)` | 20 | 720 | |
| `forest-rocks` | 30 | `Dodecahedron(1, 0)` | 36 | 1,080 | |
| `mountain-pine-canopies-mesh` | 218 | `ConeGeometry(1, 1, 6)` | 12 | 2,616 | 7% of 35.5k |
| `mountain-pine-trunks` | 218 | cylinder | 32 | 6,976 | |
| `mountain-peaks-body` / `-snow` | 25 / 22 | cones | | | |

Two consequences fall straight out of that table and they shape the rest of
the plan:

1. **The forest cannot afford canopy segments.** Doubling the lathe from 7 to
   14 segments is +24k triangles on a frame already at 58k against an 80k
   budget. Leafiness has to come from SHADING, not subdivision. That is
   items A2 and B1, and it is why they are ranked above every geometry item.
2. **The mountain can afford real pines.** Its crowns are 2.6k triangles in a
   35k frame. Tripling them is noise. That is C1.

### 1.2 The one fact that makes wave A free

`displaceSphereGeometry` **already calls `geometry.computeVertexNormals()`**
(`spherical-world.js:882`). Smooth normals exist on the ground mesh right now
and are thrown away every frame by `flatShading: true` on the material
(`:3326`). Same for every lathe and cone: three computes smooth normals when
it builds them, and thirty-four materials in `spherical-world.js` discard
them. Flat shading is a **material** property, and this world applies it to
everything as if it were a rendering mode.

The lesson from §14 of the build plan still holds: the largest visual change
of an entire session was one enum (tone mapping). This wave is the same
shape — a boolean on the materials, and it is most of the difference between
a low-poly toy and a soft world.

---

## 2. The principle: soil is smooth, rock is crystalline, and both live on one mesh

The owner's brief is precise: *"give it a smoother appearance where dirt/soil
etc but pointy rocks."* Read literally, that is a request for a shading rule,
not a modelling one — the same surface should shade smooth where it is soil
and faceted where it is rock. Three cannot do that per material, but the
ground shader already knows which is which: `ground-detail.js` computes a
slope term (`gdSlope`) and uses it to put soil on slopes and rock on faces.
The same mask can select the NORMAL.

```glsl
// After <normal_fragment_begin>, which has set `normal` from the smooth
// vertex normal (view space) now that flatShading is off:
vec3 facetN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
if (dot(facetN, normal) < 0.0) facetN = -facetN;
float rocky = smoothstep(uGdSlopeRange.x, uGdSlopeRange.y, gdSlope);
normal = normalize(mix(normal, facetN, rocky));
```

Flat ground shades smooth; steep faces keep their crystalline facets; the
transition follows the material boundary the shader already draws. On the
mountain that is snow fields that roll and rock faces that fracture. In the
canyons it is sand flats against stepped walls. In the forest it is the
whole floor going soft while the carved valley walls keep an edge. **One
mesh, one draw call, one new line of GLSL.** The instanced rocks and
boulders are separate materials and simply keep `flatShading: true` — they
are the one place low-poly reads correctly as material.

This is the idea that the rest of the pass hangs off. Build A1 first and
look at it before anything else.

---

## 3. Wave A — zero cost

Nothing in this wave adds a draw call or a triangle. Prove that on the sheet:
every tile's `calls` and `triangles` must match the shipping sheet within
frustum noise (±2 calls, ±1%).

### Step 0 — the A/B hook, before any of it

Every material decision in this repo's history was judged by a flag you can
flip on the phone (`?bark=0`, `?skytex=0.5`, `?feathers=0`). Add one first:

- `?smooth=0` — a URL flag read once at boot, threaded to the world builder
  as `smoothShading: boolean`, default **on** once the wave lands.
- `__BIRB.smooth(on)` — a debug hook that flips `flatShading` on every
  material in `sphericalWorld.root` at runtime and sets `needsUpdate`, so
  `birb-shot --after "__BIRB.smooth(false)"` captures the before frame from
  the identical pose. Note it MUST also flip the ground-detail normal source
  (A1 below) or the A/B compares a broken state.

Build the hook, capture the pair, look, then decide the default. Not the
other way round.

### A1 — the ground

`spherical-world.js:3324` — `flatShading: true` → driven by the flag.

**The trap, and it is the whole of A1's difficulty:** `ground-detail.js:261`
derives its slope from the FACET normal on purpose —
`gdN = normalize(cross(dFdx(gdP), dFdy(gdP)))` — with a comment saying it
"agrees with the visible faceting rather than with a smoothed vertex normal
that does not." Once the visible surface is smooth that reasoning inverts:
material boundaries would snap per triangle across a surface whose lighting
does not, which reads as a hard-edged paint splotch on a soft hill. So:

- Keep `facetN` (it is needed for the rock blend).
- Add `smoothN`: three's Lambert fragment has the interpolated view-space
  normal as `vNormal` when not `FLAT_SHADED`, and `<common>` provides
  `inverseTransformDirection(dir, viewMatrix)` to bring it to world space:
  `vec3 smoothN = inverseTransformDirection(normalize(vNormal), viewMatrix);`
- `gdSlope` comes from `smoothN` when smooth, `facetN` when flat (the flag
  becomes a `#define`, or a uniform — a uniform keeps one program).
- Then the §2 blend into `normal` itself, injected after
  `#include <normal_fragment_begin>`, so the LIGHTING uses the blended normal
  and not just the tint. `vViewPosition` exists in Lambert since it went
  per-fragment (r154+); this repo pins 0.183. Confirm on the first compile
  with `tools/birb-shaders.mjs`, which is the guard that catches a missing
  varying as a whole-material blank.
- `customProgramCacheKey` must change with the shader. Identical closures
  share a program (`icon3d` paid for this).

**Expected side effects to tune, not bugs:** the ±10% per-vertex luminance
mottle (`spherical-world.js:876`, `lum = 1 + mottle * 0.10`) was put there
to "kill the flat-paint look" of facets. Interpolated across a smooth
surface it will read as soft camouflage blotches at the 6.7-unit vertex
spacing. Expect to halve it (A5). The bake-time contact darkening
(`bakeGroundContacts`) will start reading as soft shadow pools around
trunks instead of facet-shaped stains — a free improvement; check its
radius once you can see it.

### A2 — canopies, cones, snow, clouds

Flip `flatShading` on: `canopyMats[0..2]` (`:924`), `pineCanopyMat`
(`:2379`), `snowMat` (`:2310`), both `cloudMat`s (`:1382`, `:2859`). Leave
flat: every rock, boulder, scree, spire, peak body, cliff wall, city
building. That list is the soil/rock rule applied to props.

- `LatheGeometry` fixes its own seam normals (it averages the first and last
  column), so a 7-segment lathe with smooth normals shades as a rounded
  mass with no dark meridian. Verify with `goToProp('forest-canopies-0', i)`
  from two bearings; a seam shows as a vertical dark line.
- The lathe profiles have a flat base disc (`[0,0] → [1,0.04]`). Smooth
  normals blend the base's downward normal into the wall's outward one over
  the first ring, which is a slight darkening under the skirt. At twenty
  units it is invisible; at the perch it is a soft underside, which is
  right for foliage.
- The canopy's baked vertex colours (rim/pocket shade in
  `createCanopyGeometry`) interpolate softly under smooth shading. That is
  the intent of the bake finally being visible.
- A six-sided cone with smooth normals still shows six shading bands, but
  soft ones; that is acceptable for the snow caps and is superseded on the
  pines by C1.

### A3 — tree lean

`spherical-world.js:1206` and `:2735` — every tree is oriented
`setFromUnitVectors(defaultUp, p.up)`: perfectly radial, plumb to the
planet. A forest where every trunk is vertical reads as planted. Compose a
small random tilt — 1–3° about a random tangent axis — into `orientQ` for
the trunk AND its canopy (same random per tree, or the crown floats off the
trunk).

**Only on trees that carry no nest.** Nest points are computed radially on
champion crowns; a tilted champion moves its perch. The grove trees and the
scatter layer are where the lean goes. A 3° lean on a 40-unit tree moves the
crown 2 units, well inside its 8–16-unit canopy collider, so colliders do
not need touching — but `tools/birb-modes.mjs` (which lands the bird) is the
gate anyway. Zero cost: it is the instance matrix.

### A4 — rocks

`:1338` — `dummy.scale.set(s, s, s)`: every forest rock is a regular
dodecahedron at a random rotation. Dice. Use `s * [0.7–1.3]` per axis and
sink the placement offset from `-0.2` to about `-0.35 * s` so the base is
buried. Same for `mountain-boulders` and `canyon-boulders`. The collider
radius stays `1.0 * s` (the largest axis). Zero cost.

### A5 — vertex mottle

See A1. `0.10 → 0.05` once A1 is on screen, judged from the nest tile.

---

## 4. Wave B — near-zero fragment work

### B1 — silhouette erosion: the leaves

This is the item that answers "the actual leaves." A solid crown reads as a
solid because its OUTLINE is solid. Leaves are a ragged edge, and a ragged
edge can be cut out of a smooth mesh in the fragment shader at zero geometry
cost: near the silhouette, discard fragments by a noise threshold.

```glsl
// In the canopy fragment, before <alphatest_fragment>. World position from
// the shared vBirbWorld varying (addAtmosphere provides it — see §8 for the
// chaining rule), world normal via inverseTransformDirection as in A1.
// The view-space normal's z is how much the surface faces the camera, so
// this is the silhouette term with no extra varying at all.
float rim = 1.0 - abs(normalize(normal).z);          // 0 facing camera, 1 edge-on
float leaf = gdNoise(vBirbWorld * 0.9) * 0.6 + gdNoise(vBirbWorld * 2.7) * 0.4;
// Interior stays solid; the outer ~35% of the rim goes lacy.
diffuseColor.a = 1.0 - smoothstep(0.55, 0.95, rim) * (1.0 - step(0.5, leaf));
```

with `material.alphaTest = 0.5` so three compiles `USE_ALPHATEST` and the
discard goes through `<alphatest_fragment>`. Use three's path, not a
hand-rolled `discard`: the alpha test then also applies wherever three
renders the material for depth (the shadow proxy if D1 ever lands).

- **World-space noise, never screen-space.** Screen-space noise swims with
  the camera; world-space is fixed to the crown and moves only with the wind
  displacement, which reads as leaves stirring.
- **`alphaToCoverage: true`** on the material. Where the scene target has
  MSAA (tier 0's offscreen target, `bloomPass.setSamples`) the hard alpha
  edge becomes a dithered soft one for free; where it does not, it is
  ignored. No branch needed.
- **Cost, honestly.** A discarding fragment shader disables early depth
  rejection for that draw, so canopy overdraw is paid in full. The canopies
  are the largest instanced meshes in the forest. Measure it: pin the pose,
  capture `frameTotals()` at tier 1 (whole-frame equals scene there) before
  and after, and on the phone watch the adaptive tier — if B1 makes the tier
  drop where it did not before, gate erosion on `tier < 2` like the ribbons.
- **What you see through the holes** is whatever is behind: sky, the far
  side of the crown is culled (`FrontSide`), so a lacy rim is see-through.
  Correct. If the trunk showing through the crown from below bothers the
  eye, the rim mask can be weighted by the crown's own `position.y` so the
  underside stays solid.
- The same treatment on `cloudMat` with a softer threshold turns the
  icosahedral puffs into wisps. Same code path, second material.
- **This is the one item that needs the blind paired A/B** from
  `docs/ULTRACODE_REALISM_PLAN.md`: a lacy crown is a taste call the sheet
  cannot make. Two captures, same pose, `?leaves=0` against on, on the phone.

### B2 — snow on upward faces (mountain)

Everything on the mountain that has a top gets snow on it. One term:

```glsl
// At <color_fragment>, AFTER three applies vertex colour — before lighting.
// Never at <opaque_fragment>: Lambert has folded diffuseColor into the
// lighting by then and a write there changes nothing (CLAUDE.md, §16.13).
float upness = dot(normalWorld, normalize(vBirbWorld));
float snow = smoothstep(0.45, 0.85, upness) * uSnowAmount;
diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, snow);
```

on `pineCanopyMat`, `boulderMat`, `screeMat` and `stoneMat` (peak body — but
below its own snow cap so they agree). `uSnowColor` is the existing
`snowMat` colour (`0xe6f1ff`) so the snow on a boulder matches the snow cap
next to it. Zero cost; it is a dot product. The mountain reads as cold for
the first time. A variant with a warm sun-facing tint (`dot(N, sunDir)`)
does "lit top / shaded underside" on the forest crowns for the same price;
try it after B1, it may be redundant with the baked rim/pocket colours.

### B3 — ground bump from the albedo, forest

The forest ground already samples `forest_ground_albedo` triplanar
(`ground-detail.js:294–306`). The derivative of that sample's luminance is
a height field for free — no extra fetches, no normal map:

```glsl
float h = dot(gtTex, vec3(0.299, 0.587, 0.114));
vec2 dh = vec2(dFdx(h), dFdy(h));
// Perturb the (view-space) normal by the screen-space gradient, scaled by
// distance so it fades before it aliases. Three's bumpmap_pars_fragment
// does exactly this (perturbNormalArb); borrow its form.
```

Reads at the perch view — a grazing camera three units off the ground —
where the soil currently looks like a photograph laid flat. Fade the
amplitude with view distance (the same `distFactor` the mist uses) or it
shimmers at altitude. Gate on the nest tile. Only worth doing AFTER A1, and
only in the forest (the only biome with a ground albedo).

---

## 5. Wave C — small, measured triangle costs

State each cost as a number on the sheet before pushing. Budget is 80k
triangles and 100 draw calls per biome; the current worst is forest at
59.3k / 26 calls in flight and 93–96 calls standing in a champion grove.

### C1 — tiered pines (+7.8k, mountain)

A conifer is not one cone. Merge three `ConeGeometry(1, h, 8)` at three
heights and radii into ONE geometry with `bakeGeometryTRS` +
`mergeAndDispose` (both exist in `index.html` for the bird; lift them into a
shared module or duplicate the twelve lines). 48 tris each × 218 = 10.5k,
against 2.6k today: **+7.8k on a 35.5k frame.** Same InstancedMesh, same
draw call, same material, same wind patch. Keep the bounding envelope
(radius ≤ 1, base y = 0, tip y = 1) so `pineCeilingPlacements` and the
canopy colliders still mean what they mean. With B1's erosion on the tier
edges this is the single biggest legibility change on the mountain.

### C2 — ferns and shrubs as crossed quads (−1.2k)

A flattened d20 is never going to read as a fern. Two crossed
`PlaneGeometry` quads (4 tris) with `side: DoubleSide` and a **procedural**
frond alpha mask — no texture, so no asset, no residency cost:

```glsl
// uv.x across the blade, uv.y root to tip. Three blades per quad.
float x = fract(vUv.x * 3.0) - 0.5;
float blade = smoothstep(0.02, 0.10, (0.5 - vUv.y * 0.45) - abs(x) * 2.2);
float serration = 0.85 + 0.15 * sin(vUv.y * 40.0 + abs(x) * 30.0);
diffuseColor.a = blade * serration;
```

`alphaTest: 0.5`, `alphaToCoverage: true`, and the same wind patch with
weight by `uv.y` so tips sway and roots do not. 4 tris against 20: the
forest loses ~1.2k triangles and gains plants. `DoubleSide` doubles the
fill of tiny objects — tiny. Write the mask as a JS reference function
mirrored by the GLSL and test the reference (`equirectUvLocal` is the
precedent for that shape of test), because a mask that is 98% transparent
by mistake renders NOTHING and exits zero.

### C3 — trunk root flare (+4.7k, forest)

The trunk is a tapered unit cylinder. Add one ring at the base flared to
~1.6× radius over the bottom 6% of height: +16 tris × 294 = 4.7k. Trees
stand in the ground instead of being pushed into it. **The trap:** the
bark texture's repeat comes from `addInstancedUvScale`'s `'cylinder'` path
with `unitRadius: 1.0`. A flare changes the circumference at the base only;
the UV path derives one repeat per instance from the instance scale, so
the flare ring simply stretches its bark a little — acceptable — but if the
geometry stops being a `CylinderGeometry` instance, the shape check in
`addInstancedUvScale` throws. Keep it a cylinder with an edited position
attribute, not a merge.

### C4 — ground `high` (+17k forest) — only if needed

`GROUND_RESOLUTION_PRESETS.high` is `[160, 104]` on mobile: 32,960
triangles against 15,904 — **+17k**, forest to ~76k. Affordable now (the
bird saved 8k and the slalom 5.6k) but it is the most expensive line in
this plan and A1 may make it unnecessary: smooth shading hides facets in
the interior of the surface entirely, and only the horizon and the valley
rims still show the polygon. Look at those two places on the A1 sheet
first. If the rims step, `high`. If they do not, leave it.

---

## 6. Wave D — gated on the phone

### D1 — shadows

`renderer.shadowMap.enabled = false` at boot, and the Ascend wave built the
whole lever behind the quality panel (`setShadows`, the base-anchored caster
proxy, PCF, map-size keys). `G-ASCEND.md` §1.1 records that the lever
"could NOT be shown to do" anything measurable under SwiftShader and §9
that **no frame-time, fps or thermal figure for it exists anywhere.** So it
is neither shipped nor rejected — it is unmeasured, and the owner holds the
only instrument that can measure it.

The experiment is five minutes and needs no code: open the panel on the
phone (three-finger gesture), enable shadows, fly the forest for two
minutes, read the FPS chip and watch whether the adaptive tier drops. If it
holds tier 0 at 58+, shadows are the single largest realism gain left in
this game and should ship as part of the **Ultra** preset first, then be
judged for Amazing. If it drops, they stay behind Ultra only. Either way the
answer is a number from the device, which this repo has never had.

### D2 — back-lit leaf glow

When the sun is behind a crown, real leaves glow. A rim term on the canopy
material, toward the sun only:

```glsl
float toSun = max(0.0, dot(normalize(cameraPosition - vBirbWorld), -uBirbSun));
outgoingLight += uLeafGlow * pow(toSun, 8.0) * rim;   // rim from B1
```

`uBirbSun` is already a shared uniform. A few ALU per canopy pixel. Do it
after B1, because the erosion rim is the mask it wants.

---

## 7. Rejected, with the number

| Idea | Why not |
|---|---|
| More lathe segments on the forest canopies | +24k triangles at 14 segments (§1.1). The forest is at 58k of 80k. |
| Puff-cluster canopies (3–5 icosahedra per crown, the stylised-game way) | 320 tris per crown against 84: 4× the dominant cost of the frame. |
| Geometry grass (thousands of instanced cross-quads) | The fill-rate trap the contract warns about (`DEF-4`): alpha-tested overdraw on a fill-bound device, unmeasured. The authored ground albedo already carries the grass read at flight altitude; C2's ferns cover the near field. |
| `MeshStandardMaterial` on the ground for specular | Under flat shading it was measured "visually equivalent" and rejected; under SMOOTH shading it is not equivalent — a specular lobe on a smooth hill reads as wet plastic. Snow is the one surface that wants it; try it there, later, as its own item. |
| Near-field terrain patches / spherical clipmaps (research §"Terrain") | Correct and large. Not "easy clever". After this pass, if C4's 17k is not enough at the rims. |
| Authored leaf-card textures | The pipeline exists (`AUTHORED_ASSETS.md`) but a card atlas is a residency cost in every biome and needs mips, AA and a coverage test (research §"The bird"). B1 gets most of the read with no asset; commission cards only if the blind A/B says the procedural rim is not enough. |
| Spatial instance sectors | Already measured and rejected (`DEF-7`). Not reopened by "we have headroom now". |

---

## 8. Traps, in the order the executor will meet them

1. **Chain, never assign, `onBeforeCompile`.** `addFoliageWind` ASSIGNS
   (`visual-style.js:246`); `addAtmosphere` chains (`:54`). Any new patch on
   a canopy material must take `const previous = material.onBeforeCompile`
   and call it first, or it silently replaces the wind. The feather detail
   patch is the model (`authored-textures.js:673`).
2. **`vBirbWorld` is declared conditionally by whoever runs first.** Two
   injections that both declare it do not compile — "redefinition" — and
   three then draws NOTHING for that material. The city's whole ground shipped
   invisible this way. Check `includes('varying vec3 vBirbWorld;')` before
   declaring, as `addAtmosphere` does.
3. **`customProgramCacheKey` must change when the shader does.** Otherwise
   the first-compiled variant serves every material that shares the key.
4. **Write colour at `<color_fragment>`, not `<opaque_fragment>`.** Lambert
   folds `diffuseColor` into the lighting before `<opaque_fragment>`; a write
   there is a no-op that looks like a mistake in your maths.
5. **The ground-detail slope must move with the shading.** A1's whole
   difficulty. Facet slope on a smooth surface snaps the material at every
   triangle edge.
6. **Tilting a nest tree moves its perch.** A3 is scatter and grove trees
   only, and `birb-modes.mjs` is the gate.
7. **A shader that fails to compile draws nothing and exits zero.**
   `tools/birb-shaders.mjs` after every GLSL edit, not at the end.
8. **An alpha mask that is mostly transparent by mistake also draws
   nothing.** C2's frond mask and B1's rim mask need a JS reference and a
   test asserting coverage between, say, 30% and 80% — the same shape as the
   bird sheet's pixel floor. **A sheet that cannot fail is not evidence.**
9. **`birdStats().worldSize` axis trap** is irrelevant here, but the
   equivalent exists: `goToProp` returns `count` for the FIRST mesh whose
   name includes the string. `'forest-canopies'` matches bucket 0 only.
10. **Every `src/` module you add goes in `sw.js` `CORE_ASSETS`** and
    `BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js` is the oracle
    that catches the omission. Bump `BIRB_BUILD` and `CACHE_VERSION`.
11. **The oracle manifest.** Any new test file is pinned by
    `node tools/oracle-manifest-regen.mjs` (additive; `--check` in CI).
    Do not edit a listed test to make it pass; see `G-R5-DRIFT.md`.

---

## 9. Order, gates, and what to commit

One wave per commit, each pushed to `main` behind its evidence. The sheets
are the record.

| wave | before pushing, all of | plus |
|---|---|---|
| A | `npm test`; `birb-shaders`; `birb-modes`; `birb-quality --check all`; `birb-sheet` with calls/tris within noise of shipping; `sha256sum -c tools/oracle-manifest.txt` | the `?smooth=0` pair captured from one pose, both frames in the commit message's evidence |
| B | the above; `frameTotals()` at tier 1 before/after B1 at a pinned pose | the blind paired A/B on the phone for B1 |
| C | the above; the triangle delta per biome stated as measured, not from §5's arithmetic | |
| D | D1 is a phone number, not a commit; D2 as B | |

**Tests to add** (new files; the manifest picks them up):

- `tests/organic-shading.test.js` — the ground and canopy materials are not
  flat-shaded by default and ARE with `?smooth=0`; the rock/boulder materials
  are flat regardless. Pins the soil/rock decision so a future "tidy-up"
  cannot flip it back.
- `tests/leaf-mask.test.js` — JS references for the B1 rim mask and the C2
  frond mask, mirrored by the GLSL; coverage bounds; world-space (not
  screen-space) inputs.
- `tests/tree-lean.test.js` — the tilt is bounded (≤ 3°), is zero for any
  placement flagged as a nest host, and is deterministic under the seeded
  RNG.

**Captures** (the commands the executor runs, so the evidence is
reproducible):

```sh
# the A/B pair, one pose
node tools/birb-shot.mjs --start --out a1-on.png
node tools/birb-shot.mjs --start --out a1-off.png --query smooth=0
# a crown up close, two bearings, for the lathe seam
node tools/birb-shot.mjs --start --out crown.png --after "__BIRB.goToProp('forest-canopies-0', 3, 14, 4)"
# the ground at grazing angle: the nest tile IS the test for A1/A5/B3
node tools/birb-sheet.mjs --out organic-sheet.png
# the mountain, for B2 and C1
node tools/birb-shot.mjs --start --env mountain --out pines.png --after "__BIRB.goToProp('mountain-pine-canopies-mesh', 5, 22, 6)"
```

---

## 10. Notes from the planning session — the reasoning, kept

- **Every "make it less blocky" request in this repo's history has been
  answered with geometry, and geometry lost every time** (sectors, ribbons,
  the same-height giant tree, §14). The tone-mapping enum won. This plan is
  built on that record: shading first, triangles last, and only where the
  census says the budget is there.
- **The owner's brief contains the design.** "Smoother dirt/soil but pointy
  rocks" is not two requests, it is one rule — soft where it is loose
  material, faceted where it is crystalline — and the ground shader already
  has the mask that separates them. Do not build two grounds.
- **Leaves are an edge, not a surface.** A crown's interior can be a smooth
  blob forever; what the eye reads as foliage is the outline breaking up.
  B1 spends its cost exactly there and nowhere else.
- **The mountain is the cheap biome to make dramatic.** 35k triangles, one
  colour of snow on nothing, cones for trees. B2 + C1 together are +7.8k
  triangles and one dot product, and they turn it into a mountain.
- **Shadows are not a plan item, they are a measurement waiting to happen.**
  The lever is built. The phone is the instrument. Five minutes.
- **The slalom removal paid for this.** 5–7 draw calls and up to 6.8k
  triangles per biome came back on 2026-09-13. C1 and C3 spend about that.
  C4 spends more than that; hence "only if needed."
