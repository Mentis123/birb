/**
 * Rocket Projectile System
 * Fires rockets from the nest in the direction of the crosshair.
 */

// Rocket configuration
const ROCKET_SPEED = 25.0;
const ROCKET_GRAVITY = 5.0;
const ROCKET_LIFETIME = 8.0; // seconds
const ROCKET_COOLDOWN = 2.0; // seconds between shots

/**
 * Create a single rocket mesh
 */
function createRocketMesh(THREE) {
  const group = new THREE.Group();
  group.name = 'rocket';

  // Rocket body - elongated capsule
  const bodyGeometry = new THREE.CapsuleGeometry(0.08, 0.4, 8, 16);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xff4400,
    emissive: 0xff2200,
    emissiveIntensity: 0.8,
    metalness: 0.6,
    roughness: 0.3,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.rotation.x = Math.PI / 2; // Point forward
  group.add(body);

  // Nose cone
  const noseGeometry = new THREE.ConeGeometry(0.08, 0.2, 8);
  const noseMaterial = new THREE.MeshStandardMaterial({
    color: 0xffaa00,
    emissive: 0xff6600,
    emissiveIntensity: 0.6,
    metalness: 0.7,
    roughness: 0.2,
  });
  const nose = new THREE.Mesh(noseGeometry, noseMaterial);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.3;
  group.add(nose);

  // Exhaust glow
  const exhaustGeometry = new THREE.ConeGeometry(0.12, 0.3, 8);
  const exhaustMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff44,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const exhaust = new THREE.Mesh(exhaustGeometry, exhaustMaterial);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.z = 0.35;
  group.add(exhaust);

  // Store references
  group.userData.body = body;
  group.userData.exhaust = exhaust;
  group.userData.exhaustMaterial = exhaustMaterial;

  return group;
}

/**
 * Create trail particles for a rocket
 */
function createRocketTrail(THREE, count = 30) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const opacities = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
    opacities[i] = 0;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffaa44,
    size: 0.15,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const trail = new THREE.Points(geometry, material);
  trail.userData.positions = [];
  trail.userData.maxPositions = count;

  return trail;
}

/**
 * Main rocket system
 * @param {Object} THREE - Three.js library
 * @param {Object} scene - Three.js scene
 * @param {Object} [options] - Configuration options
 * @param {Function} [options.onExplosion] - Callback when a rocket explodes on impact
 */
