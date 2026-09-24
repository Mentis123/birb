/**
 * Shared measurement for the hex-tiling checks. No default export, so the
 * runner loads it and skips it; every check imports it, so a measurement and
 * its control are the SAME code.
 *
 * The question is whether the forest ground map repeats. The authored map is
 * laid every GROUND_TILE_UNITS (18) along the projection's own axes, so a
 * repeating ground is a frame that correlates with ITSELF shifted by one tile
 * period — and a hex-tiled one should not. The frame is:
 *
 *  - the cockpit camera `above` units over the ground, looking straight down
 *    the local radial, with the simulation clock held (__BIRB.hold), so the
 *    same pose photographs the same pixels every time;
 *  - the ground alone: props hidden with __BIRB.solo, horizon shadows off (a
 *    canopy's baked shadow is not the texture), the sun clock stopped;
 *  - RECTIFIED onto the dominant projection's own (u, v) grid (rectifyGrid
 *    below says why a straight-down frame is still not a map), where one
 *    tile is exactly TILE / spacing samples everywhere.
 *
 * The rectified frame is band-passed (a difference of box blurs) before
 * correlating: the procedural moss/soil mottling is value noise on ~18- and
 * ~4-unit cells, common to both arms of the A/B and NOT periodic, and the
 * lighting's slow gradients are not the texture either. What survives is
 * the map's own grain — and the verdict is the one-tile correlation against
 * the SAME statistic at 64 lags that are not a tile, never against a fixed
 * number, because every frame has its own floor.
 */

import { GROUND_PROFILES } from '../../src/environment/ground-detail.js';

export const TILE = 18; // authored-textures.js GROUND_TILE_UNITS

const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

/** Sun at cycle time `t`, then the clock stopped. */
export async function holdSun(ctx, t = 0) {
  await ctx.page.evaluate((s) => { const B = window.__BIRB; B.setSunTime(s); B.setSunEnabled(true); }, t);
  await ctx.frames(3);
  await ctx.page.evaluate(() => window.__BIRB.setSunEnabled(false));
  await ctx.frames(2);
}

/**
 * Cockpit camera `above` units over the ground at direction U, looking
 * straight down, clock held, only the ground drawn. Returns the bird position
 * and the pixel lag of one tile period (and its negative) at the nadir.
 */
export async function topDownGround(ctx, { U = [1, 0.08, 0.05], above = 40 } = {}) {
  const { page } = ctx;
  // The weather is not the ground, and it is not under __BIRB.solo: a pollen
  // mote near the lens drew a pale disc over the frame's edge on one boot in
  // four and halved the triplanar's measured repeat. Reduced motion is the
  // game's own switch for it (weather density 0); nothing else it gates
  // (wind, water, shake, speed FOV) is in a held, props-hidden frame.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const B = window.__BIRB;
    B.pinTier?.(0);
    B.setCameraView('fpv');
    B.horizon?.(0);
    B.birdShadow?.(0);
    B.solo('sphere-ground');
  });
  await holdSun(ctx, 0);
  const up = norm(U);
  const pos = await page.evaluate(({ U, above }) => {
    const B = window.__BIRB;
    B.hold(false);
    return B.teleport(U[0], U[1], U[2], above);
  }, { U, above });
  const quaternion = ctx.levelQuat(up, Math.PI / 2);
  await page.evaluate(({ pos, quaternion }) => {
    const B = window.__BIRB;
    B.restorePose({ position: pos, quaternion });
    B.freeze(true);
    B.hold(true);
  }, { pos, quaternion });
  await ctx.frames(6);
  const geo = await page.evaluate(async ({ pos, TILE }) => {
    const { sampleTerrainHeight } = await import('/src/environment/spherical-world.js');
    const B = window.__BIRB;
    const R = 120;
    const len = Math.hypot(...pos);
    const d0 = pos.map((v) => v / len);
    const P0 = d0.map((v) => v * (R + sampleTerrainHeight(...d0)));
    // The dominant projection axis, and the ground point one tile along its
    // v coordinate (X reads zy, Y reads xz, Z reads xy — ground-detail.js).
    const a = [0, 1, 2].reduce((m, i) => (Math.abs(d0[i]) > Math.abs(d0[m]) ? i : m), 0);
    const vAxis = a === 0 ? 1 : 2;
    const onGround = (shift) => {
      const Q = P0.slice();
      Q[vAxis] += shift;
      for (let k = 0; k < 6; k++) {
        const l = Math.hypot(...Q);
        const r = R + sampleTerrainHeight(Q[0] / l, Q[1] / l, Q[2] / l);
        const rest = Q.reduce((s, v, i) => (i === a ? s : s + v * v), 0);
        Q[a] = Math.sign(P0[a]) * Math.sqrt(Math.max(0, r * r - rest));
      }
      return Q;
    };
    const p0 = B.project(...P0);
    const pf = B.project(...onGround(TILE));
    const pb = B.project(...onGround(-TILE));
    return { axis: 'xyz'[a], vAxis: 'xyz'[vAxis], P0, p0, pf, pb };
  }, { pos, TILE });
  const lag = geo.p0 && geo.pf ? [geo.pf[0] - geo.p0[0], geo.pf[1] - geo.p0[1]] : null;
  const lagBack = geo.p0 && geo.pb ? [geo.pb[0] - geo.p0[0], geo.pb[1] - geo.p0[1]] : null;
  return { pos, ...geo, lag, lagBack };
}

