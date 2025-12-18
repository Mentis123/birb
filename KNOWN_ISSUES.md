# Known Issues for Future Agents

This document tracks unresolved issues with attempted fixes, research directions, and fallback strategies.

---

## Issue 1: Birb Facing Direction (Unresolved)

### Problem
The birb model does not consistently face the direction of travel. Users expect the beak to point forward (away from camera) when flying, but the model orientation appears incorrect.

### Root Cause Analysis
- The procedural birb model is sculpted along the **+X axis** (beak pointing toward +X)
- The flight controller uses **-Z as forward** (standard Three.js convention)
- A quaternion offset (`modelOrientationOffset`) is applied to rotate the model

### What Has Been Tried

| PR | Commit | Change | Result |
|----|--------|--------|--------|
| #184 | f935afc | Rotated 90° clockwise: `Euler(0, -Math.PI / 2, 0)` | Still facing wrong direction |
| #185 | 1ed3e77 | Reversed to 90° anticlockwise: `Euler(0, Math.PI / 2, 0)` | Still facing wrong direction |
| This PR | _pending_ | Removed the yaw offset (identity quaternion) so the model follows the controller forward vector | Aims to flip the bird away from the camera; verify on device |

### Current State (after latest rotation attempt)
```javascript
// index.html:1158-1160
const modelOrientationOffset = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0, Math.PI, 0)  // 180° yaw to face away from camera
);
```

### Why Fixes Haven't Worked
The offset rotation is applied, but there may be multiple issues:
1. The offset may not be applied at the right point in the render pipeline
2. The `positionBirbModel()` function re-centers the model which could affect orientation
3. The `birbAnchor` group orientation vs model orientation confusion
4. Camera follow mode may affect perceived direction

### Research Directions
1. **Verify model axis**: Load the GLTF/procedural model in a test scene and confirm which axis the beak points along
2. **Check quaternion application order**: The offset is multiplied, verify if it should be pre- or post-multiplied
3. **Inspect render loop**: See where `birbAnchor.quaternion` is set from `flightController.quaternion`
4. **Camera perspective**: Confirm issue persists in FPV vs follow camera modes

### Next Fix to Try
```javascript
// Try rotating 180° if beak is pointing backward (toward camera):
const modelOrientationOffset = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0, Math.PI, 0)  // 180° rotation
);

// Or try different axis combinations:
const modelOrientationOffset = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0, -Math.PI / 2, Math.PI)  // Combined Y and Z rotation
);
```

### Fallback: Rebuild with Best Practices
If simple rotations don't fix it:
1. Re-model the bird with beak pointing along **-Z axis** (Three.js forward)
2. Or create a wrapper group with explicit forward vector documentation
3. Add visual debug helpers (arrows showing model forward vs controller forward)

---

## Issue 2: Climbing Behavior on Joystick Push-Up (Unresolved)

### Problem
When pushing up on the left joystick, the birb does not climb (gain altitude) as users expect. The birb moves forward but doesn't ascend.

### Root Cause Analysis
The left thumbstick Y-axis is mapped to **forward thrust**, not **lift/pitch**:

```javascript
// flight-controls.js:151-157
const handleLeftStickChange = (value, context = {}) => {
  const forward = clamp(-value.y, -1, 1);  // Y-axis → forward
  const strafe = clamp(-value.x, -1, 1);   // X-axis → strafe
  axisSources.leftStick.forward = forward;
  axisSources.leftStick.strafe = strafe;
  axisSources.leftStick.lift = 0;  // Lift is ALWAYS 0 from joystick!
  // ...
};
```

Lift is only controlled by:
- Keyboard: Space/E (up), Q (down)
- Touch lift buttons (if present in UI)

### What Has Been Tried

| PR | Commit | Change | Result |
|----|--------|--------|--------|
| #186 | 1cfd753 | Added `LIFT_ACCELERATION_MULTIPLIER = 1.8` | Only affects lift buttons/keys, not joystick |
| This branch | TBD | Pitch-up approach: joystick Y applies pitch via `addLookDelta` | Testing |

### Current State (as of this branch)
```javascript
// free-flight-controller.js:28,192
export const LIFT_ACCELERATION_MULTIPLIER = 1.8;
// ...
acceleration.addScaledVector(up, smoothed.lift * LIFT_ACCELERATION_MULTIPLIER);
```

### Why the Fix Didn't Work
The multiplier increases lift **authority**, but the left joystick never sends lift input. The joystick Y-axis is mapped to `forward` only.

### Research Directions
1. **Design decision**: Should joystick-up mean "pitch up" (nose up, gradual climb) or "direct lift" (helicopter-style vertical)?
2. **Mobile flight game conventions**: Research how other mobile gliding games handle single-joystick climb input
3. **User testing**: Determine if users expect pitch control or altitude control from joystick Y

### Current Implementation (Option B: Pitch-up approach)

The pitch-up approach is now implemented:
```javascript
// flight-controls.js - tracks pitch from left stick
leftStickPitchState.pitch = forward;  // joystick Y → pitch state

// applyLeftStickPitch called each frame applies pitch rotation
flightController.addLookDelta(0, -pitch * DEFAULT_LEFT_STICK_PITCH_SPEED * limitedDelta);
```

This causes the bird's nose to pitch up when pushing joystick up, which combined with the cruise forward speed results in natural climbing.

### Alternative Approaches (if pitch doesn't feel right)

**Option A: Map joystick Y to lift (helicopter-style)**
```javascript
axisSources.leftStick.lift = forward * 0.5;  // Direct vertical lift
```

**Option C: Split joystick axes**
- Y-axis upper half → lift (climbing)
- Y-axis lower half → brake/dive
- Separate forward thrust to always-on cruise mode

### Fallback: Rebuild with Best Practices
If simple mappings cause control issues:
1. Research mobile flight games (e.g., Alto's Adventure, Tiny Wings) for control schemes
2. Implement "pitch-to-climb" physics where joystick Y tilts the bird nose up/down
3. Forward velocity + pitch angle = climb rate (realistic gliding physics)
4. Consider two-joystick layout: left = thrust/strafe, right = pitch/yaw

---

## Summary Table

| Issue | Status | Quick Fix Likelihood | Rebuild Complexity |
|-------|--------|---------------------|-------------------|
| Birb facing direction | Unresolved | Medium (rotation math) | Low (re-model) |
| Climb on joystick up | Unresolved | High (add lift mapping) | Medium (physics rework) |

---

## For Future Agents

When working on these issues:
1. **Test on mobile** - These are mobile-first issues
2. **Check both camera modes** - Follow vs FPV may behave differently
3. **Use debug overlays** - Add visual arrows for forward vectors
4. **Small incremental changes** - Each PR should test one hypothesis
5. **Document results** - Update this file with what you tried and observed
