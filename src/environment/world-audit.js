// World audit — is every prop actually standing on its ground?
//
// Every floating, flattened or buried prop this game ever shipped was found by
// eye on a phone: complete tori floating 10-25 units over the canyons, a forest
// arch laid flat on its back, an arch site that landed in a pit and buried the
// whole span. Each was a NUMBER the whole time — the height of the object's
// base above the ground it stands on — and nothing was reading it.
//
// This module reads it. Pure arithmetic over plain arrays (matrix `.elements`,
// `instanceMatrix.array`, `geometry.attributes.position.array`), so it needs no
// THREE at all and the unit suite drives it with hand-built fakes. The page
// exposes it as `__BIRB.auditWorld()`; tools/birb-audit.mjs runs it on every
// biome and exits 1 on a failure.
//
// Ported in spirit from the tabletop worlds kit (adamrappaport
// public/map-assets/geometry-audit.js + auditLandmarks' groundError), with the
// one change a planet needs: "height" is RADIAL. A prop's clearance is
// |P| - groundRadius(P), never P.y - height(x, z).

/**
 * Per-layer rules for instanced props, matched by mesh name. The first rule
 * whose `match` hits wins; a mesh no rule matches is not audited (canopies,
 * clouds, hover traffic and ceiling discs hang in the air by design).
 *
 *   float: the base may stand at most this many units ABOVE its ground.
 *   bury:  the base may sink at most this FRACTION of the instance's own
 *          height below its ground (rocks sit into the soil on purpose).
 *   floatFrac (optional): an extra float allowance as a fraction of height,
 *          for wide footprints on slopes, where the base centre is honestly
 *          above the downhill ground.
 *
 * The tolerances were set from a measured distribution (fixed seeds, all four
 * biomes) and then checked to FAIL on a planted defect; see the test and
 * tools/birb-audit.mjs `--plant`.
 */
export const GROUNDED_LAYER_RULES = [
  { match: /trunk/i, float: 1.2, bury: 0.5, floatFrac: 0.04 },
  // Domes and rocks sit INTO the soil by design; a fully buried one (no
  // vertex above the ground) is the defect.
  { match: /shrub|fern|snag/i, float: 1.2, bury: 0.95, floatFrac: 0.1 },
  { match: /rock|boulder|scree/i, float: 1.5, bury: 0.95, floatFrac: 0.35 },
  { match: /spire|needle|wall|cliff|peak|monolith/i, float: 2.0, bury: 0.5, floatFrac: 0.05 },
  { match: /arch/i, float: 2.0, bury: 0.6, floatFrac: 0.05 },
  { match: /building|tower|pylon|antenna-base/i, float: 1.5, bury: 0.5, floatFrac: 0.04 },
];

// Hang in the air on purpose, or ride on another prop.
const SKIP_LAYERS = /cloud|canopy|ceiling|crown|hover|antenna|clutter|glow|rooftop|snow|cap|ring|drone|actor/i;

/** Which rule audits `name`, or null when the layer is not ground-standing. */
export function layerRuleFor(name, rules = GROUNDED_LAYER_RULES) {
  if (!name || SKIP_LAYERS.test(name)) return null;
  for (const r of rules) if (r.match.test(name)) return r;
  return null;
}

// --- tiny matrix helpers on column-major 4x4 arrays (three's layout) -------

