/**
 * tests/fixtures/perf-traces/ladder.js — what a "rung" is.
 *
 * Wave 3 / P3.1. Part of the trace corpus; see ./README.md.
 *
 * A capacity trace says "at THIS setting the frame costs THIS much". That
 * needs an agreed, ordered set of settings. This module is that set.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE
 * ---------------------------------------------------------------------------
 * A ladder is an ORDERED array. Index 0 is the highest quality; higher indices
 * are cheaper. "Downshift" means index increases. Nothing else about a rung is
 * interpreted by the driver: a rung's `settings` are documentation for the
 * human and a target for the controller, and the driver never reads them to
 * compute a cost. Cost comes from the trace, because cost is a property of the
 * DEVICE and the SCENE, not of the setting name.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE TWO LADDERS
 * ---------------------------------------------------------------------------
 * COMPAT_LADDER is today's shipped three tiers, transcribed from
 * docs/perf/CONTRACT.md §1.3, which lists them as facts about the code —
 * re-derivable by grep, explicitly NOT provisional. It exists because
 * CONTRACT §11 requires the new controller to ship a profile that "reproduces
 * today's 55/58 three-tier behaviour exactly", and a trace corpus that cannot
 * express the reference behaviour cannot compare against it.
 *
 * SEPARATED_LADDER is the finer ladder the source plan's own step 5 orders:
 *
 *   "Prefer low visual loss: reduce shaft work, distant mist/weather coverage
 *    and post resolution; then reduce scene DPR in 0.05-0.10 steps. Reorder
 *    this list from device A/B evidence."
 *
 * The ORDER above is quoted, not invented. The DPR step sizes are PRO-7 and
 * are imported, not written down here. The last sentence is the reason
 * `SEPARATED_LADDER` is a function of the constants rather than a literal: a
 * Wave 4 device pass reorders it, and a fixture that hard-coded the order
 * would have to be rewritten instead of re-run.
 *
 * The first gap in docs/PERFORMANCE_REALISM_PLAN.md is precisely that today's
 * tier 0->1 "changes DPR 1.7->1.0, switches bloom off and reduces other
 * effects together ... Separate the controls." COMPAT is the bundled ladder;
 * SEPARATED is the separated one. Traces declare which they are written
 * against, because a controller's behaviour on a 3-rung bundled ladder and a
 * 7-rung separated one are different questions.
 *
 * No THREE, no DOM.
 */

import { PROVISIONAL } from '../../../src/game/perf-constants.js';

/**
 * Keys a rung may carry. This list is the panel-owned quantity set from
 * CONTRACT §7.2's routing register, minus everything that is not a quality
 * lever. It is a CLOSED set so that a ladder cannot quietly grow a knob the
 * controller is not allowed to touch.
 */
export const RUNG_SETTING_KEYS = Object.freeze([
  'dpr',            // renderer pixel ratio (T3 / applyTier)
  'post',           // 'full' | 'half' | 'quarter' | 'off'  (bloom pass, T1)
  'shafts',         // boolean — light shafts (the 8-pass vs 5-pass branch)
  'weatherDensity', // 0..1 (T5/T6)
  'mistBudget',     // 0..1 (T7/T8)
  'contactShadow',  // boolean (T9)
  'ribbons',        // boolean (T10)
  'cloudShell',     // boolean (applyTier)
  'wind',           // 0..1 (T4)
]);

/**
 * Keys NO rung may EVER carry. docs/PERFORMANCE_REALISM_PLAN.md step 4:
 * "Never reduce collision, input or flight simulation fidelity to conceal a
 * rendering bottleneck." CONTRACT §7.2 repeats it: "No route in this register
 * touches bird-flight.js, touch-input.js, collider-grid.js or any gameplay
 * target."
 *
 * The driver treats an apply() naming one of these as a VIOLATION rather than
 * a setting. It is listed here, in the fixture, on purpose: an invariant that
 * lives only in the controller's own source cannot catch the controller.
 */
export const FORBIDDEN_SETTING_KEYS = Object.freeze([
  'physicsRate', 'collisionRate', 'colliderGrid', 'inputRate', 'inputSmoothing',
  'flightFidelity', 'simulationRate', 'substeps', 'reducedMotion',
]);

/**
 * COMPAT_LADDER — today's shipped tiers, verbatim from CONTRACT §1.3:
 *
 *   0 = DPR <= DPR_CAP + bloom on + cloud shell on
 *   1 = DPR 1.0, bloom off, cloud shell off, weather 0.5, mist 0.65
 *   2 = DPR 0.85, no contact shadow, no ribbons, wind 0.35, weather 0, mist 0.35
 *
 * @param {object} K — a PROVISIONAL-shaped constants table.
 */
export function compatLadder(K = PROVISIONAL) {
  return Object.freeze([
    Object.freeze({
      id: 'tier0',
      label: 'tier 0 (shipped: full)',
      settings: Object.freeze({
        dpr: K.dprDefaultCeilingMobile, post: 'half', shafts: true,
        weatherDensity: 1, mistBudget: 1, contactShadow: true, ribbons: true,
        cloudShell: true, wind: 1,
      }),
    }),
    Object.freeze({
      id: 'tier1',
      label: 'tier 1 (shipped: no post)',
      settings: Object.freeze({
        dpr: 1.0, post: 'off', shafts: false,
        weatherDensity: 0.5, mistBudget: 0.65, contactShadow: true, ribbons: true,
        cloudShell: false, wind: 1,
      }),
    }),
    Object.freeze({
      id: 'tier2',
      label: 'tier 2 (shipped: minimum)',
      settings: Object.freeze({
        dpr: 0.85, post: 'off', shafts: false,
        weatherDensity: 0, mistBudget: 0.35, contactShadow: false, ribbons: false,
        cloudShell: false, wind: 0.35,
      }),
    }),
  ]);
}