/**
 * RECTIFY the frame onto the texture's own grid. A straight-down perspective
 * view is not a map: on this pose one tile measures 403 px up the frame and
 * 353 px down it (relief and the planet's curvature), so no single pixel
 * shift aligns the whole frame and the raw frame correlates with itself at
 * 0.02-0.08 at EVERY vertical lag, repeating ground or not. So the question
 * is asked in the projection's own coordinates instead: a grid of ground
 * points at fixed (u, v) — X reads (z, y), Y reads (x, z), Z reads (x, y),
 * as ground-detail.js does — each solved onto the terrain along the
 * projection axis and projected to a pixel. Sampling the frame there gives
 * the ground as the texture sees it, where one tile is exactly
 * TILE / spacing samples everywhere.
 *
 * The terrain is sampled on a 1-unit lattice and interpolated (it is smooth
 * at that scale; the mesh's own vertices are 5-7 units apart), so the grid
 * costs a few hundred height evaluations, not tens of thousands.
 */
export async function rectifyGrid(ctx, view, { spacing = 0.1, u = [-9, 9], v = [-21, 21] } = {}) {
  return ctx.page.evaluate(async ({ P0, axis, spacing, u, v }) => {
    const { sampleTerrainHeight } = await import('/src/environment/spherical-world.js');
    const B = window.__BIRB;
    const R = 120;
    const a = 'xyz'.indexOf(axis);
    const [iu, iv] = a === 0 ? [2, 1] : a === 1 ? [0, 2] : [0, 1];
    const sgn = Math.sign(P0[a]) || 1;
    // Ground along the projection axis at (u, v): |p| = R + h(p/|p|).
    const solve = (du, dv) => {
      const p = P0.slice();
      p[iu] += du; p[iv] += dv;
      for (let k = 0; k < 6; k++) {
        const l = Math.hypot(...p);
        const r = R + sampleTerrainHeight(p[0] / l, p[1] / l, p[2] / l);
        p[a] = sgn * Math.sqrt(Math.max(0, r * r - p[iu] * p[iu] - p[iv] * p[iv]));
      }
      return p[a];
    };
    const lu0 = Math.floor(u[0]) - 1; const lu1 = Math.ceil(u[1]) + 1;
    const lv0 = Math.floor(v[0]) - 1; const lv1 = Math.ceil(v[1]) + 1;
    const lat = [];
    for (let j = lv0; j <= lv1; j++) { const row = []; for (let i = lu0; i <= lu1; i++) row.push(solve(i, j)); lat.push(row); }
    const heightAt = (du, dv) => {
      const fx = du - lu0; const fy = dv - lv0;
      const x0 = Math.floor(fx); const y0 = Math.floor(fy); const tx = fx - x0; const ty = fy - y0;
      const r0 = lat[y0]; const r1 = lat[y0 + 1];
      return (r0[x0] * (1 - tx) + r0[x0 + 1] * tx) * (1 - ty) + (r1[x0] * (1 - tx) + r1[x0 + 1] * tx) * ty;
    };
    const nU = Math.round((u[1] - u[0]) / spacing) + 1;
    const nV = Math.round((v[1] - v[0]) / spacing) + 1;
    const sx = new Array(nU * nV); const sy = new Array(nU * nV);
    for (let j = 0; j < nV; j++) {
      const dv = v[0] + j * spacing;
      for (let i = 0; i < nU; i++) {
        const du = u[0] + i * spacing;
        const p = P0.slice();
        p[iu] += du; p[iv] += dv; p[a] = heightAt(du, dv);
        const px = B.project(p[0], p[1], p[2]);
        sx[j * nU + i] = px ? +px[0].toFixed(2) : -1;
        sy[j * nU + i] = px ? +px[1].toFixed(2) : -1;
      }
    }
    return { nU, nV, spacing, sx, sy };
  }, { P0: view.P0, axis: view.axis, spacing, u, v });
}

