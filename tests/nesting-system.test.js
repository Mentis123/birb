import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createNestingSystem, NESTING_STATES } from '../src/nesting/nesting-system.js';

test('forceNestAt starts landing even when not in proximity range', () => {
  const flightController = {
    position: new THREE.Vector3(0, 0, 0),
    quaternion: new THREE.Quaternion(),
    lookQuaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    setSpeed() {},
    setOrientation(quat) {
      this.quaternion.copy(quat);
      this.lookQuaternion.copy(quat);
    },
  };

  const nest = {
    position: new THREE.Vector3(10, 0, 0),
    quaternion: new THREE.Quaternion(),
    userData: {
      surfaceNormal: new THREE.Vector3(0, 1, 0),
      hostClearance: 0,
    },
  };

  let occupied = false;
  const nestPointsSystem = {
    update() {},
    reset() {},
    getNearestActiveNest() { return null; },
    getNestWorldPosition(n, target) { return target.copy(n.position); },
    getNestWorldQuaternion(n, target) { return target.copy(n.quaternion); },
    getNestWorldSurfaceNormal(n, target) { return target.copy(n.userData.surfaceNormal); },
    setNestOccupied(_n, value) { occupied = value; },
  };

  const nestingSystem = createNestingSystem(THREE, { flightController, nestPointsSystem });

  const started = nestingSystem.forceNestAt(nest);

  assert.equal(started, true);
  assert.equal(nestingSystem.getState(), NESTING_STATES.LANDING);
  assert.equal(nestingSystem.getCurrentNest(), nest);
  assert.equal(occupied, true);
});

test('landing tracks moving nest position and still reaches nested state', () => {
  const flightController = {
    position: new THREE.Vector3(0, 0, 0),
    quaternion: new THREE.Quaternion(),
    lookQuaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    setSpeed() {},
    setOrientation(quat) {
      this.quaternion.copy(quat);
      this.lookQuaternion.copy(quat);
    },
  };

  const nest = {
    position: new THREE.Vector3(0.2, 0, 0),
    quaternion: new THREE.Quaternion(),
    userData: {
      surfaceNormal: new THREE.Vector3(0, 1, 0),
      hostClearance: 0,
    },
  };

  const nestPointsSystem = {
    update() {},
    reset() {},
    getNearestActiveNest() { return nest; },
    getNestWorldPosition(n, target) { return target.copy(n.position); },
    getNestWorldQuaternion(n, target) { return target.copy(n.quaternion); },
    getNestWorldSurfaceNormal(n, target) { return target.copy(n.userData.surfaceNormal); },
    setNestOccupied() {},
  };

  const nestingSystem = createNestingSystem(THREE, { flightController, nestPointsSystem });
  assert.equal(nestingSystem.forceNestAt(nest), true);
  assert.equal(nestingSystem.getState(), NESTING_STATES.LANDING);

  // Simulate the world rotating and moving the nest while birb is auto-flying.
  nest.position.set(1.6, 0, 0);
  nestingSystem.update(0.1, flightController.position);

  // Landing target should follow moved nest instead of sticking to stale position.
  assert.ok(flightController.position.x > 0.2);

  for (let i = 0; i < 20; i += 1) {
    nestingSystem.update(0.1, flightController.position);
    if (nestingSystem.getState() === NESTING_STATES.NESTED) break;
  }

  assert.equal(nestingSystem.getState(), NESTING_STATES.NESTED);
});
