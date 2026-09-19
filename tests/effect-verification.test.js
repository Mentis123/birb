/**
 * tests/effect-verification.test.js — RED-FIRST spec for
 * `src/game/effect-verification.js`, step 2 of the MANDATORY RUNTIME LOOP.
 *
 * Wave 3 / task P3.2 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4, implementing
 * RL-2 of docs/PERFORMANCE_REALISM_PLAN.md:
 *
 *   "Apply and verify: confirm the effective buffer sizes, effect activity or
 *    update rates actually changed. A SLIDER VALUE CHANGING IS NOT EVIDENCE
 *    THAT RENDERING WORK CHANGED. Allow the settling period before scoring."
 *
 * That middle sentence is the module. Everything below exists to make it
 * mechanical rather than aspirational.
 *
 * ---------------------------------------------------------------------------
 * R4 — red-first form
 * ---------------------------------------------------------------------------
 * Every test dynamic-imports INSIDE its body and is skipped unless
 * BIRB_PERF_IMPL is set. A top-level static import of a module that does not
 * exist resolves BEFORE any skip is evaluated and turns tests.yml red for the
 * whole repo — humanoid/, gauntlet/, sculpture/ and icon3d/ included.
 *
 *   node --test tests/effect-verification.test.js                  # skipped
 *   BIRB_PERF_IMPL=1 node --test tests/effect-verification.test.js # red until P3.2 builds it
 *
 * ---------------------------------------------------------------------------
 * THE SURFACE THIS SUITE PINS  (the implementer transcribes; it does not redesign)
 * ---------------------------------------------------------------------------
 *   createEffectVerifier({
 *     readEffective,   // () => OBSERVATION | null   READ BACK off the live world
 *     now,             // () => ms                   injected clock, never a wall clock
 *     constants,       // PROVISIONAL-shaped table (src/game/perf-constants.js)
 *     settleMs,        // optional; DEFAULTS TO constants.settleHoldMs (PRO-6)
 *     forbiddenKeys,   // optional; defaults to the gameplay-fidelity deny list
 *   })
 *   -> {
 *     begin({ kind, keys, requested, expect, tMs }) -> { id, before }
 *     verify(id, tMs) -> {
 *       id, state, verdict, changed, creditable, settled, evidence, unmet, reason
 *     }
 *     pending() -> id | null
 *     snapshot() -> { pendingId, lastVerdict, verifications }
 *   }
 *
 * OBSERVATION — everything is read back off the live objects that render
 * (CONTRACT §0 "effective"), and any field with no source is `null`, never 0:
 *
 *   {
 *     buffers:  { drawingBufferWidth, drawingBufferHeight, rendererPixelRatio,
 *                 post: { sceneTarget:{width,height}, blurA:{width,height},
 *                         blurB:{...}, rayTarget:{...}, downscale } | null },
 *     activity: { post, shafts, weatherVisible, contactShadow, ribbons, cloudShell },
 *     work:     { passes, sceneCalls, totalCalls, sceneTriangles, totalTriangles },
 *     rates:    { weatherDensity, mistBudget, wind, panelUpdateHz },
 *   }
 *
 * EXPECT — a closed set of three forms, dotted paths into the OBSERVATION:
 *
 *   { path, to: <value> }                    the field must READ BACK as this
 *   { path, direction: 'increase'|'decrease' }
 *   { path, changed: true }
 *
 * VERDICT is decided by the expectations and nothing else:
 *   'applied' — every expectation held        -> creditable === true
 *   'partial' — some held, some did not       -> creditable === false
 *   'no-op'   — none held                     -> creditable === false
 * and `state` is one of 'pending' | 'resolved' | 'unavailable' | 'superseded'.
 * `creditable` is the ONE field step 3 (perf-learning.evaluate) is allowed to
 * consult: an adjustment whose rendering work cannot be shown to have changed
 * may not be credited with a frame-time improvement, whatever the frames say.
 *
 * A sentinel is CONTRACT §3.1's, exactly: { value: null, state: 'unavailable',
 * reason: <closed enum> }. Never 0, never a plausible default.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PROVISIONAL } from '../src/game/perf-constants.js';
import { FORBIDDEN_SETTING_KEYS } from './fixtures/perf-traces/ladder.js';

const MODULE = '../src/game/effect-verification.js';
const K = PROVISIONAL;

const IMPL = process.env.BIRB_PERF_IMPL
  ? false
  : 'BIRB_PERF_IMPL unset — src/game/effect-verification.js is a Wave 3 deliverable (P3.2)';

async function load() {
  try {
    return await import(MODULE);
  } catch (err) {
    err.message =
      `[red-first] ${MODULE} does not exist yet — Wave 3 P3.2 must create it.\n` +
      `  Its surface is pinned at the top of tests/effect-verification.test.js.\n` +
      `  original (${err.code || 'no code'}): ${err.message}`;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Observation builders. Deliberately verbose: a helper that defaulted missing
// fields to 0 would hide exactly the defect EV-7 exists to catch.
// ---------------------------------------------------------------------------
function observation({ dpr = 1.7, w = 1170, h = 2532, post = true, downscale = K.bloomDownscale,
  passes = 8, sceneCalls = 64, totalCalls = 68, shafts = true, weatherVisible = true,
  weatherDensity = 1, contactShadow = true, ribbons = true, cloudShell = true,
  mistBudget = 1, wind = 1, panelUpdateHz = null } = {}) {
  const sceneW = Math.round(w);
  const sceneH = Math.round(h);
  const blurW = Math.max(1, Math.floor(sceneW / downscale));
  const blurH = Math.max(1, Math.floor(sceneH / downscale));
  return {
    buffers: {
      drawingBufferWidth: sceneW,
      drawingBufferHeight: sceneH,
      rendererPixelRatio: dpr,
      post: post
        ? {
          sceneTarget: { width: sceneW, height: sceneH },
          blurA: { width: blurW, height: blurH },
          blurB: { width: blurW, height: blurH },
          rayTarget: { width: blurW, height: blurH },
          downscale,
        }
        : null,
    },
    activity: { post, shafts, weatherVisible, contactShadow, ribbons, cloudShell },
    work: {
      passes,
      sceneCalls,
      totalCalls,
      sceneTriangles: sceneCalls * 1000,
      totalTriangles: totalCalls * 1000,
    },
    rates: { weatherDensity, mistBudget, wind, panelUpdateHz },
  };
}

/** A world whose read-back is scripted frame by frame. Counts its reads. */
function scriptedWorld(sequence) {
  let i = 0;
  const world = {
    reads: 0,
    current: sequence[0],
    readEffective() {
      world.reads += 1;
      const obs = i < sequence.length ? sequence[i] : sequence[sequence.length - 1];
      world.current = obs;
      return obs;
    },
    advance() { i = Math.min(i + 1, sequence.length - 1); },
  };
  return world;
}

