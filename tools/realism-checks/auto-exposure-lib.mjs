/**
 * Shared set-up and pixel measures for the auto-exposure checks
 * (?autoexp=1 eye adaptation, ?localtm=1 local tone mapping — see
 * src/effects/exposure.js and docs/perf/gates/G-REALISM-AUTO-EXPOSURE.md).
 * No default export, so tools/birb-realism.mjs loads it as a library.
 *
 * Every A/B here is inside ONE boot and ONE held pose: the eye's own runtime
 * switch (`__BIRB.exposure({ auto: false })`, `{ local: 0 }`) leaves the
 * composite multiplying by exactly 2^0, so "off" is the authored frame, and
 * the first state is photographed again as the control — two boots never
 * frame a pose the same way (CLAUDE.md, the feather A/B).
 */

import { EXPOSURE_KEYS } from '../../src/effects/exposure.js';

export const SEED = 16160;
// t = 165 s: the elevation the palettes were authored at (the atmosphere
// model's reference, ~42 degrees) — the calibration's sun.
export const AUTHORED_SUN = 165;

/**
 * The poses the checks hold, all in the seeded world. DARK: 6 units over the
 * forest floor, nose 0.8 rad down, low sun (t = 0) — metered 0.5 stop under
 * the forest key. BRIGHT: 60 units up facing the sun at the authored
 * elevation — metered 1.1 stops over it. CANYON: the calibration's darkest
 * view (canyons spot 2, heading a: the chase camera up against a sandstone
 * spire that fills the frame, metered -6.9, four and a third stops under the
 * canyons key), where the EV must sit on its +1.5 clamp. BACKLIT: 10 units up facing a low
 * sun — dark canopies against a bright sky, the case for local tone mapping.
 */
export const POSES = {
  dark: { env: 'forest', sunTime: 0, U: [1, 0.08, 0.05], above: 6, pitch: 0.8 },
  bright: { env: 'forest', sunTime: 165, U: [1, 0.08, 0.05], above: 60, faceSun: 0.35 },
  canyon: { env: 'canyons', sunTime: 165, U: [-0.5, 0.7, -0.4], heading: 0, above: 30, pitch: 0.1 },
  backlitSun: 0,
  backlit: [
    { U: [1, 0.08, 0.05], above: 10, faceSun: 0.12 },
    { U: [0.3, 0.9, -0.2], above: 10, faceSun: 0.12 },
    { U: [0.6, 0.6, 0.5], above: 10, faceSun: 0.12 },
  ],
  // The shipped table, so a check compares against what the game uses.
  keys: EXPOSURE_KEYS,
};

/** The calibration's reference views: 8 spots x 2 level headings. */
export const CALIBRATION = {
  spots: [[1, 0.08, 0.05], [0.3, 0.9, -0.2], [-0.5, 0.7, -0.4], [0.6, 0.6, 0.5],
    [-0.8, 0.1, 0.6], [0.1, -0.7, 0.7], [-0.3, -0.4, -0.85], [0.7, -0.3, -0.6]],
  above: 30,
  pitch: 0.1,
  // log2 units; at strength 0.7 that is an EV of at most 0.21 at the median view.
  tolerance: 0.3,
};

// Render passes in one post-pass frame without the eye: scene, bright, two
// blurs, composite (5); +3 while shafts draw; +1 on the frame they clear.
export const BASE_PASSES = [5, 6, 8];

const toLinear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Seeded biome, tier pinned at 0 (the post pass runs), sun at `sunTime` and held. */
export async function setupBiome(ctx, { env = 'forest', sunTime = AUTHORED_SUN } = {}) {
  await ctx.page.evaluate(({ seed, env }) => {
    const B = window.__BIRB;
    B.hold(false);
    B.stillAir?.(true);
    B.air?.(false);
    B.worldSeed(seed);
    B.setEnvironment(env);
    B.pinTier(0);
  }, { seed: SEED, env });
  await ctx.frames(6);
  await ctx.page.evaluate((t) => { const B = window.__BIRB; B.setSunTime(t); B.setSunEnabled(true); }, sunTime);
  await ctx.frames(3);
  await ctx.page.evaluate(() => window.__BIRB.setSunEnabled(false));
  await ctx.frames(1);
}

/** Two level headings at spot U (perpendicular to each other). */
export function headings(U) {
  const u = norm(U);
  const helper = Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const f1 = norm(cross(u, helper));
  const f2 = norm(cross(u, f1));
  return [f1, f2];
}

/**
 * Put the bird `above` units over the ground at U, heading F (or facing the
 * sun with `faceSun: pitchUp`), pitched `pitch` nose-down, and HOLD every
 * clock — the chase camera snaps onto the held pose. The eye's own clock
 * (performance.now) keeps running, so it adapts to the held frame.
 */
export async function holdAt(ctx, { U, F = null, above = 30, pitch = 0, faceSun = null }) {
  const q = F ? ctx.quatFromUpForward(U, F, pitch) : ctx.levelQuat(U, pitch);
  await ctx.page.evaluate(({ U, q, above, faceSun }) => {
    const B = window.__BIRB;
    B.hold(false);
    B.setStick?.(0, 0);
    const pos = B.teleport(U[0], U[1], U[2], above);
    B.restorePose({ position: pos, quaternion: q });
    B.freeze(true);
    if (faceSun !== null) B.faceSun(faceSun);
    B.hold(true);
  }, { U, q, above, faceSun });
  await ctx.frames(3);
}

/** The eye's state (async readback of the 1x1 adaptation target). */
export const eye = (ctx, opts = null) => ctx.page.evaluate((o) => window.__BIRB.exposure(o || undefined), opts);

/**
 * Luminance percentiles of a capture, sRGB 0-255, with the HUD's corners
 * (pause/gear top right, boost pill bottom right) left out: they are drawn
 * over the canvas and no exposure touches them.
 */
export function lumStats(png) {
  const { w, h, ch, data } = png;
  const vals = [];
  let lin = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if ((y < 150 && x > w - 150) || (y > h - 90 && x > w - 170)) continue;
      const i = (y * w + x) * ch;
      const v = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      vals.push(v);
      lin += 0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1]) + 0.0722 * toLinear(data[i + 2]);
    }
  }
  vals.sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    mean: +mean.toFixed(2), linMean: +(lin / vals.length).toFixed(4),
    p10: +q(0.1).toFixed(2), p50: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), p99: +q(0.99).toFixed(2),
  };
}

/** Move the sun WITHOUT touching the world (a biome switch is a cut; this is not). */
export async function setSun(ctx, t) {
  await ctx.page.evaluate((s) => { const B = window.__BIRB; B.setSunTime(s); B.setSunEnabled(true); }, t);
  await ctx.frames(3);
  await ctx.page.evaluate(() => window.__BIRB.setSunEnabled(false));
  await ctx.frames(1);
}

export const pct = (a, b) => `${((a / b - 1) * 100).toFixed(1)}%`;
