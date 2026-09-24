/**
 * The eye lifts a dark view, lowers a bright one, adapts without overshoot,
 * and resets cleanly on a tier shed/restore and on a biome switch.
 *
 * `?autoexp=1`. At a DARK pose (low over shaded ground, nose down) and a
 * BRIGHT pose (high, facing the sun), each held: the adapted frame, then
 * the same held frame with the eye switched off at runtime (the composite
 * multiplies by exactly 2^0 — the authored frame), then the adapted frame
 * again as the control. The eye must move each frame the right way by more
 * than the control moves.
 */
import {
  setupBiome, holdAt, eye, lumStats, pct, setSun, headings, BASE_PASSES, POSES,
} from './auto-exposure-lib.mjs';

export const name = 'auto-exposure-adapt';
export const query = 'flight=classic&autoexp=1';

async function abc(ctx, pose, tag) {
  await holdAt(ctx, pose);
  await eye(ctx, { snap: true, auto: true });
  await ctx.frames(3);
  const r = await eye(ctx);
  const on = lumStats(await ctx.shot(`${tag}-on`));
  await eye(ctx, { auto: false });
  await ctx.frames(2);
  const off = lumStats(await ctx.shot(`${tag}-off`));
  await eye(ctx, { auto: true });
  await ctx.frames(2);
  const again = lumStats(await ctx.shot(`${tag}-on-again`));
  ctx.log(`${tag}: measured ${r.measured.toFixed(3)} key ${r.key} ev ${r.ev.toFixed(3)} (target ${r.target.toFixed(3)})`);
  ctx.log(`${tag}: mean on ${on.mean} / off ${off.mean} (${pct(on.mean, off.mean)}) / on again ${again.mean}; linear ${on.linMean} / ${off.linMean}`);
  return { r, on, off, again, noise: Math.abs(on.mean - again.mean) };
}

