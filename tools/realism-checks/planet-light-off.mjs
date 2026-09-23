/**
 * `?planetsun=0&atmos=0` is the true before: a world-fixed sun, a hemisphere
 * light on world +Y, the core glow light on, no atmosphere. Asserted from the
 * rig itself, so the escape hatch is known to work rather than assumed to —
 * the A/B these flags exist for is only as good as its "off" side. The one
 * thing that does NOT come back is the doubled sun under shadows: that was a
 * defect, not a look, and it has no flag.
 */
import { setSunTime, rigAt, SPOTS } from './planet-light-lib.mjs';

export const name = 'planet-light-off';
export const query = 'planetsun=0&atmos=0';

export default async function run(ctx) {
  const { page } = ctx;
  await setSunTime(ctx, 0);
  const north = await rigAt(ctx, SPOTS.north);
  const south = await rigAt(ctx, SPOTS.south);
  ctx.check(north.planetSun === false && north.atmos === false && north.skyTint === null,
    'both flags off: no planet frame, no atmosphere, no dome tint');
  ctx.check(north.glowVisible === true, 'the core glow light is back, as before');
  ctx.check(south.hemiUpDot < -0.99, `the hemisphere axis is world +Y again (dot with the south pole's up ${south.hemiUpDot})`);
  const same = north.sunDir.every((v, i) => Math.abs(v - south.sunDir[i]) < 1e-3);
  ctx.check(same, `the sun is world-fixed again (${JSON.stringify(north.sunDir)} at both poles)`);
  ctx.check(south.sunLocalElevationDeg < 0,
    `...and so it is below the south pole's horizon again (${south.sunLocalElevationDeg} deg) — the defect the flag exists to show`);
  // The doubled sun is fixed regardless of the flags.
  await page.evaluate(() => window.__BIRB.setShadows({ enabled: true }));
  await ctx.frames(4);
  const on = await page.evaluate(() => window.__BIRB.lightRig());
  ctx.check(on.keyVisible === false && on.shadowLightVisible === true, 'shadows on still means ONE sun under the before flags');
  await page.evaluate(() => window.__BIRB.setShadows({ enabled: false }));
  await ctx.frames(2);
  await ctx.unfreeze();
  await page.evaluate(() => window.__BIRB.setSunEnabled(true));
}
