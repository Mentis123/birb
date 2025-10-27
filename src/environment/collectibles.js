/**
 * Collectible Ring System
 * Creates themed collectible rings for each environment with particles and glow effects
 */

const RING_CONFIGS = {
  mountain: {
    color: 0x76d8ff,
    emissive: 0x3aa8ff,
    emissiveIntensity: 0.8,
    glowColor: 0x76d8ff,
    particleColor: 0xc4e8ff,
  },
  forest: {
    color: 0x4fcc88,
    emissive: 0x2d9966,
    emissiveIntensity: 0.7,
    glowColor: 0x4fcc88,
    particleColor: 0xb5ffdb,
  },
  canyons: {
    color: 0xffb563,
    emissive: 0xff8833,
    emissiveIntensity: 0.85,
    glowColor: 0xffb563,
    particleColor: 0xffe4c4,
  },
  city: {
    color: 0x69c8ff,
    emissive: 0x2e8bff,
    emissiveIntensity: 0.9,
    glowColor: 0x7fd8ff,
    particleColor: 0xe0f4ff,
  },
};

/**
 * Generate interesting flight paths for rings
 */
function generateRingPlacements(environmentId, count = 20) {
  const placements = [];

  switch (environmentId) {
    case 'mountain':
      // Rings weave through mountain peaks at various heights
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const radius = 15 + Math.random() * 25;
        const height = 3 + Math.sin(i * 0.5) * 8 + Math.random() * 5;
        placements.push({
          position: [
            Math.cos(angle) * radius,
            height,
            Math.sin(angle) * radius,
          ],
          rotation: [Math.random() * 0.3 - 0.15, angle + Math.PI / 2, Math.random() * 0.2 - 0.1],
          scale: 0.9 + Math.random() * 0.3,
        });
      }
      break;

    case 'forest':
      // Rings create a winding path through the forest canopy
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const spiralAngle = t * Math.PI * 3;
        const radius = 18 + Math.sin(t * Math.PI * 2) * 12;
        const height = 2 + Math.sin(t * Math.PI * 4) * 6;
        placements.push({
          position: [
            Math.cos(spiralAngle) * radius,
            height,
            Math.sin(spiralAngle) * radius,
          ],
          rotation: [Math.random() * 0.2 - 0.1, spiralAngle + Math.PI / 2, 0],
          scale: 0.95 + Math.random() * 0.25,
        });
      }
      break;

    case 'canyons':
      // Rings follow a canyon corridor with altitude changes
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const pathAngle = t * Math.PI * 2.5;
        const radius = 20 + Math.sin(t * Math.PI * 1.5) * 15;
        const height = 4 + Math.cos(t * Math.PI * 3) * 7;
        placements.push({
          position: [
            Math.cos(pathAngle) * radius,
            height,
            Math.sin(pathAngle) * radius,
          ],
          rotation: [Math.random() * 0.25 - 0.125, pathAngle + Math.PI / 2, Math.random() * 0.15 - 0.075],
          scale: 1.0 + Math.random() * 0.2,
        });
      }
      break;

    case 'city':
      // Rings create a challenging urban flight course between buildings
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const angle = t * Math.PI * 4;
        const radius = 16 + Math.sin(t * Math.PI * 3) * 18;
        const height = 5 + Math.sin(t * Math.PI * 5) * 8;
        placements.push({
          position: [
            Math.cos(angle) * radius,
            height,
            Math.sin(angle) * radius,
          ],
          rotation: [Math.random() * 0.3 - 0.15, angle + Math.PI / 2, 0],
          scale: 0.85 + Math.random() * 0.35,
        });
      }
      break;

    default:
      // Default circular pattern
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const radius = 20;
        const height = 5;
        placements.push({
          position: [Math.cos(angle) * radius, height, Math.sin(angle) * radius],
          rotation: [0, angle + Math.PI / 2, 0],
          scale: 1.0,
        });
      }
  }

  return placements;
}

/**
 * Create a single collectible ring with glow effect
 */
