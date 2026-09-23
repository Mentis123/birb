/**
 * The sky answers to the sun — measured at ONE fixed view, so the only thing
 * that differs between the two shots is the light.
 *
 * sun-local's own sky check faces AWAY from the sun, and under ?planetsun the
 * sun's azimuth at t=0 and t=300 differ by 180 degrees in the local frame, so
 * its two shots look at opposite halves of the panorama: part of whatever it
 * measures is the picture, not the light. This one looks along the local
 * North both times (90 degrees off both sun azimuths) and has a control:
 * planet-light-sky-off runs the identical measurement with ?atmos=0 and must
 * read no change, which is what makes the number here the atmosphere's.
 *
 * Both shots are rendered sky-only (see planet-light-lib.mjs): the runner's
 * world is unseeded, and on one boot a tree in the band moved the control
 * -5.8% while on another it read 0.0%.
 */
import { skyAtFixedView, SPOTS } from './planet-light-lib.mjs';

export const name = 'planet-light-sky';

export default async function run(ctx) {
  const { page } = ctx;
  const { low, high, change } = await skyAtFixedView(ctx, SPOTS.equator, 'atmos-on');
  ctx.log(`sky-only band (rows 2-28%, left 60%) along local North: low sun ${low.lum.toFixed(2)}, high sun ${high.lum.toFixed(2)} (${(change * 100).toFixed(1)}%)`);
  ctx.log(`dome tint low ${JSON.stringify(low.rig.skyTint)} high ${JSON.stringify(high.rig.skyTint)}`);
  ctx.check(low.rig.atmos === true, 'booted with the atmosphere on');
  ctx.check(change > 0.05,
    `?atmos: the side sky brightens as the sun climbs (${low.lum.toFixed(1)} -> ${high.lum.toFixed(1)}, ${(change * 100).toFixed(1)}%)`);
  await ctx.unfreeze();
  await page.evaluate(() => window.__BIRB.setSunEnabled(true));
}
