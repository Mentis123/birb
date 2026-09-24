/**
 * Under a skyline AND a cloud, the sun is lost ONCE — by the product of the
 * two visibilities (review of the cloud-volume / horizon-shadow wiring).
 *
 * cloud-volume-compose proves the cloud takes the sun's light times its
 * occlusion at a patch in the open. That patch is under no skyline, so it
 * cannot see how the two shadows COMBINE, which is the one thing the merge
 * had to get right: built on e252ca1, the cloud would have stacked on the
 * horizon as a second, differently-shaped term. Here the patch is found in a
 * ridge's shadow (`horizonFind`, the same search analytic-shadows-ridge
 * uses), and a cloud-level shadow sphere is planted on the sun ray above it
 * by writing the shared uniform the real clouds use — so the two shadows
 * overlap exactly where the camera is looking, whatever the seed put where.
 *
 * Both shadows are dialled to PARTIAL strength (the horizon lever at 0.5,
 * the cloud's at 0.55) so each leaves light to measure, tone mapping is off
 * so the frame is linear, the cloud's sky share is off so only the sun term
 * moves, and the clock is held so every frame is the same pixels. With S the
 * sun's own light at the patch (key on minus key off):
 *
 *   h = S_horizon / S,  c = S_cloud / S,  and under both: S_both = S * h * c.
 *
 * A stacked law (the cloud taking its occlusion of the FULL sun off whatever
 * the skyline left) removes (1 - c) * S instead of (1 - c) * h * S — more than
 * the sun has left there. The control is F(both) shot twice.
 */
import { setSun, waitForBake, ridgeShadowView, boxLum, restore } from './analytic-shadows-lib.mjs';

export const name = 'cloud-volume-ridge';

const H = 0.5;     // horizon strength
const C = 0.55;    // cloud shadow strength

