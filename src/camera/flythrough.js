// Flythrough kernel — camera shots as DATA, evaluated by shot time.
//
// Ported from the tabletop worlds kit (adamrappaport
// public/map-assets/flythrough.js). A shot is a list of keyframes whose
// positions and look targets are REFERENCES into the live world, re-resolved
// on every sample, so a camera can chase an actor that is itself a pure
// function of scene time. Centripetal Catmull-Rom through the resolved
// points, keyframe-indexed so key i is reached exactly at t_i.
//
// What changes on a planet:
//   - there is no turntable `yaw`, and no `{view}` preset;
//   - "up" is radial: an actor offset is [along, up, side] in the actor's own
//     frame (forward, normalize(position), forward x up), a landmark offset is
//     in the landmark's tangent frame;
//   - the audit's clearance is |p| - groundRadius(p), never p.y - height(x,z);
//   - the camera's up vector is the local radial, so the horizon is level
//     wherever on the sphere the shot flies.
//
// No DOM. THREE is injected (the page passes esm.sh three; tests pass a tiny
// fake), so the unit suite can drive every path.

export const EASE = {
  linear: (u) => u,
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  inOut: (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
  smooth: (u) => u * u * (3 - 2 * u),
};

const smoothstep = (u) => { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x); };

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }
function norm(a) { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function addScaled(a, b, s) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; }

/** A tangent frame at unit `up`: a stable `east` (from world Y unless at a pole) and `north`. */
export function tangentFrame(up, hint = null) {
  let e = hint ? norm(addScaled(hint, up, -dot(hint, up))) : null;
  if (!e || !Number.isFinite(e[0]) || len(e) < 0.5) {
    e = cross([0, 1, 0], up);
    if (len(e) < 1e-6) e = [1, 0, 0];
    e = norm(e);
  }
  const n = cross(up, e);
  return { east: e, north: n };
}

/** [along, up, side] in an actor's own frame → world point. */
export function actorFrame(position, forward, offset = [0, 0, 0]) {
  const up = norm(position);
  const f = norm(addScaled(forward, up, -dot(forward, up)));
  const side = cross(f, up);
  return [
    position[0] + f[0] * offset[0] + up[0] * offset[1] + side[0] * offset[2],
    position[1] + f[1] * offset[0] + up[1] * offset[1] + side[1] * offset[2],
    position[2] + f[2] * offset[0] + up[2] * offset[1] + side[2] * offset[2],
  ];
}

/**
 * Resolve one reference to a world point [x, y, z].
 *
 *   [x, y, z]                                    fixed point
 *   { landmark: id, offset: [fwd, up, side] }    from the landmark's base,
 *                                                 in its own tangent frame
 *   { around: id, radius, height, angle }        on a circle round a landmark
 *                                                 (radians from its forward)
 *   { actor: name, offset: [along, up, side] }   a moving thing at scene time
 *   { bird: true, offset }                        where the bird is now
 */
