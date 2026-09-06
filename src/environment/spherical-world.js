import { createCanopyGeometry, addFoliageWind, bakeGroundContacts } from './visual-style.js';
import * as THREEImported from "https://esm.sh/three@0.183.2";
import { createValleyFeature } from "./landmark-valley.js";
import { createSlalomRun } from "./slalom-run.js";
import { createColliderGrid } from "./collider-grid.js";

const DEG2RAD = Math.PI / 180;

// Immersion-scale world: radius 120 gives circumference ~754 units
// At speed 8, loop time ~94s — room to breathe, fly THROUGH environments
const SPHERE_RADIUS = 120;

// Active terrain profile for the environment currently being built. Lets
// placeOnSphere() AND ground collision sample the SAME FBM displacement, so
// props sit ON the rolling terrain and the bird flies over highlands / down
// into valleys instead of skating a perfect sphere. Set at the top of
// createSphericalWorld; null = flat sphere (server/test builds).
let _activeTerrainProfile = null;
// Landmarks of the world currently being built, reported on the world object.
let _landmarks = [];

// Mobile gate — env builders read this to disable heavy fill-rate effects
// (transparent canopy ceilings, cloud puffs) and trim prop density.
// Set by index.html before any env module loads; default false on server tests.
function _isMobile() {
  return typeof window !== 'undefined' && window.__birbIsMobile === true;
}

// Collision detection helper
export class SphericalCollisionSystem {
  constructor(sphereRadius, objectColliders = []) {
    this.sphereRadius = sphereRadius;
    this.objectColliders = objectColliders;
    this._tempVec = null;
    // Spatial-hash broad-phase: built lazily on first query, invalidated by
    // addCollider/clearColliders. Colliders are static per environment, so a
    // single build amortizes to nothing while queries drop from a full scan
    // (~700 mobile / ~1,200 desktop colliders) to one 27-cell neighborhood.
    this._grid = createColliderGrid(14);
    this._gridDirty = true;
  }

  _rebuildGrid() {
    this._grid.clear();
    for (let i = 0; i < this.objectColliders.length; i++) {
      this._grid.insert(this.objectColliders[i]);
    }
    this._gridDirty = false;
  }

  _ensureVec(THREE) {
    if (!this._tempVec) {
      this._tempVec = new THREE.Vector3();
    }
    return this._tempVec;
  }

  // Add a collidable object (trees, rocks, etc.)
  addCollider(position, radius, type = 'object') {
    this.objectColliders.push({ position: position.clone(), radius, type });
    this._gridDirty = true;
  }

  // Clear all object colliders
  clearColliders() {
    this.objectColliders = [];
    this._gridDirty = true;
  }

  // Check collision with sphere ground - returns corrected position if collision
  checkGroundCollision(THREE, position, entityRadius = 0.5) {
    const vec = this._ensureVec(THREE);
    const distanceFromCenter = position.length();
    // Landing floor = the full carved terrain (<= 0), the SAME surface the mesh
    // renders, so the bird lands exactly on what it sees and can't sink through
    // detail. Downward-only, so flying level over the plateau never falsely
    // grounds the bird. Matches the bird-flight floor exactly (same sampler).
    let terrain = 0;
    if (distanceFromCenter > 1e-3) {
      const inv = 1 / distanceFromCenter;
      // Full terrain floor (detail + continental) — must match the BirdFlight
      // floor exactly, or the bird couldn't descend past the baseline into a canyon.
      terrain = terrainFloorDir(position.x * inv, position.y * inv, position.z * inv);
    }
    const minAltitude = this.sphereRadius + terrain + entityRadius;

    if (distanceFromCenter < minAltitude) {
      // Bird is below the local ground - push it up to the surface
      vec.copy(position).normalize().multiplyScalar(minAltitude);
      return { collided: true, correctedPosition: vec.clone(), normal: position.clone().normalize() };
    }

    return { collided: false, correctedPosition: null, normal: null };
  }

  // Check collision with objects on the sphere
  checkObjectCollision(THREE, position, entityRadius = 0.5) {
    const vec = this._ensureVec(THREE);

    // Broad-phase: the grid guarantees a complete candidate set only for
    // query radii up to its cell size (bird is 0.6 — far under). Anything
    // larger falls back to the full scan so correctness never depends on
    // the caller knowing grid internals.
    let candidates = this.objectColliders;
    if (entityRadius <= this._grid.cellSize) {
      if (this._gridDirty) this._rebuildGrid();
      candidates = this._grid.query(position.x, position.y, position.z);
    }

    for (let i = 0; i < candidates.length; i++) {
      const collider = candidates[i];
      vec.copy(position).sub(collider.position);
      const minDistance = collider.radius + entityRadius;
      // Squared-distance compare avoids a per-collider sqrt; only normalize
      // (which takes the sqrt) on an actual hit.
      const distanceSq = vec.lengthSq();

      if (distanceSq < minDistance * minDistance) {
        // Collision detected - push entity away from object
        const pushDirection = vec.normalize();
        const correctedPosition = collider.position.clone().add(
          pushDirection.multiplyScalar(minDistance)
        );
        return {
          collided: true,
          correctedPosition,
          colliderType: collider.type,
          normal: pushDirection.clone()
        };
      }
    }

    return { collided: false, correctedPosition: null, colliderType: null, normal: null };
  }

  // Combined collision check
  checkAllCollisions(THREE, position, velocity, entityRadius = 0.5) {
    let finalPosition = position.clone();
    let finalVelocity = velocity.clone();
    let hadCollision = false;

    // Check ground collision first
    const groundResult = this.checkGroundCollision(THREE, finalPosition, entityRadius);
    if (groundResult.collided) {
      finalPosition.copy(groundResult.correctedPosition);
      hadCollision = true;

      // Reflect velocity off the ground with damping
      // Standard reflection: v' = v - 2(v·n)n
      // With restitution (0.3 = 30% bounce): v' = v - (1 + restitution)(v·n)n
      const normal = groundResult.normal;
      const dot = finalVelocity.dot(normal);
      if (dot < 0) {
        // Moving into ground - reflect with damping (0.3 restitution = soft bounce)
        const restitution = 0.3;
        finalVelocity.addScaledVector(normal, -(1 + restitution) * dot);
      }
    }

    // Check object collisions
    const objectResult = this.checkObjectCollision(THREE, finalPosition, entityRadius);
    if (objectResult.collided) {
      finalPosition.copy(objectResult.correctedPosition);
      hadCollision = true;

      // Reflect velocity off the object with damping
      const normal = objectResult.normal;
      const dot = finalVelocity.dot(normal);
      if (dot < 0) {
        // Moving into object - reflect with damping (0.2 restitution = softer bounce)
        const restitution = 0.2;
        finalVelocity.addScaledVector(normal, -(1 + restitution) * dot);
      }
    }

    return {
      position: finalPosition,
      velocity: finalVelocity,
      hadCollision
    };
  }
}

// Helper to place objects on sphere surface. Now terrain-aware: the active
// environment's FBM displacement is added so props rest on the rolling ground
// (heightOffset still stacks on top, e.g. clouds/arches at altitude).
function placeOnSphere(THREE, radius, theta, phi, heightOffset = 0) {
  const sp = Math.sin(phi);
  const nx = sp * Math.cos(theta);
  const ny = Math.cos(phi);
  const nz = sp * Math.sin(theta);
  const r = radius + heightOffset + (_activeTerrainProfile ? terrainHeightDir(nx, ny, nz) : 0);
  return new THREE.Vector3(r * nx, r * ny, r * nz);
}

// Helper to orient object to face outward from sphere center
function orientToSurfaceNormal(object, position) {
  const up = position.clone().normalize();
  object.up.copy(up);
  object.lookAt(position.clone().multiplyScalar(2));
}

// Create uniformly distributed points on a sphere using fibonacci spiral
function fibonacciSpherePoints(count, radius) {
  const points = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  for (let i = 0; i < count; i++) {
    const theta = 2 * Math.PI * i / goldenRatio;
    const phi = Math.acos(1 - 2 * (i + 0.5) / count);

    points.push({
      theta,
      phi,
      position: {
        x: radius * Math.sin(phi) * Math.cos(theta),
        y: radius * Math.cos(phi),
        z: radius * Math.sin(phi) * Math.sin(theta)
      }
    });
  }

  return points;
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

// ============================================================
// WORLD BEAUTY PASS — build-time-only helpers (zero per-frame cost)
//
// All of the following run ONCE at environment build. They add per-instance
// color variation, vertex-color gradients on prop geometries, and richer
// ground vertex coloring. None of them allocate per frame, add draw calls, or
// add transparent surfaces — they enrich existing InstancedMesh / mesh data in
// place. instanceColor MULTIPLIES the material color, so every builder that
// uses these rebalances its base material color toward white/the mean hue.
// ============================================================

// Apply subtle per-instance color jitter to an InstancedMesh. `setColorAt`
// allocates the instanceColor buffer once; values multiply the base material
// color. lumJit = ± luminance spread, hueJit = ± per-channel tint spread.
// Build-time only. THREE.Color reused across the loop (one alloc, not per-i).
function applyInstanceColorJitter(THREE, inst, count, baseR, baseG, baseB, lumJit, hueJit) {
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const lum = 1 + (Math.random() * 2 - 1) * lumJit;
    const r = baseR * lum + (Math.random() * 2 - 1) * hueJit;
    const g = baseG * lum + (Math.random() * 2 - 1) * hueJit;
    const b = baseB * lum + (Math.random() * 2 - 1) * hueJit;
    c.setRGB(
      r < 0 ? 0 : r > 1 ? 1 : r,
      g < 0 ? 0 : g > 1 ? 1 : g,
      b < 0 ? 0 : b > 1 ? 1 : b,
    );
    inst.setColorAt(i, c);
  }
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
}

// Bake a vertical vertex-color gradient into a unit geometry whose local Y runs
// 0 (base) → 1 (top). topColor/bottomColor are [r,g,b] in 0..1; these MULTIPLY
// the material color (which should be ~white when this is used). Optional
// `bands` paints horizontal strata (canyon sediment look) by quantizing the
// vertical t into N steps with a small per-band luminance offset. Build-time.
function bakeVerticalGradient(THREE, geom, bottomColor, topColor, bands = 0, bandJit = 0) {
  const pos = geom.getAttribute('position');
  const n = pos.count;
  // Local Y range of this unit geom (base-at-0 geoms span ~0..1, but cones/cyl
  // can vary) — normalize against the measured min/max so the gradient always
  // spans the full prop regardless of the source geometry's exact extents.
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const range = (maxY - minY) || 1;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let t = (pos.getY(i) - minY) / range; // 0 base → 1 top
    let bandMul = 1;
    if (bands > 0) {
      const bi = Math.min(bands - 1, Math.floor(t * bands));
      // Deterministic per-band offset (hash on band index) so strata read as
      // distinct sediment layers, not a smooth ramp.
      bandMul = 1 + (Math.sin(bi * 12.9898) * 0.5) * bandJit;
    }
    const r = bottomColor[0] + t * (topColor[0] - bottomColor[0]);
    const g = bottomColor[1] + t * (topColor[1] - bottomColor[1]);
    const b = bottomColor[2] + t * (topColor[2] - bottomColor[2]);
    colors[i * 3] = Math.min(1, r * bandMul);
    colors[i * 3 + 1] = Math.min(1, g * bandMul);
    colors[i * 3 + 2] = Math.min(1, b * bandMul);
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geom;
}

function angularDistance(thetaA, phiA, thetaB, phiB) {
  const sinPhiA = Math.sin(phiA);
  const cosPhiA = Math.cos(phiA);
  const sinPhiB = Math.sin(phiB);
  const cosPhiB = Math.cos(phiB);
  const cosDeltaTheta = Math.cos(thetaA - thetaB);
  const dot = sinPhiA * sinPhiB * cosDeltaTheta + cosPhiA * cosPhiB;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

// ============================================================
// Simplex-like noise for terrain displacement (CPU-side)
// Uses a hash-based approach for no-dependency noise generation
// ============================================================
const NOISE_PERM = new Uint8Array(512);
(function initNoise() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates shuffle with fixed seed for reproducible terrain
  let seed = 42;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807 + 0) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) NOISE_PERM[i] = p[i & 255];
})();

function grad3d(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }

function noise3D(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const P = NOISE_PERM;
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
  const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return lerp(
    lerp(lerp(grad3d(P[AA], x, y, z), grad3d(P[BA], x - 1, y, z), u),
         lerp(grad3d(P[AB], x, y - 1, z), grad3d(P[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad3d(P[AA + 1], x, y, z - 1), grad3d(P[BA + 1], x - 1, y, z - 1), u),
         lerp(grad3d(P[AB + 1], x, y - 1, z - 1), grad3d(P[BB + 1], x - 1, y - 1, z - 1), u), v),
    w
  );
}

// Fractal Brownian Motion — layers of noise at increasing frequency
function fbm(x, y, z, octaves = 5, lacunarity = 2.0, persistence = 0.5) {
  let value = 0, amplitude = 1, frequency = 1, maxAmplitude = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxAmplitude; // Normalized to roughly -1..1
}

// Biome-specific noise profiles.
//  - scale/amplitude/octaves/...: medium-frequency DETAIL roughness (local hills)
//  - continentScale/continentAmplitude: low-frequency CONTINENTAL layer that
//    creates broad highlands and deep valleys/canyons you fly over and into.
const TERRAIN_PROFILES = {
  forest:   { scale: 0.05,  amplitude: 13, octaves: 5, persistence: 0.45, lacunarity: 2.1, continentScale: 0.013, continentAmplitude: 26 },
  canyons:  { scale: 0.035, amplitude: 18, octaves: 4, persistence: 0.55, lacunarity: 2.3, continentScale: 0.012, continentAmplitude: 40 },
  mountain: { scale: 0.03,  amplitude: 24, octaves: 6, persistence: 0.5,  lacunarity: 2.0, continentScale: 0.011, continentAmplitude: 42 },
  city:     { scale: 0.07,  amplitude: 5,  octaves: 3, persistence: 0.35, lacunarity: 2.0, continentScale: 0.015, continentAmplitude: 15 },
};

// Face shaping. The continental carve is pushed through tanh to shape the
// transition from highland to valley floor. Kept LOW so the faces ROLL (broad
// gradients) rather than snapping to flat mesas/cliffs — the world should read as
// undulating terrain everywhere, not a flat plain with the odd sharp pit. Higher
// = sharper faces; lower = rounder, rolling relief.
const FACE_STEEPNESS = 1.4;
const TANH_FACE_NORM = Math.tanh(FACE_STEEPNESS);

// Downward bias on the continental field. We can't raise terrain above the base
// radius (it doubles as the flight/collision floor for a gravity-less bird that
// must never be ratcheted upward — see invariant below), so "rolling hills" are
// faked by carving DOWN across MOST of the surface: shifting the continental
// field down by this much sinks the average ground into rolling lowlands and
// leaves only the highest peaks at the baseline ceiling. Crucially it also
// unlocks the medium-frequency DETAIL roughness almost everywhere — detail is
// only visible where the ground is carved below baseline (otherwise it's clamped
// flat), so a deeper average carve = rolling texture across the whole world.
const CONTINENT_BIAS = 0.35;

// Combined terrain displacement at a unit direction (nx,ny,nz): medium-frequency
// detail (local roughness) + a broad low-frequency continental layer (deep
// valleys/canyons). The WHOLE result is clamped to <= 0 ("carve down from a
// baseline plateau"), which is the key invariant that lets the SAME function be
// the visible mesh AND the flight/collision floor:
//   * mesh == floor  -> the bird can never fly through what it sees (the old bug
//     was detail hills poking ABOVE a smoother, continental-only floor).
//   * height <= 0     -> the floor never rises above the base radius, so the
//     gravity-less bird is never ratcheted upward, never falsely grounded, and
//     never pops at spawn. Upward relief comes from PROPS (trees, mountains,
//     towers) which have their own colliders; the terrain itself only descends.
// Shared by the sphere mesh, prop placement, and the flight floor so all agree.
//
// ── Landmark valley (one dramatic carved feature, in every environment) ──
// A deep basin + a shallow inflow groove, carved into the SAME displacement the
// mesh AND flight floor share. valleyCarveAt() returns <= 0 and is folded into
// terrainDisplacement's Math.min(0,…), so the carve-down invariant holds (the
// bird flies DOWN into the valley; the floor never rises). The overlaid water
// (pool/waterfall/river) lives in landmark-valley.js and rides this carve via a
// heightAt() probe. The slalom Run is anchored separately (SLALOM_ANCHOR).
const VALLEY_ANCHOR = (() => { const x = 0.35, y = 0.78, z = 0.52; const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; })();
const SLALOM_ANCHOR = (() => { const x = -0.55, y = 0.62, z = -0.58; const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; })();
// riverDepth 7 (was 4): the inflow brook must out-carve the forest detail
// noise or the water reads as buried slivers on the plateau.
const VALLEY_PARAMS = { radiusAng: 0.16, depth: 28, riverHalfAng: 0.05, riverReachAng: 0.30, riverDepth: 7, poolRadius: 11, canyonReachAng: 0.52, canyonHalfAng: 0.062, canyonDepth: 22 };

let _valleyActive = false;
let _vaX = 0, _vaY = 0, _vaZ = 0;   // anchor unit dir
let _vfX = 0, _vfY = 0, _vfZ = 0;   // river forward (tangent)
let _vrX = 0, _vrY = 0, _vrZ = 0;   // river across (tangent)
let _valleyRadiusAng = 0.16, _valleyDepth = 28, _valleyCosCull = 0.85;
let _riverHalfAng = 0.05, _riverReachAng = 0.30, _riverDepth = 4;
let _canyonReachAng = 0.52, _canyonHalfAng = 0.062, _canyonDepth = 22;

function setActiveValley(anchor, forward, right, params) {
  _valleyActive = true;
  _vaX = anchor.x; _vaY = anchor.y; _vaZ = anchor.z;
  _vfX = forward.x; _vfY = forward.y; _vfZ = forward.z;
  _vrX = right.x; _vrY = right.y; _vrZ = right.z;
  _valleyRadiusAng = params.radiusAng; _valleyDepth = params.depth;
  _riverHalfAng = params.riverHalfAng; _riverReachAng = params.riverReachAng; _riverDepth = params.riverDepth;
  _canyonReachAng = params.canyonReachAng; _canyonHalfAng = params.canyonHalfAng; _canyonDepth = params.canyonDepth;
  _valleyCosCull = Math.cos(Math.max(params.radiusAng, params.riverReachAng, params.canyonReachAng) + 0.05);
}

// Tangent frame (forward/right) at a unit anchor — the river axis + across axis.
function _tangentFrame(THREE, anchor) {
  const A = new THREE.Vector3(anchor.x, anchor.y, anchor.z).normalize();
  let f = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), A);
  if (f.lengthSq() < 1e-4) f = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), A);
  f.normalize();
  const r = new THREE.Vector3().crossVectors(A, f).normalize();
  return { forward: { x: f.x, y: f.y, z: f.z }, right: { x: r.x, y: r.y, z: r.z } };
}

