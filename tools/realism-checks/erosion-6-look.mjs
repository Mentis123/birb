/**
 * What the flag looks like, from altitude — and what the wetness does, measured.
 *
 * Three absolute poses over the seeded forest (erosion-lib.mjs ERODED_VIEWS),
 * the same ones erosion-off photographs on the default boot: run with --out
 * and the pairs are the before and after the owner can look at.
 *
 * Then the wetness, as a live A/B in ONE frame: the tint's strength goes
 * 1, 0, 1, 0 over the channel with the clock held, so the two ONs and the two
 * OFFs are the control. It must change the frame far more than the control
 * does, change a LINE of it rather than all of it (drainage, not a colour
 * wash), and only ever darken — wet ground is darker ground.
 */
import { ERODED_VIEWS, seededForest, shootViews, placeAbsolute, restoreView } from './erosion-lib.mjs';

export const name = 'erosion-look';
export const query = 'erosion=1';

function diff(a, b) {
  let sum = 0; let changed = 0; let brighter = 0; let n = 0;
  for (let y = 0; y < a.h; y += 2) {
    for (let x = 0; x < a.w; x += 2) {
      // DOM overlays (minimap top right, buttons bottom right) are not the world.
      if ((y < 150 && x > a.w - 150) || (y > a.h - 90 && x > a.w - 170)) continue;
      const i = (y * a.w + x) * a.ch;
      const la = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
      const lb = 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2];
      const d = Math.abs(la - lb);
      sum += d; n += 1;
      if (d > 4) changed += 1;
      if (la > lb + 2) brighter += 1;
    }
  }
  return { mean: sum / n, changed: changed / n, brighter: brighter / n };
}

export default async function run(ctx) {
  const { page } = ctx;
  await seededForest(ctx);
  const shots = await shootViews(ctx, ERODED_VIEWS, 'on');
  ctx.check(shots.every((s) => s.ok), `photographed the eroded views (${shots.map((s) => s.label).join(', ')})`);

  // Live A/B of the wetness over the channel, ground alone.
  await placeAbsolute(ctx, ERODED_VIEWS[0]);
  await page.evaluate(() => window.__BIRB.solo('sphere-ground'));
  const frame = [];
  for (const s of [1, 0, 1, 0]) {
    await page.evaluate((v) => window.__BIRB.erosion({ agreement: false, wetStrength: v }), s);
    await ctx.frames(3);
    frame.push(await ctx.shot(`wet-${s}`));
  }
  await page.evaluate(() => window.__BIRB.erosion({ agreement: false, wetStrength: 1 }));
  const control = Math.max(diff(frame[0], frame[2]).mean, diff(frame[1], frame[3]).mean);
  const effect = diff(frame[0], frame[1]);
  ctx.log(`wetness over the channel: mean |dL| ${effect.mean.toFixed(2)} (control ${control.toFixed(3)}), `
    + `${(100 * effect.changed).toFixed(1)}% of the frame changed, ${(100 * effect.brighter).toFixed(2)}% brighter`);
  ctx.check(effect.mean > 0.5 && effect.mean > 10 * control,
    `the wetness is visible: mean |dL| ${effect.mean.toFixed(2)} against a control of ${control.toFixed(3)}`);
  ctx.check(effect.changed > 0.01 && effect.changed < 0.35,
    `it is a network, not a wash: ${(100 * effect.changed).toFixed(1)}% of the frame changed by more than 4 levels`);
  ctx.check(effect.brighter < 0.002, `wet ground only darkens (${(100 * effect.brighter).toFixed(2)}% of pixels brighter)`);
  await restoreView(ctx);
}
