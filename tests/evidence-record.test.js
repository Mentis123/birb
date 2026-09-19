/**
 * tests/evidence-record.test.js — RED-FIRST spec for `src/game/evidence-record.js`,
 * the DEVELOPMENT loop's half of Wave 3 / task P3.2.
 *
 * docs/PERFORMANCE_REALISM_PLAN.md, the development loop, verbatim:
 *
 *   "Every retained change needs a short evidence record: hypothesis,
 *    build/settings/seed, device/browser, warm/cold state, repeated results and
 *    variability, observed visual tradeoff, decision, and next unresolved
 *    issue."
 *
 * and, one paragraph earlier:
 *
 *   "For each change: state a hypothesis and success gate -> record a fixed-build
 *    baseline -> change one factor -> repeat matched A/B or A/B/A runs -> ...
 *    Use different routes and devices for final validation from those used to
 *    tune the change."
 *
 * and, on what may NOT be concluded:
 *
 *   "Mark changing scenes, unavailable evidence or differences within measured
 *    noise as inconclusive." / "Image differences alone cannot establish
 *    improved realism; review matched motion clips or obtain player feedback."
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT A MARKDOWN TEMPLATE
 * ---------------------------------------------------------------------------
 * Two properties make it real, and both are asserted mechanically here.
 *
 * 1. THE EXPORT SCHEMA IS A SUPERSET OF THE FIXTURE SCHEMA. A Wave 4 device
 *    capture has to land in tests/fixtures/perf-traces/scenarios/ UNCHANGED and
 *    replay for ever as a deterministic regression. If the panel's export and
 *    the corpus disagree about the shape of a trace, the device data — the most
 *    expensive artefact in the whole programme, and the only one that is not
 *    synthesised — is thrown away at the moment it is collected. So the export
 *    is measured against the REAL corpus shape (tests/fixtures/perf-traces/
 *    schema.js + every scenario the corpus actually builds), never against a
 *    restated field list.
 *
 *    The superset relation is not decorative. A device visits only the rungs the
 *    controller chose, and the fixture validator REJECTS a costMs hole, because
 *    a hole is a trace that cannot answer "what if the controller had gone
 *    there". So the export must fill the unvisited rungs AND say so: every rung
 *    cost carries provenance, and a modelled cost may never be presented as a
 *    measured one.
 *
 * 2. THE BUILD HASH. CONTRACT §8.2: the phone is served by a service worker
 *    whose `staleWhileRevalidate` hands back the PREVIOUS build's `src/**`
 *    modules on a session's first run, against the new index.html. Without a
 *    build identity in the record, every device number is attributed to a build
 *    that may not have been the one running. CONTRACT §8.3 SW-4/SW-5:
 *    `build: { requested, serving, stale }`, `stale === true` is recorded in
 *    every evidence export, and such a number is DISCARDED, not adjusted.
 *
 * And the third thing that makes it more than a form: CONCLUSIVE and
 * INCONCLUSIVE are different states, and "inconclusive" is a LATCH. The failure
 * mode this rejects is not a lie, it is a drift — a run marked inconclusive at
 * noon because the scene changed, then quietly reading as a result at four
 * o'clock because two more fields got filled in.
 *
 * ---------------------------------------------------------------------------
 * R4 — red-first form
 * ---------------------------------------------------------------------------
 *   node --test tests/evidence-record.test.js                   # skipped
 *   BIRB_PERF_IMPL=1 node --test tests/evidence-record.test.js  # red until P3.2 builds it
 *
 * Every `import()` of the module under test is INSIDE a test body. A top-level
 * static import of a not-yet-existing module resolves before any skip and turns
 * tests.yml red for humanoid/, gauntlet/, sculpture/ and icon3d/.
 *
 * ---------------------------------------------------------------------------
 * THE SURFACE THIS SUITE PINS
 * ---------------------------------------------------------------------------
 *   EVIDENCE_FIELDS        frozen, the nine fields the plan names, in order
 *   NON_SENTINEL_FIELDS    the subset that may NEVER be a sentinel
 *   CONCLUSIONS            ['conclusive', 'inconclusive']
 *   INCONCLUSIVE_REASONS   closed enum, why a comparison decided nothing
 *   DECISIONS              ['keep', 'roll-back', 'emergency-hold', 'defer']
 *   WARM_STATES            ['cold', 'warm']          — no third "unknown" value
 *   CLAIM_SCOPES           ['functional', 'device-performance']   (R6)
 *   VISUAL_EVIDENCE_KINDS  ['image-diff', 'motion-clip', 'player-feedback']
 *   COST_PROVENANCE        ['measured', 'modelled', 'interpolated']
 *   EXPORT_TRACE_FIELDS    frozen, what an exported capture carries
 *   sentinel(reason)                       -> CONTRACT §3.1 shape
 *   createEvidenceRecord({ now, constants, targetFPS }) -> builder, below
 *   validateEvidenceRecord(rec, { K })     -> string[]  (COLLECTED, never thrown)
 *   isComplete(rec)                        -> { complete, missing }
 *   toFixtureScenario(rec)                 -> a scenario the corpus accepts
 *   exportEvidence(rec)                    -> { ok, problems, evidence, scenario }
 *
 * The builder:
 *   setHypothesis({ statement, successGate })
 *   setBuild({ requested, serving })       — `stale` is DERIVED, never accepted
 *   setEnvironment({ device, browser, renderer, softwareRenderer, warmState, claimScope })
 *   setSettings({ settings, seed })
 *   addRun({ arm, seed, samples, tierChangeLog, note })
 *   setVisualTradeoff({ observed, evidence })
 *   setNextIssue(text)
 *   markInconclusive(reason)
 *   conclude({ conclusion, decision, reason })  -> { accepted, reason }
 *   record() / problems() / violations() / complete() / reopen()
 *
 * `record()` returns a plain JSON-safe object; every module-level function takes
 * that object, so a record read back off disk is validated by the same code that
 * validated it in the browser.
 *
 * NOTHING HERE RECOMPUTES A STATISTIC. Per-run gate verdicts are
 * `evaluateAcceptanceGates` from src/game/frame-stats.js and percentiles are
 * frame-metrics' single nearest-rank helper — the same rule the corpus lives
 * under. A second percentile is a second opinion, and this file exists to stop
 * a number having two.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PROVISIONAL, budgetMs, TARGET_FPS } from '../src/game/perf-constants.js';
import { evaluateAcceptanceGates } from '../src/game/frame-stats.js';
import { buildScenario, SCENARIO_NAMES } from './fixtures/perf-traces/index.js';
import { validateScenario } from './fixtures/perf-traces/schema.js';
import { runTrace } from './fixtures/perf-traces/driver.js';
import { createCompatPolicy, createFixedPolicy } from './fixtures/perf-traces/reference-policies.js';

const MODULE = '../src/game/evidence-record.js';
const K = PROVISIONAL;
const B = budgetMs(TARGET_FPS);

const IMPL = process.env.BIRB_PERF_IMPL
  ? false
  : 'BIRB_PERF_IMPL unset — src/game/evidence-record.js is a Wave 3 deliverable (P3.2)';

async function load() {
  try {
    return await import(MODULE);
  } catch (err) {
    err.message =
      `[red-first] ${MODULE} does not exist yet — Wave 3 P3.2 must create it.\n` +
      `  Its surface is pinned at the top of tests/evidence-record.test.js.\n` +
      `  original (${err.code || 'no code'}): ${err.message}`;
    throw err;
  }
}

/** CONTRACT §3.1, the closed reason enum. Restated nowhere else in this file. */
const SENTINEL_REASONS = ['not-implemented', 'no-extension', 'no-context', 'not-webgl2',
  'disjoint', 'insufficient-samples', 'paused', 'not-applicable', 'stale'];

