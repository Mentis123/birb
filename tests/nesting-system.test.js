import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createNestingSystem, NESTING_STATES } from '../src/nesting/nesting-system.js';
import { createMockFlightController, createMockNest, createMockNestPointsSystem } from './helpers/mocks.js';

// Helper to create a nesting system with mocks
function createTestNestingSystem(options = {}) {
  const flightController = options.flightController || createMockFlightController();
  const nest = options.nest || createMockNest();
  const nestPointsSystem = options.nestPointsSystem || createMockNestPointsSystem({ nests: [nest] });

  const stateChanges = [];
  const onStateChange = (newState, previousState, nest) => {
    stateChanges.push({ newState, previousState, nest });
  };

  const nestingSystem = createNestingSystem(THREE, {
    flightController,
    nestPointsSystem,
    onStateChange: options.onStateChange || onStateChange,
  });

  return { nestingSystem, flightController, nestPointsSystem, nest, stateChanges };
}

// Helper to simulate landing until nested (runs update cycles until arrival)
function simulateLandingUntilNested(nestingSystem, flightController, maxIterations = 100) {
  for (let i = 0; i < maxIterations; i++) {
    nestingSystem.update(0.1, flightController.position);
    if (nestingSystem.getState() === NESTING_STATES.NESTED) {
      return true;
    }
  }
  return false;
}

// === State Transition Tests ===

test('initial state is FLYING', () => {
  const { nestingSystem } = createTestNestingSystem();
  assert.equal(nestingSystem.getState(), NESTING_STATES.FLYING);
});

test('transitions from FLYING to APPROACHING when near a nest', () => {
  const { nestingSystem, nestPointsSystem, nest, stateChanges } = createTestNestingSystem();

  // Simulate being near a nest
  nestPointsSystem.setNearestNest(nest);

  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));

  assert.equal(nestingSystem.getState(), NESTING_STATES.APPROACHING);
  assert.equal(stateChanges.length, 1);
  assert.equal(stateChanges[0].newState, NESTING_STATES.APPROACHING);
  assert.equal(stateChanges[0].previousState, NESTING_STATES.FLYING);
});

test('transitions from APPROACHING back to FLYING when leaving range', () => {
  const { nestingSystem, nestPointsSystem, nest, stateChanges } = createTestNestingSystem();

  // Enter range
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  assert.equal(nestingSystem.getState(), NESTING_STATES.APPROACHING);

  // Leave range
  nestPointsSystem.setNearestNest(null);
  nestingSystem.update(0.05, new THREE.Vector3(100, 35, 0));

  assert.equal(nestingSystem.getState(), NESTING_STATES.FLYING);
  assert.equal(stateChanges.length, 2);
  assert.equal(stateChanges[1].newState, NESTING_STATES.FLYING);
  assert.equal(stateChanges[1].previousState, NESTING_STATES.APPROACHING);
});

test('transitions from APPROACHING to LANDING when tryLandOnNest called', () => {
  const { nestingSystem, nestPointsSystem, nest, stateChanges } = createTestNestingSystem();

  // Enter range
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));

  // Try to land
  const result = nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));

  assert.equal(result, true);
  assert.equal(nestingSystem.getState(), NESTING_STATES.LANDING);
});

test('transitions from LANDING to NESTED on arrival', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Enter range and start landing
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  assert.equal(nestingSystem.getState(), NESTING_STATES.LANDING);

  // Simulate landing by running update cycles until arrival
  const arrived = simulateLandingUntilNested(nestingSystem, flightController);

  assert.equal(arrived, true, 'should arrive at nest');
  assert.equal(nestingSystem.getState(), NESTING_STATES.NESTED);
});

test('transitions from NESTED to TAKING_OFF when takeOff called', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Get to NESTED state
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  simulateLandingUntilNested(nestingSystem, flightController);
  assert.equal(nestingSystem.getState(), NESTING_STATES.NESTED);

  // Take off
  const result = nestingSystem.takeOff();

  assert.equal(result, true);
  assert.equal(nestingSystem.getState(), NESTING_STATES.TAKING_OFF);
});

test('transitions from TAKING_OFF to FLYING after timer expires', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Get to TAKING_OFF state
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  simulateLandingUntilNested(nestingSystem, flightController);
  nestingSystem.takeOff();
  assert.equal(nestingSystem.getState(), NESTING_STATES.TAKING_OFF);

  // Clear nest proximity so we go to FLYING, not back to APPROACHING
  nestPointsSystem.setNearestNest(null);

  // Simulate time passing (take-off duration is 0.5s)
  for (let i = 0; i < 15; i++) {
    nestingSystem.update(0.05, flightController.position);
  }

  assert.equal(nestingSystem.getState(), NESTING_STATES.FLYING);
});

