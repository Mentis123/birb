/**
 * A landscape carved by water — stream-power erosion, baked once per world.
 *
 * The terrain in this game is analytic: detail fbm plus a tanh continental
 * carve, clamped to <= 0 (spherical-world.js, terrainDisplacement). Noise
 * makes hills. It does not make valleys, because a valley is not a shape, it
 * is a HISTORY: water collects, the collecting water cuts, the cut collects
 * more water. Nothing in an fbm stack knows which way anything drains, so the
 * low ground between its hills is a scatter of pits that connect to nothing.
 * A river cannot be painted onto that; it has to be eroded into it.
 *
 * This module erodes it, once, at world build, behind `?erosion=1`:
 *
 *  1. The terrain is sampled on a CUBE-SPHERE grid (6 x N x N cells, one
 *     node per cell corner, equiangular so a cell is the same size to within
 *     ~30% everywhere — a lat-long grid would be 100x denser at the poles).
 *  2. Every node drains to its steepest-descent neighbour on a DEPRESSION-
 *     FILLED copy of the surface (Priority-Flood + epsilon, Barnes, Lehman &
 *     Mulla 2014), seeded from the lakes — so water reaches a lake from
 *     everywhere, and a pit in the noise spills over its lowest rim instead
 *     of swallowing its catchment.
 *  3. Drainage area accumulates down the receiver tree in stack order
 *     (Braun & Willett 2013's ordering: a DFS from each outlet over the donor
 *     lists, so every node comes after the node it drains into).
 *  4. The stream-power law with uplift, dh/dt = U - K A^m S, is integrated
 *     IMPLICITLY along that order (Braun & Willett 2013, n = 1):
 *     h_i <- (h_i + U dt + F h_r) / (1 + F), F = K dt A^m / L, downstream
 *     first. Unconditionally stable, which is what lets two dozen big steps
 *     stand in for ten thousand small ones. The ORIGINAL ground is a
 *     ceiling, so the fixed point is h_i = min(h0_i, h_r + U/F): the steady
 *     channel profile of the law (the analytic solution Tzathas et al. 2024
 *     build terrain from) wherever it runs under the ground, the ground
 *     wherever it does not. `slope` sets U/K as the steady channel slope at
 *     `refArea`. Channels start above a critical area, so the hillslopes
 *     between them keep the art direction's noise.
 *  5. The channel gets a BED (bankfull depth ~ A^0.4, Leopold & Maddock
 *     1953) along the whole network, and the cut spreads sideways into a
 *     valley that falls off `flank` units from its channel — a width the
 *     ground MESH can draw (a 3-unit channel under a 6.7-unit mesh is a
 *     thing the floor can find and the eye cannot — see below).
 *
 * Output, per node: `delta = min(0, eroded - original)` — CARVE-DOWN ONLY,
 * so the gravity-less-floor invariant (the floor may only ever dip below the
 * base radius) survives by construction — and the drainage area, from which
 * a 0..1 wetness is derived for the ground shader.
 *
 * Measured on the three eroded biomes against the same mesh with erosion
 * off (the control): the ground drawn above the flight floor moves by
 * +0.013 (forest), +0.032 (canyons) and +0.036 (mountain) units at the 99th
 * percentile and by at most +0.37 / +0.36 / +0.56 anywhere, where the
 * control's own 99th percentile is already 1.5-1.9 — the detail noise's own
 * sub-vertex skim. Tuned against that, not by eye:
 * docs/perf/gates/G-REALISM-EROSION.md has the table.
 *
 * ── The mesh and the floor have to agree, and that sets the grid ─────────
 *
 * The flight floor and the landing check sample the terrain ANALYTICALLY at
 * the bird's exact direction; the ground mesh samples it at its vertices,
 * 6.7 units apart on a phone, and draws straight lines between. A channel
 * narrower than that is in the floor and missing from the mesh, and the
 * bird can descend into ground that is drawn above it — fly-through, the
 * failure the carve-down clamp exists to prevent. So the geometric delta is
 * smoothed on the node graph after erosion (`smooth` passes), and what is
 * too fine for the mesh travels only in the WETNESS field, which the ground
 * shader reads per fragment and the floor never sees.
 *
 * ── Sea level is a base level, not a depth ───────────────────────────────
 *
 * Lakes are outlets. A river erodes down to the lake SURFACE, never below
 * it, and a node the erosion lowers is clamped at `level + margin`: carving
 * a dry channel below sea level outside the flooded basins would open a pit
 * the water sheet does not cover while terrainFloorDir holds the floor AT
 * sea level above it — a bird hovering over its own ground.
 *
 * References (docs/perf/gates/G-REALISM-EROSION.md): Braun & Willett 2013;
 * Barnes, Lehman & Mulla 2014; Schott et al., TOG 2023 (large-scale terrain
 * authoring through interactive erosion simulation — the same implicit
 * stream-power core at authoring scale); Tzathas, Gailleton, Steer &
 * Cordonnier, EG 2024 (the steady-state analytic form of the same law).
 *
 * Pure: no THREE, no DOM, no Math.random. The same inputs give the same
 * bytes. The samplers allocate nothing and are safe per frame.
 */

