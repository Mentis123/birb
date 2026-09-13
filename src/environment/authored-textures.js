/**
 * authored-textures.js — the loader for `assets/`, and the first one this repo
 * has ever had.
 *
 * Nothing in Birb Mobile loaded an image before this file: every texture in
 * `src/` is a CanvasTexture or DataTexture drawn in code at boot, and there was
 * no `TextureLoader` call anywhere in `index.html` or `src/`. So the
 * conventions below are not a port of an existing path — they are the path, and
 * each line of them is a defect somebody would otherwise pay for once.
 *
 * THREE is INJECTED rather than imported so this module is unit-testable
 * against a fake: `src/environment/spherical-world.js` imports three from a CDN
 * URL, which `node --test` cannot resolve, and that is exactly why six other
 * things in this repo have no Node oracle.
 *
 * Gated behind `?bark=1`, following `?glb=1`: the procedural material is built
 * first and unconditionally, the authored one replaces it on a successful load,
 * and a failure warns and leaves the game playable.
 */

/**
 * Colour space is decided by the FILENAME SUFFIX, never by a default.
 *
 * An albedo is a picture and must decode as sRGB. A normal map is DATA — three
 * numbers packed into three channels — and decoding it as sRGB silently bends
 * every slope, which detaches the lighting from the geometry in a way that
 * never announces itself. Getting this backwards is the classic silent bug and
 * it is why `assets/MANIFEST.md` requires the suffix in the filename.
 */
export function colorSpaceFor(filename, THREE) {
  return /_albedo|_basecolor|_color|_colour|_diff/i.test(filename)
    ? THREE.SRGBColorSpace
    : THREE.NoColorSpace;
}

/**
 * How many times a map repeats over one mesh, solved from the geometry rather
 * than guessed.
 *
 * `map.repeat` — not the pixel count — is what sets on-screen texel density,
 * and a CylinderGeometry's UVs run 0..1 around the circumference and 0..1 up
 * the height regardless of the mesh's world size. So the same map on the
 * 88-unit landmark trunk and on a 34-unit log needs different numbers, and a
 * SQUARE tile is the only target that does not smear.
 */
export function repeatForCylinder(circumference, height, tileMetres) {
  return {
    x: Math.max(1, Math.round(circumference / tileMetres)),
    y: Math.max(1, Math.round(height / tileMetres)),
  };
}

/**
 * The bark tile is 4.3 units square, and that number was solved, not chosen.
 *
 * The forest landmark tree hosts a nest 8.5 units out along a bough where the
 * trunk radius is 5.53, so the perch camera sits ~2.97 units from a bark face —
 * and `hostObject: null` is set on that nest deliberately so the host is NOT
 * hidden while the player is sitting in it. At 3 units on a 60-degree portrait
 * view, one world unit spans ~115 CSS px. A 512 map across the trunk's
 * 34.7-unit circumference is 14.7 texels per unit, so one texel would cover
 * about 8 x 20 CSS pixels — a blur, and an anisotropic one. Landing near one
 * texel per pixel wants a tile of roughly 4.3 units.
 */
export const BARK_TILE_METRES = 4.3;

/**
 * Linear-space multiplier that lands the textured trunk on the procedural
 * material's own tone. Derived in applyAuthoredBark's header; setRGB defaults
 * to the linear working space, so these are linear values, not sRGB.
 */
export const BARK_TINT = Object.freeze({ r: 1.78, g: 1.05, b: 0.51 });

/**
 * The same bark file, tinted for the MOUNTAIN's pines. No new asset, no new
 * download -- bark_pine_albedo is already in the service worker's core cache.
 *
 * Solved rather than picked, and NOT by reproducing the procedural colour the
 * way the forest's was. `pineTrunkMat` is 0x33422f, a dark cold green, and
 * reproducing it exactly lands the textured trunk at luminance 0.048 against
 * the forest trunk's 0.162 -- three times darker, which is the black-slab
 * defect this repo keeps paying for, arriving by yet another route.
 *
 * So the target is #7a7264: luminance 0.171, within 6% of the forest trunk, so
 * it cannot read as a hole -- but desaturated and cool, so the mountain keeps
 * its own palette instead of borrowing the forest's brown. The ratio to the
 * albedo's mean is (1.222, 1.301, 1.128), and nothing clips.
 */
export const PINE_BARK_TINT = Object.freeze({ r: 1.222, g: 1.301, b: 1.128 });