// Extra downward carve for the landmark valley at a unit direction (always <= 0).
// Single-dot early-out so the ~24k mesh samples and per-frame floor samples that
// are far from the valley cost almost nothing.
function valleyCarveAt(nx, ny, nz) {
  if (!_valleyActive) return 0;
  const d = _vaX * nx + _vaY * ny + _vaZ * nz;
  if (d < _valleyCosCull) return 0;
  // Clamp both sides before acos — the early-out above already keeps d well
  // inside [_valleyCosCull, 1], but this guards the sacred floor invariant
  // against any float drift making d slip just past ±1 (acos(±1.0000001) = NaN).
  const ang = Math.acos(d > 1 ? 1 : d < -1 ? -1 : d);
  let carve = 0;
  if (ang < _valleyRadiusAng) {
    const t = 1 - ang / _valleyRadiusAng;
    // Cliff-walled basin: full depth reached by t >= 0.45, giving a FLAT pond
    // floor (~11u radius — matches the pool disc) ringed by steep headwalls.
    // The old plain-smoothstep bowl was so gradual that the waterfall sheet
    // sat INSIDE the slope and the pool was mostly buried (2026-06-11
    // playtest). Still strictly carve-down (<= 0): the floor invariant holds.
    const tc = Math.min(1, t / 0.45);
    carve -= _valleyDepth * (tc * tc * (3 - 2 * tc));
  }
  const along = _vfX * nx + _vfY * ny + _vfZ * nz;
  if (along > 0 && ang < _riverReachAng) {
    const across = _vrX * nx + _vrY * ny + _vrZ * nz;
    const acrossAng = Math.asin(across < -1 ? -1 : across > 1 ? 1 : across);
    const w = 1 - Math.abs(acrossAng) / _riverHalfAng;
    if (w > 0) {
      const wf = w * w * (3 - 2 * w);
      const reach = 1 - ang / _riverReachAng;
      carve -= _riverDepth * wf * (reach > 0 ? reach : 0);
    }
  }
  // Outflow canyon: a long, deep channel running DOWNSTREAM (−forward) from the
  // basin, so the valley doesn't end at the pool — it carves away for a good
  // distance below the waterfall before easing back up to the plateau.
  if (along < 0 && ang < _canyonReachAng) {
    const across = _vrX * nx + _vrY * ny + _vrZ * nz;
    const acrossAng = Math.asin(across < -1 ? -1 : across > 1 ? 1 : across);
    const w = 1 - Math.abs(acrossAng) / _canyonHalfAng;
    if (w > 0) {
      const wf = w * w * (3 - 2 * w);
      const u = ang / _canyonReachAng;            // 0 at basin → 1 at far end
      let lp = u < 0.15 ? u / 0.15 : u > 0.8 ? (1 - (u - 0.8) / 0.2) : 1;
      lp = lp < 0 ? 0 : lp > 1 ? 1 : lp;
      carve -= _canyonDepth * wf * (lp * lp * (3 - 2 * lp));
    }
  }
  // Final guard: never let a non-finite value reach terrainDisplacement's
  // Math.min(0,…) — a NaN there would corrupt the mesh AND the flight floor.
  return Number.isFinite(carve) && carve < 0 ? carve : 0;
}

function terrainDisplacement(nx, ny, nz, profile) {
  const R = SPHERE_RADIUS;
  const detail = fbm(nx * R * profile.scale, ny * R * profile.scale, nz * R * profile.scale, profile.octaves, profile.lacunarity, profile.persistence) * profile.amplitude;
  let cont = 0;
  if (profile.continentAmplitude) {
    const cs = profile.continentScale;
    // Shift the field DOWN by CONTINENT_BIAS so most of it is < 0 → carved, rolling
    // lowlands; only the highest peaks (c > BIAS) stay at the baseline plateau.
    const c = fbm(nx * R * cs, ny * R * cs, nz * R * cs, 3, 2.0, 0.5) - CONTINENT_BIAS;
    // Carve where c < 0, shaped by a GENTLE tanh face (rolling, not cliffs).
    // Clamped to [-1, 0] so the bias overshoot can't carve past the amplitude.
    const carve = c < 0 ? Math.max(-1, -Math.tanh(-FACE_STEEPNESS * c) / TANH_FACE_NORM) : 0;
    cont = carve * profile.continentAmplitude;
  }
  // Clamp the COMBINED height to <= 0 (downward-only — preserves the flight-floor
  // invariant). Detail textures the cliff faces/floors and dimples the plateau,
  // but the plateau itself is the ceiling — nothing rises above the base radius.
  return Math.min(0, cont + detail + valleyCarveAt(nx, ny, nz));
}

// FULL terrain height (detail + carved continental) along a unit direction.
// Used by the sphere MESH and prop placement so the ground has its fine texture.
// Zero-allocation.
function terrainHeightDir(nx, ny, nz) {
  return _activeTerrainProfile ? terrainDisplacement(nx, ny, nz, _activeTerrainProfile) : 0;
}

// The flyable/landing/collision FLOOR along a unit direction. This is now the
// SAME full terrain the mesh uses (detail + continental, clamped <= 0), so the
// bird rests exactly on the surface it sees — no flying through detail hills, and
// solid canyon walls/floors when you descend in. The downward-only clamp (inside
// terrainDisplacement) keeps it a true MINIMUM-altitude floor: it only ever dips
// below the base radius, never lifts the cruising bird. The bird's birdRadius
// clearance hides any sub-vertex skim jitter. Zero-allocation. 0 before any world
// is built. Kept as its own name because callers are the flight/collision path.
function terrainFloorDir(nx, ny, nz) {
  return _activeTerrainProfile ? terrainDisplacement(nx, ny, nz, _activeTerrainProfile) : 0;
}

// Public sampler for the flight controller: the smooth valley FLOOR (≤0) at a
// WORLD position's direction. Zero-allocation (primitives only), safe per-frame.
export function sampleTerrainHeight(x, y, z) {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < 1e-6) return 0;
  const inv = 1 / len;
  return terrainFloorDir(x * inv, y * inv, z * inv);
}

// Height-based color palettes per biome (low altitude → high altitude).
// Beauty pass: richer, more saturated stops derived from each biome's own
// sky/light/ground identity (world-shell.js ENVIRONMENT_VARIANTS) — same world,
// more alive. More intermediate stops give smoother, more painterly bands.
const TERRAIN_COLORS = {
  forest: [
    { height: -0.3, color: [0.06, 0.20, 0.30] },  // Deep water (dark blue-green)
    { height: -0.05, color: [0.10, 0.30, 0.40] },  // Shallow water
    { height: 0.0,  color: [0.50, 0.46, 0.30] },   // Sand/shore
    { height: 0.08, color: [0.14, 0.42, 0.20] },   // Lush valley grass (vivid)
    { height: 0.22, color: [0.20, 0.52, 0.27] },   // Rich meadow
    { height: 0.4,  color: [0.16, 0.44, 0.22] },   // Deep forest green
    { height: 0.58, color: [0.30, 0.40, 0.22] },   // Dry grass / clearing
    { height: 0.74, color: [0.34, 0.30, 0.20] },   // Soil / ridge earth
    { height: 0.9,  color: [0.40, 0.36, 0.30] },   // Exposed rock
    { height: 1.0,  color: [0.74, 0.78, 0.82] },   // Snow dusting
  ],
  canyons: [
    { height: -0.2, color: [0.16, 0.07, 0.03] },   // Deep canyon floor (rust shadow)
    { height: 0.0,  color: [0.34, 0.14, 0.07] },   // Canyon floor
    { height: 0.15, color: [0.46, 0.20, 0.09] },   // Red rock low band
    { height: 0.3,  color: [0.58, 0.27, 0.12] },   // Sediment band — red
    { height: 0.45, color: [0.70, 0.38, 0.18] },   // Sediment band — orange
    { height: 0.58, color: [0.80, 0.52, 0.30] },   // Cream/buff strata
    { height: 0.72, color: [0.66, 0.36, 0.18] },   // Orange mesa wall
    { height: 0.88, color: [0.56, 0.32, 0.18] },   // Mesa top
    { height: 1.0,  color: [0.44, 0.24, 0.14] },   // Peak
  ],
  mountain: [
    { height: -0.2, color: [0.05, 0.14, 0.20] },   // Deep valley
    { height: 0.0,  color: [0.09, 0.22, 0.18] },   // Valley floor
    { height: 0.14, color: [0.13, 0.34, 0.21] },   // Low alpine meadow (vivid)
    { height: 0.3,  color: [0.14, 0.27, 0.18] },   // Pine line
    { height: 0.46, color: [0.22, 0.24, 0.22] },   // Grey-green slope
    { height: 0.6,  color: [0.34, 0.34, 0.34] },   // Rock face
    { height: 0.74, color: [0.50, 0.50, 0.52] },   // High scree
    { height: 0.86, color: [0.74, 0.76, 0.80] },   // Snow line
    { height: 1.0,  color: [0.90, 0.93, 0.97] },   // Peak snow
  ],
  city: [
    { height: -0.1, color: [0.05, 0.07, 0.12] },   // Low ground (deep asphalt)
    { height: 0.0,  color: [0.09, 0.11, 0.17] },   // Ground level asphalt
    { height: 0.25, color: [0.11, 0.14, 0.21] },   // Concrete block
    { height: 0.45, color: [0.13, 0.20, 0.20] },   // Park-green patch tint
    { height: 0.65, color: [0.12, 0.17, 0.27] },   // Elevated concrete
    { height: 1.0,  color: [0.16, 0.23, 0.34] },   // High ground (cool slab)
  ],
};

function sampleTerrainColor(palette, normalizedHeight) {
  // normalizedHeight: 0..1 mapped from displacement range
  const h = Math.max(0, Math.min(1, normalizedHeight));
  for (let i = 1; i < palette.length; i++) {
    if (h <= palette[i].height) {
      const prev = palette[i - 1], curr = palette[i];
      const t = (h - prev.height) / (curr.height - prev.height);
      return [
        prev.color[0] + t * (curr.color[0] - prev.color[0]),
        prev.color[1] + t * (curr.color[1] - prev.color[1]),
        prev.color[2] + t * (curr.color[2] - prev.color[2]),
      ];
    }
  }
  const last = palette[palette.length - 1].color;
  return [last[0], last[1], last[2]];
}

/**
 * Displace sphere vertices using FBM noise and assign vertex colors.
 * Returns the displacement array for use by object placement (spawn on terrain).
 */
function displaceSphereGeometry(geometry, sphereRadius, variant = 'forest') {
  const profile = TERRAIN_PROFILES[variant] || TERRAIN_PROFILES.forest;
  const palette = TERRAIN_COLORS[variant] || TERRAIN_COLORS.forest;
  const posAttr = geometry.getAttribute('position');
  const count = posAttr.count;

  // Add vertex colors
  const colors = new Float32Array(count * 3);

  // Track min/max displacement for normalization
  let minDisp = Infinity, maxDisp = -Infinity;
  const displacements = new Float32Array(count);

  // First pass: compute displacements
  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    // Normalize to unit sphere for noise sampling
    const len = Math.sqrt(x * x + y * y + z * z);
    const nx = x / len, ny = y / len, nz = z / len;
    const disp = terrainDisplacement(nx, ny, nz, profile);
    displacements[i] = disp;
    if (disp < minDisp) minDisp = disp;
    if (disp > maxDisp) maxDisp = disp;
  }

  const dispRange = maxDisp - minDisp || 1;

  // Second pass: apply displacement + vertex colors
  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const len = Math.sqrt(x * x + y * y + z * z);
    const nx = x / len, ny = y / len, nz = z / len;

    const disp = displacements[i];
    // Displace along normal
    posAttr.setXYZ(i, nx * (sphereRadius + disp), ny * (sphereRadius + disp), nz * (sphereRadius + disp));

    // Color by depth. Terrain now carves DOWN (disp <= 0, maxDisp ~ 0), so the
    // dominant plateau (disp ~ 0) is the biome's BASE ground and valleys deepen
    // below it. Map plateau -> mid palette (ground tone) and the deepest carve ->
    // low palette, so we never paint the plateau with the snow/peak top color
    // (which the old "0=low,1=high" mapping did once everything went <= 0).
    const depthN = minDisp < 0 ? (disp - minDisp) / (-minDisp) : 1; // 0 = deepest, 1 = plateau

    // Beauty pass — break the smooth elevation ramp with painterly variation so
    // the ground reads as patchy living terrain, not a clean banded gradient.
    // Build-time only (one noise field eval per vertex; ~24k total). Two cheap,
    // independent low-frequency fields:
    //   patch  — a broad low-freq field that nudges the palette SAMPLE up/down,
    //            so a valley floor can carry a dry-grass clearing or a ridge can
    //            keep a lush pocket (lush/dry mottling for free).
    //   mottle — a higher-freq field applied as a small per-vertex luminance
    //            jitter so adjacent faces differ subtly (kills the flat-paint look).
    const patch = fbm(nx * 2.3, ny * 2.3, nz * 2.3, 3, 2.0, 0.5);   // ~-1..1, broad
    const mottle = fbm(nx * 9.0, ny * 9.0, nz * 9.0, 2, 2.0, 0.5);  // ~-1..1, fine

    // Slope term: faces whose geometric normal tilts away from the radial "up"
    // are steeper. We don't have computeVertexNormals yet (it runs after this
    // loop), so approximate slope from the local displacement gradient proxy —
    // deeper carve below the plateau tends to mean steeper walls, so bias steep
    // spots slightly toward the higher (rockier) palette stops. Cheap & stable.
    const slopeBias = (1 - depthN) * 0.06; // 0 on plateau → +0.06 deep in carves

    let normalizedHeight = 0.1 + 0.5 * depthN + patch * 0.07 + slopeBias;
    normalizedHeight = normalizedHeight < 0 ? 0 : normalizedHeight > 1 ? 1 : normalizedHeight;
    const col = sampleTerrainColor(palette, normalizedHeight);
    const lum = 1 + mottle * 0.10; // ±10% per-vertex luminance for surface texture
    let r = col[0] * lum, g = col[1] * lum, b = col[2] * lum;
    colors[i * 3] = r < 0 ? 0 : r > 1 ? 1 : r;
    colors[i * 3 + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
    colors[i * 3 + 2] = b < 0 ? 0 : b > 1 ? 1 : b;
  }

  geometry.setAttribute('color', new THREEImported.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  posAttr.needsUpdate = true;

  return { displacements, minDisp, maxDisp };
}

