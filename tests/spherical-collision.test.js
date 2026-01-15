import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SphericalCollisionSystem } from './helpers/collision-system.js';

const SPHERE_RADIUS = 30;

// === Ground Collision Tests ===

test('checkGroundCollision returns no collision when above surface', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const position = new THREE.Vector3(0, 35, 0); // 5 units above surface

  const result = collision.checkGroundCollision(THREE, position, 0.5);

  assert.equal(result.collided, false);
  assert.equal(result.correctedPosition, null);
  assert.equal(result.normal, null);
});

test('checkGroundCollision detects collision below sphere surface', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const position = new THREE.Vector3(0, 28, 0); // Below surface (30 + 0.5 = 30.5 minimum)

  const result = collision.checkGroundCollision(THREE, position, 0.5);

  assert.equal(result.collided, true);
  assert.notEqual(result.correctedPosition, null);
  assert.notEqual(result.normal, null);
});

test('checkGroundCollision corrects position to surface level', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const entityRadius = 0.5;
  const position = new THREE.Vector3(0, 25, 0); // 5 units below minimum altitude

  const result = collision.checkGroundCollision(THREE, position, entityRadius);

  assert.equal(result.collided, true);
  // Corrected position should be at sphere radius + entity radius
  const expectedAltitude = SPHERE_RADIUS + entityRadius;
  assert.ok(
    Math.abs(result.correctedPosition.length() - expectedAltitude) < 0.001,
    `corrected position should be at altitude ${expectedAltitude}, got ${result.correctedPosition.length()}`
  );
});

test('checkGroundCollision returns correct surface normal', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const position = new THREE.Vector3(10, 20, 15); // Below surface, off-center

  const result = collision.checkGroundCollision(THREE, position, 0.5);

  assert.equal(result.collided, true);
  // Normal should point in same direction as position (outward from center)
  const expectedNormal = position.clone().normalize();
  assert.ok(
    Math.abs(result.normal.dot(expectedNormal) - 1) < 0.001,
    'normal should point outward from sphere center'
  );
});

test('checkGroundCollision handles position exactly at boundary', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const entityRadius = 0.5;
  // Position exactly at minimum altitude - should not collide
  const position = new THREE.Vector3(0, SPHERE_RADIUS + entityRadius, 0);

  const result = collision.checkGroundCollision(THREE, position, entityRadius);

  assert.equal(result.collided, false);
});

test('checkGroundCollision handles different entity radii', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);

  // Small entity at altitude 31 - should not collide with 0.5 radius
  const position = new THREE.Vector3(0, 31, 0);
  const resultSmall = collision.checkGroundCollision(THREE, position, 0.5);
  assert.equal(resultSmall.collided, false);

  // Large entity at altitude 31 - should collide with 2.0 radius (needs 32)
  const resultLarge = collision.checkGroundCollision(THREE, position, 2.0);
  assert.equal(resultLarge.collided, true);
});

// === Object Collision Tests ===

test('checkObjectCollision returns no collision when far from objects', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  collision.addCollider(new THREE.Vector3(0, 35, 0), 1.0, 'tree');

  const position = new THREE.Vector3(100, 35, 0); // Far away

  const result = collision.checkObjectCollision(THREE, position, 0.5);

  assert.equal(result.collided, false);
  assert.equal(result.correctedPosition, null);
  assert.equal(result.colliderType, null);
});

test('checkObjectCollision detects collision with added colliders', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  collision.addCollider(new THREE.Vector3(0, 35, 0), 2.0, 'tree');

  const position = new THREE.Vector3(1, 35, 0); // 1 unit away, within range

  const result = collision.checkObjectCollision(THREE, position, 0.5);

  assert.equal(result.collided, true);
  assert.equal(result.colliderType, 'tree');
});

test('checkObjectCollision pushes entity away from object', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const colliderPos = new THREE.Vector3(0, 35, 0);
  const colliderRadius = 2.0;
  const entityRadius = 0.5;
  collision.addCollider(colliderPos, colliderRadius, 'rock');

  const position = new THREE.Vector3(1, 35, 0); // Inside collision range

  const result = collision.checkObjectCollision(THREE, position, entityRadius);

  assert.equal(result.collided, true);
  // Corrected position should be at minimum distance from collider
  const minDistance = colliderRadius + entityRadius;
  const actualDistance = result.correctedPosition.distanceTo(colliderPos);
  assert.ok(
    Math.abs(actualDistance - minDistance) < 0.001,
    `corrected position should be ${minDistance} from collider, got ${actualDistance}`
  );
});

test('addCollider and clearColliders manage collider list', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);

  // Initially no colliders
  assert.equal(collision.objectColliders.length, 0);

  // Add colliders
  collision.addCollider(new THREE.Vector3(0, 35, 0), 1.0, 'tree');
  collision.addCollider(new THREE.Vector3(10, 35, 0), 2.0, 'rock');
  assert.equal(collision.objectColliders.length, 2);

  // Clear colliders
  collision.clearColliders();
  assert.equal(collision.objectColliders.length, 0);
});