export default async function run(ctx) {
  const { page } = ctx;
  await setupBiome(ctx, { env: POSES.dark.env, sunTime: POSES.dark.sunTime });

  const passes = await page.evaluate(() => window.__BIRB.frameTotals().passes);
  ctx.check(BASE_PASSES.map((p) => p + 2).includes(passes), `the eye adds exactly its two passes, meter and adapt (${passes})`);
  const first = await eye(ctx);
  ctx.check(first.present && first.autoexp && !first.localtm && first.compositePristine === false,
    `the flag builds the eye and patches the composite (autoexp ${first.autoexp}, localtm ${first.localtm})`);
  ctx.check(first.sizes.meter.width === 64 && first.sizes.state.width === 1,
    `meter 64x64, state 1x1 ${first.sizes.state.type} (${JSON.stringify(first.sizes)})`);

  // ---- dark lifts, bright lowers ----
  const dark = await abc(ctx, POSES.dark, 'dark');
  ctx.check(dark.r.ev > 0.2 && dark.r.ev <= 1.5, `a dark view lifts the exposure (EV ${dark.r.ev.toFixed(3)})`);
  ctx.check(dark.on.mean > dark.off.mean + 4 * dark.noise + 3,
    `the dark frame is brighter with the eye (${dark.off.mean} -> ${dark.on.mean}, control ${dark.noise.toFixed(2)})`);

  if (POSES.bright.env !== POSES.dark.env || POSES.bright.sunTime !== POSES.dark.sunTime) {
    await setupBiome(ctx, { env: POSES.bright.env, sunTime: POSES.bright.sunTime });
  }
  const bright = await abc(ctx, POSES.bright, 'bright');
  ctx.check(bright.r.ev < -0.2 && bright.r.ev >= -1.5, `a bright view lowers the exposure (EV ${bright.r.ev.toFixed(3)})`);
  ctx.check(bright.on.mean < bright.off.mean - 4 * bright.noise - 3,
    `the bright frame is darker with the eye (${bright.off.mean} -> ${bright.on.mean}, control ${bright.noise.toFixed(2)})`);
  ctx.check(Math.abs(dark.on.mean - bright.on.mean) < Math.abs(dark.off.mean - bright.off.mean),
    `the eye narrows the gap between the two views (off ${Math.abs(dark.off.mean - bright.off.mean).toFixed(1)} -> on ${Math.abs(dark.on.mean - bright.on.mean).toFixed(1)})`);

  // ---- adaptation on the live page: bright -> dark without a cut ----
  // Frame by frame the EV climbs toward the new target and never passes it.
  // (bright is still the current biome and sun; the sun moves without a cut)
  await holdAt(ctx, POSES.bright);
  await eye(ctx, { snap: true });
  await ctx.frames(3);
  const start = (await eye(ctx)).ev;
  await setSun(ctx, POSES.dark.sunTime);
  await holdAt(ctx, POSES.dark);
  const trace = [];
  for (let i = 0; i < 14; i += 1) {
    await ctx.frames(1);
    const r = await eye(ctx);
    trace.push({ ev: r.ev, target: r.target, dt: r.dt });
  }
  const target = trace.at(-1).target;
  let monotone = true; let overshoot = 0;
  for (let i = 1; i < trace.length; i += 1) if (trace[i].ev < trace[i - 1].ev - 1e-4) monotone = false;
  for (const s of trace) overshoot = Math.max(overshoot, s.ev - s.target);
  ctx.log(`bright -> dark: EV ${start.toFixed(3)} -> ${trace.map((s) => s.ev.toFixed(3)).join(' ')} (target ${target.toFixed(3)}, dt ${trace.map((s) => s.dt.toFixed(3)).join(' ')})`);
  ctx.check(monotone, 'the EV rises monotonically after the view darkens');
  ctx.check(overshoot <= 1e-3, `and never passes its target (worst ${overshoot.toFixed(4)})`);
  ctx.check(trace[0].ev < target - 0.05, `it adapts rather than jumps (first sample ${trace[0].ev.toFixed(3)} vs target ${target.toFixed(3)})`);
  ctx.check(Math.abs(trace.at(-1).ev - target) < Math.abs(start - target) * 0.5, `and gets most of the way there (${trace.at(-1).ev.toFixed(3)})`);

  // ---- the clamp, live: a view four stops under the key ----
  await setupBiome(ctx, { env: POSES.canyon.env, sunTime: POSES.canyon.sunTime });
  const canyon = await abc(ctx, { ...POSES.canyon, F: headings(POSES.canyon.U)[POSES.canyon.heading] }, 'canyon');
  ctx.check(Math.abs(canyon.r.ev - 1.5) < 1e-3 && canyon.r.target === 1.5,
    `the darkest reference view sits on the +1.5 stop clamp (measured ${canyon.r.measured.toFixed(2)}, key ${canyon.r.key}, EV ${canyon.r.ev.toFixed(4)})`);
  ctx.check(canyon.on.mean > canyon.off.mean, `and is lifted by it (${canyon.off.mean} -> ${canyon.on.mean})`);
  await setupBiome(ctx, { env: POSES.dark.env, sunTime: POSES.dark.sunTime });
  await holdAt(ctx, POSES.dark);

  // ---- tier shed / restore: restart from the authored exposure ----
  await eye(ctx, { snap: true });
  await ctx.frames(3);
  const settled = (await eye(ctx)).ev;
  await page.evaluate(() => window.__BIRB.pinTier(1));
  await ctx.frames(3);
  const shed = await eye(ctx);
  await page.evaluate(() => window.__BIRB.pinTier(0));
  await ctx.frames(1);
  const restored = await eye(ctx);
  ctx.log(`tier shed: post ${shed.postActive}; restored EV ${restored.ev.toFixed(3)} (settled ${settled.toFixed(3)}, target ${restored.target.toFixed(3)})`);
  ctx.check(shed.postActive === false, 'pinning tier 1 sheds the post pass (the no-post path shows the authored exposure)');
  ctx.check(restored.ev > 0 && restored.ev < settled * 0.8,
    `on restore the eye restarts from the authored exposure, not the stale ${settled.toFixed(3)} (${restored.ev.toFixed(3)})`);

  // ---- biome switch: a cut to the new biome's key ----
  await page.evaluate(() => window.__BIRB.setEnvironment('city'));
  await ctx.frames(3);
  const city = await eye(ctx);
  ctx.check(city.environment === 'city' && city.key === POSES.keys.city,
    `a biome switch takes that biome's key (${city.environment}: ${city.key})`);
  ctx.check(Math.abs(city.ev - city.target) < 0.02 || Math.abs(city.ev - city.target) < Math.abs(settled - city.target),
    `and snaps to its first frames instead of carrying the forest's adaptation in (EV ${city.ev.toFixed(3)}, target ${city.target.toFixed(3)})`);
  ctx.check(Math.abs(city.ev) <= 1.5 && Math.abs(dark.r.ev) <= 1.5 && Math.abs(bright.r.ev) <= 1.5, 'every EV inside +/-1.5 stops');

  await page.evaluate(() => { const B = window.__BIRB; B.setEnvironment('forest'); B.hold(false); });
  await ctx.frames(3);
}
