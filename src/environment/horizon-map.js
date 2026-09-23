/**
 * Horizon map — the planet's own shadow, baked once per world.
 *
 * Real shadow maps exist only at Ultra, cover a 110-unit square round the
 * bird, and have one receiver (the ground) and twenty casters (cone proxies
 * at the nest hosts plus the bird). Below Ultra nothing in this world casts
 * anything: a 40-unit ridge standing between a valley and a 20-degree sun
 * leaves the valley floor exactly as bright as the ridge top, and a grove of
 * 40-unit trees leaves no mark on the grass it stands in.
 *
 * A horizon map answers the question a shadow map answers — "can this point
 * see the sun?" — for EVERY sun direction at once, which is what makes it a
 * bake instead of a pass. For each texel of an equirect grid over the sphere
 * it stores, for 8 azimuths, the elevation angle of the highest thing on the
 * skyline in that direction. At runtime a fragment interpolates the two
 * azimuths either side of the sun and compares the sun's elevation with the
 * skyline: two texture fetches, no depth pass, no draw call, every preset.
 * The same eight angles give sky visibility for free (mean of cos^2 of the
 * horizon, which is the cosine-weighted share of the sky dome left open).
 *
 * Research lineage (docs/perf/gates/G-REALISM-ANALYTIC-SHADOWS.md):
 * Max 1988 (horizon mapping), Timonen & Westerholm 2010 (linear-time
 * horizons), Fritsch et al. HPG 2025 (planetary horizon maps, which is this
 * geometry: a CURVED planet, so every elevation is measured against the
 * texel's own radial up and the far side of the curvature drops away).
 *
 * Conventions — ONE definition, mirrored by horizon-shadow.js's GLSL:
 *
 *  - Texel (i, j) of a W x H grid has its centre at longitude
 *    phi = (i + 0.5) / W * 2PI and colatitude theta = (j + 0.5) / H * PI,
 *    with the SphereGeometry convention the ground mesh uses:
 *        x = -cos(phi) sin(theta),  y = cos(theta),  z = sin(phi) sin(theta)
 *    so u = atan2(z, -x) / 2PI and v = theta / PI (v = 0 at the +Y pole,
 *    row 0 of the data, DataTexture flipY false).
 *  - The local frame is East = normalize(Y x up), North = up x East. East is
 *    the direction of increasing u. At the exact poles East falls back to +X.
 *  - Azimuth a (0..7) is the direction cos(a PI/4) East + sin(a PI/4) North.
 *  - Angles are encoded angle / PI + 0.5 into a byte: [-90, 90] degrees at
 *    0.7 degrees a step, well inside the few-degree penumbra.
 *
 * Two eye heights, one occluder field. The OCCLUDER field is terrain plus
 * the tall props (canopies, spires, peaks, towers) splatted as solids. The
 * GROUND set looks out from the terrain surface — what the ground material
 * reads, so the forest floor between trees is shaded by the trees. The PROP
 * set looks out from the occluder ENVELOPE — the top surface of whatever is
 * standing there — so a canopy top reads its own skyline instead of the
 * inside of its own column. Where nothing stands on the ground the two are
 * the same number and the prop set is a copy; only texels under a prop are
 * marched twice.
 *
 * Pure: no THREE, no DOM. Deterministic: the same inputs give the same bytes.
 */

export const HORIZON_AZIMUTHS = 8;

