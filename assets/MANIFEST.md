# Authored asset manifest

Every file under `assets/` gets a row here before it is wired into the game.
The brief, the contract and the acceptance gate are in
[docs/realism/AUTHORED_ASSETS.md](../docs/realism/AUTHORED_ASSETS.md).

Rules, in short:

- **Generated from scratch or licensed for redistribution.** This is a public
  repository used to teach. Nothing derived from a photograph, a scan or
  another artist's texture that cannot be licensed.
- **Baked offline, committed as the final runtime file.** There is no build
  step, no bundler and no asset pipeline at deploy.
- **Root Birb only.** `/gauntlet`, `/sculpture`, `/icon3d` and `/AR` ship zero
  external assets by their own rules and must not import from here.
- **Accepted means `node tools/asset-check.mjs assets/` exits zero** — and that
  says nothing about whether it *looks* right, which is a human's call on a
  real phone.

| File | Kind | Target (material + slot) | World tile | Source (model + prompt, or tool) | Licence | Commit |
|---|---|---|---|---|---|---|
| `textures/bark_pine_albedo.png` | sRGB albedo | `barkMat.map` + `trunkMat.map` (landmark trunk, fallen log, every instanced forest trunk, and the MOUNTAIN's pine trunks under `PINE_BARK_TINT`) — **shipping default**, `?bark=0` to disable | ~4.3 m square | OpenAI image generation; prompt "seamless, unlit grey-brown weathered pine bark plates with deep vertical fissures"; from scratch, resized to 512² RGB with Pillow 12.3.0 | ISC | `e20a04b` |
| `textures/bark_pine_normal.png` | linear tangent-space normal, OpenGL +Y | `barkMat.normalMap` / `trunkMat.normalMap` — **shipping default** | ~4.3 m square | Offline from the albedo with Pillow 12.3.0 + NumPy 2.3.5: wrap-aware multiscale luminance height proxy, circular gradients | ISC | `e20a04b` |
| `textures/stone_rock_albedo.png` | sRGB albedo → `stoneMat.map`, ~4.5 m tile, `?stone=1` | `stoneMat.map` (landmark arch) — **shipping default**, `?stone=0` to disable | ~4 m square | OpenAI image generation; prompt “seamless, orthographic weathered grey-brown sandstone with horizontal bedding, wind-scoured pitting and shallow cracks under flat ambient light”; generated from scratch, resized and mean-graded to `#6b6257` with Pillow 12.3.0 + NumPy 2.3.5. **Runtime tint lifts it to `#b5a58c`** — as delivered its mean sits 6.6 sRGB units from the bark's and the arch read as timber; the arch's UVs are also swapped so its bedding rings the tube instead of running down the leg | ISC | `2df735c` |
| `textures/stone_rock_normal.png` | linear tangent-space normal, OpenGL +Y | `stoneMat.normalMap` (landmark arch) — **shipping default** | ~4 m square | Offline from `stone_rock_albedo.png` with Pillow 12.3.0 + NumPy 2.3.5: wrap-aware multiscale luminance height proxy and circular gradients; independently generated normal rejected because its surface features did not align | ISC | `2df735c` |
| `env/forest_sky.png` | RGB LDR equirectangular environment | `skyDome` sky texture — **shipping default**, `?skytex=0` to disable | n/a — equirectangular | OpenAI image generation; prompt “seamless full-sphere humid forest atmosphere, blue-green sky, warm horizon, broad directional brightening, no sun disc or landscape”; generated from scratch, resized to 1024×512 RGB with Pillow 12.3.0 | ISC | `59b3cbf` |
| `env/canyons_sky.png` | RGB LDR equirectangular environment | `skyDome` sky texture — **shipping default**, `?skytex=0` to disable | n/a — equirectangular | OpenAI image generation; prompt “seamless full-sphere high-desert atmosphere, mauve upper air, peach horizon, subtle dust and cirrus, no sun disc or terrain”; generated from scratch, resized to 1024×512 RGB with Pillow 12.3.0 | ISC | `59b3cbf` |
| `env/mountain_sky.png` | RGB LDR equirectangular environment | `skyDome` sky texture — **shipping default**, `?skytex=0` to disable | n/a — equirectangular | OpenAI image generation; prompt “seamless full-sphere high-altitude atmosphere, cool blue vault, subdued warm horizon and wind-stretched cloud, no sun disc or mountains”; generated from scratch, resized to 1024×512 RGB with Pillow 12.3.0 | ISC | `59b3cbf` |
| `env/city_sky.png` | RGB LDR equirectangular environment | `skyDome` sky texture — **shipping default**, `?skytex=0` to disable | n/a — equirectangular | OpenAI image generation; prompt “seamless full-sphere dark urban dusk atmosphere, deep blue sky, muted peach afterglow and layered cloud, no sun, skyline or lights”; generated from scratch, resized to 1024×512 RGB with Pillow 12.3.0 | ISC | `59b3cbf` |

| `textures/canyon_sandstone_albedo.png` | sRGB albedo | `spireMat.map` + `darkSpireMat.map` (canyon spires, both InstancedMesh buckets) — **shipping default**, `?canyon=0` to disable | ~4.3 m square | OpenAI image generation via the owner's ChatGPT, from this session's brief; from scratch; committed first at `Mentis123/data3-cisco-live@249ea46` (`client/public/textures/`) as 1024²; downscaled here to 512² — see "Why 512, not 1024" below | ISC | `249ea46` (source), this commit (512² + normal) |
| `textures/canyon_sandstone_normal.png` | linear tangent-space normal, OpenGL +Y | `spireMat.normalMap` + `darkSpireMat.normalMap` — **shipping default** | ~4.3 m square | Derived offline from the albedo above by `tools/derive-normal.mjs` (wrap-aware multiscale luminance height proxy, circular Sobel gradient) — see "Normals from a proxy, not a scan" below | ISC | this commit |
| `textures/mountain_granite_albedo.png` | sRGB albedo | `stoneMat.map` (MOUNTAIN's own peak body material, distinct from the forest arch's `stoneMat`) — **shipping default**, `?granite=0` to disable | 8.0 m square | OpenAI image generation via the owner's ChatGPT, from this session's brief; from scratch; committed first at `Mentis123/data3-cisco-live@249ea46` as 1024²; downscaled here to 512² | ISC | `249ea46` (source), this commit (512² + normal) |
| `textures/mountain_granite_normal.png` | linear tangent-space normal, OpenGL +Y | `stoneMat.normalMap` (mountain peaks) — **shipping default** | 8.0 m square | Derived offline from the albedo above by `tools/derive-normal.mjs` | ISC | this commit |
| `textures/mountain_snow_albedo.png` | sRGB albedo | `snowMat.map` (mountain snow caps, `ConeGeometry` — confirmed a `CylinderGeometry` subclass with the same UV convention before wiring, not assumed) — **shipping default**, `?snow=0` to disable | 8.0 m square | OpenAI image generation via the owner's ChatGPT, from this session's brief; from scratch; committed first at `Mentis123/data3-cisco-live@249ea46` as 1024²; downscaled here to 512² | ISC | `249ea46` (source), this commit (512² + normal) |
| `textures/mountain_snow_normal.png` | linear tangent-space normal, OpenGL +Y | `snowMat.normalMap` (mountain snow caps) — **shipping default** | 8.0 m square | Derived offline from the albedo above by `tools/derive-normal.mjs` | ISC | this commit |
| `textures/city_concrete_albedo.png` | sRGB albedo | `buildingMats[0..2].map` (city facades, `shape:'box'` — a `BoxGeometry` face's UV patch spans its own two world-size axes, not a circumference) — **shipping default**, `?city=0` to disable | 6.0 m square | OpenAI image generation via the owner's ChatGPT, from this session's brief; from scratch; committed first at `Mentis123/data3-cisco-live@249ea46` as 1024²; downscaled here to 512² | ISC | `249ea46` (source), this commit (512² + normal) |
| `textures/city_concrete_normal.png` | linear tangent-space normal, OpenGL +Y | `buildingMats[0..2].normalMap` (city facades) — **shipping default** | 6.0 m square | Derived offline from the albedo above by `tools/derive-normal.mjs` | ISC | this commit |
| `textures/forest_ground_albedo.png` | sRGB albedo | `sphereMaterial`'s triplanar `groundMap` overlay (forest ground only — the only ground albedo shipped; the planet's own UVs converge at the poles, hence triplanar) — **shipping default**, `?ground=0` to disable | 18 m square (`GROUND_TILE_UNITS`), triplanar `pow(\|N\|,4)` blend | OpenAI image generation via the owner's ChatGPT, from this session's brief; from scratch; committed first at `Mentis123/data3-cisco-live@249ea46` as 1024²; downscaled here to 512² | ISC | `249ea46` (source), this commit (512² + normal) |
| `textures/forest_ground_normal.png` | linear tangent-space normal, OpenGL +Y | **unused** — `ground-detail.js`'s triplanar overlay declares a single `uGroundMap` albedo sampler and no normal slot (see `applyAuthoredGround`'s doc comment: filling one anyway is the same `MeshLambertMaterial`-has-no-`roughnessMap` no-op `applyAuthoredBark` already found once). Shipped for provenance parity with its sibling albedo; never fetched at runtime, and charged `none` in the residency table below | n/a | Derived offline from the albedo above by `tools/derive-normal.mjs` | ISC | this commit |

