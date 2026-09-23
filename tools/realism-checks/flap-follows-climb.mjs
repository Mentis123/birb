/**
 * The wing beat must follow the CLIMB, not the stick.
 *
 * Measured on main 54b1961 (2026-09-23): under the shipping default (stunt
 * model, pull back to climb) a 42-degree dive flapped ~2.6x harder than a
 * 43-degree climb (left wingtip travel SD 0.363 vs 0.140; the climb equalled
 * hands-off cruise at 0.137), and the tail elevator moved the wrong way.
 * index.html read the RAW stick (`climbing = pitchInput > 0.2`) while the
 * model's pitch was inverted inside the controller.
 *
 * The stick sign that means "climb" is READ from the probe, never assumed,
 * so flipping the pitch preference cannot turn this into a check that passes
 * for the wrong reason.
 */
export const name = 'flap-follows-climb';

const SAMPLE = `const p = B.birdPose(); const f = B.flightProbe();
  return { tip: p.leftTip ? p.leftTip[1] : 0, tail: p.tail ? p.tail.x : 0, pitch: f.pitchDeg };`;

export default async function run(ctx) {
  const { page } = ctx;
  const climbSign = await page.evaluate(() => {
    const t = window.__BIRB.flightProbe()?.tuning;
    return t && t.invertPitch === false ? 1 : -1;
  });
  const level = await page.evaluate(() => window.__BIRB.capturePose());
  const fly = async (y) => {
    await page.evaluate((p) => { const B = window.__BIRB; B.restorePose(p); B.setAltitude(220); }, level);
    await ctx.frames(20);
    return ctx.hold({ y }, 90, SAMPLE);
  };
  const climb = await fly(climbSign * 0.6);
  const dive = await fly(-climbSign * 0.6);

  const endClimb = climb[climb.length - 1].pitch;
  const endDive = dive[dive.length - 1].pitch;
  ctx.check(endClimb > 20, `the climb stick climbs (pitch ${endClimb.toFixed(1)} deg)`);
  ctx.check(endDive < -20, `the dive stick dives (pitch ${endDive.toFixed(1)} deg)`);

  const sdClimb = ctx.stats(climb.map((s) => s.tip)).sd;
  const sdDive = ctx.stats(dive.map((s) => s.tip)).sd;
  ctx.check(sdClimb > sdDive * 1.25,
    `the wings work harder climbing than diving (tip travel sd ${sdClimb.toFixed(3)} climb vs ${sdDive.toFixed(3)} dive)`);

  // The tail is an elevator: it DROPS on a climb (negative rotation.x in this
  // rig, see tailPitchOffset) and lifts on a dive.
  const tailClimb = ctx.stats(climb.slice(20).map((s) => s.tail)).mean;
  const tailDive = ctx.stats(dive.slice(20).map((s) => s.tail)).mean;
  ctx.check(tailClimb < tailDive,
    `the tail drops on the climb and lifts on the dive (${tailClimb.toFixed(3)} vs ${tailDive.toFixed(3)})`);

  await page.evaluate((p) => window.__BIRB.restorePose(p), level);
}
