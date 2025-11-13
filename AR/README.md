# AR Shooter Game

A browser-based augmented reality shooting game that uses your phone's camera and gyroscope to create an immersive experience.

## Features

- 📱 Mobile-first design (iOS & Android)
- 📷 Camera feed with 3D overlay
- 🎯 Gyroscope-based aiming
- 🎮 Floating target shooting
- 🏆 Score tracking
- ⚡ Optimized performance

## Requirements

- Mobile device (phone or tablet)
- Modern browser (Chrome, Safari, Samsung Internet)
- HTTPS connection (required for camera/gyro access)
- Camera permission
- Motion sensor permission (iOS requires explicit grant)

## Browser Compatibility

| Feature | Android Chrome | Android Samsung | iOS Safari | iOS Chrome |
|---------|---------------|-----------------|------------|------------|
| Camera  | ✅ | ✅ | ✅ | ✅ |
| Gyro    | ✅ (auto) | ✅ (auto) | ✅ (permission) | ✅ (permission) |
| WebGL   | ✅ | ✅ | ✅ | ✅ |

## Project Structure

```
/AR/
├── index.html          # Landing page with device checks
├── test-camera.html    # Camera feed test
├── test-gyro.html      # Gyroscope test with 3D cube
├── test-3d.html        # Three.js rendering test
├── game.html           # Full AR game
├── js/
│   ├── camera.js       # Camera management utilities
│   ├── gyro.js         # Gyroscope utilities
│   ├── scene.js        # Three.js scene management
│   └── game.js         # Game logic and effects
└── css/
    └── style.css       # Shared styles
```

## Getting Started

### Development

1. Ensure the project is served over HTTPS (required for camera/gyro)
2. Open `index.html` on your mobile device
3. Run device compatibility checks
4. Use test pages to validate individual features
5. Play the game at `game.html`

### Testing Individual Features

- **Camera Test**: `test-camera.html`
  - Verifies camera access
  - Shows resolution and facing mode
  - Switch between front/rear cameras

- **Gyroscope Test**: `test-gyro.html`
  - Tests device orientation sensors
  - Displays alpha/beta/gamma values
  - Visualizes rotation with 3D cube

- **3D Rendering Test**: `test-3d.html`
  - Tests WebGL performance
  - Shows FPS counter
  - Displays floating animated cubes

### Playing the Game

1. Navigate to `game.html`
2. Grant camera permission when prompted
3. Grant motion sensor permission (iOS only)
4. Look around using your device to find targets
5. Align the crosshair with a target
6. Tap the FIRE button to shoot
7. Score points for each hit!

## How It Works

### Camera Feed
- Uses `navigator.mediaDevices.getUserMedia()` API
- Requests rear camera (`facingMode: 'environment'`)
- Displays as full-screen background video element

### Gyroscope Tracking
- Uses `DeviceOrientationEvent` API
- iOS 13+ requires `requestPermission()` on user interaction
- Android provides automatic access
- Maps device rotation to Three.js camera orientation

### 3D Rendering
- Three.js for WebGL rendering
- Transparent canvas overlay on camera feed
- Objects positioned relative to player (viewer reference space)
- Optimized for mobile (low poly, efficient lighting)

### Game Mechanics
- Targets spawn in hemisphere in front of player (2-5 units away)
- Floating animation using sine waves
- Raycasting from camera center for hit detection
- Visual feedback (screen flash) and haptic feedback (vibration)
- Continuous respawning to maintain target count

## Technical Details

### Performance Optimizations
- Target 30+ FPS on mobile devices
- Pixel ratio capped at 2x for performance
- Object pooling for targets (reuse geometry/materials)
- Efficient lighting (ambient + single directional)
- Low-poly geometry (0.3 unit cubes)

### Coordinate System
- Three.js uses right-handed Y-up coordinate system
- Device orientation provides Euler angles (alpha, beta, gamma)
- Quaternions used to avoid gimbal lock
- Screen orientation handled for portrait/landscape

### Known Limitations
- Gyro drift over time (minimal impact for short sessions)
- No positional tracking (rotation only, no walking around)
- No plane detection (objects don't anchor to real world)
- iOS Safari lacks WebXR support (falls back to DeviceOrientation)

## Troubleshooting

### Camera not working
- Ensure HTTPS is enabled
- Check browser permissions
- Try switching between front/rear camera
- Verify camera not in use by another app

### Gyroscope not working
- iOS: Must tap button to request permission
- Android: Should work automatically
- Check device has gyroscope (some budget devices don't)
- Try locking/unlocking screen orientation

### Low FPS
- Close other apps to free memory
- Reduce number of targets in scene
- Disable browser extensions
- Try different browser (Chrome usually best)

### Targets not visible
- Look around slowly - they spawn in front of you
- Adjust brightness if outdoors in bright light
- Ensure 3D rendering test works (WebGL check)

## Future Enhancements

Possible improvements:
- [ ] Difficulty levels (target speed, size)
- [ ] Power-ups and special targets
- [ ] Multiplayer support
- [ ] Leaderboards
- [ ] Sound effects toggle
- [ ] Tutorial/first-time user experience
- [ ] Different target types
- [ ] Timer-based game modes
- [ ] Achievements system

## Dependencies

- [Three.js](https://threejs.org/) (r128) - 3D rendering library
- Native Web APIs:
  - getUserMedia (camera)
  - DeviceOrientation (gyroscope)
  - WebGL (3D graphics)
  - Vibration API (haptic feedback)
  - Web Audio API (sound effects)

## Credits

Built with ❤️ using web standards and open source technologies.

## License

MIT License - feel free to use and modify!
