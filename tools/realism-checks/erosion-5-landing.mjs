/**
 * A landing on eroded ground still lands, and the bird can walk down the bed.
 *
 * tools/birb-walk.mjs is frozen and boots the default world, so it never
 * touches a carved channel. This is its eroded counterpart: put the bird on
 * the floor of the deepest channel the forest has, let the REAL ground
 * collision do the transition (as the player's own landing does), then walk
 * it — the landing check, the walking pose and the flight floor all read one
 * carved field, and a mismatch between them shows up as a bird that never
 * grounds, or one that leaves the surface on the first step.
 *
 * Frames, never milliseconds: the landing and the walk advance per frame.
 * The strict `<` in the landing check is a coin toss at exactly the floor
 * (CLAUDE.md, "A level bird cannot land"), so it is polled, as birb-walk does.
 */
import { findSpots, relaunch } from './erosion-lib.mjs';

export const name = 'erosion-landing';
export const query = 'erosion=1';

const arc = (a, b) => {
  const la = Math.hypot(...a); const lb = Math.hypot(...b);
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, dot))) * ((la + lb) / 2);
};

export default async function run(ctx) {
  const { page } = ctx;
  await page.evaluate(() => window.__BIRB.setEnvironment('forest'));
  await ctx.frames(6);
  await relaunch(ctx);
  const spots = await findSpots(ctx, { limit: 10, by: 'cut' });
  const spot = spots.find((s) => s.cut > 2) || spots[0];
  ctx.check(!!spot && spot.cut > 2, `found a carved channel bed to land in (cut ${spot?.cut?.toFixed(2)} units)`);
  if (!spot) return;

  await page.evaluate((d) => {
    const B = window.__BIRB;
    B.hold(false);
    B.freeze(false);
    B.setCameraView('chase');
    B.setStick(0, 0);
    B.teleport(d[0], d[1], d[2], 3);
  }, spot.dir);
  await ctx.frames(3);
  await page.evaluate(() => window.__BIRB.setAltitude(0.2));
  let grounded = null;
  for (let i = 0; i < 60 && !grounded; i++) {
    await ctx.frames(3);
    const p = await page.evaluate(() => window.__BIRB.birdPose());
    if (p?.recovery === 'grounded') grounded = p;
    else if (i % 10 === 9) await page.evaluate(() => window.__BIRB.setAltitude(0.2));
  }
  ctx.check(!!grounded, `the bird GROUNDED on the eroded bed (radius ${grounded?.radius}, aboveGround ${grounded?.aboveGround})`);
  if (!grounded) { await relaunch(ctx); return; }
  ctx.check(grounded.aboveGround >= 0 && grounded.aboveGround < 1.2,
    `it stands ON the carved ground, not above or inside it (aboveGround ${grounded.aboveGround})`);

  // Walk forward, then back: clearance must hold on the carved slopes.
  const start = await page.evaluate(() => window.__BIRB.birdPose());
  const trail = await ctx.hold({ x: 0, y: 1 }, 30,
    'const p = B.birdPose(); return p ? [p.aboveGround, p.recovery, ...p.position] : null;');
  const end = await page.evaluate(() => window.__BIRB.birdPose());
  const walked = arc(start.position, end.position);
  const clear = trail.filter(Boolean).map((s) => s[0]);
  const lo = Math.min(...clear); const hi = Math.max(...clear);
  ctx.log(`walked ${walked.toFixed(2)} units; clearance ${lo.toFixed(3)} .. ${hi.toFixed(3)}; states ${[...new Set(trail.filter(Boolean).map((s) => s[1]))].join('/')}`);
  ctx.check(walked > 0.8, `the bird walks on eroded ground (${walked.toFixed(2)} units)`);
  ctx.check(lo >= 0 && hi - lo < 1.0,
    `and stays on it: clearance ${lo.toFixed(3)} .. ${hi.toFixed(3)} (never under, never lifting off)`);
  await relaunch(ctx);
  await page.evaluate(() => window.__BIRB.setStick(0, 0));
}
