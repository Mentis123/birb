/**
 * `?air=0` is the still air of the base, on the live page.
 *
 * The same pose `air-field-thermal` flew through a thermal core (handed over
 * in-process when that check ran first, as it does in a full run) is flown
 * hands off again in a boot with the flag off: it must hold its height, the
 * flight must have no sampler, the foliage uniform must be the bare density
 * on every frame, and the mountain pines must carry no wind patch. Run on its
 * own (`--only air-field-still`) it flies the spawn pose instead — the claim
 * is that no air acts anywhere, so any pose tests it.
 */
export const name = 'air-field-still';
export const query = 'air=0';

export default async function run(ctx) {
  const { page } = ctx;
  const a = await page.evaluate(() => window.__BIRB.air());
  ctx.check(a && a.enabled === false && a.built === false && a.attached === false,
    `?air=0 builds no field and attaches nothing (${JSON.stringify({ enabled: a?.enabled, built: a?.built, attached: a?.attached })})`);

  const handed = globalThis.__airFieldThermalRun || null;
  if (handed) {
    await page.evaluate((p) => window.__BIRB.restorePose(p), handed.pose);
  } else {
    await page.evaluate(() => window.__BIRB.setAltitude(18));
  }
  await ctx.frames(2);
  const frames = handed ? handed.frames : 40;
  if (handed) await page.evaluate((p) => window.__BIRB.restorePose(p), handed.pose);
  const run1 = await ctx.hold({ x: 0, y: 0 }, frames,
    'const p = B.flightProbe(); const a = B.air(); return { r: p.radius, air: p.air, rec: p.recovery, w: a.windUniform, d: a.density };');
  const gain = run1[run1.length - 1].r - run1[0].r;
  ctx.log(`${handed ? 'the thermal pose' : 'the spawn pose'}: ${gain.toFixed(3)} over ${frames} frames` +
    `${handed ? ` (the same pose climbed ${handed.gain.toFixed(2)} with the air on)` : ''}`);
  ctx.check(run1.every((s) => s.rec === 'flying'), 'the pass was clean (no collision)');
  ctx.check(Math.abs(gain) < 0.25, `hands-off level flight holds its height in still air (${gain.toFixed(3)})`);
  ctx.check(run1.every((s) => s.air === 0), 'the controller applied no air on any frame');
  // (windUniform is reported to four places, the density in full.)
  ctx.check(run1.every((s) => Math.abs(s.w - s.d) < 1e-4), 'the foliage wind uniform IS the decorative density, every frame');

  const env = await page.evaluate(() => window.__BIRB.setEnvironment('mountain'));
  if (env) {
    await ctx.frames(6);
    const m = await page.evaluate(() => window.__BIRB.air());
    ctx.check(m.pineWind === false, `the mountain pines are as still as they were (${m.pineWind})`);
    await page.evaluate(() => window.__BIRB.setEnvironment('forest'));
    await ctx.frames(4);
  }
}
