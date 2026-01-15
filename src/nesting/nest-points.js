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

  // Main nest platform - a soft glowing disc/bowl shape (increased size for visibility)
  const nestGeometry = new THREE.CylinderGeometry(1.2, 0.8, 0.4, 16);
  // Use MeshBasicMaterial for guaranteed visibility (not affected by lighting)
  const nestMaterial = new THREE.MeshBasicMaterial({
    color: config.color,
    transparent: true,
    opacity: 0.95,
  });
  const nest = new THREE.Mesh(nestGeometry, nestMaterial);
  group.add(nest);

  // Outer glow ring (increased size)
  const glowGeometry = new THREE.TorusGeometry(1.4, 0.2, 12, 32);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: config.glowColor,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 0.2;
  group.add(glow);

  // Inner bright core (increased size)
  const coreGeometry = new THREE.SphereGeometry(0.5, 16, 12);
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xffaa88,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.position.y = 0.3;
  group.add(core);

  // Tall beacon for visibility - a glowing column above the nest (made thicker)
  const beaconHeight = 12.0;
  const beaconGeometry = new THREE.CylinderGeometry(0.2, 0.4, beaconHeight, 8);
  const beaconMaterial = new THREE.MeshBasicMaterial({
    color: config.glowColor,
    transparent: true,
    opacity: 0.8,
  });
  const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
  beacon.position.y = beaconHeight / 2 + 0.5;
  group.add(beacon);

  // Beacon tip sphere for extra visibility (made larger)
  const tipGeometry = new THREE.SphereGeometry(0.8, 12, 8);
  const tipMaterial = new THREE.MeshBasicMaterial({
    color: config.color,
    transparent: true,
    opacity: 0.95,
  });
  const tip = new THREE.Mesh(tipGeometry, tipMaterial);
  tip.position.y = beaconHeight + 1.0;
  group.add(tip);

  // Store references for animation and interaction
  group.userData.nest = nest;
  group.userData.nestMaterial = nestMaterial;
  group.userData.glow = glow;
  group.userData.glowMaterial = glowMaterial;
  group.userData.core = core;
  group.userData.coreMaterial = coreMaterial;
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
 * @param parentContainer - The parent to add nests to (typically sphericalWorld.root so nests rotate with the world)
 */
export function createNestPointsSystem(THREE, parentContainer, environmentId, sphereRadius, nestablePositions = []) {
  console.log(`[NestSystem] Creating nests for ${environmentId}: ${nestablePositions.length} positions provided`);
  console.log(`[NestSystem] Parent container: ${parentContainer ? parentContainer.name || 'unnamed' : 'NULL'}`);
  console.log(`[NestSystem] Parent in scene: ${parentContainer?.parent ? 'yes' : 'no'}`);
  const config = NEST_CONFIGS[environmentId] || NEST_CONFIGS.forest;
  const _hostBounds = new THREE.Box3();
  const _hostSize = new THREE.Vector3();
  const _normalAbs = new THREE.Vector3();
  // Temporary vectors for world position/quaternion calculations
  const _worldPos = new THREE.Vector3();
  const _worldQuat = new THREE.Quaternion();

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
  parentContainer.add(container);

  const nests = [];
  let animationTime = 0;
  let currentlyOccupiedNest = null;

  // Create nest markers at the positions provided by the environment
  nestablePositions.forEach((placement, index) => {
    const nestGroup = createNestMarker(THREE, config);

    // Position nest at the environment object's top
    nestGroup.position.copy(placement.position);
    console.log(`[NestSystem] Nest ${index}: pos (${placement.position.x.toFixed(1)}, ${placement.position.y.toFixed(1)}, ${placement.position.z.toFixed(1)}), distance from origin: ${placement.position.length().toFixed(1)}`);

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

  // Force initial matrix update to ensure nests are visible on first render
  container.updateMatrixWorld(true);

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

        // Use world position for proper distance calculation when sphere rotates
        nestGroup.getWorldPosition(_worldPos);
        const distance = birbPosition.distanceTo(_worldPos);
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
        const { nestMaterial, glowMaterial, coreMaterial } = nestGroup.userData;
        const baseEmissive = nestGroup.userData.baseEmissiveIntensity;

        // Emissive intensity with pulse and proximity boost
        nestMaterial.emissiveIntensity = baseEmissive * (0.8 + pulse * 0.4) * intensityMultiplier * activePulse;

        // Glow ring opacity
        glowMaterial.opacity = nestGroup.userData.baseGlowOpacity * (0.6 + pulse * 0.4) * intensityMultiplier;

        // Core glow
        coreMaterial.opacity = nestGroup.userData.baseCoreOpacity * (0.5 + pulse * 0.5) * intensityMultiplier * activePulse;

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
     * Uses world coordinates for proper detection when sphere rotates
     */
    getNearestActiveNest(birbPosition) {
      let nearest = null;
      let nearestDistance = Infinity;

      nests.forEach((nestGroup) => {
        if (!nestGroup.visible) return;

        // Get nest's world position (accounts for sphere rotation)
        nestGroup.getWorldPosition(_worldPos);
        const distance = birbPosition.distanceTo(_worldPos);
        if (distance < NEST_PROXIMITY_RANGE && distance < nearestDistance) {
          nearest = nestGroup;
          nearestDistance = distance;
        }
      });

      return nearest;
    },

    /**
     * Get the world position of a nest (for landing target)
     */
    getNestWorldPosition(nestGroup, target) {
      if (!nestGroup) return null;
      nestGroup.getWorldPosition(target || _worldPos);
      return target || _worldPos.clone();
    },

    /**
     * Get the world quaternion of a nest (for landing orientation)
     */
    getNestWorldQuaternion(nestGroup, target) {
      if (!nestGroup) return null;
      nestGroup.getWorldQuaternion(target || _worldQuat);
      return target || _worldQuat.clone();
    },

    /**
     * Get the world-space surface normal of a nest
     */
    getNestWorldSurfaceNormal(nestGroup, target) {
      if (!nestGroup || !nestGroup.userData.surfaceNormal) return null;
      // The surface normal in local space needs to be transformed to world space
      // We can do this by applying the nest's world quaternion to the local normal
      nestGroup.getWorldQuaternion(_worldQuat);
      const normal = target || new THREE.Vector3();
      normal.copy(nestGroup.userData.surfaceNormal).applyQuaternion(_worldQuat);
      return normal;
    },

    /**
     * Get all nests in glow range (for UI indicator)
     */
    getNestsInRange(birbPosition) {
      return nests.filter((nestGroup) => {
        if (!nestGroup.visible) return false;
        // Use world position for proper distance calculation
        nestGroup.getWorldPosition(_worldPos);
        const distance = birbPosition.distanceTo(_worldPos);
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
      // Remove from parent first to prevent visual artifacts
      parentContainer.remove(container);

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
