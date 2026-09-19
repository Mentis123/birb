/**
 * src/game/frame-stats.js — frame-interval acceptance gates and oscillation detection
 *
 * Wave 2 / task P2.1 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4.
 * Implements the acceptance gates (ACC-1 through ACC-4) and the oscillation detector
 * for tier quality, as specified in tests/frame-stats-totals.test.js.
 *
 * Exports two functions:
 *   evaluateAcceptanceGates(samples, { targetFPS, thresholds? })
 *   evaluateOscillation(tierChangeLog, { settleMs?, windowMs?, observedMs, maxReversals? })
 *
 * Percentiles are computed by the ONE shared helper in `frame-metrics.js`
 * (docs/perf/CONTRACT.md: "the value the controller fires on and the value
 * the acceptance gate scores must be computed by the same module, or the
 * loop is closed against itself" — see docs/perf/gates/G2a.md §4.1). This
 * module used to carry its own private `nearestRankPercentile`; it disagreed
 * with `frame-metrics.percentile` and was O(n^2) on top of that (§4.11).
 */

import { percentile as sharedPercentile, HITCH_THRESHOLD_MS } from './frame-metrics.js';

// ============================================================================
// ACCEPTANCE GATES — thresholds and provenance (CONTRACT §10)
// ============================================================================

/**
 * ACCEPTANCE_THRESHOLDS — provisional constants for the four acceptance gates.
 *
 * Every value is `unmeasured` and unlocked by Wave 4 device testing. Do not
 * treat these as fixed in any test or default.
 *
 * Sourced from:
 *   PRO-10: p95 ≤ 18.5 ms — initial sustained acceptance
 *   PRO-11: < 1% of intervals > 25 ms on the repeatable route
 *   PRO-12: no recurring unexplained > 50 ms spikes
 *   minSamples: sufficiency floor for percentile computation
 */
export const ACCEPTANCE_THRESHOLDS = {
  p95MaxMs: 18.5,               // PRO-10
  longIntervalMs: 25,           // PRO-11
  longIntervalMaxFraction: 0.01, // PRO-11: < 1%
  // PRO-12: derived from frame-metrics' own HITCH_THRESHOLD_MS, not restated —
  // docs/perf/gates/G2a.md §4.12: the same provisional number declared twice
  // in two modules is a number Wave 4 will change in one place and not the
  // other, with nothing to say so (CONTRACT §10 rule 2: one named constant).
  spikeMs: HITCH_THRESHOLD_MS,
  spikeRecurrenceCount: 3,      // min occurrences to call it "recurring"
  minSamples: 100,              // sufficiency floor (testable as <<, unmeasured value)
};

/**
 * ACCEPTANCE_PROVENANCE — metadata for each threshold.
 * Declares the source and status of every number so Wave 4 can change them
 * without hunting through implementations.
 */
export const ACCEPTANCE_PROVENANCE = {
  p95MaxMs: { provenance: 'unmeasured', provisional: 'PRO-10' },
  longIntervalMs: { provenance: 'unmeasured', provisional: 'PRO-11' },
  longIntervalMaxFraction: { provenance: 'unmeasured', provisional: 'PRO-11' },
  spikeMs: { provenance: 'unmeasured', provisional: 'PRO-12' },
  spikeRecurrenceCount: { provenance: 'unmeasured' },
  minSamples: { provenance: 'unmeasured' },
};

// ============================================================================
// OSCILLATION DEFAULTS (CONTRACT §10 PRO-13)
// ============================================================================

/**
 * OSCILLATION_DEFAULTS — the definition of "persistent" quality oscillation.
 *
 * PRO-13: "no persistent quality oscillation after settling" — the very
 * definition of "persistent" is itself unmeasured. These are the initial
 * thresholds; Wave 4 unlocks them.
 *
 *   settleMs: 5000  — changes inside this window (warm-up) are not oscillation
 *   windowMs: 30000 — evaluate reversals in this window after settling
 *   maxReversals: 3 — at most this many direction changes before it fails
 */
export const OSCILLATION_DEFAULTS = {
  settleMs: 5000,
  windowMs: 30000,
  maxReversals: 3,
};

/**
 * OSCILLATION_PROVENANCE — metadata for oscillation thresholds.
 */