function clockFrom(t0 = 0) {
  const c = { t: t0, now: () => c.t };
  return c;
}

const SETTLE = K.settleHoldMs;

// ---------------------------------------------------------------------------
// EV-0 — the factory shape.
// REJECTS: a module that reaches for a renderer, a DOM node or a wall clock.
//          CONTRACT §11: "a module is unit-testable here ONLY if it imports
//          nothing and takes its side effects as injected callbacks."
// ---------------------------------------------------------------------------
test('EV-0 createEffectVerifier takes its side effects as injected callbacks', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  assert.equal(typeof createEffectVerifier, 'function');

  const world = scriptedWorld([observation()]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });

  for (const method of ['begin', 'verify', 'pending', 'snapshot']) {
    assert.equal(typeof v[method], 'function', `the verifier must expose ${method}()`);
  }

  v.begin({ kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 }, expect: [{ path: 'buffers.rendererPixelRatio', to: 1.0 }], tMs: clock.t });
  assert.ok(world.reads > 0,
    'begin() must READ THE WORLD BACK. A verifier that never calls readEffective() is verifying its own intent.');
});

// ---------------------------------------------------------------------------
// EV-1 — a no-op apply is detected.
// REJECTS: the implementation this whole module exists to prevent — comparing
//          the REQUESTED value against the previous requested value and calling
//          a difference "applied". Here the request changes and the world does
//          not move a pixel.
// ---------------------------------------------------------------------------
test('EV-1 a request that changes nothing in the world is a no-op, not an application', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const before = observation({ dpr: 1.7 });
  const after = observation({ dpr: 1.7 }); // identical read-back: the slider moved, the renderer did not
  const world = scriptedWorld([before, after]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });

  const { id } = v.begin({
    kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 },
    expect: [{ path: 'buffers.rendererPixelRatio', to: 1.0 }, { path: 'buffers.drawingBufferWidth', direction: 'decrease' }],
    tMs: clock.t,
  });
  world.advance();
  clock.t += SETTLE;
  const r = v.verify(id, clock.t);

  assert.equal(r.state, 'resolved');
  assert.equal(r.verdict, 'no-op',
    'requested 1.0, read back 1.7, drawing buffer unchanged — "a slider value changing is not evidence that rendering work changed"');
  assert.equal(r.changed, false);
  assert.equal(r.creditable, false);
  assert.ok(Array.isArray(r.unmet) && r.unmet.length === 2, 'both unmet expectations must be named');
});

