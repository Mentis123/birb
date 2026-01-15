# Test Coverage Analysis

## Executive Summary

The birb codebase has **~6% functional test coverage** with 20 passing tests across 2 test files. The existing tests are well-written and focus heavily on flight physics correctness, but large areas of the codebase remain untested.

**Key Metrics:**
- **Total Source Files:** 20 files (~7,943 lines)
- **Test Files:** 2 files (456 lines including helpers)
- **Test Cases:** 20 (all passing)
- **Modules with Tests:** 1 of 6 (controls - partial)
- **Modules without Tests:** 5 of 6 (camera, environment, flight, nesting, most of controls)

---

## Current Test Coverage

### Well-Tested Areas

| Component | File | Coverage |
|-----------|------|----------|
| `FreeFlightController` | `free-flight-controller.js` | 16 tests - velocity alignment, yaw/pitch, spherical mode, frozen state |
| `SimpleFlightController` | `src/controls/simple-flight-controller.js` | Tested via flight harness |
| Input Shaping | `src/controls/virtual-thumbstick.js` | 3 tests - deadzone, expo curves |

### Untested Areas

| Module | Files | Lines | Priority |
|--------|-------|-------|----------|
| **Nesting** | 3 files | 1,075 | HIGH |
| **Camera** | 4 files | 1,496 | HIGH |
| **Environment** | 5 files | 3,471 | MEDIUM |
| **Flight Visuals** | 4 files | 546 | MEDIUM |
| **Controls (remaining)** | 2 files | 1,046 | LOW |

---

## Prioritized Recommendations

### Priority 1: Nesting System State Machine (HIGH IMPACT)

**Why:** The nesting system is core gameplay logic with a complex state machine that affects user experience. Bugs here cause frustrating gameplay issues.

**Files to test:**
- `src/nesting/nesting-system.js` (309 lines)
- `src/nesting/nest-points.js` (367 lines)

**Recommended tests:**

```javascript
// tests/nesting-system.test.js

// State transitions
test('transitions from FLYING to APPROACHING when near a nest')
test('transitions from APPROACHING back to FLYING when leaving range')
test('transitions from APPROACHING to LANDING when tryLandOnNest called')
test('transitions from LANDING to NESTED on arrival')
test('transitions from NESTED to TAKING_OFF when takeOff called')
test('transitions from TAKING_OFF to FLYING after timer expires')

// Landing mechanics
test('tryLandOnNest returns false when not in FLYING or APPROACHING state')
test('tryLandOnNest returns false when no nest in range')
test('landing auto-flies toward target position')
test('landing smoothly interpolates quaternion orientation')
test('arrival snaps position and zeroes velocity')

// Take-off mechanics
test('takeOff returns false when not NESTED')
test('takeOff applies boost velocity in surface normal direction')
test('takeOff restores flight speed')

// Edge cases
test('reset clears current nest and returns to FLYING')
test('multiple rapid state changes are handled correctly')
```

**Estimated effort:** Medium - requires mocking flightController and nestPointsSystem

---

### Priority 2: Camera State Management (HIGH IMPACT)

**Why:** Camera behavior directly affects user experience. Mode transitions and damping calculations are complex and prone to regressions.

**Files to test:**
- `src/camera/camera-state.js` (635 lines)
- `src/camera/follow-camera.js` (391 lines)

**Recommended tests:**

```javascript
// tests/camera-state.test.js

// Mode switching
test('setMode transitions between FOLLOW, SEQUENCE, FPV, FIXED')
test('cycleToNextMode cycles through all modes in order')
test('mode transitions use easing function correctly')
test('isTransitioning returns true during mode change')

// Follow camera
test('follow camera maintains correct offset from target')
test('follow camera applies position damping correctly')
test('follow camera applies lookAt damping correctly')
test('velocity look-ahead shifts camera appropriately')
test('steering look-ahead responds to yaw/pitch input')

// Configuration
test('setConfig updates damping and offset values')
test('getSnapshot returns correct state for debug overlay')
```

**Estimated effort:** Medium - requires mocking THREE.js camera and target objects

---

### Priority 3: Collision System (MEDIUM IMPACT)

**Why:** The `SphericalCollisionSystem` is pure logic with no DOM dependencies - easy to test and critical for gameplay feel.

