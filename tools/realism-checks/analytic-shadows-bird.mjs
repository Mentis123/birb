/**
 * The bird casts a shadow along the SUN, not straight down.
 *
 * Before this package (e252ca1) the bird's only shadow below Ultra was the
 * contact disc, laid down the radial whatever the sun was doing. The disc
 * stays — it is the altitude cue — and now the body and both wings, as
 * analytic ellipsoids read off the live rig, shade the ground where the sun
 * ray from the bird actually lands.
 *
 * The bird is placed 7 units up the sun ray from a LIT open spot (found in
 * the baked map), facing away from the sun and pitched down so the chase
 * camera sees the spot ahead of it. Classic flight, because the stunt rig's
 * camera stands along a held LEVEL heading and would keep the spot behind
 * the bird. Clock held: bird shadow on, off, on, off, one box of pixels.
 * The horizon is set to 0 so only the bird's shadow is measured.
 */
import { setSun, waitForBake, birdOverLitSpot, abSeries, restore } from './analytic-shadows-lib.mjs';

export const name = 'analytic-shadows-bird';
export const query = 'flight=classic';

export default async function run(ctx) {
  const { page } = ctx;
  await page.evaluate(() => window.__BIRB.pinTier?.(0));
  await waitForBake(ctx);
  await setSun(ctx, 0);
  const view = await birdOverLitSpot(ctx);
  ctx.check(!!view, view
    ? `placed the bird 7 units up the sun ray from a lit spot (sun ${view.spot.sunElevationDeg} deg; spot ${Math.round(Math.hypot(view.px[0] - view.birdPx[0], view.px[1] - view.birdPx[1]))} px from the bird on screen)`
    : 'placed the bird up the sun ray from a lit, visible spot');
  if (view) {
    const state = await page.evaluate(() => window.__BIRB.birdShadow());
    ctx.check(state?.active && state?.bodyValid, `the ellipsoids are live (${JSON.stringify(state?.body)})`);
    await page.evaluate(() => window.__BIRB.horizon(0));
    const [on1, off1, on2, off2] = await abSeries(ctx, 'birdShadow', [1, 0, 1, 0], view.px, 6, 'bird');
    const noise = Math.max(Math.abs(on1 - on2), Math.abs(off1 - off2));
    ctx.check(noise <= 0.002 * Math.max(off1, off2),
      `the control pairs agree (on ${on1.toFixed(4)} / ${on2.toFixed(4)}, off ${off1.toFixed(4)} / ${off2.toFixed(4)})`);
    const darkening = 1 - on1 / off1;
    ctx.check(darkening > 0.15,
      `the bird's sun shadow darkens the spot ${(darkening * 100).toFixed(1)}% (linear ${off1.toFixed(4)} -> ${on1.toFixed(4)})`);
    // The contact disc is still there, straight down: the altitude cue.
    const disc = await page.evaluate(() => window.__BIRB.shadow());
    ctx.check(disc?.visible === true && disc.opacity > 0.05,
      `the contact disc still marks the altitude (opacity ${disc?.opacity?.toFixed?.(3)})`);
  }
  await restore(ctx);
}
