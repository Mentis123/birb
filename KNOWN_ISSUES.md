# Known Issues for Future Agents

This document tracks unresolved issues with attempted fixes, research directions, and fallback strategies.

---

## Issue 1: Birb Facing Direction (Resolved)

### Problem
The birb model did not consistently face the direction of travel. Users expect the beak to point forward (away from camera) when flying, but the model orientation appeared incorrect.

### Root Cause Analysis
- The procedural birb model is sculpted along the **+X axis** (beak pointing toward +X)
- The GLB currently ships facing **-Z** already
- The flight controller uses **-Z as forward** (standard Three.js convention)
- A static quaternion offset (`modelOrientationOffset`) that assumed +X forward rotated the GLB too far, making it face left

### What Has Been Tried

| PR | Commit | Change | Result |
|----|--------|--------|--------|
| #184 | f935afc | Rotated 90° clockwise: `Euler(0, -Math.PI / 2, 0)` | Still facing wrong direction |
| #185 | 1ed3e77 | Reversed to 90° anticlockwise: `Euler(0, Math.PI / 2, 0)` | Still facing wrong direction |
| #213+ | edd724b | Ground/world orientation fixes (not model-facing) | No change to birb heading |
| This branch |  | Dynamically infer the beak direction from the model's bounding box and rotate it toward controller -Z | ✅ Beak now faces away (both GLB and procedural) |

### Current State (after dynamic orientation)
```javascript
// index.html ~1292
const guessedForward = computeModelForwardGuess(birbBounds, birbCenter);
modelOrientationOffset.setFromUnitVectors(guessedForward, targetModelForward);
```

### Resolution Notes
- We now compute the model's dominant axis and which side has greater reach to infer the beak direction.
- A quaternion maps that inferred forward to controller forward (-Z), keeping the birb visually aligned with its actual heading.
- Works for both GLB (already -Z) and procedural (+X) models without manual toggles.

### Additional Fixes (Dec 2024)

**Auto-detection algorithm fix:**
The original algorithm had a bug where symmetric models (like the GLB with spread wings) would fall back to "longest span" detection, incorrectly selecting the X-axis (wingspan) as forward instead of Z-axis (body).

Fixed by:
1. Filtering out Y-axis from forward candidates (birds face horizontally)
2. Preferring Z-axis when biases are similar (standard 3D convention for most models)
3. Only falling back to X-axis for models with clear +X asymmetry (like the procedural model)

**Final fix - GLB model faces -X:**
After extensive testing, the GLB model is actually authored facing **-X** (left), not +X or -Z.

The correct rotation is:
- `guessedForward = (-1, 0, 0)` for GLB
- `setFromUnitVectors((-1,0,0), (0,0,-1))` rotates -X to -Z
- This is 90° clockwise when viewed from above

**Correct behavior:**
- GLB model forward: -X (needs 90° clockwise rotation to face -Z)
- Procedural model forward: +X (needs 90° counter-clockwise rotation to face -Z)
- The code now explicitly sets `guessedForward = (-1, 0, 0)` for GLB models

---

## Issue 2: Climbing Behavior on Joystick Push-Up (Resolved)

### Problem
When pushing up on the left joystick, the birb dove instead of climbing. The pitch direction was inverted.

### Root Cause Analysis
The cross product used to calculate the "right" axis for pitch rotation was in the wrong order:

```javascript
// free-flight-controller.js ~228 (OLD - WRONG)
const right = this._right.crossVectors(up, horizontalForward).normalize();
```

When facing -Z with Y up:
- `up × horizontalForward = (0,1,0) × (0,0,-1) = (-1,0,0)` which is LEFT, not right
- Rotating by positive pitch around the LEFT axis tilts the nose DOWN

### Resolution
Fixed the cross product order to get the correct right vector:

```javascript
// free-flight-controller.js ~228 (NEW - CORRECT)
const right = this._right.crossVectors(horizontalForward, up).normalize();
```

Now:
- `horizontalForward × up = (0,0,-1) × (0,1,0) = (+1,0,0)` which is RIGHT
- Rotating by positive pitch around RIGHT axis tilts the nose UP
- Joystick up → nose up → bird climbs (with forward velocity)

---

## Issue 3: Follow Camera Not Behind Bird (Resolved)

### Problem
The follow camera appeared in front of or to the side of the bird instead of trailing behind it at a nice perspective.