const QUARTER_PI = Math.PI / 4;
const FOUR_OVER_PI = 4 / Math.PI;

/**
 * Per-biome erosion. `null` = this biome is not eroded even with the flag
 * on: the city's ground is a street grid laid over it by world position,
 * and a drainage channel cut through a grid of streets is a rendering bug
 * that happens to look like a river.
 *
 * Units: heights and lengths in world units (the planet is radius 120),
 * areas in square units. `k` is erodibility x timestep, per iteration.
 */
export const EROSION_PROFILES = Object.freeze({
  forest: Object.freeze({
    n: 64, iterations: 24, routeEvery: 5, k: 0.1, m: 0.5,
    slope: 0.1, refArea: 1000, areaCrit: 40, groove: 1.2, flank: 5, smooth: 2, margin: 0.4,
    wetArea: [120, 2400], wetSmooth: 1, wetCore: Object.freeze([0.42, 0.72]),
    wetTint: Object.freeze([0.40, 0.55, 0.80]), wetDamp: Object.freeze([0.80, 0.94, 0.84]), wetStrength: 1,
  }),
  canyons: Object.freeze({
    n: 64, iterations: 24, routeEvery: 5, k: 0.1, m: 0.5,
    slope: 0.2, refArea: 1000, areaCrit: 50, groove: 1.4, flank: 5, smooth: 2, margin: 0.4,
    wetArea: [160, 3200], wetSmooth: 1, wetCore: Object.freeze([0.42, 0.72]),
    wetTint: Object.freeze([0.50, 0.56, 0.60]), wetDamp: Object.freeze([0.84, 0.90, 0.78]), wetStrength: 1,
  }),
  mountain: Object.freeze({
    n: 64, iterations: 24, routeEvery: 5, k: 0.1, m: 0.5,
    slope: 0.2, refArea: 1000, areaCrit: 40, groove: 1.4, flank: 6, smooth: 3, maxCut: 10, margin: 0.4,
    wetArea: [140, 3000], wetSmooth: 1, wetCore: Object.freeze([0.42, 0.72]),
    wetTint: Object.freeze([0.45, 0.58, 0.72]), wetDamp: Object.freeze([0.82, 0.92, 0.88]), wetStrength: 1,
  }),
  city: null,
});

/** `?erosion=1` — opt-in; absent (the default) is the un-eroded world. */
export function erosionRequested(search) {
  return /[?&]erosion=1(?:&|$)/.test(typeof search === 'string' ? search : '');
}

// ── The cube-sphere grid ─────────────────────────────────────────────────
//
// Face f carries (n+1) x (n+1) NODES at equiangular coordinates
// a_k = tan(PI/4 (2k/n - 1)), k = 0..n, laid on the cube as
//
//   f 0: (+1, a_i, a_j)   f 1: (-1, a_i, a_j)
//   f 2: (a_i, +1, a_j)   f 3: (a_i, -1, a_j)
//   f 4: (a_i, a_j, +1)   f 5: (a_i, a_j, -1)
//
// A node on a face EDGE is the same 3D point as the matching node of the
// neighbouring face (both have a coordinate at +-1), and a cube CORNER is
// shared by three faces. Nodes are identified by their integer lattice
// coordinates (kx, ky, kz) in [0, n]^3, so duplicates merge exactly: the
// erosion runs on 6 n^2 + 2 unique nodes, and the sampler reads per-face
// (n+1)^2 arrays in which a shared node carries one value on every face —
// which is what makes bilinear interpolation continuous across an edge
// without any cross-face lookup at sample time.

/** Solid angle of the spherical triangle (a, b, c), unit vectors given by id. */
function solidAngle(dir, a, b, c) {
  // Van Oosterom & Strackee 1983: tan(W/2) = |a.(b x c)| / (1 + a.b + b.c + c.a)
  const ax = dir[a * 3]; const ay = dir[a * 3 + 1]; const az = dir[a * 3 + 2];
  const bx = dir[b * 3]; const by = dir[b * 3 + 1]; const bz = dir[b * 3 + 2];
  const cx = dir[c * 3]; const cy = dir[c * 3 + 1]; const cz = dir[c * 3 + 2];
  const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  const div = 1 + (ax * bx + ay * by + az * bz) + (bx * cx + by * cy + bz * cz) + (cx * ax + cy * ay + cz * az);
  return 2 * Math.atan2(det < 0 ? -det : det, div);
}

// Upper bound on a node's degree: 8 inside a face, 8 along an edge, 6 at a
// cube corner.
const MAX_DEGREE = 8;

// A valley flank thinner than this (units) is not carried further out.
const FLANK_FLOOR = 0.02;

