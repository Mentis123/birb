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
 *
 * THE TAIL IS JUDGED BY WHERE ITS TIP GOES, not by an Euler angle
 * (realism/aero-pose, 2026-09-23). The first cut of this check read
 * `tail.rotation.x`, because that is where the old rig wrote its elevator —
 * but the tail is built along -X, so rotation.x is a TWIST about its own long
 * axis and a point on that axis does not move at all. Measured with
 * `birdPose().tailTip` under `?aeropose=0`, the old "elevator" moved the tip
 * by nothing on a climb or a dive whichever way round its sign was. Same
 * lesson as the bank dip: a rotation pair does not say which way a part went;
 * evaluating a point on it does.
 *
 * And the bird has to still be FLYING. The runner's shared setup flies the
 * bird at 40 units over the spawn grove, where a canopy or a drone can knock
 * it down, and a falling bird's stick is zeroed — one such run read pitch 0.0
 * on both holds and a tumble's flapping on both, which is a failure of the
 * setup, not of the thing measured. So each hold starts from FLYING and
 * asserts it stayed there.
 */
export const name = 'flap-follows-climb';

const SAMPLE = `const p = B.birdPose(); const f = B.flightProbe();
  return { tip: p.leftTip ? p.leftTip[1] : 0, tail: p.tailTip ? p.tailTip[1] : null,
    pitch: f.pitchDeg, rec: f.recovery };`;

export default async function run(ctx) {
  const { page } = ctx;
  const climbSign = await page.evaluate(() => {
    const t = window.__BIRB.flightProbe()?.tuning;
    return t && t.invertPitch === false ? 1 : -1;
  });
  const level = await page.evaluate(() => window.__BIRB.capturePose());
  const fly = async (y) => {
    await page.evaluate((p) => {
      const B = window.__BIRB;
      B.setRecovery?.('flying');
      B.restorePose(p);
      B.setAltitude(220);
    }, level);
    await ctx.frames(20);
    return ctx.hold({ y }, 90, SAMPLE);
  };
  const climb = await fly(climbSign * 0.6);
  const dive = await fly(-climbSign * 0.6);

  const flew = [...climb, ...dive].every((s) => s.rec === 'flying');
  ctx.check(flew, `the bird flew both holds (${[...new Set([...climb, ...dive].map((s) => s.rec))].join(', ')})`);

  const endClimb = climb[climb.length - 1].pitch;
  const endDive = dive[dive.length - 1].pitch;
  ctx.check(endClimb > 20, `the climb stick climbs (pitch ${endClimb.toFixed(1)} deg)`);
  ctx.check(endDive < -20, `the dive stick dives (pitch ${endDive.toFixed(1)} deg)`);

  const sdClimb = ctx.stats(climb.map((s) => s.tip)).sd;
  const sdDive = ctx.stats(dive.map((s) => s.tip)).sd;
  ctx.check(sdClimb > sdDive * 1.25,
    `the wings work harder climbing than diving (tip travel sd ${sdClimb.toFixed(3)} climb vs ${sdDive.toFixed(3)} dive)`);

  // The tail is an elevator: it DROPS on a climb and lifts on a dive
  // (tailPitchOffset's convention), measured as the height of a point near
  // its tip in the bird's own frame.
  const hasTip = climb.every((s) => Number.isFinite(s.tail)) && dive.every((s) => Number.isFinite(s.tail));
  ctx.check(hasTip, 'birdPose().tailTip is reported (the check cannot see the tail without it)');
  if (hasTip) {
    const tailClimb = ctx.stats(climb.slice(20).map((s) => s.tail)).mean;
    const tailDive = ctx.stats(dive.slice(20).map((s) => s.tail)).mean;
    ctx.check(tailClimb < tailDive - 0.05,
      `the tail tip drops on the climb and lifts on the dive (y ${tailClimb.toFixed(3)} vs ${tailDive.toFixed(3)}, want a gap over 0.05)`);
  }

  await page.evaluate((p) => window.__BIRB.restorePose(p), level);
}