// ============================================================
// FOREST — Dense groves with canopy corridors
// Design: 12-15 groves of 12-20 trees each, clustered tight.
// Fly THROUGH gaps between groves. Fly UNDER canopy within.
// Trees 15-35 units tall (bird is ~1 unit).
// InstancedMesh for performance (1 draw call per type).
// ============================================================
function buildForestOnSphere({ THREE, root, sphereRadius, collisionSystem, proximityTargets }) {
  const nestablePositions = [];
  const defaultUp = new THREE.Vector3(0, 1, 0);

  // --- Shared materials (flat shading for low-poly aesthetic) ---
  // Bark base nudged ~15% brighter than the old 0x3a2a1a so the per-instance
  // jitter (which multiplies, mean ~1.0) averages back to the original tone.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x43301e, flatShading: true });
  // Canopy mats carry vertexColors so the baked base→tip gradient reads; the
  // gradient averages ~0.85 so the hues are lifted slightly to compensate.
  const canopyMats = [
    new THREE.MeshLambertMaterial({ color: 0x1f6d39, flatShading: true, vertexColors: true }),
    new THREE.MeshLambertMaterial({ color: 0x2a854c, flatShading: true, vertexColors: true }),
    new THREE.MeshLambertMaterial({ color: 0x35a258, flatShading: true, vertexColors: true }),
  ];
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x2a3a3a, flatShading: true });
  const shrubMat = new THREE.MeshLambertMaterial({ color: 0x2e7a48, flatShading: true });

  // Canopy ceiling material — translucent green, dappled feel when below.
  // One InstancedMesh across all groves keeps it to a single draw call.
  const canopyCeilingMat = new THREE.MeshBasicMaterial({
    color: 0x1e6a36,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // --- Generate grove center points (spread across sphere) ---
  // Further reduced to avoid "tree walls" and heavy overlap on mobile.
  // With fibonacci distribution on sphereRadius=120, 8 groves gives
  // ~125-unit average centre-to-centre spacing.
  const groveCount = _isMobile() ? 9 : 12;
  const groveCenters = fibonacciSpherePoints(groveCount, sphereRadius);

  // Pre-collect ceiling placements; we'll build one InstancedMesh after the loop.
  const ceilingPlacements = []; // { pos, up, radius }

  // PERF: instead of ~210 tree Groups × 2 meshes = ~420 draw calls, we collect
  // placements here and build 1 trunk InstancedMesh + 3 canopy InstancedMeshes
  // (one per color material) after the grove loop — 4 draw calls total.
  // Unit trunk geom (radius 1, height 1, centered at origin+0.5 up); per-instance
  // scale encodes trunk radius * treeScale (X/Z) and trunk height * treeScale (Y).
  const trunkPlacements = []; // { pos, up, trunkRadiusBottom, trunkHeight, treeScale }
  const canopyPlacementsByColor = [[], [], []]; // one bucket per canopy material
  // { pos, up, canopyRadius, canopyHeight, treeScale, trunkHeight }

  let treeIndex = 0;
  const nestInterval = 5; // Every 5th tree is nestable — denser nest field (~1.9x)

  groveCenters.forEach((groveCenter, groveIdx) => {
    // Fuller groves (desktop 8-14 / mobile 5-9 — both above the old 4-8); the
    // angular-spacing pass below keeps them from stacking into tree walls.
    const treesInGrove = Math.floor(randomInRange(_isMobile() ? 5 : 8, _isMobile() ? 9 : 14));
    // Cluster radius in angular space — wider than before so trees aren't
    // stacked. On radius 120, 0.07 rad ≈ 8.4 units at surface.
    const clusterSpread = randomInRange(0.05, 0.09);
    const minTreeAngularSpacing = randomInRange(0.028, 0.04);
    const placedAngles = [];

    // Pick 1-2 "champion" indices and 1-2 "shrimp" indices per grove
    const championCount = 1 + (Math.random() < 0.4 ? 1 : 0);
    const shrimpCount = 1 + (Math.random() < 0.5 ? 1 : 0);
    const championSet = new Set();
    const shrimpSet = new Set();
    while (championSet.size < championCount) championSet.add(Math.floor(Math.random() * treesInGrove));
    while (shrimpSet.size < shrimpCount) {
      const idx = Math.floor(Math.random() * treesInGrove);
      if (!championSet.has(idx)) shrimpSet.add(idx);
    }

    // Track max tree top for canopy ceiling placement
    let maxTreeTopOffset = 0;
    let championTopPos = null;

    for (let t = 0; t < treesInGrove; t++) {
      let jitterTheta = groveCenter.theta;
      let jitterPhi = groveCenter.phi;
      let accepted = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        jitterTheta = groveCenter.theta + randomInRange(-clusterSpread, clusterSpread);
        jitterPhi = groveCenter.phi + randomInRange(-clusterSpread * 0.65, clusterSpread * 0.65);
        if (placedAngles.every((a) =>
          angularDistance(jitterTheta, jitterPhi, a.theta, a.phi) >= minTreeAngularSpacing
        )) {
          accepted = true;
          break;
        }
      }
      if (!accepted) continue; // Never force overlapping crowns after exhausted retries.
      placedAngles.push({ theta: jitterTheta, phi: jitterPhi });
      const pos = placeOnSphere(THREE, sphereRadius, jitterTheta, jitterPhi, 0);
      const up = pos.clone().normalize();

      const trunkHeight = randomInRange(8, 16);
      const trunkRadiusBottom = randomInRange(0.5, 1.0);
      const canopyHeight = randomInRange(8, 16);
      const canopyRadius = randomInRange(3, 6);
      const canopyColorIdx = Math.floor(Math.random() * canopyMats.length);

      // Scale variation with champion / shrimp overrides for dramatic height variation
      let scale;
      const isChampion = championSet.has(t);
      // A tree hosts a nest if it's a champion OR lands on the nest interval. Nest
      // trees have a bounded crown height. One well-spaced crown is selected
      // per grove by the nest system; taller scenery stays around the perch.
      // A nest tree is therefore never a shrimp.
      const isNestTree = isChampion || (treeIndex % nestInterval === 0);
      const isShrimp = shrimpSet.has(t) && !isNestTree;
      if (isNestTree) {
        // A canopy perch, not an observation tower above the entire planet.
        // Old 2.6–3.6x trees put nests up to ~110u above a radius-120 world.
        scale = randomInRange(30, 40) / (trunkHeight + canopyHeight * 0.9);
      } else if (isShrimp) {
        scale = randomInRange(0.5, 0.7); // Undergrowth
      } else {
        scale = randomInRange(1.0, 2.0);
      }

      trunkPlacements.push({ pos, up, trunkRadiusBottom, trunkHeight, treeScale: scale });
      canopyPlacementsByColor[canopyColorIdx].push({
        pos, up, canopyRadius, canopyHeight, treeScale: scale, trunkHeight,
      });

      // Collision — trunk at base, plus a canopy sphere at tree-top altitude
      // so cruise-level birds actually bump into the visible tree.
      collisionSystem.addCollider(pos, Math.min(trunkRadiusBottom * scale * 1.2, 3.7), 'tree');
      const treeCanopyCenter = pos.clone().add(
        up.clone().multiplyScalar((trunkHeight + canopyHeight * 0.5) * scale)
      );
      collisionSystem.addCollider(treeCanopyCenter, canopyRadius * scale * 0.95, 'tree');

      const treeTopLocalY = trunkHeight + canopyHeight * 0.8 + 0.5;
      const treeTopOffset = treeTopLocalY * scale;
      if (treeTopOffset > maxTreeTopOffset) {
        maxTreeTopOffset = treeTopOffset;
        championTopPos = pos;
      }

      // Nest positions — on the (now emergent) nest trees, sat ABOVE the canopy
      // crown + clearance rather than nestled inside the foliage, so every nest
      // reads in the open and the approach from above is clear. Champions are
      // included as hosts, which also lifts the overall nest count.
      if (isNestTree) {
        const nestHeight = (trunkHeight + canopyHeight * 0.9) * scale + 0.2; // clear of the crown
        const nestPos = pos.clone().add(up.clone().multiplyScalar(nestHeight));
        nestablePositions.push({
          position: nestPos,
          surfaceNormal: up.clone(),
          hostObject: null,
          hostId: `forest-tree-${groveIdx}-${t}`,
          groveId: `forest-grove-${groveIdx}`,
        });
        // Champions also fire the proximity whoosh cue.
        if (isChampion && proximityTargets) {
          proximityTargets.push({
            position: nestPos.clone(),
            radius: 10,
            tint: 0x9be5b0,
          });
        }
      }
      treeIndex++;
    }

    // Defer ceiling placement to one InstancedMesh after the loop (single draw call).
    if (maxTreeTopOffset > 10) {
      const ceilingPos = placeOnSphere(THREE, sphereRadius, groveCenter.theta, groveCenter.phi, 0);
      const up = ceilingPos.clone().normalize();
      const ceilingHeight = maxTreeTopOffset * 0.66;
      const discRadius = sphereRadius * clusterSpread * 1.35;
      const finalPos = ceilingPos.clone().addScaledVector(up, ceilingHeight);
      ceilingPlacements.push({ pos: finalPos, up, radius: discRadius });

      // Champion-tier grove: add proximity target at ceiling edge for whoosh
      if (championTopPos && proximityTargets) {
        proximityTargets.push({
          position: finalPos.clone(),
          radius: 12,
          tint: 0xaaf0c0,
        });
      }
    }
  });

  // --- Tall bare snags / emergent birches (vertical mid-layer accents) ---
  // Pushed into trunkPlacements so they ride the SAME trunk InstancedMesh (zero
  // new draw calls) with no canopy. Collider-free decoration — thin verticals
  // the bird threads between the canopy and the emergent giants/clouds.
  const snagsPerGrove = _isMobile() ? 1 : 2;
  groveCenters.forEach((grove) => {
    for (let s = 0; s < snagsPerGrove; s++) {
      const theta = grove.theta + randomInRange(-0.075, 0.075);
      const phi = grove.phi + randomInRange(-0.05, 0.05);
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();
      trunkPlacements.push({
        pos, up,
        trunkRadiusBottom: randomInRange(0.3, 0.45),
        trunkHeight: randomInRange(22, 30),
        treeScale: randomInRange(1.0, 1.4),
      });
    }
  });

  // --- Global tree scatter — fills the bare ground BETWEEN groves so the world
  // reads as a continuous forest, not a handful of isolated clusters. This is the
  // real fix for "feels sparse": on a radius-120 sphere the horizon is only ~44u
  // away, but groves sit ~125u apart, so most views land in an empty gap. These
  // evenly-distributed singles guarantee trees are always in view. They ride the
  // SAME trunk + canopy InstancedMeshes (zero new draw calls). Mobile-gated.
  const scatterTreeCount = _isMobile() ? 270 : 420;
  const scatterTreePoints = fibonacciSpherePoints(scatterTreeCount, sphereRadius);
  for (let i = 0; i < scatterTreePoints.length; i++) {
    const sp = scatterTreePoints[i];
    const jt = sp.theta + randomInRange(-0.05, 0.05);
    const jp = sp.phi + randomInRange(-0.05, 0.05);
    // Zone the forest by elevation: lush + dense down in the carved valleys,
    // thinning to dwarfed trees on the exposed plateau tops (a soft tree line).
    // Terrain is now <= 0 (carve-down), so depth = -th: 0 on the plateau, larger
    // the deeper the valley. This is the "low forest / high forest" variation.
    const spp = Math.sin(jp);
    const th = terrainHeightDir(spp * Math.cos(jt), Math.cos(jp), spp * Math.sin(jt));
    const depth = -th;                                                  // 0 plateau → deep valley
    const exposure = Math.max(0, Math.min(1, 1 - depth / 24));          // 1 exposed top → 0 valley
    if (exposure > 0.82 && Math.random() < (exposure - 0.82) * 1.0) continue; // thin exposed tops
    const pos = placeOnSphere(THREE, sphereRadius, jt, jp, 0);
    const up = pos.clone().normalize();
    const trunkHeight = randomInRange(8, 15);
    const trunkRadiusBottom = randomInRange(0.45, 0.9);
    const canopyHeight = randomInRange(8, 15);
    const canopyRadius = randomInRange(3, 5.5);
    const scale = randomInRange(0.9, 2.0) * (0.78 + (1 - exposure) * 0.32); // dwarf tops, lush valleys
    const canopyColorIdx = Math.floor(Math.random() * canopyMats.length);
    trunkPlacements.push({ pos, up, trunkRadiusBottom, trunkHeight, treeScale: scale });
    canopyPlacementsByColor[canopyColorIdx].push({ pos, up, canopyRadius, canopyHeight, treeScale: scale, trunkHeight });
    collisionSystem.addCollider(pos, Math.min(trunkRadiusBottom * scale * 1.2, 3.5), 'tree');
    const scatterCanopyCenter = pos.clone().add(up.clone().multiplyScalar((trunkHeight + canopyHeight * 0.5) * scale));
    collisionSystem.addCollider(scatterCanopyCenter, canopyRadius * scale * 0.95, 'tree');
  }

  // --- Build instanced trunks (1 draw call for ALL trunks) ---
  // Unit trunk geom: cylinder with radius 1 at bottom, 0.4 at top, height 1,
  // centred so y=0 sits at the base and y=1 at the top. Per-instance scale
  // gives final proportions; rotation orients trunk along surface normal.
  if (trunkPlacements.length > 0) {
    const trunkUnitGeom = new THREE.CylinderGeometry(0.4, 1.0, 1.0, 6);
    // Translate up by 0.5 so the cylinder base sits at y=0 in local space.
    trunkUnitGeom.translate(0, 0.5, 0);
    const trunkInst = new THREE.InstancedMesh(trunkUnitGeom, trunkMat, trunkPlacements.length);
    trunkInst.name = 'forest-trunks';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    for (let i = 0; i < trunkPlacements.length; i++) {
      const p = trunkPlacements[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      dummy.position.copy(p.pos);
      dummy.quaternion.copy(orientQ);
      // Non-uniform scale bakes trunkRadiusBottom / trunkHeight into the unit geom.
      dummy.scale.set(
        p.trunkRadiusBottom * p.treeScale,
        p.trunkHeight * p.treeScale,
        p.trunkRadiusBottom * p.treeScale,
      );
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
    }
    trunkInst.instanceMatrix.needsUpdate = true;
    trunkInst.computeBoundingSphere();
    // Per-instance bark variation: trunkMat base is near the mean bark tone, so
    // jitter spreads each trunk a little lighter/darker (weathered grove look).
    applyInstanceColorJitter(THREE, trunkInst, trunkPlacements.length, 1, 1, 1, 0.18, 0.03);
    root.add(trunkInst);
  }

  // --- Build instanced canopies, one InstancedMesh per color bucket ---
  // Unit canopy geom: cone with radius 1, height 1, base at y=0, tip at y=1.
  // Vertex gradient bakes a darker shaded base → brighter sun-lit tip into the
  // foliage cone (build-time, zero runtime cost). The gradient MULTIPLIES the
  // per-bucket canopy material color, so leave the gradient near-white and let
  // the material + per-instance jitter carry the hue.
  const localUp = new THREE.Vector3();
  for (let c = 0; c < canopyPlacementsByColor.length; c++) {
    const bucket = canopyPlacementsByColor[c];
    if (bucket.length === 0) continue;
    const canopyUnitGeom = createCanopyGeometry(THREE, c);
    addFoliageWind(canopyMats[c]);
    const canopyInst = new THREE.InstancedMesh(canopyUnitGeom, canopyMats[c], bucket.length);
    canopyInst.name = `forest-canopies-${c}`;
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    for (let i = 0; i < bucket.length; i++) {
      const p = bucket[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      // Original: canopy's center was at local-y = trunkHeight + canopyHeight*0.4.
      // Original ConeGeometry was centered (base at -h/2, tip at +h/2).
      // So canopy BASE was at local-y = trunkHeight + canopyHeight*0.4 - canopyHeight*0.5
      //   = trunkHeight - canopyHeight*0.1
      // We use a unit cone with base at y=0, tip at y=1, scaled by canopyHeight.
      // So place the instance origin at pos + up * (trunkHeight - canopyHeight*0.1) * treeScale.
      const baseYWorld = (p.trunkHeight - p.canopyHeight * 0.1) * p.treeScale;
      localUp.copy(p.up).multiplyScalar(baseYWorld);
      dummy.position.copy(p.pos).add(localUp);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(
        p.canopyRadius * p.treeScale,
        p.canopyHeight * p.treeScale,
        p.canopyRadius * p.treeScale,
      );
      dummy.updateMatrix();
      canopyInst.setMatrixAt(i, dummy.matrix);
    }
    canopyInst.instanceMatrix.needsUpdate = true;
    canopyInst.computeBoundingSphere();
    // Per-instance foliage hue/luminance spread so the grove stops looking like
    // one cloned tree repeated. Mean 1.0 keeps the bucket's average hue intact.
    applyInstanceColorJitter(THREE, canopyInst, bucket.length, 1, 1, 1, 0.16, 0.045);
    root.add(canopyInst);
  }

  // --- Build one InstancedMesh for all canopy ceilings (single draw call) ---
  // Mobile fill-rate: canopy ceilings are large transparent discs rendered
  // from the inside of groves. Even with just 1 draw call the overdraw cost
  // on mobile during Ring Rush is significant (player often flies under them).
  // Gate disabled on mobile; desktop keeps the painterly canopy feel.
  if (ceilingPlacements.length > 0 && !_isMobile()) {
    // Slight noisy edge once, applied to the shared base geometry.
    const baseDiscGeom = new THREE.CircleGeometry(1.0, 10);
    const posAttr = baseDiscGeom.getAttribute('position');
    for (let v = 1; v < posAttr.count; v++) {
      const cx = posAttr.getX(v), cy = posAttr.getY(v);
      const jitter = 0.82 + Math.random() * 0.36;
      posAttr.setX(v, cx * jitter);
      posAttr.setY(v, cy * jitter);
    }
    posAttr.needsUpdate = true;
    const ceilings = new THREE.InstancedMesh(baseDiscGeom, canopyCeilingMat, ceilingPlacements.length);
    ceilings.name = 'forest-canopy-ceilings';
    ceilings.renderOrder = 1;
    ceilings.raycast = () => {};
    const dummy = new THREE.Object3D();
    const flatRotX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const orientQ = new THREE.Quaternion();
    const tmpQ = new THREE.Quaternion();
    ceilingPlacements.forEach((p, idx) => {
      orientQ.setFromUnitVectors(defaultUp, p.up);
      tmpQ.copy(orientQ).multiply(flatRotX);
      dummy.position.copy(p.pos);
      dummy.quaternion.copy(tmpQ);
      dummy.scale.setScalar(p.radius);
      dummy.updateMatrix();
      ceilings.setMatrixAt(idx, dummy.matrix);
    });
    ceilings.instanceMatrix.needsUpdate = true;
    root.add(ceilings);
  }

  console.log(`[Forest] ${treeIndex} trees in ${groveCount} groves, ${nestablePositions.length} nests, ${_isMobile() ? 0 : ceilingPlacements.length} canopy ceilings (${_isMobile() ? 'mobile gated' : 'instanced'})`);

  // --- Shrubs at grove edges (ground-level scale anchors) ---
  // Collect placements then build one InstancedMesh (was ~126 draw calls).
  const shrubPlacements = []; // { pos, up, baseRadius, scaleMul }
  groveCenters.forEach((grove) => {
    const shrubsPerGrove = Math.floor(randomInRange(6, 12));
    const shrubSpread = 0.08; // Wider than tree cluster — fills edges
    for (let s = 0; s < shrubsPerGrove; s++) {
      const theta = grove.theta + randomInRange(-shrubSpread, shrubSpread);
      const phi = grove.phi + randomInRange(-shrubSpread * 0.6, shrubSpread * 0.6);
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();
      shrubPlacements.push({
        pos, up,
        baseRadius: randomInRange(1.0, 2.5),
        scaleMul: randomInRange(1.0, 2.0),
      });
    }
  });
  if (shrubPlacements.length > 0) {
    // Unit icosahedron radius 1; scale encodes per-instance radius & flatten.
    const shrubUnitGeom = new THREE.IcosahedronGeometry(1, 0);
    const shrubInst = new THREE.InstancedMesh(shrubUnitGeom, shrubMat, shrubPlacements.length);
    shrubInst.name = 'forest-shrubs';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    for (let i = 0; i < shrubPlacements.length; i++) {
      const p = shrubPlacements[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      dummy.position.copy(p.pos);
      dummy.quaternion.copy(orientQ);
      const s = p.baseRadius * p.scaleMul;
      dummy.scale.set(s, s * 0.6, s); // squash Y for low bush look
      dummy.updateMatrix();
      shrubInst.setMatrixAt(i, dummy.matrix);
    }
    shrubInst.instanceMatrix.needsUpdate = true;
    shrubInst.computeBoundingSphere();
    applyInstanceColorJitter(THREE, shrubInst, shrubPlacements.length, 1, 1, 1, 0.2, 0.04);
    root.add(shrubInst);
  }

  // --- Rocks scattered between groves (instanced, 50 -> 1 draw call) ---
  const rockCount = _isMobile() ? 30 : 70;
  const rockPoints = fibonacciSpherePoints(rockCount, sphereRadius);
  if (rockPoints.length > 0) {
    const rockUnitGeom = new THREE.DodecahedronGeometry(1, 0);
    const rockInst = new THREE.InstancedMesh(rockUnitGeom, rockMat, rockPoints.length);
    rockInst.name = 'forest-rocks';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rockPoints.length; i++) {
      const point = rockPoints[i];
      const pos = placeOnSphere(THREE, sphereRadius, point.theta + randomInRange(-0.15, 0.15), point.phi + randomInRange(-0.08, 0.08), -0.2);
      const baseRadius = randomInRange(0.8, 2.0);
      const scaleMul = randomInRange(1.0, 2.5);
      const s = baseRadius * scaleMul;
      dummy.position.copy(pos);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      rockInst.setMatrixAt(i, dummy.matrix);
      collisionSystem.addCollider(pos, 1.0 * s, 'rock');
    }
    rockInst.instanceMatrix.needsUpdate = true;
    rockInst.computeBoundingSphere();
    applyInstanceColorJitter(THREE, rockInst, rockPoints.length, 1, 1, 1, 0.2, 0.04);
    root.add(rockInst);
  }

  // --- Ferns / undergrowth ground cover (instanced, collider-free) ---
  // Lived-in forest floor under the canopy. One InstancedMesh; mobile-gated.
  const fernsPerGrove = _isMobile() ? 4 : 8;
  const fernPlacements = [];
  groveCenters.forEach((grove) => {
    for (let f = 0; f < fernsPerGrove; f++) {
      const theta = grove.theta + randomInRange(-0.09, 0.09);
      const phi = grove.phi + randomInRange(-0.06, 0.06);
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, -0.1);
      const up = pos.clone().normalize();
      fernPlacements.push({ pos, up, radius: randomInRange(0.6, 1.8) });
    }
  });
  if (fernPlacements.length > 0) {
    const fernUnitGeom = new THREE.IcosahedronGeometry(1, 0);
    const fernMat = new THREE.MeshLambertMaterial({ color: 0x2c6e3a, flatShading: true });
    const fernInst = new THREE.InstancedMesh(fernUnitGeom, fernMat, fernPlacements.length);
    fernInst.name = 'forest-ferns';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    for (let i = 0; i < fernPlacements.length; i++) {
      const p = fernPlacements[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      dummy.position.copy(p.pos);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(p.radius, p.radius * 0.45, p.radius); // flattened tuft
      dummy.updateMatrix();
      fernInst.setMatrixAt(i, dummy.matrix);
    }
    fernInst.instanceMatrix.needsUpdate = true;
    fernInst.computeBoundingSphere();
    applyInstanceColorJitter(THREE, fernInst, fernPlacements.length, 1, 1, 1, 0.22, 0.05);
    root.add(fernInst);
  }

  // --- Clouds — instanced puffs (ALL puffs in 1 draw call; was up to 80) ---
  // One shared unit icosahedron + per-instance scale collapses what were 80
  // separate transparent meshes into a single draw call — the headroom that
  // keeps desktop forest under the <100 draw-call budget. Clouds stay SOLID:
  // a per-cloud collider is preserved so the bird can still bump into them.
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xdfeeff, transparent: !_isMobile(), opacity: _isMobile() ? 1 : 0.7, flatShading: true,
  });
  const cloudCount = _isMobile() ? 4 : 20;
  const puffsPerCloud = _isMobile() ? 1 : 4;
  const cloudPuffs = []; // { pos, scale } — built once at env-build time
  const _cloudQuat = new THREE.Quaternion();
  const _cloudOffset = new THREE.Vector3();
  for (let i = 0; i < cloudCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const center = placeOnSphere(THREE, sphereRadius, theta, phi, randomInRange(40, 80));
    const up = center.clone().normalize();
    _cloudQuat.setFromUnitVectors(defaultUp, up);
    const cloudScale = randomInRange(1.5, 3.0);
    for (let j = 0; j < puffsPerCloud; j++) {
      _cloudOffset.set(randomInRange(-4, 4), randomInRange(-1, 2), randomInRange(-4, 4))
        .applyQuaternion(_cloudQuat).multiplyScalar(cloudScale);
      cloudPuffs.push({ pos: center.clone().add(_cloudOffset), scale: randomInRange(3, 6) * cloudScale });
    }
    // Soft collider so the bird can bump into clouds and get knocked down.
    collisionSystem.addCollider(center, 6 * cloudScale, 'cloud');
  }
  if (cloudPuffs.length > 0) {
    const puffUnitGeom = new THREE.IcosahedronGeometry(1, 1);
    const cloudInst = new THREE.InstancedMesh(puffUnitGeom, cloudMat, cloudPuffs.length);
    cloudInst.name = 'forest-clouds';
    cloudInst.renderOrder = 2;
    cloudInst.raycast = () => {};
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cloudPuffs.length; i++) {
      dummy.position.copy(cloudPuffs[i].pos);
      dummy.scale.setScalar(cloudPuffs[i].scale);
      dummy.updateMatrix();
      cloudInst.setMatrixAt(i, dummy.matrix);
    }
    cloudInst.instanceMatrix.needsUpdate = true;
    cloudInst.computeBoundingSphere();
    root.add(cloudInst);
  }

  _landmarks = buildForestLandmarks({
    THREE, root, sphereRadius, collisionSystem, proximityTargets, nestablePositions,
  });

  return nestablePositions;
}

