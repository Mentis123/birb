/**
 * tests/fixtures/perf-traces/reference-policies.js — small controllers whose
 * only job is to make the corpus FAIL.
 *
 * Wave 3 / P3.1. NONE of these is a product. They are here because of R8:
 *
 *   "A check must be shown to fail before it is trusted. Red-because-nothing-
 *    is-implemented is not proof of discrimination."
 *
 * A trace corpus is a check. "The controller passed all sixteen scenarios" is
 * worth nothing unless something can fail them, and the thing that fails them
 * has to be a controller that is WRONG IN A NAMED WAY, not a stub. Each policy
 * below is wrong in exactly one named way, drawn from a defect this repo or
 * this plan has already paid for, and tests/perf-trace-corpus.test.js pins
 * which scenario catches which.
 *
 * `createCompatPolicy` is the exception to "none of these is a product": it is
 * a faithful transcription of the SHIPPED `adaptiveTier` IIFE (index.html
 * 6593-6660), which CONTRACT §11 requires the new controller to be able to
 * reproduce, and which `tools/birb-perf-ab.mjs` (P3.5) needs as its reference
 * arm. It is a baseline of BEHAVIOUR, never of correctness — CLAUDE.md records
 * that its 55/58 thresholds were tuned against a sampler that could not run.
 *
 * All of them implement the adapter contract in ./README.md.
 * No THREE, no DOM.
 */

import { createFrameSampler } from '../../../src/game/frame-metrics.js';
import { PROVISIONAL } from '../../../src/game/perf-constants.js';

/* ========================================================================== *
 * 1. FIXED — apply a rung once, then never again.
 *    Not a defect: this is the "fixed reference profile" arm the development
 *    loop requires ("Compare Auto with the current controller and fixed
 *    reference profiles to verify that adaptation earns its overhead").
 * ========================================================================== */
export function createFixedPolicy(rungIndex) {
  let applyFn = null;
  let done = false;
  return {
    label: `fixed(${rungIndex})`,
    start(ctx) { applyFn = ctx.apply; },
    frame() {
      if (done || !applyFn) return;
      done = true;
      applyFn({ kind: 'startup', rung: rungIndex, reason: 'fixed reference profile', source: 'panel' });
    },
  };
}

/* ========================================================================== *
 * 2. STATIC — never applies anything, ever.
 *    The named defect: a controller whose decisions never reach the renderer.
 *    This repo shipped exactly that for the whole life of the adaptive tier —
 *    `if (!fpsMetric) return;` in front of the only sampleFps() call site — and
 *    it was green the entire time. Catches: overload, recovery, stuck-quality,
 *    delayed-regression.
 * ========================================================================== */
export function createStaticPolicy() {
  return { label: 'static', frame() {} };
}

/* ========================================================================== *
 * 3. THRASH — changes rung on a fixed beat, forever.
 *    The named defect: persistent quality oscillation after settling (ACC-4 /
 *    PRO-13). Catches: oscillation-bait.
 * ========================================================================== */
export function createThrashPolicy({ everyMs = 1200 } = {}) {
  let applyFn = null;
  let nextAt = 0;
  let cur = 0;
  let depth = 2;
  return {
    label: 'thrash',
    start(ctx) {
      applyFn = ctx.apply;
      depth = ctx.depth;
      cur = Math.min(depth - 1, Math.max(0, ctx.startProfile.rung | 0));
      nextAt = ctx.now() + everyMs;
    },
    frame(f) {
      if (!applyFn || f.tMs < nextAt) return;
      nextAt = f.tMs + everyMs;
      const next = cur === 0 ? 1 : 0;
      const kind = next > cur ? 'downshift' : 'upshift';
      cur = Math.min(depth - 1, next);
      applyFn({ kind, rung: cur, reason: 'thrash: alternate on a fixed beat' });
    },
  };
}

/* ========================================================================== *
 * 4. TWITCHY — downshifts on ANY single frame over budget, and never restores.
 *    The named defect: reacting to one frame instead of a window, so a single
 *    shader compile, a resume spike or a recurring gameplay hitch permanently
 *    degrades the game. "A stable frame rate with permanently poor quality is
 *    not success" (RL-6). Catches: first-use-shader-compilation, resume,
 *    boundary-interleaved-with-recurrent-hitch.
 * ========================================================================== */
