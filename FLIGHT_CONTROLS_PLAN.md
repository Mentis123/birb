# Flight Controls & Mobile Experience - Fresh Start Plan

## Executive Summary

A full audit and redesign of controls, display, and flight for a casual mobile browser game targeting Chrome iOS. This plan covers the current state, research findings, and a clear path forward.

---

## Part 1: Current State Audit

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     INPUT SOURCES                            │
├─────────────────────────────────────────────────────────────┤
│ Touch (nipplejs)  │  Keyboard (WASD)  │  Mouse (pointer lock)│
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│               flight-controls.js (801 lines)                 │
│  • Normalizes nipplejs data                                  │
│  • Applies deadzone + expo curve + smoothing                 │
│  • Combines multiple input sources                           │
│  • Mode switching (yaw-only, pitch-only, nest look)         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│            free-flight-controller.js (666 lines)             │
│  • Position, velocity, quaternion management                 │
│  • Vector-based forward direction (spherical world)         │
│  • Heading, pitch, bank tracking                            │
│  • Throttle and sprint mechanics                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   Three.js Render                            │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Lines | Role | Health |
|------|-------|------|--------|
| `free-flight-controller.js` | 666 | Core flight physics | Complex, recently fixed |
| `src/controls/flight-controls.js` | 801 | Input aggregation | Overgrown, needs cleanup |
| `src/controls/thumbstick.js` | 245 | Static thumbstick UI | OK |
| `src/controls/virtual-thumbstick.js` | 288 | Input shaping | OK |
| `index.html` | 1500+ | Everything else | Monolithic, hard to test |

### Current Input Tuning

```javascript
// Joystick settings
DEFAULT_TOUCH_JOYSTICK_DEADZONE = 0.15
DEFAULT_TOUCH_JOYSTICK_EXPO = 0.32
TOUCH_INPUT_SMOOTHING = 0.3
TOUCH_JOYSTICK_SIZE = 120px

// Flight physics
YAW_RATE = π * 0.75 rad/sec (135°/sec)
PITCH_RATE = π * 0.6 rad/sec (108°/sec)
BANK_RESPONSE = 8
MAX_BANK_ANGLE = 65°
BASE_FORWARD_SPEED = 3.5
MAX_FORWARD_SPEED = 7
```

### Resolved Issues

| Issue | Status | Fix |
|-------|--------|-----|
| Birb facing direction | ✅ Resolved | Dynamic orientation detection |
| Climb on joystick up | ✅ Resolved | Cross product order fix |
| Follow camera position | ✅ Resolved | Offset sign fix |
| Mobile flight direction | ✅ Resolved | Heading extraction + GLB offset |

---

## ⚠️ CRITICAL BLOCKING ISSUE: Spherical World Flight Direction

### Status: UNRESOLVED - Must Fix Before Anything Else

### The Problem
On the spherical world, **the bird flies in a fixed absolute direction regardless of which way it's visually facing**. When the user turns (yaw input), the visual model rotates but movement continues in the original direction. The bird appears to "strafe" sideways.

**This breaks gameplay entirely** - you cannot control where you fly on the sphere.

### Root Cause
The heading system uses a **scalar angle** (`this.heading`) interpreted as rotation around **world Y axis**:
```javascript
this._ambientEuler.set(this.pitch, this.heading, 0, 'YXZ');
this.quaternion.setFromEuler(this._ambientEuler);
```

On a spherical world, local "up" changes based on position. World-Y-based heading doesn't correctly represent direction in the local tangent plane.

### What Has Been Tried (Multiple Sessions)

| Approach | Result |
|----------|--------|
| GLB model offset fixes | Visual changed, velocity still wrong |
| Parallel transport compensation | Didn't fix core issue |
| Local-up quaternion building | Visual and velocity still mismatched |
| Direct velocity from `_yawQuaternion` | Partial - forward changes with position but not with heading |
| Vector-based `_persistentForward` | Implemented but **still not working correctly** |

### Debug Tools Available
- URL param `?debugVectors` - Shows colored arrows:
  - Blue: Model forward direction
  - Yellow: Camera forward direction
  - Pink: Velocity direction