export const HORIZON_MAP_DEFAULTS = Object.freeze({
  width: 512,
  height: 256,
  // The terrain field is sampled every `terrainStride` texels and bilinearly
  // upsampled: 4.4 units at 512x256, which is finer than the ground MESH the
  // player sees (6.7 units a vertex at the standard mobile resolution, 4.7
  // at High) — shadows of relief the mesh does not draw would be shadows of
  // nothing. The terrain field is ~1.2 us a sample in V8 (eight octaves of
  // 3D noise), so this is the difference between ~160 ms and ~18 ms of the
  // world build. The props, which do need the full resolution, are splatted
  // at full resolution afterwards.
  terrainStride: 3,
  // Geometric march: dense near the eye where a canopy edge is decided,
  // sparse far out where only ridges are big enough to matter.
  firstStep: 1.3,
  stepGrowth: 1.17,
  maxDistance: 84,
  // The eye sits this far above the surface. The mesh the player sees is a
  // linear interpolation of the same field at a coarser spacing, so without
  // a lift the texel's own neighbours shadow it along every terminator.
  eyeBias: 0.9,
  // An envelope this far above the terrain is a prop texel (prop set marched).
  propThreshold: 0.75,
});

const TAU = Math.PI * 2;

/** Byte for an elevation angle in radians. */
export function encodeHorizonAngle(angle) {
  const v = Math.round((angle / Math.PI + 0.5) * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Elevation angle in radians for a stored byte. */
export function decodeHorizonByte(byte) {
  return (byte / 255 - 0.5) * Math.PI;
}

// The ENVELOPE (occluder top) is stored too, one byte a texel, so a fragment
// standing well above it — a cloud, a snag, the upper storeys of a wall whose
// footprint is next door — can tell it is not where the skyline was measured
// from. Relative height over [-80, 120] units: 0.78 units a step.
export const ENVELOPE_MIN = -80;
export const ENVELOPE_RANGE = 200;

export function encodeEnvelopeHeight(h) {
  const v = Math.round(((h - ENVELOPE_MIN) / ENVELOPE_RANGE) * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function decodeEnvelopeByte(b) {
  return (b / 255) * ENVELOPE_RANGE + ENVELOPE_MIN;
}

/** Unit direction of texel (i, j)'s centre. Writes into `out`. */
export function horizonTexelDirection(i, j, width, height, out = { x: 0, y: 0, z: 0 }) {
  const phi = ((i + 0.5) / width) * TAU;
  const theta = ((j + 0.5) / height) * Math.PI;
  const st = Math.sin(theta);
  out.x = -Math.cos(phi) * st;
  out.y = Math.cos(theta);
  out.z = Math.sin(phi) * st;
  return out;
}

/** (u, v) of a unit direction; u in [0, 1), v in [0, 1]. The GLSL mirror. */
export function horizonUv(x, y, z, out = { u: 0, v: 0 }) {
  let u = Math.atan2(z, -x) / TAU;
  if (u < 0) u += 1;
  out.u = u;
  out.v = Math.acos(y < -1 ? -1 : y > 1 ? 1 : y) / Math.PI;
  return out;
}

/** East/North at a unit direction. The GLSL mirror. */
export function horizonFrame(x, y, z, out = {}) {
  let ex = z; let ez = -x;
  const el = Math.hypot(ex, ez);
  if (el > 1e-6) { ex /= el; ez /= el; } else { ex = 1; ez = 0; }
  out.ex = ex; out.ey = 0; out.ez = ez;
  // North = up x East
  out.nx = y * ez - z * 0;
  out.ny = z * ex - x * ez;
  out.nz = x * 0 - y * ex;
  return out;
}

/** The march distances (surface units). */
export function horizonSteps({ firstStep, stepGrowth, maxDistance } = HORIZON_MAP_DEFAULTS) {
  const out = [];
  for (let d = firstStep; d <= maxDistance + 1e-9; d *= stepGrowth) out.push(d);
  if (out[out.length - 1] < maxDistance) out.push(maxDistance);
  return Float64Array.from(out);
}

/**
 * Bilinear sample of a W x H equirect grid at grid coordinates (gx, gy),
 * where texel (i, j)'s centre is (i, j). Wraps in x, clamps in y. For tests
 * and build-time lookups; the bake's inner loop inlines the same arithmetic.
 */
export function sampleGrid(grid, width, height, gx, gy) {
  const fx0 = Math.floor(gx);
  const fx = gx - fx0;
  let x0 = fx0 % width; if (x0 < 0) x0 += width;
  const x1 = x0 + 1 === width ? 0 : x0 + 1;
  const fy0 = Math.floor(gy);
  const fy = gy - fy0;
  const y0 = fy0 < 0 ? 0 : fy0 > height - 1 ? height - 1 : fy0;
  const y1 = fy0 + 1 < 0 ? 0 : fy0 + 1 > height - 1 ? height - 1 : fy0 + 1;
  const a = grid[y0 * width + x0] + (grid[y0 * width + x1] - grid[y0 * width + x0]) * fx;
  const b = grid[y1 * width + x0] + (grid[y1 * width + x1] - grid[y1 * width + x0]) * fx;
  return a + (b - a) * fy;
}

/**
 * Fill `grid` (W x H, relative heights) from `heightAt(nx, ny, nz)`, sampling
 * every `stride` texels and bilinearly upsampling between. The coarse lattice
 * is sampled at texel centres of the full grid, so stride 1 is exact.
 */
export function fillHeightGrid(grid, width, height, heightAt, stride = 1) {
  const s = Math.max(1, Math.floor(stride));
  if (s === 1) {
    const d = { x: 0, y: 0, z: 0 };
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        horizonTexelDirection(i, j, width, height, d);
        grid[j * width + i] = heightAt(d.x, d.y, d.z);
      }
    }
    return grid;
  }
  // Coarse lattice: every s-th column (wrapping) and every s-th row plus the
  // last row, so the poles are sampled rather than extrapolated.
  const cw = Math.ceil(width / s);
  const rows = [];
  for (let j = 0; j < height; j += s) rows.push(j);
  if (rows[rows.length - 1] !== height - 1) rows.push(height - 1);
  const coarse = new Float32Array(cw * rows.length);
  const d = { x: 0, y: 0, z: 0 };
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cw; c++) {
      horizonTexelDirection(c * s, rows[r], width, height, d);
      coarse[r * cw + c] = heightAt(d.x, d.y, d.z);
    }
  }
  let r = 0;
  for (let j = 0; j < height; j++) {
    while (r < rows.length - 2 && rows[r + 1] < j) r++;
    const ja = rows[r]; const jb = rows[Math.min(r + 1, rows.length - 1)];
    const ty = jb === ja ? 0 : (j - ja) / (jb - ja);
    for (let i = 0; i < width; i++) {
      const cx = i / s;
      const c0 = Math.floor(cx);
      const tx = cx - c0;
      const ca = c0 % cw; const cb = (c0 + 1) % cw;
      // The last coarse column wraps to column 0, whose true distance is
      // (width - ca*s) texels rather than s when width is not a multiple.
      const span = cb === 0 ? width - ca * s : s;
      const txw = cb === 0 ? (i - ca * s) / span : tx;
      const top = coarse[r * cw + ca] + (coarse[r * cw + cb] - coarse[r * cw + ca]) * txw;
      const rb = Math.min(r + 1, rows.length - 1);
      const bot = coarse[rb * cw + ca] + (coarse[rb * cw + cb] - coarse[rb * cw + ca]) * txw;
      grid[j * width + i] = top + (bot - top) * ty;
    }
  }
  return grid;
}