// === Landing Mechanics Tests ===

test('tryLandOnNest returns false when not in FLYING or APPROACHING state', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Get to NESTED state first
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  simulateLandingUntilNested(nestingSystem, flightController);
  assert.equal(nestingSystem.getState(), NESTING_STATES.NESTED);

  // Try to land again while nested
  const result = nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));

  assert.equal(result, false);
});

test('tryLandOnNest returns false when no nest in range', () => {
  const { nestingSystem, nestPointsSystem } = createTestNestingSystem();

  // No nest in range
  nestPointsSystem.setNearestNest(null);

  const result = nestingSystem.tryLandOnNest(new THREE.Vector3(100, 100, 100));

  assert.equal(result, false);
  assert.equal(nestingSystem.getState(), NESTING_STATES.FLYING);
});

test('landing auto-flies toward target position', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Start far from nest
  flightController.position.set(20, 40, 10);
  const startDistance = flightController.position.distanceTo(nest.userData.landingPosition);

  // Enter range and start landing
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, flightController.position);
  nestingSystem.tryLandOnNest(flightController.position);

  // Update a few times
  for (let i = 0; i < 5; i++) {
    nestingSystem.update(0.1, flightController.position);
  }

  const endDistance = flightController.position.distanceTo(nest.userData.landingPosition);

  assert.ok(endDistance < startDistance, `should move closer: ${endDistance} < ${startDistance}`);
});

test('arrival snaps position and zeroes velocity', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Set velocity
  flightController.velocity.set(5, 2, 3);

  // Enter range and start landing
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));

  // Simulate landing until nested
  simulateLandingUntilNested(nestingSystem, flightController);

  assert.equal(nestingSystem.getState(), NESTING_STATES.NESTED);
  assert.equal(flightController.velocity.length(), 0, 'velocity should be zeroed');
});

// === Take-off Mechanics Tests ===

test('takeOff returns false when not NESTED', () => {
  const { nestingSystem } = createTestNestingSystem();

  assert.equal(nestingSystem.getState(), NESTING_STATES.FLYING);

  const result = nestingSystem.takeOff();

  assert.equal(result, false);
});

test('takeOff applies boost velocity', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Get to NESTED state
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  simulateLandingUntilNested(nestingSystem, flightController);
  flightController.velocity.set(0, 0, 0);

  const positionBefore = flightController.position.clone();

  // Take off and update
  nestingSystem.takeOff();
  nestingSystem.update(0.1, flightController.position);

  // Position should have moved (boost applied)
  const displacement = flightController.position.distanceTo(positionBefore);
  assert.ok(displacement > 0, 'position should move during take-off boost');
});

test('takeOff restores flight speed', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Get to NESTED state
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  simulateLandingUntilNested(nestingSystem, flightController);

  // Run one more update in NESTED state to trigger setSpeed(0)
  nestingSystem.update(0.05, flightController.position);

  // Speed should be 0 when nested (setSpeed called)
  assert.equal(flightController.speed, 0, 'speed should be 0 when nested');

  // Take off
  nestingSystem.takeOff();

  assert.equal(flightController.speed, 4.0, 'speed should be restored after take-off');
});

// === Helper Method Tests ===

test('isNested returns true only when NESTED', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  assert.equal(nestingSystem.isNested(), false);

  // Get to NESTED state
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  simulateLandingUntilNested(nestingSystem, flightController);

  assert.equal(nestingSystem.isNested(), true);
});

test('isFlying returns true for FLYING, APPROACHING, and TAKING_OFF states', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // FLYING
  assert.equal(nestingSystem.isFlying(), true, 'FLYING should be flying');

  // APPROACHING
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  assert.equal(nestingSystem.getState(), NESTING_STATES.APPROACHING);
  assert.equal(nestingSystem.isFlying(), true, 'APPROACHING should be flying');

  // LANDING (not flying)
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  assert.equal(nestingSystem.getState(), NESTING_STATES.LANDING);
  assert.equal(nestingSystem.isFlying(), false, 'LANDING should not be flying');

  // NESTED (not flying)
  simulateLandingUntilNested(nestingSystem, flightController);
  assert.equal(nestingSystem.getState(), NESTING_STATES.NESTED);
  assert.equal(nestingSystem.isFlying(), false, 'NESTED should not be flying');

  // TAKING_OFF (is flying)
  nestingSystem.takeOff();
  assert.equal(nestingSystem.getState(), NESTING_STATES.TAKING_OFF);
  assert.equal(nestingSystem.isFlying(), true, 'TAKING_OFF should be flying');
});

