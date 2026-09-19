/**
 * tests/perf-trace-corpus.test.js — the corpus checks ITSELF.
 *
 * Wave 3 / task P3.1 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS GREEN NOW AND NOT RED-FIRST
 * ---------------------------------------------------------------------------
 * `tests/adaptive-quality-traces.test.js` is the red-first suite: it drives the
 * not-yet-written `src/game/adaptive-quality.js` and is skipped unless
 * BIRB_PERF_IMPL is set (R4). THIS file tests the fixture machinery, which
 * exists, so it runs unconditionally — and it has to, because the whole point
 * of P3.1 is to buy an oracle in this wave and spend it in the next. R8:
 *
 *   "A check must be shown to fail before it is trusted. Red-because-nothing-
 *    is-implemented is not proof of discrimination."
 *
 * A corpus nobody has watched discriminate is a hope. The centrepiece here is
 * TC-11, the discrimination matrix: every scenario names reference policies
 * that MUST fail named invariants and reference policies that MUST pass them,
 * and both directions are asserted. A check nothing can fail is not an oracle;
 * a check nothing can pass is a broken one.
 *
 * Run:
 *   node --test tests/perf-trace-corpus.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_SCENARIOS, SCENARIO_NAMES, SCENARIO_MODULES,
  buildCorpus, buildScenario, discriminatorsFor,
} from './fixtures/perf-traces/index.js';
import { runTrace, runPair, APPLY_KINDS } from './fixtures/perf-traces/driver.js';
import { validateScenario, capacityAt, feasibleRung, EVENT_KINDS, GPU_STATES } from './fixtures/perf-traces/schema.js';
import {
  makePolicy, createFixedPolicy, createStaticPolicy,
  createClairvoyantPolicy, CLAIRVOYANT_STRATEGIES,
} from './fixtures/perf-traces/reference-policies.js';
import * as INV from './fixtures/perf-traces/invariants.js';
import { generateHoldout, holdoutFingerprint, HOLDOUT_ENV_VAR } from './fixtures/perf-traces/holdout.js';
import { PROVISIONAL, PROVENANCE, provenanceProblems, withConstants, budgetMs } from '../src/game/perf-constants.js';
import { evaluateAcceptanceGates, evaluateOscillation } from '../src/game/frame-stats.js';
import { INVALID_REASONS, RESET_TAGS } from '../src/game/frame-metrics.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests/fixtures/perf-traces');
const K = PROVISIONAL;

/**
 * Seeds for the holdout property tests are derived at RUN TIME, never written
 * down. A literal seed in a committed test file is a committed holdout seed:
 * an agent tuning a controller could run it and tune against those traces,
 * which is precisely what the holdout exists to prevent. Determinism and
 * difference are properties, and a property test does not need a fixed value.
 */
let seedCounter = 0;
const freshSeed = () => `runtime-${process.hrtime.bigint()}-${seedCounter += 1}`;

// ---------------------------------------------------------------------------
// TC-1 — the commissioned list is complete and every scenario validates.
//
// Would catch: a scenario quietly dropped or renamed, which shrinks the corpus
// while every remaining test still passes.
// ---------------------------------------------------------------------------
test('TC-1 every commissioned scenario exists, is unique, and validates', () => {
  assert.deepEqual(
    SCENARIO_NAMES.slice().sort(), REQUIRED_SCENARIOS.slice().sort(),
    'the registry and the commissioning list have diverged',
  );
  assert.equal(new Set(SCENARIO_NAMES).size, SCENARIO_NAMES.length, 'duplicate scenario name');
  assert.equal(REQUIRED_SCENARIOS.length, 16, 'the P3.1 brief commissions sixteen scenarios');

  for (const name of REQUIRED_SCENARIOS) {
    const scenario = buildScenario(name, K);       // throws on any validation problem
    const mod = SCENARIO_MODULES[name];
    assert.equal(typeof mod.build, 'function', `${name} must export build(K)`);
    assert.equal(typeof mod.invariants, 'function', `${name} must export invariants(result, K)`);
    const disc = discriminatorsFor(name, K);
    assert.ok(Array.isArray(disc) && disc.length > 0,
      `${name} must export discriminators (an array, or a function of K returning one) — ` +
      'a scenario nobody has watched fail is not an oracle (R8)');
    assert.ok(scenario.whyCapacityModel.length >= 40,
      `${name} must say what a fixed interval replay could not show`);
  }
});

