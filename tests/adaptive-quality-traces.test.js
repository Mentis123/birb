/**
 * tests/adaptive-quality-traces.test.js — RED-FIRST spec for the controller,
 * driven by the P3.1 trace corpus.
 *
 * Wave 3 / task P3.1 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4. The module under
 * test — `src/game/adaptive-quality.js` — DOES NOT EXIST YET; P3.3 builds it.
 * This file and `tests/fixtures/perf-traces/` are the oracle it will be built
 * against, so the adapter surface below is a CONTRACT, not a suggestion.
 *
 * ---------------------------------------------------------------------------
 * R4 — red-first form
 * ---------------------------------------------------------------------------
 * Every test dynamic-imports INSIDE its body and is skipped unless
 * BIRB_PERF_IMPL is set. A top-level static import of a module that does not
 * exist resolves before any skip is evaluated and turns tests.yml red for the
 * whole repo — humanoid/, gauntlet/, sculpture/ and icon3d/ included.
 *
 *   node --test tests/adaptive-quality-traces.test.js                 # skipped
 *   BIRB_PERF_IMPL=1 node --test tests/adaptive-quality-traces.test.js # red until P3.3
 *
 * ---------------------------------------------------------------------------
 * WHY THE SCENARIOS ARE NOT DESCRIBED HERE
 * ---------------------------------------------------------------------------
 * Each scenario owns its own prose (`depicts`, `whyCapacityModel`), its own
 * invariants and its own discrimination matrix, in
 * `tests/fixtures/perf-traces/scenarios/`. Restating any of that here would
 * create a second place to change it. `tests/perf-trace-corpus.test.js` — which
 * runs unconditionally — is what proves those invariants can fail and can pass;
 * this file only points them at the real controller.
 *
 * ---------------------------------------------------------------------------
 * THE SURFACE THIS SUITE PINS  (P3.3 transcribes; it does not redesign)
 * ---------------------------------------------------------------------------
 *   createAdaptiveQuality({
 *     now,             // () => ms                       injected clock, never a wall clock
 *     apply,           // (request) => { effectiveRung, clamped, rejected, reason }
 *                      //                                 the ONE routing point (CONTRACT §7.2)
 *     ladder,          // ordered rung array; index 0 is the highest quality
 *     depth,           // ladder.length
 *     targetFPS,       // number
 *     budgetMs,        // B = 1000 / targetFPS
 *     startProfile,    // { rung, outOfRange } — the cold start, UNTRUSTED input
 *     constants,       // a PROVISIONAL-shaped table (src/game/perf-constants.js)
 *     instrumentation, // 'off' | 'on'
 *     profile,         // 'auto' (default) | 'compat'  — CONTRACT §11
 *   })
 *   -> {
 *     frame({ tMs, dtMs, valid, invalidReason, tag, cpuMs, updateMs, submitMs,
 *             gpu: { value, state, reason }, mode, rung, budgetMs, targetFPS, frameIndex })
 *     reset(tag, tMs)                 // a boundary from the closed enum
 *     setMode(mode, tMs)              // 'auto' | 'manual' | 'benchmark'
 *     setPaused(paused, reason, tMs)  // optional
 *     snapshot()                      // TEL-13/14/15 + PNL-1..4 live here
 *     history()                       // optional: the in-session action history
 *   }
 *
 * CONTRACT §11 fixes the factory's shape independently of this file: "a module
 * is unit-testable here ONLY if it imports nothing and takes its side effects
 * as injected callbacks ... So `src/game/adaptive-quality.js` MUST be
 * `createAdaptiveQuality({ apply, now, ... })`."
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScenario, REQUIRED_SCENARIOS, SCENARIO_MODULES } from './fixtures/perf-traces/index.js';
import { runTrace, runPair } from './fixtures/perf-traces/driver.js';
import * as INV from './fixtures/perf-traces/invariants.js';
import { createCompatPolicy } from './fixtures/perf-traces/reference-policies.js';
import { PROVISIONAL } from '../src/game/perf-constants.js';

const MODULE = '../src/game/adaptive-quality.js';
const IMPL = process.env.BIRB_PERF_IMPL ? false
  : 'BIRB_PERF_IMPL unset — src/game/adaptive-quality.js is a Wave 3 deliverable (P3.3)';
const K = PROVISIONAL;

/** Dynamic import with a legible red. Preserves err.code. */
async function load() {
  try {
    return await import(MODULE);
  } catch (err) {
    err.message =
      `[red-first] ${MODULE} does not exist yet — Wave 3 P3.3 must create it.\n` +
      `  The corpus it is graded against is tests/fixtures/perf-traces/ and it runs today:\n` +
      `  node --test tests/perf-trace-corpus.test.js\n` +
      `  original (${err.code || 'no code'}): ${err.message}`;
    throw err;
  }
}

