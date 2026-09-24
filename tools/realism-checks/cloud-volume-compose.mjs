/**
 * The real clouds, composed with the rest of the realism wave.
 *
 * Built on e252ca1 before wave 1 landed, the cloud shadow multiplied
 * reflectedLight.directDiffuse — the SUM of every direct light — so under a
 * cloud the rim and fill lights (other parts of the sky) went dark with the
 * sun, and after the merge it would have stacked on horizon-shadow.js's own
 * sun visibility as a second, differently-shaped term. It now scales the
 * sun's own light inside three's light loop and, where the horizon patch is
 * on the material, multiplies into THAT patch's visibility (one wrapper, one
 * sky multiply). Measured here, on the GPU:
 *
 *  - the horizon bake splats no cloud (they are not terrain);
 *  - the sun is ONE light, matched by direction, at the Amazing boot and with
 *    shadow maps on (planet-light hides the key; the shadow light is the sun);
 *  - at a cloud-shadowed patch, with tone mapping off so the frame is linear
 *    and the sky share off so only the sun term moves, the light the cloud
 *    removes is the SUN's light times the analytic occlusion — never more
 *    than the sun's own contribution — at Amazing AND with shadows on;
 *  - the in-cloud fog colour moves with the sun by exactly the ratio the
 *    atmosphere moves the fog and the mist by;
 *  - a cloud's own colour warms and dims at a low sun with everything else.
 *
 * cloud-volume-atmos-off is the same colour/fog measurement under ?atmos=0.
 */
import {
  setupForest, setSun, holdPose, findShadowSpot, sunExtremes, measureCloudColour, LOOK, cells, ensureFlying,
  convergeShadowPose,
} from './cloud-volume-lib.mjs';
import { waitForBake } from './analytic-shadows-lib.mjs';

export const name = 'cloud-volume-compose';
export const query = 'flight=classic';

const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function linLum(png) {
  const { w, h, ch, data } = png;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const r = data[i * ch]; const g = data[i * ch + 1]; const b = data[i * ch + 2];
    // Clipped pixels carry no ratio: marked and skipped below.
    out[i] = (r >= 254 || g >= 254 || b >= 254) ? NaN
      : 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  }
  return out;
}

/**
 * One cloud-shadowed patch, four frames: shadow on / off, then with the key
 * off, then with key, rim and fill off (both with the shadow off). Linear,
 * sky share 0. Returns cell statistics of removed / sun and of the other
 * direct light the pre-merge law would also have removed.
 */
