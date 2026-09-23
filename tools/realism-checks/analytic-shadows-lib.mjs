/**
 * Shared measurement for the analytic-shadows checks. No default export, so
 * the runner loads it and skips it; each check imports it, so a measurement
 * and its control are the SAME code.
 *
 * Two things make these frames exact rather than approximately repeatable:
 *
 *  - __BIRB.hold(true) stops the simulation clock (frame delta 0) while
 *    rendering continues, and snaps the chase camera onto the held pose.
 *    freeze() alone zeroes the speed but the controller keeps flying the bird
 *    on (measured ~0.45 units a frame under SwiftShader), and a cockpit
 *    camera drifts off its target within a few frames.
 *  - The spot is FOUND, not hoped for: __BIRB.horizonFind reads the baked map
 *    and confirms a ridge shadow by marching the terrain alone, on open, dry
 *    ground (no prop within ~9 units, no lake). The world's props are
 *    unseeded, so a fixed coordinate would be a tree on some boots.
 *
 * The sun is re-read after every move: under the planet-light package the
 * sun is defined in the BIRD's own horizon frame, so moving the camera moves
 * the sun. Every placement converges before anything is measured.
 */

const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Starting directions, tried in order: near the +Y pole where the base's
// world-fixed sun is lowest over the local horizon, then round the valley.
export const STARTS = Object.freeze([
  [0.05, 1, 0.3], [0.3, 0.9, -0.2], [-0.3, 0.9, 0.2], [0.6, 0.6, 0.5], [-0.5, 0.7, -0.4],
]);

/** Sun at cycle time `t`, then the clock stopped. */
export async function setSun(ctx, t = 0) {
  await ctx.page.evaluate((s) => { const B = window.__BIRB; B.setSunTime(s); B.setSunEnabled(true); }, t);
  await ctx.frames(3);
  await ctx.page.evaluate(() => window.__BIRB.setSunEnabled(false));
  await ctx.frames(2);
}

/** Wait (in frames) for the horizon bake to land and fade in. */
export async function waitForBake(ctx, maxFrames = 400) {
  let h = null;
  for (let n = 0; n < maxFrames; n += 5) {
    h = await ctx.page.evaluate(() => window.__BIRB.horizon());
    if (!h || !h.enabled || (h.landed && h.ready >= 1)) return h;
    await ctx.frames(5);
  }
  return h;
}

async function placeHeld(ctx, position, quaternion, settle = 4) {
  await ctx.page.evaluate(({ position, quaternion }) => {
    const B = window.__BIRB;
    B.hold(false);
    B.restorePose({ position, quaternion });
    B.freeze(true);
    B.hold(true);
  }, { position, quaternion });
  await ctx.frames(settle);
}

/** Bird (camera, in cockpit view) `height` above `spot`, looking straight down. */
async function lookDownAt(ctx, spot, height) {
  const up = norm(spot.position);
  const r = Math.hypot(...spot.position) + height;
  await placeHeld(ctx, up.map((v) => v * r), ctx.levelQuat(up, 1.45));
}

/**
 * A ground patch in a RIDGE's shadow (want 'shadow') — or in a PROP's, where
 * the terrain alone would light it (want 'canopy') — for the current sun,
 * with the cockpit camera 14 units above it looking down. { spot, px } | null.
 */
export async function ridgeShadowView(ctx, { minElevationDeg = 15, want = 'shadow', clearTexels = 6 } = {}) {
  await ctx.page.evaluate(() => window.__BIRB.setCameraView('fpv'));
  for (const start of STARTS) {
    await placeHeld(ctx, norm(start).map((v) => v * 150), ctx.levelQuat(start));
    let spots = await ctx.page.evaluate((o) => window.__BIRB.horizonFind({ minArc: 0, maxArc: 70, limit: 4, ...o }), { minElevationDeg, want, clearTexels });
    if (!spots.length) continue;
    let spot = spots[0];
    // Converge: move over it, re-read the (possibly bird-relative) sun, and
    // re-find within a texel or so of where the camera now looks.
    for (let k = 0; k < 4 && spot; k++) {
      await lookDownAt(ctx, spot, 14);
      spots = await ctx.page.evaluate((o) => window.__BIRB.horizonFind({ minArc: 0, maxArc: 2.5, limit: 1, ...o }), { dir: spot.dir, minElevationDeg, want, clearTexels });
      if (spots.length && Math.acos(Math.min(1, dot(spots[0].dir, spot.dir))) * 120 < 0.8) {
        spot = spots[0];
        const px = await ctx.page.evaluate((p) => window.__BIRB.project(p[0], p[1], p[2]), spot.position);
        if (px) return { spot, px };
      }
      spot = spots[0] || null;
    }
  }
  return null;
}