export function resolveRef(ref, ctx, sceneTime, variant = null) {
  if (Array.isArray(ref)) return ref.slice(0, 3);
  if (!ref || typeof ref !== 'object') throw new Error('bad ref: ' + JSON.stringify(ref));
  if (ref.actor) {
    const a = ctx.actors?.[ref.actor];
    if (!a) throw new Error(`unknown actor "${ref.actor}"`);
    const s = a.stateAt(sceneTime);
    return actorFrame(s.position, s.forward, ref.offset || [0, 0, 0]);
  }
  if (ref.landmark || ref.around) {
    const id = ref.landmark || ref.around;
    const lm = ctx.landmark?.(id);
    if (!lm) throw new Error(`unknown landmark "${id}"`);
    const base = lm.base || lm.position;
    const up = norm(base);
    const { east, north } = tangentFrame(up, lm.forward || null);
    // A planning variant turns the whole flight round the landmark (`spin`)
    // and widens it (`scale`), so a shot can route round a tower or a crown
    // a random world put in its way without anyone re-authoring it.
    const spin = variant?.spin || 0, scl = variant?.scale || 1;
    if (ref.around) {
      const a = (ref.angle || 0) + spin, r = (ref.radius ?? 40) * scl, h = ref.height ?? 15;
      return [
        base[0] + east[0] * Math.cos(a) * r + north[0] * Math.sin(a) * r + up[0] * h,
        base[1] + east[1] * Math.cos(a) * r + north[1] * Math.sin(a) * r + up[1] * h,
        base[2] + east[2] * Math.cos(a) * r + north[2] * Math.sin(a) * r + up[2] * h,
      ];
    }
    const o0 = ref.offset || [0, lm.apex ? lm.apex * 0.5 : 0, 0];
    const cs = Math.cos(spin), sn = Math.sin(spin);
    const o = [(o0[0] * cs - o0[2] * sn) * scl, o0[1], (o0[0] * sn + o0[2] * cs) * scl];
    return [
      base[0] + east[0] * o[0] + up[0] * o[1] + north[0] * o[2],
      base[1] + east[1] * o[0] + up[1] * o[1] + north[1] * o[2],
      base[2] + east[2] * o[0] + up[2] * o[1] + north[2] * o[2],
    ];
  }
  if (ref.bird) {
    const b = ctx.bird?.();
    if (!b) throw new Error('no bird');
    return actorFrame(b.position, b.forward, ref.offset || [0, 0, 0]);
  }
  throw new Error('bad ref: ' + JSON.stringify(ref));
}

/** Scene time at which a shot must start so an actor hits a phase on cue. */
export function solveStartSceneTime(clock, actors) {
  if (!clock) return 0;
  if (Number.isFinite(clock.sceneTime)) return clock.sceneTime;
  const a = actors?.[clock.actor];
  if (!a) throw new Error(`clock: unknown actor "${clock.actor}"`);
  const ph = (a.phases || []).find((p) => p.name === clock.phase);
  if (!ph) throw new Error(`clock: actor "${clock.actor}" has no phase "${clock.phase}"`);
  const target = ph.start + (clock.progress ?? 0) * ph.length;
  const t = target - (clock.atShotTime ?? 0);
  const c = a.cycle || 0;
  return c > 0 ? ((t % c) + c) % c : t;
}

function validate(spec) {
  if (!spec || !Array.isArray(spec.keys) || spec.keys.length < 2) throw new Error('a shot needs at least two keys');
  if (spec.keys[0].t !== 0) throw new Error('the first key must be at t = 0');
  for (let i = 1; i < spec.keys.length; i++) {
    if (!(spec.keys[i].t > spec.keys[i - 1].t)) throw new Error(`key ${i}: t must increase`);
  }
  if (spec.fade) for (let i = 1; i < spec.fade.length; i++) {
    if (!(spec.fade[i][0] > spec.fade[i - 1][0])) throw new Error(`fade ${i}: t must increase`);
  }
}

function fadeAt(fade, t) {
  if (!fade || !fade.length) return 0;
  if (t <= fade[0][0]) return fade[0][1];
  for (let i = 1; i < fade.length; i++) {
    if (t <= fade[i][0]) {
      const [t0, a0] = fade[i - 1], [t1, a1] = fade[i];
      return a0 + (a1 - a0) * smoothstep((t - t0) / (t1 - t0));
    }
  }
  return fade[fade.length - 1][1];
}

/**
 * Compile a shot against a context:
 *   { THREE, actors, landmark(id) -> {base, position, forward, apex}, bird() }
 * Returns { name, title, duration, startSceneTime, sample(t) }.
 * sample(t) -> { t, sceneTime, position: [3], lookAt: [3], up: [3], fov, fade, segment, lead? }
 */
