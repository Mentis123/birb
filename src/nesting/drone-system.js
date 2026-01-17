/**
 * Drone Target System
 * Spawns and manages flying drone targets around the sphere for turret practice.
 * Drones orbit at nest altitude and can be shot with rockets or collided with by birb.
 */

// Explosion configuration
const EXPLOSION_CONFIG = {
  // Core flash
  flashDuration: 0.15,
  flashMaxScale: 4.0,

  // Shockwave ring
  ringDuration: 0.4,
  ringMaxScale: 8.0,

  // Debris shards
  shardCount: 12,
  shardSpeed: 15,
  shardSpeedVariance: 0.5,
  shardDuration: 0.8,
  shardGravity: 25,

  // Spark particles
  sparkCount: 30,
  sparkSpeed: 20,
  sparkSpeedVariance: 0.6,
  sparkDuration: 0.6,

  // Ember particles (slower, lingering)
  emberCount: 15,
  emberSpeed: 5,
  emberDuration: 1.2,
};

const DRONE_CONFIG = {
  count: 8,                    // Total drones maintained in world
  minAltitude: 35,             // Sphere radius (30) + 5
  maxAltitude: 45,             // Sphere radius (30) + 15
  orbitSpeed: 0.15,            // Base radians per second (half speed)
  orbitSpeedVariance: 0.4,     // Speed varies ±40%
  respawnDelay: 2.0,           // Seconds before respawn after destruction
  collisionRadius: 3.0,        // Hit detection radius (doubled for larger drones)
  birbCollisionRadius: 0.8,    // Birb collision radius
};

/**
 * Create a single drone mesh with visual components
 */
function createDroneMesh(THREE) {
  const group = new THREE.Group();
  group.name = 'drone';

  // Main body - glowing octahedron (diamond shape)
  const bodyGeometry = new THREE.OctahedronGeometry(1.6, 0);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xff3366,
    emissive: 0xff2255,
    emissiveIntensity: 0.8,
    metalness: 0.6,
    roughness: 0.3,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  group.add(body);

  // Spinning ring around the body
  const ringGeometry = new THREE.TorusGeometry(2.4, 0.16, 8, 24);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6699,
    transparent: true,
    opacity: 0.7,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Store references for animation
  group.userData.body = body;
  group.userData.ring = ring;
  group.userData.bodyMaterial = bodyMaterial;
  group.userData.collisionRadius = DRONE_CONFIG.collisionRadius;

  return group;
}

/**
 * Create explosion effect components at given position
 * Returns an object containing all explosion elements that need to be updated
 */
