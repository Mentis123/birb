# Authored assets: a brief for an external image/asset agent

**Audience: an external generation agent (Codex with an image model, or equivalent) and whoever integrates what it returns.**

[The decision report](README.md) permits this and bounds it:

> Allow authored meshes and a small compressed texture set for root Birb. Retain procedural placement. Offline authoring/baking is allowed; the shipped site can remain static with no runtime build framework. This does not amend the independent zero-asset rules of `/sculpture`.

[The build handoff](BUILD_BACKLOG.md) then asks, under R1–R4, for the thing this document is:

> Define the asset contract: units/scale, forward/up axes, bone names, material slots, LOD bounds, texture color spaces, encoded and decoded sizes, license/source and disposal.

So: this is the contract, the ranked shopping list, and the acceptance gate. An asset that satisfies it can be dropped into `assets/` and wired up. One that does not is not a near miss — it is a texture that will look wrong on a phone in a way nobody can point at.

---

## 0. Read this first: what the game currently is

These are measured facts about the code as it stands, not impressions. They are why the list in §2 is ordered the way it is.

| Fact | Consequence |
|---|---|
| `TextureLoader` appears **zero** times in `index.html` and `src/`. | Nothing in the game loads an image today. There is no established loader path to copy; §5 defines one. |
| `scene.environment` and `PMREMGenerator` appear **zero** times. | Every material is lit by two lights and nothing else. There is no image-based lighting at all — which is why an environment map is item 1 and not item 4. |
| All 12 textures in `src/` are `CanvasTexture` or `DataTexture` — drawn in code at boot. | Surfaces have colour and gradient but no *structure*. Bark is a brown cylinder. Rock is a grey facet. |
| `birb.glb` (1.7 MB) exists and loads only behind `?glb=1`. | The A/B pattern in §5 is not invented for this brief; it is already the house pattern for an authored asset. |
| Materials are `MeshLambertMaterial` / `MeshStandardMaterial`, flat-shaded, tone-mapped `NeutralToneMapping`. | Roughness and normal maps have somewhere to go. Anything relying on clearcoat, transmission or sheen does not. |

The research's conclusion, which this brief exists to act on, is that pushing every existing slider is a stress test and not an upgrade: **the next real gain is in representation, and the repo currently has none to offer.**

---

## 1. Scope, and the parts of the repo this does NOT touch

**In scope: root Birb only.** That is `/` — `index.html`, `src/`, and a new `assets/` directory.

**Out of scope, and this is a hard line:** `/gauntlet`, `/sculpture`, `/icon3d` (`/svg`) and `/AR` each ship **zero external assets** by their own rule, and each rule is load-bearing for a different reason (offline QR encoding, the "every proportion is a number in a table" workflow, airtightness against the parent). Do not add an image to any of them, and do not import anything from `assets/` into them.

**Also out of scope:** anything that requires a build step. This repo has no bundler, no transpiler and no asset pipeline that runs at deploy. Whatever is generated is **baked offline and committed as the final runtime file**.

---

## 2. What to generate, most valuable first

Ranked by how much of the gap in §0 each one closes. Do them in order; item 1 alone changes every material in the game.

### 1. An environment map for image-based lighting — the single highest-value asset

**Deliver:** one equirectangular HDR-ish sky per biome, 2:1, 1024×512, PNG.
`assets/env/forest_sky.png`, `canyons_sky.png`, `mountain_sky.png`, `city_sky.png`.

Every `MeshStandardMaterial` in the game currently reflects nothing, because there is nothing to reflect. A PMREM-prefiltered environment gives the whole world sky-coloured ambient occlusion-ish falloff, a horizon in every wet surface, and a rim on the bird for free — at the cost of one texture and one prefilter at environment-switch time (never per frame; see §5).

Match the biome's existing sky, which the game already draws as a gradient dome. Forest, for example, is: zenith `#397da7`, mid `#91bdb9`, horizon `#ffe0a1`, below-horizon `#3c665d`, key light `#ffdfab` from up-and-right. Do not invent a new sky — this map must agree with the dome the player is actually looking at, or reflections will disagree with the background and read as a bug.

### 2. Ground and rock materials for the forest river slice

The first production scene is a forest river valley. Terrain is flat-shaded noise with a per-biome procedural tint and nothing else.

**Deliver, tileable, 512×512, as albedo + normal + roughness triples:**

| Set | Used for |
|---|---|
| `forest_soil` | valley floor, riverbank |
| `forest_rock` | exposed faces, boulders, the waterfall lip |
| `forest_litter` | leaf/needle debris under the canopy |
| `river_gravel` | the wet bed, seen through water |

