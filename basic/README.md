# Basic Birb Flight - Mobile Thumbstick Demo

A minimal, mobile-first implementation of thumbstick-controlled bird flight. This is a stripped-down version designed to prove the core flight mechanic works flawlessly on mobile devices.

## 🎮 Controls

### Mobile (Touch)
- **Touch anywhere on screen** - Virtual thumbstick appears
- **Drag left/right** - Yaw (turn the bird)
- **Drag up/down** - Pitch (control altitude)
- Bird flies forward automatically at constant speed

### Desktop (Mouse)
- **Click and drag** anywhere - Same as touch controls
- Works identically to mobile for testing

## 🚀 How to Use

### Option 1: Direct File Access
Simply open `index.html` in your mobile browser:
```
file:///path/to/birb/basic/index.html
```

### Option 2: Local Server (Recommended)
Serve from the `/basic` directory:
```bash
# Python 3
python -m http.server 8000

# Node.js
npx http-server -p 8000

# PHP
php -S localhost:8000
```

Then visit: `http://localhost:8000` on your mobile device (use your computer's IP address).

### Option 3: GitHub Pages
If this repository is on GitHub, you can access it at:
```
https://[username].github.io/birb/basic/
```

## 📱 Mobile Testing

### iOS Safari
1. Open Safari on your iPhone/iPad
2. Navigate to the URL
3. Touch anywhere and drag to fly
4. Works in both portrait and landscape

### Android Chrome
1. Open Chrome on your Android device
2. Navigate to the URL
3. Touch anywhere and drag to fly
4. Works in both portrait and landscape

## ✨ Features

- ✅ Virtual floating thumbstick (appears where you touch)
- ✅ Smooth flight physics with pitch and yaw control
- ✅ Third-person follow camera
- ✅ Simple geometric bird (no loading delays)
- ✅ Ground collision prevention
- ✅ FPS counter and flight metrics display
- ✅ Mobile-optimized WebGL rendering
- ✅ Responsive layout (portrait and landscape)
- ✅ Works offline (single HTML file)

## 🎯 Flight Tips

1. **Take Off**: Drag up on the thumbstick to pitch up and gain altitude
2. **Turn**: Drag left or right to yaw (turn) in that direction
3. **Descend**: Drag down to pitch down and lose altitude
4. **Level Flight**: Keep the thumbstick centered to maintain altitude
5. **Ground Collision**: Bird will stop at 0.5m above ground to prevent crashing

## 🔧 Technical Details

### Architecture
- **Single HTML File**: All code inline (no build process required)
- **THREE.js r168**: Loaded via CDN (no npm needed)
- **Pure JavaScript**: ES6 modules, no frameworks
- **Mobile-First**: Touch controls only, optimized for mobile GPU

### Performance
- **Target**: 60 FPS on mid-range mobile devices
- **Pixel Ratio**: Capped at 1.5x on mobile for performance
- **Physics**: Constant forward speed with lift/gravity simulation
- **Rendering**: WebGL with basic lighting (2 lights only)

### Browser Compatibility
- ✅ iOS Safari 14+
- ✅ Android Chrome 90+
- ✅ Desktop Chrome/Firefox/Edge (for testing)
- ⚠️ Requires WebGL support

## 🐛 Troubleshooting

### "WebGL is not available" Error
- Your device doesn't support WebGL
- Try a different browser or device
- Update your browser to the latest version

### Thumbstick Not Appearing
- Make sure you're touching inside the canvas area
- Try refreshing the page
- Check browser console for errors (Safari: Settings > Advanced > Web Inspector)

### Low FPS / Laggy
- Close other apps to free up memory
- Try reducing screen brightness (reduces GPU load)
- Restart your browser
- The game automatically caps pixel ratio at 1.5x for mobile

### Bird Falls Through Ground
- This shouldn't happen (collision at y=0.5)
- If it does, please report the issue

### Screen Scrolls When Touching
- The page should prevent scrolling with `touch-action: none`
- If scrolling occurs, try fullscreen mode or different browser

## 📊 On-Screen Info

- **FPS**: Frames per second (should be ~60)
- **Altitude**: Height above ground in meters
- **Speed**: Current velocity in meters per second

## 🎨 What's Different from Full Version?

This basic version intentionally excludes:
- ❌ Collectibles/rings
- ❌ Particle effects (speed trails)
- ❌ Multiple camera modes
- ❌ Keyboard controls
- ❌ Complex animations
- ❌ Score/leaderboards
- ❌ Sound effects
- ❌ Procedural terrain
- ❌ Throttle/speed control

**Focus**: Prove the core thumbstick flight mechanic works perfectly on mobile.

## 📝 Implementation Notes

Based on proven patterns from the main birb codebase:
- WebGL initialization from commits 7d65f34, 41816af
- Virtual thumbstick adapted from `src/controls/virtual-thumbstick.js`
- Flight physics simplified from `free-flight-controller.js`
- Camera system simplified from `src/camera/follow-camera.js`

## 🚀 Next Steps

If this basic version works well on mobile, you can:
1. Add throttle control (second thumbstick or slider)
2. Implement collectibles/rings
3. Add particle effects for visual feedback
4. Integrate with the main birb game
5. Add sound effects and music

## 📄 License

Same as parent project.

## 🙋 Support

If you encounter issues:
1. Check the browser console for errors
2. Try the troubleshooting steps above
3. Report issues with device/browser info

---

**Enjoy flying! 🐦**