// ---------------------------------------------------------------------------
// EV-2 — the positive control.
// REJECTS: an implementation that satisfies EV-1 by returning 'no-op' always.
//          Without this row EV-1 is passable by a constant.
// ---------------------------------------------------------------------------
test('EV-2 a request the world honoured reads back as applied and creditable', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const before = observation({ dpr: 1.7, w: 1170, h: 2532 });
  const after = observation({ dpr: 1.0, w: 688, h: 1489 });
  const world = scriptedWorld([before, after]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });

  const { id } = v.begin({
    kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 },
    expect: [{ path: 'buffers.rendererPixelRatio', to: 1.0 }, { path: 'buffers.drawingBufferWidth', direction: 'decrease' }],
    tMs: clock.t,
  });
  world.advance();
  clock.t += SETTLE;
  const r = v.verify(id, clock.t);

  assert.equal(r.state, 'resolved');
  assert.equal(r.verdict, 'applied');
  assert.equal(r.changed, true);
  assert.equal(r.creditable, true);
  assert.deepEqual(r.unmet, []);
  const dprEvidence = r.evidence.find((e) => e.path === 'buffers.rendererPixelRatio');
  assert.ok(dprEvidence && dprEvidence.before === 1.7 && dprEvidence.after === 1.0,
    'evidence must carry the before/after READ BACK off the world, so a human can see what moved');
});

// ---------------------------------------------------------------------------
// EV-3 — the A6 desync, as a RUNTIME check rather than a harness check.
// REJECTS: "some field changed, therefore applied". The renderer took the new
//          pixel ratio and the bloom targets kept the old size — precisely the
//          shipped defect this programme was commissioned for (CONTRACT §4, A6:
//          applyTier calls setPixelRatio and never touches bloomPass.setSize).
// ---------------------------------------------------------------------------
test('EV-3 a half-applied change is partial and NOT creditable', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const before = observation({ dpr: 1.7, w: 1170, h: 2532 });
  const after = observation({ dpr: 1.0, w: 688, h: 1489 });
  // The renderer resized; the post chain did not. Stale targets, exactly as shipped.
  after.buffers.post = before.buffers.post;
  const world = scriptedWorld([before, after]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });

  const { id } = v.begin({
    kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 },
    expect: [
      { path: 'buffers.rendererPixelRatio', to: 1.0 },
      { path: 'buffers.post.sceneTarget.width', direction: 'decrease' },
      { path: 'buffers.post.blurA.width', direction: 'decrease' },
    ],
    tMs: clock.t,
  });
  world.advance();
  clock.t += SETTLE;
  const r = v.verify(id, clock.t);

  assert.equal(r.verdict, 'partial');
  assert.equal(r.creditable, false,
    'a partially applied change may not be credited with a frame-time improvement: the saving cannot be attributed');
  assert.deepEqual(r.unmet.map((u) => u.path).sort(),
    ['buffers.post.blurA.width', 'buffers.post.sceneTarget.width']);
});

