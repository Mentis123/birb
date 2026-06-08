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
| Spherical world velocity mismatch | ✅ Resolved | Fixed in `src/flight/bird-flight.js` | N/A |

---

## Issue 5: Spherical World Velocity Direction Mismatch — ✅ RESOLVED

### History
The bird previously flew in a fixed world direction regardless of facing on the spherical world. This was the longest-running bug in the project, with multiple fix attempts between Dec 2025 - Jan 2026 (see git history).

### Resolution
Fixed in `src/flight/bird-flight.js` — the active flight controller uses vector-based forward direction tracking with parallel transport and sphere re-projection. The bird now flies the direction it faces on the sphere.

The legacy `free-flight-controller.js` still contains the old heading-based approach and debug comments from the investigation. It is kept for reference only.

### Key Learnings
- Scalar heading angles break on curved surfaces — track `forward` as a persistent Vector3
- Derive quaternion FROM the forward vector for rendering, not the other way around
- Parallel transport (re-projecting forward to new tangent plane after movement) is essential

---

## Issue 6: Bird Clips Into / Gets Stuck Inside Terrain Rises — ✅ RESOLVED

### Problem
Flying low into a terrain rise (the carved ground ahead being higher than the
altitude the bird was skimming at), the bird would clip into the mesh and stick /
get force-grounded against it instead of gliding over or around the slope.