/**
 * The frame's linear luminance at every grid point (bilinear), NaN where the
 * point falls outside `safe` = [x0, y0, x1, y1] (off the canvas, or under the
 * DOM the game draws over it).
 */
export function rectify(png, grid, safe, exclude = [], mask = null) {
  const lum = luminance(png);
  const { nU, nV, sx, sy } = grid;
  const out = new Float32Array(nU * nV);
  const [x0, y0, x1, y1] = safe;
  for (let k = 0; k < nU * nV; k++) {
    const x = sx[k] - 0.5; const y = sy[k] - 0.5;
    const covered = exclude.some(([ex0, ey0, ex1, ey1]) => x >= ex0 && x < ex1 && y >= ey0 && y < ey1)
      || (mask && mask[Math.round(y) * png.w + Math.round(x)]);
    if (covered || !(x >= x0 && x < x1 - 1 && y >= y0 && y < y1 - 1)) { out[k] = NaN; continue; }
    const xi = Math.floor(x); const yi = Math.floor(y); const tx = x - xi; const ty = y - yi;
    const i = yi * png.w + xi;
    out[k] = (lum[i] * (1 - tx) + lum[i + 1] * tx) * (1 - ty) + (lum[i + png.w] * (1 - tx) + lum[i + png.w + 1] * tx) * ty;
  }
  return out;
}

/**
 * Pixels that are not ground, in ANY of the frames: anything whose 9x9-pixel
 * mean luminance is far off the frame's own median (a drone, a mote at the
 * lens, a cloud), grown by `grow` px. One mask for every frame of an A/B, so
 * both arms are measured over the same cells. The blur is what lets a bright
 * pebble through — it is the texture — while a disc forty pixels across is
 * not. Returns { mask, fraction }, the fraction over `safe` less `exclude`.
 * It also takes the brightest sunlit gravel (a few per cent of a frame):
 * harmless, both arms lose the same cells.
 */
export function intrusionMask(pngs, safe, exclude = [], { hi = 1.7, lo = 0.5, grow = 8 } = {}) {
  const { w, h } = pngs[0];
  const [x0, y0, x1, y1] = safe;
  const excluded = (x, y) => exclude.some(([ex0, ey0, ex1, ey1]) => x >= ex0 && x < ex1 && y >= ey0 && y < ey1);
  const hit = new Float32Array(w * h);
  for (const png of pngs) {
    const blur = boxBlur(luminance(png), w, h, 4);
    const vals = [];
    for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) vals.push(blur[y * w + x]);
    vals.sort((a, b) => a - b);
    const med = vals[vals.length >> 1];
    for (let i = 0; i < w * h; i++) if (blur[i] > hi * med || blur[i] < lo * med) hit[i] = 1;
  }
  const grown = boxBlur(hit, w, h, grow);
  const mask = new Uint8Array(w * h);
  let n = 0; let masked = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (grown[i] > 1e-6) mask[i] = 1;
      if (excluded(x, y)) continue;
      if (mask[i]) masked++;
      n++;
    }
  }
  return { mask, fraction: masked / n };
}

