/**
 * tests/adaptive-quality.test.js — RED-FIRST unit spec for the policy machine.
 *
 * Wave 3 / task **P3.2a** of docs/ULTRACODE_PERFORMANCE_PLAN.md §4.
 * Module under test: `src/game/adaptive-quality.js`. **It does not exist yet.**
 * P3.3 builds it, against this file and against
 * tests/adaptive-quality-traces.test.js. Both are oracles; neither is a draft.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SUITE IS *FOR*, GIVEN THE TRACE SUITE ALREADY EXISTS
 * ---------------------------------------------------------------------------
 * tests/adaptive-quality-traces.test.js grades the controller on sixteen
 * capacity scenarios: does it respond, recover, roll back, and not oscillate.
 * It cannot see the things this file exists to pin, because a trace only ever
 * observes a RUNG INDEX moving:
 *
 *   - a trace cannot tell a ladder whose rungs each drop ONE cost from a ladder
 *     whose first rung drops DPR and bloom and the cloud shell together. Both
 *     are "rung 0 -> rung 1". The plan's very first finding is that the second
 *     one is not a measured saving;
 *   - a trace cannot tell a threshold that was IMPORTED from one that was typed
 *     into the controller, because both produce the same numbers today;
 *   - a trace cannot see that a rung named `inputRate` was never offered,
 *     because the corpus's own ladders do not contain one;
 *   - a trace cannot see which profile the shipped page would SELECT, and
 *     CONTRACT §11 makes that the whole no-device ship path.
 *
 * So: the trace suite asks "does it behave"; this file asks "is it the thing
 * the contract commissioned". Where the two overlap (the compatibility
 * profile), this file drives the controller through a hand-built adversarial
 * input rather than a corpus scenario, on purpose — a controller tuned until
 * the sixteen committed scenarios go green has learned the sixteen.
 *
 * ---------------------------------------------------------------------------
 * R4 — red-first form. THIS IS THE RULE THAT BREAKS FOUR SIBLING PROJECTS.
 * ---------------------------------------------------------------------------
 * Every test dynamic-imports INSIDE its body and is gated `{ skip: !IMPL }`.
 * A top-level static import of a module that does not exist resolves BEFORE
 * any skip is evaluated and turns tests.yml red for humanoid/, gauntlet/,
 * sculpture/ and icon3d/ as well as this project.
 *
 *   node --test tests/adaptive-quality.test.js                  # every test SKIPS
 *   BIRB_PERF_IMPL=1 node --test tests/adaptive-quality.test.js # RED until P3.3
 *
 * ---------------------------------------------------------------------------
 * THE SURFACE THIS SUITE PINS. P3.3 TRANSCRIBES IT; IT DOES NOT REDESIGN IT.
 * ---------------------------------------------------------------------------
 * Named exports of src/game/adaptive-quality.js:
 *
 *   createAdaptiveQuality({ now, apply, ladder, depth, targetFPS, budgetMs,
 *                           startProfile, constants, instrumentation, profile })
 *     -> { frame(f), reset(tag, tMs), setMode(mode, tMs), setPaused(...),
 *          snapshot(), history() }
 *     snapshot() -> { mode, phase, timers: { overloadWindowMs, recoveryWindowMs },
 *                     atFloor, lastAdjustment, cooldownMs, ... }
 *                   lastAdjustment/cooldownMs/mode are TEL-13/14/15 and are
 *                   pinned by tests/adaptive-quality-traces.test.js AQ-17;
 *                   phase, timers and atFloor are pinned here.
 *     CONTRACT §11 fixes this shape and the reason is load-bearing:
 *     "a module is unit-testable here ONLY if it imports nothing and takes its
 *     side effects as injected callbacks ... So `src/game/adaptive-quality.js`
 *     MUST be `createAdaptiveQuality({ apply, now, ... })`."
 *
 *   PROVISIONAL          re-exported from ./perf-constants.js, IDENTITY-equal
 *                        (CONTRACT §10 rule 2: ONE named constant object).
 *   REDUCTION_LADDER     the shipped ranked reduction ladder for the new
 *                        policy. Ordered, index 0 = highest quality.
 *                        Each rung: { id, label, costSide, settings }.
 *   PROTECTED_FIDELITY_KEYS  the quantities the controller may never write.
 *   PHASES               the closed set of state-machine phases.
 *   PROFILES             { compat: {...}, auto: {...} } — the two policies.
 *   DEFAULT_PROFILE      which one a page gets when nobody asks. CONTRACT §11
 *                        says the NEW policy is "reachable only from the panel
 *                        and a URL flag", so this is 'compat'.
 *   PROFILE_URL_FLAG     the query-string key that reaches the new policy.
 *                        MUST NOT be 'debug' (CONTRACT §6: every harness in
 *                        this repo loads the page with ?debug=1, so a flag
 *                        called 'debug' would silently switch the policy under
 *                        every automated run and under no phone).
 *   selectProfile({ search, panelRequest }) -> 'compat' | 'auto'   (pure)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HAS ITS OWN BENCH INSTEAD OF USING THE CORPUS DRIVER
 * ---------------------------------------------------------------------------
 * tests/fixtures/perf-traces/driver.js is the right tool for a capacity
 * scenario and the wrong tool here. It validates a scenario, seeds jitter,
 * quantises presentation and collects contract violations — all of which are
 * exactly what the trace suite wants, and all of which stand between an
 * assertion and the single question it is asking ("how many milliseconds until
 * the first downshift?"). The bench below is forty lines, free-running (no
 * vsync quantum), and deterministic to the millisecond. It imports
 * FORBIDDEN_SETTING_KEYS from the frozen fixture rather than restating it,
 * because a gameplay-fidelity list that lives in two files is a list that will
 * disagree with itself.
 *
 * No THREE, no DOM. Runs under plain `node --test` against the tracked
 * four-class three stub, with no install step.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PROVISIONAL, withConstants, budgetMs as budgetFor } from '../src/game/perf-constants.js';
import { RESET_TAGS } from '../src/game/frame-metrics.js';
import { FORBIDDEN_SETTING_KEYS, compatLadder } from './fixtures/perf-traces/ladder.js';
import { createCompatPolicy } from './fixtures/perf-traces/reference-policies.js';

const MODULE = '../src/game/adaptive-quality.js';
const MODULE_URL = new URL('../src/game/adaptive-quality.js', import.meta.url);
const INDEX_HTML = fileURLToPath(new URL('../index.html', import.meta.url));

const IMPL = process.env.BIRB_PERF_IMPL
  ? false
  : 'BIRB_PERF_IMPL unset — src/game/adaptive-quality.js is a Wave 3 deliverable (P3.3)';

const K = PROVISIONAL;
const TARGET_FPS = 60;
const BUDGET_MS = budgetFor(TARGET_FPS);

/** PRO-1/2/3, as arithmetic. Never written down as a number. */
const OVERLOAD_DEADLINE_MS = K.evaluationWindowMs * K.overloadWindowCount;

