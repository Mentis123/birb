/**
 * A cloud is soft at the edge and costs one draw call.
 *
 * Measured on e252ca1 (2026-09-23): the phone's clouds were single opaque
 * Lambert icosahedra with an alpha-tested noise rim — the builder's own
 * comment calls them "floating rocks" — and the desktop's were the same
 * polyhedra at a flat 0.6-0.7 opacity. Both are HARD-edged: the silhouette
 * goes from sky to cloud inside a couple of pixels.
 *
 * The volume (src/environment/cloud-volume.js) integrates density along the
 * view ray, so alpha falls to zero at the rim by construction. Measured here
 * as the width of the ramp in |clouds shown - clouds hidden| across the
 * silhouette, on 24 rays from the cloud's centre, cockpit view so the bird
 * is not in the frame, one boot, one pose, with the shown frame repeated as
 * the control. The same pose also reads the cloud mesh's cost: one draw call
 * with it shown vs hidden — a transparent DoubleSide material renders in TWO
 * passes in three unless `forceSinglePass` is set, and that would read 2.
 */
import { setupForest, LOOK, edgeProfile, holdPose } from './cloud-volume-lib.mjs';

export const name = 'cloud-volume-look';
// Classic flight holds a frozen pose exactly (the stunt model's idle
// stabilisers keep turning a bird at speed 0), and its own boot keeps the
// reseeded world away from every other check.
export const query = 'flight=classic';

// Coverage per pixel from a FLAT magenta cloud: green is exactly 0 in the
// cloud's own colour, so what green survives is the background showing
// through — alpha = 1 - G(shown) / G(hidden), whatever is behind it.
function coverage(shown, hidden) {
  const { w, h, ch } = shown;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const gh = hidden.data[i * ch + 1];
    out[i] = gh > 24 ? 255 * Math.min(1, Math.max(0, 1 - shown.data[i * ch + 1] / gh)) : 0;
  }
  return out;
}

export async function measureCloudEdge(ctx, label) {
  const { page } = ctx;
  await setupForest(ctx);
  const info = await page.evaluate(() => window.__BIRB.clouds());
  const view = await page.evaluate(() => {
    const B = window.__BIRB;
    B.setCameraView('fpv');
    // Bloom off for the measurement: a glow is not coverage.
    const bloom = B.setBloom({}).enabled;
    B.setBloom({ enabled: false });
    return { bloom };
  });
  // Re-posed every frame, then every clock stopped: the frames below differ
  // only by what they toggle, and both boots photograph the same pose.
  view.r = (await holdPose(ctx, "return B.goToCloud(arg, { back: 70, view: 'away' });", LOOK.cloud, 6)).last;
  const shoot = async (state, tag) => {
    await page.evaluate((s) => window.__BIRB.clouds(s), state);
    await ctx.frames(3);
    const stats = await page.evaluate(() => window.__BIRB.stats());
    return { png: await ctx.shot(`${label}-${tag}`), calls: stats.calls, tris: stats.triangles };
  };
  const shaded = await shoot({ visible: true, flat: false }, 'shaded');
  const hiddenShaded = await shoot({ visible: false }, 'hidden');
  const flat = await shoot({ visible: true, flat: true }, 'flat');
  const hidden = await shoot({ visible: false }, 'flat-hidden');
  const again = await shoot({ visible: true }, 'flat-again');
  await page.evaluate((bloom) => {
    const B = window.__BIRB; B.clouds({ visible: true, flat: false }); B.holdMotion(false);
    B.setCameraView('chase'); B.setBloom({ enabled: bloom });
  }, view.bloom);
  const { w, h } = flat.png;
  const alpha = coverage(flat.png, hidden.png);
  const alphaAgain = coverage(again.png, hidden.png);
  // Normalise by the footprint's own 95th percentile: fog tints the flat
  // colour toward the fog's (green included) by distance, which would read
  // as every pixel of a solid being "partly" covered.
  const inFoot = Array.from(alpha).filter((v) => v > 25).sort((p, q) => p - q);
  const p95 = inFoot.length ? inFoot[Math.floor(inFoot.length * 0.95)] : 255;
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = Math.min(255, (alpha[i] * 255) / p95);
    alphaAgain[i] = Math.min(255, (alphaAgain[i] * 255) / p95);
  }
  const edge = edgeProfile(alpha, w, h, w / 2, h / 2);
  // Control: the same flat frame twice. Measured where the cloud is, as a
  // fraction of the cloud's own coverage there.
  let sig = 0; let noise = 0;
  // How much of the footprint is PARTLY covered: an alpha-tested solid is
  // 0 or 1 at every pixel but its anti-aliased rim; a volume is a gradient.
  let foot = 0; let partial = 0;
  for (let i = 0; i < alpha.length; i += 1) {
    if (alpha[i] > 25) { sig += alpha[i]; noise += Math.abs(alpha[i] - alphaAgain[i]); foot += 1; }
    if (alpha[i] > 25 && alpha[i] < 230) partial += 1;
  }
  const controlFraction = sig > 0 ? noise / sig : 1;
  return {
    info, view: view.r, bloom: view.bloom, edge, controlFraction, partial: foot ? partial / foot : 0, foot,
    shown: shaded, hidden: hiddenShaded, flat,
  };
}

