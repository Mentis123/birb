/**
 * Review of ?erosion=1 (G-REALISM-EROSION, "Review"): the two things the
 * builder's own checks averaged away or never compared.
 *
 * 1. WHERE THE WATER CUT, not over the whole planet. erosion-agreement
 *    samples 20,000 directions over all dry ground, two thirds of which the
 *    carve barely touches, so its p99 is mostly the un-eroded hillside. Here
 *    the same exact ray-cast is restricted to directions the carve lowered by
 *    more than 1 (and 3) units, against the same directions un-eroded — the
 *    question "does the bird sink into a channel wall" asked where the
 *    channels are.
 * 2. THE WORKER AND THE MAIN THREAD BAKE THE SAME GROUND. Which of the two a
 *    biome's bake came from is a race against the page's own boot, so two
 *    sessions can get different paths for the same biome: if the paths
 *    differed by a bit, the same seed would be two different worlds. A biome
 *    that landed from the worker is compared, at every sample, with a fresh
 *    main-thread bake of the same biome in the same page.
 */
export const name = 'erosion-review';
export const query = 'erosion=1';

const quant = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN);

export default async function run(ctx) {
  const { page } = ctx;

  // Let the prefetch land first (frames, not milliseconds).
  for (let k = 0; k < 200; k++) {
    const pf = await page.evaluate(() => window.__BIRB.erosion({ agreement: false }).prefetch);
    if (!pf || !pf.running) break;
    await ctx.frames(5);
  }

  for (const env of ['forest', 'canyons', 'mountain']) {
    const r = await page.evaluate(async (id) => {
      const B = window.__BIRB;
      B.setEnvironment(id);
      const { sampleTerrainHeight, sampleTerrainMeshHeight, bakeErosionForVariant } = await import('/src/environment/spherical-world.js');
      const e0 = B.erosion({ agreement: false });
      // Carved dry directions on a Fibonacci lattice.
      const N = 60000; const dirs = []; const cuts = [];
      let maxDiffDelta = 0; let maxDiffWet = 0; let compared = 0;
      const fresh = bakeErosionForVariant(id).field;
      for (let i = 0; i < N; i++) {
        const z = 1 - 2 * (i + 0.5) / N; const rr = Math.sqrt(1 - z * z); const a = i * 2.399963229728653;
        const d = [rr * Math.cos(a), z, rr * Math.sin(a)];
        const at = B.erosion({ agreement: false, at: d }).at;
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        // Worker (or cached) field against a fresh main-thread bake.
        if (i % 1 === 0) {
          compared++;
          maxDiffDelta = Math.max(maxDiffDelta, Math.abs(at.delta - fresh.delta(d[0] / l, d[1] / l, d[2] / l)));
          maxDiffWet = Math.max(maxDiffWet, Math.abs(at.wet - fresh.wet(d[0] / l, d[1] / l, d[2] / l)));
        }
        const cut = -at.delta;
        if (cut <= 1) continue;
        const floor = sampleTerrainHeight(d[0] * 130, d[1] * 130, d[2] * 130);
        const mesh = sampleTerrainMeshHeight(d[0] * 130, d[1] * 130, d[2] * 130);
        if (floor !== mesh) continue;   // under water: the floor is the lake surface
        dirs.push(d); cuts.push(cut);
      }
      const on = B.erosion({ samples: dirs }).agreement;
      const off = B.erosion({ samples: dirs, control: true }).agreement;
      const gapsOn1 = []; const gapsOff1 = []; const gapsOn3 = []; const gapsOff3 = [];
      for (let k = 0; k < dirs.length; k++) {
        const a = on[k]; const b = off[k];
        if (!Number.isFinite(a.mesh) || !Number.isFinite(b.mesh)) continue;
        gapsOn1.push(a.mesh - a.floor); gapsOff1.push(b.mesh - b.floor);
        if (cuts[k] > 3) { gapsOn3.push(a.mesh - a.floor); gapsOff3.push(b.mesh - b.floor); }
      }
      return {
        source: e0.stats?.source, cached: e0.cached, compared, maxDiffDelta, maxDiffWet,
        gapsOn1, gapsOff1, gapsOn3, gapsOff3,
      };
    }, env);
    ctx.check(r.compared > 5000 && r.maxDiffDelta === 0 && r.maxDiffWet === 0,
      `${env}: the ${r.source} bake the world uses equals a fresh main-thread bake exactly at ${r.compared} directions `
      + `(max |d delta| ${r.maxDiffDelta}, |d wet| ${r.maxDiffWet})`);
    const sum = (a) => {
      const s = [...a].sort((p, q) => p - q);
      return {
        n: s.length, p50: +quant(s, 0.5).toFixed(3), p99: +quant(s, 0.99).toFixed(3), max: +(s[s.length - 1] ?? NaN).toFixed(3),
        over06: +(s.filter((g) => g > 0.6).length / (s.length || 1)).toFixed(4),
      };
    };
    const on1 = sum(r.gapsOn1); const off1 = sum(r.gapsOff1); const on3 = sum(r.gapsOn3); const off3 = sum(r.gapsOff3);
    ctx.log(`${env}: carved > 1 unit (${on1.n} dirs): ground drawn above the floor p50 ${off1.p50} -> ${on1.p50}, `
      + `p99 ${off1.p99} -> ${on1.p99}, max ${off1.max} -> ${on1.max}, >0.6 ${(100 * off1.over06).toFixed(1)}% -> ${(100 * on1.over06).toFixed(1)}%`);
    ctx.log(`${env}: carved > 3 units (${on3.n} dirs): p50 ${off3.p50} -> ${on3.p50}, p99 ${off3.p99} -> ${on3.p99}, `
      + `max ${off3.max} -> ${on3.max}, >0.6 ${(100 * off3.over06).toFixed(1)}% -> ${(100 * on3.over06).toFixed(1)}%`);
    // Where the water cut, the drawn ground must not stand above the floor
    // (the direction the bird sinks into) much more than the hillside that was
    // there did: same bounds erosion-agreement applies planet-wide.
    ctx.check(on1.n > 500 && on1.p99 - off1.p99 <= 0.25 && on1.max - off1.max <= 0.8 && on1.over06 - off1.over06 <= 0.05,
      `${env}: in the carved ground the mesh-above-floor gap moves p99 ${(on1.p99 - off1.p99).toFixed(3)}, `
      + `max ${(on1.max - off1.max).toFixed(3)}, share >0.6 ${(100 * (on1.over06 - off1.over06)).toFixed(1)} points`);
  }
  // 3. AT THE MESH'S OWN VERTICES the floor carries exactly the field's carve
  //    (so reading the carve through the mesh moved no vertex), and the floor
  //    equals the drawn ground there.
  const vx = await page.evaluate(async () => {
    const B = window.__BIRB;
    const { sampleBasinHeight } = await import('/src/environment/spherical-world.js');
    B.setEnvironment('forest');
    const seg = B.erosion({ samples: 200 }).agreement?.segments;
    if (!seg) return null;
    const [W, H] = seg;
    const dirs = [];
    for (let iy = 3; iy < H - 3; iy += 2) {
      for (let ix = 0; ix < W; ix += 3) {
        const p = (ix / W) * Math.PI * 2; const t = (iy / H) * Math.PI;
        dirs.push([-Math.cos(p) * Math.sin(t), Math.cos(t), Math.sin(p) * Math.sin(t)]);
      }
    }
    const on = B.erosion({ samples: dirs }).agreement;
    const off = B.erosion({ samples: dirs, control: true }).agreement;
    const level = B.water().level;
    let n = 0; let carveErr = 0; let meshErr = 0; let meshN = 0;
    for (let k = 0; k < dirs.length; k++) {
      const delta = B.erosion({ agreement: false, at: dirs[k] }).at.delta;
      if (delta > -0.05) continue;                         // carved vertices only
      // Dry ground outside every basin: on the water sheet the floor is the
      // lake surface, and inside a basin the lake-bed planing (a smoothstep
      // on h) is not additive in the carve by design.
      const d = dirs[k];
      if (level < 0 && (on[k].floor <= level + 1e-9 || sampleBasinHeight(d[0] * 130, d[1] * 130, d[2] * 130) < level)) continue;
      const err = Math.abs((on[k].floor - off[k].floor) - delta);
      n++; carveErr = Math.max(carveErr, err);
      if (Number.isFinite(on[k].mesh)) { meshN++; meshErr = Math.max(meshErr, Math.abs(on[k].mesh - on[k].floor)); }
    }
    return { W, H, n, carveErr, meshN, meshErr };
  });
  ctx.check(!!vx && vx.n > 200 && vx.carveErr < 1e-4,
    `at ${vx?.n} carved vertices of the ${vx?.W}x${vx?.H} ground mesh the floor carries exactly the field's carve (max error ${vx?.carveErr?.toExponential(2)})`);
  ctx.check(!!vx && vx.meshN > 200 && vx.meshErr < 1e-3,
    `and the floor equals the drawn ground there (${vx?.meshN} ray-cast, max |mesh - floor| ${vx?.meshErr?.toExponential(2)})`);
  await ctx.frames(6);
}
