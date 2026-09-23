/**
 * The tail twists INTO a roll, and a hard pull flexes the wings up.
 *
 * realism/aero-pose. The twist is read off the live rig: the tail's
 * rotation.x, which for a tail built along -X is a roll about its own long
 * axis — exactly why the old rig's elevator, written there, never moved the
 * tip. The roll rate is the one the page MEASURED off the flight frame, so
 * this also proves that measurement has the right sign. The flex is the
 * model's dihedral under load (pitch rate x airspeed).
 */
export const name = 'aero-pose-tail';

const SAMPLE = `const a = B.aeroPose(); const p = B.birdPose(); const f = B.flightProbe();
  return { twist: a.tailTwist, x: p.tail.x, roll: a.input.rollRate, flex: a.flex, load: a.load,
    rec: f.recovery };`;

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
      B.setRecovery?.('flying');
      B.restorePose(p);
      B.setAltitude(220);
    }, level);
    await ctx.frames(24);
  };

  // A firm 0.9: past the dihedral band the stunt law rolls straight through
  // (G-STUNT-4), so the rate holds for the whole window instead of settling
  // at a bank the way a lazy stick does.
  await reset();
  const right = await ctx.hold({ x: 0.9 }, 14, SAMPLE);
  await reset();
  const left = await ctx.hold({ x: -0.9 }, 14, SAMPLE);
  const rRight = mean(right.slice(4).map((s) => s.roll));
  const rLeft = mean(left.slice(4).map((s) => s.roll));
  ctx.check(rRight > 1 && rLeft < -1, `the measured roll rate follows the stick (${rRight.toFixed(2)} / ${rLeft.toFixed(2)} rad/s)`);
  const tRight = mean(right.slice(4).map((s) => s.x));
  const tLeft = mean(left.slice(4).map((s) => s.x));
  ctx.check(tRight > 0.08 && tLeft < -0.08,
    `the tail twists into the roll: right edge down rolling right (${tRight.toFixed(3)}), left rolling left (${tLeft.toFixed(3)})`);

  // Load: the opening of a hard pull at cruise, before the speed bleeds.
  await reset();
  const cruise = await ctx.hold({}, 30, SAMPLE);
  await reset();
  const pull = await ctx.hold({ y: climbSign * 0.9 }, 14, SAMPLE);
  const peakLoad = Math.max(...pull.map((s) => s.load));
  const peakFlex = Math.max(...pull.map((s) => s.flex));
  ctx.check(peakLoad > 2, `a hard pull loads the wing (peak n ${peakLoad.toFixed(2)})`);
  ctx.check(peakFlex > 0.08, `and flexes it up (peak flex ${peakFlex.toFixed(3)} rad)`);
  ctx.check(Math.abs(mean(cruise.map((s) => s.flex))) < 0.02, `level flight carries no flex (${mean(cruise.map((s) => s.flex)).toFixed(4)})`);

  const flew = [...right, ...left, ...cruise, ...pull].every((s) => s.rec === 'flying');
  ctx.check(flew, 'the bird was flying through every hold');
  await page.evaluate((p) => window.__BIRB.restorePose(p), level);
}