// ============================================================
// CANYON — Parallel ridgelines forming valley corridors
// Design: 10 ridge clusters, each a line of 8-14 tall spires.
// Ridges form walls. Fly BETWEEN ridges through valley corridors.
// Arches span between ridges for threading challenges.
// ============================================================

/**
 * Landmarks: a handful of one-off, hand-placed forms that are NOT instanced.
 *
 * The 2026-05-31 distribution pass made the world dense and even, which fixed
 * emptiness and created a different problem: every direction looks like every
 * other direction, so there is nothing to fly TOWARD and no way to tell where
 * you are. A grove of two hundred identical trees is scenery; one tree twice
 * the height of the others is a destination.
 *
 * Deliberately few and deliberately not instanced. Six draw calls buys three
 * recognisable silhouettes, and an instanced landmark is a contradiction.
 *
 * Placed along the great circle running out of the landmark valley, so the
 * waterfall and these share a route rather than sitting in unrelated corners.
 */
function buildForestLandmarks({ THREE, root, sphereRadius, collisionSystem, proximityTargets, nestablePositions }) {
  const group = new THREE.Group();
  group.name = 'forest-landmarks';

  // A tangent frame at the valley, so landmarks can be offset along a
  // consistent bearing rather than at arbitrary latitudes and longitudes.
  const anchor = new THREE.Vector3(VALLEY_ANCHOR.x, VALLEY_ANCHOR.y, VALLEY_ANCHOR.z).normalize();
  const frame = _tangentFrame(THREE, VALLEY_ANCHOR);
  const forward = new THREE.Vector3(frame.forward.x, frame.forward.y, frame.forward.z).normalize();
  const right = new THREE.Vector3(frame.right.x, frame.right.y, frame.right.z).normalize();

  /** A unit direction `angle` radians from the valley along a bearing. */
  const along = (angle, bearing) => {
    const dir = new THREE.Vector3()
      .addScaledVector(forward, Math.cos(bearing))
      .addScaledVector(right, Math.sin(bearing))
      .normalize();
    return new THREE.Vector3()
      .addScaledVector(anchor, Math.cos(angle))
      .addScaledVector(dir, Math.sin(angle))
      .normalize();
  };

  /** Ground position and local up for a unit direction. */
  const groundAt = (dir) => {
    const height = terrainHeightDir(dir.x, dir.y, dir.z);
    return { position: dir.clone().multiplyScalar(sphereRadius + height), up: dir.clone() };
  };

  const orient = (object, up) => {
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  };

  const barkMat = new THREE.MeshLambertMaterial({ color: 0x4a3520, flatShading: true });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x2b7f45, flatShading: true, vertexColors: true });
  addFoliageWind(crownMat);
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x6b6257, flatShading: true });

  // ── The giant nesting tree ──────────────────────────────────────────
  // A destination, and a nest host. Its crown is kept within the same 30-40
  // unit band the corrected perches use: a taller one becomes an observation
  // tower, which is the failure the September pass was fixing.
  const giantDir = along(0.30, 0.0);
  const giant = groundAt(giantDir);
  const trunkHeight = 26;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 3.4, trunkHeight, 9), barkMat);
  trunk.position.copy(giant.position).addScaledVector(giant.up, trunkHeight / 2);
  orient(trunk, giant.up);
  group.add(trunk);

  // Three stacked crowns, widest at the bottom, reusing the shared canopy
  // profile so the giant reads as the same species as the forest it towers over.
  const crownGeometry = createCanopyGeometry(THREE, 1);
  let crownTop = trunkHeight;
  for (let i = 0; i < 3; i++) {
    const scale = 13 - i * 3;
    const crown = new THREE.Mesh(crownGeometry, crownMat);
    const base = trunkHeight - 6 + i * 6.5;
    crown.position.copy(giant.position).addScaledVector(giant.up, base);
    crown.scale.set(scale, scale * 0.92, scale);
    orient(crown, giant.up);
    group.add(crown);
    crownTop = base + scale * 0.92;
  }

  // Solid at cruise altitude, like every other champion.
  collisionSystem.addCollider(
    giant.position.clone().addScaledVector(giant.up, trunkHeight * 0.5), 3.6, 'tree',
  );
  collisionSystem.addCollider(
    giant.position.clone().addScaledVector(giant.up, trunkHeight + 4), 11, 'tree',
  );

  // hostObject stays NULL. nest-points hides any non-instanced host object
  // while the player is nested in it, which would erase the very tree they
  // are sitting in — the one landmark guaranteed to be on screen.
  nestablePositions.push({
    position: giant.position.clone().addScaledVector(giant.up, Math.min(crownTop - 2, 38)),
    surfaceNormal: giant.up.clone(),
    hostObject: null,
    hostId: 'forest-giant-tree',
    groveId: 'forest-landmark',
  });
  proximityTargets.push({
    position: giant.position.clone().addScaledVector(giant.up, trunkHeight),
    radius: 20,
    tint: 0xbdf5c8,
  });

  // ── A fallen log, lying across the approach ─────────────────────────
  const logDir = along(0.17, 1.15);
  const log = groundAt(logDir);
  const logMesh = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.8, 34, 8), barkMat);
  logMesh.position.copy(log.position).addScaledVector(log.up, 2.2);
  // Laid ALONG the surface: rotate the cylinder's own axis onto a tangent.
  const logAxis = new THREE.Vector3().crossVectors(log.up, forward).normalize();
  logMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), logAxis);
  group.add(logMesh);
  proximityTargets.push({ position: logMesh.position.clone(), radius: 12, tint: 0xd8c9a4 });

  // ── A stone arch to fly through ─────────────────────────────────────
  const archDir = along(0.22, -1.05);
  const arch = groundAt(archDir);
  const archMesh = new THREE.Mesh(new THREE.TorusGeometry(13, 2.4, 6, 14, Math.PI), stoneMat);
  archMesh.position.copy(arch.position).addScaledVector(arch.up, 0.5);
  // The torus lies in its own XY plane; stand it up so the opening faces
  // along the route rather than flat against the ground.
  const archQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), arch.up);
  const standUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  archMesh.quaternion.copy(archQuat).multiply(standUp);
  group.add(archMesh);
  // Legs only. The opening is the point of an arch; a collider across it
  // would make the one thing you want to fly through a wall.
  const archSide = new THREE.Vector3().crossVectors(arch.up, forward).normalize();
  for (const sign of [-1, 1]) {
    collisionSystem.addCollider(
      arch.position.clone().addScaledVector(archSide, sign * 13).addScaledVector(arch.up, 4), 3.2, 'rock',
    );
  }
  proximityTargets.push({ position: archMesh.position.clone(), radius: 16, tint: 0xe0dcc8 });

  root.add(group);
  // Reported so the capture harness can aim at a landmark instead of hunting
  // for one: a landmark that cannot be found in a render is not a landmark.
  return [
    { id: 'giant-tree', position: giant.position.clone().addScaledVector(giant.up, trunkHeight) },
    { id: 'fallen-log', position: logMesh.position.clone() },
    { id: 'stone-arch', position: archMesh.position.clone() },
  ];
}

