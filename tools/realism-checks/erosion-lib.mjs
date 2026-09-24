/**
 * Shared by the erosion checks. No default export, so the runner loads it
 * and skips it; each check imports it, so the flag-on views and the
 * flag-off control are the SAME poses from the SAME code.
 *
 * Poses are ABSOLUTE (a direction and a radius), not "N above the ground":
 * the eroded ground is lower than the un-eroded one, and a camera placed
 * relative to it would photograph the two worlds from different heights —
 * a difference that is the camera's, not the terrain's.
 */

// Found once with __BIRB.erosion({ at }) on the forest bake: a trunk channel
// (wetness 0.94, cut 3.5 units) and a highland valley (cut 7.8). The terrain
// is deterministic (seeded noise, fixed valley and sea level), so these are
// the same ground on every boot; the PROPS need worldSeed.
export const CHANNEL = Object.freeze([-0.507, 0.5998, 0.619]);
export const HIGHLAND = Object.freeze([0.3723, 0.8908, -0.2603]);

// alt is above the BASE radius (120). The forest's clouds float 40-80 above
// their ground, so a top-down view photographs the ground alone (solo) and
// the full-scene view stays under the cloud deck.
export const ERODED_VIEWS = Object.freeze([
  { label: 'channel-top', u: CHANNEL, alt: 48, pitch: 1.45, solo: true },
  { label: 'channel-low', u: [-0.53, 0.6, 0.6], alt: 26, pitch: 0.55, solo: false },
  { label: 'highland-top', u: HIGHLAND, alt: 62, pitch: 1.2, solo: true },
]);

const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

/** The same props on every boot, the clock and sun held. */
export async function seededForest(ctx) {
  await ctx.page.evaluate(() => {
    const B = window.__BIRB;
    B.worldSeed(16160);
    B.setEnvironment('forest');
    B.pinTier(0);
    B.setSunTime(0);
    B.setSunEnabled(true);
  });
  await ctx.frames(3);
  await ctx.page.evaluate(() => window.__BIRB.setSunEnabled(false));
  await ctx.frames(2);
}

/** Cockpit camera at an absolute pose, clock held. */
export async function placeAbsolute(ctx, view) {
  const u = norm(view.u);
  const q = ctx.levelQuat(u, view.pitch);
  const pos = u.map((x) => x * (120 + view.alt));
  await ctx.page.evaluate(({ pos, q }) => {
    const B = window.__BIRB;
    B.setCameraView('fpv');
    B.hold(false);
    B.restorePose({ position: pos, quaternion: q });
    B.freeze(true);
    B.hold(true);
  }, { pos, q });
  await ctx.frames(8);
}

/** One PNG per view (the full scene, or the ground alone). */
export async function shootViews(ctx, views, tag) {
  const out = [];
  for (const v of views) {
    await placeAbsolute(ctx, v);
    if (v.solo) await ctx.page.evaluate(() => window.__BIRB.solo('sphere-ground'));
    await ctx.frames(3);
    const png = await ctx.shot(`${tag}-${v.label}`);
    if (v.solo) await ctx.page.evaluate(() => window.__BIRB.solo(null));
    out.push({ label: v.label, ok: png.w > 0 && png.h > 0, png });
  }
  return out;
}

/** Back to what the runner expects: chase camera, clock running, all visible. */
export async function restoreView(ctx) {
  await ctx.page.evaluate(() => {
    const B = window.__BIRB;
    B.solo(null);
    B.hold(false);
    B.freeze(false);
    B.setCameraView('chase');
    B.setSunEnabled(true);
  });
  await ctx.frames(4);
}

/** Tap Fly if a check left the bird on the ground (as a player would). */
export async function relaunch(ctx) {
  await ctx.page.evaluate(() => {
    const p = window.__BIRB.birdPose();
    if (p?.recovery === 'grounded') document.querySelector('[data-flight-recovery]')?.click();
  });
  await ctx.frames(3);
}

/**
 * Dry directions on the ACTIVE bake, ranked by a score over (wet, cut).
 * Deterministic: a fixed Fibonacci lattice, never Math.random.
 */
export async function findSpots(ctx, { n = 6000, limit = 8, by = 'wet' } = {}) {
  return ctx.page.evaluate(({ n, limit, by }) => {
    const B = window.__BIRB;
    const out = [];
    for (let i = 0; i < n; i++) {
      const z = 1 - 2 * (i + 0.5) / n; const r = Math.sqrt(1 - z * z); const a = i * 2.399963229728653;
      const d = [r * Math.cos(a), z, r * Math.sin(a)];
      const e = B.erosion({ agreement: false, at: d });
      if (!e.at) return [];
      out.push({ dir: d, wet: e.at.wet, cut: -e.at.delta });
    }
    out.sort((p, q) => (by === 'cut' ? q.cut - p.cut : (q.wet + 0.05 * q.cut) - (p.wet + 0.05 * p.cut)));
    return out.slice(0, limit);
  }, { n, limit, by });
}
