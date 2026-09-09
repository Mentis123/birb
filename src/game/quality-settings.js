/**
 * src/game/quality-settings.js — quality mode and request routing
 *
 * Wave 2 / task P2.1b of docs/ULTRACODE_PERFORMANCE_PLAN.md §4.
 *
 * Pure module: imports nothing, side effects injected as callbacks.
 * Auto / Manual / Benchmark modes; Manual suspends adaptive tier writes.
 * Benchmark freezes seed, route, settings AND sun (the latter is critical —
 * the game runs a ten-minute sun cycle, so an A/B taken three minutes apart
 * measures the time of day).
 *
 * Requested vs effective are reported separately: `effective` is READ BACK,
 * never echoed. This entire programme exists because of one such desync.
 *
 * Paused is NOT a reset tag: it marks samples invalid for adaptive decisions
 * but retains them, because a 900ms frame while the tab was hidden is real
 * data about the resume path and erasing it means the controller learns
 * nothing about a boundary it crosses every session.
 */

export const QUALITY_MODES = {
  AUTO: 'auto',
  MANUAL: 'manual',
  BENCHMARK: 'benchmark',
};

export const REQUEST_SOURCES = {
  PANEL: 'panel',
  ADAPTIVE: 'adaptive',
  PROBE: 'probe',
};

export const RESET_TAGS = {
  LOAD: 'load',
  RESUME: 'resume',
  RESIZE: 'resize',
  ORIENTATION: 'orientation',
  CONTEXT_RESTORE: 'contextRestore',
  ENVIRONMENT: 'environment',
  MANUAL: 'manual',
};

export const BENCHMARK_FROZEN = ['seed', 'route', 'settings', 'sun'];

/**
 * createQualitySettings — factory for a quality settings instance.
 *
 * @param {Object} deps — injected dependencies (testable, mockable)
 *   apply(key, value) — route a requested value to the live renderer
 *   readEffective(key) — read back what the live object came back with
 *   onResetHistory({ tag, mode, atMs }) — signal a history reset
 *   freeze(what, frozen) — freeze/thaw a benchmark item (what ∈ BENCHMARK_FROZEN)
 *   now() — return current timestamp in ms
 *   clamp(key, value) — optional; bounds a value live
 *   storage — optional { getItem, setItem }; locks are session-scoped (never persisted)
 *
 * @returns {Object} instance
 *   .mode — current mode string (auto/manual/benchmark)
 *   .setMode(mode) — throws RangeError on unknown mode
 *   .request({ source, key, value }) — route a request; returns record with fields:
 *       { key, source, requested, effective, clamped, desync, changed, applied, rejected, reason? }
 *       - requested: the value exactly as requested, unmodified
 *       - effective: the value read back from the live object after apply (CONTRACT §0)
 *       - clamped: true if the injected clamp function bounded the request
 *       - desync: true if effective !== what was handed to apply (the headline defect)
 *       - changed: true if effective before and after apply differ
 *       - applied: true only if request was not rejected and not desync
 *   .sealDefaults() — end the probe's defaults window
 *   .setPaused(bool) — mark samples valid/invalid for adaptive decisions
 *   .setLearningEnabled(bool) — the user's learning preference (PNL-5)
 *   .snapshot() — { mode, adapting, learning, paused, sealed, values }
 */
