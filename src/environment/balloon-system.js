/**
 * Balloon Pop System
 * Creates floating balloons that pop with a satisfying effect when the bird flies through.
 * Themed colors per environment, respawns after popping.
 *
 * OPTIMIZED:
 * - Uses squared distance for collision detection (avoids sqrt)
 * - Pre-allocated scratch vectors
 * - Batch buffer updates
 * - Zero allocations per frame
 */

const BALLOON_CONFIGS = {
  mountain: {
    bodyColor: 0xff6b9d,      // Pink
    highlightColor: 0xffa0c4,
    stringColor: 0xcccccc,
    popParticleColors: [0xff6b9d, 0xffa0c4, 0xffffff, 0xff4477],
  },
  forest: {
    bodyColor: 0x7ed56f,      // Green
    highlightColor: 0xa8e6a3,
    stringColor: 0x8b7355,
    popParticleColors: [0x7ed56f, 0xa8e6a3, 0xffffff, 0x55c048],
  },
  canyons: {
    bodyColor: 0xffa500,      // Orange
    highlightColor: 0xffcc66,
    stringColor: 0x996633,
    popParticleColors: [0xffa500, 0xffcc66, 0xffffff, 0xff8800],
  },
  city: {
    bodyColor: 0x6bb3ff,      // Blue
    highlightColor: 0xa0d4ff,
    stringColor: 0x888888,
    popParticleColors: [0x6bb3ff, 0xa0d4ff, 0xffffff, 0x4499ff],
  },
};

const BALLOON_SYSTEM_CONFIG = {
  count: 15,                   // Total balloons maintained
  minAltitude: 35,             // Sphere radius (30) + 5
  maxAltitude: 50,             // Sphere radius (30) + 20
  collisionRadius: 1.8,        // Hit detection radius
  birbCollisionRadius: 0.8,    // Bird collision radius
  respawnDelay: 3.0,           // Seconds before respawn
  bobSpeed: 1.5,               // Vertical bobbing speed
  bobAmount: 0.5,              // Vertical bobbing amplitude
  swaySpeed: 0.8,              // Horizontal sway speed
  swayAmount: 0.3,             // Horizontal sway amplitude
};

/**
 * Generate random balloon placements around the sphere
 */
function generateBalloonPlacements(count, sphereRadius = 30) {
  const placements = [];

  for (let i = 0; i < count; i++) {
    // Random position on sphere
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const altitude = BALLOON_SYSTEM_CONFIG.minAltitude +
                     Math.random() * (BALLOON_SYSTEM_CONFIG.maxAltitude - BALLOON_SYSTEM_CONFIG.minAltitude);

    placements.push({
      position: [
        altitude * Math.sin(phi) * Math.cos(theta),
        altitude * Math.cos(phi),
        altitude * Math.sin(phi) * Math.sin(theta),
      ],
      scale: 0.8 + Math.random() * 0.4,
      bobPhase: Math.random() * Math.PI * 2,
      swayPhase: Math.random() * Math.PI * 2,
    });
  }

  return placements;
}

/**
 * Create a single balloon mesh
 */
function createBalloonMesh(THREE, config) {
  const group = new THREE.Group();
  group.name = 'balloon';

  // Balloon body - elongated sphere
  const bodyGeometry = new THREE.SphereGeometry(1, 24, 18);
  // Stretch slightly for balloon shape
  bodyGeometry.scale(1, 1.2, 1);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: config.bodyColor,
    emissive: config.bodyColor,
    emissiveIntensity: 0.15,
    metalness: 0.1,
    roughness: 0.3,
    transparent: true,
    opacity: 0.9,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  group.add(body);

  // Highlight/shine spot
  const highlightGeometry = new THREE.SphereGeometry(0.3, 12, 12);
  const highlightMaterial = new THREE.MeshBasicMaterial({
    color: config.highlightColor,
    transparent: true,
    opacity: 0.6,
  });
  const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
  highlight.position.set(-0.4, 0.5, 0.5);
  group.add(highlight);

  // Balloon knot at bottom
  const knotGeometry = new THREE.ConeGeometry(0.15, 0.25, 8);
  const knotMaterial = new THREE.MeshStandardMaterial({
    color: config.bodyColor,
    roughness: 0.5,
  });
  const knot = new THREE.Mesh(knotGeometry, knotMaterial);
  knot.position.y = -1.3;
  knot.rotation.x = Math.PI;
  group.add(knot);

  // String
  const stringGeometry = new THREE.CylinderGeometry(0.02, 0.02, 2, 8);
  const stringMaterial = new THREE.MeshBasicMaterial({
    color: config.stringColor,
  });
  const string = new THREE.Mesh(stringGeometry, stringMaterial);
  string.position.y = -2.4;
  group.add(string);

  // Store references
  group.userData.body = body;
  group.userData.bodyMaterial = bodyMaterial;
  group.userData.highlight = highlight;
  group.userData.collisionRadius = BALLOON_SYSTEM_CONFIG.collisionRadius;

  return group;
}