// ---------------------------------------------------------------------------
// TC-2 — the validator can fail. Flip-tested, not assumed.
//
// Would catch: a validator that returns [] for everything, which is what a
// validator becomes the moment someone "simplifies" it.
// ---------------------------------------------------------------------------
test('TC-2 the schema validator rejects the malformations it exists to reject', () => {
  const good = buildScenario('overload', K);
  assert.deepEqual(validateScenario(good, { K }), [], 'the good scenario must validate clean');

  const clone = () => JSON.parse(JSON.stringify(good));

  // A missing rung in a costMs row: the trace can no longer answer "what if
  // the controller had gone there", which is the only question it exists for.
  const hole = clone();
  delete hole.samples[1].costMs.rung2;
  assert.ok(validateScenario(hole, { K }).some((p) => p.includes('rung2')),
    'a costMs row missing a rung must be rejected');

  // An unknown reset tag. CONTRACT §2.1: an untagged reset is a violation.
  const badTag = clone();
  badTag.events = [{ atMs: 100, kind: 'reset', tag: 'pause' }];
  assert.ok(validateScenario(badTag, { K }).some((p) => p.includes('RESET_TAGS')),
    'a reset tag outside frame-metrics RESET_TAGS must be rejected');

  // `no-context` as a depicted steady state. CONTRACT §3.1 makes it a STOP.
  const noContext = clone();
  noContext.events = [{ atMs: 100, kind: 'gpu', state: 'no-context' }];
  const ncProblems = validateScenario(noContext, { K });
  assert.ok(ncProblems.some((p) => p.includes('STOP condition')),
    'no-context must be rejected as a depicted GPU state, with the reason stated');

  // A gameplay-fidelity key on a rung.
  const gameplay = clone();
  gameplay.ladder = [
    { id: 'a', settings: { dpr: 1.7 } },
    { id: 'b', settings: { collisionRate: 0.5 } },
  ];
  assert.ok(validateScenario(gameplay, { K }).some((p) => p.includes('forbidden gameplay key')),
    'a rung that reduces collision/input/flight fidelity must be rejected');

  // Out-of-range start without the explicit flag.
  const oor = clone();
  oor.startRung = 9;
  assert.ok(validateScenario(oor, { K }).some((p) => p.includes('allowOutOfRangeStart')),
    'an out-of-range startRung must require the explicit corrupt-store flag');

  // Samples out of order.
  const unsorted = clone();
  unsorted.samples = [unsorted.samples[1], unsorted.samples[0]];
  assert.ok(validateScenario(unsorted, { K }).length > 0, 'unordered samples must be rejected');
});

// ---------------------------------------------------------------------------
// TC-3 — the corpus is PARAMETERISED on the provisional constants, not baked.
//
// CONTRACT §10 rule 1: "No fixture, corpus, test, contract or default may treat
// a provisional value as fixed. Traces are authored as capacity models
// parameterised on the threshold, not as arrays baked against one."
//
// Would catch: durations and deadlines hand-typed in milliseconds, which is
// exactly the 40-60% rework ULTRACODE §1 costs out if Wave 4 moves a number.
// ---------------------------------------------------------------------------
test('TC-3 retuning PROVISIONAL retunes the corpus', () => {
  const retuned = withConstants({
    evaluationWindowMs: K.evaluationWindowMs * 2,
    probeIntervalMs: K.probeIntervalMs * 2,
    restoreStabilityMaxMs: K.restoreStabilityMaxMs * 2,
  });
  let changed = 0;
  for (const name of REQUIRED_SCENARIOS) {
    const a = buildScenario(name, K);
    const b = buildScenario(name, retuned);
    if (a.durationMs !== b.durationMs || JSON.stringify(a.samples) !== JSON.stringify(b.samples)
        || JSON.stringify(a.marks) !== JSON.stringify(b.marks)) changed += 1;
  }
  assert.equal(changed, REQUIRED_SCENARIOS.length,
    `${REQUIRED_SCENARIOS.length - changed} scenario(s) did not move when the thresholds moved — ` +
    'those have millisecond figures baked into them.');

  assert.throws(() => withConstants({ noSuchThreshold: 1 }), RangeError,
    'an override naming a field that does not exist must throw, not silently do nothing');
});

// ---------------------------------------------------------------------------
// TC-4 — THE HEADLINE. The trace responds to the decision.
//
// Would catch: the corpus being turned back into a recorded interval array by
// a later "simplification". Under a replay the two runs below are identical by
// construction, and every test of a decision in this repository becomes vacuous.
// ---------------------------------------------------------------------------
test('TC-4 the delivered intervals depend on what the controller decided', () => {
  const scenario = buildScenario('overload', K);
  const top = runTrace(scenario, { policy: createFixedPolicy(0), K });
  const bottom = runTrace(scenario, { policy: createFixedPolicy(2), K });

  const seqTop = top.steps.map((s) => s.dtMs);
  const seqBottom = bottom.steps.map((s) => s.dtMs);
  assert.notDeepEqual(seqTop, seqBottom,
    'two different decisions produced the same interval sequence — this is a replay, not a capacity model');

  // And the difference is in the direction the capacity model says it must be.
  assert.ok(top.metrics.timeOutsideBudgetMs > bottom.metrics.timeOutsideBudgetMs,
    'holding the top rung through an overload must cost more time outside budget than dropping to the bottom');

  // The costs really do come from the rung, per frame.
  const late = top.steps.find((s) => s.tMs > scenario.marks.onsetMs + 500);
  const lateBottom = bottom.steps.find((s) => s.tMs > scenario.marks.onsetMs + 500);
  assert.ok(late.costMs > lateBottom.costMs, 'rung 0 must cost more than rung 2 after the onset');
});

// ---------------------------------------------------------------------------
// TC-5 — vsync quantisation, which is the misleading plateau's whole mechanism.
//
// Would catch: a driver that hands back raw cost as the interval, in which case
// `misleading-plateau` stops depicting a plateau and starts depicting a device
// with an obvious 12-vs-19.5 ms difference that any controller can read.
// ---------------------------------------------------------------------------
test('TC-5 a 60 Hz panel delivers whole refreshes, so cheap and nearly-late frames look identical', () => {
  const scenario = buildScenario('misleading-plateau', K);
  const B = budgetMs(60);
  const held = runTrace(scenario, { policy: createFixedPolicy(1), K });   // 12.0 ms
  const probed = runTrace(scenario, { policy: createFixedPolicy(0), K }); // 19.5 ms
  const cheap = runTrace(scenario, { policy: createFixedPolicy(2), K });  // 8.5 ms

  const uniq = (r) => [...new Set(r.steps.map((s) => Math.round(s.dtMs * 100) / 100))];
  assert.deepEqual(uniq(held), uniq(cheap),
    'a 12 ms frame and an 8.5 ms frame must be delivered identically on a 60 Hz panel — that IS the plateau');
  assert.ok(held.steps.every((s) => Math.abs(s.dtMs - B) < 1e-9),
    `the plateau must deliver exactly one refresh per frame; saw ${uniq(held).join(', ')}`);
  // Frame 0 renders at the scenario's start rung: fixed(0) cannot apply
  // anything until it has been handed a frame, which is the point of TC-6.
  assert.ok(probed.steps.slice(1).every((s) => Math.abs(s.dtMs - 2 * B) < 1e-9),
    `the rung above the plateau must deliver two refreshes per frame, i.e. 30 fps; saw ${uniq(probed).join(', ')}`);
});

