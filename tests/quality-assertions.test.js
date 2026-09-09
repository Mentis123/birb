/**
 * tests/quality-assertions.test.js — the oracle for the oracle.
 *
 * Wave 1 / P1.2. `tools/lib/quality-assertions.mjs` is what nine cheap Wave 2
 * tasks are graded against, so its comparator directions need a check of their
 * own. R8: a check is not trusted until it has been WATCHED FAILING, and this
 * file is where every one of them is watched failing, mechanically, on every
 * `npm test` run.
 *
 * Three things are pinned here that nothing else pins:
 *
 *  1. THE TRANSCRIPTION. `getQualityPixelRatio` is copied out of
 *     src/environment/visual-style.js because that module imports three and
 *     cannot run under this repo's tracked stub. The copy is compared against
 *     the real file AS TEXT. A transcription nobody re-checks is a fabricated
 *     constant with a citation attached.
 *  2. EXPECTED_RED_HEAD. The A6 manifest is re-derived from the numbers
 *     actually captured off the running page and must still come out
 *     field-for-field identical. If the sizing fix lands, this test goes red —
 *     which is correct: revising EXPECTED-RED.md is a gate decision, not a
 *     harness convenience.
 *  3. ABSENCE IS NEVER A PASS. Every assertion run over an empty snapshot must
 *     return unavailable or invalid. That is the single rule the whole wave
 *     rests on.
 *
 * No BIRB_PERF_IMPL gate: unlike the P1.1 suites, the module under test is
 * written by this same task and exists on disk, so a static import is correct
 * here and R4 does not apply.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASSERTIONS, ASSERTION_IDS, MUTATIONS, UNAVAILABLE_REASONS, PASS_COUNTS,
  A6_REQUIRED_STEPS, A10_ROUTED_FIELDS, EXPECTED_RED_HEAD,
  getQualityPixelRatio, QUALITY_PIXEL_RATIO_SOURCE, expectedTargetSizes,
  computeRaysOn, matchesExpectedRed, runAssertions, exitCodeFor, mutationCoverage,
} from '../tools/lib/quality-assertions.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Fixtures. Every number in `head*` was captured off the running page; the
// synthetic ones are marked and exist only to give a comparator something to
// compare.
// ---------------------------------------------------------------------------

/** MEASURED: index.html at 390x844, deviceScaleFactor 3, isMobile (DPR_CAP 1.7). */
const effective = (rpr, dbw, dbh, sw, sh, bw, bh, wpr, rspr) => ({
  rendererPixelRatio: rpr,
  drawingBufferWidth: dbw,
  drawingBufferHeight: dbh,
  bloom: {
    sceneTarget: { width: sw, height: sh },
    blurA: { width: bw, height: bh },
    blurB: { width: bw, height: bh },
    rayTarget: { width: bw, height: bh },
    downscale: 2,
  },
  weatherPixelRatio: wpr,
  resizeStatePixelRatio: rspr,
  statsPath: rpr >= 1.7 ? 'bloom-frameStats' : 'renderer-info',
});

/** MEASURED, verbatim from the HEAD resize-restore capture. */
const headResizeRestore = () => ({
  context: { devicePixelRatio: 3, dprCap: 1.7 },
  steps: [
    { id: 'tier0', requestedTier: 0, cssWidth: 390, cssHeight: 844, effective: effective(1.7, 663, 1434, 663, 1434, 331, 717, 1.7, 1.7) },
    { id: 'degraded', requestedTier: 2, cssWidth: 390, cssHeight: 844, effective: effective(0.85, 331, 717, 663, 1434, 331, 717, 1.7, 1.7) },
    { id: 'resizedWhileDegraded', requestedTier: 2, cssWidth: 360, cssHeight: 780, effective: effective(0.85, 306, 663, 306, 663, 153, 331, 0.85, 0.85) },
    { id: 'restored', requestedTier: 0, cssWidth: 360, cssHeight: 780, effective: effective(1.7, 612, 1326, 306, 663, 153, 331, 0.85, 0.85) },
  ],
});