// How much of a stream's wetness its neighbouring node takes (see wetSmooth).
const WET_SPREAD = 0.6;

const _gridCache = new Map();

/**
 * The cube-sphere node graph for `n` cells per face edge. Pure geometry,
 * cached per n (it does not depend on the terrain), typed arrays only.
 *
 * @returns {{
 *   n, count, dir: Float64Array (x,y,z per node, unit),
 *   solid: Float64Array (steradians per node; sums to 4 PI),
 *   nbrStart: Int32Array(count + 1), nbr: Int32Array, nbrAngle: Float64Array (radians),
 *   faceNode: Int32Array(6 (n+1)^2) (face, j, i) -> node id,
 * }}
 */
export function getCubeSphereGrid(n) {
  const key = n | 0;
  if (!(key >= 2)) throw new Error(`getCubeSphereGrid: n must be >= 2 (got ${n})`);
  const cached = _gridCache.get(key);
  if (cached) return cached;

  const side = key + 1;
  const perFace = side * side;
  const faceNode = new Int32Array(6 * perFace);
  const lattice = new Int32Array(side * side * side).fill(-1);
  const coord = new Float64Array(side);
  for (let k = 0; k <= key; k++) coord[k] = Math.tan(QUARTER_PI * (2 * k / key - 1));
  // Exact at the ends, so a shared edge node is bit-identical on both faces.
  coord[0] = -1; coord[key] = 1;

  const count = 6 * key * key + 2;
  const dir = new Float64Array(count * 3);
  let next = 0;
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j <= key; j++) {
      for (let i = 0; i <= key; i++) {
        // Lattice coordinates of (f, i, j): the face's own axis at 0 or n.
        let kx; let ky; let kz;
        if (f === 0) { kx = key; ky = i; kz = j; }
        else if (f === 1) { kx = 0; ky = i; kz = j; }
        else if (f === 2) { kx = i; ky = key; kz = j; }
        else if (f === 3) { kx = i; ky = 0; kz = j; }
        else if (f === 4) { kx = i; ky = j; kz = key; }
        else { kx = i; ky = j; kz = 0; }
        const lk = (kx * side + ky) * side + kz;
        let id = lattice[lk];
        if (id < 0) {
          id = next++;
          lattice[lk] = id;
          const x = coord[kx]; const y = coord[ky]; const z = coord[kz];
          const l = Math.sqrt(x * x + y * y + z * z);
          dir[id * 3] = x / l; dir[id * 3 + 1] = y / l; dir[id * 3 + 2] = z / l;
        }
        faceNode[f * perFace + j * side + i] = id;
      }
    }
  }
  if (next !== count) throw new Error(`getCubeSphereGrid: ${next} unique nodes, expected ${count}`);

  // 8-neighbour links within each face; a shared node collects links from
  // every face it sits on, deduplicated in a fixed-stride scratch table.
  const deg = new Uint8Array(count);
  const tmp = new Int32Array(count * MAX_DEGREE);
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j <= key; j++) {
      for (let i = 0; i <= key; i++) {
        const a = faceNode[f * perFace + j * side + i];
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj > key) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if ((di === 0 && dj === 0) || ii < 0 || ii > key) continue;
            const b = faceNode[f * perFace + jj * side + ii];
            const base = a * MAX_DEGREE;
            const d = deg[a];
            let seen = false;
            for (let q = 0; q < d; q++) if (tmp[base + q] === b) { seen = true; break; }
            if (seen) continue;
            if (d >= MAX_DEGREE) throw new Error(`getCubeSphereGrid: node ${a} exceeds degree ${MAX_DEGREE}`);
            tmp[base + d] = b;
            deg[a] = d + 1;
          }
        }
      }
    }
  }
  const nbrStart = new Int32Array(count + 1);
  for (let id = 0; id < count; id++) nbrStart[id + 1] = nbrStart[id] + deg[id];
  const nbr = new Int32Array(nbrStart[count]);
  const nbrAngle = new Float64Array(nbrStart[count]);
  for (let id = 0; id < count; id++) {
    const ax = dir[id * 3]; const ay = dir[id * 3 + 1]; const az = dir[id * 3 + 2];
    for (let q = 0; q < deg[id]; q++) {
      const b = tmp[id * MAX_DEGREE + q];
      const d = ax * dir[b * 3] + ay * dir[b * 3 + 1] + az * dir[b * 3 + 2];
      nbr[nbrStart[id] + q] = b;
      nbrAngle[nbrStart[id] + q] = Math.acos(d > 1 ? 1 : d < -1 ? -1 : d);
    }
  }

  // Each quad's solid angle, a quarter to each of its corners.
  const solid = new Float64Array(count);
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j < key; j++) {
      for (let i = 0; i < key; i++) {
        const q0 = faceNode[f * perFace + j * side + i];
        const q1 = faceNode[f * perFace + j * side + i + 1];
        const q2 = faceNode[f * perFace + (j + 1) * side + i + 1];
        const q3 = faceNode[f * perFace + (j + 1) * side + i];
        const w = (solidAngle(dir, q0, q1, q2) + solidAngle(dir, q0, q2, q3)) * 0.25;
        solid[q0] += w; solid[q1] += w; solid[q2] += w; solid[q3] += w;
      }
    }
  }

  const grid = Object.freeze({ n: key, count, dir, solid, nbrStart, nbr, nbrAngle, faceNode });
  _gridCache.set(key, grid);
  return grid;
}

