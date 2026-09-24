/**
 * The air and the floor, on the live page (review of src/flight/air-field.js).
 *
 * The frozen harnesses that prove landing, walking and nesting
 * (tools/birb-walk.mjs, tools/birb-modes.mjs) boot `&flight=classic`, and the
 * classic law never reads the air sampler — so on their own they say nothing
 * about the air. This check flies the SHIPPING stunt model with the field
 * attached and asks the questions they cannot:
 *
 *   - the floor: flown hands-off and nose-down through the strongest SINKING
 *     air near the ground the field has, the bird never sits below the
 *     floor's own clearance (0.6) while it is flying — the air moves
 *     position before the floor clamp, and the clamp keeps the last word;
 *   - landing still works where the air pushes UP hardest: a gentle push
 *     down through the strongest thermal cores reaches the ground wherever
 *     the same descent with the air detached does; an upright bird given one real ground contact (`probeGround`)
 *     in a core goes GROUNDED — and walks, with the air applying exactly
 *     nothing while the speed is commanded;
 *   - the nest still takes the bird: nested, the air applies nothing and the
 *     bird does not drift up out of it;
 *   - state: a knockdown (FALLING) applies no air; an environment switch
 *     rebuilds the field for the new biome and the SAME sampler stays
 *     attached; a teleport applies the air of the place it lands on the very
 *     next frame, never the old one.
 *
 * FRAMES, NEVER MILLISECONDS.
 */
export const name = 'air-field-floor';

const PROBE = `const p = B.flightProbe();
  return { agl: p.aboveGround, air: p.air, rec: p.recovery, r: p.radius, pitch: p.pitchDeg };`;

