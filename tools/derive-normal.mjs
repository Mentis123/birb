#!/usr/bin/env node
/**
 * derive-normal.mjs — deterministic, dependency-free normal-map derivation
 * from a tiling albedo.
 *
 * There is no scan, no height field and no build step in this repo — an
 * authored albedo is the only signal on disk. This derives a plausible
 * tangent-space normal map from it the same way `bark_pine_normal.png` and
 * `stone_rock_normal.png` were made, so a new albedo does not have to ship
 * flat-lit while waiting on an artist-authored height field.
 *
 * Pipeline, all wrap-aware (circular indexing) because every consumer is a
 * TILING material — a normal map with a seam is worse than none, and reads
 * as a fault line across every hillside it is mapped onto:
 *
 *   1. Luminance from the albedo — the only per-pixel signal we have.
 *   2. A MULTISCALE height proxy: three wrap-aware box blurs at increasing
 *      radius, combined as the octave differences between them (a small
 *      discrete Laplacian-pyramid reconstruction). A single blur radius
 *      picks one relief scale and misses either the fine grain or the
 *      broad undulation; summing several octaves gets both without a real
 *      height field to sample.
 *   3. A wrap-aware 3x3 Sobel gradient of that proxy, taken after a light
 *      radius-2 pre-smooth — circular indices across the wrap, so the
 *      gradient at column 0 sees column w-1 as its left neighbour instead
 *      of falling back to a clamped edge. The pre-smooth is load-bearing,
 *      not cosmetic: `city_concrete_albedo` passes the raw-luminance tiling
 *      check at a 0.03x seam ratio (the wrap matches in VALUE) but its
 *      Sobel gradient measured 8.0x/6.4x undiffused — an AI-generated
 *      "seamless" tile can match tone across the wrap while its per-pixel
 *      grain does not, and a derivative is a high-pass filter that makes
 *      exactly that invisible-in-value mismatch visible. Radius 2 was the
 *      smallest that brought every one of the five new albedos back under
 *      the gate's 3x ratio (measured 1.95x/2.69x for concrete at r=2, still
 *      9.1x/6.9x at r=1); radius 3 buys no further margin worth the extra
 *      blur.
 *   4. Pack to a unit tangent-space vector, OpenGL +Y (green-up): X is the
 *      negated horizontal gradient, Y is the POSITIVE vertical gradient.
 *      That sign pair is not asserted here from theory — it is what makes
 *      tools/lib/asset-analysis.mjs's normalConvention() correlate the same
 *      way the two existing shipped normals do (rG positive, rR negative
 *      against their own sibling albedo); asset-check is the oracle this
 *      derivation is built to satisfy, not a check bolted on afterward.
 *
 *   node tools/derive-normal.mjs <albedo.png> <out_normal.png> [--strength N]
 *
 * --strength (default 3.2) scales the gradient before it is folded into Z;
 * higher reads bumpier and pulls the mean blue channel down. Zero
 * dependencies: PNG in and out goes through tools/lib/asset-analysis.mjs's
 * own zlib-based codec, the same one asset-check measures with.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from './lib/asset-analysis.mjs';

const wrap = (i, n) => ((i % n) + n) % n;

function luminance(p) {
  const { w, h, ch, data } = p;
  const L = new Float64Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * ch;
    L[i] = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
  }
  return L;
}

/**
 * Wrap-aware separable box blur, radius r, on a flat w*h Float64Array.
 * Separable because a box filter's 2D kernel is the outer product of two 1D
 * kernels — blurring rows then columns gives the exact same result as a
 * square kernel at a fraction of the cost, and a sliding-sum pass makes each
 * direction O(n) instead of O(n*r).
 */
function boxBlurWrap(src, w, h, r) {
  if (r <= 0) return src.slice();
  const tmp = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  const norm = 1 / (2 * r + 1);

  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k += 1) acc += src[row + wrap(k, w)];
    for (let x = 0; x < w; x += 1) {
      tmp[row + x] = acc * norm;
      acc += src[row + wrap(x + r + 1, w)] - src[row + wrap(x - r, w)];
    }
  }
  for (let x = 0; x < w; x += 1) {
    let acc = 0;
    for (let k = -r; k <= r; k += 1) acc += tmp[wrap(k, h) * w + x];
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = acc * norm;
      acc += tmp[wrap(y + r + 1, h) * w + x] - tmp[wrap(y - r, h) * w + x];
    }
  }
  return out;
}

/** Multiscale height proxy: sum of octave differences between three radii. */
function heightProxy(L, w, h) {
  const b1 = boxBlurWrap(L, w, h, 1);
  const b2 = boxBlurWrap(L, w, h, 4);
  const b3 = boxBlurWrap(L, w, h, 12);
  const H = new Float64Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    H[i] = 0.5 * (L[i] - b1[i]) + 0.35 * (b1[i] - b2[i]) + 0.15 * (b2[i] - b3[i]);
  }
  return H;
}

/** Wrap-aware 3x3 Sobel gradient of a flat w*h Float64Array. */
function sobelWrap(H, w, h) {
  const at = (x, y) => H[wrap(y, h) * w + wrap(x, w)];
  const gx = new Float64Array(w * h);
  const gy = new Float64Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      gx[i] = (
        (at(x + 1, y - 1) - at(x - 1, y - 1))
        + 2 * (at(x + 1, y) - at(x - 1, y))
        + (at(x + 1, y + 1) - at(x - 1, y + 1))
      ) / 8;
      gy[i] = (
        (at(x - 1, y + 1) - at(x - 1, y - 1))
        + 2 * (at(x, y + 1) - at(x, y - 1))
        + (at(x + 1, y + 1) - at(x + 1, y - 1))
      ) / 8;
    }
  }
  return { gx, gy };
}

/**
 * Build the normal map buffer from a decoded albedo. Exported so
 * tests/tools can drive it without going through the filesystem.
 */
export function deriveNormal(albedo, strength = 3.2) {
  const { w, h } = albedo;
  const L = luminance(albedo);
  const H = heightProxy(L, w, h);
  // Pre-smooth before differentiating — see module doc for why r=2 is not optional.
  const Hs = boxBlurWrap(H, w, h, 2);
  const { gx, gy } = sobelWrap(Hs, w, h);
  const data = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    const nx = -gx[i] * strength;
    const ny = gy[i] * strength; // OpenGL +Y (green-up): see module doc.
    const nzSq = Math.max(0, 1 - nx * nx - ny * ny);
    const nz = Math.sqrt(nzSq);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const o = i * 3;
    data[o] = Math.round((nx / len * 0.5 + 0.5) * 255);
    data[o + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
    data[o + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
  }
  return { w, h, ch: 3, data };
}

function main() {
  const args = process.argv.slice(2);
  const strengthFlag = args.indexOf('--strength');
  const strength = strengthFlag >= 0 ? Number(args[strengthFlag + 1]) : 3.2;
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--strength');
  const [albedoPath, outPath] = positional;
  if (!albedoPath || !outPath) {
    console.error('usage: node tools/derive-normal.mjs <albedo.png> <out_normal.png> [--strength N]');
    process.exit(2);
  }
  const albedo = decodePng(fs.readFileSync(albedoPath), albedoPath);
  const normal = deriveNormal(albedo, strength);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, encodePng(normal));
  console.log(`${albedoPath} (${albedo.w}x${albedo.h}) -> ${outPath}, strength ${strength}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) main();