/** Dynamic import with a legible red that names the wave that owes the file. */
async function load() {
  try {
    return await import(MODULE);
  } catch (err) {
    err.message =
      `[red-first] ${MODULE} does not exist yet — Wave 3 P3.3 must create it.\n` +
      `  This suite is one of its two oracles; the other is tests/adaptive-quality-traces.test.js.\n` +
      `  The surface it must expose is listed at the top of this file.\n` +
      `  original (${err.code || 'no code'}): ${err.message}`;
    throw err;
  }
}

/** Read the controller's own source. ENOENT here is "module absent", not an import error. */
function readModuleSource() {
  try {
    return readFileSync(MODULE_URL, 'utf8');
  } catch (err) {
    err.message =
      `[red-first] cannot read ${MODULE} as text — Wave 3 P3.3 must create it. ` +
      `original: ${err.message}`;
    throw err;
  }
}

/** Strip comments so a source scan cannot be satisfied — or defeated — by prose. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/* ========================================================================== *
 * THE BENCH
 *
 * A minimal world: it owns the rung, records every apply(), and hands the
 * controller frames. Free presentation (dtMs === cost) unless a fixed interval
 * is asked for, so "time to first downshift" means exactly what it says.
 * ========================================================================== */

const MAX_FRAMES = 200000;   // a stuck controller must fail, not hang the runner

function makeBench({
  ladder,
  startRung = 0,
  targetFPS = TARGET_FPS,
  constants = K,
  instrumentation = 'off',
} = {}) {
  const depth = ladder.length;
  const budget = budgetFor(targetFPS);
  let t = 0;
  let frameIndex = 0;
  let rung = Math.min(depth - 1, Math.max(0, startRung));
  let mode = 'auto';

  const applies = [];
  const changes = [];

  function apply(request) {
    const req = request || {};
    const target = Number.isInteger(req.rung)
      ? Math.min(depth - 1, Math.max(0, req.rung))
      : null;
    const record = {
      tMs: t,
      frameIndex,
      kind: req.kind,
      source: req.source ?? null,
      reason: req.reason ?? null,
      settings: req.settings ?? null,
      requestedRung: req.rung,
      effectiveRung: rung,
      clamped: target !== null && target !== req.rung,
      rejected: target === null,
    };
    if (target !== null) {
      const from = rung;
      rung = target;
      record.effectiveRung = rung;
      if (from !== rung) changes.push({ tMs: t, from, to: rung, kind: req.kind, reason: record.reason });
    }
    applies.push(record);
    return {
      effectiveRung: rung,
      clamped: record.clamped,
      rejected: record.rejected,
      reason: record.rejected ? 'non-integer-rung' : null,
    };
  }

  const ctx = {
    ladder,
    depth,
    targetFPS,
    budgetMs: budget,
    constants,
    startProfile: { rung: startRung, outOfRange: startRung !== Math.min(depth - 1, Math.max(0, startRung)) },
    instrumentation,
    apply,
    now: () => t,
  };

  const bench = {
    ctx,
    applies,
    changes,
    depth,
    budgetMs: budget,
    get tMs() { return t; },
    get rung() { return rung; },
    setMode(next, policy) {
      mode = next;
      if (policy && typeof policy.setMode === 'function') policy.setMode(next, t);
    },

    /**
     * Run frames whose cost is a function of the rung the controller is
     * standing on — the capacity model, in miniature. This is the only honest
     * way to ask "did the reduction help", because the answer has to depend on
     * the decision.
     */
    feedCapacity(policy, {
      costFor,
      durationMs,
      cpuShare = 0.45,
      gpu = 'ok',
      valid = true,
      invalidReason = null,
      tag = null,
    }) {
      const until = t + durationMs;
      let firstTag = tag;
      while (t < until) {
        if (frameIndex > MAX_FRAMES) throw new Error('bench: frame cap reached');
        const cost = Math.max(0.05, costFor(rung, t));
        const cpuMs = cost * cpuShare;
        policy.frame({
          tMs: t,
          dtMs: cost,
          valid,
          invalidReason,
          tag: firstTag,
          cpuMs,
          updateMs: cpuMs * 0.6,
          submitMs: cpuMs * 0.4,
          gpu: gpu === 'ok'
            ? { value: Math.max(0, cost - cpuMs), state: 'ok', reason: null }
            : { value: null, state: 'unavailable', reason: gpu },
          mode,
          rung,                       // read BACK off the world, never echoed
          budgetMs: budget,
          targetFPS,
          frameIndex,
        });
        firstTag = null;
        t += cost;
        frameIndex += 1;
      }
      return bench;
    },

    /** Frames delivered at a fixed rate. Used where the INPUT is a frame rate. */
    feedFps(policy, { fps, durationMs, valid = true, invalidReason = null, cpuShare = 0.45 }) {
      const dt = 1000 / fps;
      return bench.feedCapacity(policy, {
        costFor: () => dt, durationMs, cpuShare, valid, invalidReason,
      });
    },

    /** Paused frames: long, retained, and invalid for decisions (CONTRACT §2.2). */
    feedPaused(policy, { durationMs, reason = 'hidden', pausedFrameMs = 900 }) {
      return bench.feedCapacity(policy, {
        costFor: () => pausedFrameMs, durationMs, valid: false, invalidReason: reason,
      });
    },

    /** Adaptive applies only — the ones the policy layer owns. */
    adaptiveApplies() {
      const ADAPTIVE = ['downshift', 'emergency', 'upshift', 'probe', 'probe-keep', 'probe-rollback', 'revoke'];
      return applies.filter((a) => ADAPTIVE.includes(a.kind) && !a.rejected);
    },

    /** Time of the first reduction, or null. */
    firstReductionMs() {
      const hit = changes.find((c) => c.to > c.from);
      return hit ? hit.tMs : null;
    },
  };
  return bench;
}