function assertSentinel(v, what) {
  assert.ok(v && typeof v === 'object', `${what} must be a CONTRACT §3.1 sentinel, got ${JSON.stringify(v)}`);
  assert.equal(v.value, null, `${what}: a sentinel's value is null — 0 is a measurement`);
  assert.equal(v.state, 'unavailable', `${what}: state must be "unavailable"`);
  assert.ok(SENTINEL_REASONS.includes(v.reason),
    `${what}: reason "${v.reason}" is outside the CONTRACT §3.1 enum`);
}

// ---------------------------------------------------------------------------
// Real runs, from the real driver, so a "repeated result" in this suite is the
// same object the acceptance gate consumes in production. A fabricated sample
// array here would let a fabricated one through in the module.
// ---------------------------------------------------------------------------
const SEED = 10001;

function twoArms() {
  const s = buildScenario('overload', K);
  const auto = () => runTrace(s, { policy: createCompatPolicy({ K }) });
  const fixed = () => runTrace(s, { policy: createFixedPolicy(1) });
  const shape = (arm, r) => ({
    arm, seed: SEED, samples: r.samples, tierChangeLog: r.tierChangeLog,
    note: `${arm} over the overload capacity model`,
  });
  return [
    shape('auto', auto()), shape('auto', auto()),
    shape('fixed-rung1', fixed()), shape('fixed-rung1', fixed()),
  ];
}

const GOOD_BUILD = Object.freeze({
  requested: 'v43-2026-09-09-adaptive-quality',
  serving: 'v43-2026-09-09-adaptive-quality',
});

const GOOD_ENV = Object.freeze({
  device: 'iPhone 12',
  browser: 'Safari 26.1 / iOS 26.1',
  renderer: 'Apple GPU',
  softwareRenderer: false,
  warmState: 'warm',
  claimScope: 'device-performance',
});

const GOOD_HYPOTHESIS = Object.freeze({
  statement:
    'Dropping the bloom target to quarter resolution before touching scene DPR keeps p95 inside ' +
    'budget on the forest valley dive at a smaller visual cost than a DPR step.',
  successGate: { metric: 'p95', direction: 'lower', thresholdMs: B * 1.2 },
});

const GOOD_TRADEOFF = Object.freeze({
  observed:
    'Shaft edges soften noticeably at the waterfall; the bird silhouette and contact shading are unchanged.',
  evidence: ['motion-clip'],
});

const NEXT_ISSUE =
  'Whether the same step helps on the city perch, where the lit-window shader dominates rather than fill rate.';

/** A record that is complete and conclusive, built only through the pinned surface. */
async function completeRecord(overrides = {}) {
  const { createEvidenceRecord } = await load();
  const R = createEvidenceRecord({ now: () => 0, constants: K, targetFPS: TARGET_FPS });
  R.setHypothesis(overrides.hypothesis ?? GOOD_HYPOTHESIS);
  R.setBuild(overrides.build ?? GOOD_BUILD);
  R.setEnvironment({ ...GOOD_ENV, ...(overrides.environment ?? {}) });
  R.setSettings({ settings: { rung: 0, dpr: 1.7, bloom: true }, seed: SEED });
  for (const run of overrides.runs ?? twoArms()) R.addRun(run);
  R.setVisualTradeoff(overrides.tradeoff ?? GOOD_TRADEOFF);
  R.setNextIssue(overrides.nextIssue ?? NEXT_ISSUE);
  if (overrides.conclude !== null) {
    R.conclude(overrides.conclude ?? { conclusion: 'conclusive', decision: 'keep' });
  }
  return R;
}

