/**
 * What the ground is made of.
 *
 * The four-biome contact sheet makes the case on its own: the city, which got
 * a legibility pass (lit windows, a street grid), is far and away the best
 * frame on it, and the other three are one flat colour each. The forest is a
 * plain olive field, the canyons are a smooth orange dome and the mountain is
 * a uniform pale blue-grey — and the forest is the DEFAULT biome, so it is the
 * first thing anyone ever sees.
 *
 * The ground is also, by a long way, the largest thing on screen. Every other
 * item on the visual roadmap improves something occupying a tenth of the
 * frame. This one improves half of it.
 *
 * ── The geometric normal is free, and it is the whole trick ─────────────
 *
 * `normalize(cross(dFdx(P), dFdy(P)))` on the interpolated world position is
 * the FACET normal, which suits a flat-shaded low-poly terrain exactly: it
 * costs two derivatives and a cross product, needs no attribute, and gives a
 * clean per-face slope. Snow that lies on the flats and not on the faces,
 * sand that collects in the basins and not on the walls, soil that shows
 * through where the hill is steep — all of that is one `smoothstep` away once
 * you have the slope, with no texture and no extra draw call.
 *
 * Only the forest needs actual noise, and one octave of it. Two things follow
 * from that: this stays cheap enough for a phone's fill rate, and there is no
 * octave stack to tune.
 *
 * ── outgoingLight, not diffuseColor ─────────────────────────────────────
 *
 * By the time `<opaque_fragment>` runs, Lambert has already folded
 * `diffuseColor` into the lighting, so writing to it there changes nothing at
 * all — which is exactly how the city's street grid shipped invisible the
 * first time (docs/VISUAL_UPGRADE_BUILD_PLAN.md 16.13). This tints
 * `outgoingLight`, so it modulates the LIT result and keeps the light rig's
 * shaping instead of flattening it.
 *
 * ── Tints multiply, they never add ──────────────────────────────────────
 *
 * A flat additive term lifts a dark material far more than a bright one, which
 * is how a sun rim once turned the city's asphalt into snow. Everything here
 * is a multiply against a mean of about 1.0, so a face keeps its exposure and
 * only its hue and value shift.
 */

/** Per-biome ground character. All multiplicative tints, mean ~1. */
export const GROUND_PROFILES = {
  forest: {
    // Mottled moss and soil. The world position is in units and the planet is
    // radius 120, so a cell is 1/scale units across: 0.055 gives patches about
    // 18 units wide, which is a couple of ground facets and a few tree
    // spacings — big enough to read from the air, small enough that a low pass
    // still shows several.
    noiseScale: 0.055,
    // Contrast between the two has to be REAL. The first pass used tints
    // about 0.1 apart in every channel and the result was a soft gradient
    // across the whole field rather than ground with anything on it — the
    // effect was measurably present and visually absent.
    mossTint: [0.72, 1.18, 0.68],
    soilTint: [1.26, 0.92, 0.62],
    // Steep ground sheds its litter and shows dirt.
    slopeTint: [1.24, 0.90, 0.64],
    slopeStart: 0.10, slopeEnd: 0.42,
    // Valleys are damper and darker than the ridges above them.
    dampTint: [0.78, 0.94, 0.84],
    dampDepth: 26,
    // Second, finer noise cell, as a fraction of the first. Undergrowth inside
    // a clearing; without it the macro patches read as painted shapes.
    detailScale: 4.5,
    detail: 0.16,
    band: 0, bandScale: 0,
  },
  canyons: {
    // Sand gathers in the basins, rock shows on the walls — and, crucially,
    // the sediment BANDS run all the way across the ground, not only down the
    // cliff faces. addAtmosphere already bands the walls by radius, but a
    // canyon floor is nearly level, so its radius barely changes across a
    // whole view and not one band ever appeared on it. The first capture with
    // ground detail on still read as a smooth orange dome for exactly that
    // reason. Banding the ground too turns the plateau into exposed strata
    // seen from above, which is what a canyon country actually looks like.
    noiseScale: 0.09,
    mossTint: [1.16, 1.00, 0.82],
    soilTint: [0.94, 0.84, 0.76],
    slopeTint: [0.72, 0.58, 0.52],
    slopeStart: 0.12, slopeEnd: 0.44,
    dampTint: [1.18, 1.08, 0.90],
    dampDepth: 34,
    detailScale: 3.2,
    detail: 0.10,
    // Amplitude, and radians of phase per world unit of radius: 0.9 is a band
    // every ~7 units, which is one or two ground facets thick.
    band: 0.13, bandScale: 0.9,
  },
  mountain: {
    // The big one. A mountain lit as one pale mass has no mountain in it; the
    // shape only appears when snow lies on what is flat and rock shows on what
    // is steep. `slopeStart` is deliberately early — on a 96x64 mobile ground
    // mesh a genuinely vertical face is rare, so waiting for one means the
    // rock never appears.
    noiseScale: 0.07,
    mossTint: [1.02, 1.04, 1.08],
    soilTint: [0.94, 0.96, 1.02],
    slopeTint: [0.58, 0.60, 0.68],
    slopeStart: 0.07, slopeEnd: 0.34,
    dampTint: [0.82, 0.86, 0.96],
    dampDepth: 30,
    detailScale: 4.0,
    detail: 0.12,
    // A little banding reads as strata in the exposed rock.
    band: 0.06, bandScale: 0.55,
  },
};