export function compileShot(spec, ctx, { raise = 0, spin = 0, scale = 1 } = {}) {
  const variant = { spin, scale };
  validate(spec);
  const { THREE } = ctx;
  const keys = spec.keys;
  const n = keys.length;
  const duration = keys[n - 1].t;
  const startSceneTime = solveStartSceneTime(spec.clock, ctx.actors);
  const fov0 = spec.fov ?? 55;
  const lead = spec.bird?.lead ?? null;
  // A chase camera sits ABOVE the bird it chases: the path is the bird's,
  // the lens rides `lift` units up the radial and looks `ahead` past it.
  // Looking straight at a bird that is climbing its own path is a frame of
  // sky (measured: half of the first forest-arch render was sky).
  const lift = spec.bird?.lift ?? 0;
  // `pin: true` on a key keeps it exact under a raise (an arch's opening is
  // a place, not a height): the raise eases to zero within 2.5 s of it.
  const pins = keys.filter((k) => k.pin).map((k) => k.t);
  const raiseAt = (t) => {
    let w = 1;
    for (const tp of pins) w = Math.min(w, smoothstep(Math.abs(t - tp) / 2.5));
    return raise * w;
  };

  // A shot whose keys reference only fixed points and landmarks has fixed
  // curves: build them once, so playback allocates nothing per frame. Only
  // actor and bird refs move, and only they force a rebuild per sample.
  const moving = (r) => !!(r && typeof r === 'object' && !Array.isArray(r) && (r.actor || r.bird));
  const dynamic = keys.some((k) => moving(k.pos) || moving(k.look));
  const cache = {};
  function curveAt(field, sceneTime) {
    if (!dynamic && cache[field]) return cache[field];
    const pts = keys.map((k) => {
      const p = resolveRef(k[field] ?? keys[0][field], ctx, sceneTime, variant);
      return new THREE.Vector3(p[0], p[1], p[2]);
    });
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    if (!dynamic) cache[field] = curve;
    return curve;
  }

  function segmentAt(t) {
    const tc = Math.max(0, Math.min(duration, t));
    let i = 1;
    while (i < n - 1 && tc > keys[i].t) i++;
    const t0 = keys[i - 1].t, t1 = keys[i].t;
    const ease = EASE[keys[i].ease || 'linear'] || EASE.linear;
    const local = ease((tc - t0) / (t1 - t0));
    return { i, u: (i - 1 + local) / (n - 1), local, tc };
  }

  function pointAt(field, t, sceneTime) {
    const { u } = segmentAt(t);
    const v = curveAt(field, sceneTime).getPoint(Math.max(0, Math.min(1, u)));
    return [v.x, v.y, v.z];
  }

  function sample(t) {
    const { i, local, tc } = segmentAt(t);
    const sceneTime = startSceneTime + tc;
    let position = pointAt('pos', tc, sceneTime);
    const up0 = lift + raiseAt(tc);
    if (up0) position = addScaled(position, norm(position), up0);
    let lookAt;
    let leadPoint = null;
    if (lead !== null) {
      const tl = Math.min(duration, tc + lead);
      leadPoint = pointAt('pos', tl, startSceneTime + tl);
      const rl = raiseAt(tl);
      if (rl) leadPoint = addScaled(leadPoint, norm(leadPoint), rl);
      // A lead bird that has run out of path still needs somewhere to be:
      // carry it on along the last tangent.
      if (tc + lead > duration) {
        const back = pointAt('pos', Math.max(0, duration - 0.25), startSceneTime + duration - 0.25);
        const dir = norm(sub(leadPoint, back));
        const extra = (tc + lead - duration) * (len(sub(leadPoint, back)) / 0.25);
        leadPoint = addScaled(leadPoint, dir, extra);
      }
    }
    if (keys.some((k) => k.look)) lookAt = pointAt('look', tc, sceneTime);
    else if (leadPoint) lookAt = leadPoint;
    else lookAt = pointAt('pos', Math.min(duration, tc + 0.5), sceneTime);
    const fovA = keys[i - 1].fov ?? fov0, fovB = keys[i].fov ?? fovA;
    return {
      t: tc, sceneTime, position, lookAt, up: norm(position),
      fov: fovA + (fovB - fovA) * local,
      fade: fadeAt(spec.fade, tc),
      segment: i,
      lead: leadPoint,
    };
  }

  return { spec, name: spec.name, title: spec.title || spec.name, duration, startSceneTime, dynamic, raise, spin, scale, sample };
}