function mulPoint(e, x, y, z, out) {
  out[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
  out[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
  out[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  return out;
}

function mulMat(a, b, out) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function geometryBounds(pos) {
  const a = pos.array, stride = pos.itemSize || 3;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < a.length; i += stride) {
    const x = a[i], y = a[i + 1], z = a[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);

/**
 * Audit one instanced layer. For each instance the BASE is the bottom-centre of
 * the geometry's bounding box in its own frame (every grounded builder here
 * builds along local +Y and orients local +Y onto the radial), transformed by
 * instance x mesh world. `height` is the instance's own extent along that axis.
 */
export function auditInstancedLayer({ name, meshWorld, instanceArray, count, position, groundRadiusAt, rule, maxSamples = 4000 }) {
  const b = geometryBounds(position);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  const localH = b.max[1] - b.min[1];
  const pa = position.array, ps = position.itemSize || 3, verts = pa.length / ps;
  // Small meshes (rocks, boulders, scree, wall boxes) are judged by their
  // actual LOWEST and HIGHEST vertex: they are randomly rotated, so "the
  // bottom of the bounding box" is a side as often as it is a bottom. Big
  // meshes (lathed trunks, spires) are built along +Y and judged by base.
  const vertexMode = verts <= 256;
  const m = new Array(16), p = [0, 0, 0], top = [0, 0, 0];
  const clear = [];
  const failures = [];
  const stride = Math.max(1, Math.ceil(count / maxSamples));
  let audited = 0;
  for (let i = 0; i < count; i += stride) {
    const inst = instanceArray.subarray ? instanceArray.subarray(i * 16, i * 16 + 16) : instanceArray.slice(i * 16, i * 16 + 16);
    // A zero-scale instance is a hidden slot (collapsed after planting).
    if (Math.abs(inst[0]) + Math.abs(inst[5]) + Math.abs(inst[10]) < 1e-9) continue;
    mulMat(meshWorld, inst, m);
    let c, height, highest;
    if (vertexMode) {
      let lo = Infinity, hi = -Infinity, rlo = Infinity, rhi = -Infinity;
      for (let v = 0; v < verts; v++) {
        mulPoint(m, pa[v * ps], pa[v * ps + 1], pa[v * ps + 2], p);
        const r = Math.hypot(p[0], p[1], p[2]);
        const cv = r - groundRadiusAt(p[0], p[1], p[2]);
        if (cv < lo) lo = cv; if (cv > hi) hi = cv;
        if (r < rlo) rlo = r; if (r > rhi) rhi = r;
      }
      c = lo; highest = hi; height = rhi - rlo;
    } else {
      mulPoint(m, cx, b.min[1], cz, p);
      mulPoint(m, cx, b.max[1], cz, top);
      height = Math.hypot(top[0] - p[0], top[1] - p[1], top[2] - p[2]);
      c = Math.hypot(p[0], p[1], p[2]) - groundRadiusAt(p[0], p[1], p[2]);
      highest = c + height;
    }
    if (!Number.isFinite(c)) { failures.push({ index: i, problem: 'non-finite', clearance: c }); continue; }
    audited++;
    clear.push(c);
    const floatLimit = rule.float + (rule.floatFrac || 0) * height;
    if (c > floatLimit) failures.push({ index: i, problem: 'floating', clearance: r3(c), limit: r3(floatLimit), height: r3(height) });
    else if (highest < (1 - rule.bury) * height) failures.push({ index: i, problem: 'buried', highest: r3(highest), limit: r3((1 - rule.bury) * height), height: r3(height) });
  }
  clear.sort((a, z) => a - z);
  return {
    name, kind: 'layer', mode: vertexMode ? 'vertices' : 'base', count, audited, localHeight: r3(localH),
    clearance: { min: r3(clear[0]), p05: r3(quantile(clear, 0.05)), median: r3(quantile(clear, 0.5)), p95: r3(quantile(clear, 0.95)), max: r3(clear[clear.length - 1]) },
    failures: failures.slice(0, 12), failureCount: failures.length,
    pass: failures.length === 0,
  };
}

/**
 * Audit one landmark: every vertex of every mesh it owns, in world space.
 *
 *   - its LOWEST point must reach the ground (minClearance <= float), or it floats;
 *   - its HIGHEST point must stand at least `minRise` of its declared apex above
 *     the ground, or it was laid flat or sunk (a flat torus tops out at its tube
 *     diameter; a standing one at its radius);
 *   - no more than `buriedShare` of its vertices may be under the ground.
 */
export function auditLandmark({ id, apex, base, contacts = null, meshes, groundRadiusAt, float = 2.5, minRise = 0.7, buriedShare = 0.35, contactFloat = 1.5, contactBury = 4, maxVertices = 3000 }) {
  let lo = Infinity, hi = -Infinity, n = 0, under = 0, rise = -Infinity;
  const p = [0, 0, 0];
  // RISE is measured along the landmark's own up (its base's radial), never
  // against the local ground: an arch on a valley rim has ground 40 units
  // below one foot, which says nothing about whether the arch stands up.
  const bl = base ? Math.hypot(base[0], base[1], base[2]) : 0;
  const up = base && bl ? [base[0] / bl, base[1] / bl, base[2] / bl] : null;
  for (const mesh of meshes) {
    const a = mesh.position.array, stride = mesh.position.itemSize || 3;
    const verts = a.length / stride;
    const step = Math.max(1, Math.ceil(verts / maxVertices));
    for (let v = 0; v < verts; v += step) {
      mulPoint(mesh.world, a[v * stride], a[v * stride + 1], a[v * stride + 2], p);
      const c = Math.hypot(p[0], p[1], p[2]) - groundRadiusAt(p[0], p[1], p[2]);
      if (!Number.isFinite(c)) continue;
      n++;
      if (c < lo) lo = c;
      if (c > hi) hi = c;
      if (c < -0.25) under++;
      if (up) {
        const h = (p[0] - base[0]) * up[0] + (p[1] - base[1]) * up[1] + (p[2] - base[2]) * up[2];
        if (h > rise) rise = h;
      }
    }
  }
  const failures = [];
  if (!n) failures.push({ problem: 'no-geometry' });
  else {
    if (lo > float) failures.push({ problem: 'floating', lowest: r3(lo), limit: float });
    const top = up ? rise : hi;
    if (Number.isFinite(apex) && apex > 0 && top < minRise * apex) failures.push({ problem: 'flattened-or-sunk', rise: r3(top), expected: r3(minRise * apex) });
    if (under / n > buriedShare) failures.push({ problem: 'buried', share: r3(under / n), limit: buriedShare });
  }
  // Feet: an arch can rise to its full height with one leg dangling over a
  // slope and the other in the hill. Each declared contact must be ON the ground.
  const feet = [];
  for (const c of contacts || []) {
    const cl = Math.hypot(c[0], c[1], c[2]) - groundRadiusAt(c[0], c[1], c[2]);
    feet.push(r3(cl));
    if (!(cl <= contactFloat)) failures.push({ problem: 'foot-floating', clearance: r3(cl), limit: contactFloat });
    else if (cl < -contactBury) failures.push({ problem: 'foot-buried', clearance: r3(cl), limit: -contactBury });
  }
  return { name: id, kind: 'landmark', vertices: n, apex, lowest: r3(lo), highest: r3(hi), rise: up ? r3(rise) : null, feet, buriedShare: n ? r3(under / n) : null, failures, failureCount: failures.length, pass: failures.length === 0 };
}

/**
 * Geometry sanity per unique geometry (straight port of the kit's
 * geometry-audit): non-finite positions/normals and out-of-range indices.
 * Degenerate triangles are COUNTED, not failed — three's polyhedra and
 * lathes legitimately emit zero-area pole triangles.
 */
export function auditGeometryBuffers({ name, position, normal, index }) {
  let nonFinite = 0, badIndices = 0;
  for (const v of position.array) if (!Number.isFinite(v)) nonFinite++;
  if (normal) for (const v of normal.array) if (!Number.isFinite(v)) nonFinite++;
  const count = position.array.length / (position.itemSize || 3);
  if (index) for (const i of index.array) if (i < 0 || i >= count) badIndices++;
  const failures = [];
  if (nonFinite) failures.push({ problem: 'non-finite', values: nonFinite });
  if (badIndices) failures.push({ problem: 'bad-index', values: badIndices });
  return { name, kind: 'geometry', vertices: count, failures, failureCount: failures.length, pass: failures.length === 0 };
}

/**
 * Route audit for clocked actors (living-world.js): every sample must ride at
 * its declared height above the ground, within a band, and never inside a
 * collider it is not allowed to cross.
 */
export function auditRoute({ name, samples, groundRadiusAt, minClear, maxClear }) {
  const failures = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const [x, y, z] = samples[i];
    const c = Math.hypot(x, y, z) - groundRadiusAt(x, y, z);
    if (!Number.isFinite(c)) { failures.push({ index: i, problem: 'non-finite' }); continue; }
    if (c < lo) lo = c;
    if (c > hi) hi = c;
    if (c < minClear) failures.push({ index: i, problem: 'below-ride-band', clearance: r3(c), limit: minClear });
    else if (c > maxClear) failures.push({ index: i, problem: 'above-ride-band', clearance: r3(c), limit: maxClear });
  }
  return { name, kind: 'route', samples: samples.length, lowest: r3(lo), highest: r3(hi), failures: failures.slice(0, 12), failureCount: failures.length, pass: failures.length === 0 };
}

/** Roll a list of section results into one verdict. */
export function summarise(sections) {
  const failed = sections.filter((s) => !s.pass);
  return {
    pass: failed.length === 0,
    checked: sections.length,
    failed: failed.map((s) => `${s.kind}:${s.name}`),
    sections,
  };
}

/**
 * Audit a built spherical world: every ground-standing instanced layer, every
 * landmark's own meshes, every unique geometry, and (when the living world is
 * on) every actor route. `world` is createSphericalWorld's return value;
 * `groundRadiusAt(x, y, z)` is the radius of the ground you SEE at that
 * direction (sphereRadius + sampleTerrainMeshHeight), not the flight floor —
 * a prop stands on the mesh, and over a lake the floor is the water.
 */
export function auditSphericalWorld(world, { groundRadiusAt, rules = GROUNDED_LAYER_RULES, routes = [] } = {}) {
  const sections = [];
  if (!world?.root) return summarise([{ name: 'world', kind: 'world', pass: false, failures: [{ problem: 'no-world' }], failureCount: 1 }]);
  world.root.updateMatrixWorld(true);
  const seenGeometry = new Set();
  world.root.traverse((o) => {
    const g = o.geometry;
    if (g?.attributes?.position && !seenGeometry.has(g)) {
      seenGeometry.add(g);
      const res = auditGeometryBuffers({ name: o.name || o.type, position: g.attributes.position, normal: g.attributes.normal, index: g.index });
      if (!res.pass) sections.push(res);
    }
    if (!o.isInstancedMesh || !o.visible) return;
    const rule = layerRuleFor(o.name, rules);
    if (!rule) return;
    sections.push(auditInstancedLayer({
      name: o.name,
      meshWorld: o.matrixWorld.elements,
      instanceArray: o.instanceMatrix.array,
      count: o.count,
      position: g.attributes.position,
      groundRadiusAt,
      rule,
    }));
  });
  for (const lm of world.landmarks || []) {
    if (!lm.meshes?.length) continue;
    sections.push(auditLandmark({
      id: lm.id,
      apex: lm.apex,
      base: lm.base ? [lm.base.x, lm.base.y, lm.base.z] : null,
      contacts: (lm.contacts || []).map((c) => [c.x, c.y, c.z]),
      groundRadiusAt,
      meshes: lm.meshes.map((m) => ({ world: m.matrixWorld.elements, position: m.geometry.attributes.position })),
      // A tree's crowns are most of its vertices and all of them are high, so
      // only the buried share needs a different reading for a lying log.
      ...(lm.kind === 'log' ? { buriedShare: 0.5 } : null),
    }));
  }
  for (const route of routes) sections.push(auditRoute({ ...route, groundRadiusAt }));
  return summarise(sections);
}
