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
  await relaunch(ctx);
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

/** A bird the landing check grounded stays grounded through every later
 *  restorePose, and forceGroundedPose then pins it (and a cockpit camera)
 *  to the ground: tap Fly, exactly as a player would. */
async function relaunch(ctx) {
  const was = await ctx.page.evaluate(() => {
    const p = window.__BIRB.birdPose();
    if (p?.recovery === 'grounded') document.querySelector('[data-flight-recovery]')?.click();
    return p?.recovery;
  });
  await ctx.frames(2);
  return was;
}

/**
 * The shortest distance up the sun ray from `p` (at least `t`) at which the
 * bird clears the ground UNDER ITSELF by `clearance`. The spot's own height is
 * not the question: 7 units up a 20-degree ray is 2.4 units above the spot and
 * 6.6 units across it, over ground that can easily be higher — and the
 * landing check grounds a bird within 0.6 of it (one run of this check did).
 */
async function clearRayDistance(ctx, p, sun, R, t, clearance) {
  return ctx.page.evaluate(async ({ p, sun, R, t, clearance }) => {
    const { sampleTerrainHeight } = await import('/src/environment/spherical-world.js');
    for (let s = t; s <= t * 2; s += 0.5) {
      const b = [p[0] + sun[0] * s, p[1] + sun[1] * s, p[2] + sun[2] * s];
      if (Math.hypot(b[0], b[1], b[2]) - (R + sampleTerrainHeight(b[0], b[1], b[2])) >= clearance) return s;
    }
    return null;
  }, { p, sun, R, t, clearance });
}

/**
 * The bird up the sun ray from a LIT open ground spot — `t` units, or further
 * if the ground under the bird needs it — facing away from the sun and
 * pitched nose-down so the chase camera sees the spot ahead. Verified FLYING
 * where it was put. Returns { spot, bird, px, birdPx, t } or null.
 */
export async function birdOverLitSpot(ctx, { t = 7, pitch = 0.9, minElevationDeg = 18, clearance = 2.5 } = {}) {
  await ctx.page.evaluate(() => window.__BIRB.setCameraView('chase'));
  await relaunch(ctx);
  for (const start of STARTS) {
    await placeHeld(ctx, norm(start).map((v) => v * 150), ctx.levelQuat(start));
    const spots = await ctx.page.evaluate((m) => window.__BIRB.horizonFind({ want: 'lit', minArc: 4, maxArc: 60, limit: 3, minElevationDeg: m, clearTexels: 4 }), minElevationDeg);
    for (const spot of spots) {
      const R = Math.hypot(...spot.position) - (spot.ground || 0);
      let bird = null; let dist = null;
      for (let k = 0; k < 4; k++) {
        const sun = (await ctx.page.evaluate(() => window.__BIRB.horizon())).sun;
        dist = await clearRayDistance(ctx, spot.position, sun, R, t, clearance);
        if (dist == null) break;
        const next = spot.position.map((v, i) => v + sun[i] * dist);
        const moved = bird ? Math.hypot(...next.map((v, i) => v - bird[i])) : Infinity;
        bird = next;
        const up = norm(bird);
        const away = norm(sun.map((v, i) => -(v - up[i] * dot(sun, up))));
        await placeHeld(ctx, bird, ctx.quatFromUpForward(up, away, pitch), 6);
        if (moved < 0.05) break;
      }
      if (dist == null || !bird) continue;
      const pose = await ctx.page.evaluate(() => window.__BIRB.birdPose());
      const off = pose ? Math.hypot(...pose.position.map((v, i) => v - bird[i])) : Infinity;
      if (pose?.recovery !== 'flying' || off > 0.05) { await relaunch(ctx); continue; }
      const still = await ctx.page.evaluate((dir) => window.__BIRB.horizonFind({ want: 'lit', dir, minArc: 0, maxArc: 1.6, limit: 1, clearTexels: 0 }), spot.dir);
      if (!still.length) continue;
      const px = await ctx.page.evaluate((p) => window.__BIRB.project(p[0], p[1], p[2]), spot.position);
      const birdPx = await ctx.page.evaluate((p) => window.__BIRB.project(p[0], p[1], p[2]), bird);
      if (px && birdPx && px[1] > 40 && px[1] < 800 && Math.hypot(px[0] - birdPx[0], px[1] - birdPx[1]) > 60) {
        return { spot, bird, px, birdPx, t: dist };
      }
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

const toLinear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function windowLum(png, cx, cy, half) {
  let s = 0; let n = 0;
  for (let y = cy - half; y <= cy + half; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      const i = (y * png.w + x) * png.ch;
      s += 0.2126 * toLinear(png.data[i]) + 0.7152 * toLinear(png.data[i + 1]) + 0.0722 * toLinear(png.data[i + 2]);
      n += 1;
    }
  }
  return s / n;
}

/**
 * The bird's shadow, measured where it actually LANDS. The spot is on the sun
 * ray through the bird's anchor; the body ellipsoid's centre sits a few
 * tenths of a unit off it and the rendered ground is a tessellation of the
 * sampled one, so a small fixed box at the spot measured the shadow's edge on
 * some boots (12.6% on one, 50% on another, same code). Four shots at
 * `values` (on, off, on, off), then the (2*half+1)^2 window, anywhere within
 * `search` px of `px`, that the first pair darkens most — read back in the
 * second pair as the control. Frames are held, so the control is exact.
 */
export async function darkestWindow(ctx, lever, values, px, { search = 24, half = 3, label = 'win' } = {}) {
  const shots = [];
  for (let n = 0; n < values.length; n++) {
    const v = values[n];
    await ctx.page.evaluate(({ lever, v }) => window.__BIRB[lever](v), { lever, v });
    await ctx.frames(3);
    shots.push(await ctx.shot(`${label}-${lever}-${v}-${n}`));
  }
  const [on1, off1, on2, off2] = shots;
  const x0 = Math.round(px[0]); const y0 = Math.round(px[1]);
  let best = null;
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      const cx = x0 + dx; const cy = y0 + dy;
      if (cx - half < 0 || cy - half < 0 || cx + half >= on1.w || cy + half >= on1.h) continue;
      const off = windowLum(off1, cx, cy, half);
      const on = windowLum(on1, cx, cy, half);
      const d = off > 0 ? 1 - on / off : 0;
      if (!best || d > best.darkening) best = { darkening: d, at: [cx, cy], on1: on, off1: off };
    }
  }
  if (!best) return null;
  best.on2 = windowLum(on2, best.at[0], best.at[1], half);
  best.off2 = windowLum(off2, best.at[0], best.at[1], half);
  return best;
}

/** Put every lever the checks touch back where the runner expects it. */
export async function restore(ctx) {
  await relaunch(ctx);
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