### Root Cause Analysis
The follow camera offset was defined as `(0, 0.6, 2.1)`, intending Z=+2.1 to mean "behind the bird." However, the camera transformation logic works as follows:

```javascript
// follow-camera.js ~140
scratch.lookMatrix.makeBasis(scratch.right, scratch.up, scratch.forward);
scratch.noRollQuaternion.setFromRotationMatrix(scratch.lookMatrix);
scratch.offset.applyQuaternion(scratch.noRollQuaternion);
```

This maps `offset.z` to the bird's **forward** direction, not backward. With Z=+2.1:
- `2.1 * forward = 2.1 * (0, 0, -1) = (0, 0, -2.1)`
- Camera ends up IN FRONT of the bird at world -Z

### Resolution
The offset Z should be positive to position camera behind the bird:
```javascript
// camera-state.js, CAMERA_MODES.FOLLOW
offset: new Vector3(0, 0.6, 2.1)
```

The follow camera transformation correctly maps positive Z offset to the position behind the bird's flight direction.

---

## Summary Table

| Issue | Status | Quick Fix Likelihood | Rebuild Complexity |
|-------|--------|---------------------|-------------------|
| Birb facing direction | Resolved | Medium (rotation math) | Low (re-model) |
| Climb on joystick up | Resolved | Fixed (cross product order) | N/A |
| Follow camera position | Resolved | Fixed (offset sign) | N/A |

---

## Issue 4: Mobile Flight Direction Mismatch (Resolved)

### Problem
On mobile devices, the bird would fly in one absolute direction regardless of which way the model was visually pointed. Users could rotate the visual model, but movement always went toward the same world direction.

### Root Cause Analysis
Two interconnected issues were identified:

1. **Heading never initialized from spawn orientation**: In `FreeFlightController.reset()`, the heading was always set to 0, ignoring any initial orientation quaternion passed to the constructor. This meant the bird always started flying toward -Z regardless of spawn orientation.

2. **GLB model orientation mismatch**: The code assumed the GLB model faced -Z and set `guessedForward = (0, 0, -1)`, resulting in identity offset. But the documentation correctly noted the GLB faces -X. This mismatch was never applied to the code.

### Resolution

**Fix 1: Extract heading from initial quaternion** (`free-flight-controller.js`)
```javascript
// Before (WRONG - always started at heading 0)
this.heading = 0;

// After (CORRECT - extract from initial orientation)
this.heading = extractHeadingFromQuaternion(this._initialQuaternion, this._ambientEuler);
this.pitch = extractPitchFromQuaternion(this._initialQuaternion, this._ambientEuler);
```

Added helper functions to extract Euler angles from quaternions using YXZ order.

**Fix 2: Correct GLB model forward direction** (`index.html`)
```javascript
// Before (WRONG - assumed GLB faces -Z)
const guessedForward = isGLB
  ? new THREE.Vector3(0, 0, -1)
  : computeModelForwardGuess(birbBounds, birbCenter);

// After (CORRECT - GLB faces -X as documented)
const guessedForward = isGLB
  ? new THREE.Vector3(-1, 0, 0)
  : computeModelForwardGuess(birbBounds, birbCenter);
```

**Fix 3: Mobile input diagnostics** (`flight-controls.js`)
Added `DEBUG_MOBILE_INPUT` flag for debugging touch input issues on mobile devices.

### New APIs Added
- `setInitialOrientation(quaternion)` - Set spawn orientation after construction
- `getHeading()` - Get current heading in radians
- `setHeading(radians)` - Set heading directly for teleportation

---

## Summary Table

| Issue | Status | Quick Fix Likelihood | Rebuild Complexity |
|-------|--------|---------------------|-------------------|
| Birb facing direction | Resolved | Medium (rotation math) | Low (re-model) |
| Climb on joystick up | Resolved | Fixed (cross product order) | N/A |
| Follow camera position | Resolved | Fixed (offset sign) | N/A |
| Mobile flight direction | Resolved | Fixed (heading init + GLB offset) | N/A |

---

## For Future Agents

When working on these issues:
1. **Test on mobile** - These are mobile-first issues
2. **Check both camera modes** - Follow vs FPV may behave differently
3. **Use debug overlays** - Add visual arrows for forward vectors
4. **Small incremental changes** - Each PR should test one hypothesis
5. **Document results** - Update this file with what you tried and observed
6. **Enable DEBUG_MOBILE_INPUT** - Set to `true` in `flight-controls.js` to trace mobile input
