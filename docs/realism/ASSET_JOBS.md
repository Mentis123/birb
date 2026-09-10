# Asset jobs — the running log

**The contract is [AUTHORED_ASSETS.md](AUTHORED_ASSETS.md). This is the job queue: what was commissioned, what came back, what it taught, and what is live now.**

One job at a time, each small enough to prove the pipeline before the next depends on it. That discipline has already paid: job 01 was three files and it found two defects in the gate and one in the contract.

---

## Job 01 — pine bark — **CLOSED, 2 of 3 accepted**

Delivered as `e20a04b` + `92ef620` on `codex/authored-bark-assets`. Shipped in `c01d7e4`.

**Accepted and live** behind `?bark=1`, dressing the forest landmark trunk and the fallen log:

| File | Why it passed |
|---|---|
| `bark_pine_albedo.png` | Seam ratio 1.25× against a 3 threshold; no interior repetition (top non-trivial autocorrelation lag r=0.391 at a 1% offset); quadrant luminance spread 2.5% against 18; linear albedo mean 0.130, a textbook dark-bark range |
| `bark_pine_normal.png` | Green-up/OpenGL, confirmed by correlating against its own albedo rather than by trusting the manifest; decoded vector length max **1.0058**, inside the 1.0068 ceiling 8-bit quantisation of a true unit vector can produce — exactly what a clean machine-derived field looks like |

Both files carry **zero ancillary PNG chunks** — no ICC profile, no gamma, no C2PA blob. And the worry about deriving a normal from albedo luminance measured dead: `corr(albedo saturation, normal tilt) = −0.006`. Colour is not being encoded as geometry. The multiscale derivation was the right call and it is measurable.

**Rejected:** `bark_pine_rough.png`. It spans **0.145 across 37 of 256 values** — a constant wearing a texture's filename. See the correction below, which makes it moot anyway.

**What it taught the gate** (all five now live, each with a watched-failing test):

- `roughnessRange` — a single-channel map must beat a scalar. This is the one that would have caught the delivery.
- `selfDuplication` — **mirror-tiling defeats the seam check and is worse than blind**: a mirror-tiled fake scores a seam ratio of *exactly 0*, a perfect result, better than the genuinely tileable bark's 1.25. Built one and watched the whole gate pass it.
- `normalConvention` — green-up vs green-down, decided against the sibling albedo. The flip changes no mean, no bias and no vector length, and renders as plausible material with every hollow lit as a ridge.
- `normalLength` — catches a map painted as an image rather than derived as a vector field.
- `ancillary` — an ICC profile makes the browser hand the GPU different pixels from the ones the tool measured, with no pixel in the file changed.

**And two things the wiring taught**, both of which are now your problem too:

`map` **multiplies** `color`. Keeping the procedural trunk colour landed it at 14% brightness — two albedos multiplied together. Setting it white measured **19%** of the procedural luminance in a real capture, which is precisely the defect that material's own source comment memorialises ("read as a black slab against the sky"). The tint had to be solved from the two means. **An albedo is not a drop-in replacement for a material colour.**

`map.repeat`, not the pixel count, sets on-screen density — and a `CylinderGeometry`'s UVs run 0..1 regardless of world size. **State the world tile size** in the manifest row or nobody can set it.

---

## The correction that changes every remaining job

> **Stop sending roughness, gloss, metalness and ORM maps. They have no consumer in this game.**

Every world prop material in `src/environment/spherical-world.js` is `MeshLambertMaterial` with `flatShading: true`. `MeshStandardMaterial` appears only on the backdrop shell, the drones and the rockets — never on a tree, rock, spire or building.

Verified twice against the pinned `three@0.183.2` source, and the first citation was bad, so here is the good one: `src/renderers/shaders/ShaderLib/**meshlambert.glsl.js**` — note the path, `meshlambert_frag.glsl.js` does not exist and the CDN returns a 100-byte "couldn't find the requested file" stub that greps as zero hits for anything you ask it. The real 3,253-byte file contains `roughness` **zero** times. Independently, `MeshLambertMaterial.js` declares exactly ten maps — `alphaMap aoMap bumpMap displacementMap emissiveMap envMap lightMap map normalMap specularMap` — and `roughnessMap` is not among them.

Assigning one uploads a texture, perturbs the program cache key into a fresh compile that produces an identical shader, and samples nothing.

**So every future material request is `_albedo` + `_normal` only.** That is not a downgrade — it halves the file count and the memory for the same visible result, until and unless the props move to a Standard material, which is a rendering decision nobody has taken.

---

## Job 02 — four biome environment maps — **LIVE, this is the next one**

The highest-value asset in the whole programme, and the premise is verified rather than assumed.

**The consumer is real.** `WebGLPrograms.js:54` reads:

```js
const environment = ( material.isMeshStandardMaterial || material.isMeshLambertMaterial
                   || material.isMeshPhongMaterial ) ? scene.environment : null;
```

`isMeshLambertMaterial` is named explicitly, and `meshlambert.glsl.js` includes `envmap_physical_pars_fragment` — the PMREM path. So a single `scene.environment` reaches **every prop in the world at once**: trees, rocks, spires, buildings, the lot. Nothing else on the list touches that many pixels for one texture.