**All ten are wired.** `forest_ground_albedo.png` was the one "pending
wiring" row left after the previous pass — `ground-detail.js`'s shader/uniform
mechanics (`groundMap`, the triplanar sampling, `uGroundMap`/`uGroundMix`)
were already built and unit-tested (`tests/ground-triplanar.test.js`) by that
stage, but nothing called `addGroundDetail` with a `groundMap` option and
`authored-textures.js` had no loader for it — so `?ground=1` was a genuine
no-op, verified pixel-identical against `?ground=0` on a real capture (0.00
mean abs diff over 2.96M px). `GROUND_TILE_UNITS`, `GROUND_TRIPLANAR_SHARPNESS`,
`authoredGroundRequested` and `applyAuthoredGround` now close that gap in
`authored-textures.js`, and `spherical-world.js` passes `groundMap` for the
forest biome only. `GROUND_TINT` and `GROUND_MAP_STRENGTH` (already exported,
already the oracle's own contract) are unchanged by this.

**`GRANITE_TINT` was also revised, downward.** The delivered value (1.73x the
mountain peak's own procedural luminance, solved to clear a 60 sRGB-unit gap
against the pine bark 40+ altitude units below it) was measured on real
capture to collapse the snow cap's contrast against the granite it physically
sits on by 39% (128.4 sRGB units with both textures off, 78.8 with both on) —
lifting the peak pulled it up TOWARD a snow cap that cannot get brighter to
compensate (SNOW_TINT is already at its own 1.5%-clipping ceiling). The
revised value holds the peak at 0.867x its procedural luminance instead —
nearer stoneMat's own tone than brighter than it — which recovers the
snow:granite luminance ratio to 81% of its procedural value (was 40%). See
the constant's own comment in `authored-textures.js` and the new guard test
`tests/authored-textures.test.js`'s `'the snow cap does not lose its contrast
ratio against the granite peak'`, watched failing against the old value
before the fix (`granite renders at 1.733x its procedural luminance (ceiling
1.3)`). **This makes `tests/authored-tints.test.js`'s pinned
`assert.deepEqual(GRANITE_TINT, [0.813, 0.957, 1.274])` and its `mountain:
pine bark vs granite >= 60` separation assertion stale, and both were
reconciled at integration:** the pin is `{r: 0.407, g: 0.479, b: 0.637}`
(target `#5c6372`, 0.87x the procedural peak), and the pine-vs-granite pair
moved out of the 60-unit sweep into its own test with a measured floor. The
measurement that settled it: the authored pine bark already sat **34.9** sRGB
units from the PROCEDURAL peak before any granite texture existed (the
procedural pine trunk was the near-black slab, which is why the procedural
pair read 98.7), so the gap was never the granite's to open; the authored
peak lands at 36.3, i.e. authoring the granite did not cost a unit of it. The
test asserts exactly that (authored gap >= procedural gap), a 30-unit floor,
and hue opposition (pine r/b > 1.3, granite r/b < 0.8), which Euclidean sRGB
distance under-counts and which is what actually separates warm bark from
cold rock at 40+ altitude units apart.

Every tint (`CANYON_TINT`, the per-material `CANYON_DARK_SPIRE_SCALE`,
`GRANITE_TINT`, `SNOW_TINT`, `CONCRETE_TINT` and its three
`CITY_FACADE_SCALES`) is solved against the file's own measured linear mean
and documented alongside the constants in `authored-textures.js`, the same
way `PINE_BARK_TINT` was. `tests/authored-tints.test.js` was red on this
stage's start (`applyAuthoredSurfaceInstanced`'s consumers imported six
constants that did not exist yet) and is green now, 13/13.

