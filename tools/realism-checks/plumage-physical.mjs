/**
 * The v3 bird's feathers are PHYSICAL, and the sky they reflect stands on the
 * bird's own horizon.
 *
 * Measured on the base (e252ca1, 2026-09-23): both feather materials were
 * MeshStandardMaterial with no environment map, the wing faked a brighter
 * specular with metalness 0.34, and its own comment said it could go no
 * further because "there is no envMap on the shipping path — past about that,
 * three's metal has nothing to reflect and the wing goes DARK between
 * highlights". This check fails on that base: no physical material, no film,
 * no sheen, no env map.
 *
 * The orientation half is the one a still frame cannot show. The bake puts the
 * zenith at world +Y and three samples an env map in WORLD space, so without
 * the per-frame rotation a bird on the equator reflects the horizon on its
 * back. Two measurements, and the second is the decisive one:
 *
 *  - `plumage().zenith` — the bird's radial up put through the matrix three
 *    builds from envMapRotation — must be (0, 1, 0) at the north pole, on the
 *    equator and at the south pole;
 *  - ON THE GPU: bake a two-tone sky (white above the horizon, black below)
 *    and its inverse, route the env's own irradiance into the feathers
 *    (`envDiffuse` 1, hemisphere 0 — only the env lights them then), and
 *    photograph the bird's BACK from above. Oriented right, the back is bright
 *    under white-above and dark under black-above at every latitude; a
 *    world-frame env on the equator would light the back from the side and
 *    the two frames would come out nearly equal. Lights are identical between
 *    the pair, so the difference is the env and nothing else.
 *
 * Own boot (`plumage=1` is the default path, spelled out) because it switches
 * biome and rebakes the env, which no shared-boot check should inherit; and
 * `flight=classic` because the stunt model SINKS a frozen bird, which walks
 * it out of the frame between placing the camera and taking the shot.
 */
export const name = 'plumage-physical';
export const query = 'plumage=1&flight=classic';

const WHITE_ABOVE = { top: 0xffffff, mid: 0xffffff, horizon: 0xffffff, bottom: 0x000000 };
const BLACK_ABOVE = { top: 0x000000, mid: 0x000000, horizon: 0x000000, bottom: 0xffffff };
const PROBE = { hemi: 0, envDiffuse: 1, rim: 0, featherSheen: 0 };

const SPOTS = {
  north: [0.02, 1, 0.03],
  equator: [1, 0.02, 0.03],
  south: [0.03, -1, 0.02],
};

/** Mean linear luminance of the non-grey (bird) pixels in the middle band. */
function birdLum(png) {
  const { w, h, ch, data } = png;
  const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  let s = 0; let n = 0;
  for (let y = Math.floor(h * 0.3); y < Math.floor(h * 0.7); y += 1) {
    for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.9); x += 1) {
      const i = (y * w + x) * ch;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      if (Math.abs(r - 128) <= 24 && Math.abs(g - 128) <= 24 && Math.abs(b - 128) <= 24) continue;
      s += 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
      n += 1;
    }
  }
  return { lum: n ? s / n : 0, n };
}