// ===========================================================================
// ER-0 .. ER-3 — the shape of the thing
// ===========================================================================

// ---------------------------------------------------------------------------
// ER-0 — the surface exists and takes its clock injected.
// REJECTS: a module that reads Date.now() or performance.now() directly, which
// cannot be replayed and cannot be tested (CONTRACT §11).
// ---------------------------------------------------------------------------
test('ER-0 evidence-record exposes the pinned surface and injects its clock', { skip: IMPL }, async () => {
  const M = await load();
  for (const fn of ['sentinel', 'createEvidenceRecord', 'validateEvidenceRecord', 'isComplete',
    'toFixtureScenario', 'exportEvidence']) {
    assert.equal(typeof M[fn], 'function', `evidence-record must export ${fn}()`);
  }
  for (const e of ['EVIDENCE_FIELDS', 'NON_SENTINEL_FIELDS', 'CONCLUSIONS', 'INCONCLUSIVE_REASONS',
    'DECISIONS', 'WARM_STATES', 'CLAIM_SCOPES', 'VISUAL_EVIDENCE_KINDS', 'COST_PROVENANCE',
    'EXPORT_TRACE_FIELDS']) {
    assert.ok(Array.isArray(M[e]), `${e} must be an array`);
    assert.ok(Object.isFrozen(M[e]), `${e} must be frozen — a closed set that can be pushed to is not closed`);
  }
  const R = M.createEvidenceRecord({ now: () => 1234, constants: K, targetFPS: TARGET_FPS });
  for (const m of ['setHypothesis', 'setBuild', 'setEnvironment', 'setSettings', 'addRun',
    'setVisualTradeoff', 'setNextIssue', 'markInconclusive', 'conclude', 'record', 'problems',
    'violations', 'complete', 'reopen']) {
    assert.equal(typeof R[m], 'function', `the builder must expose ${m}()`);
  }
  assert.equal(R.record().createdAtMs, 1234, 'the record is stamped from the INJECTED clock, not a wall clock');
});

// ---------------------------------------------------------------------------
// ER-1 — the nine fields the plan names, all nine, by name.
// REJECTS: a form that silently drops "next unresolved issue" or "warm/cold
// state" — the two fields nobody misses until a result cannot be reproduced.
// ---------------------------------------------------------------------------
test('ER-1 EVIDENCE_FIELDS is exactly the nine fields the plan names', { skip: IMPL }, async () => {
  const { EVIDENCE_FIELDS } = await load();
  const expected = [
    'hypothesis',        // "state a hypothesis and success gate"
    'build',             // "build/settings/seed" — and CONTRACT §8.2
    'settings',
    'environment',       // "device/browser"
    'warmState',         // "warm/cold state"
    'runs',              // "repeated results and variability"
    'visualTradeoff',    // "observed visual tradeoff"
    'decision',          // "decision"
    'nextIssue',         // "next unresolved issue"
  ];
  assert.deepEqual([...EVIDENCE_FIELDS].sort(), [...expected].sort(),
    'EVIDENCE_FIELDS must be the plan\'s nine, no more and no fewer');
});

// ---------------------------------------------------------------------------
// ER-2 — an empty record is incomplete and names EVERY hole at once.
// REJECTS: a validator that throws on the first missing field, which turns a
// nine-field form into nine round trips and, in practice, into a filled-in form
// with eight fields nobody looked at.
// ---------------------------------------------------------------------------
test('ER-2 an empty record reports every missing field, collected not thrown', { skip: IMPL }, async () => {
  const { createEvidenceRecord, validateEvidenceRecord, isComplete, EVIDENCE_FIELDS } = await load();
  const rec = createEvidenceRecord({ now: () => 0, constants: K, targetFPS: TARGET_FPS }).record();

  let problems;
  assert.doesNotThrow(() => { problems = validateEvidenceRecord(rec, { K }); },
    'validateEvidenceRecord must collect problems, never throw — a validator that throws hides the other eight');
  assert.ok(Array.isArray(problems));

  const { complete, missing } = isComplete(rec);
  assert.equal(complete, false, 'a record with nothing in it is not complete');
  for (const f of EVIDENCE_FIELDS) {
    assert.ok(missing.includes(f), `missing must name "${f}" — a hole nobody is told about is a hole nobody fills`);
    assert.ok(problems.some((p) => String(p).includes(f)), `problems must mention "${f}"`);
  }
});

// ---------------------------------------------------------------------------
// ER-3 — a plausible default is not a measurement.
// REJECTS: `variability: 0`, `p95Delta: 0`, `device: 'unknown'`, `""`, `-1`,
// `NaN`, a bare `null` in a display slot, or the literal string 'unavailable'.
// CONTRACT §3.1's forbidden-substitute list, applied field by field.
// ---------------------------------------------------------------------------
test('ER-3 forbidden sentinel substitutes are rejected in every field', { skip: IMPL }, async () => {
  const { validateEvidenceRecord } = await load();
  const R = await completeRecord();
  const base = R.record();
  const substitutes = [0, -1, '', null, NaN, 'unavailable', '—', 'unknown', 'n/a'];

  assert.deepEqual(validateEvidenceRecord(base, { K }), [], 'the control record must be clean');

  for (const field of ['hypothesis', 'build', 'settings', 'environment', 'warmState', 'runs',
    'visualTradeoff', 'decision', 'nextIssue']) {
    for (const bad of substitutes) {
      const rec = { ...base, [field]: bad };
      const problems = validateEvidenceRecord(rec, { K });
      assert.ok(problems.length > 0,
        `${field} = ${String(bad)} must be a problem — CONTRACT §3.1 forbids a plausible default standing in for a measurement`);
      assert.ok(problems.some((p) => String(p).includes(field)), `the problem must name ${field}`);
    }
  }
});

