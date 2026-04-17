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
      const distance = vec.length();
      const minDistance = collider.radius + entityRadius;

      if (distance < minDistance) {
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

  // --- Generate grove center points (12-15 groves spread across sphere) ---
  const groveCount = 14;
  const groveCenters = fibonacciSpherePoints(groveCount, sphereRadius);

  const treeGroup = new THREE.Group();
  treeGroup.name = 'forest-trees';

  // Pre-collect ceiling placements; we'll build one InstancedMesh after the loop.
  const ceilingPlacements = []; // { pos, up, radius }

  let treeIndex = 0;
  const nestInterval = 15; // Every 15th tree is nestable

  groveCenters.forEach((groveCenter, groveIdx) => {
    // Each grove: 12-20 trees clustered tightly around center
    const treesInGrove = Math.floor(randomInRange(12, 20));
    // Cluster radius in angular space — tight enough to form corridors
    // On radius 120, 0.04 radians ≈ 4.8 units at surface — trees ~3-8 units apart
    const clusterSpread = randomInRange(0.03, 0.06);

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
      const jitterTheta = groveCenter.theta + randomInRange(-clusterSpread, clusterSpread);
      const jitterPhi = groveCenter.phi + randomInRange(-clusterSpread * 0.6, clusterSpread * 0.6);
      const pos = placeOnSphere(THREE, sphereRadius, jitterTheta, jitterPhi, 0);
      const up = pos.clone().normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);

      const tree = new THREE.Group();

      // Trunk — tall enough to create corridors between
      const trunkHeight = randomInRange(8, 16);
      const trunkRadiusBottom = randomInRange(0.5, 1.0);
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(trunkRadiusBottom * 0.4, trunkRadiusBottom, trunkHeight, 6),
        trunkMat
      );
      trunk.position.y = trunkHeight / 2;
      tree.add(trunk);

      // Canopy — forms the ceiling layer
      const canopyHeight = randomInRange(8, 16);
      const canopyRadius = randomInRange(3, 6);
      const canopy = new THREE.Mesh(
        new THREE.ConeGeometry(canopyRadius, canopyHeight, 7),
        canopyMats[Math.floor(Math.random() * canopyMats.length)]
      );
      canopy.position.y = trunkHeight + canopyHeight * 0.4;
      tree.add(canopy);

      // Scale variation with champion / shrimp overrides for dramatic height variation
      let scale;
      const isChampion = championSet.has(t);
      const isShrimp = shrimpSet.has(t);
      if (isChampion) {
        scale = randomInRange(2.3, 3.1); // Giant — eye reference
      } else if (isShrimp) {
        scale = randomInRange(0.5, 0.7); // Undergrowth
      } else {
        scale = randomInRange(1.0, 2.0);
      }
      tree.position.copy(pos);
      tree.quaternion.copy(quaternion);
      tree.scale.setScalar(scale);
      treeGroup.add(tree);

      // Collision
      collisionSystem.addCollider(pos, trunkRadiusBottom * scale * 1.2, 'tree');

      const treeTopLocalY = trunkHeight + canopyHeight * 0.8 + 0.5;
      const treeTopOffset = treeTopLocalY * scale;
      if (treeTopOffset > maxTreeTopOffset) {
        maxTreeTopOffset = treeTopOffset;
        championTopPos = pos;
      }

      // Nest positions — on the tallest trees in each grove
      if (treeIndex % nestInterval === 0 || isChampion) {
        const nestPos = pos.clone().add(up.clone().multiplyScalar(treeTopOffset));
        if (treeIndex % nestInterval === 0) {
          nestablePositions.push({
            position: nestPos,
            surfaceNormal: up.clone(),
            hostObject: tree,
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

  root.add(treeGroup);

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
  const shrubGroup = new THREE.Group();
  shrubGroup.name = 'forest-shrubs';

  groveCenters.forEach((grove) => {
    const shrubsPerGrove = Math.floor(randomInRange(6, 12));
    const shrubSpread = 0.08; // Wider than tree cluster — fills edges
    for (let s = 0; s < shrubsPerGrove; s++) {
      const theta = grove.theta + randomInRange(-shrubSpread, shrubSpread);
      const phi = grove.phi + randomInRange(-shrubSpread * 0.6, shrubSpread * 0.6);
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();

      const shrub = new THREE.Mesh(
        new THREE.IcosahedronGeometry(randomInRange(1.0, 2.5), 0),
        shrubMat
      );
      shrub.position.copy(pos);
      shrub.quaternion.setFromUnitVectors(defaultUp, up);
      shrub.scale.set(1, 0.6, 1).multiplyScalar(randomInRange(1.0, 2.0));
      shrubGroup.add(shrub);
    }
  });
  root.add(shrubGroup);

  // --- Rocks scattered between groves ---
  const rockGroup = new THREE.Group();
  rockGroup.name = 'forest-rocks';
  const rockCount = 50;
  const rockPoints = fibonacciSpherePoints(rockCount, sphereRadius);

  rockPoints.forEach((point) => {
    const pos = placeOnSphere(THREE, sphereRadius, point.theta + randomInRange(-0.15, 0.15), point.phi + randomInRange(-0.08, 0.08), -0.2);
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(randomInRange(0.8, 2.0), 0),
      rockMat
    );
    rock.position.copy(pos);
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    rock.scale.setScalar(randomInRange(1.0, 2.5));
    rockGroup.add(rock);
    collisionSystem.addCollider(pos, 1.0 * rock.scale.x, 'rock');
  });
  root.add(rockGroup);

  // --- Clouds — higher up, bigger, fewer ---
  // PERF: 20 cloud groups × 4 puff meshes = 80 transparent draw calls. Each
  // icosahedron is ~80 tris but transparency forces sort+blend. Mobile only
  // shows 4 clouds (1 puff each, opaque-like) to keep the sky "lived-in" for
  // free; desktop keeps the full cloud field.
  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'forest-clouds';
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xdfeeff, transparent: !_isMobile(), opacity: _isMobile() ? 1 : 0.7, flatShading: true,
  });

  const cloudCount = _isMobile() ? 4 : 20;
  const puffsPerCloud = _isMobile() ? 1 : 4;
  for (let i = 0; i < cloudCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const cloudHeight = randomInRange(40, 80);
    const pos = placeOnSphere(THREE, sphereRadius, theta, phi, cloudHeight);

    const cloud = new THREE.Group();
    for (let j = 0; j < puffsPerCloud; j++) {
      const puff = new THREE.Mesh(
        new THREE.IcosahedronGeometry(randomInRange(3, 6), 1),
        cloudMat
      );
      puff.position.set(randomInRange(-4, 4), randomInRange(-1, 2), randomInRange(-4, 4));
      puff.raycast = () => {};
      cloud.add(puff);
    }
    cloud.position.copy(pos);
    const up = pos.clone().normalize();
    cloud.quaternion.setFromUnitVectors(defaultUp, up);
    cloud.scale.setScalar(randomInRange(1.5, 3.0));
    cloudGroup.add(cloud);
  }
  root.add(cloudGroup);

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
  const ridgeCount = 10;
  const ridgeCenters = fibonacciSpherePoints(ridgeCount, sphereRadius);
  const spireGroup = new THREE.Group();
  spireGroup.name = 'canyon-spires';

  let spireIndex = 0;

  ridgeCenters.forEach((ridge, rIdx) => {
    const spiresInRidge = Math.floor(randomInRange(8, 14));
    // Ridge direction — a random tangent angle
    const ridgeAngle = Math.random() * Math.PI;
    const ridgeLength = randomInRange(0.06, 0.1); // Angular extent of ridge

    // Champion: 1 spire per ridge gets 2-3× scale to anchor the eye
    const championIdx = Math.floor(Math.random() * spiresInRidge);
    const shrimpIdx = (championIdx + Math.floor(spiresInRidge / 2)) % spiresInRidge;

    for (let s = 0; s < spiresInRidge; s++) {
      const t = (s / spiresInRidge - 0.5) * 2; // -1 to 1 along ridge
      const along = t * ridgeLength;
      const across = randomInRange(-0.008, 0.008); // Very tight perpendicular spread = wall

      const theta = ridge.theta + along * Math.cos(ridgeAngle) + across * Math.sin(ridgeAngle);
      const phi = ridge.phi + along * Math.sin(ridgeAngle) * 0.5 + across * Math.cos(ridgeAngle) * 0.5;
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();

      // Tall wall-like spires
      const height = randomInRange(20, 50);
      const baseRadius = randomInRange(2.0, 4.5);
      const spire = new THREE.Mesh(
        new THREE.CylinderGeometry(baseRadius * 0.3, baseRadius, height, 6, 1),
        Math.random() > 0.5 ? spireMat : darkSpireMat
      );
      spire.position.copy(pos).addScaledVector(up, height / 2);
      spire.quaternion.setFromUnitVectors(defaultUp, up);
      spire.rotateX(randomInRange(-0.08, 0.08));
      spire.rotateZ(randomInRange(-0.08, 0.08));

      let scale;
      if (s === championIdx) {
        scale = randomInRange(2.2, 2.9); // Towering champion spire
      } else if (s === shrimpIdx) {
        scale = randomInRange(0.5, 0.7);
      } else {
        scale = randomInRange(1.0, 1.5);
      }
      spire.scale.setScalar(scale);
      spireGroup.add(spire);
      collisionSystem.addCollider(pos, baseRadius * scale * 0.8, 'spire');

      // Nests on tallest spires
      if (spireIndex % 12 === 0 && height > 35) {
        const nestPos = pos.clone().add(up.clone().multiplyScalar(height * scale + 1));
        nestablePositions.push({ position: nestPos, surfaceNormal: up.clone(), hostObject: spire });
      }

      // Champion spires register as proximity targets
      if (s === championIdx && proximityTargets) {
        const apex = pos.clone().add(up.clone().multiplyScalar(height * scale * 0.6));
        proximityTargets.push({
          position: apex,
          radius: 14,
          tint: 0xffd0a0,
        });
      }
      spireIndex++;
    }
  });

  root.add(spireGroup);
  console.log(`[Canyon] ${spireIndex} spires in ${ridgeCount} ridges, ${nestablePositions.length} nests`);

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

  // --- Arches spanning between ridges (fly-through challenges) ---
  const archGroup = new THREE.Group();
  archGroup.name = 'canyon-arches';
  const archMat = new THREE.MeshLambertMaterial({ color: 0xb25e34, flatShading: true });

  for (let i = 0; i < 8; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const pos = placeOnSphere(THREE, sphereRadius, theta, phi, randomInRange(10, 25));
    const arch = new THREE.Mesh(new THREE.TorusGeometry(8, 1.2, 6, 16), archMat);
    arch.position.copy(pos);
    const up = pos.clone().normalize();
    arch.quaternion.setFromUnitVectors(defaultUp, up);
    arch.rotateX(Math.PI / 2);
    arch.rotateZ(Math.random() * Math.PI);
    arch.scale.setScalar(randomInRange(1.2, 2.0));
    archGroup.add(arch);
    collisionSystem.addCollider(pos, 6 * arch.scale.x, 'arch');
  }
  root.add(archGroup);

  // --- Boulders at ground level ---
  const boulderGroup = new THREE.Group();
  boulderGroup.name = 'canyon-boulders';
  const boulderPoints = fibonacciSpherePoints(40, sphereRadius);

  boulderPoints.forEach((point) => {
    const pos = placeOnSphere(THREE, sphereRadius, point.theta + randomInRange(-0.12, 0.12), point.phi + randomInRange(-0.06, 0.06), -0.2);
    const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(randomInRange(1.5, 4), 0), boulderMat);
    boulder.position.copy(pos);
    boulder.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    boulder.scale.setScalar(randomInRange(1.0, 2.0));
    boulderGroup.add(boulder);
    collisionSystem.addCollider(pos, 2.0 * boulder.scale.x, 'boulder');
  });
  root.add(boulderGroup);

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
  const rangeCount = 8;
  const rangeCenters = fibonacciSpherePoints(rangeCount, sphereRadius);
  const peakGroup = new THREE.Group();
  peakGroup.name = 'mountain-peaks';
  let peakIndex = 0;

  rangeCenters.forEach((range, rIdx) => {
    const peaksInRange = Math.floor(randomInRange(4, 8));
    const rangeSpread = randomInRange(0.04, 0.07);
    const rangeAngle = Math.random() * Math.PI;

    // Champion / shrimp picks — eye references for scale
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

      const peak = new THREE.Group();
      const height = randomInRange(25, 65);
      const baseRadius = randomInRange(5, 12);

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(baseRadius * 0.2, baseRadius, height, 7, 1),
        stoneMat
      );
      body.position.y = height / 2;
      peak.add(body);

      // Snow cap on tall peaks
      if (height > 35) {
        const snowHeight = randomInRange(5, 12);
        const snowCap = new THREE.Mesh(
          new THREE.ConeGeometry(baseRadius * 0.5, snowHeight, 6),
          snowMat
        );
        snowCap.position.y = height + snowHeight * 0.3;
        peak.add(snowCap);
      }

      peak.position.copy(pos);
      peak.quaternion.setFromUnitVectors(defaultUp, up);
      peak.rotateX(randomInRange(-0.06, 0.06));
      peak.rotateZ(randomInRange(-0.06, 0.06));

      let scale;
      const isChampion = p === championIdx;
      const isShrimp = p === shrimpIdx;
      if (isChampion) {
        scale = randomInRange(2.0, 2.8); // Towering champion peak
      } else if (isShrimp) {
        scale = randomInRange(0.5, 0.7);
      } else {
        scale = randomInRange(1.0, 1.4);
      }
      peak.scale.setScalar(scale);
      peakGroup.add(peak);
      collisionSystem.addCollider(pos, baseRadius * scale * 0.8, 'mountain');

      // Nest on tallest peaks (champion always gets a nest)
      if ((peakIndex % 8 === 0 && height > 40) || isChampion) {
        const nestPos = pos.clone().add(up.clone().multiplyScalar((height + 2) * scale));
        nestablePositions.push({ position: nestPos, surfaceNormal: up.clone(), hostObject: peak });
      }

      // Champion peaks get proximity cues
      if (isChampion && proximityTargets) {
        const apex = pos.clone().addScaledVector(up, height * scale * 0.7);
        proximityTargets.push({
          position: apex,
          radius: 18,
          tint: 0xeaf4ff,
        });
      }
      peakIndex++;
    }
  });
  root.add(peakGroup);
  console.log(`[Mountain] ${peakIndex} peaks in ${rangeCount} ranges, ${nestablePositions.length} nests`);

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
  const pineGroup = new THREE.Group();
  pineGroup.name = 'mountain-pines';
  // Pine canopy ceiling placements (built into one InstancedMesh after the loop)
  const pineCeilingPlacements = []; // { pos, up, radius }
  // Place pine groves between ranges
  const pineGroveCount = 12;
  const pineGroveCenters = fibonacciSpherePoints(pineGroveCount, sphereRadius);

  pineGroveCenters.forEach((grove) => {
    const pinesInGrove = Math.floor(randomInRange(10, 18));
    const groveSpread = randomInRange(0.03, 0.05);
    const championIdx = Math.floor(Math.random() * pinesInGrove);
    let maxTopOffset = 0;
    for (let t = 0; t < pinesInGrove; t++) {
      const theta = grove.theta + randomInRange(-groveSpread, groveSpread);
      const phi = grove.phi + randomInRange(-groveSpread * 0.6, groveSpread * 0.6);
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();

      const pine = new THREE.Group();
      const trunkH = randomInRange(5, 10);
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.6, trunkH, 5),
        pineTrunkMat
      );
      trunk.position.y = trunkH / 2;
      pine.add(trunk);

      const canopyH = randomInRange(6, 12);
      const canopy = new THREE.Mesh(
        new THREE.ConeGeometry(randomInRange(2, 4), canopyH, 6),
        pineCanopyMat
      );
      canopy.position.y = trunkH + canopyH * 0.35;
      pine.add(canopy);

      pine.position.copy(pos);
      pine.quaternion.setFromUnitVectors(defaultUp, up);
      const scale = (t === championIdx)
        ? randomInRange(2.4, 3.0)
        : randomInRange(1.0, 1.8);
      pine.scale.setScalar(scale);
      pineGroup.add(pine);
      collisionSystem.addCollider(pos, 0.8 * scale, 'pine');
      const topOffset = (trunkH + canopyH * 0.85) * scale;
      if (topOffset > maxTopOffset) maxTopOffset = topOffset;
    }
    // Defer pine canopy ceiling — one InstancedMesh after the loop
    if (maxTopOffset > 8) {
      const ceilingPos = placeOnSphere(THREE, sphereRadius, grove.theta, grove.phi, 0);
      const up = ceilingPos.clone().normalize();
      const discRadius = sphereRadius * groveSpread * 1.3;
      const finalPos = ceilingPos.clone().addScaledVector(up, maxTopOffset * 0.66);
      pineCeilingPlacements.push({ pos: finalPos, up, radius: discRadius });
    }
  });
  root.add(pineGroup);
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

  // --- Boulder fields ---
  const boulderGroup = new THREE.Group();
  boulderGroup.name = 'mountain-boulders';
  const boulderPoints = fibonacciSpherePoints(50, sphereRadius);
  boulderPoints.forEach((point) => {
    const pos = placeOnSphere(THREE, sphereRadius, point.theta + randomInRange(-0.15, 0.15), point.phi + randomInRange(-0.08, 0.08), -0.2);
    const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(randomInRange(1.5, 4), 0), boulderMat);
    boulder.position.copy(pos);
    boulder.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    boulder.scale.setScalar(randomInRange(1.0, 2.0));
    boulderGroup.add(boulder);
    collisionSystem.addCollider(pos, 2.0 * boulder.scale.x, 'boulder');
  });
  root.add(boulderGroup);

  // --- Mist clouds weaving between peaks ---
  // Mobile: 4 clouds × 1 puff (was 18 × 3 = 54 transparent draw calls).
  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'mountain-clouds';
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xe7eef9, transparent: !_isMobile(), opacity: _isMobile() ? 1 : 0.6, flatShading: true });
  const mtnCloudCount = _isMobile() ? 4 : 18;
  const mtnPuffsPer = _isMobile() ? 1 : 3;
  for (let i = 0; i < mtnCloudCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const pos = placeOnSphere(THREE, sphereRadius, theta, phi, randomInRange(25, 55));
    const cloud = new THREE.Group();
    for (let j = 0; j < mtnPuffsPer; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(randomInRange(3, 7), 1), cloudMat);
      puff.position.set(randomInRange(-5, 5), randomInRange(-1, 2), randomInRange(-5, 5));
      puff.raycast = () => {};
      cloud.add(puff);
    }
    cloud.position.copy(pos);
    cloud.quaternion.setFromUnitVectors(defaultUp, pos.clone().normalize());
    cloud.scale.setScalar(randomInRange(1.5, 3.0));
    cloudGroup.add(cloud);
  }
  root.add(cloudGroup);

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

  const towerGroup = new THREE.Group();
  towerGroup.name = 'city-towers';

  // --- City blocks (clusters of buildings in rough grids) ---
  const blockCount = 10;
  const blockCenters = fibonacciSpherePoints(blockCount, sphereRadius);
  let buildingIndex = 0;

  blockCenters.forEach((block) => {
    const buildingsInBlock = Math.floor(randomInRange(10, 20));
    const blockSpread = randomInRange(0.025, 0.045);
    // Grid-like placement within block
    const gridSize = Math.ceil(Math.sqrt(buildingsInBlock));
    const gridAngle = Math.random() * Math.PI; // Block orientation

    const championIdx = Math.floor(Math.random() * buildingsInBlock);
    const shrimpIdx = (championIdx + Math.floor(buildingsInBlock / 2)) % buildingsInBlock;

    for (let b = 0; b < buildingsInBlock; b++) {
      const row = Math.floor(b / gridSize);
      const col = b % gridSize;
      // Grid spacing with some jitter (street gaps ~5-8 units)
      const spacing = 0.012; // Angular spacing between buildings
      const gx = (col - gridSize / 2) * spacing + randomInRange(-0.002, 0.002);
      const gy = (row - gridSize / 2) * spacing + randomInRange(-0.002, 0.002);

      const theta = block.theta + gx * Math.cos(gridAngle) - gy * Math.sin(gridAngle);
      const phi = block.phi + (gx * Math.sin(gridAngle) + gy * Math.cos(gridAngle)) * 0.5;
      const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 0);
      const up = pos.clone().normalize();

      const tower = new THREE.Group();
      // Height varies: champions tower (160-200), shrimps stub (8-12), rest 15-70
      let height, width, depth;
      if (b === championIdx) {
        height = randomInRange(140, 190);
        width = randomInRange(6, 9);
        depth = randomInRange(6, 9);
      } else if (b === shrimpIdx) {
        height = randomInRange(8, 14);
        width = randomInRange(4, 6);
        depth = randomInRange(4, 6);
      } else {
        height = randomInRange(15, 70);
        width = randomInRange(3, 7);
        depth = randomInRange(3, 7);
      }

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        buildingMats[Math.floor(Math.random() * buildingMats.length)]
      );
      body.position.y = height / 2;
      tower.add(body);

      // Glow strips (subtle window effect)
      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(width * 1.02, height * 0.9, depth * 1.02),
        glowMat
      );
      glow.position.y = height / 2;
      tower.add(glow);

      // Antenna on tall buildings
      if (height > 50) {
        const antennaH = randomInRange(5, 12);
        const antenna = new THREE.Mesh(
          new THREE.CylinderGeometry(0.15, 0.15, antennaH, 4),
          antennaMat
        );
        antenna.position.y = height + antennaH / 2;
        tower.add(antenna);
      }

      tower.position.copy(pos);
      tower.quaternion.setFromUnitVectors(defaultUp, up);
      // Random rotation around local up for block variety
      tower.rotateY(Math.random() * Math.PI * 0.5);

      towerGroup.add(tower);
      collisionSystem.addCollider(pos, Math.max(width, depth) * 0.6, 'tower');

      // Nest on tallest buildings (champions always get nests)
      if ((buildingIndex % 12 === 0 && height > 45) || b === championIdx) {
        const nestPos = pos.clone().add(up.clone().multiplyScalar(height + 1));
        nestablePositions.push({ position: nestPos, surfaceNormal: up.clone(), hostObject: tower });
      }

      // Champion towers register as proximity cues
      if (b === championIdx && proximityTargets) {
        const apex = pos.clone().addScaledVector(up, height * 0.55);
        proximityTargets.push({
          position: apex,
          radius: 18,
          tint: 0x9bd5ff,
        });
      }
      buildingIndex++;
    }
  });

  root.add(towerGroup);
  console.log(`[City] ${buildingIndex} buildings in ${blockCount} blocks, ${nestablePositions.length} nests`);

  // --- Hover vehicles between buildings ---
  const hoverGroup = new THREE.Group();
  hoverGroup.name = 'city-hover';
  const hoverMat = new THREE.MeshLambertMaterial({ color: 0x6cc4ff, transparent: true, opacity: 0.6 });

  for (let i = 0; i < 25; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const pos = placeOnSphere(THREE, sphereRadius, theta, phi, randomInRange(30, 60));
    const hover = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.3, 6, 12), hoverMat);
    hover.position.copy(pos);
    hover.quaternion.setFromUnitVectors(defaultUp, pos.clone().normalize());
    hover.rotateX(Math.PI / 2);
    hover.scale.setScalar(randomInRange(1.5, 3.0));
    hoverGroup.add(hover);
  }
  root.add(hoverGroup);

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
  // 128×96 = ~24K tris — fits in mobile budget with room for objects
  const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 128, 96);
  const terrainData = displaceSphereGeometry(sphereGeometry, sphereRadius, variant);

  const sphereMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,    // Low-poly aesthetic — every face visible
    roughness: 0.82,
    metalness: 0.05,
    side: THREE.FrontSide,
  });

  const sphereGround = new THREE.Mesh(sphereGeometry, sphereMaterial);
  sphereGround.name = 'sphere-ground';
  // Exclude ground from rocket raycasting (rockets should only hit objects like trees/rocks)
  sphereGround.raycast = () => {};
  root.add(sphereGround);

  // Multiple light sources to eliminate dark areas
  // Key light - main directional
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(50, 80, 50);
  root.add(keyLight);

  // Fill light - opposite side
  const fillLight = new THREE.DirectionalLight(0xaaccff, 0.6);
  fillLight.position.set(-50, -30, -50);
  root.add(fillLight);

  // Rim light - from below
  const rimLight = new THREE.DirectionalLight(0xffc9a4, 0.4);
  rimLight.position.set(0, -80, 30);
  root.add(rimLight);

  // Additional fill from another angle
  const fillLight2 = new THREE.DirectionalLight(0xd4f1ff, 0.5);
  fillLight2.position.set(60, -40, -60);
  root.add(fillLight2);

  // Another directional to cover remaining dark spots
  const fillLight3 = new THREE.DirectionalLight(0xffeedd, 0.4);
  fillLight3.position.set(-60, 40, 60);
  root.add(fillLight3);

  // Strong ambient hemisphere light for overall illumination
  const hemiLight = new THREE.HemisphereLight(0xd4f1ff, 0x1a4f32, 0.9);
  root.add(hemiLight);

  // Point light at center for inner glow
  const centerLight = new THREE.PointLight(0x63d0ff, 0.8, sphereRadius * 3);
  centerLight.position.set(0, 0, 0);
  root.add(centerLight);

  // Create sky sphere (large sphere surrounding the world)
  const skyRadius = sphereRadius * 6;
  const skyGeometry = new THREE.SphereGeometry(skyRadius, 64, 48);

  // Get sky colors from definition or use defaults
  const skyTop = definition?.sky?.top ?? 0x4d80c0;
  const skyBottom = definition?.sky?.bottom ?? 0x071323;

  let skyMaterial;
  try {
    skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(skyTop) },
        bottomColor: { value: new THREE.Color(skyBottom) },
        glowIntensity: { value: definition?.sky?.glow ?? 0.28 },
      },
      side: THREE.BackSide,
      fog: false,
      transparent: false,
      vertexShader: `
        varying float vGradient;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vGradient = smoothstep(-0.2, 0.8, normalize(worldPosition.xyz).y);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float glowIntensity;
        varying float vGradient;
        void main() {
          vec3 base = mix(bottomColor, topColor, vGradient);
          base += glowIntensity * 0.4 * vec3(0.18, 0.3, 0.55) * pow(vGradient, 2.5);
          gl_FragColor = vec4(base, 1.0);
        }
      `,
    });
  } catch (shaderError) {
    // Fallback to simple material if shader compilation fails
    skyMaterial = new THREE.MeshBasicMaterial({
      color: skyTop,
      side: THREE.BackSide,
      fog: false,
    });
  }

  const skydome = new THREE.Mesh(skyGeometry, skyMaterial);
  skydome.name = 'sky-sphere';
  skydome.renderOrder = -5;
  // Exclude sky from rocket raycasting
  skydome.raycast = () => {};
  root.add(skydome);

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