// ---------------------------------------------------------------------------
// EV-4 — the settling period. "Allow the settling period before scoring."
// REJECTS: scoring on the frame of the apply, which reads the PRE-resize world
//          and declares every real change a no-op.
// ---------------------------------------------------------------------------
test('EV-4 verify() before the settle period is pending, and scores only after it', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const before = observation({ dpr: 1.7, w: 1170, h: 2532 });
  const after = observation({ dpr: 1.0, w: 688, h: 1489 });
  const world = scriptedWorld([before, after]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });

  const { id } = v.begin({
    kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 },
    expect: [{ path: 'buffers.rendererPixelRatio', to: 1.0 }],
    tMs: clock.t,
  });

  clock.t += SETTLE - 1;
  const early = v.verify(id, clock.t);
  assert.equal(early.state, 'pending');
  assert.equal(early.verdict, null, 'a pending verification has no verdict — not "no-op", not "applied"');
  assert.equal(early.settled, false);
  assert.equal(early.reason, 'settling');

  world.advance();
  clock.t += 1;
  const late = v.verify(id, clock.t);
  assert.equal(late.state, 'resolved');
  assert.equal(late.settled, true);
  assert.equal(late.verdict, 'applied');
});

// ---------------------------------------------------------------------------
// EV-5 — the settle period comes from CONTRACT §10, not from a literal.
// REJECTS: a hardcoded settle time. Wave 4 retunes PRO-6 in one place
//          (src/game/perf-constants.js) and every deadline must move with it.
// ---------------------------------------------------------------------------
test('EV-5 the default settle period is PRO-6, read from the constants table', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const { withConstants } = await import('../src/game/perf-constants.js');
  const retuned = withConstants({ settleHoldMs: K.settleHoldMs * 2 });

  const before = observation({ dpr: 1.7 });
  const after = observation({ dpr: 1.0 });
  const world = scriptedWorld([before, after]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: retuned });

  const { id } = v.begin({
    kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 },
    expect: [{ path: 'buffers.rendererPixelRatio', to: 1.0 }],
    tMs: clock.t,
  });
  world.advance();
  clock.t += K.settleHoldMs; // the DEFAULT table's hold — must not be enough under the retuned one
  assert.equal(v.verify(id, clock.t).state, 'pending',
    'the hold must follow constants.settleHoldMs, not a number written into the module');
  clock.t += K.settleHoldMs;
  assert.equal(v.verify(id, clock.t).state, 'resolved');
});

// ---------------------------------------------------------------------------
// EV-6 — effect ACTIVITY, not a uniform. Assertion A5 as a runtime check.
// REJECTS: "the density uniform reads 0, therefore the weather stopped costing
//          anything". CONTRACT §4 A5's own flip: "Set the uniform to 0 but
//          leave points.visible === true — must fail (a uniform is not a
//          skipped draw)."
// ---------------------------------------------------------------------------
test('EV-6 a rate that moved while the draw stayed is partial, not applied', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const before = observation({ weatherDensity: 1, weatherVisible: true, sceneCalls: 64, totalCalls: 68 });
  const after = observation({ weatherDensity: 0, weatherVisible: true, sceneCalls: 64, totalCalls: 68 });
  const world = scriptedWorld([before, after]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });

  const { id } = v.begin({
    kind: 'downshift', keys: ['weatherDensity'], requested: { weatherDensity: 0 },
    expect: [
      { path: 'rates.weatherDensity', to: 0 },
      { path: 'activity.weatherVisible', to: false },
      { path: 'work.sceneCalls', direction: 'decrease' },
    ],
    tMs: clock.t,
  });
  world.advance();
  clock.t += SETTLE;
  const r = v.verify(id, clock.t);

  assert.equal(r.verdict, 'partial');
  assert.equal(r.creditable, false);
  assert.deepEqual(r.unmet.map((u) => u.path).sort(), ['activity.weatherVisible', 'work.sceneCalls']);
});

