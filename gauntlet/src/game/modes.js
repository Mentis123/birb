/**
 * game/modes.js — Birb Gauntlet's mode system. PURE: no THREE, no DOM.
 *
 * This is the port of Birb Mobile's `src/game/game-modes.js`, rewritten rather
 * than imported (gauntlet/ stays airtight against the parent game) and extended
 * with the one structural idea the original was missing.
 *
 * THE STRUCTURAL CHANGE — CAPABILITY FLAGS, NOT NAME CHECKS
 *
 * The original branched on the mode string at every call site:
 * `if (mode === 'ring_rush' || mode === 'drone_hunter') ...`. Adding a fifth
 * mode meant hunting those down across ~5,600 lines of index.html, and missing
 * one is silent. Here each mode is a DESCRIPTOR of what it turns on, and the
 * game loop asks `MODE_DEFS[mode].drones` rather than comparing names. A new
 * mode is a new row in one table.
 *
 * MERGED MODE — Zen folded into Casual, deliberately.
 * The original shipped both, and they differed only by tuning multipliers on
 * the same free flight. Two cards for one experience is a worse menu, so
 * Casual carries the gentle tuning and Zen is gone. Drones stay ambient in
 * Casual: the world reads dead without something moving in it, and they are
 * dodgeable rather than hostile there.
 */

export const MODES = {
    CASUAL: 'casual',
    RACE: 'race',
    RING_RUSH: 'ring_rush',
    DRONE_HUNTER: 'drone_hunter',
    TURRET_DEFENSE: 'turret_defense',
};

/** Mode presentation order on the title screen. Casual is the default. */
export const MODE_ORDER = [
    MODES.CASUAL,
    MODES.RACE,
    MODES.RING_RUSH,
    MODES.DRONE_HUNTER,
    MODES.TURRET_DEFENSE,
];

export const DEFAULT_MODE = MODES.CASUAL;

// --- tuning shared with the original -----------------------------------------

/** Drone Hunter run length, in seconds. Verbatim from Birb Mobile. */
export const DRONE_HUNTER_DURATION = 60;
/** Combo grows +0.25 per kill, capped here; decays after this idle window. */
export const COMBO_MAX = 5;
export const COMBO_DECAY_SECONDS = 3;
/** Turret Defense starting lives. */
export const TURRET_LIVES = 3;

/**
 * What each mode switches on.
 *
 *   course      the racing ribbon + gates exist and are visible
 *   laps        race lap count, or 0
 *   rivals      AI birds fly the circuit
 *   drones      'off' | 'ambient' | 'hunt' | 'waves'
 *   nesting     the bird can land on a nest and man the turret
 *   rings       collectible rings spawn
 *   timed       a clock drives the run
 *   canFail     the run can end badly (vs. play forever)
 *   gentle      Casual's softened flight tuning
 *   scoreKind   what a finished run reports: 'time' | 'score' | 'wave' | null
 *   lowerIsBetter  for the personal-best comparison
 */
export const MODE_DEFS = {
    [MODES.CASUAL]: {
        id: MODES.CASUAL,
        label: 'Casual',
        blurb: 'Free flight. No clock, no fail.',
        hint: 'Fly anywhere. Land on a nest to man the turret.',
        course: false, laps: 0, rivals: false,
        drones: 'ambient', nesting: true, rings: false,
        timed: false, canFail: false, gentle: true,
        scoreKind: null, lowerIsBetter: false,
    },
    [MODES.RACE]: {
        id: MODES.RACE,
        label: 'Gauntlet Race',
        blurb: 'Three laps, three rivals.',
        hint: 'Follow the ribbon. Pass every gate in order.',
        course: true, laps: 3, rivals: true,
        drones: 'off', nesting: false, rings: false,
        timed: true, canFail: false, gentle: false,
        scoreKind: 'time', lowerIsBetter: true,
    },
    [MODES.RING_RUSH]: {
        id: MODES.RING_RUSH,
        label: 'Ring Rush',
        blurb: 'Collect every ring, fast.',
        hint: 'The clock starts on your first ring.',
        course: false, laps: 0, rivals: false,
        drones: 'off', nesting: false, rings: true,
        timed: true, canFail: false, gentle: false,
        scoreKind: 'time', lowerIsBetter: true,
    },
    [MODES.DRONE_HUNTER]: {
        id: MODES.DRONE_HUNTER,
        label: 'Drone Hunter',
        blurb: '60 seconds. Ram everything.',
        hint: 'Fly through drones to destroy them. Chain kills for combo.',
        course: false, laps: 0, rivals: false,
        drones: 'hunt', nesting: false, rings: false,
        timed: true, canFail: false, gentle: false,
        scoreKind: 'score', lowerIsBetter: false,
    },
    [MODES.TURRET_DEFENSE]: {
        id: MODES.TURRET_DEFENSE,
        label: 'Turret Defense',
        blurb: 'Hold the nest. Wave after wave.',
        hint: 'Land on the nest, then aim and fire. Three lives.',
        course: false, laps: 0, rivals: false,
        drones: 'waves', nesting: true, rings: false,
        timed: false, canFail: true, gentle: false,
        scoreKind: 'wave', lowerIsBetter: false,
    },
};

