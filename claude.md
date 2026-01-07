# CLAUDE.md - Birb Mobile Project Context

## Project Overview
Mobile-first 3D bird flight game built with Three.js. Bird flies on a spherical world.
Target: iOS Safari on Vercel deployment.

## Quick Start
```bash
cd C:\Users\user\Documents\birb
python -m http.server 8000
# Open http://localhost:8000 in browser
# For mobile testing: Edge F12 → Device Emulation → iPhone
```

## Key Files
| File | Purpose |
|------|---------|
| `index.html` | Main game, Three.js scene setup, model loading |
| `free-flight-controller.js` | **Core flight physics** - heading, pitch, velocity |
| `src/controls/flight-controls.js` | Touch input handling (nipplejs joystick) |
| `KNOWN_ISSUES.md` | Bug documentation with fix attempts |

## Architecture
```
Touch Input → flight-controls.js → free-flight-controller.js → Three.js Render
                  ↓                         ↓
            setInputs({yaw,pitch})    quaternion + velocity
```

## CRITICAL OPEN BUG: Flight Direction on Spherical World
**Status**: UNRESOLVED - Multiple fix attempts have failed (Jan 2026)

**Problem**: Bird always flies in absolute world direction, not the direction it's facing. When you turn/bank, the bird keeps going the original direction. **This breaks gameplay entirely.**

**Root Cause Analysis**:
- Current system: `heading (angle) → quaternion → forward direction`
- On flat world: works fine (Y-axis is always "up")
- On sphere: local "up" changes with position, breaking Euler-based heading

**What's Been Tried** (see KNOWN_ISSUES.md Issue 5):
1. Model orientation fixes (`guessedForward` vector changes) - didn't fix
2. Parallel transport compensation for heading drift - didn't fix
3. Building quaternion from local-up axis instead of world Y - didn't fix
4. Direct velocity calculation from `_yawQuaternion` - didn't fix
5. Vector-based `_persistentForward` (Dec 2025) - **implemented but still broken**

**Required Solution** (see FLIGHT_CONTROLS_PLAN.md):
Clean rewrite of spherical flight in isolated module. Track `forward` as persistent Vector3, derive quaternion for rendering only:
```javascript
turn(deltaRadians) {
  const localUp = this.getLocalUp();
  const q = new Quaternion().setFromAxisAngle(localUp, deltaRadians);
  this.forward.applyQuaternion(q).normalize();
  this._projectToTangent(); // Keep forward tangent to sphere
}
// Velocity = forward * speed (directly, not via quaternion)
// Quaternion = derived from forward + up (for rendering only)
```

## Debug Tools
- URL param `?debugVectors` - Shows colored arrow helpers
- `DEBUG_MOBILE_INPUT = true` in flight-controls.js (line 15)
- Console logs: YAW INPUT, HEADING, FORWARD DIR, VELOCITY

## Code Conventions
- Three.js quaternion multiplication: `premultiply` = apply first, `multiply` = apply after
- Euler order: 'YXZ' (yaw around Y, then pitch around X)
- Reuse objects with `_` prefix to avoid GC

## Testing Checklist
- [ ] Bird faces direction of travel
- [ ] Turning changes actual flight direction
- [ ] Works on both poles of sphere
- [ ] Touch input responsive at 60fps
- [ ] No jitter on input release

---

# Flight Quality & Regression Guidance

## Priorities
- **Mobile-first flight feel:** Optimize for touch devices before desktop; interactions should remain responsive at 60fps on midrange phones.
- **Smooth touch controls:** Thumbstick/touch drag should have no dead jitter, predictable centering, and stable acceleration curves with consistent input scaling across pixel densities.
- **Camera mode expectations:** Default camera follows behind the birb with gentle damping, never losing sight of the model; camera transitions must avoid abrupt snaps or horizon flips.
- **Regression checks before merging:** Block merges on any control latency increase, camera jitter, frame pacing drop, or touch gesture misfires observed on target mobile devices.

## Running the Demo
1. From repo root, start a static server (e.g., `python3 -m http.server 8000`).
2. Open `http://localhost:8000/` (or `http://<host>:8000/` on your phone) and load the main `index.html` or `/basic/index.html` experience.
3. Rotate the device to the expected orientation and ensure the page is in full-screen for accurate touch areas.

## What “Good Flight” Looks Like
- Takeoff and turns respond within one frame of touch input; no visible stutter when initiating or releasing input.
- Camera tracks the birb smoothly with minimal oscillation and maintains clear sight lines during banking and dives.
- Speed changes feel continuous (no sudden spikes/drops) and the birb maintains altitude predictably when controls are neutral.
- Touch UI stays anchored under the thumb, never drifting or resizing mid-session.

## Logging & Triaging Control/Render Regressions
- **Capture:** Record device/OS/browser, build SHA, scenario, and a short screen recording showing the issue plus FPS overlay if available.
- **Repro steps:** List exact inputs (touch paths, duration, gestures), camera mode, and environment state (altitude, speed) leading to the problem.
- **Expected vs. actual:** Describe what good behavior would be (per above) and what deviated (lag, wobble, artifact, missing model, etc.).
- **Triage:** File an issue labeled `mobile-regression` and `controls` or `render`. Add severity (P0 crash, P1 major jitter, P2 minor drift) and assign an owner.
- **Verification:** Attach test replay or manual checklist results showing the fix removes the regression without new side effects on target devices.