/**
 * Four more authored albedos, on the canyon spires, the mountain peaks and
 * snow caps, and the city facades. Same rule as every tint above: `map`
 * MULTIPLIES `color`, so a tint is the quotient of a STATED target and the
 * file's own measured linear mean, never picked by eye. The full derivation
 * — clipping ceilings, the black-slab check, the same-frame separation
 * numbers — lives in `tests/authored-tints.test.js`, which is the oracle
 * these six constants exist to satisfy; this comment gives the short form.
 *
 * CANYON_TINT — target #a05a34, a warm rust-sandstone. Keeps the current
 * spire's VALUE (the canyon floor is the same sandstone, so the spires must
 * not visually darken against it) while dropping its saturation from a
 * poster-paint 15:3.4:1 to a sandstone 9:2.8:1. Solved against
 * canyon_sandstone_albedo's measured mean and the spire's own baked 4-band
 * vertical gradient (bakeVerticalGradient in spherical-world.js ~1992).
 *
 * CANYON_DARK_SPIRE_SCALE — one tint, two spire materials. darkSpireMat
 * (0x763923) and spireMat (0x99502e) are the same rock at two procedural
 * values so the ridges don't read as one cloned cone; a single absolute
 * tint on both would erase that. The scale is darkSpireMat's linear luma
 * over spireMat's own, applied to CANYON_TINT for the dark bucket only.
 *
 * GRANITE_TINT — REVISED. The first solve (target #7f899d, forced to 1.73x
 * the procedural peak's own luminance) was refuted: a real in-game capture at
 * a pinned pose measured the snow cap losing 39% of its contrast against the
 * granite it sits on (78.8 sRGB units against a 128.4-unit floor with either
 * texture disabled), because lifting the peak that far pulls it up TOWARD the
 * snow rather than staying beneath it — snow cannot compensate by getting
 * brighter, it is already at its own clipping ceiling (see SNOW_TINT below).
 * A 60-unit separation from the mountain's pine bark is real but the wrong
 * thing to solve for: the pine sits 40+ altitude-units below the peaks and is
 * rarely in the same frame, while the snow cap physically sits ON the granite
 * in every frame that shows either.
 *
 * So this is now a target NEARER stoneMat's own value (#5c6372, close kin of
 * the procedural 0x646c7c) rather than brighter than it: 0.867x the peak's
 * own procedural luminance, comfortably inside the black-slab floor (0.6x)
 * and the new granite ceiling (1.3x — a peak may not be lifted far enough to
 * threaten the cap it carries). That recovers
 * `luma(snowCap)/luma(granitePeak)` to 2.36x its OWN procedural ratio's 81%
 * (was 40%) — see tests/authored-textures.test.js (`the snow cap does not lose its
 * contrast ratio against the granite peak`), the oracle this stage owns, and
 * the re-pinned solve in tests/authored-tints.test.js.
 *
 * SNOW_TINT — not solved from a target colour at all. mountain_snow_albedo's
 * own histogram (98.5th percentile at 1.55x its mean) means no tint can push
 * the mean past ~0.646 linear without blowing the 1.5% clipping budget, so
 * this is that ceiling — half of snowMat's own cool cast (0xe6f1ff), scaled
 * until 1.5% of texels saturate. Reaching the originally-specified luma 0.8
 * would cost 31.6% of the texture, a third of it flat white.
 *
 * CONCRETE_TINT — target #17243b, which IS buildingMats[1]'s (0x18263c)
 * current render, unmoved. city-windows.js adds light for the lit windows
 * and the street lamps on TOP of this facade, and a lifted facade is what
 * turned the city's own asphalt to pale snow once already (§16.13).
 *
 * CITY_FACADE_SCALES — one tint, three facades. buildingMats[0]/[1]/[2]
 * (0x141f33 / 0x18263c / 0x101a2c) are the same dusk navy hue at three
 * values — measured, their linear r:g:b ratios agree to within 2 sRGB units
 * once rendered — so a single scalar per material (its own luma over
 * buildingMats[1]'s, the CONCRETE_TINT reference) reproduces all three
 * without flattening them into one slab.
 *
 * GROUND_TINT / GROUND_MAP_STRENGTH — the forest ground's material carries
 * NO colour of its own (spherical-world.js ~3185 sets only vertexColors), so
 * GROUND_TINT is a NORMALISATION (1/mean per channel, product with the
 * albedo's mean is exactly 1) rather than a lift, and GROUND_MAP_STRENGTH is
 * how much of the map's own contrast is allowed to show through
 * (`mix(1, albedo x GROUND_TINT, strength)`) before the vegetated stops clip
 * — 0.8 is the largest value under the 1.5% budget.
 *
 * GROUND_TILE_UNITS / GROUND_TRIPLANAR_SHARPNESS — the two remaining fields
 * `ground-detail.js`'s `groundMap` option requires. Tile 18: the forest's
 * ground-character noise cells already read at ~18 units (GROUND_PROFILES.
 * forest.noiseScale === 0.055, i.e. 1/0.055), so the authored map's own grain
 * sits at the same macro scale as the procedural mottling it is layered over
 * instead of introducing a second, competing frequency. Sharpness 4: the
 * triplanar blend weight is `pow(|N|, sharpness)` renormalised to sum to 1 —
 * at 4 the dominant axis (near a flat ground facet, that is the sphere-up
 * axis almost everywhere) claims essentially all the weight, so the ground
 * reads as one coherent top-down projection rather than a visible three-way
 * blend seam near the rare steep facet.
 */