// ---------------------------------------------------------------------------
// TC-6 — rendering work moves only through apply().
//
// PERFORMANCE_REALISM_PLAN.md runtime-loop step 2: "A slider value changing is
// not evidence that rendering work changed."
// ---------------------------------------------------------------------------
test('TC-6 a controller that decides internally and never routes the decision moves nothing', () => {
  const scenario = buildScenario('overload', K);
  let internalRung = 0;
  const daydreamer = {
    label: 'daydreamer',
    frame(f) { if (f.dtMs > f.budgetMs) internalRung = 2; },  // decides, never applies
  };
  const result = runTrace(scenario, { policy: daydreamer, K });
  assert.equal(internalRung, 2, 'the fixture policy must actually have decided, or the test proves nothing');
  assert.equal(result.applies.length, 0);
  assert.ok(result.steps.every((s) => s.rung === 0), 'the world must not move without an apply()');
  assert.ok(!INV.boundedResponse(result, { onsetMs: scenario.marks.onsetMs, K }).pass,
    'and an unrouted decision must fail the bounded-response invariant');
});

// ---------------------------------------------------------------------------
// TC-7 — the driver's violation ledger, every code, watched firing.
// ---------------------------------------------------------------------------
test('TC-7 every violation code can be produced', () => {
  const scenario = buildScenario('corrupt-store-clamped', K);
  const codes = new Set();
  const naughty = {
    label: 'naughty',
    start(ctx) { this.apply = ctx.apply; },
    frame(f) {
      if (f.frameIndex === 0) {
        this.apply({ kind: 'nonsense', rung: 0, reason: 'unknown kind' });
        this.apply({ kind: 'downshift', rung: 97, reason: 'straight from a corrupt store' });
        this.apply({ kind: 'downshift', rung: 'two', reason: 'not an index' });
        this.apply({ kind: 'downshift', rung: 1, settings: { collisionRate: 0.5 }, reason: 'hiding a render cost in the simulation' });
        this.apply({ kind: 'probe', rung: 0, reason: 'first probe' });
        this.apply({ kind: 'probe', rung: 0, reason: 'second probe, overlapping and far too soon' });
        this.apply({ kind: 'probe-keep', rung: 0 });
        this.apply({ kind: 'probe-keep', rung: 0 });   // no outstanding probe
      }
    },
  };
  const result = runTrace(scenario, { policy: naughty, K });
  for (const v of result.violations) codes.add(v.code);
  for (const expected of ['unknown-apply-kind', 'out-of-range-rung', 'non-integer-rung',
    'gameplay-fidelity-write', 'probe-overlap', 'probe-too-soon', 'probe-resolution-without-probe']) {
    assert.ok(codes.has(expected), `violation "${expected}" was never produced; codes seen: ${[...codes].join(', ')}`);
  }
  assert.ok(!INV.noViolations(result).pass, 'INV-1 must fail when violations exist');
  assert.ok(!INV.startProfileClamped(result).pass, 'INV-11 must fail when an out-of-range rung reaches apply()');

  // ...and the same ledger is empty for a well-behaved controller.
  const clean = runTrace(scenario, { policy: createFixedPolicy(0), K });
  assert.deepEqual(clean.violations, [], 'a well-behaved controller must record no violations');
  assert.ok(INV.startProfileClamped(clean).pass);
});

// ---------------------------------------------------------------------------
// TC-8 — the panel lock. CONTRACT §7.1 / assertion A10.
// ---------------------------------------------------------------------------
test('TC-8 an adaptive write while Manual holds the lock is rejected AND recorded', () => {
  const scenario = buildScenario('manual-to-auto', K);
  const result = runTrace(scenario, { policy: makePolicy('twitchy'), K });
  const locked = result.applies.filter((a) => a.rejected && a.rejectReason === 'mode-locked');
  assert.ok(locked.length > 0, 'the fixture must actually attempt a write while locked, or the test proves nothing');
  assert.ok(result.violations.some((v) => v.code === 'adaptive-write-while-locked'));
  // Rejected means REJECTED: the rung did not move on those frames.
  for (const a of locked) assert.equal(a.effectiveRung, a.effectiveRung, 'rejected applies report the unchanged rung');
  const duringLock = result.steps.filter((s) => s.mode === 'manual');
  assert.equal(new Set(duringLock.map((s) => s.rung)).size, 1,
    'the rung must not change at all while the panel holds the lock');

  // A panel request is always allowed, in every mode (CONTRACT §7.1 precedence).
  const panelist = {
    start(ctx) { this.apply = ctx.apply; },
    frame(f) { if (f.mode === 'manual' && !this.done) { this.done = true; this.r = this.apply({ kind: 'manual', rung: 2, source: 'panel', reason: 'the human chose it' }); } },
  };
  const panelRun = runTrace(scenario, { policy: panelist, K });
  assert.equal(panelist.r.rejected, false, 'a panel request must win in every mode');
  assert.ok(!panelRun.violations.some((v) => v.code === 'adaptive-write-while-locked'));
});

