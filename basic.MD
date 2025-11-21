# Basic Thumbstick Birb Flight - Implementation Plan

## Overview
Create a minimal, mobile-first birb flight game at `/basic` that strips down to the absolute essentials while guaranteeing mobile functionality. This will be a completely rewritten, standalone implementation focused on proving the core thumbstick flight mechanic works flawlessly on mobile devices.

---

## Core Requirements

### Must-Have Features
1. **Thumbstick Flight Control** - Virtual on-screen joystick for mobile touch
2. **Basic Physics** - Simplified flight with pitch, yaw, and speed control
3. **3D Bird Model** - Simple geometric bird (no need for complex GLB model)
4. **Follow Camera** - Basic third-person camera that tracks the bird
5. **Environment** - Minimal ground plane and sky for spatial reference
6. **Mobile-First Rendering** - Bulletproof WebGL initialization for mobile browsers

### Explicitly Excluded (Keep It Simple)
- ❌ Collectibles/rings
- ❌ Particle effects (speed trails, vortices)
- ❌ Multiple camera modes
- ❌ Ambient animations/bounce
- ❌ Complex lighting setups
- ❌ Keyboard controls (mobile-only)
- ❌ World shell environment system
- ❌ Score/UI metrics
- ❌ Wing animations
- ❌ Gesture controls (dive, flap) - thumbstick only

---

## Architecture Design

### File Structure
```
/basic/
├── index.html              # Single-file implementation (all-in-one)
└── README.md               # Simple usage instructions
```

**Decision: Single HTML File**
- Inline all JavaScript and CSS
- No external dependencies except THREE.js CDN
- Easier deployment, no build process
- Self-contained and portable

### Technology Stack
- **THREE.js r168** (via CDN import map)
- **Vanilla JavaScript** (ES6 modules)
- **Pure CSS** for UI (no frameworks)
- **Touch Events API** for thumbstick

---

## Implementation Details

### 1. WebGL Initialization (Mobile-Hardened)

Based on recent mobile fixes (commits 7d65f34, 41816af), use this proven pattern:

```javascript
// Step 1: Create and size canvas BEFORE WebGL context
const canvas = document.createElement('canvas');
canvas.width = window.innerWidth * window.devicePixelRatio;
canvas.height = window.innerHeight * window.devicePixelRatio;
canvas.style.width = '100%';
canvas.style.height = '100%';

// Step 2: Test WebGL availability
const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
if (!gl || !gl.getParameter) {
  throw new Error('WebGL not available on this device');
}

// Step 3: Create THREE.js renderer
const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance'
});

// Step 4: Cap pixel ratio for mobile performance
const maxPixelRatio = 1.5; // Mobile optimization
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));

// Step 5: Start render loop after 2 frames (GPU stabilization)
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    startGameLoop();
  });
});
```

**Why this works:**
- Canvas dimensions set before WebGL context creation
- Explicit WebGL availability check prevents silent failures
- Pixel ratio capped at 1.5x reduces mobile GPU load
- Double-rAF delay allows GPU to initialize properly

---

### 2. Virtual Thumbstick Implementation

Adapt the proven `virtual-thumbstick.js` pattern into a minimal inline version:

```javascript
class VirtualThumbstick {
  constructor(container) {
    this.container = container;
    this.baseRadius = 80;    // Base circle size
    this.stickRadius = 30;   // Stick knob size
    this.deadzone = 0.12;    // Ignore tiny movements
    this.active = false;

    this.baseCenter = { x: 0, y: 0 };
    this.stickPosition = { x: 0, y: 0 };
    this.outputValue = { x: 0, y: 0 }; // -1 to 1 range

    this.createElements();
    this.attachEvents();
  }

  createElements() {
    // Base circle (appears on touch)
    this.baseElement = document.createElement('div');
    this.baseElement.className = 'thumbstick-base';
    this.baseElement.style.cssText = `
      position: absolute;
      width: ${this.baseRadius * 2}px;
      height: ${this.baseRadius * 2}px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.1);
      border: 2px solid rgba(255, 255, 255, 0.3);
      display: none;
      pointer-events: none;
    `;

    // Stick knob (moves within base)
    this.stickElement = document.createElement('div');
    this.stickElement.className = 'thumbstick-stick';
    this.stickElement.style.cssText = `
      position: absolute;
      width: ${this.stickRadius * 2}px;
      height: ${this.stickRadius * 2}px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.5);
      border: 2px solid rgba(255, 255, 255, 0.8);
      display: none;
      pointer-events: none;
      transition: opacity 0.1s;
    `;

    this.container.appendChild(this.baseElement);
    this.container.appendChild(this.stickElement);
  }

  attachEvents() {
    // Touch events
    this.container.addEventListener('touchstart', this.onStart.bind(this), { passive: false });
    this.container.addEventListener('touchmove', this.onMove.bind(this), { passive: false });
    this.container.addEventListener('touchend', this.onEnd.bind(this), { passive: false });

    // Mouse events (for desktop testing)
    this.container.addEventListener('mousedown', this.onStart.bind(this));
    this.container.addEventListener('mousemove', this.onMove.bind(this));
    this.container.addEventListener('mouseup', this.onEnd.bind(this));
  }

  onStart(event) {
    event.preventDefault();

    const touch = event.touches ? event.touches[0] : event;
    this.baseCenter = { x: touch.clientX, y: touch.clientY };
    this.stickPosition = { ...this.baseCenter };

    this.active = true;
    this.showThumbstick();
  }

  onMove(event) {
    if (!this.active) return;
    event.preventDefault();

    const touch = event.touches ? event.touches[0] : event;
    const dx = touch.clientX - this.baseCenter.x;
    const dy = touch.clientY - this.baseCenter.y;

    // Constrain stick to base radius
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = this.baseRadius - this.stickRadius;

    if (distance > maxDistance) {
      const angle = Math.atan2(dy, dx);
      this.stickPosition.x = this.baseCenter.x + Math.cos(angle) * maxDistance;
      this.stickPosition.y = this.baseCenter.y + Math.sin(angle) * maxDistance;
    } else {
      this.stickPosition.x = touch.clientX;
      this.stickPosition.y = touch.clientY;
    }

    // Calculate normalized output (-1 to 1)
    const normalizedX = (this.stickPosition.x - this.baseCenter.x) / maxDistance;
    const normalizedY = (this.stickPosition.y - this.baseCenter.y) / maxDistance;

    // Apply deadzone
    const magnitude = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
    if (magnitude < this.deadzone) {
      this.outputValue = { x: 0, y: 0 };
    } else {
      // Scale output after deadzone
      const scale = (magnitude - this.deadzone) / (1 - this.deadzone);
      this.outputValue = {
        x: normalizedX * scale,
        y: normalizedY * scale
      };
    }

    this.updateVisuals();
  }

  onEnd(event) {
    event.preventDefault();
    this.active = false;
    this.outputValue = { x: 0, y: 0 };
    this.hideThumbstick();
  }

  showThumbstick() {
    this.baseElement.style.display = 'block';
    this.stickElement.style.display = 'block';
    this.updateVisuals();
  }

  hideThumbstick() {
    this.baseElement.style.display = 'none';
    this.stickElement.style.display = 'none';
  }

  updateVisuals() {
    // Position base
    this.baseElement.style.left = `${this.baseCenter.x - this.baseRadius}px`;
    this.baseElement.style.top = `${this.baseCenter.y - this.baseRadius}px`;

    // Position stick
    this.stickElement.style.left = `${this.stickPosition.x - this.stickRadius}px`;
    this.stickElement.style.top = `${this.stickPosition.y - this.stickRadius}px`;
  }

  getValue() {
    return this.outputValue;
  }
}
```

**Key Features:**
- Appears where user touches (floating thumbstick)
- Constrained movement within base circle
- Deadzone prevents drift
- Normalized output for flight controls
- Visual feedback with semi-transparent UI
- Works with both touch and mouse

---

### 3. Simplified Flight Physics

Strip down `FreeFlightController` to bare essentials:

```javascript
class BasicFlightController {
  constructor() {
    // Bird state
    this.position = new THREE.Vector3(0, 5, 0);
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();

    // Physics constants
    this.speed = 3.0;              // Forward speed (constant for simplicity)
    this.turnSpeed = Math.PI / 2;  // Radians per second
    this.pitchSpeed = Math.PI / 4; // Half of turn speed
    this.liftForce = 1.5;          // Upward lift from pitch
    this.gravity = 0.5;            // Downward pull

    // Control inputs (set by thumbstick)
    this.yawInput = 0;   // -1 (left) to 1 (right)
    this.pitchInput = 0; // -1 (down) to 1 (up)
  }

  update(deltaTime) {
    // 1. Apply rotation from thumbstick
    const yawDelta = this.yawInput * this.turnSpeed * deltaTime;
    const pitchDelta = this.pitchInput * this.pitchSpeed * deltaTime;

    const yawQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), // Y-axis (world up)
      yawDelta
    );

    const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
      rightAxis,
      -pitchDelta // Negative for intuitive up/down
    );

    this.quaternion.premultiply(yawQuat).multiply(pitchQuat).normalize();

    // 2. Calculate forward direction
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);

    // 3. Calculate vertical velocity (lift vs gravity)
    const lift = this.pitchInput * this.liftForce;
    const verticalVelocity = lift - this.gravity;

    // 4. Update velocity
    this.velocity.copy(forward).multiplyScalar(this.speed);
    this.velocity.y += verticalVelocity;

    // 5. Update position
    this.position.addScaledVector(this.velocity, deltaTime);

    // 6. Prevent going underground
    if (this.position.y < 0.5) {
      this.position.y = 0.5;
      this.velocity.y = Math.max(0, this.velocity.y); // Stop downward velocity
    }

    return {
      position: this.position.clone(),
      quaternion: this.quaternion.clone()
    };
  }

  setInputs(yaw, pitch) {
    this.yawInput = THREE.MathUtils.clamp(yaw, -1, 1);
    this.pitchInput = THREE.MathUtils.clamp(pitch, -1, 1);
  }
}
```

**Simplifications:**
- Constant forward speed (no throttle control)
- No hover mode, dive mode, or flapping
- No banking/roll animations
- Direct gravity vs lift calculation
- Ground collision is simple Y-clamp

---

### 4. Minimal 3D Bird Model

Instead of loading the GLB model, create a simple geometric bird:

```javascript
function createSimpleBird() {
  const bird = new THREE.Group();

  // Body (stretched sphere)
  const bodyGeometry = new THREE.SphereGeometry(0.3, 16, 12);
  bodyGeometry.scale(1, 0.8, 1.5); // Elongate
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a9eff,
    roughness: 0.7,
    metalness: 0.1
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  bird.add(body);

  // Head (smaller sphere)
  const headGeometry = new THREE.SphereGeometry(0.2, 12, 10);
  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.position.set(0, 0.15, -0.4);
  bird.add(head);

  // Beak (cone)
  const beakGeometry = new THREE.ConeGeometry(0.08, 0.25, 8);
  beakGeometry.rotateX(Math.PI / 2);
  const beakMaterial = new THREE.MeshStandardMaterial({
    color: 0xffa500,
    roughness: 0.8
  });
  const beak = new THREE.Mesh(beakGeometry, beakMaterial);
  beak.position.set(0, 0.1, -0.6);
  bird.add(beak);

  // Wings (flat boxes)
  const wingGeometry = new THREE.BoxGeometry(0.8, 0.05, 0.4);
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a7ecf,
    roughness: 0.6
  });

  const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
  leftWing.position.set(-0.5, 0, 0);
  leftWing.rotation.z = 0.2;
  bird.add(leftWing);

  const rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
  rightWing.position.set(0.5, 0, 0);
  rightWing.rotation.z = -0.2;
  bird.add(rightWing);

  // Tail (triangle)
  const tailGeometry = new THREE.ConeGeometry(0.15, 0.4, 3);
  tailGeometry.rotateX(Math.PI / 2);
  const tail = new THREE.Mesh(tailGeometry, wingMaterial);
  tail.position.set(0, 0.1, 0.5);
  bird.add(tail);

  return bird;
}
```

**Benefits:**
- No model loading delays
- Instant initialization
- Small file size
- Easy to debug
- Still recognizable as a bird

---

### 5. Basic Follow Camera

Simplified third-person camera:

```javascript
class SimpleFollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.distance = 8;       // Distance behind bird
    this.height = 3;         // Height above bird
    this.lookAhead = 2;      // How far ahead to look
    this.smoothing = 5;      // Lerp speed

    this.currentPosition = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
  }

  update(birdPosition, birdQuaternion, deltaTime) {
    // Calculate ideal camera position (behind and above bird)
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(birdQuaternion);
    const targetPosition = birdPosition.clone()
      .add(back.multiplyScalar(this.distance))
      .add(new THREE.Vector3(0, this.height, 0));

    // Calculate look-at point (ahead of bird)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(birdQuaternion);
    const targetLookAt = birdPosition.clone()
      .add(forward.multiplyScalar(this.lookAhead));

    // Smooth interpolation
    const t = 1 - Math.exp(-this.smoothing * deltaTime);
    this.currentPosition.lerp(targetPosition, t);
    this.currentLookAt.lerp(targetLookAt, t);

    // Apply to camera
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }
}
```

**Features:**
- Smooth following with exponential smoothing
- Looks ahead in flight direction
- No complex orbit controls
- No camera switching

---

### 6. Minimal Environment

Simple ground and sky:

```javascript
function createEnvironment(scene) {
  // Ground plane
  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a7c59,
    roughness: 0.9,
    metalness: 0.0
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid for spatial reference
  const gridHelper = new THREE.GridHelper(200, 40, 0x333333, 0x222222);
  scene.add(gridHelper);

  // Sky color
  scene.background = new THREE.Color(0x87ceeb);

  // Simple lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
  sunLight.position.set(10, 20, 5);
  scene.add(sunLight);
}
```

**Simplifications:**
- No fog
- No world shell
- No procedural terrain
- Just flat ground with grid
- Basic two-light setup

---

### 7. Game Loop Structure

```javascript
let lastTime = 0;

function gameLoop(currentTime) {
  requestAnimationFrame(gameLoop);

  // Calculate delta (capped at 50ms to prevent physics jumps)
  const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.05);
  lastTime = currentTime;

  if (deltaTime === 0) return; // Skip first frame

  // 1. Read thumbstick input
  const thumbstickValue = thumbstick.getValue();

  // 2. Map thumbstick to flight controls
  //    X-axis = yaw (left/right turn)
  //    Y-axis = pitch (up/down)
  flightController.setInputs(
    thumbstickValue.x,  // Yaw
    -thumbstickValue.y  // Pitch (inverted Y)
  );

  // 3. Update physics
  const pose = flightController.update(deltaTime);

  // 4. Update bird visual
  bird.position.copy(pose.position);
  bird.quaternion.copy(pose.quaternion);

  // 5. Update camera
  camera.update(pose.position, pose.quaternion, deltaTime);

  // 6. Render
  renderer.render(scene, camera.camera);
}
```

**Clean and simple:**
- One clear update sequence
- No complex state management
- No conditional features
- Direct thumbstick → physics → rendering pipeline

---

## Mobile-Specific Optimizations

### Viewport & Scaling
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

### Touch Action Prevention
```css
* {
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
```

### Full-Screen Canvas
```css
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: fixed;
}

#game-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
```

### Handle Orientation Changes
```javascript
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});
```

---

## Testing Strategy

### Phase 1: WebGL Initialization
1. Test on iOS Safari (known to be strict)
2. Test on Android Chrome
3. Verify console shows no WebGL errors
4. Confirm canvas renders basic scene

### Phase 2: Thumbstick
1. Test touch appears at correct location
2. Verify thumbstick constrains to circle
3. Check output values in range [-1, 1]
4. Confirm deadzone works (no drift)

### Phase 3: Flight Physics
1. Verify bird moves forward at constant speed
2. Test yaw (left/right turning)
3. Test pitch (up/down movement)
4. Confirm ground collision prevents going underground
5. Check gravity pulls bird down when no pitch input

### Phase 4: Camera
1. Verify camera follows bird smoothly
2. Check camera stays behind bird during turns
3. Ensure no camera jitter or jumps

### Phase 5: Performance
1. Monitor FPS on mobile (target: 60fps)
2. Check for memory leaks (use DevTools)
3. Test extended play sessions (5+ minutes)
4. Verify no thermal throttling issues

---

## Success Criteria

The `/basic` implementation will be considered successful when:

