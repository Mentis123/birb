/**
 * Speed morphs the wing: fast flight tucks and sweeps it and furls the tail
 * (a boost reads as a falcon's partial tuck); slow flight spreads the tail,
 * opens the hand and holds the full span; the stall splays the primaries.
 *
 * realism/aero-pose. The fast case is the Ring Rush sprint (a level 24 u/s,
 * 2.2x cruise, so no dive confounds it); the slow case is idle throttle held
 * until the energy model settles near 0.55x cruise; the stall is a pull to
 * the vertical at idle — the hammerhead, which is how one is flown.
 */
export const name = 'aero-pose-morph';

const SAMPLE = `const a = B.aeroPose(); const f = B.flightProbe(); const p = B.birdPose();
  return { span: a.span, morph: a.morphSpan, sweep: a.sweep, splay: a.splay, fan: a.tailFan,
    stalled: a.stalled, speed: f.speed, rec: f.recovery, wingY: p.leftWing.y, spanZ: p.leftWingSpanZ };`;

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

export default async function run(ctx) {
  const { page } = ctx;
  const climbSign = await page.evaluate(() => {
    const t = window.__BIRB.flightProbe()?.tuning;
    return t && t.invertPitch === false ? 1 : -1;
  });
  const level = await page.evaluate(() => window.__BIRB.capturePose());
  const reset = async () => {
    await page.evaluate((p) => {
      const B = window.__BIRB;
      B.setSprint?.(false);
      B.setRecovery?.('flying');
      B.restorePose(p);
      B.setAltitude(220);
    }, level);
    await ctx.frames(30);
  };

  // ---- cruise: the designed planform ----
  await reset();
  const cruise = await ctx.hold({}, 40, SAMPLE);
  const cruiseMorph = mean(cruise.slice(20).map((s) => s.morph));
  ctx.check(cruiseMorph > 0.97, `cruise flies the designed span (morph ${cruiseMorph.toFixed(3)})`);

  // ---- fast: tuck, sweep, furl ----
  await reset();
  await page.evaluate(() => window.__BIRB.setSprint(true));
  const fast = await ctx.hold({}, 60, SAMPLE);
  // Saved only under --out: the chase view of the tuck, for the eye.
  await ctx.shot('fast-tuck');
  await page.evaluate(() => window.__BIRB.setSprint(false));
  const fastTail = fast.slice(40);
  const fastMorph = mean(fastTail.map((s) => s.morph));
  const fastSweep = mean(fastTail.map((s) => s.sweep));
  const fastFan = mean(fastTail.map((s) => s.fan));
  const fastSpeed = mean(fastTail.map((s) => s.speed));
  ctx.check(fastSpeed > 18, `the sprint is fast (${fastSpeed.toFixed(1)} u/s)`);
  ctx.check(fastMorph < 0.72, `fast flight tucks the span (morph ${fastMorph.toFixed(3)})`);
  ctx.check(fastSweep > 0.2, `and sweeps the wing aft (sweep ${fastSweep.toFixed(3)} rad)`);
  ctx.check(fastFan < 0.9, `and furls the tail (fan ${fastFan.toFixed(3)})`);
  // The rig actually wears it: the wing's own y rotation and span scale.
  const wingY = mean(fastTail.map((s) => s.wingY));
  const spanZ = mean(fastTail.map((s) => s.spanZ));
  ctx.check(wingY < mean(cruise.map((s) => s.wingY)) - 0.15 && spanZ < 0.8,
    `the left wing is swept (rotation.y ${wingY.toFixed(3)}) and pulled in (scale.z ${spanZ.toFixed(3)})`);

  // ---- slow: spread, open ----
  await reset();
  const slow = await ctx.hold({ throttle: 0.55 }, 110, SAMPLE);
  await ctx.shot('slow-spread');
  const slowTail = slow.slice(80);
  const slowSpeed = mean(slowTail.map((s) => s.speed));
  const slowFan = mean(slowTail.map((s) => s.fan));
  const slowSplay = mean(slowTail.map((s) => s.splay));
  const slowMorph = mean(slowTail.map((s) => s.morph));
  const slowSweep = mean(slowTail.map((s) => s.sweep));
  ctx.check(slowSpeed < 7.5, `idle throttle slows the bird (${slowSpeed.toFixed(2)} u/s)`);
  ctx.check(slowFan > 1.3, `slow flight fans the tail (fan ${slowFan.toFixed(3)})`);
  ctx.check(slowSplay > 0.4, `and opens the hand (splay ${slowSplay.toFixed(3)})`);
  ctx.check(slowMorph > 0.97 && slowSweep <= 0, `at full span, held forward (morph ${slowMorph.toFixed(3)}, sweep ${slowSweep.toFixed(3)})`);

  // ---- the stall: a steep pull at idle ----
  // 0.75 of stick holds a climb near 60 degrees rather than looping; at idle
  // the energy model has no answer for that angle and bleeds the bird to its
  // 0.35x floor, well under the 0.5x stall.
  await reset();
  const stall = await ctx.hold({ y: climbSign * 0.75, throttle: 0.55 }, 90, SAMPLE);
  await ctx.shot('stall');
  const stalledSamples = stall.filter((s) => s.stalled);
  ctx.check(stalledSamples.length > 0, `a vertical pull at idle stalls the wing (${stalledSamples.length} stalled frames, min speed ${Math.min(...stall.map((s) => s.speed)).toFixed(2)})`);
  const peakSplay = Math.max(...stall.map((s) => s.splay));
  const peakFan = Math.max(...stall.map((s) => s.fan));
  ctx.check(peakSplay > 0.8, `the stall splays the primaries (peak splay ${peakSplay.toFixed(3)})`);
  ctx.check(peakFan > 1.4, `and fans the tail wide (peak fan ${peakFan.toFixed(3)})`);

  const flew = [...cruise, ...fast, ...slow, ...stall].every((s) => s.rec === 'flying');
  ctx.check(flew, 'the bird was flying through every hold');
  await page.evaluate((p) => { window.__BIRB.setSprint?.(false); window.__BIRB.restorePose(p); }, level);
}