// ── Occluder profiles ───────────────────────────────────────────────────────
// A prop is splatted as a solid standing on its footprint: at normalised
// footprint radius rho the solid's top is base + span * profile(rho). The
// profile is tabulated at PROFILE_SAMPLES points over [0, 1]; -1 means "no
// solid at this radius".
export const PROFILE_SAMPLES = 17;

/** Frustum of a cylinder (a cone when rTop is 0), normalised to max radius. */
export function frustumProfile(radiusTop, radiusBottom) {
  const rMax = Math.max(radiusTop, radiusBottom) || 1;
  const rt = radiusTop / rMax; const rb = radiusBottom / rMax;
  const out = new Float32Array(PROFILE_SAMPLES);
  for (let s = 0; s < PROFILE_SAMPLES; s++) {
    const rho = s / (PROFILE_SAMPLES - 1);
    if (rt >= rb) out[s] = rho <= rt + 1e-9 ? 1 : -1;
    else if (rho <= rt) out[s] = 1;
    else out[s] = rho <= rb + 1e-9 ? Math.max(0, (rb - rho) / (rb - rt)) : -1;
  }
  return out;
}

/** Solid of revolution of a (radius, height) polyline, e.g. LatheGeometry. */
export function latheProfile(points) {
  let rMax = 0; let yMin = Infinity; let yMax = -Infinity;
  for (const p of points) {
    const r = Math.abs(p.x); if (r > rMax) rMax = r;
    if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
  }
  const ys = yMax - yMin || 1; const rs = rMax || 1;
  const out = new Float32Array(PROFILE_SAMPLES);
  for (let s = 0; s < PROFILE_SAMPLES; s++) {
    const rho = s / (PROFILE_SAMPLES - 1);
    let best = -1;
    for (let k = 0; k + 1 < points.length; k++) {
      const r1 = Math.abs(points[k].x) / rs; const y1 = (points[k].y - yMin) / ys;
      const r2 = Math.abs(points[k + 1].x) / rs; const y2 = (points[k + 1].y - yMin) / ys;
      if (r1 >= rho - 1e-9 && y1 > best) best = y1;
      if (r2 >= rho - 1e-9 && y2 > best) best = y2;
      if ((r1 - rho) * (r2 - rho) < 0) {
        const y = y1 + (y2 - y1) * (rho - r1) / (r2 - r1);
        if (y > best) best = y;
      }
    }
    out[s] = best;
  }
  return out;
}