- `DEBUG_MOBILE_INPUT = true` in `flight-controls.js:15`
- Console logs for YAW INPUT, HEADING, FORWARD DIR

### The Correct Solution (From Cesium Flight Simulator)

**Track forward direction as a persistent Vector3, not a scalar heading.**

```javascript
class SphericalFlight {
  constructor() {
    this.position = new Vector3();
    this.forward = new Vector3(0, 0, -1);  // Tangent to sphere
    this.speed = 0;
  }

  getLocalUp() {
    return this.position.clone().sub(sphereCenter).normalize();
  }

  turn(deltaRadians) {
    // Rotate forward around local up - THIS IS THE KEY
    const localUp = this.getLocalUp();
    const q = new Quaternion().setFromAxisAngle(localUp, deltaRadians);
    this.forward.applyQuaternion(q).normalize();
    this._projectToTangent();  // Keep forward in tangent plane
  }

  _projectToTangent() {
    const localUp = this.getLocalUp();
    const dot = this.forward.dot(localUp);
    this.forward.addScaledVector(localUp, -dot).normalize();
  }

  update(dt) {
    // Move along forward - velocity IS the forward vector
    this.position.addScaledVector(this.forward, this.speed * dt);
    // Re-project to sphere surface
    const toCenter = this.position.clone().sub(sphereCenter);
    toCenter.normalize().multiplyScalar(sphereRadius);
    this.position.copy(sphereCenter).add(toCenter);
    // Re-project forward to new tangent plane (parallel transport)
    this._projectToTangent();
  }

  getQuaternion() {
    // Derive quaternion FROM forward + up (for rendering only)
    const localUp = this.getLocalUp();
    const localRight = new Vector3().crossVectors(this.forward, localUp).normalize();
    const m = new Matrix4().makeBasis(localRight, localUp, this.forward.clone().negate());
    return new Quaternion().setFromRotationMatrix(m);
  }
}
```

**Key insight**: Current code does `heading → quaternion → forward`.
Correct approach: `forward (updated directly by yaw) → quaternion (derived for rendering)`.

### Why Previous "Fix" Didn't Work

The code has `_persistentForward` but something in the chain is broken:
1. Maybe `_persistentForward` isn't being used for velocity calculation
2. Maybe the parallel transport isn't re-projecting correctly
3. Maybe there's still a path using the old scalar heading
4. Maybe the quaternion is still overriding the vector-based direction

**This needs a ground-up rewrite of the spherical flight path, not patches.**

---

### Remaining Problems (After Fixing Spherical Flight)

1. **Complexity**: 1500+ lines split across files, hard to reason about
2. **Mobile feel**: Not optimized for casual gaming - feels "sim-like"
3. **No haptic feedback**: Missing vibration on iOS
4. **No gyroscope integration**: Device tilt not used
5. **UI density**: Control panel/telemetry clutter on small screens
6. **No progressive disclosure**: All complexity exposed immediately

---

## Part 2: Research Findings - What Works

### Best Casual Flight Control Schemes

**1. Single Joystick + Tilt (Recommended for Casual)**
- Left thumb: virtual joystick for altitude/speed
- Device tilt: banking and turning
- Tap anywhere: boost/action
- Example: "Alto's Adventure" style

**2. Dual Virtual Joysticks (More Control)**
- Left joystick: throttle (Y) + strafe (X)
- Right joystick: pitch (Y) + yaw (X)
- Example: Console-style flight games
- Current birb uses this approach

**3. Swipe + Tap (Simplest)**
- Swipe direction = turn direction
- Tap = altitude change
- Auto-forward movement
- Example: "Flappy Bird" / "Tiny Wings"

### Recommended Stack

| Component | Library | Why |
|-----------|---------|-----|
| Virtual Joystick | **nipplejs** (keep) | Already integrated, no dependencies, works well |
| Gestures | **Hammer.js** (add) | Better swipe/tap detection, prevents conflicts |
| Touch Prevention | **CSS touch-action** | More reliable than JS preventDefault |
| Haptics | **Navigator.vibrate()** | Simple API, works on Chrome/Android |

