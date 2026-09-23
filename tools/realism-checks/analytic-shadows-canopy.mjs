/**
 * Trees shade the ground they stand on — at every preset.
 *
 * Before this package (e252ca1) no tree cast anything at any preset: the
 * Ultra shadow map's casters are the bird and ~20 cone proxies at the nest
 * hosts, and the scatter forest is deliberately not among them. The horizon
 * map splats every canopy into its occluder field, so a patch of open ground
 * the TERRAIN alone would leave in full sun can sit in a grove's shadow.
 *
 * __BIRB.horizonFind({ want: 'canopy' }) finds exactly that: shaded in the
 * baked map, lit by an independent march of the terrain alone, on open dry
 * ground with no prop over it. Cockpit camera 14 units up, clock held,
 * horizon on / off / on / off.
 */
import { setSun, waitForBake, ridgeShadowView, abSeries, restore } from './analytic-shadows-lib.mjs';

export const name = 'analytic-shadows-canopy';

export default async function run(ctx) {
  const { page } = ctx;
  await page.evaluate(() => window.__BIRB.pinTier?.(0));
  const bake = await waitForBake(ctx);
  ctx.check(bake?.stats?.instances > 50,
    `canopies were splatted into the occluder field (${bake?.stats?.instances} props: ${bake?.stats?.meshes?.join(', ')})`);
  await setSun(ctx, 0);
  const view = await ridgeShadowView(ctx, { want: 'canopy', clearTexels: 3, minElevationDeg: 12 });
  ctx.check(!!view, view
    ? `found open ground in a prop's shadow the terrain alone would light (sun ${view.spot.sunElevationDeg} deg, terrain skyline ${view.spot.terrainHorizonDeg} deg)`
    : 'found open ground in a prop\'s shadow the terrain alone would light');
  if (view) {
    const [on1, off1, on2, off2] = await abSeries(ctx, 'horizon', [1, 0, 1, 0], view.px, 20, 'canopy');
    const noise = Math.max(Math.abs(on1 - on2), Math.abs(off1 - off2));
    ctx.check(noise <= 0.002 * Math.max(off1, off2),
      `the control pairs agree (on ${on1.toFixed(4)} / ${on2.toFixed(4)}, off ${off1.toFixed(4)} / ${off2.toFixed(4)})`);
    ctx.check(1 - on1 / off1 > 0.12,
      `the canopy's shadow darkens the patch ${((1 - on1 / off1) * 100).toFixed(1)}% (linear ${off1.toFixed(4)} -> ${on1.toFixed(4)})`);
  }
  await restore(ctx);
}