/**
 * Priority-Flood + epsilon (Barnes, Lehman & Mulla 2014, Alg. 3) on a graph,
 * from `outlet` nodes. Writes the depression-filled surface into `filled`;
 * `h` is not modified.
 *
 * Every node is reached from an already-flooded neighbour c and gets
 * filled = max(h, filled[c] + eps) — strictly above c — so steepest descent
 * on `filled` has no pits whatever order the nodes are processed in. The
 * ORDER only decides whether a depression fills to its true spill height,
 * which is why the binary heap can be a monotone BUCKET queue `bucket`
 * units wide (O(n) instead of O(n log n); out of order by at most one
 * bucket, i.e. a spill a hundredth of a unit high). Pit cells skip the queue
 * through a FIFO, as in the paper.
 */
function priorityFlood(grid, h, outlet, filled, work, eps, bucket) {
  const { count, nbrStart, nbr } = grid;
  const { closed, pit, next } = work;
  let lo = Infinity; let hi = -Infinity;
  for (let i = 0; i < count; i++) {
    const v = h[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const nb = Math.max(1, Math.ceil((hi - lo) / bucket) + 2);
  if (!work.head || work.head.length < nb) work.head = new Int32Array(nb);
  const head = work.head;
  head.fill(-1, 0, nb);
  const inv = 1 / bucket;
  closed.fill(0);
  let cur = nb;
  for (let i = 0; i < count; i++) {
    if (!outlet[i]) continue;
    closed[i] = 1;
    filled[i] = h[i];
    let b = Math.floor((h[i] - lo) * inv);
    if (b < 0) b = 0; else if (b > nb - 1) b = nb - 1;
    next[i] = head[b]; head[b] = i;
    if (b < cur) cur = b;
  }
  let ph = 0; let pt = 0;
  for (;;) {
    let c;
    if (ph < pt) {
      c = pit[ph++];
    } else {
      ph = 0; pt = 0;
      while (cur < nb && head[cur] < 0) cur++;
      if (cur >= nb) break;
      c = head[cur];
      head[cur] = next[c];
    }
    const fc = filled[c];
    for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
      const q = nbr[k];
      if (closed[q]) continue;
      closed[q] = 1;
      if (h[q] <= fc + eps) {
        filled[q] = fc + eps;
        pit[pt++] = q;
      } else {
        filled[q] = h[q];
        let b = Math.floor((h[q] - lo) * inv);
        if (b < cur) b = cur; else if (b > nb - 1) b = nb - 1;
        next[q] = head[b]; head[b] = q;
      }
    }
  }
}

/** Steepest descent on the filled surface; outlets receive themselves. */
function steepestReceivers(grid, filled, outlet, rec, recAngle) {
  const { count, nbrStart, nbr, nbrAngle } = grid;
  for (let i = 0; i < count; i++) {
    rec[i] = i; recAngle[i] = 0;
    if (outlet[i]) continue;
    let best = -1; let bestSlope = 0; let bestAngle = 0;
    const fi = filled[i];
    for (let k = nbrStart[i]; k < nbrStart[i + 1]; k++) {
      const q = nbr[k];
      const dz = fi - filled[q];
      if (dz <= 0) continue;
      const s = dz / nbrAngle[k];
      if (s > bestSlope) { bestSlope = s; best = q; bestAngle = nbrAngle[k]; }
    }
    if (best >= 0) { rec[i] = best; recAngle[i] = bestAngle; }
  }
}

/**
 * Braun & Willett (2013) stack: every node appears after its receiver.
 * Returns the number of nodes placed — `count` unless the receivers hold a
 * cycle, which the flood makes impossible and the tests pin.
 */
function buildStack(grid, rec, work, stack) {
  const { count } = grid;
  const { donorStart, donors, dfs } = work;
  donorStart.fill(0);
  for (let i = 0; i < count; i++) if (rec[i] !== i) donorStart[rec[i] + 1] += 1;
  for (let i = 0; i < count; i++) donorStart[i + 1] += donorStart[i];
  const fillAt = work.fillAt;
  fillAt.set(donorStart.subarray(0, count));
  for (let i = 0; i < count; i++) if (rec[i] !== i) donors[fillAt[rec[i]]++] = i;
  let s = 0;
  for (let b = 0; b < count; b++) {
    if (rec[b] !== b) continue;
    let top = 0;
    dfs[top++] = b;
    while (top > 0) {
      const c = dfs[--top];
      stack[s++] = c;
      for (let k = donorStart[c]; k < donorStart[c + 1]; k++) dfs[top++] = donors[k];
    }
  }
  return s;
}

/** Drainage area (units^2): each node's own cell plus everything upstream. */
function accumulate(grid, rec, stack, cellArea, area) {
  const { count } = grid;
  area.set(cellArea);
  for (let k = count - 1; k >= 0; k--) {
    const i = stack[k];
    const r = rec[i];
    if (r !== i) area[r] += area[i];
  }
}

/**
 * Erode a terrain. Build-time; allocates its working arrays.
 *
 * @param grid       from getCubeSphereGrid(n)
 * @param heightAt   (nx,ny,nz) -> terrain height (<= 0 for this game), NOT eroded
 * @param outletAt   (nx,ny,nz) -> true where water stands (a lake: base level).
 *                   Optional; with no outlet anywhere the lowest node is one.
 * @param protectAt  (nx,ny,nz) -> 0..1, how much of the carve to withhold
 *                   here (1 = untouched). Optional.
 * @param baseLevel  the lake surface (sea level), or -Infinity for none
 * @param radius     planet radius, to turn angles into lengths
 * @param profile    one of EROSION_PROFILES (iterations, routeEvery, k, m,
 *                   slope, refArea, areaCrit, groove, flank, smooth, margin,
 *                   wetArea, wetSmooth); missing fields take the defaults below
 * @returns {{ h0, h, delta, area, wet, outlet, rec, stats }}  per node
 */
export function erodeTerrain({
  grid, heightAt, outletAt = null, protectAt = null,
  baseLevel = -Infinity, radius = 120, profile,
}) {
  if (!grid || typeof heightAt !== 'function' || !profile) throw new Error('erodeTerrain: grid, heightAt and profile are required');
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { count, dir, solid, nbrStart, nbr, nbrAngle } = grid;
  const {
    iterations = 30, k = 0.1, m = 0.5, areaCrit = 0,
    slope = 0.1, refArea = 1000, groove = 0, maxCut = 0,
    flank = 0, smooth = 0, margin = 0.4,
    wetArea = [100, 1000], wetSmooth = 0, eps = 1e-6, bucket = 0.01,
    routeEvery = 1,
  } = profile;
  // Uplift per step, from the steady channel slope asked for: at the fixed
  // point of the implicit update h_i = h_r + U / F, i.e. a channel slope of
  // U / (k A^m) — `slope` at `refArea`, steeper upstream, gentler down.
  const uplift = slope * k * Math.pow(refArea, m);

  const h0 = new Float64Array(count);
  const h = new Float64Array(count);
  const lim = new Float64Array(count);
  const outlet = new Uint8Array(count);
  const cellArea = new Float64Array(count);
  const r2 = radius * radius;
  const floorLevel = Number.isFinite(baseLevel) ? baseLevel + margin : -Infinity;
  let outlets = 0; let lowest = 0;
  for (let i = 0; i < count; i++) {
    const x = dir[i * 3]; const y = dir[i * 3 + 1]; const z = dir[i * 3 + 2];
    const hi = heightAt(x, y, z);
    h0[i] = hi; h[i] = hi;
    if (hi < h0[lowest]) lowest = i;
    const out = outletAt ? !!outletAt(x, y, z) : false;
    outlet[i] = out ? 1 : 0;
    if (out) outlets++;
    // Never below the original ground, never below the lake surface unless
    // the original ground already was.
    let l = hi < floorLevel ? hi : floorLevel;
    if (l > hi) l = hi;
    if (protectAt) {
      const p = protectAt(x, y, z);
      if (p >= 1) l = hi;
      else if (p > 0) l += (hi - l) * p;
    }
    // Exactly, not approximately: a blend that rounds a hair ABOVE the ground
    // would hand the smoothing below a positive "floor" to clamp up to.
    lim[i] = l < hi ? l : hi;
    cellArea[i] = solid[i] * r2;
  }
  if (!outlets) { outlet[lowest] = 1; outlets = 1; }
  const tSample = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const filled = new Float64Array(count);
  const rec = new Int32Array(count);
  const recAngle = new Float64Array(count);
  const stack = new Int32Array(count);
  const area = new Float64Array(count);
  const dh = new Float64Array(count);
  const work = {
    closed: new Uint8Array(count), pit: new Int32Array(count), next: new Int32Array(count), head: null,
    donorStart: new Int32Array(count + 1), donors: new Int32Array(count),
    fillAt: new Int32Array(count), dfs: new Int32Array(count),
  };
  const sqrtLaw = m === 0.5;
  // Per routing: F_i and 1 / (1 + F_i), 0 where the node is no channel. The
  // law's inner loop is then two reads and a multiply-add per node.
  const lawF = new Float64Array(count);
  const lawInv = new Float64Array(count);
  let routeMs = 0; let lawMs = 0; let flankMs = 0;
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  let placed = count;
  let routes = 0;
  for (let it = 0; it < iterations; it++) {
    const c0 = clock();
    if (it % Math.max(1, routeEvery) === 0) {
      priorityFlood(grid, h, outlet, filled, work, eps, bucket);
      steepestReceivers(grid, filled, outlet, rec, recAngle);
      placed = buildStack(grid, rec, work, stack);
      accumulate(grid, rec, stack, cellArea, area);
      for (let i = 0; i < count; i++) {
        const a = area[i] - areaCrit;
        if (rec[i] === i || a <= 0) { lawF[i] = 0; lawInv[i] = 0; continue; }
        const F = k * (sqrtLaw ? Math.sqrt(a) : Math.pow(a, m)) / (recAngle[i] * radius);
        lawF[i] = F; lawInv[i] = 1 / (1 + F);
      }
      routes++;
    }
    const c1 = clock();

    // Implicit stream power with uplift, downstream first, so h[r] is
    // already t+1. The original ground is a CEILING (carve-down only), so
    // the fixed point is h_i = min(h0_i, h_r + U/F): the steady channel of
    // the stream-power law wherever that runs under the ground, the ground
    // wherever it does not — which is the analytic steady state of Tzathas
    // et al. (2024), reached here by the implicit iteration.
    for (let s = 0; s < placed; s++) {
      const i = stack[s];
      const F = lawF[i];
      if (F === 0) continue;
      const r = rec[i];
      let hr = h[r];
      if (outlet[r] && hr < floorLevel) hr = floorLevel;
      // A pit on the routed path: water carves its way out, it never fills.
      if (h[i] <= hr) continue;
      let hn = (h[i] + uplift + F * hr) * lawInv[i];
      if (hn > h0[i]) hn = h0[i];
      if (hn < lim[i]) hn = lim[i];
      h[i] = hn;
    }
    routeMs += c1 - c0; lawMs += clock() - c1;
  }

  // The valley. A stream-power channel is one node wide — three units, half
  // the ground mesh's vertex spacing — so on its own it is a cut the floor
  // can find and the mesh cannot draw. Real channels widen by their banks
  // failing into them; the INCISION spreads sideways and the valley walls
  // keep the hillside's own texture, only lower. So the incision depth D is
  // spread by relaxation, D(i) = max(D(i), D(j) exp(-L_ij / flank)): a
  // valley whose cut falls to 1/e `flank` units from its channel,
  // subtracted from the ORIGINAL ground.
  //
  // Not thermal erosion on the heights. A stepped talus collapse was built
  // first, then its steady state (the lower envelope of talus cones on every
  // incised node), and both did the same wrong thing: this world's noise is
  // steeper than any sane talus angle at grid scale (the median node already
  // has a 39-degree link), so every bank that collapsed became an incision
  // whose own neighbours collapsed in turn, and whole hills slid into
  // channels that were only there to start it. Spreading the INCISION
  // instead of capping the SLOPE leaves every hill with no river at its foot
  // exactly as the art direction made it.
  const c3 = clock();
  let flankVisits = 0;
  const cut = dh;   // reuse: build-time scratch
  // The CHANNEL, as well as the profile. The stream-power fixed point only
  // cuts where the steady profile runs under the ground — at saddles and in
  // highlands — which on this noise is a scatter of short notches, and the
  // network between them is still there in the drainage but not in the
  // ground. A river also has a bed: bankfull depth grows with discharge
  // (Leopold & Maddock 1953, depth ~ Q^0.4, Q ~ A), so every node on the
  // network is cut at least `groove (A/refArea)^0.4` — continuous from the
  // first channel node to the lake.
  const grooveCap = groove * 3;
  for (let i = 0; i < count; i++) {
    let d = h0[i] - h[i];
    if (groove > 0 && !outlet[i]) {
      const a = area[i] - areaCrit;
      if (a > 0) {
        let g = groove * Math.pow(a / refArea, 0.4);
        if (g > grooveCap) g = grooveCap;
        if (g > d) d = g;
      }
    }
    // A soft ceiling on the depth (maxCut x tanh): a gorge deeper than the
    // mesh can draw cleanly saturates instead of clipping.
    cut[i] = maxCut > 0 ? maxCut * Math.tanh(d / maxCut) : d;
  }
  if (flank > 0) {
    // Per-link decay exp(-L / flank): the cut falls to 1/e `flank` units
    // from its channel, whatever its depth, so a deep channel is a deeper
    // valley rather than a wider one that swallows the hill beside it.
    // Label-correcting worklist: a node is revisited only when its cut grew,
    // and a cut under `FLANK_FLOOR` is not worth carrying further — so the
    // work is the valleys, not the planet.
    const decay = new Float64Array(nbr.length);
    for (let q = 0; q < nbr.length; q++) decay[q] = Math.exp(-(nbrAngle[q] * radius) / flank);
    const queue = work.pit;          // reuse: the flood is done
    const queued = work.closed;
    queued.fill(0);
    let head = 0; let size = 0;
    for (let i = 0; i < count; i++) {
      if (cut[i] > FLANK_FLOOR) { queue[(head + size) % count] = i; size++; queued[i] = 1; }
    }
    while (size > 0) {
      const j = queue[head];
      head = head + 1 === count ? 0 : head + 1;
      size--;
      queued[j] = 0;
      flankVisits++;
      const cj = cut[j];
      for (let q = nbrStart[j]; q < nbrStart[j + 1]; q++) {
        const i = nbr[q];
        const v = cj * decay[q];
        if (v <= cut[i] + 1e-9) continue;
        cut[i] = v;
        if (v > FLANK_FLOOR && !queued[i]) {
          queue[(head + size) % count] = i; size++; queued[i] = 1;
        }
      }
    }
  }
  for (let i = 0; i < count; i++) {
    if (outlet[i]) continue;
    let hn = h0[i] - cut[i];
    if (hn < lim[i]) hn = lim[i];
    h[i] = hn;
  }
  flankMs = clock() - c3;

  // Carve-down only.
  const delta = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const d = h[i] - h0[i];
    delta[i] = d < 0 ? d : 0;
  }
  // Widen to what the ground mesh can draw: average with the neighbours,
  // then re-clamp. An average of carves is a carve, so this stays <= 0.
  if (smooth > 0) {
    const tmp = new Float32Array(count);
    for (let pass = 0; pass < smooth; pass++) {
      for (let i = 0; i < count; i++) {
        let s = 0; let w = 0;
        for (let q = nbrStart[i]; q < nbrStart[i + 1]; q++) { s += delta[nbr[q]]; w += 1; }
        tmp[i] = 0.5 * delta[i] + 0.5 * (w ? s / w : delta[i]);
      }
      for (let i = 0; i < count; i++) {
        let floorD = lim[i] - h0[i];
        if (floorD > 0) floorD = 0;
        const d = tmp[i];
        delta[i] = d < floorD ? floorD : d >= 0 ? 0 : d;
      }
    }
  }

  // Wetness: log drainage area between two thresholds, dry under water
  // (a lake is not a wet field, it is a lake) and on the watershed.
  const wet = new Float32Array(count);
  const lo = Math.log(Math.max(1e-6, wetArea[0]));
  const hi = Math.log(Math.max(wetArea[0] * 1.0001, wetArea[1]));
  for (let i = 0; i < count; i++) {
    if (outlet[i]) continue;
    let t = (Math.log(area[i]) - lo) / (hi - lo);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    wet[i] = t * t * (3 - 2 * t);
  }
  // A D8 channel is a chain of single nodes, and bilinear over a DIAGONAL
  // chain of single nodes is a string of beads. A soft dilation — each node
  // takes the larger of its own wetness and WET_SPREAD of its wettest
  // neighbour's — joins the beads into a line without lowering the peak, so
  // the shader's threshold still finds the stream (a plain average halved
  // it: the first capture's stream was a smudge at 40% strength).
  if (wetSmooth > 0) {
    const tmpW = new Float32Array(count);
    for (let pass = 0; pass < wetSmooth; pass++) {
      for (let i = 0; i < count; i++) {
        if (outlet[i]) { tmpW[i] = 0; continue; }
        let best = wet[i];
        for (let q = nbrStart[i]; q < nbrStart[i + 1]; q++) {
          const v = wet[nbr[q]] * WET_SPREAD;
          if (v > best) best = v;
        }
        tmpW[i] = best;
      }
      // …then one light average, which rounds the grid's staircase off the
      // line's edge (the dilation alone draws a river in right angles).
      for (let i = 0; i < count; i++) {
        if (outlet[i]) { wet[i] = 0; continue; }
        let s = 0;
        for (let q = nbrStart[i]; q < nbrStart[i + 1]; q++) s += tmpW[nbr[q]];
        const d = nbrStart[i + 1] - nbrStart[i];
        wet[i] = 0.6 * tmpW[i] + 0.4 * (d ? s / d : tmpW[i]);
      }
    }
  }

  let maxCarve = 0; let sumCarve = 0; let carved = 0; let maxArea = 0; let maxWet = 0;
  for (let i = 0; i < count; i++) {
    const d = -delta[i];
    if (d > maxCarve) maxCarve = d;
    if (d > 0.05) { carved++; sumCarve += d; }
    if (!outlet[i] && area[i] > maxArea) maxArea = area[i];
    if (wet[i] > maxWet) maxWet = wet[i];
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    h0, h, delta, area, wet, outlet, rec,
    stats: {
      n: grid.n, nodes: count, iterations, routes, outlets, placed,
      maxCarve, meanCarve: carved ? sumCarve / carved : 0,
      carvedShare: carved / count, maxArea, maxWet,
      sampleMs: tSample - t0, erodeMs: t1 - tSample, ms: t1 - t0,
      routeMs, lawMs, flankMs, flankVisits,
    },
  };
}