// ---------------------------------------------------------------------------
// ER-4 — a genuine sentinel is accepted, in the fields where "unavailable" is a
// real answer, and only there.
// REJECTS: a schema that will not let a device record say "GPU time was not
// available", forcing a 0 in its place — the exact failure §3.1 exists for.
// ---------------------------------------------------------------------------
test('ER-4 a §3.1 sentinel is accepted for an unavailable measurement', { skip: IMPL }, async () => {
  const { sentinel, validateEvidenceRecord, EVIDENCE_FIELDS, NON_SENTINEL_FIELDS } = await load();
  assertSentinel(sentinel('not-applicable'), 'sentinel()');
  assert.throws(() => sentinel('made-up-reason'), /reason/i,
    'a reason outside the §3.1 enum must be refused at the source, not stored');

  for (const f of NON_SENTINEL_FIELDS) {
    assert.ok(EVIDENCE_FIELDS.includes(f), `NON_SENTINEL_FIELDS names ${f}, which is not a field`);
  }
  for (const f of ['hypothesis', 'build', 'decision']) {
    assert.ok(NON_SENTINEL_FIELDS.includes(f),
      `${f} may never be a sentinel — there is no such thing as an unavailable ${f} on a change somebody kept`);
  }

  // A record that could not observe the visual side says so, and is filed as
  // inconclusive for exactly that reason. That is a legal, complete record; a
  // 0 or an empty string in the same slot is not. (ER-17 covers the other half:
  // a CONCLUSIVE record cannot rest on absent or image-diff-only visual evidence.)
  const base = (await completeRecord({
    conclude: { conclusion: 'inconclusive', decision: 'defer', reason: 'unavailable-evidence' },
  })).record();
  const sentinelled = { ...base, visualTradeoff: sentinel('not-applicable') };
  assert.deepEqual(validateEvidenceRecord(sentinelled, { K }), [],
    'a sentinel is a legal value for a field that may be unavailable');
  const illegal = { ...(await completeRecord()).record(), decision: sentinel('not-applicable') };
  assert.ok(validateEvidenceRecord(illegal, { K }).length > 0,
    'a sentinel in a NON_SENTINEL_FIELD must be a problem');
});

// ===========================================================================
// ER-5 .. ER-8 — the build hash (CONTRACT §8.2, SW-4, SW-5)
// ===========================================================================

// ---------------------------------------------------------------------------
// ER-5 — no build identity, no record. This one outranks every other field.
// REJECTS: a record that is complete on eight fields and attributes its numbers
// to nothing. staleWhileRevalidate serves the PREVIOUS build's src/** on a
// session's first run; without the hash the number belongs to no build at all.
// ---------------------------------------------------------------------------
test('ER-5 an otherwise-perfect record without a build hash is incomplete', { skip: IMPL }, async () => {
  const { isComplete, validateEvidenceRecord } = await load();
  const good = (await completeRecord()).record();
  assert.equal(isComplete(good).complete, true, 'the control record must be complete');

  for (const bad of [undefined, {}, { serving: 'v43' }, { requested: '', serving: 'v43' },
    { requested: null, serving: null }]) {
    const rec = { ...good, build: bad };
    const { complete, missing } = isComplete(rec);
    assert.equal(complete, false,
      `build = ${JSON.stringify(bad)} must leave the record INCOMPLETE — CONTRACT §8.2, a number with no build is not evidence`);
    assert.ok(missing.includes('build'));
    assert.ok(validateEvidenceRecord(rec, { K }).some((p) => /build/i.test(String(p))));
  }
});

// ---------------------------------------------------------------------------
// ER-6 — `stale` is DERIVED from the two halves, never accepted as an input.
// REJECTS: a panel that lets the exporter hand in `stale: false` alongside two
// different hashes, which is how a poisoned session gets filed as a clean one.
// ---------------------------------------------------------------------------
test('ER-6 build.stale is derived from requested vs serving, never supplied', { skip: IMPL }, async () => {
  const M = await load();
  const R = await completeRecord({ build: { requested: 'v43-new', serving: 'v42-old', stale: false } });
  const rec = R.record();
  assert.equal(rec.build.stale, true,
    'requested !== serving is staleness, whatever the caller passed in for `stale`');
  assert.ok(M.validateEvidenceRecord({ ...rec, build: { ...rec.build, stale: false } }, { K })
    .some((p) => /stale/i.test(String(p))),
    'a record whose stored `stale` disagrees with its own two hashes must be a problem');
});

// ---------------------------------------------------------------------------
// ER-7 — absence of a service worker is not staleness (SW-4, last sentence).
// REJECTS: `stale = requested !== serving` written naively, which marks every
// localhost and every harness run stale and trains the reader to ignore the flag.
// ---------------------------------------------------------------------------
test('ER-7 no controlling service worker gives a sentinel serving and stale false', { skip: IMPL }, async () => {
  const R = await completeRecord({ build: { requested: 'v43-new', serving: null } });
  const rec = R.record();
  assertSentinel(rec.build.serving, 'build.serving with no service worker');
  assert.equal(rec.build.serving.reason, 'not-applicable',
    'no SW registered is "not-applicable", not "stale" and not "not-implemented"');
  assert.equal(rec.build.stale, false, 'absence of a service worker is not staleness');
  const { isComplete } = await load();
  assert.equal(isComplete(rec).complete, true,
    'a harness run with no SW is still a complete record — it just cannot claim what the SW served');
});

