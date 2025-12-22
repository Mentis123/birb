/**
 * Nest Points System
 * Creates glowing red/orange nest markers at the tops of environment objects
 * (trees, buildings, rock spires) where the birb can land and enter nest mode.
 *
 * Nests are now placed ON actual environment objects, not floating in the air.
 */

// Nest configuration per environment
const NEST_CONFIGS = {
  forest: {
    color: 0xff4422,
    emissive: 0xff2200,
    emissiveIntensity: 1.2,
    glowColor: 0xff6644,
  },
  canyons: {
    color: 0xff5533,
    emissive: 0xff3311,
    emissiveIntensity: 1.0,
    glowColor: 0xff7755,
  },
  city: {
    color: 0xff3344,
    emissive: 0xff1122,
    emissiveIntensity: 1.4,
    glowColor: 0xff5566,
  },
  mountain: {
    color: 0xff4422,
    emissive: 0xff2200,
    emissiveIntensity: 1.1,
    glowColor: 0xff6644,
  },
};

// Detection range for "pretty close" proximity
export const NEST_PROXIMITY_RANGE = 5.0;
// Range at which nest starts glowing brighter
export const NEST_GLOW_RANGE = 8.0;

/**
 * Create a single nest marker with glow effect
 */
function createNestMarker(THREE, config) {
  const group = new THREE.Group();
  group.name = 'nest-marker';

  // Main nest platform - a soft glowing disc/bowl shape
  const nestGeometry = new THREE.CylinderGeometry(0.6, 0.4, 0.2, 16);
  const nestMaterial = new THREE.MeshStandardMaterial({
    color: config.color,
    emissive: config.emissive,
    emissiveIntensity: config.emissiveIntensity,
    metalness: 0.2,
    roughness: 0.4,
    transparent: true,
    opacity: 0.9,
  });
  const nest = new THREE.Mesh(nestGeometry, nestMaterial);
  group.add(nest);

  // Outer glow ring
  const glowGeometry = new THREE.TorusGeometry(0.7, 0.12, 12, 32);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: config.glowColor,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 0.1;
  group.add(glow);

  // Inner bright core
  const coreGeometry = new THREE.SphereGeometry(0.25, 16, 12);
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xffaa88,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.position.y = 0.15;
  group.add(core);

  // Vertical beam effect (visible from afar)
  const beamGeometry = new THREE.CylinderGeometry(0.08, 0.15, 3.0, 8);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: config.glowColor,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.position.y = 1.6;
  group.add(beam);

  // Store references for animation and interaction
  group.userData.nest = nest;
  group.userData.nestMaterial = nestMaterial;
  group.userData.glow = glow;
  group.userData.glowMaterial = glowMaterial;
  group.userData.core = core;
  group.userData.coreMaterial = coreMaterial;
  group.userData.beam = beam;
  group.userData.beamMaterial = beamMaterial;
  group.userData.baseEmissiveIntensity = config.emissiveIntensity;
  group.userData.baseGlowOpacity = 0.5;
  group.userData.baseCoreOpacity = 0.7;
  group.userData.isNest = true;
  group.userData.isActive = false; // True when birb is in range
  group.userData.isOccupied = false; // True when birb has landed here

  return group;
}

/**
 * Main nest points system
 * Now accepts nestable positions from the environment builder
 */