/** Band-pass that ignores NaN holes (normalised convolution of two box blurs). */
function maskedBandpass(img, w, h, r1, r2) {
  const val = new Float32Array(w * h); const msk = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const ok = Number.isFinite(img[i]); val[i] = ok ? img[i] : 0; msk[i] = ok ? 1 : 0; }
  const blur = (r) => {
    const a = r > 0 ? boxBlur(val, w, h, r) : val; const m = r > 0 ? boxBlur(msk, w, h, r) : msk;
    const o = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) o[i] = m[i] > 0.25 ? a[i] / m[i] : NaN;
    return o;
  };
  const fine = blur(r1); const coarse = blur(r2);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Number.isFinite(img[i]) ? fine[i] - coarse[i] : NaN;
  return out;
}

/** NCC of a rectified image with itself shifted (du, dv) samples, over the cells where both are valid. */
function gridNcc(img, nU, nV, du, dv) {
  let sa = 0; let sb = 0; let n = 0;
  for (let j = Math.max(0, -dv); j < Math.min(nV, nV - dv); j++) {
    for (let i = Math.max(0, -du); i < Math.min(nU, nU - du); i++) {
      const a = img[j * nU + i]; const b = img[(j + dv) * nU + i + du];
      if (Number.isFinite(a) && Number.isFinite(b)) { sa += a; sb += b; n++; }
    }
  }
  if (n < 500) return { r: NaN, n };
  const ma = sa / n; const mb = sb / n;
  let num = 0; let da = 0; let db = 0;
  for (let j = Math.max(0, -dv); j < Math.min(nV, nV - dv); j++) {
    for (let i = Math.max(0, -du); i < Math.min(nU, nU - du); i++) {
      const a = img[j * nU + i]; const b = img[(j + dv) * nU + i + du];
      if (Number.isFinite(a) && Number.isFinite(b)) { num += (a - ma) * (b - mb); da += (a - ma) ** 2; db += (b - mb) ** 2; }
    }
  }
  return { r: num / Math.sqrt(da * db || 1), n };
}

/**
 * The procedural mottling's finer value-noise lattice, in units: the one
 * STRUCTURED lag in this frame that is not the map's. Value noise correlates
 * with itself one lattice cell away (neighbouring cells share four corner
 * values), so the frame has a floor of correlation there with or without
 * the map — the honest yardstick for "no longer stands out".
 */
export const DETAIL_LATTICE = 1 / (GROUND_PROFILES.forest.noiseScale * GROUND_PROFILES.forest.detailScale);

/**
 * Repetition in texture space: the NCC at exactly one tile along v (best of
 * +/-1 sample, for the rounding of the lattice), against control lags that
 * are not a tile — 0.37 and 0.61 of one along v, a third of one across it,
 * and the procedural detail lattice (DETAIL_LATTICE) along v.
 * Band-passed between ~r1 and ~r2 samples (0.1 unit each by default, so
 * 0.1-1.2 units: the gravel's grain and clumps, not the mottling or the
 * light). Chosen on the null's width, not on the answer: a coarser band
 * (0.2-2.4) lets the flat ground's facet edges in and doubles the null's
 * spread there (sd 0.05 against 0.023), while the triplanar still reads
 * z > 10 on both grounds in this one.
 */
