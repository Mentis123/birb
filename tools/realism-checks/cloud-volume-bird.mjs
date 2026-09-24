/**
 * A cloud the bird flies into never swallows the bird.
 *
 * Measured on e252ca1 (2026-09-23): the puffs were solid, so a bird flying
 * into the part of a cloud its collider does not cover went BEHIND an opaque
 * polyhedron and vanished from its own chase camera.
 *
 * The volume draws one face per pixel and integrates the chord from the
 * camera either way; the face only decides what happens to an OPAQUE thing
 * inside the hull. A front face is in front of it and veils it with the
 * WHOLE chord, including the cloud behind it; a back face is behind it and
 * leaves it clear. cloud-volume.js switches to back faces within
 * `nearMargin` of the hull for the camera OR the bird, so the bird inside a
 * puff is never veiled by the density behind it.
 *
 * Here the bird sits just inside a puff's hull (outside its density), facing
 * in, with the chase camera behind it OUTSIDE the hull. The bird's own pixels
 * come from a pair with the bird shown and hidden; the puff's coverage of
 * them from the flat-magenta pair (1 - G(shown)/G(hidden)). The margin is
 * pinned at 0.5 for the A/B so the camera, five units back, is outside it
 * while the bird is inside: the bird as focus against the camera alone, then
 * the shipping margin. A ring of pixels just around the bird proves the
 * cloud is actually there.
 */
import { setupForest, holdPose } from './cloud-volume-lib.mjs';

export const name = 'cloud-volume-bird';
export const query = 'flight=classic';

// d = sqrt(1 - rho) density radii from the centre: 0.9 hull radii, inside
// the hull and just outside the (lumpy) density.
const RHO = 1 - (0.9 / 0.78) ** 2;

function birdMask(shown, hidden) {
  const { w, h, ch } = shown;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    let d = 0;
    for (let c = 0; c < 3; c += 1) d = Math.max(d, Math.abs(shown.data[i * ch + c] - hidden.data[i * ch + c]));
    if (d > 10) mask[i] = 1;
  }
  return mask;
}

// Mean coverage over the mask, and over a ring `r0..r1` px from (cx, cy)
// that is NOT the bird.
function coverage(flat, clear, mask, cx, cy, r0, r1) {
  const { w, h, ch } = flat;
  let bird = 0; let nb = 0; let ring = 0; let nr = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const g = clear.data[i * ch + 1];
      if (g < 24) continue;
      const a = Math.min(1, Math.max(0, 1 - flat.data[i * ch + 1] / g));
      if (mask[i]) { bird += a; nb += 1; continue; }
      const rr = Math.hypot(x - cx, y - cy);
      if (rr >= r0 && rr <= r1) { ring += a; nr += 1; }
    }
  }
  return { bird: nb ? bird / nb : null, birdPx: nb, ring: nr ? ring / nr : null, ringPx: nr };
}