/**
 * The adapter. Everything the driver needs from a controller, and nothing else.
 * Kept here rather than in the fixture package on purpose: the fixture package
 * must stay usable against ANY controller, including the reference policies and
 * whatever P3.5's A/B harness wants to compare, and it cannot do that if it
 * imports the deliverable.
 */
function adapt(createAdaptiveQuality, { profile = 'auto' } = {}) {
  let ctrl = null;
  return {
    label: `adaptive-quality(${profile})`,
    start(ctx) {
      ctrl = createAdaptiveQuality({
        now: ctx.now,
        apply: ctx.apply,
        ladder: ctx.ladder,
        depth: ctx.depth,
        targetFPS: ctx.targetFPS,
        budgetMs: ctx.budgetMs,
        startProfile: ctx.startProfile,
        constants: ctx.constants,
        instrumentation: ctx.instrumentation,
        profile,
      });
      assert.ok(ctrl && typeof ctrl.frame === 'function',
        'createAdaptiveQuality must return an object with frame(frame)');
    },
    frame(f) { ctrl.frame(f); },
    reset(tag, tMs) { if (typeof ctrl.reset === 'function') ctrl.reset(tag, tMs); },
    setMode(mode, tMs) { if (typeof ctrl.setMode === 'function') ctrl.setMode(mode, tMs); },
    setPaused(p, reason, tMs) { if (typeof ctrl.setPaused === 'function') ctrl.setPaused(p, reason, tMs); },
    snapshot() { return typeof ctrl.snapshot === 'function' ? ctrl.snapshot() : null; },
  };
}

// ---------------------------------------------------------------------------
// AQ-0 — the shape. Two of these are not optional however tempting it is to
//        make them so: without reset() a boundary is invisible to the
//        controller and CONTRACT §2.1 cannot be honoured; without setMode() the
//        panel lock is unenforceable and A10 fails on the next frame.
// ---------------------------------------------------------------------------
test('AQ-0 createAdaptiveQuality takes its side effects as injected callbacks', { skip: IMPL }, async () => {
  const { createAdaptiveQuality } = await load();
  assert.equal(typeof createAdaptiveQuality, 'function');

  const scenario = buildScenario('overload', K);
  let ctrl = null;
  const probe = {
    start(ctx) { ctrl = createAdaptiveQuality({ ...ctx, profile: 'auto' }); },
    frame(f) { ctrl.frame(f); },
  };
  runTrace(scenario, { policy: probe, K, maxSteps: 200 });

  for (const method of ['frame', 'reset', 'setMode', 'snapshot']) {
    assert.equal(typeof ctrl[method], 'function',
      `the controller must expose ${method}() — see the surface pinned at the top of this file`);
  }
});

// ---------------------------------------------------------------------------
// AQ-1 … AQ-15 — one per scenario, invariants owned by the scenario.
// ---------------------------------------------------------------------------
for (const name of REQUIRED_SCENARIOS.filter((n) => n !== 'instrumentation-pair')) {
  test(`AQ trace: ${name}`, { skip: IMPL }, async () => {
    const { createAdaptiveQuality } = await load();
    const scenario = buildScenario(name, K);
    const result = runTrace(scenario, { policy: adapt(createAdaptiveQuality), K });
    const report = INV.summarise(name, SCENARIO_MODULES[name].invariants(result, K));
    assert.ok(report.pass, `${report.message}\n\n  scenario: ${scenario.depicts}`);
  });
}

// ---------------------------------------------------------------------------
// AQ-16 — the instrumentation pair, which is one scenario run twice.
// ---------------------------------------------------------------------------
test('AQ trace: instrumentation-pair (panel closed vs panel open)', { skip: IMPL }, async () => {
  const { createAdaptiveQuality } = await load();
  const scenario = buildScenario('instrumentation-pair', K);
  const pair = runPair(scenario, { makePolicy: () => adapt(createAdaptiveQuality), K });

  for (const [arm, result] of Object.entries(pair)) {
    const report = INV.summarise(`instrumentation-pair (panel ${arm})`, SCENARIO_MODULES['instrumentation-pair'].invariants(result, K));
    assert.ok(report.pass, report.message);
  }
  const cost = INV.instrumentationPair(pair);
  assert.ok(cost.pass, cost.message);
  const decision = INV.instrumentationDoesNotChangeTheDecision(pair);
  assert.ok(decision.pass, decision.message);
});