/** Build a controller against a bench, with the injected-callback contract. */
function boot(createAdaptiveQuality, bench, { profile = 'auto' } = {}) {
  const ctrl = createAdaptiveQuality({ ...bench.ctx, profile });
  assert.ok(ctrl && typeof ctrl.frame === 'function',
    'createAdaptiveQuality must return an object with frame(frame)');
  return ctrl;
}

/** A five-rung capacity ladder for the descent tests: each rung is cheaper. */
function descendingCost(costs) {
  return (rung) => costs[Math.min(costs.length - 1, rung)];
}

/** Rung settings deltas, as a list of changed keys. */
function changedKeys(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].filter((k) => (a || {})[k] !== (b || {})[k]);
}

/* ========================================================================== *
 * SECTION 1 — SHAPE AND INJECTION (CONTRACT §11)
 * ========================================================================== */

test('AQP-1 the controller imports nothing that renders and reaches no global', { skip: IMPL }, async () => {
  const src = stripComments(readModuleSource());

  const forbidden = [
    [/from\s+['"]three['"]/, "imports 'three' — node_modules/three is a 414-line stub of four classes and CI runs npm test with no install"],
    [/\brequire\s*\(/, 'uses require() — this repo is ES modules with no build step'],
    [/\bdocument\s*\./, 'touches document — the controller takes its side effects as injected callbacks'],
    [/\bwindow\s*\./, 'touches window — see CONTRACT §11'],
    [/\bnavigator\s*\./, "touches navigator — `(navigator.hardwareConcurrency || 4) <= 4` is this repo's most expensive documented mistake"],
    [/\bperformance\s*\.\s*now\b/, 'reads performance.now() — the clock is injected as now(), or a fake clock cannot drive it'],
    [/\blocalStorage\b/, 'touches localStorage — CONTRACT §9 DEF-1 DEFERS the persisted learning store; the in-session history is all Wave 3 ships'],
    [/\brenderer\s*\./, 'touches a renderer — every quality change goes through the injected apply()'],
  ];
  for (const [re, why] of forbidden) {
    assert.equal(re.test(src), false, `src/game/adaptive-quality.js ${why}`);
  }

  const { createAdaptiveQuality } = await load();
  assert.equal(typeof createAdaptiveQuality, 'function');
});

test('AQP-2 apply and now are MANDATORY injections, not optional with a fallback', { skip: IMPL }, async () => {
  const { createAdaptiveQuality } = await load();
  const ladder = compatLadder(K);
  const base = {
    ladder, depth: ladder.length, targetFPS: TARGET_FPS, budgetMs: BUDGET_MS,
    constants: K, startProfile: { rung: 0, outOfRange: false }, instrumentation: 'off',
    apply: () => ({ effectiveRung: 0, clamped: false, rejected: false, reason: null }),
    now: () => 0,
  };
  assert.throws(() => createAdaptiveQuality({ ...base, apply: undefined }), /apply/i,
    'a controller that can be built without apply() has somewhere else to write to, and that place is a renderer');
  assert.throws(() => createAdaptiveQuality({ ...base, now: undefined }), /now/i,
    'a controller that can be built without now() reads a wall clock, and a fake clock cannot then drive it');
});

test('AQP-3 the state machine names its phases, and an adjustment enters the settle phase', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, PHASES } = mod;

  assert.ok(Array.isArray(PHASES), 'PHASES must be an exported closed set — the plan\'s machine is observe -> reduce one cost -> settle -> evaluate -> hold or revert, and a machine whose states are implicit cannot be inspected');
  for (const required of ['observe', 'settle', 'evaluate']) {
    assert.ok(PHASES.includes(required), `PHASES is missing "${required}"`);
  }

  const ladder = mod.REDUCTION_LADDER;
  const bench = makeBench({ ladder });
  const ctrl = boot(createAdaptiveQuality, bench);
  const costs = ladder.map((_, i) => 30 - i);     // every reduction helps
  bench.feedCapacity(ctrl, { costFor: descendingCost(costs), durationMs: OVERLOAD_DEADLINE_MS * 3 });

  const snap = ctrl.snapshot();
  assert.ok(snap && PHASES.includes(snap.phase), `snapshot().phase must be one of PHASES, got ${JSON.stringify(snap && snap.phase)}`);
  assert.ok(bench.changes.length > 0, 'sustained overload produced no adjustment at all');

  // Immediately after an adjustment the machine is settling, not observing:
  // "Hold for 2-3 seconds after ordinary adjustments" (PRO-6) is a PHASE, not
  // a subtraction hidden inside the next decision.
  const bench2 = makeBench({ ladder });
  const ctrl2 = boot(createAdaptiveQuality, bench2);
  let phaseAtAdjustment = null;
  const costFor = descendingCost(costs);
  bench2.feedCapacity(ctrl2, {
    costFor: (rung, t) => {
      if (phaseAtAdjustment === null && bench2.changes.length > 0) {
        phaseAtAdjustment = ctrl2.snapshot().phase;
      }
      return costFor(rung, t);
    },
    durationMs: OVERLOAD_DEADLINE_MS * 3,
  });
  assert.equal(phaseAtAdjustment, 'settle',
    'the frame after an adjustment must be in the settle phase — "settle" is step 3 of the plan\'s own five-verb machine');
});

/* ========================================================================== *
 * SECTION 2 — THE RANKED REDUCTION LADDER
 *
 * The plan's first finding, verbatim: tier 0->1 "changes DPR 1.7->1.0,
 * switches bloom off and reduces other effects together. That removes about
 * 65% of scene pixels on a device reaching the cap; it is not a measured 65%
 * frame-time saving. Separate the controls."
 * ========================================================================== */

test('AQP-4 REDUCTION_LADDER reduces exactly ONE cost per rung — never a bundle', { skip: IMPL }, async () => {
  const { REDUCTION_LADDER } = await load();
  assert.ok(Array.isArray(REDUCTION_LADDER) && REDUCTION_LADDER.length >= 4,
    'REDUCTION_LADDER must be an ordered array of at least four rungs; three bundled tiers is the thing being replaced');

  for (let i = 1; i < REDUCTION_LADDER.length; i += 1) {
    const prev = REDUCTION_LADDER[i - 1];
    const cur = REDUCTION_LADDER[i];
    const diff = changedKeys(prev.settings, cur.settings);
    assert.equal(diff.length, 1,
      `rung ${i} ("${cur.id}") changes ${diff.length} settings at once (${diff.join(', ')}). ` +
      'One rung reduces one cost. A rung that moves three levers cannot have its benefit attributed to any of them, ' +
      'which is precisely why today\'s tier 0->1 saving has never been measured. ' +
      'NOTE for P3.3: tests/fixtures/perf-traces/ladder.js SEPARATED_LADDER is a CORPUS ladder and is not one-lever-per-rung; ' +
      're-exporting it as REDUCTION_LADDER does not satisfy this.');
  }
});

test('AQP-5 shaft, weather/mist and post reductions all come BEFORE any scene-DPR reduction', { skip: IMPL }, async () => {
  const { REDUCTION_LADDER } = await load();
  const top = REDUCTION_LADDER[0].settings;

  const firstIndexWhere = (pred) => {
    for (let i = 1; i < REDUCTION_LADDER.length; i += 1) {
      if (pred(REDUCTION_LADDER[i].settings, top)) return i;
    }
    return -1;
  };

  const firstDpr = firstIndexWhere((s, t0) => Number(s.dpr) < Number(t0.dpr));
  assert.ok(firstDpr > 0, 'the ladder never reduces scene DPR — it is the plan\'s last resort, not its absent one');

  const POST_ORDER = { full: 3, half: 2, quarter: 1, off: 0 };
  const cheaper = {
    shafts: (s, t0) => t0.shafts === true && s.shafts === false,
    post: (s, t0) => POST_ORDER[s.post] < POST_ORDER[t0.post],
    weatherDensity: (s, t0) => Number(s.weatherDensity) < Number(t0.weatherDensity),
    mistBudget: (s, t0) => Number(s.mistBudget) < Number(t0.mistBudget),
  };

  for (const [key, pred] of Object.entries(cheaper)) {
    const at = firstIndexWhere(pred);
    assert.ok(at > 0, `the ladder never reduces ${key}; the plan names it explicitly before DPR`);
    assert.ok(at < firstDpr,
      `${key} is first reduced at rung ${at}, after the first DPR reduction at rung ${firstDpr}. ` +
      'Plan step 5, verbatim: "Prefer low visual loss: reduce shaft work, distant mist/weather coverage and post ' +
      'resolution; THEN reduce scene DPR in 0.05-0.10 steps."');
  }
});

test('AQP-6 the ladder carries a CPU-side rung, and it is a decorative one', { skip: IMPL }, async () => {
  const { REDUCTION_LADDER, PROTECTED_FIDELITY_KEYS } = await load();

  for (const rung of REDUCTION_LADDER) {
    assert.ok(rung.costSide === 'cpu' || rung.costSide === 'gpu',
      `rung "${rung.id}" must declare costSide 'cpu' or 'gpu' — plan step 4 branches on exactly this: ` +
      '"if pixel reduction helps, target pixel/effect cost; if CPU work dominates and DPR changes do little, ' +
      'target decorative update rates, allocations or submission overhead"');
  }

  const cpuRungs = REDUCTION_LADDER.filter((r) => r.costSide === 'cpu');
  assert.ok(cpuRungs.length >= 1,
    'every rung is GPU-side. A controller whose only lever is pixels cannot answer the CPU-dominated half of ' +
    'plan step 4, and on a device where DPR changes do little it will shed image quality forever and never help.');

  for (let i = 1; i < REDUCTION_LADDER.length; i += 1) {
    if (REDUCTION_LADDER[i].costSide !== 'cpu') continue;
    const [key] = changedKeys(REDUCTION_LADDER[i - 1].settings, REDUCTION_LADDER[i].settings);
    assert.ok(/rate|hz|interval|stagger|budget|alloc|submit|update|detail/i.test(key),
      `CPU rung "${REDUCTION_LADDER[i].id}" changes "${key}", which does not read as a decorative update-rate, ` +
      'allocation or submission lever');
    assert.equal(PROTECTED_FIDELITY_KEYS.includes(key), false,
      `CPU rung "${REDUCTION_LADDER[i].id}" reduces "${key}", which is protected gameplay fidelity`);
  }
});

test('AQP-7 the ladder is monotone — no rung is more expensive than the one above it', { skip: IMPL }, async () => {
  const { REDUCTION_LADDER } = await load();
  const POST_ORDER = { full: 3, half: 2, quarter: 1, off: 0 };
  for (let i = 1; i < REDUCTION_LADDER.length; i += 1) {
    const a = REDUCTION_LADDER[i - 1].settings;
    const b = REDUCTION_LADDER[i].settings;
    for (const key of Object.keys(a)) {
      const av = a[key];
      const bv = b[key];
      if (typeof av === 'number') {
        assert.ok(bv <= av + 1e-9, `rung ${i} raises ${key} from ${av} to ${bv}`);
      } else if (typeof av === 'boolean') {
        assert.ok(!(av === false && bv === true), `rung ${i} switches ${key} back on`);
      } else if (key === 'post') {
        assert.ok(POST_ORDER[bv] <= POST_ORDER[av], `rung ${i} raises post from ${av} to ${bv}`);
      }
    }
  }
});

/* ========================================================================== *
 * SECTION 3 — GAMEPLAY FIDELITY IS NOT A QUALITY LEVER
 *
 * Plan step 4, verbatim: "Never reduce collision, input or flight simulation
 * fidelity to conceal a rendering bottleneck." CONTRACT §7.2 repeats it.
 * ========================================================================== */

test('AQP-8 PROTECTED_FIDELITY_KEYS covers the corpus list, and no rung of any profile names one', { skip: IMPL }, async () => {
  const { PROTECTED_FIDELITY_KEYS, REDUCTION_LADDER, PROFILES } = await load();

  assert.ok(Array.isArray(PROTECTED_FIDELITY_KEYS));
  for (const key of FORBIDDEN_SETTING_KEYS) {
    assert.ok(PROTECTED_FIDELITY_KEYS.includes(key),
      `PROTECTED_FIDELITY_KEYS is missing "${key}", which tests/fixtures/perf-traces/ladder.js already forbids. ` +
      'A protection list that lives in two files and disagrees with itself protects nothing.');
  }

  const ladders = [REDUCTION_LADDER, ...Object.values(PROFILES).map((p) => p.ladder).filter(Array.isArray)];
  for (const ladder of ladders) {
    for (const rung of ladder) {
      for (const key of Object.keys(rung.settings || {})) {
        assert.equal(PROTECTED_FIDELITY_KEYS.includes(key), false,
          `rung "${rung.id}" offers "${key}" as a quality lever`);
      }
    }
  }
});

test('AQP-9 catastrophic overload reaches the ladder floor and stops — it never degrades gameplay', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, PROTECTED_FIDELITY_KEYS, REDUCTION_LADDER } = mod;
  const bench = makeBench({ ladder: REDUCTION_LADDER });
  const ctrl = boot(createAdaptiveQuality, bench);

  // Every reduction helps a little and none of them is enough: the device
  // cannot render this scene at any setting on the ladder. Descending is the
  // right thing to do and it still will not be sufficient. The one thing the
  // controller may not do is go looking for a lever OUTSIDE the ladder.
  //
  // (The costs fall with the rung on purpose. A capacity model where nothing
  // helps at all is a different scenario with a different correct answer, and
  // it is AQP-19's.)
  const hopeless = (rung) => BUDGET_MS * (4 - 0.2 * rung);   // the FLOOR is still over budget
  bench.feedCapacity(ctrl, { costFor: hopeless, durationMs: 120000 });

  for (const a of bench.applies) {
    for (const key of Object.keys(a.settings || {})) {
      assert.equal(PROTECTED_FIDELITY_KEYS.includes(key), false,
        `apply({kind:'${a.kind}'}) named "${key}". A controller that hits its frame budget by degrading input has failed.`);
    }
  }
  assert.ok(bench.rung <= bench.depth - 1);
  const snap = ctrl.snapshot();
  assert.equal(snap.atFloor, true,
    'after exhausting the ladder against an impossible frame cost the controller must REPORT that it is at the floor. ' +
    '"Report sustained slowdown, not a claimed temperature measurement" — and a controller that cannot say ' +
    '"this is as low as I go" is one that will keep looking for something else to turn off.');
});

