/**
 * Nesting System
 * Manages the birb's nesting state, auto-fly landing, and nest mode controls.
 */

import { NEST_PROXIMITY_RANGE } from './nest-points.js';

// Nesting states
export const NESTING_STATES = {
  FLYING: 'flying',
  APPROACHING: 'approaching', // In range of a nest
  LANDING: 'landing', // Auto-flying to nest
  NESTED: 'nested', // Stationary at nest
  TAKING_OFF: 'taking_off', // Leaving nest
};

// Auto-fly configuration
const AUTO_FLY_SPEED = 4.0;
const AUTO_FLY_ARRIVAL_THRESHOLD = 0.3;
const TAKE_OFF_DURATION = 0.5;
const TAKE_OFF_BOOST = 3.0;

/**
 * Create the nesting system
 */
export function createNestingSystem(THREE, { flightController, nestPointsSystem, onStateChange }) {
  let currentState = NESTING_STATES.FLYING;
  let currentNest = null;
  let targetPosition = new THREE.Vector3();
  let targetQuaternion = new THREE.Quaternion();
  let takeOffTimer = 0;
  let takeOffDirection = new THREE.Vector3();
  let hasShownWelcomeMessage = false;

  // Temporary vectors for calculations
  const _tempVec = new THREE.Vector3();
  const _tempQuat = new THREE.Quaternion();

  function setState(newState) {
    if (currentState !== newState) {
      const previousState = currentState;
      currentState = newState;
      if (onStateChange) {
        onStateChange(newState, previousState, currentNest);
      }
    }
  }

  return {
    /**
     * Get current nesting state
     */
    getState() {
      return currentState;
    },

    /**
     * Get the current nest (if any)
     */
    getCurrentNest() {
      return currentNest;
    },

    /**
     * Check if birb is in a stationary nest state
     */
    isNested() {
      return currentState === NESTING_STATES.NESTED;
    },

    /**
     * Check if birb is flying (including take-off)
     */
    isFlying() {
      return currentState === NESTING_STATES.FLYING ||
             currentState === NESTING_STATES.APPROACHING ||
             currentState === NESTING_STATES.TAKING_OFF;
    },

    /**
     * Check if welcome message should be shown
     */
    shouldShowWelcome() {
      if (!hasShownWelcomeMessage && currentState === NESTING_STATES.NESTED) {
        hasShownWelcomeMessage = true;
        return true;
      }
      return false;
    },

    /**
     * Attempt to land on the nearest available nest
     * Called when player clicks/taps while in range
     */
    tryLandOnNest(birbPosition) {
      if (currentState !== NESTING_STATES.FLYING &&
          currentState !== NESTING_STATES.APPROACHING) {
        return false;
      }

      const nearestNest = nestPointsSystem.getNearestActiveNest(birbPosition);
      if (!nearestNest) {
        return false;
      }

      // Start landing sequence
      currentNest = nearestNest;
      targetPosition.copy(nearestNest.userData.landingPosition);
      targetQuaternion.copy(nearestNest.userData.landingQuaternion);

      // Offset landing position slightly above the nest
      const surfaceNormal = nearestNest.userData.surfaceNormal;
      const hostClearance = nearestNest.userData.hostClearance || 0;
      const clearanceOffset = Math.max(0.6, Math.min(hostClearance * 0.2, 3.0));
      targetPosition.addScaledVector(surfaceNormal, clearanceOffset);

      setState(NESTING_STATES.LANDING);
      nestPointsSystem.setNestOccupied(currentNest, true);

      return true;
    },

    /**
     * Take off from current nest
     */
    takeOff() {
      if (currentState !== NESTING_STATES.NESTED) {
        return false;
      }

      // Calculate take-off direction (outward from sphere + slight forward)
      if (currentNest) {
        takeOffDirection.copy(currentNest.userData.surfaceNormal);

        // Add some forward momentum based on current look direction
        const forward = _tempVec.set(0, 0, -1).applyQuaternion(flightController.lookQuaternion);
        takeOffDirection.addScaledVector(forward, 0.5);
        takeOffDirection.normalize();

        nestPointsSystem.setNestOccupied(currentNest, false);
      } else {
        takeOffDirection.set(0, 1, 0);
      }

      takeOffTimer = TAKE_OFF_DURATION;
      setState(NESTING_STATES.TAKING_OFF);
      hasShownWelcomeMessage = false; // Reset for next landing

      return true;
    },

    /**
     * Update the nesting system
     */
    update(delta, birbPosition) {
      // Update nest point system (handles glow animations)
      nestPointsSystem.update(delta, birbPosition);

      switch (currentState) {
        case NESTING_STATES.FLYING: {
          // Check if birb entered proximity of any nest
          const nearestNest = nestPointsSystem.getNearestActiveNest(birbPosition);
          if (nearestNest) {
            setState(NESTING_STATES.APPROACHING);
          }
          break;
        }

        case NESTING_STATES.APPROACHING: {
          // Check if birb left proximity
          const nearestNest = nestPointsSystem.getNearestActiveNest(birbPosition);
          if (!nearestNest) {
            setState(NESTING_STATES.FLYING);
          }
          break;
        }

        case NESTING_STATES.LANDING: {
          // Auto-fly toward the nest
          const toTarget = _tempVec.copy(targetPosition).sub(flightController.position);
          const distance = toTarget.length();

          if (distance < AUTO_FLY_ARRIVAL_THRESHOLD) {
            // Arrived at nest
            flightController.position.copy(targetPosition);
            flightController.velocity.set(0, 0, 0);
            // Use setOrientation to properly sync heading/pitch/bank with quaternion
            // This prevents the next update() from overwriting the orientation
            if (typeof flightController.setOrientation === 'function') {
              flightController.setOrientation(targetQuaternion);
            } else {
              // Fallback for older controller versions
              flightController.lookQuaternion.copy(targetQuaternion);
              flightController.quaternion.copy(targetQuaternion);
            }
            setState(NESTING_STATES.NESTED);
          } else {
            // Move toward nest
            const direction = toTarget.normalize();
            const speed = Math.min(AUTO_FLY_SPEED, distance / delta);

            flightController.velocity.copy(direction).multiplyScalar(speed);
            flightController.position.addScaledVector(direction, speed * delta);

            // Smoothly rotate to face landing orientation
            flightController.lookQuaternion.slerp(targetQuaternion, delta * 3);
            flightController.quaternion.slerp(targetQuaternion, delta * 3);
            // Sync heading/pitch/bank with the slerped quaternion
            if (typeof flightController.setOrientation === 'function') {
              flightController.setOrientation(flightController.quaternion, { preserveBank: true });
            }
          }
          break;
        }

        case NESTING_STATES.NESTED: {
          // Keep birb stationary
          flightController.velocity.set(0, 0, 0);
          // Position is maintained, controls are for look-around only
          break;
        }

        case NESTING_STATES.TAKING_OFF: {
          takeOffTimer -= delta;

          if (takeOffTimer <= 0) {
            // Take-off complete, return to flying
            currentNest = null;
            setState(NESTING_STATES.FLYING);
          } else {
            // Apply take-off boost
            const boostFactor = takeOffTimer / TAKE_OFF_DURATION;
            flightController.velocity.copy(takeOffDirection).multiplyScalar(TAKE_OFF_BOOST * boostFactor);
            flightController.position.addScaledVector(takeOffDirection, TAKE_OFF_BOOST * boostFactor * delta);
          }
          break;
        }
      }

      return currentState;
    },

    /**
     * Get look direction for crosshair aiming (when nested)
     */
    getLookDirection() {
      return _tempVec.set(0, 0, -1).applyQuaternion(flightController.lookQuaternion);
    },

    /**
     * Reset nesting system
     */
    reset() {
      if (currentNest) {
        nestPointsSystem.setNestOccupied(currentNest, false);
      }
      currentNest = null;
      currentState = NESTING_STATES.FLYING;
      takeOffTimer = 0;
      hasShownWelcomeMessage = false;
      nestPointsSystem.reset();
    },

    /**
     * Dispose resources
     */
    dispose() {
      this.reset();
    },
  };
}
