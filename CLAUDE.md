# CLAUDE.md — Birb Mobile

> Context for AI assistants and Vibe Academy builders. Read this first.

## This Is a Birb Labs Artefact

Birb Mobile is a **breakable toy** — a real, shipped, playable game that also serves as a learning artefact inside Vibe Academy. It exists so people can inspect real code, run it, break it, rebuild it, and learn from it.

**Play it:** https://birbmobile.vercel.app
**Repo:** git@github.com:Mentis123/birb.git
**Ecosystem:** Part of the Vibe ecosystem (vibeacademy.com.au)

## What This Is

A mobile-first 3D bird flight game built with Three.js. A bird flies on a spherical world — you control it with touch (virtual joystick), collect rings, shoot rockets from nests, and fight drones. Four game modes: Casual free flight, Ring Rush (timed collection), Drone Hunter (60s survival), Turret Defense (wave-based).

**Target platform:** iOS Safari (iPhone 12+), Android Chrome, desktop for testing.
**Deploy:** Vercel static hosting. Push to main → auto-deploys.

## Who Made This

**Mentis** (Adam Rappaport) — call him Mentis, not Adam.

## House Rules

1. **Never test locally unless you must** — push to git, Vercel auto-deploys at birbmobile.vercel.app
2. **Git remote uses SSH** — `git@github.com:Mentis123/birb.git`
3. **Mobile-first always** — touch devices are primary, desktop is for testing only
4. **Zero-allocation game loop** — reuse objects with `_` prefix, never allocate in update()
5. **No build step** — this is vanilla JS with ES6 imports from CDN. No webpack, no bundler.
6. **Preserve the fun** — this is a game. Changes should make it more delightful, not more complex.

## Product Intent

Birb Mobile should feel **playful, responsive, and alive**. The bird should feel good to fly. The turret should feel heavy and satisfying. The rings should feel rewarding to collect. Performance must hold 60fps on mid-range mobile.

**Non-goals:** Realistic flight simulation, desktop-first design, unnecessary abstractions that make learning harder, framework dependencies.

## Architecture Overview

**Stack:** Three.js (WebGL), vanilla JavaScript (ES6 modules), HTML5 Audio, nipplejs (virtual joystick). No frameworks, no build tools.

**Entry point:** `index.html` — single-file game (~5600 lines). Imports modular systems from `src/`.

```
index.html (main game loop, scene setup, state coordination)
├── src/flight/          Flight physics, bird visuals, touch input
├── src/controls/        Input aggregation, joystick, thumbstick UI
├── src/camera/          Follow cam, FPV cam, mode switching
├── src/nesting/         Nest landing, turret aiming, rockets, drones
├── src/environment/     Spherical world, sky dome, collectibles, trails
├── src/effects/         Particles, screen shake
├── src/performance/     FPS monitor, object pools, LOD, culling
├── sound/               Audio assets (mp3)
├── basic/               Minimal reference implementation
├── AR/                  Experimental AR branch (not integrated)
└── docs/                Technical documentation
```

**Data flow:**
```
Touch Input → flight-controls.js → bird-flight.js → Three.js Render
                                        ↓
                                 position + quaternion
                                        ↓
                              camera, collectibles, drones
```

**Key CDN imports:**
- `three@0.161.0` from esm.sh
- `nipplejs@0.10.1` from esm.sh
- GLTFLoader from Three.js examples

## Key Files

| File | What It Does |
|------|-------------|
| `index.html` | Main game — scene, loop, UI, audio, all systems coordinated |
| `src/flight/bird-flight.js` | Current flight controller (vector-based) |
| `free-flight-controller.js` | Legacy flight controller (heading-based, has spherical bug) |
| `src/controls/flight-controls.js` | Input handling — joystick, keyboard, smoothing, deadzones |
| `src/camera/follow-camera.js` | Third-person chase camera with damping |
| `src/nesting/nesting-system.js` | Nest landing/takeoff state machine |
| `src/nesting/aim-rig.js` | Turret aiming with spring-damper inertia |
| `src/nesting/rocket.js` | Projectile system with arc trajectory |
| `src/nesting/drone-system.js` | Enemy drone spawning and AI |
| `src/environment/spherical-world.js` | Sphere + collision system |
| `src/environment/collectibles.js` | Ring collection with proximity detection |
| `src/performance/performance-manager.js` | FPS monitoring, adaptive quality |
| `src/performance/object-pool.js` | Reusable object pools (rockets, particles) |
| `KNOWN_ISSUES.md` | Bug tracker with detailed fix attempts |
| `FLIGHT_CONTROLS_PLAN.md` | 4-phase flight system redesign plan |
| `TURRET_RESEARCH.md` | Gun feel research, spring-damper physics |
| `docs/PRD-game-modes.md` | Game mode specifications |
| `basic/index.html` | Minimal reference implementation (single-file) |

