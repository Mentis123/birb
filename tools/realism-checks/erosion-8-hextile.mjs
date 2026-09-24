/**
 * ?erosion=1 together with ?hextile=1 — the one combination of two wave
 * shaders that meet in the same block of the ground's fragment shader (the
 * wet block is spliced AFTER the hex/triplanar overlay, and the program key
 * carries both suffixes). Never booted before this review.
 *
 * A shader that fails to compile draws nothing and the page still paints, so
 * the runner's clean-console rule is half of this; the other half is a frame
 * of ground that is actually lit and textured, and the wetness still moving
 * it under the hex tiling.
 */
import { CHANNEL } from './erosion-lib.mjs';

export const name = 'erosion-hextile';
export const query = 'erosion=1&hextile=1';

export default async function run(ctx) {
  const { page } = ctx;
  const st = await page.evaluate(() => {
    const B = window.__BIRB;
    B.setEnvironment('forest');
    const e = B.erosion({ agreement: false });
    return { enabled: e.enabled, wet: e.wetTexture, search: location.search };
  });
  ctx.check(st.enabled && st.wet, `forest boots eroded with the wetness map under hextile (${st.search})`);
  await ctx.frames(4);

  // Top-down over the trunk channel, ground only, gust and clock held; the
  // wetness at 1 then 0 in the same program.
  const u = CHANNEL.map((v) => v / Math.hypot(...CHANNEL));
  const q = ctx.levelQuat(u, 1.45);
  await page.evaluate(({ pos, q }) => {
    const B = window.__BIRB;
    B.pinTier(0); B.setSunTime(0); B.setSunEnabled(false);
    if (typeof B.stillAir === 'function') B.stillAir(true);
    B.setCameraView('fpv'); B.hold(false);
    B.restorePose({ position: pos, quaternion: q });
    B.freeze(true); B.hold(true);
    B.solo('sphere-ground');
  }, { pos: u.map((v) => v * 168), q });
  await ctx.frames(8);
  const shoot = async (strength, label) => {
    await page.evaluate((s) => window.__BIRB.erosion({ agreement: false, wetStrength: s }), strength);
    await ctx.frames(4);
    return ctx.shot(label);
  };
  const a = await shoot(1, 'hex-wet1');
  const b = await shoot(0, 'hex-wet0');
  const c = await shoot(1, 'hex-wet1b');
  const diff = (p, r) => {
    let s = 0; let n = 0; let big = 0;
    for (let i = 0; i < p.data.length; i += p.ch * 4) {
      const lp = 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
      const lr = 0.2126 * r.data[i] + 0.7152 * r.data[i + 1] + 0.0722 * r.data[i + 2];
      s += Math.abs(lp - lr); n++; if (Math.abs(lp - lr) > 4) big++;
    }
    return { mean: s / n, share: big / n };
  };
  const L = ctx.lum(a);
  // Spread of the frame: a shader that compiled to a flat colour (or black)
  // has none.
  let lo = 255; let hi = 0;
  for (let i = 0; i < a.data.length; i += a.ch * 16) {
    const l = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
    if (l < lo) lo = l; if (l > hi) hi = l;
  }
  const ab = diff(a, b); const ac = diff(a, c);
  ctx.check(L > 20 && L < 235 && hi - lo > 30,
    `a lit, textured ground frame under hex tiling + erosion (mean luminance ${L.toFixed(1)}, range ${lo.toFixed(0)}-${hi.toFixed(0)})`);
  ctx.check(ab.mean > 0.5 && ac.mean < 0.05,
    `the wetness still moves the frame under hex tiling: mean |dL| ${ab.mean.toFixed(2)} (${(100 * ab.share).toFixed(1)}% of pixels > 4) against a control of ${ac.mean.toFixed(3)}`);
  await page.evaluate(() => {
    const B = window.__BIRB;
    B.solo(null); B.hold(false); B.freeze(false); B.setCameraView('chase'); B.setSunEnabled(true);
    if (typeof B.stillAir === 'function') B.stillAir(false);
  });
  await ctx.frames(4);
}