function createDroneExplosion(THREE, container, position) {
  const explosionGroup = new THREE.Group();
  explosionGroup.position.copy(position);
  container.add(explosionGroup);

  const explosion = {
    group: explosionGroup,
    age: 0,
    components: [],
    finished: false,
  };

  // 1. Core flash - bright center burst
  const flashGeometry = new THREE.SphereGeometry(0.5, 12, 10);
  const flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.Mesh(flashGeometry, flashMaterial);
  explosionGroup.add(flash);
  explosion.components.push({
    type: 'flash',
    mesh: flash,
    material: flashMaterial,
    duration: EXPLOSION_CONFIG.flashDuration,
    maxScale: EXPLOSION_CONFIG.flashMaxScale,
  });

  // 2. Shockwave ring
  const ringGeometry = new THREE.RingGeometry(0.8, 1.2, 32);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6699,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  // Orient ring to face outward from center of sphere
  ring.lookAt(position.clone().normalize().multiplyScalar(100));
  explosionGroup.add(ring);
  explosion.components.push({
    type: 'ring',
    mesh: ring,
    material: ringMaterial,
    duration: EXPLOSION_CONFIG.ringDuration,
    maxScale: EXPLOSION_CONFIG.ringMaxScale,
  });

  // 3. Secondary ring (perpendicular)
  const ring2 = ring.clone();
  ring2.material = ringMaterial.clone();
  ring2.rotation.x += Math.PI / 2;
  explosionGroup.add(ring2);
  explosion.components.push({
    type: 'ring',
    mesh: ring2,
    material: ring2.material,
    duration: EXPLOSION_CONFIG.ringDuration * 0.9,
    maxScale: EXPLOSION_CONFIG.ringMaxScale * 0.8,
  });

  // 4. Debris shards - small octahedron pieces flying outward
  const shardGeometry = new THREE.OctahedronGeometry(0.3, 0);
  for (let i = 0; i < EXPLOSION_CONFIG.shardCount; i++) {
    const shardMaterial = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? 0xff3366 : 0xff6699,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shard = new THREE.Mesh(shardGeometry, shardMaterial);

    // Random direction (sphere distribution)
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const direction = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    );

    const speed = EXPLOSION_CONFIG.shardSpeed *
      (1 - EXPLOSION_CONFIG.shardSpeedVariance / 2 + Math.random() * EXPLOSION_CONFIG.shardSpeedVariance);

    // Random rotation axis and speed
    const rotationAxis = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();

    explosionGroup.add(shard);
    explosion.components.push({
      type: 'shard',
      mesh: shard,
      material: shardMaterial,
      velocity: direction.multiplyScalar(speed),
      rotationAxis,
      rotationSpeed: 10 + Math.random() * 20,
      duration: EXPLOSION_CONFIG.shardDuration * (0.7 + Math.random() * 0.3),
      gravity: EXPLOSION_CONFIG.shardGravity,
    });
  }

  // 5. Spark particles - small bright dots
  const sparkGeometry = new THREE.SphereGeometry(0.08, 6, 6);
  for (let i = 0; i < EXPLOSION_CONFIG.sparkCount; i++) {
    const sparkMaterial = new THREE.MeshBasicMaterial({
      color: i % 3 === 0 ? 0xffff88 : (i % 3 === 1 ? 0xff8844 : 0xff4466),
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);

    // Random direction
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const direction = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    );

    const speed = EXPLOSION_CONFIG.sparkSpeed *
      (1 - EXPLOSION_CONFIG.sparkSpeedVariance / 2 + Math.random() * EXPLOSION_CONFIG.sparkSpeedVariance);

    explosionGroup.add(spark);
    explosion.components.push({
      type: 'spark',
      mesh: spark,
      material: sparkMaterial,
      velocity: direction.multiplyScalar(speed),
      duration: EXPLOSION_CONFIG.sparkDuration * (0.5 + Math.random() * 0.5),
    });
  }

  // 6. Ember particles - slower glowing particles that linger
  const emberGeometry = new THREE.SphereGeometry(0.12, 6, 6);
  for (let i = 0; i < EXPLOSION_CONFIG.emberCount; i++) {
    const emberMaterial = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? 0xff2244 : 0xff4466,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ember = new THREE.Mesh(emberGeometry, emberMaterial);

    // Random direction with slight upward bias
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const direction = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta) + 0.3,
      Math.cos(phi)
    ).normalize();

    const speed = EXPLOSION_CONFIG.emberSpeed * (0.5 + Math.random());

    explosionGroup.add(ember);
    explosion.components.push({
      type: 'ember',
      mesh: ember,
      material: emberMaterial,
      velocity: direction.multiplyScalar(speed),
      duration: EXPLOSION_CONFIG.emberDuration * (0.7 + Math.random() * 0.3),
      pulsePhase: Math.random() * Math.PI * 2,
    });
  }

  return explosion;
}

/**
 * Update a drone explosion animation
 * Returns true if explosion is still active, false if finished
 */
function updateDroneExplosion(explosion, delta) {
  explosion.age += delta;
  let hasActiveComponents = false;

  for (const comp of explosion.components) {
    const progress = explosion.age / comp.duration;

    if (progress >= 1) {
      // Hide finished components
      comp.mesh.visible = false;
      continue;
    }

    hasActiveComponents = true;

    switch (comp.type) {
      case 'flash': {
        // Quick bright flash that expands and fades
        const scale = 1 + progress * (comp.maxScale - 1);
        comp.mesh.scale.setScalar(scale);
        // Fast fade out
        comp.material.opacity = Math.max(0, 1 - progress * progress);
        break;
      }

      case 'ring': {
        // Expanding ring that fades
        const scale = 1 + progress * (comp.maxScale - 1);
        comp.mesh.scale.setScalar(scale);
        // Fade out with easing
        comp.material.opacity = Math.max(0, 0.9 * (1 - progress * progress));
        break;
      }

      case 'shard': {
        // Move shard outward with gravity
        comp.mesh.position.addScaledVector(comp.velocity, delta);
        // Apply gravity (toward sphere center approximated as down from explosion point)
        comp.velocity.y -= comp.gravity * delta;
        // Spin the shard
        comp.mesh.rotateOnAxis(comp.rotationAxis, comp.rotationSpeed * delta);
        // Fade out
        comp.material.opacity = Math.max(0, 1 - progress);
        // Shrink slightly as it fades
        const shardScale = 1 - progress * 0.5;
        comp.mesh.scale.setScalar(shardScale);
        break;
      }

      case 'spark': {
        // Fast moving bright spark
        comp.mesh.position.addScaledVector(comp.velocity, delta);
        // Slow down over time
        comp.velocity.multiplyScalar(1 - delta * 2);
        // Fade out with easing
        comp.material.opacity = Math.max(0, 1 - progress * progress);
        break;
      }

      case 'ember': {
        // Slower glowing ember with pulse
        comp.mesh.position.addScaledVector(comp.velocity, delta);
        // Slow down
        comp.velocity.multiplyScalar(1 - delta);
        // Pulse glow
        comp.pulsePhase += delta * 15;
        const pulse = 0.5 + Math.sin(comp.pulsePhase) * 0.3;
        // Fade out gradually
        comp.material.opacity = Math.max(0, pulse * (1 - progress));
        break;
      }
    }
  }

  explosion.finished = !hasActiveComponents;
  return hasActiveComponents;
}

