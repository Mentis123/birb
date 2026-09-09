/**
 * src/game/perf-constants.js — the ONE named object holding every provisional
 * number in the adaptive-realism programme.
 *
 * Wave 3 / task P3.1 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4.
 * Transcribes docs/perf/CONTRACT.md §10, whose first line is:
 *
 *   "This section is the single most expensive mistake available in this
 *    programme."
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT INSIDE adaptive-quality.js
 * ---------------------------------------------------------------------------
 * CONTRACT §10 rule 2 says every provisional value is read from ONE named
 * constant object in `src/game/adaptive-quality.js`, "so a Wave 4 device pass
 * changes numbers in one place and nothing else moves". The rule's subject is
 * ONE OBJECT, and that is preserved exactly: `PROVISIONAL` below is that
 * object, and `adaptive-quality.js` (Wave 3 P3.3) imports and re-exports it
 * rather than declaring a second one.
 *
 * It is a separate module because of the ordering. P3.1 authors the trace
 * corpus, and CONTRACT §10 rule 1 requires the corpus to be "authored as
 * capacity models parameterised on the threshold, not as arrays baked against
 * one". A corpus parameterised on numbers it cannot import until the module it
 * is the oracle FOR has been written is a corpus that cannot be run, and a
 * corpus that cannot be run before the controller exists cannot be watched
 * discriminating (R8). So the numbers land here, one wave early, and the
 * controller reads them from here.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS *NOT* IN HERE, DELIBERATELY
 * ---------------------------------------------------------------------------
 * PRO-10, PRO-11, PRO-12 and PRO-13 already have a home:
 * `src/game/frame-stats.js` exports `ACCEPTANCE_THRESHOLDS` and
 * `OSCILLATION_DEFAULTS`, and PRO-12 is in turn derived there from
 * `frame-metrics.js`'s own `HITCH_THRESHOLD_MS`. They are IMPORTED and
 * re-exposed below, never restated. docs/perf/gates/G2a.md §4.12: "the same
 * provisional number declared twice in two modules is a number Wave 4 will
 * change in one place and not the other, with nothing to say so."
 *
 * ---------------------------------------------------------------------------
 * RANGES
 * ---------------------------------------------------------------------------
 * Four rows in §10 are ranges, not points ("10-15 seconds", "2-3 seconds",
 * "0.05-0.10 steps", "0.85-2.0"). Collapsing a range to a point IS picking a
 * number, so each keeps both: `<name>MinMs`/`<name>MaxMs` for the range the
 * plan states, and `<name>Ms` for the point the code has to run with, whose
 * provenance is recorded as `unmeasured` exactly like the range. Assertions
 * that care must be written against the RANGE (a restore inside
 * [restoreStabilityMinMs, restoreStabilityMaxMs] is conforming); only defaults
 * use the point.
 *
 * No import of THREE, no DOM, no side effects. Safe under `node --test`
 * against the tracked 4-class three stub.
 */

import { ACCEPTANCE_THRESHOLDS, OSCILLATION_DEFAULTS } from './frame-stats.js';

/**
 * The target frame rate, and the budget B every threshold below is expressed
 * against. NOT provisional in its value: CONTRACT §9 DEF-3 defers 30/90/120
 * until a named pacing mechanism exists, so the panel's Target rate control
 * ships 60 only. B = 1000 / targetFPS is arithmetic, not a threshold.
 */
export const TARGET_FPS = 60;

/** B, in milliseconds. Arithmetic on TARGET_FPS — do not hand-write 16.67. */
export function budgetMs(targetFPS = TARGET_FPS) {
  if (!Number.isFinite(targetFPS) || targetFPS <= 0) {
    throw new RangeError(`targetFPS must be a positive finite number, got ${targetFPS}`);
  }
  return 1000 / targetFPS;
}