/* ========================================================================== *
 * SECTION 4 — THE THRESHOLDS ARE IMPORTED (CONTRACT §10 rule 2)
 * ========================================================================== */

test('AQP-10 PROVISIONAL is re-exported by identity — there is exactly ONE constants object', { skip: IMPL }, async () => {
  const mod = await load();
  assert.equal(mod.PROVISIONAL, PROVISIONAL,
    'src/game/adaptive-quality.js must re-export the SAME frozen object as src/game/perf-constants.js, not a copy. ' +
    'CONTRACT §10 rule 2: "every provisional value is read from ONE named constant object ... so a Wave 4 device ' +
    'pass changes numbers in one place and nothing else moves."');
});

test('AQP-11 retuning the constants retunes the controller — the thresholds are not inlined', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;
  const costs = REDUCTION_LADDER.map((_, i) => BUDGET_MS * 2 - i);

  const runWith = (constants) => {
    const bench = makeBench({ ladder: REDUCTION_LADDER, constants });
    const ctrl = boot(createAdaptiveQuality, bench);
    bench.feedCapacity(ctrl, { costFor: descendingCost(costs), durationMs: 30000 });
    return bench.firstReductionMs();
  };

  const slow = runWith(K);
  const fast = runWith(withConstants({ evaluationWindowMs: K.evaluationWindowMs / 4 }));

  assert.ok(slow !== null, 'no reduction at all under sustained overload with the shipped constants');
  assert.ok(fast !== null, 'no reduction at all with a quartered evaluation window');
  assert.ok(fast < slow * 0.6,
    `quartering PROVISIONAL.evaluationWindowMs moved the first reduction from ${Math.round(slow)} ms to ` +
    `${Math.round(fast)} ms — barely at all. The window is inlined, and Wave 4 will change a number in ` +
    'perf-constants.js and watch nothing happen.');
});