export function createNestPointsSystem(THREE, scene, environmentId, sphereRadius, nestablePositions = []) {
  const config = NEST_CONFIGS[environmentId] || NEST_CONFIGS.forest;
  const _hostBounds = new THREE.Box3();
  const _hostSize = new THREE.Vector3();
  const _normalAbs = new THREE.Vector3();

  const computeHostClearance = (hostObject, surfaceNormal) => {
    if (!hostObject || !surfaceNormal) return 0;

    hostObject.updateWorldMatrix(true, true);
    _hostBounds.setFromObject(hostObject);

    if (_hostBounds.isEmpty()) return 0;

    _hostBounds.getSize(_hostSize);
    _normalAbs.set(
      Math.abs(surfaceNormal.x),
      Math.abs(surfaceNormal.y),
      Math.abs(surfaceNormal.z)
    );

    // Project the bounds along the surface normal to approximate clearance
    return _hostSize.dot(_normalAbs);
  };

  const hideHostObject = (nestGroup) => {
    const hostObject = nestGroup?.userData?.hostObject;
    if (!hostObject) return;

    if (hostObject.userData.__nestOriginalVisibility === undefined) {
      hostObject.userData.__nestOriginalVisibility = hostObject.visible;
    }
    hostObject.visible = false;
  };

  const restoreHostObjectVisibility = (nestGroup) => {
    const hostObject = nestGroup?.userData?.hostObject;
    if (!hostObject) return;

    if (hostObject.userData.__nestOriginalVisibility !== undefined) {
      hostObject.visible = hostObject.userData.__nestOriginalVisibility;
      delete hostObject.userData.__nestOriginalVisibility;
    }
  };

  const container = new THREE.Group();
  container.name = 'nest-points';
  scene.add(container);

  const nests = [];
  let animationTime = 0;
  let currentlyOccupiedNest = null;

  // Create nest markers at the positions provided by the environment
  nestablePositions.forEach((placement, index) => {
    const nestGroup = createNestMarker(THREE, config);

    // Position nest at the environment object's top
    nestGroup.position.copy(placement.position);

    // Orient nest to face outward from sphere center (surface normal)
    const up = placement.surfaceNormal.clone().normalize();
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);
    nestGroup.quaternion.copy(quaternion);

    // Store metadata
    nestGroup.userData.index = index;
    nestGroup.userData.landingPosition = nestGroup.position.clone();
    nestGroup.userData.landingQuaternion = nestGroup.quaternion.clone();
    nestGroup.userData.surfaceNormal = up.clone();
    nestGroup.userData.hostObject = placement.hostObject;
    nestGroup.userData.hostClearance = computeHostClearance(placement.hostObject, up);

    container.add(nestGroup);
    nests.push(nestGroup);
  });

  return {
    nests,
    container,
    config,

    /**
     * Update nest animations and proximity effects
     */
    update(delta, birbPosition) {
      animationTime += delta;

      nests.forEach((nestGroup, index) => {
        if (!nestGroup.visible) return;

        const distance = birbPosition.distanceTo(nestGroup.position);
        const isInRange = distance < NEST_PROXIMITY_RANGE;
        const isGlowing = distance < NEST_GLOW_RANGE;

        nestGroup.userData.isActive = isInRange;
        nestGroup.userData.distance = distance;

        // Calculate intensity multiplier based on proximity
        let intensityMultiplier = 1.0;
        if (isGlowing) {
          // Smoothly increase glow as birb gets closer
          const t = 1 - (distance / NEST_GLOW_RANGE);
          intensityMultiplier = 1.0 + t * 2.0; // Up to 3x when very close
        }

        // Pulse animation
        const pulse = Math.sin(animationTime * 3 + index * 0.7) * 0.5 + 0.5;
        const activePulse = isInRange ? (Math.sin(animationTime * 6) * 0.3 + 0.7) : 1.0;

        // Update materials
        const { nestMaterial, glowMaterial, coreMaterial, beamMaterial } = nestGroup.userData;
        const baseEmissive = nestGroup.userData.baseEmissiveIntensity;

        // Emissive intensity with pulse and proximity boost
        nestMaterial.emissiveIntensity = baseEmissive * (0.8 + pulse * 0.4) * intensityMultiplier * activePulse;

        // Glow ring opacity
        glowMaterial.opacity = nestGroup.userData.baseGlowOpacity * (0.6 + pulse * 0.4) * intensityMultiplier;

        // Core glow
        coreMaterial.opacity = nestGroup.userData.baseCoreOpacity * (0.5 + pulse * 0.5) * intensityMultiplier * activePulse;

        // Beam visibility increases when close
        beamMaterial.opacity = 0.15 + (isGlowing ? 0.25 * intensityMultiplier : 0) + pulse * 0.1;

        // Slight bobbing animation for the core
        const core = nestGroup.userData.core;
        if (core) {
          core.position.y = 0.15 + Math.sin(animationTime * 2 + index) * 0.05;
        }

        // Rotate glow ring slowly
        const glow = nestGroup.userData.glow;
        if (glow) {
          glow.rotation.z = animationTime * 0.5 + index;
        }
      });
    },

    /**
     * Find the nearest active (in-range) nest
     */
    getNearestActiveNest(birbPosition) {
      let nearest = null;
      let nearestDistance = Infinity;

      nests.forEach((nestGroup) => {
        if (!nestGroup.visible) return;

        const distance = birbPosition.distanceTo(nestGroup.position);
        if (distance < NEST_PROXIMITY_RANGE && distance < nearestDistance) {
          nearest = nestGroup;
          nearestDistance = distance;
        }
      });

      return nearest;
    },

    /**
     * Get all nests in glow range (for UI indicator)
     */
    getNestsInRange(birbPosition) {
      return nests.filter((nestGroup) => {
        if (!nestGroup.visible) return false;
        const distance = birbPosition.distanceTo(nestGroup.position);
        return distance < NEST_GLOW_RANGE;
      });
    },

    /**
     * Mark a nest as occupied and hide it for FPV view
     */
    setNestOccupied(nestGroup, occupied) {
      if (nestGroup && nestGroup.userData.isNest) {
        nestGroup.userData.isOccupied = occupied;

        // Hide/show the nest when occupied (for clear FPV view)
        if (occupied) {
          currentlyOccupiedNest = nestGroup;
          nestGroup.visible = false;
          hideHostObject(nestGroup);
        } else {
          nestGroup.visible = true;
          currentlyOccupiedNest = null;
          restoreHostObjectVisibility(nestGroup);
        }
      }
    },

    /**
     * Get the currently occupied nest
     */
    getCurrentlyOccupiedNest() {
      return currentlyOccupiedNest;
    },

    /**
     * Reset all nests
     */
    reset() {
      nests.forEach((nestGroup) => {
        nestGroup.visible = true;
        nestGroup.userData.isActive = false;
        nestGroup.userData.isOccupied = false;
        restoreHostObjectVisibility(nestGroup);
      });
      currentlyOccupiedNest = null;
    },

    /**
     * Dispose of resources
     */
    dispose() {
      // Remove from scene first to prevent visual artifacts
      scene.remove(container);

      // Then dispose geometries and materials
      try {
        nests.forEach((nestGroup) => {
          nestGroup.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
          });
        });
      } catch (e) {
        console.warn('Error disposing nest points resources:', e);
      }
    },
  };
}
