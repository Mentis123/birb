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

## Job 02 — four biome environment maps — **CANCELLED, and here is the measurement that killed it**

**Do not make these. The work was proved with a procedural map first, and it does not pay.**

The premise held: `scene.environment` really does reach every prop. `WebGLPrograms.js:54` names `isMeshLambertMaterial` explicitly, and `meshlambert.glsl.js` includes `envmap_physical_pars_fragment`. The path was built (`src/environment/sky-environment.js`, `?ibl=1`), it runs with **zero console errors or warnings**, and it costs **no measurable draw calls** — 82–84 with it on or off, inside frame-to-frame variance.

Then it was measured, with the world seed, sun, tier, pose and drones all pinned so the frames were actually comparable:

| Environment | Frame luminance | vs no IBL |
|---|---:|---:|
| none (shipping) | 0.0489 | — |
| the real four-stop sky gradient | 0.0861 | **1.759×** |
| a **flat grey**, no gradient at all | 0.0854 | **1.746×** |

**A flat grey and the real sky are 0.7% apart.** The shape of the map does not matter, and there is a structural reason rather than a tuning one: `lights_lambert_pars_fragment.glsl.js` defines only `RE_Direct` and `RE_IndirectDiffuse`. There is **no `RE_IndirectSpecular`**. Lambert takes IBL as diffuse irradiance only — the cosine-weighted integral of the whole sky — which is low-frequency by construction. Clouds, structure and detail integrate away before they reach a single pixel.

So four authored 1024×512 maps would cost 10.67 MB of repository and buy a difference measured at **0.7%** on every tree, rock, spire and building in the game. The four gradients the game already computes give the same lighting for nothing, which is what the module now does.

Two things that *did* come out of it, and they are worth more than the maps would have been:

- **IBL is a +76% ambient lift**, so switching it on needs the hemisphere ambient (currently 1.12 in forest) cut by roughly 43% to hold the exposure. That rebalance is a lighting decision for the owner's eye, not an asset.
- **An authored sky would still matter for `MeshStandardMaterial`** — the backdrop shell, the drones, the rockets — because those *do* evaluate indirect specular. That is a much smaller and more specific case than "the highest-value asset in the programme", and it should be argued on its own merits when something in that set actually needs it.

The general lesson, and the reason this was worth two hours: **prove the consumer before commissioning the asset.** This is the second time on this track — the first was a roughness map for a material class with no roughness slot.

---

## Job 03 — reference imagery and the acceptance rubric — **LIVE, and it needs no code at all**

**This is the job with the highest value and the lowest risk on the whole list, and it is the one thing here an image model is unambiguously the right tool for.**

`docs/realism/` contains six documents and five PNGs of the **current** build. There is no reference image of a bluebird, a forest river, or any look this programme is aiming at. Every art stage therefore accepts against a memory, which is exactly the failure `/sculpture` records twice in this repo: *green gate, worse render*.

`/sculpture` solved it with matched photographs, a side-by-side compositor, and `LIKENESS.md` — 41 binary checks committed **before** the work, each citing the image that settles it. This programme has neither half.

**Deliver into `docs/realism/reference/`** — evidence only, never imported by the running page, so no format or budget rules apply beyond "readable":

| File | What it has to settle |
|---|---|
| `bird-*.jpg/png` (4–6) | Real bluebird plumage, wing structure in flight and folded, foot/perch contact, head shape. The blue/cyan identity is fixed; this is about *anatomy and feather structure*, not recolouring |
| `forest-river-*.jpg/png` (4–6) | The first production scene: a forest river valley, canopy-to-water, bank geology, how light falls through a canopy |
| `bark-and-ground-*.jpg/png` (3–4) | Pine bark at reading distance, forest floor litter, wet river gravel, exposed rock |
| `lighting-key-*.jpg/png` (2–3) | The time of day and mood being aimed at, one per biome where they differ |

**And the rubric, `docs/realism/LIKENESS_BIRB.md`:** 20–30 **binary** checks, each citing the reference image that settles it, in `/sculpture`'s exact form. *"The wing has visible primary/secondary separation at chase distance — ref bird-03"*, not *"the wings look good"*. Written **before** the art it judges, so it cannot be negotiated afterwards by the person who just spent three weeks on it.

If you do nothing else on this list, do this one.

---

## Job 04 — stone for the landmark arch — **LIVE, small, and the consumer is proven**

Deliberately shaped like the bark job, because that pattern is now known to work end to end.

**Deliver:** `assets/textures/stone_rock_albedo.png` and `stone_rock_normal.png`, 512², tileable, unlit, RGB.

**Target:** `stoneMat` — a plain `MeshLambertMaterial` on the canyon landmark's stone arch, `TorusGeometry(13, 2.4, 6, 14, PI)`. Current colour `#6b6257`, a flat grey-brown.

**World tile: 4.3 units square**, the same as the bark, so the two read at one scale. That solves to `repeat (9, 4)` on that torus — arc length is π×13 = 40.8 units, tube circumference 2π×2.4 = 15.1 — giving a 4.5 × 3.8 tile. Put the number in the manifest row; the integrator sets the repeat.

Weathered sandstone to match the canyons: warm grey-brown, bedding planes, wind-scour. Unlit, no baked ambient occlusion beyond what the material itself has, no directional highlight.

---

## Why the forest GROUND is not on this list yet

The earlier draft of this file had "forest ground and rock, 8 files" as the next job. It is deferred, and the reason is worth writing down because it is the third instance of the same mistake.

The terrain is a `SphereGeometry` of radius 120 with `MeshLambertMaterial`. Its UVs run once around the whole planet:

- **0.68 texels per world unit** at 512², which is unusable. A 4-unit tile would need `repeat (188, 94)`.
- **Every u converges at both poles**, so any texture smears into a singularity at each — twice visible on a planet you fly all over.

A ground texture needs a **triplanar projection** first — a shader injection costing three samples per pixel, on the single largest surface in the game, on a phone. That is a rendering decision with a real fill-rate cost, not an asset. The good news is that `ground-detail.js` composes multiplicatively (`outgoingLight *= gdTint`), so a `map` would survive alongside it once the projection exists.

**Commission the ground the day the projection lands, not before.** The pattern by now is unmistakable: a roughness map for a material class with no roughness slot, four sky maps whose detail integrates away, and very nearly a ground texture for UVs that cannot carry it. **Prove the consumer before making the asset.**

---

## Standing rules, short form

1. **Generated from scratch or licensed for redistribution.** Public repo, used to teach.
2. **Baked offline, committed as the final runtime file.** No build step, no bundler, no asset pipeline at deploy.
3. **Root Birb only.** `/gauntlet`, `/sculpture`, `/icon3d` and `/AR` ship zero external assets by their own rules.
4. **Powers of two**, correct suffix, correct colour space by suffix — albedo sRGB, everything else linear data.
5. **A manifest row per file**, with target slot and world tile size.
6. **The gate is `node tools/asset-check.mjs`.** If a check fires, regenerate rather than arguing with the threshold. If a threshold is genuinely wrong for a legitimate texture, say so with the numbers — but changing one to make an asset pass, rather than because the threshold was wrong, is how this gate becomes decoration.