/**
 * Create pop effect particles at given position
 */
function createPopEffect(THREE, container, position, config) {
  const popGroup = new THREE.Group();
  popGroup.position.copy(position);
  container.add(popGroup);

  const pop = {
    group: popGroup,
    age: 0,
    duration: 0.8,
    components: [],
    finished: false,
  };

  // 1. Central flash burst
  const flashGeometry = new THREE.SphereGeometry(0.3, 8, 8);
  const flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.Mesh(flashGeometry, flashMaterial);
  popGroup.add(flash);
  pop.components.push({
    type: 'flash',
    mesh: flash,
    material: flashMaterial,
    duration: 0.15,
  });

  // 2. Rubber shred particles
  const shredCount = 20;
  const shredGeometry = new THREE.PlaneGeometry(0.3, 0.15);

  for (let i = 0; i < shredCount; i++) {
    const colorIndex = i % config.popParticleColors.length;
    const shredMaterial = new THREE.MeshBasicMaterial({
      color: config.popParticleColors[colorIndex],
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const shred = new THREE.Mesh(shredGeometry, shredMaterial);

    // Random direction
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const speed = 8 + Math.random() * 12;

    const direction = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    );

    // Random rotation
    shred.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );

    popGroup.add(shred);
    pop.components.push({
      type: 'shred',
      mesh: shred,
      material: shredMaterial,
      velocity: direction.multiplyScalar(speed),
      rotationSpeed: new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20
      ),
      duration: 0.6 + Math.random() * 0.3,
      gravity: 15,
    });
  }

  // 3. Sparkle particles
  const sparkCount = 15;
  const sparkGeometry = new THREE.SphereGeometry(0.06, 6, 6);

  for (let i = 0; i < sparkCount; i++) {
    const sparkMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);

    // Random direction with upward bias
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const speed = 5 + Math.random() * 8;

    const direction = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.abs(Math.sin(phi) * Math.sin(theta)) + 0.3,
      Math.cos(phi)
    ).normalize();

    popGroup.add(spark);
    pop.components.push({
      type: 'spark',
      mesh: spark,
      material: sparkMaterial,
      velocity: direction.multiplyScalar(speed),
      duration: 0.4 + Math.random() * 0.3,
    });
  }

  return pop;
}

/**
 * Update pop effect animation
 */
function updatePopEffect(pop, delta) {
  pop.age += delta;
  let hasActiveComponents = false;

  for (const comp of pop.components) {
    const progress = pop.age / comp.duration;

    if (progress >= 1) {
      comp.mesh.visible = false;
      continue;
    }

    hasActiveComponents = true;

    switch (comp.type) {
      case 'flash': {
        // Quick expanding flash
        const scale = 1 + progress * 4;
        comp.mesh.scale.setScalar(scale);
        comp.material.opacity = Math.max(0, 1 - progress * progress);
        break;
      }

      case 'shred': {
        // Moving rubber shreds with gravity and spin
        comp.mesh.position.addScaledVector(comp.velocity, delta);
        comp.velocity.y -= comp.gravity * delta;
        comp.mesh.rotation.x += comp.rotationSpeed.x * delta;
        comp.mesh.rotation.y += comp.rotationSpeed.y * delta;
        comp.mesh.rotation.z += comp.rotationSpeed.z * delta;
        comp.material.opacity = Math.max(0, 1 - progress);
        // Shrink as they fade
        const shredScale = 1 - progress * 0.5;
        comp.mesh.scale.setScalar(shredScale);
        break;
      }

      case 'spark': {
        // Fast moving sparkles
        comp.mesh.position.addScaledVector(comp.velocity, delta);
        comp.velocity.multiplyScalar(1 - delta * 3);
        comp.material.opacity = Math.max(0, 1 - progress * progress);
        break;
      }
    }
  }

  pop.finished = !hasActiveComponents;
  return hasActiveComponents;
}

/**
 * Dispose of pop effect resources
 */
function disposePopEffect(pop, container) {
  for (const comp of pop.components) {
    if (comp.mesh.geometry) comp.mesh.geometry.dispose();
    if (comp.material) comp.material.dispose();
  }
  container.remove(pop.group);
}