### Why 512, not 1024

The five new albedos landed at 1024² in `data3-cisco-live@249ea46` and are
downscaled to 512² here, **in place**, with a genuine 2×2 box filter averaged
in linear light and re-encoded sRGB (a naive average of sRGB bytes darkens
midtones — the curve is convex on the way down). Three reasons, the same ones
that already put `bark_pine` and `stone_rock` at 512 rather than 1024:

- **The phone draws these props small.** The landmark arch and the instanced
  trunks this game already ships read correctly at 512² tiling every ~4-4.5 m,
  and this game's own measured on-screen footprint for a tiling prop is
  roughly 140 px — 1024² is detail the display never resolves.
- **1024² is 2 MB of DOWNLOAD per file**, decoded cost aside. Five of them is
  10 MB before a single normal map or sky exists, on a mobile-first game whose
  own service worker precaches its core assets.
- **It halves the decoded/mip cost for free**: 5.33 MB → 1.33 MB each. The
  1024² masters are not lost — `data3-cisco-live@249ea46` is the provenance
  pointer and stays the source of truth; this repo never carries the masters,
  only the shipping-sized derivative, matching every other authored texture
  here.

The box filter is a decimation-by-exactly-2, which is also the one resampling
kernel that cannot introduce a new wrap seam: every output texel averages
exactly four input texels with no fractional-grid drift, so a texture that
tiled at 1024² tiles at 512² by construction. Verified, not assumed — every
downscaled file's own seam ratio in the `asset-check` output above is
comparable to (usually better than) its measurement at 1024².

