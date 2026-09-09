/**
 * Frame-rate sampling for the adaptive quality tier.
 *
 * This exists as its own module because of the bug that created it. The
 * sampler used to live inside the function that also wrote the FPS number
 * into a debug readout, and that function opened with:
 *
 *     if (!fpsMetric) return;
 *
 * The element it looks for, `[data-metric="fps"]`, is not in the document —
 * the string appears exactly once in the whole file, in the query that hunts
 * for it. So the guard hit on every frame the game has ever rendered, the
 * adaptive tier was never handed a sample, and the entire mobile quality
 * safety net was dead: DPR never dropped, no optional effect was ever shed,
 * and a struggling phone simply stayed struggling.
 *
 * A measurement the game acts on must never be reachable only through a
 * display. Rendering the number is optional; sampling it is not.
 */

export const FRAME_SAMPLE_WINDOW_MS = 250;

export const PERCENTILE_CONVENTION = 'nearest-rank';
export const RESET_TAGS = ['load', 'resume', 'resize', 'orientation', 'contextRestore', 'environment', 'manual'];
export const INVALID_REASONS = ['hidden', 'flightPaused', 'systemPaused', 'contextLost', 'frozen', 'benchmarkHold', 'panelHold'];
export const INTERVAL_CAPACITY = 512;
export const HITCH_CAPACITY = 256;
export const BOUNDARY_CAPACITY = 128;
export const HITCH_THRESHOLD_MS = 50;

/**
 * Nearest-rank percentile: for sorted values, index = clamp(ceil(p * n) - 1, 0, n - 1).
 * Does not sort the input array in place.
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  let index = Math.ceil(p * n) - 1;
  if (index < 0) index = 0;
  if (index > n - 1) index = n - 1;
  return sorted[index];
}

/**
 * Create an interval recorder for raw per-frame statistics.
 * Maintains fixed-capacity rings for intervals, hitches, and boundaries.
 * Invalid samples (paused) are marked and excluded from percentiles but retained in export.
 */