/**
 * ── Ground that never repeats: hex tiling on two projections (?hextile=1) ──
 *
 * The authored ground map is one 512² photograph laid every 18 units. From
 * the air that is a lattice: the same dark blotch, the same pale gravel
 * patch, marching across the valley in rows. `groundMap.hexTile` replaces the
 * triplanar sample with two ideas that compose:
 *
 *  - Mikkelsen 2022, "Practical Real-Time Hex-Tiling" (JCGT 11(3)). The plane
 *    is cut into a triangle grid; each vertex owns a hexagonal tile that shows
 *    the texture at a random OFFSET and ROTATION, and every point blends the
 *    three tiles of its triangle. His blend is what makes it usable: the
 *    barycentric weight is raised to the 7th power, so most of every tile is
 *    one sample and only a thin seam blends, and it is tilted toward the
 *    BRIGHTER sample (`mix(1, luminance, 0.6)`), so the seam follows the
 *    texture's own features like a height blend instead of cross-fading two
 *    photographs into mush. Each fetch is a `textureGrad` with the gradient
 *    rotated with the tile, so the mip choice is continuous across the seams
 *    that the random offsets would otherwise tear.
 *  - Quilez's biplanar mapping. Of the three triplanar projections only the
 *    two dominant ones are fetched, each with ITS OWN projected gradients,
 *    and the weights get local support — a kept axis weighs nothing at
 *    1/sqrt(3), which is exactly where the dropped axis can change, so the
 *    swap is seamless. Three tiles x two projections is six fetches, not
 *    nine; and over most of the planet the second axis sits below 1/sqrt(3)
 *    and weighs exactly nothing, so it is skipped: three fetches there, the
 *    same count the triplanar pays everywhere.
 *
 * The projections are chosen by the SMOOTH surface normal on the smooth path
 * (the default), not by the sphere's radial as the triplanar does. Three
 * projections averaged hide a projection that lies nearly along a valley
 * wall — as blur; two cannot, and the map streaks. The triplanar avoided the
 * facet normal because it snaps per triangle; the smooth normal is
 * continuous, which is all the seamless swap needs. The flat path has no
 * continuous surface normal and keeps the radial.
 *
 * Considered and rejected on the fetch budget: Wronski 2025 ("GPU-Friendly
 * Laplacian Texture Blending", JCGT 14(1)) blends Laplacian levels with
 * per-level mask sharpness and fixes the contrast loss properly — at n+1
 * fetches per tile per projection, 30 for four levels against six here.
 *
 * Measured on the real forest albedo with the JS mirror below (200k samples):
 * Mikkelsen's blend moves the mean +0.2% (inside the estimate's own noise,
 * and the uGroundGain normalisation assumes the file's mean) and keeps 94% of
 * the texture's standard deviation — the thin seams are all it loses.
 *
 * Everything here is OPT-IN. The frozen suites pin the default's fetch budget
 * (three texture2D calls) and its bytes, so without `hexTile` this module
 * emits exactly what it always has; with it and switched off at runtime
 * (`setGroundHexTile(material, false)`), likewise — so the A/B's off side is
 * the true before, not an approximation of it.
 */
export const HEX_TILE_DEFAULTS = Object.freeze({
  // Fraction of a full turn a tile may be rotated by. Gravel and leaf litter
  // seen from above have no grain direction, so all of it.
  rotation: 1.0,
  // Mikkelsen's g_fallOffContrast and g_exp, unchanged.
  falloff: 0.6,
  exponent: 7.0,
  // Triangle-grid density in grid cells per texture repeat. 2*sqrt(3) is the
  // paper's (and Heitz-Neyret 2018's): neighbouring tile centres 0.29 of a
  // repeat apart, i.e. about 5.2 units on the 18-unit forest tile.
  cells: 2 * Math.sqrt(3),
});

