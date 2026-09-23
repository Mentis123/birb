/**
 * Shared set-up and pixel measures for the cloud-volume checks. No default
 * export, so tools/birb-realism.mjs loads it as a library, not a check.
 *
 * Every measure here is an A/B inside ONE boot and ONE pose — clouds shown
 * vs hidden, shadow strength default vs 0 — with a repeat of the first
 * state as the control, because two boots never frame a cloud the same way
 * (the notes on the feather A/B in CLAUDE.md are why).
 */

export const SEED = 16160;
// Cloud 1 of the seeded mobile forest, with the sun 47 degrees above ITS
// horizon at t = 90 s (sun-cycle.js; measured, not assumed — goToCloud
// reports the elevation and the checks print it).
export const LOOK = { cloud: 1, sunTime: 90 };

const toLinear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

/** Seeded forest, tier pinned, sun at `sunTime` and then held. */
export async function setupForest(ctx, { sunTime = LOOK.sunTime, env = 'forest' } = {}) {
  await ctx.page.evaluate(({ seed, env, sunTime }) => {
    const B = window.__BIRB;
    B.worldSeed(seed);
    B.setEnvironment(env);
    B.pinTier(0);
    B.setSunTime(sunTime);
    B.setSunEnabled(true);
  }, { seed: SEED, env, sunTime });
  await ctx.frames(4);
  await ctx.page.evaluate(() => { window.__BIRB.setSunEnabled(false); window.__BIRB.freeze(true); });
  await ctx.frames(2);
}

/**
 * Re-pose every frame for `n` frames, then stop every clock (holdMotion).
 * freeze() does NOT hold the bird — the main loop re-asserts cruise speed
 * every frame, and its own comment says so — so a pose that has to be exact
 * on the frame it is photographed is set again on every frame until then.
 * `src` is a function body taking (B, arg); returns its last result.
 */
export async function holdPose(ctx, src, arg = null, n = 6) {
  const out = await ctx.page.evaluate(({ src, arg, n }) => new Promise((resolve) => {
    // eslint-disable-next-line no-new-func
    const f = new Function('B', 'arg', src);
    const B = window.__BIRB;
    let k = 0; let last = null;
    const step = () => {
      last = f(B, arg);
      k += 1;
      if (k < n) { requestAnimationFrame(step); return; }
      B.holdMotion(true);
      resolve({ last, recovery: B.flightProbe().recovery });
    };
    requestAnimationFrame(step);
  }), { src, arg, n });
  await ctx.frames(2);
  return out;
}

/** Put the sun at `t` seconds of the cycle and hold it there. */
export async function setSun(ctx, t) {
  await ctx.page.evaluate((s) => { const B = window.__BIRB; B.setSunTime(s); B.setSunEnabled(true); }, t);
  await ctx.frames(3);
  await ctx.page.evaluate(() => window.__BIRB.setSunEnabled(false));
  await ctx.frames(1);
}

/** Per-pixel luminance, sRGB 0-255 (or linear 0-1). */
export function lumArray(png, linear = false) {
  const { w, h, ch, data } = png;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const r = data[i * ch]; const g = data[i * ch + 1]; const b = data[i * ch + 2];
    out[i] = linear
      ? 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
      : 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return out;
}

/** Mean of `a` over square cells of `size` px: a coarse image, noise-free. */
export function cells(a, w, h, size, { y0 = 0, y1 = 1 } = {}) {
  const cw = Math.floor(w / size); const r0 = Math.floor((h * y0) / size); const r1 = Math.floor((h * y1) / size);
  const out = [];
  for (let cy = r0; cy < r1; cy += 1) {
    for (let cx = 0; cx < cw; cx += 1) {
      let s = 0;
      for (let y = cy * size; y < (cy + 1) * size; y += 1) {
        for (let x = cx * size; x < (cx + 1) * size; x += 1) s += a[y * w + x];
      }
      out.push({ cx, cy, v: s / (size * size) });
    }
  }
  return out;
}

