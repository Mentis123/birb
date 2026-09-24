/**
 * With the real shadow maps on (the Ultra lever), the analytic shadows
 * compose with them instead of fighting them.
 *
 *  - The horizon's sun visibility multiplies the sun's light INSIDE three's
 *    light loop, matched by direction. Three sorts shadow casters first, so
 *    with maps on directionalLights[0] is the shadow light — and on e252ca1
 *    the key light is still lit beside it (the double sun the planet-light
 *    package removes). Both shine from the sun, so both are shadowed.
 *  - The ground already receives the map, and the bird is a caster in it:
 *    the ellipsoids stand down on any fragment with receiveShadow, so the
 *    bird's shadow on the ground is the map's and it is not darkened twice.
 */
import { setSun, waitForBake, ridgeShadowView, birdOverLitSpot, abSeries, darkestWindow, restore } from './analytic-shadows-lib.mjs';

export const name = 'analytic-shadows-maps';
export const query = 'flight=classic';

export default async function run(ctx) {
  const { page } = ctx;
  await page.evaluate(() => window.__BIRB.pinTier?.(0));
  await waitForBake(ctx);
  const maps = await page.evaluate(() => window.__BIRB.setShadows({ enabled: true }));
  await ctx.frames(6);
  ctx.check(maps?.enabled === true, `real shadow maps on (${JSON.stringify(maps)})`);
  const rig = await page.evaluate(() => window.__BIRB.horizon());
  ctx.check(rig.index0IsSun && rig.lights.some((l) => l.name === 'shadow' && l.sun),
    `directionalLights[0] is the shadow light and is matched as the sun (${JSON.stringify(rig.lights.map((l) => `${l.name}${l.castShadow ? '*' : ''}:${l.sun}`))})`);

  await setSun(ctx, 0);
  const ridge = await ridgeShadowView(ctx);
  ctx.check(!!ridge, 'found open ground in a ridge\'s shadow with maps on');
  if (ridge) {
    const [on1, off1, on2, off2] = await abSeries(ctx, 'horizon', [1, 0, 1, 0], ridge.px, 30, 'maps-ridge');
    ctx.check(Math.abs(on1 - on2) + Math.abs(off1 - off2) <= 0.004 * off1, 'the control pairs agree');
    // The failure this guards is the maps CANCELLING the horizon (0%) — not
    // a particular depth. How much a ridge removes depends on the patch's own
    // sun share (its Lambert term), and the patch the finder lands on moves
    // with the route-dependent sun azimuth: 13.0%, 37.1% and 54.4% on three
    // boots of the v83 tree. So the bar is 5% AND ten times the control
    // pairs' own disagreement, not a fixed 15% that a grazing-sun patch
    // cannot reach.
    const noise = (Math.abs(on1 - on2) + Math.abs(off1 - off2)) / off1;
    ctx.check(1 - on1 / off1 > Math.max(0.05, 10 * noise),
      `with maps on the ridge still shadows the patch ${((1 - on1 / off1) * 100).toFixed(1)}% (${off1.toFixed(4)} -> ${on1.toFixed(4)})`);
  }

  const bird = await birdOverLitSpot(ctx);
  ctx.check(!!bird, 'placed the bird up the sun ray from a lit spot with maps on');
  if (bird) {
    await page.evaluate(() => window.__BIRB.horizon(0));
    // The window the ellipsoids darken MOST, anywhere around where the bird's
    // shadow lands: with maps on, that most is nothing.
    const w = await darkestWindow(ctx, 'birdShadow', [1, 0, 1, 0], bird.px, { label: 'maps-bird' });
    ctx.check(!!w && Math.abs(w.on1 - w.on2) + Math.abs(w.off1 - w.off2) <= 0.004 * w.off1, 'the control pairs agree');
    ctx.check(!!w && w.darkening <= 0.005,
      `the ellipsoids add nothing where the map already shades the ground (most darkened window ${w ? (w.darkening * 100).toFixed(2) : '?'}%)`);
  }
  await restore(ctx);
}