// ---------------------------------------------------------------------------
// AQ-17 — TEL-13, TEL-14, TEL-15.
//
// CONTRACT §3.2 says all three render the sentinel in Waves 0-2 and are W3's to
// supply, and that fabricating them is forbidden: "Fabricating it from `tier` +
// `pinned` is forbidden" (TEL-13) and "Reporting `pinned === true` as 'Manual'
// is an inference and is forbidden" (TEL-15). Only the controller knows why it
// last moved and how long it must wait, so only the controller can serve them.
// ---------------------------------------------------------------------------
test('AQ-17 snapshot() serves last-adjustment/reason, cooldown and mode without inventing them', { skip: IMPL }, async () => {
  const { createAdaptiveQuality } = await load();
  const scenario = buildScenario('overload', K);
  const policy = adapt(createAdaptiveQuality);
  const result = runTrace(scenario, { policy, K });
  const snap = policy.snapshot();

  assert.ok(snap && typeof snap === 'object', 'snapshot() must return an object');
  assert.ok('mode' in snap, 'TEL-15: the active mode is a state, not an inference from a pinned flag');
  assert.ok(['auto', 'manual', 'benchmark'].includes(snap.mode));

  // TEL-13. Before any adjustment it is the sentinel; after one it carries a
  // reason. Either way it is never a number-shaped guess.
  assert.ok('lastAdjustment' in snap, 'TEL-13: last adjustment / reason');
  if (result.applies.some((a) => !a.rejected)) {
    assert.ok(snap.lastAdjustment && typeof snap.lastAdjustment.reason === 'string' && snap.lastAdjustment.reason.length > 0,
      'after an adjustment, TEL-13 must carry the REASON, not just a timestamp — the shipped adaptiveTier records `lastTierChange` and no reason at all');
  } else {
    assert.deepEqual(snap.lastAdjustment, { value: null, state: 'unavailable', reason: 'insufficient-samples' },
      'with no adjustment yet, TEL-13 renders the §3.1 sentinel');
  }

  // TEL-14 is the REMAINING cooldown, not the constant. CONTRACT §3.2:
  // "MIN_INTERVAL_MS = 1500 is a constant inside the IIFE; no *remaining*
  // cooldown is computed, and the constant is not the field."
  assert.ok('cooldownMs' in snap, 'TEL-14: cooldown');
  if (typeof snap.cooldownMs === 'number') {
    assert.ok(snap.cooldownMs >= 0);
    assert.notEqual(snap.cooldownMs, K.settleHoldMs,
      'TEL-14 must be the time REMAINING, not the configured hold restated');
  } else {
    assert.equal(snap.cooldownMs.state, 'unavailable');
  }
});

// ---------------------------------------------------------------------------
// AQ-18 — the compatibility profile. CONTRACT §11.
//
// "The new controller ships with a profile that reproduces today's 55/58
//  three-tier behaviour EXACTLY. The new policy is reachable only from the
//  panel and a URL flag, and the switchover is gated on a recorded device
//  session."
//
// This is the answer to "what if the phone never happens", and it is only worth
// anything if it is checked. `createCompatPolicy` in the fixture package is the
// shipped IIFE transcribed; on the same trace, the two must move identically.
// ---------------------------------------------------------------------------
test('AQ-18 profile:"compat" reproduces the shipped 55/58 tier behaviour exactly', { skip: IMPL }, async () => {
  const { createAdaptiveQuality } = await load();
  const scenario = buildScenario('oscillation-bait', K);

  const reference = runTrace(scenario, { policy: createCompatPolicy({ K }), K });
  const candidate = runTrace(scenario, { policy: adapt(createAdaptiveQuality, { profile: 'compat' }), K });

  const shape = (r) => r.tierChangeLog.map((c) => `${c.from}->${c.to}@${Math.round(c.tMs)}`);
  assert.deepEqual(shape(candidate), shape(reference),
    'the compatibility profile must reproduce the shipped policy tier-for-tier and millisecond-for-millisecond. ' +
    'It is the no-device ship path: "a no-device outcome then ships a workbench and a measurement rig ... and ' +
    'nothing riskier than today."');
  assert.deepEqual(candidate.violations, []);
});