// ── Sampling across the cube, zero-allocation ────────────────────────────

/**
 * Per-face node arrays for a per-node field: (face, j, i) -> value. A node on
 * an edge or corner writes the SAME value into every face it sits on.
 */
export function faceValuesOf(grid, perNode, out = null) {
  const side = grid.n + 1;
  const len = 6 * side * side;
  const values = out && out.length === len ? out : new Float32Array(len);
  const fn = grid.faceNode;
  for (let k = 0; k < len; k++) values[k] = perNode[fn[k]];
  return values;
}

/**
 * Bilinear sample of a per-face field at a unit direction. Continuous across
 * face edges and corners because the shared nodes carry one value.
 * Zero-allocation: scalars only.
 */
export function sampleCubeField(values, n, nx, ny, nz) {
  const ax = nx < 0 ? -nx : nx;
  const ay = ny < 0 ? -ny : ny;
  const az = nz < 0 ? -nz : nz;
  let f; let mj; let u; let v;
  if (ax >= ay && ax >= az) { f = nx >= 0 ? 0 : 1; mj = ax; u = ny; v = nz; }
  else if (ay >= az) { f = ny >= 0 ? 2 : 3; mj = ay; u = nx; v = nz; }
  else { f = nz >= 0 ? 4 : 5; mj = az; u = nx; v = ny; }
  if (!(mj > 0)) return 0;
  const half = n * 0.5;
  let gi = (Math.atan(u / mj) * FOUR_OVER_PI + 1) * half;
  let gj = (Math.atan(v / mj) * FOUR_OVER_PI + 1) * half;
  if (gi < 0) gi = 0; else if (gi > n) gi = n;
  if (gj < 0) gj = 0; else if (gj > n) gj = n;
  let i0 = Math.floor(gi); if (i0 > n - 1) i0 = n - 1;
  let j0 = Math.floor(gj); if (j0 > n - 1) j0 = n - 1;
  const fi = gi - i0; const fj = gj - j0;
  const side = n + 1;
  const base = f * side * side + j0 * side + i0;
  const v00 = values[base]; const v10 = values[base + 1];
  const v01 = values[base + side]; const v11 = values[base + side + 1];
  const a = v00 + (v10 - v00) * fi;
  const b = v01 + (v11 - v01) * fi;
  return a + (b - a) * fj;
}