/** Upper half of an ellipsoid: the fallback for anything round. */
export function domeProfile() {
  const out = new Float32Array(PROFILE_SAMPLES);
  for (let s = 0; s < PROFILE_SAMPLES; s++) {
    const rho = s / (PROFILE_SAMPLES - 1);
    out[s] = Math.sqrt(Math.max(0, 1 - rho * rho));
  }
  return out;
}

/**
 * Splat one prop into the occluder grid (max).
 *
 * `prop` — plain numbers, in world units, relative heights (height above the
 * base radius, the same convention as the terrain field):
 *   dir: [x, y, z]    unit direction of the footprint centre
 *   ex, ez: [x,y,z]   the footprint's local X / Z axes in world (tangent)
 *   halfX, halfZ      footprint half-extents along ex / ez
 *   base, span        the solid's top at footprint radius rho is
 *                     base + span * profile(rho)
 *   profile           Float32Array(PROFILE_SAMPLES), or null for a BOX
 *                     (flat top at base + span over |lx|<=halfX, |lz|<=halfZ)
 * Returns the number of texels raised.
 */
export function splatProp(grid, width, height, radius, prop, scratch) {
  const { dir, ex, ez, halfX, halfZ, base, span, profile } = prop;
  const reach = Math.max(halfX, halfZ) * (profile ? 1 : Math.SQRT2);
  if (!(reach > 0) || !(span > 0)) return 0;
  // The footprint is anti-aliased: a texel whose centre is within half a
  // texel of the edge is raised by its COVERAGE rather than all or nothing.
  // A hard in/out test puts a staircase of 1.5-unit steps round every
  // canopy, and a shadow is that outline projected along the sun, so the
  // steps are what the ground shows.
  const texel = (Math.PI * radius) / height;
  const minHalf = Math.min(halfX, halfZ);
  const ang = (reach + texel) / radius + 1.5 * Math.PI / height;
  const cy = dir[1] < -1 ? -1 : dir[1] > 1 ? 1 : dir[1];
  const theta = Math.acos(cy);
  let phi = Math.atan2(dir[2], -dir[0]); if (phi < 0) phi += TAU;
  const j0 = Math.max(0, Math.floor(((theta - ang) / Math.PI) * height - 0.5));
  const j1 = Math.min(height - 1, Math.ceil(((theta + ang) / Math.PI) * height - 0.5));
  const sinT = scratch?.sinT; const cosT = scratch?.cosT;
  const cosP = scratch?.cosP; const sinP = scratch?.sinP;
  let raised = 0;
  for (let j = j0; j <= j1; j++) {
    const st = sinT ? sinT[j] : Math.sin(((j + 0.5) / height) * Math.PI);
    const ctj = cosT ? cosT[j] : Math.cos(((j + 0.5) / height) * Math.PI);
    // Columns within the angular reach at this row; the whole row near a pole.
    const dPhi = st > 1e-6 ? Math.min(Math.PI, ang / st) : Math.PI;
    const full = dPhi >= Math.PI - 1e-9;
    const i0 = full ? 0 : Math.floor(((phi - dPhi) / TAU) * width - 0.5);
    const i1 = full ? width - 1 : Math.ceil(((phi + dPhi) / TAU) * width - 0.5);
    for (let ii = i0; ii <= i1; ii++) {
      let i = ii % width; if (i < 0) i += width;
      const cp = cosP ? cosP[i] : Math.cos(((i + 0.5) / width) * TAU);
      const sp = sinP ? sinP[i] : Math.sin(((i + 0.5) / width) * TAU);
      const tx = -cp * st; const ty = ctj; const tz = sp * st;
      const dot = tx * dir[0] + ty * dir[1] + tz * dir[2];
      if (dot < 0.5) continue;
      // Offset from the footprint centre in the tangent plane, world units.
      const ox = (tx - dir[0] * dot) * radius;
      const oy = (ty - dir[1] * dot) * radius;
      const oz = (tz - dir[2] * dot) * radius;
      const lx = ox * ex[0] + oy * ex[1] + oz * ex[2];
      const lz = ox * ez[0] + oy * ez[1] + oz * ez[2];
      let top; let inside;
      if (!profile) {
        inside = Math.min(halfX - Math.abs(lx), halfZ - Math.abs(lz));
        top = base + span;
      } else {
        const rho = Math.sqrt((lx / halfX) * (lx / halfX) + (lz / halfZ) * (lz / halfZ));
        inside = (1 - rho) * minHalf;
        const f = (rho < 1 ? rho : 1) * (PROFILE_SAMPLES - 1);
        const s0 = Math.floor(f); const s1 = s0 + 1 < PROFILE_SAMPLES ? s0 + 1 : s0;
        const p0 = profile[s0]; const p1 = profile[s1];
        if (p0 < 0 && p1 < 0) continue;
        const pr = p0 < 0 ? p1 : p1 < 0 ? p0 : p0 + (p1 - p0) * (f - s0);
        top = base + span * pr;
      }
      const coverage = 0.5 + inside / texel;
      if (coverage <= 0) continue;
      const idx = j * width + i;
      const old = grid[idx];
      if (top <= old) continue;
      grid[idx] = coverage >= 1 ? top : old + (top - old) * coverage;
      raised++;
    }
  }
  return raised;
}

