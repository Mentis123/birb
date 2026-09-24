/**
 * Air with structure, on the live page (src/flight/air-field.js).
 *
 * A bird put in a thermal's core, low over the ground, and flown HANDS OFF
 * and level must climb — and the SAME pose flown again with the field
 * detached from the flight (`__BIRB.air(false)`, same boot, same frames)
 * must hold its height. That pair is the control: it separates "the air
 * lifted it" from anything the stunt law or the terrain does on its own.
 * `air-field-b-still` then boots `?air=0` and flies the same pose again, to
 * prove the flag's off path is the still air of the base.
 *
 * Also here, because each is where this kind of feature quietly breaks:
 *   - the gust moves the foliage uniform while the decorative-density lever
 *     reads back unchanged (the frozen A10 oracle's contract);
 *   - above the layer the air is exactly still, which is what keeps
 *     tools/birb-stunt.mjs (flown at 220) untouched;
 *   - the mountain pines carry the wind patch and it compiles (the runner
 *     fails this boot on any console error).
 *
 * FRAMES, NEVER MILLISECONDS; the climb is measured on the sim clock.
 */
export const name = 'air-field-thermal';

const PROBE = `const p = B.flightProbe(); const a = B.air();
  return { r: p.radius, agl: p.aboveGround, air: p.air, rec: p.recovery, t: p.simTime,
    up: a.updraft, d: a.nearestThermal ? a.nearestThermal.distance : null };`;

