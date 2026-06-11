/**
 * Game-mode core — the testable, DOM-free heart of Birb Mobile's four modes,
 * extracted from index.html as one of the final two "seam" extractions
 * (CODEBASE_EVALUATION.md L1).
 *
 * Scope (what lives here): the GAME_MODES enum, the mini-game state shape +
 * reset, the win/lose condition math (Ring Rush ring count, Drone Hunter 60s
 * timer, Turret Defense lives + the 2+wave spawn curve), the scoring/combo
 * math, time formatting, and best-score new-record evaluation (the pure half
 * of the birb_best_* localStorage logic — the actual read/write glue stays in
 * index.html).
 *
 * Out of scope (stays in index.html): ALL DOM/HUD updates, audio, drone-system
 * glue, countdown banners, combo popups, and the localStorage calls themselves.
 * This file imports nothing — no THREE, no CDN — so it unit-tests under plain
 * `node --test`. Zero-allocation: reset mutates the passed object in place; the
 * math helpers return primitives / mutate in place and allocate nothing.
 */

export const GAME_MODES = {
  CASUAL: 'casual',
  RING_RUSH: 'ring_rush',
  DRONE_HUNTER: 'drone_hunter',
  TURRET_DEFENSE: 'turret_defense',
  ZEN: 'zen',
};

/** Drone Hunter run length, in seconds. */
export const DRONE_HUNTER_DURATION = 60;
/** Combo grows +0.25 per kill, capped here; decays after this idle window. */
export const COMBO_MAX = 5;
export const COMBO_DECAY_SECONDS = 3;

/**
 * Format seconds as M:SS.cc (verbatim from index.html). Pure.
 */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

/**
 * The mini-game state shape. The defaults match index.html exactly. Index.html
 * still owns the live instance (and tacks on nothing extra); this just gives a
 * single canonical definition + a reset that's testable.
 */
export function createMiniGameState() {
  return {
    active: false,
    time: 0,
    score: 0,
    ringsCollected: 0,
    ringsTotal: 10,
    dronesDestroyed: 0,
    combo: 1,
    comboTimer: 0,
    wave: 1,
    lives: 3,
    waveSpawnCount: 3, // wave N spawns 2 + N drones; reset back to 3 on start
    waveSpawnedThisWave: 0,
    droneSpawnTimer: 0,
    started: false, // For Ring Rush - starts on first ring
    // Turret Defense specific
    waveKills: 0,
    dronesRemaining: 0,
    waveTimer: 0,
    waveComplete: false,
  };
}

/**
 * Reset a mini-game state for a fresh run (the field-by-field reset that lived
 * inline at the top of startGameMode). Mutates in place (zero-alloc) and
 * activates the run. `ringsTotal` is intentionally NOT reset here — index.html
 * syncs it from the real spawned ring count right after, which is the fix for
 * the race-ends-early bug. Returns the same object for chaining/tests.
 */
export function resetMiniGameState(s) {
  s.active = true;
  s.time = 0;
  s.score = 0;
  s.ringsCollected = 0;
  s.dronesDestroyed = 0;
  s.combo = 1;
  s.comboTimer = 0;
  s.wave = 1;
  s.lives = 3;
  s.waveSpawnCount = 3;
  s.waveSpawnedThisWave = 0;
  s.droneSpawnTimer = 0;
  s.started = false;
  s.waveKills = 0;
  s.dronesRemaining = 0;
  s.waveTimer = 0;
  s.waveComplete = false;
  return s;
}

// ===== Win / lose conditions =====

/** Ring Rush is won when all spawned rings are collected. */
export function ringRushWon(s) {
  return s.ringsCollected >= s.ringsTotal;
}

/** Remaining Drone Hunter time, clamped to 0. */
export function droneHunterRemaining(time) {
  return Math.max(0, DRONE_HUNTER_DURATION - time);
}

/** Drone Hunter ends when the 60s clock runs out. */
export function droneHunterTimeUp(s) {
  return s.time >= DRONE_HUNTER_DURATION;
}

/** Turret Defense is lost when the nest's lives reach zero. */
export function turretDefenseLost(s) {
  return s.lives <= 0;
}

/**
 * Turret Defense spawn curve: wave N spawns 2 + N drones. Verbatim from the
 * wave-advance (`miniGameState.waveSpawnCount = 2 + miniGameState.wave`).
 */
export function nextWaveSpawnCount(wave) {
  return 2 + wave;
}

// ===== Scoring / combo =====

/**
 * Apply a Drone Hunter kill to the state (score + combo bump + combo timer).
 * Mutates in place. Returns { oldComboFloor, newComboFloor } so the caller can
 * decide whether to fire the combo-popup VFX (kept in index.html). The
 * base-score / heavy-drone roll is decided by the caller (it's RNG + time
 * dependent) and passed in as `baseScore`, so this stays deterministic/pure.
 */
export function applyKillScore(s, baseScore) {
  s.score += Math.round(baseScore * s.combo);
  const oldComboFloor = Math.floor(s.combo);
  s.combo = Math.min(COMBO_MAX, s.combo + 0.25);
  s.comboTimer = COMBO_DECAY_SECONDS;
  const newComboFloor = Math.floor(s.combo);
  return { oldComboFloor, newComboFloor };
}

/**
 * Tick the combo decay clock; reset combo to 1 when it lapses. Mutates in
 * place. Returns true if the combo just expired this frame.
 */
export function decayCombo(s, delta) {
  if (s.comboTimer > 0) {
    s.comboTimer -= delta;
    if (s.comboTimer <= 0) {
      s.combo = 1;
      return true;
    }
  }
  return false;
}

// ===== Best-score evaluation (pure half of the birb_best_* logic) =====

/**
 * Decide whether a finished run beat the saved best, given the raw saved value
 * (string|null from localStorage) and the run value. `lowerIsBetter` is true for
 * Ring Rush (time), false for Drone Hunter score / Turret wave. `parse` is
 * parseFloat (time) or parseInt (score/wave). Returns { isNewBest, bestValue }
 * where bestValue is the value to display/persist (the new run if it's a record,
 * else the previous best). Pure — index.html does the actual localStorage I/O.
 */
export function evaluateBest(savedRaw, runValue, { lowerIsBetter, parse = parseFloat } = {}) {
  const fallback = lowerIsBetter ? Infinity : 0;
  const saved = savedRaw == null ? fallback : (parse(savedRaw) || fallback);
  const isNewBest = lowerIsBetter ? runValue < saved : runValue > saved;
  const bestValue = isNewBest ? runValue : (savedRaw == null ? null : saved);
  return { isNewBest, bestValue };
}