// ---------------------------------------------------------------------------
// TC-9 — `paused` is a validity state, not a reset. CONTRACT §2.2 / RUL-2.
// ---------------------------------------------------------------------------
test('TC-9 paused frames are marked invalid, carry a reason from the enum, and are RETAINED', () => {
  const scenario = buildScenario('resume', K);
  const result = runTrace(scenario, { policy: createStaticPolicy(), K });
  const invalid = result.steps.filter((s) => !s.valid);
  assert.ok(invalid.length > 0, 'the resume scenario must actually pause');
  for (const s of invalid) {
    assert.ok(INVALID_REASONS.includes(s.invalidReason),
      `invalidReason "${s.invalidReason}" is not in frame-metrics INVALID_REASONS`);
  }
  // Retained in the export...
  assert.equal(result.samples.filter((s) => s.valid === false).length, invalid.length,
    'invalid samples must be present in the export, not deleted');
  // ...and excluded from the decision statistics.
  const gates = evaluateAcceptanceGates(result.samples, { targetFPS: result.targetFPS });
  assert.equal(gates.counts.invalid, invalid.length);
  assert.ok(gates.counts.valid > 0);
  assert.ok(gates.p95 <= K.acceptanceP95MaxMs,
    `p95 ${gates.p95} must be computed over valid samples only; a 900 ms hidden-tab frame must not reach it`);
  // The reset tags are in the closed enum.
  for (const r of result.resets) assert.ok(RESET_TAGS.includes(r.tag), `reset tag "${r.tag}" not in the enum`);
});

// ---------------------------------------------------------------------------
// TC-10 — a boundary reset does not erase a recurrent gameplay hitch.
// CONTRACT §2.1 rule 1, verbatim from the plan: "Do not erase recurrent
// gameplay hitches."
// ---------------------------------------------------------------------------
test('TC-10 tagged boundaries interleaved with an untagged recurrent hitch leave the hitch visible', () => {
  const scenario = buildScenario('boundary-interleaved-with-recurrent-hitch', K);
  const result = runTrace(scenario, { policy: createStaticPolicy(), K });

  assert.ok(result.resets.length >= 8, 'the storm must actually fire');
  assert.ok(result.hitches.length >= 10, 'the recurrent hitch must actually fire');

  const check = INV.recurrentHitchesRemainUnexplained(result, { atLeast: K.acceptanceSpikeRecurrenceCount, K });
  assert.ok(check.pass, check.message);

  // Tags EXPLAIN spikes; validity EXCLUDES samples; neither DELETES one. The
  // boundary frames carry tags and the hitch frames do not, and both are in
  // the export.
  const tagged = result.samples.filter((s) => s.tag);
  assert.ok(tagged.length >= 8, 'boundary frames must be tagged');
  const untaggedSpikes = result.samples.filter((s) => !s.tag && s.valid && s.dtMs > K.acceptanceSpikeMs);
  assert.ok(untaggedSpikes.length >= K.acceptanceSpikeRecurrenceCount,
    'the recurrent hitch must remain in the export as unexplained spikes');
});

// ---------------------------------------------------------------------------
// TC-11 — THE DISCRIMINATION MATRIX (R8).
//
// Every scenario declares reference policies that MUST fail named invariants
// and policies that MUST pass them. Both directions matter: a check nothing can
// fail is not an oracle, and a check nothing can pass is a broken one.
// ---------------------------------------------------------------------------
test('TC-11 every scenario has been watched failing, and watched passing', () => {
  const corpus = buildCorpus(K);
  const problems = [];
  let cells = 0;

  for (const { name, module, scenario } of corpus) {
    for (const d of discriminatorsFor(name, K)) {
      const result = runTrace(scenario, { policy: makePolicy(d.policy, { K, ...(d.opts ?? {}) }), K });
      const checks = module.invariants(result, K);
      const byId = new Map(checks.map((c) => [c.id, c]));

      for (const id of d.mustFail ?? []) {
        cells += 1;
        const c = byId.get(id);
        if (!c) { problems.push(`${name}/${d.policy}: ${id} is not among the invariants this scenario evaluates`); continue; }
        if (c.pass) problems.push(`${name}/${d.policy}: ${id} was expected to FAIL (${d.why}) but passed — ${c.message}`);
      }
      for (const id of d.mustPass ?? []) {
        cells += 1;
        const c = byId.get(id);
        if (!c) { problems.push(`${name}/${d.policy}: ${id} is not among the invariants this scenario evaluates`); continue; }
        if (!c.pass) problems.push(`${name}/${d.policy}: ${id} was expected to PASS (${d.why}) but failed — ${c.message}`);
      }
    }
    assert.notEqual(result_endedBecause(scenario), 'step-cap',
      `${name} hit the driver's step cap — the trace never reached its own duration`);
  }

  assert.deepEqual(problems, [], `discrimination matrix broken:\n  - ${problems.join('\n  - ')}`);
  assert.ok(cells >= 30, `only ${cells} discrimination cells; the matrix is too thin to be evidence`);

  function result_endedBecause(scenario) {
    return runTrace(scenario, { policy: createStaticPolicy(), K }).endedBecause;
  }
});