test('AQP-12 the five shipped-unvalidated 55/58 literals appear nowhere in the controller source', { skip: IMPL }, async () => {
  const src = stripComments(readModuleSource());
  const literals = {
    55: 'compatLowFpsThreshold',
    58: 'compatRestoreFpsThreshold',
    2000: 'compatLowWindowMs',
    4000: 'compatHighWindowMs',
    1500: 'compatMinIntervalMs',
    18.5: 'acceptanceP95MaxMs (PRO-10, and its home is frame-stats.js)',
    30000: 'probeIntervalMs',
  };
  for (const [literal, name] of Object.entries(literals)) {
    const re = new RegExp(`(?<![\\w.])${String(literal).replace('.', '\\.')}(?![\\w.])`);
    assert.equal(re.test(src), false,
      `the literal ${literal} appears in src/game/adaptive-quality.js; it belongs to PROVISIONAL.${name}. ` +
      'CLAUDE.md records that the 55/58 family was tuned against a sampler that could not run; the one thing ' +
      'that makes that recoverable is that the numbers live in one table.');
  }
});

/* ========================================================================== *
 * SECTION 5 — SEPARATE OVERLOAD AND RECOVERY TIMERS (GAP-2)
 *
 * CONTRACT §1.3: "The averaging window is selected by the current tier
 * (state.tier >= 1 ? HIGH_WINDOW_MS : LOW_WINDOW_MS), so at tier 1 a FURTHER
 * DOWNSHIFT waits the 4 s recovery window. This is GAP-2."
 * ========================================================================== */

test('AQP-13 snapshot().timers exposes two DISTINCT windows, both derived from PROVISIONAL', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;
  const bench = makeBench({ ladder: REDUCTION_LADDER });
  const ctrl = boot(createAdaptiveQuality, bench);
  bench.feedCapacity(ctrl, { costFor: () => BUDGET_MS * 0.5, durationMs: 2000 });

  const timers = ctrl.snapshot().timers;
  assert.ok(timers && typeof timers === 'object', 'snapshot().timers must exist');
  assert.equal(timers.overloadWindowMs, OVERLOAD_DEADLINE_MS,
    'the overload window is PRO-3 x PRO-2 (evaluationWindowMs x overloadWindowCount), as arithmetic');
  assert.ok(timers.recoveryWindowMs >= K.restoreStabilityMinMs && timers.recoveryWindowMs <= K.restoreStabilityMaxMs,
    `the recovery window must sit inside PRO-4's stated range [${K.restoreStabilityMinMs}, ${K.restoreStabilityMaxMs}] ms, got ${timers.recoveryWindowMs}`);
  assert.notEqual(timers.overloadWindowMs, timers.recoveryWindowMs,
    'one window used for both directions IS the shipped defect');
  assert.ok(timers.overloadWindowMs < timers.recoveryWindowMs,
    'a bird that is dropping frames must be rescued faster than a comfortable one is rewarded');
});

