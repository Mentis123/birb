/**
 * The forest ground map stops repeating under ?hextile=1.
 *
 * The authored map is laid every 18 units, so the default ground is one
 * photograph in a lattice: the same dark blotch, the same pale patch, in
 * rows across every valley. Measured here as the correlation of the ground
 * with itself one tile away, in the TEXTURE's own coordinates (rectifyGrid in
 * hex-tiling-lib.mjs says why not in pixels), band-passed to the gravel's
 * grain and clumps (0.1-1.2 units).
 *
 * Same pose — cockpit camera 40 units up, straight down, clock held, props
 * and horizon shadows off — hex OFF, ON, OFF, ON by runtime recompile. Off
 * is the default triplanar program itself (the unit suite pins its source
 * byte for byte), not a copy of it. The two offs and the two ons are the
 * control: the frames must repeat pixel for pixel, or nothing below is a
 * measurement.
 */
import fs from 'node:fs';
import { measureHexAB, restore, TILE, DETAIL_LATTICE } from './hex-tiling-lib.mjs';

export const name = 'hex-tiling-repeat';
export const query = 'hextile=1';

/** Shared with hex-tiling-flat: every assertion the A/B supports. */
export async function assertNoRepeat(ctx, label) {
  const { page } = ctx;
  const state = await page.evaluate(() => window.__BIRB.hexTile());
  ctx.check(!!state && state.enabled && state.define, `${label}: the ground was built hex-tiled (${JSON.stringify(state)})`);
  if (!state) return null;

  // HEX_TILING_DUMP=grid.json keeps the grid, so the saved shots (--out) can
  // be re-analysed offline without another boot.
  const ab = await measureHexAB(ctx, {
    dump: process.env.HEX_TILING_DUMP ? (g) => fs.writeFileSync(process.env.HEX_TILING_DUMP, JSON.stringify(g)) : null,
  });
  const { view } = ab;
  ctx.check(!!view.lag, `${label}: a tile projects into the frame — ${TILE} units along world ${view.vAxis} (projection ${view.axis}) `
    + `is ${view.lag ? Math.hypot(...view.lag).toFixed(0) : 'n/a'} px up it and `
    + `${view.lagBack ? Math.hypot(...view.lagBack).toFixed(0) : 'n/a'} px down it: a perspective view, not a map`);
  if (!view.lag) return null;

  const { shots, noise } = ab;
  ctx.check(ab.intrusion < 0.25,
    `${label}: the frame is ground — ${(ab.intrusion * 100).toFixed(1)}% masked as not-ground (motes, drones, the brightest sunlit gravel)`);
  ctx.check(!shots['off-1'].state.enabled && !shots['off-1'].state.define
    && shots['on-1'].state.enabled && shots['on-1'].state.define,
  `${label}: the runtime flip reaches the program (off ${JSON.stringify(shots['off-1'].state)}, on ${JSON.stringify(shots['on-1'].state)})`);
  ctx.check(noise.off < 0.05 && noise.on < 0.05 && noise.arms > 2,
    `${label}: the control pairs repeat (off/off ${noise.off.toFixed(3)}, on/on ${noise.on.toFixed(3)} of 255, mean abs) and the arms do not (${noise.arms.toFixed(2)})`);

  const ctlNames = ['0.37 tile', '0.61 tile', '1/3 tile across', `detail lattice ${DETAIL_LATTICE.toFixed(2)}u`];
  const nullText = (n) => `null of ${n.n} non-tile lags ${n.mean.toFixed(3)} +/- ${n.sd.toFixed(3)} (max ${n.max.toFixed(3)}), z ${n.z.toFixed(1)}`;
  for (const [k, s] of Object.entries(shots)) {
    ctx.log(`${label} ${k}: r one tile away ${s.rep.period.r.toFixed(3)} (lag ${s.rep.period.lag}/${s.rep.samplesPerTile}, `
      + `${s.rep.period.n} cells) | ${nullText(s.rep.null)} | ${s.rep.controls.map((c, i) => `${ctlNames[i]} ${c.r.toFixed(3)}`).join(', ')} `
      + `| raw-pixel r ${s.rawPixel.toFixed(3)} | mean ${s.mean.toFixed(4)}`);
  }
  // One tile against the same statistic at 64 lags that are not a tile: the
  // triplanar must stand out of that distribution (z > 4, and half as high
  // again as its largest member), the hex tiling must sit inside it (z < 3)
  // at a third of the triplanar's value or less. Relative to the null, not
  // to fixed numbers, because the frames differ: the flat ground's facet
  // edges are hard lines, and in a coarser band they doubled its null's
  // spread. The named controls (logged above) include the procedural
  // mottle's own value-noise lattice, the one structured lag this frame has.
  const off = shots['off-1']; const on = shots['on-1'];
  ctx.check(off.rep.null.z > 4 && off.rep.period.r > 1.5 * off.rep.null.max,
    `${label}, triplanar (hex off): the ground repeats — r ${off.rep.period.r.toFixed(3)} one tile away; ${nullText(off.rep.null)}`);
  ctx.check(on.rep.null.z < 3 && on.rep.period.r < off.rep.period.r / 3,
    `${label}, hex-tiled: the repeat is gone — r ${on.rep.period.r.toFixed(3)} one tile away (off ${off.rep.period.r.toFixed(3)}); ${nullText(on.rep.null)}`);
  ctx.check(Math.abs(shots['off-2'].rep.period.r - off.rep.period.r) < 1e-6 && Math.abs(shots['on-2'].rep.period.r - on.rep.period.r) < 1e-6,
    `${label}: the measurement repeats on the control frames (off ${shots['off-2'].rep.period.r.toFixed(3)}, on ${shots['on-2'].rep.period.r.toFixed(3)})`);
  const meanShift = on.mean / off.mean - 1;
  ctx.check(Math.abs(meanShift) < 0.02,
    `${label}: hex tiling keeps the ground's value — mean linear luminance ${off.mean.toFixed(4)} -> ${on.mean.toFixed(4)} (${(meanShift * 100).toFixed(2)}%)`);
  return ab;
}

export default async function run(ctx) {
  await assertNoRepeat(ctx, 'smooth');
  await restore(ctx);
}