✅ **Loads on iOS Safari and Android Chrome** without errors
✅ **Thumbstick appears and responds** to touch input
✅ **Bird flies forward continuously** with realistic physics
✅ **Yaw control turns the bird** left and right smoothly
✅ **Pitch control changes altitude** (up/down)
✅ **Camera follows bird** from behind without jitter
✅ **Runs at 60 FPS** on mid-range mobile devices (iPhone 12, Pixel 5)
✅ **No console errors** during 5-minute play session
✅ **Touch input works** without scrolling or zooming the page
✅ **Landscape and portrait modes** both work correctly

---

## Implementation Sequence

### Step 1: Basic Structure (30 minutes)
- Create `/basic/index.html`
- Set up HTML boilerplate with viewport meta tags
- Add THREE.js import map
- Create canvas and basic page structure

### Step 2: WebGL Initialization (20 minutes)
- Implement mobile-hardened renderer creation
- Add WebGL availability check
- Set up scene, camera, lights
- Test render loop with empty scene

### Step 3: Minimal Environment (15 minutes)
- Add ground plane
- Add grid helper
- Set sky color
- Add basic lighting

### Step 4: Simple Bird Model (20 minutes)
- Create geometric bird with primitives
- Position at starting location
- Add to scene
- Test that it's visible

### Step 5: Virtual Thumbstick (45 minutes)
- Implement VirtualThumbstick class
- Add CSS for base and stick elements
- Attach touch/mouse events
- Test output values in console

### Step 6: Flight Physics (40 minutes)
- Implement BasicFlightController class
- Connect thumbstick input to controller
- Test rotation and movement
- Add ground collision

### Step 7: Follow Camera (30 minutes)
- Implement SimpleFollowCamera class
- Connect to bird position/rotation
- Test smooth following behavior

### Step 8: Integration & Polish (30 minutes)
- Connect all systems in game loop
- Add resize handling
- Test on mobile device
- Fix any issues

### Step 9: Documentation (15 minutes)
- Add README.md with instructions
- Document controls
- Add troubleshooting tips

**Total Estimated Time: ~4 hours**

---

## Risk Mitigation

### Risk: WebGL Context Loss on Mobile
**Mitigation:** Add context loss handlers and graceful recovery
```javascript
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.warn('WebGL context lost');
});

canvas.addEventListener('webglcontextrestored', () => {
  console.log('WebGL context restored');
  // Reinitialize if needed
});
```

### Risk: Touch Events Conflict with Page Scrolling
**Mitigation:** Prevent default on all touch events and set CSS `touch-action: none`

### Risk: Low FPS on Older Devices
**Mitigation:**
- Cap pixel ratio at 1.0 if FPS drops below 30
- Reduce antialias quality
- Simplify geometry further if needed

### Risk: Thumbstick Hidden by Hand
**Mitigation:** Keep thumbstick visual simple and semi-transparent so users can see through it

### Risk: Orientation Change Breaks Layout
**Mitigation:** Listen for resize events and update renderer/camera dimensions

---

## Future Enhancements (NOT in Basic Version)

These are explicitly OUT OF SCOPE but could be added later:

- 🔮 Throttle/speed control (second thumbstick or slider)
- 🔮 Collectibles and scoring
- 🔮 Particle effects (speed trails)
- 🔮 Multiple camera views
- 🔮 Sound effects
- 🔮 Procedural terrain
- 🔮 Tutorial overlay
- 🔮 Settings menu
- 🔮 Leaderboards
- 🔮 Gesture controls (dive, boost)

---

## Conclusion

This implementation plan creates a **minimal viable product** for mobile thumbstick flight that:

1. **Focuses on core mechanic** - Get thumbstick flight working perfectly
2. **Mobile-first** - Designed for touch devices from the ground up
3. **Simple and debuggable** - Single file, no complex dependencies
4. **Proven patterns** - Uses working mobile WebGL initialization from recent fixes
5. **Fast to implement** - ~4 hours to complete
6. **Low risk** - No complex features that could break

The `/basic` version serves as a **proof of concept** that validates the thumbstick flight mechanic works on mobile before adding complexity back in.

---

## Ready to Proceed?

Once approved, we'll:
1. Create the `/basic` directory
2. Implement the single HTML file with inline JavaScript
3. Test on mobile devices
4. Iterate based on results

**Estimated implementation time: 4 hours**
**Target: 100% functional thumbstick flight on mobile browsers**