// ---------------------------------------------------------------------------
// TC-12 — the corpus feeds the SHARED evaluators, not private copies.
//
// docs/perf/gates/G2a.md §4.1: "the value the controller fires on and the value
// the acceptance gate scores must be computed by the same module, or the loop
// is closed against itself."
// ---------------------------------------------------------------------------
test('TC-12 run results are shaped for frame-stats, and every scenario is long enough to score', () => {
  for (const { name, scenario } of buildCorpus(K)) {
    const result = runTrace(scenario, { policy: makePolicy('compat', { K }), K });

    const gates = evaluateAcceptanceGates(result.samples, { targetFPS: result.targetFPS });
    assert.ok(gates.counts.valid >= K.acceptanceMinSamples,
      `${name}: only ${gates.counts.valid} valid samples; evaluateAcceptanceGates needs ${K.acceptanceMinSamples}`);
    assert.ok(gates.gates['ACC-1'].state !== 'unavailable', `${name}: ACC-1 returned a sentinel`);

    // evaluateOscillation must not be fed a log it cannot score. A scenario
    // whose invariants include INV-5 has to be at least settle + window long,
    // or the check silently degrades to a sentinel and asserts nothing.
    const osc = evaluateOscillation(result.tierChangeLog, {
      settleMs: K.oscillationSettleMs, windowMs: K.oscillationWindowMs, observedMs: result.observedMs,
    });
    const usesInv5 = SCENARIO_MODULES[name].invariants(result, K).some((c) => c.id === 'INV-5');
    if (usesInv5) {
      assert.notEqual(osc.state, 'unavailable',
        `${name} asserts INV-5 but is only ${Math.round(result.observedMs)} ms long; PRO-13 needs ` +
        `${K.oscillationSettleMs + K.oscillationWindowMs} ms`);
    }
  }
});

// ---------------------------------------------------------------------------
// TC-13 — the instrumentation pair, both halves, both watched failing.
// ---------------------------------------------------------------------------
test('TC-13 an open panel costs measurable CPU, and the check can fail', () => {
  const scenario = buildScenario('instrumentation-pair', K);
  const pair = runPair(scenario, { makePolicy: () => makePolicy('compat', { K }), K });

  const cost = INV.instrumentationPair(pair);
  assert.ok(cost.pass, cost.message);
  assert.deepEqual(
    pair.off.steps.map((s) => s.capacity[0]).slice(0, 50),
    pair.on.steps.map((s) => s.capacity[0]).slice(0, 50),
    'both arms must run the IDENTICAL capacity model — that is what makes the pair a comparison',
  );

  const decision = INV.instrumentationDoesNotChangeTheDecision(pair);
  assert.ok(decision.pass, decision.message);

  // FLIP 1: a panel that costs nothing cannot be being measured.
  const free = JSON.parse(JSON.stringify(scenario));
  free.instrumentation = { perFrameMs: 0, perUpdateMs: 0 };
  const freePair = runPair(free, { makePolicy: () => makePolicy('compat', { K }), K, validate: false });
  assert.ok(!INV.instrumentationPair(freePair).pass,
    'INV-12 must fail for a zero-cost panel; a panel whose overhead is unmeasurable is a panel nobody is measuring');
  assert.ok(validateScenario(free, { K }).some((p) => p.includes('perUpdateMs')),
    'and the schema must refuse to accept such a scenario in the first place');

  // FLIP 2: arms that end up in different places invalidate every number the
  // panel ever showed.
  const divergent = { off: runTrace(scenario, { policy: createFixedPolicy(0), K }), on: runTrace(scenario, { policy: createFixedPolicy(2), K, instrumentation: 'on' }) };
  assert.ok(!INV.instrumentationDoesNotChangeTheDecision(divergent).pass,
    'INV-13 must fail when the two arms finish on different rungs');
});

// ---------------------------------------------------------------------------
// TC-14 — the holdout generator: deterministic, seedless-by-default, and
// structurally different from the committed corpus.
// ---------------------------------------------------------------------------
test('TC-14 the holdout is deterministic per seed and has no default seed', () => {
  assert.throws(() => generateHoldout(), RangeError, 'generateHoldout must refuse to run without a seed');
  assert.throws(() => generateHoldout(null), RangeError);
  assert.throws(() => generateHoldout(''), RangeError);

  const a = freshSeed();
  const b = freshSeed();
  assert.deepEqual(
    JSON.parse(JSON.stringify(generateHoldout(a, { count: 3 }))),
    JSON.parse(JSON.stringify(generateHoldout(a, { count: 3 }))),
    'the same seed must produce byte-identical traces, or a gate cannot re-run its own failure',
  );
  assert.notDeepEqual(
    JSON.parse(JSON.stringify(generateHoldout(a, { count: 3 }))),
    JSON.parse(JSON.stringify(generateHoldout(b, { count: 3 }))),
    'different seeds must produce different traces',
  );
  assert.notEqual(holdoutFingerprint(a), holdoutFingerprint(b));
  assert.equal(holdoutFingerprint(a), holdoutFingerprint(a));
});