export function createTwitchyPolicy() {
  let applyFn = null;
  let depth = 3;
  let cur = 0;
  return {
    label: 'twitchy',
    start(ctx) { applyFn = ctx.apply; depth = ctx.depth; cur = Math.min(depth - 1, Math.max(0, ctx.startProfile.rung)); },
    frame(f) {
      if (!applyFn) return;
      // Note: no validity check either — a hidden-tab frame is "over budget".
      if (f.dtMs > f.budgetMs && cur < depth - 1) {
        cur += 1;
        applyFn({ kind: 'downshift', rung: cur, reason: 'one frame was over budget' });
      }
    },
  };
}

/* ========================================================================== *
 * 5. NAIVE-GPU — `gpu.value || 0`, and trusts a stored profile verbatim.
 *    The named defect is this repo's most expensive one, twice over:
 *      - `isLowEnd = isMobile && (navigator.hardwareConcurrency || 4) <= 4`
 *        on a platform that does not expose hardwareConcurrency. `undefined ||
 *        4` is 4, and bloom was gated off on every iPhone ever made.
 *      - the same shape here: a GPU reading that is unavailable (absent
 *        extension, or a DISJOINT result the spec says to discard) reads as
 *        `0 ms of GPU work`, i.e. infinite headroom, and the controller
 *        upshifts into overload.
 *    It also applies its start profile without clamping, which is the corrupt
 *    store. Catches: absent-gpu-timer, disjoint-gpu-results, corrupt-store.
 * ========================================================================== */
export function createNaiveGpuPolicy({ K = PROVISIONAL } = {}) {
  let applyFn = null;
  let depth = 3;
  let cur = 0;
  let started = false;
  let lastChangeAt = -Infinity;
  return {
    label: 'naive-gpu',
    start(ctx) {
      applyFn = ctx.apply;
      depth = ctx.depth;
      cur = ctx.startProfile.rung;   // straight from the store, unchecked
    },
    frame(f) {
      if (!applyFn) return;
      if (!started) {
        started = true;
        applyFn({ kind: 'startup', rung: cur, reason: 'stored profile', source: 'panel' });
        return;
      }
      if (f.tMs - lastChangeAt < K.settleHoldMs) return;
      const gpuMs = f.gpu.value || 0;               // <- the whole defect
      const headroom = 1 - (gpuMs / f.budgetMs);
      if (headroom > K.restoreHeadroomFraction && cur > 0) {
        cur -= 1;
        lastChangeAt = f.tMs;
        applyFn({ kind: 'upshift', rung: cur, reason: `gpu ${gpuMs.toFixed(2)}ms looks idle` });
      } else if (f.dtMs > f.budgetMs * K.overloadP95Multiplier && cur < depth - 1) {
        cur += 1;
        lastChangeAt = f.tMs;
        applyFn({ kind: 'downshift', rung: cur, reason: 'over budget' });
      }
    },
  };
}

/* ========================================================================== *
 * 6. COMPAT — the SHIPPED policy, transcribed.
 *
 *    index.html 6593-6660, verbatim in behaviour:
 *      - fed from a 250 ms frame sampler, so it sees ~4 rate values a second
 *        and averages THOSE (CONTRACT §1.3: "percentiles over that are
 *        meaningless")
 *      - the averaging window is selected by the CURRENT tier
 *        (tier >= 1 ? HIGH_WINDOW_MS : LOW_WINDOW_MS), which is GAP-2: at
 *        tier 1 a further downshift waits the four-second RECOVERY window
 *      - MIN_INTERVAL_MS dwell between changes
 *      - three tiers, no probes, no rollback, no failed-probe memory,
 *        NO MODE CONCEPT AT ALL (so it writes straight through a panel lock —
 *        which is what CONTRACT §7.1 and assertion A10 exist to forbid)
 *
 *    Every number comes from PROVISIONAL.compat*, provenance
 *    `shipped-unvalidated`. Catches: misleading-plateau (it restores on
 *    delivered FPS, the restore fails, and having no memory of the failure it
 *    does it again — forever), manual-to-auto (it writes while locked).
 * ========================================================================== */