function buildCanyonOnSphere({ THREE, root, sphereRadius, collisionSystem, proximityTargets }) {
  const nestablePositions = [];
  const defaultUp = new THREE.Vector3(0, 1, 0);
  // Spire mats carry vertexColors so the baked sediment strata (banded base→top
  // gradient) reads. The gradient averages ~0.9 so the hues are lifted slightly.
  const spireMat = new THREE.MeshLambertMaterial({ color: 0x99502e, flatShading: true, vertexColors: true });
  const darkSpireMat = new THREE.MeshLambertMaterial({ color: 0x763923, flatShading: true, vertexColors: true });
  const boulderMat = new THREE.MeshLambertMaterial({ color: 0x7a3c23, flatShading: true });
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x6e3520, flatShading: true, vertexColors: true });

  // --- Ridge clusters (parallel lines of tall spires) ---
  // Denser corridor field (desktop 9 / mobile 8 — both > the old 7); wide
  // ridgeLength keeps them distinct. Spires batched via 2 InstancedMesh per tint.
  const ridgeCount = _isMobile() ? 8 : 9;
  const ridgeCenters = fibonacciSpherePoints(ridgeCount, sphereRadius);

  // Per-material buckets: index 0 = spireMat, 1 = darkSpireMat.
  const spirePlacementsByMat = [[], []];
  let spireIndex = 0;

  ridgeCenters.forEach((ridge, rIdx) => {
    const spiresInRidge = Math.floor(randomInRange(_isMobile() ? 6 : 7, _isMobile() ? 11 : 13));
    // Ridge direction — a random tangent angle
    const ridgeAngle = Math.random() * Math.PI;
    const ridgeLength = randomInRange(0.06, 0.1);

    const championIdx = Math.floor(Math.random() * spiresInRidge);
    const shrimpIdx = (championIdx + Math.floor(spiresInRidge / 2)) % spiresInRidge;

    for (let s = 0; s < spiresInRidge; s++) {
      const t = (s / spiresInRidge - 0.5) * 2;
      const along = t * ridgeLength;
      const across = randomInRange(-0.008, 0.008);

      const theta = ridge.theta + along * Math.cos(ridgeAngle) + across * Math.sin(ridgeAngle);
      const phi = ridge.phi + along * Math.sin(ridgeAngle) * 0.5 + across * Math.cos(ridgeAngle) * 0.5;
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();

      const height = randomInRange(22, 64);
      const baseRadius = randomInRange(2.0, 4.5);
      const matIdx = Math.random() > 0.5 ? 0 : 1;

      let scale;
      if (s === championIdx) scale = randomInRange(2.5, 3.5);
      else if (s === shrimpIdx) scale = randomInRange(0.5, 0.7);
      else scale = randomInRange(1.0, 1.5);

      spirePlacementsByMat[matIdx].push({
        pos, up, height, baseRadius, scale,
        rotX: randomInRange(-0.08, 0.08),
        rotZ: randomInRange(-0.08, 0.08),
      });
      collisionSystem.addCollider(pos, Math.min(baseRadius * scale * 0.8, 7.0), 'spire');
      // Mid-height collider so the spire is solid at cruise altitude.
      const spireMid = pos.clone().add(up.clone().multiplyScalar(height * scale * 0.5));
      collisionSystem.addCollider(spireMid, baseRadius * scale * 0.65, 'spire');

      // Use actual, modest spire tops. Mid-height nests were INSIDE the
      // champion spire and only looked usable because nesting hid all spires.
      if (spireIndex % 4 === 0 && height * scale <= 65) {
        const host = spirePlacementsByMat[matIdx].at(-1);
        host.rotX = 0; host.rotZ = 0; // Nest-bearing top stays level and aligned.
        const nestPos = pos.clone().addScaledVector(up, height * scale + 0.2);
        nestablePositions.push({ position: nestPos, surfaceNormal: up.clone(),
          hostObject: null, hostId: `canyon-spire-${spireIndex}` });
      }

      if (s === championIdx && proximityTargets) {
        const apex = pos.clone().add(up.clone().multiplyScalar(height * scale * 0.6));
        proximityTargets.push({ position: apex, radius: 14, tint: 0xffd0a0 });
      }
      spireIndex++;
    }
  });

  // --- Global spire scatter — fills the open ground BETWEEN ridges so the
  // canyon floor reads as populated, not bare. Rides the SAME spire
  // InstancedMeshes (zero new draw calls). Mobile-gated.
  const scatterSpireCount = _isMobile() ? 95 : 155;
  const scatterSpirePoints = fibonacciSpherePoints(scatterSpireCount, sphereRadius);
  for (let i = 0; i < scatterSpirePoints.length; i++) {
    const sp = scatterSpirePoints[i];
    const pos = placeOnSphere(THREE, sphereRadius, sp.theta + randomInRange(-0.05, 0.05), sp.phi + randomInRange(-0.05, 0.05), 0);
    const up = pos.clone().normalize();
    const height = randomInRange(14, 44);
    const baseRadius = randomInRange(1.6, 3.6);
    const scale = randomInRange(0.8, 1.6);
    const matIdx = Math.random() > 0.5 ? 0 : 1;
    spirePlacementsByMat[matIdx].push({
      pos, up, height, baseRadius, scale,
      rotX: randomInRange(-0.08, 0.08),
      rotZ: randomInRange(-0.08, 0.08),
    });
    collisionSystem.addCollider(pos, Math.min(baseRadius * scale * 0.8, 6.0), 'spire');
    const scatterSpireMid = pos.clone().add(up.clone().multiplyScalar(height * scale * 0.5));
    collisionSystem.addCollider(scatterSpireMid, baseRadius * scale * 0.65, 'spire');
  }

  // Build InstancedMesh per material bucket.
  // Unit cylinder: top radius 0.3 (was baseRadius*0.3), bottom radius 1, height 1,
  // base at y=0, tip at y=1. Per-instance scale = (baseRadius, height, baseRadius) * treeScale.
  const spireMats = [spireMat, darkSpireMat];
  for (let mi = 0; mi < 2; mi++) {
    const bucket = spirePlacementsByMat[mi];
    if (bucket.length === 0) continue;
    const spireUnitGeom = new THREE.CylinderGeometry(0.3, 1.0, 1.0, 6, 4);
    spireUnitGeom.translate(0, 0.5, 0); // base at y=0
    // Sediment strata: 4 horizontal bands (darker rust base → lighter buff top)
    // with a per-band luminance offset — the canyon "layered rock" read, baked
    // once at build. heightSegments raised 1→4 so the bands have facets to land on.
    bakeVerticalGradient(THREE, spireUnitGeom, [0.78, 0.66, 0.58], [1.16, 1.06, 0.92], 4, 0.16);
    const inst = new THREE.InstancedMesh(spireUnitGeom, spireMats[mi], bucket.length);
    inst.name = `canyon-spires-${mi}`;
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    const tiltQ = new THREE.Quaternion();
    const tiltEuler = new THREE.Euler();
    for (let i = 0; i < bucket.length; i++) {
      const p = bucket[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      // Apply rotX/Z as a local rotation AFTER orientQ (same as original spire.rotateX/Z).
      tiltEuler.set(p.rotX, 0, p.rotZ);
      tiltQ.setFromEuler(tiltEuler);
      orientQ.multiply(tiltQ);
      dummy.position.copy(p.pos); // instance origin sits ON the surface (base of spire)
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(
        p.baseRadius * p.scale,
        p.height * p.scale,
        p.baseRadius * p.scale,
      );
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    applyInstanceColorJitter(THREE, inst, bucket.length, 1, 1, 1, 0.14, 0.035);
    root.add(inst);
  }
  console.log(`[Canyon] ${spireIndex} spires in ${ridgeCount} ridges (instanced), ${nestablePositions.length} nests`);

  // --- Towering canyon corridor walls (single InstancedMesh = 1 draw call) ---
  // Pair two parallel cliff walls per cluster to form a flyable corridor.
  // 3 of the existing ridges get this "corridor" treatment.
  const corridorRidgeIndices = [
    Math.floor(ridgeCount * 0.15),
    Math.floor(ridgeCount * 0.5),
    Math.floor(ridgeCount * 0.85),
  ];
  const wallPlacements = []; // { center, up, cdir, height, length, thickness }
  corridorRidgeIndices.forEach((rIdx) => {
    const ridge = ridgeCenters[rIdx];
    if (!ridge) return;
    const corridorAngle = Math.random() * Math.PI;
    const corridorLengthAng = 0.10;
    const corridorWorldLen = sphereRadius * corridorLengthAng * 1.05;
    const wallOffsetWorld = 9 + Math.random() * 4; // 9-13 corridor half-width
    const wallHeight = 70 + Math.random() * 25;     // 70-95 — taller than mountains
    const wallThickness = 4 + Math.random() * 3;

    for (let side = -1; side <= 1; side += 2) {
      const centerPos = placeOnSphere(THREE, sphereRadius, ridge.theta, ridge.phi, 0);
      const up = centerPos.clone().normalize();
      const helper = Math.abs(up.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const right = new THREE.Vector3().crossVectors(up, helper).normalize();
      const forward = new THREE.Vector3().crossVectors(right, up).normalize();
      const cosA = Math.cos(corridorAngle), sinA = Math.sin(corridorAngle);
      const cdir = forward.clone().multiplyScalar(cosA).addScaledVector(right, sinA);
      const cperp = forward.clone().multiplyScalar(-sinA).addScaledVector(right, cosA);

      const wallCenter = centerPos.clone().addScaledVector(cperp, side * wallOffsetWorld);
      wallCenter.normalize().multiplyScalar(sphereRadius);
      const wallUp = wallCenter.clone().normalize();

      wallPlacements.push({
        center: wallCenter,
        up: wallUp,
        cdir,
        height: wallHeight,
        length: corridorWorldLen,
        thickness: wallThickness,
      });

      if (proximityTargets) {
        const apex = wallCenter.clone().addScaledVector(wallUp, wallHeight * 0.45);
        proximityTargets.push({
          position: apex,
          radius: 16,
          tint: 0xffb070,
        });
      }
    }
  });
  if (wallPlacements.length > 0) {
    // Unit box; per-instance scale gives length/height/thickness. Height
    // segments raised so the baked cliff strata have facets; the box centres at
    // y=0, so the gradient spans -0.5..0.5 → base (rust) to top (buff) naturally.
    const wallGeom = new THREE.BoxGeometry(1, 1, 1, 1, 4, 1);
    bakeVerticalGradient(THREE, wallGeom, [0.74, 0.62, 0.54], [1.12, 1.0, 0.88], 4, 0.14);
    const wallInst = new THREE.InstancedMesh(wallGeom, wallMat, wallPlacements.length);
    wallInst.name = 'canyon-corridor-walls';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    const localXVec = new THREE.Vector3();
    const projCdir = new THREE.Vector3();
    const projLocalX = new THREE.Vector3();
    const crossVec = new THREE.Vector3();
    const yRotQ = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    wallPlacements.forEach((wp, idx) => {
      orientQ.setFromUnitVectors(defaultUp, wp.up);
      localXVec.set(1, 0, 0).applyQuaternion(orientQ);
      projCdir.copy(wp.cdir).addScaledVector(wp.up, -wp.cdir.dot(wp.up)).normalize();
      projLocalX.copy(localXVec).addScaledVector(wp.up, -localXVec.dot(wp.up)).normalize();
      const dot = Math.max(-1, Math.min(1, projLocalX.dot(projCdir)));
      crossVec.crossVectors(projLocalX, projCdir);
      const sign = crossVec.dot(wp.up) >= 0 ? 1 : -1;
      const yAngle = Math.acos(dot) * sign;
      yRotQ.setFromAxisAngle(yAxis, yAngle);
      orientQ.multiply(yRotQ);

      dummy.position.copy(wp.center).addScaledVector(wp.up, wp.height / 2);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(wp.length, wp.height, wp.thickness);
      dummy.updateMatrix();
      wallInst.setMatrixAt(idx, dummy.matrix);
    });
    wallInst.instanceMatrix.needsUpdate = true;
    wallInst.computeBoundingSphere();
    root.add(wallInst);
  }
  console.log(`[Canyon] ${wallPlacements.length} corridor walls in ${corridorRidgeIndices.length} canyons (instanced)`);

  // --- Arches spanning between ridges (instanced) ---
  const archMat = new THREE.MeshLambertMaterial({ color: 0xb25e34, flatShading: true });
  const archCount = _isMobile() ? 9 : 12;
  {
    const archGeom = new THREE.TorusGeometry(8, 1.2, 6, 16);
    const archInst = new THREE.InstancedMesh(archGeom, archMat, archCount);
    archInst.name = 'canyon-arches';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    const flatXQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const spinZQ = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < archCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - 2 * Math.random());
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, randomInRange(10, 25));
      const up = pos.clone().normalize();
      const s = randomInRange(1.2, 2.0);
      orientQ.setFromUnitVectors(defaultUp, up).multiply(flatXQ);
      spinZQ.setFromAxisAngle(zAxis, Math.random() * Math.PI);
      orientQ.multiply(spinZQ);
      dummy.position.copy(pos);
      dummy.quaternion.copy(orientQ);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      archInst.setMatrixAt(i, dummy.matrix);
      collisionSystem.addCollider(pos, 6 * s, 'arch');
      // This torus lies in the tangent plane: its 8u major radius extends
      // SIDEWAYS, not upward. Seat the bowl on the tube instead of floating
      // 8*s above the ring's empty centre.
      const archNestPos = new THREE.Vector3(8 * s, 0, 0).applyQuaternion(orientQ)
        .add(pos).addScaledVector(up, 1.2 * s + 0.2);
      nestablePositions.push({ position: archNestPos, surfaceNormal: up.clone(),
        hostObject: null, hostId: `canyon-arch-${i}` });
    }
    archInst.instanceMatrix.needsUpdate = true;
    archInst.computeBoundingSphere();
    root.add(archInst);
  }

  // --- Boulders at ground level (instanced) ---
  const boulderCount = _isMobile() ? 24 : 40;
  const boulderPoints = fibonacciSpherePoints(boulderCount, sphereRadius);
  if (boulderPoints.length > 0) {
    const boulderUnitGeom = new THREE.IcosahedronGeometry(1, 0);
    const boulderInst = new THREE.InstancedMesh(boulderUnitGeom, boulderMat, boulderPoints.length);
    boulderInst.name = 'canyon-boulders';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < boulderPoints.length; i++) {
      const point = boulderPoints[i];
      const pos = placeOnSphere(THREE, sphereRadius, point.theta + randomInRange(-0.12, 0.12), point.phi + randomInRange(-0.06, 0.06), -0.2);
      const baseR = randomInRange(1.5, 4);
      const scaleMul = randomInRange(1.0, 2.0);
      const s = baseR * scaleMul;
      dummy.position.copy(pos);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      boulderInst.setMatrixAt(i, dummy.matrix);
      collisionSystem.addCollider(pos, 2.0 * s, 'boulder');
    }
    boulderInst.instanceMatrix.needsUpdate = true;
    boulderInst.computeBoundingSphere();
    applyInstanceColorJitter(THREE, boulderInst, boulderPoints.length, 1, 1, 1, 0.18, 0.04);
    root.add(boulderInst);
  }

  // --- Needle rock spires (instanced, collider-free) — thin vertical accents ---
  // Slender needles rising from the canyon floor between the chunky spires,
  // filling the vertical band up toward the corridor walls. Collider-free so
  // they add visual depth without ground no-fly bubbles.
  const needleCount = _isMobile() ? 16 : 30;
  {
    const needleGeom = new THREE.ConeGeometry(0.3, 1, 6);
    needleGeom.translate(0, 0.5, 0);
    const needleMat = new THREE.MeshLambertMaterial({ color: 0x5a2c18, flatShading: true });
    const needleInst = new THREE.InstancedMesh(needleGeom, needleMat, needleCount);
    needleInst.name = 'canyon-needles';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    for (let i = 0; i < needleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - 2 * Math.random());
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();
      orientQ.setFromUnitVectors(defaultUp, up);
      dummy.position.copy(pos);
      dummy.quaternion.copy(orientQ);
      const r = randomInRange(1.5, 3.0);
      dummy.scale.set(r, randomInRange(35, 75), r);
      dummy.updateMatrix();
      needleInst.setMatrixAt(i, dummy.matrix);
    }
    needleInst.instanceMatrix.needsUpdate = true;
    needleInst.computeBoundingSphere();
    applyInstanceColorJitter(THREE, needleInst, needleCount, 1, 1, 1, 0.16, 0.035);
    root.add(needleInst);
  }

  return nestablePositions;
}