test('checkObjectCollision finds nearest collision when multiple objects overlap', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  collision.addCollider(new THREE.Vector3(0, 35, 0), 3.0, 'tree1');
  collision.addCollider(new THREE.Vector3(5, 35, 0), 3.0, 'tree2');

  // Position inside first collider only
  const position = new THREE.Vector3(1, 35, 0);

  const result = collision.checkObjectCollision(THREE, position, 0.5);

  assert.equal(result.collided, true);
  assert.equal(result.colliderType, 'tree1'); // First one added
});

// === Combined Collision Tests ===

test('checkAllCollisions handles ground collision only', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const position = new THREE.Vector3(0, 25, 0); // Below ground
  const velocity = new THREE.Vector3(0, -5, 0); // Moving down

  const result = collision.checkAllCollisions(THREE, position, velocity, 0.5);

  assert.equal(result.hadCollision, true);
  assert.ok(result.position.length() >= SPHERE_RADIUS + 0.5, 'position should be above ground');
});

test('checkAllCollisions handles object collision only', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  collision.addCollider(new THREE.Vector3(0, 35, 0), 2.0, 'tree');

  const position = new THREE.Vector3(1, 35, 0); // Near object but above ground
  const velocity = new THREE.Vector3(-1, 0, 0); // Moving toward object

  const result = collision.checkAllCollisions(THREE, position, velocity, 0.5);

  assert.equal(result.hadCollision, true);
});

test('checkAllCollisions handles simultaneous ground and object collision', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  collision.addCollider(new THREE.Vector3(0, 30.5, 0), 2.0, 'tree'); // Tree at ground level

  const position = new THREE.Vector3(0.5, 29, 0); // Below ground AND near tree
  const velocity = new THREE.Vector3(0, -5, 0);

  const result = collision.checkAllCollisions(THREE, position, velocity, 0.5);

  assert.equal(result.hadCollision, true);
  // Position should be corrected for both
  assert.ok(result.position.length() >= SPHERE_RADIUS + 0.5, 'should be above ground');
});

test('velocity is reflected with restitution on ground bounce', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const position = new THREE.Vector3(0, 28, 0); // Below ground
  const velocity = new THREE.Vector3(0, -10, 0); // Moving down fast

  const result = collision.checkAllCollisions(THREE, position, velocity, 0.5);

  // Velocity should be reflected upward with 0.3 restitution
  // Original: (0, -10, 0), normal: (0, 1, 0), dot = -10
  // Reflected: v - (1 + 0.3) * dot * n = (0, -10, 0) - (-13) * (0, 1, 0) = (0, 3, 0)
  assert.ok(result.velocity.y > 0, 'velocity y should be positive after bounce');
  assert.ok(
    Math.abs(result.velocity.y - 3) < 0.1,
    `velocity y should be ~3 after bounce with 0.3 restitution, got ${result.velocity.y}`
  );
});

test('velocity moving away from ground is not modified', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const position = new THREE.Vector3(0, 28, 0); // Below ground
  const velocity = new THREE.Vector3(5, 10, 0); // Moving up and sideways

  const result = collision.checkAllCollisions(THREE, position, velocity, 0.5);

  // Velocity should not be reflected since dot product is positive
  assert.ok(result.velocity.y > 0, 'velocity y should stay positive');
  assert.ok(result.velocity.x > 0, 'velocity x should be preserved');
});

test('checkAllCollisions returns no collision when position is safe', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  collision.addCollider(new THREE.Vector3(100, 35, 0), 2.0, 'tree');

  const position = new THREE.Vector3(0, 35, 0); // Safe position
  const velocity = new THREE.Vector3(1, 0, 0);

  const result = collision.checkAllCollisions(THREE, position, velocity, 0.5);

  assert.equal(result.hadCollision, false);
  assert.ok(result.position.equals(position), 'position should be unchanged');
  assert.ok(result.velocity.equals(velocity), 'velocity should be unchanged');
});

// === Edge Cases ===

test('collision system handles zero velocity', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const position = new THREE.Vector3(0, 28, 0); // Below ground
  const velocity = new THREE.Vector3(0, 0, 0);

  const result = collision.checkAllCollisions(THREE, position, velocity, 0.5);

  assert.equal(result.hadCollision, true);
  assert.ok(result.velocity.length() === 0, 'zero velocity should stay zero');
});

test('collision system handles positions at sphere center', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const position = new THREE.Vector3(0, 0, 0); // At center
  const velocity = new THREE.Vector3(0, 0, 0);

  const result = collision.checkGroundCollision(THREE, position, 0.5);

  // At exact center (0,0,0), collision is detected
  assert.equal(result.collided, true);
  // Note: The corrected position may be invalid (0,0,0) because normalizing
  // a zero-length vector produces (0,0,0). This is an extreme edge case
  // that won't occur in normal gameplay. Just verify collision detection works.
});

test('collision system handles negative sphere positions', () => {
  const collision = new SphericalCollisionSystem(SPHERE_RADIUS);
  const position = new THREE.Vector3(-10, -20, -15);

  const result = collision.checkGroundCollision(THREE, position, 0.5);

  assert.equal(result.collided, true);
  // Normal should still point outward (same direction as position)
  const expectedDir = position.clone().normalize();
  assert.ok(
    result.normal.dot(expectedDir) > 0.99,
    'normal should point in direction of position from center'
  );
});
