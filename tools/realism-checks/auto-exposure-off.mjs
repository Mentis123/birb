/**
 * With neither ?autoexp nor ?localtm the post pass is what it was.
 *
 * The frozen quality oracles (tools/birb-quality.mjs) observe the post pass,
 * so the default must build no eye, add no pass, and compile the composite
 * from the untouched COMPOSITE_FRAG string — the same string object, not an
 * equal one (bloom-pass.js's `compositePristine`).
 */
import { setupBiome, holdAt, eye, BASE_PASSES } from './auto-exposure-lib.mjs';

export const name = 'auto-exposure-off';
export const query = 'flight=classic';

export default async function run(ctx) {
  const { page } = ctx;
  await setupBiome(ctx);
  await holdAt(ctx, { U: [1, 0.08, 0.05], above: 30, pitch: 0.1 });
  const r = await eye(ctx);
  ctx.check(r.present === false && r.autoexp === false && r.localtm === false,
    `no eye is built without a flag (present ${r.present}, autoexp ${r.autoexp}, localtm ${r.localtm})`);
  ctx.check(r.postActive === true, `the post pass is running, so the comparison means something (${r.postActive})`);
  ctx.check(r.compositePristine === true, `the composite is compiled from the untouched source (${r.compositePristine})`);
  // The pass list: scene + bright + two blur passes + composite = 5, plus 3
  // shaft passes while the sun is in frame (1 on the frame it leaves). The
  // eye adds 2 (meter, adapt) and/or 4 (the fusion).
  const passes = await page.evaluate(() => window.__BIRB.frameTotals().passes);
  ctx.check(BASE_PASSES.includes(passes), `the frame runs the shipping pass list (${passes} render passes; ${BASE_PASSES.join('/')} expected)`);
  await page.evaluate(() => window.__BIRB.hold(false));
}