// ---------------------------------------------------------------------------
// ER-8 — a stale build discards the result. It does not adjust it (SW-5).
// REJECTS: a stale run kept as a conclusive "keep" with a footnote.
// ---------------------------------------------------------------------------
test('ER-8 build.stale true forces inconclusive and forbids a keep decision', { skip: IMPL }, async () => {
  const { validateEvidenceRecord } = await load();
  const R = await completeRecord({
    build: { requested: 'v43-new', serving: 'v42-old' },
    conclude: { conclusion: 'conclusive', decision: 'keep' },
  });
  const rec = R.record();
  assert.equal(rec.build.stale, true);
  assert.equal(rec.conclusion, 'inconclusive',
    'a stale-build run cannot be conclusive whatever the caller asked for');
  assert.equal(rec.inconclusiveReason, 'stale-build');
  assert.notEqual(rec.decision, 'keep',
    'SW-5: a stale number is discarded, not adjusted — nothing is retained on it');
  assert.ok(validateEvidenceRecord({ ...rec, conclusion: 'conclusive' }, { K }).length > 0,
    'a hand-edited stale-but-conclusive record read back off disk must still be caught');
});

// ===========================================================================
// ER-9 .. ER-13 — conclusive vs inconclusive
// ===========================================================================

// ---------------------------------------------------------------------------
// ER-9 — the two states are a closed enum and inconclusive carries a reason.
// REJECTS: a free-text `status` field, where "probably fine" is representable.
// ---------------------------------------------------------------------------
test('ER-9 conclusion is a closed enum and inconclusive states why', { skip: IMPL }, async () => {
  const { CONCLUSIONS, INCONCLUSIVE_REASONS, validateEvidenceRecord } = await load();
  assert.deepEqual([...CONCLUSIONS].sort(), ['conclusive', 'inconclusive']);
  for (const r of ['changing-scene', 'unavailable-evidence', 'within-noise', 'stale-build',
    'insufficient-repeats']) {
    assert.ok(INCONCLUSIVE_REASONS.includes(r),
      `INCONCLUSIVE_REASONS must carry "${r}" — the plan names it as a reason to conclude nothing`);
  }
  const base = (await completeRecord()).record();
  assert.ok(validateEvidenceRecord({ ...base, conclusion: 'probably-fine' }, { K }).length > 0);
  assert.ok(validateEvidenceRecord({ ...base, conclusion: 'inconclusive', inconclusiveReason: null }, { K }).length > 0,
    'an inconclusive record with no reason is a shrug, not a record');
  assert.ok(validateEvidenceRecord({ ...base, conclusion: 'inconclusive', inconclusiveReason: 'meh' }, { K }).length > 0,
    'the reason must come from the closed enum');
});

// ---------------------------------------------------------------------------
// ER-10 — INCONCLUSIVE IS A LATCH. This is the assertion the task exists for.
// REJECTS: the drift — a run marked inconclusive because the scene changed, then
// silently reading as a result once two more fields are filled in.
// ---------------------------------------------------------------------------
test('ER-10 inconclusive cannot be upgraded by a later field or a later conclude()', { skip: IMPL }, async () => {
  const R = await completeRecord({ conclude: null });
  R.markInconclusive('changing-scene');
  assert.equal(R.record().conclusion, 'inconclusive');

  // Every later write a plausible implementation might let through.
  R.addRun(twoArms()[0]);
  R.setVisualTradeoff({ observed: 'No visible difference at all in the matched clip.', evidence: ['motion-clip'] });
  R.setNextIssue('Re-run on a fixed route so the scene is not changing under the comparison.');
  assert.equal(R.record().conclusion, 'inconclusive',
    'adding evidence after the fact does not un-invalidate the evidence that was invalid');

  const out = R.conclude({ conclusion: 'conclusive', decision: 'keep' });
  assert.equal(out.accepted, false, 'conclude() must refuse to upgrade a latched inconclusive');
  assert.equal(R.record().conclusion, 'inconclusive');
  assert.notEqual(R.record().decision, 'keep', 'nothing is retained on an inconclusive comparison');
  assert.ok(R.violations().some((v) => /upgrade/i.test(String(v.kind ?? v))),
    'the attempt must be RECORDED, not merely refused — a refusal nobody can see is indistinguishable from success');
});

// ---------------------------------------------------------------------------
// ER-11 — the only way back is a new experiment, and it does not inherit.
// REJECTS: reopen() mutating the failed record into a passing one, which loses
// the fact that the first attempt decided nothing.
// ---------------------------------------------------------------------------
test('ER-11 reopen() starts a fresh record and leaves the latched one untouched', { skip: IMPL }, async () => {
  const R = await completeRecord({ conclude: null });
  R.markInconclusive('within-noise');
  const before = JSON.stringify(R.record());

  const R2 = R.reopen({ note: 'Longer windows, same route, same seed.' });
  assert.notEqual(R2, R, 'reopen() returns a NEW record');
  assert.equal(JSON.stringify(R.record()), before, 'the original record is not mutated by reopening it');
  const rec2 = R2.record();
  assert.notEqual(rec2.id, R.record().id, 'the new record has its own id');
  assert.equal(rec2.supersedes, R.record().id, 'and says what it supersedes');
  assert.notEqual(rec2.conclusion, 'conclusive',
    'a fresh record starts with nothing concluded — it certainly does not inherit a conclusion');
});