export function rectifiedRepetition(rect, grid, { r1 = 1, r2 = 12, nullLags = 64 } = {}) {
  const { nU, nV, spacing } = grid;
  const band = maskedBandpass(rect, nU, nV, r1, r2);
  const lag = Math.round(TILE / spacing);
  const at = (du, dv) => gridNcc(band, nU, nV, du, dv);
  const best = (du, dv) => {
    let b = { r: -Infinity };
    for (const d of [-1, 0, 1]) { const x = at(du, dv + d); if (x.r > b.r) b = { ...x, lag: dv + d }; }
    return b;
  };
  // The null: the same statistic (best of three) at pseudo-random lags that
  // are not a tile, 3-23 units along v and up to 11 across, deterministic.
  // One tile either stands out of this distribution or it does not.
  let s = 0x9e3779b9;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const vals = [];
  while (vals.length < nullLags) {
    const du = Math.round((rnd() * 2 - 1) * 11 / spacing);
    const dv = Math.round((3 + rnd() * 20) / spacing);
    if (Math.abs(dv - lag) * spacing < 1.5 && Math.abs(du) * spacing < 1.5) continue;
    const x = best(du, dv);
    if (Number.isFinite(x.r)) vals.push(x.r);
  }
  const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  const period = best(0, lag);
  return {
    period,
    controls: [
      best(0, Math.round(lag * 0.37)), best(0, Math.round(lag * 0.61)), best(Math.round(lag / 3), 0),
      best(0, Math.round(DETAIL_LATTICE / spacing)),
    ],
    null: { n: vals.length, mean, sd, max: Math.max(...vals), z: (period.r - mean) / (sd || 1) },
    samplesPerTile: lag,
  };
}

// Pixels the game's own DOM covers: the minimap and its gear (top right),
// the BOOST pill and the settings gear (bottom right).
export const SAFE = [4, 4, 386, 770];
export const EXCLUDE = [[244, 0, 390, 146]];
export const ROI = [16, 150, 240, 740];

/**
 * The whole A/B, shared by every check that asks "does it repeat": place the
 * view, build the grid, then hex OFF, ON, OFF, ON by runtime recompile, and
 * measure each frame. Returns everything the checks assert on.
 */
export async function measureHexAB(ctx, { U = [1, 0.08, 0.05], above = 40, band = {}, dump = null } = {}) {
  const { page } = ctx;
  const view = await topDownGround(ctx, { U, above });
  if (!view.lag) return { view };
  const grid = await rectifyGrid(ctx, view);
  if (dump) dump(grid);
  const shots = {};
  for (const [label, on] of [['off-1', false], ['on-1', true], ['off-2', false], ['on-2', true]]) {
    const state = await page.evaluate((v) => window.__BIRB.hexTile(v), on);
    await ctx.frames(4);
    shots[label] = { png: await ctx.shot(`hex-${label}`), state };
  }
  // One intrusion mask for all four frames, so both arms are measured over
  // the same cells; the check fails loudly if it has to hide much.
  const intrusion = intrusionMask(Object.values(shots).map((s) => s.png), SAFE, EXCLUDE);
  for (const s of Object.values(shots)) {
    const rect = rectify(s.png, grid, SAFE, EXCLUDE, intrusion.mask);
    s.rep = rectifiedRepetition(rect, grid, band);
    s.mean = roiMean(luminance(s.png), s.png.w, ROI);
    // The trap, kept on the record: the same question asked in raw pixels.
    s.rawPixel = repetition(s.png, ROI, view.lag, null).period.r;
  }
  return {
    view,
    grid,
    shots,
    intrusion: intrusion.fraction,
    noise: {
      off: meanAbsDiff(shots['off-1'].png, shots['off-2'].png, ROI),
      on: meanAbsDiff(shots['on-1'].png, shots['on-2'].png, ROI),
      arms: meanAbsDiff(shots['off-1'].png, shots['on-1'].png, ROI),
    },
  };
}

/** Put every lever these checks touch back where the runner expects it. */
export async function restore(ctx) {
  await ctx.page.emulateMedia({ reducedMotion: null });
  await ctx.page.evaluate(async () => {
    const B = window.__BIRB;
    B.solo(null);
    B.hold(false);
    B.horizon?.(1);
    B.birdShadow?.(1);
    B.setCameraView('chase');
    B.setSunEnabled(true);
    B.freeze(false);
    await B.hexTile?.(true);
  });
  await ctx.frames(4);
}

// ---- pixel analysis (Node side) ----

