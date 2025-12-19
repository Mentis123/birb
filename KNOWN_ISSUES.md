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

---

## Issue 2: Climbing Behavior on Joystick Push-Up (Unresolved)

### Problem
When pushing up on the left joystick, the birb does not climb (gain altitude) as users expect. The birb moves forward but doesn't ascend.

### Root Cause Analysis
The left thumbstick Y-axis is mapped to **forward thrust**, not **lift/pitch**:

```javascript
// flight-controls.js ~249
const handleLeftStickChange = (value, context = {}) => {
  const shaped = shapeStickWithContext(value, context, thrustInputShaping);
  const forward = clamp(shaped.y, -1, 1);  // Y-axis → forward (pitch)
  const strafe = clamp(shaped.x, -1, 1);   // X-axis → strafe/roll
  axisSources.leftStick.forward = forward;
  axisSources.leftStick.strafe = strafe;
  axisSources.leftStick.roll = clamp(strafe * effectiveRollSensitivity, -1, 1);
  axisSources.leftStick.lift = 0;  // No direct lift from joystick
  // ...
};
```

Lift is only controlled by:
- Keyboard: Space/E (up), Q (down)
- Touch lift buttons (if present in UI)

### Current State
- Left stick Y feeds `forward` input for **pitch**, not vertical lift.
- Default (checkbox unchecked) is **non-inverted**: pushing up/forward pitches the nose up; down pitches down.
- Checking "Invert pitch" flips to airplane style (push forward to dive, pull back to climb).
- Direct lift is still only on keyboard (Space/E/Q) or touch lift buttons.

### Research Directions
1. **Design decision**: Should joystick-up mean "pitch up" (nose up, gradual climb) or "direct lift" (helicopter-style vertical)?
2. **Mobile flight game conventions**: Research how other mobile gliding games handle single-joystick climb input
3. **User testing**: Determine if users expect pitch control or altitude control from joystick Y

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
| Birb facing direction | Resolved | Medium (rotation math) | Low (re-model) |
| Climb on joystick up | Unresolved | High (add lift mapping) | Medium (physics rework) |

---

## For Future Agents

When working on these issues:
1. **Test on mobile** - These are mobile-first issues
2. **Check both camera modes** - Follow vs FPV may behave differently
3. **Use debug overlays** - Add visual arrows for forward vectors
4. **Small incremental changes** - Each PR should test one hypothesis
5. **Document results** - Update this file with what you tried and observed
