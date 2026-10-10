/**
 * perf-advisor.js — the Auto graphics setting's eye on the frame rate.
 *
 * Auto starts on the best preset and never changes it by itself. What it does
 * is WATCH: when the frame rate sags it raises a yellow chip in the corner
 * that offers one step down, and the player decides. Ignore the chip and one
 * of two things happens — the frame rate recovers and the chip goes away, or
 * it does not and the chip turns red and asks again.
 *
 * This file is only the judgement (pure, no THREE, no DOM, zero allocation
 * per sample, unit-tested in tests/perf-advisor.test.js). index.html feeds it
 * the frame sampler's ~250 ms FPS readings and owns the chip.
 *
 * The thresholds, and why:
 * - iOS caps requestAnimationFrame at 60 Hz, so 60 is "perfect" on the phone
 *   this is built for. A 120 Hz desktop sits far above every line here.
 * - The average is an exponential moving average with a 2.5 s time constant:
 *   one hitch (a shader compile, a biome switch) moves it a few fps and cannot
 *   trip anything on its own; only a sustained sag can.
 * - YELLOW below 48 fps held for 3 s. 48 is a fifth under 60 — the point where
 *   a 60 Hz panel is dropping roughly every fifth frame and the judder is
 *   visible in a turn, not just measurable.
 * - RED below 38 fps held for 3 s (straight from OK if it is that bad), OR a
 *   yellow that has been ignored for 20 s while the average is still under
 *   48. Under 38 most frames are being held for two refreshes: the game is
 *   effectively running at 30.
 * - RESOLVE (back to OK) at 54 fps or better held for 6 s. The 48-54 band is
 *   hysteresis: a phone that hovers around 50 does not flicker the chip.
 * - GRACE of 4 s after boot, after any preset change and after any pause
 *   (an invalid sample: settings open, background tab) or a gap in the
 *   samples longer than 5 s: every one of those is followed by shader
 *   compiles and a cold frame that say nothing about steady-state
 *   performance. The gap is deliberately long — a device rendering a frame
 *   every second or two is exactly the device that most needs the chip, and
 *   a 1 s gap rule would have read its every frame as a resume.
 */

export const PERF_LEVELS = Object.freeze({ OK: 'ok', WARN: 'warn', BAD: 'bad' });

export const PERF_ADVISOR_DEFAULTS = Object.freeze({
  tauMs: 2500,          // EMA time constant
  warnBelow: 48,        // fps
  badBelow: 38,         // fps
  resolveAbove: 54,     // fps
  enterHoldMs: 3000,    // sustained sag before yellow / red
  escalateMs: 20000,    // an ignored yellow still under warnBelow turns red
  resolveHoldMs: 6000,  // sustained recovery before the chip clears
  graceMs: 4000,        // ignore samples after boot / preset change / resume
  gapMs: 5000,          // a gap this long between samples is an unreported resume
});

export function createPerfAdvisor(options = {}) {
  const cfg = { ...PERF_ADVISOR_DEFAULTS, ...options };
  const state = {
    level: PERF_LEVELS.OK,
    avg: 0,
    seeded: false,
    lastTime: null,
    graceUntil: null,   // null = start a grace on the first sample
    lowSince: null,     // avg < warnBelow continuously since
    veryLowSince: null, // avg < badBelow continuously since
    highSince: null,    // avg >= resolveAbove continuously since
    warnSince: null,    // when the current yellow began
    forced: null,
  };

  function clearTimers() {
    state.lowSince = null;
    state.veryLowSince = null;
    state.highSince = null;
  }

  function setLevel(level, time) {
    if (state.level === level) return false;
    state.level = level;
    state.warnSince = level === PERF_LEVELS.WARN ? time : null;
    return true;
  }

  return {
    /**
     * Feed one FPS reading. `valid` false (paused, hidden) holds everything.
     * Returns true when the level changed, so the caller touches the DOM only
     * then.
     */
    sample(fps, time, valid = true) {
      if (state.forced) return false;
      if (!valid || !Number.isFinite(fps) || !Number.isFinite(time)) {
        // Whatever comes next starts with a grace, never a stale timer.
        state.lastTime = null;
        clearTimers();
        return false;
      }
      if (state.lastTime === null || time - state.lastTime > cfg.gapMs || time < state.lastTime) {
        state.graceUntil = time + cfg.graceMs;
        state.seeded = false;
        clearTimers();
      }
      const dt = state.lastTime === null ? 0 : time - state.lastTime;
      state.lastTime = time;
      if (time < state.graceUntil) return false;

      if (!state.seeded) {
        state.avg = fps;
        state.seeded = true;
      } else {
        state.avg += (fps - state.avg) * (1 - Math.exp(-dt / cfg.tauMs));
      }
      const avg = state.avg;

      if (avg < cfg.warnBelow) { if (state.lowSince === null) state.lowSince = time; } else state.lowSince = null;
      if (avg < cfg.badBelow) { if (state.veryLowSince === null) state.veryLowSince = time; } else state.veryLowSince = null;
      if (avg >= cfg.resolveAbove) { if (state.highSince === null) state.highSince = time; } else state.highSince = null;

      const L = PERF_LEVELS;
      if (state.level !== L.BAD) {
        if (state.veryLowSince !== null && time - state.veryLowSince >= cfg.enterHoldMs) return setLevel(L.BAD, time);
        if (state.level === L.WARN && state.lowSince !== null && time - state.warnSince >= cfg.escalateMs) {
          return setLevel(L.BAD, time);
        }
      }
      if (state.level === L.OK && state.lowSince !== null && time - state.lowSince >= cfg.enterHoldMs) {
        return setLevel(L.WARN, time);
      }
      if (state.level !== L.OK && state.highSince !== null && time - state.highSince >= cfg.resolveHoldMs) {
        return setLevel(L.OK, time);
      }
      return false;
    },

    /**
     * The player took the offer (or the preset changed some other way): back
     * to OK, forget the history, and give the new preset a grace period.
     */
    reset() {
      state.level = PERF_LEVELS.OK;
      state.warnSince = null;
      state.lastTime = null;
      state.seeded = false;
      clearTimers();
      return true;
    },

    /** Debug/capture only: hold a level regardless of samples; null releases. */
    force(level) {
      if (level === null || level === undefined) {
        state.forced = null;
        this.reset();
        return state.level;
      }
      if (level !== PERF_LEVELS.OK && level !== PERF_LEVELS.WARN && level !== PERF_LEVELS.BAD) return state.level;
      state.forced = level;
      state.level = level;
      return level;
    },

    getLevel() { return state.level; },
    getAverage() { return state.seeded ? state.avg : null; },
    snapshot() {
      return {
        level: state.level,
        avgFps: state.seeded ? Math.round(state.avg * 10) / 10 : null,
        forced: state.forced,
        thresholds: { warnBelow: cfg.warnBelow, badBelow: cfg.badBelow, resolveAbove: cfg.resolveAbove },
      };
    },
  };
}

/**
 * The preset one step lighter than `index` in an ordered list (best first),
 * or -1 when there is nothing lighter left to offer.
 */
export function nextLighterPreset(index, count) {
  return index >= 0 && index + 1 < count ? index + 1 : -1;
}
