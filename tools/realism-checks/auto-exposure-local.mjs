/**
 * Local tone mapping lifts the shadows and keeps the highlights.
 *
 * `?localtm=1` (exposure fusion, Mertens 2007 / Wronski 2022, at quarter
 * resolution, applied as a lift-only local exposure). At backlit views of the
 * seeded forest with a low sun — dark canopies against a bright sky, the case
 * a single global curve cannot serve — each held: fusion on, fusion off at
 * runtime (`local: 0`, the composite adds exactly 0 stops), fusion on again as
 * the control. The frame's 10th percentile must rise by more than the control
 * moves it; its 99th must stay within a few percent. Also: the fusion resizes
 * with the canvas and keeps working.
 */
import { setupBiome, holdAt, eye, lumStats, pct, BASE_PASSES, POSES } from './auto-exposure-lib.mjs';

export const name = 'auto-exposure-local';
export const query = 'flight=classic&localtm=1';

export default async function run(ctx) {
  const { page } = ctx;
  await setupBiome(ctx, { env: 'forest', sunTime: POSES.backlitSun });
  const passes = await page.evaluate(() => window.__BIRB.frameTotals().passes);
  ctx.check(BASE_PASSES.map((p) => p + 4).includes(passes), `the fusion adds exactly its four passes (${passes})`);
  const info = await eye(ctx);
  ctx.check(info.localtm && !info.autoexp, `the flag builds the fusion alone (localtm ${info.localtm}, autoexp ${info.autoexp})`);
  const fw = info.sizes.fusion;
  ctx.check(fw.width === Math.floor(info.sizes.scene.width / 4) && fw.height === Math.floor(info.sizes.scene.height / 4),
    `fusion at quarter resolution (${fw.width}x${fw.height} of ${info.sizes.scene.width}x${info.sizes.scene.height}, ${fw.levels} levels, ${fw.fused} fused)`);

  const lifts = [];
  for (const [i, spot] of POSES.backlit.entries()) {
    await holdAt(ctx, spot);
    await eye(ctx, { local: 1 });
    await ctx.frames(3);
    const on = lumStats(await ctx.shot(`backlit${i}-on`));
    await eye(ctx, { local: 0 });
    await ctx.frames(2);
    const off = lumStats(await ctx.shot(`backlit${i}-off`));
    await eye(ctx, { local: 1 });
    await ctx.frames(2);
    const again = lumStats(await ctx.shot(`backlit${i}-on-again`));
    const noise10 = Math.abs(on.p10 - again.p10);
    const noise99 = Math.abs(on.p99 - again.p99);
    ctx.log(`backlit ${i}: p10 ${off.p10} -> ${on.p10} (${pct(on.p10, off.p10)}), p50 ${off.p50} -> ${on.p50} (${pct(on.p50, off.p50)}), p99 ${off.p99} -> ${on.p99} (${pct(on.p99, off.p99)}); control p10 ${noise10.toFixed(2)} p99 ${noise99.toFixed(2)}`);
    ctx.check(on.p10 > off.p10 * 1.03 && on.p10 - off.p10 > 3 * noise10 + 0.5,
      `backlit ${i}: the shadows come up (p10 ${off.p10} -> ${on.p10}, ${pct(on.p10, off.p10)}; control ${noise10.toFixed(2)})`);
    ctx.check(Math.abs(on.p99 / off.p99 - 1) <= 0.03 + noise99 / off.p99,
      `backlit ${i}: the highlights hold (p99 ${off.p99} -> ${on.p99}, ${pct(on.p99, off.p99)})`);
    lifts.push(on.p10 / off.p10 - 1);
  }
  ctx.log(`p10 lifts: ${lifts.map((l) => `${(l * 100).toFixed(1)}%`).join(', ')}`);

  // ---- resize: the fusion's targets follow the canvas ----
  const before = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 760 });
  await ctx.frames(4);
  const resized = await eye(ctx);
  const rf = resized.sizes.fusion;
  ctx.check(rf.width === Math.floor(resized.sizes.scene.width / 4) && rf.height === Math.floor(resized.sizes.scene.height / 4)
    && resized.sizes.scene.width !== info.sizes.scene.width,
    `after a resize the fusion is re-sized with the scene (${rf.width}x${rf.height} of ${resized.sizes.scene.width}x${resized.sizes.scene.height})`);
  const shotResized = lumStats(await ctx.shot('resized'));
  ctx.check(Number.isFinite(shotResized.mean) && shotResized.mean > 5, `and the frame still renders (mean ${shotResized.mean})`);
  await page.setViewportSize(before);
  await ctx.frames(3);
  await page.evaluate(() => window.__BIRB.hold(false));
}
