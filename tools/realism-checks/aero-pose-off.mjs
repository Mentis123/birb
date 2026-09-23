/**
 * `?aeropose=0` is the TRUE before: the old rig, raw stick and all.
 *
 * realism/aero-pose. An escape hatch that is not the old code path is not a
 * before, it is a third variant. This boots with the flag and proves the old
 * rig is what runs: the aero model reports itself off, and the tail's
 * rotation.x equals the old `tailPitchOffset(raw stick y)` to the digit on
 * every frame of a climb — the backwards elevator, reproduced exactly.
 *
 * It asserts nothing about the defect itself (a check that turned green on a
 * regression would be worse than none); it LOGS the before under the same
 * method flap-follows-climb uses, so the gate record's numbers have a
 * reproducible source: `node tools/birb-realism.mjs --only aero-pose-off`.
 */
import { tailPitchOffset } from '../../src/flight/bird-pose.js';

export const name = 'aero-pose-off';
export const query = 'aeropose=0';

const SAMPLE = `const p = B.birdPose(); const f = B.flightProbe();
  return { tip: p.leftTip[1], rtip: p.rightTip[1], tailX: p.tail.x, tailTip: p.tailTip ? p.tailTip[1] : null,
    stickY: f.stick.y, pitch: f.pitchDeg, rec: f.recovery };`;

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

export default async function run(ctx) {
  const { page } = ctx;
  const hook = await page.evaluate(() => window.__BIRB.aeroPose?.());
  ctx.check(hook && hook.enabled === false, `the aero pose reports itself off (${JSON.stringify(hook)})`);

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

  // The old elevator, exactly: tail.x = base (0) + tailPitchOffset(RAW y)
  // + perch (0 in the air). The raw stick on a pull-back climb is NEGATIVE.
  const worst = Math.max(...climb.map((s) => Math.abs(s.tailX - tailPitchOffset(s.stickY))));
  ctx.check(worst < 2e-3, `the old rig's elevator runs on the raw stick (max |tail.x - tailPitchOffset(y)| ${worst.toFixed(5)})`);

  const sd = (a) => ctx.stats(a).sd;
  ctx.log(`BEFORE (aeropose=0): tip travel sd climb ${sd(climb.map((s) => s.tip)).toFixed(3)} vs dive ${sd(dive.map((s) => s.tip)).toFixed(3)}; `
    + `tail tip y climb ${mean(climb.slice(20).map((s) => s.tailTip)).toFixed(3)} vs dive ${mean(dive.slice(20).map((s) => s.tailTip)).toFixed(3)}; `
    + `tail.x climb ${mean(climb.slice(20).map((s) => s.tailX)).toFixed(3)} vs dive ${mean(dive.slice(20).map((s) => s.tailX)).toFixed(3)}; `
    + `max |leftTip.y - rightTip.y| ${Math.max(...[...climb, ...dive].map((s) => Math.abs(s.tip - s.rtip))).toFixed(4)}; `
    + `pitch ${climb[climb.length - 1].pitch.toFixed(1)} / ${dive[dive.length - 1].pitch.toFixed(1)}`);
  const flew = [...climb, ...dive].every((s) => s.rec === 'flying');
  ctx.check(flew, 'the bird was flying through both holds');

  await page.evaluate((p) => window.__BIRB.restorePose(p), level);
}
