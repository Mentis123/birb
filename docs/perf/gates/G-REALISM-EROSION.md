# G-REALISM-EROSION — a landscape carved by water

**Date:** 2026-09-23, finished 2026-09-24. **Branch:** `realism/erosion`, based
on `d47fc7e`, with main `d28da11` (realism wave 2: air field, cloud volume,
hex tiling) merged in and every check below re-run on the merged tree.
**Decision:** SHIP OPT-IN. `?erosion=1` (Flags tab → Terrain → "A landscape
carved by water", default **Off**). Off is the true before: no bake, no
worker, no texture, the ground shader byte-identical (a test diffs it), and
`terrainDisplacement` one `null` comparison away from the function it was.
No frozen oracle was touched; the new `tests/erosion.test.js` makes
`tests/oracle-manifest.test.js` report the manifest stale, which is the
expected and only failure.

**Not measured: the phone.** Every number below is this machine's Chromium
on SwiftShader, or Node, on a shared 4-core box whose load average sat at
**15-19** for the first session and **5-12** for the re-run on the merged
tree (other builders' harnesses). Where the two sessions both measured a
number, both are given. No frame-time,
bake-time, memory or thermal number exists for the iPhone 16 Pro, and none
is claimed. Nobody has looked at it on glass.

## What was missing

The terrain is analytic: detail fbm plus a tanh continental carve, clamped
to `<= 0` (the gravity-less-floor invariant). **Noise makes hills. It does
not make valleys**, because a valley is not a shape, it is a history: water
collects, the collecting water cuts, the cut collects more water. Nothing in
an fbm stack knows which way anything drains, so the low ground between its
hills is a scatter of pits that connect to nothing, and the lakes (floods of
the smooth continental field) are islands of water with no river into or
out of any of them. A river cannot be painted onto that; it has to be
eroded into it.

## What shipped

### 1. The bake — `src/environment/erosion.js` (pure: no THREE, no DOM, no `Math.random`)

- **A cube-sphere grid**, `n = 64`: 6 x 64 x 64 cells, one node per cell
  corner, **24,578 unique nodes** about 3 units apart, equiangular so a cell
  is the same size to within ~30% everywhere (a lat-long grid is 100x denser
  at the poles). Edge and corner nodes are merged by their integer lattice
  coordinates, and each face keeps its own `(n+1)^2` array in which a shared
  node carries one value on every face — which is what makes bilinear
  sampling continuous across an edge with no cross-face lookup at sample
  time. Solid angles sum to 4 PI (tested).
- **Routing** on a depression-filled copy of the surface: Priority-Flood +
  epsilon (Barnes, Lehman & Mulla 2014) with a monotone bucket queue at 0.01
  units plus a pit FIFO, **seeded from the lakes** — exactly the nodes where
  the water sheet floods (the smooth basin field under sea level) — so a pit
  in the noise spills over its lowest rim instead of swallowing its
  catchment, and every drop reaches water that is drawn. D8 steepest descent
  on the filled surface; the Braun & Willett (2013) stack by a DFS over the
  donor lists; drainage area accumulated in stack order.
- **The stream-power law with uplift, implicit** (Braun & Willett 2013,
  `n = 1`): `h_i <- (h_i + U + F h_r) / (1 + F)`, `F = K A^m / L`,
  downstream first, 24 iterations re-routed every 5. The ORIGINAL ground is
  a ceiling, so the fixed point is `min(h0_i, h_r + U/F)` — the steady
  channel profile of the law (the analytic form Tzathas, Gailleton, Steer &
  Cordonnier, EG 2024 build terrain from) wherever it runs under the
  ground, the ground wherever it does not. `slope` sets `U/K` as the steady
  channel slope at `refArea`. Channels start above a critical drainage area,
  so the hillslopes between them keep the art direction's noise.
- **A bed and a valley.** Every network node is cut at least
  `groove (A / refArea)^0.4` (bankfull depth ~ Q^0.4, Leopold & Maddock
  1953) so the channel is continuous from its head to the lake, and the
  incision spreads sideways as `max(D_i, D_j exp(-L_ij / flank))` — a valley
  whose cut falls to 1/e `flank` units (5-6) from its channel, subtracted
  from the original ground, so the valley walls keep the hillside's texture.
  Two or three graph-averaging passes widen it to what the ground mesh can
  draw. The mountain's gorges saturate softly at `maxCut` 10 (`tanh`).
- **Lakes are base level, not depth**: nothing is cut below `level + 0.4`
  that was not already under it. A dry channel below sea level outside the
  flooded basins would be a pit the water does not cover while
  `terrainFloorDir` holds the floor at sea level above it — a bird hovering
  over its own ground.
- **The authored landmark valley is withheld** (`protectAt`: 1 inside its
  reach, smoothstep to 0 over 0.05 rad): its waterfall, pool and river
  ribbon are placed on its own carve, and a creek re-cutting the headwall
  would leave the falls hanging off a notch.
- **The city is not eroded** (`EROSION_PROFILES.city = null`): its ground is
  a street grid laid by world position, and a drainage channel through a
  grid of streets is a rendering bug that happens to look like a river.

Output per node: `delta = min(0, eroded - original)` — **carve-down only,
exactly** — and the drainage area, from which a 0..1 wetness is derived
(log area between two thresholds, one dilation pass so a diagonal D8 chain
reads as a line rather than a string of beads, one light average). The
sampler `sampleCubeField(values, n, x, y, z)` is scalars in, one number out,
two `atan`s and a bilinear read: **150-220 ns a call in Node** at this
box's load, allocation-free (structural scan plus a heap test against a
control, below). The floor, the landing check and the walking pose call it
a handful of times a frame.

### 2. One field, every reader — `spherical-world.js`

`terrainDisplacement` gained one guarded line, **after** the valley carve and
**before** the lake-bed planing:

```js
if (_activeErosion !== null) h += _activeErosion.delta(nx, ny, nz);
```

`_activeErosion` is set in `createSphericalWorld` directly after
`setActiveValley` (the valley is part of the ground the water runs over) and
before anything samples the terrain, and it is `null` for every other
build. So the mesh, every prop, the water, the landmark features, the flight
floor, the landing check, the walking pose and the horizon bake all read ONE
eroded field — the horizon's worker is handed its terrain grid from the
main thread, so it cannot see anything else, and a check proves it.

### 3. The wet ground — `ground-detail.js` `wetMap`

A channel one grid node wide is three units — half the phone mesh's vertex
spacing (112 x 72 segments: 6.7 units round the equator) — so the carve
draws the VALLEY and the stream itself rides a texture: the node wetness
baked to a **512 x 256 R8 equirect** in the horizon map's exact texel
convention (`u = atan(z, -x) / 2PI`, `v = acos(y) / PI`, tested against
`horizonTexelDirection`), sampled per fragment. It damps the whole
catchment slightly (`wetDamp`) and tints the stream core toward a cool,
darker green/blue (`wetTint`, from `smoothstep(core)`) — it only ever
darkens (checked: 0.00% of pixels brighter). New option, all-or-nothing
(missing field throws), its own program-cache key suffix `-wet`, live
uniforms (`__BIRB.erosion({ wetStrength })` re-tints without a recompile).
**Omitted, the shader and its cache key are byte-for-byte what they were**
(tested), which is what the default path always does.

### 4. When it runs — a worker, a cache, a fallback

The bake is a pure function of the biome (seeded noise, fixed valley, fixed
sea level), so a biome is eroded once per session and cached. With the flag
on, `spherical-world.js` starts a **module worker when it loads**
(`erosion-worker.js` imports `bakeErosionForVariant` from
`spherical-world.js`, so the terrain keeps ONE definition; the price is that
module's whole import graph, three.js included, evaluated once in the worker
and freed when it terminates after its last biome) that bakes forest,
canyons and mountain in that order and posts the arrays back transferred.
index.html imports the module long before its first
`setEnvironment()`, and in the measured boot the forest's bake had **landed
before the first world build, which then spent 0 ms on erosion**. A build
that gets there first bakes on the main thread (the fallback), and the late
worker copy is simply not used; a worker that cannot start is swallowed
(`preventDefault`) and every biome still erodes on the main thread. The
build stays synchronous deliberately — a carve that landed after the props
were placed would leave them standing on the old ground.

## Flags and hooks

| | default | effect |
|---|---|---|
| `?erosion=1` | **Off** | bake + carve + wet map, forest / canyons / mountain; the city unchanged |

`__BIRB.erosion(opts)` (debug): `enabled`, `ms` / `cached` / `stats` for
this build (source `worker` or `main`, per-phase timings), `prefetch`
state, `at: [x,y,z]` → `{ delta, wet }`, `texels: [[i,j]]` → the horizon
bake's input height there, `wetStrength/wetTint/wetDamp/wetCore` → live
re-tint, and `agreement` — the mesh-against-floor measurement below
(`{ samples, seed, control }`, or `samples: [dirs]` for a flight path).

## Measured

All with a control. "Control" is always the same world with the carve
switched off, measured in the same boot where the check allows it.

**Cost of the bake** (forest, 6 x 64 x 64):

| | ms |
|---|---|
| first forest build, flag on (module-load worker had landed) | **0** (0.1 on a revisit) — both sessions |
| worker bakes, off the main thread | forest 458, canyons 258, mountain 132 (first session: 566 / 518 / 235) |
| main-thread fallback, forest, timed twice in one boot | **379** (incl. building the grid), **196** (first session: 432, 683) |
| same, Node, one thread | 266 (+137 building the grid, once per session) |
| a whole cached world build around it | forest 269, canyons 400, mountain 565, city 256 (first session: 358 / 921 / 412 / 427) |

The fallback straddles the brief's ~300 ms mark (196-683 ms depending on
load and whether the grid is already built), which is why the worker exists; it is what a phone would pay only if its worker lost the race to the
first build. The same bake measured anywhere from 210 to 1,708 ms on this
box as its load went from ~10 to ~17 — **quote the ratio to the control,
not the milliseconds.**