/**
 * Audit a compiled shot before anyone records it.
 *   { groundRadiusAt(x,y,z), waterRadiusAt?(x,y,z) (or -Infinity), step, minClearance, maxSpeed }
 * Checks: positive duration; finite samples; camera (and lead bird) clear
 * of ground and water; speed bounded; never looking at itself.
 */
export function auditShot(compiled, { groundRadiusAt, waterRadiusAt = null, obstacleAt = null, sightBlocked = null, maxOccluded = 0.12, step = 0.1, minClearance, maxSpeed } = {}) {
  const limits = {
    minClearance: minClearance ?? compiled.spec.audit?.minClearance ?? 2,
    maxSpeed: maxSpeed ?? compiled.spec.audit?.maxSpeed ?? 40,
  };
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  add('duration', compiled.duration > 0, `${compiled.duration}s`);
  let finite = true, lowest = Infinity, lowestAt = 0, birdLowest = Infinity, fastest = 0, fastestAt = 0, nearest = Infinity;
  let prev = null;
  let samples = 0;
  let blocked = 0, blockedAt = null, blockedBy = null;
  let occluded = 0, sightSamples = 0, occludedAt = null;
  for (let t = 0; t <= compiled.duration + 1e-9; t += step) {
    const s = compiled.sample(t);
    samples++;
    const pts = [s.position, s.lookAt, ...(s.lead ? [s.lead] : [])];
    if (pts.some((p) => !p.every(Number.isFinite)) || !Number.isFinite(s.fade) || !Number.isFinite(s.fov)) { finite = false; continue; }
    const clear = (p) => {
      let c = len(p) - groundRadiusAt(p[0], p[1], p[2]);
      if (waterRadiusAt) c = Math.min(c, len(p) - waterRadiusAt(p[0], p[1], p[2]));
      return c;
    };
    const c = clear(s.position);
    if (sightBlocked) {
      // Line of sight from the lens to the subject (the lead bird, or the
      // look target): a shot that spends its time behind a canopy is a shot
      // of a canopy. Brief occlusion is cinematic; most of it is not.
      sightSamples++;
      const target = s.lead || s.lookAt;
      if (sightBlocked(s.position, target)) { occluded++; if (occludedAt === null) occludedAt = t; }
    }
    if (obstacleAt) {
      // Through a tree, a tower or a cliff is a frame of bark: count every
      // sample where the lens (or the lead bird) is inside a solid collider.
      for (const p of s.lead ? [s.position, s.lead] : [s.position]) {
        const hit = obstacleAt(p[0], p[1], p[2]);
        if (hit) { blocked++; if (blockedAt === null) { blockedAt = t; blockedBy = hit; } }
      }
    }
    if (c < lowest) { lowest = c; lowestAt = t; }
    if (s.lead) birdLowest = Math.min(birdLowest, clear(s.lead));
    nearest = Math.min(nearest, len(sub(s.position, s.lookAt)));
    if (prev) {
      const v = len(sub(s.position, prev)) / step;
      if (v > fastest) { fastest = v; fastestAt = t; }
    }
    prev = s.position;
  }
  add('finite', finite, finite ? 'all samples finite' : 'non-finite sample');
  add('clearance', lowest >= limits.minClearance, `lowest ${lowest.toFixed(2)} at ${lowestAt.toFixed(1)}s (limit ${limits.minClearance})`);
  if (Number.isFinite(birdLowest)) add('bird-clearance', birdLowest >= 0.8, `lead bird lowest ${birdLowest.toFixed(2)}`);
  if (sightBlocked) add('sight', occluded / Math.max(1, sightSamples) <= maxOccluded, `${(100 * occluded / Math.max(1, sightSamples)).toFixed(0)}% of samples occluded${occludedAt !== null ? `, first at ${occludedAt.toFixed(1)}s` : ''} (limit ${(maxOccluded * 100).toFixed(0)}%)`);
  if (obstacleAt) add('obstacles', blocked === 0, blocked ? `${blocked} samples inside a solid, first at ${blockedAt.toFixed(1)}s (${blockedBy})` : 'clear of every collider');
  add('speed', fastest <= limits.maxSpeed, `peak ${fastest.toFixed(1)} u/s at ${fastestAt.toFixed(1)}s (limit ${limits.maxSpeed})`);
  add('look', nearest >= 0.3, `nearest look distance ${nearest.toFixed(2)}`);
  return { pass: checks.every((c) => c.pass), checks, samples, limits };
}

