/**
 * Stream-power erosion (src/environment/erosion.js), on synthetic planets.
 *
 * What each of these pins, and why it is here rather than being obvious:
 *
 *  - CARVE-DOWN ONLY. The terrain doubles as the flight floor of a bird with
 *    no gravity, and a floor that rises above where it was ratchets the bird
 *    upward forever (CLAUDE.md, "Fly-INTO-valleys"). `delta <= 0` at every
 *    node, on every terrain, is the whole safety case.
 *  - Deterministic. The bake runs at world build on the main thread AND in a
 *    prefetch worker, and the two must hand back the same bytes.
 *  - Water runs downhill and gathers: drainage area strictly grows along
 *    every receiver link, every node is placed in the stack, and nothing but
 *    a lake is a pit (the flood's whole job).
 *  - The network is a NETWORK: a noisy cone erodes into many channels that
 *    join, with the cut concentrated in them and the hillslopes between
 *    left alone — not a uniform lowering, and not noise.
 *  - The sampler is continuous across cube faces and at cube corners, and
 *    allocates nothing (it runs inside the flight floor, several times a
 *    frame).
 *  - Sea level is a base level: nothing is cut below the lake surface that
 *    was not already there, which is what keeps the water sheet, the floor
 *    and the mesh agreeing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';

import {
  EROSION_PROFILES, erosionRequested, getCubeSphereGrid, erodeTerrain,
  faceValuesOf, sampleCubeField, createErosionField, erosionFieldFromFaces, bakeWetnessEquirect,
} from '../src/environment/erosion.js';
import { horizonTexelDirection } from '../src/environment/horizon-map.js';
import { bootFlagByKey, readBootFlag, withBootFlag } from '../src/ui/boot-flags.js';
import { addGroundDetail } from '../src/environment/ground-detail.js';

const R = 120;

// A small deterministic value noise on the sphere (no Math.random anywhere:
// the tests are as reproducible as the module).
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x, y, z) {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const fx = x - xi; const fy = y - yi; const fz = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(fx); const v = s(fy); const w = s(fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
const noiseAt = (x, y, z, f) => valueNoise(x * f + 11.3, y * f - 4.1, z * f + 7.7);

// A cone: a peak at +Y falling 40 units to a ring of "sea" beyond 70 degrees,
// its flanks roughened so the water has to choose.
const CONE_LEVEL = -40;
function cone(x, y, z) {
  const ang = Math.acos(Math.max(-1, Math.min(1, y)));
  const rough = noiseAt(x, y, z, 9) * 1.6 + noiseAt(x, y, z, 23) * 0.6;
  return Math.min(0, -ang * 32 + rough);
}
const coneOutlet = (x, y, z) => cone(x, y, z) < CONE_LEVEL;
const CONE_PROFILE = Object.freeze({
  iterations: 24, routeEvery: 5, k: 0.1, m: 0.5, slope: 0.08, refArea: 1000,
  areaCrit: 30, groove: 1.0, flank: 4, smooth: 1, margin: 0.4, wetArea: [100, 2000],
});

// A world like this game's: rolling noise, everything <= 0, lakes under -14.
const NOISE_LEVEL = -14;
function noiseWorld(x, y, z) {
  return Math.min(0, -8 + noiseAt(x, y, z, 3) * 9 + noiseAt(x, y, z, 8) * 4 + noiseAt(x, y, z, 20) * 1.5);
}
const noiseOutlet = (x, y, z) => noiseWorld(x, y, z) < NOISE_LEVEL;

function bake(heightAt, outletAt, level, profile = CONE_PROFILE, n = 32, extra = {}) {
  return erodeTerrain({
    grid: getCubeSphereGrid(n), heightAt, outletAt, baseLevel: level, radius: R, profile, ...extra,
  });
}

// ── the flag ─────────────────────────────────────────────────────────────
test('?erosion=1 is opt-in and the Flags tab offers it as Off / On', () => {
  assert.equal(erosionRequested(''), false);
  assert.equal(erosionRequested('?debug=1'), false);
  assert.equal(erosionRequested('?erosion=1'), true);
  assert.equal(erosionRequested('?debug=1&erosion=1'), true);
  assert.equal(erosionRequested('?erosion=0'), false);
  assert.equal(erosionRequested('?erosion=10'), false, 'not fooled by a longer value');
  assert.equal(erosionRequested('?noerosion=1'), false, 'not fooled by a longer key');
  const flag = bootFlagByKey('erosion');
  assert.ok(flag, 'no Flags-tab entry for ?erosion');
  assert.equal(flag.kind, 'select');
  assert.deepEqual(flag.options.map((o) => o.value), [null, '1']);
  assert.deepEqual(readBootFlag('', 'erosion'), { value: null });
  assert.deepEqual(readBootFlag('?erosion=1', 'erosion'), { value: '1' });
  // What the panel navigates to is exactly what the game's regex reads.
  assert.equal(erosionRequested('?' + withBootFlag('?debug=1', 'erosion', '1')), true);
  assert.equal(erosionRequested('?' + withBootFlag('?debug=1&erosion=1', 'erosion', null)), false);
});

test('every biome profile is complete, and the city is deliberately not eroded', () => {
  assert.equal(EROSION_PROFILES.city, null);
  for (const biome of ['forest', 'canyons', 'mountain']) {
    const p = EROSION_PROFILES[biome];
    assert.ok(p, `${biome} has a profile`);
    for (const key of ['n', 'iterations', 'k', 'm', 'slope', 'refArea', 'areaCrit', 'groove', 'flank',
      'smooth', 'margin', 'wetArea', 'wetTint', 'wetDamp', 'wetStrength', 'wetCore']) {
      assert.ok(p[key] !== undefined, `${biome}.${key}`);
    }
    assert.ok(p.margin > 0, `${biome}: channels stop ABOVE the lake surface`);
    assert.ok(p.wetArea[1] > p.wetArea[0], `${biome}: wetArea rises`);
    assert.ok(p.wetCore[1] > p.wetCore[0], `${biome}: the stream core has a width`);
  }
});

// ── the grid ─────────────────────────────────────────────────────────────
test('the cube-sphere grid: 6n^2+2 unit nodes, shared edges and corners, symmetric links, 4 PI of area', () => {
  for (const n of [4, 16, 64]) {
    const g = getCubeSphereGrid(n);
    assert.equal(g.count, 6 * n * n + 2);
    assert.equal(getCubeSphereGrid(n), g, 'cached per n');
    let solid = 0; let corners = 0;
    for (let i = 0; i < g.count; i++) {
      const l = Math.hypot(g.dir[i * 3], g.dir[i * 3 + 1], g.dir[i * 3 + 2]);
      assert.ok(Math.abs(l - 1) < 1e-12, `node ${i} is on the unit sphere`);
      solid += g.solid[i];
      const deg = g.nbrStart[i + 1] - g.nbrStart[i];
      if (deg === 6) corners++;
      else assert.equal(deg, 8, `node ${i}: degree ${deg}`);
    }
    assert.equal(corners, 8, 'exactly the eight cube corners have six neighbours');
    assert.ok(Math.abs(solid - 4 * Math.PI) < 1e-9, `solid angles sum to 4 PI (${solid})`);
    // Links are symmetric and about one cell long.
    const cell = (Math.PI / 2) / n;
    for (let i = 0; i < g.count; i++) {
      for (let q = g.nbrStart[i]; q < g.nbrStart[i + 1]; q++) {
        const j = g.nbr[q];
        let back = false;
        for (let r = g.nbrStart[j]; r < g.nbrStart[j + 1]; r++) if (g.nbr[r] === i) back = true;
        assert.ok(back, `link ${i}->${j} has no way back`);
        assert.ok(g.nbrAngle[q] > 0.5 * cell && g.nbrAngle[q] < 1.7 * cell, `link ${i}->${j} spans ${g.nbrAngle[q] / cell} cells`);
      }
    }
  }
  // A node on the +X/+Y edge is ONE node on both faces.
  const n = 8; const g = getCubeSphereGrid(n); const side = n + 1;
  for (let j = 0; j <= n; j++) {
    const onX = g.faceNode[0 * side * side + j * side + n];   // face +X, i = n (y = +1)
    const onY = g.faceNode[2 * side * side + j * side + n];   // face +Y, i = n (x = +1)
    assert.equal(onX, onY, `edge node j=${j} merged`);
  }
});

// ── the sampler ──────────────────────────────────────────────────────────
function smoothField(x, y, z) { return 1 + 0.3 * x + 0.5 * y - 0.2 * z + 0.4 * x * y - 0.3 * y * z; }
function fieldOn(g, f) {
  const per = new Float32Array(g.count);
  for (let i = 0; i < g.count; i++) per[i] = f(g.dir[i * 3], g.dir[i * 3 + 1], g.dir[i * 3 + 2]);
  return per;
}

test('the sampler returns node values at nodes and interpolates a smooth field closely', () => {
  const n = 32; const g = getCubeSphereGrid(n);
  const faces = faceValuesOf(g, fieldOn(g, smoothField));
  for (let i = 0; i < g.count; i += 7) {
    const v = sampleCubeField(faces, n, g.dir[i * 3], g.dir[i * 3 + 1], g.dir[i * 3 + 2]);
    const want = Math.fround(smoothField(g.dir[i * 3], g.dir[i * 3 + 1], g.dir[i * 3 + 2]));
    assert.ok(Math.abs(v - want) < 1e-5, `node ${i}: ${v} vs ${want}`);
  }
  let worst = 0;
  for (let k = 0; k < 4000; k++) {
    const z = 1 - 2 * (k + 0.5) / 4000; const r = Math.sqrt(1 - z * z); const a = k * 2.399963229728653;
    const x = r * Math.cos(a); const y = z; const w = r * Math.sin(a);
    worst = Math.max(worst, Math.abs(sampleCubeField(faces, n, x, y, w) - smoothField(x, y, w)));
  }
  assert.ok(worst < 2e-3, `bilinear error ${worst}`);
});

test('the sampler is continuous across every cube edge and at every cube corner', () => {
  const n = 16; const g = getCubeSphereGrid(n);
  // A rough per-node field: continuity must come from the shared nodes, not
  // from the field happening to be smooth.
  const per = new Float32Array(g.count);
  for (let i = 0; i < g.count; i++) per[i] = hash3(i, 3, 9) * 10;
  const faces = faceValuesOf(g, per);
  const eps = 1e-7;
  const edges = [];
  // 12 edges: two coordinates at +-1, the third running along.
  for (const [a, b, c] of [[0, 1, 2], [0, 2, 1], [1, 2, 0]]) {
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) edges.push({ a, b, c, sa, sb });
  }
  let worst = 0;
  for (const e of edges) {
    for (let k = 0; k <= 40; k++) {
      const t = -1 + 2 * k / 40;
      const p = [0, 0, 0]; p[e.a] = e.sa; p[e.b] = e.sb; p[e.c] = t;
      // Step off the edge onto each of its two faces.
      const onA = p.slice(); onA[e.b] = e.sb * (1 - eps);
      const onB = p.slice(); onB[e.a] = e.sa * (1 - eps);
      const la = Math.hypot(...onA); const lb = Math.hypot(...onB);
      const va = sampleCubeField(faces, n, onA[0] / la, onA[1] / la, onA[2] / la);
      const vb = sampleCubeField(faces, n, onB[0] / lb, onB[1] / lb, onB[2] / lb);
      worst = Math.max(worst, Math.abs(va - vb));
    }
  }
  assert.ok(worst < 1e-4, `jump across a cube edge: ${worst}`);
  // Corners: all three faces meet at one node, whose value the sampler returns.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const d = [sx, sy, sz].map((v) => v / Math.sqrt(3));
    const at = sampleCubeField(faces, n, d[0], d[1], d[2]);
    for (const nudge of [[1e-7, 0, 0], [0, 1e-7, 0], [0, 0, 1e-7]]) {
      const p = d.map((v, i) => v + nudge[i] * Math.sign(d[i]));
      const l = Math.hypot(...p);
      const near = sampleCubeField(faces, n, p[0] / l, p[1] / l, p[2] / l);
      assert.ok(Math.abs(near - at) < 1e-4, `corner (${sx},${sy},${sz}) is one value from every face`);
    }
  }
});

test('the sampler allocates nothing: scalars in, one number out, no allocating syntax', () => {
  // Structural: the hot path has nothing in it that can allocate.
  const src = sampleCubeField.toString();
  for (const bad of [/\bnew\b/, /=>/, /\bfunction\b[^(]*\([^)]*\)\s*\{[\s\S]*\bfunction\b/, /\.\.\./,
    /\.(map|slice|concat|filter|from|of|push)\(/, /[=(,]\s*\[/, /[=(,:]\s*\{/]) {
    assert.ok(!bad.test(src), `sampleCubeField contains ${bad}`);
  }
  const g = getCubeSphereGrid(32);
  const field = createErosionField(g, { delta: new Float32Array(g.count).fill(-1), wet: new Float32Array(g.count), stats: {} });
  assert.equal(typeof field.delta(0.3, 0.8, 0.52), 'number');
  // Empirical, against a CONTROL: V8 boxes a double crossing an un-inlined
  // call in the lower tiers, so ANY number-returning function shows some heap
  // traffic in a loop like this one — including the terrain function this
  // samples beside. What must hold is that the sampler adds nothing to what a
  // bare arithmetic function with the same signature costs.
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  const control = { delta(x, y, z) { return x * 0.5 + y * 0.25 - z; } };
  const growth = (f) => {
    let sink = 0;
    for (let k = 0; k < 20000; k++) sink += f.delta(0.3, 0.8, 0.52 + k * 1e-6);   // warm up
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let k = 0; k < 20000; k++) sink += f.delta(0.3 + k * 1e-6, 0.8, 0.52);
    const grew = process.memoryUsage().heapUsed - before;
    assert.ok(Number.isFinite(sink));
    return grew;
  };
  const base = Math.max(growth(control), growth(control));
  const sampler = Math.min(growth(field), growth(field));
  assert.ok(sampler <= base + 64 * 1024,
    `20k samples grew the heap ${sampler} bytes against ${base} for bare arithmetic`);
});

// ── the bake ─────────────────────────────────────────────────────────────
test('carve-down only: delta <= 0 at every node, on a cone and on rolling noise', () => {
  for (const [name, h, o, level] of [['cone', cone, coneOutlet, CONE_LEVEL], ['noise', noiseWorld, noiseOutlet, NOISE_LEVEL]]) {
    const r = bake(h, o, level);
    let carved = 0;
    for (let i = 0; i < r.delta.length; i++) {
      assert.ok(r.delta[i] <= 0, `${name}: node ${i} RAISED by ${r.delta[i]}`);
      assert.ok(Number.isFinite(r.delta[i]), `${name}: node ${i} non-finite`);
      if (r.delta[i] < -0.5) carved++;
    }
    assert.ok(carved > 20, `${name}: the water cut something (${carved} nodes > 0.5)`);
    assert.equal(r.stats.placed, r.stats.nodes, `${name}: every node is in the stack`);
  }
});

test('deterministic: the same terrain gives the same bytes, twice', () => {
  const a = bake(noiseWorld, noiseOutlet, NOISE_LEVEL);
  const b = bake(noiseWorld, noiseOutlet, NOISE_LEVEL);
  assert.deepEqual(Buffer.from(a.delta.buffer), Buffer.from(b.delta.buffer));
  assert.deepEqual(Buffer.from(a.wet.buffer), Buffer.from(b.wet.buffer));
  assert.deepEqual(Array.from(a.rec), Array.from(b.rec));
});

test('water runs downhill and gathers: area grows along every link, and only lakes are pits', () => {
  const r = bake(noiseWorld, noiseOutlet, NOISE_LEVEL);
  const g = getCubeSphereGrid(32);
  let links = 0;
  for (let i = 0; i < g.count; i++) {
    const rec = r.rec[i];
    if (rec === i) {
      assert.ok(r.outlet[i], `node ${i} is a pit that is not a lake`);
      continue;
    }
    links++;
    assert.ok(r.area[rec] > r.area[i], `drainage fell downstream at ${i} -> ${rec}: ${r.area[i]} -> ${r.area[rec]}`);
    // A receiver is a neighbour.
    let adjacent = false;
    for (let q = g.nbrStart[i]; q < g.nbrStart[i + 1]; q++) if (g.nbr[q] === rec) adjacent = true;
    assert.ok(adjacent, `node ${i} drains to a non-neighbour`);
  }
  assert.ok(links > g.count * 0.5, 'most of the planet drains somewhere');
  // Every drop reaches a lake: the outlets' areas account for the land.
  let intoLakes = 0; let total = 0;
  for (let i = 0; i < g.count; i++) {
    total += g.solid[i] * R * R;
    if (r.rec[i] === i) intoLakes += r.area[i];
  }
  assert.ok(Math.abs(intoLakes - total) / total < 1e-9, `drainage is conserved (${intoLakes} of ${total})`);
});

test('a roughened cone erodes into a dendritic network: many channels, joining, cut concentrated in them', () => {
  const n = 48;
  const g = getCubeSphereGrid(n);
  const r = bake(cone, coneOutlet, CONE_LEVEL, CONE_PROFILE, n);
  const channelArea = 200;
  // Donor counts among CHANNEL nodes: a confluence is where two channels meet.
  const channelDonors = new Int32Array(g.count);
  let channels = 0; let heads = 0;
  for (let i = 0; i < g.count; i++) {
    if (r.outlet[i] || r.area[i] < channelArea) continue;
    channels++;
    if (r.rec[i] !== i) channelDonors[r.rec[i]]++;
  }
  let confluences = 0; let mouths = 0;
  for (let i = 0; i < g.count; i++) {
    if (r.outlet[i] || r.area[i] < channelArea) continue;
    if (channelDonors[i] >= 2) confluences++;
    if (channelDonors[i] === 0) heads++;
    if (r.outlet[r.rec[i]]) mouths++;
  }
  // Measured on this cone at n = 48: 66 heads, 27 confluences, 38 mouths.
  assert.ok(heads >= 30, `channel heads: ${heads}`);
  assert.ok(confluences >= 12, `confluences: ${confluences} — a set of parallel gullies is not a network`);
  assert.ok(mouths >= 10 && mouths < heads * 0.8, `mouths ${mouths} vs heads ${heads}: channels JOIN on the way down`);
  // The cut is in the channels, not spread evenly over the hillslopes.
  let chSum = 0; let chN = 0; let hsSum = 0; let hsN = 0; let all = 0; let land = 0;
  for (let i = 0; i < g.count; i++) {
    if (r.outlet[i]) continue;
    land++;
    all -= r.delta[i];
    if (r.area[i] >= channelArea) { chSum -= r.delta[i]; chN++; }
    else if (r.area[i] < 60) { hsSum -= r.delta[i]; hsN++; }
  }
  const ch = chSum / chN; const hs = hsSum / hsN;
  assert.ok(ch > 1.0, `channels are cut (mean ${ch.toFixed(2)} units)`);
  assert.ok(ch > 1.8 * hs, `cut concentrates in channels: ${ch.toFixed(2)} vs hillslopes ${hs.toFixed(2)}`);
  assert.ok(chSum / all > 1.5 * (chN / land),
    `channels (${(100 * chN / land).toFixed(0)}% of the land) hold ${(100 * chSum / all).toFixed(0)}% of the cut`);
  assert.ok(channels < land * 0.3, `channels are a network, not the whole cone (${channels} of ${land})`);
});

test('sea level is a base level: nothing is cut below the lake surface that was not already under it', () => {
  const profile = { ...CONE_PROFILE, slope: 0.01 };   // a law that WANTS to cut to the sea
  const r = bake(noiseWorld, noiseOutlet, NOISE_LEVEL, profile);
  const floor = NOISE_LEVEL + profile.margin;
  for (let i = 0; i < r.h.length; i++) {
    const allowed = Math.min(r.h0[i], floor);
    assert.ok(r.h[i] >= allowed - 1e-6, `node ${i} cut to ${r.h[i]} under ${allowed}`);
    if (r.outlet[i]) assert.equal(r.delta[i], 0, `lake node ${i} was eroded`);
  }
});

test('protectAt withholds the carve exactly where it says, and fades it', () => {
  const g = getCubeSphereGrid(32);
  const protectAt = (x, y) => (y > 0.5 ? 1 : 0);
  const r = bake(cone, coneOutlet, CONE_LEVEL, CONE_PROFILE, 32, { protectAt });
  let inside = 0;
  for (let i = 0; i < g.count; i++) {
    if (g.dir[i * 3 + 1] > 0.5) { assert.equal(r.delta[i], 0, `protected node ${i} carved`); inside++; }
  }
  assert.ok(inside > 50);
  const open = bake(cone, coneOutlet, CONE_LEVEL, CONE_PROFILE, 32);
  let carvedThere = 0;
  for (let i = 0; i < g.count; i++) if (g.dir[i * 3 + 1] > 0.5 && open.delta[i] < -0.3) carvedThere++;
  assert.ok(carvedThere > 10, 'the same region IS carved when unprotected (the test can fail)');
});

test('wetness: 0..1, dry under the lakes, rising with drainage', () => {
  const profile = { ...CONE_PROFILE, wetSmooth: 0 };
  const r = bake(noiseWorld, noiseOutlet, NOISE_LEVEL, profile);
  let maxWet = 0;
  const pairs = [];
  for (let i = 0; i < r.wet.length; i++) {
    assert.ok(r.wet[i] >= 0 && r.wet[i] <= 1, `wet ${r.wet[i]}`);
    if (r.outlet[i]) assert.equal(r.wet[i], 0, 'a lake is not a wet field');
    else pairs.push([r.area[i], r.wet[i]]);
    maxWet = Math.max(maxWet, r.wet[i]);
  }
  assert.ok(maxWet > 0.99, 'the big rivers saturate');
  pairs.sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < pairs.length; k++) {
    assert.ok(pairs[k][1] >= pairs[k - 1][1] - 1e-6, 'wetness never falls as drainage grows');
  }
});

test('the equirect wetness bake uses the horizon map\'s texel convention exactly', () => {
  const n = 32; const g = getCubeSphereGrid(n);
  // wet = (y + 1) / 2 at the nodes: a known function of direction.
  const wet = fieldOn(g, (x, y) => (y + 1) / 2);
  const field = createErosionField(g, { delta: new Float32Array(g.count), wet, stats: {} });
  const W = 64; const H = 32;
  const bytes = bakeWetnessEquirect(field, W, H);
  assert.equal(bytes.length, W * H);
  const t = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i += 5) {
      horizonTexelDirection(i, j, W, H, t);
      const want = Math.round(((t.y + 1) / 2) * 255);
      assert.ok(Math.abs(bytes[j * W + i] - want) <= 2, `texel ${i},${j}: ${bytes[j * W + i]} vs ${want}`);
    }
  }
  // Row 0 is the +Y pole (wet 1), the last row the -Y pole.
  assert.ok(bytes[0] > 250 && bytes[(H - 1) * W] < 5);
});

// ── the ground shader's wetness option ───────────────────────────────────
const GD_THREE = {
  Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
  Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  Vector4: class { constructor(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; } },
};
// The chunks three actually hands onBeforeCompile: INCLUDES, unexpanded.
const GD_FRAG = ['void main() {', '#include <normal_fragment_begin>', '#include <normal_fragment_maps>', '#include <opaque_fragment>', '}'].join('\n');
const GD_VERT = ['void main() {', '#include <begin_vertex>', '}'].join('\n');
function compileGround(opts) {
  const material = { userData: {} };
  addGroundDetail(material, GD_THREE, { baseRadius: 120, biome: 'forest', ...opts });
  const shader = { uniforms: {}, fragmentShader: GD_FRAG, vertexShader: GD_VERT };
  material.onBeforeCompile(shader, null);
  return { frag: shader.fragmentShader, vert: shader.vertexShader, key: material.customProgramCacheKey(), uniforms: shader.uniforms, material };
}
const WET = { texture: { isTexture: true }, tint: [0.4, 0.55, 0.8], damp: [0.8, 0.94, 0.84], strength: 1, core: [0.42, 0.72] };

test('wetMap omitted: the ground shader and its cache key are byte-for-byte what they were', () => {
  for (const smooth of [false, true]) {
    const before = compileGround({ smooth });
    const nullOpt = compileGround({ smooth, wetMap: null });
    assert.equal(nullOpt.frag, before.frag);
    assert.equal(nullOpt.vert, before.vert);
    assert.equal(nullOpt.key, before.key);
    assert.ok(!/uGdWet/.test(before.frag), 'no wetness symbol leaks into the default shader');
    assert.ok(!/-wet/.test(before.key));
  }
});

test('wetMap passed: one fetch in the horizon convention, its own program, live uniforms', () => {
  for (const smooth of [false, true]) {
    const wet = compileGround({ smooth, wetMap: WET });
    const plain = compileGround({ smooth });
    assert.notEqual(wet.key, plain.key, 'a wet ground cannot share a program with a dry one');
    assert.match(wet.key, /-wet$/);
    assert.equal((wet.frag.match(/texture2D\(uGdWetMap/g) || []).length, 1, 'exactly one wetness fetch');
    // The same equirect lookup horizon-shadow.js makes: u = atan(z, -x)/2PI, v = acos(y)/PI.
    assert.match(wet.frag, /atan\(gdUp\.z, -gdUp\.x\) \* 0\.15915494/);
    assert.match(wet.frag, /acos\(clamp\(gdUp\.y, -1\.0, 1\.0\)\) \* 0\.31830989/);
    // Written into the tint, before outgoingLight takes it (multiplies, never adds).
    const at = wet.frag.indexOf('gdTint = mix(gdTint, gdTint * uGdWetDamp');
    assert.ok(at > 0 && at < wet.frag.indexOf('outgoingLight *= gdTint'));
    assert.equal(wet.uniforms.uGdWetMap.value, WET.texture);
    assert.equal(wet.uniforms.uGdWet.value.w, 1);
    // The material exposes the SAME uniform objects, so a live A/B needs no recompile.
    assert.equal(wet.material.userData.birbGroundWetUniforms.uGdWet, wet.uniforms.uGdWet);
  }
});

test('wetMap is all-or-nothing: a missing field throws rather than defaulting', () => {
  for (const field of ['texture', 'tint', 'damp', 'strength']) {
    const partial = { ...WET, [field]: undefined };
    assert.throws(() => compileGround({ wetMap: partial }), new RegExp(`wetMap\\.${field}`));
  }
});

test('a worker result survives the transfer: its face arrays rebuild the same field with no grid', () => {
  const g = getCubeSphereGrid(32);
  const r = bake(noiseWorld, noiseOutlet, NOISE_LEVEL);
  const a = createErosionField(g, r);
  // What erosion-worker.js posts, TRANSFERRED (the worker's copies detach).
  const sent = { n: a.n, deltaFaces: a.deltaFaces.slice(), wetFaces: a.wetFaces.slice(), stats: r.stats };
  const got = structuredClone(sent, { transfer: [sent.deltaFaces.buffer, sent.wetFaces.buffer] });
  assert.equal(sent.deltaFaces.length, 0, 'the sender\'s array was transferred, not copied');
  const b = erosionFieldFromFaces(got.n, got.deltaFaces, got.wetFaces, got.stats);
  for (let k = 0; k < 500; k++) {
    const z = 1 - 2 * (k + 0.5) / 500; const rr = Math.sqrt(1 - z * z); const ang = k * 2.4;
    const d = [rr * Math.cos(ang), z, rr * Math.sin(ang)];
    assert.equal(a.delta(...d), b.delta(...d));
    assert.equal(a.wet(...d), b.wet(...d));
  }
  // A wrong-sized array is refused, not sampled out of bounds.
  assert.throws(() => erosionFieldFromFaces(32, new Float32Array(10), got.wetFaces), /Float32Array/);
  assert.throws(() => erosionFieldFromFaces(16, got.deltaFaces, got.wetFaces), /Float32Array/);
});