/** What the same sequence must look like once the Wave 2 sizing fix lands. */
const fixedResizeRestore = () => {
  const s = headResizeRestore();
  s.steps[1].effective = effective(0.85, 331, 717, 331, 717, 165, 358, 0.85, 0.85);
  s.steps[3].effective = effective(1.7, 612, 1326, 612, 1326, 306, 663, 1.7, 1.7);
  return s;
};

const greenSnapshots = () => ({
  // MEASURED: tier 0, rays off, settled.
  A4: { effective: effective(1.7, 663, 1434, 663, 1434, 331, 717, 1.7, 1.7) },
  A6: fixedResizeRestore(),
  A7: {
    frameTotals: { calls: 74, triangles: 76854, passes: 5, scene: { calls: 70, triangles: 76850 }, tier: 0 },
    frameTotalsPrev: { calls: 74, passes: 5, scene: { calls: 70 }, tier: 0 },
    raysStrength: 0, sunVisible: 0, bloomEnabled: true,
  },
  // MEASURED: tier 1.
  A8: { frameTotals: { calls: 87, triangles: 77528, passes: 1, scene: { calls: 87, triangles: 77528 }, tier: 1 } },
  // MEASURED: 8 then 6,5,5,5 after setBloom({rays:0}).
  A9: {
    before: { passes: 8, tier: 0 },
    samplesAfter: [{ passes: 6 }, { passes: 5 }, { passes: 5 }, { passes: 5 }],
  },
  // SYNTHETIC (the surfaces below do not exist until Wave 2).
  A1: { debugParamPresent: false, panel: { present: true, openedAfterGesture: true }, gesture: { performed: 'three-finger-hold-release' } },
  A2: { panel: { present: true, openedAfterGesture: false }, gesture: { performed: 'two-finger-hold' }, sprintActive: true },
  A3: {
    selfCheckDprPassed: true, requestedDpr: 1.2,
    before: { effective: effective(1.7, 663, 1434, 663, 1434, 331, 717, 1.7, 1.7) },
    after: { effective: effective(1.2, 468, 1012, 468, 1012, 234, 506, 1.2, 1.2) },
  },
  A5: {
    densityOne: { tier: 0, weather: { visible: true }, frameTotals: { scene: { calls: 70 } } },
    densityZero: { tier: 0, weather: { visible: false }, frameTotals: { scene: { calls: 69 } } },
  },
  A10: {
    request: { dpr: 1.2 },
    atN: { tier: 1, rendererPixelRatio: 1.2, weatherPixelRatio: 1.2, windValue: 1, weatherVisible: true },
    atN2: { tier: 1, rendererPixelRatio: 1.2, weatherPixelRatio: 1.2, windValue: 1, weatherVisible: true },
  },
  A11: {
    sentinelFields: ['cooldown', 'lastAdjustment.reason', 'activeMode'],
    quality: {
      cooldown: { value: null, state: 'unavailable', reason: 'not-implemented' },
      lastAdjustment: { reason: { value: null, state: 'unavailable', reason: 'not-implemented' } },
      activeMode: { value: null, state: 'unavailable', reason: 'not-implemented' },
    },
  },
  A12: {
    panelShowsStaleWarning: false,
    quality: { build: { requested: 'v42-2026-09-08-ground-and-ribbons', serving: 'v42-2026-09-08-ground-and-ribbons', stale: false } },
  },
});

// ---------------------------------------------------------------------------
// 1. The transcription pin
// ---------------------------------------------------------------------------

test('QA-P1: getQualityPixelRatio is a live transcription of the real source', () => {
  const src = fs.readFileSync(path.join(REPO, 'src/environment/visual-style.js'), 'utf8');
  assert.ok(
    src.includes(QUALITY_PIXEL_RATIO_SOURCE),
    'src/environment/visual-style.js no longer contains the transcribed return expression:\n  ' +
    QUALITY_PIXEL_RATIO_SOURCE +
    '\nThe copy in tools/lib/quality-assertions.mjs has drifted from the code it claims to mirror. ' +
    'Fix the copy AND the pinned string together, and note it as a CONTRACT amendment.',
  );
  // The table CONTRACT §5.2 pins, re-derived rather than restated.
  assert.equal(getQualityPixelRatio(3, 1.7, 0), 1.7);
  assert.equal(getQualityPixelRatio(3, 1.7, 1), 1);
  assert.equal(getQualityPixelRatio(3, 1.7, 2), 0.85);
  assert.equal(getQualityPixelRatio(1, 1.7, 0), 1);
  // SC-DPR's dead-discriminator row: at dsf 1 tier 0 and tier 1 are identical.
  assert.equal(getQualityPixelRatio(1, 1.7, 0), getQualityPixelRatio(1, 1.7, 1));
  assert.notEqual(getQualityPixelRatio(3, 1.7, 0), getQualityPixelRatio(3, 1.7, 1));
});

