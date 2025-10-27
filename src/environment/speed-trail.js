/**
 * Speed Trail Particle System
 * Creates dynamic particles behind the bird based on movement speed
 */

/**
 * Create speed trail particle system
 */
export function createSpeedTrail(THREE, environmentId) {
  const particleCount = 200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount * 3);
  const ages = new Float32Array(particleCount);
  const sizes = new Float32Array(particleCount);

  // Initialize particles at origin
  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
    velocities[i * 3] = 0;
    velocities[i * 3 + 1] = 0;
    velocities[i * 3 + 2] = 0;
    ages[i] = 1.0; // Start as "dead" particles
    sizes[i] = 0.05 + Math.random() * 0.1;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  // Color based on environment
  const colors = {
    mountain: 0xb8e8ff,
    forest: 0xa8ffcc,
    canyons: 0xffcc88,
    city: 0x88d4ff,
  };

  const trailColor = colors[environmentId] || colors.mountain;

  const material = new THREE.PointsMaterial({
    color: trailColor,
    size: 0.12,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const particles = new THREE.Points(geometry, material);

  // Trail state
  let emitIndex = 0;
  let lastPosition = new THREE.Vector3();
  let accumulatedDistance = 0;

  return {
    particles,

    /**
     * Update trail particles
     */
    update(delta, birbPosition, birbVelocity, speed) {
      const positions = geometry.attributes.position.array;
      const sizes = geometry.attributes.size.array;

      // Update existing particles
      for (let i = 0; i < particleCount; i++) {
        if (ages[i] >= 1.0) continue; // Skip dead particles

        // Age particles
        ages[i] += delta * 1.5;

        // Update positions with velocity
        positions[i * 3] += velocities[i * 3] * delta;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * delta;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;

        // Add gravity and drag
        velocities[i * 3 + 1] -= delta * 2;
        velocities[i * 3] *= 0.98;
        velocities[i * 3 + 2] *= 0.98;
      }

      // Emit new particles based on speed
      const emissionRate = Math.max(0, speed - 1) * 8; // Start emitting above minimum speed
      const distanceThreshold = 0.05 / Math.max(emissionRate, 1);

      accumulatedDistance += birbPosition.distanceTo(lastPosition);

      if (accumulatedDistance >= distanceThreshold && speed > 1) {
        const particlesToEmit = Math.min(3, Math.ceil(emissionRate * delta));

        for (let i = 0; i < particlesToEmit; i++) {
          // Respawn particle at bird position with spread
          const spread = 0.3;
          positions[emitIndex * 3] = birbPosition.x + (Math.random() - 0.5) * spread;
          positions[emitIndex * 3 + 1] = birbPosition.y + (Math.random() - 0.5) * spread;
          positions[emitIndex * 3 + 2] = birbPosition.z + (Math.random() - 0.5) * spread;

          // Initial velocity opposite to movement direction with some randomness
          const randomFactor = 0.3;
          velocities[emitIndex * 3] = -birbVelocity.x * 0.3 + (Math.random() - 0.5) * randomFactor;
          velocities[emitIndex * 3 + 1] = -birbVelocity.y * 0.2 + (Math.random() - 0.5) * randomFactor;
          velocities[emitIndex * 3 + 2] = -birbVelocity.z * 0.3 + (Math.random() - 0.5) * randomFactor;

          ages[emitIndex] = 0;
          sizes[emitIndex] = 0.08 + Math.random() * 0.08 + speed * 0.02;

          emitIndex = (emitIndex + 1) % particleCount;
        }

        accumulatedDistance = 0;
      }

      lastPosition.copy(birbPosition);

      // Update opacity based on particle age
      let visibleCount = 0;
      for (let i = 0; i < particleCount; i++) {
        if (ages[i] < 1.0) {
          visibleCount++;
        }
      }

      // Adjust material opacity based on speed
      const targetOpacity = Math.min(0.8, speed * 0.1);
      material.opacity += (targetOpacity - material.opacity) * delta * 5;

      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.size.needsUpdate = true;

      // Update geometry draw range to only render active particles
      geometry.setDrawRange(0, particleCount);
    },

    /**
     * Reset trail
     */
    reset() {
      for (let i = 0; i < particleCount; i++) {
        ages[i] = 1.0;
      }
      accumulatedDistance = 0;
      emitIndex = 0;
      geometry.attributes.position.needsUpdate = true;
    },

    /**
     * Set trail color for environment changes
     */
    setColor(environmentId) {
      const colors = {
        mountain: 0xb8e8ff,
        forest: 0xa8ffcc,
        canyons: 0xffcc88,
        city: 0x88d4ff,
      };
      material.color.setHex(colors[environmentId] || colors.mountain);
    },

    /**
     * Dispose of resources
     */
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Create wing tip vortices for added effect
 */
export function createWingVortices(THREE) {
  const vortexCount = 60;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(vortexCount * 3);
  const ages = new Float32Array(vortexCount);
  const sizes = new Float32Array(vortexCount);

  for (let i = 0; i < vortexCount; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
    ages[i] = 1.0;
    sizes[i] = 0.1;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.1,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);

  let emitIndex = 0;
  const wingOffset = 0.8; // Distance from center to wingtip

  return {
    particles,

    update(delta, birbPosition, birbQuaternion, speed) {
      if (speed < 3) return; // Only show vortices at higher speeds

      const positions = geometry.attributes.position.array;

      // Age particles
      for (let i = 0; i < vortexCount; i++) {
        if (ages[i] < 1.0) {
          ages[i] += delta * 2;

          // Particles drift slightly
          positions[i * 3 + 1] -= delta * 0.5;
        }
      }

      // Emit particles at wing tips
      if (Math.random() < delta * 30) {
        const rightWing = new THREE.Vector3(wingOffset, 0, 0);
        rightWing.applyQuaternion(birbQuaternion);
        rightWing.add(birbPosition);

        positions[emitIndex * 3] = rightWing.x;
        positions[emitIndex * 3 + 1] = rightWing.y;
        positions[emitIndex * 3 + 2] = rightWing.z;
        ages[emitIndex] = 0;
        sizes[emitIndex] = 0.06;

        emitIndex = (emitIndex + 1) % vortexCount;

        if (Math.random() > 0.5) {
          const leftWing = new THREE.Vector3(-wingOffset, 0, 0);
          leftWing.applyQuaternion(birbQuaternion);
          leftWing.add(birbPosition);

          positions[emitIndex * 3] = leftWing.x;
          positions[emitIndex * 3 + 1] = leftWing.y;
          positions[emitIndex * 3 + 2] = leftWing.z;
          ages[emitIndex] = 0;
          sizes[emitIndex] = 0.06;

          emitIndex = (emitIndex + 1) % vortexCount;
        }
      }

      geometry.attributes.position.needsUpdate = true;
    },

    reset() {
      for (let i = 0; i < vortexCount; i++) {
        ages[i] = 1.0;
      }
      emitIndex = 0;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
