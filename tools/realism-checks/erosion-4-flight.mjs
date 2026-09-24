/**
 * A low pass down an eroded channel: the floor holds, and what is drawn stays
 * where the bird can see it.
 *
 * The flight floor is a MINIMUM radius the bird's centre may not go under
 * (terrain + 0.6); an eroded floor is lower, never higher, so the pass is the
 * check that the lowered floor is still one the bird is held above — every
 * frame, not just where a test put it. `aboveGround` comes from the same
 * sampler the floor, the landing check and the walking pose use, so it must
 * never be negative. The clearance above the DRAWN ground is reported beside
 * it (ray-cast against the real triangles under the bird), with the same
 * flight over the same channel measured against the un-eroded mesh as the
 * control — the skim the detail noise always had.
 */
import { findSpots, relaunch } from './erosion-lib.mjs';

export const name = 'erosion-flight';
export const query = 'erosion=1';

export default async function run(ctx) {
  const { page } = ctx;
  await page.evaluate(() => window.__BIRB.setEnvironment('forest'));
  await ctx.frames(6);
  await relaunch(ctx);
  const spots = await findSpots(ctx, { limit: 12 });
  // A trunk channel with a real cut, not a lake shore.
  const spot = spots.find((s) => s.cut > 1.5 && s.wet > 0.6) || spots[0];
  ctx.check(!!spot, `found a channel to fly (wetness ${spot?.wet?.toFixed(2)}, cut ${spot?.cut?.toFixed(2)} units)`);
  if (!spot) return;

  // Heading: down the eroded ground's own slope at the spot (downstream).
  const down = await page.evaluate(async (d) => {
    const { sampleTerrainMeshHeight } = await import('/src/environment/spherical-world.js');
    const up = d.map((v) => v / Math.hypot(...d));
    const h = Math.abs(up[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nrm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const e = nrm(cr(h, up)); const n = cr(up, e);
    const at = (a, b) => { const p = up.map((v, i) => v + (a * e[i] + b * n[i]) * (3 / 120)); return sampleTerrainMeshHeight(p[0] * 120, p[1] * 120, p[2] * 120); };
    const gx = at(1, 0) - at(-1, 0); const gy = at(0, 1) - at(0, -1);
    return nrm(e.map((v, i) => -(gx * v + gy * n[i])));
  }, spot.dir);
  const q = ctx.quatFromUpForward(spot.dir, down, 0.05);
  await page.evaluate(({ d, q }) => {
    const B = window.__BIRB;
    B.hold(false);
    B.setCameraView('chase');
    const pos = B.teleport(d[0], d[1], d[2], 2.2);
    B.restorePose({ position: pos, quaternion: q });
    B.freeze(false);
  }, { d: spot.dir, q });
  await ctx.frames(2);

  // Fly it: a light push, nose just under the horizon, so the pass stays on
  // the floor and skims it rather than flying off the channel as the ground
  // falls away downstream. Sampled every frame.
  const samples = await ctx.hold({ x: 0, y: 0.12 }, 150,
    'const p = B.birdPose(); return p ? [p.aboveGround, p.recovery, p.position[0], p.position[1], p.position[2]] : null;');
  const valid = samples.filter(Boolean);
  const above = valid.map((s) => s[0]).filter((v) => Number.isFinite(v));
  const minAbove = Math.min(...above);
  const path = valid.map((s) => [s[2], s[3], s[4]]);
  let travelled = 0;
  for (let k = 1; k < path.length; k++) travelled += Math.hypot(...path[k].map((v, i) => v - path[k - 1][i]));
  const states = [...new Set(valid.map((s) => s[1]))];
  ctx.check(above.length === valid.length && valid.length >= 140,
    `${valid.length} frames sampled, aboveGround finite on every one`);
  ctx.check(minAbove >= 0,
    `aboveGround never negative over a ${travelled.toFixed(0)}-unit low pass down the channel (min ${minAbove.toFixed(3)}; states ${states.join('/')})`);
  ctx.check(travelled > 15, `the pass covered ground (${travelled.toFixed(1)} units)`);

  // Clearance above what is DRAWN. The control is the SAME flight in the
  // un-eroded world: at each sample the bird held the same height above the
  // un-eroded floor as it did above the eroded one, measured against the
  // un-eroded mesh (a bird flying the eroded floor over the un-eroded mesh
  // would be inside the old ground by construction, which proves nothing).
  const clear = await page.evaluate((pts) => {
    const B = window.__BIRB;
    const on = B.erosion({ samples: pts }).agreement;
    const off = B.erosion({ samples: pts, control: true }).agreement;
    return pts.map((p, k) => {
      const above = Math.hypot(...p) - 120 - on[k].floor;
      return [above - (on[k].mesh - on[k].floor), above - (off[k].mesh - off[k].floor)];
    });
  }, path);
  const minOn = Math.min(...clear.map((c) => c[0]));
  const minOff = Math.min(...clear.map((c) => c[1]));
  ctx.log(`clearance of the bird's centre above the DRAWN ground: min ${minOn.toFixed(3)} eroded, `
    + `${minOff.toFixed(3)} for the same flight over the un-eroded world`);
  ctx.check(minOn > -1.0 && minOn >= minOff - 0.5,
    `the bird's centre never sinks more than a unit into what it sees (min clearance ${minOn.toFixed(3)}; same flight un-eroded ${minOff.toFixed(3)})`);
  await relaunch(ctx);
}