async function sunOnlyRemoval(ctx, spot, label) {
  const { page } = ctx;
  const lighting = await page.evaluate(() => window.__BIRB.setLighting({}));
  await convergeShadowPose(ctx, spot.i);   // from wherever the bird was: fly there first
  await ensureFlying(ctx);
  const held = await holdPose(ctx, 'return B.goToCloudShadow(arg, { above: 40, tilt: 0.2 });', spot.i, 6);
  const strength = (await page.evaluate(() => window.__BIRB.clouds().tuning.shadowStrength));
  let w = 0; let h = 0;
  const shoot = async (tune, light, tag) => {
    await page.evaluate(({ tune, light }) => {
      const B = window.__BIRB; B.clouds(tune); if (light) B.setLighting(light);
    }, { tune, light });
    await ctx.frames(3);
    const png = await ctx.shot(`${label}-${tag}`);
    w = png.w; h = png.h;
    return linLum(png);
  };
  const on = await shoot({ shadowStrength: strength }, null, 'on');
  const off = await shoot({ shadowStrength: 0 }, null, 'off');
  const again = await shoot({ shadowStrength: strength }, null, 'on-again');
  const keyOff = await shoot({ shadowStrength: 0 }, { key: 0 }, 'key-off');
  const allOff = await shoot({ shadowStrength: 0 }, { key: 0, rim: 0, fill: 0 }, 'direct-off');
  await page.evaluate(({ s, l }) => {
    const B = window.__BIRB; B.clouds({ shadowStrength: s }); B.setLighting({ key: l.key, rim: l.rim, fill: l.fill });
  }, { s: strength, l: lighting });
  await ctx.frames(2);
  // Cells, so a mote or a dither pixel is not a ratio.
  const size = 16;
  const grid = (a) => cells(a, w, h, size, { y0: 0.18, y1: 0.86 });
  const [cOn, cOff, cAgain, cKey, cAll] = [on, off, again, keyOff, allOff].map(grid);
  const cw = Math.floor(w / size);
  const rows = [];
  for (let k = 0; k < cOn.length; k += 1) {
    const vals = [cOn[k].v, cOff[k].v, cAgain[k].v, cKey[k].v, cAll[k].v];
    if (vals.some((v) => !Number.isFinite(v))) continue;
    const sun = cOff[k].v - cKey[k].v;           // the sun's own contribution
    const other = cKey[k].v - cAll[k].v;         // rim + fill
    const removed = cOff[k].v - cOn[k].v;        // what the cloud took
    const noise = Math.abs(cOn[k].v - cAgain[k].v);
    rows.push({ cx: cOn[k].cx, cy: cOn[k].cy, sun, other, removed, noise });
  }
  const lit = rows.filter((r) => r.sun > 0.02);
  const worstExcess = lit.reduce((m, r) => Math.max(m, r.removed - r.sun), -Infinity);
  const noise = rows.reduce((m, r) => Math.max(m, r.noise), 0);
  // The centre of the frame is the spot goToCloudShadow aimed at.
  const cy0 = Math.floor((h * 0.5) / size); const cx0 = Math.floor(cw / 2);
  const centre = lit.filter((r) => Math.abs(r.cx - cx0) <= 1 && Math.abs(r.cy - cy0) <= 1);
  const mean = (a, f) => (a.length ? a.reduce((s, r) => s + f(r), 0) / a.length : NaN);
  const centreOcc = mean(centre, (r) => r.removed / r.sun);
  const otherShare = mean(centre, (r) => r.other / r.sun);
  const sumRemoved = lit.reduce((s, r) => s + r.removed, 0);
  const sumOld = lit.reduce((s, r) => s + (r.sun > 0 ? (r.removed / r.sun) * (r.sun + r.other) : 0), 0);
  return {
    recovery: held.recovery,
    clear: !!held.last?.clear,
    standOff: held.last ? `${held.last.above} up, tilt ${held.last.tilt}` : null,
    // The analytic occlusion of the SUN at the spot, from the converged
    // placement (the JS mirror of the shader; the sky share never enters it).
    occJs: held.last ? 1 - held.last.visibility : NaN,
    elevation: held.last ? held.last.sunElevation : NaN,
    lit: lit.length, worstExcess, noise, centreOcc, otherShare, centreCells: centre.length,
    oldOverRemoval: sumRemoved > 0 ? sumOld / sumRemoved - 1 : NaN,
  };
}