function createRing(THREE, config) {
  const group = new THREE.Group();

  // Main ring geometry
  const ringGeometry = new THREE.TorusGeometry(1.2, 0.12, 16, 32);
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: config.color,
    emissive: config.emissive,
    emissiveIntensity: config.emissiveIntensity,
    metalness: 0.3,
    roughness: 0.2,
    transparent: true,
    opacity: 0.95,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  group.add(ring);

  // Outer glow ring
  const glowGeometry = new THREE.TorusGeometry(1.35, 0.06, 12, 32);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: config.glowColor,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  group.add(glow);

  // Inner highlight
  const innerGeometry = new THREE.TorusGeometry(1.05, 0.04, 12, 32);
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const inner = new THREE.Mesh(innerGeometry, innerMaterial);
  group.add(inner);

  // Store references for animation
  group.userData.ring = ring;
  group.userData.glow = glow;
  group.userData.inner = inner;
  group.userData.baseOpacity = ringMaterial.opacity;
  group.userData.collected = false;

  return group;
}

/**
 * Create particle sparkles around a ring
 */
function createRingParticles(THREE, config, count = 24) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];
  const baseAngles = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const radius = 1.2;

    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.2;

    velocities.push(0);
    baseAngles.push(angle);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: config.particleColor,
    size: 0.1,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  particles.userData.velocities = velocities;
  particles.userData.baseAngles = baseAngles;
  particles.userData.time = Math.random() * Math.PI * 2;

  return particles;
}

/**
 * Create burst effect for collection
 */