/** Per-row / per-column trig tables for splatting. */
export function createGridTrig(width, height) {
  const sinT = new Float64Array(height); const cosT = new Float64Array(height);
  const cosP = new Float64Array(width); const sinP = new Float64Array(width);
  for (let j = 0; j < height; j++) {
    const t = ((j + 0.5) / height) * Math.PI;
    sinT[j] = Math.sin(t); cosT[j] = Math.cos(t);
  }
  for (let i = 0; i < width; i++) {
    const p = ((i + 0.5) / width) * TAU;
    cosP[i] = Math.cos(p); sinP[i] = Math.sin(p);
  }
  return { sinT, cosT, cosP, sinP };
}

// ── The bake ────────────────────────────────────────────────────────────────

/**
 * Create a (time-sliceable) horizon bake.
 *
 *   terrain  Float32Array(W*H)  relative terrain height — the GROUND eye
 *   occluder Float32Array(W*H)  terrain + props (>= terrain) — what blocks
 *
 * `step(maxRows)` bakes up to `maxRows` rows and returns true when done.
 * Output: `ground` and `prop`, each [Uint8Array(W*H*4) x 2] — azimuths 0-3
 * in the first texture's RGBA, 4-7 in the second's.
 *
 * Every elevation is measured in the plane of the texel's own radial up and
 * the great circle it is marching along, from the true positions on the
 * sphere: tan(e) = (r_s cos b - r_e) / (r_s sin b), b the arc angle. The
 * curvature is therefore exact rather than corrected — a flat planet's
 * skyline falls away below the tangent plane exactly as far as a real one.
 */