/**
 * The bird `t` units up the sun ray from a LIT open ground spot, facing away
 * from the sun and pitched nose-down so the chase camera sees the spot ahead.
 * Returns { spot, bird, px, birdPx } or null.
 */
export async function birdOverLitSpot(ctx, { t = 7, pitch = 0.9, minElevationDeg = 18 } = {}) {
  await ctx.page.evaluate(() => window.__BIRB.setCameraView('chase'));
  for (const start of STARTS) {
    await placeHeld(ctx, norm(start).map((v) => v * 150), ctx.levelQuat(start));
    const spots = await ctx.page.evaluate((m) => window.__BIRB.horizonFind({ want: 'lit', minArc: 4, maxArc: 60, limit: 3, minElevationDeg: m, clearTexels: 4 }), minElevationDeg);
    if (!spots.length) continue;
    const spot = spots[0];
    let bird = null;
    for (let k = 0; k < 4; k++) {
      const sun = (await ctx.page.evaluate(() => window.__BIRB.horizon())).sun;
      const next = spot.position.map((v, i) => v + sun[i] * t);
      const moved = bird ? Math.hypot(...next.map((v, i) => v - bird[i])) : Infinity;
      bird = next;
      const up = norm(bird);
      const away = norm(sun.map((v, i) => -(v - up[i] * dot(sun, up))));
      await placeHeld(ctx, bird, ctx.quatFromUpForward(up, away, pitch), 6);
      if (moved < 0.05) break;
    }
    const still = await ctx.page.evaluate((dir) => window.__BIRB.horizonFind({ want: 'lit', dir, minArc: 0, maxArc: 1.6, limit: 1, clearTexels: 0 }), spot.dir);
    if (!still.length) continue;
    const px = await ctx.page.evaluate((p) => window.__BIRB.project(p[0], p[1], p[2]), spot.position);
    const birdPx = await ctx.page.evaluate((p) => window.__BIRB.project(p[0], p[1], p[2]), bird);
    if (px && birdPx && px[1] > 40 && px[1] < 800 && Math.hypot(px[0] - birdPx[0], px[1] - birdPx[1]) > 60) {
      return { spot, bird, px, birdPx };
    }
  }
  return null;
}

/** Linear mean luminance of a (2r+1)^2-pixel box around px. */
export function boxLum(ctx, png, px, r) {
  return ctx.lum(png, (px[1] - r) / png.h, (px[1] + r) / png.h, {
    linear: true, x0: (px[0] - r) / png.w, x1: (px[0] + r) / png.w,
  });
}

/** Four shots at `values` of a runtime lever, measured in one box. */
export async function abSeries(ctx, lever, values, px, r, label) {
  const out = [];
  for (let n = 0; n < values.length; n++) {
    const v = values[n];
    await ctx.page.evaluate(({ lever, v }) => window.__BIRB[lever](v), { lever, v });
    await ctx.frames(3);
    const png = await ctx.shot(`${label}-${lever}-${v}-${n}`);
    out.push(boxLum(ctx, png, px, r));
  }
  return out;
}

/** Put every lever the checks touch back where the runner expects it. */
export async function restore(ctx) {
  await ctx.page.evaluate(() => {
    const B = window.__BIRB;
    B.hold(false);
    B.horizon?.(1);
    B.birdShadow?.(1);
    B.setShadows?.({ enabled: false });
    B.setCameraView?.('chase');
    B.setSunEnabled(true);
    B.freeze(false);
  });
  await ctx.frames(4);
}
