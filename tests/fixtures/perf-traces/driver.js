/**
 * tests/fixtures/perf-traces/driver.js — the thing that makes the corpus a
 * CAPACITY MODEL rather than a tape.
 *
 * Wave 3 / P3.1. Read ./README.md first; this is the machine that reads a
 * scenario from ./schema.js and drives a controller through it.
 *
 * ---------------------------------------------------------------------------
 * THE LOOP, AND WHY IT IS THIS WAY ROUND
 * ---------------------------------------------------------------------------
 * Per step:
 *
 *   1. fire any world events due at or before `t`
 *   2. look up the capacity at `t` — the sustainable cost AT EVERY RUNG
 *   3. take the cost AT THE RUNG THE CONTROLLER IS CURRENTLY STANDING ON
 *   4. add instrumentation, hitches and deterministic jitter
 *   5. turn that cost into a DELIVERED interval through the presentation model
 *   6. hand the frame to the controller, which may call apply()
 *   7. advance `t` by the delivered interval
 *
 * Step 3 is the whole point. The controller's decision on frame n changes what
 * frame n+1 MEASURES. A recorded interval array cannot do that, so under a
 * replay every test of a decision is vacuous: the controller could downshift,
 * upshift or do nothing and read back the identical numbers.
 *
 * ---------------------------------------------------------------------------
 * THE RUNG MOVES ONLY THROUGH apply()
 * ---------------------------------------------------------------------------
 * The driver never asks the controller what rung it thinks it is on. Rendering
 * work changes when, and only when, apply() is called. That is
 * PERFORMANCE_REALISM_PLAN.md's runtime-loop step 2 made mechanical:
 *
 *   "confirm the effective buffer sizes, effect activity or update rates
 *    actually changed. A slider value changing is not evidence that rendering
 *    work changed."
 *
 * A controller that decides internally and forgets to route the decision moves
 * nothing here and fails every capacity assertion, which is exactly what it
 * would do on the phone.
 *
 * ---------------------------------------------------------------------------
 * VIOLATIONS ARE COLLECTED, NOT THROWN
 * ---------------------------------------------------------------------------
 * Contract breaches observable from outside the controller (an adaptive write
 * during Manual, a gameplay-fidelity key, two outstanding probes, a probe
 * sooner than PRO-8, an out-of-range rung) are recorded on the result. Tests
 * assert on the list. Throwing at the first one would hide the other nine and
 * would make the driver's own diagnostics worse than the controller's.
 *
 * No THREE, no DOM, no timers and no wall clock of any kind: the clock IS the
 * trace, and `now()` returns the trace's own time.
 */

import { mulberry32 } from '../../../src/environment/seeded-random.js';
import { PROVISIONAL, budgetMs as budgetFor } from '../../../src/game/perf-constants.js';
import { buildLadder, FORBIDDEN_SETTING_KEYS } from './ladder.js';
import { capacityAt, feasibleRung, assertValidScenario } from './schema.js';

/**
 * The closed set of `kind`s an apply() may carry. Pinned here because the
 * probe budget (PRO-8: "at most one optional upgrade probe per 30 seconds",
 * "one outstanding probe") is unenforceable unless a probe is distinguishable
 * from an ordinary adjustment, and the corpus cannot ask the controller nicely.
 */
export const APPLY_KINDS = Object.freeze([
  'downshift',      // ordinary reduction, measured overload
  'emergency',      // severe sustained overload; the one documented exception (CONTRACT §7.1)
  'upshift',        // ordinary restore after PRO-4 stability
  'probe',          // a bounded upgrade probe — starts an outstanding probe
  'probe-keep',     // the probe held up; acceptance retained
  'probe-rollback', // the probe regressed; rolled back and its cooldown lengthened
  'revoke',         // post-acceptance watchdog revoking an earlier accepted change
  'manual',         // a panel request (allowed in every mode)
  'startup',        // the cold-start profile, applied once at the top of the run
]);

