/**
 * One sun for a PLANET: never below the local horizon, and the sky knows
 * where it is.
 *
 * sun-cycle.js promises "Never below the horizon. The elevation floor keeps
 * the world lit." Measured on main 54b1961 (2026-09-23) that promise held
 * only near the +Y pole: the key light's direction was world-fixed, so at the
 * south pole the sun sat 19-58 degrees BELOW the local horizon for the whole
 * cycle, and on the equator for half of it. In the same A/B the sky rendered
 * pixel-identical with the sun 75 degrees above and 27 degrees below the
 * horizon.
 *
 * The sun direction is read with `faceSun()` (which also turns the bird, so
 * the pose is captured and restored around it). The sun time is FROZEN
 * (setSunEnabled(false)) before teleporting, so this also proves the sun's
 * direction follows the bird's position even while the clock is paused.
 */
export const name = 'sun-local';

const SPOTS = {
  north: [0.02, 1, 0.03],
  equatorA: [1, 0.02, 0.03],
  equatorB: [-1, 0.02, 0.03],
  south: [0.03, -1, 0.02],
};

const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

async function setSunTime(ctx, t) {
  await ctx.page.evaluate((s) => { const B = window.__BIRB; B.setSunTime(s); B.setSunEnabled(true); }, t);
  await ctx.frames(3);
  await ctx.page.evaluate(() => window.__BIRB.setSunEnabled(false));
  await ctx.frames(2);
}

async function sunAt(ctx, U) {
  await ctx.place({ U, above: 30, settle: 6 });
  return ctx.page.evaluate(() => {
    const B = window.__BIRB;
    const pose = B.capturePose();
    const s = B.faceSun(0);
    B.restorePose(pose);
    return s;
  });
}

export default async function run(ctx) {
  const { page } = ctx;
  for (const t of [0, 150, 300, 450]) {
    await setSunTime(ctx, t);
    for (const [where, U] of Object.entries(SPOTS)) {
      const s = await sunAt(ctx, U);
      if (!s) { ctx.check(true, `t=${t}s ${where}: sun straight overhead`); continue; }
      const elev = Math.asin(Math.max(-1, Math.min(1, dot(unit(s), unit(U)))));
      ctx.check(elev >= 0.30 && elev <= 1.10,
        `t=${t}s ${where}: the sun is ${(elev * 180 / Math.PI).toFixed(1)} deg above the local horizon (designed range 19-58)`);
    }
  }

  // The sky has to respond to the sun. Same place, facing AWAY from the sun
  // so the disc and halo never enter the measured band, low sun vs high sun.
  const U = SPOTS.equatorA;
  const skyAt = async (t, label) => {
    await setSunTime(ctx, t);
    const s = await sunAt(ctx, U);
    const away = s ? s.map((v) => -v) : [0, 0, 1];
    await ctx.place({ U, above: 30, settle: 10, quat: ctx.quatFromUpForward(U, away, -0.15) });
    const png = await ctx.shot(label);
    return ctx.lum(png, 0.02, 0.28);
  };
  const low = await skyAt(0, 'sky-low-sun');
  const high = await skyAt(300, 'sky-high-sun');
  const change = Math.abs(high - low) / Math.max(1, (high + low) / 2);
  ctx.check(change > 0.03,
    `the sky responds to the sun's height (sky luminance ${low.toFixed(1)} low sun vs ${high.toFixed(1)} high sun, ${(change * 100).toFixed(1)}%)`);

  await ctx.unfreeze();
  await page.evaluate(() => window.__BIRB.setSunEnabled(true));
}
