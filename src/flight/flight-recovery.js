/**
 * Flight-recovery state machine — the FLYING / FALLING / GROUNDED core,
 * extracted from index.html as one of the final two "seam" extractions
 * recommended by CODEBASE_EVALUATION.md (L1).
 *
 * This machine is DELICATE: in index.html its transitions are read from ~30
 * sites and its side effects (screen shake, recovery-button UI, crash/land
 * sounds, flight-speed overrides, knockdown/launch position impulses) are
 * spread across the render loop. So this module deliberately owns only the
 * MOVABLE core — the states enum, the tuning config, the fall-ramp /
 * launch-boost timer math, and a tiny factory that holds the mutable state +
 * timers and fires injected enter-callbacks on transition. All Three.js /
 * DOM / audio side effects stay in index.html, passed in as callbacks, so
 * this file imports nothing (no CDN, no THREE) and unit-tests under plain
 * `node --test`.
 *
 * Zero-allocation: the factory allocates once; transitionTo() and the math
 * helpers allocate nothing per frame.
 */

export const FLIGHT_RECOVERY_STATES = {
  FLYING: 'flying',
  FALLING: 'falling',
  GROUNDED: 'grounded',
};

export const FLIGHT_RECOVERY_CONFIG = {
  birdRadius: 0.6,
  walkSpeed: 2.1,
  // Pull the stick back past this (y < -threshold) to walk backwards.
  // backMult keeps the reverse shuffle a touch slower than the forward
  // walk, the way a real bird backs up more tentatively than it strides.
  walkBackThreshold: 0.3,
  walkBackMult: 0.7,
  // Committed knockdown: you're going down. Slow enough (~1s fall)
  // that the tumble reads as a moment, not a teleport.
  knockbackFallSpeed: 5.0,
  minFlightResumeSpeed: 3.5,
  // Tap-to-launch impulse after walking. Outward boost for a short window
  // so the bird pops off the ground with the same weight as a nest takeoff.
  launchBoostSpeed: 6.0,
  launchBoostDuration: 0.4,
};

// Fall accelerates: 1× for first frame → 3× after FALL_RAMP_DURATION seconds.
export const FALL_RAMP_DURATION = 3.0;
export const FALL_RAMP_MAX_MULT = 3.0;

/**
 * Linear fall-ramp multiplier: 1× at fallTimer 0, ramping to maxMult after
 * `duration` seconds, then held. Pure — this is the math the knockdown impulse
 * scales by each frame (verbatim from index.html's per-frame ramp).
 */
export function fallRampMultiplier(
  fallTimer,
  duration = FALL_RAMP_DURATION,
  maxMult = FALL_RAMP_MAX_MULT,
) {
  const rampT = Math.min(fallTimer / duration, 1);
  return 1 + rampT * (maxMult - 1);
}

/**
 * Create the flight-recovery owner. Holds the mutable `state` plus the
 * `fallTimer` / `launchBoostTimer` clocks, and fires injected enter-callbacks
 * when the state changes. Index.html mirrors `.state` into its module-scope
 * `flightRecoveryState` so the ~30 read-sites stay byte-identical.
 *
 * @param onEnter optional ({ next, prev }) => void, called once per real
 *   transition AFTER `state` updates, so the host can run shake/sound/UI.
 */
export function createFlightRecovery({ onEnter } = {}) {
  let state = FLIGHT_RECOVERY_STATES.FLYING;
  let fallTimer = 0;
  let launchBoostTimer = 0;

  return {
    get state() { return state; },
    get fallTimer() { return fallTimer; },
    set fallTimer(v) { fallTimer = v; },
    get launchBoostTimer() { return launchBoostTimer; },
    set launchBoostTimer(v) { launchBoostTimer = v; },

    isFlying() { return state === FLIGHT_RECOVERY_STATES.FLYING; },
    isFalling() { return state === FLIGHT_RECOVERY_STATES.FALLING; },
    isGrounded() { return state === FLIGHT_RECOVERY_STATES.GROUNDED; },

    /**
     * Transition to a new state. No-op if already there (matches the original
     * `if (flightRecoveryState === nextState) return;` guard). Resets the
     * fall clock on entering FALLING. Fires `onEnter({ next, prev })`.
     * Returns true if a transition actually happened.
     */
    transitionTo(next) {
      if (state === next) return false;
      const prev = state;
      state = next;
      if (next === FLIGHT_RECOVERY_STATES.FALLING) {
        fallTimer = 0;
      }
      if (onEnter) onEnter({ next, prev });
      return true;
    },

    /**
     * Advance the fall clock and return the current knockdown ramp multiplier.
     * Pure timer bookkeeping — the caller applies the radial impulse.
     */
    advanceFall(delta) {
      fallTimer += delta;
      return fallRampMultiplier(fallTimer);
    },

    /** Tick down the launch-boost window; returns true while still boosting. */
    advanceLaunchBoost(delta) {
      if (launchBoostTimer <= 0) return false;
      launchBoostTimer = Math.max(0, launchBoostTimer - delta);
      return true;
    },

    /** Arm the launch-boost window (tap Fly from grounded). */
    armLaunchBoost() {
      launchBoostTimer = FLIGHT_RECOVERY_CONFIG.launchBoostDuration;
    },
  };
}