export function createCompatPolicy({ K = PROVISIONAL } = {}) {
  const sampler = createFrameSampler({ windowMs: K.compatSampleWindowMs });
  let applyFn = null;
  let depth = 3;
  let maxTier = 2;
  const state = { tier: 0, fpsSum: 0, fpsCount: 0, windowStart: 0, lastTierChange: 0 };

  return {
    label: 'compat-55/58',
    start(ctx) {
      applyFn = ctx.apply;
      depth = ctx.depth;
      // The shipped policy knows exactly three tiers. On a deeper ladder it
      // still only knows three — that is the point of a compatibility profile.
      maxTier = Math.min(2, depth - 1);
      state.tier = Math.min(maxTier, Math.max(0, ctx.startProfile.rung | 0));
    },
    reset() {
      // The shipped code resets `frameSampler` at three sites and the tier
      // accumulator at NONE (CONTRACT §2.1, GAP-5). Transcribed faithfully:
      // only the sampler forgets.
      sampler.reset();
    },
    frame(f) {
      if (!applyFn) return;
      // Fed at the sampler's cadence, exactly like updateFpsReadout().
      const fps = sampler.sample(f.tMs);
      if (fps === null) return;
      const time = f.tMs;
      if (state.windowStart === 0) state.windowStart = time;
      state.fpsSum += fps;
      state.fpsCount += 1;
      if (time - state.lastTierChange < K.compatMinIntervalMs) return;
      const elapsed = time - state.windowStart;
      const win = state.tier >= 1 ? K.compatHighWindowMs : K.compatLowWindowMs;
      if (elapsed < win) return;
      const avgFps = state.fpsSum / Math.max(1, state.fpsCount);
      if (avgFps < K.compatLowFpsThreshold && state.tier < maxTier) {
        state.tier += 1;
        state.lastTierChange = time;
        applyFn({ kind: 'downshift', rung: state.tier, reason: `avgFps ${avgFps.toFixed(1)} < ${K.compatLowFpsThreshold}` });
      } else if (avgFps > K.compatRestoreFpsThreshold && state.tier > 0) {
        state.tier -= 1;
        state.lastTierChange = time;
        applyFn({ kind: 'upshift', rung: state.tier, reason: `avgFps ${avgFps.toFixed(1)} > ${K.compatRestoreFpsThreshold}` });
      }
      state.fpsSum = 0;
      state.fpsCount = 0;
      state.windowStart = time;
    },
  };
}

/* ========================================================================== *
 * 7. FIRE-AND-FORGET — accepts a change and stops watching it.
 *    The named defect: no post-acceptance watchdog. "Continue a longer
 *    watchdog after accepting a change ... Revoke acceptance if delayed
 *    regressions appear." Catches: delayed-regression.
 * ========================================================================== */
export function createFireAndForgetPolicy({ K = PROVISIONAL } = {}) {
  let applyFn = null;
  let depth = 3;
  let cur = 0;
  let settled = false;
  let overloadSince = null;
  return {
    label: 'fire-and-forget',
    start(ctx) { applyFn = ctx.apply; depth = ctx.depth; cur = Math.min(depth - 1, Math.max(0, ctx.startProfile.rung)); },
    frame(f) {
      if (!applyFn || settled) return;
      if (!f.valid) return;
      if (f.dtMs > f.budgetMs * K.overloadP95Multiplier) {
        if (overloadSince === null) overloadSince = f.tMs;
        if (f.tMs - overloadSince >= K.evaluationWindowMs * K.overloadWindowCount && cur < depth - 1) {
          cur += 1;
          applyFn({ kind: 'downshift', rung: cur, reason: 'sustained overload' });
          overloadSince = null;
          settled = true;      // <- and never looks again
        }
      } else {
        overloadSince = null;
      }
    },
  };
}

/* ========================================================================== *
 * 8. PROBE-ONLY — probes up on PRO-8's schedule and rolls back what does not
 *    fit. Deliberately incomplete: it has NO overload response at all, so it
 *    is not a candidate for anything. It exists to prove INV-9 and INV-8 are
 *    SATISFIABLE — an invariant that nothing can satisfy is a broken oracle,
 *    and the only way to find that out before shipping the corpus is to
 *    satisfy it with something.
 * ========================================================================== */