/** Which kinds the adaptive layer owns, i.e. which are forbidden while locked. */
const ADAPTIVE_KINDS = Object.freeze(['downshift', 'emergency', 'upshift', 'probe', 'probe-keep', 'probe-rollback', 'revoke']);

/**
 * How the modelled CPU cost splits between simulation/update work and render
 * submission (TEL-4 wants them as separate accumulators). A property of the
 * depicted device, like cpuShare — not a threshold, so not a CONTRACT §10 row.
 * A scenario that cares states its own `cpuSplit`.
 */
export const DEFAULT_UPDATE_SHARE = 0.6;

/** Cost can never be zero; a zero-cost frame would divide the run into infinity. */
const MIN_COST_MS = 0.05;

/**
 * The interval delivered while the tab is hidden / the loop is frozen. rAF is
 * throttled or stopped, so the honest depiction of a paused frame is one long
 * interval, not a 16 ms one. It is marked invalid, and CONTRACT §2.2 is
 * emphatic that it is RETAINED: "a 900 ms frame while the tab was hidden is
 * real data about the resume path".
 */
export const PAUSED_FRAME_MS = 900;

function clampRung(r, depth) {
  if (!Number.isInteger(r)) return null;
  return Math.min(depth - 1, Math.max(0, r));
}

/**
 * runTrace(scenario, options) -> result
 *
 * @param {object}  scenario                a validated scenario from ./scenarios
 * @param {object}  options
 * @param {object}  options.policy          the controller adapter (see README "THE ADAPTER")
 * @param {object} [options.K]              a PROVISIONAL-shaped constants table
 * @param {string} [options.instrumentation] 'off' | 'on' — is the dev panel open
 * @param {number} [options.maxSteps]       safety stop
 * @param {boolean}[options.validate]       validate the scenario first (default true)
 */