### 3. Bark and foliage for the hero tree

**Deliver:** `bark_pine` (albedo + normal + roughness, 512²) and `foliage_needle` (albedo **with alpha**, 512², RGBA).

The hero tree is a perch the camera sits *on*. It is the one surface a player looks at from 30 cm of virtual distance, and it is currently a smooth cone.

### 4. Feather detail for the bird

**Deliver:** `feather_wing_normal` and `feather_wing_rough`, 512², tileable along the feather axis.

This is a detail map that rides on top of the bird's existing blue/cyan colour — **not** a colour map. The blue/cyan identity is a fixed decision; do not repaint the bird.

### 5. Non-shipping reference imagery

Concept boards, geology reference, plumage reference, a lighting key. Enormously useful, and **committed under `docs/realism/reference/` where nothing imports it**. This is the `/sculpture` convention: reference is evidence, never a runtime dependency.

---

## 3. The asset contract

### Textures

| Property | Value |
|---|---|
| Format | PNG, 8-bit, colour type 2 (RGB) or 6 (RGBA). No 16-bit, no palette, no interlace. |
| Dimensions | **Powers of two.** 512×512 for material maps, 1024×512 for equirectangular skies. |
| Tiling | Material maps must tile seamlessly on **both** axes. Skies wrap horizontally only. |
| Colour space | Albedo is **sRGB**. Normal, roughness, metalness, AO, height are **linear data** — they are numbers, not pictures. The PNG cannot say which; the *filename suffix* does, and the loader in §5 sets it from that. |
| Naming | `<subject>_<channel>.png`, lowercase, underscores. Channels: `_albedo`, `_normal`, `_rough`, `_ao`, `_metal`, `_orm` (packed), `_sky`. |
| Alpha | Only where cut-out is needed (foliage). Everything else is RGB. |
| Location | `assets/textures/` for material maps, `assets/env/` for skies. |
| **World tile size** | State it. A texture is not "512 pixels", it is "a 4-metre patch of bark at 512 pixels" — and `map.repeat`, not the resolution, is what sets on-screen density. Record the intended metres-per-tile in `assets/MANIFEST.md`; without it nobody, including the generating agent, knows what the image depicts. |
| Decoded budget | **24 MB RESIDENT**, RGBA8 with mips — what is live on the GPU at one moment, not what exists in the repo. A 512² map is 1.33 MB; a 1024×512 sky is 2.67 MB. That is the real constraint; the download is not. |

**Packed maps.** `_orm` means occlusion in R, roughness in G, metalness in B, which saves two texture units. It is accepted, and the gate checks the one thing that goes wrong: an agent returning a greyscale image and calling it ORM, which silently loses two of the three maps. `_ao` and `_metal` are a separate kind (`mask`) from `_rough`, because occlusion on a convex surface and metalness on a dielectric are *legitimately* near-constant and must not trip the dynamic-range check that roughness has to pass.

**Why the budget is resident and not cumulative.** The ranked list in §2 comes to **34.67 MB** if every map is live at once — four skies 10.67, twelve ground maps 16.00, bark 4.00, foliage 1.33, feather 2.67 — which is 10.67 MB *over* the stated ceiling. One biome's working set is **13.33 MB** and fits with room to spare. So the list is affordable only if `setEnvironment()` **disposes the outgoing biome's textures**, which is what turns disposal from hygiene into a gate. If disposal is not implemented, the ranked list is not affordable and the honest move is to cut it, not to raise the number.

### Meshes (if any are requested later)

| Property | Value |
|---|---|
| Format | `.glb`, glTF 2.0 binary, Draco **off** (no decoder is loaded) |
| Units | Metres. The planet is radius **120**; terrain carves down to **−46** at its deepest; forest trees stand **14–58** tall; the bird is about **2** long. |
| Axes | glTF convention: **+Y up, −Z forward.** `birb.glb` already faces −Z and `positionBirbModel(model, true)` compensates. Match it. |
| Origin | At the contact point (feet for the bird, base for a tree), not the bounding-box centre. |
| Materials | `MeshStandardMaterial`-compatible: baseColor, normal, roughness/metalness. No transmission, no clearcoat, no sheen. |
| LODs | Three, named `_lod0/1/2`, roughly 100% / 40% / 15% triangles. |
| Budget | The whole scene holds **<100 draw calls and <80k triangles**. A hero asset that spends 20k of that must earn it in a phone view. |