export default async function run(ctx) {
  const { page } = ctx;
  await setupForest(ctx);

  // ── The bake: terrain and tall props, never a cloud ─────────────────────
  const bake = await waitForBake(ctx);
  const meshes = bake?.stats?.meshes || [];
  ctx.check(!!bake?.landed && meshes.length > 0 && !meshes.some((m) => /cloud/i.test(m)),
    `the horizon bake splats no cloud (${meshes.join(', ') || 'no meshes'})`);

  // The bake is a wait of up to a few hundred frames, long enough for the
  // bird to drift into a collider and be grounded; tap Fly if it was.
  ctx.check(await ensureFlying(ctx), 'the bird is flying again after the bake wait');

  // ── One sun, by direction, at Amazing and with shadow maps on ───────────
  const amazing = await page.evaluate(() => window.__BIRB.horizon());
  const sunAt = (hz) => hz.lights.filter((l) => l.sun).map((l) => l.name);
  ctx.check(sunAt(amazing).join() === 'key',
    `at the Amazing boot the one light shining from the sun is the key (${sunAt(amazing).join(', ')})`);
  await page.evaluate(() => window.__BIRB.setShadows({ enabled: true }));
  await ctx.frames(4);
  const shadowed = await page.evaluate(() => ({ hz: window.__BIRB.horizon(), rig: window.__BIRB.lightRig() }));
  ctx.check(sunAt(shadowed.hz).join() === 'shadow' && shadowed.rig.keyVisible === false,
    `with shadow maps on it is the shadow light alone, the key hidden (${sunAt(shadowed.hz).join(', ')}; key visible ${shadowed.rig.keyVisible})`);
  await page.evaluate(() => window.__BIRB.setShadows({ enabled: false }));
  await ctx.frames(3);

  // ── The cloud takes the SUN, once ───────────────────────────────────────
  const spot = await findShadowSpot(ctx);
  ctx.check(!!spot, spot
    ? `a cloud shadow on dry ground: cloud ${spot.i}, t=${spot.t}s, sun ${spot.sunElevation} deg, visibility ${spot.visibility}`
    : 'no cloud shadow on dry ground under a raised sun');
  if (spot) {
    await setSun(ctx, spot.t);
    const setup = await page.evaluate(() => {
      const B = window.__BIRB;
      const bloom = B.setBloom({}).enabled;
      B.setBloom({ enabled: false });
      B.setCameraView('fpv');
      B.setLighting({ tone: 'none' });                 // linear frame
      const tune = B.clouds().tuning;
      B.clouds({ shadowSky: 0 });                      // only the sun term moves
      return { bloom, sky: tune.shadowSky, strength: tune.shadowStrength, patched: B.horizonPatched?.() };
    });
    await ctx.frames(4);
    const a = await sunOnlyRemoval(ctx, spot, 'amazing');
    await page.evaluate(() => window.__BIRB.setShadows({ enabled: true }));
    await ctx.frames(4);
    const u = await sunOnlyRemoval(ctx, spot, 'shadows-on');
    await page.evaluate(() => window.__BIRB.setShadows({ enabled: false }));
    await page.evaluate((s) => {
      const B = window.__BIRB; B.clouds({ shadowSky: s.sky }); B.setLighting({ tone: 'neutral' });
      B.setBloom({ enabled: s.bloom }); B.setCameraView('chase'); B.holdMotion(false);
    }, setup);
    await ctx.frames(4);
    ctx.log(`horizon patch on ${setup.patched} world materials, so the cloud JOINED its sun visibility; analytic occlusion at the spot `
      + `${a.occJs.toFixed(3)} (Amazing) / ${u.occJs.toFixed(3)} (shadows on), sun ${a.elevation} deg`);
    for (const [tag, m] of [['Amazing', a], ['shadows on', u]]) {
      ctx.log(`${tag}: ${m.lit} sunlit cells; removed/sun at the spot ${m.centreOcc.toFixed(3)} over ${m.centreCells} cells; `
        + `worst (removed - sun) ${m.worstExcess.toFixed(4)}; control ${m.noise.toFixed(4)}; rim+fill there = ${(m.otherShare * 100).toFixed(1)}% of the sun's light, `
        + `so the pre-merge law would have removed ${(m.oldOverRemoval * 100).toFixed(1)}% more light over the frame`);
      ctx.check(m.recovery === 'flying' && m.clear,
        `${tag}: the camera holds a clear stand-off over the spot, flying (${m.recovery}; ${m.standOff})`);
      ctx.check(m.lit >= 20, `${tag}: the frame has sunlit ground to measure (${m.lit} cells)`);
      ctx.check(m.worstExcess <= Math.max(0.004, 2 * m.noise),
        `${tag}: the cloud never removes more than the sun's own light (worst excess ${m.worstExcess.toFixed(4)}, control ${m.noise.toFixed(4)})`);
      ctx.check(Number.isFinite(m.centreOcc) && Math.abs(m.centreOcc - m.occJs) <= 0.12,
        `${tag}: what it removes at the spot is the sun's light times the analytic occlusion (${m.centreOcc.toFixed(3)} vs ${m.occJs.toFixed(3)})`);
    }
  }

  // ── Colour: the in-cloud fog and the cloud itself, low sun vs high ──────
  const ex = await sunExtremes(ctx);
  ctx.log(`sun cycle: lowest raised elevation ${ex.low.e} deg at t=${ex.low.t}s, highest ${ex.high.e} deg at t=${ex.high.t}s`);
  const at = async (t, tag) => {
    await ensureFlying(ctx);
    await setSun(ctx, t);
    await ctx.frames(3);
    const rig = await page.evaluate(() => {
      const B = window.__BIRB; const r = B.lightRig();
      return { fog: r.fogColor, mist: r.mistColor, key: r.keyColor, atmos: r.atmos, cloudFog: B.clouds().fogColor };
    });
    const colour = await measureCloudColour(ctx, LOOK.cloud, `colour-${tag}`);
    return { ...rig, colour };
  };
  const low = await at(ex.low.t, 'low');
  const high = await at(ex.high.t, 'high');
  const ratio = (p, q) => p.map((v, c) => v / q[c]);
  const fmt = (v) => v.map((x) => x.toFixed(3)).join('/');
  const rFog = ratio(low.fog, high.fog); const rMist = ratio(low.mist, high.mist); const rCloud = ratio(low.cloudFog, high.cloudFog);
  ctx.log(`low / high sun, per channel: scene fog ${fmt(rFog)}, valley mist ${fmt(rMist)}, in-cloud fog ${fmt(rCloud)}`);
  ctx.check(low.atmos === true, 'the atmosphere model is on in this boot');
  ctx.check(rMist.some((v) => Math.abs(v - 1) > 0.02), `the atmosphere moved the mist between the two suns (${fmt(rMist)})`);
  ctx.check(rCloud.every((v, c) => Math.abs(v - rMist[c]) < 2e-3 * Math.max(1, rMist[c])),
    `the in-cloud fog moves by exactly the atmosphere's ratio (${fmt(rCloud)} vs mist ${fmt(rMist)})`);
  ctx.check(rCloud.every((v, c) => Math.abs(v - rFog[c]) < 2e-3 * Math.max(1, rFog[c])),
    `...which is the scene fog's ratio too (${fmt(rFog)})`);
  const warm = (rgb) => (rgb ? rgb[0] / rgb[2] : NaN);
  const lum = (rgb) => (rgb ? 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] : NaN);
  ctx.log(`cloud ${LOOK.cloud}'s own colour (linear): low sun ${fmt(low.colour.rgb || [0, 0, 0])} (${low.colour.px} px), `
    + `high sun ${fmt(high.colour.rgb || [0, 0, 0])} (${high.colour.px} px); R/B ${warm(low.colour.rgb).toFixed(3)} vs ${warm(high.colour.rgb).toFixed(3)}, `
    + `luminance ${lum(low.colour.rgb).toFixed(3)} vs ${lum(high.colour.rgb).toFixed(3)}; key colour ${fmt(low.key)} vs ${fmt(high.key)}`);
  ctx.check(low.colour.recovery === 'flying' && high.colour.recovery === 'flying',
    `the bird is flying at both colour poses (${low.colour.recovery} / ${high.colour.recovery})`);
  ctx.check(low.colour.px > 200 && high.colour.px > 200, `the cloud is measurable at both suns (${low.colour.px} / ${high.colour.px} px)`);
  ctx.check(warm(low.colour.rgb) > warm(high.colour.rgb),
    `the cloud warms at the low sun with the key light (R/B ${warm(low.colour.rgb).toFixed(3)} > ${warm(high.colour.rgb).toFixed(3)})`);
  await ctx.unfreeze();
}