// ---------------------------------------------------------------------------
// EV-7 — unreadable is NOT unchanged.
// REJECTS: treating a missing read-back as evidence of a no-op, which rolls
//          back a change that in fact worked. CONTRACT §3.1's forbidden
//          substitutes include "any value derived from what the code intended".
// ---------------------------------------------------------------------------
test('EV-7 an unreadable observation is a sentinel, never a no-op', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const before = observation({ post: true });
  const after = observation({ post: true });
  after.buffers.post = null; // no post chain to read: no source, not a zero
  const world = scriptedWorld([before, after]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });

  const { id } = v.begin({
    kind: 'downshift', keys: ['post'], requested: { post: 'quarter' },
    expect: [{ path: 'buffers.post.blurA.width', direction: 'decrease' }],
    tMs: clock.t,
  });
  world.advance();
  clock.t += SETTLE;
  const r = v.verify(id, clock.t);

  assert.equal(r.state, 'unavailable');
  assert.notEqual(r.verdict, 'no-op', '"cannot read" and "did not change" are different facts with different consequences');
  assert.equal(r.creditable, false);
  assert.ok(['not-implemented', 'not-applicable', 'stale', 'insufficient-samples'].includes(r.reason),
    `reason must come from the CONTRACT §3.1 closed enum, got ${JSON.stringify(r.reason)}`);

  // ...and the same when the world cannot be read at all.
  const dead = createEffectVerifier({ readEffective: () => null, now: clock.now, constants: K });
  const h = dead.begin({ kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 }, expect: [{ path: 'buffers.rendererPixelRatio', to: 1.0 }], tMs: clock.t });
  const dr = dead.verify(h.id, clock.t + SETTLE);
  assert.equal(dr.state, 'unavailable');
  assert.equal(dr.creditable, false);
});

// ---------------------------------------------------------------------------
// EV-8 — gameplay fidelity is not a quality lever, at any verdict.
// REJECTS: a verifier that will happily certify "we hit the frame budget by
//          halving the collision rate" as a successful optimisation. The plan:
//          "Never reduce collision, input or flight simulation fidelity to
//          conceal a rendering bottleneck." The deny list is imported from the
//          fixture, because an invariant that lives only in the module's own
//          source cannot catch the module.
// ---------------------------------------------------------------------------
test('EV-8 begin() refuses every gameplay-fidelity key', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const world = scriptedWorld([observation(), observation()]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });

  assert.ok(FORBIDDEN_SETTING_KEYS.length > 0);
  for (const key of FORBIDDEN_SETTING_KEYS) {
    assert.throws(
      () => v.begin({ kind: 'downshift', keys: [key], requested: { [key]: 0.5 }, expect: [{ path: 'work.sceneCalls', direction: 'decrease' }], tMs: clock.t }),
      RangeError,
      `begin() must refuse the gameplay-fidelity key "${key}" rather than verify a change to it`,
    );
  }
});

// ---------------------------------------------------------------------------
// EV-9 — the before snapshot must be a COPY.
// REJECTS: holding a reference to the object the world hands back. Three.js
//          hands out live objects that it mutates in place — `renderer.info`
//          is reset on every render() call and this repo has already shipped
//          one bug from exactly that (the AR page reporting 3 draw calls for a
//          23-call frame). A verifier holding the reference sees `before`
//          become `after` and reports every change as a no-op.
// ---------------------------------------------------------------------------
test('EV-9 the before-observation is snapshotted, not aliased to the live object', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const live = observation({ dpr: 1.7, w: 1170, h: 2532 });
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: () => live, now: clock.now, constants: K });

  const { id } = v.begin({
    kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 },
    expect: [{ path: 'buffers.rendererPixelRatio', to: 1.0 }, { path: 'buffers.drawingBufferWidth', direction: 'decrease' }],
    tMs: clock.t,
  });

  // The renderer mutates the very object it handed out, in place.
  live.buffers.rendererPixelRatio = 1.0;
  live.buffers.drawingBufferWidth = 688;
  live.buffers.drawingBufferHeight = 1489;

  clock.t += SETTLE;
  const r = v.verify(id, clock.t);
  assert.equal(r.verdict, 'applied',
    'the change is real; a verifier aliasing the live object would report no-op because before === after');
});