export const OSCILLATION_PROVENANCE = {
  settleMs: { provenance: 'unmeasured', provisional: 'PRO-13' },
  windowMs: { provenance: 'unmeasured', provisional: 'PRO-13' },
  maxReversals: { provenance: 'unmeasured', provisional: 'PRO-13' },
};

// ============================================================================
// ACCEPTED TAGS (CONTRACT §2.1)
// ============================================================================

/**
 * Valid reset tags — a closed set. Used to explain spikes in ACC-3.
 * A spike tagged with one of these is "explained" and does not fail the gate.
 */
const VALID_TAGS = new Set([
  'load', 'resume', 'resize', 'orientation', 'contextRestore', 'environment', 'manual',
]);

// ============================================================================
// SENTINEL HELPER
// ============================================================================

/**
 * Sentinel — "there is no value for this".
 * Never 0, never a default, never derived from the code's intent — only
 * from an explicit unavailable-data reason.
 */
function sentinel(reason) {
  return { value: null, state: 'unavailable', reason };
}

// ============================================================================
// TAG VALIDATION
// ============================================================================

/**
 * Validate that a tag is in the accepted set or null.
 * Throws RangeError if an invalid tag is encountered.
 */
function validateTag(tag) {
  if (tag === null || tag === undefined) return;
  if (!VALID_TAGS.has(tag)) {
    throw new RangeError(`Invalid tag: ${JSON.stringify(tag)}. Must be one of ${Array.from(VALID_TAGS).join(', ')} or null.`);
  }
}

// ============================================================================
// SAMPLE VALIDATION
// ============================================================================

/**
 * Validate that a sample has the required fields and correct shape.
 */
function validateSample(sample) {
  if (!sample || typeof sample !== 'object') {
    throw new TypeError('Each sample must be an object');
  }
  if (typeof sample.dtMs !== 'number' || !Number.isFinite(sample.dtMs)) {
    throw new TypeError(`Sample dtMs must be a finite number, got ${sample.dtMs}`);
  }
  if (typeof sample.tMs !== 'number' || !Number.isFinite(sample.tMs)) {
    throw new TypeError(`Sample tMs must be a finite number, got ${sample.tMs}`);
  }
  if ('valid' in sample && typeof sample.valid !== 'boolean') {
    throw new TypeError(`Sample valid must be boolean, got ${sample.valid}`);
  }
  if ('tag' in sample) {
    validateTag(sample.tag);
  }
}

// ============================================================================
// CHANGELOGENTRY VALIDATION
// ============================================================================

/**
 * Validate a tier change log entry.
 */
function validateChangeLogEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('Each change log entry must be an object');
  }
  if (typeof entry.tMs !== 'number' || !Number.isFinite(entry.tMs)) {
    throw new TypeError(`Change log entry tMs must be a finite number, got ${entry.tMs}`);
  }
  if (typeof entry.from !== 'number' || !Number.isFinite(entry.from)) {
    throw new TypeError(`Change log entry from must be a finite number, got ${entry.from}`);
  }
  if (typeof entry.to !== 'number' || !Number.isFinite(entry.to)) {
    throw new TypeError(`Change log entry to must be a finite number, got ${entry.to}`);
  }
}

// ============================================================================
// MAIN: evaluateAcceptanceGates
// ============================================================================

/**
 * Evaluate the four acceptance gates over a stream of frame-interval samples.
 *
 * Samples must carry: dtMs (frame duration), tMs (absolute time), valid (boolean),
 * tag (reset tag from the closed enum, or null).
 *
 * ACC-1: p95 frame interval <= threshold
 * ACC-2: < X% of intervals > threshold
 * ACC-3: no recurring unexplained spikes > threshold (unexplained = untagged)
 * ACC-4: no persistent quality oscillation (ALWAYS a sentinel — requires tier change log)
 *
 * Percentiles are computed over valid === true only.
 * Tags do NOT remove samples from percentiles; they only explain spikes for ACC-3.
 * Counts report both valid and invalid samples.
 *
 * @param {Array} samples — array of { dtMs, tMs, valid?, invalidReason?, tag? }
 * @param {Object} opts — { targetFPS, thresholds? }
 *                  thresholds defaults to ACCEPTANCE_THRESHOLDS
 * @returns {Object} — { targetBudgetMs, counts, p50, p95, p99, missedTargetPct,
 *                       unexplainedSpikes, gates: { 'ACC-1', 'ACC-2', 'ACC-3', 'ACC-4' } }
 */
