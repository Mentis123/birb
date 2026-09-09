/**
 * Red-first oracle for `src/game/gpu-timer.js` — the GPU timer capability probe
 * that Wave 2 (P2.1) will write and Wave 3 will consume.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS BEFORE THE CODE DOES, AND WHY IT IS PARANOID
 * ---------------------------------------------------------------------------
 * `EXT_disjoint_timer_query_webgl2` is exposed by **neither iOS Safari nor
 * headless SwiftShader**. So the module this suite pins will, on the target
 * device and in CI, ship permanently on its unavailable branch — green,
 * unexercised, and reporting nothing. Every automated check that only asks
 * "did it crash?" will pass forever while the feature does not exist.
 *
 * That is not a hypothetical. CLAUDE.md records the same shape twice:
 *   - `isLowEnd = isMobile && (navigator.hardwareConcurrency || 4) <= 4`, where
 *     iOS Safari does not expose `hardwareConcurrency` at all, so the bloom
 *     pass written for this game had never once run on the device the game is
 *     built for; and
 *   - the 55/58 adaptive thresholds, tuned against an FPS sampler whose only
 *     call site was unreachable.
 * Both were green the entire time. "A feature gated on a capability probe is
 * not shipped until you have proof the probe returns what you think it does."
 *
 * The only defence available in CI — where the extension will never be present
 * — is to test the probe against a **fake WebGL context we control**, and to
 * make the UNAVAILABLE path first-class and precisely diagnosable. Hence the
 * central design rule this suite enforces:
 *
 *     "gpuMs is null" is not an acceptable report.
 *     A WIRING BUG MUST BE DISTINGUISHABLE FROM A PLATFORM FACT.
 *
 * `docs/perf/CONTRACT.md` §3.1 makes that a STOP condition, not a preference:
 * `reason: "no-context"` on the GPU timer is a wiring bug wearing a platform
 * fact's clothes, while `reason: "no-extension"` is a legitimate platform fact.
 * GT-A4/GT-A5/GT-A6 are the assertions that keep those three apart, and they
 * are the reason this file is worth more than the module it tests.
 *
 * Scope is `docs/perf/CONTRACT.md` §9 **DEF-2**: the probe only. Query pools,
 * multi-frame read scheduling at scale and disjoint handling "at scale" are
 * deferred until a phone reports the extension present. What is NOT deferred,
 * and is pinned here, is that the one query the probe does issue is read on a
 * later frame, is discarded when disjoint, is cleaned up, and survives a
 * context loss.
 *
 * ---------------------------------------------------------------------------
 * R4 — WHY THE IMPORT IS DYNAMIC AND EVERY TEST IS SKIP-GATED
 * ---------------------------------------------------------------------------
 * A top-level `import` of a not-yet-existing module resolves BEFORE any skip
 * option is evaluated. `npm test` is `node --test` over the whole repository,
 * so a red module graph here would turn `tests.yml` red for `humanoid/`,
 * `gauntlet/`, `sculpture/` and `icon3d/` as well. Every test below therefore
 *   (a) is gated `{ skip: !process.env.BIRB_PERF_IMPL }`, and
 *   (b) does its `import()` INSIDE the test body.
 *
 *   npm test                  -> this suite skips; the repo stays green.
 *   BIRB_PERF_IMPL=1 npm test -> this suite is red, because the module is absent.
 *
 * Red is the correct state until P2.1 lands. Do not weaken an assertion to make
 * it pass, and do not delete the skip gate.
 *
 * This suite is also independent of its siblings: it imports nothing from
 * `tests/frame-metrics-stats.test.js`, `tests/quality-settings.test.js` or
 * `tests/frame-stats-totals.test.js`, so one module's absence cannot fail
 * another's suite.
 *
 * ---------------------------------------------------------------------------
 * THE API THIS SUITE PINS  (Wave 2 P2.1 implements exactly this)
 * ---------------------------------------------------------------------------
 * `src/game/gpu-timer.js` — imports nothing, takes its side effects as injected
 * callbacks, per CONTRACT.md §11 ("a module is unit-testable here ONLY if it
 * imports nothing and takes side effects as injected callbacks"). It never
 * touches `document`, `window`, `navigator` or a renderer; the GL context
 * arrives through `getContext`.
 *
 *   export const GPU_TIMER_EXTENSION = 'EXT_disjoint_timer_query_webgl2';
 *   export const GPU_TIMER_STATES            // closed, ordered, 5 members
 *   export const GPU_TIMER_CAPABILITY_STATES // closed, ordered, 4 members
 *   export const GPU_SAMPLE_CAPACITY         // fixed ring capacity, integer >= 1
 *   export const GPU_QUERY_TIMEOUT_FRAMES    // provisional; see below
 *
 *   export function createGpuTimer({ getContext }) -> {
 *     capability() -> { state, reason, available }
 *     beginFrame(frameId), endFrame(frameId), poll(frameId)
 *     read()     -> reading      // last accepted GPU time, in MILLISECONDS
 *     meanMs()   -> reading      // mean of accepted samples in the ring
 *     counters() -> { created, deleted, inFlight, accepted, discarded }
 *     onContextLost(), onContextRestored(), dispose(),
 *     __buffers() -> { samples: <the LIVE internal array> }
 *   }
 *
 * A "reading" is the sentinel-capable shape from CONTRACT.md §3.1, so the panel
 * can forward it without inventing a plausible zero:
 *
 *     { value: number|null, state: 'ok'|'unavailable', reason: string|null }
 *
 * `__buffers()` exists for the same reason it exists in the sibling
 * frame-metrics suite: a structural bounded-memory check that cannot reach the
 * buffers passes vacuously, and R8 says a check nobody has watched fail is not
 * a check. See GT-A19.
 *
 * ---------------------------------------------------------------------------
 * THE CLOSED ENUM, AND WHY IT IS SPLIT IN TWO
 * ---------------------------------------------------------------------------
 * The task's enum is five members: `no-extension | no-context | not-webgl2 |
 * disjoint | ok`. Four of those are properties of the *capability* — they are
 * true for the whole session until the context changes. `disjoint` is not: it
 * is a property of ONE RESULT. A driver that returns a disjoint result on one
 * frame is still a driver with a working timer extension.
 *
 * Collapsing the two would force exactly the failure this programme exists to
 * prevent: a single latched `state` that says `disjoint` forever after one bad
 * frame is indistinguishable, in a log, from a platform that has no extension.
 * So:
 *
 *   GPU_TIMER_CAPABILITY_STATES = ['ok','no-context','not-webgl2','no-extension']
 *   GPU_TIMER_STATES            = the four above, plus 'disjoint'
 *
 * `capability().state` is drawn from the first; a reading's `reason` is drawn
 * from `GPU_TIMER_STATES` minus 'ok', plus `'insufficient-samples'` (which is
 * already in CONTRACT.md §3.1's reason enum and means "the probe works, no
 * result has landed yet"). GT-A2 pins both sets and their relationship; GT-A7
 * pins that a probe failure never masquerades as `insufficient-samples`.
 *
 * **Contract note for G1.** `not-webgl2` is NOT in CONTRACT.md §3.1's reason
 * list today. It is commissioned by this task ("a CLOSED enum: no-extension |
 * no-context | not-webgl2 | disjoint | ok") and it is load-bearing: a WebGL1
 * context handed to a WebGL2 probe is a *wiring* bug, and reporting it as
 * `no-extension` would file it under "platform fact" — the exact laundering the
 * STOP condition exists to stop. Per §"Amendment rule" a wave may ADD rows, so
 * Wave 2 adds `not-webgl2` to the §3.1 reason enum for TEL-5 in the same commit
 * as the module. It changes no comparator, sentinel or precedence.
 *
 * ---------------------------------------------------------------------------
 * PRECEDENCE OF THE UNAVAILABLE REASONS — PINNED
 * ---------------------------------------------------------------------------
 *     no-context   >   not-webgl2   >   no-extension
 *
 * Every one of these is true at once for a null context, and a WebGL1 context
 * also genuinely lacks `EXT_disjoint_timer_query_webgl2`. Without a pinned
 * precedence, three different implementations report three different reasons
 * for the same fault, and the STOP condition ("`no-context` means STOP,
 * `no-extension` means the platform") becomes unenforceable. Most-specific
 * wiring fault first, platform fact last. GT-A4/A5/A6 pin each rung.
 *
 * ---------------------------------------------------------------------------
 * THE FRAME MODEL — "READ ON A LATER FRAME" MADE MECHANICAL
 * ---------------------------------------------------------------------------
 * `beginFrame`, `endFrame` and `poll` all take an integer `frameId` that the
 * caller increments once per rendered frame. The module MUST NOT read the
 * result of a query whose issuing frameId equals the current one, regardless of
 * the order the three calls arrive in.
 *
 * This is pinned mechanically (GT-A8: zero `getQueryParameter` calls on the
 * issuing frame) rather than by wall-clock, because the failure it guards
 * against is a synchronous same-frame `getQueryParameter(QUERY_RESULT)`, which
 * stalls the pipeline and destroys the very frame time being measured. That
 * defect cannot be seen in the returned number — the number looks fine. It can
 * only be seen in the SEQUENCE OF CALLS, which is why this suite fakes the
 * context entirely and asserts on the call log rather than on return values
 * alone.
 *
 * ---------------------------------------------------------------------------
 * UNITS — PINNED
 * ---------------------------------------------------------------------------
 * `EXT_disjoint_timer_query_webgl2` returns NANOSECONDS. Every reading this
 * module emits is MILLISECONDS, because that is the unit of every other number
 * in this programme (PRO-1 "p95 interval > 1.2 x B", PRO-10 "p95 <= 18.5 ms",
 * CONTRACT.md TEL-2/TEL-4). GT-A9 pins the conversion with a value chosen so a
 * wrong divisor cannot coincide: 4,500,000 ns -> 4.5 ms. A factor-of-1000 error
 * here would put a healthy phone permanently in emergency downshift.
 *
 * ---------------------------------------------------------------------------
 * THE ONE PROVISIONAL NUMBER, AND HOW IT IS TESTED
 * ---------------------------------------------------------------------------
 * A query that never reports available (a driver that silently drops it) must
 * not block timing forever. `GPU_QUERY_TIMEOUT_FRAMES` bounds that wait. Its
 * VALUE is `unmeasured` in CONTRACT.md §10's sense, so GT-A20 asserts the
 * BEHAVIOUR parameterised on the exported constant and never against a literal
 * — §10 rule 1: "traces are authored as capacity models parameterised on the
 * threshold, not as arrays baked against one." Wave 2 chooses the number;
 * Wave 4 may change it without touching this file.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FAKE CONTEXT MODELS, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 * Modelled: WebGL2 query objects; `getExtension` by exact name; availability
 * and result as separate reads; `GPU_DISJOINT_EXT` via `getParameter`; context
 * loss (`isContextLost()` true, `createQuery` returns null); a fresh context
 * object on restore.
 *
 * NOT modelled: `GPU_DISJOINT_EXT`'s real latch-and-clear-on-read semantics.
 * The fake holds the flag until the fixture clears it. Clearing on read would
 * make a correct implementation that happens to read the flag twice per result
 * fail — an over-strict oracle, and a wrong oracle is worse than none here,
 * because a cheap agent cannot tell "my code is wrong" from "my oracle is
 * wrong". GT-A14 therefore asserts the flag is consulted AT LEAST once per
 * consumed result and says nothing about ordering beyond that.
 *
 * ---------------------------------------------------------------------------
 * R8 — THESE ASSERTIONS HAVE BEEN WATCHED FAILING
 * ---------------------------------------------------------------------------
 * "An assertion nobody has watched fail is not an oracle, it is a hope."
 * Authoring this suite included writing a throwaway reference implementation of
 * the API above OUTSIDE the repository (never committed), confirming all 19 test
 * blocks pass against it, and then mutating that implementation one defect at a
 * time. Every mutant below exited 1 and turned exactly the listed assertions red.
 * (GT-A1 is the loader guard rather than a test block of its own; every other
 * assertion runs through it.)
 *
 *   mutant          defect introduced                                   flipped
 *   nocontextfirst  a null context reported as 'no-extension'           A4
 *   webgl1asnoext   a WebGL1 context reported as 'no-extension'         A5
 *   anyextname      accepts the WebGL1 ext name on a WebGL2 context     A6
 *   nodatareason    probe failure reported as 'insufficient-samples'    A4 A7 A15 A17
 *   sameframe       reads the query on its own issuing frame            A8
 *   nanoseconds     forwards raw ns as if it were ms                    A8 A9 A12 A13 A16 A20
 *   multiquery      issues a query per frame regardless of the pending  A10
 *   noleakfree      never calls deleteQuery                             A11 A13 A15 A20
 *   ignoredisjoint  never reads GPU_DISJOINT_EXT                        A12 A13 A14
 *   servelast       a disjoint frame re-serves the last good value      A12
 *   averagedirty    the disjoint sample enters the mean                 A13
 *   readafterloss   polls the pre-loss query after context loss         A15
 *   leakonloss      the in-flight query is never released on loss       A11 A13 A15 A20
 *   cachedext       capability cached across restore, never re-probed   A16 A17
 *   ambientcanvas   falls back to a canvas when getContext is missing   A18
 *   unbounded       the sample ring grows without limit                 A19
 *   nobuffers       __buffers() returns {} (the vacuity case)           A19
 *   nevertimeout    a stuck query blocks all future timing              A20
 *
 * Two things the exercise taught that were NOT visible from reading the file,
 * and which are the argument for doing it rather than asserting it was done:
 *
 *  1. `multiquery` flips GT-A10 ALONE. The prediction while drafting was that an
 *     implementation issuing a query every frame would also trip the leak and
 *     bounded-memory checks — it does not, because it still deletes every query
 *     it consumes. So GT-A10 is the SOLE guard on "at most one in flight", and
 *     weakening it leaves that requirement with no oracle at all. Nothing else
 *     covers it.
 *  2. Ordering inside `probe()` is load-bearing and is caught by exactly one
 *     line: GT-A5's `getExtension` call-count check. `webgl1asnoext` still
 *     returns a plausible reason, still reports `available: false`, and still
 *     behaves identically for the whole rest of the session — the ONLY
 *     observable difference between the wiring bug and the platform fact is the
 *     reason string and the call log.
 *
 * No assertion in this file was weakened to make a mutant or the reference pass.
 * GT-A15 was written from the start to permit `isContextLost()` and
 * `deleteQuery()` on a lost context and to forbid only the four calls that are
 * genuinely wrong, because an over-strict oracle fails correct code and a cheap
 * agent cannot tell that from its own bug.
 *
 * ---------------------------------------------------------------------------
 * ASSERTION IDS
 * ---------------------------------------------------------------------------
 * Ids are `GT-A<n>`, NOT bare `A<n>`. CONTRACT.md §12 keys the `A-n` namespace
 * to that document's §4 harness table (A1-A12, of which A2/A6/A7 are pinned by
 * the wave workflow), so a bare `A6` here would collide inside a binding
 * namespace. Each id below cites the CONTRACT.md row it derives from.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const IMPL = !!process.env.BIRB_PERF_IMPL;
const gate = { skip: !IMPL ? 'set BIRB_PERF_IMPL=1 to run the Wave 2 GPU-timer oracle' : false };

const MODULE_PATH = '../src/game/gpu-timer.js';

const REQUIRED_EXPORTS = [
  'createGpuTimer',
  'GPU_TIMER_EXTENSION',
  'GPU_TIMER_STATES',
  'GPU_TIMER_CAPABILITY_STATES',
  'GPU_SAMPLE_CAPACITY',
  'GPU_QUERY_TIMEOUT_FRAMES',
];

/**
 * GT-A1. Load the module, and fail with the ONE message that distinguishes
 * "the module has not been written yet" (the expected Wave 1 red) from "the
 * module exists and blew up" (a real regression). Unlike the sibling
 * frame-metrics suite, `src/game/gpu-timer.js` does not exist at all today, so
 * the expected red is a resolution failure — but once P2.1 lands, this same
 * function is what keeps a later import-time crash from being mistaken for
 * "not implemented yet".
 *
 * Derives from CONTRACT.md §3.2 TEL-5 and §9 DEF-2.
 */