### Chrome iOS Critical Fixes Needed

```css
/* Must have for Chrome iOS */
#game-canvas {
    touch-action: none;  /* Prevents browser gestures */
}

body {
    overscroll-behavior: none;  /* Prevents pull-to-refresh */
    -webkit-user-select: none;  /* Prevents text selection */
}
```

```javascript
// Edge swipe protection (Safari back gesture)
document.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    if (touch.clientX < 20 || touch.clientX > window.innerWidth - 20) {
        e.preventDefault();
    }
}, { passive: false });
```

### Open Source Examples to Study

| Project | URL | Learn From |
|---------|-----|------------|
| flight-portals | github.com/xpnguinx/flight-portals | Simple flight + touch in single HTML |
| aviator | github.com/feldhaus/aviator | Clean TypeScript architecture |
| airplane-adventure | github.com/ninjarangja/airplane-adventure | Full game loop, power-ups |
| Cesium Flight Simulator | github.com/WilliamAvHolmberg/cesium-flight-simulator | Vector-based spherical flight |
| TouchControls | github.com/mese79/TouchControls | Three.js touch handling |

---

## Part 3: Redesign Recommendations

### Control Scheme Options

**Option A: Simplified Casual (Recommended)**
```
┌─────────────────────────────────────────┐
│                                         │
│                                         │
│           [Game View]                   │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│  [Joystick]                   [Boost]   │
│    Zone                        Button   │
└─────────────────────────────────────────┘

- Single joystick (left thumb): Controls direction
  - X axis: yaw (turning)
  - Y axis: pitch (climb/dive)
- Auto-forward: Bird always flies forward at base speed
- Boost button (right thumb): Speed burst
- Optional: Device tilt for banking feel
```

**Option B: Dual Stick (Current, Refined)**
```
┌─────────────────────────────────────────┐
│                                         │
│           [Game View]                   │
│                                         │
├─────────────────────────────────────────┤
│  [Thrust]                     [Look]    │
│  Joystick                    Joystick   │
└─────────────────────────────────────────┘

- Left stick: Throttle (Y), unused X
- Right stick: Yaw (X), Pitch (Y)
- More complex, sim-like feel
```

**Option C: Swipe Controls (Most Casual)**
```
- Swipe left/right: Turn
- Swipe up/down: Pitch
- Tap: Boost
- Auto-forward, always moving
- Best for hyper-casual feel
```

### Recommended: Option A with Progressive Complexity

1. **Default**: Single joystick + boost (easiest)
2. **Settings toggle**: Enable dual-stick for "advanced" users
3. **Settings toggle**: Enable tilt controls (gyroscope)

### UI Simplification

**Remove/Hide by Default:**
- Heading telemetry panel (debug only)
- Control panel with sliders
- Throttle slider (use auto-throttle or boost instead)

**Keep Visible:**
- Score/distance (if gamified)
- Speed indicator (subtle, minimal)
- Boost meter (if using boost)

**On-Demand (Settings):**
- Camera mode toggle
- Invert pitch toggle
- Sensitivity slider

### Input Feel Tuning for Casual

```javascript
// MORE responsive, less sim-like
const CASUAL_TUNING = {
    deadzone: 0.08,        // Lower = more responsive
    expo: 0.15,            // Lower = more linear feel
    smoothing: 0.15,       // Lower = less lag
    yawRate: Math.PI * 1.0,   // Faster turning
    pitchRate: Math.PI * 0.8, // Faster pitch
    maxBank: 45,           // Less extreme banking
};

// Current (more sim-like)
const SIM_TUNING = {
    deadzone: 0.15,
    expo: 0.32,
    smoothing: 0.3,
    yawRate: Math.PI * 0.75,
    pitchRate: Math.PI * 0.6,
    maxBank: 65,
};
```

---

## Part 4: Implementation Plan

### Phase 0: Fix Spherical Flight Direction (BLOCKING)

**Goal**: Bird flies where it's pointed on the sphere

**This must be done first - nothing else matters until flight works.**

#### Approach: Clean Rewrite of Spherical Flight