/** `?hextile=1`. Off is the shipping default (see the note above). */
export function hexTileRequested(search) {
  return /[?&]hextile=1(?:&|#|$)/.test(search || '');
}

/**
 * Switch a hex-capable ground material between the hex path and the
 * byte-identical triplanar at runtime (a recompile, not a uniform: the off
 * program is literally the default's). Returns the new state, or null when
 * the material was never given `groundMap.hexTile`. Debug/A-B only.
 */
export function setGroundHexTile(material, on) {
  const state = material?.userData?.birbGroundHex;
  if (!state) return null;
  const next = !!on;
  if (state.enabled !== next) {
    state.enabled = next;
    markHexProgram(material, next);
    material.needsUpdate = true;
  }
  return state.enabled;
}

/**
 * The flip has to reach three's PROGRAM cache, and the cache key alone cannot
 * carry it: addAtmosphere (chained after this patch on every world material)
 * evaluates the key chain ONCE, at patch time, and returns that string
 * forever — so a key that changes afterwards changes nothing, three reuses
 * the program it already has, and the A/B photographs one arm twice (it did,
 * pixel for pixel). Three also keys programs on `material.defines`, so the
 * hex program carries a define; an empty defines object adds nothing to the
 * key or the source, which keeps the off program the default one exactly.
 */
function markHexProgram(material, on) {
  if (on) material.defines = { ...(material.defines || {}), BIRB_GROUND_HEX: '' };
  else if (material.defines) delete material.defines.BIRB_GROUND_HEX;
}

// ---- JS mirror of the GLSL below. Tests pin the properties the look depends
// on (weights sum to 1, seams are continuous, the swap is seamless); nothing
// here runs per frame. Plain float64, so it matches the shader's float32 in
// behaviour, not to the last bit. ----
const _fract = (x) => x - Math.floor(x);

/** "Hash without Sine" (Dave Hoskins, MIT): three values in [0,1) per vertex. */
export function hexTileHash(x, y) {
  let a = _fract(x * 0.1031);
  let b = _fract(y * 0.1030);
  let c = _fract(x * 0.0973);
  const d = a * (b + 33.33) + b * (a + 33.33) + c * (c + 33.33);
  a += d; b += d; c += d;
  return [_fract((a + b) * c), _fract((a + c) * b), _fract((b + c) * a)];
}

/**
 * The triangle of the hex grid under `st` (texture units): its three vertex
 * ids (integer lattice points in the skewed grid) and the barycentric weight
 * each one gets, which is 1 at its own vertex and 0 on the far edge.
 */
export function hexTileCell(stx, sty, cells = HEX_TILE_DEFAULTS.cells) {
  const gx = stx * cells;
  const gy = sty * cells;
  const kx = gx - 0.57735027 * gy;
  const ky = 1.15470054 * gy;
  const bx = Math.floor(kx);
  const by = Math.floor(ky);
  const fx = kx - bx;
  const fy = ky - by;
  const fz = 1 - fx - fy;
  const s = fz <= 0 ? 1 : 0;
  const s2 = 2 * s - 1;
  return {
    weights: [Math.max(0, -fz * s2), Math.max(0, s - fy * s2), Math.max(0, s - fx * s2)],
    vertices: [[bx + s, by + s], [bx + s, by + 1 - s], [bx + 1 - s, by + s]],
  };
}

/** Where vertex `v`'s tile samples the texture for the point `st`. */
export function hexTileUv(stx, sty, v, { rotation = HEX_TILE_DEFAULTS.rotation, cells = HEX_TILE_DEFAULTS.cells } = {}) {
  const h = hexTileHash(v[0], v[1]);
  const angle = (h[2] * 2 - 1) * Math.PI * rotation;
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const cx = (v[0] + 0.5 * v[1]) / cells;
  const cy = 0.8660254 * v[1] / cells;
  const dx = stx - cx;
  const dy = sty - cy;
  return [cs * dx - sn * dy + cx + h[0], sn * dx + cs * dy + cy + h[1]];
}

/** Mikkelsen's blend weights for barycentrics `w` and sample luminances `lum`, normalised. */
export function hexTileWeights(w, lum, { falloff = HEX_TILE_DEFAULTS.falloff, exponent = HEX_TILE_DEFAULTS.exponent } = {}) {
  const W = w.map((b, i) => (1 + (lum[i] - 1) * falloff) * Math.pow(Math.max(0, b), exponent));
  const sum = W[0] + W[1] + W[2];
  return W.map((x) => x / sum);
}

/**
 * The two projections the biplanar path fetches for blend normal `n` (the
 * smooth surface normal on the smooth path, the radial on the flat one),
 * major first, with their normalised weights: `{ axes: ['x','z'], weights:
 * [0.9, 0.1] }`. The minor axis is dropped (ties drop x, then y); a kept
 * axis's raw weight is `clamp((|n| - 1/sqrt(3)) / (1 - 1/sqrt(3)))^sharpness`.
 */
export function biplanarProjections(nx, ny, nz, sharpness = 4) {
  const an = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
  const dropX = an[0] <= an[1] && an[0] <= an[2];
  const dropY = !dropX && an[1] <= an[2];
  const keepZ = dropX || dropY;
  let axes = [dropX ? 1 : 0, keepZ ? 2 : 1];
  if (an[axes[1]] > an[axes[0]]) axes = [axes[1], axes[0]];
  const k = 0.57735027;
  const raw = axes.map((a) => Math.pow(Math.min(1, Math.max(0, (an[a] - k) / (1 - k))), sharpness));
  const names = ['x', 'y', 'z'];
  // Mirrors the shader's early-out: no weight on the second axis, first only.
  const weights = raw[1] <= 0 ? [1, 0] : [raw[0] / (raw[0] + raw[1]), raw[1] / (raw[0] + raw[1])];
  return { axes: axes.map((a) => names[a]), weights };
}

// The GLSL. Declared after the ground-map uniforms (it reads uGroundMap,
// uGroundTile and uGroundSharp) and emitted only on the hex path. GLSL ES
// 3.00, which three compiles as: textureGrad is core, no extension needed.
const HEX_TILE_GLSL = `
      uniform vec4 uGroundHex; // x rotation (angle up to +/- x*PI), y luminance falloff, z exponent, w grid cells per repeat
      // Hash without Sine (Dave Hoskins, MIT): offset and angle per vertex.
      vec3 gtHexHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yxz + 33.33);
        return fract((p3.xxy + p3.yzz) * p3.zyx);
      }
      // Mikkelsen 2022: three rotated, offset tiles of uGroundMap at st
      // (texture units), dx/dy its screen derivatives.
      vec3 gtHexTile(vec2 st, vec2 dx, vec2 dy) {
        vec2 hxG = st * uGroundHex.w;
        vec2 hxK = vec2(hxG.x - 0.57735027 * hxG.y, 1.15470054 * hxG.y);
        vec2 hxB = floor(hxK);
        vec3 hxF = vec3(hxK - hxB, 0.0);
        hxF.z = 1.0 - hxF.x - hxF.y;
        float hxS = step(0.0, -hxF.z);
        float hxS2 = 2.0 * hxS - 1.0;
        vec3 hxBary = max(vec3(-hxF.z * hxS2, hxS - hxF.y * hxS2, hxS - hxF.x * hxS2), 0.0);
        vec2 hxV1 = hxB + vec2(hxS);
        vec2 hxV2 = hxB + vec2(hxS, 1.0 - hxS);
        vec2 hxV3 = hxB + vec2(1.0 - hxS, hxS);
        vec3 hxH1 = gtHexHash(hxV1);
        vec3 hxH2 = gtHexHash(hxV2);
        vec3 hxH3 = gtHexHash(hxV3);
        vec3 hxAng = (vec3(hxH1.z, hxH2.z, hxH3.z) * 2.0 - 1.0) * (3.14159265 * uGroundHex.x);
        vec3 hxCs = cos(hxAng);
        vec3 hxSn = sin(hxAng);
        mat2 hxR1 = mat2(hxCs.x, hxSn.x, -hxSn.x, hxCs.x);
        mat2 hxR2 = mat2(hxCs.y, hxSn.y, -hxSn.y, hxCs.y);
        mat2 hxR3 = mat2(hxCs.z, hxSn.z, -hxSn.z, hxCs.z);
        vec2 hxC1 = vec2(hxV1.x + 0.5 * hxV1.y, 0.8660254 * hxV1.y) / uGroundHex.w;
        vec2 hxC2 = vec2(hxV2.x + 0.5 * hxV2.y, 0.8660254 * hxV2.y) / uGroundHex.w;
        vec2 hxC3 = vec2(hxV3.x + 0.5 * hxV3.y, 0.8660254 * hxV3.y) / uGroundHex.w;
        // Gradients rotate with the tile: the mip level stays continuous
        // across the seams the random offsets tear in the coordinate.
        vec3 hxT1 = textureGrad(uGroundMap, hxR1 * (st - hxC1) + hxC1 + hxH1.xy, hxR1 * dx, hxR1 * dy).rgb;
        vec3 hxT2 = textureGrad(uGroundMap, hxR2 * (st - hxC2) + hxC2 + hxH2.xy, hxR2 * dx, hxR2 * dy).rgb;
        vec3 hxT3 = textureGrad(uGroundMap, hxR3 * (st - hxC3) + hxC3 + hxH3.xy, hxR3 * dx, hxR3 * dy).rgb;
        // Mikkelsen's contrast-preserving blend: a steep barycentric falloff
        // tilted toward the brighter sample, renormalised to sum to 1.
        vec3 hxLw = vec3(0.299, 0.587, 0.114);
        vec3 hxW = mix(vec3(1.0), vec3(dot(hxT1, hxLw), dot(hxT2, hxLw), dot(hxT3, hxLw)), uGroundHex.y)
                 * pow(hxBary, vec3(uGroundHex.z));
        hxW /= hxW.x + hxW.y + hxW.z;
        return hxW.x * hxT1 + hxW.y * hxT2 + hxW.z * hxT3;
      }
      // Quilez's biplanar: the two dominant projections of the triplanar
      // (X reads zy, Y reads xz, Z reads xy), major first, each with its own
      // projected world-space derivatives.
      vec3 gtHexBiplanar(vec3 p, vec3 n, vec3 dpx, vec3 dpy) {
        vec3 hxN = abs(n);
        bool hxDropX = hxN.x <= hxN.y && hxN.x <= hxN.z;
        bool hxKeepZ = hxDropX || hxN.y <= hxN.z;
        vec2 hxW = vec2(hxDropX ? hxN.y : hxN.x, hxKeepZ ? hxN.z : hxN.y);
        vec2 hxUvP = hxDropX ? p.xz : p.zy;
        vec2 hxDxP = hxDropX ? dpx.xz : dpx.zy;
        vec2 hxDyP = hxDropX ? dpy.xz : dpy.zy;
        vec2 hxUvQ = hxKeepZ ? p.xy : p.xz;
        vec2 hxDxQ = hxKeepZ ? dpx.xy : dpx.xz;
        vec2 hxDyQ = hxKeepZ ? dpy.xy : dpy.xz;
        bool hxSwap = hxW.y > hxW.x;
        // Local support: a kept axis weighs nothing at 1/sqrt(3), which is
        // where the dropped axis can change, so the swap is seamless.
        hxW = pow(clamp(((hxSwap ? hxW.yx : hxW) - 0.57735027) / 0.42264973, 0.0, 1.0), vec2(uGroundSharp));
        vec3 hxA = gtHexTile((hxSwap ? hxUvQ : hxUvP) / uGroundTile,
          (hxSwap ? hxDxQ : hxDxP) / uGroundTile, (hxSwap ? hxDyQ : hxDyP) / uGroundTile);
        // Most of the planet: the median axis weighs exactly nothing, so its
        // three fetches are skipped. Explicit gradients make the branch legal.
        if (hxW.y <= 0.0) return hxA;
        vec3 hxQ = gtHexTile((hxSwap ? hxUvP : hxUvQ) / uGroundTile,
          (hxSwap ? hxDxP : hxDxQ) / uGroundTile, (hxSwap ? hxDyP : hxDyQ) / uGroundTile);
        return (hxA * hxW.x + hxQ * hxW.y) / (hxW.x + hxW.y);
      }
`;

// The hex path's replacements for the two triplanar fetch blocks below.
const HEX_SMOOTH_FETCH = `
      // Hex-tiled biplanar (?hextile=1), HOISTED like the triplanar it
      // replaces: the bump below reads the same six fetches, not more.
      // Projections chosen by the SMOOTH surface normal, not the sphere's:
      // with only two projections a valley wall can be left with one that
      // lies almost along it, and the map streaks. The smooth normal is
      // continuous across triangles, which is all the swap needs.
      vec3 gtN0 = normalize(mix(gdSmoothW, gdFacetW, uGroundFacet));
      vec3 gdTex = gtHexBiplanar(vBirbWorld, gtN0, dFdx(vBirbWorld), dFdy(vBirbWorld));
`;
const HEX_FLAT_OVERLAY = `
        // Authored ground overlay, hex-tiled biplanar (?hextile=1): see the
        // hex note at the top of this module.
        vec3 gtN = normalize(mix(gdUp, gdN, uGroundFacet));
        vec3 gtTex = gtHexBiplanar(gdP, gtN, dFdx(gdP), dFdy(gdP));
        gdTint *= mix(vec3(1.0), gtTex * uGroundGain, uGroundMix);
`;

/**
 * Optional authored-texture overlay for the ground, projected TRIPLANAR off
 * the world position — the planet's own UVs run once around the sphere and
 * converge at the poles, so there is no seam-free UV to tile a texture on.
 * Triplanar has no pole singularity and needs no attribute.
 *
 * Blending is by the SPHERE normal (`gdUp`), not the facet normal (`gdN`):
 * `gdN` is constant per triangle, so blending by it would snap the projection
 * at every triangle edge that straddles the 45-degree crossover and the seam
 * would show up in the mesh itself. `gdUp` varies per fragment for free.
 * `uGroundFacet` (default 0, i.e. fully sphere-normal) exists as an A/B knob
 * only — nobody has looked at facet-blended output yet.
 *
 * The three projections are weighted by `pow(|N|, sharpness)`, RENORMALISED
 * to sum to 1. That normalisation is load-bearing: a weighted average of three
 * samples of the same texture has the texture's own mean only if the weights
 * sum to 1, and mean-preservation is the entire point of `uGroundGain`
 * (1 / the file's measured linear mean, so `mean(sample * gain) == 1` by
 * construction — the map can only add structure, never shift the ground's
 * hue or value).
 *
 * `uGroundMix` is driven from a decode gate (see authored-textures.js's
 * `commitWhenDecoded`) and starts at 0, so a texture bound but not yet
 * decoded contributes `mix(1, ..., 0) == 1` — bit-identical to the map being
 * absent. That is what stands in for the black-slab guard here: this module
 * never touches `map`, so there is no "TextureLoader returned an object with
 * an empty `image`" moment to protect against directly, but the same shape of
 * bug (switching a sampler on before its upload lands) is closed the same way.
 *
 * `smooth` is the 2026-09-13 organic pass and it changes TWO things, not one.
 * The obvious half is that the material stops flat-shading. The half that is
 * easy to miss: the slope term below — which decides soil against rock, and
 * with it every material boundary this shader draws — was deliberately taken
 * from the FACET normal, on the reasoning that it "agrees with the visible
 * faceting". Once the visible surface is lit per fragment that reasoning
 * inverts. A boundary that is constant per triangle, painted across a surface
 * whose lighting is not, snaps at every triangle edge: hard-edged blotches on
 * a soft hill. So the slope switches to the smooth normal with the shading.
 *
 * The facet normal does not go away — it becomes the thing the LIGHTING
 * normal is blended back toward wherever that slope says rock. That is the
 * whole of "smooth soil, pointy rocks": one mesh, one draw call, soil rolling
 * and rock faces fracturing, with the transition following the material
 * boundary the shader was already drawing.
 *
 * @param material   the terrain mesh's material (Lambert)
 * @param biome      key into GROUND_PROFILES; anything else is a no-op
 * @param smooth     shade soil smoothly and keep facets on rock (see above).
 *                    False emits EXACTLY the shader this module always has —
 *                    same injections, same slope source, same cache key — so
 *                    `?smooth=0` is a true before, not an approximation of it.
 * @param groundMap  optional { tile, sharpness, gain: {r,g,b} }. Omitted (the
 *                    default), this function emits exactly the shader it
 *                    always has — no sampler declared, no fetches, no dead
 *                    branch — so every biome and every existing caller is
 *                    byte-for-byte unchanged. Passed, and only for a truthy
 *                    call, every field is required: this throws rather than
 *                    defaults a missing one, the same contract
 *                    `addInstancedUvScale` uses for an unknown geometry shape.
 *                    Optional `hexTile` (true, or a partial HEX_TILE_DEFAULTS)
 *                    swaps the triplanar for hex-tiled biplanar — see the hex
 *                    note above HEX_TILE_DEFAULTS. Absent, nothing changes.
 */
export function addGroundDetail(material, THREE, { baseRadius = 120, biome, groundMap = null, smooth = false, bump = 0.0 } = {}) {
  const profile = GROUND_PROFILES[biome];
  // The city's ground already carries a street grid and asphalt; mottling it
  // would fight the one thing that identifies it.
  if (!material || !profile || material.userData?.birbGroundDetail) return material;
  if (groundMap) {
    for (const field of ['tile', 'sharpness', 'gain']) {
      if (groundMap[field] === undefined) {
        throw new Error(`addGroundDetail: groundMap.${field} is required when groundMap is passed`);
      }
    }
  }
  material.userData = material.userData || {};
  material.userData.birbGroundDetail = true;

  // Created here, in the closure, so the loader can raise uGroundMix at any
  // time — before or after the material's first compile, which is when
  // onBeforeCompile actually runs — with no needsUpdate and no recompile.
  // Assigned into shader.uniforms (the same object, not a copy) below.
  const texUniforms = groundMap ? {
    uGroundMap: { value: null },
    uGroundTile: { value: groundMap.tile },
    uGroundSharp: { value: groundMap.sharpness },
    uGroundFacet: { value: 0.0 },
    uGroundGain: { value: new THREE.Vector3(groundMap.gain.r, groundMap.gain.g, groundMap.gain.b) },
    uGroundMix: { value: 0.0 },
    // Bump strength. Live only on the smooth path: perturbing a normal that
    // is about to be replaced by its own facet normal changes nothing.
    uGroundBump: { value: smooth ? bump : 0.0 },
  } : null;
  if (texUniforms) material.userData.birbGroundTexUniforms = texUniforms;

  // Hex tiling rides the ground map (it re-samples it) and is only ever
  // attached when asked for. `enabled` is read at every compile and by the
  // cache key, so setGroundHexTile can flip it with one recompile.
  let hexState = null;
  if (texUniforms && groundMap.hexTile) {
    const o = { ...HEX_TILE_DEFAULTS, ...(typeof groundMap.hexTile === 'object' ? groundMap.hexTile : {}) };
    hexState = {
      enabled: true,
      uniform: { value: new THREE.Vector4(o.rotation, o.falloff, o.exponent, o.cells) },
    };
    material.userData.birbGroundHex = hexState;
    markHexProgram(material, true);
  }

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    const hex = !!(hexState && hexState.enabled);

    shader.uniforms.uGdBase = { value: baseRadius };
    shader.uniforms.uGdScale = { value: profile.noiseScale };
    shader.uniforms.uGdMoss = { value: new THREE.Vector3(...profile.mossTint) };
    shader.uniforms.uGdSoil = { value: new THREE.Vector3(...profile.soilTint) };
    shader.uniforms.uGdSlope = { value: new THREE.Vector3(...profile.slopeTint) };
    shader.uniforms.uGdSlopeRange = { value: new THREE.Vector2(profile.slopeStart, profile.slopeEnd) };
    shader.uniforms.uGdDamp = { value: new THREE.Vector3(...profile.dampTint) };
    shader.uniforms.uGdDampDepth = { value: profile.dampDepth };
    shader.uniforms.uGdDetail = { value: new THREE.Vector2(profile.detailScale, profile.detail) };
    shader.uniforms.uGdBand = { value: new THREE.Vector2(profile.band, profile.bandScale) };
    if (texUniforms) Object.assign(shader.uniforms, texUniforms);
    // Bound whenever the material CAN go hex, not only when this compile is
    // the hex one: three runs a program it reuses from its cache with the
    // uniforms object of whichever program it compiled LAST, so after an
    // off -> on flip a uniform bound only for the hex variant is never
    // uploaded again — the program keeps its stale value and a retune
    // silently does nothing (measured: five parameter sets, one frame).
    // Unused by the off program, and a uniform not in the source is not in
    // the program: the off shader's bytes do not change.
    if (hexState) shader.uniforms.uGroundHex = hexState.uniform;

    // Shared with addAtmosphere and the city's street grid; whichever runs
    // first declares it. Declared twice the shader does not compile, Three
    // draws nothing, and the entire ground disappears — which has happened.
    if (!shader.vertexShader.includes('varying vec3 vBirbWorld;')) {
      shader.vertexShader = 'varying vec3 vBirbWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvBirbWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    }
    if (!shader.fragmentShader.includes('varying vec3 vBirbWorld;')) {
      shader.fragmentShader = 'varying vec3 vBirbWorld;\n' + shader.fragmentShader;
    }

    // Smooth path only: take the slope from the smooth normal and bend the
    // LIGHTING normal back toward the facet on rock. This has to happen at
    // <normal_fragment_begin> — `normal` is folded into the lighting long
    // before <opaque_fragment>, so the tint block below cannot do it. The
    // two values it computes are declared in main()'s scope, which is where
    // <normal_fragment_begin> sits, so the tint block reads them for free.
    //
    // Derived in WORLD space off vBirbWorld rather than from vViewPosition:
    // the varying is already here for the tint, and it costs this injection
    // no assumption about which varyings the material happens to carry.
    if (smooth) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
      #include <normal_fragment_begin>
      vec3 gdUpW = normalize(vBirbWorld);
      vec3 gdFacetW = normalize(cross(dFdx(vBirbWorld), dFdy(vBirbWorld)));
      if (dot(gdFacetW, gdUpW) < 0.0) gdFacetW = -gdFacetW;
      // Read BEFORE the blend below overwrites it, or the slope measures its
      // own output and the rock term runs away with itself.
      vec3 gdSmoothW = inverseTransformDirection(normal, viewMatrix);
      float gdShadeSlope = 1.0 - clamp(dot(gdSmoothW, gdUpW), 0.0, 1.0);
      vec3 gdShadeW = gdSmoothW;
` + (texUniforms ? (hex ? HEX_SMOOTH_FETCH : `
      // The triplanar sample, HOISTED out of the tint block below so the
      // bump and the colour share ONE set of fetches. Still three, exactly
      // as before this existed.
      vec3 gtN0 = normalize(mix(gdUpW, gdFacetW, uGroundFacet));
      vec3 gtW0 = pow(abs(gtN0), vec3(uGroundSharp));
      gtW0 /= max(gtW0.x + gtW0.y + gtW0.z, 1e-4);
      vec3 gdTex = texture2D(uGroundMap, vBirbWorld.zy / uGroundTile).rgb * gtW0.x
            + texture2D(uGroundMap, vBirbWorld.xz / uGroundTile).rgb * gtW0.y
            + texture2D(uGroundMap, vBirbWorld.xy / uGroundTile).rgb * gtW0.z;
`) + `
      // The soil albedo's own luminance IS a height field, and its
      // screen-space gradient is that field's slope — so relief costs no
      // normal map and no extra fetch. Same construction as three's
      // perturbNormalArb, done in world space because everything else here
      // already is.
      //
      // Faded with view distance: at altitude one texel spans less than a
      // pixel and an unfaded bump is just aliasing that crawls when the
      // camera moves. It is a PERCH effect — a grazing camera three units
      // off the ground, where the soil otherwise reads as a photograph laid
      // flat — and it should be gone before it can shimmer.
      if (uGroundBump > 0.0) {
        float gdH = dot(gdTex, vec3(0.299, 0.587, 0.114));
        vec3 gdSX = dFdx(vBirbWorld);
        vec3 gdSY = dFdy(vBirbWorld);
        vec3 gdR1 = cross(gdSY, gdShadeW);
        vec3 gdR2 = cross(gdShadeW, gdSX);
        float gdDet = dot(gdSX, gdR1);
        // Solved, not picked. Wanted ~5 units of effective strength at a
        // perch (4 units) and ~1 by ordinary flight altitude (25): the ratio
        // fixes the rate at ln(5)/21 = 0.077, and the strength follows.
        float gdFade = exp(-length(cameraPosition - vBirbWorld) * 0.08);
        vec3 gdGrad = sign(gdDet) * (dFdx(gdH) * gdR1 + dFdy(gdH) * gdR2);
        gdShadeW = normalize(abs(gdDet) * gdShadeW - gdGrad * uGroundBump * gdFade);
      }
` : ``) + `
      gdShadeW = normalize(mix(gdShadeW, gdFacetW,
        smoothstep(uGdSlopeRange.x, uGdSlopeRange.y, gdShadeSlope)));
      normal = normalize((viewMatrix * vec4(gdShadeW, 0.0)).xyz);
      `);
    }

    shader.fragmentShader =
      'uniform float uGdBase; uniform float uGdScale;\n'
      + 'uniform vec3 uGdMoss; uniform vec3 uGdSoil; uniform vec3 uGdSlope;\n'
      + 'uniform vec2 uGdSlopeRange; uniform vec3 uGdDamp;\n'
      + 'uniform float uGdDampDepth; uniform vec2 uGdDetail; uniform vec2 uGdBand;\n'
      + (texUniforms
        ? 'uniform sampler2D uGroundMap; uniform float uGroundTile; uniform float uGroundSharp;\n'
          + 'uniform float uGroundFacet; uniform vec3 uGroundGain; uniform float uGroundMix;\n'
          + 'uniform float uGroundBump;\n'
        : '')
      + (hex ? HEX_TILE_GLSL : '')
      + `
      float gdHash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }
      // One octave of 3D value noise. One is enough: the slope term below
      // carries the structure, and the noise only has to break up the flat
      // facets. A stack of octaves here is fill-rate spent on a phone for a
      // difference nobody sees at flight altitude.
      float gdNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = gdHash(i + vec3(0.0, 0.0, 0.0));
        float n100 = gdHash(i + vec3(1.0, 0.0, 0.0));
        float n010 = gdHash(i + vec3(0.0, 1.0, 0.0));
        float n110 = gdHash(i + vec3(1.0, 1.0, 0.0));
        float n001 = gdHash(i + vec3(0.0, 0.0, 1.0));
        float n101 = gdHash(i + vec3(1.0, 0.0, 1.0));
        float n011 = gdHash(i + vec3(0.0, 1.0, 1.0));
        float n111 = gdHash(i + vec3(1.0, 1.0, 1.0));
        return mix(
          mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
          mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
          f.z);
      }
      `
      + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      {
        vec3 gdP = vBirbWorld;
        vec3 gdUp = normalize(gdP);
` + (smooth ? `
        // Both already computed at <normal_fragment_begin>, from the SMOOTH
        // normal — see the module doc for why the facet normal is the wrong
        // slope source the moment the surface is lit per fragment.
        vec3 gdN = gdFacetW;
        float gdSlope = gdShadeSlope;
` : `
        // The FACET normal, from the interpolated world position. Free, and
        // exactly right for flat-shaded low-poly ground: no attribute, no
        // tangent frame, and it agrees with the visible faceting rather than
        // with a smoothed vertex normal that does not.
        vec3 gdN = normalize(cross(dFdx(gdP), dFdy(gdP)));
        if (dot(gdN, gdUp) < 0.0) gdN = -gdN;
        float gdSlope = 1.0 - clamp(dot(gdN, gdUp), 0.0, 1.0);
`) + `
        // Macro patches, plus a finer cell mixed in. Two calls, not an octave
        // stack: the slope term below carries the structure and the noise only
        // has to break up the facets, so a third octave is fill rate spent on
        // a phone for a difference nobody sees at flight altitude.
        float gdM = gdNoise(gdP * uGdScale);
        gdM = mix(gdM, gdNoise(gdP * uGdScale * uGdDetail.x), uGdDetail.y);
        vec3 gdTint = mix(uGdSoil, uGdMoss, smoothstep(0.32, 0.70, gdM));

        // Steep ground sheds whatever lies on it. On the mountain this IS the
        // mountain: rock on the faces, snow on the flats.
        gdTint = mix(gdTint, uGdSlope,
          smoothstep(uGdSlopeRange.x, uGdSlopeRange.y, gdSlope));

        // Depth below the base radius. The terrain only ever carves DOWNWARD
        // (the gravity-less-floor invariant), so this is >= 0 everywhere and
        // reads straight as "how deep in the valley am I".
        float gdDepth = max(0.0, uGdBase - length(gdP));
        gdTint = mix(gdTint, gdTint * uGdDamp,
          smoothstep(0.0, uGdDampDepth, gdDepth));

        // Sediment banding by RADIUS, so the layers stay level everywhere on
        // the planet — the same reason the canyon walls band by radius rather
        // than by height above a local ground plane.
        if (uGdBand.x > 0.0) {
          float gdR = length(gdP);
          float gdBand = sin(gdR * uGdBand.y) * 0.68 + sin(gdR * uGdBand.y * 2.37 + 1.7) * 0.32;
          gdTint *= 1.0 + gdBand * uGdBand.x;
        }
` + (texUniforms && smooth ? `
        // Already fetched at <normal_fragment_begin>, where the bump needed
        // it. Three fetches for the frame, not six.
        gdTint *= mix(vec3(1.0), gdTex * uGroundGain, uGroundMix);
` : texUniforms ? (hex ? HEX_FLAT_OVERLAY : `
        // Authored ground overlay, triplanar off world position. See the
        // function doc comment above for why sphere-normal blending, why the
        // weights are renormalised, and why uGroundMix (not a clamp) is what
        // keeps this at the file's own mean.
        vec3 gtN = normalize(mix(gdUp, gdN, uGroundFacet));
        vec3 gtW = pow(abs(gtN), vec3(uGroundSharp));
        gtW /= max(gtW.x + gtW.y + gtW.z, 1e-4);
        vec2 gtUvX = gdP.zy / uGroundTile;
        vec2 gtUvY = gdP.xz / uGroundTile;
        vec2 gtUvZ = gdP.xy / uGroundTile;
        // texture2D returns LINEAR here: SRGBColorSpace decodes in hardware
        // (the texture's internal format), not in map_fragment, so this is
        // correct for any sampler, not only the map slot. gdTint is already
        // linear, so the two multiply directly with no extra conversion.
        vec3 gtTex = texture2D(uGroundMap, gtUvX).rgb * gtW.x
                   + texture2D(uGroundMap, gtUvY).rgb * gtW.y
                   + texture2D(uGroundMap, gtUvZ).rgb * gtW.z;
        gdTint *= mix(vec3(1.0), gtTex * uGroundGain, uGroundMix);
`) : '') + `
        outgoingLight *= gdTint;
      }

      #include <opaque_fragment>
    `);
  };

  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () =>
    `${base}-ground-${biome}${texUniforms ? '-tex' : ''}${smooth ? '-smooth' : ''}${smooth && bump > 0 ? '-bump' : ''}${hexState && hexState.enabled ? '-hex' : ''}`;
  material.needsUpdate = true;
  return material;
}