export function createHorizonBake({
  radius, width, height, terrain, occluder,
  firstStep = HORIZON_MAP_DEFAULTS.firstStep,
  stepGrowth = HORIZON_MAP_DEFAULTS.stepGrowth,
  maxDistance = HORIZON_MAP_DEFAULTS.maxDistance,
  eyeBias = HORIZON_MAP_DEFAULTS.eyeBias,
  propThreshold = HORIZON_MAP_DEFAULTS.propThreshold,
} = {}) {
  const W = width; const H = height; const R = radius;
  const steps = horizonSteps({ firstStep, stepGrowth, maxDistance });
  const K = steps.length;
  const A = HORIZON_AZIMUTHS;
  const groundA = new Uint8Array(W * H * 4); const groundB = new Uint8Array(W * H * 4);
  const propA = new Uint8Array(W * H * 4); const propB = new Uint8Array(W * H * 4);

  // Per-step constants: cot(b) and 1/sin(b).
  const cotb = new Float64Array(K); const invsb = new Float64Array(K);
  const cosb = new Float64Array(K); const sinb = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const b = steps[k] / R;
    cosb[k] = Math.cos(b); sinb[k] = Math.sin(b);
    cotb[k] = cosb[k] / sinb[k]; invsb[k] = 1 / sinb[k];
  }
  const cosA = new Float64Array(A); const sinA = new Float64Array(A);
  for (let a = 0; a < A; a++) { cosA[a] = Math.cos((a * TAU) / A); sinA[a] = Math.sin((a * TAU) / A); }

  // Row constants for (a, k): row offsets, fy, integer + fractional x offset.
  const NC = A * K;
  const rowOff0 = new Int32Array(NC); const rowOff1 = new Int32Array(NC);
  const fyArr = new Float64Array(NC); const dxArr = new Int32Array(NC); const fxArr = new Float64Array(NC);
  const maxT = new Float64Array(A * W);
  const eyeR = new Float64Array(W);
  // 1 / (R + h) for the whole occluder field, so the inner loop multiplies
  // instead of divides. Interpolating the reciprocal instead of the radius is
  // a difference of (h/R)^2 — under 0.1% at the deepest carve.
  const invR = new Float32Array(W * H);
  for (let n = 0; n < W * H; n++) invR[n] = 1 / (R + occluder[n]);

  let row = 0;
  let marched = 0;       // samples taken, for the stats
  let propTexels = 0;

  function rowConstants(j) {
    const theta0 = ((j + 0.5) / H) * Math.PI;
    const st = Math.sin(theta0); const ct = Math.cos(theta0);
    // At longitude 0: U = (-st, ct, 0), East = (0, 0, 1), North = (ct, st, 0).
    for (let a = 0; a < A; a++) {
      const dx = sinA[a] * ct; const dy = sinA[a] * st; const dz = cosA[a];
      for (let k = 0; k < K; k++) {
        const c = a * K + k;
        const px = -cosb[k] * st + sinb[k] * dx;
        const py = cosb[k] * ct + sinb[k] * dy;
        const pz = sinb[k] * dz;
        const theta = Math.acos(py < -1 ? -1 : py > 1 ? 1 : py);
        const phi = Math.atan2(pz, -px);
        const gy = (theta / Math.PI) * H - 0.5;
        const y0 = Math.floor(gy);
        fyArr[c] = gy - y0;
        rowOff0[c] = (y0 < 0 ? 0 : y0 > H - 1 ? H - 1 : y0) * W;
        rowOff1[c] = (y0 + 1 < 0 ? 0 : y0 + 1 > H - 1 ? H - 1 : y0 + 1) * W;
        const ox = (phi / TAU) * W;
        const ox0 = Math.floor(ox);
        dxArr[c] = ox0; fxArr[c] = ox - ox0;
      }
    }
  }

  function writeAngles(dstA, dstB, j, i, a, tanE) {
    const b = encodeHorizonAngle(Math.atan(tanE));
    const px = (j * W + i) * 4 + (a & 3);
    if (a < 4) dstA[px] = b; else dstB[px] = b;
  }

  function bakeRow(j) {
    rowConstants(j);
    const base = j * W;
    for (let i = 0; i < W; i++) eyeR[i] = R + terrain[base + i] + eyeBias;
    maxT.fill(-1e9);
    // Ground set: every texel, (a, k) outer so the inner loop walks two grid
    // rows sequentially. The column offset is the same for the whole row, so
    // the wrap is resolved once into three straight segments and the hot
    // loop has no branch but the max.
    for (let a = 0; a < A; a++) {
      const mo = a * W;
      for (let k = 0; k < K; k++) {
        const c = a * K + k;
        const r0 = rowOff0[c]; const r1 = rowOff1[c];
        const fy = fyArr[c]; const fx = fxArr[c];
        const w00 = (1 - fx) * (1 - fy); const w01 = fx * (1 - fy);
        const w10 = (1 - fx) * fy; const w11 = fx * fy;
        const cb = cotb[k]; const ib = invsb[k];
        const start = ((dxArr[c] % W) + W) % W;   // x0 of texel 0
        // i in [0, W-1-start): x0 = start + i, x1 = x0 + 1
        const seg1 = W - 1 - start;
        for (let i = 0; i < seg1; i++) {
          const x0 = start + i;
          const inv = invR[r0 + x0] * w00 + invR[r0 + x0 + 1] * w01
            + invR[r1 + x0] * w10 + invR[r1 + x0 + 1] * w11;
          const t = cb - eyeR[i] * ib * inv;
          if (t > maxT[mo + i]) maxT[mo + i] = t;
        }
        // i = seg1: x0 = W - 1, x1 = 0
        {
          const i = seg1;
          const inv = invR[r0 + W - 1] * w00 + invR[r0] * w01
            + invR[r1 + W - 1] * w10 + invR[r1] * w11;
          const t = cb - eyeR[i] * ib * inv;
          if (t > maxT[mo + i]) maxT[mo + i] = t;
        }
        // i in (seg1, W): x0 = i - seg1 - 1
        for (let i = seg1 + 1; i < W; i++) {
          const x0 = i - seg1 - 1;
          const inv = invR[r0 + x0] * w00 + invR[r0 + x0 + 1] * w01
            + invR[r1 + x0] * w10 + invR[r1 + x0 + 1] * w11;
          const t = cb - eyeR[i] * ib * inv;
          if (t > maxT[mo + i]) maxT[mo + i] = t;
        }
      }
    }
    marched += W * A * K;
    for (let a = 0; a < A; a++) {
      const mo = a * W;
      for (let i = 0; i < W; i++) writeAngles(groundA, groundB, j, i, a, maxT[mo + i]);
    }
    // Prop set: a copy, re-marched only where something stands on the ground.
    const pxBase = base * 4;
    propA.set(groundA.subarray(pxBase, pxBase + W * 4), pxBase);
    propB.set(groundB.subarray(pxBase, pxBase + W * 4), pxBase);
    for (let i = 0; i < W; i++) {
      const envelope = occluder[base + i];
      if (envelope - terrain[base + i] < propThreshold) continue;
      propTexels++;
      const er = R + envelope + eyeBias;
      for (let a = 0; a < A; a++) {
        let best = -1e9;
        for (let k = 0; k < K; k++) {
          const c = a * K + k;
          let x0 = i + dxArr[c];
          if (x0 >= W || x0 < 0) x0 = ((x0 % W) + W) % W;
          const x1 = x0 + 1 === W ? 0 : x0 + 1;
          const r0 = rowOff0[c]; const r1 = rowOff1[c];
          const fx = fxArr[c];
          const top = invR[r0 + x0] + (invR[r0 + x1] - invR[r0 + x0]) * fx;
          const inv = top + (invR[r1 + x0] + (invR[r1 + x1] - invR[r1 + x0]) * fx - top) * fyArr[c];
          const t = cotb[k] - er * invsb[k] * inv;
          if (t > best) best = t;
        }
        marched += K;
        writeAngles(propA, propB, j, i, a, best);
      }
    }
  }

  return {
    width: W, height: H, steps,
    ground: [groundA, groundB],
    prop: [propA, propB],
    get done() { return row >= H; },
    get progress() { return row / H; },
    get marched() { return marched; },
    get propTexels() { return propTexels; },
    /** Bake up to `maxRows` rows; true when the whole map is done. */
    step(maxRows = H) {
      const end = Math.min(H, row + Math.max(1, maxRows));
      for (; row < end; row++) bakeRow(row);
      return row >= H;
    },
  };
}