export default async function run(ctx) {
  const { page } = ctx;
  const a0 = await page.evaluate(() => window.__BIRB.air());
  if (!ctx.check(a0 && a0.built && a0.attached, 'the air is built and attached to the stunt flight')) return;
  const model = await page.evaluate(() => window.__BIRB.flightProbe().controller);
  ctx.check(model === 'stunt', `the shipping stunt model is flying (${model})`);
  await page.evaluate(() => { const B = window.__BIRB; B.setSunTime(0); B.setSunEnabled(false); B.stillAir(true); });
  await ctx.frames(2);

  try {
    // ---- 1. The floor under the strongest sinking air near the ground ----
    // A deterministic scan (Fibonacci sphere) of the air 4 units up, where
    // the taper still lets a lee sink most of its strength through.
    const spots = await page.evaluate(() => {
      const B = window.__BIRB;
      const out = [];
      const N = 900;
      for (let i = 0; i < N; i += 1) {
        const y = 1 - (2 * (i + 0.5)) / N;
        const s = Math.sqrt(1 - y * y);
        const phi = i * Math.PI * (3 - Math.sqrt(5));
        const a = B.airAt(s * Math.cos(phi), y, s * Math.sin(phi), 4);
        if (a) out.push({ d: [s * Math.cos(phi), y, s * Math.sin(phi)], w: a.updraft, ridge: a.ridge });
      }
      out.sort((p, q) => p.w - q.w);
      return { worst: out.slice(0, 6), min: out[0] ? out[0].w : null, sampled: out.length };
    });
    ctx.log(`sinkiest air 4 units up, of ${spots.sampled} spots: ${spots.worst.map((s) => s.w.toFixed(3)).join(', ')}`);
    ctx.check(spots.min !== null && spots.min < -0.2, `the scan found real sinking air near the ground (${spots.min?.toFixed(3)} u/s)`);

    let flown = 0;
    let lowest = Infinity;
    let belowWhileFlying = 0;
    let sinkSeen = 0;
    for (const spot of spots.worst.slice(0, 4)) {
      for (const [above, pitch, stickY] of [[4, 0, 0], [3, 0.25, 0]]) {
        const q = ctx.levelQuat(spot.d, pitch);   // pitched nose-DOWN by `pitch` rad
        await page.evaluate(({ U, above, q }) => {
          const B = window.__BIRB;
          B.setRecovery('flying'); B.freeze(false);
          const pos = B.teleport(U[0], U[1], U[2], above);
          B.restorePose({ position: pos, quaternion: q });
        }, { U: spot.d, above, q });
        const samples = await ctx.hold({ x: 0, y: stickY }, 24, PROBE);
        flown += 1;
        for (const s of samples) {
          if (s.rec !== 'flying') break;       // a tree or a contact ends the pass
          if (s.agl < lowest) lowest = s.agl;
          if (s.agl < 0.6 - 2e-3) belowWhileFlying += 1;
          if (s.air < -0.05) sinkSeen += 1;
        }
      }
    }
    ctx.log(`${flown} low passes through sinking air: lowest clearance while flying ${lowest.toFixed(3)}; ` +
      `${sinkSeen} frames with the air pushing down; ${belowWhileFlying} frames below the floor`);
    ctx.check(sinkSeen > 0, `the passes met sinking air that the flight applied (${sinkSeen} frames)`);
    ctx.check(belowWhileFlying === 0 && lowest >= 0.6 - 2e-3,
      `the air never takes a flying bird below the floor's clearance (lowest ${lowest.toFixed(3)} >= 0.6)`);

    // ---- 2. Contact still lands, in the strongest updraft there is -------
    const ranked = await page.evaluate(() => (window.__BIRB.air().thermals || [])
      .slice().sort((a, b) => b.core15 - a.core15).map((t) => t.index));
    // (a) A gentle push down over the strongest cores, 4 units up, flown
    // twice — with the air, and with it detached (the control): the air must
    // not hold a descending bird off the ground where the still-air control
    // reaches it. What contact then READS (grounded, a crash, or the floor's
    // coin toss — CLAUDE.md "A level bird cannot land") is the stunt law's
    // business and is logged, not judged: the control says what it is.
    const descend = async (index, attached) => {
      await page.evaluate((on) => { const B = window.__BIRB; B.air(on); B.setRecovery('flying'); B.freeze(false); }, attached);
      const go = await page.evaluate((i) => window.__BIRB.goToThermal(i, 4), index);
      if (!go) return null;
      await ctx.frames(1);
      const s = await ctx.hold({ x: 0, y: 0.35 }, 40, PROBE);
      const hit = s.findIndex((q) => q.rec !== 'flying');
      const flying = hit < 0 ? s : s.slice(0, hit);
      return {
        reached: hit >= 0 || flying.some((q) => q.agl <= 0.6 + 0.02),
        contact: hit >= 0 ? `${s[hit].rec}@${hit + 1}` : 'none',
        minAgl: Math.min(...flying.map((q) => q.agl)),
        maxAir: Math.max(...s.map((q) => q.air)),
      };
    };
    const descents = [];
    try {
      for (const index of ranked.slice(0, 3)) {
        const on = await descend(index, true);
        const off = await descend(index, false);
        if (on && off) descents.push({ index, on, off });
      }
    } finally {
      await page.evaluate(() => window.__BIRB.air(true));
    }
    for (const d of descents) {
      ctx.log(`thermal ${d.index}: with the air reached ${d.on.reached} (contact ${d.on.contact}, lowest flying clearance ${d.on.minAgl.toFixed(3)}, air up to ${d.on.maxAir}); `
        + `detached reached ${d.off.reached} (contact ${d.off.contact}, lowest ${d.off.minAgl.toFixed(3)})`);
    }
    ctx.check(descents.length > 0 && descents.every((d) => d.on.reached || !d.off.reached) && descents.some((d) => d.on.reached),
      `a gentle push down through the strongest thermal cores reaches the ground wherever the still-air control does (${descents.map((d) => `${d.on.reached}/${d.off.reached}`).join(', ')})`);

    // (b) An upright bird given one real ground contact in a core: the
    // contact is delivered to whatever clearance the air left it at.
    let landed = null;
    for (const index of ranked.slice(0, 4)) {
      await page.evaluate(() => { const B = window.__BIRB; B.setRecovery('flying'); B.freeze(false); });
      const go = await page.evaluate((i) => window.__BIRB.goToThermal(i, 1.2), index);
      if (!go) continue;
      await ctx.frames(1);
      const before = await page.evaluate(() => { const B = window.__BIRB; const p = B.flightProbe(); return { air: p.air, rec: p.recovery, up: B.air().updraft, agl: p.aboveGround }; });
      await page.evaluate((d) => window.__BIRB.probeGround(d), Math.max(0.05, before.agl - 0.6 + 0.3));
      let rec = null;
      for (let k = 0; k < 6 && rec !== 'grounded'; k += 1) {
        await ctx.frames(1);
        rec = await page.evaluate(() => window.__BIRB.flightProbe().recovery);
      }
      if (rec === 'grounded') { landed = { index, before }; break; }
      ctx.log(`thermal ${index}: contact read ${rec} (air ${before.air}), trying the next`);
    }
    if (ctx.check(!!landed, 'an upright bird given a ground contact in a thermal core goes GROUNDED')) {
      ctx.log(`landed in thermal ${landed.index}'s core on the first contact, where the air read ${landed.before.up} u/s`);
      // Walk: the speed is commanded, so the air must apply exactly nothing
      // and the bird must stay on the surface.
      const walk = await ctx.hold({ x: 0, y: 1 }, 18, PROBE);
      const w0 = walk[0]; const w1 = walk[walk.length - 1];
      ctx.check(walk.every((s) => s.rec === 'grounded'), 'walking in the core it stays GROUNDED (the air cannot lift it off)');
      ctx.check(walk.every((s) => s.air === 0), `and the air applies exactly nothing while walking (max |air| ${Math.max(...walk.map((s) => Math.abs(s.air)))})`);
      ctx.check(Math.abs(w1.agl - w0.agl) < 1.0, `clearance while walking ${w0.agl} -> ${w1.agl}`);
    }

    // ---- 3. The nest ----------------------------------------------------
    await page.evaluate(() => { const B = window.__BIRB; B.setRecovery('flying'); B.freeze(false); B.setAltitude(30); });
    await ctx.frames(2);
    const forced = await page.evaluate(() => window.__BIRB.forceNest(null));
    let nested = false;
    for (let k = 0; k < 90 && forced && !nested; k += 1) {
      await ctx.frames(2);
      nested = await page.evaluate(() => !!window.__BIRB.birdPose().nested);
    }
    if (ctx.check(nested, 'the stunt bird with the air attached still lands in a nest')) {
      const n0 = await page.evaluate(() => { const p = window.__BIRB.flightProbe(); return { r: p.radius, air: p.air }; });
      await ctx.frames(12);
      const n1 = await page.evaluate(() => { const p = window.__BIRB.flightProbe(); return { r: p.radius, air: p.air }; });
      ctx.check(n0.air === 0 && n1.air === 0, `nested, the air applies nothing (${n0.air}, ${n1.air})`);
      ctx.check(Math.abs(n1.r - n0.r) < 1e-3, `and the bird does not drift out of the nest (radius ${n0.r} -> ${n1.r})`);
      await page.evaluate(() => window.__BIRB.takeOff());
      await ctx.frames(20);
    }

    // ---- 4. State: knockdown, environment switch, teleport ---------------
    await page.evaluate(() => { const B = window.__BIRB; B.setRecovery('flying'); B.freeze(false); });
    const hot = ranked[0];
    await page.evaluate((i) => window.__BIRB.goToThermal(i, 20), hot);
    await ctx.frames(2);
    const inCore = await page.evaluate(() => window.__BIRB.flightProbe().air);
    await page.evaluate(() => window.__BIRB.setRecovery('falling'));
    const falling = [];
    for (let k = 0; k < 4; k += 1) {
      await ctx.frames(1);
      falling.push(await page.evaluate(() => { const p = window.__BIRB.flightProbe(); return { rec: p.recovery, air: p.air }; }));
    }
    ctx.check(inCore > 0.3, `flying in the core the air carries the bird (${inCore} u/s)`);
    ctx.check(falling.filter((s) => s.rec === 'falling').every((s) => s.air === 0),
      `knocked down (FALLING) in the same core, the air applies nothing (${falling.map((s) => `${s.rec}:${s.air}`).join(' ')})`);
    await page.evaluate(() => { const B = window.__BIRB; B.setRecovery('flying'); B.freeze(false); });

    const before = await page.evaluate(() => window.__BIRB.air());
    await page.evaluate(() => window.__BIRB.setEnvironment('mountain'));
    await ctx.frames(4);
    const mtn = await page.evaluate(() => window.__BIRB.air());
    await page.evaluate(() => window.__BIRB.setEnvironment('forest'));
    await ctx.frames(4);
    const back = await page.evaluate(() => window.__BIRB.air());
    ctx.check(mtn.built && mtn.attached && back.built && back.attached,
      'an environment switch rebuilds the field and the same sampler stays attached');
    ctx.check(JSON.stringify(mtn.thermals.map((t) => t.dir)) !== JSON.stringify(before.thermals.map((t) => t.dir)),
      'the mountain gets its own thermals, not the forest\'s');
    ctx.check(JSON.stringify(back.thermals.map((t) => t.dir)) === JSON.stringify(before.thermals.map((t) => t.dir)),
      'and the forest gets the same ones back (seeded by biome)');
    ctx.check(back.time < before.time, `the rebuilt field starts its own clock (${before.time} -> ${back.time})`);

    // Teleport from a core to still air far above the layer: the very next
    // frame applies the new place's air (zero), not the core's.
    await page.evaluate((i) => { const B = window.__BIRB; B.setRecovery('flying'); B.freeze(false); B.goToThermal(i, 20); }, hot);
    await ctx.frames(2);
    const a1 = await page.evaluate(() => window.__BIRB.flightProbe().air);
    await page.evaluate(() => window.__BIRB.setAltitude(120));
    await ctx.frames(1);
    const a2 = await page.evaluate(() => window.__BIRB.flightProbe().air);
    ctx.check(a1 > 0.3 && a2 === 0, `a teleport out of the core applies the new place's air on the next frame (${a1} -> ${a2})`);
  } finally {
    await page.evaluate(() => {
      const B = window.__BIRB;
      B.stillAir(false); B.setStick(0, 0); B.setRecovery('flying'); B.freeze(false); B.air(true);
      B.setSunEnabled(true);
    });
  }
}