/** Linear-light luminance of every pixel, as a Float32Array (w*h). */
export function luminance(png) {
  const { w, h, ch, data } = png;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; lut[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.2126 * lut[data[i * ch]] + 0.7152 * lut[data[i * ch + 1]] + 0.0722 * lut[data[i * ch + 2]];
  }
  return out;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0; let n = 0;
    for (let x = -r; x < w + r; x++) {
      const add = x + r; const sub = x - r - 1;
      if (add >= 0 && add < w) { s += src[y * w + add]; n++; }
      if (sub >= 0 && sub < w) { s -= src[y * w + sub]; n--; }
      if (x >= 0 && x < w) tmp[y * w + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0; let n = 0;
    for (let y = -r; y < h + r; y++) {
      const add = y + r; const sub = y - r - 1;
      if (add >= 0 && add < h) { s += tmp[add * w + x]; n++; }
      if (sub >= 0 && sub < h) { s -= tmp[sub * w + x]; n--; }
      if (y >= 0 && y < h) out[y * w + x] = s / n;
    }
  }
  return out;
}

/** Difference of box blurs: keeps structure between ~r1 and ~r2 pixels. */
export function bandpass(lum, w, h, r1 = 1, r2 = 10) {
  const a = r1 > 0 ? boxBlur(lum, w, h, r1) : lum;
  const b = boxBlur(lum, w, h, r2);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = a[i] - b[i];
  return out;
}

/**
 * Normalised cross-correlation of the ROI with itself shifted by (dx, dy),
 * over the part of the ROI whose shifted partner is also inside it.
 * roi = [x0, y0, x1, y1] in pixels.
 */
export function ncc(img, w, roi, dx, dy) {
  const [x0, y0, x1, y1] = roi;
  let sa = 0; let sb = 0; let n = 0;
  const xs = Math.max(x0, x0 - dx); const xe = Math.min(x1, x1 - dx);
  const ys = Math.max(y0, y0 - dy); const ye = Math.min(y1, y1 - dy);
  if (xe - xs < 8 || ye - ys < 8) return NaN;
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) { sa += img[y * w + x]; sb += img[(y + dy) * w + x + dx]; n++; }
  }
  const ma = sa / n; const mb = sb / n;
  let num = 0; let da = 0; let db = 0;
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) {
      const a = img[y * w + x] - ma; const b = img[(y + dy) * w + x + dx] - mb;
      num += a * b; da += a * a; db += b * b;
    }
  }
  return num / Math.sqrt(da * db || 1);
}

/** The highest NCC within +/-search pixels of `lag`, and where it was. */
export function peakNear(img, w, roi, lag, search = 10) {
  let best = { r: -Infinity, at: null };
  const lx = Math.round(lag[0]); const ly = Math.round(lag[1]);
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      const r = ncc(img, w, roi, lx + dx, ly + dy);
      if (r > best.r) best = { r, at: [lx + dx, ly + dy] };
    }
  }
  return best;
}

/** Mean of a Float32Array over the ROI. */
export function roiMean(lum, w, roi) {
  const [x0, y0, x1, y1] = roi;
  let s = 0; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum[y * w + x]; n++; }
  return s / n;
}

/** Mean absolute difference of two decoded PNGs over the ROI, 0-255 units. */
export function meanAbsDiff(a, b, roi) {
  const [x0, y0, x1, y1] = roi;
  let s = 0; let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.w + x) * a.ch;
      s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      n += 3;
    }
  }
  return s / n;
}

/**
 * Everything one frame says about repetition: the correlation peak at +one
 * period and -one period (searched), and at two control lags that are not a
 * period (half a tile along the same axis, and a quarter tile across it).
 */
export function repetition(png, roi, lag, lagBack, { r1 = 1, r2 = 10, search = 10 } = {}) {
  const lum = luminance(png);
  const band = bandpass(lum, png.w, png.h, r1, r2);
  const fwd = peakNear(band, png.w, roi, lag, search);
  const back = lagBack ? peakNear(band, png.w, roi, lagBack, search) : null;
  const half = peakNear(band, png.w, roi, [lag[0] / 2, lag[1] / 2], search);
  const across = peakNear(band, png.w, roi, [-lag[1] / 4, lag[0] / 4], search);
  return { period: fwd, periodBack: back, half, across, mean: roiMean(lum, png.w, roi) };
}