export const GROUND_TILE_UNITS = 18;
export const GROUND_TRIPLANAR_SHARPNESS = 4;
export const CANYON_TILE_METRES = 4.3;
export const CANYON_TINT = Object.freeze({ r: 1.549, g: 0.632, b: 0.299 });
export const CANYON_DARK_SPIRE_SCALE = 0.5429;

export const GRANITE_TILE_METRES = 8.0;
export const GRANITE_TINT = Object.freeze({ r: 0.407, g: 0.479, b: 0.637 });

export const SNOW_TILE_METRES = 8.0;
export const SNOW_TINT = Object.freeze({ r: 1.561, g: 1.640, b: 1.731 });

export const CITY_TILE_METRES = 6.0;
export const CONCRETE_TINT = Object.freeze({ r: 0.029, g: 0.061, b: 0.147 });
export const CITY_FACADE_SCALES = Object.freeze([0.7173, 1.0000, 0.5406]);

export const GROUND_TINT = Object.freeze({ r: 5.213, g: 5.962, b: 7.030 });
export const GROUND_MAP_STRENGTH = 0.8;

/**
 * Load one authored texture with every convention applied.
 *
 * `anisotropy` is deliberately over-asked at 16: three clamps it to the
 * device's real maximum on upload, and grazing-angle filtering on a near
 * vertical trunk is the largest quality win available here for zero memory.
 */
export function loadTexture(THREE, url, { repeat, anisotropy = 16, onError, onLoad } = {}) {
  const texture = new THREE.TextureLoader().load(
    url,
    // `onLoad` is not decoration. TextureLoader returns the Texture object
    // immediately and fills its image in later, so anything that switches a
    // material ON at call time is switching to an EMPTY texture for the
    // length of the download. Captured, with the sky held in flight: the
    // whole upper half of the screen renders solid black.
    onLoad ? (tex) => onLoad(tex) : undefined,
    undefined,
    (err) => {
      console.warn(`[authored-textures] ${url} failed to load; keeping the procedural material`, err);
      if (onError) onError(err);
    },
  );
  texture.colorSpace = colorSpaceFor(url, THREE);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (repeat) texture.repeat.set(repeat.x, repeat.y);
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  return texture;
}

/**
 * Authored textures are ON by default; `?bark=0` / `?stone=0` opt out, and
 * `?authored=0` opts out of both at once.
 *
 * Inverted from `?bark=1` once the art was accepted on a real phone. The
 * escape hatch stays because the A/B is how every one of these was judged,
 * and a comparison you cannot re-run is a comparison nobody re-runs.
 */
export function authoredBarkRequested(search) {
  return !/[?&](bark|authored)=0/.test(search || '');
}

/** `?stone=0`, or `?authored=0` for every authored texture at once. */
export function authoredStoneRequested(search) {
  return !/[?&](stone|authored)=0/.test(search || '');
}

/** `?canyon=0`, or `?authored=0` for every authored texture at once. */
export function authoredCanyonRequested(search) {
  return !/[?&](canyon|authored)=0/.test(search || '');
}

/** `?granite=0`, or `?authored=0` for every authored texture at once. */
export function authoredGraniteRequested(search) {
  return !/[?&](granite|authored)=0/.test(search || '');
}

