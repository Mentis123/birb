/**
 * Inside a cloud is fog, and getting there does not pop.
 *
 * The chase camera trails the bird through the outer third of a cloud that
 * its collider does not cover. A front-face-only volume draws NOTHING from
 * inside (every front face is behind the camera), so on e252ca1's opaque
 * puffs the camera saw straight through to clear sky from inside a cloud.
 *
 * The volume keeps exactly one face per pixel — front faces well clear of
 * the hull, back faces near and inside it — starts the chord at the camera
 * whichever face carries it (so the hand-over changes nothing over the sky),
 * and drives a world fog from the camera's immersion (a peak or a tree
 * inside the puff sits in FRONT of its back faces, so the volume alone
 * cannot veil it). Walked here along one line from two density radii out to
 * as deep as the colliders allow: the puffs' COVERAGE of the sky band at
 * every step (flat magenta, 1 - G(shown)/G(hidden): only the volume can
 * cover the sky, and a white veil over a pale sky is invisible to a plain
 * difference), and the world-fog uniform. Coverage must only ever rise.
 */
import { setupForest, holdPose } from './cloud-volume-lib.mjs';

export const name = 'cloud-volume-inside';
export const query = 'flight=classic';

const DEPTHS = [2.0, 1.8, 1.62, 1.5, 1.4, 1.32, 1.26, 1.18, 1.08, 0.95, 0.8, 0.6];

function skyCoverage(shown, hidden) {
  const { w, h, ch } = shown;
  let s = 0; let n = 0;
  for (let y = 0; y < Math.floor(h * 0.3); y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * ch;
      const g = hidden.data[i + 1];
      if (g < 24) continue;
      s += Math.min(1, Math.max(0, 1 - shown.data[i + 1] / g));
      n += 1;
    }
  }
  return n ? s / n : 0;
}

export default async function run(ctx) {
  const { page } = ctx;
  await setupForest(ctx);
  const allRhos = DEPTHS.map((d) => 1 - d * d);
  // One puff, one ray, every depth clear of every collider — as deep as any
  // line goes (the collider covers each cloud's middle by design).
  const line = await page.evaluate((rhos) => {
    const B = window.__BIRB;
    const n = B.clouds()?.puffs || 0;
    let best = null;
    for (let puff = 0; puff < n; puff += 1) {
      for (let dir = 0; dir < 7; dir += 1) {
        let k = 0;
        while (k < rhos.length && B.goToCloud(0, { inside: rhos[k], puff, dir, dryRun: true })) k += 1;
        if (!best || k > best.steps) best = { puff, dir, steps: k };
      }
    }
    return best;
  }, allRhos);
  const steps = line ? line.steps : 0;
  const deepest = steps ? DEPTHS[steps - 1] : null;
  ctx.check(steps > 0 && deepest <= 0.95, line
    ? `a collider-free line into puff ${line.puff} (ray ${line.dir}) reaching ${deepest} density radii from its centre`
    : 'no collider-free line into any puff');
  if (!(steps > 0 && deepest <= 0.95)) return;
  const rhos = allRhos.slice(0, steps);
  const bloom = await page.evaluate(() => {
    const B = window.__BIRB; const was = B.setBloom({}).enabled;
    B.setBloom({ enabled: false }); B.setCameraView('fpv');
    return was;
  });
  const rows = [];
  let knocked = 0;
  for (let k = 0; k < rhos.length; k += 1) {
    await page.evaluate(() => window.__BIRB.clouds({ visible: true, flat: false }));
    // Re-posed every frame until the shot, so d is where the camera IS.
    const held = await holdPose(ctx,
      'B.goToCloud(0, { inside: arg.rho, puff: arg.line.puff, dir: arg.line.dir });',
      { rho: rhos[k], line }, 6);
    if (held.recovery !== 'flying') knocked += 1;
    const fog = (await page.evaluate(() => window.__BIRB.clouds()))?.fog ?? 0;
    await ctx.shot(`d${DEPTHS[k]}-shaded`);
    await page.evaluate(() => window.__BIRB.clouds({ flat: true }));
    await ctx.frames(3);
    const shown = await ctx.shot(`d${DEPTHS[k]}-flat`);
    await page.evaluate(() => window.__BIRB.clouds({ visible: false }));
    await ctx.frames(3);
    const hidden = await ctx.shot(`d${DEPTHS[k]}-hidden`);
    await page.evaluate(() => { const B = window.__BIRB; B.clouds({ visible: true, flat: false }); B.holdMotion(false); });
    rows.push({ d: DEPTHS[k], sky: skyCoverage(shown, hidden), fog });
  }
  await page.evaluate((b) => { const B = window.__BIRB; B.setCameraView('chase'); B.setBloom({ enabled: b }); }, bloom);
  for (const r of rows) ctx.log(`d=${r.d.toFixed(2)} density radii: sky coverage ${(r.sky * 100).toFixed(1)}%, world fog ${r.fog}`);
  ctx.check(knocked === 0, `the bird flew every step of the walk, never knocked down (${knocked} steps were not)`);
  const last = rows[rows.length - 1];
  const range = Math.max(...rows.map((r) => r.sky)) - Math.min(...rows.map((r) => r.sky));
  let maxStep = 0;
  let maxDrop = 0;
  for (let k = 1; k < rows.length; k += 1) {
    maxStep = Math.max(maxStep, Math.abs(rows[k].sky - rows[k - 1].sky));
    maxDrop = Math.max(maxDrop, rows[k - 1].sky - rows[k].sky);
  }
  ctx.check(last.sky >= 0.5,
    `from inside, the volume covers ${(last.sky * 100).toFixed(1)}% of the sky band — back faces carry the chord from the camera`);
  ctx.check(last.fog > 0, `the camera's immersion fogs the world (fog ${last.fog})`);
  ctx.check(rows[0].fog === 0, `outside the cloud there is no fog (${rows[0].fog})`);
  ctx.check(maxStep <= 0.5 * range,
    `no pop on the way in: the largest step in sky coverage is ${(maxStep * 100).toFixed(1)} points of a ${(range * 100).toFixed(1)}-point range`);
  // The first cut faded each puff to nothing at its hull to hide the switch
  // from front to back faces, and a cloud you flew at dissolved in front of
  // you (74% of the sky band -> 20% -> 94%) before it closed round you.
  ctx.check(maxDrop <= 0.05,
    `no dip on the way in: sky coverage never falls, step to step, by more than ${(maxDrop * 100).toFixed(1)} points`);
  await ctx.unfreeze();
}