export function createRocketSystem(THREE, scene, options = {}) {
  const { onExplosion } = options;

  const container = new THREE.Group();
  container.name = 'rockets';
  scene.add(container);

  const rockets = [];
  const explosions = [];
  let cooldownTimer = 0;
  let animationTime = 0;
  let collisionTargets = [];

  // Temporary vectors
  const _tempVec = new THREE.Vector3();
  const _tempQuat = new THREE.Quaternion();
  const _movementVec = new THREE.Vector3();
  const _rayDirection = new THREE.Vector3();
  const _raycaster = new THREE.Raycaster();

  const createExplosion = (position) => {
    // Notify listener about explosion
    if (typeof onExplosion === 'function') {
      onExplosion(position);
    }

    const explosionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const explosion = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 10),
      explosionMaterial,
    );

    explosion.position.copy(position);
    explosion.userData.lifetime = 0.6;
    explosion.userData.age = 0;
    explosion.userData.material = explosionMaterial;

    container.add(explosion);
    explosions.push(explosion);
  };

  return {
    /**
     * Check if rocket can be fired (cooldown elapsed)
     */
    canFire() {
      return cooldownTimer <= 0;
    },

    /**
     * Get remaining cooldown time
     */
    getCooldownRemaining() {
      return Math.max(0, cooldownTimer);
    },

    /**
     * Get cooldown progress (0 = ready, 1 = just fired)
     */
    getCooldownProgress() {
      return cooldownTimer / ROCKET_COOLDOWN;
    },

    /**
     * Fire a rocket from position in direction
     */
    fire(position, direction) {
      if (cooldownTimer > 0) {
        return false;
      }

      // Create rocket
      const rocket = createRocketMesh(THREE);
      rocket.position.copy(position);

      // Orient rocket to face direction
      const forward = _tempVec.set(0, 0, -1);
      _tempQuat.setFromUnitVectors(forward, direction.clone().normalize());
      rocket.quaternion.copy(_tempQuat);

      // Create trail
      const trail = createRocketTrail(THREE);
      trail.position.copy(position);

      // Store rocket data
      rocket.userData.velocity = direction.clone().normalize().multiplyScalar(ROCKET_SPEED);
      rocket.userData.lifetime = ROCKET_LIFETIME;
      rocket.userData.trail = trail;
      rocket.userData.trailIndex = 0;
      rocket.userData.previousPosition = position.clone();

      container.add(rocket);
      container.add(trail);
      rockets.push(rocket);

      // Start cooldown
      cooldownTimer = ROCKET_COOLDOWN;

      return true;
    },

    /**
     * Update all rockets
     */
    update(delta) {
      animationTime += delta;

      // Update cooldown
      if (cooldownTimer > 0) {
        cooldownTimer -= delta;
      }

      // Update rockets
      for (let i = rockets.length - 1; i >= 0; i--) {
        const rocket = rockets[i];
        rocket.userData.lifetime -= delta;

        if (rocket.userData.lifetime <= 0) {
          // Remove expired rocket
          this.removeRocket(i);
          continue;
        }

        const previousPosition = rocket.userData.previousPosition || rocket.position.clone();

        // Apply gravity
        rocket.userData.velocity.y -= ROCKET_GRAVITY * delta;

        // Update position
        rocket.position.addScaledVector(rocket.userData.velocity, delta);

        // Collision detection along travel path
        _movementVec.copy(rocket.position).sub(previousPosition);
        const distanceTraveled = _movementVec.length();
        if (distanceTraveled > 0 && collisionTargets.length > 0) {
          _rayDirection.copy(_movementVec).normalize();
          _raycaster.set(previousPosition, _rayDirection);
          _raycaster.far = distanceTraveled;

          const intersections = _raycaster.intersectObjects(collisionTargets, true);
          if (intersections.length > 0) {
            const hitPoint = intersections[0].point;
            createExplosion(hitPoint);
            this.removeRocket(i);
            continue;
          }
        }

        rocket.userData.previousPosition = rocket.position.clone();

        // Orient rocket to velocity direction
        const velocity = rocket.userData.velocity;
        if (velocity.lengthSq() > 0.01) {
          const forward = _tempVec.set(0, 0, -1);
          const direction = velocity.clone().normalize();
          _tempQuat.setFromUnitVectors(forward, direction);
          rocket.quaternion.slerp(_tempQuat, delta * 10);
        }

        // Animate exhaust
        const exhaustMat = rocket.userData.exhaustMaterial;
        if (exhaustMat) {
          exhaustMat.opacity = 0.6 + Math.sin(animationTime * 20) * 0.3;
        }

        // Update trail
        const trail = rocket.userData.trail;
        if (trail) {
          // Add current position to trail history
          trail.userData.positions.unshift(rocket.position.clone());
          if (trail.userData.positions.length > trail.userData.maxPositions) {
            trail.userData.positions.pop();
          }

          // Update trail geometry
          const positions = trail.geometry.attributes.position.array;
          for (let j = 0; j < trail.userData.maxPositions; j++) {
            if (j < trail.userData.positions.length) {
              const pos = trail.userData.positions[j];
              positions[j * 3] = pos.x;
              positions[j * 3 + 1] = pos.y;
              positions[j * 3 + 2] = pos.z;
            }
          }
          trail.geometry.attributes.position.needsUpdate = true;

          // Fade trail based on age
          const fadeProgress = 1 - (rocket.userData.lifetime / ROCKET_LIFETIME);
          trail.material.opacity = 0.7 * (1 - fadeProgress * 0.5);
        }
      }

      // Update explosions
      for (let i = explosions.length - 1; i >= 0; i--) {
        const explosion = explosions[i];
        explosion.userData.age += delta;
        const progress = explosion.userData.age / explosion.userData.lifetime;
        const material = explosion.userData.material;
        const scale = 1 + progress * 1.6;
        explosion.scale.setScalar(scale);
        if (material) {
          material.opacity = Math.max(0, 0.8 * (1 - progress));
        }

        if (explosion.userData.age >= explosion.userData.lifetime) {
          explosion.geometry.dispose();
          if (material) material.dispose();
          container.remove(explosion);
          explosions.splice(i, 1);
        }
      }
    },

    /**
     * Remove a rocket by index
     */
    removeRocket(index) {
      const rocket = rockets[index];
      if (!rocket) return;

      // Dispose trail
      const trail = rocket.userData.trail;
      if (trail) {
        trail.geometry.dispose();
        trail.material.dispose();
        container.remove(trail);
      }

      // Dispose rocket
      rocket.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      container.remove(rocket);

      rockets.splice(index, 1);
    },

    removeExplosion(index) {
      const explosion = explosions[index];
      if (!explosion) return;

      if (explosion.geometry) explosion.geometry.dispose();
      if (explosion.userData.material) explosion.userData.material.dispose();
      container.remove(explosion);
      explosions.splice(index, 1);
    },

    /**
     * Get active rocket count
     */
    getRocketCount() {
      return rockets.length;
    },

    /**
     * Provide objects to test for collisions against
     */
    setCollisionTargets(targets = []) {
      collisionTargets = (targets || []).filter(Boolean);
    },

    /**
     * Reset system (clear all rockets, reset cooldown)
     */
    reset() {
      while (rockets.length > 0) {
        this.removeRocket(0);
      }
      while (explosions.length > 0) {
        this.removeExplosion(0);
      }
      cooldownTimer = 0;
    },

    /**
     * Dispose of all resources
     */
    dispose() {
      this.reset();
      scene.remove(container);
    },
  };
}

export { ROCKET_COOLDOWN };
