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

### Additional Fix (Dec 2024)
The original algorithm had a bug where symmetric models (like the GLB with spread wings) would fall back to "longest span" detection, incorrectly selecting the X-axis (wingspan) as forward instead of Z-axis (body).

Fixed by:
1. Filtering out Y-axis from forward candidates (birds face horizontally)
2. Preferring Z-axis when biases are similar (standard 3D convention for most models)
3. Only falling back to X-axis for models with clear +X asymmetry (like the procedural model)

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

## Summary Table

| Issue | Status | Quick Fix Likelihood | Rebuild Complexity |
|-------|--------|---------------------|-------------------|
| Birb facing direction | Resolved | Medium (rotation math) | Low (re-model) |
| Climb on joystick up | Resolved | Fixed (cross product order) | N/A |

---

## For Future Agents

When working on these issues:
1. **Test on mobile** - These are mobile-first issues
2. **Check both camera modes** - Follow vs FPV may behave differently
3. **Use debug overlays** - Add visual arrows for forward vectors
4. **Small incremental changes** - Each PR should test one hypothesis
5. **Document results** - Update this file with what you tried and observed
