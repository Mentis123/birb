/**
 * The cloud colour and in-cloud fog A/B's other side: `?atmos=0`, the
 * realism wave's atmosphere model off.
 *
 * With the model off nothing recolours the fog or the valley mist with the
 * sun, so the in-cloud fog must not move either (it is authored from the
 * mist and rides the same ratio, which is now 1). The cloud's own colour
 * still follows the key light — under ?atmos=0 the key is warmed by the old
 * warmth heuristic — and is reported beside cloud-volume-compose's
 * atmosphere-on numbers for the owner.
 */
import {
  setupForest, setSun, sunExtremes, measureCloudColour, LOOK, ensureFlying,
} from './cloud-volume-lib.mjs';

export const name = 'cloud-volume-atmos-off';
export const query = 'atmos=0&flight=classic';

export default async function run(ctx) {
  const { page } = ctx;
  await setupForest(ctx);
  const ex = await sunExtremes(ctx);
  ctx.log(`sun cycle: lowest raised elevation ${ex.low.e} deg at t=${ex.low.t}s, highest ${ex.high.e} deg at t=${ex.high.t}s`);
  const at = async (t, tag) => {
    await ensureFlying(ctx);
    await setSun(ctx, t);
    await ctx.frames(3);
    const rig = await page.evaluate(() => {
      const B = window.__BIRB; const r = B.lightRig();
      return { fog: r.fogColor, mist: r.mistColor, key: r.keyColor, atmos: r.atmos, cloudFog: B.clouds().fogColor };
    });
    const colour = await measureCloudColour(ctx, LOOK.cloud, `colour-${tag}`);
    return { ...rig, colour };
  };
  const low = await at(ex.low.t, 'low');
  const high = await at(ex.high.t, 'high');
  const fmt = (v) => v.map((x) => x.toFixed(3)).join('/');
  const ratio = (p, q) => p.map((v, c) => v / q[c]);
  ctx.check(low.atmos === false, 'the atmosphere model is off in this boot');
  const rCloud = ratio(low.cloudFog, high.cloudFog);
  ctx.check(rCloud.every((v) => Math.abs(v - 1) < 1e-3),
    `with nothing recolouring the mist, the in-cloud fog holds still (low / high ${fmt(rCloud)})`);
  const warm = (rgb) => (rgb ? rgb[0] / rgb[2] : NaN);
  const lum = (rgb) => (rgb ? 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] : NaN);
  ctx.log(`cloud ${LOOK.cloud}'s own colour (linear) under ?atmos=0: low sun ${fmt(low.colour.rgb || [0, 0, 0])} (${low.colour.px} px), `
    + `high sun ${fmt(high.colour.rgb || [0, 0, 0])} (${high.colour.px} px); R/B ${warm(low.colour.rgb).toFixed(3)} vs ${warm(high.colour.rgb).toFixed(3)}, `
    + `luminance ${lum(low.colour.rgb).toFixed(3)} vs ${lum(high.colour.rgb).toFixed(3)}; key colour ${fmt(low.key)} vs ${fmt(high.key)}`);
  ctx.check(low.colour.recovery === 'flying' && high.colour.recovery === 'flying',
    `the bird is flying at both colour poses (${low.colour.recovery} / ${high.colour.recovery})`);
  ctx.check(low.colour.px > 200 && high.colour.px > 200, `the cloud is measurable at both suns (${low.colour.px} / ${high.colour.px} px)`);
  await ctx.unfreeze();
}