test('AQP-14 the downshift deadline does not depend on the rung already occupied', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;
  const overBudgetEverywhere = () => BUDGET_MS * 1.9;

  const timeToDownshiftFrom = (startRung) => {
    const bench = makeBench({ ladder: REDUCTION_LADDER, startRung });
    const ctrl = boot(createAdaptiveQuality, bench);
    bench.feedCapacity(ctrl, { costFor: overBudgetEverywhere, durationMs: K.restoreStabilityMaxMs * 2 });
    const first = bench.changes.find((c) => c.to > c.from);
    return first ? first.tMs : null;
  };

  const fromTop = timeToDownshiftFrom(0);
  const fromDegraded = timeToDownshiftFrom(2);

  assert.ok(fromTop !== null, 'no downshift from the top rung under sustained overload');
  assert.ok(fromDegraded !== null,
    'no FURTHER downshift from an already degraded rung. This is GAP-2 exactly: the shipped controller selects its ' +
    'averaging window by the current tier, so at tier 1 the next downgrade waits the four-second RECOVERY window.');

  const slack = K.evaluationWindowMs;   // one window of tolerance, not a number
  assert.ok(Math.abs(fromDegraded - fromTop) <= slack,
    `downshift took ${Math.round(fromTop)} ms from rung 0 and ${Math.round(fromDegraded)} ms from rung 2. ` +
    'The overload timer is being selected by the current rung.');
  assert.ok(fromDegraded < K.restoreStabilityMinMs,
    `a further downshift waited ${Math.round(fromDegraded)} ms, which is at or beyond the RECOVERY stability period ` +
    `(${K.restoreStabilityMinMs} ms). Overload and recovery are sharing a timer.`);
});

test('AQP-15 a restore waits the RECOVERY window, not the overload one', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;
  const bench = makeBench({ ladder: REDUCTION_LADDER, startRung: 2 });
  const ctrl = boot(createAdaptiveQuality, bench);

  // Comfortable at every rung, from the first frame. Nothing here justifies a
  // reduction, and a restore before PRO-4's stability period is a controller
  // that treats "one good window" as evidence of headroom.
  bench.feedCapacity(ctrl, { costFor: () => BUDGET_MS * 0.35, durationMs: K.restoreStabilityMaxMs * 3 });

  const firstRestore = bench.changes.find((c) => c.to < c.from);
  assert.ok(firstRestore, 'the controller never restored quality across three full stability periods of comfortable frames — "a stable frame rate with permanently poor quality is not success"');
  assert.ok(firstRestore.tMs >= K.restoreStabilityMinMs,
    `restored after ${Math.round(firstRestore.tMs)} ms; PRO-4 requires ${K.restoreStabilityMinMs}-${K.restoreStabilityMaxMs} ms of stability first. ` +
    'Restoring on the overload timer is how a controller oscillates.');
  const reductions = bench.changes.filter((c) => c.to > c.from);
  assert.deepEqual(reductions, [], 'the controller reduced quality on a run that was inside budget on every frame');
});

test('AQP-16 no adjustment inside the first evaluation window, however bad the frames are', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;
  const bench = makeBench({ ladder: REDUCTION_LADDER });
  const ctrl = boot(createAdaptiveQuality, bench);
  bench.feedCapacity(ctrl, { costFor: () => BUDGET_MS * 6, durationMs: K.evaluationWindowMs * 4 });

  const early = bench.adaptiveApplies().filter((a) => a.tMs < K.evaluationWindowMs);
  assert.deepEqual(early.map((a) => `${a.kind}@${Math.round(a.tMs)}`), [],
    'the controller adjusted before it had one full evaluation window of data. A single shader compile, a resume ' +
    'spike or a recurring gameplay hitch is not a device that cannot run the game.');
});

/* ========================================================================== *
 * SECTION 6 — ONE COST PER STEP, SETTLE, EVALUATE, HOLD OR REVERT
 * ========================================================================== */

test('AQP-17 every adaptive move is exactly one rung', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;
  const bench = makeBench({ ladder: REDUCTION_LADDER });
  const ctrl = boot(createAdaptiveQuality, bench);

  // Cheaper at every rung, and only the last one fits: the controller has to
  // walk the whole ladder.
  const costs = REDUCTION_LADDER.map((_, i, arr) => BUDGET_MS * (1.9 - 1.0 * (i / (arr.length - 1))));
  bench.feedCapacity(ctrl, { costFor: descendingCost(costs), durationMs: 90000 });

  assert.ok(bench.changes.length >= 2, 'the controller made fewer than two moves walking a ladder it had to descend');
  for (const c of bench.changes) {
    if (c.kind === 'startup' || c.kind === 'manual') continue;
    assert.equal(Math.abs(c.to - c.from), 1,
      `a ${c.kind} moved ${c.from} -> ${c.to}, ${Math.abs(c.to - c.from)} rungs at once. ` +
      'Plan step 2 of the machine is "reduce ONE cost"; even severe overload "may take another STEP sooner", ' +
      'which is one step earlier, not two steps at once.');
  }
});

test('AQP-18 an adjustment is held for PRO-6 before the next ordinary one', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;
  const bench = makeBench({ ladder: REDUCTION_LADDER });
  const ctrl = boot(createAdaptiveQuality, bench);
  const costs = REDUCTION_LADDER.map((_, i, arr) => BUDGET_MS * (1.9 - 1.0 * (i / (arr.length - 1))));
  bench.feedCapacity(ctrl, { costFor: descendingCost(costs), durationMs: 90000 });

  const ordinary = bench.changes.filter((c) => c.kind === 'downshift' || c.kind === 'upshift');
  for (let i = 1; i < ordinary.length; i += 1) {
    const gap = ordinary[i].tMs - ordinary[i - 1].tMs;
    assert.ok(gap >= K.settleHoldMinMs,
      `two ordinary adjustments ${Math.round(gap)} ms apart; PRO-6 holds ${K.settleHoldMinMs}-${K.settleHoldMaxMs} ms ` +
      'after an ordinary adjustment. Without the hold the controller is scoring a change against frames it has not caused yet.');
  }
});

