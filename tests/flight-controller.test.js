import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { runFlightHarness, forwardFromQuaternion } from './helpers/flight-harness.js';
import { SimpleFlightController } from '../src/controls/simple-flight-controller.js';
import { FreeFlightController } from '../free-flight-controller.js';

const round = (value, places = 6) => Number(value.toFixed(places));

const toDirection = (vector) => vector.clone().normalize();

test('yaw replay keeps velocity aligned with facing direction', () => {
  const trace = runFlightHarness(
    [
      { duration: 1, yaw: 1, pitch: 0 },
      { duration: 0.5, yaw: 0, pitch: 0 },
    ],
    { deltaTime: 0.05 }
  );

  const final = trace.at(-1);
  const forward = forwardFromQuaternion(final.quaternion);
  const velocityDir = toDirection(final.velocity);
  const alignment = forward.dot(velocityDir);

  assert.ok(alignment > 0.99, 'velocity should track facing direction');
  assert.ok(final.position.y > 4.9, 'glide should stay above ground');
  assert.ok(final.position.x < -2.3, 'positive yaw should arc left');
  assert.ok(round(forward.x, 3) <= -0.98, `unexpected forward vector ${forward.x}`);
});

test('positive pitch input raises the nose and altitude', () => {
  const controller = new SimpleFlightController();
  const startY = controller.position.y;

  const trace = runFlightHarness(
    [
      { duration: 0.8, yaw: 0, pitch: 1 },
      { duration: 0.4, yaw: 0, pitch: 0 },
    ],
    { deltaTime: 0.05, controller }
  );

  const final = trace.at(-1);
  const forward = forwardFromQuaternion(final.quaternion);

  assert.ok(final.position.y > startY, 'altitude should rise after pitching up');
  assert.ok(final.velocity.y > 1, 'vertical velocity should reflect lift');
  assert.ok(forward.y > 0.5, 'forward vector should tilt upward');
});

test('combined yaw and pitch apply in the correct order', () => {
  const trace = runFlightHarness(
    [{ duration: 0.6, yaw: 0.6, pitch: 0.8 }],
    { deltaTime: 0.05 }
  );

  const final = trace.at(-1);
  const forward = forwardFromQuaternion(final.quaternion);

  assert.ok(final.position.y > 5.15 && final.position.y < 5.2);
  assert.ok(Math.abs(round(forward.x, 3) + 0.33) < 0.02, 'yaw should push left');
  assert.ok(Math.abs(round(forward.y, 3) - 0.217) < 0.01, 'pitch should lift relative to yawed axis');
  assert.ok(Math.abs(round(forward.z, 3) + 0.919) < 0.01, 'forward should retain forward weight');
});

// Test FreeFlightController specifically (used in main game)
test('FreeFlightController velocity follows facing direction during turns', () => {
  const controller = new FreeFlightController(THREE, {
    position: new THREE.Vector3(0, 5, 0),
  });

  // Fly straight for a bit
  for (let i = 0; i < 10; i++) {
    controller.update(0.05);
  }

  // Turn right (yaw = 1) for 1 second
  controller.setInputs({ yaw: 1, pitch: 0 });
  for (let i = 0; i < 20; i++) {
    controller.update(0.05);
  }

  // Check velocity follows facing direction
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(controller.quaternion).normalize();
  const velocityDir = controller.velocity.clone().normalize();
  const alignment = forward.dot(velocityDir);

  assert.ok(alignment > 0.95, `velocity should follow facing direction, got alignment ${alignment}`);
  // Position should have moved to the right (positive X) since we turned right
  assert.ok(controller.position.x > 0, `position.x should be positive after turning right, got ${controller.position.x}`);
});

test('FreeFlightController pitch changes altitude', () => {
  const controller = new FreeFlightController(THREE, {
    position: new THREE.Vector3(0, 5, 0),
  });

  const startY = controller.position.y;

  // Pitch up for 1 second
  controller.setInputs({ yaw: 0, pitch: 1 });
  for (let i = 0; i < 20; i++) {
    controller.update(0.05);
  }

  assert.ok(controller.position.y > startY, `altitude should increase when pitching up, got ${controller.position.y}`);
  assert.ok(controller.verticalVelocity > 0, `vertical velocity should be positive, got ${controller.verticalVelocity}`);
});