1. **Create new isolated module: `src/flight/spherical-flight.js`**
   ```javascript
   // Minimal, tested, no legacy baggage
   export class SphericalFlightController {
     constructor(sphereCenter, sphereRadius) {
       this.position = new Vector3();
       this.forward = new Vector3(0, 0, -1);  // THE source of truth
       this.speed = 0;
       this.sphereCenter = sphereCenter;
       this.sphereRadius = sphereRadius;
     }

     turn(deltaRadians) { /* rotate forward around localUp */ }
     pitch(deltaRadians) { /* tilt forward toward/away from localUp */ }
     update(dt) { /* move position, re-project to sphere */ }
     getQuaternion() { /* derive from forward+up for rendering */ }
   }
   ```

2. **Test in isolation BEFORE integrating**
   - Unit tests: turn → forward changes direction
   - Unit tests: move → stays on sphere surface
   - Unit tests: at poles → doesn't break
   - Visual test: debug arrows match movement

3. **Integration strategy**
   - Add feature flag: `?newFlight=true`
   - Run old and new in parallel, compare outputs
   - Once validated, swap default

4. **Delete old spherical code paths**
   - Remove `_persistentForward` from old controller
   - Remove parallel transport hacks
   - Clean up dead code

#### Key Implementation Details

**The forward vector is truth:**
```javascript
// WRONG (current): heading → quaternion → forward
this._ambientEuler.set(this.pitch, this.heading, 0, 'YXZ');
this.quaternion.setFromEuler(this._ambientEuler);
forwardDirection.set(0, 0, -1).applyQuaternion(this.quaternion);

// RIGHT (new): forward → quaternion (for rendering only)
this.forward.applyQuaternion(turnQuaternion);  // Direct rotation
this.velocity.copy(this.forward).multiplyScalar(this.speed);
this.quaternion = deriveFromBasis(this.forward, localUp);  // For visuals
```

**Parallel transport (re-project forward when localUp changes):**
```javascript
_projectToTangent() {
  const localUp = this.getLocalUp();
  const dot = this.forward.dot(localUp);
  this.forward.addScaledVector(localUp, -dot).normalize();
}
```

**Cross product order matters:**
```javascript
// For right-handed coordinates:
localRight = forward.cross(localUp);   // NOT localUp.cross(forward)
```

#### Acceptance Criteria
- [ ] Turn left → bird flies left (not just looks left)
- [ ] Turn right → bird flies right
- [ ] Works at equator
- [ ] Works at poles (no gimbal lock)
- [ ] Works after flying around the sphere
- [ ] Debug arrows (pink velocity) match visual facing direction

---

### Phase 1: Foundation Cleanup

**Goal**: Clean slate without breaking current functionality

1. **Extract game logic from index.html**
   - Create `src/game/game-loop.js`
   - Create `src/game/scene-setup.js`
   - index.html becomes thin shell

2. **Simplify flight-controls.js**
   - Remove unused code paths
   - Extract nipplejs setup to separate file
   - Create `src/controls/input-manager.js` as single entry point

3. **Add Chrome iOS fixes**
   - CSS touch-action on all interactive elements
   - Edge swipe protection
   - Test on actual iOS device

### Phase 2: Casual Control Mode (Week 2)

**Goal**: Add simplified single-joystick option

1. **Create `src/controls/casual-controls.js`**
   - Single joystick implementation
   - Auto-forward movement
   - Boost button

2. **Add control mode switcher**
   - `?controls=casual` or `?controls=dual`
   - Persist preference in localStorage

3. **Tune feel for casual**
   - Lower deadzone
   - Faster response
   - Less smoothing

### Phase 3: UI Minimalism (Week 3)

**Goal**: Clean, game-like interface

1. **Hide debug panels by default**
   - Telemetry only with `?debug`
   - Control panel in settings menu

2. **Add game UI elements**
   - Speed indicator (minimal)
   - Boost meter (if using)
   - Score/distance (if gamified)

3. **Mobile-first layout**
   - No overlapping elements
   - Touch targets 44px minimum
   - Safe areas for notch/home indicator

### Phase 4: Polish & Juice (Week 4)

**Goal**: Fun factor

