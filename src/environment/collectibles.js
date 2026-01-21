/**
 * Collectible Ring System for Ring Rush Mode
 *
 * Rings are placed at good flying altitudes around the sphere.
 * Only visible during Ring Rush mode.
 */

const SPHERE_RADIUS = 30;
const RING_ALTITUDE_MIN = 6;  // Above sphere surface
const RING_ALTITUDE_MAX = 12;
const RING_COUNT = 10;

// Ring visual config - environment-themed colors
const RING_CONFIGS = {
  mountain: { color: 0x44ddff, emissive: 0x22aaff, glow: 0x66eeff },
  forest: { color: 0x44ff88, emissive: 0x22dd66, glow: 0x66ffaa },
  canyons: { color: 0xffaa44, emissive: 0xff8822, glow: 0xffcc66 },
  city: { color: 0x44aaff, emissive: 0x2288ff, glow: 0x66ccff },
};

/**
 * Generate ring positions distributed around the sphere at flying altitude
 */
function generateRingPositions(count = RING_COUNT) {
  const positions = [];

  // Use fibonacci sphere for even distribution
  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  for (let i = 0; i < count; i++) {
    // Fibonacci sphere distribution
    const theta = 2 * Math.PI * i / goldenRatio;
    const phi = Math.acos(1 - 2 * (i + 0.5) / count);

    // Random altitude variation
    const altitude = SPHERE_RADIUS + RING_ALTITUDE_MIN +
                     Math.random() * (RING_ALTITUDE_MAX - RING_ALTITUDE_MIN);

    // Convert to cartesian
    const x = altitude * Math.sin(phi) * Math.cos(theta);
    const y = altitude * Math.cos(phi);
    const z = altitude * Math.sin(phi) * Math.sin(theta);

    positions.push({ x, y, z, altitude });
  }

  return positions;
}

/**
 * Create a single ring mesh - small, glowing torus
 */
function createRing(THREE, config) {
  const group = new THREE.Group();
  group.name = 'collectible-ring';

  // Main ring - small torus
  const ringGeo = new THREE.TorusGeometry(0.6, 0.08, 12, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: config.color,
    transparent: true,
    opacity: 0.95,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  group.add(ring);

  // Outer glow
  const glowGeo = new THREE.TorusGeometry(0.7, 0.04, 8, 24);
  const glowMat = new THREE.MeshBasicMaterial({
    color: config.glow,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  group.add(glow);

  // Inner bright core
  const coreGeo = new THREE.TorusGeometry(0.5, 0.03, 8, 24);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  // Store for animation
  group.userData.ringMat = ringMat;
  group.userData.glowMat = glowMat;
  group.userData.coreMat = coreMat;
  group.userData.collected = false;

  return group;
}

/**
 * Main collectibles system
 */
export function createCollectiblesSystem(THREE, scene, environmentId) {
  const config = RING_CONFIGS[environmentId] || RING_CONFIGS.mountain;
  const positions = generateRingPositions(RING_COUNT);

  const container = new THREE.Group();
  container.name = 'collectibles';
  container.visible = false; // Hidden by default - only show in Ring Rush
  scene.add(container);

  const rings = [];
  let animationTime = 0;

  // Scratch vectors for collision detection
  const _scratchPos = new THREE.Vector3();

  // Create rings
  positions.forEach((pos, index) => {
    const ring = createRing(THREE, config);
    ring.position.set(pos.x, pos.y, pos.z);

    // Orient ring to face outward from sphere center
    const radial = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, radial);
    if (right.lengthSq() < 0.01) {
      right.set(1, 0, 0);
    }
    right.normalize();
    const forward = new THREE.Vector3().crossVectors(radial, right).normalize();

    // Make ring face radially (fly through it toward/away from center)
    ring.lookAt(ring.position.x + radial.x, ring.position.y + radial.y, ring.position.z + radial.z);

    ring.userData.index = index;
    container.add(ring);
    rings.push(ring);
  });

  return {
    rings,
    container,

    /**
     * Show/hide all rings (for Ring Rush mode toggle)
     */
    setVisible(visible) {
      container.visible = visible;
    },

    /**
     * Update ring animations
     */
    update(delta) {
      if (!container.visible) return;

      animationTime += delta;

      rings.forEach((ring, i) => {
        if (ring.userData.collected) return;

        // Gentle rotation
        ring.rotation.z += delta * 2;

        // Pulse glow
        const pulse = Math.sin(animationTime * 3 + i * 0.5) * 0.3 + 0.7;
        ring.userData.glowMat.opacity = 0.4 * pulse;
        ring.userData.coreMat.opacity = 0.6 * pulse;
      });
    },

    /**
     * Check for ring collection
     */
    checkCollection(birbPosition, radius = 1.2) {
      if (!container.visible) return [];

      const collected = [];

      rings.forEach((ring, i) => {
        if (ring.userData.collected) return;

        ring.getWorldPosition(_scratchPos);
        const dist = birbPosition.distanceTo(_scratchPos);

        if (dist < radius + 0.6) { // ring radius is 0.6
          ring.userData.collected = true;
          ring.visible = false;
          collected.push(i);
        }
      });

      return collected;
    },

    /**
     * Get collection stats
     */
    getStats() {
      const total = rings.length;
      const collected = rings.filter(r => r.userData.collected).length;
      return { collected, total };
    },

    /**
     * Reset all rings
     */
    reset() {
      rings.forEach((ring) => {
        ring.userData.collected = false;
        ring.visible = true;
      });
    },

    /**
     * Dispose resources
     */
    dispose() {
      rings.forEach((ring) => {
        ring.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      });
      scene.remove(container);
    },
  };
}