/**
 * SEPARATED_LADDER — the plan's step-5 order, one lever at a time.
 *
 * Built from the constants so a Wave 4 reorder is a table edit, not a fixture
 * rewrite. Every DPR value is derived by subtracting PRO-7's step from the
 * PRO-9 default ceiling; no DPR literal appears in this file.
 *
 * @param {object} K — a PROVISIONAL-shaped constants table.
 */
export function separatedLadder(K = PROVISIONAL) {
  const top = K.dprDefaultCeilingMobile;
  const step = K.dprStep;
  const round = (v) => Math.round(v * 1000) / 1000;
  const base = {
    dpr: top, post: 'half', shafts: true, weatherDensity: 1, mistBudget: 1,
    contactShadow: true, ribbons: true, cloudShell: true, wind: 1,
  };
  const rungs = [
    { id: 'full', label: 'everything on', settings: { ...base } },
    // plan step 5, first item: "reduce shaft work"
    { id: 'no-shafts', label: 'shafts off', settings: { ...base, shafts: false } },
    // "...distant mist/weather coverage"
    { id: 'thin-weather', label: 'weather + mist halved', settings: { ...base, shafts: false, weatherDensity: 0.5, mistBudget: 0.5 } },
    // "...and post resolution"
    { id: 'quarter-post', label: 'post at quarter res', settings: { ...base, shafts: false, weatherDensity: 0.5, mistBudget: 0.5, post: 'quarter' } },
    { id: 'no-post', label: 'post off', settings: { ...base, shafts: false, weatherDensity: 0.5, mistBudget: 0.5, post: 'off' } },
    // "...then reduce scene DPR in 0.05-0.10 steps"
    { id: 'dpr-1', label: 'post off, DPR -1 step', settings: { ...base, shafts: false, weatherDensity: 0.5, mistBudget: 0.5, post: 'off', dpr: round(top - step) } },
    { id: 'dpr-2', label: 'post off, DPR -2 steps', settings: { ...base, shafts: false, weatherDensity: 0.25, mistBudget: 0.35, post: 'off', dpr: round(top - 2 * step) } },
    { id: 'dpr-3', label: 'post off, DPR -3 steps, decoration off', settings: { ...base, shafts: false, weatherDensity: 0, mistBudget: 0.35, post: 'off', contactShadow: false, ribbons: false, cloudShell: false, dpr: round(top - 3 * step) } },
  ];
  return Object.freeze(rungs.map((r) => Object.freeze({ ...r, settings: Object.freeze(r.settings) })));
}

/** The two named ladders, by name, for a scenario's `ladder:` field. */
export const LADDERS = Object.freeze({
  compat: compatLadder,
  separated: separatedLadder,
});

/**
 * Build a ladder by name. Throws on an unknown name — a scenario naming a
 * ladder that does not exist must not silently fall back to a default, because
 * the ladder decides how many rungs every costMs row has to cover.
 */
export function buildLadder(name, K = PROVISIONAL) {
  const fn = LADDERS[name];
  if (!fn) {
    throw new RangeError(`Unknown ladder "${name}". Known: ${Object.keys(LADDERS).join(', ')}.`);
  }
  return fn(K);
}

/** `rung0`, `rung1`, ... — the key a costMs row uses for rung index `i`. */
export function rungKey(i) {
  return `rung${i}`;
}

/**
 * A synthetic ladder of N rungs, for the holdout generator, which needs
 * ladders of shapes the two named ladders do not have. Carries no settings
 * beyond a DPR that steps down: the holdout is about capacity, not about
 * which knob moved.
 */
export function syntheticLadder(depth, K = PROVISIONAL) {
  if (!Number.isInteger(depth) || depth < 2) {
    throw new RangeError(`syntheticLadder depth must be an integer >= 2, got ${depth}`);
  }
  const top = K.dprDefaultCeilingMobile;
  const step = K.dprStep;
  const out = [];
  for (let i = 0; i < depth; i += 1) {
    const dpr = Math.max(K.dprSliderMin, Math.round((top - i * step) * 1000) / 1000);
    out.push(Object.freeze({
      id: `synthetic${i}`,
      label: `synthetic rung ${i}`,
      settings: Object.freeze({
        dpr,
        post: i === 0 ? 'half' : i < depth - 1 ? 'quarter' : 'off',
        shafts: i === 0,
        weatherDensity: Math.max(0, 1 - i / (depth - 1)),
        mistBudget: Math.max(0, 1 - i / (depth - 1)),
        contactShadow: i < depth - 1,
        ribbons: i < depth - 1,
        cloudShell: i === 0,
        wind: i < depth - 1 ? 1 : 0.35,
      }),
    }));
  }
  return Object.freeze(out);
}