/** `?snow=0`, or `?authored=0` for every authored texture at once. */
export function authoredSnowRequested(search) {
  return !/[?&](snow|authored)=0/.test(search || '');
}

/**
 * `?city=0` (or `?authored=0`) opts out, exactly like the other four.
 *
 * Kept as its own named function rather than folded into the generic pattern
 * so the wiring in spherical-world.js reads the same as every other authored
 * surface: the A/B is how the owner judges the city facade on real glass, and
 * this is the one line that flips if that judgement goes the other way.
 */
export function authoredCityRequested(search) {
  return !/[?&](city|authored)=0/.test(search || '');
}

/**
 * `?ground=0` (or `?authored=0`) opts out of the forest ground's triplanar
 * texture overlay — same pattern as the other five, and the same reason: the
 * A/B against the pure procedural ground is how the owner judges it on real
 * glass.
 */
export function authoredGroundRequested(search) {
  return !/[?&](ground|authored)=0/.test(search || '');
}

/**
 * Run `commit` once EVERY texture in a set has decoded, and give the caller a
 * way to cancel it.
 *
 * This exists because a Texture is not an image. `TextureLoader.load` returns
 * the object immediately and fills its `image` in later, so a material that
 * assigns `map` at call time has `USE_MAP` defined against an empty upload for
 * the whole download. Captured, with the bark PNGs held in flight by a route
 * delay: every trunk in the forest renders as a SOLID BLACK SLAB -- which is
 * word for word the defect `spherical-world.js`'s own barkMat comment was
 * written to memorialise. The sky had the identical bug and the identical
 * symptom, so this is the shared fix rather than a third copy of it.
 *
 * ALL of them, not each as it lands: attaching a normalMap whose image has not
 * arrived perturbs the lighting on a surface whose albedo is still procedural,
 * which is a different wrong frame rather than no wrong frame.
 */
export function commitWhenDecoded(total, commit) {
  let remaining = total;
  let state = 'waiting';
  return {
    onOne() {
      if (state !== 'waiting') return;
      remaining -= 1;
      if (remaining > 0) return;
      state = 'committed';
      commit();
    },
    cancel() {
      const wasCommitted = state === 'committed';
      state = 'cancelled';
      return wasCommitted;
    },
  };
}

/**
 * Apply the authored bark to a material, and return a disposer.
 *
 * `map` MULTIPLIES `color`, and that is the whole trap. Two wrong answers were
 * measured before this one:
 *
 *   keep 0x8a6440 -> the trunk lands at ~14% of its current brightness, because
 *                    the map is already an albedo and you are multiplying two
 *                    of them together.
 *   set it white  -> CAPTURED, and the trunk measured 19% of the procedural
 *                    luminance in the real render. That is not a rounding
 *                    error, it is the exact defect this material's own comment
 *                    in spherical-world.js memorialises: "At 0x5a4028 the trunk
 *                    of an 88-unit tree read as a black slab against the sky."
 *                    White also loses the warmth: the stylised bark was so
 *                    saturated (linear blue 0.051) that it forced a warm read
 *                    even in ambient-only light, while a photograph of real
 *                    bark is near-neutral and picks up the cool sky instead.
 *
 * So the tint is SOLVED, not chosen: diffuseColor = color x map, the procedural
 * material was linear 0.2542/0.1274/0.0513 and the albedo's mean is
 * 0.1430/0.1216/0.0997, so the colour that reproduces the old trunk tone
 * exactly while keeping the map's variation is their ratio. Values above 1 are
 * legal — three's Color holds floats — and 1.78 in red only says the stylised
 * bark was redder than a photograph of the real thing.
 *
 * This is the one number here that is genuinely an art call rather than a
 * measurement, so it is a named constant: it restores the STATUS QUO tone, and
 * whether the status quo was right is the owner's judgement on real glass.
 *
 * Returns a disposer, or null when the flag is off.
 */