## Critical Open Bug

**Spherical flight direction** — the bird always flies in the same absolute world direction regardless of facing. Turning rotates the model visually but doesn't change movement direction. This breaks gameplay on the sphere.

**Root cause:** Heading is a scalar angle rotated around world Y-axis. On a sphere, local "up" changes with position, so Euler-based heading breaks.

**Required fix:** Track forward direction as a persistent Vector3. Yaw rotates forward around local-up (not world Y). Derive quaternion from forward+up for rendering only. See `FLIGHT_CONTROLS_PLAN.md` Phase 0 and `KNOWN_ISSUES.md` Issue 5 for full analysis.

## Key Technical Patterns

**Zero-allocation game loop:** All vectors and quaternions pre-allocated in constructors with `_` prefix. No `new Vector3()` in update(). Target: <1ms GC per frame on mobile.

**iOS audio:** Web Audio API doesn't work on iOS Safari. Use HTML Audio elements with a `Set` reference pool to prevent garbage collection clipping sounds.

**Control feel tuning:**
```
Forward speed: 3.5-7 m/s    Yaw rate: 135°/sec
Pitch rate: 108°/sec         Max bank: 65°
Joystick deadzone: 0.15      Expo curve: 0.32
Input smoothing: 0.3
```

**Turret feel:** Spring-damper system (C0=8.0 stiffness, C1=6.0 damping). Heavy, inertial, momentum carry-through on release. See `TURRET_RESEARCH.md`.

**Performance budget:** 60fps, <100 draw calls, <80k triangles, <50MB heap, <16ms frame time.

**Mobile rendering:** DPR capped at 1.4 (mobile) / 1.8 (desktop). Adaptive quality via performance manager.

## Environment Variables

None — this is a static site with no backend.

## How to Run

```bash
# Local (for testing only — prefer pushing to Vercel)
python3 -m http.server 8000
# Open http://localhost:8000 on mobile or desktop
```

For mobile testing: use Edge DevTools device emulation, or access via local network IP on phone.

## Safe Change Zones

**Safe to edit:**
- Copy/text in UI overlays (in `index.html` HTML section)
- Visual styling (CSS in `index.html`)
- Tuning constants (speeds, rates, deadzones in controllers)
- Sound effects (swap mp3 files in `sound/`)
- Particle effects and visual juice
- Game mode balancing (scoring, timers, spawn rates)

**Edit carefully:**
- `src/flight/` — flight physics affect everything
- `src/nesting/nesting-system.js` — state machine is delicate
- `src/controls/flight-controls.js` — input pipeline affects feel
- Camera systems — bad changes cause motion sickness

**Never touch without explicit permission:**
- Three.js import URLs (version pinned for stability)
- Performance manager thresholds (tuned for mobile)
- The `_` prefixed pre-allocated objects (zero-allocation pattern)

## Common Tasks

| Task | Where to Look |
|------|--------------|
| Tweak flight feel | `src/flight/bird-flight.js` — speed, rates, damping |
| Adjust turret feel | `src/nesting/aim-rig.js` — spring-damper constants |
| Add a sound effect | `sound/` folder + audio system in `index.html` (~line 1198) |
| Change game mode balancing | `index.html` game mode sections + `docs/PRD-game-modes.md` |
| Improve mobile controls | `src/controls/flight-controls.js` — deadzone, expo, smoothing |
| Add visual effect | `src/effects/particles.js` or `src/effects/screen-shake.js` |
| Fix a camera issue | `src/camera/follow-camera.js` or `fpv-camera.js` |
| Performance optimization | `src/performance/` — pools, LOD, culling |

## Code Conventions

- **Three.js quaternion:** `premultiply` = apply first, `multiply` = apply after
- **Euler order:** `'YXZ'` (yaw around Y, then pitch around X)
- **Object reuse:** `_` prefix for pre-allocated scratch objects (e.g., `_tempVec`, `_tempQuat`)
- **No `new` in update loops** — ever
- **ES6 modules** from CDN — no bundler, no build step
- **Squared distance** for proximity checks (avoid `Math.sqrt`)

## Known Issues

1. **Spherical flight direction bug** (CRITICAL) — see above
2. Eruda debug console still enabled in `index.html` — remove after flight fix confirmed
3. iOS audio full duration testing incomplete

See `KNOWN_ISSUES.md` for detailed history and fix attempts.

---

## Notes for Vibe Academy

This is a **breakable toy** — a real, playable game you can pull down, modify, and make your own. The whole point is to get your hands in it. Below are things to try, roughly ordered from "I've never touched code" to "I want a real challenge."

### First Steps (Do These First)

