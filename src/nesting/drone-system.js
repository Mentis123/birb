/**
 * Drone Target System
 * Spawns and manages flying drone targets around the sphere for turret practice.
 * Drones orbit at nest altitude and can be shot with rockets or collided with by birb.
 */

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
      drones.length = 0;
      pendingRespawns.length = 0;
      scene.remove(container);
    },
  };
}

export { DRONE_CONFIG };
