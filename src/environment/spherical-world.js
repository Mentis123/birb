import * as THREEImported from "https://esm.sh/three@0.183.2";

const DEG2RAD = Math.PI / 180;

// Immersion-scale world: radius 120 gives circumference ~754 units
// At speed 8, loop time ~94s — room to breathe, fly THROUGH environments
const SPHERE_RADIUS = 120;

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
  }

  // Clear all object colliders
  clearColliders() {
    this.objectColliders = [];
  }

  // Check collision with sphere ground - returns corrected position if collision
  checkGroundCollision(THREE, position, entityRadius = 0.5) {
    const vec = this._ensureVec(THREE);
    const distanceFromCenter = position.length();
    const minAltitude = this.sphereRadius + entityRadius;

    if (distanceFromCenter < minAltitude) {
      // Bird is below ground - push it up to surface
      vec.copy(position).normalize().multiplyScalar(minAltitude);
      return { collided: true, correctedPosition: vec.clone(), normal: position.clone().normalize() };
    }

    return { collided: false, correctedPosition: null, normal: null };
  }

  // Check collision with objects on the sphere
  checkObjectCollision(THREE, position, entityRadius = 0.5) {
    const vec = this._ensureVec(THREE);

    for (const collider of this.objectColliders) {
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

// Helper to place objects on sphere surface
function placeOnSphere(THREE, radius, theta, phi, heightOffset = 0) {
  const r = radius + heightOffset;
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
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

// Biome-specific noise profiles
const TERRAIN_PROFILES = {
  forest: { scale: 0.06, amplitude: 8, octaves: 5, persistence: 0.45, lacunarity: 2.1 },
  canyons: { scale: 0.04, amplitude: 14, octaves: 4, persistence: 0.55, lacunarity: 2.3 },
  mountain: { scale: 0.035, amplitude: 20, octaves: 6, persistence: 0.5, lacunarity: 2.0 },
  city: { scale: 0.08, amplitude: 3, octaves: 3, persistence: 0.35, lacunarity: 2.0 },
};

// Height-based color palettes per biome (low altitude → high altitude)
const TERRAIN_COLORS = {
  forest: [
    { height: -0.3, color: [0.08, 0.22, 0.35] },  // Deep water (dark blue-green)
    { height: -0.05, color: [0.12, 0.30, 0.42] },  // Shallow water
    { height: 0.0,  color: [0.55, 0.50, 0.35] },   // Sand/shore
    { height: 0.1,  color: [0.12, 0.35, 0.18] },   // Low grass
    { height: 0.35, color: [0.18, 0.48, 0.30] },   // Rich grass
    { height: 0.6,  color: [0.22, 0.32, 0.22] },   // Highland
    { height: 0.85, color: [0.35, 0.30, 0.25] },   // Rock
    { height: 1.0,  color: [0.75, 0.78, 0.82] },   // Snow
  ],
  canyons: [
    { height: -0.2, color: [0.18, 0.08, 0.04] },   // Deep canyon floor
    { height: 0.0,  color: [0.35, 0.15, 0.08] },   // Canyon floor
    { height: 0.2,  color: [0.50, 0.22, 0.10] },   // Red rock low
    { height: 0.45, color: [0.62, 0.30, 0.14] },   // Red rock mid
    { height: 0.7,  color: [0.72, 0.42, 0.22] },   // Orange rock
    { height: 0.9,  color: [0.58, 0.35, 0.20] },   // Mesa top
    { height: 1.0,  color: [0.45, 0.25, 0.15] },   // Peak
  ],
  mountain: [
    { height: -0.2, color: [0.06, 0.15, 0.22] },   // Deep valley
    { height: 0.0,  color: [0.10, 0.22, 0.18] },   // Valley floor
    { height: 0.15, color: [0.12, 0.30, 0.20] },   // Low meadow
    { height: 0.35, color: [0.15, 0.25, 0.18] },   // Forest line
    { height: 0.55, color: [0.25, 0.22, 0.18] },   // Rock face
    { height: 0.75, color: [0.40, 0.38, 0.35] },   // High rock
    { height: 0.9,  color: [0.70, 0.72, 0.75] },   // Snow line
    { height: 1.0,  color: [0.85, 0.88, 0.92] },   // Peak snow
  ],
  city: [
    { height: -0.1, color: [0.06, 0.08, 0.14] },   // Low ground
    { height: 0.0,  color: [0.08, 0.12, 0.20] },   // Ground level
    { height: 0.3,  color: [0.10, 0.15, 0.24] },   // Elevated
    { height: 0.6,  color: [0.12, 0.18, 0.28] },   // High ground
    { height: 1.0,  color: [0.15, 0.22, 0.32] },   // Peak
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
    const disp = fbm(nx * sphereRadius * profile.scale, ny * sphereRadius * profile.scale, nz * sphereRadius * profile.scale, profile.octaves, profile.lacunarity, profile.persistence) * profile.amplitude;
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

    // Normalized height for coloring (0 = lowest, 1 = highest)
    const normalizedHeight = (disp - minDisp) / dispRange;
    const col = sampleTerrainColor(palette, normalizedHeight);
    colors[i * 3] = col[0];
    colors[i * 3 + 1] = col[1];
    colors[i * 3 + 2] = col[2];
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
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1a, flatShading: true });
  const canopyMats = [
    new THREE.MeshLambertMaterial({ color: 0x1a5c30, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x247040, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x2d8a4a, flatShading: true }),
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
  const groveCount = _isMobile() ? 8 : 10;
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
      if (!accepted && placedAngles.length > 0) {
        const fallback = placedAngles[Math.floor(Math.random() * placedAngles.length)];
        jitterTheta = fallback.theta + randomInRange(-clusterSpread * 0.45, clusterSpread * 0.45);
        jitterPhi = fallback.phi + randomInRange(-clusterSpread * 0.35, clusterSpread * 0.35);
      }
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
      const isShrimp = shrimpSet.has(t);
      if (isChampion) {
        scale = randomInRange(2.6, 3.6); // Towering emergent giant — eye reference
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

      // Nest positions — on the tallest trees in each grove.
      // No per-tree host object now (trees are instanced); nests attach via world
      // position only which is what the nest system uses anyway.
      if (treeIndex % nestInterval === 0 || isChampion) {
        const nestPos = pos.clone().add(up.clone().multiplyScalar(treeTopOffset));
        if (treeIndex % nestInterval === 0) {
          nestablePositions.push({
            position: nestPos,
            surfaceNormal: up.clone(),
            hostObject: null,
          });
        }
        // Champions are proximity targets (whoosh cue)
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
    root.add(trunkInst);
  }

  // --- Build instanced canopies, one InstancedMesh per color bucket ---
  // Unit canopy geom: cone with radius 1, height 1, base at y=0, tip at y=1.
  const canopyUnitGeom = new THREE.ConeGeometry(1, 1, 7);
  canopyUnitGeom.translate(0, 0.5, 0);
  const localUp = new THREE.Vector3();
  for (let c = 0; c < canopyPlacementsByColor.length; c++) {
    const bucket = canopyPlacementsByColor[c];
    if (bucket.length === 0) continue;
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

  return nestablePositions;
}

// ============================================================
// CANYON — Parallel ridgelines forming valley corridors
// Design: 10 ridge clusters, each a line of 8-14 tall spires.
// Ridges form walls. Fly BETWEEN ridges through valley corridors.
// Arches span between ridges for threading challenges.
// ============================================================
function buildCanyonOnSphere({ THREE, root, sphereRadius, collisionSystem, proximityTargets }) {
  const nestablePositions = [];
  const defaultUp = new THREE.Vector3(0, 1, 0);
  const spireMat = new THREE.MeshLambertMaterial({ color: 0x8b4728, flatShading: true });
  const darkSpireMat = new THREE.MeshLambertMaterial({ color: 0x6a3420, flatShading: true });
  const boulderMat = new THREE.MeshLambertMaterial({ color: 0x7a3c23, flatShading: true });
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x6e3520, flatShading: true });

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

      // Nests on spires — every 6th spire for reliable coverage.
      // Champion spires (scale 2.2-2.9) place the nest at 0.6× height so it's
      // visible from below without being unreachable. hostObject = null since
      // spires are rendered via InstancedMesh; nest system uses world position.
      if (spireIndex % 4 === 0 && height > 24) {
        const isChamp = s === championIdx;
        const nestHeight = isChamp ? (height * scale) * 0.6 + 1 : height * scale + 1;
        const nestPos = pos.clone().add(up.clone().multiplyScalar(nestHeight));
        nestablePositions.push({ position: nestPos, surfaceNormal: up.clone(), hostObject: null });
      }

      if (s === championIdx && proximityTargets) {
        const apex = pos.clone().add(up.clone().multiplyScalar(height * scale * 0.6));
        proximityTargets.push({ position: apex, radius: 14, tint: 0xffd0a0 });
      }
      spireIndex++;
    }
  });

  // Build InstancedMesh per material bucket.
  // Unit cylinder: top radius 0.3 (was baseRadius*0.3), bottom radius 1, height 1,
  // base at y=0, tip at y=1. Per-instance scale = (baseRadius, height, baseRadius) * treeScale.
  const spireMats = [spireMat, darkSpireMat];
  for (let mi = 0; mi < 2; mi++) {
    const bucket = spirePlacementsByMat[mi];
    if (bucket.length === 0) continue;
    const spireUnitGeom = new THREE.CylinderGeometry(0.3, 1.0, 1.0, 6, 1);
    spireUnitGeom.translate(0, 0.5, 0); // base at y=0
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
    // Unit box; per-instance scale gives length/height/thickness.
    const wallGeom = new THREE.BoxGeometry(1, 1, 1);
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
      // Nest atop each arch — landmark nests in flyable mid-airspace.
      const archNestPos = pos.clone().add(up.clone().multiplyScalar(8 * s));
      nestablePositions.push({ position: archNestPos, surfaceNormal: up.clone(), hostObject: null });
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
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x5c6472, flatShading: true });
  const snowMat = new THREE.MeshLambertMaterial({ color: 0xe6f1ff, flatShading: true });
  const pineTrunkMat = new THREE.MeshLambertMaterial({ color: 0x2e3b2b, flatShading: true });
  const pineCanopyMat = new THREE.MeshLambertMaterial({ color: 0x2a5535, flatShading: true });
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

      // Nest on peaks. Baseline: every 4th peak. Champions get a nest only ~1/3
      // of the time and sit at 0.55× scaled height so they're reachable rather
      // than floating at the unreachable apex. hostObject = null (instanced).
      const wantsBaselineNest = peakIndex % 3 === 0 && height > 28;
      const wantsChampionNest = isChampion && Math.random() < 0.55;
      if (wantsBaselineNest || wantsChampionNest) {
        const nestHeight = wantsChampionNest
          ? (height * scale) * 0.55 + 2
          : (height + 2) * scale;
        const nestPos = pos.clone().add(up.clone().multiplyScalar(nestHeight));
        nestablePositions.push({ position: nestPos, surfaceNormal: up.clone(), hostObject: null });
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
    const bodyUnitGeom = new THREE.CylinderGeometry(0.2, 1.0, 1.0, 7, 1);
    bodyUnitGeom.translate(0, 0.5, 0);
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

  pineGroveCenters.forEach((grove) => {
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
        ? randomInRange(2.4, 3.0)
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
      // Champion pine hosts a nest — adds a low-altitude nesting layer that
      // pine groves never had before.
      if (t === championIdx) {
        const pineNestPos = pos.clone().add(up.clone().multiplyScalar(topOffset));
        nestablePositions.push({ position: pineNestPos, surfaceNormal: up.clone(), hostObject: null });
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
  const buildingMats = [
    new THREE.MeshLambertMaterial({ color: 0x1e2f4c, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x243854, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x1a2840, flatShading: true }),
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

      // Nest on buildings. Baseline: every 6th building. Champion towers
      // (140-190u) get a nest only ~1/3 of the time and sit at 0.5× height so
      // they're approachable. hostObject = null (instanced).
      const wantsBaselineNest = buildingIndex % 4 === 0 && height > 30;
      const wantsChampionNest = b === championIdx && Math.random() < 0.34;
      if (wantsBaselineNest || wantsChampionNest) {
        const nestHeight = wantsChampionNest ? height * 0.5 + 1 : height + 1;
        const nestPos = pos.clone().add(up.clone().multiplyScalar(nestHeight));
        nestablePositions.push({ position: nestPos, surfaceNormal: up.clone(), hostObject: null });
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
  const bodyUnitGeom = new THREE.BoxGeometry(1, 1, 1);
  bodyUnitGeom.translate(0, 0.5, 0);

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

  for (let mi = 0; mi < bodyPlacementsByMat.length; mi++) {
    const inst = buildBoxInstances(`city-towers-${mi}`, bodyPlacementsByMat[mi], buildingMats[mi]);
    if (inst) root.add(inst);
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

  // Multiple light sources to eliminate dark areas.
  // PERF: on mobile, index.html already adds a separate 5-light scene rig, so
  // stacking this 7-light world rig pushes the per-fragment lighting loop to 12
  // lights. Gate the directional + point lights out on mobile and keep only the
  // ambient hemisphere fill — index.html's lights still illuminate the world.
  // Key light - main directional
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(50, 80, 50);

  // Fill light - opposite side
  const fillLight = new THREE.DirectionalLight(0xaaccff, 0.6);
  fillLight.position.set(-50, -30, -50);

  // Rim light - from below
  const rimLight = new THREE.DirectionalLight(0xffc9a4, 0.4);
  rimLight.position.set(0, -80, 30);

  // Additional fill from another angle
  const fillLight2 = new THREE.DirectionalLight(0xd4f1ff, 0.5);
  fillLight2.position.set(60, -40, -60);

  // Another directional to cover remaining dark spots
  const fillLight3 = new THREE.DirectionalLight(0xffeedd, 0.4);
  fillLight3.position.set(-60, 40, 60);

  // Strong ambient hemisphere light for overall illumination
  const hemiLight = new THREE.HemisphereLight(0xd4f1ff, 0x1a4f32, 0.9);

  // Point light at center for inner glow
  const centerLight = new THREE.PointLight(0x63d0ff, 0.8, sphereRadius * 3);
  centerLight.position.set(0, 0, 0);

  if (_isMobile()) {
    // Mobile: hemisphere ambient only (at most one world light).
    root.add(hemiLight);
  } else {
    root.add(keyLight);
    root.add(fillLight);
    root.add(rimLight);
    root.add(fillLight2);
    root.add(fillLight3);
    root.add(hemiLight);
    root.add(centerLight);
  }

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
  console.log(`[SphericalWorld] Builder returned ${nestablePositions.length} nestable positions, ${proximityTargets.length} proximity targets`);

  return {
    root,
    sphereRadius,
    collisionSystem,
    nestablePositions,
    proximityTargets,
    dispose() {
      // Remove from scene first to prevent visual artifacts during environment switch
      scene.remove(root);

      // Then dispose geometries and materials
      try {
        root.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m && m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      } catch (e) {
        console.warn('Error disposing spherical world resources:', e);
      }
    }
  };
}

export { SPHERE_RADIUS };
