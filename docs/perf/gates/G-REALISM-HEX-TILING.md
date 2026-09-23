# G-REALISM-HEX-TILING — ground that never repeats (opt-in)

**Date:** 2026-09-23. **Branch:** `realism/hex-tiling`, based on `d47fc7e`
(the integrated first realism wave; the brief named `e252ca1`, and
`src/environment/ground-detail.js` is byte-identical in the two).
**Decision:** SHIP OPT-IN, `?hextile=1` — a select on the Flags tab
(Surfaces → "Ground map never repeats (hex tiling)"). The default does not
move by one byte: without the flag `addGroundDetail` emits `e252ca1`'s shader
exactly, and so does a hex-capable ground switched off at runtime — diffed
against that commit's own file for every combination of biome, smooth, bump
and map it understands (32), plus the 16 of them with a map built hex-capable
and switched off: 48 of 48 identical, vertex and fragment source and cache
key. No frozen oracle was touched
(`sha256sum -c tools/oracle-manifest.txt` exits 0); the new
`tests/hex-tiling.test.js` makes `tests/oracle-manifest.test.js` report the
manifest stale, which is the expected and only failure (`npm test`: 1122
tests, 910 pass, 210 skipped, 2 fail — both of them that file's two
assertions naming `tests/hex-tiling.test.js`).

**Not measured: the phone.** Every number below is this machine's Chromium
on SwiftShader or the unit suite's JS mirror. No frame-time, thermal or
fill-rate number exists for the iPhone 16 Pro, and none is claimed. That is
why this is opt-in: the frozen suites pin the default's fetch budget (three
`texture2D` calls), and a budget is the one thing a SwiftShader frame cannot
price.

## What was wrong

The forest ground's authored map (`forest_ground_albedo.png`, 512², one tile
every 18 units) is one photograph laid in a lattice. From the air that is the
same dark blotch and the same pale gravel patch marching across every valley
in rows. Measured at the default — cockpit camera 40 units up, straight down,
clock held, props, weather and horizon shadows off, the frame rectified onto
the projection's own coordinates (below) and band-passed to the gravel's
grain and clumps (0.1-1.2 units) — the ground correlates with itself one tile
away at **r = 0.359**, against **0.004 +/- 0.020** (max 0.047) at 64 lags
that are not a tile: **z = 18**. Nothing else in the frame repeats; the
photograph does.

## What shipped

### 1. Hex tiling (Mikkelsen 2022, "Practical Real-Time Hex-Tiling", JCGT 11(3))

