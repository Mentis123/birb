/**
 * The light rig is coherent on a sphere: one sun, above the LOCAL horizon,
 * a hemisphere light whose sky is the local sky, and — under ?atmos — a key
 * light whose colour answers to how high that sun is.
 *
 * Measured on the base (e252ca1): the HemisphereLight's axis was world +Y
 * everywhere (hemiUpDot -1 at the south pole: the "sky" colour lit the
 * ground-facing sides), the core glow light was on, and the key light stayed
 * lit under shadows so the sun counted twice. Everything is read back from
 * __BIRB.lightRig(), i.e. from the objects that render, not from source.
 */
import { setSunTime, rigAt, SPOTS, LOW_SUN_DEG, HIGH_SUN_DEG, lum3 } from './planet-light-lib.mjs';

export const name = 'planet-light-rig';

export default async function run(ctx) {
  const { page } = ctx;
  const has = await page.evaluate(() => typeof window.__BIRB.lightRig === 'function');
  if (!ctx.check(has, '__BIRB.lightRig() exists')) return;

  await setSunTime(ctx, 0);
  const low = {};
  for (const [where, U] of Object.entries(SPOTS)) low[where] = await rigAt(ctx, U);
  ctx.check(low.north.planetSun && low.north.atmos, 'planetsun and atmos are both on by default');
  ctx.check(low.north.glowVisible === false, 'the core glow light (118 units under the ground) is hidden');
  for (const [where, r] of Object.entries(low)) {
    ctx.check(r.hemiUpDot > 0.99, `${where}: the hemisphere light's sky axis is the local up (dot ${r.hemiUpDot})`);
    ctx.check(Math.abs(r.sunLocalElevationDeg - LOW_SUN_DEG) < 0.5,
      `${where}: t=0 sun ${r.sunLocalElevationDeg} deg above the local horizon (the cycle says ${LOW_SUN_DEG.toFixed(2)})`);
  }

  await setSunTime(ctx, 300);
  const high = await rigAt(ctx, SPOTS.equator);
  const highSouth = await rigAt(ctx, SPOTS.south);
  ctx.check(Math.abs(high.sunLocalElevationDeg - HIGH_SUN_DEG) < 0.5 && Math.abs(highSouth.sunLocalElevationDeg - HIGH_SUN_DEG) < 0.5,
    `t=300 sun ${high.sunLocalElevationDeg} (equator) / ${highSouth.sunLocalElevationDeg} (south) deg (the cycle says ${HIGH_SUN_DEG.toFixed(2)})`);
  ctx.check(highSouth.hemiUpDot > 0.99, `south pole, high sun: hemisphere axis still local (dot ${highSouth.hemiUpDot})`);

  // ?atmos: the key light's colour is the sun's transmittance, relative to
  // the elevation the biome was authored at — redder and dimmer when low.
  const lo = low.equator.keyColor;
  const hi = high.keyColor;
  ctx.log(`key colour low sun ${JSON.stringify(lo)} vs high sun ${JSON.stringify(hi)}; ratios low ${JSON.stringify(low.equator.atmosphere?.sun)} high ${JSON.stringify(high.atmosphere?.sun)}`);
  ctx.check(lo[2] / lo[0] < (hi[2] / hi[0]) * 0.9,
    `?atmos: the key is redder at low sun (b/r ${(lo[2] / lo[0]).toFixed(3)} vs ${(hi[2] / hi[0]).toFixed(3)})`);
  ctx.check(lum3(lo) < lum3(hi) * 0.9, `?atmos: and dimmer (luminance ${lum3(lo).toFixed(3)} vs ${lum3(hi).toFixed(3)})`);
  const tz = (r) => r.skyTint && r.skyTint.zenith;
  ctx.check(!!(tz(low.equator) && tz(high)) && tz(low.equator)[1] < tz(high)[1],
    `?atmos: the dome's zenith tint follows the sun (${JSON.stringify(tz(low.equator))} -> ${JSON.stringify(tz(high))})`);
  ctx.check(!!low.equator.atmosphere && high.atmosphere.irradiance[1] > low.equator.atmosphere.irradiance[1],
    `?atmos: sky irradiance on the hemisphere rises with the sun (${low.equator.atmosphere?.irradiance} -> ${high.atmosphere?.irradiance})`);

  // One sun: with shadows on, the shadow light IS the sun and the key is dark.
  await page.evaluate(() => window.__BIRB.setShadows({ enabled: true }));
  await ctx.frames(4);
  const on = await page.evaluate(() => window.__BIRB.lightRig());
  ctx.check(on.shadowsEnabled && on.shadowLightVisible && on.keyVisible === false,
    `shadows on: shadow light visible ${on.shadowLightVisible}, key visible ${on.keyVisible}`);
  await page.evaluate(() => window.__BIRB.setShadows({ enabled: false }));
  await ctx.frames(4);
  const off = await page.evaluate(() => window.__BIRB.lightRig());
  ctx.check(!off.shadowsEnabled && !off.shadowLightVisible && off.keyVisible === true,
    `shadows off: the key is the sun again (key visible ${off.keyVisible})`);

  // A teleport is a jump: the frame resets rather than transporting.
  const r0 = await rigAt(ctx, SPOTS.north);
  const r1 = await rigAt(ctx, SPOTS.south);
  ctx.check(r1.frameResets > r0.frameResets, `a pole-to-pole teleport resets the sun frame (${r0.frameResets} -> ${r1.frameResets})`);

  await ctx.unfreeze();
  await page.evaluate(() => window.__BIRB.setSunEnabled(true));
}