test('TC-14b holdout traces validate, run, and contain the shapes the corpus deliberately lacks', () => {
  // 40 traces is enough to make the presence of each shape overwhelmingly
  // likely without pinning a seed. Each is validated by generateHoldout itself.
  const traces = generateHoldout(freshSeed(), { count: 40, K });
  let deadRungs = 0;
  let cpuBound = 0;
  let nonVsync = 0;
  let deepLadders = 0;

  for (const s of traces) {
    assert.deepEqual(validateScenario(s, { K }), [], `${s.name} failed validation`);
    const depth = s.ladder.length;
    if (depth > 3) deepLadders += 1;
    if (s.presentation.mode === 'free') nonVsync += 1;
    for (const sample of s.samples) {
      for (let r = 1; r < depth; r += 1) {
        if (sample.costMs[`rung${r}`] === sample.costMs[`rung${r - 1}`]) deadRungs += 1;
      }
      if ((sample.cpuShare ?? 0) > 0.75) cpuBound += 1;
    }
    // Ground truth is derived from the capacity model, never from a run.
    assert.ok(Number.isFinite(s.groundTruth.decisiveMs));
    assert.ok(Number.isFinite(s.groundTruth.gainAvailableMs));
    assert.ok(Number.isInteger(s.groundTruth.regimeChanges));
    // Both directions of travel are rate-limited by the contract, and INV-14
    // charged only one of them until a clairvoyant reference was recorded as
    // DOMINATED for descending at exactly the rate PRO-6 mandates.
    assert.ok(Number.isInteger(s.groundTruth.upwardSteps) && s.groundTruth.upwardSteps >= 0);
    assert.ok(Number.isInteger(s.groundTruth.downwardSteps) && s.groundTruth.downwardSteps >= 0);
    // The gain NET of the toll of reaching it. It is the same segments as
    // gainAvailableMs minus the contract's own rate limits, minus the segments
    // where no rung meets the budget and both metrics are rung-independent —
    // so it can never exceed it, and a sign error in the toll arithmetic shows
    // up here rather than as a silently wider INV-18 guard.
    assert.ok(Number.isFinite(s.groundTruth.collectableGainMs));
    assert.ok(s.groundTruth.collectableGainMs >= 0,
      `${s.name}: collectableGainMs must not be negative`);
    assert.ok(s.groundTruth.collectableGainMs <= s.groundTruth.gainAvailableMs + 1e-9,
      `${s.name}: collectable gain ${s.groundTruth.collectableGainMs} exceeds available gain ${s.groundTruth.gainAvailableMs}`);
    // And it really runs.
    const r = runTrace(s, { policy: makePolicy('compat', { K }), K });
    assert.equal(r.endedBecause, 'duration', `${s.name} hit the step cap`);
    assert.ok(r.frames > 100);
  }
  assert.ok(deadRungs > 0, 'the holdout must contain rungs that cost what the rung above costs');
  assert.ok(cpuBound > 0, 'the holdout must contain CPU-bound regimes where the ladder cannot help');
  assert.ok(nonVsync > 0, 'the holdout must contain non-vsync presentation');
  assert.ok(deepLadders > 0, 'the holdout must contain ladders deeper than the shipped three tiers');
});

// ---------------------------------------------------------------------------
// TC-15 — the holdout DISCRIMINATES. Deterministic, and it has to be.
//
// ---------------------------------------------------------------------------
// WHY THIS TEST NO LONGER ASKS WHETHER THE ORACLES ARE SATISFIABLE
// ---------------------------------------------------------------------------
// It used to ask both questions of ONE randomly drawn seed: "can a bad
// controller fail this?" and "can a good controller pass it?". The second is a
// SEARCH over trace space, and a search answered by one random sample is a
// coin toss — measured, three consecutive `npm test` runs gave exit 0, 1, 1.
// This suite is the default suite, which is four sibling projects' CI, and a
// nondeterministic test in a shared suite is worse than no test: it trains
// everyone who sees it to re-run rather than to read.
//
// Pinning a seed is not the fix. TC-14 asserts the holdout has no committed
// default seed, and a seed written down here is a committed seed whatever file
// it sits in — it converts the holdout into more committed scenarios and
// deletes the only check in the wave that catches a controller tuned to the
// corpus.
//
// So the two questions are separated by what can be stated without a seed:
//
//   DISCRIMINATION is a THEOREM and lives here. A controller that never
//   applies anything is byte-identical to fixed(startRung) — same rung every
//   frame, same costs, same metrics — so wherever INV-18 scores a trace at
//   all, it must fail, because a strict inequality against itself is false.
//   That holds for every seed, so sweeping several of them is a strengthening
//   and never a lottery. The one statistical claim, "at least one of ~48
//   traces is scored", has a per-trace rate around 0.4: it fails with
//   probability under 1e-10, and if the guards are ever widened enough to make
//   it fail, that is the finding.
//
//   SATISFIABILITY is a SEARCH and lives in the gate: TC-15b below, on the
//   gate's own seed, plus `node tools/perf-satisfiability.mjs`, which sweeps
//   ten seeds and 120 traces with the same shared clairvoyant reference.
//   The alternative considered and rejected was to keep it here as a
//   statistical assertion over many seeds. That does not make it
//   deterministic, it makes it rarely wrong — and it lowers the flake rate by
//   exactly the factor it lowers the power to detect a rare unsatisfiable
//   shape, which is the only thing it was there to detect.
//
// The loose satisfiability floor below is the compromise, and it is labelled
// as what it is: a smoke alarm, not the gate.
// ---------------------------------------------------------------------------
test('TC-15 every holdout trace the invariants score is one a never-moving controller fails', () => {
  const SEEDS = 6;                 // swept, not pinned — see the header
  const PER_SEED = 8;
  let scored = 0;
  let idleFailed = 0;
  let skipped = 0;
  let referenceScored = 0;
  let referenceWon = 0;
  const problems = [];

  for (let s = 0; s < SEEDS; s += 1) {
    for (const scenario of generateHoldout(freshSeed(), { count: PER_SEED, K })) {
      const depth = scenario.ladder.length;
      const gt = scenario.groundTruth;
      const fixed = [];
      for (let r = 0; r < depth; r += 1) fixed.push(runTrace(scenario, { policy: createFixedPolicy(r), K }));
      const opts = {
        gainAvailableMs: gt.gainAvailableMs, decisiveMs: gt.decisiveMs, K,
        collectableGainMs: gt.collectableGainMs, allFixed: fixed,
      };

      // The premise of the theorem, asserted rather than assumed: a controller
      // that never applies anything IS the fixed profile at its start rung.
      const idle = runTrace(scenario, { policy: createStaticPolicy(), K });
      const same = fixed[scenario.startRung].metrics;
      assert.equal(idle.metrics.timeOutsideBudgetMs, same.timeOutsideBudgetMs,
        `${scenario.name}: a controller that never moves must score exactly what fixed(startRung) scores`);
      assert.equal(idle.metrics.timeUnnecessarilyDegradedMs, same.timeUnnecessarilyDegradedMs,
        `${scenario.name}: a controller that never moves must score exactly what fixed(startRung) scores`);

      const idleCheck = INV.beatsStandingStill(idle, fixed[scenario.startRung], opts);
      if (idleCheck.skipped) { skipped += 1; continue; }
      scored += 1;
      if (idleCheck.pass) {
        problems.push(`${scenario.name}: INV-18 scored this trace and a controller that NEVER ADAPTS passed it — ${idleCheck.message}`);
      } else {
        idleFailed += 1;
      }

      // The smoke alarm. Not the satisfiability gate — that is TC-15b and
      // tools/perf-satisfiability.mjs — but a floor low enough never to flake
      // and high enough to notice if a change makes the oracles broadly
      // unsatisfiable. Only the scored traces are worth asking about: a
      // skipped trace makes no demand of anybody.
      referenceScored += 1;
      const ref = runTrace(scenario, { policy: createClairvoyantPolicy(scenario, { K }), K });
      if (INV.beatsStandingStill(ref, fixed[scenario.startRung], opts).pass) referenceWon += 1;
    }
  }

  assert.deepEqual(problems, [],
    'the holdout scored a trace that a controller which never adapts passed. ' +
    'A guard wide enough to hide an unsatisfiable trace is wide enough to hide a bad controller.');
  assert.ok(scored > 0,
    `no holdout trace out of ${SEEDS * PER_SEED} was scoreable at all (${skipped} skipped) — the guards are too wide`);
  assert.equal(idleFailed, scored,
    `${scored} traces were scored and only ${idleFailed} failed a controller that never adapts`);
  assert.ok(referenceWon >= Math.ceil(referenceScored * 0.9),
    `a conforming clairvoyant reference beat standing still on only ${referenceWon} of the ${referenceScored} ` +
    'traces the invariants scored. The oracles have become broadly unsatisfiable; run ' +
    '`node tools/perf-satisfiability.mjs` for the per-trace diagnosis.');
});

