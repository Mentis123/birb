/**
 * ?erosion=1 bakes, carves only down, and what it costs the world build.
 *
 * The bake is synchronous at world build (the build is, and everything in it
 * samples the terrain), so its cost is reported the only honest way: what
 * THIS build spent, beside what the same build costs with the bake already
 * cached — measured in one boot, so load on the box moves both.
 *
 * With the flag on, spherical-world.js starts a module worker when it LOADS
 * that bakes every eroded biome into a cache; a build that finds its biome
 * there spends nothing on erosion, and one that gets there first bakes on the
 * main thread (the fallback) — which of the two the first forest build was is
 * a race against the page's own boot, so it is reported, not asserted.
 * The city has no erosion profile: its ground is a street grid.
 */
import { relaunch } from './erosion-lib.mjs';

export const name = 'erosion-bake';
export const query = 'erosion=1';

export default async function run(ctx) {
  const { page } = ctx;
  const first = await page.evaluate(() => window.__BIRB.erosion({ agreement: false }));
  ctx.check(first.enabled && first.env === 'spherical-world-forest',
    `the forest boots eroded (${first.env}, enabled ${first.enabled})`);
  const s = first.stats || {};
  ctx.log(`forest bake: ${first.ms} ms in the world build (${s.source}); sample ${s.sampleMs?.toFixed(0)} + route `
    + `${s.routeMs?.toFixed(0)} + law ${s.lawMs?.toFixed(0)} + valley ${s.flankMs?.toFixed(0)} ms; `
    + `${s.nodes} nodes, ${s.routes} routings, ${s.outlets} lake nodes`);
  ctx.check(s.placed === s.nodes && s.nodes === 6 * 64 * 64 + 2,
    `every node of the 6x64x64 cube sphere is in the drainage stack (${s.placed} of ${s.nodes})`);
  ctx.check(s.outlets > 100 && s.maxCarve > 2 && s.maxCarve < 30 && s.carvedShare > 0.05 && s.carvedShare < 0.9,
    `the water cut the forest: deepest ${s.maxCarve?.toFixed(2)} units, ${(100 * s.carvedShare).toFixed(0)}% of nodes lowered, `
    + `drained to ${s.outlets} lake nodes`);
  ctx.check(first.wetTexture === true, 'the ground carries the wetness map');

  // Carve-down only, on the live world: the bake's delta and the terrain the
  // floor reads, over a lattice of the whole planet.
  const cd = await page.evaluate(async () => {
    const { sampleTerrainHeight, sampleTerrainMeshHeight } = await import('/src/environment/spherical-world.js');
    const B = window.__BIRB;
    let maxDelta = -Infinity; let maxH = -Infinity; let nanCount = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const z = 1 - 2 * (i + 0.5) / N; const r = Math.sqrt(1 - z * z); const a = i * 2.399963229728653;
      const d = [r * Math.cos(a), z, r * Math.sin(a)];
      const e = B.erosion({ agreement: false, at: d }).at;
      const h = sampleTerrainMeshHeight(d[0] * 120, d[1] * 120, d[2] * 120);
      const f = sampleTerrainHeight(d[0] * 120, d[1] * 120, d[2] * 120);
      if (!Number.isFinite(e.delta) || !Number.isFinite(h) || !Number.isFinite(f)) nanCount++;
      maxDelta = Math.max(maxDelta, e.delta);
      maxH = Math.max(maxH, h, f);
    }
    return { maxDelta, maxH, nanCount, N };
  });
  ctx.check(cd.maxDelta <= 0 && cd.maxH <= 0 && cd.nanCount === 0,
    `carve-down only on the live world: max delta ${cd.maxDelta}, max ground/floor ${cd.maxH.toFixed(4)} (<= 0), `
    + `${cd.nanCount} non-finite of ${cd.N}`);

  // The prefetch: wait (in frames) for the worker to land the other biomes.
  let pf = null;
  for (let k = 0; k < 160; k++) {
    pf = await page.evaluate(() => window.__BIRB.erosion({ agreement: false }).prefetch);
    if (!pf || !pf.running) break;
    await ctx.frames(5);
  }
  ctx.log(`prefetch: ${JSON.stringify(pf)}`);
  ctx.check(!!pf && !pf.failed && pf.landed.length === pf.wanted.length,
    `the worker baked the eroded biomes off the main thread (${pf?.landed?.join(', ') || 'none'}${pf?.failed ? `; failed: ${pf.failed}` : ''})`);

  // The fallback, timed on its own: the same bake the build runs when the
  // worker has not landed, on this page's main thread, twice. A page whose
  // bakes all came from the worker has never built the node graph, so the
  // first of the two pays for that as well — as a real fallback would.
  const fallback = await page.evaluate(async () => {
    const { bakeErosionForVariant } = await import('/src/environment/spherical-world.js');
    const out = [];
    for (let k = 0; k < 2; k++) {
      const t0 = performance.now();
      const r = bakeErosionForVariant('forest');
      out.push({ ms: +(performance.now() - t0).toFixed(0), sample: +r.stats.sampleMs.toFixed(0),
        route: +r.stats.routeMs.toFixed(0), law: +r.stats.lawMs.toFixed(0), valley: +r.stats.flankMs.toFixed(0) });
    }
    return out;
  });
  ctx.log(`main-thread fallback bake, forest, timed twice in this boot (the first builds the grid too): `
    + `${fallback.map((f) => `${f.ms} ms (sample ${f.sample} + route ${f.route} + law ${f.law} + valley ${f.valley})`).join('; ')}`);

  // Switch through every biome and back, timing each world build.
  const builds = [];
  for (const id of ['canyons', 'mountain', 'city', 'forest']) {
    const b = await page.evaluate((env) => {
      const B = window.__BIRB;
      const t0 = performance.now();
      const ok = B.setEnvironment(env);
      const buildMs = performance.now() - t0;
      const e = B.erosion({ agreement: false });
      return { env, ok, buildMs: +buildMs.toFixed(0), enabled: e.enabled, erosionMs: e.ms, cached: e.cached,
        source: e.stats?.source ?? null, workerMs: e.stats?.workerMs ? +e.stats.workerMs.toFixed(0) : null,
        maxCarve: e.stats ? +e.stats.maxCarve.toFixed(2) : null };
    }, id);
    builds.push(b);
    ctx.log(JSON.stringify(b));
    await ctx.frames(6);
  }
  const byEnv = Object.fromEntries(builds.map((b) => [b.env, b]));
  ctx.check(byEnv.canyons.enabled && byEnv.mountain.enabled && byEnv.canyons.maxCarve > 2 && byEnv.mountain.maxCarve > 2,
    `canyons and mountain erode (deepest cut ${byEnv.canyons.maxCarve} / ${byEnv.mountain.maxCarve} units)`);
  ctx.check(byEnv.city.ok && byEnv.city.enabled === false, 'the city builds and is NOT eroded (no profile: its ground is a street grid)');
  ctx.check(byEnv.forest.cached && byEnv.forest.erosionMs < 5,
    `a second visit bakes nothing: forest ${byEnv.forest.erosionMs} ms of erosion in a ${byEnv.forest.buildMs} ms build`);
  const prefetched = ['canyons', 'mountain'].filter((env) => byEnv[env].source === 'worker');
  ctx.check(prefetched.every((env) => byEnv[env].erosionMs < 5),
    `a prefetched biome costs the switch nothing (${prefetched.map((env) => `${env} ${byEnv[env].erosionMs} ms`).join(', ') || 'none prefetched'})`);
  ctx.log(`first-visit cost on the main thread: forest ${first.ms} ms (${s.source === 'worker'
    ? 'the module-load prefetch landed before the first build' : 'baked on the main thread: the prefetch had not landed'}; `
    + `the world build around it: ${byEnv.forest.buildMs} ms cached); worker bakes: forest ${s.workerMs ? s.workerMs.toFixed(0) : '-'} ms, `
    + `canyons ${byEnv.canyons.workerMs} ms, mountain ${byEnv.mountain.workerMs} ms`);
  await relaunch(ctx);
}
