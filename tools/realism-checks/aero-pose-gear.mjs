/**
 * The feet are landing gear: tucked at altitude, down a beat or three before
 * contact on a slow descending approach, and tucked again climbing away.
 *
 * realism/aero-pose. The approach is flown, not posed: from 10 units over
 * the ground at idle throttle, a gentle push takes the nose down and the bird
 * descends at well under cruise. The gear is read while the bird is still
 * FLYING — a landed bird has its feet down for a different reason, and a
 * check that could pass on that would pass on a bird with no gear at all.
 */
export const name = 'aero-pose-gear';

export default async function run(ctx) {
  // The approach is flown from 10 units up, inside the air field's layer
  // (src/flight/air-field.js): a thermal or a windward slope under the spawn
  // can hold a slow idle-throttle descent level, and whether it does depends
  // on where the wind has veered to by the time this check runs. That is the
  // AIR's business (air-field-thermal), not the gear's, so the field is
  // detached from the flight for this check and put back after it. Optional
  // chaining: a build without the air runs this unchanged.
  await ctx.page.evaluate(() => window.__BIRB.air?.(false));
  try {
    await runGear(ctx);
  } finally {
    await ctx.page.evaluate(() => window.__BIRB.air?.(true));
  }
}

async function runGear(ctx) {
  const { page } = ctx;
  const climbSign = await page.evaluate(() => {
    const t = window.__BIRB.flightProbe()?.tuning;
    return t && t.invertPitch === false ? 1 : -1;
  });
  const level = await page.evaluate(() => window.__BIRB.capturePose());

  // ---- at altitude: tucked ----
  await page.evaluate((p) => {
    const B = window.__BIRB;
    B.setRecovery?.('flying');
    B.restorePose(p);
    B.setAltitude(220);
  }, level);
  await ctx.frames(30);
  const high = await page.evaluate(() => ({ a: window.__BIRB.aeroPose(), p: window.__BIRB.birdPose() }));
  ctx.check(high.a.gear < 0.05 && high.a.feet < 0.05, `at altitude the gear is up (gear ${high.a.gear}, feet ${high.a.feet})`);
  ctx.check(high.p.leftFoot.z < -1.5, `and the legs are tucked (foot rotation.z ${high.p.leftFoot.z})`);

  // ---- the approach, then the go-around ----
  const approach = await page.evaluate(async ({ p, climbSign }) => {
    const B = window.__BIRB;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    B.setRecovery?.('flying');
    B.restorePose(p);
    B.setAltitude(10);
    for (let i = 0; i < 6; i += 1) await raf();
    const trace = [];
    let deployedAt = null;
    // Descend: idle throttle, a gentle push. The stick and pad stay held
    // across the shot below; the go-around replaces them.
    B.setPad(0, 0.55);
    B.setStick(0, -climbSign * 0.3);
    for (let i = 0; i < 160; i += 1) {
      await raf();
      const a = B.aeroPose(); const f = B.flightProbe(); const q = B.birdPose();
      trace.push({ gear: a.gear, feet: a.feet, ag: f.aboveGround, climb: a.input.climbRate, speed: f.speed, rec: f.recovery, foot: q.leftFoot.z });
      if (f.recovery !== 'flying') break;
      if (a.gear > 0.7) { deployedAt = trace.length - 1; break; }
    }
    return { trace, deployedAt };
  }, { p: level, climbSign });
  // Saved only under --out: the gear down, from the chase camera.
  await ctx.shot('gear-down');
  const away = approach.deployedAt === null ? [] : await page.evaluate(async ({ climbSign }) => {
    const B = window.__BIRB;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const out = [];
    // Go around: full power, pull.
    B.setPad(0, 1.35);
    B.setStick(0, climbSign * 0.8);
    for (let i = 0; i < 40; i += 1) {
      await raf();
      const a = B.aeroPose(); const f = B.flightProbe();
      out.push({ gear: a.gear, climb: a.input.climbRate, ag: f.aboveGround, rec: f.recovery });
    }
    return out;
  }, { climbSign });
  await page.evaluate(() => { window.__BIRB.setStick(0, 0); window.__BIRB.setPad(null); });
  const run1 = { ...approach, away };

  const deployed = run1.deployedAt !== null ? run1.trace[run1.deployedAt] : null;
  ctx.check(!!deployed, `the gear came down on the approach (${deployed ? `gear ${deployed.gear.toFixed(2)} at ${deployed.ag.toFixed(2)} above ground, sinking ${(-deployed.climb).toFixed(2)} u/s at ${deployed.speed.toFixed(1)} u/s` : `never: last ${JSON.stringify(run1.trace[run1.trace.length - 1])}`})`);
  if (deployed) {
    ctx.check(deployed.rec === 'flying', 'while the bird was still flying');
    ctx.check(deployed.ag < 6, `close to the ground, not at altitude (${deployed.ag.toFixed(2)} units)`);
    ctx.check(deployed.foot > -1.2, `the legs actually swung down (foot rotation.z ${deployed.foot.toFixed(3)})`);
    const firstOut = run1.trace.find((s) => s.gear > 0.1);
    ctx.log(`gear started at ${firstOut?.ag.toFixed(2)} above ground; full at ${deployed.ag.toFixed(2)}`);
  }
  if (run1.away.length) {
    const end = run1.away[run1.away.length - 1];
    const climbed = run1.away.some((s) => s.climb > 0.6);
    ctx.check(climbed, `the go-around climbs (${Math.max(...run1.away.map((s) => s.climb)).toFixed(2)} u/s)`);
    ctx.check(end.gear < 0.2, `and the gear tucks again climbing away (gear ${end.gear.toFixed(3)} at ${end.ag.toFixed(2)} above ground)`);
  }

  await page.evaluate((p) => {
    const B = window.__BIRB;
    B.setRecovery?.('flying');
    B.restorePose(p);
    B.setAltitude(40);
  }, level);
}
