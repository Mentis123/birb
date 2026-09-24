/**
 * At a typical view the eye leaves the authored exposure alone.
 *
 * EXPOSURE_KEYS in src/effects/exposure.js are the metered log2 luminance of
 * each biome's REFERENCE VIEW: the median of 16 views (8 spots x 2 level
 * headings), 30 units over the ground, nose 0.1 rad down, seeded world, the
 * sun at the palettes' authored elevation. At the key the EV is exactly 0, so
 * the authored look is the centre of the eye's range, not something it
 * overrides. This re-meters those 16 views per biome and asserts the key still
 * sits on their median — a palette, fog or lighting change that moves a
 * biome's typical brightness fails here, rather than silently turning the eye
 * into a global exposure shift.
 */
import { setupBiome, holdAt, eye, headings, CALIBRATION } from './auto-exposure-lib.mjs';
import { EXPOSURE_KEYS, AUTO_EXPOSURE } from '../../src/effects/exposure.js';

export const name = 'auto-exposure-calibration';
export const query = 'flight=classic&autoexp=1';

export default async function run(ctx) {
  for (const env of ['forest', 'canyons', 'mountain', 'city']) {
    await setupBiome(ctx, { env });
    const vals = [];
    for (const U of CALIBRATION.spots) {
      for (const F of headings(U)) {
        await holdAt(ctx, { U, F, above: CALIBRATION.above, pitch: CALIBRATION.pitch });
        await eye(ctx, { snap: true });
        await ctx.frames(2);
        vals.push((await eye(ctx)).measured);
      }
    }
    const sorted = [...vals].sort((a, b) => a - b);
    const median = (sorted[7] + sorted[8]) / 2;
    const key = EXPOSURE_KEYS[env];
    ctx.log(`${env}: median ${median.toFixed(3)} (key ${key}), range ${sorted[0].toFixed(2)} .. ${sorted.at(-1).toFixed(2)}; ${vals.map((v) => v.toFixed(2)).join(' ')}`);
    ctx.check(Math.abs(median - key) <= CALIBRATION.tolerance,
      `${env}: the key sits on the typical view (median ${median.toFixed(3)} vs key ${key}, EV at the median ${(AUTO_EXPOSURE.strength * (key - median)).toFixed(3)})`);
  }
  await ctx.page.evaluate(() => { const B = window.__BIRB; B.setEnvironment('forest'); B.hold(false); });
  await ctx.frames(3);
}