export default async function run(ctx) {
  const { page } = ctx;
  await page.evaluate(() => { const B = window.__BIRB; B.pinTier?.(0); B.stillAir?.(true); B.birdShadow?.(0); });
  const info = await page.evaluate(() => window.__BIRB.clouds());
  if (!ctx.check(info && info.volumetric && info.shadowSpheres > 0, 'the forest has real cloud shadows to plant')) return;
  const bake = await waitForBake(ctx);
  ctx.check(!!bake?.landed, 'the horizon map baked');
  // Shadow maps off (with them on, planet light hides the key and the shadow
  // light is the sun, so the key lever below would move nothing).
  await page.evaluate(() => window.__BIRB.setShadows({ enabled: false }));
  const setup = await page.evaluate((C) => {
    const B = window.__BIRB;
    const bloom = B.setBloom({}).enabled;
    B.setBloom({ enabled: false });
    B.setLighting({ tone: 'none' });
    const tune = B.clouds().tuning;
    B.clouds({ shadowSky: 0, shadowStrength: 0 });
    const lighting = B.setLighting({});
    return { bloom, sky: tune.shadowSky, strength: tune.shadowStrength, key: lighting.key };
  }, C);
  const k = setup.key;
  let view = null;
  const measureAt = async (h, c, key, tag) => {
    await page.evaluate(({ h, c, key }) => {
      const B = window.__BIRB;
      B.horizon(h);
      B.clouds({ shadowStrength: c });
      B.setLighting({ key });
    }, { h, c, key });
    await ctx.frames(3);
    const png = await ctx.shot(`ridge-cloud-${tag}`);
    return boxLum(ctx, png, view.px, 10);
  };
  // A patch the sun would light if the ridge were not there: a lee slope
  // that faces away from the sun is dark by its own Lambert term and has
  // nothing to lose to either shadow. Tried at three suns.
  for (const t of [0, 60, 120]) {
    await setSun(ctx, t);
    view = await ridgeShadowView(ctx);
    if (!view) continue;
    const lit = await measureAt(0, 0, k, `probe-${t}`) - await measureAt(0, 0, 0, `probe-${t}-dark`);
    ctx.log(`t=${t}s: ridge-shadowed patch under a ${view.spot.terrainHorizonDeg} deg skyline, sun ${view.spot.sunElevationDeg} deg; its own sun term ${lit.toFixed(4)}`);
    if (lit > 0.01) break;
    view = null;
  }
  if (!ctx.check(!!view, view
    ? `open ground in a ridge's shadow that faces the sun: sun ${view.spot.sunElevationDeg} deg under a ${view.spot.terrainHorizonDeg} deg skyline`
    : 'open ground in a ridge\'s shadow that faces the sun')) {
    await page.evaluate((s) => {
      const B = window.__BIRB; B.horizon(1); B.setLighting({ key: s.key, tone: 'neutral' }); B.setBloom({ enabled: s.bloom });
      B.clouds({ shadowSky: s.sky, shadowStrength: s.strength });
    }, setup);
    await restore(ctx);
    return;
  }

  await page.evaluate(async ({ p }) => {
    const B = window.__BIRB;
    const m = await import('/src/environment/cloud-volume.js');
    const u = m.cloudShadowUniforms;
    window.__cvRidgeSaved = { spheres: Array.from(u.spheres.value), count: u.count.value };
    const sun = B.horizon().sun;
    // A 9-unit cloud sphere 25 units up the sun ray from the patch: the
    // patch's ray to the sun runs straight through its centre.
    const c = [p[0] + sun[0] * 25, p[1] + sun[1] * 25, p[2] + sun[2] * 25];
    u.spheres.value.fill(0);
    u.spheres.value[0] = c[0]; u.spheres.value[1] = c[1]; u.spheres.value[2] = c[2]; u.spheres.value[3] = 9;
    u.count.value = 1;
  }, { p: view.spot.position });
  await ctx.frames(3);

  const shoot = measureAt;
  const F00 = await shoot(0, 0, k, 'neither');
  const F01 = await shoot(0, C, k, 'cloud');
  const F10 = await shoot(H, 0, k, 'ridge');
  const F11 = await shoot(H, C, k, 'both');
  const F11b = await shoot(H, C, k, 'both-again');
  const K0 = await shoot(0, 0, 0, 'key-off');
  const K1 = await shoot(H, 0, 0, 'key-off-ridge');
  // Restore every lever before judging anything.
  await page.evaluate((s) => {
    const B = window.__BIRB;
    B.horizon(1); B.setLighting({ key: s.key, tone: 'neutral' }); B.setBloom({ enabled: s.bloom });
    B.clouds({ shadowSky: s.sky, shadowStrength: s.strength });
    return import('/src/environment/cloud-volume.js').then((m) => {
      const u = m.cloudShadowUniforms; const sv = window.__cvRidgeSaved;
      u.spheres.value.set(sv.spheres); u.count.value = sv.count;
      delete window.__cvRidgeSaved;
    });
  }, setup);
  await ctx.frames(2);

  const S = F00 - K0;           // the sun's own light at the patch
  const Sc = F01 - K0;          // ... through the cloud alone
  const Sh = F10 - K1;          // ... past the skyline alone (the skyline also dims the sky: K1)
  const Sb = F11 - K1;          // ... through both
  const h = Sh / S; const c = Sc / S;
  const predicted = S * h * c;
  const noise = Math.abs(F11 - F11b);
  const removedUnderRidge = F10 - F11;
  const stacked = (1 - c) * S;  // what a law blind to the skyline would remove
  ctx.log(`linear box at the patch: sun S ${S.toFixed(4)}, key-off ${K0.toFixed(4)} / ${K1.toFixed(4)} (ridge); `
    + `h = ${h.toFixed(3)}, c = ${c.toFixed(3)}; under both ${Sb.toFixed(4)} vs product ${predicted.toFixed(4)}; `
    + `the cloud removed ${removedUnderRidge.toFixed(4)} under the ridge (product law ${((1 - c) * Sh).toFixed(4)}, `
    + `a stacked law ${stacked.toFixed(4)}); control ${noise.toFixed(5)}`);
  ctx.check(S > 0.01, `the patch has direct sun to measure (${S.toFixed(4)})`);
  ctx.check(h > 0.15 && h < 0.9 && c > 0.15 && c < 0.9,
    `both shadows are partial, so each leaves light to measure (h ${h.toFixed(3)}, c ${c.toFixed(3)})`);
  const tol = Math.max(0.03 * S, 4 * noise, 1e-3);
  ctx.check(Math.abs(Sb - predicted) <= tol,
    `under both, the sun is h x c of itself: ${Sb.toFixed(4)} vs ${predicted.toFixed(4)} (tolerance ${tol.toFixed(4)})`);
  ctx.check(removedUnderRidge <= Sh + tol,
    `under the ridge the cloud never removes more than the sun the ridge left (${removedUnderRidge.toFixed(4)} <= ${Sh.toFixed(4)})`);
  ctx.check(Math.abs(removedUnderRidge - stacked) > 2 * tol || Math.abs(1 - h) < 0.05,
    `...and is measurably NOT the stacked law's ${stacked.toFixed(4)}`);
  await restore(ctx);
  await page.evaluate(() => { const B = window.__BIRB; B.stillAir?.(false); B.birdShadow?.(1); });
}