export function applyAuthoredBark(THREE, material, { circumference, height, basePath = './assets/textures' } = {}) {
  const repeat = repeatForCylinder(circumference, height, BARK_TILE_METRES);
  const previous = { color: material.color.getHex(), map: material.map, normalMap: material.normalMap };
  // `let`, not `const`: the commit closure below is created before these are
  // assigned, and a cached image whose onLoad fired synchronously would read
  // them inside a const's temporal dead zone.
  let map = null;
  let normalMap = null;
  const gate = commitWhenDecoded(2, () => {
    material.map = map;
    material.normalMap = normalMap;
    material.color.setRGB(BARK_TINT.r, BARK_TINT.g, BARK_TINT.b);
    material.needsUpdate = true;
  });
  map = loadTexture(THREE, `${basePath}/bark_pine_albedo.png`, { repeat, onLoad: gate.onOne });
  normalMap = loadTexture(THREE, `${basePath}/bark_pine_normal.png`, { repeat, onLoad: gate.onOne });

  // NOT roughnessMap: MeshLambertMaterial has no such slot. Assigning one
  // uploads a texture, perturbs the program cache key into a fresh compile that
  // produces an identical shader, and samples nothing.
  //
  // Verified twice against the pinned three@0.183.2 source, because the first
  // citation was bad: src/renderers/shaders/ShaderLib/meshlambert.glsl.js (note
  // the path — meshlambert_frag.glsl.js does not exist and the CDN returns a
  // 100-byte "couldn't find the requested file" stub that greps as zero hits
  // for anything). The real 3,253-byte file contains "roughness" zero times.
  // MeshLambertMaterial.js independently declares only ten maps, none of them
  // roughnessMap, which is what the decision actually rested on.
  return () => {
    const wasApplied = gate.cancel();
    map?.dispose();
    normalMap?.dispose();
    // Restore ONLY what was actually changed. A disposer that runs before the
    // images land would otherwise write `previous` over a material nothing had
    // touched -- harmless here, and a silent way to clobber a later edit.
    if (!wasApplied) return;
    material.map = previous.map;
    material.normalMap = previous.normalMap;
    material.color.setHex(previous.color);
    material.needsUpdate = true;
  };
}

/**
 * Weathered sandstone on the landmark arch.
 *
 * Deliberately a sibling of applyAuthoredBark rather than a generalisation of
 * it: the two differ only in numbers, and one shared function taking six
 * options would be harder to read than two that each state their own geometry.
 *
 * The tint used to be near-white, on the reasoning that the albedo had been
 * graded to the procedural material's own tone and so needed no correction.
 * That was true and it was the wrong target, because the procedural tone was
 * itself a brown: measured, the bark albedo's mean is #6f655e and the stone's
 * is #6c6359 -- 6.6 sRGB units apart, which is no distance at all. Shipped,
 * the arch read as a wooden bridge, and the owner said so on sight.
 *
 * So the tint takes the stone to a pale limestone instead. Solved, not picked:
 * the stone's linear mean is 0.1509/0.1254/0.0991, the target #b5a58c is
 * 0.4621/0.3762/0.2622, and the ratio is (3.062, 3.000, 2.647). Brighter
 * targets were measured too and rejected on clipping -- #c2ab86 blows 1.68%
 * of the texture's pixels against #b5a58c's 0.51%. Rendered, bark and stone
 * now sit 101.6 sRGB units apart, and `authored-textures.test.js` asserts that
 * separation against the shipped files so the next delivery cannot quietly be
 * the same brown again.
 *
 * TorusGeometry(R, tube, .., PI) with its UVs SWAPPED by the builder, so u
 * runs the tube (2*PI*tube) and v runs the arc (PI*R). The swap is not
 * cosmetic: this albedo's structure is horizontal bedding -- measured, rowVar
 * 10.0 against colVar 1.5 -- so unswapped the bands run lengthwise down a
 * standing leg, which is exactly how bark fissures run. Swapped they ring the
 * tube as level strata, which is both what sedimentary rock does and what the
 * canyons already do (§16.13 bands their walls by RADIUS for the same reason).
 *
 * The DEFAULTS below are only a fallback -- the arch's real dimensions are
 * passed in from the builder that owns the geometry. Hard-coding them here
 * means the day someone resizes the arch, the tiles stretch silently and the
 * only symptom is a texture that looks slightly wrong in a screenshot nobody
 * takes.
 */
export const STONE_TINT = Object.freeze({ r: 3.062, g: 3.000, b: 2.647 });
export const ARCH_RADIUS_UNITS = 17;
export const ARCH_TUBE_RADIUS_UNITS = 2.9;
export const ARCH_ARC_UNITS = Math.PI * ARCH_RADIUS_UNITS;
export const ARCH_TUBE_UNITS = 2 * Math.PI * ARCH_TUBE_RADIUS_UNITS;