### Root Cause Analysis
The terrain is a single shared FBM field clamped to height `<= 0` ("carve down
from a baseline plateau"), used as both the visible mesh AND the flight/collision
floor (`src/environment/spherical-world.js`). Two floors consumed it, and they
disagreed by exactly the bird's radius:

- `src/flight/bird-flight.js` `_floorAt()` returned `sphereRadius + Math.min(0, terrain)`
  — **no clearance**. So the flight controller let the bird's CENTRE descend to
  `sphereRadius + terrain`, i.e. `birdRadius` (0.6) INTO the visible mesh. The
  redundant `Math.min(0, …)` also double-clamped a sampler that is already `<= 0`.
- `spherical-world.js` `checkGroundCollision()` used `sphereRadius + terrain + entityRadius`.

The bird (governed by `BirdFlight`, with `checkGroundCollision` run each frame in
`index.html`'s loop on the live pose) would therefore sink into a rise under its
own floor, then trip the ground check on the next frame, which pushed it out AND
flipped it to `GROUNDED` — reading as "stuck in the mountain." The flight floor
also only ever **snapped** the bird straight up out of penetration; it never
deflected the heading, so a rise hard-stopped forward progress.

(Note: the FBM terrain never actually rises above the baseline — true upward
relief, e.g. mountains/spires/trees, comes from PROPS with their own sphere
colliders handled by `checkObjectCollision`. So "stuck inside terrain" is the
carve-down equivalent of flying into a rise: the bird sinking into higher carved
ground than it was skimming.)

### Resolution
All in `src/flight/bird-flight.js` (plus one constructor arg in `index.html`):

1. **One floor, with clearance.** `_floorAt()` now returns
   `sphereRadius + terrain + birdRadius` (dropping the redundant `Math.min(0,…)`
   since the shared sampler is already clamped `<= 0`). `birdRadius` is a new
   constructor option, wired from `FLIGHT_RECOVERY_CONFIG.birdRadius` so the
   flight floor and `checkGroundCollision` are now the SAME surface — the bird
   skims OVER the mesh it sees and no longer sinks in and force-grounds.
2. **Tangential slide on penetration** (`_deflectAlongTerrain()`): when the bird
   does penetrate the floor, it is pushed out along the local surface normal and
   its forward heading is deflected to remove the into-slope component (re-aimed
   via a minimal quaternion rotation), so it GLIDES over/around the rise instead
   of snapping straight up or hard-stopping. The surface normal is recovered by
   finite-differencing the shared terrain height along two tangents — only on a
   penetration frame, never on the cruise hot path.

### Why this does NOT reintroduce the "ratchet up gentle hills" bug
The floor is still `sphereRadius + terrain + birdRadius` with `terrain <= 0`, i.e.
a constant clearance, never a rise-follower. The gravity-less bird is lifted ONLY
when it is actually below the floor (penetrating), and only by the overlap — it is
never pushed up by ground that rises ahead. Valley/flat skimming feel is unchanged
apart from a fixed `birdRadius` clearance that matches the visible collision body.

### Key Learnings
- Two floors over one terrain field must use the SAME formula (including the
  body-radius clearance) or they fight at the boundary.
- This controller has no velocity vector — movement is orientation-driven, so
  "deflect velocity tangentially" means re-aiming the quaternion's forward, the
  analogue of `spherical-world.js`'s reflect-with-damping ground response.

---

## Historical Notes: Previous Hypotheses

The following were explored before finding the vector-based solution:

1. ~~Visual quaternion includes modelOrientationOffset but velocity doesn't~~
2. ~~The reference forward (world -Z projected onto tangent plane) isn't stable~~
3. **Need to track forward direction as a persistent vector** ✓ THIS WAS THE FIX
4. ~~Multiplication order issue in quaternion combining~~

### Phase 1: Research & Framework Selection

**Questions to Answer:**
1. What 3D frameworks handle spherical world navigation well?
2. What's the best touch control library for iOS/mobile?
3. How do other games solve "flying on a sphere" (e.g., Mario Galaxy, Kerbal Space Program)?

**Frameworks to Evaluate:**

| Framework | Pros | Cons | Research Tasks |
|-----------|------|------|----------------|
| **Three.js** (current) | Already using, large community | Current quaternion issues | Check if examples exist for spherical navigation |
| **Babylon.js** | Built-in physics, good mobile perf | Migration effort | Test touch controls, sphere navigation demos |
| **PlayCanvas** | Mobile-optimized, visual editor | Less low-level control | Check flight/sphere examples |
| **react-three-fiber** | React integration, good for Vercel | Abstraction overhead | Evaluate with Next.js on Vercel |
| **Custom minimal** | Full control, no baggage | More work | Only if frameworks fail |

**Touch Control Libraries to Evaluate:**
- nipplejs (current) - assess if it's the issue
- Hammer.js - gesture recognition
- Native Touch API - maximum control
- Custom virtual joystick implementation

**Reference Implementations to Study:**
- Three.js examples: `misc_controls_fly`, `misc_controls_pointerlock`
- Open source flight games on GitHub
- Unity/Unreal spherical gravity tutorials (concepts transfer)

### Phase 2: Architecture Design

**Core Principles for Rebuild:**
1. **Track direction as a vector, not an angle** - Store `forwardDirection` as Vector3, not `heading` as scalar
2. **Everything in local coordinates** - No world-Y assumptions
3. **Single source of truth** - One orientation drives both visual and physics
4. **Mobile-first input** - Design touch controls before keyboard

**Proposed Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│                    FlightController                      │
├─────────────────────────────────────────────────────────┤
│ State:                                                   │
│   - position: Vector3                                    │
│   - forwardDir: Vector3 (normalized, in tangent plane)  │
│   - speed: number                                        │
│   - localUp: Vector3 (computed from sphere position)    │
│                                                          │
│ Methods:                                                 │
│   - turn(deltaYaw): rotate forwardDir around localUp    │
│   - pitch(deltaPitch): tilt forwardDir toward localUp   │
│   - update(dt): move position along forwardDir          │
│   - getQuaternion(): derive from forwardDir + localUp   │
└─────────────────────────────────────────────────────────┘
```

**Key Insight**: Derive quaternion FROM forward direction, not the other way around. Current code does: heading → quaternion → forward. New code should do: forward (updated directly) → quaternion (for rendering).

### Phase 3: Implementation Plan

**Step 1: Create Isolated Prototype**
- New file: `src/flight/spherical-flight-v2.js`
- Minimal dependencies
- Test in isolation before integrating

**Step 2: Core Flight Math**
```javascript
class SphericalFlight {
  constructor(sphereCenter, sphereRadius) {
    this.position = new Vector3();
    this.forward = new Vector3(0, 0, -1);  // Tangent to sphere
    this.speed = 0;
    this.sphereCenter = sphereCenter;
    this.sphereRadius = sphereRadius;
  }

  getLocalUp() {
    return this.position.clone().sub(this.sphereCenter).normalize();
  }

  turn(deltaRadians) {
    // Rotate forward around local up
    const localUp = this.getLocalUp();
    const q = new Quaternion().setFromAxisAngle(localUp, deltaRadians);
    this.forward.applyQuaternion(q).normalize();
    // Ensure forward stays in tangent plane
    this._projectToTangent();
  }

  _projectToTangent() {
    const localUp = this.getLocalUp();
    const dot = this.forward.dot(localUp);
    this.forward.addScaledVector(localUp, -dot).normalize();
  }

  update(dt) {
    // Move along forward direction
    this.position.addScaledVector(this.forward, this.speed * dt);
    // Re-project to sphere surface
    const toCenter = this.position.clone().sub(this.sphereCenter);
    toCenter.normalize().multiplyScalar(this.sphereRadius);
    this.position.copy(this.sphereCenter).add(toCenter);
    // Re-project forward to new tangent plane
    this._projectToTangent();
  }

  getQuaternion() {
    // Build quaternion from forward + up (for rendering)
    const localUp = this.getLocalUp();
    const localRight = new Vector3().crossVectors(localUp, this.forward).normalize();
    const m = new Matrix4().makeBasis(localRight, localUp, this.forward.clone().negate());
    return new Quaternion().setFromRotationMatrix(m);
  }
}
```

**Step 3: Touch Input Integration**
- Separate input handling from flight math
- Map joystick X → turn(), joystick Y → pitch/speed
- Test on actual iOS device, not just emulator

**Step 4: Integration & Migration**
- Create adapter to match existing API
- Swap in new flight controller
- Remove old code once verified

### Phase 4: Deployment & Testing

**Vercel Setup:**
- Ensure Three.js bundle is optimized
- Test on iOS Safari specifically
- Check touch event handling on actual devices
- Profile frame rate on mid-range phones

**Test Matrix:**
- [ ] iPhone Safari
- [ ] iPhone Chrome
- [ ] Android Chrome
- [ ] Desktop (regression test)
- [ ] Device emulator in Edge/Chrome DevTools

### Resources to Gather

1. **Three.js Spherical Examples**
   - https://threejs.org/examples/ (search for sphere, fly)
   - https://github.com/mrdoob/three.js/tree/dev/examples

2. **Spherical World Navigation Theory**
   - "Parallel transport on sphere" mathematical concept
   - Game dev articles on spherical gravity

3. **Mobile 3D Performance**
   - Three.js performance tips for mobile
   - WebGL best practices for iOS Safari

4. **Similar Open Source Projects**
   - Search GitHub for "three.js flight simulator"
   - Search for "spherical world game javascript"

---

## For Future Agents

When working on these issues:
1. **Test on mobile** - These are mobile-first issues
2. **Check both camera modes** - Follow vs FPV may behave differently
3. **Use debug overlays** - Add visual arrows for forward vectors
4. **Small incremental changes** - Each PR should test one hypothesis
5. **Document results** - Update this file with what you tried and observed
6. **Enable DEBUG_MOBILE_INPUT** - Set to `true` in `flight-controls.js` to trace mobile input