test('QA-P2: expectedTargetSizes reproduces the measured buffer dimensions', () => {
  // MEASURED off the page; floor(), not round(), and the difference shows at
  // 844 * 1.7 = 1434.8 -> 1434 and 390 * 0.85 = 331.5 -> 331.
  assert.deepEqual(
    expectedTargetSizes({ cssWidth: 390, cssHeight: 844, pixelRatio: 1.7, downscale: 2 }),
    {
      drawingBufferWidth: 663, drawingBufferHeight: 1434,
      sceneTarget: { width: 663, height: 1434 },
      blurA: { width: 331, height: 717 }, blurB: { width: 331, height: 717 }, rayTarget: { width: 331, height: 717 },
    },
  );
  assert.deepEqual(
    expectedTargetSizes({ cssWidth: 360, cssHeight: 780, pixelRatio: 0.85, downscale: 2 }).sceneTarget,
    { width: 306, height: 663 },
  );
  assert.deepEqual(
    expectedTargetSizes({ cssWidth: 360, cssHeight: 780, pixelRatio: 1.7, downscale: 2 }).sceneTarget,
    { width: 612, height: 1326 },
  );
  // No target may ever be zero-sized, whatever the ratio.
  const tiny = expectedTargetSizes({ cssWidth: 1, cssHeight: 1, pixelRatio: 0.1, downscale: 8 });
  assert.equal(tiny.sceneTarget.width, 1);
  assert.equal(tiny.blurA.width, 1);
});

// ---------------------------------------------------------------------------
// 2. Enums and constants — closed sets, pinned
// ---------------------------------------------------------------------------

