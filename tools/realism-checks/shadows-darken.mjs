/**
 * A shadow can only take light away.
 *
 * Measured on main 54b1961 (2026-09-23): turning shadows on BRIGHTENED the
 * frame by 5.9% (lower half +8.5%) at matched framing, because the shadow
 * light copied the key light at full intensity every frame while the key
 * light stayed lit — the sun counted twice, and a shadow could remove at
 * most half of it.
 *
 * Same pose restored before every shot; off, on, off again, so the control
 * pair measures the method's own noise.
 */
export const name = 'shadows-darken';

export default async function run(ctx) {
  const { page } = ctx;
  await page.evaluate(() => {
    const B = window.__BIRB;
    B.pinTier?.(0);
    B.setSunTime(0);
    B.setSunEnabled(true);
  });
  await ctx.frames(3);
  await page.evaluate(() => window.__BIRB.setSunEnabled(false));

  const measure = async (on, label) => {
    await page.evaluate((v) => window.__BIRB.setShadows({ enabled: v }), on);
    await ctx.frames(6);
    await ctx.place({ U: [1, 0.08, 0.05], above: 22, pitch: 0.5, settle: 12 });
    const png = await ctx.shot(label);
    return ctx.lum(png, 0.5, 0.98, { linear: true });
  };
  const off1 = await measure(false, 'off');
  const on = await measure(true, 'on');
  const off2 = await measure(false, 'off-again');
  const noise = Math.abs(off1 - off2);
  ctx.check(noise <= Math.max(off1, off2) * 0.02, `the control pair is stable (${off1.toFixed(4)} vs ${off2.toFixed(4)})`);
  ctx.check(on <= Math.max(off1, off2) * 1.005 + noise,
    `turning shadows on never brightens the frame (off ${off1.toFixed(4)} / ${off2.toFixed(4)}, on ${on.toFixed(4)})`);

  await page.evaluate(() => window.__BIRB.setShadows({ enabled: false }));
  await ctx.unfreeze();
  await page.evaluate(() => window.__BIRB.setSunEnabled(true));
}