async function loadGpuTimer() {
  let mod;
  try {
    mod = await import(MODULE_PATH);
  } catch (err) {
    const msg = String((err && err.message) || err);
    const absent = /Cannot find module|ERR_MODULE_NOT_FOUND/i.test(msg);
    assert.fail(
      absent
        ? `[GT-A1] src/game/gpu-timer.js does not exist yet. This is the CORRECT state ` +
          `until ULTRACODE §4 Wave 2 P2.1 lands (CONTRACT.md TEL-5 / DEF-2). This suite is ` +
          `the oracle P2.1 is written against, not a report of a broken build. (${msg})`
        : `[GT-A1] src/game/gpu-timer.js EXISTS and failed to load: ${msg}. That is NOT the ` +
          `expected Wave 1 red — the expected red is "the module is absent". Fix the module.`
    );
  }
  const missing = REQUIRED_EXPORTS.filter((name) => mod[name] === undefined);
  if (missing.length > 0) {
    assert.fail(
      `[GT-A1] src/game/gpu-timer.js does not export the probe API required by ` +
      `ULTRACODE §4 Wave 2 P2.1 (CONTRACT.md TEL-5, DEF-2). Missing: ${missing.join(', ')}.`
    );
  }
  return mod;
}

/* =========================================================================
 * THE FAKE WebGL CONTEXT
 *
 * Every call the module makes is appended to a shared log as a string, so the
 * assertions can talk about the SEQUENCE of calls and not only about return
 * values. Entries are `<tag>:<op>[:<detail>]`, e.g.
 *   gl0:getExtension:EXT_disjoint_timer_query_webgl2
 *   gl0:beginQuery:q1
 *   gl0:getQueryParameter:q1:AVAILABLE
 * The `<tag>` distinguishes the pre-loss context from the post-restore one,
 * which is what makes GT-A15/GT-A16 expressible at all.
 * ========================================================================= */