export default async function run(ctx) {
  const { page } = ctx;
  await setupForest(ctx);
  // The biggest puff with a collider-free spot on its outer side — and free
  // a little deeper too, since the bird drifts in toward the puff's centre
  // between one frame's re-pose and the next.
  const pick = await page.evaluate(({ rho, deeper }) => {
    const B = window.__BIRB;
    const n = B.clouds()?.puffs || 0;
    let best = null;
    for (let puff = 0; puff < n; puff += 1) {
      const r = B.goToCloud(0, { inside: rho, puff, dir: 0, dryRun: true });
      if (!r || !B.goToCloud(0, { inside: deeper, puff, dir: 0, dryRun: true })) continue;
      if (!best || r.radius > best.radius) best = r;
    }
    return best;
  }, { rho: RHO, deeper: 1 - (0.84 / 0.78) ** 2 });
  ctx.check(!!pick, pick ? `a collider-free spot just inside puff ${pick.puff} (hull radius ${pick.radius.toFixed(1)})` : 'no collider-free spot inside any puff');
  if (!pick) return;
  const bloom = await page.evaluate(() => {
    const B = window.__BIRB;
    B.setCameraView('chase');
    const was = B.setBloom({}).enabled;
    B.setBloom({ enabled: false });
    return was;
  });
  // freeze() does not hold the bird (the main loop re-asserts cruise speed
  // every frame; its own comment says so), so the pose is re-set EVERY frame
  // while the chase camera settles behind it, then every clock is stopped.
  const { recovery: state } = await holdPose(ctx,
    'B.goToCloud(0, { inside: arg.rho, puff: arg.pick.puff, dir: arg.pick.dir });', { rho: RHO, pick }, 30);
  ctx.check(state === 'flying', `the bird is still flying, not knocked down (${state})`);
  const where = await page.evaluate(() => window.__BIRB.birdScreen());
  const puffAt = await page.evaluate((i) => window.__BIRB.clouds({ list: true }).puffList[i], pick.puff);
  const dist = (p) => Math.hypot(p[0] - puffAt[0], p[1] - puffAt[1], p[2] - puffAt[2]);
  const birdD = dist(where.position); const camD = dist(where.camera);
  ctx.log(`from the puff's centre: bird ${birdD.toFixed(2)}, camera ${camD.toFixed(2)}, hull radius ${puffAt[3].toFixed(2)}`);
  ctx.check(birdD < puffAt[3] * 0.934 && camD > puffAt[3] + 0.5,
    `the bird is inside the hull (${(birdD / puffAt[3]).toFixed(2)} R) and the camera outside it and the A/B margin (${(camD / puffAt[3]).toFixed(2)} R)`);
  const shot = async (state, tag) => {
    await page.evaluate((s) => {
      const B = window.__BIRB;
      if (s.bird !== undefined) B.birdVisible(s.bird);
      B.clouds(s.clouds);
    }, state);
    await ctx.frames(3);
    return ctx.shot(tag);
  };
  const withBird = await shot({ bird: true, clouds: { visible: false } }, 'clear-bird');
  const noBird = await shot({ bird: false, clouds: { visible: false } }, 'clear-nobird');
  const mask = birdMask(withBird, noBird);
  // Margin 0.5: the camera is outside it, the bird inside the hull.
  const onBird = await shot({ bird: true, clouds: { visible: true, flat: true, nearMargin: 0.5, focus: true } }, 'flat-focus');
  const offBird = await shot({ clouds: { focus: false } }, 'flat-camera-only');
  const shipping = await shot({ clouds: { focus: true, reset: true } }, 'flat-shipping');
  const shadedOn = await shot({ clouds: { flat: false } }, 'shaded-shipping');
  // The bird takes the cloud's shadow on its sun light like the ground does
  // (index.html patches its lit materials with addCloudShadow, fog off): the
  // same frame with the shadow at 0 is the bird as the pre-merge build lit it.
  const shadowStrength = await page.evaluate(() => window.__BIRB.clouds().tuning.shadowStrength);
  const shadedOff = await shot({ clouds: { shadowStrength: 0 } }, 'shaded-no-cloud-shadow');
  await page.evaluate((st) => window.__BIRB.clouds({ shadowStrength: st }), shadowStrength);
  const cam = await page.evaluate(() => window.__BIRB.clouds());
  await page.evaluate((b) => {
    const B = window.__BIRB;
    B.clouds({ flat: false, focus: true, visible: true, reset: true });
    B.birdVisible(true);
    B.setBloom({ enabled: b });
    B.holdMotion(false);
  }, bloom);
  const { w, h } = withBird;
  const cx = where.x * w; const cy = where.y * h; const r = Math.max(6, where.r * w);
  const birdPx = mask.reduce((s, v) => s + v, 0);
  ctx.log(`bird ${where.distance} units from the camera, ${birdPx} px on screen at (${cx.toFixed(0)}, ${cy.toFixed(0)}), puff hull radius ${pick.radius.toFixed(1)}`);
  ctx.check(birdPx > 150, `the bird is on screen (${birdPx} px)`);
  const a = coverage(onBird, withBird, mask, cx, cy, r * 1.2, r * 2.5);
  const b = coverage(offBird, withBird, mask, cx, cy, r * 1.2, r * 2.5);
  const s = coverage(shipping, withBird, mask, cx, cy, r * 1.2, r * 2.5);
  ctx.log(`coverage of the bird: focus ${(a.bird * 100).toFixed(1)}%, camera only ${(b.bird * 100).toFixed(1)}%, shipping ${(s.bird * 100).toFixed(1)}%; `
    + `of the ring around it: ${(a.ring * 100).toFixed(1)}% (${a.ringPx} px)`);
  ctx.check(a.ring >= 0.3, `the bird is in the cloud: ${(a.ring * 100).toFixed(1)}% coverage just around it`);
  ctx.check(b.bird >= 0.3, `with the camera alone choosing, the front face veils the bird with the cloud BEHIND it (${(b.bird * 100).toFixed(1)}%)`);
  ctx.check(a.bird <= 0.05, `with the bird as focus, the puff it is in leaves it clear (${(a.bird * 100).toFixed(1)}%)`);
  ctx.check(s.bird <= 0.05, `and so does the shipping margin (${(s.bird * 100).toFixed(1)}%)`);
  // Mean linear luminance of the bird's own pixels, shadow on vs off.
  const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const birdLum = (png) => {
    let sum = 0; let n = 0;
    for (let i = 0; i < w * h; i += 1) {
      if (!mask[i]) continue;
      const k = i * png.ch;
      sum += 0.2126 * toLin(png.data[k]) + 0.7152 * toLin(png.data[k + 1]) + 0.0722 * toLin(png.data[k + 2]);
      n += 1;
    }
    return n ? sum / n : 0;
  };
  const lOn = birdLum(shadedOn); const lOff = birdLum(shadedOff);
  const birdSun = cam?.birdSun;
  ctx.log(`the bird inside the puff: the sun's analytic visibility at the bird ${birdSun}; linear luminance `
    + `${lOn.toFixed(4)} with the cloud shadow vs ${lOff.toFixed(4)} without it (${((1 - lOn / lOff) * 100).toFixed(1)}% darker)`);
  if (birdSun !== null && birdSun < 0.8) {
    ctx.check(lOn < lOff * 0.99, `the bird in a cloud's shade is shaded like the ground under it (${((1 - lOn / lOff) * 100).toFixed(1)}% darker at visibility ${birdSun})`);
  } else {
    ctx.check(Math.abs(lOn - lOff) <= 0.02 * lOff + 1e-4, `the bird out of the cloud's shade keeps its light (visibility ${birdSun}, ${((1 - lOn / lOff) * 100).toFixed(1)}%)`);
  }
  ctx.check(cam?.focus === true && cam?.sort?.inversions === 0,
    `the bird is the live focus and the puffs draw back to front (${cam?.sort?.inversions} inversions, ${cam?.sort?.writes} re-sorts)`);
  await ctx.unfreeze();
}