### Normals from a proxy, not a scan

None of these five arrived with a height field, so `tools/derive-normal.mjs`
derives one the same way `bark_pine_normal.png` and `stone_rock_normal.png`
were made: a wrap-aware multiscale height proxy from the albedo's own
luminance (three box-blur radii, combined as octave differences — one radius
picks one relief scale and misses either the grain or the undulation), then a
wrap-aware 3×3 Sobel gradient packed to a unit tangent-space vector.

**A derivative is a high-pass filter, and that found a real defect an
albedo-level check cannot see.** `city_concrete_albedo` passes the plain
wrap-seam check at a 0.03× ratio — its TONE matches across the wrap — but the
raw Sobel gradient of its height proxy measured 8.0×/6.4× at the same seam:
an AI-generated "seamless" tile can match value across the wrap while its
per-pixel grain does not, and only a derivative makes that visible. A
radius-2 wrap-aware pre-smooth before the Sobel step (inside
`deriveNormal()`) brought every one of the five back under the gate's 3×
ceiling (concrete measured 1.95×/2.69× at r=2; still 9.1×/6.9× at r=1) at the
cost of a little fine relief — a trade worth taking over shipping a normal
map with a visible seam. **Watched fail, not assumed to fail**: deliberately
inverting the green channel of `canyon_sandstone_normal.png` after
derivation flipped its convention correlation from `rG 0.365` to `rG -0.365`
and `tools/asset-check.mjs` rejected it as GREEN-DOWN, as designed; the
shipped file is the un-flipped, correctly-derived one.