const GL_QUERY_RESULT_AVAILABLE = 0x8867;
const GL_QUERY_RESULT = 0x8866;
const EXT_TIME_ELAPSED = 0x88bf;
const EXT_GPU_DISJOINT = 0x8fbb;

/** The name a WebGL2 probe must ask for. A typo here is a silent 'no-extension'. */
const WEBGL2_EXT_NAME = 'EXT_disjoint_timer_query_webgl2';
/** The WebGL1 name. Present on a WebGL1 context; must NOT satisfy a WebGL2 probe. */
const WEBGL1_EXT_NAME = 'EXT_disjoint_timer_query';

/**
 * @param {object} opts
 * @param {string[]} opts.log            shared call log (mutated)
 * @param {string}   [opts.tag]          identity of this context in the log
 * @param {boolean}  [opts.webgl2]       false => a WebGL1-shaped object (no query API)
 * @param {string[]} [opts.extNames]     names `getExtension` will satisfy
 */
function createFakeGl({ log, tag = 'gl0', webgl2 = true, extNames = [WEBGL2_EXT_NAME] }) {
  const state = {
    lost: false,
    disjoint: false,
    nextId: 1,
    // id -> { deleted, begun, ended, available, resultNs }
    queries: new Map(),
    openQuery: null,   // begun and not yet ended
    lastEnded: null,   // most recently ended, not yet consumed by the fixture
  };

  const rec = (op, detail) => {
    log.push(detail === undefined ? `${tag}:${op}` : `${tag}:${op}:${detail}`);
  };

  const ext = {
    TIME_ELAPSED_EXT: EXT_TIME_ELAPSED,
    GPU_DISJOINT_EXT: EXT_GPU_DISJOINT,
  };

  const gl = {
    __tag: tag,
    __state: state,
    QUERY_RESULT_AVAILABLE: GL_QUERY_RESULT_AVAILABLE,
    QUERY_RESULT: GL_QUERY_RESULT,

    isContextLost() {
      rec('isContextLost');
      return state.lost;
    },

    getExtension(name) {
      rec('getExtension', name);
      if (state.lost) return null;
      return extNames.includes(name) ? ext : null;
    },

    getParameter(pname) {
      rec('getParameter', pname === EXT_GPU_DISJOINT ? 'GPU_DISJOINT_EXT' : String(pname));
      if (state.lost) return null;
      if (pname === EXT_GPU_DISJOINT) return state.disjoint;
      return null;
    },
  };

  if (webgl2) {
    gl.createQuery = () => {
      if (state.lost) { rec('createQuery', 'null(lost)'); return null; }
      const id = `q${state.nextId++}`;
      state.queries.set(id, { id, deleted: false, begun: false, ended: false, available: false, resultNs: 0 });
      rec('createQuery', id);
      return { __id: id };
    };
    gl.deleteQuery = (q) => {
      const id = q && q.__id;
      rec('deleteQuery', id || 'null');
      const entry = state.queries.get(id);
      if (entry) entry.deleted = true;
      if (state.openQuery === id) state.openQuery = null;
      if (state.lastEnded === id) state.lastEnded = null;
    };
    gl.beginQuery = (target, q) => {
      const id = q && q.__id;
      rec('beginQuery', id || 'null');
      if (target !== EXT_TIME_ELAPSED) {
        throw new Error(`fake gl: beginQuery target ${target} is not TIME_ELAPSED_EXT`);
      }
      const entry = state.queries.get(id);
      if (entry) entry.begun = true;
      state.openQuery = id;
    };
    gl.endQuery = (target) => {
      rec('endQuery', state.openQuery || 'null');
      if (target !== EXT_TIME_ELAPSED) {
        throw new Error(`fake gl: endQuery target ${target} is not TIME_ELAPSED_EXT`);
      }
      const entry = state.queries.get(state.openQuery);
      if (entry) entry.ended = true;
      state.lastEnded = state.openQuery;
      state.openQuery = null;
    };
    gl.getQueryParameter = (q, pname) => {
      const id = q && q.__id;
      const which = pname === GL_QUERY_RESULT_AVAILABLE ? 'AVAILABLE'
        : pname === GL_QUERY_RESULT ? 'RESULT'
        : String(pname);
      rec('getQueryParameter', `${id || 'null'}:${which}`);
      if (state.lost) return null;
      const entry = state.queries.get(id);
      if (!entry) return null;
      if (which === 'AVAILABLE') return entry.available;
      if (which === 'RESULT') return entry.resultNs;
      return null;
    };
  }

  /* ---- fixture-side controls (never called by the module) ---- */

  /** Mark the most recently ended query as available, with a result in NANOSECONDS. */
  gl.__complete = (resultNs) => {
    const id = state.lastEnded;
    if (!id) throw new Error('fake gl: __complete called with no ended query');
    const entry = state.queries.get(id);
    entry.available = true;
    entry.resultNs = resultNs;
    return id;
  };
  gl.__setDisjoint = (v) => { state.disjoint = !!v; };
  gl.__lose = () => { state.lost = true; };
  /** created minus deleted, as the CONTEXT sees it — an independent leak count. */
  gl.__liveQueries = () => {
    let n = 0;
    for (const entry of state.queries.values()) if (!entry.deleted) n += 1;
    return n;
  };
  gl.__createdCount = () => state.queries.size;

  return gl;
}

