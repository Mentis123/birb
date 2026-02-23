import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { AimRig, AIM_RIG_DEFAULTS } from '../src/nesting/aim-rig.js';

const UP = new THREE.Vector3(0, 1, 0);

const directionFromQuaternion = (quaternion) =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();

test('AimRig respects minPitch limit (allows looking below horizon)', () => {
  const aimRig = new AimRig(THREE);
  aimRig.setActive(true);
  aimRig.setReferenceFromVectors(new THREE.Vector3(0, 0, -1), UP);

  // Pull down hard for many frames
  for (let i = 0; i < 60; i++) {
    aimRig.update({ axisX: 0, axisY: -1 }, 0.05);
  }

  const lookDir = directionFromQuaternion(aimRig.getQuaternion());
  // With minPitch = -30°, look direction can go below horizon but not past -30°
  const pitchAngle = Math.asin(lookDir.y);
  const minPitchRad = AIM_RIG_DEFAULTS.minPitch;
  assert.ok(pitchAngle >= minPitchRad - 0.01,
    `pitch ${pitchAngle} should not exceed minPitch ${minPitchRad}`);
});

test('AimRig rotates smoothly through full yaw turns while elevated', () => {
  const aimRig = new AimRig(THREE);
  aimRig.setActive(true);
  aimRig.setReferenceFromVectors(new THREE.Vector3(0, 0, -1), UP);

  // Elevate above horizon
  for (let i = 0; i < 20; i++) {
    aimRig.update({ axisX: 0, axisY: 1 }, 0.05);
  }

  // Rotate continuously past 360° at fixed elevation and track heading sweep
  let minHeading = Infinity;
  let maxHeading = -Infinity;
  for (let i = 0; i < 120; i++) {
    aimRig.update({ axisX: 1, axisY: 0 }, 0.05);
    const stepDir = directionFromQuaternion(aimRig.getQuaternion());
    const heading = Math.atan2(stepDir.x, -stepDir.z);
    minHeading = Math.min(minHeading, heading);
    maxHeading = Math.max(maxHeading, heading);
  }

  const after = directionFromQuaternion(aimRig.getQuaternion());
  assert.ok(after.y > 0.01, `elevation should remain above horizon while yawing, y=${after.y}`);
  assert.ok(maxHeading - minHeading > Math.PI, 'yaw should sweep broadly without stalling');
});

test('AimRig inertia: velocity carries through on release', () => {
  const aimRig = new AimRig(THREE);
  aimRig.setActive(true);
  aimRig.setReferenceFromVectors(new THREE.Vector3(0, 0, -1), UP);

  // Apply yaw input to build up velocity
  for (let i = 0; i < 30; i++) {
    aimRig.update({ axisX: 1, axisY: 0 }, 1 / 60);
  }

  // Record yaw at moment of release
  const yawAtRelease = aimRig._yaw;
  assert.ok(Math.abs(aimRig._yawVelocity) > 0.1,
    `should have built up yaw velocity, got ${aimRig._yawVelocity}`);

  // Release input — velocity should coast (not stop dead)
  for (let i = 0; i < 10; i++) {
    aimRig.update({ axisX: 0, axisY: 0 }, 1 / 60);
  }

  const yawAfterCoast = aimRig._yaw;
  const coastDistance = Math.abs(normalizeAngle(yawAfterCoast - yawAtRelease));
  assert.ok(coastDistance > 0.01,
    `turret should coast after release, coasted ${coastDistance} rad`);
});

test('AimRig inertia: velocity decays to zero eventually', () => {
  const aimRig = new AimRig(THREE);
  aimRig.setActive(true);
  aimRig.setReferenceFromVectors(new THREE.Vector3(0, 0, -1), UP);

  // Build up velocity
  for (let i = 0; i < 20; i++) {
    aimRig.update({ axisX: 1, axisY: 0 }, 1 / 60);
  }

  // Release and coast for 2 seconds
  for (let i = 0; i < 120; i++) {
    aimRig.update({ axisX: 0, axisY: 0 }, 1 / 60);
  }

  assert.ok(Math.abs(aimRig._yawVelocity) < 0.01,
    `velocity should decay to near-zero, got ${aimRig._yawVelocity}`);
});

test('AimRig inertia: pitch stops at boundaries', () => {
  const aimRig = new AimRig(THREE);
  aimRig.setActive(true);
  aimRig.setReferenceFromVectors(new THREE.Vector3(0, 0, -1), UP);

  // Push pitch to max
  for (let i = 0; i < 60; i++) {
    aimRig.update({ axisX: 0, axisY: 1 }, 0.05);
  }

  assert.ok(aimRig._pitch <= aimRig.maxPitch + 1e-6,
    `pitch ${aimRig._pitch} should not exceed maxPitch ${aimRig.maxPitch}`);
  assert.ok(aimRig._pitchVelocity <= 0.01,
    `pitch velocity should be killed at boundary, got ${aimRig._pitchVelocity}`);
});

// Helper — same as module-internal normalizeAngle
function normalizeAngle(angle) {
  const TWO_PI = Math.PI * 2;
  while (angle > Math.PI) angle -= TWO_PI;
  while (angle < -Math.PI) angle += TWO_PI;
  return angle;
}