test('AQP-19 a reduction that buys nothing is rolled back, not followed by six more', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;
  const bench = makeBench({ ladder: REDUCTION_LADDER });
  const ctrl = boot(createAdaptiveQuality, bench);

  // The scene is CPU-bound in a way this ladder cannot touch: every rung costs
  // exactly the same, and it is over budget. Descending buys nothing at all.
  bench.feedCapacity(ctrl, { costFor: () => BUDGET_MS * 1.45, durationMs: 120000 });

  const deepest = bench.changes.reduce((m, c) => Math.max(m, c.to), 0);
  const restoring = bench.changes.filter((c) => c.to < c.from);

  assert.ok(restoring.length >= 1,
    'the controller reduced quality repeatedly, measured no benefit whatever, and never put anything back. ' +
    'RL-4: "Retain a quality reduction only when it provides a useful, measurable performance benefit ... ' +
    'Roll back ineffective reductions."');
  assert.ok(deepest <= 2,
    `the controller descended to rung ${deepest} on a ladder where no rung changed the frame cost by one microsecond. ` +
    'One exploratory step is diagnosis; seven is a controller that has confused "I changed something" with ' +
    '"it helped", and its reward is a permanently ugly game running at exactly the frame rate it started with.');
  assert.ok(bench.rung <= 1,
    `the run ended parked at rung ${bench.rung} with nothing to show for it`);
});

/* ========================================================================== *
 * SECTION 7 — VALIDITY AND BOUNDARIES (CONTRACT §2)
 * ========================================================================== */

test('AQP-20 paused frames are invalid for decisions and are not adjusted on', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;
  const bench = makeBench({ ladder: REDUCTION_LADDER });
  const ctrl = boot(createAdaptiveQuality, bench);

  bench.feedCapacity(ctrl, { costFor: () => BUDGET_MS * 0.4, durationMs: 3000 });
  bench.feedPaused(ctrl, { durationMs: 30000, reason: 'hidden' });

  const during = bench.adaptiveApplies().filter((a) => a.tMs >= 3000);
  assert.deepEqual(during.map((a) => `${a.kind}@${Math.round(a.tMs)}`), [],
    'thirty seconds of 900 ms hidden-tab frames produced an adaptive decision. CONTRACT §2.2: paused samples are ' +
    'EXCLUDED from decisions and RETAINED in evidence — "invalid-for-decisions and present-in-evidence are different properties".');
});

test('AQP-21 a history reset must carry a tag from the closed enum', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;
  const bench = makeBench({ ladder: REDUCTION_LADDER });
  const ctrl = boot(createAdaptiveQuality, bench);
  bench.feedCapacity(ctrl, { costFor: () => BUDGET_MS * 0.5, durationMs: 1000 });

  assert.throws(() => ctrl.reset(undefined, bench.tMs), /tag/i,
    'CONTRACT §2.1: "Every history reset carries exactly one tag from this set. An untagged reset is a contract violation."');
  assert.throws(() => ctrl.reset('whenever', bench.tMs), /whenever|tag/i,
    'an unknown reset tag must be rejected, not accepted as documentation');
  for (const tag of RESET_TAGS) {
    assert.doesNotThrow(() => ctrl.reset(tag, bench.tMs), `reset("${tag}") is in the enum and must be accepted`);
  }
});

/* ========================================================================== *
 * SECTION 8 — THE COMPATIBILITY LADDER (CONTRACT §11)
 *
 * "The new controller ships with a profile that reproduces today's 55/58
 *  three-tier behaviour exactly. The new policy is reachable only from the
 *  panel and a URL flag, and the switchover is gated on a recorded device
 *  session. A no-device outcome then ships a workbench and a measurement rig
 *  ... and nothing riskier than today."
 *
 * That paragraph is the whole insurance policy of this programme, and it is
 * worth exactly nothing unless something checks it.
 * ========================================================================== */

test('AQP-22 the page gets the COMPAT policy unless something explicitly asks for the new one', { skip: IMPL }, async () => {
  const { DEFAULT_PROFILE, PROFILE_URL_FLAG, PROFILES, selectProfile } = await load();

  assert.equal(DEFAULT_PROFILE, 'compat',
    'CONTRACT §11 makes the new policy "reachable only from the panel and a URL flag". A default of "auto" ships the ' +
    'unvalidated policy to every phone and deletes the no-device ship path.');
  assert.ok(PROFILES && PROFILES.compat && PROFILES.auto, 'PROFILES must carry both policies by name');

  assert.equal(typeof PROFILE_URL_FLAG, 'string');
  assert.notEqual(PROFILE_URL_FLAG, 'debug',
    'the flag must not be "debug". CONTRACT §6: every harness in this repo loads the page with ?debug=1, so a policy ' +
    'gated on ?debug would be the NEW policy in CI and the OLD policy on the phone — the hardwareConcurrency trap, ' +
    'inverted, with the automated evidence all collected against the wrong arm.');

  assert.equal(selectProfile({}), 'compat');
  assert.equal(selectProfile({ search: '' }), 'compat');
  assert.equal(selectProfile({ search: '?debug=1' }), 'compat',
    '?debug must not switch the policy');
  assert.equal(selectProfile({ search: `?${PROFILE_URL_FLAG}=auto` }), 'auto');
  assert.equal(selectProfile({ search: `?debug=1&${PROFILE_URL_FLAG}=auto` }), 'auto');
  assert.equal(selectProfile({ panelRequest: 'auto' }), 'auto',
    'the panel is the other route CONTRACT §11 names');
  assert.equal(selectProfile({ search: `?${PROFILE_URL_FLAG}=nonsense` }), 'compat',
    'an unrecognised profile name falls back to the safe one, it does not throw the page away');
});