// ============================================================
// MOUNTAINS — Clustered ranges with passes, dense pine forests below
// Design: 8 mountain ranges of 4-8 peaks each. Saddle passes between.
// Pine forest clusters at lower altitudes for under-canopy flying.
// Mist/clouds weaving between peaks.
// ============================================================
function buildMountainOnSphere({ THREE, root, sphereRadius, collisionSystem, proximityTargets }) {
  const nestablePositions = [];
  const defaultUp = new THREE.Vector3(0, 1, 0);
  // Stone body carries vertexColors for a baked base→scree vertical gradient.
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x646c7c, flatShading: true, vertexColors: true });
  const snowMat = new THREE.MeshLambertMaterial({ color: 0xe6f1ff, flatShading: true });
  const pineTrunkMat = new THREE.MeshLambertMaterial({ color: 0x33422f, flatShading: true });
  // Pine canopy carries vertexColors for the baked base→tip gradient.
  const pineCanopyMat = new THREE.MeshLambertMaterial({ color: 0x32623e, flatShading: true, vertexColors: true });
  const boulderMat = new THREE.MeshLambertMaterial({ color: 0x4a505a, flatShading: true });
  const cliffWallMat = new THREE.MeshLambertMaterial({ color: 0x434953, flatShading: true });
  const pineCanopyCeilingMat = new THREE.MeshBasicMaterial({
    color: 0x2a5535,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // --- Mountain ranges (clusters of peaks) ---
  // Fuller horizon of ridgelines (desktop 9 / mobile 7 — both > the old 6); wide
  // rangeSpread keeps them discrete. Peaks render via 2 InstancedMesh (body+snow).
  const rangeCount = _isMobile() ? 7 : 9;
  const rangeCenters = fibonacciSpherePoints(rangeCount, sphereRadius);
  const peakPlacements = []; // { pos, up, height, baseRadius, scale, rotX, rotZ }
  const snowPlacements = []; // { pos, up, height, baseRadius, scale, snowHeight, rotX, rotZ }
  let peakIndex = 0;

  rangeCenters.forEach((range, rIdx) => {
    const peaksInRange = Math.floor(randomInRange(_isMobile() ? 3 : 4, _isMobile() ? 6 : 8));
    // Slightly wider spread so peaks aren't stacked
    const rangeSpread = randomInRange(0.05, 0.09);
    const rangeAngle = Math.random() * Math.PI;

    const championIdx = Math.floor(Math.random() * peaksInRange);
    const shrimpIdx = (championIdx + Math.floor(peaksInRange / 2)) % peaksInRange;

    for (let p = 0; p < peaksInRange; p++) {
      const t = (p / peaksInRange - 0.5) * 2;
      const along = t * rangeSpread;
      const across = randomInRange(-0.015, 0.015);
      const theta = range.theta + along * Math.cos(rangeAngle) + across * Math.sin(rangeAngle);
      const phi = range.phi + along * Math.sin(rangeAngle) * 0.5 + across * Math.cos(rangeAngle) * 0.5;
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();

      const height = randomInRange(28, 78);
      const baseRadius = randomInRange(5, 12);
      const rotX = randomInRange(-0.06, 0.06);
      const rotZ = randomInRange(-0.06, 0.06);

      let scale;
      const isChampion = p === championIdx;
      const isShrimp = p === shrimpIdx;
      if (isChampion) scale = randomInRange(2.3, 3.3);
      else if (isShrimp) scale = randomInRange(0.5, 0.7);
      else scale = randomInRange(1.0, 1.4);

      peakPlacements.push({ pos, up, height, baseRadius, scale, rotX, rotZ });
      if (height > 35) {
        snowPlacements.push({
          pos, up, height, baseRadius, scale,
          snowHeight: randomInRange(5, 12),
          rotX, rotZ,
        });
      }
      collisionSystem.addCollider(pos, Math.min(baseRadius * scale * 0.8, 27), 'mountain');
      // Mid-height collider so peaks are solid at cruise altitude.
      const mtnMid = pos.clone().add(up.clone().multiplyScalar(height * scale * 0.5));
      collisionSystem.addCollider(mtnMid, baseRadius * scale * 0.55, 'mountain');

      // Low bare summits only; a fractional-height nest intersects the
      // mountain, and the tall snow peaks are scenery rather than perches.
      if (peakIndex % 3 === 0 && height <= 35 && height * scale <= 55) {
        const host = peakPlacements.at(-1);
        host.rotX = 0; host.rotZ = 0;
        const nestPos = pos.clone().addScaledVector(up, height * scale + 0.2);
        nestablePositions.push({ position: nestPos, surfaceNormal: up.clone(),
          hostObject: null, hostId: `mountain-peak-${peakIndex}` });
      }

      if (isChampion && proximityTargets) {
        const apex = pos.clone().addScaledVector(up, height * scale * 0.7);
        proximityTargets.push({ position: apex, radius: 18, tint: 0xeaf4ff });
      }
      peakIndex++;
    }
  });

  // Build mountain body InstancedMesh. Unit cylinder: top radius 0.2, bottom 1,
  // height 1, base at y=0; per-instance scale (baseRadius, height, baseRadius) × peakScale.
  if (peakPlacements.length > 0) {
    const bodyUnitGeom = new THREE.CylinderGeometry(0.2, 1.0, 1.0, 7, 3);
    bodyUnitGeom.translate(0, 0.5, 0);
    // Darker shadowed rock base → lighter weathered scree near the summit, baked
    // once. heightSegments 1→3 gives the gradient facets to read across.
    bakeVerticalGradient(THREE, bodyUnitGeom, [0.74, 0.74, 0.78], [1.16, 1.18, 1.22]);
    const bodyInst = new THREE.InstancedMesh(bodyUnitGeom, stoneMat, peakPlacements.length);
    bodyInst.name = 'mountain-peaks-body';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    const tiltQ = new THREE.Quaternion();
    const tiltEuler = new THREE.Euler();
    for (let i = 0; i < peakPlacements.length; i++) {
      const p = peakPlacements[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      tiltEuler.set(p.rotX, 0, p.rotZ);
      tiltQ.setFromEuler(tiltEuler);
      orientQ.multiply(tiltQ);
      dummy.position.copy(p.pos);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(p.baseRadius * p.scale, p.height * p.scale, p.baseRadius * p.scale);
      dummy.updateMatrix();
      bodyInst.setMatrixAt(i, dummy.matrix);
    }
    bodyInst.instanceMatrix.needsUpdate = true;
    bodyInst.computeBoundingSphere();
    // Per-peak rock variation — some warmer, some cooler/greyer, so the range
    // doesn't read as one cloned stone cone. Mean 1.0 preserves the base tone.
    applyInstanceColorJitter(THREE, bodyInst, peakPlacements.length, 1, 1, 1, 0.13, 0.035);
    root.add(bodyInst);
  }

  // Build snow cap InstancedMesh. Unit cone: radius 1, height 1, base at y=0.
  // Original: snowCap.position.y = height + snowHeight * 0.3, ConeGeometry was
  // centered, so snow BASE was at height + snowHeight*0.3 - snowHeight*0.5 =
  // height - snowHeight*0.2. Radius scale = baseRadius * 0.5.
  if (snowPlacements.length > 0) {
    const snowUnitGeom = new THREE.ConeGeometry(1, 1, 6);
    snowUnitGeom.translate(0, 0.5, 0);
    const snowInst = new THREE.InstancedMesh(snowUnitGeom, snowMat, snowPlacements.length);
    snowInst.name = 'mountain-peaks-snow';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    const tiltQ = new THREE.Quaternion();
    const tiltEuler = new THREE.Euler();
    const upShift = new THREE.Vector3();
    for (let i = 0; i < snowPlacements.length; i++) {
      const p = snowPlacements[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      tiltEuler.set(p.rotX, 0, p.rotZ);
      tiltQ.setFromEuler(tiltEuler);
      orientQ.multiply(tiltQ);
      const baseWorldY = (p.height - p.snowHeight * 0.2) * p.scale;
      upShift.copy(p.up).multiplyScalar(baseWorldY);
      dummy.position.copy(p.pos).add(upShift);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(
        p.baseRadius * 0.5 * p.scale,
        p.snowHeight * p.scale,
        p.baseRadius * 0.5 * p.scale,
      );
      dummy.updateMatrix();
      snowInst.setMatrixAt(i, dummy.matrix);
    }
    snowInst.instanceMatrix.needsUpdate = true;
    snowInst.computeBoundingSphere();
    root.add(snowInst);
  }
  console.log(`[Mountain] ${peakIndex} peaks in ${rangeCount} ranges (instanced body + snow), ${nestablePositions.length} nests`);

  // --- Cliff corridor walls between selected mountain ranges (3 spots, instanced) ---
  const cliffRangeIndices = [
    Math.floor(rangeCount * 0.2),
    Math.floor(rangeCount * 0.55),
    Math.floor(rangeCount * 0.85),
  ];
  const cliffPlacements = [];
  cliffRangeIndices.forEach((rIdx) => {
    const range = rangeCenters[rIdx];
    if (!range) return;
    const corridorAngle = Math.random() * Math.PI;
    const corridorWorldLen = sphereRadius * 0.11;
    const wallOffsetWorld = 11 + Math.random() * 5;
    const wallHeight = 75 + Math.random() * 30;
    const wallThickness = 5 + Math.random() * 3;

    for (let side = -1; side <= 1; side += 2) {
      const centerPos = placeOnSphere(THREE, sphereRadius, range.theta, range.phi, 0);
      const up = centerPos.clone().normalize();
      const helper = Math.abs(up.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const right = new THREE.Vector3().crossVectors(up, helper).normalize();
      const forward = new THREE.Vector3().crossVectors(right, up).normalize();
      const cosA = Math.cos(corridorAngle), sinA = Math.sin(corridorAngle);
      const cdir = forward.clone().multiplyScalar(cosA).addScaledVector(right, sinA);
      const cperp = forward.clone().multiplyScalar(-sinA).addScaledVector(right, cosA);

      const wallCenter = centerPos.clone().addScaledVector(cperp, side * wallOffsetWorld);
      wallCenter.normalize().multiplyScalar(sphereRadius);
      const wallUp = wallCenter.clone().normalize();

      cliffPlacements.push({
        center: wallCenter,
        up: wallUp,
        cdir,
        height: wallHeight,
        length: corridorWorldLen,
        thickness: wallThickness,
      });

      if (proximityTargets) {
        const apex = wallCenter.clone().addScaledVector(wallUp, wallHeight * 0.5);
        proximityTargets.push({
          position: apex,
          radius: 16,
          tint: 0xc8d6e6,
        });
      }
    }
  });
  if (cliffPlacements.length > 0) {
    const wallGeom = new THREE.BoxGeometry(1, 1, 1);
    const wallInst = new THREE.InstancedMesh(wallGeom, cliffWallMat, cliffPlacements.length);
    wallInst.name = 'mountain-cliff-walls';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    const localXVec = new THREE.Vector3();
    const projCdir = new THREE.Vector3();
    const projLocalX = new THREE.Vector3();
    const crossVec = new THREE.Vector3();
    const yRotQ = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    cliffPlacements.forEach((wp, idx) => {
      orientQ.setFromUnitVectors(defaultUp, wp.up);
      localXVec.set(1, 0, 0).applyQuaternion(orientQ);
      projCdir.copy(wp.cdir).addScaledVector(wp.up, -wp.cdir.dot(wp.up)).normalize();
      projLocalX.copy(localXVec).addScaledVector(wp.up, -localXVec.dot(wp.up)).normalize();
      const dot = Math.max(-1, Math.min(1, projLocalX.dot(projCdir)));
      crossVec.crossVectors(projLocalX, projCdir);
      const sign = crossVec.dot(wp.up) >= 0 ? 1 : -1;
      const yAngle = Math.acos(dot) * sign;
      yRotQ.setFromAxisAngle(yAxis, yAngle);
      orientQ.multiply(yRotQ);

      dummy.position.copy(wp.center).addScaledVector(wp.up, wp.height / 2);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(wp.length, wp.height, wp.thickness);
      dummy.updateMatrix();
      wallInst.setMatrixAt(idx, dummy.matrix);
    });
    wallInst.instanceMatrix.needsUpdate = true;
    wallInst.computeBoundingSphere();
    root.add(wallInst);
  }
  console.log(`[Mountain] ${cliffPlacements.length} cliff corridor walls (instanced)`);

  // --- Pine forests between ranges (clustered, shorter than peaks) ---
  // PERF: ~168 pines × 2 meshes → 2 InstancedMesh draw calls (trunk + canopy).
  const pineCeilingPlacements = []; // { pos, up, radius }
  // Place pine groves between ranges — fewer groves, wider spread so they read
  // as distinct clusters. PERF: trunks + canopies batched via 2 InstancedMesh.
  const pineTrunkPlacements = []; // { pos, up, trunkH, scale }
  const pineCanopyPlacements = []; // { pos, up, canopyH, canopyR, trunkH, scale }
  const pineGroveCount = _isMobile() ? 6 : 8;
  const pineGroveCenters = fibonacciSpherePoints(pineGroveCount, sphereRadius);

  pineGroveCenters.forEach((grove, groveIdx) => {
    const pinesInGrove = Math.floor(randomInRange(_isMobile() ? 6 : 9, _isMobile() ? 10 : 14));
    const groveSpread = randomInRange(0.05, 0.09);
    const minPineAngularSpacing = randomInRange(0.026, 0.038);
    const placedPineAngles = [];
    const championIdx = Math.floor(Math.random() * pinesInGrove);
    let maxTopOffset = 0;
    for (let t = 0; t < pinesInGrove; t++) {
      let theta = grove.theta;
      let phi = grove.phi;
      for (let attempt = 0; attempt < 12; attempt++) {
        theta = grove.theta + randomInRange(-groveSpread, groveSpread);
        phi = grove.phi + randomInRange(-groveSpread * 0.65, groveSpread * 0.65);
        if (placedPineAngles.every((a) =>
          angularDistance(theta, phi, a.theta, a.phi) >= minPineAngularSpacing
        )) {
          break;
        }
      }
      placedPineAngles.push({ theta, phi });
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();

      const trunkH = randomInRange(5, 10);
      const canopyH = randomInRange(6, 12);
      const canopyR = randomInRange(2, 4);
      const scale = (t === championIdx)
        ? randomInRange(28, 38) / (trunkH + canopyH * 0.85)
        : randomInRange(1.0, 1.8);

      pineTrunkPlacements.push({ pos, up, trunkH, scale });
      pineCanopyPlacements.push({ pos, up, canopyH, canopyR, trunkH, scale });
      collisionSystem.addCollider(pos, 0.8 * scale, 'pine');
      // Canopy collider so pines collide at flight altitude.
      const pineCanopyCenter = pos.clone().add(
        up.clone().multiplyScalar((trunkH + canopyH * 0.5) * scale)
      );
      collisionSystem.addCollider(pineCanopyCenter, canopyR * scale * 0.95, 'pine');
      const topOffset = (trunkH + canopyH * 0.85) * scale;
      if (topOffset > maxTopOffset) maxTopOffset = topOffset;
      // Champion pine hosts a nest — sat above the canopy crown (+ clearance) so it
      // crowns the pine instead of hiding inside the needles.
      if (t === championIdx) {
        const pineNestHeight = (trunkH + canopyH * 0.85) * scale + 0.2;
        const pineNestPos = pos.clone().add(up.clone().multiplyScalar(pineNestHeight));
        nestablePositions.push({ position: pineNestPos, surfaceNormal: up.clone(), hostObject: null,
          hostId: `mountain-pine-${groveIdx}-${t}`, groveId: `mountain-grove-${groveIdx}` });
      }
    }
    if (maxTopOffset > 8) {
      const ceilingPos = placeOnSphere(THREE, sphereRadius, grove.theta, grove.phi, 0);
      const up = ceilingPos.clone().normalize();
      const discRadius = sphereRadius * groveSpread * 1.3;
      const finalPos = ceilingPos.clone().addScaledVector(up, maxTopOffset * 0.66);
      pineCeilingPlacements.push({ pos: finalPos, up, radius: discRadius });
    }
  });

  // --- Global pine scatter — fills the bare valleys BETWEEN ranges/groves so the
  // mountain floor reads as a wooded landscape, not bare rock. Rides the SAME pine
  // trunk + canopy InstancedMeshes (zero new draw calls). Mobile-gated.
  const scatterPineCount = _isMobile() ? 210 : 320;
  const scatterPinePoints = fibonacciSpherePoints(scatterPineCount, sphereRadius);
  for (let i = 0; i < scatterPinePoints.length; i++) {
    const sp = scatterPinePoints[i];
    const jt = sp.theta + randomInRange(-0.05, 0.05);
    const jp = sp.phi + randomInRange(-0.05, 0.05);
    // Alpine tree line: pines crowd the low slopes/valleys and give way to bare
    // rock and snow on the exposed plateau tops. Terrain is <= 0 (carve-down), so
    // depth = -th: 0 on the plateau, larger the deeper the valley.
    const spp = Math.sin(jp);
    const th = terrainHeightDir(spp * Math.cos(jt), Math.cos(jp), spp * Math.sin(jt));
    const depth = -th;                                                  // 0 plateau → deep valley
    const exposure = Math.max(0, Math.min(1, 1 - depth / 30));          // 1 exposed top → 0 valley
    if (exposure > 0.78 && Math.random() < (exposure - 0.78) * 0.9) continue; // thin exposed tops
    const pos = placeOnSphere(THREE, sphereRadius, jt, jp, 0);
    const up = pos.clone().normalize();
    const trunkH = randomInRange(5, 10);
    const canopyH = randomInRange(6, 11);
    const canopyR = randomInRange(2, 3.8);
    const scale = randomInRange(0.9, 1.8) * (0.8 + (1 - exposure) * 0.3); // dwarf tops, lush valleys
    pineTrunkPlacements.push({ pos, up, trunkH, scale });
    pineCanopyPlacements.push({ pos, up, canopyH, canopyR, trunkH, scale });
    collisionSystem.addCollider(pos, 0.8 * scale, 'pine');
    const scatterPineCanopy = pos.clone().add(up.clone().multiplyScalar((trunkH + canopyH * 0.5) * scale));
    collisionSystem.addCollider(scatterPineCanopy, canopyR * scale * 0.95, 'pine');
  }

  // Build pine trunk InstancedMesh. Unit cylinder: top 0.3, bottom 0.6, height 1.
  // Original: trunk.position.y = trunkH/2 (centered), so base was at y=0.
  // Unit geom base-at-0 matches that. Per-instance scale Y = trunkH * scale.
  if (pineTrunkPlacements.length > 0) {
    const trunkUnitGeom = new THREE.CylinderGeometry(0.3, 0.6, 1.0, 5);
    trunkUnitGeom.translate(0, 0.5, 0);
    const trunkInst = new THREE.InstancedMesh(trunkUnitGeom, pineTrunkMat, pineTrunkPlacements.length);
    trunkInst.name = 'mountain-pine-trunks';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    for (let i = 0; i < pineTrunkPlacements.length; i++) {
      const p = pineTrunkPlacements[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      dummy.position.copy(p.pos);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(p.scale, p.trunkH * p.scale, p.scale);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
    }
    trunkInst.instanceMatrix.needsUpdate = true;
    trunkInst.computeBoundingSphere();
    root.add(trunkInst);
  }

  // Build pine canopy InstancedMesh. Unit cone radius 1, height 1, base at y=0.
  // Original: canopy.position.y = trunkH + canopyH*0.35, ConeGeometry was centered.
  // So canopy BASE was at trunkH + canopyH*0.35 - canopyH*0.5 = trunkH - canopyH*0.15.
  if (pineCanopyPlacements.length > 0) {
    const canopyUnitGeom = new THREE.ConeGeometry(1, 1, 6);
    canopyUnitGeom.translate(0, 0.5, 0);
    bakeVerticalGradient(THREE, canopyUnitGeom, [0.66, 0.66, 0.66], [1.06, 1.06, 1.06]);
    const canopyInst = new THREE.InstancedMesh(canopyUnitGeom, pineCanopyMat, pineCanopyPlacements.length);
    canopyInst.name = 'mountain-pine-canopies-mesh';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    const upShift = new THREE.Vector3();
    for (let i = 0; i < pineCanopyPlacements.length; i++) {
      const p = pineCanopyPlacements[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      const baseYWorld = (p.trunkH - p.canopyH * 0.15) * p.scale;
      upShift.copy(p.up).multiplyScalar(baseYWorld);
      dummy.position.copy(p.pos).add(upShift);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(p.canopyR * p.scale, p.canopyH * p.scale, p.canopyR * p.scale);
      dummy.updateMatrix();
      canopyInst.setMatrixAt(i, dummy.matrix);
    }
    canopyInst.instanceMatrix.needsUpdate = true;
    canopyInst.computeBoundingSphere();
    applyInstanceColorJitter(THREE, canopyInst, pineCanopyPlacements.length, 1, 1, 1, 0.17, 0.05);
    root.add(canopyInst);
  }
  // Mobile: skip the pine canopy ceiling (same fill-rate story as forest).
  if (pineCeilingPlacements.length > 0 && !_isMobile()) {
    const baseDiscGeom = new THREE.CircleGeometry(1.0, 9);
    const posAttr = baseDiscGeom.getAttribute('position');
    for (let v = 1; v < posAttr.count; v++) {
      const cx = posAttr.getX(v), cy = posAttr.getY(v);
      const jitter = 0.85 + Math.random() * 0.3;
      posAttr.setX(v, cx * jitter);
      posAttr.setY(v, cy * jitter);
    }
    posAttr.needsUpdate = true;
    const ceilings = new THREE.InstancedMesh(baseDiscGeom, pineCanopyCeilingMat, pineCeilingPlacements.length);
    ceilings.name = 'mountain-pine-canopies';
    ceilings.renderOrder = 1;
    ceilings.raycast = () => {};
    const dummy = new THREE.Object3D();
    const flatRotX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const orientQ = new THREE.Quaternion();
    const tmpQ = new THREE.Quaternion();
    pineCeilingPlacements.forEach((p, idx) => {
      orientQ.setFromUnitVectors(defaultUp, p.up);
      tmpQ.copy(orientQ).multiply(flatRotX);
      dummy.position.copy(p.pos);
      dummy.quaternion.copy(tmpQ);
      dummy.scale.setScalar(p.radius);
      dummy.updateMatrix();
      ceilings.setMatrixAt(idx, dummy.matrix);
    });
    ceilings.instanceMatrix.needsUpdate = true;
    root.add(ceilings);
  }

  // --- Boulder fields (instanced) ---
  const boulderCount = _isMobile() ? 30 : 50;
  const boulderPoints = fibonacciSpherePoints(boulderCount, sphereRadius);
  if (boulderPoints.length > 0) {
    const boulderUnitGeom = new THREE.IcosahedronGeometry(1, 0);
    const boulderInst = new THREE.InstancedMesh(boulderUnitGeom, boulderMat, boulderPoints.length);
    boulderInst.name = 'mountain-boulders';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < boulderPoints.length; i++) {
      const point = boulderPoints[i];
      const pos = placeOnSphere(THREE, sphereRadius, point.theta + randomInRange(-0.15, 0.15), point.phi + randomInRange(-0.08, 0.08), -0.2);
      const baseR = randomInRange(1.5, 4);
      const scaleMul = randomInRange(1.0, 2.0);
      const s = baseR * scaleMul;
      dummy.position.copy(pos);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      boulderInst.setMatrixAt(i, dummy.matrix);
      collisionSystem.addCollider(pos, 2.0 * s, 'boulder');
    }
    boulderInst.instanceMatrix.needsUpdate = true;
    boulderInst.computeBoundingSphere();
    applyInstanceColorJitter(THREE, boulderInst, boulderPoints.length, 1, 1, 1, 0.18, 0.04);
    root.add(boulderInst);
  }

  // --- Scree / talus fields at peak bases (instanced, collider-free) ---
  // Small rubble clustered around the foot of peaks so mountains transition
  // into the ground instead of popping out of a bare sphere.
  const screeCount = _isMobile() ? 30 : 60;
  if (peakPlacements.length > 0) {
    const screeGeom = new THREE.IcosahedronGeometry(1, 0);
    const screeMat = new THREE.MeshLambertMaterial({ color: 0x555c68, flatShading: true });
    const screeInst = new THREE.InstancedMesh(screeGeom, screeMat, screeCount);
    screeInst.name = 'mountain-scree';
    const dummy = new THREE.Object3D();
    const jitter = new THREE.Vector3();
    for (let i = 0; i < screeCount; i++) {
      const peak = peakPlacements[Math.floor(Math.random() * peakPlacements.length)];
      jitter.set(randomInRange(-1, 1), randomInRange(-1, 1), randomInRange(-1, 1))
        .normalize().multiplyScalar(randomInRange(4, 16));
      const pos = peak.pos.clone().add(jitter).normalize().multiplyScalar(sphereRadius - 0.3);
      const s = randomInRange(0.8, 2.0);
      dummy.position.copy(pos);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.scale.set(s, s * 0.7, s);
      dummy.updateMatrix();
      screeInst.setMatrixAt(i, dummy.matrix);
    }
    screeInst.instanceMatrix.needsUpdate = true;
    screeInst.computeBoundingSphere();
    applyInstanceColorJitter(THREE, screeInst, screeCount, 1, 1, 1, 0.2, 0.04);
    root.add(screeInst);
  }

  // --- Mist clouds — instanced puffs (1 draw call; was up to 54). Stay SOLID. ---
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xe7eef9, transparent: !_isMobile(), opacity: _isMobile() ? 1 : 0.6, flatShading: true });
  const mtnCloudCount = _isMobile() ? 4 : 18;
  const mtnPuffsPer = _isMobile() ? 1 : 3;
  const mtnPuffs = [];
  const _mc = new THREE.Quaternion();
  const _mo = new THREE.Vector3();
  for (let i = 0; i < mtnCloudCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const center = placeOnSphere(THREE, sphereRadius, theta, phi, randomInRange(25, 55));
    _mc.setFromUnitVectors(defaultUp, center.clone().normalize());
    const mtnCloudScale = randomInRange(1.5, 3.0);
    for (let j = 0; j < mtnPuffsPer; j++) {
      _mo.set(randomInRange(-5, 5), randomInRange(-1, 2), randomInRange(-5, 5))
        .applyQuaternion(_mc).multiplyScalar(mtnCloudScale);
      mtnPuffs.push({ pos: center.clone().add(_mo), scale: randomInRange(3, 7) * mtnCloudScale });
    }
    collisionSystem.addCollider(center, 6 * mtnCloudScale, 'cloud');
  }
  if (mtnPuffs.length > 0) {
    const puffUnitGeom = new THREE.IcosahedronGeometry(1, 1);
    const cloudInst = new THREE.InstancedMesh(puffUnitGeom, cloudMat, mtnPuffs.length);
    cloudInst.name = 'mountain-clouds';
    cloudInst.renderOrder = 2;
    cloudInst.raycast = () => {};
    const dummy = new THREE.Object3D();
    for (let i = 0; i < mtnPuffs.length; i++) {
      dummy.position.copy(mtnPuffs[i].pos);
      dummy.scale.setScalar(mtnPuffs[i].scale);
      dummy.updateMatrix();
      cloudInst.setMatrixAt(i, dummy.matrix);
    }
    cloudInst.instanceMatrix.needsUpdate = true;
    cloudInst.computeBoundingSphere();
    root.add(cloudInst);
  }

  return nestablePositions;
}

// ============================================================
// CITY — Grid-aligned building clusters forming street corridors
// Design: 10 city blocks, each a grid of 10-20 buildings.
// Varying heights create step-patterns. Fly BETWEEN buildings.
// Antennas/spires on rooftops for threading.
// ============================================================
function buildCityOnSphere({ THREE, root, sphereRadius, collisionSystem, proximityTargets }) {
  const nestablePositions = [];
  const defaultUp = new THREE.Vector3(0, 1, 0);
  // Building bodies carry vertexColors for a baked dark-base → lit-top façade
  // gradient. Per-instance jitter (added after instancing) spreads each tower's
  // tint so the skyline reads as many distinct buildings, not three clones.
  const buildingMats = [
    new THREE.MeshLambertMaterial({ color: 0x223656, flatShading: true, vertexColors: true }),
    new THREE.MeshLambertMaterial({ color: 0x29405f, flatShading: true, vertexColors: true }),
    new THREE.MeshLambertMaterial({ color: 0x1e2e49, flatShading: true, vertexColors: true }),
  ];
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x74d4ff, transparent: true, opacity: 0.15 });
  const antennaMat = new THREE.MeshLambertMaterial({ color: 0x888888 });

  // --- City blocks (clusters of buildings in rough grids) ---
  // PERF: ~150 buildings × (body + glow + maybe antenna) = ~300-450 draw calls.
  // Instance by material: 3 body buckets + 1 glow + 1 antenna = 5 InstancedMesh.
  const blockCount = _isMobile() ? 11 : 13;
  const blockCenters = fibonacciSpherePoints(blockCount, sphereRadius);

  // Per-mat buckets for building bodies.
  const bodyPlacementsByMat = [[], [], []];
  const glowPlacements = [];
  const antennaPlacements = [];
  let buildingIndex = 0;

  blockCenters.forEach((block) => {
    const buildingsInBlock = Math.floor(randomInRange(_isMobile() ? 11 : 13, _isMobile() ? 19 : 24));
    const gridSize = Math.ceil(Math.sqrt(buildingsInBlock));
    const gridAngle = Math.random() * Math.PI;

    const championIdx = Math.floor(Math.random() * buildingsInBlock);
    const shrimpIdx = (championIdx + Math.floor(buildingsInBlock / 2)) % buildingsInBlock;

    for (let b = 0; b < buildingsInBlock; b++) {
      const row = Math.floor(b / gridSize);
      const col = b % gridSize;
      const spacing = 0.012;
      const gx = (col - gridSize / 2) * spacing + randomInRange(-0.002, 0.002);
      const gy = (row - gridSize / 2) * spacing + randomInRange(-0.002, 0.002);

      const theta = block.theta + gx * Math.cos(gridAngle) - gy * Math.sin(gridAngle);
      const phi = block.phi + (gx * Math.sin(gridAngle) + gy * Math.cos(gridAngle)) * 0.5;
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();

      let height, width, depth;
      if (b === championIdx) {
        height = randomInRange(170, 240);
        width = randomInRange(6, 9);
        depth = randomInRange(6, 9);
      } else if (b === shrimpIdx) {
        height = randomInRange(8, 14);
        width = randomInRange(4, 6);
        depth = randomInRange(4, 6);
      } else {
        height = randomInRange(20, 95);
        width = randomInRange(3, 7);
        depth = randomInRange(3, 7);
      }

      const matIdx = Math.floor(Math.random() * buildingMats.length);
      const yaw = Math.random() * Math.PI * 0.5;

      const common = { pos, up, height, width, depth, yaw };
      bodyPlacementsByMat[matIdx].push(common);
      glowPlacements.push(common);
      if (height > 38) {
        antennaPlacements.push({
          pos, up, height, yaw,
          antennaH: randomInRange(7, 18),
        });
      }
      collisionSystem.addCollider(pos, Math.max(width, depth) * 0.6, 'tower');
      // Mid-height collider so buildings are solid at cruise altitude.
      const towerMid = pos.clone().add(up.clone().multiplyScalar(height * 0.5));
      collisionSystem.addCollider(towerMid, Math.max(width, depth) * 0.65, 'tower');

      // Roof perches on mid-rise buildings. Never put a nest halfway inside
      // a skyscraper or erase the city to expose it when occupied.
      if (buildingIndex % 4 === 0 && height > 25 && height <= 65) {
        const nestPos = pos.clone().addScaledVector(up, height + 0.2);
        nestablePositions.push({ position: nestPos, surfaceNormal: up.clone(),
          hostObject: null, hostId: `city-building-${buildingIndex}` });
      }

      if (b === championIdx && proximityTargets) {
        const apex = pos.clone().addScaledVector(up, height * 0.55);
        proximityTargets.push({ position: apex, radius: 18, tint: 0x9bd5ff });
      }
      buildingIndex++;
    }
  });

  // Helper to build an instanced box with per-instance yaw around local up.
  // Unit box: 1×1×1 centered; translate +0.5Y so base sits on surface.
  // heightSegments raised so the baked façade gradient (dark street base →
  // lit upper floors) has facets to read across. The `color` attribute is
  // ignored by the glow/rooftop materials (no vertexColors) and only read by
  // the building bodies — so this one shared geom serves all three uses.
  const bodyUnitGeom = new THREE.BoxGeometry(1, 1, 1, 1, 3, 1);
  bodyUnitGeom.translate(0, 0.5, 0);
  bakeVerticalGradient(THREE, bodyUnitGeom, [0.66, 0.66, 0.72], [1.18, 1.2, 1.24]);

  function buildBoxInstances(name, placements, material, widthMul = 1, depthMul = 1, heightMul = 1) {
    if (placements.length === 0) return null;
    const inst = new THREE.InstancedMesh(bodyUnitGeom, material, placements.length);
    inst.name = name;
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    const yawQ = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      yawQ.setFromAxisAngle(yAxis, p.yaw);
      orientQ.multiply(yawQ);
      dummy.position.copy(p.pos);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(p.width * widthMul, p.height * heightMul, p.depth * depthMul);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    return inst;
  }

  // --- Global building scatter — fills the gaps BETWEEN city blocks so the
  // surface reads as continuous urban sprawl, not a few isolated downtowns.
  // Rides the SAME body InstancedMeshes (zero new draw calls). Mobile-gated.
  const scatterBldgCount = _isMobile() ? 150 : 250;
  const scatterBldgPoints = fibonacciSpherePoints(scatterBldgCount, sphereRadius);
  for (let i = 0; i < scatterBldgPoints.length; i++) {
    const sp = scatterBldgPoints[i];
    const pos = placeOnSphere(THREE, sphereRadius, sp.theta + randomInRange(-0.04, 0.04), sp.phi + randomInRange(-0.04, 0.04), 0);
    const up = pos.clone().normalize();
    const height = randomInRange(12, 60);
    const width = randomInRange(3, 6);
    const depth = randomInRange(3, 6);
    const yaw = Math.random() * Math.PI * 0.5;
    const common = { pos, up, height, width, depth, yaw };
    bodyPlacementsByMat[Math.floor(Math.random() * buildingMats.length)].push(common);
    glowPlacements.push(common);
    collisionSystem.addCollider(pos, Math.max(width, depth) * 0.6, 'tower');
    const scatterTowerMid = pos.clone().add(up.clone().multiplyScalar(height * 0.5));
    collisionSystem.addCollider(scatterTowerMid, Math.max(width, depth) * 0.65, 'tower');
  }

  for (let mi = 0; mi < bodyPlacementsByMat.length; mi++) {
    const inst = buildBoxInstances(`city-towers-${mi}`, bodyPlacementsByMat[mi], buildingMats[mi]);
    if (inst) {
      // Per-building tint spread (warmer/cooler, lit/dim) so the skyline reads
      // as a varied city, not three repeated slabs. Mean 1.0 keeps the palette.
      applyInstanceColorJitter(THREE, inst, bodyPlacementsByMat[mi].length, 1, 1, 1, 0.16, 0.05);
      root.add(inst);
    }
  }

  // Glow is an offset-scale box (width*1.02 × height*0.9 × depth*1.02) with
  // its base slightly inset so it still hugs the body. Use a second instanced
  // mesh with its own scale mul. On mobile: skip glow entirely (saves a full
  // transparent pass over every building).
  if (!_isMobile()) {
    const glowInst = buildBoxInstances('city-tower-glow', glowPlacements, glowMat, 1.02, 1.02, 0.9);
    if (glowInst) {
      // Offset base up slightly so glow center aligns with body center.
      // Original had glow.position.y = height/2 same as body; our unit box is
      // base-at-0 scaled by height*0.9, so base lifts by height*0.05 naturally —
      // we need to center the glow *inside* the body. Translate the unit geom
      // before instancing? Simpler: accept 5% base offset (invisible at play
      // distance). Desktop-only so worst case is cosmetic.
      root.add(glowInst);
    }
  }

  // Antennas: unit cylinder radius 0.15, height 1, base at y=0. Per-instance
  // position sits at tower top (height from surface), scale Y = antennaH.
  if (antennaPlacements.length > 0) {
    const antennaUnitGeom = new THREE.CylinderGeometry(0.15, 0.15, 1.0, 4);
    antennaUnitGeom.translate(0, 0.5, 0);
    const antennaInst = new THREE.InstancedMesh(antennaUnitGeom, antennaMat, antennaPlacements.length);
    antennaInst.name = 'city-antennas';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    const yawQ = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const upShift = new THREE.Vector3();
    for (let i = 0; i < antennaPlacements.length; i++) {
      const p = antennaPlacements[i];
      orientQ.setFromUnitVectors(defaultUp, p.up);
      yawQ.setFromAxisAngle(yAxis, p.yaw);
      orientQ.multiply(yawQ);
      // Antenna sits at the top of the building (height above surface).
      upShift.copy(p.up).multiplyScalar(p.height);
      dummy.position.copy(p.pos).add(upShift);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(1, p.antennaH, 1);
      dummy.updateMatrix();
      antennaInst.setMatrixAt(i, dummy.matrix);
    }
    antennaInst.instanceMatrix.needsUpdate = true;
    antennaInst.computeBoundingSphere();
    root.add(antennaInst);
  }
  console.log(`[City] ${buildingIndex} buildings in ${blockCount} blocks (instanced), ${nestablePositions.length} nests`);

  // --- Rooftop clutter: vents/tanks on tall building tops (instanced, collider-free) ---
  // Reuses the building unit box + the already-collected placements (glowPlacements
  // holds every building's pos/up/height/yaw). Evenly samples the tall ones.
  const rooftopBudget = _isMobile() ? 30 : 60;
  {
    const rooftopCandidates = glowPlacements.filter((p) => p.height > 30);
    const count = Math.min(rooftopBudget, rooftopCandidates.length);
    if (count > 0) {
      const rooftopMat = new THREE.MeshLambertMaterial({ color: 0x39434f, flatShading: true });
      const inst = new THREE.InstancedMesh(bodyUnitGeom, rooftopMat, count);
      inst.name = 'city-rooftop-clutter';
      const dummy = new THREE.Object3D();
      const orientQ = new THREE.Quaternion();
      const yawQ = new THREE.Quaternion();
      const yAxis = new THREE.Vector3(0, 1, 0);
      const upShift = new THREE.Vector3();
      const step = rooftopCandidates.length / count;
      for (let i = 0; i < count; i++) {
        const p = rooftopCandidates[Math.floor(i * step)];
        orientQ.setFromUnitVectors(defaultUp, p.up);
        yawQ.setFromAxisAngle(yAxis, p.yaw + randomInRange(-0.4, 0.4));
        orientQ.multiply(yawQ);
        upShift.copy(p.up).multiplyScalar(p.height);
        dummy.position.copy(p.pos).add(upShift);
        dummy.quaternion.copy(orientQ);
        const bw = Math.min(p.width, p.depth) * randomInRange(0.3, 0.6);
        dummy.scale.set(bw, randomInRange(1.5, 4), bw);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      root.add(inst);
    }
  }

  // --- Street pylons / light poles at ground level (instanced, collider-free) ---
  const pylonCount = _isMobile() ? 24 : 50;
  {
    const pylonGeom = new THREE.CylinderGeometry(0.15, 0.25, 1, 5);
    pylonGeom.translate(0, 0.5, 0);
    const pylonMat = new THREE.MeshLambertMaterial({
      color: 0x3a4a5e, emissive: 0x16324a, emissiveIntensity: 0.5, flatShading: true,
    });
    const pylonInst = new THREE.InstancedMesh(pylonGeom, pylonMat, pylonCount);
    pylonInst.name = 'city-pylons';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    for (let i = 0; i < pylonCount; i++) {
      const block = blockCenters[i % blockCenters.length];
      const theta = block.theta + randomInRange(-0.05, 0.05);
      const phi = block.phi + randomInRange(-0.035, 0.035);
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();
      orientQ.setFromUnitVectors(defaultUp, up);
      dummy.position.copy(pos);
      dummy.quaternion.copy(orientQ);
      dummy.scale.set(1, randomInRange(8, 16), 1);
      dummy.updateMatrix();
      pylonInst.setMatrixAt(i, dummy.matrix);
    }
    pylonInst.instanceMatrix.needsUpdate = true;
    pylonInst.computeBoundingSphere();
    root.add(pylonInst);
  }

  // --- Hover vehicles between buildings (instanced; mobile holds count low) ---
  const hoverCount = _isMobile() ? 14 : 38;
  const hoverMat = new THREE.MeshLambertMaterial({
    color: 0x6cc4ff,
    // Keep transparent on both (looks better), but low opacity = cheap blend.
    transparent: true,
    opacity: 0.6,
  });
  if (hoverCount > 0) {
    const hoverGeom = new THREE.TorusGeometry(1.5, 0.3, 6, 12);
    const hoverInst = new THREE.InstancedMesh(hoverGeom, hoverMat, hoverCount);
    hoverInst.name = 'city-hover';
    const dummy = new THREE.Object3D();
    const orientQ = new THREE.Quaternion();
    const flatXQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    for (let i = 0; i < hoverCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - 2 * Math.random());
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, randomInRange(30, 60));
      orientQ.setFromUnitVectors(defaultUp, pos.clone().normalize()).multiply(flatXQ);
      dummy.position.copy(pos);
      dummy.quaternion.copy(orientQ);
      dummy.scale.setScalar(randomInRange(2.0, 4.2));
      dummy.updateMatrix();
      hoverInst.setMatrixAt(i, dummy.matrix);
    }
    hoverInst.instanceMatrix.needsUpdate = true;
    hoverInst.computeBoundingSphere();
    root.add(hoverInst);
  }

  return nestablePositions;
}