Today `scene.environment` is `null` and `PMREMGenerator` appears nowhere. There is no image-based lighting in this game at all.

### Deliver

| File | Size | Notes |
|---|---|---|
| `assets/env/forest_sky.png` | 1024×512 | 2:1 equirectangular, RGB |
| `assets/env/canyons_sky.png` | 1024×512 | note the spelling — **canyons**, not canyon |
| `assets/env/mountain_sky.png` | 1024×512 | |
| `assets/env/city_sky.png` | 1024×512 | |

Only one is resident at a time (2.67 MB decoded with mips), so the set is comfortably inside the 24 MB resident budget.

### Match the sky the player is actually looking at

The game draws its own gradient sky dome. If the environment map disagrees with it, reflections will contradict the background and read as a bug. These are the shipped values — match them.

| Biome | Zenith | Mid | Horizon | Below horizon | Fog |
|---|---|---|---|---|---|
| forest | `#397da7` | `#91bdb9` | `#ffe0a1` | `#3c665d` | `#0a1b2e` |
| canyons | `#756eaa` | `#dca68e` | `#ffd4a1` | `#644959` | `#2b150f` |
| mountain | `#3d74ad` | `#9dc0d4` | `#e3d3ae` | `#44637e` | `#0f1f2f` |
| city | `#283a75` | `#748da9` | `#e5b7a0` | `#283c55` | `#0b1524` |

City is dusk on purpose — a lit window only reads against a dark street. Do not brighten it.

### The sun

All four biomes put the key light at **41–47° above the horizon**, azimuth ~52–55°. Put the warm brightening of the sky in that quadrant so the ambient light has a direction.

**Do not paint a sun disc.** The game already draws its own HDR sun disc on the dome at about five times its true angular size, and a second one baked into the reflections would disagree with it. What the map supplies is *directional ambient and a horizon* — the punchy specular comes from the existing key light.

Be aware this is 8-bit LDR, so it cannot carry real sun energy, and that is fine: it is doing the job a sky dome does, not the job a light does. Do not try to fake HDR by clipping a white blob into it.

### Azimuth and strength are fixable here, so do not agonise

`scene.environmentRotation` (an `Euler`) and `scene.environmentIntensity` both exist in 0.183.2. If the bright quadrant lands at the wrong bearing, one rotation fixes it at wiring time; if the whole thing is too strong, one scalar does. Get the *vertical* structure and the colours right — those are the parts a rotation cannot repair.

### Acceptance

```
node tools/asset-check.mjs assets/env/
```

The `sky` kind checks three things: the 2:1 aspect, the ancillary chunks, and — added for this job — the **longitude wrap**. The left and right edges of an equirectangular map are the same meridian, so a discontinuity there is a vertical seam standing in the sky and in every reflection of it. The **poles are not checked**: top and bottom rows legitimately differ, and a check that failed that would be wrong. As always the tool says **nothing** about whether it looks like sky — that is an eye on a real phone.

Return the four files, the tool output, and the `assets/MANIFEST.md` rows with **target** (`scene.environment`) and **world tile** (`n/a — equirectangular`) filled in.

---

## The queue after that, re-costed with the roughness correction applied

| # | Job | Files | Resident cost | Why it is here |
|---|---|---:|---:|---|
| 03 | Forest ground and rock: `forest_soil`, `forest_rock`, `forest_litter`, `river_gravel` | 8 | 10.7 MB | The first production scene is a forest river valley and its terrain is flat-shaded noise with a tint |
| 04 | `foliage_needle` — albedo **with alpha**, RGBA | 1 | 1.3 MB | The hero tree's canopy. First cut-out asset, so the gate needs an alpha-coverage check written before it lands, not after |
| 05 | `feather_wing_normal` — detail map for the bird | 1 | 1.3 MB | A detail map riding on the existing blue/cyan, **not** a colour map. The blue/cyan identity is a fixed decision; do not repaint the bird |
| 06 | Reference imagery — concept boards, geology, plumage, a lighting key | — | 0 | Committed to `docs/realism/reference/` where **nothing imports it**. Evidence, never a runtime dependency. This is also the missing half of the whole programme: there is currently no reference image of anything being aimed at |

Note what dropped out: item 03 was twelve files and is now eight; every `_rough` in the original list is gone.

**Job 06 is more valuable than its position suggests.** `/sculpture` solved a likeness problem in this repo with matched photographs and a rubric committed *before* the work. This programme has neither, and every art stage currently accepts against a memory. If you have capacity beyond job 02, that is the one to volunteer for.

---

## Standing rules, short form

1. **Generated from scratch or licensed for redistribution.** Public repo, used to teach.
2. **Baked offline, committed as the final runtime file.** No build step, no bundler, no asset pipeline at deploy.
3. **Root Birb only.** `/gauntlet`, `/sculpture`, `/icon3d` and `/AR` ship zero external assets by their own rules.
4. **Powers of two**, correct suffix, correct colour space by suffix — albedo sRGB, everything else linear data.
5. **A manifest row per file**, with target slot and world tile size.
6. **The gate is `node tools/asset-check.mjs`.** If a check fires, regenerate rather than arguing with the threshold. If a threshold is genuinely wrong for a legitimate texture, say so with the numbers — but changing one to make an asset pass, rather than because the threshold was wrong, is how this gate becomes decoration.
