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
 * Load one authored texture with every convention applied.
 *
 * `anisotropy` is deliberately over-asked at 16: three clamps it to the
 * device's real maximum on upload, and grazing-angle filtering on a near
 * vertical trunk is the largest quality win available here for zero memory.
 */
export function loadTexture(THREE, url, { repeat, anisotropy = 16, onError } = {}) {
  const texture = new THREE.TextureLoader().load(
    url,
    undefined,
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

/** `?bark=1`, on the `?glb=1` precedent. Off is the shipping default. */
export function authoredBarkRequested(search) {
  return /[?&]bark=1/.test(search || '');
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
  const map = loadTexture(THREE, `${basePath}/bark_pine_albedo.png`, { repeat });
  const normalMap = loadTexture(THREE, `${basePath}/bark_pine_normal.png`, { repeat });

  const previous = { color: material.color.getHex(), map: material.map, normalMap: material.normalMap };
  material.map = map;
  material.normalMap = normalMap;
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
  material.color.setRGB(BARK_TINT.r, BARK_TINT.g, BARK_TINT.b);
  material.needsUpdate = true;

  return () => {
    map.dispose();
    normalMap.dispose();
    material.map = previous.map;
    material.normalMap = previous.normalMap;
    material.color.setHex(previous.color);
    material.needsUpdate = true;
  };
}
