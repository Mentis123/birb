/**
 * Erosion is opt-in, and its absence is the true before (?erosion absent).
 *
 * The default boot must carry none of it: no bake, no wetness map, no
 * retained horizon grid, and a Flags-tab switch that reads Off. It is also
 * where the CONTROL lives for the look: the same seeded forest, the same
 * absolute camera poses erosion-look photographs with the flag on, so the
 * two sets of frames differ only by the flag (--out keeps them).
 *
 * And the mesh-against-floor gap of the UN-eroded world is measured here too,
 * so the numbers erosion-agreement compares against in its own boot (its
 * `control: true` pass re-displaces the mesh with the carve off) can be read
 * against a world that never had the carve at all.
 */
import { ERODED_VIEWS, seededForest, shootViews, restoreView } from './erosion-lib.mjs';

export const name = 'erosion-off';

export default async function run(ctx) {
  const { page } = ctx;
  const off = await page.evaluate(() => {
    const e = window.__BIRB.erosion({ agreement: false });
    return {
      enabled: e.enabled, wetTexture: e.wetTexture, stats: e.stats,
      search: location.search,
    };
  });
  ctx.check(off.enabled === false && off.wetTexture === false && off.stats === null,
    `no erosion on the default boot (enabled ${off.enabled}, wet map ${off.wetTexture})`);
  const flag = await page.evaluate(async () => {
    const { readBootFlag } = await import('/src/ui/boot-flags.js');
    return readBootFlag(location.search, 'erosion');
  });
  ctx.check(flag && flag.value === null, `the Flags tab reads erosion Off (${JSON.stringify(flag)})`);

  const agree = await page.evaluate(() => window.__BIRB.erosion({ samples: 20000 }).agreement);
  ctx.check(!!agree && agree.samples > 10000,
    `control: drawn ground vs flight floor, un-eroded forest — p99 ${agree?.p99}, max ${agree?.max}, `
    + `${((agree?.over06 ?? 0) * 100).toFixed(1)}% of dry ground drawn >0.6 above the floor (${agree?.samples} samples)`);

  await seededForest(ctx);
  const shots = await shootViews(ctx, ERODED_VIEWS, 'off');
  ctx.check(shots.every((s) => s.ok), `photographed the control views (${shots.map((s) => s.label).join(', ')})`);
  await restoreView(ctx);
}
