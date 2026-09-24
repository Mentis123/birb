/**
 * Both halves of the eye at once compile, compose, and read back.
 *
 * `?autoexp=1&localtm=1`: six extra passes (meter, adapt, then the fusion's
 * four), one patched composite. The fusion synthesises its exposures from
 * the ADAPTED frame, so the two stack rather than fight: at a dark view both
 * lift, and the frame with both is at least as bright as the adapted one.
 * The debug views (1 local, 2 adaptation, 3 both, as grey) must render.
 */
import { setupBiome, holdAt, eye, lumStats, BASE_PASSES, POSES } from './auto-exposure-lib.mjs';

export const name = 'auto-exposure-both';
export const query = 'flight=classic&autoexp=1&localtm=1';

export default async function run(ctx) {
  const { page } = ctx;
  await setupBiome(ctx, { env: POSES.dark.env, sunTime: POSES.dark.sunTime });
  const passes = await page.evaluate(() => window.__BIRB.frameTotals().passes);
  ctx.check(BASE_PASSES.map((p) => p + 6).includes(passes), `both halves add six passes (${passes})`);
  const r0 = await eye(ctx);
  ctx.log(`render-target memory ${(r0.memoryBytes / 1024).toFixed(0)} KiB; sizes ${JSON.stringify(r0.sizes)}`);
  ctx.check(r0.autoexp && r0.localtm, 'both flags build both halves');
  ctx.check(r0.memoryBytes > 0 && r0.memoryBytes < 4 * 1024 * 1024, `render targets under 4 MiB (${(r0.memoryBytes / 1024).toFixed(0)} KiB)`);

  await holdAt(ctx, POSES.dark);
  await eye(ctx, { snap: true, auto: true, local: 1 });
  await ctx.frames(3);
  const r = await eye(ctx);
  const both = lumStats(await ctx.shot('dark-both'));
  await eye(ctx, { local: 0 });
  await ctx.frames(2);
  const autoOnly = lumStats(await ctx.shot('dark-auto'));
  await eye(ctx, { auto: false });
  await ctx.frames(2);
  const off = lumStats(await ctx.shot('dark-off'));
  await eye(ctx, { auto: true, local: 1 });
  await ctx.frames(2);
  const again = lumStats(await ctx.shot('dark-both-again'));
  ctx.log(`dark: off ${off.mean} / auto ${autoOnly.mean} / both ${both.mean} / both again ${again.mean}; p10 ${off.p10} / ${autoOnly.p10} / ${both.p10}; EV ${r.ev.toFixed(3)}`);
  ctx.check(Number.isFinite(r.ev) && r.ev > 0, `the eye lifts the dark view with the fusion running (EV ${r.ev.toFixed(3)})`);
  ctx.check(autoOnly.mean > off.mean && both.mean >= autoOnly.mean - Math.abs(both.mean - again.mean) - 0.5,
    `off ${off.mean} < adapted ${autoOnly.mean} <= adapted + fused ${both.mean}`);

  for (const view of [1, 2, 3]) {
    await eye(ctx, { debug: view });
    await ctx.frames(2);
    const s = lumStats(await ctx.shot(`debug-${view}`));
    ctx.check(s.mean > 20 && s.mean < 250, `debug view ${view} renders (mean ${s.mean})`);
  }
  await eye(ctx, { debug: 0 });
  await page.evaluate(() => window.__BIRB.hold(false));
  await ctx.frames(2);
}