// Environment builder mapping
const SPHERE_BUILDERS = {
  forest: buildForestOnSphere,
  canyons: buildCanyonOnSphere,
  city: buildCityOnSphere,
  mountain: buildMountainOnSphere,
};

export function createSphericalWorld(scene, { three, variant = 'forest', definition } = {}) {
  const THREE = three ?? THREEImported;

  const sphereRadius = SPHERE_RADIUS;
  const collisionSystem = new SphericalCollisionSystem(sphereRadius);

  // Activate this environment's terrain profile so the sphere mesh, prop
  // placement (placeOnSphere) and ground collision all sample the same rolling
  // displacement. Set before anything is built.
  _activeTerrainProfile = TERRAIN_PROFILES[variant] || TERRAIN_PROFILES.forest;
  _landmarks = [];

  // Carve the landmark valley into the SAME field the mesh & flight floor sample.
  // Must happen BEFORE displaceSphereGeometry so the basin shows in the mesh.
  const _valleyFrame = _tangentFrame(THREE, VALLEY_ANCHOR);
  setActiveValley(VALLEY_ANCHOR, _valleyFrame.forward, _valleyFrame.right, VALLEY_PARAMS);

  const root = new THREE.Group();
  root.name = `spherical-world-${variant}`;
  scene.add(root);

  // Get colors from definition
  const groundColor = definition?.groundColor ?? 0x1e5f3c;
  const floorColor = definition?.floor?.color ?? 0x1e5f3c;
  const floorOpacity = definition?.floor?.opacity ?? 0.9;

  // Create the sphere ground with terrain displacement + vertex coloring
  // Desktop 128×96 = ~24K tris; mobile 96×64 trims vertex/raster cost while
  // keeping the silhouette readable under flat shading.
  const groundWidthSeg = _isMobile() ? 96 : 128;
  const groundHeightSeg = _isMobile() ? 64 : 96;
  const sphereGeometry = new THREE.SphereGeometry(sphereRadius, groundWidthSeg, groundHeightSeg);
  const terrainData = displaceSphereGeometry(sphereGeometry, sphereRadius, variant);

  // Lambert (vs Standard) drops the PBR roughness/metalness pass — cheaper to
  // shade and visually equivalent here under flat shading + vertex colors.
  const sphereMaterial = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,    // Low-poly aesthetic — every face visible
    side: THREE.FrontSide,
  });

  const sphereGround = new THREE.Mesh(sphereGeometry, sphereMaterial);
  sphereGround.name = 'sphere-ground';
  // Exclude ground from rocket raycasting (rockets should only hit objects like trees/rocks)
  sphereGround.raycast = () => {};
  root.add(sphereGround);

  // index.html owns the single biome light rig on every device.

  // NOTE: the full-screen BackSide sky sphere that used to be built here has
  // been removed. It enclosed the camera (skyRadius = sphereRadius * 6) and
  // fully overwrote the painterly sky-dome that index.html adds, so it was
  // redundant overdraw across the entire viewport with no visual benefit.
  // index.html owns the sky-dome now; do not re-add a world sky sphere here.

  // Build environment-specific objects and get nestable positions
  let nestablePositions = [];
  const proximityTargets = []; // Large props that trigger whoosh + haptic when bird flies close
  const builder = SPHERE_BUILDERS[variant];
  console.log(`[SphericalWorld] Creating ${variant} environment, builder exists: ${typeof builder === 'function'}`);
  if (typeof builder === 'function') {
    nestablePositions = builder({
      THREE,
      root,
      sphereRadius,
      collisionSystem,
      proximityTargets,
    }) || [];
  }
  bakeGroundContacts(THREE, sphereGeometry, root);

  console.log(`[SphericalWorld] Builder returned ${nestablePositions.length} nestable positions, ${proximityTargets.length} proximity targets`);

  // ── Landmark valley water + slalom Run (added to EVERY environment) ──
  // Added to root so they rotate with the world and are disposed with it. The
  // returned `features.update(birdPos, delta, timeMs)` animates the water +
  // neon and drives the ring-gate chime; index.html calls it once per frame.
  let features = null;
  try {
    const mobile = _isMobile();
    const slalomFrame = _tangentFrame(THREE, SLALOM_ANCHOR);
    const heightAt = (nx, ny, nz) => terrainHeightDir(nx, ny, nz);
    const valley = createValleyFeature({
      THREE, sphereRadius, anchor: VALLEY_ANCHOR,
      forward: _valleyFrame.forward, right: _valleyFrame.right,
      params: VALLEY_PARAMS, heightAt, isMobile: mobile,
    });
    const slalom = createSlalomRun({
      THREE, sphereRadius, collisionSystem, anchor: SLALOM_ANCHOR,
      forward: slalomFrame.forward, right: slalomFrame.right, heightAt, isMobile: mobile,
    });
    root.add(valley.group);
    root.add(slalom.group);
    // Exclude the decorative landmark subtrees (waterfall/pool/river/mist +
    // slalom corridor tube/gates/trees/banners) from raycasting. The rocket
    // system raycasts [root] RECURSIVELY every frame per live shot; the slalom
    // corridor alone is a ~2.7k-tri non-instanced TubeGeometry whose bounding
    // sphere spans the whole course, so nearly every shot fell through to a full
    // brute-force triangle sweep — that stacked with the dense prop world froze
    // mobile a moment after firing (the muzzle corridor arms the raycast at 28u).
    // Rockets should never detonate on a waterfall sheet or a translucent gate
    // anyway, so this is correct as well as fast. Matches sphereGround/cloud/
    // canopy `raycast = () => {}`. Bird collision is unaffected — it uses the
    // spatial-hash collisionSystem, not the Raycaster.
    const _noRaycast = () => {};
    valley.group.traverse((o) => { o.raycast = _noRaycast; });
    slalom.group.traverse((o) => { o.raycast = _noRaycast; });
    features = {
      valley,
      update(birdPos, delta, timeMs) {
        valley.update(delta, timeMs, birdPos);
        slalom.update(birdPos, delta, timeMs);
      },
    };
  } catch (e) {
    console.warn('[SphericalWorld] landmark features failed:', e);
  }

  return {
    root,
    landmarks: _landmarks,
    sphereRadius,
    collisionSystem,
    nestablePositions,
    proximityTargets,
    features,
    dispose() {
      // Remove from scene first to prevent visual artifacts during environment switch
      scene.remove(root);

      // Then dispose geometries and materials
      try {
        root.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          // Beauty pass: InstancedMesh.instanceColor is a GPU buffer that
          // material/geometry disposal does NOT release — free it explicitly
          // (matches world-shell.js's teardown) so env swaps don't leak it.
          if (child.instanceColor?.dispose) child.instanceColor.dispose();
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
              if (!m) return;
              // Dispose CanvasTextures too (landmark water + RUN sign) — the
              // material.dispose() alone leaks them on environment swaps.
              if (m.map) m.map.dispose();
              if (m.emissiveMap) m.emissiveMap.dispose();
              m.dispose();
            });
          }
        });
      } catch (e) {
        console.warn('Error disposing spherical world resources:', e);
      }
    }
  };
}

export { SPHERE_RADIUS };