export function createProbeOnlyPolicy({ K = PROVISIONAL } = {}) {
  let applyFn = null;
  let depth = 3;
  let cur = 0;
  let started = false;
  let nextProbeAt = 0;
  let probe = null;   // { fromRung, toRung, judgeAt, over }
  return {
    label: 'probe-only',
    start(ctx) {
      applyFn = ctx.apply;
      depth = ctx.depth;
      cur = Math.min(depth - 1, Math.max(0, ctx.startProfile.rung | 0));
      nextProbeAt = ctx.now() + K.restoreStabilityMinMs;
    },
    frame(f) {
      if (!applyFn) return;
      if (!started) {
        started = true;
        applyFn({ kind: 'startup', rung: cur, reason: 'clamped cold-start profile', source: 'panel' });
        return;
      }
      if (probe) {
        if (f.valid && f.dtMs > f.budgetMs * K.overloadP95Multiplier) probe.over += 1;
        if (f.tMs < probe.judgeAt) return;
        if (probe.over > 0) {
          cur = probe.fromRung;
          applyFn({ kind: 'probe-rollback', rung: cur, reason: `probe to ${probe.toRung} produced ${probe.over} over-budget frames` });
          // "lengthen its retry cooldown" — SM-3.
          nextProbeAt = f.tMs + K.probeIntervalMs * 2;
        } else {
          applyFn({ kind: 'probe-keep', rung: cur, reason: 'probe held up' });
          nextProbeAt = f.tMs + K.probeIntervalMs;
        }
        probe = null;
        return;
      }
      if (cur > 0 && f.tMs >= nextProbeAt) {
        const from = cur;
        cur -= 1;
        probe = { fromRung: from, toRung: cur, judgeAt: f.tMs + K.evaluationWindowMs * (K.overloadWindowCount + 1), over: 0 };
        applyFn({ kind: 'probe', rung: cur, reason: 'bounded upgrade probe — no GPU timing available' });
        nextProbeAt = f.tMs + K.probeIntervalMs;
      }
    },
  };
}

/* ========================================================================== *
 * 9. CLAIRVOYANT — the UPPER BOUND, and the only honest way to ask whether an
 *    oracle is satisfiable at all.
 *
 * It reads `feasibleRung` straight out of the capacity model, so no real
 * controller can ever beat it, and it still obeys the contract: one rung per
 * move, PRO-6's hold between moves, PRO-8's probe budget on every upward move,
 * every probe resolved with probe-keep / probe-rollback.
 *
 * NOT a candidate for anything and not copyable into a product: it takes the
 * scenario object and reads the future out of it. It exists because of the
 * principle G3o established and this wave made permanent — BEFORE SHIPPING AN
 * ORACLE, PROVE A CONFORMING IMPLEMENTATION CAN SATISFY IT — and it lives here,
 * once, because there were three divergent copies of it (the satisfiability
 * tool, TC-15, and the gate's own driver) and only one of them was right.
 *
 * ---------------------------------------------------------------------------
 * `chase` — AND WHY THE DEFAULT IS NOT 'greedy'
 * ---------------------------------------------------------------------------
 * 'greedy' walks to `feasibleRung` always. That is what every earlier copy of
 * this instrument did, and it is NOT an upper bound — measured, it failed 4 of
 * 120 holdout traces and 21 of 1200. In a regime where NOTHING on the ladder
 * meets the budget, `feasibleRung` is the deepest rung by definition
 * (schema.js: "the honest answer is the cheapest setting") and BOTH scored
 * metrics are rung-independent there: every rung is outside budget, and
 * nothing can be unnecessarily degraded below the deepest rung. So descending
 * buys nothing at all — and under PRO-8 it costs 30 seconds per rung to undo,
 * which is why a greedy instrument arrived at the next good regime three rungs
 * too deep and tied standing still.
 *
 * 'metric' holds position while nothing fits. That is not a trick to make the
 * oracle green: it is precisely what the holdout was BUILT to demand. Its own
 * header says of CPU-bound regimes, "Nothing on this ladder helps, and the
 * correct behaviour is to stop descending, not to keep paying visual cost for
 * nothing." The greedy instrument was modelling the very controller the corpus
 * exists to catch.
 *
 * Neither strategy dominates the other — 'metric' arrives at a late descent
 * later — so satisfiability is "SOME conforming controller can do it", and
 * `tools/perf-satisfiability.mjs` runs both.
 * ========================================================================== */