// ---------------------------------------------------------------------------
// ER-12 — one run is not a repeated result, and variability is not 0.
// REJECTS: "variability: 0" from a single run, which reads as a perfectly
// repeatable measurement and is the absence of one.
// ---------------------------------------------------------------------------
test('ER-12 variability is a sentinel until an arm has been repeated', { skip: IMPL }, async () => {
  const { createEvidenceRecord } = await load();
  const runs = twoArms();
  const R = createEvidenceRecord({ now: () => 0, constants: K, targetFPS: TARGET_FPS });
  R.setHypothesis(GOOD_HYPOTHESIS);
  R.setBuild(GOOD_BUILD);
  R.setEnvironment(GOOD_ENV);
  R.setSettings({ settings: { rung: 0 }, seed: SEED });
  R.addRun(runs[0]);                       // one arm, one run
  const one = R.record();
  assertSentinel(one.arms.auto.variability, 'variability after a single run');
  assert.equal(one.arms.auto.variability.reason, 'insufficient-samples');
  assert.equal(R.conclude({ conclusion: 'conclusive', decision: 'keep' }).accepted, false,
    'a single unrepeated run cannot support a conclusion');
  assert.equal(R.record().inconclusiveReason, 'insufficient-repeats');

  R.addRun(runs[1]);
  const two = R.record();
  assert.equal(typeof two.arms.auto.variability, 'number',
    'with two runs of the same arm, variability is a real number — and 0 then means 0');
});

// ---------------------------------------------------------------------------
// ER-13 — a comparison needs something to compare against.
// REJECTS: a record of four Auto runs declared a win over a baseline that was
// never run. The plan: "Compare Auto with the current controller and fixed
// reference profiles to verify that adaptation earns its overhead."
// ---------------------------------------------------------------------------
test('ER-13 a single-arm record cannot be conclusive', { skip: IMPL }, async () => {
  const runs = twoArms().filter((r) => r.arm === 'auto');
  const R = await completeRecord({ runs, conclude: { conclusion: 'conclusive', decision: 'keep' } });
  const rec = R.record();
  assert.equal(rec.conclusion, 'inconclusive', 'one arm is not an A/B');
  assert.equal(rec.inconclusiveReason, 'unavailable-evidence');
  assert.notEqual(rec.decision, 'keep');
});

// ---------------------------------------------------------------------------
// ER-14 — matched runs are matched. Different seeds are not an A/B.
// REJECTS: crediting a difference to the change when the two arms did not see
// the same world — the development loop's "change one factor" in mechanical form.
// ---------------------------------------------------------------------------
test('ER-14 arms compared under different seeds are flagged, not credited', { skip: IMPL }, async () => {
  const { validateEvidenceRecord } = await load();
  const runs = twoArms().map((r, i) => (r.arm === 'auto' ? r : { ...r, seed: SEED + 1 + i }));
  const R = await completeRecord({ runs, conclude: { conclusion: 'conclusive', decision: 'keep' } });
  const rec = R.record();
  assert.ok(validateEvidenceRecord(rec, { K }).some((p) => /seed/i.test(String(p))),
    'unmatched seeds across arms must be a named problem');
  assert.equal(rec.conclusion, 'inconclusive');
  assert.equal(rec.inconclusiveReason, 'unmatched-seed');
});

// ---------------------------------------------------------------------------
// ER-15 — per-run verdicts come from the SHARED acceptance gate.
// REJECTS: a second percentile implementation living in the evidence module,
// which is how two parts of one programme come to disagree about one number.
// ---------------------------------------------------------------------------
test('ER-15 per-run gate verdicts equal frame-stats.evaluateAcceptanceGates exactly', { skip: IMPL }, async () => {
  const runs = twoArms();
  const R = await completeRecord({ runs });
  const rec = R.record();
  assert.equal(rec.runs.length, runs.length);
  rec.runs.forEach((stored, i) => {
    const expected = evaluateAcceptanceGates(runs[i].samples, { targetFPS: TARGET_FPS });
    assert.deepEqual(stored.gates, expected,
      'the record must CALL the shared gate, not recompute a percentile of its own');
  });
});

// ---------------------------------------------------------------------------
// ER-16 — the hypothesis carries a success gate, and the decision is checked
// against it.
// REJECTS: "we tried it and liked it" — a keep whose own stated gate was missed.
// ---------------------------------------------------------------------------
test('ER-16 a keep whose stated success gate was not met is a violation', { skip: IMPL }, async () => {
  const { validateEvidenceRecord } = await load();
  const noGate = { statement: GOOD_HYPOTHESIS.statement, successGate: null };
  const R0 = await completeRecord({ hypothesis: noGate, conclude: null });
  assert.ok(validateEvidenceRecord(R0.record(), { K }).some((p) => /gate/i.test(String(p))),
    'a hypothesis with no success gate is not a hypothesis, it is a hope');

  // A gate nothing in the run met: p95 must land under a quarter of a frame.
  const R = await completeRecord({
    hypothesis: { statement: GOOD_HYPOTHESIS.statement,
      successGate: { metric: 'p95', direction: 'lower', thresholdMs: B / 4 } },
    conclude: { conclusion: 'conclusive', decision: 'keep' },
  });
  const rec = R.record();
  assert.equal(rec.gateMet, false, 'the record must state whether its own gate was met');
  assert.ok(R.violations().some((v) => /gate/i.test(String(v.kind ?? v))),
    'keeping a change whose gate was missed must be recorded as a violation');
  assert.notEqual(rec.decision, 'keep');
});