The texture plane is cut into a triangle grid (`2*sqrt(3)` cells per repeat,
the paper's and Heitz-Neyret 2018's: tile centres 0.29 of a repeat apart,
5.2 units on the forest's 18-unit tile). Every grid vertex owns a hexagonal
tile that shows the map at a random offset (a whole repeat) and a random
rotation (a full turn: gravel seen from above has no grain direction), and
every point blends the three tiles of its triangle. Mikkelsen's blend is what
makes that usable: the barycentric weight is raised to the 7th power, so most
of every tile is one sample and only a thin seam blends, and it is tilted
toward the brighter sample (`mix(1, luminance, 0.6)`), so the seam follows
the texture's own features like a height blend instead of cross-fading two
photographs into mush. Each fetch is a `textureGrad` whose gradients are
rotated with its tile — GLSL ES 3.00, which three compiles as, has it in core
(`#define texture2DGradEXT textureGrad` is three's own alias for it) — so the
mip choice stays continuous across seams the random offsets tear in the
coordinate. The per-vertex hash is Hoskins' "hash without sine", measured
uncorrelated across the lattice shifts that matter (|r| <= 0.026 over the
6,561 vertices the planet uses).

On the real albedo, through the JS mirror (`hexTileCell` / `hexTileUv` /
`hexTileWeights` — the functions the GLSL is written from), the blend moves
the mean **+0.2% per channel** (200k samples; with the luminance weighting
switched off the same estimator reads -0.2%, so that is its floor) and
**+0.3%** in the unit test's luminance-only version, and keeps **94%** of the
map's standard deviation against the plain tiling sampled the same way.
`uGroundGain` is 1/mean of the file, so a blend that moved the mean would
move the whole forest floor's value; this one does not. On the live page the
frame's mean moved -0.25 to -0.31% (smooth) and -0.24 to -0.49% (flat) across
boots.

### 2. On two projections, not three (Quilez's biplanar)

Of the triplanar's three projections only the two dominant ones are fetched,
each with its OWN projected world-space derivatives (the axis choice makes
the coordinate discontinuous, so implicit derivatives would pick garbage mip
levels at every swap). Kept axes are weighted with local support —
`clamp((|n| - 1/sqrt(3)) / (1 - 1/sqrt(3)))^4` — so a kept axis weighs
nothing at 1/sqrt(3), which is exactly where the dropped axis can change:
the swap is seamless (a unit test walks 60 great circles in 3e-4 rad steps
and proves the steepest step is a slope, not a jump). Three tiles times two
projections is **six fetches, not nine** — and over most of the planet the
median axis sits below 1/sqrt(3) and weighs exactly zero, so its three are
**skipped**: three fetches there, the triplanar's own count. Explicit
gradients are what make that branch legal.

**The projections are chosen by the smooth surface normal**, not by the
sphere's radial the triplanar uses. This was measured, not assumed: chosen by
the radial, a valley wall near one of the planet's three-way ties kept a
single projection lying almost along it and the map streaked into long
vertical smears; the triplanar had hidden the same projection by averaging
three into blur. The triplanar avoided the FACET normal because it snaps per
triangle; the smooth normal is continuous, which is all the seamless swap
needs, and on the same frame it turns both the streaks and the blur into
clean gravel. The flat path (`?smooth=0`) has no continuous surface normal
(three compiles `vNormal` away under FLAT_SHADED) and keeps the radial.

The bump (`?groundbump=0`) still reads the colour fetches — its height is
the luminance of the same hex result — so the ground is at most six fetches
with or without it.

### 3. Opt-in, and the off side is the true before

`addGroundDetail(material, THREE, { groundMap: { ..., hexTile: true } })`;
`hexTile` may also be a partial `HEX_TILE_DEFAULTS` (`rotation`, `falloff`,
`exponent`, `cells`), carried to the shader as one `vec4 uGroundHex`.
`spherical-world.js` passes `hexTile: hexTileRequested(location.search)` for
the forest only — the only biome with a ground map. Without it the module
takes exactly the path it always took. `setGroundHexTile(material, on)`
flips a hex-capable ground at runtime by RECOMPILING, so the A/B's off frame
is the default program, not an imitation of it.

Hooks (`?debug=1`): `__BIRB.hexTile()` reads `{ enabled, define, params }`
(null on a ground built without the flag — the default boot cannot be
switched on); `__BIRB.hexTile(on, { rotation, falloff, exponent, cells })`
flips and retunes live.

## Measured

`node tools/birb-realism.mjs --only 'hex-tiling-*'`: **24/24**, three boots
(`hextile=1`, `hextile=1&smooth=0`, and the default, where `hexTile()` reads
null and cannot be switched on), zero console errors or warnings in any of
them. Every A/B is hex OFF, ON, OFF, ON at one held pose in one boot; the
repeat of each arm is its control.

| 40 units up, straight down | smooth (default) | flat (`?smooth=0`) |
|---|---|---|
| control pairs (off/off, on/on), mean abs, of 255 | 0.000 / 0.000 | 0.000 / 0.000 |
| the arms, mean abs, of 255 | 11.94 | 9.87 |
| r one tile away, triplanar | **0.359** (z 18.0) | **0.332** (z 12.8) |
| r one tile away, hex | **0.030** (z 1.1) | **0.021** (z 0.5) |
| null, triplanar (64 non-tile lags) | 0.004 +/- 0.020, max 0.047 | 0.005 +/- 0.026, max 0.057 |
| null, hex | 0.006 +/- 0.021, max 0.080 | 0.007 +/- 0.027, max 0.100 |
| raw-pixel r at the predicted lag, off / on | 0.035 / 0.051 | 0.023 / 0.037 |
| mean linear luminance, off -> on | 0.1860 -> 0.1855 (-0.25%) | 0.1848 -> 0.1844 (-0.24%) |
| frame masked as not-ground | 3.7% | 6.5% |

Earlier boots of the same measurement before the band and the weather were
settled read the same shape: triplanar 0.24-0.43 (z 4.7-16), hex
0.017-0.091 (z 0.5-2.2), never a hex arm outside its null. Reproduce with
`--out <dir>` to keep the frames and `HEX_TILING_DUMP=grid.json` to keep the
rectification grid, and every number here can be re-read offline without
another boot.

`tests/hex-tiling.test.js` (29 tests) pins the rest without a browser: the
off side byte for byte against the no-hex shader for every path and biome;
three `textureGrad` tiles with rotated gradients fetched for two projections
and none of the triplanar's; both blends renormalised; the bump on the same
fetches; the define and the uniform binding the runtime flip depends on; and
on the JS mirror, weights summing to 1, per-vertex weights continuous across
every triangle edge, the biplanar swap continuous over 60 great circles, the
hash uncorrelated across lattice shifts, a synthetic periodic texture
correlating at 1.000 one repeat away under plain tiling and under 0.1 hex
tiled, and the real albedo's mean (+0.31%) and contrast (0.944) kept. Four
mutations were run against it (local support removed, the wrong triangle
chosen near the diagonal, the blend left unnormalised, the flat overlay's
tint multiply dropped); each failed the tests that name it.

Parameter sensitivity, one earlier boot, same pose, same band (r one tile
away, z against that frame's null of sd 0.02): the defaults 0.040 (z 1.6);
`exponent` 3 and 12 and `falloff` 0, 0.038-0.039 (z 1.5-1.6) — the blend's
knobs do not re-deal the tiles, so they cannot move it; `cells` 3.6, 0.014
(z 0.6) and `rotation` 0, 0.009 (z 0.2) — these re-deal the tiles, and a
different deal at one spot reads a different number inside the same null.
Triplanar 0.281 (z 14.0) in that boot. At 80 units up (grid 0.2 units, a
0.2-1.2-unit band): triplanar 0.293, hex 0.005. The paper's defaults stand;
nothing here is a reason to depart from them. Across every boot of this
package the hex arm read z 0.5-2.2 at this spot — always inside its null,
usually a little above its mean: one spot is one deal, and the check's
threshold is z < 3, not zero.

Cost, SwiftShader only (ground filling the frame, Amazing, a 4-core box at
load average 6-8 shared with another builder): 389.6 / 422.9 ms a frame off,
458.3 / 475.0 ms on — about +15%, and it proves nothing about a GPU. What is
known without a device: where one projection weighs anything (most of the
planet) the hex path makes the triplanar's three fetches, as `textureGrad`,
plus, per projection, three hashes, three sine/cosine pairs and a `pow`; in
the blend bands, six fetches and twice the arithmetic. The texture carries anisotropy 16, so a grazing fetch can
cost up to 16 taps on either path.

## Traps (each cost a round)

- **The first A/B photographed one arm twice, pixel for pixel** ("the arms
  differ by 0.00"). `addAtmosphere`, chained after this patch on every world
  material, evaluates the cache-key chain ONCE, at patch time, and returns
  that string forever; a key that changes afterwards changes nothing, and
  three reuses the program it has. Three also keys programs on
  `material.defines`, so the hex program carries `BIRB_GROUND_HEX` — and an
  empty defines object adds nothing to the key or the source, so the off
  program stays the default one exactly.
- **A program reused from three's cache uploads from the uniforms object of
  the program compiled LAST.** After off -> on, a uniform bound only for the
  hex variant was never uploaded again: a five-point parameter sweep came
  back as five identical frames. `uGroundHex` is now bound in every compile
  of a hex-capable ground; the off source does not declare it, so the off
  program is unchanged.
- **A perspective frame is not a map.** On the check's pose one tile measures
  403 px up the frame and 353 px down it (relief and the planet's curvature),
  so no single pixel shift aligns the frame with itself: the REPEATING ground
  correlated at 0.02-0.04 at the predicted pixel lag and at no more than 0.08
  anywhere in an 80 x 260 px search around it — indistinguishable from the
  hex frame (0.04-0.05). The checks ask in the projection's own coordinates
  instead — a grid of ground points at fixed (u, v), each solved onto the
  terrain along the projection axis (sampled on a 1-unit lattice and
  interpolated) and projected to a pixel — where one tile is exactly 180
  samples everywhere. Every log line still prints the raw-pixel number
  beside the rectified one, so the trap stays on the record.
- **A mote at the lens halved the answer on one boot in four.** A pollen
  particle close to the camera drew a pale disc over the frame's right edge
  (the weather is not under `__BIRB.solo`), and the triplanar's one-tile
  correlation read 0.140 where three other boots read 0.29; excluding the
  disc's 50 px strip put it back at 0.297. The checks now emulate
  reduced motion, which is the game's own switch for weather density 0, and
  mask anything whose 9x9-pixel mean is far off the frame's median in any of
  the four frames (a drone, a disc; it also takes the brightest sunlit
  gravel, 4-7% of the frame, the same cells in both arms). Reduced motion
  also drops the speed-sense FOV, so the frame is about 10% narrower than a
  flying one (a tile 403 px up the frame rather than 367): the grid is
  projected through the camera that took the frame, so it follows.
- **The band was chosen on the null's width, not on the answer.** At 0.2-2.4
  units the flat ground's facet edges are hard lines in the band and its
  null spread to sd 0.05 (the triplanar at z 4.7-5.2, a coin toss against
  any threshold); at 0.1-1.2 units both grounds' nulls are sd 0.02-0.03 and
  the triplanar stands at z 11-18 on both.
- **Bilinear filtering alone takes 17% of the gravel's standard deviation.**
  The first contrast test read 0.784 against the raw texels and failed;
  against the plain tiling sampled the same way it is 0.944. Compare like
  with like.
- **Value noise correlates with itself one lattice cell away** (neighbouring
  cells share four corners). The procedural mottle's finer lattice is 4.04
  units, and that lag reads up to 0.06 in frames with no repeating map at
  all. It is part of the honest floor, which is why the verdict is a z-score
  against 64 pseudo-random lags rather than against three friendly ones.
- **Biplanar has one pinch it cannot avoid**: at the eight points where all
  three axes tie, two projections cannot be symmetric, and within about a
  unit of each the weight changes hands over a short distance (steep, not
  discontinuous — the unit test proves the difference). Eight points on a
  754-unit planet. The triplanar blurs there instead.
- Considered and rejected on the fetch budget: **Wronski 2025**, "GPU-Friendly
  Laplacian Texture Blending" (JCGT 14(1)), which blends Laplacian levels with
  per-level mask sharpness and fixes the seams' contrast loss properly — at
  n+1 fetches per tile per projection, 30 for four levels against six.

## Not verified

- **The phone**: the cost above, and whether the hex seams read as a faint
  lattice at a perch under the soil bump on real glass. In the perch
  capture here no hex lattice was visible and the bump read alike on both
  sides; that is SwiftShader and one reviewer's eye, not the owner's.
- **Any other biome**: only the forest has a ground map, so only the forest
  can be hex-tiled. The canyon, granite and concrete surfaces sit on real UVs
  of their own props and are untouched.
- **The eight three-way ties in flight**: understood and bounded in the unit
  suite, photographed from 40 units up, never flown through.

## Files

`src/environment/ground-detail.js` (the option, the GLSL, the JS mirror,
`hexTileRequested`, `setGroundHexTile`); `src/environment/spherical-world.js`
(one import, the `hexTile` field on the forest's ground map);
`src/ui/boot-flags.js` (`hextile`, a select, Surfaces); `index.html` (the
`__BIRB.hexTile` hook beside `__BIRB.smooth`); `tests/hex-tiling.test.js`;
`tools/realism-checks/hex-tiling-{lib,repeat,flat,off}.mjs`. No new module,
so `sw.js` is untouched.
