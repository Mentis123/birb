/**
 * The beat is a power output: shallow bursts at cruise, a deep continuous
 * stroke on a climb, a glide in a dive and at idle throttle — at a near
 * constant frequency, with a Bronze-winged Pionus's shape (deep downstroke,
 * upstroke barely above the glide line), and mirror-symmetric.
 *
 * realism/aero-pose. Read off the LIVE model with `__BIRB.aeroPose()` and the
 * live wingtips with `birdPose()`, on the production default (stunt, pull
 * back to climb — the sign is read from the probe, never assumed).
 *
 * Symmetry is measured at the TIPS because the old rig's hands were not: it
 * negated the right hand's rotation, but the hand is a child INSIDE the arm's
 * scale.z = -1, so that bent the two wrists opposite ways (left 1.249 vs
 * right 0.896 at mid-downstroke under the forced stroke).
 */
export const name = 'aero-pose-beat';

const SAMPLE = `const p = B.birdPose(); const a = B.aeroPose(); const f = B.flightProbe();
  return { l: p.leftTip[1], r: p.rightTip[1], depth: a.depth, env: a.envelope, demand: a.demand,
    duty: a.duty, beats: a.beats, t: f.simTime, rec: f.recovery, speed: f.speed };`;

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
    await ctx.frames(30);
  };

  // ---- the hook ----
  const snap = await page.evaluate(() => window.__BIRB.aeroPose());
  ctx.check(snap && snap.enabled === true && snap.live === true, `the aero pose is live on the default boot (${JSON.stringify({ enabled: snap?.enabled, live: snap?.live })})`);
  const numbers = Object.entries(snap || {}).filter(([, v]) => typeof v === 'number');
  ctx.check(numbers.length > 10 && numbers.every(([, v]) => Number.isFinite(v)),
    `every number it reports is finite (${numbers.length} fields)`);

  // ---- cruise: shallow bursts ----
  await reset();
  const cruise = await ctx.hold({}, 90, SAMPLE);
  const cruiseDemand = mean(cruise.map((s) => s.demand));
  const cruiseDepth = mean(cruise.map((s) => s.depth));
  const cruiseEnv = mean(cruise.map((s) => s.env));
  ctx.check(cruiseDemand > 0.7 && cruiseDemand < 1.3, `level cruise asks for about cruise power (demand ${cruiseDemand.toFixed(2)})`);
  ctx.check(cruiseDepth > 0.1 && cruiseDepth < 0.35, `and beats shallow (depth ${cruiseDepth.toFixed(2)})`);
  ctx.check(cruiseEnv > 0.2 && cruiseEnv < 0.9, `in bursts, not continuously (envelope mean ${cruiseEnv.toFixed(2)})`);

  // ---- idle throttle: a glide ----
  await reset();
  const idle = await ctx.hold({ throttle: 0.55 }, 90, SAMPLE);
  const idleTail = idle.slice(45);
  const glideTip = mean(idleTail.map((s) => s.l));
  ctx.check(Math.max(...idleTail.map((s) => s.depth * s.env)) < 0.05,
    `idle throttle glides (peak beat ${Math.max(...idleTail.map((s) => s.depth * s.env)).toFixed(3)})`);

  // ---- climb: deep, continuous, Pionus-shaped, symmetric ----
  await reset();
  const climb = await ctx.hold({ y: climbSign * 0.6 }, 90, SAMPLE);
  await ctx.shot('climb');
  const climbTail = climb.slice(30);
  const climbDepth = mean(climbTail.map((s) => s.depth));
  const climbEnv = mean(climbTail.map((s) => s.env));
  ctx.check(climbDepth > 0.8, `a climb beats full depth (depth ${climbDepth.toFixed(2)})`);
  ctx.check(climbEnv > 0.9, `and continuously (envelope mean ${climbEnv.toFixed(2)})`);
  const up = Math.max(...climb.map((s) => s.l)) - glideTip;
  const down = glideTip - Math.min(...climb.map((s) => s.l));
  ctx.check(down > 0.6 && down > 1.8 * up,
    `the stroke is deep below the glide line and shallow above it (down ${down.toFixed(3)}, up ${up.toFixed(3)})`);
  const asym = Math.max(...climb.map((s) => Math.abs(s.l - s.r)));
  ctx.check(asym < 2e-3, `the two wingtips mirror each other through the stroke (max |dy| ${asym.toFixed(5)})`);

  // Near-constant frequency: beats per SIM second, cruise vs climb.
  const rate = (s) => (s[s.length - 1].beats - s[0].beats) / Math.max(1e-6, s[s.length - 1].t - s[0].t);
  const cruiseHz = rate(cruise);
  const climbHz = rate(climb);
  ctx.check(climbHz >= cruiseHz * 0.98 && climbHz <= cruiseHz * 1.25,
    `the beat frequency barely moves with effort (${cruiseHz.toFixed(2)} -> ${climbHz.toFixed(2)} Hz)`);

  // ---- dive: a glide ----
  await reset();
  const dive = await ctx.hold({ y: -climbSign * 0.6 }, 90, SAMPLE);
  const diveTail = dive.slice(30);
  ctx.check(Math.max(...diveTail.map((s) => s.depth * s.env)) < 0.08,
    `a dive glides (peak beat ${Math.max(...diveTail.map((s) => s.depth * s.env)).toFixed(3)})`);

  const flew = [...cruise, ...idle, ...climb, ...dive].every((s) => s.rec === 'flying');
  ctx.check(flew, 'the bird was flying through every hold');
  ctx.log(`cruise demand ${cruiseDemand.toFixed(2)} depth ${cruiseDepth.toFixed(2)} env ${cruiseEnv.toFixed(2)}; `
    + `climb depth ${climbDepth.toFixed(2)} env ${climbEnv.toFixed(2)}; glide tip ${glideTip.toFixed(3)}`);

  await page.evaluate((p) => window.__BIRB.restorePose(p), level);
}
