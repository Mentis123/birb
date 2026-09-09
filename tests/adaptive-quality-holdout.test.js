/**
 * tests/adaptive-quality-holdout.test.js — the anti-laundering check.
 *
 * Wave 3 / task P3.1 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4:
 * "Holdout traces' seed lives only in the gate prompt."
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * A controller tuned until the committed sixteen scenarios go green has learned
 * the committed sixteen. That is the closed loop the whole tiering law exists
 * to prevent — "an agent that writes both the code and its test is a closed
 * loop that proves nothing" — arriving by the back door: the agent does not
 * have to write the test, only iterate against it.
 *
 * The traces here are generated from a seed THE GATE SUPPLIES. Nothing about
 * them is in the repository: not the seed, not a cached copy, not an example.
 * `generateHoldout()` throws without a seed, and
 * tests/perf-trace-corpus.test.js TC-18 asserts that this file provides no
 * fallback for it.
 *
 * ---------------------------------------------------------------------------
 * RUN
 * ---------------------------------------------------------------------------
 *   BIRB_PERF_IMPL=1 BIRB_PERF_HOLDOUT_SEED=<seed> \
 *     node --test tests/adaptive-quality-holdout.test.js
 *
 * Without the seed the suite SKIPS, loudly, naming what is missing. That is
 * deliberate and it is also a hazard: a skipped check and a passing check look
 * alike in a log, and this repo has already shipped one summary line that said
 * `ok` on a failing run. **The gate must record the fingerprint printed below**
 * in docs/perf/gates/G3*.md; a gate file with no fingerprint in it did not run
 * the holdout.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS CHECKED, AND WHY IT IS THRESHOLD-FREE
 * ---------------------------------------------------------------------------
 * Nothing here knows what the controller "should" do on any particular trace.
 * Every check is one of:
 *
 *   INV-1  a contract violation (binary)
 *   INV-5  persistent oscillation, via the shared evaluateOscillation (PRO-13)
 *   INV-7  the probe budget (PRO-8)
 *   INV-14 not dominated by any FIXED profile run on the identical trace
 *   INV-18 and, where the ground truth says there was something to win, better
 *          than never moving
 *
 * INV-14 is the development loop's own question — "verify that adaptation earns
 * its overhead" — asked with no weights and no invented trade-off: the
 * controller fails only if some fixed profile is no worse on BOTH of the plan's
 * evaluator metrics and strictly better on one. Its two guards (a segment where
 * every rung fits, or none does, decides nothing; and every change of the
 * correct rung costs at least one detection window) were both added because a
 * controller handed the capacity model itself failed without them. See
 * tests/perf-trace-corpus.test.js TC-15, which pins that.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runTrace } from './fixtures/perf-traces/driver.js';
import { generateHoldout, holdoutFingerprint, HOLDOUT_ENV_VAR } from './fixtures/perf-traces/holdout.js';
import { createFixedPolicy } from './fixtures/perf-traces/reference-policies.js';
import * as INV from './fixtures/perf-traces/invariants.js';
import { PROVISIONAL } from '../src/game/perf-constants.js';

const MODULE = '../src/game/adaptive-quality.js';
const K = PROVISIONAL;

const SEED = process.env[HOLDOUT_ENV_VAR];
const COUNT = Number(process.env.BIRB_PERF_HOLDOUT_COUNT || 12);

const SKIP = !process.env.BIRB_PERF_IMPL
  ? 'BIRB_PERF_IMPL unset — src/game/adaptive-quality.js is a Wave 3 deliverable (P3.3)'
  : (!SEED
    ? `${HOLDOUT_ENV_VAR} unset — the holdout seed lives in the gate prompt and nowhere else. ` +
      `Run: BIRB_PERF_IMPL=1 ${HOLDOUT_ENV_VAR}=<seed> node --test tests/adaptive-quality-holdout.test.js`
    : false);

async function load() {
  try {
    return await import(MODULE);
  } catch (err) {
    err.message = `[red-first] ${MODULE} does not exist yet — Wave 3 P3.3 must create it.\n` +
      `  original (${err.code || 'no code'}): ${err.message}`;
    throw err;
  }
}

function adapt(createAdaptiveQuality) {
  let ctrl = null;
  return {
    label: 'adaptive-quality',
    start(ctx) { ctrl = createAdaptiveQuality({ ...ctx, profile: 'auto' }); },
    frame(f) { ctrl.frame(f); },
    reset(tag, tMs) { if (typeof ctrl.reset === 'function') ctrl.reset(tag, tMs); },
    setMode(mode, tMs) { if (typeof ctrl.setMode === 'function') ctrl.setMode(mode, tMs); },
    setPaused(p, r, t) { if (typeof ctrl.setPaused === 'function') ctrl.setPaused(p, r, t); },
  };
}

test('HO-1 the controller survives traces it has never seen', { skip: SKIP }, async () => {
  const { createAdaptiveQuality } = await load();

  // The fingerprint, not the seed. It is enough to prove two runs used the same
  // seed and not enough to reproduce it. The gate copies this line into G3.
  console.error(`[holdout] ${COUNT} traces, seed fingerprint ${holdoutFingerprint(SEED)}`);

  const traces = generateHoldout(SEED, { count: COUNT, K });
  const failures = [];

  for (const scenario of traces) {
    const depth = scenario.ladder.length;
    const gt = scenario.groundTruth;

    const adaptive = runTrace(scenario, { policy: adapt(createAdaptiveQuality), K });
    const fixed = [];
    for (let r = 0; r < depth; r += 1) fixed.push(runTrace(scenario, { policy: createFixedPolicy(r), K }));

    const checks = [
      INV.noViolations(adaptive),
      INV.boundedProbes(adaptive, { K }),
      INV.noPersistentOscillation(adaptive, { K }),
      INV.notDominatedByFixedProfile(adaptive, fixed, {
        K, decisiveMs: gt.decisiveMs, regimeChanges: gt.regimeChanges, upwardSteps: gt.upwardSteps,
      }),
      INV.beatsStandingStill(adaptive, fixed[scenario.startRung], {
        gainAvailableMs: gt.gainAvailableMs, climbBudgetMs: gt.climbBudgetMs, climbWindowMs: gt.climbWindowMs, decisiveMs: gt.decisiveMs, K, allFixed: fixed,
      }),
    ];

    for (const c of checks) {
      if (!c.pass) {
        failures.push(`${scenario.name} [${scenario.title}] ${c.id}: ${c.message}`);
      }
    }
  }

  assert.deepEqual(failures, [],
    `${failures.length} holdout failure(s) across ${traces.length} unseen traces ` +
    `(fingerprint ${holdoutFingerprint(SEED)}):\n  - ${failures.join('\n  - ')}`);
});