### Provenance

Every asset gets a row in `assets/MANIFEST.md`: file, what generated it (model and prompt, or the tool), licence, and the commit that introduced it. **Generated-from-scratch only** — do not return anything derived from a photograph, a scan, or another artist's texture that you cannot licence. This is a public repo used to teach.

---

## 4. The five ways this goes wrong

Each of these produces a file that opens fine, looks fine in isolation, and is wrong in the game.

1. **Lighting baked into the albedo.** Image models love to return a lit, shaded, three-quarter-lit render of a material. An albedo is the material's colour with the light *removed*. A baked highlight fights the renderer's own key light, and the symptom is not "the texture is wrong" — it is a vague "the materials look off" that survives ten rounds of tuning. **Ask for flat, evenly lit, ambient-only, no cast shadows, no directional highlight.**
2. **It does not tile.** A seam is invisible in a thumbnail and repeats every few metres on a hillside, which is the single most recognisable tell of a generated texture.
3. **A height field labelled as a normal map.** A tangent-space normal map is mostly pale blue (`~128, 128, 255`). If it is grey, it is a bump/height image and the renderer will read its red channel as an X slope and tilt the entire surface.
4. **A "roughness map" that is a colour picture.** Roughness carries one channel. Colour in it means the generator returned an image of a rough thing rather than a map of how rough it is.
5. **Wrong colour space.** Albedo decoded as linear comes out washed and pale; a normal map decoded as sRGB has every slope quietly wrong and the lighting subtly detaches from the geometry. This one never announces itself.

Items 1–4 are caught mechanically by §6. Item 5 is caught by the loader convention in §5.

---

## 5. How an accepted asset gets wired in

For whoever integrates, not the generating agent. Every one of these is a defect this repo has already paid for once.

- **`sw.js` `CORE_ASSETS` or it breaks offline.** A file the game fetches that the service worker does not know about is a blank page on the second, offline visit. Add it, bump `CACHE_VERSION`, and bump `index.html`'s `BIRB_BUILD` **in the same commit** — `tests/build-identity.test.js` enforces that they match.
  Large optional assets may instead be left out of `CORE_ASSETS` deliberately and picked up by the runtime cache, exactly as `birb.glb` is. Say which, in the comment, and why.
- **Behind an explicit switch, with a procedural fallback.** Follow `?glb=1`: the procedural version is built first and unconditionally, the authored one replaces it on successful load, and a failure `console.warn`s and leaves the game playable. First-load fallback must remain playable if the hero asset has not loaded.
- **Colour space is set by the loader, from the suffix.** `_albedo` → `THREE.SRGBColorSpace`. Everything else → `THREE.NoColorSpace`. Do not rely on a default.
- **`wrapS = wrapT = RepeatWrapping`, `generateMipmaps = true`, `anisotropy` from `renderer.capabilities.getMaxAnisotropy()`.**
- **PMREM once, never per frame.** Prefilter the environment map inside `setEnvironment()`, `dispose()` the generator and the source texture immediately, and keep the resulting cubemap on `scene.environment`. The backlog names per-frame PMREM generation explicitly as a thing not to do.
- **Every texture gets a disposal path.** `setEnvironment()` switches worlds; a texture created there and not disposed is leaked once per switch.
- **Re-run the existing gates.** `npm test`, `node tools/birb-shaders.mjs`, `node tools/birb-modes.mjs` (warnings are failures), `node tools/birb-quality.mjs --check all`, and the plain-start browser-health path. A rendering world is not a working world.

---

## 6. Acceptance

```
node tools/asset-check.mjs assets/textures/          # sweeps a directory, recursively
node tools/asset-check.mjs assets/env/dusk_sky.png --kind sky
node tools/asset-check.mjs assets/ --json            # machine-readable
```

Exit 0 means accepted, non-zero means rejected with a named reason. Zero dependencies — it parses PNG with Node's own `zlib`, because this repo installs nothing to run its checks.

It checks:

| Check | Applies to | Rejects when |
|---|---|---|
| Power-of-two dimensions | all | not POT — a repeating texture cannot be mipped, and unmipped ground aliases into noise |
| Wrap seam vs. the steepest ordinary transition in the image | albedo, normal, roughness, packed | seam > **3×** the 90th-percentile interior step |
| Quadrant luminance spread | albedo | spread > **18%** of the mean — lighting is baked in |
| Mean RGB near (128, 128, >200) | normal | blue too low (a height field), or R/G biased off centre by >24 |
| Channel divergence | roughness, AO, metal | > 3 — it is not single-channel |
| Channel divergence | packed (`_orm`) | ≤ 3 — it is greyscale, so two of the three maps are lost |
| Aspect | sky | not 2:1 |
| **Dynamic range** (p1–p99 of G) | roughness, gloss | span < **0.20** — a map with no range is a constant that costs a texture unit; `material.roughness = x` costs neither. `_ao`/`_metal` are exempt by kind |
| **Self-duplication** vs unrelated regions | albedo, normal, roughness, packed | any half/quarter shift or mirror scoring < **0.12** of the baseline |
| **Normal convention** vs the sibling albedo | normal | `rG ≤ −0.30` (green-down/DirectX) or `rR ≥ +0.30` (X inverted). Abstains below \|0.30\| rather than guessing |
| **Decoded vector length** | normal | more than 0.25% of texels longer than **1.015**, which 8-bit quantisation of a unit vector cannot produce (worst honest case 1.0068) |
| **Ancillary PNG chunks** | all | `iCCP`, `cHRM`, a non-sRGB `gAMA`, or any `gAMA`/`sRGB` on a data map |
| Decoded size with mips | the resident set | total > 24 MB |

**What it deliberately does not check: whether the rock looks like rock.** No model tier can score that, so it is an owner's eye on a real device, and no green gate substitutes for it. The tool prints that caveat on every successful run so nobody forgets.

The thresholds are not decoration. `tests/asset-check.test.js` builds a texture that violates each one and asserts the corresponding check rejects it, plus it decodes `icons/icon-512.png` — a real PNG this repo generated by another route — and confirms the two checks a vertical gradient *should* fail are the two that fire. A gate nobody has watched fail is not a gate.

### What the first delivery taught the gate

The pine bark set of §7 arrived, passed the original gate with margin, and was right about almost everything — it tiles (seam 1.25× against a 3 threshold), it is genuinely unlit (2.5% quadrant spread against 18), its normal map is green-up and unit-length, and it carries no ancillary chunks at all. Two things came out of reviewing it, and both are now checks.

**A roughness map with no range walked straight through.** It spanned 0.145 across 37 of 256 values. Under this game's light rig that moves the brightest specular pixel by under three code values, and this repo's own recorded floor is that a ~0.1 per-channel difference is "measurably present, visually absent". Nothing in the gate measured range. Now `roughnessRange` does.

**Mirror-tiling defeats the seam check completely, and it is worse than blind.** A mirror-tiled fake — the cheap way to make anything seamless — scores a seam ratio of **exactly 0**, a *perfect* result, better than the genuinely tileable bark's 1.25. Verified by building one and watching the whole gate pass it. `selfDuplication` closes that.

**One hole is known and still open**, recorded rather than papered over: border-smearing, where a texture that does not tile is cross-faded at its edges so the wrap matches. It was reported as scoring 0.75 and passing. Three separate constructions were tried against this gate and all three were still caught (5.93, 11.71, 13.25), so it is **unreproduced here** — but no detector separates smeared from natural borders either (ring-vs-interior gradient energy interleaves the two), so nothing is claimed. Treat a suspiciously perfect seam score as a reason to look, not as a pass.

**And one defect the gate found in its own test fixtures.** `selfDuplication` failed the suite's "good" textures on first run, correctly: their generating field used only even harmonics, which makes it bit-identical to itself under a half-width shift — verified at a maximum difference of 0.0000000000. Every "good" fixture was a 128px texture stored at 256. A check that finds a real bug in the harness it is graded by is a check worth having.

---

## 7. The first job

Do not generate the whole list. Generate **one set** and put it through the gate, so the pipeline is proven before items 2–4 depend on it:

```
assets/textures/bark_pine_albedo.png     512x512  RGB   tileable, unlit, sRGB
assets/textures/bark_pine_normal.png     512x512  RGB   tileable, tangent-space, linear
assets/textures/bark_pine_rough.png      512x512  RGB   tileable, greyscale, linear
```

Pine bark: grey-brown plates with deep vertical fissures, matching a forest floor of `#123324` under a warm `#ffdfab` key. Weathered, not stylised, not lit.

Then:

```
node tools/asset-check.mjs assets/textures/
```

Return the three files, the tool's output, and the `assets/MANIFEST.md` rows. If any check fails, the message names what to change; regenerate rather than arguing with the threshold. If a threshold is genuinely wrong for a legitimate texture, say so with the numbers — but changing a threshold to make an asset pass, rather than because the threshold was wrong, is how this gate becomes decoration.
