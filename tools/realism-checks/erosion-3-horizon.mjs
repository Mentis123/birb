/**
 * The horizon bake marched the ERODED ground, not the ground before it.
 *
 * horizon-map.js's bake runs in a worker, and a worker has its own copy of
 * every module — so if the terrain were sampled THERE, it would see a world
 * with no erosion in it (nothing sets the carve in the worker's module
 * instance) and the shadows would fall across valleys that are no longer
 * there. It is not sampled there: spherical-world.js fills the height grid on
 * the main thread, after the carve is active, and posts it. This proves it on
 * the bytes: at texels on the grid's coarse lattice (every third texel, where
 * fillHeightGrid samples exactly rather than interpolating) the grid the
 * bake was handed must equal the ERODED terrain to float precision, and
 * differ from the un-eroded terrain by the carve.
 */
export const name = 'erosion-horizon';
export const query = 'erosion=1';

export default async function run(ctx) {
  const { page } = ctx;
  await page.evaluate(() => window.__BIRB.setEnvironment('forest'));
  // Land the bake (frames, not milliseconds).
  let h = null;
  for (let k = 0; k < 120; k++) {
    h = await page.evaluate(() => window.__BIRB.horizon());
    if (!h?.enabled || h.landed) break;
    await ctx.frames(5);
  }
  ctx.check(!!h?.enabled && h.landed, `the horizon bake landed (${h?.result?.mode}, ${h?.result?.bakeMs} ms)`);

  const r = await page.evaluate(async () => {
    const { horizonTexelDirection, HORIZON_MAP_DEFAULTS } = await import('/src/environment/horizon-map.js');
    const { sampleTerrainMeshHeight } = await import('/src/environment/spherical-world.js');
    const B = window.__BIRB;
    const W = HORIZON_MAP_DEFAULTS.width; const H = HORIZON_MAP_DEFAULTS.height; const S = HORIZON_MAP_DEFAULTS.terrainStride;
    const d = { x: 0, y: 0, z: 0 };
    // Every lattice texel; keep the most-carved.
    const cand = [];
    for (let j = 0; j < H; j += S) {
      for (let i = 0; i < W; i += S) {
        horizonTexelDirection(i, j, W, H, d);
        const cut = -B.erosion({ agreement: false, at: [d.x, d.y, d.z] }).at.delta;
        if (cut > 1) cand.push({ i, j, cut, dir: [d.x, d.y, d.z] });
      }
    }
    cand.sort((a, b) => b.cut - a.cut);
    const top = cand.slice(0, 40);
    const grid = B.erosion({ agreement: false, texels: top.map((c) => [c.i, c.j]) }).horizonGrid;
    return top.map((c, k) => {
      const eroded = sampleTerrainMeshHeight(c.dir[0] * 120, c.dir[1] * 120, c.dir[2] * 120);
      return { i: c.i, j: c.j, cut: c.cut, grid: grid[k], eroded, uneroded: eroded + c.cut, lattice: cand.length };
    });
  });
  ctx.check(r.length >= 20, `found ${r.length} carved lattice texels (>1 unit) of the bake's grid (${r[0]?.lattice} carved in all)`);
  const f32 = (v) => Math.fround(v);
  const exact = r.filter((t) => t.grid !== null && Math.abs(t.grid - f32(t.eroded)) < 1e-4).length;
  const worstOld = Math.min(...r.map((t) => Math.abs(t.grid - t.uneroded)));
  ctx.log(`deepest texel: grid ${r[0]?.grid?.toFixed(3)} = eroded ${r[0]?.eroded?.toFixed(3)} (un-eroded ${r[0]?.uneroded?.toFixed(3)}, cut ${r[0]?.cut?.toFixed(2)})`);
  ctx.check(exact === r.length,
    `the bake's input equals the ERODED ground at every one of ${r.length} texels (${exact} exact to 1e-4)`);
  ctx.check(worstOld > 0.9,
    `and differs from the un-eroded ground at all of them by at least ${worstOld.toFixed(2)} units — it saw the carve`);
}