// ---------------------------------------------------------------------------
// ER-17 — image differences alone cannot establish improved realism (plan).
// REJECTS: a visual tradeoff evidenced only by a PNG diff, in a repo where a
// dark-rendering bloom pass and two invisible shaders all passed "a frame painted".
// ---------------------------------------------------------------------------
test('ER-17 a visual tradeoff evidenced only by an image diff is insufficient', { skip: IMPL }, async () => {
  const { validateEvidenceRecord, VISUAL_EVIDENCE_KINDS } = await load();
  assert.deepEqual([...VISUAL_EVIDENCE_KINDS].sort(),
    ['image-diff', 'motion-clip', 'player-feedback']);
  const R = await completeRecord({
    tradeoff: { observed: 'Slightly softer shafts at the waterfall.', evidence: ['image-diff'] },
    conclude: { conclusion: 'conclusive', decision: 'keep' },
  });
  const rec = R.record();
  assert.ok(validateEvidenceRecord(rec, { K }).some((p) => /image-diff|motion|feedback/i.test(String(p))),
    'image-diff alone must be named as insufficient visual evidence');
  assert.equal(rec.conclusion, 'inconclusive');
  assert.equal(rec.inconclusiveReason, 'unavailable-evidence');
});

// ---------------------------------------------------------------------------
// ER-18 — warm/cold is stated, never assumed, and a software renderer may not
// make a device-performance claim (R6).
// REJECTS: a default of 'warm' (the flattering one), and a SwiftShader number
// filed as phone evidence.
// ---------------------------------------------------------------------------
test('ER-18 warm/cold has no default, and SwiftShader cannot claim device performance', { skip: IMPL }, async () => {
  const { WARM_STATES, CLAIM_SCOPES, isComplete, validateEvidenceRecord } = await load();
  assert.deepEqual([...WARM_STATES].sort(), ['cold', 'warm'],
    'there is no third "unknown" warm state — an unknown one is a sentinel, and a sentinel is incomplete here');
  assert.deepEqual([...CLAIM_SCOPES].sort(), ['device-performance', 'functional']);

  const noWarm = await completeRecord({ environment: { warmState: undefined } });
  const rec = noWarm.record();
  assert.notEqual(rec.warmState, 'warm', 'warm must never be assumed — it is the flattering answer');
  assert.equal(isComplete(rec).complete, false);
  assert.ok(isComplete(rec).missing.includes('warmState'));

  const sw = await completeRecord({
    environment: { device: 'Linux CI', browser: 'Chromium headless', renderer: 'SwiftShader',
      softwareRenderer: true, claimScope: 'device-performance' },
  });
  assert.ok(validateEvidenceRecord(sw.record(), { K }).some((p) => /software|device-performance|R6/i.test(String(p))),
    'R6: no SwiftShader number is a device claim');
  assert.equal(sw.record().claimScope, 'functional',
    'a software-rendered record is demoted to a functional claim, not discarded and not believed');
});

// ---------------------------------------------------------------------------
// ER-19 — "next unresolved issue" is prose or it is nothing.
// REJECTS: 'n/a', '', 'none' — the three ways a form field gets closed without
// anybody thinking about what is still unknown.
// ---------------------------------------------------------------------------
test('ER-19 nextIssue is enforced prose, not a closed box', { skip: IMPL }, async () => {
  const { validateEvidenceRecord } = await load();
  const base = (await completeRecord()).record();
  for (const bad of ['', 'n/a', 'none', 'ok', 'tbd']) {
    assert.ok(validateEvidenceRecord({ ...base, nextIssue: bad }, { K }).length > 0,
      `nextIssue "${bad}" must be rejected — the same rule the corpus applies to whyCapacityModel`);
  }
  assert.deepEqual(validateEvidenceRecord({ ...base, nextIssue: NEXT_ISSUE }, { K }), []);
});

// ===========================================================================
// ER-20 .. ER-24 — the export, and the superset relation
// ===========================================================================

// ---------------------------------------------------------------------------
// ER-20 — EXPORT_TRACE_FIELDS is a superset of what the corpus actually builds.
// Measured against every scenario the corpus produces, so an optional field
// (allowOutOfRangeStart, interpolate) cannot be missed by sampling one.
// REJECTS: the Wave-2 failure this task names — an export and a fixture with two
// different shapes, which discards the device capture on the day it is taken.
// ---------------------------------------------------------------------------
test('ER-20 the export schema is a superset of the real fixture schema', { skip: IMPL }, async () => {
  const { EXPORT_TRACE_FIELDS } = await load();
  const scenarioFields = new Set();
  const sampleFields = new Set();
  const eventFields = new Set();
  for (const name of SCENARIO_NAMES) {
    const s = buildScenario(name, K);
    for (const k of Object.keys(s)) scenarioFields.add(k);
    for (const sample of s.samples ?? []) for (const k of Object.keys(sample)) sampleFields.add(k);
    for (const ev of s.events ?? []) for (const k of Object.keys(ev)) eventFields.add(k);
  }
  assert.ok(scenarioFields.size >= 15, 'sanity: the corpus really was walked');

  const exported = new Set(EXPORT_TRACE_FIELDS);
  for (const f of scenarioFields) {
    assert.ok(exported.has(f),
      `EXPORT_TRACE_FIELDS is missing "${f}" — a device capture that omits it cannot be dropped into ` +
      `tests/fixtures/perf-traces/scenarios/ unchanged, and a capture that cannot be replayed is a screenshot`);
  }
  // The nested shapes travel too.
  for (const f of sampleFields) {
    assert.ok(exported.has(`samples.${f}`), `EXPORT_TRACE_FIELDS is missing "samples.${f}"`);
  }
  for (const f of eventFields) {
    assert.ok(exported.has(`events.${f}`), `EXPORT_TRACE_FIELDS is missing "events.${f}"`);
  }
  // Superset, not equality: the capture carries provenance the synthetic traces do not need.
  assert.ok(exported.has('samples.costProvenance'),
    'a capture must say which rung costs it MEASURED and which it modelled');
  assert.ok(exported.has('capturedOn') && exported.has('evidenceId'),
    'an exported capture carries its provenance back to the record that produced it');
});