export function evaluateAcceptanceGates(samples, { targetFPS, thresholds } = {}) {
  // Validate inputs
  if (!Array.isArray(samples)) {
    throw new TypeError('samples must be an array');
  }
  if (typeof targetFPS !== 'number' || !Number.isFinite(targetFPS) || targetFPS <= 0) {
    throw new TypeError('targetFPS must be a positive finite number');
  }

  // Use injected thresholds or defaults
  const T = thresholds || ACCEPTANCE_THRESHOLDS;

  // Validate all samples
  for (const sample of samples) {
    validateSample(sample);
  }

  // Separate valid and invalid intervals
  const validIntervals = [];
  let invalidCount = 0;

  for (const sample of samples) {
    if (sample.valid !== false) {
      validIntervals.push(sample.dtMs);
    } else {
      invalidCount += 1;
    }
  }

  const totalCount = samples.length;
  const validCount = validIntervals.length;

  // Compute target budget: B = 1000 / targetFPS
  const targetBudgetMs = 1000 / targetFPS;

  // ========================================================================
  // Check sufficiency: do we have enough valid samples?
  // ========================================================================
  const sufficient = validCount >= T.minSamples;
  const insufficientSentinel = sentinel('insufficient-samples');

  // ========================================================================
  // ACC-1: p95 frame interval <= p95MaxMs
  // ACC-2: < longIntervalMaxFraction of intervals > longIntervalMs
  // ========================================================================

  let p50 = insufficientSentinel;
  let p95 = insufficientSentinel;
  let p99 = insufficientSentinel;
  let missedTargetPct = insufficientSentinel;

  let acc1Pass = false;
  let acc2Pass = false;
  let acc2Value = insufficientSentinel;

  if (sufficient) {
    // Compute percentiles over valid intervals only
    p50 = sharedPercentile(validIntervals, 50);
    p95 = sharedPercentile(validIntervals, 95);
    p99 = sharedPercentile(validIntervals, 99);

    // Missed-target percentage: count intervals > budget / total valid
    let missedCount = 0;
    for (const dt of validIntervals) {
      if (dt > targetBudgetMs) missedCount += 1;
    }
    missedTargetPct = (missedCount / validCount) * 100;

    // ACC-1: p95 <= threshold
    acc1Pass = p95 <= T.p95MaxMs;

    // ACC-2: < 1% (or the configured fraction) > 25 ms (or the configured value)
    let longCount = 0;
    for (const dt of validIntervals) {
      if (dt > T.longIntervalMs) longCount += 1;
    }
    const longFraction = validCount > 0 ? longCount / validCount : 0;
    acc2Pass = longFraction <= T.longIntervalMaxFraction;
    // Reported alongside its own threshold (T.longIntervalMaxFraction * 100) —
    // docs/perf/gates/G2a.md §4.3: the gate used to score longFraction but
    // report missedTargetPct (a different quantity, against B not 25ms) next
    // to it, so a passing ACC-2 could display e.g. 40 against a threshold of 1.
    acc2Value = longFraction * 100;
  }

  // ========================================================================
  // ACC-3: no recurring unexplained spikes
  // ========================================================================

  let unexplainedSpikes = insufficientSentinel;
  let acc3Pass = true;

  if (sufficient) {
    // Count spikes > spikeMs that are NOT tagged (i.e., unexplained) AND not
    // excluded by validity. docs/perf/gates/G2a.md §4.4 / CONTRACT §2.2: tags
    // EXPLAIN spikes, validity EXCLUDES samples — different axes. A hidden-tab
    // frame (valid:false, no tag) previously counted as an unexplained spike.
    const spikeOccurrences = [];
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      if (sample.valid !== false && sample.dtMs > T.spikeMs && !sample.tag) {
        spikeOccurrences.push(i);
      }
    }

    unexplainedSpikes = spikeOccurrences.length;

    // ACC-3 passes if unexplained spike count is below the recurrence threshold
    // "recurring" means >= spikeRecurrenceCount occurrences
    acc3Pass = unexplainedSpikes < T.spikeRecurrenceCount;
  }

  // ========================================================================
  // ACC-4: oscillation — always a sentinel (evaluated by separate function)
  // ========================================================================

  const acc4Sentinel = sentinel('not-applicable');

  // ========================================================================
  // Build result object
  // ========================================================================

  const result = {
    targetBudgetMs,
    counts: {
      total: totalCount,
      valid: validCount,
      invalid: invalidCount,
    },
    p50,
    p95,
    p99,
    missedTargetPct,
    unexplainedSpikes,
    gates: {
      'ACC-1': sufficient
        ? { pass: acc1Pass, value: p95, threshold: T.p95MaxMs }
        : insufficientSentinel,
      'ACC-2': sufficient
        ? { pass: acc2Pass, value: acc2Value, threshold: T.longIntervalMaxFraction * 100 }
        : insufficientSentinel,
      'ACC-3': sufficient
        ? { pass: acc3Pass, value: unexplainedSpikes, threshold: T.spikeRecurrenceCount }
        : insufficientSentinel,
      'ACC-4': acc4Sentinel,
    },
  };

  return result;
}