/**
 * Edge softness of whatever `diff` (|shown - hidden| luminance) outlines,
 * measured along `rays` rays from (cx, cy): per ray, the plateau P is the
 * 90th percentile of the profile inside its own 50% crossing, and the width
 * is how far the profile takes to fall from 0.9 P to 0.1 P, walking outward.
 * Returns the median width in px, the median 50% radius, and per-ray data.
 */
export function edgeProfile(diff, w, h, cx, cy, { rays = 24, maxR = null } = {}) {
  const R = maxR || Math.floor(Math.min(w, h) / 2) - 2;
  const widths = []; const radii = [];
  for (let k = 0; k < rays; k += 1) {
    const a = (k / rays) * Math.PI * 2;
    const dx = Math.cos(a); const dy = Math.sin(a);
    const prof = [];
    for (let r = 0; r <= R; r += 1) {
      const x = Math.round(cx + dx * r); const y = Math.round(cy + dy * r);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) break;
      // 3x3 box: a one-pixel dither or a weather mote is not an edge.
      let s = 0;
      for (let j = -1; j <= 1; j += 1) for (let i = -1; i <= 1; i += 1) s += diff[(y + j) * w + x + i];
      prof.push(s / 9);
    }
    if (prof.length < 8) continue;
    const sorted = prof.slice(0, Math.max(4, Math.floor(prof.length * 0.6))).sort((p, q) => p - q);
    const P = sorted[Math.floor(sorted.length * 0.9)];
    if (!(P > 6)) continue;                      // no cloud on this ray
    const outermost = (f) => { for (let r = prof.length - 1; r >= 0; r -= 1) if (prof[r] >= f * P) return r; return -1; };
    const r90 = outermost(0.9); const r50 = outermost(0.5); const r10 = outermost(0.1);
    if (r10 < 0 || r90 < 0 || r10 >= prof.length - 2) continue;   // silhouette left the frame
    widths.push(Math.max(0, r10 - r90));
    radii.push(r50);
  }
  const med = (v) => { const s = v.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  return { width: med(widths), radius: med(radii), rays: widths.length, widths };
}

/** |a - b| per pixel. */
export function absDiff(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = Math.abs(a[i] - b[i]);
  return out;
}

/**
 * The frame's luminance ratio on/off in cells: where the shadow is, how
 * dark its core is, and how much of it is penumbra rather than umbra.
 */
export function shadowStats(onLin, offLin, w, h, size = 12) {
  const on = cells(onLin, w, h, size, { y0: 0.18, y1: 0.86 });
  const off = cells(offLin, w, h, size, { y0: 0.18, y1: 0.86 });
  let minR = Infinity; let dark = 0; let sx = 0; let sy = 0; let sw = 0;
  const depths = [];
  for (let i = 0; i < on.length; i += 1) {
    if (!(off[i].v > 0.004)) continue;           // black pixels carry no ratio
    const r = on[i].v / off[i].v;
    const d = Math.max(0, 1 - r);
    depths.push(d);
    if (r < minR) minR = r;
    if (r < 0.95) { dark += 1; sx += on[i].cx * d; sy += on[i].cy * d; sw += d; }
  }
  const dMax = Math.max(0, 1 - minR);
  const umbra = depths.filter((d) => d > 0.8 * dMax).length;
  const penumbra = depths.filter((d) => d > 0.15 * dMax && d <= 0.8 * dMax).length;
  const cw = Math.floor(w / size);
  // Robust versions: one cell holding a weather mote or a HUD edge is not
  // a shadow and not noise worth failing on.
  const sortedD = depths.slice().sort((p, q) => p - q);
  const pct = (p) => (sortedD.length ? sortedD[Math.min(sortedD.length - 1, Math.floor(sortedD.length * p))] : 0);
  return {
    core: 1 - pct(0.98),          // ratio at the 98th-percentile depth
    p99dev: pct(0.99),            // 99th-percentile darkening (a control reads ~0)
    minRatio: minR,
    darkFraction: dark / Math.max(1, depths.length),
    umbra, penumbra,
    centroid: sw > 0 ? [((sx / sw) + 0.5) * size / w, ((sy / sw) + 0.5) * size / h] : null,
    cellsWide: cw,
  };
}