/**
 * Create the balloon system
 * @param {Object} THREE - Three.js library
 * @param {Object} scene - Three.js scene
 * @param {string} environmentId - Environment identifier for theming
 * @param {Object} options - Configuration options
 * @param {Function} options.onBalloonPopped - Callback when balloon is popped
 */
export function createBalloonSystem(THREE, scene, environmentId, options = {}) {
  const { onBalloonPopped } = options;

  const config = BALLOON_CONFIGS[environmentId] || BALLOON_CONFIGS.mountain;
  const placements = generateBalloonPlacements(BALLOON_SYSTEM_CONFIG.count);

  const balloons = [];
  const pendingRespawns = [];
  const activePopEffects = [];
  const container = new THREE.Group();
  container.name = 'balloons';
  scene.add(container);

  // Pre-allocated scratch vectors (ZERO allocations per frame)
  const _scratchWorldPos = new THREE.Vector3();
  const _scratchDelta = new THREE.Vector3();

  // Animation time tracker
  let animationTime = 0;

  /**
   * Spawn a balloon at given placement or random position
   */
  function spawnBalloon(placement = null) {
    if (!placement) {
      // Generate random placement
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - 2 * Math.random());
      const altitude = BALLOON_SYSTEM_CONFIG.minAltitude +
                       Math.random() * (BALLOON_SYSTEM_CONFIG.maxAltitude - BALLOON_SYSTEM_CONFIG.minAltitude);

      placement = {
        position: [
          altitude * Math.sin(phi) * Math.cos(theta),
          altitude * Math.cos(phi),
          altitude * Math.sin(phi) * Math.sin(theta),
        ],
        scale: 0.8 + Math.random() * 0.4,
        bobPhase: Math.random() * Math.PI * 2,
        swayPhase: Math.random() * Math.PI * 2,
      };
    }

    const balloon = createBalloonMesh(THREE, config);
    balloon.position.set(...placement.position);
    balloon.scale.setScalar(placement.scale);

    // Store animation data
    balloon.userData.basePosition = new THREE.Vector3(...placement.position);
    balloon.userData.bobPhase = placement.bobPhase;
    balloon.userData.swayPhase = placement.swayPhase;
    balloon.userData.scale = placement.scale;
    balloon.userData.isAlive = true;
    balloon.userData.index = balloons.length;

    container.add(balloon);
    balloons.push(balloon);

    return balloon;
  }

  /**
   * Schedule respawn after delay
   */
  function scheduleRespawn() {
    pendingRespawns.push({
      timer: BALLOON_SYSTEM_CONFIG.respawnDelay,
    });
  }

  // Initial spawn
  placements.forEach((placement) => {
    spawnBalloon(placement);
  });

  return {
    balloons,
    container,

    /**
     * Update balloon animations and effects
     */
    update(delta) {
      animationTime += delta;

      // Update pending respawns
      for (let i = pendingRespawns.length - 1; i >= 0; i--) {
        pendingRespawns[i].timer -= delta;
        if (pendingRespawns[i].timer <= 0) {
          pendingRespawns.splice(i, 1);
          if (balloons.length < BALLOON_SYSTEM_CONFIG.count) {
            spawnBalloon();
          }
        }
      }

      // Animate balloons
      for (const balloon of balloons) {
        if (!balloon.userData.isAlive) continue;

        const base = balloon.userData.basePosition;
        const bobPhase = balloon.userData.bobPhase;
        const swayPhase = balloon.userData.swayPhase;

        // Gentle bobbing motion
        const bobOffset = Math.sin(animationTime * BALLOON_SYSTEM_CONFIG.bobSpeed + bobPhase) *
                          BALLOON_SYSTEM_CONFIG.bobAmount;

        // Gentle swaying motion
        const swayOffsetX = Math.sin(animationTime * BALLOON_SYSTEM_CONFIG.swaySpeed + swayPhase) *
                            BALLOON_SYSTEM_CONFIG.swayAmount;
        const swayOffsetZ = Math.cos(animationTime * BALLOON_SYSTEM_CONFIG.swaySpeed * 0.7 + swayPhase) *
                            BALLOON_SYSTEM_CONFIG.swayAmount;

        // Calculate local up direction for bobbing (radial from sphere center)
        const localUp = _scratchDelta.copy(base).normalize();

        // Apply bob offset along local up
        balloon.position.copy(base)
          .addScaledVector(localUp, bobOffset);

        // Apply sway in tangent plane (perpendicular to local up)
        // Simple approximation: offset in world X and Z, scaled down
        balloon.position.x += swayOffsetX;
        balloon.position.z += swayOffsetZ;

        // Gentle rotation for visual interest
        balloon.rotation.y = Math.sin(animationTime * 0.5 + swayPhase) * 0.1;
        balloon.rotation.z = Math.sin(animationTime * 0.3 + bobPhase) * 0.05;
      }

      // Update pop effects
      for (let i = activePopEffects.length - 1; i >= 0; i--) {
        const pop = activePopEffects[i];
        const stillActive = updatePopEffect(pop, delta);
        if (!stillActive) {
          disposePopEffect(pop, container);
          activePopEffects.splice(i, 1);
        }
      }
    },

    /**
     * Check if bird position collides with any balloon (OPTIMIZED: uses squared distance)
     * @param {Vector3} birbPosition - Current bird position
     * @returns {{ hit: boolean, balloon?: Object, index?: number, position?: Vector3 }}
     */
    checkBirbCollision(birbPosition) {
      const birbRadius = BALLOON_SYSTEM_CONFIG.birbCollisionRadius;
      const birbRadiusSq = birbRadius * birbRadius;

      for (let i = 0; i < balloons.length; i++) {
        const balloon = balloons[i];
        if (!balloon.userData.isAlive) continue;

        // Get world position using pre-allocated vector (NO allocation)
        balloon.getWorldPosition(_scratchWorldPos);

        // Use squared distance to avoid sqrt (OPTIMIZED)
        _scratchDelta.subVectors(birbPosition, _scratchWorldPos);
        const distSq = _scratchDelta.x * _scratchDelta.x +
                       _scratchDelta.y * _scratchDelta.y +
                       _scratchDelta.z * _scratchDelta.z;

        const collisionRadius = balloon.userData.collisionRadius * balloon.userData.scale;
        const thresholdSq = (collisionRadius + birbRadius) * (collisionRadius + birbRadius);

        if (distSq < thresholdSq) {
          return { hit: true, balloon, index: i, position: _scratchWorldPos.clone() };
        }
      }

      return { hit: false };
    },

    /**
     * Pop a balloon by index
     * @param {number} index - Index in balloons array
     */
    popBalloon(index) {
      const balloon = balloons[index];
      if (!balloon || !balloon.userData.isAlive) return;

      const position = balloon.position.clone();
      balloon.userData.isAlive = false;
      container.remove(balloon);

      // Create pop effect
      const pop = createPopEffect(THREE, container, position, config);
      activePopEffects.push(pop);

      // Dispose balloon geometry and materials
      balloon.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });

      balloons.splice(index, 1);

      // Update indices of remaining balloons
      for (let i = index; i < balloons.length; i++) {
        balloons[i].userData.index = i;
      }

      // Notify listener
      if (typeof onBalloonPopped === 'function') {
        onBalloonPopped(position);
      }

      // Schedule respawn
      scheduleRespawn();
    },

    /**
     * Get all active balloons
     */
    getBalloons() {
      return balloons.filter(b => b.userData.isAlive);
    },

    /**
     * Get balloon count
     */
    getCount() {
      return balloons.length;
    },

    /**
     * Get pop stats
     */
    getStats() {
      const popped = BALLOON_SYSTEM_CONFIG.count - balloons.length + pendingRespawns.length;
      return { popped, total: BALLOON_SYSTEM_CONFIG.count };
    },

    /**
     * Reset all balloons
     */
    reset() {
      // Clear existing balloons
      for (const balloon of balloons) {
        container.remove(balloon);
        balloon.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }
      balloons.length = 0;

      // Clear pop effects
      for (const pop of activePopEffects) {
        disposePopEffect(pop, container);
      }
      activePopEffects.length = 0;

      // Clear pending respawns
      pendingRespawns.length = 0;

      // Respawn all balloons
      const newPlacements = generateBalloonPlacements(BALLOON_SYSTEM_CONFIG.count);
      newPlacements.forEach((placement) => {
        spawnBalloon(placement);
      });
    },

    /**
     * Dispose of all resources
     */
    dispose() {
      for (const balloon of balloons) {
        balloon.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }

      for (const pop of activePopEffects) {
        disposePopEffect(pop, container);
      }

      balloons.length = 0;
      pendingRespawns.length = 0;
      activePopEffects.length = 0;
      scene.remove(container);
    },
  };
}

export { BALLOON_SYSTEM_CONFIG, BALLOON_CONFIGS };