/**
 * PROVISIONAL — the one object. Every field is `unmeasured` or
 * `shipped-unvalidated` (see PROVENANCE). Wave 4 changes them here and
 * nowhere else.
 *
 * Frozen so an accidental write in a test or a controller cannot silently
 * retune the programme: a corpus greened against a mutated constant is the
 * 55/58 failure with extra steps.
 */
export const PROVISIONAL = Object.freeze({
  // -- PRO-1 / PRO-2 / PRO-3 — the overload rule -----------------------------
  /** PRO-1: p95 interval > this multiple of B is overload. */
  overloadP95Multiplier: 1.2,
  /** PRO-2: more than this percentage of frames missing B is overload. */
  overloadMissedTargetPct: 5,
  /** PRO-2: ...sustained for this many consecutive evaluation windows. */
  overloadWindowCount: 2,
  /** PRO-3: the evaluation window. Everything above is measured over one of these. */
  evaluationWindowMs: 1000,

  // -- PRO-4 — restore only after sustained stability ------------------------
  /** PRO-4 range: "Restore one small step only after 10-15 seconds of stability". */
  restoreStabilityMinMs: 10000,
  restoreStabilityMaxMs: 15000,
  /** PRO-4 point, for a default. Provenance identical to the range. */
  restoreStabilityMs: 12000,

  // -- PRO-5 — headroom required before restoring ----------------------------
  /** PRO-5: "roughly 20% measured CPU/GPU work headroom where available". */
  restoreHeadroomFraction: 0.20,

  // -- PRO-6 — hold after an ordinary adjustment -----------------------------
  /** PRO-6 range: "Hold for 2-3 seconds after ordinary adjustments". */
  settleHoldMinMs: 2000,
  settleHoldMaxMs: 3000,
  /** PRO-6 point, for a default. */
  settleHoldMs: 2500,

  // -- PRO-7 — the DPR reduction step ---------------------------------------
  /** PRO-7 range: "then reduce scene DPR in 0.05-0.10 steps". */
  dprStepMin: 0.05,
  dprStepMax: 0.10,
  /** PRO-7 point, for a default. */
  dprStep: 0.05,

  // -- PRO-8 — bounded exploration ------------------------------------------
  /** PRO-8: "at most one optional upgrade probe per 30 seconds". */
  probeIntervalMs: 30000,
  /** PRO-8: "one outstanding probe". NOT a tunable in the same sense — but it
   *  is stated in the same provisional sentence, so it is recorded here. */
  maxOutstandingProbes: 1,

  // -- PRO-9 — the DPR slider ------------------------------------------------
  /** PRO-9: "Absolute render-DPR slider, initially 0.85-2.0 in 0.05 steps". */
  dprSliderMin: 0.85,
  dprSliderMax: 2.0,
  dprSliderStep: 0.05,
  /** PRO-9: the mobile default ceiling. The 1.7 itself is `shipped-validated`
   *  (raised from 1.2 on positive device feedback); its role as a DEFAULT
   *  rather than a hard cap is what is unmeasured. */
  dprDefaultCeilingMobile: 1.7,
  dprDefaultCeilingDesktop: 1.8,

  // -- PRO-10..PRO-13 — imported, never restated ----------------------------
  /** PRO-10 (src/game/frame-stats.js ACCEPTANCE_THRESHOLDS.p95MaxMs). */
  acceptanceP95MaxMs: ACCEPTANCE_THRESHOLDS.p95MaxMs,
  /** PRO-11 (frame-stats.js). */
  acceptanceLongIntervalMs: ACCEPTANCE_THRESHOLDS.longIntervalMs,
  acceptanceLongIntervalMaxFraction: ACCEPTANCE_THRESHOLDS.longIntervalMaxFraction,
  /** PRO-12 (frame-stats.js, itself derived from frame-metrics HITCH_THRESHOLD_MS). */
  acceptanceSpikeMs: ACCEPTANCE_THRESHOLDS.spikeMs,
  acceptanceSpikeRecurrenceCount: ACCEPTANCE_THRESHOLDS.spikeRecurrenceCount,
  acceptanceMinSamples: ACCEPTANCE_THRESHOLDS.minSamples,
  /** PRO-13 (frame-stats.js OSCILLATION_DEFAULTS). */
  oscillationSettleMs: OSCILLATION_DEFAULTS.settleMs,
  oscillationWindowMs: OSCILLATION_DEFAULTS.windowMs,
  oscillationMaxReversals: OSCILLATION_DEFAULTS.maxReversals,

  // -- PRO-14 — panel cadence -----------------------------------------------
  /** PRO-14: "Update panel telemetry about four times per second". The
   *  companion rule -- no per-frame DOM work -- is NOT provisional (§3.4). */
  panelCadenceHz: 4,
  /** Arithmetic on the above; kept as a field because the traces need it as a
   *  period, and 1000/4 hand-written in a fixture is an inlined number. */
  panelUpdateIntervalMs: 1000 / 4,

  // -- PRO-15 — bounded development loop ------------------------------------
  /** PRO-15: "initially allow three candidate revisions per experiment". */
  candidateRevisionsPerExperiment: 3,

  // -- PRO-16 — the SHIPPED policy. `shipped-unvalidated`, not `measured`. ---
  /** index.html 6509-6513. The compatibility profile (CONTRACT §11) reproduces
   *  these exactly. CLAUDE.md: they were tuned against a sampler that could
   *  not run. Cite them as a baseline of BEHAVIOUR, never of correctness. */
  compatLowFpsThreshold: 55,
  compatRestoreFpsThreshold: 58,
  compatLowWindowMs: 2000,
  compatHighWindowMs: 4000,
  compatMinIntervalMs: 1500,
  /** The 250 ms cadence the shipped sampler feeds at (FRAME_SAMPLE_WINDOW_MS).
   *  Part of the compatibility profile's behaviour: `sampleFps` averages values
   *  that are themselves 250 ms window averages (CONTRACT §1.3). */
  compatSampleWindowMs: 250,

  // -- PRO-17 — post downscale ----------------------------------------------
  /** PRO-17: bloom `downscale = 2`, never A/B'd against quarter-res. */
  bloomDownscale: 2,
});