test('QA-P3: the closed enums match CONTRACT.md exactly', () => {
  assert.deepEqual([...UNAVAILABLE_REASONS], [
    'not-implemented', 'no-extension', 'no-context', 'disjoint',
    'insufficient-samples', 'paused', 'not-applicable', 'stale',
  ]);
  assert.deepEqual([...A6_REQUIRED_STEPS], ['tier0', 'degraded', 'resizedWhileDegraded', 'restored']);
  // CONTRACT §4.1, read from bloom-pass.js and confirmed on the page.
  assert.deepEqual({ ...PASS_COUNTS }, { raysOn: 8, raysOff: 5, raysClearingFrame: 6, noPost: 1 });
  assert.deepEqual([...ASSERTION_IDS], ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12']);
  assert.ok(A10_ROUTED_FIELDS.length >= 4);
});

test('QA-P4: computeRaysOn is the uniform predicate, not a guess', () => {
  assert.equal(computeRaysOn(1, 0.98), true);
  assert.equal(computeRaysOn(1, 0), false);      // sun off screen
  assert.equal(computeRaysOn(0, 0.98), false);   // shafts turned off
  assert.equal(computeRaysOn(0.0005, 0.98), false); // under the 0.001 epsilon
  assert.equal(computeRaysOn(undefined, 0.98), null); // unknown, never assumed
});

// ---------------------------------------------------------------------------
// 3. THE RULE: absence is never a pass
// ---------------------------------------------------------------------------

test('QA-A0: no assertion returns pass over an empty snapshot', () => {
  for (const id of ASSERTION_IDS) {
    const r = ASSERTIONS[id].run({});
    assert.notEqual(r.state, 'pass', `${id} passed with no data — that is the false pass this wave exists to prevent`);
    assert.ok(['unavailable', 'invalid'].includes(r.state), `${id} returned ${r.state}`);
    assert.notEqual(r.pass, true);
    if (r.state === 'unavailable') {
      assert.ok(UNAVAILABLE_REASONS.includes(r.reason), `${id} used reason "${r.reason}", outside the closed enum`);
    }
    assert.ok(typeof r.message === 'string' && r.message.length > 20, `${id} gave no diagnosable message`);
  }
});

test('QA-A0b: the Wave-2 surfaces report unavailable, not pass, on HEAD', () => {
  // A1's guard is different on purpose: a run on a ?debug page is an INVALID
  // run, not an unavailable one, because CONTRACT §6.4 rejects it outright.
  assert.equal(ASSERTIONS.A1.run({ debugParamPresent: true, panel: { present: true, openedAfterGesture: true } }).state, 'invalid');
  assert.equal(ASSERTIONS.A2.run({ panel: { present: false }, gesture: { performed: 'two-finger-hold' }, sprintActive: true }).state, 'unavailable');
  assert.equal(ASSERTIONS.A11.run({ sentinelFields: ['cooldown'] }).state, 'unavailable');
  assert.equal(ASSERTIONS.A12.run({ quality: {} }).state, 'unavailable');
});

// ---------------------------------------------------------------------------
// 4. Green fixtures pass
// ---------------------------------------------------------------------------

test('QA-A1..A12 green: every assertion passes on a coherent snapshot', () => {
  const snaps = greenSnapshots();
  const results = runAssertions(snaps);
  const bad = results.filter((r) => r.state !== 'pass');
  assert.deepEqual(bad.map((r) => `${r.id}:${r.state}:${r.message}`), [],
    'an assertion refused a snapshot that satisfies it — the comparator is inverted or over-strict');
  assert.equal(exitCodeFor(results), 0);
});

// ---------------------------------------------------------------------------
// 5. THE FLIP TESTS — every catalogued snapshot mutation must be detected
// ---------------------------------------------------------------------------

test('QA-FLIP: every snapshot-class mutation flips its assertion to the stated state', () => {
  const snaps = greenSnapshots();
  const snapshotMutations = MUTATIONS.filter((m) => m.class === 'snapshot');
  assert.ok(snapshotMutations.length >= 15, 'the catalogue lost coverage');
  for (const m of snapshotMutations) {
    const base = snaps[m.targets];
    assert.ok(base, `${m.id} targets ${m.targets}, which has no green fixture`);
    const before = ASSERTIONS[m.targets].run(base);
    assert.equal(before.state, 'pass', `${m.id}: the fixture for ${m.targets} was not green to begin with`);
    const mutated = m.apply(JSON.parse(JSON.stringify(base)));
    const after = ASSERTIONS[m.targets].run(mutated);
    assert.equal(after.state, m.detects,
      `${m.id} (${m.why}) left ${m.targets} at "${after.state}", expected "${m.detects}". ` +
      'An assertion that cannot be flipped is rejected before a single cheap task starts.');
    assert.notEqual(after.pass, true);
  }
});

test('QA-FLIP2: the page-hook and page-real mutations are catalogued and countable', () => {
  const byClass = (c) => MUTATIONS.filter((m) => m.class === c);
  assert.ok(byClass('page-hook').length >= 2);
  assert.ok(byClass('page-real').length >= 2);
  for (const m of byClass('page-hook')) {
    assert.equal(typeof m.pageScript, 'string', `${m.id} has no pageScript to apply`);
  }
  for (const m of byClass('page-real')) {
    assert.equal(typeof m.requires, 'string', `${m.id} must name the file whose absence makes it inapplicable`);
  }
  // The coverage line is the whole point: with none of Wave 2's files on disk,
  // applicable must be strictly less than catalogued, so `--selftest` cannot
  // report full coverage of a surface that does not exist.
  const none = mutationCoverage([]);
  assert.ok(none.applicable < none.catalogued, 'every mutation looked applicable with no Wave 2 files present');
  const all = mutationCoverage(['src/ui/dev-gesture.js', 'src/ui/dev-quality-panel.js']);
  assert.equal(all.applicable, all.catalogued);
});

// ---------------------------------------------------------------------------
// 6. A6 and the EXPECTED-RED manifest
// ---------------------------------------------------------------------------

test('QA-A6-RED: the measured HEAD capture reproduces EXPECTED_RED_HEAD field for field', () => {
  const v = ASSERTIONS.A6.run(headResizeRestore());
  assert.equal(v.state, 'fail', 'A6 passed on HEAD — that is the wrong check and Wave 1 has failed');
  const m = matchesExpectedRed(v);
  assert.deepEqual(m.differences, []);
  assert.equal(m.matches, true);
  // The load-bearing half: step 4 must be the one that is incoherent. A run in
  // which only `degraded` fails is a truncated check that goes green forever
  // the moment the sizing fix lands.
  assert.equal(v.restoredCoherent, false);
  const byStep = Object.fromEntries(v.steps.map((s) => [s.step, s]));
  assert.equal(byStep.tier0.coherent, true);
  assert.equal(byStep.resizedWhileDegraded.coherent, true,
    'step 3 must HEAL the step-2 desync; if it does not, this fixture no longer describes HEAD');
  assert.equal(byStep.restored.mismatches.length, 10);
  assert.ok(byStep.restored.mismatches.includes('bloom.sceneTarget.width'));
  assert.ok(byStep.restored.mismatches.includes('weatherPixelRatio'));
  assert.ok(byStep.restored.mismatches.includes('resizeStatePixelRatio'));
  // The drawing buffer and the renderer's own ratio are CORRECT at step 4 —
  // applyTier does set those. Anyone hunting this bug by watching the canvas
  // size will find nothing.
  assert.ok(!byStep.restored.mismatches.includes('drawingBufferWidth'));
  assert.ok(!byStep.restored.mismatches.includes('rendererPixelRatio'));
});

test('QA-A6-FIXED: the same sequence passes once every target is resized', () => {
  const v = ASSERTIONS.A6.run(fixedResizeRestore());
  assert.equal(v.state, 'pass');
  assert.equal(matchesExpectedRed(v).matches, false,
    'a fixed tree must NOT match the EXPECTED-RED manifest');
});

test('QA-A6-TRUNCATION: a two-step run is invalid, never a partial pass', () => {
  const s = headResizeRestore();
  const v = ASSERTIONS.A6.run({ ...s, steps: s.steps.slice(0, 2) });
  assert.equal(v.state, 'invalid');
  assert.match(v.message, /truncated|missing step/i);
});

test('QA-A6-BLIND-SPOT: A4 passes on the very frame A6 fails', () => {
  // sceneTarget 306x663 with blurA 153x331 is internally consistent and half
  // the resolution the renderer is drawing at. This is why A4 is not A6.
  const restored = headResizeRestore().steps[3];
  assert.equal(ASSERTIONS.A4.run({ effective: restored.effective }).state, 'pass');
  assert.equal(ASSERTIONS.A6.run(headResizeRestore()).state, 'fail');
});

// ---------------------------------------------------------------------------
// 7. Precondition guards that must refuse rather than score
// ---------------------------------------------------------------------------

test('QA-A7-GUARD: A7 refuses a tier >= 1 capture instead of failing it', () => {
  const t1 = { frameTotals: { calls: 87, passes: 1, scene: { calls: 87 }, tier: 1 }, frameTotalsPrev: { passes: 1 }, raysOn: false, bloomEnabled: true };
  const r = ASSERTIONS.A7.run(t1);
  assert.equal(r.state, 'invalid');
  assert.match(r.message, /A8/);
  // ...and A8 is content with the same capture.
  assert.equal(ASSERTIONS.A8.run(t1).state, 'pass');
});

test('QA-A7-RAYS: the 8/5 branch is chosen by the uniforms, not by the tier', () => {
  const base = greenSnapshots().A7;
  // MEASURED: raysOn -> passes 8, calls 70, scene 63.
  const on = ASSERTIONS.A7.run({
    ...base, raysStrength: 1, sunVisible: 0.71,
    frameTotals: { calls: 70, passes: 8, scene: { calls: 63 }, tier: 0 },
    frameTotalsPrev: { passes: 8 },
  });
  assert.equal(on.state, 'pass');
  assert.equal(on.raysOn, true);
  // The same 8-pass frame with the shafts off is a failure, not a pass.
  const mismatched = ASSERTIONS.A7.run({
    ...base, raysStrength: 0, sunVisible: 0.71,
    frameTotals: { calls: 70, passes: 8, scene: { calls: 63 }, tier: 0 },
    frameTotalsPrev: { passes: 8 },
  });
  assert.equal(mismatched.state, 'fail');
  // raysOn unknown is unavailable — never assumed either way.
  assert.equal(ASSERTIONS.A7.run({ ...base, raysStrength: undefined, sunVisible: undefined }).state, 'unavailable');
});

test('QA-A9-GUARD: a single 6-pass clearing frame is allowed, a second is not', () => {
  const ok = ASSERTIONS.A9.run({ before: { passes: 8, tier: 0 }, samplesAfter: [{ passes: 6 }, { passes: 5 }, { passes: 5 }] });
  assert.equal(ok.state, 'pass');
  const latched = ASSERTIONS.A9.run({ before: { passes: 8, tier: 0 }, samplesAfter: [{ passes: 6 }, { passes: 6 }, { passes: 5 }] });
  assert.equal(latched.state, 'fail');
  const short = ASSERTIONS.A9.run({ before: { passes: 8, tier: 0 }, samplesAfter: [{ passes: 5 }] });
  assert.equal(short.state, 'invalid');
});

test('QA-A5-GUARD: a cross-tier density comparison is refused as confounded', () => {
  const s = greenSnapshots().A5;
  const crossed = { densityOne: { ...s.densityOne, tier: 1 }, densityZero: { ...s.densityZero, tier: 2 } };
  const r = ASSERTIONS.A5.run(crossed);
  assert.equal(r.state, 'invalid');
  assert.match(r.message, /tier/);
});

test('QA-A3-GUARD: A3 is invalid when SC-DPR failed for the context', () => {
  const s = { ...greenSnapshots().A3, selfCheckDprPassed: false };
  assert.equal(ASSERTIONS.A3.run(s).state, 'invalid');
});

test('QA-A12-GUARD: no service worker is not-applicable, not stale', () => {
  const absent = { quality: { build: { requested: 'v42', serving: null, stale: false } } };
  assert.equal(ASSERTIONS.A12.run(absent).state, 'pass');
  const sentinel = { quality: { build: { requested: 'v42', serving: { value: null, state: 'unavailable', reason: 'not-applicable' }, stale: false } } };
  assert.equal(ASSERTIONS.A12.run(sentinel).state, 'pass');
});

// ---------------------------------------------------------------------------
// 8. Exit-code mapping
// ---------------------------------------------------------------------------

test('QA-EXIT: fail/invalid -> 1, unavailable -> 2, all pass -> 0', () => {
  assert.equal(exitCodeFor([{ state: 'pass' }, { state: 'pass' }]), 0);
  assert.equal(exitCodeFor([{ state: 'pass' }, { state: 'unavailable' }]), 2);
  assert.equal(exitCodeFor([{ state: 'unavailable' }, { state: 'fail' }]), 1);
  assert.equal(exitCodeFor([{ state: 'invalid' }]), 1);
  // The one that must never happen: an all-unavailable run reporting success.
  assert.notEqual(exitCodeFor([{ state: 'unavailable' }, { state: 'unavailable' }]), 0);
  // And an empty run is not a green run.
  assert.equal(exitCodeFor(runAssertions({})), 1);
});

test('QA-REGISTRY: every row names its contract clause and its flip recipe', () => {
  for (const id of ASSERTION_IDS) {
    const spec = ASSERTIONS[id];
    assert.equal(typeof spec.run, 'function', `${id} has no implementation`);
    assert.match(spec.contract, /CONTRACT|EXPECTED-RED/, `${id} cites no authority`);
    assert.ok(spec.flip && spec.flip.length > 10, `${id} has no flip recipe for G1`);
    assert.equal(typeof spec.availableOnHead, 'boolean');
    if (!spec.availableOnHead && id !== 'A1') {
      assert.ok(UNAVAILABLE_REASONS.includes(spec.unavailableReason), `${id} declares no valid unavailable reason`);
    }
    assert.ok(MUTATIONS.some((m) => m.targets === id), `${id} has no catalogued mutation — it has never been watched failing`);
  }
});
