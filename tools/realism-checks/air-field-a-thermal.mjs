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
  // than failing the physics, so up to three are tried.
  const ranked = await page.evaluate(() => (window.__BIRB.air().thermals || [])
    .slice().sort((a, b) => b.core15 - a.core15).map((t) => t.index));
  const AGL = 18;
  const N = 40;
  let result = null;
  for (const index of ranked.slice(0, 3)) {
    const go = await page.evaluate(({ i, agl }) => window.__BIRB.goToThermal(i, agl), { i: index, agl: AGL });
    if (!go || !(go.core > 0.8)) continue;
    await ctx.frames(2);
    const pose = { position: go.position, quaternion: go.quaternion };
    const flyFrom = async () => {
      await page.evaluate((p) => { const B = window.__BIRB; B.restorePose(p); }, pose);
      return ctx.hold({ x: 0, y: 0 }, N, PROBE);
    };
    const on = await flyFrom();
    await page.evaluate(() => window.__BIRB.air(false));
    const off = await flyFrom();
    await page.evaluate(() => window.__BIRB.air(true));
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