/**
 * PROVENANCE — one row per field of PROVISIONAL. `provenance` is the word
 * CONTRACT §0 defines; `pro` is the §10 row; `quote` is the source sentence,
 * verbatim, so a later wave can see what was actually claimed.
 *
 * A field of PROVISIONAL with no row here is a number nobody wrote down the
 * origin of. `assertProvenanceComplete()` below makes that fail loudly rather
 * than pass quietly, which is this repo's whole documented problem.
 */
export const PROVENANCE = Object.freeze({
  overloadP95Multiplier: { pro: 'PRO-1', provenance: 'unmeasured', quote: 'initial overload rule: p95 interval >1.2xB or >5% missed-target frames for two windows' },
  overloadMissedTargetPct: { pro: 'PRO-2', provenance: 'unmeasured', quote: 'or >5% missed-target frames for two windows' },
  overloadWindowCount: { pro: 'PRO-2', provenance: 'unmeasured', quote: 'for two windows' },
  evaluationWindowMs: { pro: 'PRO-3', provenance: 'unmeasured', quote: 'Evaluate one-second windows' },
  restoreStabilityMinMs: { pro: 'PRO-4', provenance: 'unmeasured', quote: 'Restore one small step only after 10-15 seconds of stability' },
  restoreStabilityMaxMs: { pro: 'PRO-4', provenance: 'unmeasured', quote: 'Restore one small step only after 10-15 seconds of stability' },
  restoreStabilityMs: { pro: 'PRO-4', provenance: 'unmeasured', quote: 'point chosen inside the stated range; the range is the requirement' },
  restoreHeadroomFraction: { pro: 'PRO-5', provenance: 'unmeasured', quote: 'with roughly 20% measured CPU/GPU work headroom where available' },
  settleHoldMinMs: { pro: 'PRO-6', provenance: 'unmeasured', quote: 'Hold for 2-3 seconds after ordinary adjustments' },
  settleHoldMaxMs: { pro: 'PRO-6', provenance: 'unmeasured', quote: 'Hold for 2-3 seconds after ordinary adjustments' },
  settleHoldMs: { pro: 'PRO-6', provenance: 'unmeasured', quote: 'point chosen inside the stated range; the range is the requirement' },
  dprStepMin: { pro: 'PRO-7', provenance: 'unmeasured', quote: 'then reduce scene DPR in 0.05-0.10 steps' },
  dprStepMax: { pro: 'PRO-7', provenance: 'unmeasured', quote: 'then reduce scene DPR in 0.05-0.10 steps' },
  dprStep: { pro: 'PRO-7', provenance: 'unmeasured', quote: 'point chosen inside the stated range; the range is the requirement' },
  probeIntervalMs: { pro: 'PRO-8', provenance: 'unmeasured', quote: 'initially at most one optional upgrade probe per 30 seconds' },
  maxOutstandingProbes: { pro: 'PRO-8', provenance: 'unmeasured', quote: 'one outstanding probe' },
  dprSliderMin: { pro: 'PRO-9', provenance: 'unmeasured', quote: 'Absolute render-DPR slider, initially 0.85-2.0 in 0.05 steps' },
  dprSliderMax: { pro: 'PRO-9', provenance: 'unmeasured', quote: 'Absolute render-DPR slider, initially 0.85-2.0 in 0.05 steps' },
  dprSliderStep: { pro: 'PRO-9', provenance: 'unmeasured', quote: 'Absolute render-DPR slider, initially 0.85-2.0 in 0.05 steps' },
  dprDefaultCeilingMobile: { pro: 'PRO-9', provenance: 'unmeasured', quote: 'Default ceiling stays 1.7 mobile (the 1.7 itself is shipped-validated; its role as a default is not)' },
  dprDefaultCeilingDesktop: { pro: 'PRO-9', provenance: 'unmeasured', quote: 'desktop cap, index.html DPR_CAP' },
  acceptanceP95MaxMs: { pro: 'PRO-10', provenance: 'unmeasured', quote: 'initial sustained acceptance is p95 frame interval <=18.5 ms', home: 'src/game/frame-stats.js' },
  acceptanceLongIntervalMs: { pro: 'PRO-11', provenance: 'unmeasured', quote: '<1% intervals >25 ms on the repeatable route', home: 'src/game/frame-stats.js' },
  acceptanceLongIntervalMaxFraction: { pro: 'PRO-11', provenance: 'unmeasured', quote: '<1% intervals >25 ms on the repeatable route', home: 'src/game/frame-stats.js' },
  acceptanceSpikeMs: { pro: 'PRO-12', provenance: 'unmeasured', quote: 'no recurring unexplained >50 ms spikes', home: 'src/game/frame-metrics.js HITCH_THRESHOLD_MS' },
  acceptanceSpikeRecurrenceCount: { pro: 'PRO-12', provenance: 'unmeasured', quote: 'recurring', home: 'src/game/frame-stats.js' },
  acceptanceMinSamples: { pro: 'PRO-10', provenance: 'unmeasured', quote: 'sufficiency floor for percentile computation', home: 'src/game/frame-stats.js' },
  oscillationSettleMs: { pro: 'PRO-13', provenance: 'unmeasured', quote: 'no persistent quality oscillation after settling', home: 'src/game/frame-stats.js' },
  oscillationWindowMs: { pro: 'PRO-13', provenance: 'unmeasured', quote: 'no persistent quality oscillation after settling', home: 'src/game/frame-stats.js' },
  oscillationMaxReversals: { pro: 'PRO-13', provenance: 'unmeasured', quote: 'no persistent quality oscillation after settling', home: 'src/game/frame-stats.js' },
  panelCadenceHz: { pro: 'PRO-14', provenance: 'unmeasured', quote: 'Update panel telemetry about four times per second' },
  panelUpdateIntervalMs: { pro: 'PRO-14', provenance: 'unmeasured', quote: 'arithmetic on panelCadenceHz' },
  candidateRevisionsPerExperiment: { pro: 'PRO-15', provenance: 'unmeasured', quote: 'initially allow three candidate revisions per experiment' },
  compatLowFpsThreshold: { pro: 'PRO-16', provenance: 'shipped-unvalidated', quote: 'LOW_FPS_THRESHOLD = 55, live at index.html 6509-6513' },
  compatRestoreFpsThreshold: { pro: 'PRO-16', provenance: 'shipped-unvalidated', quote: 'RESTORE_FPS_THRESHOLD = 58' },
  compatLowWindowMs: { pro: 'PRO-16', provenance: 'shipped-unvalidated', quote: 'LOW_WINDOW_MS = 2000' },
  compatHighWindowMs: { pro: 'PRO-16', provenance: 'shipped-unvalidated', quote: 'HIGH_WINDOW_MS = 4000' },
  compatMinIntervalMs: { pro: 'PRO-16', provenance: 'shipped-unvalidated', quote: 'MIN_INTERVAL_MS = 1500' },
  compatSampleWindowMs: { pro: 'PRO-16', provenance: 'shipped-unvalidated', quote: 'FRAME_SAMPLE_WINDOW_MS = 250; sampleFps averages values that are themselves 250 ms window averages' },
  bloomDownscale: { pro: 'PRO-17', provenance: 'shipped-unvalidated', quote: 'bloom downscale = 2, src/effects/bloom-pass.js:219, never A/B-ed against quarter-res' },
});

