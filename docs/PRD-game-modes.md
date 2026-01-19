# Product Requirements Document: Birb Game Modes

**Version:** 1.0
**Date:** January 2026
**Status:** Design & Ideation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals & Success Metrics](#2-goals--success-metrics)
3. [User Experience Flow](#3-user-experience-flow)
4. [Game Mode Architecture](#4-game-mode-architecture)
5. [Mode 0: Casual (Current)](#5-mode-0-casual-current)
6. [Mode 1: Ring Rush](#6-mode-1-ring-rush)
7. [Mode 2: Drone Hunter](#7-mode-2-drone-hunter)
8. [Mode 3: Turret Defense](#8-mode-3-turret-defense)
9. [Shared Systems](#9-shared-systems)
10. [Technical Implementation](#10-technical-implementation)
11. [Platform Considerations](#11-platform-considerations)
12. [Best Practices Research](#12-best-practices-research)
13. [Risk Assessment](#13-risk-assessment)
14. [Future Considerations](#14-future-considerations)

---

## 1. Executive Summary

### 1.1 Vision

Transform Birb from a single free-flight experience into a multi-mode game with structured challenges. Players can choose between relaxed exploration (Casual) or three distinct mini-games that leverage existing mechanics in new, engaging ways.

### 1.2 Core Principle

**Maximize existing systems, minimize new code.** Every mini-game should feel like a natural extension of Birb's flight, nesting, and combat mechanics—not a bolted-on feature.

### 1.3 Mode Overview

| Mode | Name | Core Loop | Time | Replayability |
|------|------|-----------|------|---------------|
| 0 | Casual | Free flight, no objectives | Unlimited | Exploration |
| 1 | Ring Rush | Collect all rings fastest | 1-3 min | Time attack |
| 2 | Drone Hunter | Destroy drones with power-ups | 60 sec | High score |
| 3 | Turret Defense | Defend nest from waves | 3-5 min | Wave survival |

---

## 2. Goals & Success Metrics

### 2.1 Product Goals

1. **Increase session length** by providing structured objectives
2. **Increase return visits** through high-score chasing and personal bests
3. **Showcase existing mechanics** that players might not discover organically
4. **Maintain simplicity** - each mode explainable in one sentence

### 2.2 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Mode adoption | 60%+ players try at least one mode | Analytics event |
| Session extension | +40% avg session time | Time tracking |
| Replay rate | 3+ attempts per mode per session | Play count |
| Completion rate | 70%+ finish their first attempt | Event tracking |

### 2.3 Design Principles

1. **Instant gratification** - Fun within 5 seconds of starting
2. **Clear feedback** - Always know score, time, objective
3. **Graceful failure** - Losing should motivate retry, not frustrate
4. **Skill ceiling** - Easy to play, room to master
5. **Mobile-first** - All modes fully playable on touch devices

---

## 3. User Experience Flow

### 3.1 Entry Point

```
Settings (gear icon)
    └── Game Mode (new button)
            └── Mode Selection Overlay
                    ├── Casual (current default)
                    ├── Ring Rush
                    ├── Drone Hunter
                    └── Turret Defense
```

### 3.2 Mode Selection UI

```
┌─────────────────────────────────────────────────┐
│                   GAME MODE                      │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │  ○  CASUAL                              │    │
│  │     Free flight • No objectives          │    │
│  │     Currently active ✓                   │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │  ●  RING RUSH                           │    │
│  │     Collect all 20 rings fastest         │    │
│  │     Best: 1:23.45                        │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │  ●  DRONE HUNTER                        │    │
│  │     60 seconds • Power-ups • High score  │    │
│  │     Best: 2,450 pts                      │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │  ●  TURRET DEFENSE                      │    │
│  │     Defend your nest from drone waves    │    │
│  │     Best: Wave 12                        │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│              [ START MODE ]                      │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 3.3 Mode Lifecycle

```
Mode Selection
      │
      ▼
┌─────────────┐
│  PRE-GAME   │ ◄── Countdown, position player, show instructions
└─────────────┘
      │
      ▼
┌─────────────┐
│   ACTIVE    │ ◄── Main gameplay loop, HUD visible
└─────────────┘
      │
      ▼ (win/lose/timeout)
┌─────────────┐
│  POST-GAME  │ ◄── Results screen, stats, retry/quit options
└─────────────┘
      │
      ├──► Retry (→ PRE-GAME)
      └──► Quit (→ Mode Selection or Casual)
```

---

## 4. Game Mode Architecture

### 4.1 State Machine

```javascript
const GAME_MODE_STATES = {
  INACTIVE: 'inactive',       // No mode active (Casual)
  SELECTING: 'selecting',     // Mode selection overlay open
  PRE_GAME: 'pre_game',       // Countdown/setup phase
  ACTIVE: 'active',           // Gameplay in progress
  PAUSED: 'paused',           // Player paused (settings open)
  POST_GAME: 'post_game',     // Results screen
};

const GAME_MODES = {
  CASUAL: 'casual',
  RING_RUSH: 'ring_rush',
  DRONE_HUNTER: 'drone_hunter',
  TURRET_DEFENSE: 'turret_defense',
};
```

### 4.2 Core Interface

Each game mode implements a common interface:

```javascript
interface GameMode {
  // Lifecycle
  init(scene, systems): void;       // Called once on first activation
  start(): void;                     // Called when mode begins
  update(delta: number): void;       // Called each frame when active
  pause(): void;                     // Called when game paused
  resume(): void;                    // Called when game resumed
  end(reason: string): void;         // Called when mode ends
  reset(): void;                     // Prepare for replay
  dispose(): void;                   // Cleanup resources

  // State
  getState(): ModeState;             // Current state object
  getHUDData(): HUDData;             // Data for HUD rendering
  getResults(): ResultsData;         // Final results for post-game

  // Events
  onEvent(event: GameEvent): void;   // Handle game events
}
```

### 4.3 Shared Systems Access

All modes receive references to existing systems:

```javascript
const sharedSystems = {
  scene,                    // Three.js scene
  camera,                   // Camera instance
  flightController,         // Bird flight controller
  droneSystem,              // Drone spawning/management
  rocketSystem,             // Rocket firing
  collectiblesSystem,       // Ring collection
  nestingSystem,            // Nest landing/turret
  aimRig,                   // Turret aiming
  audioManager,             // Sound effects
};
```

### 4.4 File Structure

```
src/
├── game-modes/
│   ├── index.js                 # Mode manager, state machine
│   ├── mode-interface.js        # Base interface definition
│   ├── casual-mode.js           # Casual mode (minimal)
│   ├── ring-rush-mode.js        # Ring Rush implementation
│   ├── drone-hunter-mode.js     # Drone Hunter implementation
│   ├── turret-defense-mode.js   # Turret Defense implementation
│   ├── shared/
│   │   ├── timer.js             # Countdown/elapsed timer
│   │   ├── score.js             # Scoring system
│   │   ├── combo.js             # Combo/multiplier system
│   │   ├── power-ups.js         # Power-up spawning/effects
│   │   └── hud.js               # HUD components
│   └── ui/
│       ├── mode-select.js       # Mode selection overlay
│       ├── pre-game.js          # Countdown screen
│       ├── in-game-hud.js       # Active gameplay HUD
│       └── post-game.js         # Results screen
```

---

## 5. Mode 0: Casual (Current)

### 5.1 Overview

The current Birb experience. No score, no timer, no win/lose conditions. Pure exploration and experimentation.

### 5.2 Behavior

- **Default mode** on game load
- All systems active but no tracking
- Drones respawn normally
- Rings can be collected (visual feedback only)
- No HUD overlay beyond existing UI

### 5.3 Implementation

Minimal wrapper that maintains current behavior:

```javascript
class CasualMode {
  start() {
    // Reset any previous mode state
    this.systems.collectiblesSystem.reset();
    // Ensure drones are spawning
    this.systems.droneSystem.setEnabled(true);
  }

  update(delta) {
    // No special logic - existing game loop handles everything
  }

  getHUDData() {
    return null; // No HUD in casual mode
  }
}
```

---

## 6. Mode 1: Ring Rush

### 6.1 Overview

**Tagline:** "Collect all 20 rings as fast as possible."

A time-attack mode that showcases the ring collection mechanic and rewards mastery of flight controls.

### 6.2 Core Loop

1. Player starts at a fixed position
2. Timer starts on first ring collected
3. Collect all 20 rings in the environment
4. Time stops when final ring collected
5. Compare against personal best

### 6.3 Specifications

| Aspect | Specification |
|--------|---------------|
| Duration | Player-determined (typically 1-3 min) |
| Objective | Collect all 20 rings |
| Scoring | Elapsed time (lower is better) |
| Failure | None (always completable) |
| Drones | Disabled (distraction-free) |
| Nests | Active (can use for orientation) |

### 6.4 HUD Elements

```
┌────────────────────────────────────────┐
│  TIME: 0:45.23          RINGS: 14/20   │
│                                        │
│           [ring indicator arrows]       │
│                                        │
│                                        │
│                                        │
│                                        │
│  BEST: 1:23.45                         │
└────────────────────────────────────────┘
```

### 6.5 Ring Indicator System

To help players find remaining rings:

```javascript
// Show directional indicators for nearby uncollected rings
const INDICATOR_CONFIG = {
  maxDistance: 50,           // Only show indicators within this range
  fadeStart: 40,             // Start fading at this distance
  maxIndicators: 3,          // Show up to 3 nearest rings
  edgeMargin: 0.1,           // Screen edge margin for off-screen indicators
};

// Indicator appears as arrow at screen edge pointing toward ring
// Closer rings have brighter, larger indicators
```

### 6.6 State Machine

```
PRE_GAME
  │ (3-2-1 countdown)
  ▼
WAITING_FOR_START
  │ (first ring collected)
  ▼
ACTIVE
  │ (all rings collected)
  ▼
COMPLETE
```

### 6.7 Results Screen

```
┌─────────────────────────────────────────────────┐
│                  RING RUSH                       │
│                                                  │
│              ★ COMPLETE! ★                      │
│                                                  │
│            YOUR TIME: 1:18.72                   │
│                                                  │
│            ══════════════════                    │
│            NEW PERSONAL BEST!                    │
│            Previous: 1:23.45                     │
│            ══════════════════                    │
│                                                  │
│         [ RETRY ]     [ QUIT ]                   │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 6.8 Technical Implementation

```javascript
class RingRushMode {
  constructor() {
    this.state = 'waiting';
    this.elapsedTime = 0;
    this.ringsCollected = 0;
    this.totalRings = 20;
    this.bestTime = this.loadBestTime();
  }

  start() {
    // Disable drones for distraction-free gameplay
    this.systems.droneSystem.setEnabled(false);

    // Reset rings
    this.systems.collectiblesSystem.reset();

    // Position player at starting point
    this.positionPlayerAtStart();

    this.state = 'waiting';
    this.elapsedTime = 0;
    this.ringsCollected = 0;
  }

  update(delta) {
    if (this.state === 'active') {
      this.elapsedTime += delta;
    }

    // Check for ring collection
    const collected = this.systems.collectiblesSystem.checkCollection(
      this.systems.flightController.position
    );

    if (collected.length > 0) {
      if (this.state === 'waiting') {
        this.state = 'active'; // Start timer on first ring
      }

      this.ringsCollected += collected.length;

      if (this.ringsCollected >= this.totalRings) {
        this.complete();
      }
    }
  }

  complete() {
    this.state = 'complete';

    if (this.elapsedTime < this.bestTime) {
      this.bestTime = this.elapsedTime;
      this.saveBestTime();
      this.isNewRecord = true;
    }
  }
}
```

### 6.9 Environment-Specific Best Times

Store best times per environment since ring layouts differ:

```javascript
const bestTimes = {
  forest: null,
  canyons: null,
  mountains: null,
  city: null,
};
```

---

## 7. Mode 2: Drone Hunter

### 7.1 Overview

**Tagline:** "60 seconds. Power-ups. Maximum destruction."

An arcade-style score attack that transforms the peaceful drone system into frenetic combat with power-ups.

### 7.2 Core Loop

1. 60-second countdown
2. Destroy drones to score points
3. Destroyed drones drop power-ups
4. Collect power-ups for abilities
5. Chain kills for combo multiplier
6. Maximize score before time expires

### 7.3 Specifications

| Aspect | Specification |
|--------|---------------|
| Duration | 60 seconds |
| Objective | Maximize score |
| Scoring | Points per drone × multiplier |
| Failure | None (time-limited) |
| Drones | Enhanced spawning (12-16 active) |
| Nests | Disabled (flight-only combat) |

### 7.4 Key Innovation: In-Flight Rockets

The biggest new mechanic: **fire rockets while flying**.

```javascript
// New ability: Fire rockets from bird (not just nests)
const FLIGHT_ROCKET_CONFIG = {
  enabled: true,                    // Only in Drone Hunter mode
  cooldown: 1.5,                    // Faster than nest (2.0s)
  speed: 30,                        // Slightly faster than nest rockets
  gravity: 3.0,                     // Less gravity for air-to-air
  aimAssist: {
    enabled: true,
    coneAngle: 15,                  // Degrees of aim assist
    maxDistance: 40,                // Only assist within range
  },
};
```

### 7.5 Power-Up System

#### Power-Up Types

| Power-Up | Color | Duration | Effect |
|----------|-------|----------|--------|
| Speed Boost | Green | 5s | 2× flight speed |
| Invincibility | Blue | 5s | No freeze on drone collision |
| Rapid Fire | Red | 5s | 0.5s rocket cooldown |
| Multi-Shot | Yellow | 10s | Fire 3 rockets in spread |
| Magnet | Purple | 8s | Auto-collect nearby power-ups |
| Score Boost | Gold | 8s | 2× point value |

#### Power-Up Drop Mechanics

```javascript
const POWER_UP_CONFIG = {
  dropChance: 0.4,              // 40% chance per drone destroyed
  guaranteedAfter: 5,           // Guarantee drop if none in 5 kills
  floatDuration: 10,            // Power-up despawns after 10 seconds
  collectRadius: 2.0,           // Collection radius
  magnetRadius: 15.0,           // Magnet attraction radius
};
```

#### Power-Up Visual Design

```javascript
// Floating orb with pulsing glow
function createPowerUp(type, position) {
  const config = POWER_UP_TYPES[type];

  // Core sphere
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshStandardMaterial({
      color: config.color,
      emissive: config.color,
      emissiveIntensity: 0.8,
    })
  );

  // Outer glow ring
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(0.8, 0.1, 8, 24),
    new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
    })
  );

  // Icon sprite (shows power-up type)
  const icon = createPowerUpIcon(type);

  return { core, glow, icon, type, position, lifetime: 10 };
}
```

### 7.6 Scoring System

#### Base Points

| Action | Base Points |
|--------|-------------|
| Drone destroyed | 100 |
| Power-up collected | 25 |
| Near-miss (fly close to drone) | 10 |

#### Combo Multiplier

```javascript
const COMBO_CONFIG = {
  baseMultiplier: 1.0,
  incrementPerKill: 0.25,        // +0.25× per consecutive kill
  maxMultiplier: 5.0,            // Cap at 5×
  decayDelay: 3.0,               // Seconds before decay starts
  decayRate: 0.5,                // Multiplier loss per second
};

// Example progression:
// Kill 1: 1.00× (100 pts)
// Kill 2: 1.25× (125 pts)
// Kill 3: 1.50× (150 pts)
// Kill 4: 1.75× (175 pts)
// ...
// Kill 16+: 5.00× (500 pts) - MAX
```

### 7.7 HUD Elements

```
┌────────────────────────────────────────────────────┐
│  TIME: 0:42               SCORE: 2,450             │
│                                                    │
│  [====] RAPID FIRE 3.2s              ×2.5 COMBO   │
│                                                    │
│                    [crosshair]                     │
│                                                    │
│                                                    │
│                                                    │
│  BEST: 4,200                      KILLS: 18       │
└────────────────────────────────────────────────────┘
```

### 7.8 Enhanced Drone Spawning

```javascript
const DRONE_HUNTER_CONFIG = {
  initialCount: 12,              // Start with more drones
  maxCount: 16,                  // Can have up to 16 active
  respawnDelay: 1.0,             // Faster respawn (vs 2.0s normal)
  spawnBurst: {
    enabled: true,
    interval: 15,                // Every 15 seconds
    count: 4,                    // Spawn 4 drones at once
  },
  speedMultiplier: 1.2,          // 20% faster orbits
  altitudeRange: [32, 50],       // Wider altitude range
};
```

### 7.9 Results Screen

```
┌─────────────────────────────────────────────────┐
│                 DRONE HUNTER                     │
│                                                  │
│             FINAL SCORE: 3,850                  │
│                                                  │
│    ═══════════════════════════════════          │
│    Drones Destroyed:        28                   │
│    Power-ups Collected:     12                   │
│    Max Combo:               ×4.25               │
│    Accuracy:                72%                  │
│    ═══════════════════════════════════          │
│                                                  │
│            ★ NEW HIGH SCORE! ★                  │
│            Previous: 3,200                       │
│                                                  │
│         [ RETRY ]     [ QUIT ]                   │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 7.10 Technical Implementation

```javascript
class DroneHunterMode {
  constructor() {
    this.timeRemaining = 60;
    this.score = 0;
    this.combo = 1.0;
    this.comboTimer = 0;
    this.kills = 0;
    this.powerUps = [];
    this.activeEffects = new Map();
  }

  start() {
    // Disable nesting (flight-only mode)
    this.systems.nestingSystem.setEnabled(false);

    // Enable in-flight rockets
    this.systems.rocketSystem.setFlightModeEnabled(true);

    // Configure enhanced drone spawning
    this.systems.droneSystem.configure(DRONE_HUNTER_CONFIG);

    // Hook into drone destruction for scoring
    this.systems.droneSystem.onDroneDestroyed = (position) => {
      this.onDroneKill(position);
    };

    this.timeRemaining = 60;
    this.score = 0;
    this.combo = 1.0;
  }

  update(delta) {
    // Countdown
    this.timeRemaining -= delta;
    if (this.timeRemaining <= 0) {
      this.end('timeout');
      return;
    }

    // Combo decay
    this.comboTimer -= delta;
    if (this.comboTimer <= 0 && this.combo > 1.0) {
      this.combo = Math.max(1.0, this.combo - COMBO_CONFIG.decayRate * delta);
    }

    // Update power-ups
    this.updatePowerUps(delta);

    // Check power-up collection
    this.checkPowerUpCollection();

    // Update active effects
    this.updateActiveEffects(delta);
  }

  onDroneKill(position) {
    // Score
    const basePoints = 100;
    const points = Math.floor(basePoints * this.combo);
    this.score += points;
    this.kills++;

    // Combo
    this.combo = Math.min(COMBO_CONFIG.maxMultiplier, this.combo + 0.25);
    this.comboTimer = COMBO_CONFIG.decayDelay;

    // Power-up drop
    if (Math.random() < POWER_UP_CONFIG.dropChance) {
      this.spawnPowerUp(position);
    }

    // Visual feedback
    this.showScorePopup(position, points);
  }

  spawnPowerUp(position) {
    const types = Object.keys(POWER_UP_TYPES);
    const type = types[Math.floor(Math.random() * types.length)];
    const powerUp = createPowerUp(type, position);
    this.powerUps.push(powerUp);
    this.scene.add(powerUp.group);
  }
}
```

---

## 8. Mode 3: Turret Defense

### 8.1 Overview

**Tagline:** "Defend your nest. Survive the waves."

A wave-based survival mode that showcases the nesting and turret mechanics in an intense defensive scenario.

### 8.2 Core Loop

1. Auto-land on a designated nest
2. Waves of drones approach the nest
3. Shoot drones before they reach you
4. Survive as many waves as possible
5. Game ends when 3 drones hit the nest

### 8.3 Specifications

| Aspect | Specification |
|--------|---------------|
| Duration | Until 3 lives lost |
| Objective | Survive maximum waves |
| Scoring | Wave number reached |
| Failure | 3 drone impacts |
| Drones | Wave-based spawning |
| Nests | Single designated nest |

### 8.4 Wave Configuration

```javascript
const WAVE_CONFIG = {
  baseCount: 3,                    // Drones in wave 1
  countIncrement: 1,               // +1 drone per wave
  maxCount: 12,                    // Cap at 12 per wave
  baseSpeed: 3,                    // Units/second approach speed
  speedIncrement: 0.2,             // +0.2 speed per wave
  maxSpeed: 8,                     // Cap at 8 units/second
  spawnDelay: {
    initial: 2.0,                  // Seconds before wave 1
    between: 5.0,                  // Seconds between waves
    withinWave: 0.8,               // Seconds between drones in wave
  },
  patterns: [
    'straight',                    // Direct approach
    'arc_left',                    // Curved approach from left
    'arc_right',                   // Curved approach from right
    'zigzag',                      // Serpentine approach
    'dive',                        // High altitude dive
  ],
};

// Wave difficulty progression
function getWaveConfig(waveNumber) {
  return {
    droneCount: Math.min(WAVE_CONFIG.baseCount + waveNumber - 1, WAVE_CONFIG.maxCount),
    approachSpeed: Math.min(WAVE_CONFIG.baseSpeed + (waveNumber - 1) * WAVE_CONFIG.speedIncrement, WAVE_CONFIG.maxSpeed),
    patterns: selectPatterns(waveNumber),
  };
}
```

### 8.5 Drone Approach Behavior

```javascript
class ApproachingDrone {
  constructor(targetPosition, config) {
    this.target = targetPosition;        // The nest to attack
    this.speed = config.approachSpeed;
    this.pattern = config.pattern;
    this.health = 1;                      // One hit kills (for now)

    // Spawn at edge of playable area
    this.position = this.calculateSpawnPoint();
  }

  update(delta) {
    switch (this.pattern) {
      case 'straight':
        // Direct path to target
        const direction = this.target.clone().sub(this.position).normalize();
        this.position.addScaledVector(direction, this.speed * delta);
        break;

      case 'arc_left':
        // Curved approach
        this.arcProgress += delta * 0.5;
        this.position = this.calculateArcPosition(this.arcProgress, 'left');
        break;

      case 'zigzag':
        // Serpentine movement
        const baseDir = this.target.clone().sub(this.position).normalize();
        const oscillation = Math.sin(this.lifetime * 4) * 0.5;
        const right = new THREE.Vector3().crossVectors(baseDir, this.up);
        this.position.addScaledVector(baseDir, this.speed * delta);
        this.position.addScaledVector(right, oscillation * delta * 2);
        break;
    }

    // Check if reached target
    if (this.position.distanceTo(this.target) < 2.0) {
      return 'reached'; // Drone hit the nest
    }

    return 'active';
  }
}
```

### 8.6 Lives System

```javascript
const LIVES_CONFIG = {
  initial: 3,
  maxLives: 5,                     // If we add life pickups later
  invulnerabilityDuration: 2.0,   // Seconds of invuln after hit
};

// Visual feedback for hits
function onNestHit() {
  this.lives--;

  // Screen shake
  this.camera.shake(0.5, 0.3);

  // Red flash overlay
  this.showDamageOverlay();

  // Sound effect
  this.audio.play('nest_hit');

  // Invulnerability period
  this.invulnerable = true;
  setTimeout(() => this.invulnerable = false, 2000);

  if (this.lives <= 0) {
    this.end('defeated');
  }
}
```

### 8.7 HUD Elements

```
┌────────────────────────────────────────────────────┐
│  WAVE 7                         ♥ ♥ ♡              │
│                                                    │
│  INCOMING: 5                   [cooldown ring]     │
│                                                    │
│                    [crosshair]                     │
│                                                    │
│                                                    │
│                                                    │
│  DESTROYED: 42                    BEST: WAVE 12   │
└────────────────────────────────────────────────────┘
```

### 8.8 Wave Announcements

```javascript
// Visual wave announcement
function showWaveAnnouncement(waveNumber) {
  const announcement = document.createElement('div');
  announcement.className = 'wave-announcement';
  announcement.innerHTML = `
    <div class="wave-number">WAVE ${waveNumber}</div>
    <div class="wave-info">${getWaveConfig(waveNumber).droneCount} DRONES INCOMING</div>
  `;

  // Animate in, hold, animate out
  announcement.animate([
    { opacity: 0, transform: 'scale(0.5)' },
    { opacity: 1, transform: 'scale(1)' },
    { opacity: 1, transform: 'scale(1)' },
    { opacity: 0, transform: 'scale(1.2)' },
  ], {
    duration: 2000,
    easing: 'ease-out',
  });
}
```

### 8.9 Rocket Cooldown Optimization

Faster cooldown for turret defense (otherwise too slow for waves):

```javascript
const TURRET_DEFENSE_ROCKET_CONFIG = {
  cooldown: 1.2,                   // Faster than normal 2.0s
  speed: 28,                       // Slightly faster
  gravity: 4.0,                    // Standard gravity
};
```

### 8.10 Results Screen

```
┌─────────────────────────────────────────────────┐
│                TURRET DEFENSE                    │
│                                                  │
│              SURVIVED TO WAVE 9                 │
│                                                  │
│    ═══════════════════════════════════          │
│    Drones Destroyed:        47                   │
│    Accuracy:                68%                  │
│    Longest Streak:          8                    │
│    Time Survived:           4:23                 │
│    ═══════════════════════════════════          │
│                                                  │
│            ★ NEW RECORD! ★                      │
│            Previous Best: Wave 7                 │
│                                                  │
│         [ RETRY ]     [ QUIT ]                   │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 8.11 Technical Implementation

```javascript
class TurretDefenseMode {
  constructor() {
    this.wave = 0;
    this.lives = 3;
    this.approachingDrones = [];
    this.state = 'pre_wave';
    this.dronesDestroyed = 0;
    this.waveKills = 0;
  }

  start() {
    // Disable normal drones
    this.systems.droneSystem.setEnabled(false);

    // Disable free flight
    this.systems.flightController.setEnabled(false);

    // Select and auto-land on a nest
    const nest = this.selectDefenseNest();
    this.systems.nestingSystem.forceNest(nest);

    // Configure faster rockets
    this.systems.rocketSystem.configure(TURRET_DEFENSE_ROCKET_CONFIG);

    // Start first wave after delay
    this.scheduleNextWave(WAVE_CONFIG.spawnDelay.initial);
  }

  update(delta) {
    // Update approaching drones
    for (let i = this.approachingDrones.length - 1; i >= 0; i--) {
      const drone = this.approachingDrones[i];
      const status = drone.update(delta);

      if (status === 'reached') {
        this.onNestHit();
        this.removeDrone(i);
      }
    }

    // Check for wave completion
    if (this.state === 'active' && this.approachingDrones.length === 0 && this.spawnQueue.length === 0) {
      this.onWaveComplete();
    }

    // Check rocket collisions
    this.checkRocketHits();
  }

  startWave() {
    this.wave++;
    this.waveKills = 0;

    const config = getWaveConfig(this.wave);
    this.showWaveAnnouncement(this.wave);

    // Queue drone spawns
    for (let i = 0; i < config.droneCount; i++) {
      this.spawnQueue.push({
        delay: i * WAVE_CONFIG.spawnDelay.withinWave,
        config: {
          approachSpeed: config.approachSpeed,
          pattern: config.patterns[i % config.patterns.length],
        },
      });
    }

    this.state = 'active';
  }

  onWaveComplete() {
    this.state = 'between_waves';
    this.showWaveCompleteMessage();
    this.scheduleNextWave(WAVE_CONFIG.spawnDelay.between);
  }
}
```

---

## 9. Shared Systems

### 9.1 Timer System

```javascript
// Flexible timer supporting count-up and count-down
class GameTimer {
  constructor(options = {}) {
    this.mode = options.mode || 'up';     // 'up' or 'down'
    this.duration = options.duration || 0; // For countdown
    this.elapsed = 0;
    this.running = false;
    this.onComplete = options.onComplete;
  }

  start() {
    this.running = true;
    this.elapsed = 0;
  }

  update(delta) {
    if (!this.running) return;

    this.elapsed += delta;

    if (this.mode === 'down' && this.getRemaining() <= 0) {
      this.running = false;
      this.onComplete?.();
    }
  }

  getRemaining() {
    return Math.max(0, this.duration - this.elapsed);
  }

  getFormatted() {
    const time = this.mode === 'down' ? this.getRemaining() : this.elapsed;
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const centiseconds = Math.floor((time % 1) * 100);
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  }
}
```

### 9.2 Score System

```javascript
class ScoreSystem {
  constructor() {
    this.score = 0;
    this.multiplier = 1.0;
    this.history = [];
  }

  add(points, reason = '') {
    const earned = Math.floor(points * this.multiplier);
    this.score += earned;
    this.history.push({ points: earned, reason, time: Date.now() });
    return earned;
  }

  setMultiplier(value) {
    this.multiplier = Math.max(1.0, value);
  }

  reset() {
    this.score = 0;
    this.multiplier = 1.0;
    this.history = [];
  }
}
```

### 9.3 High Score Storage

```javascript
// localStorage-based high score persistence
const HIGH_SCORE_KEY = 'birb_high_scores';

const highScoreManager = {
  get(mode, environment) {
    const scores = JSON.parse(localStorage.getItem(HIGH_SCORE_KEY) || '{}');
    return scores[`${mode}_${environment}`] || null;
  },

  set(mode, environment, score) {
    const scores = JSON.parse(localStorage.getItem(HIGH_SCORE_KEY) || '{}');
    const key = `${mode}_${environment}`;
    const current = scores[key];

    // Only save if new high score
    const isHighScore = !current || this.isBetter(mode, score, current);
    if (isHighScore) {
      scores[key] = score;
      localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(scores));
    }

    return isHighScore;
  },

  isBetter(mode, newScore, oldScore) {
    // Lower is better for time-based modes
    if (mode === 'ring_rush') {
      return newScore < oldScore;
    }
    // Higher is better for score/wave modes
    return newScore > oldScore;
  },
};
```

### 9.4 Screen Shake

```javascript
// Camera shake for impact feedback
class ScreenShake {
  constructor(camera) {
    this.camera = camera;
    this.trauma = 0;
    this.originalPosition = camera.position.clone();
  }

  add(amount) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  update(delta) {
    if (this.trauma <= 0) return;

    const shake = this.trauma * this.trauma; // Quadratic falloff
    const maxOffset = 0.5;

    this.camera.position.x = this.originalPosition.x + (Math.random() * 2 - 1) * maxOffset * shake;
    this.camera.position.y = this.originalPosition.y + (Math.random() * 2 - 1) * maxOffset * shake;

    this.trauma = Math.max(0, this.trauma - delta * 2); // Decay
  }
}
```

### 9.5 Score Popup System

```javascript
// Floating score numbers
class ScorePopup {
  constructor(scene) {
    this.scene = scene;
    this.popups = [];
  }

  show(position, text, color = 0xffffff) {
    const sprite = createTextSprite(text, {
      fontSize: 32,
      color: color,
    });

    sprite.position.copy(position);
    sprite.userData = {
      velocity: new THREE.Vector3(0, 2, 0),
      lifetime: 1.0,
      age: 0,
    };

    this.scene.add(sprite);
    this.popups.push(sprite);
  }

  update(delta) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const popup = this.popups[i];
      popup.userData.age += delta;

      // Move up
      popup.position.addScaledVector(popup.userData.velocity, delta);

      // Fade out
      const alpha = 1 - popup.userData.age / popup.userData.lifetime;
      popup.material.opacity = alpha;

      // Remove when expired
      if (popup.userData.age >= popup.userData.lifetime) {
        this.scene.remove(popup);
        this.popups.splice(i, 1);
      }
    }
  }
}
```

---

## 10. Technical Implementation

### 10.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      index.html                          │
│  (Main game loop, renderer, existing systems)            │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    GameModeManager                       │
│  - Mode state machine                                    │
│  - Mode transitions                                      │
│  - System coordination                                   │
└─────────────────────────┬───────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌───────────┐   ┌───────────┐   ┌───────────┐
    │ CasualMode │   │ RingRush  │   │DroneHunter│
    └───────────┘   └───────────┘   └───────────┘
          │               │               │
          └───────────────┼───────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    Shared Systems                        │
│  - Timer, Score, HighScore, ScreenShake, Popups         │
└─────────────────────────────────────────────────────────┘
```

### 10.2 Integration Points

#### Main Game Loop Integration

```javascript
// In index.html renderFrame()
function renderFrame(time) {
  const delta = clock.getDelta();

  // Update game mode (if active)
  if (gameModeManager.isActive()) {
    gameModeManager.update(delta);
  }

  // Existing updates...
  flightController.update(delta);
  droneSystem.update(delta);
  // etc...

  renderer.render(scene, camera);
}
```

#### System Enable/Disable Hooks

```javascript
// Add enable/disable methods to existing systems
droneSystem.setEnabled = function(enabled) {
  this.enabled = enabled;
  if (!enabled) {
    this.clearAllDrones();
  }
};

nestingSystem.setEnabled = function(enabled) {
  this.enabled = enabled;
  if (!enabled && this.isNested()) {
    this.forceTakeoff();
  }
};
```

### 10.3 Event System

```javascript
// Central event bus for game mode communication
class GameEventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    }
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }
}

// Events
const GAME_EVENTS = {
  DRONE_DESTROYED: 'drone_destroyed',
  RING_COLLECTED: 'ring_collected',
  ROCKET_FIRED: 'rocket_fired',
  NEST_ENTERED: 'nest_entered',
  NEST_EXITED: 'nest_exited',
  POWER_UP_COLLECTED: 'power_up_collected',
  WAVE_STARTED: 'wave_started',
  WAVE_COMPLETED: 'wave_completed',
};
```

### 10.4 UI Layer Structure

```html
<!-- Add to index.html -->
<div id="game-mode-ui" class="game-mode-ui">
  <!-- Mode Selection Overlay -->
  <div class="mode-select-overlay" data-ui="mode-select">
    <!-- Populated by mode-select.js -->
  </div>

  <!-- In-Game HUD -->
  <div class="game-hud" data-ui="hud">
    <div class="hud-top">
      <div class="hud-timer" data-hud="timer"></div>
      <div class="hud-score" data-hud="score"></div>
    </div>
    <div class="hud-center">
      <div class="hud-crosshair" data-hud="crosshair"></div>
    </div>
    <div class="hud-bottom">
      <div class="hud-status" data-hud="status"></div>
    </div>
  </div>

  <!-- Post-Game Results -->
  <div class="results-overlay" data-ui="results">
    <!-- Populated by post-game.js -->
  </div>

  <!-- Announcements (wave, countdown, etc) -->
  <div class="announcement-layer" data-ui="announcements"></div>
</div>
```

### 10.5 CSS Architecture

```css
/* Game Mode UI Base */
.game-mode-ui {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 50;
}

.game-mode-ui > * {
  pointer-events: auto;
}

/* HUD Styling */
.game-hud {
  display: none;
  position: absolute;
  inset: 0;
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
}

.game-hud.is-visible {
  display: block;
}

.hud-timer,
.hud-score {
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(1.2rem, 3vw, 2rem);
  color: white;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
}

/* Animations */
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.hud-score.is-updating {
  animation: pulse 0.2s ease-out;
}

/* Mode Selection */
.mode-select-overlay {
  display: none;
  place-items: center;
  background: rgba(6, 10, 22, 0.85);
  backdrop-filter: blur(8px);
}

.mode-select-overlay.is-open {
  display: grid;
}
```

---

## 11. Platform Considerations

### 11.1 Mobile-First Design

All game modes must be fully playable on mobile:

| Consideration | Solution |
|---------------|----------|
| Touch controls | Existing joystick system works for all modes |
| Screen real estate | Minimal HUD, expandable on tap |
| Safe areas | Respect notch/home indicator insets |
| Performance | 60fps target, LOD for complex effects |
| Battery | Efficient particle systems, no unnecessary renders |

### 11.2 Control Schemes

```javascript
const CONTROL_SCHEMES = {
  // Desktop
  keyboard: {
    fire: 'Space',
    pause: 'Escape',
  },
  mouse: {
    fire: 'leftClick',
    aim: 'movement',
  },

  // Mobile
  touch: {
    fire: 'fireButton',          // On-screen button
    aim: 'rightJoystick',        // Existing joystick
  },

  // Gamepad
  gamepad: {
    fire: 'RT',
    aim: 'rightStick',
    pause: 'Start',
  },
};
```

### 11.3 Responsive HUD

```javascript
// HUD adapts to screen size
const HUD_BREAKPOINTS = {
  compact: { maxWidth: 480 },    // Phone portrait
  normal: { maxWidth: 768 },     // Phone landscape / small tablet
  large: { minWidth: 769 },      // Tablet / desktop
};

function getHUDLayout() {
  const width = window.innerWidth;
  if (width <= 480) return 'compact';
  if (width <= 768) return 'normal';
  return 'large';
}
```

### 11.4 Performance Budgets

| System | Budget | Notes |
|--------|--------|-------|
| Drones | 16 max | Drone Hunter uses most |
| Power-ups | 8 max | Floating orbs |
| Particles | 200 max | Explosions, trails |
| Score popups | 10 max | Floating text |
| UI updates | 30fps | Separate from render |

---

## 12. Best Practices Research

### 12.1 Time Attack Games (Ring Rush)

**Research Sources:** Trackmania, Mirror's Edge time trials, Mario Kart time trials

**Key Learnings:**
- Ghost replay significantly increases replayability
- Split times at checkpoints show progress
- Immediate restart option is crucial
- Show time delta from best run in real-time

**Implementation:**
```javascript
// Ghost system for Ring Rush (future enhancement)
class GhostRecorder {
  constructor() {
    this.frames = [];
    this.recording = false;
  }

  record(position, quaternion, timestamp) {
    if (!this.recording) return;
    this.frames.push({
      position: position.clone(),
      quaternion: quaternion.clone(),
      time: timestamp,
    });
  }

  export() {
    return {
      frames: this.frames,
      totalTime: this.frames[this.frames.length - 1].time,
    };
  }
}
```

### 12.2 Score Attack Games (Drone Hunter)

**Research Sources:** Geometry Wars, Resogun, Pac-Man Championship Edition

**Key Learnings:**
- Combo systems create "flow state"
- Power-ups should feel overpowered but temporary
- Visual feedback for combo status is essential
- Near-misses reward risk-taking

**Implementation:**
```javascript
// Combo meter with visual feedback
class ComboMeter {
  constructor() {
    this.multiplier = 1.0;
    this.decayTimer = 0;
    this.visualIntensity = 0;
  }

  onKill() {
    this.multiplier = Math.min(5.0, this.multiplier + 0.25);
    this.decayTimer = 3.0;
    this.visualIntensity = 1.0; // Flash effect
  }

  update(delta) {
    this.decayTimer -= delta;
    if (this.decayTimer <= 0 && this.multiplier > 1.0) {
      this.multiplier = Math.max(1.0, this.multiplier - delta * 0.5);
    }
    this.visualIntensity *= 0.95; // Fade flash
  }

  getColor() {
    // Green -> Yellow -> Orange -> Red as multiplier increases
    const t = (this.multiplier - 1) / 4;
    return lerpColor(0x44ff44, 0xff4444, t);
  }
}
```

### 12.3 Wave Survival Games (Turret Defense)

**Research Sources:** Call of Duty Zombies, Horde modes, Plants vs Zombies

**Key Learnings:**
- Wave announcements build anticipation
- Brief pauses between waves allow recovery
- Enemy variety increases engagement
- Clear threat visualization (incoming indicators)

**Implementation:**
```javascript
// Wave announcement system
function showWaveAnnouncement(wave) {
  // Phase 1: Wave number flies in
  animateElement('.wave-number', {
    from: { x: '-100%', opacity: 0 },
    to: { x: '0%', opacity: 1 },
    duration: 300,
  });

  // Phase 2: Hold
  await delay(1000);

  // Phase 3: Explode out
  animateElement('.wave-number', {
    to: { scale: 2, opacity: 0 },
    duration: 200,
  });
}
```

### 12.4 Power-Up Design

**Research Sources:** Mario Kart items, Doom power-ups, Sonic rings

**Key Learnings:**
- Clear visual distinction between power-up types
- Audio cue on collection
- HUD shows active power-up with timer
- Power-ups should change gameplay meaningfully

**Best Practice Implementation:**
```javascript
const POWER_UP_DESIGN = {
  // Visual
  shape: 'floating orb with icon',
  glow: 'pulsing aura matching color',
  rotation: 'slow Y-axis spin',
  bob: 'gentle vertical oscillation',

  // Audio
  spawnSound: 'crystalline chime',
  collectSound: 'satisfying pickup',
  activateSound: 'power surge',
  expireWarning: 'diminishing tone at 2s',

  // Feedback
  screenFlash: 'brief color flash on collect',
  hudIcon: 'animated icon with countdown ring',
  particleTrail: 'player emits particles while active',
};
```

### 12.5 Scoring Psychology

**Research Sources:** Game design literature, casino mechanics research

**Key Learnings:**
- Big numbers feel more rewarding (100 points > 1 point)
- Round numbers as milestones (1000, 5000, 10000)
- Personal bests more motivating than leaderboards
- Showing improvement ("12% better than last time!")

**Implementation:**
```javascript
// Psychologically optimized scoring
const SCORE_CONFIG = {
  basePoints: 100,              // Nice round number
  milestones: [1000, 2500, 5000, 10000, 25000],

  formatScore(score) {
    // Add commas for readability
    return score.toLocaleString();
  },

  getImprovementMessage(newScore, oldScore) {
    if (!oldScore) return 'First attempt!';
    const improvement = ((newScore - oldScore) / oldScore * 100).toFixed(0);
    if (improvement > 0) return `${improvement}% better!`;
    if (improvement < 0) return `${Math.abs(improvement)}% short of best`;
    return 'Matched your best!';
  },
};
```

---

## 13. Risk Assessment

### 13.1 Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Performance degradation with power-ups | High | Medium | Strict particle budgets, LOD system |
| Mobile touch conflicts | Medium | Low | Dedicated fire button, existing joystick |
| State corruption on mode switch | High | Medium | Clean state machine, comprehensive reset |
| Memory leaks from mode cycling | Medium | Medium | Explicit dispose() on all objects |

### 13.2 Design Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Modes feel disconnected from core game | Medium | Low | Reuse all visual assets, mechanics |
| Ring Rush too easy/hard | Low | Medium | Per-environment tuning, ring placement |
| Drone Hunter balance | Medium | High | Extensive playtesting, tunable constants |
| Turret Defense monotonous | Medium | Medium | Wave variety, pattern randomization |

### 13.3 Mitigation Strategies

1. **Feature flags** - Each mode independently toggleable
2. **Tunable constants** - All balance values in config objects
3. **Analytics hooks** - Track completion rates, scores, retry rates
4. **Graceful degradation** - Fall back to Casual if mode errors

---

## 14. Future Considerations

### 14.1 Potential Enhancements

| Enhancement | Mode | Complexity | Value |
|-------------|------|------------|-------|
| Ghost replay | Ring Rush | High | Very High |
| Daily challenges | All | Medium | High |
| Achievements | All | Medium | Medium |
| Leaderboards | All | High | Medium |
| Unlockable power-ups | Drone Hunter | Medium | High |
| Boss waves | Turret Defense | High | Very High |

### 14.2 Mode 4+ Ideas (Parking Lot)

| Mode | Description | Why Parked |
|------|-------------|------------|
| **Drone Dodge** | Survival against chasing drones | Needs drone AI overhaul |
| **Ring Sequence** | Collect numbered rings in order | UI complexity |
| **Nest Hopper** | Land on nests for combos | May feel too simple |
| **Multiplayer Tag** | Online multiplayer | Infrastructure needed |

### 14.3 Technical Debt Tracking

| Item | Priority | Notes |
|------|----------|-------|
| Drone system enable/disable | P0 | Needed for mode switching |
| Nest system enable/disable | P0 | Needed for Drone Hunter |
| Event bus integration | P1 | Clean system communication |
| HUD component library | P1 | Reusable UI elements |
| Power-up particle system | P2 | Can start simple |

---

## Appendix A: Constants Reference

```javascript
// All tunable constants in one place
export const GAME_MODE_CONSTANTS = {
  // Ring Rush
  RING_RUSH: {
    TOTAL_RINGS: 20,
    INDICATOR_MAX_DISTANCE: 50,
    INDICATOR_FADE_START: 40,
    MAX_INDICATORS: 3,
  },

  // Drone Hunter
  DRONE_HUNTER: {
    DURATION: 60,
    INITIAL_DRONES: 12,
    MAX_DRONES: 16,
    RESPAWN_DELAY: 1.0,
    POWER_UP_DROP_CHANCE: 0.4,
    POWER_UP_FLOAT_DURATION: 10,
    COMBO_INCREMENT: 0.25,
    COMBO_MAX: 5.0,
    COMBO_DECAY_DELAY: 3.0,
    COMBO_DECAY_RATE: 0.5,
  },

  // Turret Defense
  TURRET_DEFENSE: {
    INITIAL_LIVES: 3,
    WAVE_BASE_COUNT: 3,
    WAVE_COUNT_INCREMENT: 1,
    WAVE_MAX_COUNT: 12,
    WAVE_BASE_SPEED: 3,
    WAVE_SPEED_INCREMENT: 0.2,
    WAVE_MAX_SPEED: 8,
    SPAWN_DELAY_INITIAL: 2.0,
    SPAWN_DELAY_BETWEEN: 5.0,
    SPAWN_DELAY_WITHIN: 0.8,
  },

  // Power-ups
  POWER_UPS: {
    SPEED_BOOST: { duration: 5, multiplier: 2.0, color: 0x44ff44 },
    INVINCIBILITY: { duration: 5, color: 0x4444ff },
    RAPID_FIRE: { duration: 5, cooldown: 0.5, color: 0xff4444 },
    MULTI_SHOT: { duration: 10, count: 3, spread: 15, color: 0xffff44 },
    MAGNET: { duration: 8, radius: 15, color: 0xff44ff },
    SCORE_BOOST: { duration: 8, multiplier: 2.0, color: 0xffaa00 },
  },
};
```

---

## Appendix B: File Checklist

### New Files to Create

- [ ] `src/game-modes/index.js` - Mode manager
- [ ] `src/game-modes/mode-interface.js` - Base interface
- [ ] `src/game-modes/casual-mode.js` - Casual wrapper
- [ ] `src/game-modes/ring-rush-mode.js` - Ring Rush
- [ ] `src/game-modes/drone-hunter-mode.js` - Drone Hunter
- [ ] `src/game-modes/turret-defense-mode.js` - Turret Defense
- [ ] `src/game-modes/shared/timer.js` - Timer system
- [ ] `src/game-modes/shared/score.js` - Score system
- [ ] `src/game-modes/shared/combo.js` - Combo system
- [ ] `src/game-modes/shared/power-ups.js` - Power-ups
- [ ] `src/game-modes/shared/hud.js` - HUD components
- [ ] `src/game-modes/ui/mode-select.js` - Selection UI
- [ ] `src/game-modes/ui/pre-game.js` - Countdown UI
- [ ] `src/game-modes/ui/in-game-hud.js` - Active HUD
- [ ] `src/game-modes/ui/post-game.js` - Results UI

### Files to Modify

- [ ] `index.html` - Add UI containers, wire up manager
- [ ] `src/nesting/drone-system.js` - Add enable/disable
- [ ] `src/nesting/rocket.js` - Add flight-mode firing
- [ ] `src/nesting/nesting-system.js` - Add enable/disable
- [ ] `src/environment/collectibles.js` - Add event hooks

---

*End of PRD*