The green-up sign is not hand-derived from tangent-space theory here — it is
picked so that `normalConvention()` in `tools/lib/asset-analysis.mjs`
correlates the same way the two existing shipped normals already do (positive
`rG`, negative `rR` against their own sibling albedo), because that function
is the actual oracle three.js's renderer will be judged against, and building
to satisfy it directly is more reliable than re-deriving the sign from first
principles and hoping. Two of the five (`city_concrete`, `forest_ground`)
land in the checker's own explicit "undecidable" band (`|rG| < 0.30`) because
those two albedos are the flattest/most isotropic of the five and do not
track their own derived relief closely enough for the correlation to be
decisive either way — noted by the checker, not a failure.

## Per-biome resident set

`tools/asset-check.mjs`'s plain directory sum charges every authored texture
at once, but the runtime never holds more than one biome's *world props* at
once: environment switches in `spherical-world.js` dispose the previous
biome's prop textures before building the next, and `sky-dome.js` disposes the
outgoing panorama on rebind (it has to do its own — the dome is added straight
to `scene`, so the world teardown never sees it). The directory total below
(32.67 MB) is therefore not the number the 24 MB budget was ever meant to
bound — the worst SINGLE biome's resident set is, and that is what
`tools/asset-check.mjs` computes and fails on, from this table. A file
present under `assets/` but missing from this table is charged in EVERY
biome (fails loud, not silently under-counted) until a row is added for it;
a file that ships but is never fetched at runtime gets the literal cell
`none` instead of a biome list, so it is not silently over-charged either
(`textures/forest_ground_normal.png` below).

**REFUTED twice, and one of the two corrections has since been retired.** A
prior pass of this table charged each file once per biome regardless of how
many materials in that biome actually load it — that undercount was real and
the fix stands. It also charged each sky panorama to exactly one biome, which
was an undercount only for as long as the dome leaked; that charge has now gone
back to one biome each, because the runtime earned it. Both, in order:

- **`loadTexture` creates a fresh `Texture` — a fresh GPU upload — per
  `apply*` call.** A file two materials in the same biome each call it for
  really is resident twice, not once: canyon_sandstone (`spireMat` +
  `darkSpireMat`), city_concrete (three `buildingMats`), and bark_pine in
  forest (the landmark trunk's `barkMat` + every instanced trunk's
  `trunkMat` — bark_pine in mountain is a single consumer, `pineTrunkMat`,
  and stays x1 there). Marked below as `biome xN`.
- **The sky panoramas leaked, and no longer do — so this table was corrected
  back.** `skyDome.setSkyTexture(null)` used to only null the uniform, never
  disposing the outgoing texture, and the dome sits outside the world teardown
  `spherical-world.js` runs on every switch — so every sky a session had ever
  opened stayed resident. Measured at the time by hooking
  `createTexture`/`deleteTexture` across 12 environment switches: 13 more live
  GL textures than a `?skytex=0` run, ~34.7 MB of leaked panoramas. While that
  stood, every sky row below listed all four biomes, because the honest worst
  case really was "every sky ever opened may still be resident."
  `setSkyTexture` now disposes the outgoing panorama before rebinding, so each
  row is back to its own biome. **That is a claim about the runtime, not about
  this file, and it is re-checkable:** `node tools/birb-textures.mjs` hooks the
  driver's texture ledger and drives all four biomes for three laps. It
  measures a flat 16 live textures per lap today, and **+4 per lap — one
  orphaned panorama per switch — with the three-line dispose removed again.**
  If that tool ever goes red, these four rows are lying and must go back to
  all-four until it is green.

| File | Biomes |
|---|---|
| `env/forest_sky.png` | forest |
| `env/canyons_sky.png` | canyons |
| `env/mountain_sky.png` | mountain |
| `env/city_sky.png` | city |
| `textures/bark_pine_albedo.png` | forest x2, mountain |
| `textures/bark_pine_normal.png` | forest x2, mountain |
| `textures/stone_rock_albedo.png` | forest |
| `textures/stone_rock_normal.png` | forest |
| `textures/forest_ground_albedo.png` | forest |
| `textures/forest_ground_normal.png` | none |
| `textures/canyon_sandstone_albedo.png` | canyons x2 |
| `textures/canyon_sandstone_normal.png` | canyons x2 |
| `textures/mountain_granite_albedo.png` | mountain |
| `textures/mountain_granite_normal.png` | mountain |
| `textures/mountain_snow_albedo.png` | mountain |
| `textures/mountain_snow_normal.png` | mountain |
| `textures/feather_contour_albedo.png` | forest, canyons, mountain, city |
| `textures/feather_contour_normal.png` | forest, canyons, mountain, city |
| `textures/feather_vane_albedo.png` | forest, canyons, mountain, city |
| `textures/feather_vane_normal.png` | forest, canyons, mountain, city |
| `textures/city_concrete_albedo.png` | city x3 |
| `textures/city_concrete_normal.png` | city x3 |