/** A log filter that keeps only entries for one context tag. */
const forTag = (log, tag) => log.filter((line) => line.startsWith(`${tag}:`));
/** Entries whose op matches, for one context tag. */
const opsOf = (log, tag, op) => forTag(log, tag).filter((line) => line.startsWith(`${tag}:${op}`));

/**
 * The canonical per-frame driver: poll the previous frame's query, then issue
 * this frame's. Returns the frameId used, so callers can keep counting.
 */
function runFrame(timer, frameId) {
  timer.poll(frameId);
  timer.beginFrame(frameId);
  timer.endFrame(frameId);
  return frameId;
}

/** Independent mean, by reduce. Never uses the module's own helper. */
function refMean(values) {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Build a healthy timer over a healthy fake context. */
async function healthyTimer() {
  const { createGpuTimer } = await loadGpuTimer();
  const log = [];
  let gl = createFakeGl({ log, tag: 'gl0' });
  const timer = createGpuTimer({ getContext: () => gl });
  return { timer, gl, log, swapContext: (next) => { gl = next; } };
}

/* =========================================================================
 * GT-A2 — the closed enum
 * ========================================================================= */

test('GT-A2 the state enum is closed, ordered, and split capability-vs-result', gate, async () => {
  const mod = await loadGpuTimer();
  const { GPU_TIMER_STATES, GPU_TIMER_CAPABILITY_STATES, GPU_TIMER_EXTENSION } = mod;

  assert.deepEqual(
    GPU_TIMER_CAPABILITY_STATES,
    ['ok', 'no-context', 'not-webgl2', 'no-extension'],
    '[GT-A2] capability states must be exactly these four, in precedence order ' +
    '(no-context > not-webgl2 > no-extension). CONTRACT.md §3.1 makes no-context a STOP ' +
    'and no-extension a platform fact; an unpinned order lets one be filed as the other.'
  );

  assert.deepEqual(
    GPU_TIMER_STATES,
    ['ok', 'no-context', 'not-webgl2', 'no-extension', 'disjoint'],
    '[GT-A2] the full enum is the capability states plus `disjoint`, which is a property ' +
    'of ONE RESULT and never of the capability.'
  );

  // The two sets must agree by construction, not by two hand-maintained literals.
  assert.deepEqual(
    GPU_TIMER_STATES.slice(0, GPU_TIMER_CAPABILITY_STATES.length),
    GPU_TIMER_CAPABILITY_STATES,
    '[GT-A2] GPU_TIMER_STATES must be a prefix-extension of GPU_TIMER_CAPABILITY_STATES.'
  );
  assert.equal(new Set(GPU_TIMER_STATES).size, GPU_TIMER_STATES.length,
    '[GT-A2] the enum must not contain duplicates.');
  assert.equal(GPU_TIMER_EXTENSION, WEBGL2_EXT_NAME,
    `[GT-A2] the probed extension name must be exactly "${WEBGL2_EXT_NAME}". ` +
    'A typo in this string is indistinguishable, in every log this programme will ever ' +
    'produce, from a platform that does not have the extension.');
});

/* =========================================================================
 * GT-A3 — the available path, and the exact extension name asked for
 * ========================================================================= */

test('GT-A3 a WebGL2 context with the extension probes as ok, by exact name', gate, async () => {
  const { timer, log } = await healthyTimer();
  const cap = timer.capability();

  assert.deepEqual(cap, { state: 'ok', reason: null, available: true },
    '[GT-A3] a WebGL2 context exposing EXT_disjoint_timer_query_webgl2 must probe as ' +
    '{state:"ok", reason:null, available:true}. `reason` is null on success so the panel ' +
    'can forward the reading shape from CONTRACT.md §3.1 unchanged.');

  const asked = opsOf(log, 'gl0', 'getExtension');
  assert.ok(asked.includes(`gl0:getExtension:${WEBGL2_EXT_NAME}`),
    `[GT-A3] the probe must call getExtension("${WEBGL2_EXT_NAME}"). Log: ${JSON.stringify(asked)}`);
  assert.ok(asked.length <= 2,
    `[GT-A3] the probe must not sweep getExtension for candidate names (${asked.length} calls). ` +
    'A sweep hides which name actually succeeded, which is the fact Wave 4 has to report ' +
    'from a phone.');
});

/* =========================================================================
 * GT-A4 / GT-A5 / GT-A6 — the three unavailable reasons, kept apart
 *
 * These three assertions are the point of this file. CONTRACT.md §3.1:
 * "`reason: "no-context"` on the GPU timer is a STOP condition, not a result."
 * ========================================================================= */

test('GT-A4 a null context is no-context (a STOP), and nothing is probed on it', gate, async () => {
  const { createGpuTimer } = await loadGpuTimer();
  const log = [];
  const timer = createGpuTimer({ getContext: () => null });

  assert.deepEqual(timer.capability(), { state: 'no-context', reason: 'no-context', available: false },
    '[GT-A4] getContext() returning null must report reason "no-context" — NOT "no-extension". ' +
    'CONTRACT.md §3.1 and ULTRACODE §4 Wave 3 make this a STOP: it is a wiring bug wearing a ' +
    'platform fact\'s clothes, the hardwareConcurrency/bloom trap exactly. Filing it as ' +
    '"no-extension" is how the bug survives a Wave 4 device session.');

  assert.deepEqual(timer.read(), { value: null, state: 'unavailable', reason: 'no-context' },
    '[GT-A4] the reading must carry the same reason. "gpuMs is null" is not an acceptable report.');

  // Frames must be harmless, and must not conjure a context out of anywhere.
  for (let f = 1; f <= 5; f += 1) runFrame(timer, f);
  assert.equal(log.length, 0,
    `[GT-A4] no GL calls are possible without a context; log was ${JSON.stringify(log)}.`);
  assert.equal(timer.counters().created, 0, '[GT-A4] no queries may be created without a context.');
});

test('GT-A5 a WebGL1 context is not-webgl2, not no-context and not no-extension', gate, async () => {
  const { createGpuTimer } = await loadGpuTimer();
  const log = [];
  // WebGL1 shape: it is a real, live context — it simply has no query API.
  // It even offers the WebGL1 timer extension, which is the tempting wrong answer.
  const gl = createFakeGl({ log, tag: 'gl1', webgl2: false, extNames: [WEBGL1_EXT_NAME] });
  const timer = createGpuTimer({ getContext: () => gl });

  const cap = timer.capability();
  assert.deepEqual(cap, { state: 'not-webgl2', reason: 'not-webgl2', available: false },
    '[GT-A5] a WebGL1 context must report "not-webgl2". Reporting "no-context" is wrong ' +
    '(the context is live), and reporting "no-extension" is worse: it files a WIRING bug — ' +
    'the page handed the probe the wrong context — under "platform fact", which is precisely ' +
    'the laundering CONTRACT.md §3.1\'s STOP condition exists to prevent.');

  assert.equal(opsOf(log, 'gl1', 'getExtension').length, 0,
    `[GT-A5] the WebGL2 shape check must run BEFORE getExtension; asking a WebGL1 context ` +
    `for a WebGL2 extension and reporting the null is how "not-webgl2" degrades into ` +
    `"no-extension". Log: ${JSON.stringify(forTag(log, 'gl1'))}`);
});

test('GT-A6 a WebGL2 context without the extension is no-extension (a platform fact)', gate, async () => {
  const { createGpuTimer } = await loadGpuTimer();

  // (a) nothing at all.
  const logA = [];
  const glA = createFakeGl({ log: logA, tag: 'glA', webgl2: true, extNames: [] });
  const timerA = createGpuTimer({ getContext: () => glA });
  assert.deepEqual(timerA.capability(), { state: 'no-extension', reason: 'no-extension', available: false },
    '[GT-A6] a WebGL2 context that does not expose the extension is the EXPECTED state on ' +
    'iOS Safari and on headless SwiftShader. It is a legitimate platform fact and must be ' +
    'reported as one — this is the branch the shipped build will live on forever.');
  assert.ok(opsOf(logA, 'glA', 'getExtension').length >= 1,
    '[GT-A6] the extension must actually have been asked for before it is declared absent.');

  // (b) the wrong-name trap: only the WebGL1 name is offered.
  const logB = [];
  const glB = createFakeGl({ log: logB, tag: 'glB', webgl2: true, extNames: [WEBGL1_EXT_NAME] });
  const timerB = createGpuTimer({ getContext: () => glB });
  assert.equal(timerB.capability().state, 'no-extension',
    `[GT-A6] a WebGL2 context that offers only "${WEBGL1_EXT_NAME}" must NOT probe as ok. ` +
    'The WebGL1 extension has a different query API; accepting it here produces a timer that ' +
    'compiles, probes green and returns garbage.');

  // (c) and the ok case is genuinely discriminated from (a) and (b).
  const logC = [];
  const glC = createFakeGl({ log: logC, tag: 'glC', webgl2: true, extNames: [WEBGL2_EXT_NAME] });
  assert.equal(createGpuTimer({ getContext: () => glC }).capability().state, 'ok',
    '[GT-A6] ...and the discriminator is alive: the same fake with the right name probes ok. ' +
    'Without this line, an implementation that returns "no-extension" unconditionally passes ' +
    '(a) and (b). CONTRACT.md §5.2 SC-DPR is the same lesson: a dead check and a passing check ' +
    'look identical in a log.');
});

/* =========================================================================
 * GT-A7 — an unavailable probe never masquerades as "no data yet"
 * ========================================================================= */

test('GT-A7 when the probe failed, the reading carries the probe reason forever', gate, async () => {
  const { createGpuTimer } = await loadGpuTimer();
  const log = [];
  const gl = createFakeGl({ log, tag: 'gl0', webgl2: true, extNames: [] });
  const timer = createGpuTimer({ getContext: () => gl });

  for (let f = 1; f <= 120; f += 1) runFrame(timer, f);

  const reading = timer.read();
  assert.deepEqual(reading, { value: null, state: 'unavailable', reason: 'no-extension' },
    '[GT-A7] a probe failure must never be reported as "insufficient-samples". Those two mean ' +
    'opposite things to Wave 4: "the platform cannot do this" versus "wait a moment". ' +
    'Conflating them is how a permanently dead feature reads as a warming-up one.');

  assert.equal(timer.counters().created, 0,
    '[GT-A7] no query may be created when the extension is absent — 120 frames of begin/end ' +
    'must be free. This branch IS the shipping branch on iOS Safari and in CI.');
  assert.equal(opsOf(log, 'gl0', 'beginQuery').length, 0,
    '[GT-A7] beginQuery must not be attempted without the extension.');
  assert.deepEqual(timer.meanMs(), { value: null, state: 'unavailable', reason: 'no-extension' },
    '[GT-A7] the mean carries the same reason, not a plausible 0. CONTRACT.md §3.1 lists 0 as ' +
    'a forbidden sentinel substitute.');
});

/* =========================================================================
 * GT-A8 — read on a LATER frame, never the frame it was issued
 * ========================================================================= */

test('GT-A8 a query is never read on the frame that issued it', gate, async () => {
  const { timer, gl, log } = await healthyTimer();

  timer.beginFrame(1);
  timer.endFrame(1);
  gl.__complete(4_500_000);      // the driver says "done" IMMEDIATELY — the tempting case
  timer.poll(1);                 // same frameId: must not read

  assert.equal(opsOf(log, 'gl0', 'getQueryParameter').length, 0,
    '[GT-A8] zero getQueryParameter calls are permitted on the issuing frame, even when the ' +
    'result is already available. A same-frame read is a synchronous pipeline stall that ' +
    'destroys the very frame time being measured — and the returned NUMBER looks perfectly ' +
    'fine, so this defect is invisible except in the call sequence. ' +
    `Log: ${JSON.stringify(forTag(log, 'gl0'))}`);

  assert.deepEqual(timer.read(), { value: null, state: 'unavailable', reason: 'insufficient-samples' },
    '[GT-A8] and until a later frame consumes it, the reading is "insufficient-samples" — the ' +
    'probe works, no result has landed. Distinct from every capability reason (GT-A7).');

  timer.poll(2);
  assert.ok(opsOf(log, 'gl0', 'getQueryParameter').length >= 1,
    '[GT-A8] on a LATER frame the result must actually be collected; a timer that never reads ' +
    'is indistinguishable from an absent extension in every downstream report.');
  assert.equal(timer.read().value, 4.5, '[GT-A8] and the value lands once collected.');
});

/* =========================================================================
 * GT-A9 — nanoseconds to milliseconds
 * ========================================================================= */

test('GT-A9 results convert ns -> ms exactly', gate, async () => {
  const { timer, gl } = await healthyTimer();

  runFrame(timer, 1);
  gl.__complete(4_500_000);      // 4.5 ms
  timer.poll(2);

  assert.deepEqual(timer.read(), { value: 4.5, state: 'ok', reason: null },
    '[GT-A9] EXT_disjoint_timer_query_webgl2 returns NANOSECONDS; every number in this ' +
    'programme is milliseconds (PRO-1, PRO-10, TEL-2, TEL-4). 4,500,000 is chosen so no wrong ' +
    'divisor coincides: /1e6 = 4.5, /1e3 = 4500, /1 = 4500000. A factor-of-1000 error here ' +
    'puts a healthy phone in permanent emergency downshift.');

  // A second, different value, so an implementation cannot pass by returning a constant.
  timer.beginFrame(3); timer.endFrame(3);
  gl.__complete(12_000_000);
  timer.poll(4);
  assert.equal(timer.read().value, 12,
    '[GT-A9] ...and the reading tracks each new result rather than latching the first.');
});

/* =========================================================================
 * GT-A10 / GT-A11 — at most one in flight, and everything is cleaned up
 * ========================================================================= */

test('GT-A10 at most one query is in flight', gate, async () => {
  const { timer, gl, log } = await healthyTimer();

  timer.beginFrame(1);
  timer.endFrame(1);
  // Frame 2 arrives with frame 1 still outstanding (nothing completed it).
  timer.poll(2);
  timer.beginFrame(2);
  timer.endFrame(2);
  timer.poll(3);
  timer.beginFrame(3);
  timer.endFrame(3);

  assert.equal(timer.counters().inFlight, 1,
    '[GT-A10] exactly one query may be outstanding. DEF-2 defers query POOLS until a phone ' +
    'reports the extension present; until then a second concurrent query is not a feature, it ' +
    'is an unbounded leak on a driver that is slow to signal availability.');
  assert.equal(gl.__createdCount(), 1,
    `[GT-A10] the context itself must have seen exactly one createQuery. ` +
    `Log: ${JSON.stringify(opsOf(log, 'gl0', 'createQuery'))}`);
  assert.equal(opsOf(log, 'gl0', 'beginQuery').length, 1,
    '[GT-A10] and beginQuery must not be re-entered while a query is open — nesting ' +
    'TIME_ELAPSED queries is a GL error, not a measurement.');
});

test('GT-A11 every query is deleted; the leak count stays bounded and ends at zero', gate, async () => {
  const { timer, gl, log } = await healthyTimer();

  // 300 frames of the healthy cycle: issue, complete, collect.
  for (let f = 1; f <= 300; f += 1) {
    timer.poll(f);
    timer.beginFrame(f);
    timer.endFrame(f);
    gl.__complete(5_000_000 + f);
    assert.ok(gl.__liveQueries() <= 1,
      `[GT-A11] at frame ${f} the context held ${gl.__liveQueries()} undeleted queries. ` +
      'Created-minus-deleted must never exceed 1 at ANY point, not merely at the end — a leak ' +
      'that is tidied up in a teardown hook is still a leak during play.');
  }
  timer.poll(301);

  const c = timer.counters();
  assert.ok(c.created >= 100,
    `[GT-A11] the soak must actually have exercised the query path (created ${c.created}).`);
  assert.equal(c.created - c.deleted, c.inFlight,
    '[GT-A11] the module\'s own accounting must balance: created - deleted === inFlight.');
  assert.equal(
    opsOf(log, 'gl0', 'createQuery').length - opsOf(log, 'gl0', 'deleteQuery').length,
    c.inFlight,
    '[GT-A11] ...and it must agree with what the CONTEXT saw. The counters are the module ' +
    'marking its own homework; the call log is the independent oracle.');

  timer.dispose();
  assert.equal(gl.__liveQueries(), 0,
    '[GT-A11] dispose() must release the outstanding query. A context that outlives the timer ' +
    'with a query attached is the leak this assertion exists for.');
  assert.equal(timer.counters().inFlight, 0, '[GT-A11] and inFlight returns to zero.');
});

/* =========================================================================
 * GT-A12 / GT-A13 / GT-A14 — disjoint results are DISCARDED, not averaged in
 * ========================================================================= */

test('GT-A12 a disjoint result is discarded and does not re-serve the last good value', gate, async () => {
  const { timer, gl } = await healthyTimer();

  runFrame(timer, 1);
  gl.__complete(4_500_000);
  timer.poll(2);
  assert.equal(timer.read().value, 4.5, '[GT-A12] precondition: a good sample landed.');

  timer.beginFrame(3); timer.endFrame(3);
  gl.__complete(999_000_000);     // a wild number, as a disjoint result typically is
  gl.__setDisjoint(true);
  timer.poll(4);

  assert.deepEqual(timer.read(), { value: null, state: 'unavailable', reason: 'disjoint' },
    '[GT-A12] a disjoint result means the GPU timer was interrupted — the number is garbage. ' +
    'It must be DISCARDED and reported as such. Two forbidden alternatives, both listed in ' +
    'CONTRACT.md §3.1: serving 999 as if it were a measurement, and silently re-serving the ' +
    'previous frame\'s 4.5 ("the previous frame\'s value" is a named forbidden sentinel ' +
    'substitute, because a stuck reading is indistinguishable from a stable one).');

  const c = timer.counters();
  assert.equal(c.discarded, 1, '[GT-A12] the discard must be COUNTED, not merely dropped — ' +
    'a device session that discards every result is a finding, and an uncounted discard is ' +
    'invisible in the evidence export.');
  assert.equal(c.accepted, 1, '[GT-A12] and the accepted count must not have moved.');
});

test('GT-A13 a disjoint sample never enters the mean', gate, async () => {
  const { timer, gl } = await healthyTimer();
  const good = [];

  // good, disjoint, good
  runFrame(timer, 1); gl.__complete(4_500_000); timer.poll(2); good.push(4.5);

  timer.beginFrame(3); timer.endFrame(3);
  gl.__complete(999_000_000); gl.__setDisjoint(true); timer.poll(4);

  gl.__setDisjoint(false);
  timer.beginFrame(5); timer.endFrame(5); gl.__complete(5_500_000); timer.poll(6); good.push(5.5);

  const expected = refMean(good);   // computed here, by reduce, from the fixture — not by the module
  assert.deepEqual(timer.meanMs(), { value: expected, state: 'ok', reason: null },
    `[GT-A13] the mean must be over ACCEPTED samples only (${expected}). Including the ` +
    'disjoint 999 gives 336.33..., which would read as a catastrophically slow GPU and would ' +
    'trigger an emergency downshift on a device that is fine. "Discard disjoint results" is a ' +
    'literal requirement of PERFORMANCE_REALISM_PLAN.md\'s state-machine step 1 (SM-1).');

  assert.equal(timer.counters().accepted, good.length, '[GT-A13] two samples accepted.');
  assert.equal(timer.counters().discarded, 1, '[GT-A13] one discarded.');
  assert.equal(gl.__liveQueries(), 0,
    '[GT-A13] and the DISJOINT query is deleted like any other — a discarded result is not ' +
    'an excuse to leak the query that produced it.');
});

test('GT-A14 the disjoint flag is actually consulted for every consumed result', gate, async () => {
  const { timer, gl, log } = await healthyTimer();

  for (let f = 1; f <= 5; f += 1) {
    timer.poll(f * 2 - 1);
    timer.beginFrame(f * 2 - 1);
    timer.endFrame(f * 2 - 1);
    gl.__complete(3_000_000);
    timer.poll(f * 2);
  }

  const disjointReads = opsOf(log, 'gl0', 'getParameter')
    .filter((line) => line.endsWith('GPU_DISJOINT_EXT')).length;

  assert.ok(disjointReads >= 5,
    `[GT-A14] GPU_DISJOINT_EXT must be read at least once per consumed result (saw ` +
    `${disjointReads} for 5 results). An implementation that never checks the flag passes ` +
    'GT-A9 and GT-A11 and every "did it crash" check, and reports garbage as measurement on ' +
    'exactly the phones this programme is for. This assertion says nothing about ORDERING ' +
    'beyond "after endQuery" — the fake does not model the flag\'s latch-and-clear semantics, ' +
    'deliberately, so that a correct implementation which reads it twice is not failed by a ' +
    'wrong oracle.');
  assert.equal(timer.counters().accepted, 5, '[GT-A14] all five were non-disjoint and accepted.');
});

/* =========================================================================
 * GT-A15 / GT-A16 / GT-A17 — the context-loss trace
 * ========================================================================= */

test('GT-A15 context loss: no read against a pre-loss query, and the leak count returns to zero', gate, async () => {
  const { createGpuTimer } = await loadGpuTimer();
  const log = [];
  let gl = createFakeGl({ log, tag: 'lost', webgl2: true });
  const timer = createGpuTimer({ getContext: () => gl });

  timer.beginFrame(1);
  timer.endFrame(1);
  assert.equal(timer.counters().inFlight, 1, '[GT-A15] precondition: a query is outstanding.');

  const lossIndex = log.length;
  gl.__lose();
  timer.onContextLost();

  // Frames keep arriving — the render loop does not stop just because the context did.
  for (let f = 2; f <= 10; f += 1) runFrame(timer, f);

  const after = log.slice(lossIndex);
  for (const forbidden of ['getQueryParameter', 'createQuery', 'beginQuery', 'endQuery']) {
    const hits = after.filter((line) => line.startsWith(`lost:${forbidden}`));
    assert.deepEqual(hits, [],
      `[GT-A15] ${forbidden} must not be called on a lost context. Reading a PRE-LOSS query ` +
      'is the specific defect: every query object is invalidated by the loss, so the read ' +
      'returns null and an implementation that trusts it publishes 0 ms as a GPU time — a ' +
      'number that says "infinite headroom" to the Wave 3 controller. ' +
      `Saw: ${JSON.stringify(hits)}`);
  }
  // isContextLost() and deleteQuery() are explicitly PERMITTED here: confirming the loss and
  // releasing the handle are both correct, and forbidding them would fail a correct module.

  assert.equal(timer.counters().inFlight, 0,
    '[GT-A15] the outstanding query must be released, not left pending against a dead ' +
    'context — otherwise the one-in-flight rule (GT-A10) permanently blocks all future ' +
    'timing after the first context loss.');
  assert.equal(timer.counters().created - timer.counters().deleted, 0,
    '[GT-A15] the leak count returns to zero across a loss.');
  assert.deepEqual(timer.read(), { value: null, state: 'unavailable', reason: 'no-context' },
    '[GT-A15] while lost, the reading is "no-context" — which CONTRACT.md §3.1 makes a STOP. ' +
    'That is correct and intended here: a lost context IS a real fault, and a genuine loss ' +
    'reported honestly is exactly what lets the STOP mean something.');
  assert.equal(timer.capability().state, 'no-context', '[GT-A15] and so is the capability.');
});

test('GT-A16 after restore the extension is RE-DETECTED on the new context', gate, async () => {
  const { createGpuTimer } = await loadGpuTimer();
  const log = [];
  let gl = createFakeGl({ log, tag: 'pre', webgl2: true });
  const timer = createGpuTimer({ getContext: () => gl });

  runFrame(timer, 1);
  gl.__lose();
  timer.onContextLost();

  // A restore hands the page a BRAND NEW context object. Nothing about the old one survives:
  // "Calls `scheduleRendererResize(true)` and re-enters the loop. Must reset history: every
  // program recompiles." (CONTRACT.md §2.1, contextRestore)
  gl = createFakeGl({ log, tag: 'post', webgl2: true });
  timer.onContextRestored();

  assert.ok(opsOf(log, 'post', 'getExtension').includes(`post:getExtension:${WEBGL2_EXT_NAME}`),
    `[GT-A16] getExtension must be called AGAIN, on the new context. Extension objects do not ` +
    'survive a context loss — a cached one is a dead handle, and every call through it fails ' +
    `silently. Log: ${JSON.stringify(forTag(log, 'post'))}`);

  assert.deepEqual(timer.capability(), { state: 'ok', reason: null, available: true },
    '[GT-A16] and the capability recovers to ok.');

  runFrame(timer, 2);
  gl.__complete(7_000_000);
  timer.poll(3);
  assert.deepEqual(timer.read(), { value: 7, state: 'ok', reason: null },
    '[GT-A16] timing resumes on a NEW query issued against the NEW context.');
  assert.ok(opsOf(log, 'post', 'createQuery').length >= 1,
    '[GT-A16] the new query must be created on the post-restore context, not the dead one.');
});

test('GT-A17 re-detection is real, not cached: a restore without the extension is no-extension', gate, async () => {
  const { createGpuTimer } = await loadGpuTimer();
  const log = [];
  let gl = createFakeGl({ log, tag: 'pre', webgl2: true });
  const timer = createGpuTimer({ getContext: () => gl });
  assert.equal(timer.capability().state, 'ok', '[GT-A17] precondition: it started available.');

  gl.__lose();
  timer.onContextLost();
  // A restored context is not obliged to offer what the old one did — a driver reset, a
  // GPU switch on a laptop, or Safari falling back all change what is exposed.
  gl = createFakeGl({ log, tag: 'post', webgl2: true, extNames: [] });
  timer.onContextRestored();

  assert.deepEqual(timer.capability(), { state: 'no-extension', reason: 'no-extension', available: false },
    '[GT-A17] the probe must re-run against the restored context and report what THAT context ' +
    'says. A cached "ok" from before the loss is the hardwareConcurrency trap with an extra ' +
    'step: the code believes a capability it has not checked since the world changed.');
  assert.deepEqual(timer.read(), { value: null, state: 'unavailable', reason: 'no-extension' },
    '[GT-A17] and the reading follows the capability, without stale values from before the loss.');
  assert.equal(timer.counters().inFlight, 0, '[GT-A17] nothing is in flight against a context ' +
    'that cannot time.');
});

/* =========================================================================
 * GT-A18 — no ambient globals
 * ========================================================================= */

test('GT-A18 createGpuTimer refuses to invent a context', gate, async () => {
  const { createGpuTimer } = await loadGpuTimer();

  assert.throws(
    () => createGpuTimer({}),
    (err) => err instanceof TypeError && /getContext/.test(String(err.message)),
    '[GT-A18] with no `getContext` injected, the factory must throw a TypeError NAMING ' +
    'getContext — not fall back to document.createElement("canvas").getContext("webgl2"). ' +
    'CONTRACT.md §11: a module is unit-testable in this repo only if it imports nothing and ' +
    'takes its side effects as injected callbacks, because node_modules/three is a 414-line ' +
    'hand-written stub and CI runs `npm test` with no install step and no DOM. A module that ' +
    'reaches for a global is one npm test can no longer be an oracle for, and every task on ' +
    'it becomes Opus work.'
  );
  assert.throws(() => createGpuTimer(), TypeError,
    '[GT-A18] and calling it with no options at all throws rather than probing something.');
});

/* =========================================================================
 * GT-A19 — bounded memory
 * ========================================================================= */

test('GT-A19 the sample ring is bounded, structurally', gate, async () => {
  const mod = await loadGpuTimer();
  const { GPU_SAMPLE_CAPACITY } = mod;

  assert.ok(Number.isInteger(GPU_SAMPLE_CAPACITY) && GPU_SAMPLE_CAPACITY >= 1,
    `[GT-A19] GPU_SAMPLE_CAPACITY must be a fixed positive integer (got ${GPU_SAMPLE_CAPACITY}).`);

  const { timer, gl } = await healthyTimer();
  const buffers = timer.__buffers();
  assert.ok(buffers && typeof buffers === 'object' && Object.keys(buffers).length > 0,
    '[GT-A19] __buffers() must expose the LIVE internal buffers. A bounded-memory check that ' +
    'cannot reach the buffers passes vacuously, and R8 says a check nobody has watched fail ' +
    'is not a check — so returning {} to satisfy the API is itself the defect this line catches.');

  for (let f = 1; f <= 2000; f += 1) {
    timer.poll(f);
    timer.beginFrame(f);
    timer.endFrame(f);
    gl.__complete(1_000_000 + f);
  }
  timer.poll(2001);

  for (const [name, buf] of Object.entries(timer.__buffers())) {
    assert.ok(Array.isArray(buf) || ArrayBuffer.isView(buf),
      `[GT-A19] __buffers().${name} must be an array-like the check can measure.`);
    assert.ok(buf.length <= GPU_SAMPLE_CAPACITY,
      `[GT-A19] __buffers().${name} grew to ${buf.length} over 2000 frames, above the fixed ` +
      `capacity ${GPU_SAMPLE_CAPACITY}. House rule 4 is a zero-allocation game loop; an ` +
      'unbounded parallel Array of every sample ever is the exact shape the sibling ' +
      'frame-metrics oracle was written to catch (its `parallel` mutant), and it is worse ' +
      'here because this runs for the whole session.');
  }
  assert.ok(timer.counters().accepted >= 2000,
    '[GT-A19] ...while still having ACCEPTED every sample. Bounding the ring must not be ' +
    'achieved by dropping measurements on the floor.');
});

/* =========================================================================
 * GT-A20 — a stuck query does not block timing forever
 * ========================================================================= */

test('GT-A20 a query that never becomes available is abandoned and re-issued', gate, async () => {
  const mod = await loadGpuTimer();
  const { GPU_QUERY_TIMEOUT_FRAMES } = mod;

  assert.ok(Number.isInteger(GPU_QUERY_TIMEOUT_FRAMES) && GPU_QUERY_TIMEOUT_FRAMES >= 1,
    `[GT-A20] GPU_QUERY_TIMEOUT_FRAMES must be a fixed positive integer ` +
    `(got ${GPU_QUERY_TIMEOUT_FRAMES}). Its VALUE is provisional per CONTRACT.md §10 — this ` +
    'assertion is parameterised on the exported constant and never on a literal, so Wave 4 ' +
    'can retune it without editing this file (§10 rule 1).');

  const { timer, gl } = await healthyTimer();

  timer.beginFrame(1);
  timer.endFrame(1);           // never completed: the driver silently drops it
  const deadline = 1 + GPU_QUERY_TIMEOUT_FRAMES;
  for (let f = 2; f <= deadline; f += 1) timer.poll(f);

  assert.equal(timer.counters().inFlight, 0,
    `[GT-A20] after GPU_QUERY_TIMEOUT_FRAMES (${GPU_QUERY_TIMEOUT_FRAMES}) frames without ` +
    'availability the query must be abandoned. Combined with the one-in-flight rule (GT-A10), ' +
    'a driver that never signals availability would otherwise stop GPU timing for the rest of ' +
    'the session, silently, while `capability()` still says "ok" — a dead feature reporting ' +
    'itself healthy, which is this repo\'s single most expensive documented failure mode.');
  assert.equal(gl.__liveQueries(), 0, '[GT-A20] and the abandoned query is deleted, not leaked.');

  // Timing must resume.
  timer.beginFrame(deadline + 1);
  timer.endFrame(deadline + 1);
  gl.__complete(8_000_000);
  timer.poll(deadline + 2);
  assert.deepEqual(timer.read(), { value: 8, state: 'ok', reason: null },
    '[GT-A20] a new query is issued afterwards and timing recovers.');
  assert.equal(timer.capability().state, 'ok',
    '[GT-A20] and a timeout is not a capability failure — the extension is still there.');
});