export function applyAuthoredStone(THREE, material, {
  basePath = './assets/textures',
  uUnits = ARCH_TUBE_UNITS,
  vUnits = ARCH_ARC_UNITS,
} = {}) {
  const repeat = repeatForCylinder(uUnits, vUnits, BARK_TILE_METRES);
  const previous = { color: material.color.getHex(), map: material.map, normalMap: material.normalMap };
  let map = null;
  let normalMap = null;
  const gate = commitWhenDecoded(2, () => {
    material.map = map;
    material.normalMap = normalMap;
    material.color.setRGB(STONE_TINT.r, STONE_TINT.g, STONE_TINT.b);
    material.needsUpdate = true;
  });
  map = loadTexture(THREE, `${basePath}/stone_rock_albedo.png`, { repeat, onLoad: gate.onOne });
  normalMap = loadTexture(THREE, `${basePath}/stone_rock_normal.png`, { repeat, onLoad: gate.onOne });

  return () => {
    const wasApplied = gate.cancel();
    map?.dispose();
    normalMap?.dispose();
    if (!wasApplied) return;
    material.map = previous.map;
    material.normalMap = previous.normalMap;
    material.color.setHex(previous.color);
    material.needsUpdate = true;
  };
}

/**
 * Per-instance UV scale for an InstancedMesh, derived from the instance matrix.
 *
 * This is what unlocks bark on the FOREST at large. The instanced trunks share
 * one material and therefore one `map.repeat`, but their per-instance scale
 * lives in the instance matrix rather than the UVs -- and the aspect of a
 * texture tile across that mesh spans 1.27:1 to 15.92:1, a 12.5x range, because
 * trunkHeight and trunkRadiusBottom are independent randomInRange draws. No
 * single repeat serves that: whichever is chosen, some class is smeared.
 *
 * A CylinderGeometry's UVs run 0..1 around and 0..1 up regardless of world
 * size, so the fix is to scale them per instance in the vertex shader. The
 * instance matrix's basis vector lengths ARE the scale, so it costs two
 * length() calls per vertex and no extra draw call, attribute or texture.
 *
 * The unit trunk is CylinderGeometry(0.4, 1.0, 1.0, 6): radiusBottom 1 and
 * height 1, scaled per instance to (radius, height, radius). So the world
 * circumference at the base is 2*PI*scaleX and the world height is scaleY.
 *
 * Injected at <uv_vertex>, which is where three computes vMapUv and
 * vNormalMapUv from the UV transform -- scaling the varyings after it means
 * the material's own map.repeat stays (1,1) and this is the only thing setting
 * density.
 *
 * `shape` (default 'cylinder', UNCHANGED behaviour) also takes 'box'. A
 * BoxGeometry gives every face its own 0..1 UV patch, so the world size a tile
 * must cover is that FACE's size, not a circumference -- the cylinder formula
 * fed through a box is wrong on all six faces, not just wrong by an aspect.
 * Which face a vertex belongs to is read from its object-space normal, so the
 * three faces of an axis-aligned box (|n.x|, |n.y| or |n.z| the largest
 * component) each get the two OTHER instance-scale axes as their repeat:
 * left/right faces span Z and Y, front/back span X and Y, top/bottom span X
 * and Z.
 *
 * That normal has to be the raw `normal` ATTRIBUTE, not `objectNormal`: in the
 * pinned three@0.183.2 meshlambert vertex template (this material has no other
 * consumer here), the main() body runs `<uv_vertex>` -- where this injects --
 * BEFORE `<beginnormal_vertex>`, which is the chunk that assigns
 * `objectNormal` from `normal` in the first place. Reading `objectNormal` at
 * this injection point would read a variable that does not exist yet; `normal`
 * itself is declared unconditionally for any lit material and is available
 * from the top of main().
 */