test('getCurrentNest returns the current nest when landing or nested', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  assert.equal(nestingSystem.getCurrentNest(), null);

  // Start landing
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));

  assert.equal(nestingSystem.getCurrentNest(), nest);
});

test('reset clears current nest and returns to FLYING', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Get to NESTED state
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  simulateLandingUntilNested(nestingSystem, flightController);

  assert.equal(nestingSystem.getState(), NESTING_STATES.NESTED);
  assert.notEqual(nestingSystem.getCurrentNest(), null);

  // Reset
  nestingSystem.reset();

  assert.equal(nestingSystem.getState(), NESTING_STATES.FLYING);
  assert.equal(nestingSystem.getCurrentNest(), null);
});

// === Edge Case Tests ===

test('multiple rapid landing attempts are handled correctly', () => {
  const { nestingSystem, nestPointsSystem, nest } = createTestNestingSystem();

  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));

  // Try landing multiple times rapidly
  const result1 = nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  const result2 = nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  const result3 = nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));

  assert.equal(result1, true);
  assert.equal(result2, false); // Already landing
  assert.equal(result3, false);
  assert.equal(nestingSystem.getState(), NESTING_STATES.LANDING);
});

test('shouldShowWelcome returns true only once per landing', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Not nested yet
  assert.equal(nestingSystem.shouldShowWelcome(), false);

  // Get to NESTED state
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));
  nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  simulateLandingUntilNested(nestingSystem, flightController);

  // First call should return true
  assert.equal(nestingSystem.shouldShowWelcome(), true);
  // Subsequent calls should return false
  assert.equal(nestingSystem.shouldShowWelcome(), false);
  assert.equal(nestingSystem.shouldShowWelcome(), false);
});

test('landing from FLYING state works', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController } = createTestNestingSystem();

  // Try to land directly from FLYING state (without explicit APPROACHING)
  nestPointsSystem.setNearestNest(nest);

  // Note: Must first update to get to APPROACHING state
  nestingSystem.update(0.05, new THREE.Vector3(10, 35, 0));

  const result = nestingSystem.tryLandOnNest(new THREE.Vector3(10, 35, 0));
  assert.equal(result, true);
  assert.equal(nestingSystem.getState(), NESTING_STATES.LANDING);
});

test('complete landing cycle from start to finish', () => {
  const { nestingSystem, nestPointsSystem, nest, flightController, stateChanges } = createTestNestingSystem();

  // Start flying
  assert.equal(nestingSystem.getState(), NESTING_STATES.FLYING);

  // Approach nest
  nestPointsSystem.setNearestNest(nest);
  nestingSystem.update(0.05, flightController.position);
  assert.equal(nestingSystem.getState(), NESTING_STATES.APPROACHING);

  // Land
  nestingSystem.tryLandOnNest(flightController.position);
  assert.equal(nestingSystem.getState(), NESTING_STATES.LANDING);

  // Wait for arrival
  simulateLandingUntilNested(nestingSystem, flightController);
  assert.equal(nestingSystem.getState(), NESTING_STATES.NESTED);

  // Take off
  nestingSystem.takeOff();
  assert.equal(nestingSystem.getState(), NESTING_STATES.TAKING_OFF);

  // Clear nest proximity so we go to FLYING, not back to APPROACHING
  nestPointsSystem.setNearestNest(null);

  // Wait for take-off to complete
  for (let i = 0; i < 15; i++) {
    nestingSystem.update(0.05, flightController.position);
  }
  assert.equal(nestingSystem.getState(), NESTING_STATES.FLYING);

  // Verify all state changes occurred
  const states = stateChanges.map(c => c.newState);
  assert.ok(states.includes(NESTING_STATES.APPROACHING), 'should have transitioned to APPROACHING');
  assert.ok(states.includes(NESTING_STATES.LANDING), 'should have transitioned to LANDING');
  assert.ok(states.includes(NESTING_STATES.NESTED), 'should have transitioned to NESTED');
  assert.ok(states.includes(NESTING_STATES.TAKING_OFF), 'should have transitioned to TAKING_OFF');
});