/** Descriptor lookup that never returns undefined. */
export function modeDef(mode) {
    return MODE_DEFS[mode] || MODE_DEFS[DEFAULT_MODE];
}

/** True if `mode` is a real mode id. */
export function isMode(mode) {
    return Object.prototype.hasOwnProperty.call(MODE_DEFS, mode);
}

// --- time --------------------------------------------------------------------

/**
 * Format seconds as M:SS.cc.
 *
 * NOT verbatim from Birb Mobile, deliberately. The original did
 * `Math.floor((seconds % 1) * 100)`, and `61.23 % 1` is 0.2299999999999969 in
 * binary floating point, so a 61.23s run displayed as "1:01.22" — a
 * centisecond lost to truncation on roughly any value you care about.
 *
 * Quantising to centiseconds FIRST and decomposing from there fixes it, and
 * makes the 59.999 -> "1:00.00" rollover fall out for free instead of
 * rendering "0:59.100".
 */
export function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00';
    const totalCs = Math.round(seconds * 100);
    const mins = Math.floor(totalCs / 6000);
    const secs = Math.floor(totalCs / 100) % 60;
    const cs = totalCs % 100;
    return mins + ':' + String(secs).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}

// --- run state ---------------------------------------------------------------

/**
 * The per-run state shape. One object for every mode: unused fields simply stay
 * at their defaults, which is cheaper and far less error-prone than a union of
 * per-mode shapes when the HUD reads across all of them.
 */
export function createRunState() {
    return {
        mode: DEFAULT_MODE,
        active: false,
        started: false,      // Ring Rush: the clock starts on the first ring
        finished: false,
        time: 0,
        score: 0,

        ringsCollected: 0,
        ringsTotal: 0,       // synced from the real spawned count, never assumed

        dronesDestroyed: 0,
        combo: 1,
        comboTimer: 0,

        wave: 1,
        lives: TURRET_LIVES,
        waveSpawnCount: 3,
        waveSpawnedThisWave: 0,
        waveKills: 0,
        dronesRemaining: 0,
        waveComplete: false,
        droneSpawnTimer: 0,
    };
}

/**
 * Reset for a fresh run in `mode`. Mutates in place — zero allocation, so a
 * restart mid-session costs nothing.
 *
 * `ringsTotal` is deliberately NOT reset: the caller syncs it from the real
 * number of rings that actually spawned. Birb Mobile shipped a bug where the
 * win condition used a hardcoded 10 against 18 spawned rings, so Ring Rush
 * could never be completed. Assume nothing about the spawner.
 */
export function resetRunState(s, mode) {
    s.mode = isMode(mode) ? mode : DEFAULT_MODE;
    s.active = true;
    s.started = false;
    s.finished = false;
    s.time = 0;
    s.score = 0;
    s.ringsCollected = 0;
    s.dronesDestroyed = 0;
    s.combo = 1;
    s.comboTimer = 0;
    s.wave = 1;
    s.lives = TURRET_LIVES;
    s.waveSpawnCount = 3;
    s.waveSpawnedThisWave = 0;
    s.waveKills = 0;
    s.dronesRemaining = 0;
    s.waveComplete = false;
    s.droneSpawnTimer = 0;
    return s;
}

// --- win / lose --------------------------------------------------------------

/** Ring Rush is won when every SPAWNED ring is collected. */
export function ringRushWon(s) {
    return s.ringsTotal > 0 && s.ringsCollected >= s.ringsTotal;
}

/** Remaining Drone Hunter time, clamped at zero. */
export function droneHunterRemaining(time) {
    return Math.max(0, DRONE_HUNTER_DURATION - time);
}

export function droneHunterTimeUp(s) {
    return s.time >= DRONE_HUNTER_DURATION;
}

