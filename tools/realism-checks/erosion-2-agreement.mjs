/**
 * The drawn ground and the flight floor still agree after the water cuts.
 *
 * The floor (and the landing check, and the walking pose) sample the terrain
 * ANALYTICALLY at the bird's own direction; the ground mesh samples it at its
 * vertices — 6.7 units apart on a phone — and draws straight lines between.
 * They never agreed exactly: the detail noise has features finer than the
 * mesh, and the bird's 0.6 clearance was always hiding that skim. A channel
 * narrower than the mesh would make it much worse, in the one direction that
 * matters — ground DRAWN ABOVE the floor, which the bird can sink into.
 *
 * So the measurement is paired, in one boot: the same 20,000 directions,
 * ray-cast against the real eroded triangles, and against the same mesh
 * re-displaced with the carve switched off (`control: true`). The erosion is
 * allowed to move the distribution by a small fraction of what the control
 * already is — and the bound is stated per biome, because the canyons' and
 * the mountain's own noise is rougher than the forest's.
 */
export const name = 'erosion-agreement';
export const query = 'erosion=1';

// Allowed growth over the control (units, and share of dry ground).
const LIMITS = Object.freeze({ p99: 0.25, p999: 0.6, max: 0.8, over06: 0.02 });

export default async function run(ctx) {
  const { page } = ctx;
  for (const env of ['forest', 'canyons', 'mountain']) {
    const r = await page.evaluate((id) => {
      const B = window.__BIRB;
      B.setEnvironment(id);
      const on = B.erosion({ samples: 20000, seed: 7 });
      const off = B.erosion({ samples: 20000, seed: 7, control: true });
      return { enabled: on.enabled, on: on.agreement, off: off.agreement };
    }, env);
    const { on, off } = r;
    ctx.check(r.enabled && on && off, `${env}: eroded and measured (${on?.samples} / ${off?.samples} dry samples)`);
    if (!on || !off) continue;
    const grow = {
      p99: +(on.p99 - off.p99).toFixed(3), p999: +(on.p999 - off.p999).toFixed(3),
      max: +(on.max - off.max).toFixed(3), over06: +(on.over06 - off.over06).toFixed(4),
    };
    ctx.log(`${env}: ground drawn above the floor — p99 ${off.p99} -> ${on.p99}, p999 ${off.p999} -> ${on.p999}, `
      + `max ${off.max} -> ${on.max}, >0.6: ${(100 * off.over06).toFixed(1)}% -> ${(100 * on.over06).toFixed(1)}%; `
      + `below it — p001 ${off.p001} -> ${on.p001}`);
    ctx.check(grow.p99 <= LIMITS.p99 && grow.p999 <= LIMITS.p999 && grow.max <= LIMITS.max && grow.over06 <= LIMITS.over06,
      `${env}: the carve moves the mesh-above-floor gap by p99 +${grow.p99}, p999 +${grow.p999}, max +${grow.max}, `
      + `share >0.6 +${(100 * grow.over06).toFixed(1)} points (limits ${LIMITS.p99} / ${LIMITS.p999} / ${LIMITS.max} / ${100 * LIMITS.over06})`);
    // And the other way: ground drawn BELOW the floor (a bird hovering).
    ctx.check(on.p001 >= off.p001 - 0.6,
      `${env}: the ground is not drawn much further BELOW the floor (p001 ${off.p001} -> ${on.p001})`);
  }
  await page.evaluate(() => window.__BIRB.setEnvironment('forest'));
  await ctx.frames(6);
}