// ---------------------------------------------------------------------------
// TC-15b — SATISFIABILITY, on the gate's seed. Skipped in the default suite
// because the seed is not in the worktree and must never be (TC-14, TC-18).
//
//   BIRB_PERF_HOLDOUT_SEED=<the gate's seed> node --test tests/perf-trace-corpus.test.js
//
// This is the half that cannot be stated without a seed, so it is stated with
// one the gate supplies. `node tools/perf-satisfiability.mjs` is the wider
// form of the same question — ten seeds rather than one — and the gate runs
// both. The principle they enforce is G3o's, and it is permanent:
// BEFORE SHIPPING AN ORACLE, PROVE A CONFORMING IMPLEMENTATION CAN SATISFY IT.
//
// The reference is CLAIRVOYANT: it reads feasibleRung straight out of the
// capacity model, so nothing can beat it and a failure here is the oracle's,
// never the controller's. Satisfiability is "SOME conforming controller can do
// it", so both strategies are tried and a trace fails only if all of them do —
// see createClairvoyantPolicy's header for why the greedy one is not an upper
// bound on its own.
// ---------------------------------------------------------------------------
test('TC-15b a conforming clairvoyant controller satisfies every invariant on the gate\'s holdout seed', {
  skip: process.env[HOLDOUT_ENV_VAR] ? false : `set ${HOLDOUT_ENV_VAR} to run the satisfiability half (gate only)`,
}, () => {
  const seed = process.env[HOLDOUT_ENV_VAR];
  console.error(`[TC-15b] holdout seed fingerprint ${holdoutFingerprint(seed)}`);
  const traces = generateHoldout(seed, { count: 12, K });
  const failures = [];

  for (const scenario of traces) {
    const depth = scenario.ladder.length;
    const gt = scenario.groundTruth;
    const fixed = [];
    for (let r = 0; r < depth; r += 1) fixed.push(runTrace(scenario, { policy: createFixedPolicy(r), K }));

    const perStrategy = CLAIRVOYANT_STRATEGIES.map((chase) => {
      const ref = runTrace(scenario, { policy: createClairvoyantPolicy(scenario, { K, chase }), K });
      const bad = [
        INV.noViolations(ref),
        INV.boundedProbes(ref, { K }),
        INV.noPersistentOscillation(ref, { K }),
        INV.notDominatedByFixedProfile(ref, fixed, {
          K, decisiveMs: gt.decisiveMs, regimeChanges: gt.regimeChanges,
          upwardSteps: gt.upwardSteps, downwardSteps: gt.downwardSteps,
        }),
        INV.beatsStandingStill(ref, fixed[scenario.startRung], {
          gainAvailableMs: gt.gainAvailableMs, decisiveMs: gt.decisiveMs, K,
          collectableGainMs: gt.collectableGainMs, allFixed: fixed,
        }),
      ].filter((c) => !c.pass);
      return bad.map((c) => `${scenario.name} [${chase}] ${c.id}: ${c.message}`);
    });
    if (perStrategy.every((f) => f.length > 0)) failures.push(...perStrategy.flat());
  }

  assert.deepEqual(failures, [],
    `no conforming controller can satisfy these oracles on ${failures.length ? 'some' : 'any'} of the ` +
    `${traces.length} traces from seed fingerprint ${holdoutFingerprint(seed)}. An oracle that is red for a ` +
    'correct implementation is worse than no oracle: the implementer\'s only route to green is to break ' +
    `something else.\n  - ${failures.join('\n  - ')}`);
});