export function addInstancedUvScale(material, THREE, {
  tileMetres = BARK_TILE_METRES,
  // The UNIT geometry's radius at its widest, before the instance scale.
  // `birbSx` is the instance's X scale, and the world circumference is
  // 2*PI*unitRadius*Sx -- not 2*PI*Sx. The forest trunk's unit cylinder has a
  // bottom radius of exactly 1.0, so this was invisible there and wrong
  // everywhere else: the mountain pine's is 0.6, which would have tiled its
  // bark 1.67x too densely around the trunk and read as a different, finer
  // material on a tree that is meant to match. Meaningless for shape: 'box'.
  unitRadius = 1,
  // 'cylinder' (default, unchanged) or 'box'. Anything else throws rather than
  // silently falling back to a formula that does not match the geometry.
  shape = 'cylinder',
} = {}) {
  if (shape !== 'cylinder' && shape !== 'box') {
    throw new Error(`addInstancedUvScale: unknown shape "${shape}" (want 'cylinder' or 'box')`);
  }
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const isBox = shape === 'box';

  // The two formulas are mutually exclusive on purpose -- emitting both and
  // branching on a runtime uniform would mean every box-shaped material also
  // carries dead cylinder math (and vice versa) and a shader diff that hides
  // which one actually ran. `shape` is fixed at material-build time, never
  // per-frame, so a compile-time choice of source string costs nothing.
  const scaleGlsl = isBox
    ? `
          // BoxGeometry: a face's UV patch spans its own two world-size axes,
          // picked by which component of the raw object-space normal is
          // largest. |n.x| -> left/right face (spans Z, Y). |n.z| -> front/back
          // (spans X, Y). Otherwise top/bottom (spans X, Z).
          float birbSx = length(instanceMatrix[0].xyz);
          float birbSy = length(instanceMatrix[1].xyz);
          float birbSz = length(instanceMatrix[2].xyz);
          vec3 birbN = abs(normal);
          vec2 birbRepeat;
          if (birbN.x > birbN.y && birbN.x > birbN.z) {
            birbRepeat = vec2(birbSz, birbSy) / uBirbTileMetres;
          } else if (birbN.z > birbN.x && birbN.z > birbN.y) {
            birbRepeat = vec2(birbSx, birbSy) / uBirbTileMetres;
          } else {
            birbRepeat = vec2(birbSx, birbSz) / uBirbTileMetres;
          }
    `
    : `
          // The basis vector lengths of the instance matrix are its scale.
          float birbSx = length(instanceMatrix[0].xyz);
          float birbSy = length(instanceMatrix[1].xyz);
          vec2 birbRepeat = vec2(
            6.28318530718 * uBirbUnitRadius * birbSx / uBirbTileMetres,
            birbSy / uBirbTileMetres
          );
    `;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    shader.uniforms.uBirbTileMetres = { value: tileMetres };
    if (!isBox) shader.uniforms.uBirbUnitRadius = { value: unitRadius };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        `#include <common>\n\tuniform float uBirbTileMetres;${isBox ? '' : '\n\tuniform float uBirbUnitRadius;'}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_INSTANCING
        {
${scaleGlsl}
          #ifdef USE_MAP
            vMapUv *= birbRepeat;
          #endif
          #ifdef USE_NORMALMAP
            vNormalMapUv *= birbRepeat;
          #endif
        }
      #endif`);
  };

  // Without its own key this shares a compiled program with any other material
  // carrying an identical onBeforeCompile closure, and every one of them gets
  // the first material's uniforms. Icon3D paid for that lesson already. `shape`
  // is in the key too: a cylinder-shaped and a box-shaped material must never
  // share a compiled program, since one branch is dead code in the other.
  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => `${base}-instuv-${shape}-${tileMetres}-${unitRadius}`;
  return material;
}

/**
 * Authored surface on an arbitrary InstancedMesh material — the general form
 * `applyAuthoredBarkInstanced` was pulled out of once a fourth and fifth
 * consumer (the canyon spires, the mountain peaks and snow caps, the city
 * facades) needed the same decode-gate + per-instance-UV-scale + disposer
 * shape with only the files, the tint and the geometry differing.
 *
 * `shape` and `unitRadius` pass straight through to `addInstancedUvScale`, so
 * the same rules apply: `shape: 'box'` for a BoxGeometry face, `unitRadius`
 * is the UNIT geometry's own radius before instance scale (meaningless for
 * `'box'`). The injection is installed WITH the maps, inside the commit, not
 * before them — it reads `USE_MAP` / `USE_NORMALMAP`, which only exist once a
 * map is attached, so installing it early compiles a program with a dead
 * branch and then needs a second compile anyway.
 */