/**
 * The runtime handle the terrain functions read. `delta` and `wet` are
 * zero-allocation and cheap (two atan, four reads): the flight floor samples
 * `delta` several times a frame.
 */
export function createErosionField(grid, result) {
  return erosionFieldFromFaces(grid.n, faceValuesOf(grid, result.delta), faceValuesOf(grid, result.wet), result.stats);
}

/**
 * The same field from face arrays that already exist — a worker's result,
 * transferred — with no grid: the main thread never has to build the node
 * graph (several MB, tens of milliseconds) just to receive a bake.
 */
export function erosionFieldFromFaces(n, deltaFaces, wetFaces, stats = null) {
  const side = (n | 0) + 1;
  const len = 6 * side * side;
  if (!(deltaFaces instanceof Float32Array) || deltaFaces.length !== len
    || !(wetFaces instanceof Float32Array) || wetFaces.length !== len) {
    throw new Error(`erosionFieldFromFaces: expected two Float32Array(${len}) for n = ${n}`);
  }
  return {
    n,
    stats,
    deltaFaces,
    wetFaces,
    delta(nx, ny, nz) { return sampleCubeField(deltaFaces, n, nx, ny, nz); },
    wet(nx, ny, nz) { return sampleCubeField(wetFaces, n, nx, ny, nz); },
  };
}