/** Turret Defense is lost when the nest's lives run out. */
export function turretDefenseLost(s) {
    return s.lives <= 0;
}

/** Wave N spawns 2 + N drones. Verbatim from Birb Mobile's curve. */
export function nextWaveSpawnCount(wave) {
    return 2 + wave;
}

/**
 * Has this run reached its end condition? One entry point so the game loop does
 * not re-implement the per-mode check, which is where the original's
 * hardcoded-ring-count bug lived.
 */
export function runIsOver(s) {
    switch (s.mode) {
        case MODES.RING_RUSH: return ringRushWon(s);
        case MODES.DRONE_HUNTER: return droneHunterTimeUp(s);
        case MODES.TURRET_DEFENSE: return turretDefenseLost(s);
        // Casual never ends; Race is ended by race-logic's lap counter.
        default: return false;
    }
}

/** The value a finished run reports, or null for modes that do not score. */
export function runResult(s) {
    switch (modeDef(s.mode).scoreKind) {
        case 'time': return s.time;
        case 'score': return s.score;
        case 'wave': return s.wave;
        default: return null;
    }
}

// --- scoring / combo ---------------------------------------------------------

/**
 * Apply a kill. `baseScore` is decided by the caller (it is RNG- and
 * time-dependent) so this stays deterministic and testable.
 *
 * Returns the combo floor before and after, so the caller can fire the
 * combo-up VFX only when the whole number actually changes.
 */
export function applyKillScore(s, baseScore) {
    s.dronesDestroyed++;
    s.score += Math.round(baseScore * s.combo);
    const before = Math.floor(s.combo);
    s.combo = Math.min(COMBO_MAX, s.combo + 0.25);
    s.comboTimer = COMBO_DECAY_SECONDS;
    return { before, after: Math.floor(s.combo) };
}

/** Tick combo decay. Returns true on the frame the combo lapses. */
export function decayCombo(s, dt) {
    if (s.comboTimer > 0) {
        s.comboTimer -= dt;
        if (s.comboTimer <= 0) {
            s.comboTimer = 0;
            s.combo = 1;
            return true;
        }
    }
    return false;
}

// --- personal bests ----------------------------------------------------------

/** localStorage key for a mode's personal best. */
export function bestKey(mode) {
    return 'gauntlet.best.' + mode;
}

/**
 * Decide whether a finished run beat the saved best.
 *
 * `savedRaw` is the raw string from localStorage (or null). Returns the value
 * to display AND persist, so the caller never has to re-derive which is which.
 * Pure — storage I/O stays with the caller.
 */
export function evaluateBest(savedRaw, runValue, mode) {
    const def = modeDef(mode);
    const lower = def.lowerIsBetter;
    if (!Number.isFinite(runValue)) return { isNewBest: false, bestValue: null };

    const parsed = savedRaw == null ? NaN : Number(savedRaw);
    const hasSaved = Number.isFinite(parsed);
    if (!hasSaved) return { isNewBest: true, bestValue: runValue };

    const isNewBest = lower ? runValue < parsed : runValue > parsed;
    return { isNewBest, bestValue: isNewBest ? runValue : parsed };
}

/** Render a best value the way its mode wants to be read. */
export function formatBest(mode, value) {
    if (value == null || !Number.isFinite(value)) return null;
    switch (modeDef(mode).scoreKind) {
        case 'time': return formatTime(value);
        case 'score': return String(Math.round(value));
        case 'wave': return 'Wave ' + Math.round(value);
        default: return null;
    }
}

// --- daily streak ------------------------------------------------------------

export const STREAK_KEY = 'gauntlet.streak.v1';

/**
 * Advance a play streak. `todayIso` / `lastIso` are YYYY-MM-DD.
 *
 * Same day  -> unchanged. Yesterday -> +1. Anything else -> back to 1.
 * Pure, so the rollover is testable without waiting a day.
 */
export function advanceStreak(prev, todayIso) {
    const count = prev && Number.isFinite(prev.count) ? prev.count : 0;
    const last = prev && prev.last ? prev.last : null;
    if (last === todayIso) return { count: Math.max(1, count), last: todayIso };

    const dayMs = 86400000;
    const t = Date.parse(todayIso + 'T00:00:00Z');
    const l = last ? Date.parse(last + 'T00:00:00Z') : NaN;
    const consecutive = Number.isFinite(l) && Number.isFinite(t) && (t - l) === dayMs;
    return { count: consecutive ? count + 1 : 1, last: todayIso };
}