function createCollectionBurst(THREE, config, position) {
  const count = 40;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];

  for (let i = 0; i < count; i++) {
    // Start at ring position
    positions[i * 3] = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;

    // Random velocities
    const phi = Math.random() * Math.PI * 2;
    const theta = Math.random() * Math.PI;
    const speed = 2 + Math.random() * 4;

    velocities.push({
      x: Math.sin(theta) * Math.cos(phi) * speed,
      y: Math.sin(theta) * Math.sin(phi) * speed,
      z: Math.cos(theta) * speed,
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: config.particleColor,
    size: 0.15,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const burst = new THREE.Points(geometry, material);
  burst.userData.velocities = velocities;
  burst.userData.life = 1.0;
  burst.userData.isBurst = true;

  return burst;
}

/**
 * Main collectibles system
 */
export function createCollectiblesSystem(THREE, scene, environmentId) {
  const config = RING_CONFIGS[environmentId] || RING_CONFIGS.mountain;
  const placements = generateRingPlacements(environmentId, 20);

  const container = new THREE.Group();
  container.name = 'collectibles';
  scene.add(container);

  const rings = [];
  const ringParticles = [];
  const burstParticles = [];

  // Create rings with particles
  placements.forEach((placement) => {
    const ringGroup = new THREE.Group();

    const ring = createRing(THREE, config);
    ringGroup.add(ring);

    const particles = createRingParticles(THREE, config);
    ringGroup.add(particles);

    ringGroup.position.set(...placement.position);
    ringGroup.rotation.set(...placement.rotation);
    ringGroup.scale.setScalar(placement.scale);

    // Add collision sphere for collection detection
    ringGroup.userData.collisionRadius = 1.5 * placement.scale;
    ringGroup.userData.index = rings.length;

    container.add(ringGroup);
    rings.push(ringGroup);
    ringParticles.push(particles);
  });

  // Animation state
  let animationTime = 0;

  return {
    rings,
    container,
    burstParticles,

    /**
     * Update ring animations
     */
    update(delta) {
      animationTime += delta;

      // Animate rings
      rings.forEach((ringGroup, index) => {
        if (ringGroup.userData.collected) return;

        const ring = ringGroup.children[0];
        const particles = ringGroup.children[1];

        // Gentle rotation
        ring.rotation.z += delta * 0.5;

        // Pulse glow
        const pulse = Math.sin(animationTime * 2 + index * 0.5) * 0.5 + 0.5;
        if (ring.userData.glow) {
          ring.userData.glow.material.opacity = 0.3 + pulse * 0.3;
        }

        // Animate particles in orbit
        if (particles.userData.baseAngles) {
          const positions = particles.geometry.attributes.position.array;
          const count = particles.userData.baseAngles.length;

          for (let i = 0; i < count; i++) {
            const baseAngle = particles.userData.baseAngles[i];
            const angle = baseAngle + animationTime * 0.8;
            const radius = 1.3 + Math.sin(animationTime * 3 + i * 0.5) * 0.15;
            const wobble = Math.sin(animationTime * 2 + i) * 0.1;

            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = Math.sin(angle) * radius;
            positions[i * 3 + 2] = wobble;
          }

          particles.geometry.attributes.position.needsUpdate = true;
        }
      });

      // Update burst particles
      for (let i = burstParticles.length - 1; i >= 0; i--) {
        const burst = burstParticles[i];
        burst.userData.life -= delta * 1.5;

        if (burst.userData.life <= 0) {
          container.remove(burst);
          burst.geometry.dispose();
          burst.material.dispose();
          burstParticles.splice(i, 1);
          continue;
        }

        // Update particles
        const positions = burst.geometry.attributes.position.array;
        const velocities = burst.userData.velocities;

        for (let j = 0; j < velocities.length; j++) {
          positions[j * 3] += velocities[j].x * delta;
          positions[j * 3 + 1] += velocities[j].y * delta;
          positions[j * 3 + 2] += velocities[j].z * delta;

          // Gravity
          velocities[j].y -= delta * 3;
        }

        burst.geometry.attributes.position.needsUpdate = true;
        burst.material.opacity = burst.userData.life;
      }
    },

    /**
     * Check for ring collection
     */
    checkCollection(position, radius = 1.0) {
      const collectedIndices = [];

      rings.forEach((ringGroup, index) => {
        if (ringGroup.userData.collected) return;

        const ringWorldPos = new THREE.Vector3();
        ringGroup.getWorldPosition(ringWorldPos);

        const distance = position.distanceTo(ringWorldPos);
        const collisionThreshold = ringGroup.userData.collisionRadius + radius;

        if (distance < collisionThreshold) {
          this.collectRing(index, ringWorldPos);
          collectedIndices.push(index);
        }
      });

      return collectedIndices;
    },

    /**
     * Collect a ring
     */
    collectRing(index, worldPosition) {
      const ringGroup = rings[index];
      if (ringGroup.userData.collected) return;

      ringGroup.userData.collected = true;

      // Create burst effect
      const burst = createCollectionBurst(THREE, config, worldPosition);
      container.add(burst);
      burstParticles.push(burst);

      // Animate ring out
      const ring = ringGroup.children[0];
      const startScale = ringGroup.scale.x;
      const startTime = animationTime;

      const animateOut = () => {
        const elapsed = animationTime - startTime;
        const t = Math.min(elapsed / 0.3, 1);

        if (t < 1) {
          ringGroup.scale.setScalar(startScale * (1 + t * 0.5));
          ring.userData.ring.material.opacity = ring.userData.baseOpacity * (1 - t);
          ring.userData.glow.material.opacity *= (1 - t * 0.5);

          requestAnimationFrame(animateOut);
        } else {
          ringGroup.visible = false;
        }
      };

      animateOut();
    },

    /**
     * Reset all rings
     */
    reset() {
      rings.forEach((ringGroup) => {
        ringGroup.visible = true;
        ringGroup.userData.collected = false;
        ringGroup.scale.setScalar(1);

        const ring = ringGroup.children[0];
        ring.userData.ring.material.opacity = ring.userData.baseOpacity;
        ring.userData.glow.material.opacity = 0.4;
      });

      // Clear bursts
      burstParticles.forEach((burst) => {
        container.remove(burst);
        burst.geometry.dispose();
        burst.material.dispose();
      });
      burstParticles.length = 0;
    },

    /**
     * Get collection stats
     */
    getStats() {
      const collected = rings.filter(r => r.userData.collected).length;
      const total = rings.length;
      return { collected, total };
    },

    /**
     * Dispose of resources
     */
    dispose() {
      rings.forEach((ringGroup) => {
        ringGroup.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      });

      burstParticles.forEach((burst) => {
        burst.geometry.dispose();
        burst.material.dispose();
      });

      scene.remove(container);
    },
  };
}
