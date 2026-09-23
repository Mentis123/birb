/**
 * `?horizon=0&birdshadow=0` is the true before: no bake, no patch, no
 * ellipsoids, a clean boot. (The runner fails this boot on any console
 * error or warning, which is the half that proves nothing was left half
 * wired.)
 */
export const name = 'analytic-shadows-off';
export const query = 'horizon=0&birdshadow=0';

export default async function run(ctx) {
  const { page } = ctx;
  await ctx.frames(10);
  const h = await page.evaluate(() => window.__BIRB.horizon());
  ctx.check(h && h.enabled === false && h.result === null && h.stats === null,
    `no horizon map is baked (${JSON.stringify({ enabled: h?.enabled, result: h?.result })})`);
  const b = await page.evaluate(() => window.__BIRB.birdShadow());
  ctx.check(b === null, 'no bird-shadow driver exists');
  const patched = await page.evaluate(() => window.__BIRB.horizonPatched?.());
  ctx.check(patched === 0, `no world material carries the shadow patch (${patched})`);
}