// ---------------------------------------------------------------------------
// ER-21 — the exported scenario is accepted by the corpus's own validator,
// unchanged, with zero problems.
// REJECTS: an export that validates only after a human edits it, which is the
// same thing as an export that is thrown away.
// ---------------------------------------------------------------------------
test('ER-21 toFixtureScenario() passes validateScenario with no problems', { skip: IMPL }, async () => {
  const { toFixtureScenario } = await load();
  const R = await completeRecord();
  const scenario = toFixtureScenario(R.record());
  assert.deepEqual(validateScenario(scenario, { K }), [],
    'the corpus validator is the oracle here — the export answers to it, not the other way round');
  assert.ok(SCENARIO_NAMES.includes(scenario.name) === false,
    'a captured scenario takes a new name; it does not overwrite a corpus member');
});

// ---------------------------------------------------------------------------
// ER-22 — every rung of every exported sample is filled, and says how.
// REJECTS: presenting a modelled cost as a measured one. A device visits the
// rungs the controller chose; the fixture validator rejects a hole; so the
// export must fill the rest AND be honest that it did.
// ---------------------------------------------------------------------------
test('ER-22 an exported capture fills every rung and marks measured vs modelled', { skip: IMPL }, async () => {
  const { toFixtureScenario, COST_PROVENANCE } = await load();
  assert.deepEqual([...COST_PROVENANCE].sort(), ['interpolated', 'measured', 'modelled']);
  const scenario = toFixtureScenario((await completeRecord()).record());
  const depth = Array.isArray(scenario.ladder) ? scenario.ladder.length : 3;

  for (const s of scenario.samples) {
    for (let i = 0; i < depth; i += 1) {
      assert.equal(typeof s.costMs[`rung${i}`], 'number',
        `sample at ${s.atMs} has a hole at rung${i} — the validator rejects it and so does the question it exists to answer`);
      assert.ok(COST_PROVENANCE.includes(s.costProvenance[`rung${i}`]),
        `sample at ${s.atMs}: rung${i} must state its provenance`);
    }
    assert.ok(Object.values(s.costProvenance).includes('measured'),
      `sample at ${s.atMs} measured nothing — a sample entirely modelled is a simulation wearing a capture's clothes`);
  }
});

// ---------------------------------------------------------------------------
// ER-23 — the export survives the round trip to disk and replays identically.
// REJECTS: functions, undefined, class instances or a live ladder object in the
// export — anything that turns into a different trace after JSON.stringify, which
// is the only form a fixture ever exists in.
// ---------------------------------------------------------------------------
test('ER-23 an exported capture round-trips through JSON and replays deterministically', { skip: IMPL }, async () => {
  const { toFixtureScenario } = await load();
  const scenario = toFixtureScenario((await completeRecord()).record());
  const onDisk = JSON.parse(JSON.stringify(scenario));
  assert.deepEqual(onDisk, scenario, 'the export must already be JSON — a fixture is a file');
  assert.deepEqual(validateScenario(onDisk, { K }), []);

  const a = runTrace(onDisk, { policy: createCompatPolicy({ K }) });
  const b = runTrace(onDisk, { policy: createCompatPolicy({ K }) });
  assert.deepEqual(b.samples, a.samples, 'a replayed capture is deterministic or it is not a regression');
  assert.deepEqual(b.tierChangeLog, a.tierChangeLog);
  assert.ok(a.samples.length > 0, 'sanity: the replay actually ran frames');
});

// ---------------------------------------------------------------------------
// ER-24 — an incomplete record cannot be exported.
// REJECTS: a trace filed in tests/fixtures/ with no build hash, no warm state
// and no hypothesis — a permanent regression nobody can interpret, which is
// worse than none, because it will be defended.
// ---------------------------------------------------------------------------
test('ER-24 exportEvidence refuses an incomplete record and says what is missing', { skip: IMPL }, async () => {
  const { exportEvidence, createEvidenceRecord } = await load();
  const empty = createEvidenceRecord({ now: () => 0, constants: K, targetFPS: TARGET_FPS }).record();
  const bad = exportEvidence(empty);
  assert.equal(bad.ok, false, 'an incomplete record does not export');
  assert.ok(Array.isArray(bad.problems) && bad.problems.length > 0);
  assert.equal(bad.scenario, undefined, 'and it does not hand back half a fixture either');

  const noBuild = { ...(await completeRecord()).record(), build: undefined };
  assert.equal(exportEvidence(noBuild).ok, false, 'CONTRACT §8.2 again: no build hash, no export');

  const good = exportEvidence((await completeRecord()).record());
  assert.equal(good.ok, true);
  assert.ok(good.evidence && good.scenario, 'a good export carries BOTH halves — the record and the replayable trace');
  assert.equal(good.scenario.evidenceId, good.evidence.id,
    'the trace names the record that produced it, so a fixture is never anonymous');
  assert.deepEqual(validateScenario(good.scenario, { K }), []);
});