export function createQualitySettings({
  apply,
  readEffective,
  onResetHistory,
  freeze,
  now,
  clamp,
  storage,
}) {
  let mode = QUALITY_MODES.AUTO;
  let sealed = false;
  let paused = false;
  let learningEnabled = false;
  let userLearningPreference = false; // The user's PNL-5 toggle, preserved across mode changes
  const values = new Map(); // key -> record

  return {
    get mode() {
      return mode;
    },

    setMode(newMode) {
      // Closed enum: reject anything else.
      if (!Object.values(QUALITY_MODES).includes(newMode)) {
        throw new RangeError(`Unknown mode: ${newMode}`);
      }

      // No-op if already in that mode.
      if (newMode === mode) {
        return;
      }

      const oldMode = mode;
      mode = newMode;

      // Entering BENCHMARK: freeze all four items, suspend learning.
      if (newMode === QUALITY_MODES.BENCHMARK) {
        for (const item of BENCHMARK_FROZEN) {
          freeze(item, true);
        }
        learningEnabled = false;
      }
      // Exiting BENCHMARK: thaw everything, restore learning. Reset history only when entering AUTO.
      else if (oldMode === QUALITY_MODES.BENCHMARK) {
        for (const item of BENCHMARK_FROZEN) {
          freeze(item, false);
        }
        learningEnabled = userLearningPreference;
        // Only reset history when transitioning to AUTO, not to MANUAL
        if (newMode === QUALITY_MODES.AUTO) {
          onResetHistory({ tag: RESET_TAGS.MANUAL, mode: newMode, atMs: now() });
        }
      }
      // Entering MANUAL: suspend learning (but preserve the user's preference).
      else if (newMode === QUALITY_MODES.MANUAL) {
        learningEnabled = false;
      }
      // Exiting MANUAL to AUTO: restore learning, reset history.
      else if (oldMode === QUALITY_MODES.MANUAL && newMode === QUALITY_MODES.AUTO) {
        learningEnabled = userLearningPreference;
        onResetHistory({ tag: RESET_TAGS.MANUAL, mode: newMode, atMs: now() });
      }
    },

    request({ source, key, value }) {
      // Validate source: must be from the closed enum.
      if (!Object.values(REQUEST_SOURCES).includes(source)) {
        return {
          key,
          source,
          requested: value,
          effective: null,
          rejected: true,
          reason: 'unknown-source',
        };
      }

      // Probe after seal: rejected.
      if (source === REQUEST_SOURCES.PROBE && sealed) {
        return {
          key,
          source,
          requested: value,
          effective: null,
          rejected: true,
          reason: 'probe-after-init',
        };
      }

      // Manual/Benchmark suspend adaptive tier writes (CONTRACT §7.1).
      // Adaptive requests are rejected; panel and probe still work.
      if (source === REQUEST_SOURCES.ADAPTIVE && mode !== QUALITY_MODES.AUTO) {
        return {
          key,
          source,
          requested: value,
          effective: null,
          rejected: true,
          reason: 'mode-locked',
        };
      }

      // Read effective before apply.
      const effectiveBefore = readEffective(key);

      // Apply clamp if provided (bounds are live outside this module).
      let clampedValue = value;
      if (clamp) {
        clampedValue = clamp(key, value);
      }

      // Route to the renderer.
      apply(key, clampedValue);

      // Read effective after apply (CONTRACT §0: never recomputed from intent).
      const effectiveAfter = readEffective(key);
      const changed = effectiveBefore !== effectiveAfter;

      // Clamped: the request was not honoured in full — the gap between what
      // the panel asked for and what the live object came back with.
      //
      // G2d gate decision. Wave 2R redefined this as `clampedValue !== value`
      // on G2a's prose recommendation, which broke QS-A6 and QS-A7 — two FROZEN
      // assertions that were green. The suite defines the term deliberately and
      // says so in its own failure message: "the gap between the two is
      // reported as a clamp". From the panel's side that is the reportable
      // fact, and WHICH layer bounded the request (a clamp function, or the
      // renderer refusing it) is a separate question. R5: the oracle wins over
      // advice about the oracle.
      const clamped = effectiveAfter !== value;

      // Desync: the live object did not accept the value handed to apply.
      // This is the distinction G2a was actually reaching for, and it is kept —
      // additively, because it is real. A clamp function bounding 1.73 to 1.7
      // is an honest clamp; the live object ignoring what it was handed is the
      // headline defect class this programme exists to detect, and only this
      // field separates them.
      const desync = effectiveAfter !== clampedValue;

      // Applied: the request actually reached the live object AND moved it.
      // G2a §4.7's real finding was here, not in `clamped`: with apply wired to
      // nothing, this used to report true. A record claiming a request was
      // applied when no rendering state moved is the exact failure G2b exists
      // to detect, appearing inside the module that reports it.
      // Not `!desync`: QS-A6's rig injects the quantiser on the RENDERER, so a
      // live object that legitimately snaps 1.73 to its own 0.05 grid reports
      // desync while having genuinely applied the request. Rendering state
      // moving is the evidence; re-requesting the value already in force is
      // honest too, and is the second clause.
      const applied = changed || effectiveAfter === clampedValue;

      // Build the record.
      const record = {
        key,
        source,
        requested: value,
        effective: effectiveAfter,
        clamped,
        desync,
        changed,
        applied,
        rejected: false,
      };

      // Store for snapshot.
      values.set(key, record);

      return record;
    },

    sealDefaults() {
      sealed = true;
    },

    setPaused(bool) {
      paused = bool;
      // NOTE: paused is NOT a reset tag. It marks samples invalid for decisions
      // but retains them (CONTRACT §2.2, RUL-2). Do not emit onResetHistory.
    },

    setLearningEnabled(bool) {
      userLearningPreference = bool;
      // Learning is enabled only in Auto mode; elsewhere it is suspended.
      learningEnabled = bool && mode === QUALITY_MODES.AUTO;
    },

    snapshot() {
      // Build the values object: every key that has been requested.
      const valuesObj = {};
      for (const [key, record] of values) {
        valuesObj[key] = {
          requested: record.requested,
          effective: record.effective,
          clamped: record.clamped,
          desync: record.desync,
        };
      }

      return {
        mode,
        // Adapting is true only in Auto mode and only when not paused.
        adapting: mode === QUALITY_MODES.AUTO && !paused,
        learning: learningEnabled,
        paused,
        sealed,
        values: valuesObj,
      };
    },
  };
}
