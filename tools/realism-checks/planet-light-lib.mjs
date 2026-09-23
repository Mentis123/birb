/**
 * Shared measurement for the planet-light checks. No default export, so the
 * runner loads it and skips it; the checks import it so a measurement and
 * its control are the SAME code, not two copies that drift.
 */

/** Put the sun at cycle time `t`: enable, set, let a frame apply it, freeze. */
export async function setSunTime(ctx, t) {
  await ctx.page.evaluate((s) => { const B = window.__BIRB; B.setSunTime(s); B.setSunEnabled(true); }, t);
  await ctx.frames(3);
  await ctx.page.evaluate(() => window.__BIRB.setSunEnabled(false));
  await ctx.frames(2);
}

export async function rigAt(ctx, U, above = 30) {
  await ctx.place({ U, above, settle: 6 });
  return ctx.page.evaluate(() => window.__BIRB.lightRig());
}

/**
 * The sky at ONE fixed local view direction, low sun (t=0) then high sun
 * (t=300). The view looks along the frame's North, 90 degrees off the sun's
 * azimuth at both times (sun-cycle.js puts t=0 at azimuth 0 and t=300 at PI),
 * so the disc and halo stay out of frame and the panorama in view is the
 * same pixels both times: whatever changes is the LIGHT, not the view.
 * Under ?planetsun=0 there is no local frame to face along; the world +Z
 * fallback is used, which is also perpendicular to both sun azimuths.
 *
 * Rendered SKY-ONLY (__BIRB.skyOnly: the camera sees just the dome's layer).
 * The runner's world is unseeded, so on some boots a tree or a cloud stands
 * in the band, its lighting changes with the sun, and the ?atmos=0 control
 * read -5.8% where it read 0.0% on another boot. A measurement of the sky
 * has to be of the sky alone.
 */
export async function skyAtFixedView(ctx, U, labelPrefix) {
  const shot = async (t, label) => {
    await setSunTime(ctx, t);
    const rig = await rigAt(ctx, U);
    const north = rig.planetSun ? rig.frame.north : [0, 0, 1];
    await ctx.place({ U, above: 30, settle: 10, quat: ctx.quatFromUpForward(U, north, -0.15) });
    await ctx.page.evaluate(() => window.__BIRB.skyOnly(true));
    await ctx.frames(3);
    const png = await ctx.shot(`${labelPrefix}-${label}`);
    await ctx.page.evaluate(() => window.__BIRB.skyOnly(false));
    await ctx.frames(1);
    // Left 60% only: the minimap is DOM, sits top right, and its drone
    // markers move between the two shots.
    return { lum: ctx.lum(png, 0.02, 0.28, { x0: 0, x1: 0.6 }), rig };
  };
  const low = await shot(0, 'low-sun');
  const high = await shot(300, 'high-sun');
  const change = (high.lum - low.lum) / Math.max(1, (high.lum + low.lum) / 2);
  return { low, high, change };
}

export const SPOTS = Object.freeze({
  north: [0.02, 1, 0.03],
  equator: [1, 0.02, 0.03],
  south: [0.03, -1, 0.02],
});

// sun-cycle.js SUN_CYCLE_DEFAULTS: minElevation 0.34, maxElevation 1.02 rad.
export const LOW_SUN_DEG = (0.34 * 180) / Math.PI;
export const HIGH_SUN_DEG = (1.02 * 180) / Math.PI;

export const lum3 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