**What the water did** (carve, whole planet, excluding lakes):

| | deepest cut | nodes lowered | dry ground cut > 1 unit | > 3 units | stream core (wet > 0.58) | damp (wet > 0.1) |
|---|---|---|---|---|---|---|
| forest | 8.41 | 66% | 22.9% | 2.7% | 4.8% | 26.7% |
| canyons | 10.93 | — | 27.9% | 7.5% | 3.2% | 22.9% |
| mountain | 7.39 | — | 36.8% | 10.0% | 3.8% | 24.6% |

(Coverage columns from Node without the valley protection, which is why its
canyons maximum there reads 11.07; the deepest cuts are the live page's.)
Carve quantiles, forest: p50 0.25, p90 1.47, p99 3.63, max 8.41 units.

**The mesh and the floor still agree** — the check this whole design is
sized against. The flight floor samples the terrain analytically at the
bird's exact direction; the mesh samples it at vertices and draws straight
lines. Measured exactly (a ray from the centre against the real displaced
triangles, 20,000 seeded directions, dry ground, 112 x 72) against a
control that re-displaces the same vertices with the carve off:

| gap = mesh - floor (units) | control p99 | eroded p99 | Δ p99 | Δ p999 | Δ max | share > 0.6 |
|---|---|---|---|---|---|---|
| forest | 1.519 | 1.532 | **+0.013** | +0.089 | +0.366 | 11.7% → 12.4% |
| canyons | 1.877 | 1.909 | **+0.032** | −0.046 | +0.355 | 17.0% → 17.3% |
| mountain | 1.606 | 1.642 | **+0.036** | +0.188 | +0.558 | 13.3% → 13.8% |

Limits the check enforces: Δp99 0.25, Δp999 0.6, Δmax 0.8, Δshare 2
points. **Read the control column first**: the un-eroded world already
draws its ground up to 1.5-1.9 units above the floor at the 99th percentile
(the detail noise's sub-vertex skim) and 2.6-3.3 at worst. The carve moves
that by hundredths.

**The horizon bake saw the eroded ground**: 40 of 40 carved lattice texels
of its input grid equal the ERODED terrain to 1e-4 and differ from the
un-eroded one by at least 5.66 units (deepest: grid −12.127 = eroded
−12.127, un-eroded −3.897).

**A low pass down an eroded channel** (a trunk channel, wetness 0.85, cut
3.23 units; stick y 0.12 so the pass skims the floor; 150 frames sampled):
`aboveGround` — the same sampler the floor, the landing check and the
walking pose use — **never negative, minimum 0.560** over 26.3 units,
flying and grounded. The clearance of the bird's centre above the DRAWN
ground along the same path: **−0.850 eroded against −0.654 for the same
flight over the un-eroded world** (first session −0.888 / −0.709) — the bird's centre already dips 0.7 units
under the drawn skin of the un-eroded ground wherever the mesh skims above
the floor, and the carve adds 0.18 to that.

**A landing still lands, and the bird walks on the carved ground**: put
over the deepest channel bed the forest has (cut 7.61 units) and brought down
to the floor, the REAL ground collision grounded it (radius 108.97,
`aboveGround` 0.593 on the merged tree; 108.937 / 0.56 and 112.624 / 0.623
in earlier runs — where the flying
bird touches down varies, that it does not), then it walked 3.15 units with
its clearance held at 0.562-0.640 (0.560-0.638 before the merge) — never under the ground, never lifting
off it. (`tools/birb-walk.mjs` is frozen and boots without the flag; this is
its flagged counterpart.)

**The wetness is visible and is a network**: over the trunk channel, the
live A/B (wet strength 1, 0, 1, 0 in one boot, no recompile) moves the
frame by mean |ΔL| **1.51-1.54** (three runs) against a control of **0.000** between the two
identical strength-1 frames; **12.0%** of the frame changes by more than 4
levels (a network, not a wash), and **0.00%** of pixels get brighter (it
only darkens).

**Clean boots**: zero console errors or warnings with the flag on, and zero
on the default boot, where the check also finds no bake, no wet map and the
Flags switch reading Off.

**The unit suite** (`tests/erosion.test.js`, 18 tests): opt-in flag and Flags
entry; complete profiles, city null; grid invariants at n = 4/16/64
(6n²+2 nodes, symmetric links, 4 PI); the sampler returns node values and
interpolates within tolerance; **continuity across all 12 cube edges and all
8 corners**; **allocation-free** (a source scan for anything that can
allocate, plus heap growth over 20k calls against a bare-arithmetic
control — an allocating variant grew 889 KB against the control's ~160 KB);
**carve-down only** on a cone and on rolling noise; **deterministic** to the
byte; **drainage grows along every link** and is conserved into the lakes to
1e-9; **a roughened cone erodes into a dendritic network** (at n = 48: 66
heads, 27 confluences, 38 mouths — channels join on the way down — with the
cut concentrated in them); sea level as base level; `protectAt` withholds
exactly; wetness monotone in drainage; the equirect convention; the
`wetMap` shader byte-identical when omitted, one fetch and its own program
when passed, throws when incomplete; worker arrays survive a structured
clone.

## Traps

1. **Thermal erosion on the heights slid whole hills into the channels.**
   A stepped talus collapse was built first, then its steady state (the
   lower envelope of talus cones on every incised node), and both did the
   same wrong thing: this world's noise is steeper than any sane talus
   angle at grid scale — the median node already has a 39-degree link — so
   every bank that collapsed became an incision whose neighbours collapsed
   in turn. Spreading the INCISION (the flank term) instead of capping the
   SLOPE leaves a hill with no river at its foot exactly as the art made it.
2. **The stream-power law alone cut notches, not rivers.** Without uplift the
   implicit iteration only cuts where the steady profile runs under the
   ground — at saddles and in highlands — which on this noise was a scatter
   of short notches, with the network between them present in the drainage
   and absent from the ground. Uplift makes the fixed point the analytic
   steady profile, and the groove makes the bed continuous to the lake.
3. **A channel the floor can find and the mesh cannot draw is a
   fly-through.** A one-node channel is 3 units under a 6.7-unit mesh: the
   floor drops into it and the drawn ground stays up, so the bird sinks into
   what it sees — the failure the carve-down clamp exists to prevent, arriving
   sideways. That is what sizes `flank` and `smooth`, and why the fine
   network travels only in the wetness texture, which the floor never reads.
   The mountain was the one biome over the line: Δmax **+0.806** against the
   0.8 limit at `flank 5 / smooth 2`; `flank 6 / smooth 3 / maxCut 10`
   measures +0.558.
4. **"Carve-down only" has to be exact, and a blend broke it by 1.78e-15.**
   The protect blend `l += (hi - l) p` can round a hair ABOVE the ground,
   which handed the smoothing a positive "floor" to clamp up to — a node
   RAISED by 2e-15, caught by the unit test that asserts `delta <= 0` at
   every node. The limit is now clamped with a comparison, not arithmetic,
   and the smoothing writes `0` rather than `-0`.
5. **V8 boxes a double crossing an un-inlined call**, so ANY number-returning
   function shows heap traffic in a loop — including the terrain function the
   sampler sits beside. The allocation test compares against a bare
   arithmetic function with the same signature; measured absolute growth
   alone would have failed a correct sampler and passed a leaky one.
6. **The first wetness was a smudge at 40% strength.** A plain average over
   a diagonal D8 chain halves its peak, so the shader's threshold missed the
   stream. Dilation first (each node takes `0.6 x` its wettest neighbour's),
   then one light average, keeps the peak and rounds the grid's staircase.
7. **The captures had two traps of their own.** The forest's clouds float
   40-80 units above their ground, so a top-down capture photographed a
   cloud deck: the top views solo the ground (`__BIRB.solo('sphere-ground')`).
   And a camera placed "N above the ground" photographs the eroded world from
   LOWER than the control, which is a difference that is the camera's, not the
   terrain's: every pose is an absolute direction and radius, the clock is
   held, and the two boots' control frames differ by 0.00.
8. **A flight control that is not the same flight proves nothing.** The first
   clearance control compared the eroded flight path against the un-eroded
   MESH — a bird flying the lowered floor over the old ground is inside it by
   construction (−2.37). The control now holds the bird at the same height
   above each world's own floor and measures against that world's own mesh.
9. **The eroded forest is a different forest, not the same forest carved.**
   The scatter's tree line consumes a random number only when a tree is
   exposed (`exposure > 0.82 && _activeRng() < ...`), so the first tree the
   carve moves across that threshold shifts every tree placed after it. Not
   fixed here: making the draw unconditional changes the DEFAULT world. It
   is why the low capture below differs in its trees more than its ground.

## The look

Captured with and without the flag from identical absolute poses (seeded
props, sun time 0 held, tier 0 pinned, and — since the merge — the air
field's gust visuals held with `__BIRB.stillAir(true)`). **Top-down over a trunk channel
(48 above base, ground solo'd): the eroded frame has a dark, sinuous, cool
line running downhill across the hill that is a uniform slope in the control
— it reads as a stream valley, continuous and joining, not as a noise
texture.** From the highland (62 above, solo'd) the change is fainter:
darker gullies down the lower slopes under the valley mist, the ridge line
unchanged (ridges are where water does not go). From a low oblique view in
the trees the ground difference is small and the tree layout difference
(trap 9) dominates. **From altitude, whole scene** (`forest-high`: 92 above
base, 1.2 rad nose-down, nothing solo'd — added on the merged tree because
this is the view a player gets from a climb): one faint darker gully runs
diagonally across the foreground hill in the eroded frame and not in the
control; the rest of the frame is valley mist, lakes and trees, and the
trees again differ by trap 9. A first attempt at 0.7 rad looked mostly into
the mist and showed no ground difference at all. `node tools/birb-realism.mjs
--only erosion-look,erosion-off --out DIR` writes all eight frames. Map renders of the bake (hillshade + wetness overlay,
Node) show the network plainly: channels leaving every catchment, joining,
and running into the lakes. At play distance this is a subtle change, and
the subtlety is set by the mesh: the carve cannot go deeper or narrower
without failing the agreement table above.

## What is NOT verified

- **The phone**: bake time, worker start-up in Chrome-on-iOS, the extra
  ground-fragment work (one R8 fetch, an `atan` and an `acos` per ground
  fragment), memory. Estimated, not measured: ~3.3 MB of JS heap for the
  shared n = 64 grid, ~0.3-0.5 MB per cached biome (face arrays + the wet
  bytes), a 128 KB R8 texture, and the 512 KB horizon terrain grid kept
  while the flag is on — ~5 MB with all three biomes cached, against the
  50 MB heap budget.
- **Anyone's eye but SwiftShader's.** No blind A/B, no owner review. The wet
  tints were tuned on these captures.
- **Desktop mesh density** (128 x 96) was not separately measured; it is
  denser than the phone mesh the table is sized against, so its gap can
  only be smaller.
- **Interaction with wave 2 is wired, not separately measured.** The air
  field's ridge lift reads `sampleTerrainHeight` (index.html hands it to
  `createAirField`), which goes through `terrainDisplacement`, so it lifts
  over the ERODED ridges by construction — but no check flies a ridge with
  both flags and compares. `?hextile=1&erosion=1` compiles the wet block
  after the hex overlay (one shader, both suffixes in the cache key) and
  was never booted together. Cloud volume does not read the terrain. The
  realism boots with `erosion=1` ran with every wave-2 default on and
  reported zero console errors or warnings.
- **The trees are a different draw, not the same trees on carved ground**
  (trap 9) — an owner looking at a before/after will see that first.

## References

- Braun, J. & Willett, S. D. (2013). A very efficient O(n), implicit and
  parallel method to solve the stream power equation governing fluvial
  incision and landscape evolution. *Geomorphology* 180-181, 170-179.
- Barnes, R., Lehman, C. & Mulla, D. (2014). Priority-flood: An optimal
  depression-filling and watershed-labeling algorithm for digital elevation
  models. *Computers & Geosciences* 62, 117-127.
- Schott, H., Paris, A., Fournier, L., Guérin, E. & Galin, E. (2023).
  Large-scale terrain authoring through interactive erosion simulation.
  *ACM Transactions on Graphics* 42(5).
- Tzathas, P., Gailleton, B., Steer, P. & Cordonnier, G. (2024). Physically
  based analytical erosion for fast terrain generation. *Computer Graphics
  Forum* 43(2) (Eurographics 2024).
- Leopold, L. B. & Maddock, T. (1953). The hydraulic geometry of stream
  channels and some physiographic implications. USGS Professional Paper 252.

## Integration notes

Shared files touched, each in one compact region:

- `src/environment/spherical-world.js`: the `erosion.js` import; module
  state after `_activeWaterLevel`; ONE line in `terrainDisplacement`; the
  bake / prefetch / agreement functions after `sampleTerrainMeshHeight`;
  activation in `createSphericalWorld` directly after `setActiveValley`; the
  wet texture just before `addGroundDetail` and the `wetMap` spread in its
  options; `terrain` in `horizonState` and `terrainGrid()` on `world.horizon`;
  `erosion` and `groundAgreement()` on the returned world; the texture's
  dispose.
- `src/environment/ground-detail.js`: the `wetMap` option (uniforms, one
  fetch before `outgoingLight *= gdTint`, AFTER the hex/triplanar overlay,
  cache-key suffix `-wet` after `-hex`). This was the one textual merge
  conflict with main's hex tiling; both sides kept.
- `src/ui/boot-flags.js`: one Terrain entry before the Light section.
- `sw.js`: two `CORE_ASSETS` lines after `ground-detail.js`. `BIRB_BUILD` /
  `CACHE_VERSION` NOT bumped — the integrator bumps once.
- `index.html`: one `__BIRB.erosion` hook after `horizonPatched`.
- The integrator regenerates `tools/oracle-manifest.txt` for the new test
  file.

## Merged-tree verification (2026-09-24)

After merging main `d28da11` into this branch (conflicts only in
`ground-detail.js` and `sw.js`, resolved keeping both sides):

- `node tools/birb-realism.mjs --only erosion-*` (the six flagged checks plus
  `erosion-off` on the default boot): **43/43**, zero console errors or
  warnings on either boot; re-run of look/off with the new altitude view
  **10/10**.
- `node tools/birb-modes.mjs`: all 5 modes ok in forest (load ~11).
- `node tools/birb-walk.mjs`: walk ok in forest.
- `npm test`: 1211 tests, 999 pass, 210 skipped, 2 fail — both
  `tests/oracle-manifest.test.js` reporting `tests/erosion.test.js` unpinned
  (the expected failure; the integrator regenerates the manifest).
  `tests/erosion.test.js` 18/18.
- `BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js`: 4/4.
- `sha256sum -c tools/oracle-manifest.txt`: 0 failures.
- The interrupted work item ("the page side: receive face arrays without
  building a grid, and stop retaining per-node arrays in the cache") was
  found complete in the WIP commit: the worker posts only the per-face
  arrays and the wet bytes (transferred), the page rebuilds the field with
  `erosionFieldFromFaces` (no grid), and a cache entry holds only
  `{ field (face arrays), wetBytes, stats }`. The node graph is built on the
  main thread only if the fallback bake runs, and is then kept (~3.3 MB)
  for the session.