/**
 * The wetness as an equirect byte map in the horizon map's convention
 * (texel (i, j) centre at phi = (i + .5)/W 2PI, theta = (j + .5)/H PI;
 * x = -cos phi sin theta, y = cos theta, z = sin phi sin theta; row 0 at +Y).
 * The ground shader samples it with u = atan(z, -x)/2PI, v = acos(y)/PI.
 */
export function bakeWetnessEquirect(field, width = 512, height = 256, out = null) {
  const bytes = out && out.length === width * height ? out : new Uint8Array(width * height);
  const cosPhi = new Float64Array(width);
  const sinPhi = new Float64Array(width);
  for (let i = 0; i < width; i++) {
    const phi = ((i + 0.5) / width) * Math.PI * 2;
    cosPhi[i] = Math.cos(phi); sinPhi[i] = Math.sin(phi);
  }
  const values = field.wetFaces; const n = field.n;
  for (let j = 0; j < height; j++) {
    const theta = ((j + 0.5) / height) * Math.PI;
    const st = Math.sin(theta); const ct = Math.cos(theta);
    for (let i = 0; i < width; i++) {
      const w = sampleCubeField(values, n, -cosPhi[i] * st, ct, sinPhi[i] * st);
      const b = Math.round(w * 255);
      bytes[j * width + i] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }
  return bytes;
}