1. **Play it** — open birbmobile.vercel.app on your phone. Fly around. Try all four game modes (Casual, Ring Rush, Drone Hunter, Turret Defense). Get a feel for what it does.
2. **Clone and run it** — `git clone git@github.com:Mentis123/birb.git`, then `python3 -m http.server 8000` and open it in your browser. You're now running the game locally.
3. **Open `basic/index.html`** — this is the stripped-down version. Read it top to bottom. It's the simplest possible flight game — one file, no complexity. This is your Rosetta Stone.

### Things to Try: Reskin & Retheme

These are visual/audio changes — low risk, high reward, instant gratification.

- **Change the world colour** — find the sky dome setup in `src/environment/sky-dome.js`. Change the sky gradient. Make it sunset orange. Make it alien green. Push it and see your world on Vercel.
- **Swap the music** — drop a new mp3 into `sound/` and update the ambient music reference in `index.html` (search for `ambient-forest`). Your world, your soundtrack.
- **Change the ring collect sound** — replace `sound/ring-collect.mp3` with any short sound effect. A coin ding? A whoosh? A voice saying "nice"?
- **Modify the rocket explosion** — in `index.html`, find the explosion particle effect. Change the colour, the size, the count. Make it fireworks. Make it confetti.
- **Restyle the UI** — the game mode selector, the score display, the splash screen — it's all CSS in `index.html`. Retheme it. Dark mode? Neon? Retro?

### Things to Try: Tweak the Feel

These change how the game *feels*. Small numbers, big impact. Great way to understand game design.

- **Make the bird faster** — in `src/flight/bird-flight.js`, find the speed constants. Double them. Now halve them. Which feels better? Why?
- **Change how tight the turns are** — find `YAW_RATE` and `PITCH_RATE`. Crank them up for an arcade feel. Lower them for a floaty glider.
- **Adjust the camera** — in `src/camera/follow-camera.js`, change the offset distance. Pull the camera way back for a cinematic feel. Push it close for intensity.
- **Make the turret snappier or heavier** — in `src/nesting/aim-rig.js`, the spring-damper constants (`C0` and `C1`) control how the turret feels. Higher C0 = snappier. Higher C1 = more damped. Try extremes.
- **Change the drone speed** — in `src/nesting/drone-system.js`, find how fast drones approach. Make them terrifying. Make them lazy.

### Things to Try: Modify Game Modes

Now you're changing what the game actually *does*.

- **Change Ring Rush rules** — find the Ring Rush setup in `index.html`. Change the ring count from 10 to 25. Add a speed multiplier. Change the timer.
- **Make Drone Hunter harder** — increase spawn rates, make drones faster, reduce the time limit. Or make it easier — more time, slower drones, more ammo.
- **Invent a new scoring rule** — what if you got bonus points for collecting rings while banking? Or a combo multiplier for consecutive hits?
- **Add a new collectible** — use `src/environment/collectibles.js` as a template. Create speed boost pickups, shield orbs, or ammo crates scattered on the sphere.

### Things to Try: Add Features

Real features. Real shipping. Real learning.

- **Add haptic feedback** — use the Vibration API (`navigator.vibrate(50)`) to add a buzz when you fire a rocket or collect a ring. Mobile-only, but very satisfying.
- **Add a new particle effect** — feathers when you graze the ground? Sparks on near-misses? Look at `src/effects/particles.js` for the pattern.
- **Build a simple HUD element** — altitude meter, speed gauge, compass direction. Pure HTML/CSS overlaid on the canvas.
- **Add a new sound layer** — wind intensity that changes with speed, a heartbeat at low health, a crowd cheer on high scores.

### The Big Challenge

- **Fix the spherical flight direction bug** — this is the real one. The bird doesn't fly the direction it's facing on the sphere. Read `KNOWN_ISSUES.md` Issue 5 and `FLIGHT_CONTROLS_PLAN.md` Phase 0. If you crack this, you've earned serious respect. This is a real, unsolved problem involving quaternions, spherical geometry, and vector-based direction tracking.

### What You'll Learn Along the Way

- **Three.js** — how 3D scenes work in the browser (scene, camera, renderer, game loop)
- **Game feel** — why numbers matter, how small tweaks change everything
- **Mobile development** — touch controls, performance budgets, iOS quirks
- **Physics** — quaternions, spherical geometry, spring-damper systems
- **Audio** — web audio on iOS, sound pools, volume mixing
- **Shipping** — from code change to deployed, playable game that others can try

---

## First Suggestions for Claude

If you're an AI assistant working on this repo:

1. **Read `KNOWN_ISSUES.md` and `FLIGHT_CONTROLS_PLAN.md`** before touching flight code
2. **The spherical flight bug is the #1 priority** — but it's hard. Read all context first.
3. **Good quick wins:** Remove eruda console, clean up debug UI, improve mobile CSS
4. **Good improvement:** Add screen shake intensity options, improve ring spawn variety
5. **Always test on mobile** — desktop behaviour is not representative
6. **Preserve zero-allocation** — never add `new` calls inside the game loop