export default async function run(ctx) {
  const { page } = ctx;
  const air0 = await page.evaluate(() => window.__BIRB.air());
  ctx.check(air0 && air0.enabled && air0.built && air0.attached,
    `the air is on by default, built and attached to the flight (${JSON.stringify({ enabled: air0?.enabled, built: air0?.built, attached: air0?.attached })})`);
  ctx.check((air0?.count ?? 0) >= 6, `the forest has its thermals (${air0?.count})`);

  // A fixed sun, so which thermals are lit does not depend on the clock.
  await page.evaluate(() => { const B = window.__BIRB; B.setSunTime(0); B.setSunEnabled(true); });
  await ctx.frames(3);
  await page.evaluate(() => window.__BIRB.setSunEnabled(false));
  await ctx.frames(2);

  // Strongest thermals first; a tree in the way invalidates a run rather
  // than failing the physics, so up to five are tried. 28 units up is inside
  // the core's strongest third and above most of a forest's canopy (trees
  // run 14-58 tall and the control pass holds its height), and every try and
  // every pass starts FLYING at cruise (`freeze(false)` is setSpeed(11)): a
  // knockdown on one try must not fail the next, and a bird left at the
  // falling speed would stall through the one after.
  const ranked = await page.evaluate(() => (window.__BIRB.air().thermals || [])
    .slice().sort((a, b) => b.core15 - a.core15).map((t) => t.index));
  const AGL = 28;
  const N = 40;
  let result = null;
  for (const index of ranked.slice(0, 5)) {
    await page.evaluate(() => { const B = window.__BIRB; B.setRecovery?.('flying'); B.freeze(false); });
    const go = await page.evaluate(({ i, agl }) => window.__BIRB.goToThermal(i, agl), { i: index, agl: AGL });
    if (!go) continue;
    await ctx.frames(2);
    // Read the core AFTER arriving: under the planet sun a jump this long
    // re-bases the sun frame (sun-frame.js), so the heat ranked from the
    // spawn is not the heat here.
    const here = await page.evaluate(() => window.__BIRB.air().nearestThermal);
    if (!here || here.index !== index || !(here.strength > 0.8)) {
      ctx.log(`thermal ${index}: core ${here ? here.strength : '?'} u/s on arrival (heat ${here ? here.heat : '?'}), trying the next`);
      continue;
    }
    go.core = here.strength; go.heat = here.heat;
    const pose = { position: go.position, quaternion: go.quaternion };
    const flyFrom = async () => {
      await page.evaluate((p) => { const B = window.__BIRB; B.setRecovery?.('flying'); B.freeze(false); B.restorePose(p); }, pose);
      return ctx.hold({ x: 0, y: 0 }, N, PROBE);
    };
    const on = await flyFrom();
    let off;
    await page.evaluate(() => window.__BIRB.air(false));
    try {
      off = await flyFrom();
    } finally {
      // Never leave the field detached for the checks after this one.
      await page.evaluate(() => window.__BIRB.air(true));
    }
    const flying = [...on, ...off].every((s) => s.rec === 'flying');
    if (!flying) { ctx.log(`thermal ${index}: the run met a tree, trying the next`); continue; }
    result = { index, go, on, off };
    break;
  }
  if (!ctx.check(!!result, 'a clean hands-off pass through a lit thermal core (no collision)')) return;

  const { index, go, on, off } = result;
  const gain = (s) => s[s.length - 1].r - s[0].r;
  const secs = (s) => s[s.length - 1].t - s[0].t;
  const gOn = gain(on); const gOff = gain(off);
  ctx.log(`thermal ${index}: core ${go.core} u/s, r2 ${go.radius}, heat ${go.heat}; ` +
    `${N} frames = ${secs(on).toFixed(2)} s sim; applied air ${on[0].air} -> ${on[on.length - 1].air}; ` +
    `climb ${gOn.toFixed(3)} with the air vs ${gOff.toFixed(3)} detached`);
  ctx.check(gOn > 1.0, `hands-off level flight through the core CLIMBS: +${gOn.toFixed(2)} units in ${secs(on).toFixed(2)} s`);
  ctx.check(Math.abs(gOff) < 0.25, `the same pose with the air detached holds its height (${gOff.toFixed(3)})`);
  ctx.check(gOn - gOff > 1.0, `the difference is the air: ${(gOn - gOff).toFixed(2)} units`);
  ctx.check(on.every((s) => s.air <= 2.5 + 1e-9 && s.air >= -1.5 - 1e-9), 'the applied air stays inside its bounds');
  globalThis.__airFieldThermalRun = { pose: { position: go.position, quaternion: go.quaternion }, gain: gOn, frames: N };

  // The pose reads the air (src/flight/aero-pose.js, wired in index.html).
  // Fly the core pose with the field detached until the wing settles, then
  // fly the SAME pose with it attached: the vertical air the wing meets
  // steps up by the core's updraft, which is what flying into a thermal is.
  // The wings must flick up, stay inside the flick's bound and settle back
  // (a high-pass, not a held flex), and the BEAT must not pay for a climb
  // the air supplied. 24 frames each keeps the bird inside ~0.4 r2 of the
  // axis, where the core is still well over 1 unit/s.
  const aero = await page.evaluate(() => window.__BIRB.aeroPose?.());
  if (aero && aero.enabled) {
    const POSE = `const a = B.aeroPose(); const p = B.flightProbe(); const f = B.air();
      return { flex: a.flex, demand: a.demand, gust: a.input.gust, lift: a.input.airLift, climb: a.input.climbRate,
        air: p.air, layer: f.layerGust, rec: p.recovery };`;
    const core = { position: go.position, quaternion: go.quaternion };
    let detached;
    await page.evaluate((p) => { const B = window.__BIRB; B.air(false); B.setRecovery?.('flying'); B.freeze(false); B.restorePose(p); }, core);
    try {
      detached = await ctx.hold({ x: 0, y: 0 }, 24, POSE);
    } finally {
      await page.evaluate((p) => { const B = window.__BIRB; B.air(true); B.setRecovery?.('flying'); B.freeze(false); B.restorePose(p); }, core);
    }
    const attached = await ctx.hold({ x: 0, y: 0 }, 24, POSE);
    const clean = [...detached, ...attached].every((s) => s.rec === 'flying');
    if (ctx.check(clean, 'the pose pass stayed in the air (no collision)')) {
      const avg = (a, k) => a.reduce((t, s) => t + s[k], 0) / a.length;
      const base = avg(detached.slice(-6), 'flex');
      const peak = Math.max(...attached.map((s) => s.flex));
      const tail = avg(attached.slice(-6), 'flex');
      const dOff = avg(detached.slice(-12), 'demand');
      const dOn = avg(attached.slice(8), 'demand');
      const liftSeen = Math.max(...attached.map((s) => s.lift));
      ctx.log(`pose: flex ${base.toFixed(3)} -> peak ${peak.toFixed(3)} -> ${tail.toFixed(3)}; gust input ${attached[0].gust} -> ${attached[attached.length - 1].gust} u/s;`
        + ` demand ${dOff.toFixed(3)} detached vs ${dOn.toFixed(3)} carried (climb ${attached[attached.length - 1].climb}, airLift ${attached[attached.length - 1].lift})`);
      // The wiring as an identity, every frame: the gust the pose is handed
      // IS the air the flight applied plus the layer's vertical turbulence.
      const worst = Math.max(...[...detached, ...attached].map((s) => Math.abs(s.gust - (s.air + s.layer))));
      ctx.check(worst < 0.003, `the pose's gust is the air that carried the bird plus the layer's turbulence, every frame (worst ${worst.toFixed(4)})`);
      const carried = avg(attached, 'air');
      ctx.check(carried > 0.5 && detached.every((s) => s.air === 0),
        `the attached pass is carried and the detached one is not (mean applied ${carried.toFixed(2)} u/s vs 0)`);
      ctx.check(peak - base > 0.05, `entering the core flicks the wings up (+${(peak - base).toFixed(3)} rad)`);
      ctx.check(peak - base <= 0.22 + 0.03, `and no further than the flick's bound (+${(peak - base).toFixed(3)} against gustMax 0.22)`);
      ctx.check(Math.abs(tail - base) < 0.06, `a steady thermal holds no flex: it settles back (${base.toFixed(3)} -> ${tail.toFixed(3)})`);
      ctx.check(liftSeen > 0.3 && Math.abs(dOn - dOff) < 0.06,
        `the beat does not pay for a climb the air supplied (demand ${dOff.toFixed(3)} -> ${dOn.toFixed(3)}, airLift up to ${liftSeen.toFixed(2)})`);
    }
  }

  // Gusts: the foliage uniform breathes, the density lever does not.
  const gusts = await ctx.hold({ x: 0, y: 0 }, 40, 'const a = B.air(); return { w: a.windUniform, d: a.density, g: a.gust, gs: a.gustSide };');
  const ws = gusts.map((s) => s.w);
  const ds = new Set(gusts.map((s) => s.d));
  const spread = Math.max(...ws) - Math.min(...ws);
  ctx.log(`wind uniform ${Math.min(...ws).toFixed(3)}..${Math.max(...ws).toFixed(3)} at density ${[...ds].join(',')}`);
  ctx.check(ds.size === 1, `the decorative-density lever reads back the same every frame (${[...ds].join(', ')})`);
  ctx.check(spread > 0.02 * Math.max(0.35, gusts[0].d) && ws.some((w, i) => w !== gusts[i].d),
    `the gust moves the foliage wind uniform (spread ${spread.toFixed(3)})`);
  ctx.check(gusts.every((s) => Math.abs(s.g) <= 1 && Math.abs(s.gs) <= 1), 'the published gust stays in -1..1');

  // Above the layer: exactly still air, which is what the stunt harness flies in.
  await page.evaluate(() => window.__BIRB.setAltitude(220));
  const high = await ctx.hold({ x: 0, y: 0 }, 6, 'const p = B.flightProbe(); const a = B.air(); return { air: p.air, up: a.updraft, agl: p.aboveGround };');
  ctx.check(high.every((s) => s.air === 0 && s.up === 0), `still air at ${high[high.length - 1].agl.toFixed(0)} above ground`);

  // The mountain pines sway in the same wind, and their shader compiles.
  const env = await page.evaluate(() => window.__BIRB.setEnvironment('mountain'));
  if (env) {
    await ctx.frames(6);
    const m = await page.evaluate(() => window.__BIRB.air());
    ctx.check(m.pineWind === true, `the mountain pines carry the wind patch (${m.pineWind})`);
    ctx.check(m.built && m.count >= 6, `the mountain has its own thermals (${m.count})`);
    await page.evaluate(() => window.__BIRB.setEnvironment('forest'));
    await ctx.frames(4);
  }

  await page.evaluate(() => window.__BIRB.setSunEnabled(true));
}