export function createIntervalRecorder({ capacity = INTERVAL_CAPACITY, targetFPS = 60 } = {}) {
  const budgetMs = 1000 / targetFPS;

  // Fixed-capacity rings
  const intervals = new Array(capacity);
  const hitches = new Array(HITCH_CAPACITY);
  const boundaries = new Array(BOUNDARY_CAPACITY);

  let intervalWritePos = 0;
  let intervalCount = 0;

  let hitchWritePos = 0;
  let hitchCount = 0;

  let boundaryWritePos = 0;
  let boundaryCount = 0;

  let lastTimestamp = null;
  let lastBoundaryTag = null;

  // Validate reset tags and invalid reasons
  const validResetTags = new Set(RESET_TAGS);
  const validInvalidReasons = new Set(INVALID_REASONS);

  function sample(timeMs, valid = true, invalidReason = null) {
    // First call starts the clock, records nothing
    if (lastTimestamp === null) {
      lastTimestamp = timeMs;
      return null;
    }

    const dtMs = timeMs - lastTimestamp;
    lastTimestamp = timeMs;

    // Validate invalid reason
    if (!valid && (invalidReason === null || !validInvalidReasons.has(invalidReason))) {
      throw new Error(`Invalid reason "${invalidReason}" not in INVALID_REASONS enum`);
    }

    // Record interval
    const record = {
      dtMs,
      tMs: timeMs,
      valid,
      invalidReason: valid ? null : invalidReason,
    };

    intervals[intervalWritePos] = record;
    intervalWritePos = (intervalWritePos + 1) % capacity;
    if (intervalCount < capacity) intervalCount += 1;

    // Record hitch if valid and over threshold
    if (valid && dtMs > HITCH_THRESHOLD_MS) {
      hitches[hitchWritePos] = { dtMs, tMs: timeMs };
      hitchWritePos = (hitchWritePos + 1) % HITCH_CAPACITY;
      if (hitchCount < HITCH_CAPACITY) hitchCount += 1;
    }

    return record;
  }

  function stats() {
    // Get valid intervals only for statistics
    const validIntervals = [];
    for (let i = 0; i < intervalCount; i += 1) {
      const record = intervals[(intervalWritePos - intervalCount + i + capacity) % capacity];
      if (record && record.valid) {
        validIntervals.push(record.dtMs);
      }
    }

    const sentinel = { value: null, state: 'unavailable', reason: 'insufficient-samples' };

    if (validIntervals.length === 0) {
      return {
        targetFPS,
        budgetMs,
        samples: { total: intervalCount, valid: validIntervals.length, invalid: intervalCount - validIntervals.length },
        p50: sentinel,
        p95: sentinel,
        p99: sentinel,
        missedTargetPct: sentinel,
      };
    }

    const p50Value = percentile(validIntervals, 0.5);
    const p95Value = percentile(validIntervals, 0.95);
    const p99Value = percentile(validIntervals, 0.99);

    let missedCount = 0;
    for (const v of validIntervals) {
      if (v > budgetMs) missedCount += 1;
    }
    const missedPct = (missedCount / validIntervals.length) * 100;

    return {
      targetFPS,
      budgetMs,
      samples: { total: intervalCount, valid: validIntervals.length, invalid: intervalCount - validIntervals.length },
      p50: { value: p50Value, state: 'ok', reason: null },
      p95: { value: p95Value, state: 'ok', reason: null },
      p99: { value: p99Value, state: 'ok', reason: null },
      missedTargetPct: { value: missedPct, state: 'ok', reason: null },
    };
  }

  function exportIntervals() {
    // Return chronological order (oldest to newest)
    const result = [];
    for (let i = 0; i < intervalCount; i += 1) {
      const record = intervals[(intervalWritePos - intervalCount + i + capacity) % capacity];
      if (record) {
        result.push({
          dtMs: record.dtMs,
          tMs: record.tMs,
          valid: record.valid,
          invalidReason: record.invalidReason,
        });
      }
    }
    return result;
  }

  function getHitches() {
    const result = [];
    for (let i = 0; i < hitchCount; i += 1) {
      const record = hitches[(hitchWritePos - hitchCount + i + HITCH_CAPACITY) % HITCH_CAPACITY];
      if (record) {
        result.push({ dtMs: record.dtMs, tMs: record.tMs });
      }
    }
    return result;
  }

  function getBoundaries() {
    const result = [];
    for (let i = 0; i < boundaryCount; i += 1) {
      const record = boundaries[(boundaryWritePos - boundaryCount + i + BOUNDARY_CAPACITY) % BOUNDARY_CAPACITY];
      if (record) {
        result.push({ tag: record.tag, tMs: record.tMs });
      }
    }
    return result;
  }

  function reset(tag, timeMs = null) {
    if (tag === undefined || tag === null) {
      throw new Error('reset() requires a tag');
    }
    if (!validResetTags.has(tag)) {
      throw new Error(`reset tag "${tag}" not in RESET_TAGS enum`);
    }

    const time = timeMs !== null ? timeMs : lastTimestamp;

    // Idempotent boundary: if last boundary has the same tag and no samples between, don't add another
    if (boundaryCount > 0) {
      const lastBound = boundaries[(boundaryWritePos - 1 + BOUNDARY_CAPACITY) % BOUNDARY_CAPACITY];
      if (lastBound && lastBound.tag === tag && intervalCount === 0) {
        return; // Idempotent
      }
    }

    // Record boundary
    boundaries[boundaryWritePos] = { tag, tMs: time };
    boundaryWritePos = (boundaryWritePos + 1) % BOUNDARY_CAPACITY;
    if (boundaryCount < BOUNDARY_CAPACITY) boundaryCount += 1;

    // Clear decision window (intervals only, not hitches or boundaries)
    intervalWritePos = 0;
    intervalCount = 0;
    lastTimestamp = null;
  }

  function getBuffers() {
    return {
      intervals,
      hitches,
      boundaries,
    };
  }

  return {
    capacity,
    targetFPS,
    budgetMs,
    sample,
    stats,
    exportIntervals,
    hitches: getHitches,
    boundaries: getBoundaries,
    reset,
    __buffers: getBuffers,
  };
}

export function createFrameSampler({ windowMs = FRAME_SAMPLE_WINDOW_MS } = {}) {
  let lastSampleTime = null;
  let frames = 0;
  let value = 0;

  return {
    /** Most recent measured rate, 0 before the first window closes. */
    get value() { return value; },

    /**
     * Count a frame. Returns the frame rate when a window closes, else null.
     *
     * The first call only starts the clock: the interval between "the page
     * loaded" and "the first frame rendered" includes module imports and
     * world construction, and reporting that as the frame rate would trip an
     * immediate downshift on a machine that is actually fine.
     */
    sample(time) {
      if (!Number.isFinite(time)) return null;
      if (lastSampleTime === null) {
        lastSampleTime = time;
        frames = 0;
        return null;
      }
      frames += 1;
      const elapsed = time - lastSampleTime;
      if (elapsed < windowMs) return null;
      // A backwards or zero-length window would divide by zero and hand the
      // tier manager an Infinity, which reads as "wonderful, upshift".
      if (elapsed <= 0) {
        lastSampleTime = time;
        frames = 0;
        return null;
      }
      value = (frames / elapsed) * 1000;
      frames = 0;
      lastSampleTime = time;
      return value;
    },

    /**
     * Forget the current window. Call after a stall the frame rate should not
     * be blamed for — returning from a background tab, or a world rebuild on
     * an environment switch — so one long frame cannot trigger a downshift.
     */
    reset() {
      lastSampleTime = null;
      frames = 0;
    },
  };
}