// ============================================================================
// MAIN: evaluateOscillation
// ============================================================================

/**
 * Evaluate oscillation in tier changes.
 *
 * ACC-4: no persistent quality oscillation after settling.
 *
 * "Oscillation" is measured as REVERSALS — direction changes in the tier
 * sequence — not total changes. A monotonic downshift followed by settling
 * is not oscillation. Reversals inside the settle window are excluded.
 *
 * The observed duration must be long enough (settle + window) for the
 * evaluation to be meaningful. Without sufficient observation time, returns
 * a sentinel.
 *
 * @param {Array} tierChangeLog — array of { tMs, from, to, reason? }
 * @param {Object} opts — { settleMs?, windowMs?, observedMs, maxReversals? }
 *                  settleMs, windowMs, maxReversals default to OSCILLATION_DEFAULTS
 * @returns {Object} — { pass, reversals, window? } or sentinel
 */
export function evaluateOscillation(tierChangeLog, { settleMs, windowMs, observedMs, maxReversals } = {}) {
  // Validate inputs
  if (!Array.isArray(tierChangeLog)) {
    throw new TypeError('tierChangeLog must be an array');
  }

  // Use defaults; observedMs defaults to 0 if not provided
  const settleWindow = settleMs ?? OSCILLATION_DEFAULTS.settleMs;
  const evalWindow = windowMs ?? OSCILLATION_DEFAULTS.windowMs;
  const maxRev = maxReversals ?? OSCILLATION_DEFAULTS.maxReversals;
  const observed = observedMs ?? 0;

  // Validate all entries
  for (const entry of tierChangeLog) {
    validateChangeLogEntry(entry);
  }

  // ========================================================================
  // Sufficiency check: do we have enough observed time?
  // ========================================================================

  const endMs = settleWindow + evalWindow;
  if (observed < endMs) {
    return sentinel('insufficient-samples');
  }

  // ========================================================================
  // Filter to entries INSIDE the window this function reports.
  //
  // docs/perf/gates/G2a.md §4.9: this used to filter only `entry.tMs >=
  // settleWindow` with no upper bound, while the returned `window` advertised
  // `{ startMs: settleMs, endMs: settleMs + windowMs }` — so a reversal at,
  // say, 80s was counted and blamed on a "window" that reports itself as
  // closing at 35s. Bounded here by endMs, chosen over widening the reported
  // window: PRO-13's window is "evaluate reversals in this window after
  // settling", a fixed evaluation period, not "however long the log runs".
  // ========================================================================

  const settled = tierChangeLog.filter((entry) => entry.tMs >= settleWindow && entry.tMs <= endMs);

  // ========================================================================
  // Count reversals in the settled window
  // ========================================================================

  let reversals = 0;

  if (settled.length >= 2) {
    // A reversal is a direction change: if the tier went up then down, or down then up.
    // We track the direction of the previous change and count when it flips.
    let lastDirection = null; // 'up', 'down', or null

    for (const entry of settled) {
      const direction = entry.to > entry.from ? 'up' : entry.to < entry.from ? 'down' : null;

      if (direction !== null && lastDirection !== null && direction !== lastDirection) {
        reversals += 1;
      }

      if (direction !== null) {
        lastDirection = direction;
      }
    }
  }

  // ========================================================================
  // Pass/fail: reversals < maxReversals
  // ========================================================================

  const pass = reversals < maxRev;

  return {
    pass,
    reversals,
    window: {
      startMs: settleWindow,
      endMs,
    },
  };
}
