// Living world — things that move on their own, on a clock.
//
// Ported from the tabletop worlds kit (adamrappaport public/map-assets:
// activity.js, service-traffic.js, mining-vehicles.js), where every moving
// thing is `world.actors[name] = { cycle, phases, stateAt(t) }` and its
// position is a PURE FUNCTION of scene time. Nothing integrates, so pausing,
// seeking, recording a shot frame by frame and asserting "the tram is at the
// station at t = 21" are all exact, and the per-frame cost is a curve lookup
// and one matrix write per vehicle.
//
// What changes on a planet: up is radial, so an actor's frame is built from
// normalize(position) and its direction of travel, never from world +Y.
//
// Budget rule (docs/FULL_SEND_PLAN.md §2): the forest is within 235 triangles
// of the 80k hard limit at its worst, so nothing here adds geometry there.
// The city's hover traffic reuses the 14/38 instanced tori the city already
// draws (zero triangles, zero draws); the city tram and the mountain cable
// car are one InstancedMesh per material for the whole fleet.
//
// Zero allocation per frame: every scratch object is created at build time.

const TAU = Math.PI * 2;

// ── shared scratch-free helpers ──────────────────────────────────────────

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Triangle wave in [0,1] with period 1: 0 → 1 → 0. */
function tri(u) {
  const f = u - Math.floor(u);
  return f < 0.5 ? f * 2 : 2 - f * 2;
}

/** Smoothstep-eased triangle: dwells a moment at each end, like a vehicle. */
function shuttle(u) {
  const t = tri(u);
  return t * t * (3 - 2 * t);
}