/**
 * Compile a shot and audit it; if the world is in the way (a random world puts
 * trees, towers and peaks somewhere new every boot) try the nearest variants
 * of the authored flight — turned round its landmark, widened, raised — and
 * take the first that passes, nearest first. Within `budgetMs`. If none
 * passes, the attempt with the fewest failed checks is returned with its
 * failing audit, so the caller can refuse it honestly.
 */
export function planShot(spec, ctx, auditOpts, { budgetMs = 3000, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
  const t0 = now();
  const spins = [0, 0.45, -0.45, 0.9, -0.9, 1.6, -1.6, Math.PI];
  const scales = [1, 1.25, 0.85];
  const raises = [0, 6, 12, 20, 30, 42];
  const tries = [];
  // Ordered by how far the variant strays from what was authored.
  for (const raise of raises) for (const spin of spins) for (const scale of scales) {
    tries.push({ raise, spin, scale, cost: raise / 6 + Math.abs(spin) * 2 + Math.abs(scale - 1) * 6 });
  }
  tries.sort((a, b) => a.cost - b.cost);
  let best = null;
  let attempts = 0;
  for (const v of tries) {
    if (attempts > 0 && now() - t0 > budgetMs) break;
    attempts++;
    const compiled = compileShot(spec, ctx, v);
    const audit = auditShot(compiled, auditOpts);
    const failed = audit.checks.filter((c) => !c.pass).length;
    const entry = { compiled, audit, raise: v.raise, spin: v.spin, scale: v.scale, attempts };
    if (audit.pass) return entry;
    if (!best || failed < best.failed) best = { ...entry, failed };
  }
  return { ...best, attempts };
}

/**
 * Occluders from what is DRAWN: one capsule per instance (and per plain mesh)
 * along the object's own local Y, from its bounding box. Colliders are the
 * wrong source for a camera — a canopy only carries one in the cruise band,
 * and the first valley render spent half its frames inside crowns that had
 * none. `skip(name)` excludes layers (clouds are flown through on purpose).
 *
 * Returns { inside(x,y,z) -> name|null, blocks(from, to, ignoreNear) -> bool }.
 * Pure arithmetic over matrix arrays; built once per world, queried by the
 * audit (allocation-free per query). A coarse grid keeps it to ~a millisecond
 * per hundred queries.
 */
export function buildOccluders(objects, { cell = 24 } = {}) {
  const caps = [];   // [ax, ay, az, bx, by, bz, r, nameIndex]
  const names = [];
  for (const o of objects) {
    const ni = names.push(o.name) - 1;
    const b = o.box;   // { min:[3], max:[3] } in local space
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const hx = (b.max[0] - b.min[0]) / 2, hz = (b.max[2] - b.min[2]) / 2;
    for (const m of o.matrices) {
      const tp = (x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      const sx = Math.hypot(m[0], m[1], m[2]), sz = Math.hypot(m[8], m[9], m[10]);
      if (sx + sz < 1e-9) continue;
      const r = Math.max(hx * sx, hz * sz) * 0.92;
      // A capsule's caps add r at each end; pull the axis in so the solid
      // ends where the object does.
      const a = tp(cx, b.min[1], cz), bb = tp(cx, b.max[1], cz);
      const L = Math.hypot(bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]);
      const k = L > 2 * r ? r / L : 0.5;
      caps.push([a[0] + (bb[0] - a[0]) * k, a[1] + (bb[1] - a[1]) * k, a[2] + (bb[2] - a[2]) * k,
        bb[0] - (bb[0] - a[0]) * k, bb[1] - (bb[1] - a[1]) * k, bb[2] - (bb[2] - a[2]) * k, r, ni]);
    }
  }
  const grid = new Map();
  const key = (i, j, k) => `${i},${j},${k}`;
  caps.forEach((c, idx) => {
    const lo = [Math.min(c[0], c[3]) - c[6], Math.min(c[1], c[4]) - c[6], Math.min(c[2], c[5]) - c[6]];
    const hi = [Math.max(c[0], c[3]) + c[6], Math.max(c[1], c[4]) + c[6], Math.max(c[2], c[5]) + c[6]];
    for (let i = Math.floor(lo[0] / cell); i <= Math.floor(hi[0] / cell); i++)
      for (let j = Math.floor(lo[1] / cell); j <= Math.floor(hi[1] / cell); j++)
        for (let k = Math.floor(lo[2] / cell); k <= Math.floor(hi[2] / cell); k++) {
          const g = key(i, j, k);
          if (!grid.has(g)) grid.set(g, []);
          grid.get(g).push(idx);
        }
  });
  const distSeg = (c, x, y, z) => {
    const dx = c[3] - c[0], dy = c[4] - c[1], dz = c[5] - c[2];
    const l2 = dx * dx + dy * dy + dz * dz;
    let t = l2 > 0 ? ((x - c[0]) * dx + (y - c[1]) * dy + (z - c[2]) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = c[0] + dx * t - x, py = c[1] + dy * t - y, pz = c[2] + dz * t - z;
    return Math.sqrt(px * px + py * py + pz * pz);
  };
  function inside(x, y, z) {
    const list = grid.get(key(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)));
    if (!list) return null;
    for (const idx of list) { const c = caps[idx]; if (distSeg(c, x, y, z) < c[6]) return names[c[7]]; }
    return null;
  }
  function blocks(from, to, ignoreNear = 3) {
    // The subject's own body is not in the way of the subject: ignore every
    // solid the target point is in or right next to (a monolith's shaft
    // contains the very point the camera looks at).
    const own = new Set();
    const near = grid.get(key(Math.floor(to[0] / cell), Math.floor(to[1] / cell), Math.floor(to[2] / cell)));
    if (near) for (const idx of near) { const c = caps[idx]; if (distSeg(c, to[0], to[1], to[2]) < c[6] + 6) own.add(idx); }
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const n = Math.max(2, Math.ceil(L / 3));
    for (let i = 1; i < n; i++) {
      const u = i / n;
      // The subject's own surroundings do not count: the last few units
      // before the target are where a landmark's own crown stands.
      if ((1 - u) * L < ignoreNear) break;
      const x = from[0] + dx * u, y = from[1] + dy * u, z = from[2] + dz * u;
      const list = grid.get(key(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)));
      if (!list) continue;
      for (const idx of list) {
        if (own.has(idx)) continue;
        const c = caps[idx];
        if (distSeg(c, x, y, z) < c[6]) return names[c[7]] || 'solid';
      }
    }
    return false;
  }
  return { inside, blocks, count: caps.length };
}