export default async function run(ctx) {
  const m = await measureCloudEdge(ctx, 'vol');
  const { info, edge } = m;
  ctx.log(`cloud ${LOOK.cloud}: sun ${m.view?.sunElevation} deg above its horizon, ${m.view?.distance} units away`);
  ctx.check(!!info && info.volumetric === true, `the forest's clouds are volumetric (${info?.clouds} clouds, ${info?.puffs} puffs)`);
  const mat = info?.material || {};
  ctx.check(mat.transparent === true && mat.depthWrite === false && mat.side === 2 && mat.forceSinglePass === true && !mat.alphaTest,
    `puffs are transparent, double-sided, single-pass, no depth write, no alpha test (${JSON.stringify(mat)})`);
  ctx.check(edge.rays >= 8, `the cloud is in frame on ${edge.rays}/24 rays`);
  const ratio = edge.width / Math.max(1, edge.radius);
  ctx.check(edge.width >= 8 && ratio >= 0.12,
    `the silhouette is soft: alpha takes ${edge.width} px to fall from 90% to 10%, ${(ratio * 100).toFixed(1)}% of the cloud's ${edge.radius} px radius`);
  ctx.check(m.partial >= 0.3,
    `${(m.partial * 100).toFixed(1)}% of the cloud's ${m.foot} px footprint is partly transparent (a volume, not a solid)`);
  ctx.check(m.controlFraction < 0.05, `the control pair is stable (${(m.controlFraction * 100).toFixed(2)}% of the coverage moved between identical frames)`);
  const dCalls = m.shown.calls - m.hidden.calls;
  const dTris = m.shown.tris - m.hidden.tris;
  ctx.check(dCalls === 1, `every puff is ONE draw call (shown ${m.shown.calls} vs hidden ${m.hidden.calls})`);
  ctx.check(dTris === info.puffs * 80, `the clouds are ${dTris} triangles: ${info.puffs} puffs x 80, nothing else`);

  // Back to front, measured on the frame: the same pose with the puffs in
  // build order. The instance matrices themselves are read back for the
  // inversion count, so this is what the GPU was handed, not bookkeeping.
  await ctx.page.evaluate(() => {
    const B = window.__BIRB;
    B.setCameraView('fpv');
    B.setBloom({ enabled: false });
  });
  await holdPose(ctx, "return B.goToCloud(arg, { back: 70, view: 'away' });", LOOK.cloud, 6);
  await ctx.frames(1);
  const sorted = await ctx.page.evaluate(() => window.__BIRB.clouds());
  const pngSorted = await ctx.shot('sorted');
  await ctx.page.evaluate(() => window.__BIRB.clouds({ sort: false }));
  await ctx.frames(3);
  const unsorted = await ctx.page.evaluate(() => window.__BIRB.clouds());
  const pngUnsorted = await ctx.shot('build-order');
  await ctx.page.evaluate(() => window.__BIRB.clouds({ sort: true }));
  await ctx.frames(3);
  const pngAgain = await ctx.shot('sorted-again');
  await ctx.page.evaluate((b) => {
    const B = window.__BIRB; B.holdMotion(false); B.setCameraView('chase'); B.setBloom({ enabled: b });
  }, m.bloom);
  const lumDiff = (p, q) => {
    let s = 0; let n = 0;
    for (let k = 0; k < p.w * p.h; k += 1) {
      const lp = 0.2126 * p.data[k * p.ch] + 0.7152 * p.data[k * p.ch + 1] + 0.0722 * p.data[k * p.ch + 2];
      const lq = 0.2126 * q.data[k * q.ch] + 0.7152 * q.data[k * q.ch + 1] + 0.0722 * q.data[k * q.ch + 2];
      const d = Math.abs(lp - lq);
      if (d > 0.5) { s += d; n += 1; }
    }
    return { mean: n ? s / n : 0, px: n };
  };
  const order = lumDiff(pngSorted, pngUnsorted);
  const noise = lumDiff(pngSorted, pngAgain);
  ctx.log(`build order vs back to front: ${order.px} px change by ${order.mean.toFixed(1)}/255 on average `
    + `(control ${noise.px} px); ${unsorted.sort?.inversions} of ${info.puffs - 1} neighbouring pairs were inverted`);
  ctx.check(sorted.sort?.enabled && sorted.sort.inversions === 0 && sorted.sort.writes > 0,
    `the puffs draw back to front (${sorted.sort?.inversions} inversions after ${sorted.sort?.writes} re-sorts)`);
  ctx.check(noise.px <= Math.max(20, 0.02 * order.px), `the sort A/B control is still (${noise.px} px moved between identical frames)`);

  // The mountain's clouds are the same material path; its shaders must
  // compile too (the runner fails this boot on any console error).
  await ctx.page.evaluate(() => { const B = window.__BIRB; B.setEnvironment('mountain'); });
  await ctx.frames(6);
  const mtn = await ctx.page.evaluate(() => {
    const B = window.__BIRB;
    B.setCameraView('fpv');
    const r = B.goToCloud(0, { back: 60, view: 'away' });
    B.freeze(true);
    return { r, c: B.clouds() };
  });
  await ctx.frames(6);
  await ctx.shot('mountain');
  ctx.check(!!mtn.c && mtn.c.volumetric && mtn.c.shadowSpheres === mtn.c.clouds,
    `the mountain's clouds are volumetric and cast ${mtn.c?.shadowSpheres} real shadows`);
  await ctx.page.evaluate(() => { const B = window.__BIRB; B.setCameraView('chase'); B.setEnvironment('forest'); });
  await ctx.frames(4);
  await ctx.unfreeze();
}