1. **Haptic feedback**
   - Vibrate on boost
   - Vibrate on turns (subtle)

2. **Gyroscope option**
   - Device tilt affects bank angle
   - Sensitivity slider

3. **Visual feedback**
   - Speed lines at high velocity
   - Screen tilt with banking
   - Camera shake (subtle)

4. **Audio cues**
   - Wind whoosh based on speed
   - Boost sound
   - Ambient bird sounds

---

## Part 5: Testing Matrix

### Devices to Test

| Device | Browser | Priority |
|--------|---------|----------|
| iPhone (any) | Chrome | **P0** - Primary target |
| iPhone (any) | Safari | P1 |
| Android (mid-range) | Chrome | P1 |
| iPad | Safari | P2 |
| Desktop | Chrome | P2 (regression) |

### Test Checklist

**Controls:**
- [ ] Joystick appears on touch, not on mouse hover
- [ ] No accidental triggers in deadzone
- [ ] Smooth input → movement (no jitter)
- [ ] Boost button responsive
- [ ] No browser gestures interfere (pull-refresh, back-swipe)

**Performance:**
- [ ] 60fps on iPhone 12 or newer
- [ ] 30fps minimum on iPhone 8
- [ ] No frame drops on input
- [ ] Memory stable (no leaks)

**Visual:**
- [ ] Bird faces flight direction
- [ ] Camera follows smoothly
- [ ] No clipping through ground
- [ ] UI readable at all screen sizes

---

## Part 6: Quick Wins (Can Do Now)

### 1. Add CSS Touch Fixes
```css
/* Add to index.html <style> */
body {
    overscroll-behavior: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
}

canvas {
    touch-action: none;
}
```

### 2. Hide Telemetry by Default
```javascript
// Only show with ?debug URL param
const showDebug = new URLSearchParams(location.search).has('debug');
document.querySelector('.heading-telemetry').hidden = !showDebug;
```

### 3. Increase Touch Responsiveness
```javascript
// In flight-controls.js, reduce smoothing for faster feel
const TOUCH_INPUT_SMOOTHING = 0.15; // was 0.3
const DEFAULT_TOUCH_JOYSTICK_DEADZONE = 0.10; // was 0.15
```

### 4. Add Edge Swipe Protection
```javascript
// Add near top of index.html script
document.addEventListener('touchstart', (e) => {
    const x = e.touches[0].clientX;
    if (x < 20 || x > window.innerWidth - 20) {
        e.preventDefault();
    }
}, { passive: false });
```

---

## Decision Points for User

1. **Control scheme**:
   - A) Single joystick + boost (casual) - **Recommended**
   - B) Dual joystick (current, sim-like)
   - C) Swipe controls (hyper-casual)

2. **Gyroscope/tilt controls**:
   - Add as option?
   - Default on or off?

3. **Auto-forward vs manual throttle**:
   - Casual: auto-forward with boost
   - Sim: manual throttle control

4. **Gamification elements**:
   - Score/distance tracker?
   - Collectibles?
   - Obstacles?

---

## Resources

### Documentation
- [MDN: Mobile Touch Controls](https://developer.mozilla.org/en-US/docs/Games/Techniques/Control_mechanisms/Mobile_touch)
- [Chrome: Passive Event Listeners](https://developer.chrome.com/blog/scrolling-intervention)
- [Three.js: Mobile Performance](https://threejs.org/docs/#manual/en/introduction/How-to-create-VR-content)

### Libraries
- [nipplejs](https://github.com/yoannmoinet/nipplejs) - Virtual joystick (currently using)
- [Hammer.js](https://hammerjs.github.io/) - Gesture recognition
- [howler.js](https://howlerjs.com/) - Audio (if adding sounds)

### Example Projects
- [flight-portals](https://github.com/xpnguinx/flight-portals) - Simple Three.js flight
- [aviator](https://github.com/feldhaus/aviator) - TypeScript flight game
- [Three.js joystick demo](https://codepen.io/ogames/pen/rNmYpdo) - Working CodePen

---

*Plan created: January 2026*
*Target: Chrome iOS casual flight game*