/**
 * Dispose of explosion resources
 */
function disposeExplosion(explosion, container) {
  for (const comp of explosion.components) {
    if (comp.mesh.geometry) comp.mesh.geometry.dispose();
    if (comp.material) comp.material.dispose();
  }
  container.remove(explosion.group);
}

/**
 * Create the drone system
 * @param {Object} THREE - Three.js library
 * @param {Object} scene - Three.js scene
 * @param {Object} options - Configuration options
 * @param {Function} options.onDroneDestroyed - Callback when drone is destroyed (receives position)
 * @param {number} options.sphereRadius - Radius of the world sphere (default 30)
 */
export function createDroneSystem(THREE, scene, options = {}) {
  const { onDroneDestroyed, sphereRadius = 30 } = options;

  const drones = [];
  const pendingRespawns = [];
  const activeExplosions = [];
  const container = new THREE.Group();
  container.name = 'drone-targets';
  scene.add(container);

  // Temp vectors for calculations
  const _tempVec = new THREE.Vector3();
  const _tempVec2 = new THREE.Vector3();

  /**
   * Spawn a drone at a random position on the sphere
   */
  function spawnDrone() {
    const drone = createDroneMesh(THREE);

    // Random position on sphere at drone altitude
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const altitude = DRONE_CONFIG.minAltitude +
                     Math.random() * (DRONE_CONFIG.maxAltitude - DRONE_CONFIG.minAltitude);

    drone.position.set(
      altitude * Math.sin(phi) * Math.cos(theta),
      altitude * Math.cos(phi),
      altitude * Math.sin(phi) * Math.sin(theta)
    );

    // Random orbit axis (perpendicular to radial direction)
    const radial = drone.position.clone().normalize();
    const randomVec = _tempVec.set(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();
    const orbitAxis = _tempVec2.crossVectors(radial, randomVec).normalize();

    // If cross product is zero (very unlikely), use a default
    if (orbitAxis.lengthSq() < 0.01) {
      orbitAxis.set(0, 1, 0);
    }

    // Store drone data
    drone.userData.orbitAxis = orbitAxis.clone();
    drone.userData.orbitSpeed = DRONE_CONFIG.orbitSpeed *
      (1 - DRONE_CONFIG.orbitSpeedVariance / 2 + Math.random() * DRONE_CONFIG.orbitSpeedVariance);
    drone.userData.baseAltitude = altitude;
    drone.userData.isAlive = true;
    drone.userData.spinPhase = Math.random() * Math.PI * 2;

    container.add(drone);
    drones.push(drone);

    return drone;
  }

  /**
   * Schedule a respawn after delay
   */
  function scheduleRespawn() {
    pendingRespawns.push({
      timer: DRONE_CONFIG.respawnDelay
    });
  }

  // Initial spawn
  for (let i = 0; i < DRONE_CONFIG.count; i++) {
    spawnDrone();
  }

  return {
    /**
     * Update all drones (call each frame)
     */
    update(delta) {
      // Update pending respawns
      for (let i = pendingRespawns.length - 1; i >= 0; i--) {
        pendingRespawns[i].timer -= delta;
        if (pendingRespawns[i].timer <= 0) {
          pendingRespawns.splice(i, 1);
          if (drones.length < DRONE_CONFIG.count) {
            spawnDrone();
          }
        }
      }

      // Update active drones
      for (const drone of drones) {
        if (!drone.userData.isAlive) continue;

        // Orbit movement - rotate position around orbit axis
        const axis = drone.userData.orbitAxis;
        const angle = drone.userData.orbitSpeed * delta;
        drone.position.applyAxisAngle(axis, angle);

        // Maintain altitude (slight bobbing effect)
        const currentAltitude = drone.position.length();
        const targetAltitude = drone.userData.baseAltitude;
        if (Math.abs(currentAltitude - targetAltitude) > 0.5) {
          drone.position.normalize().multiplyScalar(targetAltitude);
        }

        // Spin the ring
        if (drone.userData.ring) {
          drone.userData.spinPhase += delta * 3;
          drone.userData.ring.rotation.z = drone.userData.spinPhase;
        }

        // Pulse the body emissive
        if (drone.userData.bodyMaterial) {
          const pulse = 0.6 + Math.sin(drone.userData.spinPhase * 2) * 0.4;
          drone.userData.bodyMaterial.emissiveIntensity = pulse;
        }

        // Orient drone to face direction of travel (tangent to orbit)
        const radial = _tempVec.copy(drone.position).normalize();
        const tangent = _tempVec2.crossVectors(drone.userData.orbitAxis, radial).normalize();
        if (tangent.lengthSq() > 0.01) {
          drone.lookAt(drone.position.x + tangent.x, drone.position.y + tangent.y, drone.position.z + tangent.z);
        }
      }

      // Update active explosions
      for (let i = activeExplosions.length - 1; i >= 0; i--) {
        const explosion = activeExplosions[i];
        const stillActive = updateDroneExplosion(explosion, delta);
        if (!stillActive) {
          disposeExplosion(explosion, container);
          activeExplosions.splice(i, 1);
        }
      }
    },

    /**
     * Check if a rocket position hits any drone
     * @param {Vector3} rocketPosition - Current rocket position
     * @returns {{ hit: boolean, drone?: Object, index?: number }}
     */
    checkRocketCollision(rocketPosition) {
      for (let i = 0; i < drones.length; i++) {
        const drone = drones[i];
        if (!drone.userData.isAlive) continue;

        const distance = drone.position.distanceTo(rocketPosition);
        if (distance < drone.userData.collisionRadius) {
          return { hit: true, drone, index: i };
        }
      }
      return { hit: false };
    },

    /**
     * Check if birb position collides with any drone
     * @param {Vector3} birbPosition - Current birb position
     * @returns {{ hit: boolean, drone?: Object, index?: number, position?: Vector3 }}
     */
    checkBirbCollision(birbPosition) {
      const birbRadius = DRONE_CONFIG.birbCollisionRadius;

      for (let i = 0; i < drones.length; i++) {
        const drone = drones[i];
        if (!drone.userData.isAlive) continue;

        const distance = drone.position.distanceTo(birbPosition);
        if (distance < drone.userData.collisionRadius + birbRadius) {
          return { hit: true, drone, index: i, position: drone.position.clone() };
        }
      }
      return { hit: false };
    },

    /**
     * Destroy a drone by index
     * @param {number} index - Index in drones array
     */
    destroyDrone(index) {
      const drone = drones[index];
      if (!drone) return;

      const position = drone.position.clone();
      drone.userData.isAlive = false;
      container.remove(drone);

      // Create awesome explosion effect at drone position
      const explosion = createDroneExplosion(THREE, container, position);
      activeExplosions.push(explosion);

      // Dispose geometry and materials
      drone.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });

      drones.splice(index, 1);

      // Notify listener
      if (typeof onDroneDestroyed === 'function') {
        onDroneDestroyed(position);
      }

      // Schedule respawn
      scheduleRespawn();
    },

    /**
     * Get all active drones
     */
    getDrones() {
      return drones.filter(d => d.userData.isAlive);
    },

    /**
     * Get drone count
     */
    getCount() {
      return drones.length;
    },

    /**
     * Get the container group (for adding to collision targets if needed)
     */
    getContainer() {
      return container;
    },

    /**
     * Dispose of all resources
     */
    dispose() {
      for (const drone of drones) {
        drone.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }
      // Dispose active explosions
      for (const explosion of activeExplosions) {
        disposeExplosion(explosion, container);
      }
      drones.length = 0;
      pendingRespawns.length = 0;
      activeExplosions.length = 0;
      scene.remove(container);
    },
  };
}

export { DRONE_CONFIG };