// ── Runtime reference (the GLSL's mirror, for tests and debug readback) ────

/** Decoded 8 angles of texel (i, j) from a packed pair. */
export function texelAngles(pair, width, i, j, out = new Float64Array(HORIZON_AZIMUTHS)) {
  const px = (j * width + i) * 4;
  for (let a = 0; a < 4; a++) {
    out[a] = decodeHorizonByte(pair[0][px + a]);
    out[a + 4] = decodeHorizonByte(pair[1][px + a]);
  }
  return out;
}

/** Skyline elevation toward `azimuth` (radians from East toward North). */
export function horizonAt(angles, azimuth) {
  const step = TAU / HORIZON_AZIMUTHS;
  let f = azimuth / step;
  f -= Math.floor(f / HORIZON_AZIMUTHS) * HORIZON_AZIMUTHS;
  const a0 = Math.floor(f) % HORIZON_AZIMUTHS;
  const a1 = (a0 + 1) % HORIZON_AZIMUTHS;
  const t = f - Math.floor(f);
  return angles[a0] + (angles[a1] - angles[a0]) * t;
}

/** 0..1 how much of the sun clears the skyline (smoothstep penumbra). */
export function sunVisibility(angles, sunAzimuth, sunElevation, penumbra = 0.045) {
  const h = horizonAt(angles, sunAzimuth);
  const lo = h - penumbra; const hi = h + penumbra;
  const t = Math.max(0, Math.min(1, (sunElevation - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * Cosine-weighted share of the sky dome left open: for a skyline at
 * elevation h in one azimuth slice, the open sky above it contributes
 * integral_h^(PI/2) sin e cos e de = cos^2(h) / 2, normalised by the
 * unobstructed 1/2. Below-horizon skylines (h < 0) leave the whole dome open.
 */
export function skyVisibility(angles) {
  let s = 0;
  for (let a = 0; a < HORIZON_AZIMUTHS; a++) {
    const h = angles[a] > 0 ? angles[a] : 0;
    const c = Math.cos(h);
    s += c * c;
  }
  return s / HORIZON_AZIMUTHS;
}
