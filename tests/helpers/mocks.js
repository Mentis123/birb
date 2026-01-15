/**
 * Shared mock factories for tests
 */
import * as THREE from 'three';

/**
 * Create a mock flight controller with all required properties
 */
export function createMockFlightController(options = {}) {
  return {
    position: options.position || new THREE.Vector3(0, 5, 0),
    velocity: options.velocity || new THREE.Vector3(0, 0, 0),
    quaternion: options.quaternion || new THREE.Quaternion(),
    lookQuaternion: options.lookQuaternion || new THREE.Quaternion(),
    speed: options.speed || 4.0,
    setSpeed: function(s) { this.speed = s; },
    setOrientation: function(quat, opts = {}) {
      this.quaternion.copy(quat);
      if (this.lookQuaternion) {
        this.lookQuaternion.copy(quat);
      }
    },
  };
}

/**
 * Create a mock nest group object (as created by nest-points system)
 */
export function createMockNest(options = {}) {
  const position = options.position || new THREE.Vector3(10, 35, 0);
  const surfaceNormal = options.surfaceNormal || position.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    surfaceNormal
  );

  return {
    position: position,
    quaternion: quaternion,
    visible: true,
    userData: {
      isNest: true,
      isActive: false,
      isOccupied: false,
      landingPosition: position.clone(),
      landingQuaternion: quaternion.clone(),
      surfaceNormal: surfaceNormal,
      hostClearance: options.hostClearance || 2.0,
      hostObject: options.hostObject || null,
    },
  };
}

/**
 * Create a mock nest points system
 */
export function createMockNestPointsSystem(options = {}) {
  const nests = options.nests || [];
  let nearestNest = options.nearestNest || null;

  return {
    nests,
    getNearestActiveNest: function(birbPosition) {
      return nearestNest;
    },
    setNearestNest: function(nest) {
      nearestNest = nest;
    },
    setNestOccupied: function(nest, occupied) {
      if (nest && nest.userData) {
        nest.userData.isOccupied = occupied;
        nest.visible = !occupied;
      }
    },
    update: function(delta, birbPosition) {},
    reset: function() {
      nests.forEach(n => {
        if (n.userData) {
          n.userData.isOccupied = false;
          n.userData.isActive = false;
        }
        n.visible = true;
      });
      nearestNest = null;
    },
  };
}