**Worst biome: forest at ~15.33 MB of a 24 MB budget**, as
`node tools/asset-check.mjs assets/` reports it. Every total below carries a
flat **+3.33 MB bird tax** that no biome can shed, because the bird is in all
four: feather_contour and feather_vane albedo at 1.33 MB each plus their 256
normals at 0.33 MB each. Split out rather than folded in, so a reader can see
which part of each number belongs to the world and which to the one object
that is always on screen.

| Biome | World | + bird | Reported | Made of |
|---|---|---|---|---|
| forest | 12.00 | 3.33 | **15.33** | own sky 2.67 + bark_pine albedo/normal at 2 uploads each (2.67 each) + stone_rock albedo/normal (1.33 each) + forest_ground_albedo 1.33 (forest_ground_normal is `none`) |
| mountain | 10.67 | 3.33 | **14.00** | own sky 2.67 + one bark_pine upload each (1.33 each) + granite albedo/normal (1.33 each) + snow albedo/normal (1.33 each) |
| city | 10.67 | 3.33 | **14.00** | own sky 2.67 + concrete albedo/normal at 3 uploads each (4.0 each) |
| canyons | 8.00 | 3.33 | **11.33** | own sky 2.67 + sandstone albedo/normal at 2 uploads each (2.67 each) |

Each biome now carries **its own sky only** (2.67 MB), not all four — that is
the dispose fix above, and it took ~8 MB off every row. The headroom is real
but it is **not budget to spend**: it exists because a leak was closed, and the
24 MB ceiling stays where it is. A session revisiting biomes must return to the
same resident set, which is what `tools/birb-textures.mjs` exists to assert.

**Watched fail, not assumed to fail**: temporarily charging a sky row to all
four biomes again pushes forest to 23.33 MB, and a `x2`/`x3` cell reverted to a
bare biome name undercounts exactly as the refuted version did; temporarily
listing every file under a single `forest` row pushes it to the full 32.67 MB
and `asset-check` goes red. All three move the number, which is how this table
is known to be load-bearing rather than decorative.

`bark_pine_rough.png` was delivered in the same commit and **is not here**: it spans
0.145 across 37 of 256 values, which the gate rejects as a constant wearing a
texture's filename, and `MeshLambertMaterial` — which is every tree material in
this game — has no `roughnessMap` slot to put it in anyway.

**Target** names the material and the slot the asset is for — `barkMat.map`, not "trees".
A slot the material class does not have is a silent no-op: `MeshLambertMaterial` has no
`roughnessMap`, and assigning one uploads a texture, perturbs the program cache key, and
samples nothing.

**World tile** is how many metres of surface one tile of the image depicts. `map.repeat`,
not the pixel count, is what sets on-screen density, and without this number nobody can
set it.

## Where things live

| Path | Contents |
|---|---|
| `assets/textures/` | Tiling material maps: albedo, normal, roughness, AO, packed ORM |
| `assets/env/` | Equirectangular sky/environment maps, 2:1, one per biome |
| `docs/realism/reference/` | Concept and reference imagery. **Evidence only — never imported by the running page.** |


## Cross-asset acceptance

`tools/asset-check.mjs` scores each file on its own and cannot see the scene.
Two of these albedos are graded browns whose means land 6.6 sRGB units apart —
structurally perfect, and the arch shipped looking like a wooden bridge. The
check that covers this lives in `tests/authored-textures.test.js`: it reads the
shipped PNGs, applies each material's tint, and asserts the two render far
apart with the stone the lighter. **Before accepting a new albedo, look at what
else is in the same frame**, not only at the file.