// ---------------------------------------------------------------------------
// TC-16 — provenance. Every provisional number says where it came from.
// ---------------------------------------------------------------------------
test('TC-16 every PROVISIONAL field has a provenance row and none claims to be measured', () => {
  assert.deepEqual(provenanceProblems(), []);
  for (const [key, row] of Object.entries(PROVENANCE)) {
    assert.notEqual(row.provenance, 'measured',
      `PROVISIONAL.${key} claims provenance "measured"; Wave 4 is what unlocks that word`);
  }
  // PRO-10..PRO-13 must be IMPORTED from frame-stats, not restated.
  const text = fs.readFileSync(path.join(REPO_ROOT, 'src/game/perf-constants.js'), 'utf8');
  assert.ok(text.includes("from './frame-stats.js'"),
    'the acceptance and oscillation thresholds must come from frame-stats.js, not be declared twice');
  assert.ok(!/acceptanceP95MaxMs:\s*[\d.]/.test(text),
    'PRO-10 must not be restated as a literal here — G2a §4.12');
});

// ---------------------------------------------------------------------------
// TC-17 — the fixture package stays runnable under plain `node --test`.
// ---------------------------------------------------------------------------
test('TC-17 no fixture module imports THREE or touches the DOM', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) files.push(full);
    }
  };
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  walk(FIXTURE_DIR);
  assert.ok(files.length >= 20, `expected the fixture package to have its modules; found ${files.length}`);

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);
    for (const m of text.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)) {
      const spec = m[1];
      assert.ok(spec.startsWith('.'), `${rel} imports the bare specifier "${spec}"; the fixture package must import nothing outside this repository`);
      assert.ok(!/three/i.test(spec), `${rel} imports "${spec}"`);
    }
    // Comments are stripped first, and the patterns are word-boundary matched
    // and never after a dot. Both matter: `verdict.window.startMs` is a field
    // on a plain object, and the sentence "one evaluation window." is prose.
    // A substring check cannot tell either from the DOM global.
    const banned = [
      [/(?<![.\w])document\s*\./, 'document.'],
      [/(?<![.\w])window\s*\./, 'window.'],
      [/(?<![.\w])performance\s*\./, 'performance.'],
      [/(?<![.\w])Date\s*\.now/, 'Date.now'],
      [/(?<![.\w])setTimeout\s*\(/, 'setTimeout('],
      [/(?<![.\w])setInterval\s*\(/, 'setInterval('],
      [/(?<![.\w])requestAnimationFrame\s*\(/, 'requestAnimationFrame('],
    ];
    const code = stripComments(text);
    for (const [re, label] of banned) {
      assert.ok(!re.test(code), `${rel} uses ${label}; the clock IS the trace and there is no DOM`);
    }
  }
});

// ---------------------------------------------------------------------------
// TC-18 — the holdout seed is not in the worktree.
//
// This is the check that keeps the anti-laundering property real. It cannot
// prove a negative about every file, so it asserts the three things that would
// actually put a seed on disk: a default in the generator, a fallback where the
// test reads the environment, and a value set in CI.
// ---------------------------------------------------------------------------
test('TC-18 no holdout seed is materialised in the worktree', () => {
  assert.throws(() => generateHoldout(), RangeError);

  const holdoutTest = path.join(REPO_ROOT, 'tests/adaptive-quality-holdout.test.js');
  const text = fs.readFileSync(holdoutTest, 'utf8');
  assert.ok(text.includes('process.env'), 'the holdout suite must read its seed from the environment');
  assert.ok(!new RegExp(`${HOLDOUT_ENV_VAR}[^\\n]*(\\|\\||\\?\\?)`).test(text),
    `${holdoutTest} supplies a fallback for ${HOLDOUT_ENV_VAR}; a fallback IS a committed seed`);
  assert.ok(!/generateHoldout\(\s*['"`]/.test(text),
    'the holdout suite must not call generateHoldout with a string literal');

  const workflowDir = path.join(REPO_ROOT, '.github/workflows');
  if (fs.existsSync(workflowDir)) {
    for (const f of fs.readdirSync(workflowDir)) {
      const wf = fs.readFileSync(path.join(workflowDir, f), 'utf8');
      assert.ok(!new RegExp(`${HOLDOUT_ENV_VAR}\\s*:\\s*\\S`).test(wf),
        `.github/workflows/${f} sets ${HOLDOUT_ENV_VAR}; the seed belongs in the gate prompt, not in CI`);
    }
  }
});

// ---------------------------------------------------------------------------
// TC-19 — the closed enums the corpus pins are the ones the modules own.
// ---------------------------------------------------------------------------
test('TC-19 the corpus does not invent enums', () => {
  assert.deepEqual(APPLY_KINDS.slice().sort(), [
    'downshift', 'emergency', 'manual', 'probe', 'probe-keep', 'probe-rollback', 'revoke', 'startup', 'upshift',
  ]);
  assert.equal(EVENT_KINDS.length, 8);
  // gpu-timer.js's read() reports exactly these reasons; `no-context` is a STOP
  // condition (CONTRACT §3.1) and must never appear as a depicted state.
  assert.ok(!GPU_STATES.includes('no-context'));
  for (const s of GPU_STATES) assert.ok(['ok', 'no-extension', 'not-webgl2', 'disjoint'].includes(s));
});
