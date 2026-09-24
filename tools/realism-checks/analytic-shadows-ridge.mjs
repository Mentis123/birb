/**
 * A ridge shadows the valley beside it — at every preset, with no shadow map.
 *
 * Before this package (e252ca1) nothing in the world cast anything below
 * Ultra, and at Ultra only the ground received and only the bird and ~20
 * nest-host cones cast: a 40-unit ridge between a valley and a 20-degree sun
 * left the valley floor as bright as the ridge top.
 *
 * The spot is found, not guessed: __BIRB.horizonFind reads the BAKED map and
 * confirms the shadow by marching the analytic terrain alone toward the sun,
 * on open dry ground. The cockpit camera looks straight down at it from 14
 * units with the clock held, so the four shots below are the same pixels:
 * horizon on, off, on, off. The two ons and the two offs are the control.
 */
import { setSun, waitForBake, ridgeShadowView, abSeries, restore } from './analytic-shadows-lib.mjs';

export const name = 'analytic-shadows-ridge';

export default async function run(ctx) {
  const { page } = ctx;
  await page.evaluate(() => window.__BIRB.pinTier?.(0));
  // The air field's gusts sway the foliage wind, so two captures of one pose
  // differ (measured on the wave-2 tree: control pairs 0.0898/0.0901 and
  // 3626 px brightened, exact under ?air=0). Hold the gust's visuals.
  await page.evaluate(() => window.__BIRB.stillAir?.(true));
  const bake = await waitForBake(ctx);
  ctx.check(!!bake?.enabled && bake.landed && bake.ready >= 1,
    `the horizon map baked and faded in (${bake?.result?.mode}, ${bake?.result?.bakeMs} ms in the bake, `
    + `${bake?.stats?.fillMs} + ${bake?.stats?.splatMs} ms on the main thread, ${bake?.stats?.instances} props splatted)`);
  const patched = await page.evaluate(() => window.__BIRB.horizonPatched());
  ctx.check(patched > 5, `every opaque world material carries the patch (${patched} materials)`);
  ctx.check(bake?.sunLights >= 1 && bake?.index0IsSun,
    `the key light is matched as the sun and is directionalLights[0] (${JSON.stringify(bake?.lights?.map((l) => `${l.name}:${l.sun}`))})`);

  await setSun(ctx, 0);   // the lowest sun of the cycle
  const view = await ridgeShadowView(ctx);
  ctx.check(!!view, view
    ? `found open ground in a ridge's shadow: sun ${view.spot.sunElevationDeg} deg under a ${view.spot.terrainHorizonDeg} deg skyline, ${view.spot.arc} units out`
    : 'found open ground in a ridge\'s shadow near any start');
  if (view) {
    const [on1, off1, on2, off2] = await abSeries(ctx, 'horizon', [1, 0, 1, 0], view.px, 30, 'ridge');
    const noise = Math.max(Math.abs(on1 - on2), Math.abs(off1 - off2));
    ctx.check(noise <= 0.002 * Math.max(off1, off2),
      `the control pairs agree (on ${on1.toFixed(4)} / ${on2.toFixed(4)}, off ${off1.toFixed(4)} / ${off2.toFixed(4)})`);
    const darkening = 1 - on1 / off1;
    ctx.check(darkening > 0.15,
      `the ridge's shadow darkens the patch ${(darkening * 100).toFixed(1)}% (linear ${off1.toFixed(4)} -> ${on1.toFixed(4)})`);

    // A shadow only takes light away: no pixel of the frame brightens.
    await page.evaluate(() => window.__BIRB.horizon(1));
    await ctx.frames(3);
    const a = await ctx.shot('ridge-full-on');
    await page.evaluate(() => window.__BIRB.horizon(0));
    await ctx.frames(3);
    const b = await ctx.shot('ridge-full-off');
    let brighter = 0; let n = 0;
    for (let y = 0; y < a.h; y += 2) {
      for (let x = 0; x < a.w; x += 2) {
        // The DOM overlays (minimap top right, buttons bottom right) are
        // composited over the canvas and are not the world's light.
        if ((y < 150 && x > a.w - 150) || (y > a.h - 90 && x > a.w - 170)) continue;
        const i = (y * a.w + x) * a.ch;
        const la = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
        const lb = 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2];
        if (la > lb + 2) brighter += 1;
        n += 1;
      }
    }
    ctx.check(brighter <= n * 0.001, `turning the horizon on brightens no pixel (${brighter} of ${n})`);
  }
  await restore(ctx);
  await page.evaluate(() => window.__BIRB.stillAir?.(false));
}