/** Deterministic hash → [0,1). */
function hash01(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ── tiny geometry kit (no BufferGeometryUtils: one import fewer to cache) ──

/**
 * Non-indexed box soup: each box [cx, cy, cz, sx, sy, sz]. Flat normals.
 * Local +X is forward, +Y up — the fleet orients that frame along travel.
 */
function boxSoup(THREE, boxes) {
  const pos = [];
  const corner = (b, i) => [
    b[0] + ((i & 1) ? 0.5 : -0.5) * b[3],
    b[1] + ((i & 2) ? 0.5 : -0.5) * b[4],
    b[2] + ((i & 4) ? 0.5 : -0.5) * b[5],
  ];
  // Faces as corner quads, wound outward.
  const faces = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]];
  for (const b of boxes) {
    for (const [a, c, d, e] of faces) {
      const A = corner(b, a), C = corner(b, c), D = corner(b, d), E = corner(b, e);
      // A, D, C — not A, C, D. The corner quads above run clockwise seen
      // from outside, and the first version wound every face INWARD: under
      // FrontSide that draws the inside of the far wall and nothing of the
      // near one (tests/living-world.test.js checks every face's normal).
      pos.push(...A, ...D, ...C, ...A, ...E, ...D);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ── city street lanes (mirror of city-windows.js addStreetGrid) ─────────────
//
// The street grid is a shader: roads run where lon*cos(lat)*R/BLOCK or
// lat*R/BLOCK is an INTEGER. A lane is one of those lines, so a vehicle on it
// flies directly over a road the player can see lit below.

export const STREET_BLOCK = 44;

/**
 * Position on a street lane at parameter u in [0,1), radius r.
 * kind 'lat': constant latitude j*BLOCK/R, longitude sweeps a full circle.
 * kind 'lon': constant lon*cos(lat) = i*BLOCK/R, latitude shuttles between
 *             the band where that line exists (|lon| <= PI).
 * Writes into `out` ({x,y,z}) and returns it. Pure.
 */
export function laneAt(lane, u, r, R, out) {
  let lat, lon;
  if (lane.kind === 'lat') {
    lat = (lane.index * STREET_BLOCK) / R;
    lon = -Math.PI + TAU * (u - Math.floor(u));
  } else {
    const c = (lane.index * STREET_BLOCK) / R;
    // The line exists while |c / cos(lat)| <= PI, i.e. cos(lat) >= |c|/PI.
    const latMax = Math.acos(Math.min(1, Math.abs(c) / Math.PI)) * 0.92;
    lat = -latMax + 2 * latMax * shuttle(u);
    lon = c / Math.max(1e-3, Math.cos(lat));
  }
  const cl = Math.cos(lat);
  out.x = r * cl * Math.cos(lon);
  out.y = r * Math.sin(lat);
  out.z = r * cl * Math.sin(lon);
  return out;
}

/** Every lane the grid has on a radius-R planet. */
export function streetLanes(R) {
  const lanes = [];
  const latN = Math.floor((Math.PI / 2) * R / STREET_BLOCK);
  for (let j = -latN + 1; j <= latN - 1; j++) lanes.push({ kind: 'lat', index: j });
  const lonN = Math.floor(Math.PI * R / STREET_BLOCK);
  for (let i = -lonN + 1; i <= lonN - 1; i++) lanes.push({ kind: 'lon', index: i });
  return lanes;
}

// ── fleet: N vehicles sharing one InstancedMesh ───────────────────────────

function createFleet(THREE, { name, mesh, count, place, orient = 'travel', forwardOf = null }) {
  const _p = new THREE.Vector3();
  const _ahead = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _s = new THREE.Vector3(1, 1, 1);
  const _q = new THREE.Quaternion();
  const _basis = new THREE.Matrix4();
  const _flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const _Y = new THREE.Vector3(0, 1, 0);

  /** Frame of vehicle i at time t into _p (position), _fwd, _up. */
  function frame(i, t) {
    place(i, t, _p);
    _up.copy(_p).normalize();
    // A vehicle standing still (a cabin dwelling at its station) has no
    // direction of travel to read off its path, so a fleet can say what
    // its forward is instead of differencing two positions.
    if (forwardOf) forwardOf(i, t, _fwd);
    else { place(i, t + 0.05, _ahead); _fwd.copy(_ahead).sub(_p); }
    _fwd.addScaledVector(_up, -_fwd.dot(_up));
    if (_fwd.lengthSq() < 1e-10) _fwd.set(1, 0, 0).addScaledVector(_up, -_up.x);
    _fwd.normalize();
  }

  const scales = new Float32Array(count).fill(1);
  return {
    name,
    count,
    mesh,
    scales,
    update(t) {
      for (let i = 0; i < count; i++) {
        frame(i, t);
        if (orient === 'flat') {
          // A hover disc lies in the tangent plane; its heading is invisible.
          _q.setFromUnitVectors(_Y, _up).multiply(_flat);
        } else {
          // Local +X forward, +Y up (the kit's convention).
          _right.crossVectors(_fwd, _up).normalize();
          _basis.makeBasis(_fwd, _up, _right);
          _q.setFromRotationMatrix(_basis);
        }
        _s.setScalar(scales[i]);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    /** Allocating: for shots and harnesses, never per frame. */
    stateAt(i, t) {
      frame(i, t);
      return { position: _p.toArray(), forward: _fwd.toArray(), up: _up.toArray() };
    },
  };
}

// ── the world ─────────────────────────────────────────────────────────────

/**
 * Build the living layer for one biome. Called once by createSphericalWorld
 * after every prop is placed (so it can avoid them), disposed with the world.
 *
 * @param {object} o
 * @param {object} o.THREE
 * @param {object} o.root            the world's root group
 * @param {string} o.variant         forest | canyons | mountain | city
 * @param {number} o.sphereRadius
 * @param {(x:number,y:number,z:number)=>number} o.groundAt  mesh height delta (<=0) at a world position
 * @param {Array<{position:{x,y,z},radius:number,type:string}>} o.colliders  placed colliders to avoid
 * @param {()=>number} o.rng         deterministic per world seed
 * @param {boolean} o.isMobile
 * @param {string} [o.search]        location.search, for ?living=0
 */
export function createLivingWorld({ THREE, root, variant, sphereRadius, groundAt, colliders = [], rng = Math.random, isMobile = false, search = '' }) {
  const R = sphereRadius;
  const fleets = [];
  const actors = {};
  const routeSpecs = [];
  const disposables = [];
  const actorsInfo = {};
  let time = 0;
  const enabled = livingWorldRequested(search);

  const groundR = (p) => R + groundAt(p.x, p.y, p.z);

  // Function declarations below are hoisted; the order here is the order
  // each fleet's RNG draws happen in, so append new fleets at the END.
  if (enabled && variant === 'city') {
    const hover = buildHoverTraffic();
    if (hover) fleets.push(hover);
    const tram = buildSkyTram();
    if (tram) fleets.push(...tram);
  }
  if (enabled && variant === 'mountain') {
    const cable = buildCableCar();
    if (cable) fleets.push(...cable);
  }
  if (enabled) {
    const raptors = buildRaptors();
    if (raptors) fleets.push(raptors);
  }

  // Every tall thing in the city as an upright cylinder about its own radial:
  // { ux,uy,uz (unit axis), top (radius of its roof), radius (half-width) }.
  // Read from the instance matrices, because the towers' colliders only cover
  // their base and middle — a lane checked against colliders alone would fly
  // straight through the top third of every tall tower.
  function towerCylinders() {
    const out = [];
    const m = new THREE.Matrix4();
    const lo = new THREE.Vector3();
    const hi = new THREE.Vector3();
    const side = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isInstancedMesh || !/^city-towers/.test(o.name)) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        m.premultiply(o.matrixWorld);
        lo.set((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2).applyMatrix4(m);
        hi.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).applyMatrix4(m);
        side.set(b.max.x, b.min.y, b.max.z).applyMatrix4(m);
        const axis = lo.clone().normalize();
        out.push({ ux: axis.x, uy: axis.y, uz: axis.z, top: hi.length(), radius: side.distanceTo(lo) });
      }
    });
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.parent || !/landmark/.test(o.parent.name)) return;
      const box = new THREE.Box3().setFromObject(o);
      const c = box.getCenter(new THREE.Vector3());
      const axis = c.clone().normalize();
      let top = 0;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) top = Math.max(top, Math.hypot(x, y, z));
      out.push({ ux: axis.x, uy: axis.y, uz: axis.z, top, radius: 8 });
    });
    return out;
  }

  // ── A1 · city hover traffic ────────────────────────────────────────────
  // The city has always drawn 14 (phone) / 38 (desktop) instanced "hover
  // vehicles" — and parked every one of them in the sky at a random point,
  // motionless. They now fly the street grid, each in its own lane, height
  // and speed. Zero triangles and zero draw calls: the same instances move.
  function buildHoverTraffic() {
    let mesh = null;
    root.traverse((o) => { if (!mesh && o.isInstancedMesh && o.name === 'city-hover') mesh = o; });
    if (!mesh) return null;
    const lanes = streetLanes(R);
    const towers = towerCylinders();
    const tmp = new THREE.Vector3();
    // A lane at a height is usable if it passes no tower closer than the
    // tower's own half-width + 6 at any sample whose radius is below the
    // tower's roof + 6: a vehicle never flies through a building, it picks a
    // lane over a road where nothing stands that tall.
    const laneClear = (lane, alt) => {
      for (let k = 0; k < 128; k++) {
        laneAt(lane, k / 128, R + alt, R, tmp);
        const r = tmp.length();
        for (const c of towers) {
          if (r > c.top + 6) continue;
          const along = tmp.x * c.ux + tmp.y * c.uy + tmp.z * c.uz;
          const dx = tmp.x - c.ux * along, dy = tmp.y - c.uy * along, dz = tmp.z - c.uz * along;
          const lim = c.radius + 6;
          if (along > 0 && dx * dx + dy * dy + dz * dz < lim * lim) return false;
        }
      }
      return true;
    };
    const count = mesh.count;
    const spec = [];
    for (let i = 0; i < count; i++) {
      let pick = null;
      for (let tries = 0; tries < 24 && !pick; tries++) {
        const lane = lanes[Math.floor(rng() * lanes.length)];
        const alt = 16 + rng() * 34;
        if (laneClear(lane, alt)) pick = { lane, alt };
      }
      // No clear lane at any height tried: fly above the tallest towers.
      if (!pick) pick = { lane: lanes[i % lanes.length], alt: 78 };
      // One full cycle of u: a lat lane is its whole circle; a lon lane is
      // there AND back across its latitude band (measured, not estimated —
      // the band's ends are where the line bends hardest).
      let circumference;
      if (pick.lane.kind === 'lat') circumference = TAU * R * Math.cos((pick.lane.index * STREET_BLOCK) / R);
      else {
        circumference = 0;
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        laneAt(pick.lane, 0, R, R, a);
        for (let k = 1; k <= 64; k++) { laneAt(pick.lane, k / 64, R, R, b); circumference += a.distanceTo(b); a.copy(b); }
        // The shuttle eases, so its peak speed is 1.5x its mean.
        circumference *= 1.5;
      }
      const speed = 7 + rng() * 9;                   // units per second
      const dir = rng() < 0.5 ? -1 : 1;
      spec.push({
        ...pick,
        period: Math.max(20, circumference / speed),
        phase: rng(),
        dir,
        bob: rng() * TAU,
        scale: 2.0 + rng() * 2.2,
      });
    }
    const fleet = createFleet(THREE, {
      name: 'city-hover',
      mesh,
      count,
      orient: 'flat',
      place(i, t, out) {
        const s = spec[i];
        const u = s.phase + s.dir * t / s.period;
        const bob = 0.6 * Math.sin(t * 1.3 + s.bob);
        return laneAt(s.lane, u, R + s.alt + bob, R, out);
      },
    });
    spec.forEach((s, i) => { fleet.scales[i] = s.scale; });
    mesh.frustumCulled = false;   // instances move; a stale bounding sphere culls them
    for (let i = 0; i < count; i++) {
      const s = spec[i];
      actors[`hover-${i}`] = {
        kind: 'hover',
        cycle: s.period,
        phases: [{ name: 'cruise', start: 0, length: s.period }],
        stateAt: (t) => ({ ...fleet.stateAt(i, t), phase: 'cruise' }),
      };
    }
    routeSpecs.push({
      name: 'city-hover-lanes',
      // Over roads, above the roofs it was routed around, never in the ground.
      minClear: 8,
      maxClear: 140,
      samples: () => {
        const out = [];
        for (let i = 0; i < count; i++) {
          for (let k = 0; k < 24; k++) {
            const p = fleet.stateAt(i, (k / 24) * spec[i].period).position;
            out.push(p);
          }
        }
        return out;
      },
    });
    return fleet;
  }


  // ── A2 · city sky-tram ─────────────────────────────────────────────────
  // Three lit cars running a street lane at the lowest height where nothing
  // stands in its way — the one thing in the city that tells the eye how
  // big a tower is. Hover-tech like the traffic, so no track: two draws
  // (bodies, window bands) and ~100 triangles for the whole train.
  function buildSkyTram() {
    const towers = towerCylinders();
    const lanes = streetLanes(R).filter((l) => l.kind === 'lat' && Math.abs(l.index) <= 2);
    const tmp = new THREE.Vector3();
    const clearAt = (lane, alt) => {
      for (let k = 0; k < 256; k++) {
        laneAt(lane, k / 256, R + alt, R, tmp);
        if (tmp.length() - groundR(tmp) < 6) return false;
        const r = tmp.length();
        for (const c of towers) {
          if (r > c.top + 5) continue;
          const along = tmp.x * c.ux + tmp.y * c.uy + tmp.z * c.uz;
          const dx = tmp.x - c.ux * along, dy = tmp.y - c.uy * along, dz = tmp.z - c.uz * along;
          const lim = c.radius + 5;
          if (along > 0 && dx * dx + dy * dy + dz * dz < lim * lim) return false;
        }
      }
      return true;
    };
    let pick = null;
    for (let alt = 10; alt <= 70 && !pick; alt += 4) {
      for (const lane of lanes) if (clearAt(lane, alt)) { pick = { lane, alt }; break; }
    }
    if (!pick) return null;
    const CARS = 3;
    const CAR_LEN = 7.2;
    const bodyGeo = boxSoup(THREE, [
      [0, 0, 0, CAR_LEN, 2.4, 2.6],          // body
      [0, 1.35, 0, CAR_LEN * 0.86, 0.3, 2.0], // roof pod
      [0, -1.35, 0, CAR_LEN * 0.7, 0.3, 1.4], // hover skid
    ]);
    // Five panes a side and a lit nose: a solid band reads as a stripe of
    // paint, separate panes read as a carriage with people in it.
    const panes = [];
    for (let k = 0; k < 5; k++) panes.push([(k - 2) * (CAR_LEN * 0.18), 0.35, 0, CAR_LEN * 0.13, 0.75, 2.66]);
    panes.push([CAR_LEN * 0.5 + 0.02, 0.35, 0, 0.05, 0.6, 1.8]);
    const winGeo = boxSoup(THREE, panes);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xd9dee8, flatShading: true });
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffd8a0 });
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, CARS);
    const wins = new THREE.InstancedMesh(winGeo, winMat, CARS);
    bodies.name = 'actor-skytram-bodies';
    wins.name = 'actor-skytram-windows';
    for (const m of [bodies, wins]) { m.frustumCulled = false; m.raycast = () => {}; root.add(m); }
    disposables.push(() => { bodyGeo.dispose(); winGeo.dispose(); bodyMat.dispose(); winMat.dispose(); });
    const circumference = TAU * R * Math.cos((pick.lane.index * STREET_BLOCK) / R);
    const speed = 9;
    const period = circumference / speed;
    const gap = (CAR_LEN + 1.2) / circumference;
    const phase0 = rng();
    const place = (i, t, out) => laneAt(pick.lane, phase0 + t / period - i * gap, R + pick.alt, R, out);
    const a = createFleet(THREE, { name: 'skytram', mesh: bodies, count: CARS, place });
    const b = createFleet(THREE, { name: 'skytram-windows', mesh: wins, count: CARS, place });
    actors.skytram = {
      kind: 'tram', cycle: period,
      phases: [{ name: 'loop', start: 0, length: period }],
      stateAt: (t) => ({ ...a.stateAt(0, t), phase: 'loop' }),
    };
    routeSpecs.push({
      name: 'city-skytram', minClear: 5, maxClear: 120,
      samples: () => Array.from({ length: 128 }, (_, k) => a.stateAt(0, (k / 128) * period).position),
    });
    return [a, b];
  }

  // ── A3 · mountain cable car ────────────────────────────────────────────
  // Two cabins on twin cables from a valley station up to the summit arch,
  // passing each other half way. The line is chosen, not placed: every
  // candidate lower station is tried and the one whose whole span clears the
  // ground and every collider (pines, peaks, boulders) by a margin wins.
  function buildCableCar() {
    const arch = root.getObjectByName('summit-arch');
    const archPos = arch ? arch.getWorldPosition(new THREE.Vector3()) : null;
    const blockers = colliders.filter((c) => c.type !== 'cloud');
    const SAG = 0.04;
    const cablePoint = (A, B, u, out) => {
      out.copy(A).lerp(B, u);
      const len = A.distanceTo(B);
      return out.addScaledVector(out.clone().normalize(), -4 * SAG * len * u * (1 - u));
    };
    const p = new THREE.Vector3();
    const spanMid = new THREE.Vector3();
    const why = { shallow: 0, ground: 0, collider: 0, tried: 0 };
    const spanScore = (A, B) => {
      let minClear = Infinity;
      for (let k = 1; k < 48; k++) {
        cablePoint(A, B, k / 48, p);
        const cl = p.length() - groundR(p);
        // The last tenth at each end may come down to the station.
        const need = (k < 5 || k > 43) ? 2.5 : 6;
        if (cl < need) { why.ground++; return null; }
        minClear = Math.min(minClear, cl);
      }
      // Colliders only near the span: everything else cannot touch it.
      spanMid.copy(A).add(B).multiplyScalar(0.5);
      const reach = A.distanceTo(B) / 2 + 20;
      const near = blockers.filter((c) => c.position.distanceTo(spanMid) < reach + c.radius);
      for (let k = 1; k < 48; k++) {
        cablePoint(A, B, k / 48, p);
        for (const c of near) {
          if (p.distanceTo(c.position) < c.radius + 4) { why.collider++; return null; }
        }
      }
      return minClear;
    };
    // The whole planet, not just the arch's neighbourhood: the arch stands on
    // a high plateau, and on most worlds nothing within 220 units of it is
    // more than eight units lower (measured). A cable car is a plateau EDGE
    // over a valley; prefer the one closest to the arch so the two read
    // together, but take the best line anywhere over none at all.
    const t0 = nowMs();
    const golden = Math.PI * (3 - Math.sqrt(5));
    const dir = new THREE.Vector3();
    const ta = new THREE.Vector3(), tb = new THREE.Vector3();
    let best = null;
    const TOPS = 140;
    for (let i = 0; i < TOPS; i++) {
      const y = 1 - (2 * (i + 0.5)) / TOPS;
      const rr = Math.sqrt(1 - y * y);
      dir.set(Math.cos(golden * i) * rr, y, Math.sin(golden * i) * rr);
      const gTop = groundAt(dir.x * R, dir.y * R, dir.z * R);
      if (gTop < -6) continue;                     // tops stand on high ground
      ta.set(0, 1, 0).cross(dir);
      if (ta.lengthSq() < 1e-6) ta.set(1, 0, 0);
      ta.normalize();
      tb.crossVectors(dir, ta);
      const TOP = dir.clone().multiplyScalar(R + gTop + 9);
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        // Short and steep: on a radius-120 planet the ground between two
        // stations bulges dist^2/(8R) above a straight cable — 15 units over
        // a 120-unit span (measured: every such span hit the ground).
        for (const dist of [38, 52, 68, 86]) {
          const d = dir.clone().addScaledVector(ta, Math.cos(ang) * dist / R).addScaledVector(tb, Math.sin(ang) * dist / R).normalize();
          const g = groundR(d);
          const drop = TOP.length() - 9 - g;
          if (drop < 14) { why.shallow++; continue; }  // a cable car has to CLIMB
          why.tried++;
          const BOT = d.clone().multiplyScalar(g + 5);
          const score = spanScore(BOT, TOP);
          if (score === null) continue;
          const nearArch = archPos ? TOP.distanceTo(archPos) : 0;
          const value = drop + 0.2 * Math.min(score, 30) - 0.08 * nearArch;
          if (!best || value > best.value) best = { BOT, TOP, value, drop };
        }
      }
    }
    actorsInfo.cablecarSearch = { ...why, ms: +(nowMs() - t0).toFixed(1) };
    if (!best) return null;
    const TOP = best.TOP;
    const BOT = best.BOT;
    const span = TOP.clone().sub(BOT);
    const len = span.length();
    const along = span.clone().normalize();
    const mid = BOT.clone().add(TOP).multiplyScalar(0.5);
    const midUp = mid.clone().normalize();
    const side = new THREE.Vector3().crossVectors(along, midUp).normalize();
    const OFFSET = 2.2;

    // Cables: one thin box per cable, laid along the chord (the sag is a few
    // units over a ~100-unit span; drawn straight, the cabins hang on it).
    const cableGeo = boxSoup(THREE, [[0, 0, 0, 1, 0.16, 0.16]]);
    const cableMat = new THREE.MeshLambertMaterial({ color: 0x2b3038 });
    const cables = new THREE.InstancedMesh(cableGeo, cableMat, 2);
    cables.name = 'actor-cablecar-cables';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const basis = new THREE.Matrix4();
    const yAx = new THREE.Vector3().crossVectors(side, along).normalize();
    basis.makeBasis(along, yAx, side);
    q.setFromRotationMatrix(basis);
    [-1, 1].forEach((sg, k) => {
      m.compose(mid.clone().addScaledVector(side, sg * OFFSET), q, new THREE.Vector3(len, 1, 1));
      cables.setMatrixAt(k, m);
    });
    cables.instanceMatrix.needsUpdate = true;
    cables.raycast = () => {};
    root.add(cables);

    // Stations: a pylon and a roof at each end.
    const stationGeo = boxSoup(THREE, [[0, 3.5, 0, 3.2, 7, 3.2], [0, 7.6, 0, 9, 1.2, 7.5]]);
    const stationMat = new THREE.MeshLambertMaterial({ color: 0x6d7682, flatShading: true });
    const stations = new THREE.InstancedMesh(stationGeo, stationMat, 2);
    stations.name = 'actor-cablecar-stations';
    [[BOT, -1], [TOP, 1]].forEach(([P, dirSign], k) => {
      const sUp = P.clone().normalize();
      const fwd = along.clone().multiplyScalar(dirSign).addScaledVector(sUp, -along.dot(sUp)).normalize();
      const rgt = new THREE.Vector3().crossVectors(fwd, sUp).normalize();
      const sq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, sUp, rgt));
      const base = sUp.clone().multiplyScalar(groundR(sUp) - 0.5);
      m.compose(base, sq, new THREE.Vector3(1, (P.length() - base.length()) / 7.6, 1));
      stations.setMatrixAt(k, m);
    });
    stations.instanceMatrix.needsUpdate = true;
    stations.raycast = () => {};
    root.add(stations);

    // Cabins: hang 3 units under their cable.
    const cabinGeo = boxSoup(THREE, [
      [0, 0, 0, 3.4, 2.6, 2.4],
      [0, 1.55, 0, 2.4, 0.5, 1.6],
      [0, 3.0, 0, 0.18, 2.6, 0.18],           // hanger
    ]);
    const cabinMat = new THREE.MeshLambertMaterial({ color: 0xd64a3a, flatShading: true });
    const cabins = new THREE.InstancedMesh(cabinGeo, cabinMat, 2);
    cabins.name = 'actor-cablecar-cabins';
    cabins.frustumCulled = false;
    cabins.raycast = () => {};
    root.add(cabins);
    disposables.push(() => {
      for (const g of [cableGeo, stationGeo, cabinGeo]) g.dispose();
      for (const mm of [cableMat, stationMat, cabinMat]) mm.dispose();
    });
    // 2.2 u/s: an aerial tramway is SLOW, and the ride is the point — at
    // 4.5 a 44-unit line was over in ten seconds. A 6 s dwell each end.
    const period = 2 * (len / 2.2) + 2 * 6;
    const travel = (t, k) => {
      const u = ((t / period + (k ? 0.5 : 0)) % 1 + 1) % 1;
      // dwell, ride up, dwell, ride down, as fractions of the period
      const dw = 6 / period, ride = 0.5 - dw;
      if (u < dw) return 0;
      if (u < dw + ride) { const x = (u - dw) / ride; return x * x * (3 - 2 * x); }
      if (u < 2 * dw + ride) return 1;
      const x = (u - 2 * dw - ride) / ride; return 1 - x * x * (3 - 2 * x);
    };
    const tmp = new THREE.Vector3();
    const fleet = createFleet(THREE, {
      name: 'cablecar', mesh: cabins, count: 2, orient: 'travel',
      // Always up the cable: a dwelling cabin is not moving, and a cabin
      // reads the same from either end.
      forwardOf: (i, t, out) => out.copy(along),
      place(i, t, out) {
        // Cabin i runs its own cable; the two are half a period apart, so
        // one goes up while the other comes down and they pass mid-span.
        cablePoint(BOT, TOP, travel(t, i), out).addScaledVector(side, (i ? 1 : -1) * OFFSET);
        tmp.copy(out).normalize();
        return out.addScaledVector(tmp, -3.0);
      },
    });
    for (const k of [0, 1]) {
      actors[`cablecar-${k}`] = {
        kind: 'cablecar', cycle: period,
        phases: [
          { name: k ? 'top' : 'bottom', start: 0, length: 6 },
          { name: k ? 'descending' : 'ascending', start: 6, length: period / 2 - 6 },
          { name: k ? 'bottom' : 'top', start: period / 2, length: 6 },
          { name: k ? 'ascending' : 'descending', start: period / 2 + 6, length: period / 2 - 6 },
        ],
        stateAt: (t) => ({ ...fleet.stateAt(k, t), phase: 'ride' }),
      };
    }
    routeSpecs.push({
      name: 'mountain-cablecar', minClear: 1.5, maxClear: 160,
      samples: () => Array.from({ length: 64 }, (_, j) => cablePoint(BOT, TOP, (j + 0.5) / 64, new THREE.Vector3()).toArray()),
    });
    actorsInfo.cablecar = { bottom: BOT.toArray(), top: TOP.toArray(), length: +len.toFixed(1), climb: +best.drop.toFixed(1) };
    return [fleet];
  }

  // ── A5 · raptors on a thermal ──────────────────────────────────────────
  // Three dark birds circling high over the biome's landmark: life in the
  // sky that is not a drone. Two triangles each (a swept chevron), one draw,
  // six triangles for the flock — the one living thing cheap enough for the
  // forest, which is within a few hundred triangles of the hard limit.
  function buildRaptors() {
    const lmGroup = root.getObjectByName(variant === 'forest' ? 'forest-landmarks' : `${variant}-landmark`);
    if (!lmGroup) return null;
    const box = new THREE.Box3().setFromObject(lmGroup.children[0] || lmGroup);
    const c = box.getCenter(new THREE.Vector3());
    const up = c.clone().normalize();
    const centre = up.clone().multiplyScalar(Math.max(c.length(), groundR(up)) + 55);
    const ta = new THREE.Vector3(0, 1, 0).cross(up);
    if (ta.lengthSq() < 1e-6) ta.set(1, 0, 0);
    ta.normalize();
    const tb = new THREE.Vector3().crossVectors(up, ta);
    const g = new THREE.BufferGeometry();
    // A swept chevron in local XZ, nose at +X: two wings, 2 triangles.
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0.6, 0, 0, -0.5, 0, -2.4, -0.1, 0, 0,
      0.6, 0, 0, -0.1, 0, 0, -0.5, 0, 2.4,
    ], 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0x241d18, side: THREE.DoubleSide });
    const N = 3;
    const mesh = new THREE.InstancedMesh(g, mat, N);
    mesh.name = 'actor-raptors';
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    root.add(mesh);
    disposables.push(() => { g.dispose(); mat.dispose(); });
    const birds = Array.from({ length: N }, () => ({ r: 14 + rng() * 16, h: rng() * 14, w: 0.12 + rng() * 0.08, ph: rng() * TAU, scale: 0.9 + rng() * 0.5 }));
    const fleet = createFleet(THREE, {
      name: 'raptors', mesh, count: N,
      place(i, t, out) {
        const b = birds[i];
        const a = b.ph + b.w * t;
        return out.copy(centre)
          .addScaledVector(up, b.h + 3 * Math.sin(t * 0.21 + b.ph))
          .addScaledVector(ta, b.r * Math.cos(a))
          .addScaledVector(tb, b.r * Math.sin(a));
      },
    });
    birds.forEach((b, i) => { fleet.scales[i] = b.scale; });
    for (let i = 0; i < N; i++) {
      actors[`raptor-${i}`] = {
        kind: 'raptor', cycle: TAU / birds[i].w,
        phases: [{ name: 'soar', start: 0, length: TAU / birds[i].w }],
        stateAt: (t) => ({ ...fleet.stateAt(i, t), phase: 'soar' }),
      };
    }
    return fleet;
  }

  function update(delta) {
    if (!fleets.length) return;
    if (Number.isFinite(delta) && delta > 0) time += Math.min(delta, 0.25);
    for (let i = 0; i < fleets.length; i++) fleets[i].update(time);
  }
  // Place everything at t = 0 now, so the first frame is already right.
  for (const f of fleets) f.update(0);

  return {
    enabled,
    actors,
    get time() { return time; },
    /** Seek the clock (shots, harnesses). Applies immediately. */
    setTime(t) { time = Math.max(0, +t || 0); for (const f of fleets) f.update(time); },
    update,
    /** For the world audit: [{ name, samples:[[x,y,z]...], minClear, maxClear }]. */
    routes() { return routeSpecs.map((r) => ({ name: r.name, minClear: r.minClear, maxClear: r.maxClear, samples: r.samples() })); },
    stats() {
      return {
        enabled, time: +time.toFixed(3), fleets: fleets.map((f) => ({ name: f.name, count: f.count })),
        actors: Object.keys(actors).length, info: actorsInfo,
      };
    },
    dispose() { for (const d of disposables) { try { d(); } catch { /* already gone */ } } },
  };
}

/** `?living=0` turns the whole layer off (the A/B and the escape hatch). */
export function livingWorldRequested(search = '') {
  return !/[?&]living=0(?:&|$)/.test(search || '');
}

export { hash01 as _hash01, tri as _tri, shuttle as _shuttle, boxSoup as _boxSoup };
