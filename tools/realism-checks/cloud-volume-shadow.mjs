/**
 * A cloud's shadow falls where the cloud is.
 *
 * Measured on e252ca1 (2026-09-23): the only cloud shadows in the world were
 * two crossed sine fields scrolling across every surface (addAtmosphere's
 * `uBirbCloud`, 0.42) — with no relation to where any cloud was, drifting
 * under a clear sky and absent under the clouds themselves.
 *
 * With volume on, the forest and mountain materials receive the cloud-level
 * spheres and darken the DIRECT light by the sun ray's optical depth through
 * them. Here: the sun ray is followed back from a cloud's centre to the
 * rendered ground (goToCloudShadow), the camera looks straight down at that
 * spot, and the same pose is shot with the shadow at full strength, at zero
 * and at full again (the control). The ratio image must hold a shadow — a
 * dark core, soft edges, centred on the predicted spot — and nothing else.
 */
import { setupForest, setSun, lumArray, shadowStats, holdPose } from './cloud-volume-lib.mjs';

export const name = 'cloud-volume-shadow';
export const query = 'flight=classic';

// Pick a cloud and a time where the shadow lands on dry ground under a sun
// well above the local horizon, so the frame is about the shadow and not
// about a lake or a sunset.
async function findSpot(ctx) {
  let best = null;
  for (const t of [0, 30, 60, 90, 120, 480, 510, 540, 570]) {
    await setSun(ctx, t);
    const found = await ctx.page.evaluate(() => {
      const B = window.__BIRB;
      const n = B.clouds()?.clouds || 0;
      const out = [];
      for (let i = 0; i < n; i += 1) {
        const r = B.goToCloudShadow(i, { above: 40, tilt: 0.2 });
        if (r) out.push({ i, ...r });
      }
      return out;
    });
    for (const f of found) {
      if (f.water || f.visibility > 0.35) continue;
      if (!best || f.sunElevation > best.sunElevation) best = { ...f, t };
    }
    if (best && best.sunElevation > 55) break;
  }
  return best;
}

export default async function run(ctx) {
  const { page } = ctx;
  await setupForest(ctx);
  const spot = await findSpot(ctx);
  ctx.check(!!spot, spot
    ? `a cloud shadow on dry ground: cloud ${spot.i} at t=${spot.t}s, sun ${spot.sunElevation} deg up at the spot, analytic visibility ${spot.visibility}`
    : 'no cloud shadow lands on dry ground under a raised sun');
  if (!spot) return;
  await setSun(ctx, spot.t);
  const pose = await page.evaluate(() => {
    const B = window.__BIRB;
    B.setCameraView('fpv');
    // The post pass is not part of a ratio; off, so its grain is not noise.
    const bloom = B.setBloom({}).enabled;
    B.setBloom({ enabled: false });
    return { bloom, live: B.clouds() };
  });
  // Re-posed every frame, then every clock stopped: the three frames below
  // differ only by the shadow strength, and the view is centred on the spot.
  pose.r = (await holdPose(ctx, 'return B.goToCloudShadow(arg, { above: 40, tilt: 0.2 });', spot.i, 6)).last;
  const strength = pose.live.tuning.shadowStrength;
  let w = 0; let h = 0;
  const shoot = async (s, tag) => {
    await page.evaluate((v) => window.__BIRB.clouds({ shadowStrength: v }), s);
    await ctx.frames(3);
    const png = await ctx.shot(`shadow-${tag}`);
    w = png.w; h = png.h;
    return lumArray(png, true);
  };
  const on = await shoot(strength, 'on');
  const off = await shoot(0, 'off');
  const again = await shoot(strength, 'on-again');
  await page.evaluate(() => window.__BIRB.holdMotion(false));
  const s = shadowStats(on, off, w, h);
  // Control both ways round, so a brightening would show as well.
  const c1 = shadowStats(again, on, w, h);
  const c2 = shadowStats(on, again, w, h);
  const noise = Math.max(c1.p99dev, c2.p99dev);
  ctx.log(`shadow: core ratio ${s.core.toFixed(3)} (min ${s.minRatio.toFixed(3)}), ${(s.darkFraction * 100).toFixed(1)}% of the ground darker by 5%+, `
    + `umbra ${s.umbra} / penumbra ${s.penumbra} cells, centroid ${s.centroid?.map((v) => v.toFixed(2))}`);
  ctx.check(noise < 0.02, `the control pair is stable (99th-percentile change ${(noise * 100).toFixed(2)}%)`);
  ctx.check(s.core <= 0.75, `the shadow's core takes ${((1 - s.core) * 100).toFixed(1)}% of the light away (want 25%+)`);
  ctx.check(s.darkFraction > 0.03 && s.darkFraction < 0.97,
    `the shadow is a region, not the frame: ${(s.darkFraction * 100).toFixed(1)}% of it`);
  ctx.check(s.penumbra >= 0.5 * s.umbra, `the edge is soft: ${s.penumbra} penumbra cells for ${s.umbra} umbra`);
  ctx.check(!!s.centroid && Math.abs(s.centroid[0] - 0.5) < 0.3 && Math.abs(s.centroid[1] - 0.5) < 0.3,
    `the shadow sits where the sun ray from the cloud meets the ground (centroid ${s.centroid?.map((v) => v.toFixed(2))})`);
  // The trade, stated: how much of the sunlit planet each kind of shadow
  // covers. Reported, not asserted — it is what the brief asked for, and the
  // owner should see the number before the phone does.
  const cov = await page.evaluate(() => window.__BIRB.cloudShadowCoverage(6000));
  if (cov) {
    ctx.log(`sunlit ground under a shadow: real clouds ${(cov.real * 100).toFixed(1)}% (mean direct loss ${(cov.realMean * 100).toFixed(1)}%), `
      + `the sine field they replace ${(cov.sine * 100).toFixed(1)}% (mean loss ${(cov.sineMean * 100).toFixed(1)}%), over ${cov.points} points`);
  }
  await page.evaluate(({ st, bloom }) => {
    const B = window.__BIRB; B.clouds({ shadowStrength: st }); B.setCameraView('chase'); B.setBloom({ enabled: bloom });
  }, { st: strength, bloom: pose.bloom });
  await ctx.unfreeze();
}