export function runTrace(scenario, {
  policy,
  K = PROVISIONAL,
  instrumentation = 'off',
  maxSteps = null,
  validate = true,
} = {}) {
  if (!policy || typeof policy.frame !== 'function') {
    throw new TypeError('runTrace needs a policy with a frame() method — see README "THE ADAPTER"');
  }
  if (instrumentation !== 'off' && instrumentation !== 'on') {
    throw new RangeError(`instrumentation must be 'off' or 'on', got ${instrumentation}`);
  }
  if (validate) assertValidScenario(scenario, { K });

  const ladder = Array.isArray(scenario.ladder) ? scenario.ladder : buildLadder(scenario.ladder, K);
  const depth = ladder.length;
  const targetFPS = scenario.targetFPS;
  const budget = budgetFor(targetFPS);
  const pres = scenario.presentation;
  const quantum = pres.mode === 'vsync' ? 1000 / pres.hz : null;
  const jitterMs = scenario.jitterMs ?? 0;
  const rng = mulberry32(scenario.seed >>> 0);
  const updateShare = scenario.cpuSplit ?? DEFAULT_UPDATE_SHARE;
  const panelOn = instrumentation === 'on';

  // ---- world state --------------------------------------------------------
  let t = 0;
  let frameIndex = 0;
  const startRungRaw = scenario.startRung;
  const startRungClamped = clampRung(startRungRaw, depth) ?? 0;
  const startRungWasOutOfRange = startRungClamped !== startRungRaw;
  let rung = startRungClamped;
  let mode = 'auto';
  let paused = false;
  let pauseReason = null;
  let gpuState = scenario.gpuInitial ?? 'ok';
  // For PRO-4: how long the world has held still since the last rung move.
  let lastAdjustAtMs = -Infinity;
  let pendingHitchMs = 0;
  let pendingHitchTag = null;
  let recurrent = null;          // { everyMs, dtMs, nextAtMs }
  let nextPanelUpdateAt = 0;
  let eventCursor = 0;
  let frameTag = null;           // a reset tag stamped on the frame it happened

  // ---- records ------------------------------------------------------------
  const steps = [];
  const samplesForGates = [];    // shaped for frame-stats.evaluateAcceptanceGates
  const tierChangeLog = [];      // shaped for frame-stats.evaluateOscillation
  const applies = [];
  const resets = [];
  const modeLog = [{ tMs: 0, mode }];
  const violations = [];
  const hitchLog = [];           // every injected hitch, WITH its tMs. Never cleared.
  const notes = [];

  const violate = (code, detail) => violations.push({ code, tMs: t, detail });

  // ---- the ONE routing point ---------------------------------------------
  let lastProbeAtMs = null;
  let probeOutstanding = false;

  function apply(request) {
    const req = request || {};
    const kind = req.kind;
    const source = req.source ?? (ADAPTIVE_KINDS.includes(kind) ? 'adaptive' : 'panel');
    const record = {
      tMs: t, frameIndex, kind, source,
      requestedRung: req.rung,
      effectiveRung: rung,
      reason: req.reason ?? null,
      rejected: false,
      clamped: false,
    };

    if (!APPLY_KINDS.includes(kind)) {
      violate('unknown-apply-kind', `apply({kind:${JSON.stringify(kind)}}) — must be one of ${APPLY_KINDS.join(', ')}`);
      record.rejected = true;
      record.rejectReason = 'unknown-kind';
      applies.push(record);
      return { effectiveRung: rung, clamped: false, rejected: true, reason: 'unknown-kind' };
    }

    // Gameplay fidelity is never a quality lever (plan step 4, CONTRACT §7.2).
    for (const key of Object.keys(req.settings || {})) {
      if (FORBIDDEN_SETTING_KEYS.includes(key)) {
        violate('gameplay-fidelity-write', `apply() named gameplay key "${key}" — never reduce collision, input or flight simulation fidelity to conceal a rendering bottleneck`);
      }
    }

    // Precedence (CONTRACT §7.1): a panel lock suspends the adaptive layer.
    if (mode !== 'auto' && ADAPTIVE_KINDS.includes(kind)) {
      violate('adaptive-write-while-locked',
        `apply({kind:'${kind}'}) while mode='${mode}' — "Once Manual is active, the adaptive tier must not write the quantities the panel owns; not once, not on the next frame."`);
      record.rejected = true;
      record.rejectReason = 'mode-locked';
      applies.push(record);
      return { effectiveRung: rung, clamped: false, rejected: true, reason: 'mode-locked' };
    }

    // Probe budget (PRO-8), enforced from outside because the controller
    // cannot be its own witness.
    //
    // G3o BLOCKER 2. This used to bind only on kind === 'probe', so a
    // controller that climbed with kind:'upshift' escaped the budget
    // completely and INV-7 passed VACUOUSLY with zero probes — measured, on a
    // free-climbing controller. "Enforced from outside" is not enforcement if
    // the outside waits for the subject to volunteer the label.
    //
    // What separates the two upward moves is EVIDENCE, not intent. PRO-4
    // restores after measured stability WITH headroom; PRO-8 rate-limits the
    // exploratory excursion you take when you CANNOT measure headroom. DEF-2
    // ships the GPU timer on its unavailable branch on every target device, so
    // in practice headroom is unmeasurable and every upward move is a probe.
    // Classify on the last GPU state the world actually reported.
    // Lower rung index = higher quality, so an upward move DECREASES it.
    const isUpward = typeof req.rung === 'number' && req.rung < rung;
    // There are exactly TWO legitimate ways up, and the plan names both.
    // PRO-4 restores after 10-15 s of measured stability. PRO-8 rate-limits the
    // exploratory excursion you take when you cannot establish that. A move up
    // that is neither is an unwarranted climb, and before this check a
    // controller that simply never used the word "probe" escaped the budget
    // entirely: INV-7 filtered on a label the subject volunteers, so a policy
    // climbing a rung every three seconds scored ZERO probes and passed clean.
    // "Enforced from outside" is not enforcement if the outside waits to be told.
    if (isUpward && kind !== 'probe' && ADAPTIVE_KINDS.includes(kind)) {
      const stableFor = t - lastAdjustAtMs;
      if (stableFor < K.restoreStabilityMinMs) {
        violate('unlabelled-probe',
          `apply({kind:'${kind}'}) moved UP a rung after only ${Math.round(stableFor)} ms of `
          + `stability. PRO-4 restores after ${K.restoreStabilityMinMs} ms; anything sooner is an `
          + `exploratory upgrade and PRO-8 governs it — label it 'probe' and resolve it with `
          + `'probe-keep'/'probe-rollback'.`);
      }
    }
    if (kind === 'probe') {
      if (probeOutstanding) {
        violate('probe-overlap', 'a second upgrade probe started while one was still outstanding (PRO-8: one outstanding probe)');
      }
      if (lastProbeAtMs !== null && t - lastProbeAtMs < K.probeIntervalMs) {
        violate('probe-too-soon', `probes ${Math.round(t - lastProbeAtMs)} ms apart; PRO-8 allows at most one per ${K.probeIntervalMs} ms`);
      }
      lastProbeAtMs = t;
      probeOutstanding = true;
    } else if (kind === 'probe-keep' || kind === 'probe-rollback') {
      if (!probeOutstanding) {
        violate('probe-resolution-without-probe', `apply({kind:'${kind}'}) with no outstanding probe`);
      }
      probeOutstanding = false;
    }

    const target = clampRung(req.rung, depth);
    if (target === null) {
      violate('non-integer-rung', `apply({rung:${JSON.stringify(req.rung)}}) — a rung is an index into the ladder`);
      record.rejected = true;
      record.rejectReason = 'non-integer-rung';
      applies.push(record);
      return { effectiveRung: rung, clamped: false, rejected: true, reason: 'non-integer-rung' };
    }
    if (target !== req.rung) {
      record.clamped = true;
      violate('out-of-range-rung',
        `apply({rung:${req.rung}}) on a ${depth}-rung ladder; clamped to ${target}. ` +
        'A profile from a store is untrusted input and must be clamped to the approved range by the controller, not by the thing it is talking to.');
    }

    const from = rung;
    rung = target;
    lastAdjustAtMs = t;
    record.effectiveRung = rung;
    applies.push(record);
    if (from !== rung) {
      tierChangeLog.push({ tMs: t, from, to: rung, reason: record.reason, kind });
    }
    return { effectiveRung: rung, clamped: record.clamped, rejected: false, reason: null };
  }

  // ---- events -------------------------------------------------------------
  const events = scenario.events ?? [];
  function fireDueEvents() {
    while (eventCursor < events.length && events[eventCursor].atMs <= t) {
      const e = events[eventCursor];
      eventCursor += 1;
      switch (e.kind) {
        case 'reset':
          resets.push({ tMs: t, tag: e.tag });
          frameTag = e.tag;
          if (typeof policy.reset === 'function') policy.reset(e.tag, t);
          break;
        case 'paused':
          paused = e.paused;
          pauseReason = e.paused ? e.reason : null;
          if (typeof policy.setPaused === 'function') policy.setPaused(e.paused, pauseReason, t);
          break;
        case 'mode':
          mode = e.mode;
          modeLog.push({ tMs: t, mode });
          if (typeof policy.setMode === 'function') policy.setMode(e.mode, t);
          break;
        case 'gpu':
          gpuState = e.state;
          break;
        case 'hitch':
          pendingHitchMs += e.dtMs;
          pendingHitchTag = e.tag ?? null;
          break;
        case 'recurrentHitch':
          recurrent = { everyMs: e.everyMs, dtMs: e.dtMs, nextAtMs: t + e.everyMs };
          break;
        case 'stopRecurrentHitch':
          recurrent = null;
          break;
        case 'note':
          notes.push({ tMs: t, text: e.text });
          break;
        default:
          break;
      }
    }
  }

  // ---- start --------------------------------------------------------------
  if (typeof policy.start === 'function') {
    policy.start({
      ladder,
      depth,
      targetFPS,
      budgetMs: budget,
      constants: K,
      // The COLD START profile, handed over exactly as stored — including out
      // of range, which is what "corrupt store" means. CONTRACT §9 DEF-1
      // defers the persistence layer; this is the cold start, not the store.
      startProfile: { rung: startRungRaw, outOfRange: startRungWasOutOfRange },
      instrumentation,
      apply,
      now: () => t,
    });
  }

  const stepCap = maxSteps ?? Math.ceil(scenario.durationMs / (quantum ?? MIN_COST_MS)) + 512;
  let endedBecause = 'duration';

  // ---- the loop -----------------------------------------------------------
  while (t < scenario.durationMs) {
    if (steps.length >= stepCap) { endedBecause = 'step-cap'; break; }
    fireDueEvents();

    const cap = capacityAt(scenario, t, depth);
    const feasible = feasibleRung(cap.costMs, budget);

    let cost = cap.costMs[rung];

    // Recurrent gameplay hitch — a real, repeating spike in the WORLD, not a
    // boundary. CONTRACT §2.1 rule 1: a reset "does not clear ... the
    // recurrent-hitch log."
    let hitchThisFrame = 0;
    if (recurrent && t >= recurrent.nextAtMs) {
      hitchThisFrame += recurrent.dtMs;
      recurrent.nextAtMs += recurrent.everyMs;
    }
    if (pendingHitchMs > 0) {
      hitchThisFrame += pendingHitchMs;
      pendingHitchMs = 0;
    }
    cost += hitchThisFrame;

    // Instrumentation: real CPU work the panel does when it is open. Charged
    // to the frame, so a panel that manufactures the bottleneck shows up as
    // one. PRO-14 supplies the cadence; the two costs come from the trace.
    let panelMs = 0;
    if (panelOn) {
      panelMs += scenario.instrumentation.perFrameMs;
      if (t >= nextPanelUpdateAt) {
        panelMs += scenario.instrumentation.perUpdateMs;
        nextPanelUpdateAt = t + K.panelUpdateIntervalMs;
      }
    }
    cost += panelMs;

    if (jitterMs > 0) cost += (rng() * 2 - 1) * jitterMs;
    if (cost < MIN_COST_MS) cost = MIN_COST_MS;

    // CPU / GPU split. The panel's cost is CPU by construction (it is DOM and
    // string work), so it is added to the CPU side rather than shared out.
    const sceneCpu = (cost - panelMs) * cap.cpuShare;
    const cpuMs = sceneCpu + panelMs;
    const gpuTrueMs = Math.max(0, cost - cpuMs);
    const updateMs = cpuMs * updateShare;
    const submitMs = cpuMs - updateMs;

    // ---- presentation ----------------------------------------------------
    let dtMs;
    if (paused) {
      dtMs = scenario.pausedFrameMs ?? PAUSED_FRAME_MS;
    } else if (quantum !== null) {
      // A 60 Hz panel delivers whole refreshes. This is the ENTIRE mechanism
      // behind the misleading plateau: a 4 ms frame and a 16 ms frame are both
      // delivered at 16.67 ms, so delivered FPS is 60 in both cases and says
      // nothing whatever about headroom.
      const n = Math.max(1, Math.ceil((cost - 1e-9) / quantum));
      dtMs = n * quantum;
    } else {
      dtMs = cost;
    }

    const gpu = gpuState === 'ok'
      ? { value: gpuTrueMs, state: 'ok', reason: null }
      : { value: null, state: 'unavailable', reason: gpuState };

    const valid = !paused;
    const invalidReason = paused ? pauseReason : null;
    const tagThisFrame = frameTag;
    frameTag = null;

    const step = {
      frameIndex,
      tMs: t,
      dtMs,
      costMs: cost,
      rung,
      feasibleRung: feasible,
      capacity: cap.costMs,
      cpuMs,
      updateMs,
      submitMs,
      gpuTrueMs,
      panelMs,
      hitchMs: hitchThisFrame,
      valid,
      invalidReason,
      tag: tagThisFrame,
      mode,
      gpuState,
    };
    steps.push(step);
    samplesForGates.push({ dtMs, tMs: t, valid, invalidReason, tag: tagThisFrame });
    if (hitchThisFrame > 0) {
      hitchLog.push({ tMs: t, dtMs, addedMs: hitchThisFrame, tag: tagThisFrame ?? pendingHitchTag });
      pendingHitchTag = null;
    }

    // ---- the controller sees the frame -----------------------------------
    policy.frame({
      tMs: t,
      dtMs,
      valid,
      invalidReason,
      tag: tagThisFrame,
      cpuMs,
      updateMs,
      submitMs,
      gpu,
      mode,
      rung,          // read BACK off the world, never echoed from a request
      budgetMs: budget,
      targetFPS,
      frameIndex,
    });

    t += dtMs;
    frameIndex += 1;
  }

  // ---- derived metrics ----------------------------------------------------
  let timeOutsideBudgetMs = 0;
  let timeUnnecessarilyDegradedMs = 0;
  let validMs = 0;
  let cpuTotalMs = 0;
  const timeAtRung = new Array(depth).fill(0);
  for (const s of steps) {
    if (!s.valid) continue;
    validMs += s.dtMs;
    cpuTotalMs += s.cpuMs;
    timeAtRung[s.rung] += s.dtMs;
    // "Time outside budget" (RL-6) is measured against the SUSTAINABLE cost at
    // the rung actually rendered, not against the delivered interval: on a
    // 60 Hz panel a 16.5 ms frame and a 4 ms frame are delivered identically,
    // and only the capacity model knows which one was nearly over.
    if (s.capacity[s.rung] > budget + 1e-9) timeOutsideBudgetMs += s.dtMs;
    // "Time spent unnecessarily degraded" (RL-6): standing on a cheaper rung
    // than the capacity model says would have fitted.
    if (s.rung > s.feasibleRung) timeUnnecessarilyDegradedMs += s.dtMs;
  }

  return {
    scenario: scenario.name,
    // Named times the scenario declared, carried through so an invariant can
    // say "respond by marks.respondByMs" instead of repeating a number that
    // was derived from PROVISIONAL somewhere else.
    marks: scenario.marks ?? {},
    instrumentation,
    ladder,
    depth,
    targetFPS,
    budgetMs: budget,
    durationMs: scenario.durationMs,
    endedBecause,
    frames: steps.length,
    observedMs: t,
    steps,
    samples: samplesForGates,
    tierChangeLog,
    applies,
    resets,
    modeLog,
    notes,
    hitches: hitchLog,
    violations,
    startProfile: { requested: startRungRaw, effective: startRungClamped, outOfRange: startRungWasOutOfRange },
    finalRung: rung,
    timeAtRung,
    metrics: {
      timeOutsideBudgetMs,
      timeUnnecessarilyDegradedMs,
      validMs,
      cpuTotalMs,
      meanCpuMs: steps.length ? cpuTotalMs / steps.length : 0,
      adjustments: tierChangeLog.length,
      probes: applies.filter((a) => a.kind === 'probe' && !a.rejected).length,
      rollbacks: applies.filter((a) => a.kind === 'probe-rollback' && !a.rejected).length,
      revocations: applies.filter((a) => a.kind === 'revoke' && !a.rejected).length,
    },
  };
}

/**
 * runPair(scenario, opts) — the instrumentation on/off pair.
 *
 * One scenario, identical costMs, run twice with the panel closed and open.
 * The plan requires it: "Measure with telemetry and the panel both enabled and
 * disabled so instrumentation does not manufacture the bottleneck." Both runs
 * get a FRESH policy from the supplied factory, because a policy carrying
 * state from the first run would make the second run a continuation rather
 * than a repeat.
 */
export function runPair(scenario, { makePolicy, ...opts } = {}) {
  if (typeof makePolicy !== 'function') {
    throw new TypeError('runPair needs makePolicy() — each arm must get a fresh controller');
  }
  const off = runTrace(scenario, { ...opts, policy: makePolicy('off'), instrumentation: 'off' });
  const on = runTrace(scenario, { ...opts, policy: makePolicy('on'), instrumentation: 'on' });
  return { off, on };
}