export function applyAuthoredSurfaceInstanced(THREE, material, {
  basePath = './assets/textures',
  albedoFile,
  normalFile,
  tint,
  unitRadius = 1,
  tileMetres = BARK_TILE_METRES,
  shape = 'cylinder',
} = {}) {
  const previous = { color: material.color.getHex(), map: material.map, normalMap: material.normalMap };
  let map = null;
  let normalMap = null;
  const gate = commitWhenDecoded(2, () => {
    material.map = map;
    material.normalMap = normalMap;
    material.color.setRGB(tint.r, tint.g, tint.b);
    addInstancedUvScale(material, THREE, { unitRadius, tileMetres, shape });
    material.needsUpdate = true;
  });
  map = loadTexture(THREE, `${basePath}/${albedoFile}`, { onLoad: gate.onOne });
  normalMap = loadTexture(THREE, `${basePath}/${normalFile}`, { onLoad: gate.onOne });

  return () => {
    const wasApplied = gate.cancel();
    map?.dispose();
    normalMap?.dispose();
    if (!wasApplied) return;
    material.map = previous.map;
    material.normalMap = previous.normalMap;
    material.color.setHex(previous.color);
    material.needsUpdate = true;
  };
}

/**
 * Authored bark on the INSTANCED forest trunks.
 *
 * Same two files as the landmark trunk, so the forest reads as one material at
 * one physical scale; the difference is entirely in how the UVs are derived.
 * map.repeat stays (1,1) here -- addInstancedUvScale owns density.
 *
 * A thin, byte-behaviour-preserving wrapper over `applyAuthoredSurfaceInstanced`
 * now: same default tint, same default tile, same default shape.
 */
export function applyAuthoredBarkInstanced(THREE, material, {
  basePath = './assets/textures',
  tint = BARK_TINT,
  unitRadius = 1,
} = {}) {
  return applyAuthoredSurfaceInstanced(THREE, material, {
    basePath,
    albedoFile: 'bark_pine_albedo.png',
    normalFile: 'bark_pine_normal.png',
    tint,
    unitRadius,
    tileMetres: BARK_TILE_METRES,
    shape: 'cylinder',
  });
}

/**
 * Authored ground overlay on the forest sphere's triplanar `groundMap`.
 *
 * The sixth consumer, and the odd one out: every other `apply*` here owns
 * `material.map` / `material.normalMap` directly, because every other
 * material is Lambert-lit with a real UV set. The forest ground has neither
 * — `ground-detail.js`'s `addGroundDetail` already declares the whole
 * triplanar sampler, its three axis-pair UVs and the mean-preserving weight
 * math (see that file's own header for why), and exposes exactly the knob a
 * loader needs at `material.userData.birbGroundTexUniforms`: `uGroundMap`
 * (starts `null`) and `uGroundMix` (starts `0`, a bit-identical no-op). This
 * function's whole job is to wait for the decode and then set those two —
 * it does not touch `.map`/`.normalMap` and never calls `addInstancedUvScale`
 * (the sphere is not instanced and the projection is triplanar, not a
 * per-instance repeat).
 *
 * ONE texture, not two: `ground-detail.js`'s shader declares a single
 * `uGroundMap` sampler and no normal slot, so loading a normal map here would
 * download 1.3 MB that is never bound to anything — the classic
 * `MeshLambertMaterial` has-no-`roughnessMap` trap from `applyAuthoredBark`'s
 * own comment, one level up: a slot that does not exist in the consumer is a
 * silent no-op for whatever tries to fill it.
 *
 * Returns `null` (not a disposer) when the material was never given a
 * `groundMap` option by `addGroundDetail` — i.e. the caller asked for the
 * overlay but `spherical-world.js` didn't pass `groundMap` for this biome
 * (today: everything except forest). That is a caller error, not a load
 * failure, so it is surfaced by return value rather than swallowed into the
 * same warn-and-continue path a real decode failure takes.
 */
export function applyAuthoredGround(THREE, material, { basePath = './assets/textures' } = {}) {
  const texUniforms = material.userData?.birbGroundTexUniforms;
  if (!texUniforms) return null;
  let map = null;
  const gate = commitWhenDecoded(1, () => {
    texUniforms.uGroundMap.value = map;
    texUniforms.uGroundMix.value = GROUND_MAP_STRENGTH;
  });
  map = loadTexture(THREE, `${basePath}/forest_ground_albedo.png`, { onLoad: gate.onOne });

  return () => {
    const wasApplied = gate.cancel();
    map?.dispose();
    // Restore ONLY what was actually changed -- same rule as every other
    // disposer here. Before the decode lands both uniforms are still at
    // their addGroundDetail defaults (null / 0), so there is nothing to undo.
    if (!wasApplied) return;
    texUniforms.uGroundMap.value = null;
    texUniforms.uGroundMix.value = 0.0;
  };
}