/** The two legal provenance words. `measured` is deliberately absent: nothing
 *  in this file is measured, and Wave 4 adding it is the event that unlocks
 *  every row. */
export const PROVENANCE_STATES = Object.freeze(['unmeasured', 'shipped-unvalidated']);

/**
 * Every field of PROVISIONAL has a PROVENANCE row, and every row's provenance
 * is one of the two legal words. Returns a list of problems; empty means clean.
 * Called by tests/perf-trace-corpus.test.js.
 */
export function provenanceProblems() {
  const problems = [];
  for (const key of Object.keys(PROVISIONAL)) {
    const row = PROVENANCE[key];
    if (!row) {
      problems.push(`PROVISIONAL.${key} has no PROVENANCE row — a number with no recorded origin.`);
      continue;
    }
    if (!PROVENANCE_STATES.includes(row.provenance)) {
      problems.push(`PROVISIONAL.${key} provenance "${row.provenance}" is not one of ${PROVENANCE_STATES.join(', ')}.`);
    }
    if (!row.quote) {
      problems.push(`PROVISIONAL.${key} has no source quote.`);
    }
  }
  for (const key of Object.keys(PROVENANCE)) {
    if (!(key in PROVISIONAL)) {
      problems.push(`PROVENANCE.${key} describes a field PROVISIONAL does not have — stale row.`);
    }
  }
  return problems;
}

/**
 * withConstants(overrides) — a PROVISIONAL-shaped object with some rows
 * replaced. This is how a test parameterises the corpus on a threshold
 * (CONTRACT §10 rule 1) and how Wave 4 will try a candidate table without
 * editing anything. Unknown keys throw: a typo'd override silently doing
 * nothing is how a "retuned" run turns out to have been the default run.
 */
export function withConstants(overrides = {}) {
  for (const key of Object.keys(overrides)) {
    if (!(key in PROVISIONAL)) {
      throw new RangeError(
        `withConstants: "${key}" is not a field of PROVISIONAL. ` +
        `Add the row (and its PROVENANCE) rather than passing an unknown key — ` +
        `an override that matches nothing produces a run that looks retuned and is not.`,
      );
    }
  }
  return Object.freeze({ ...PROVISIONAL, ...overrides });
}