test('AQP-23 the compat profile\'s thresholds ARE the live IIFE\'s, read out of index.html', { skip: IMPL }, async () => {
  const mod = await load();
  const html = readFileSync(INDEX_HTML, 'utf8');

  const scrape = (name) => {
    const m = html.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*;`));
    assert.ok(m, `could not find ${name} in index.html — the shipped adaptiveTier IIFE has moved or been renamed. ` +
      'If it was removed by the P3.4 rewire, this assertion is the record of what it used to be and must be ' +
      'reconciled deliberately, not deleted.');
    return Number(m[1]);
  };

  const live = {
    compatLowFpsThreshold: scrape('LOW_FPS_THRESHOLD'),
    compatRestoreFpsThreshold: scrape('RESTORE_FPS_THRESHOLD'),
    compatLowWindowMs: scrape('LOW_WINDOW_MS'),
    compatHighWindowMs: scrape('HIGH_WINDOW_MS'),
    compatMinIntervalMs: scrape('MIN_INTERVAL_MS'),
  };

  for (const [key, value] of Object.entries(live)) {
    assert.equal(PROVISIONAL[key], value,
      `PROVISIONAL.${key} is ${PROVISIONAL[key]} and index.html says ${value}`);
  }

  const declared = mod.PROFILES.compat.thresholds;
  assert.ok(declared && typeof declared === 'object',
    'PROFILES.compat must declare the thresholds it reproduces, so the claim "reproduces today\'s behaviour exactly" ' +
    'is checkable against the source it claims to reproduce');
  for (const [key, value] of Object.entries(live)) {
    assert.equal(declared[key], value,
      `PROFILES.compat.thresholds.${key} is ${declared[key]}; the live IIFE uses ${value}`);
  }
});

test('AQP-24 the compat profile decides identically to the transcribed shipped policy', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality } = mod;
  const ladder = compatLadder(K);

  /**
   * An adversarial frame-rate script, deliberately NOT one of the sixteen
   * committed scenarios. It walks the 55/58 boundary from both sides, sits in
   * the dead band between them, and includes a fast-then-slow reversal inside
   * the MIN_INTERVAL dwell.
   */
  const script = [
    { fps: 60, ms: 3000 },    // warm, comfortable
    { fps: 50, ms: 7000 },    // clearly under 55 -> downshift
    { fps: 56, ms: 6000 },    // the DEAD BAND: neither < 55 nor > 58
    { fps: 59, ms: 9000 },    // above 58 -> restore, but only after the tier-1 window
    { fps: 54, ms: 5000 },    // straight back under, inside the dwell
    { fps: 62, ms: 12000 },   // sustained good
  ];

  const run = (policy, benchOpts = {}) => {
    const bench = makeBench({ ladder, ...benchOpts });
    if (typeof policy.start === 'function') policy.start(bench.ctx);
    for (const seg of script) bench.feedFps(policy, { fps: seg.fps, durationMs: seg.ms });
    return bench;
  };

  const reference = run(createCompatPolicy({ K }));
  const candidateBench = makeBench({ ladder });
  const candidate = boot(createAdaptiveQuality, candidateBench, { profile: 'compat' });
  for (const seg of script) candidateBench.feedFps(candidate, { fps: seg.fps, durationMs: seg.ms });

  const shape = (b) => b.changes.map((c) => `${c.from}->${c.to}@${Math.round(c.tMs)}`);
  assert.deepEqual(shape(candidateBench), shape(reference),
    'the compatibility profile must move tier-for-tier and millisecond-for-millisecond with the shipped policy on the ' +
    'same input. Reference (transcribed from index.html 6593-6660): ' + JSON.stringify(shape(reference)) +
    '; candidate: ' + JSON.stringify(shape(candidateBench)));
  assert.ok(shape(reference).length > 0,
    'the reference itself never moved — this comparison would then be vacuous, and the script must be fixed');
});

test('AQP-25 compat REPRODUCES GAP-2 and auto FIXES it, on identical input', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality } = mod;
  const ladder = compatLadder(K);

  // Start already degraded, then run steadily below the shipped threshold.
  // The shipped policy selects HIGH_WINDOW_MS at tier >= 1, so its next
  // downshift cannot arrive before four seconds. That is the defect, and the
  // compatibility profile's job is to have it.
  const drive = (policy, bench) => {
    if (typeof policy.start === 'function') policy.start(bench.ctx);
    bench.feedFps(policy, { fps: 48, durationMs: K.compatHighWindowMs * 3 });
    const first = bench.changes.find((c) => c.to > c.from);
    return first ? first.tMs : null;
  };

  const compatBench = makeBench({ ladder, startRung: 1 });
  const compatCtrl = createAdaptiveQuality({ ...compatBench.ctx, profile: 'compat' });
  const tCompat = drive(compatCtrl, compatBench);

  const autoBench = makeBench({ ladder, startRung: 1 });
  const autoCtrl = createAdaptiveQuality({ ...autoBench.ctx, profile: 'auto' });
  const tAuto = drive(autoCtrl, autoBench);

  assert.ok(tCompat !== null, 'the compat profile never downshifted from tier 1 at 48 fps');
  assert.ok(tAuto !== null, 'the auto profile never downshifted from a degraded rung at 48 fps');

  assert.ok(tCompat >= K.compatHighWindowMs,
    `compat downshifted after ${Math.round(tCompat)} ms; the shipped IIFE cannot move before ${K.compatHighWindowMs} ms ` +
    'at tier >= 1 because it selects its averaging window by the current tier. A compatibility profile that is BETTER ' +
    'than the shipped one is not a compatibility profile, and the A/B in P3.5 then compares the new policy against ' +
    'something that never shipped.');
  assert.ok(tAuto <= OVERLOAD_DEADLINE_MS + K.evaluationWindowMs,
    `auto downshifted after ${Math.round(tAuto)} ms; the overload rule is ${OVERLOAD_DEADLINE_MS} ms of evidence`);
  assert.ok(tAuto < tCompat,
    `auto took ${Math.round(tAuto)} ms and compat took ${Math.round(tCompat)} ms — the new policy has inherited GAP-2`);
});

test('AQP-26 a panel lock stops the adaptive layer writing, in either profile', { skip: IMPL }, async () => {
  const mod = await load();
  const { createAdaptiveQuality, REDUCTION_LADDER } = mod;

  for (const profile of ['auto', 'compat']) {
    const ladder = profile === 'compat' ? compatLadder(K) : REDUCTION_LADDER;
    const bench = makeBench({ ladder });
    const ctrl = boot(createAdaptiveQuality, bench, { profile });
    bench.setMode('manual', ctrl);
    bench.feedCapacity(ctrl, { costFor: () => BUDGET_MS * 3, durationMs: 60000 });

    assert.deepEqual(bench.adaptiveApplies().map((a) => `${a.kind}@${Math.round(a.tMs)}`), [],
      `profile "${profile}" wrote to the renderer while the panel held a Manual lock. CONTRACT §7.1: "Once Manual is ` +
      'active, the adaptive tier must not write the quantities the panel owns — not once, not on the next frame." ' +
      'The SHIPPED IIFE has no mode concept at all, so the compat profile has to acquire one: reproducing its ' +
      'thresholds is compatibility, reproducing its inability to be switched off is not.');
    assert.equal(ctrl.snapshot().mode, 'manual');
  }
});