export function createClairvoyantPolicy(scenario, { K = PROVISIONAL, chase = 'metric' } = {}) {
  if (!scenario || !scenario.groundTruth || !Array.isArray(scenario.groundTruth.timeline)) {
    throw new TypeError('createClairvoyantPolicy needs a scenario carrying groundTruth.timeline — it reads the capacity model, that is the whole point of it');
  }
  if (chase !== 'metric' && chase !== 'greedy') {
    throw new RangeError(`chase must be 'metric' or 'greedy', got ${JSON.stringify(chase)}`);
  }
  const timeline = scenario.groundTruth.timeline;
  let rung = 0;
  let lastMoveAt = -Infinity;
  let lastProbeAt = -Infinity;
  let probeOutstanding = false;
  let applyFn = null;

  const segmentAt = (tMs) => {
    let seg = timeline[0];
    for (const s of timeline) if (tMs >= s.fromMs) seg = s;
    return seg;
  };

  return {
    label: `clairvoyant(${chase})`,
    start(ctx) { applyFn = ctx.apply; rung = ctx.startProfile.rung | 0; },
    frame(f) {
      if (!applyFn) return;
      rung = f.rung;                      // read BACK off the world, never echoed
      const seg = segmentAt(f.tMs);
      const inert = chase === 'metric' && !seg.anyFits;
      const want = seg.feasibleRung;

      // Resolve an outstanding probe FIRST, always. Leaving one open forever
      // was a real defect in the first version of this instrument: the climb
      // path returned early while a probe was outstanding, so after its first
      // probe it never moved again, scored identically to standing still, and
      // reported the oracle SATISFIABLE. An instrument that cannot move is not
      // an upper bound and its green is an artifact.
      if (probeOutstanding && f.tMs - lastProbeAt >= K.settleHoldMs) {
        const keep = inert ? true : want <= rung;
        applyFn({ kind: keep ? 'probe-keep' : 'probe-rollback', rung: keep ? rung : rung + 1, reason: 'clairvoyant: resolve probe' });
        probeOutstanding = false;
        if (!keep) lastMoveAt = f.tMs;
        return;
      }
      if (probeOutstanding) return;
      if (inert) return;                  // nothing fits: no move changes either metric
      if (want === rung) return;
      if (f.tMs - lastMoveAt < K.settleHoldMs) return;   // PRO-6

      if (want > rung) {
        // Down is the overload path; PRO-8 does not govern it.
        applyFn({ kind: 'downshift', rung: rung + 1, reason: 'clairvoyant: capacity model' });
        lastMoveAt = f.tMs;
        return;
      }
      // Up. PRO-8: at most one optional upgrade probe per 30 s, one outstanding.
      if (f.tMs - lastProbeAt < K.probeIntervalMs) return;
      applyFn({ kind: 'probe', rung: rung - 1, reason: 'clairvoyant: capacity model' });
      lastProbeAt = f.tMs;
      lastMoveAt = f.tMs;
      probeOutstanding = true;
    },
  };
}

/** The two conforming clairvoyant strategies, in the order the gate reports them. */
export const CLAIRVOYANT_STRATEGIES = Object.freeze(['metric', 'greedy']);

/**
 * The registry the corpus's discrimination matrix names policies through.
 * A scenario says `{ policy: 'twitchy', mustFail: ['INV-2'] }` and this is
 * what turns that string into a controller.
 */
export const POLICY_FACTORIES = Object.freeze({
  static: () => createStaticPolicy(),
  thrash: (o) => createThrashPolicy(o),
  twitchy: () => createTwitchyPolicy(),
  'naive-gpu': (o) => createNaiveGpuPolicy(o),
  compat: (o) => createCompatPolicy(o),
  'fire-and-forget': (o) => createFireAndForgetPolicy(o),
  'probe-only': (o) => createProbeOnlyPolicy(o),
  'fixed-0': () => createFixedPolicy(0),
  'fixed-1': () => createFixedPolicy(1),
  'fixed-2': () => createFixedPolicy(2),
});

/** Build a reference policy by name. Throws on an unknown name. */
export function makePolicy(name, opts = {}) {
  const f = POLICY_FACTORIES[name];
  if (!f) throw new RangeError(`Unknown reference policy "${name}". Known: ${Object.keys(POLICY_FACTORIES).join(', ')}.`);
  return f(opts);
}