export default async function run(ctx) {
  const { page } = ctx;
  const p = await page.evaluate(() => window.__BIRB.plumage());
  ctx.check(p && p.enabled === true, 'the default boot builds physical plumage');
  ctx.check(p?.contour?.type === 'MeshPhysicalMaterial' && p?.vane?.type === 'MeshPhysicalMaterial',
    `both feather materials are MeshPhysicalMaterial (${p?.contour?.type} / ${p?.vane?.type})`);
  ctx.check(p?.vane?.iridescence > 0 && p?.vane?.iridescenceIOR > 1.56,
    `the wing carries a thin film denser than keratin (iridescence ${p?.vane?.iridescence}, film n ${p?.vane?.iridescenceIOR})`);
  ctx.check(p?.contour?.sheen > 0, `the body carries sheen (${p?.contour?.sheen}, roughness ${p?.contour?.sheenRoughness})`);
  ctx.check(p?.contour?.metalness === 0 && p?.vane?.metalness === 0, 'feathers are dielectric (metalness 0 on both)');
  ctx.check(p?.contour?.envMap && p?.vane?.envMap && p?.env?.bound === true && p?.env?.bakes >= 1,
    `the bird reflects its own baked sky (bakes ${p?.env?.bakes}, bound ${p?.env?.bound})`);
  ctx.check(p?.contour?.hemi === 1 && p?.contour?.envDiffuse === 0,
    'the sky is counted once: the hemisphere feeds the IBL slot, the env keeps only its reflection');

  // The zenith follows the radial up, everywhere.
  for (const [where, U] of Object.entries(SPOTS)) {
    await ctx.place({ U, above: 60, settle: 4 });
    const z = await page.evaluate(() => window.__BIRB.plumage().zenith);
    const ok = Array.isArray(z) && Math.abs(z[0]) < 2e-3 && Math.abs(z[1] - 1) < 2e-3 && Math.abs(z[2]) < 2e-3;
    ctx.check(ok, `${where}: the env's zenith is the bird's radial up (${JSON.stringify(z)})`);
  }

  // The same, measured in pixels.
  await page.evaluate((probe) => {
    const B = window.__BIRB;
    B.pinTier?.(0);
    B.setSunEnabled(false);
    B.setBloom?.({ enabled: false });
    B.plumage({ set: { contour: probe, vane: probe } });
  }, PROBE);
  const shootTop = async (U, sky, label) => {
    await ctx.place({ U, above: 60, settle: 2 });
    await page.evaluate((s) => {
      const B = window.__BIRB;
      B.plumage({ sky: s });
      B.birdStudio(true);
      B.flapPhase(0.62);
      B.orbitBird(0, Math.PI / 2, 3.4);
    }, sky);
    await ctx.frames(4);
    await page.evaluate(() => window.__BIRB.orbitBird(0, Math.PI / 2, 3.4));
    await ctx.frames(2);
    const png = await ctx.shot(label);
    await page.evaluate(() => { window.__BIRB.birdStudio(false); window.__BIRB.flapPhase(null); });
    return birdLum(png);
  };
  const contrast = {};
  for (const [where, U] of Object.entries(SPOTS)) {
    const up = await shootTop(U, WHITE_ABOVE, `${where}-white-above`);
    const down = await shootTop(U, BLACK_ABOVE, `${where}-black-above`);
    contrast[where] = up.lum - down.lum;
    ctx.log(`${where}: back lit ${up.lum.toFixed(4)} under white-above vs ${down.lum.toFixed(4)} under black-above (${up.n}/${down.n} px)`);
    ctx.check(up.n > 500 && down.n > 500, `${where}: the bird is in frame (${up.n} / ${down.n} px)`);
    ctx.check(up.lum > down.lum * 2,
      `${where}: the back reflects the sky ABOVE it (${up.lum.toFixed(4)} vs ${down.lum.toFixed(4)} linear)`);
  }
  ctx.check(contrast.equator > contrast.north * 0.6 && contrast.south > contrast.north * 0.6,
    `the sky stands on the local horizon at every latitude (back contrast N ${contrast.north.toFixed(4)} / E ${contrast.equator.toFixed(4)} / S ${contrast.south.toFixed(4)})`);

  // Put the shipping state back, then prove a biome switch rebakes it.
  await page.evaluate((orig) => {
    window.__BIRB.plumage({ sky: null, set: {
      contour: { hemi: orig.contour.hemi, envDiffuse: orig.contour.envDiffuse, rim: orig.contour.rim },
      vane: { hemi: orig.vane.hemi, envDiffuse: orig.vane.envDiffuse, rim: orig.vane.rim, featherSheen: orig.vane.featherSheen },
    } });
  }, p);
  const restored = await page.evaluate(() => window.__BIRB.plumage());
  ctx.check(JSON.stringify(restored.contour) === JSON.stringify(p.contour) && JSON.stringify(restored.vane) === JSON.stringify(p.vane),
    'the probe leaves the shipping materials exactly as it found them');
  const before = await page.evaluate(() => window.__BIRB.plumage().env);
  const switched = await page.evaluate(() => window.__BIRB.setEnvironment('canyons'));
  await ctx.frames(6);
  const after = await page.evaluate(() => window.__BIRB.plumage().env);
  ctx.check(switched && after.bakes === before.bakes + 1 && after.sky?.top === 0x756eaa && after.bound,
    `a biome switch rebakes the bird's sky once (bakes ${before.bakes} -> ${after.bakes}, top #${(after.sky?.top ?? 0).toString(16)})`);
  await page.evaluate(() => window.__BIRB.setEnvironment('forest'));
  await ctx.frames(4);
  await ctx.unfreeze();
  await page.evaluate(() => window.__BIRB.setSunEnabled(true));
}