**File to test:**
- `src/environment/spherical-world.js` - `SphericalCollisionSystem` class

**Recommended tests:**

```javascript
// tests/spherical-collision.test.js

// Ground collision
test('checkGroundCollision returns no collision when above surface')
test('checkGroundCollision detects collision below sphere surface')
test('checkGroundCollision corrects position to surface level')
test('checkGroundCollision returns correct surface normal')

// Object collision
test('checkObjectCollision returns no collision when far from objects')
test('checkObjectCollision detects collision with added colliders')
test('checkObjectCollision pushes entity away from object')
test('addCollider and clearColliders manage collider list')

// Combined collision
test('checkAllCollisions handles simultaneous ground and object collision')
test('velocity is reflected with restitution on ground bounce')
test('velocity is zeroed on object collision')
```

**Estimated effort:** Low - pure math, no mocking needed beyond THREE.Vector3

---

### Priority 4: Collectibles System (MEDIUM IMPACT)

**Why:** Ring collection is a core gameplay loop. Testing placement generation and collection logic prevents progression bugs.

**File to test:**
- `src/environment/collectibles.js` (506 lines)

**Recommended tests:**

```javascript
// tests/collectibles.test.js

// Ring placement
test('generateRingPlacements returns correct count for each environment')
test('mountain rings are distributed around peaks')
test('forest rings follow spiral path through canopy')
test('ring positions are within expected bounds')

// Collection
test('ring is marked collected when player passes through')
test('collected rings are not re-collectable')
test('collection triggers particle effect')
test('reset restores all rings to uncollected state')
```

**Estimated effort:** Medium - requires scene mocking for visual tests

---

### Priority 5: Virtual Thumbstick UI (LOW IMPACT)

**Why:** The `VirtualStick` class handles touch input - important for mobile users but lower priority than core systems.

**File to test:**
- `src/controls/virtual-thumbstick.js` - `VirtualStick` class (partially tested)

**Recommended tests:**

```javascript
// tests/virtual-thumbstick.test.js

// Touch handling
test('touch start creates active stick state')
test('touch move updates stick position within bounds')
test('touch end resets stick to center')
test('multiple touches are handled independently')

// Output calculation
test('getAxes returns normalized values between -1 and 1')
test('stick respects deadzone configuration')
test('stick applies expo curve to output')
```

**Estimated effort:** Medium - requires touch event simulation

---

## Test Infrastructure Recommendations

### 1. Add Mock Utilities

Create a shared mock factory for common dependencies:

```javascript
// tests/helpers/mocks.js
export function createMockFlightController() {
  return {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    setSpeed: jest.fn(),
    setOrientation: jest.fn(),
  };
}

export function createMockNestPointsSystem() {
  return {
    getNearestActiveNest: jest.fn(),
    setNestOccupied: jest.fn(),
    update: jest.fn(),
    reset: jest.fn(),
  };
}
```

### 2. Add Integration Tests

Consider adding integration tests that verify multiple systems work together:

```javascript
// tests/integration/flight-to-nest.test.js
test('bird can fly to nest and land successfully')
test('bird can take off from nest and resume flying')
test('camera follows bird during flight and landing')
```

### 3. Add Visual Regression Tests (Optional)

For Three.js visuals, consider screenshot comparison testing:
- Capture reference screenshots of known-good states
- Compare new renders against references
- Flag visual regressions automatically

---

## Implementation Roadmap

1. **Phase 1 - Core Logic** (Highest value)
   - Nesting system state machine tests
   - Collision system tests
   - These are pure logic with minimal mocking

2. **Phase 2 - Camera System**
   - Camera state management tests
   - Follow camera behavior tests

3. **Phase 3 - Gameplay Systems**
   - Collectibles system tests
   - Remaining input handling tests

4. **Phase 4 - Integration**
   - Cross-system integration tests
   - End-to-end gameplay scenarios

---

## Conclusion

The existing flight physics tests are thorough and well-designed. Extending this same quality to the nesting, camera, and collision systems would significantly improve code reliability and make refactoring safer. The recommended priority order focuses on:

1. **User-facing impact** - Systems that directly affect gameplay experience
2. **Testability** - Pure logic modules that are easy to test
3. **Risk** - Complex state machines prone to edge-case bugs

Starting with the nesting system and collision detection would provide the highest value with moderate effort.