// ---------------------------------------------------------------------------
// EV-10 — a superseded verification cannot be scored.
// REJECTS: scoring an old adjustment against a world that a newer adjustment
//          has already changed, which credits the wrong action and poisons the
//          action history for the rest of the session.
// ---------------------------------------------------------------------------
test('EV-10 an outstanding verification superseded by a newer one is not scored', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const a = observation({ dpr: 1.7 });
  const b = observation({ dpr: 1.0 });
  const c = observation({ dpr: 0.85 });
  const world = scriptedWorld([a, b, c]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });

  const first = v.begin({ kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 }, expect: [{ path: 'buffers.rendererPixelRatio', to: 1.0 }], tMs: clock.t });
  world.advance();
  clock.t += 1;
  const second = v.begin({ kind: 'downshift', keys: ['dpr'], requested: { dpr: 0.85 }, expect: [{ path: 'buffers.rendererPixelRatio', to: 0.85 }], tMs: clock.t });
  assert.equal(v.pending(), second.id, 'the newest adjustment is the outstanding one');

  world.advance();
  clock.t += SETTLE;
  const stale = v.verify(first.id, clock.t);
  assert.equal(stale.state, 'superseded');
  assert.equal(stale.creditable, false);
  assert.equal(stale.verdict, null);

  const fresh = v.verify(second.id, clock.t);
  assert.equal(fresh.state, 'resolved');
  assert.equal(fresh.verdict, 'applied');
});

// ---------------------------------------------------------------------------
// EV-11 — a resolved verdict is frozen.
// REJECTS: a verdict recomputed from the CURRENT world every time it is asked
//          for, so an accepted change silently becomes a no-op the moment the
//          scene moves — and the action history rewrites its own past.
// ---------------------------------------------------------------------------
test('EV-11 a resolved verdict does not drift with later frames', { skip: IMPL }, async () => {
  const { createEffectVerifier } = await load();
  const before = observation({ dpr: 1.7, w: 1170, h: 2532 });
  const after = observation({ dpr: 1.0, w: 688, h: 1489 });
  const later = observation({ dpr: 1.7, w: 1170, h: 2532 }); // a resize put it back
  const world = scriptedWorld([before, after, later]);
  const clock = clockFrom();
  const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });

  const { id } = v.begin({ kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 }, expect: [{ path: 'buffers.rendererPixelRatio', to: 1.0 }], tMs: clock.t });
  world.advance();
  clock.t += SETTLE;
  const first = v.verify(id, clock.t);
  assert.equal(first.verdict, 'applied');

  world.advance();
  const readsAfterResolution = world.reads;
  clock.t += SETTLE;
  const again = v.verify(id, clock.t);

  assert.equal(again.verdict, 'applied', 'the verdict is a record of what happened, not a live query');
  assert.equal(again.state, 'resolved');
  assert.equal(world.reads, readsAfterResolution,
    're-reading a resolved verification must not touch the world again');
});

// ---------------------------------------------------------------------------
// EV-12 — the module reads the world through readEffective() and nowhere else.
// REJECTS: a module that reaches for document/window/navigator/localStorage.
//          CONTRACT §11 makes injected side effects the condition of this
//          module being testable at all; node_modules/three is a 414-line stub
//          and CI runs npm test with no install.
// ---------------------------------------------------------------------------
test('EV-12 no global is touched — every fact comes from the injected reader', { skip: IMPL }, async () => {
  const hits = [];
  const saved = [];
  for (const name of ['document', 'window', 'localStorage', 'sessionStorage', 'indexedDB']) {
    const desc = Object.getOwnPropertyDescriptor(globalThis, name);
    if (desc && desc.configurable === false) continue;
    saved.push([name, desc]);
    Object.defineProperty(globalThis, name, { configurable: true, get() { hits.push(name); return undefined; } });
  }
  try {
    const { createEffectVerifier } = await load();
    const world = scriptedWorld([observation({ dpr: 1.7 }), observation({ dpr: 1.0 })]);
    const clock = clockFrom();
    const v = createEffectVerifier({ readEffective: world.readEffective, now: clock.now, constants: K });
    const { id } = v.begin({ kind: 'downshift', keys: ['dpr'], requested: { dpr: 1.0 }, expect: [{ path: 'buffers.rendererPixelRatio', to: 1.0 }], tMs: clock.t });
    world.advance();
    clock.t += SETTLE;
    v.verify(id, clock.t);
    v.pending();
    v.snapshot();
    assert.deepEqual(hits, [], `effect-verification touched globals: ${hits.join(', ')}`);
  } finally {
    for (const [name, desc] of saved) {
      if (desc) Object.defineProperty(globalThis, name, desc);
      else delete globalThis[name];
    }
  }
});
