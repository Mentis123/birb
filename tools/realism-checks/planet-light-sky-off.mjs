/**
 * The CONTROL for planet-light-sky: the identical fixed-view measurement with
 * ?atmos=0 (the planet sun still on). The before had no way for the sky to
 * know where the sun was, so at a view that never contains the disc it must
 * read no change — if it did, planet-light-sky's number would be measuring
 * the method, not the atmosphere. It also proves the ?atmos=0 boot path
 * compiles and runs clean (the runner fails any console warning).
 */
import { skyAtFixedView, SPOTS } from './planet-light-lib.mjs';

export const name = 'planet-light-sky-off';
export const query = 'atmos=0';

export default async function run(ctx) {
  const { page } = ctx;
  const { low, high, change } = await skyAtFixedView(ctx, SPOTS.equator, 'atmos-off');
  ctx.log(`sky-only band (rows 2-28%, left 60%) along local North, ?atmos=0: low sun ${low.lum.toFixed(2)}, high sun ${high.lum.toFixed(2)} (${(change * 100).toFixed(1)}%)`);
  ctx.check(low.rig.atmos === false && low.rig.skyTint === null, '?atmos=0 boots the before: no atmosphere state, no dome tint compiled in');
  ctx.check(low.rig.planetSun === true, '...with the planet sun still on');
  ctx.check(Math.abs(change) < 0.01,
    `control: without the atmosphere the same view does not respond (${low.lum.toFixed(1)} -> ${high.lum.toFixed(1)}, ${(change * 100).toFixed(1)}%)`);
  await ctx.unfreeze();
  await page.evaluate(() => window.__BIRB.setSunEnabled(true));
}
