export const meta = {
  name: 'perf-wave-3a',
  description: 'Wave 3A — buy the controller oracles: the capacity-model trace corpus, red-first suites for the policy machine and both mandatory loops, and the flip gate',
  whenToUse: 'Run after Wave 2 merged (G2e PASS). Authors every assertion Wave 3B implements against, and proves each can fail before a cheap agent is allowed near it.',
  phases: [
    { title: 'Corpus', detail: 'Opus builds the capacity-model trace corpus and the holdout generator' },
    { title: 'Specs', detail: 'Red-first suites for the policy machine, the runtime loop and the dev loop' },
    { title: 'Flip', detail: 'G3o — every new assertion forced TRUE artificially and watched flipping' },
  ],
}

const REPO = `Repo /home/user/birb — Birb Mobile. Branch claude/ultracode-sub-agents-plan-c9qmba.
Waves 0, 1 and 2 are MERGED TO MAIN AND LIVE. The workbench exists and works.

READ FIRST — all present on disk and authoritative over your assumptions:
  docs/perf/CONTRACT.md   §0 vocabulary, §2 reset tags + paused-as-validity, §3.1 SENTINEL
                          PROTOCOL (closed reason enum), §3.3 improvement-loop panel fields,
                          §4 assertions, §7 precedence, §9 DEFERRAL LEDGER, §10 PROVISIONAL
                          CONSTANTS, §11 names + THE COMPATIBILITY LADDER
  docs/perf/gates/G0.md G1.md G2a.md G2b.md G2c.md G2d.md G2e.md — what each gate decided and why
  docs/ULTRACODE_PERFORMANCE_PLAN.md §4 Wave 3
  docs/PERFORMANCE_REALISM_PLAN.md — the 7-point state machine, the 6-step RUNTIME loop, the
                          DEVELOPMENT loop's evidence-record fields, and the dev-panel's 7 items

WHAT ALREADY EXISTS AND MUST NOT BE REBUILT:
  src/game/frame-metrics.js   raw per-frame intervals, nearest-rank percentile (SHARED — the
                              controller and the acceptance gate must use this one helper),
                              tagged resets, paused-as-validity, fixed-capacity rings, no
                              per-frame allocation
  src/game/frame-stats.js     evaluateAcceptanceGates(samples,{targetFPS}) + evaluateOscillation(log)
  src/game/gpu-timer.js       the PROBE only ({state, reason} from the closed enum). DEF-2 defers
                              pools and multi-frame reads. Do not build them.
  src/game/quality-settings.js Auto/Manual/Benchmark, requested-vs-effective, clamped/desync/applied
  src/ui/dev-quality-panel.js, src/ui/dev-gesture.js, tools/birb-quality.mjs + tools/lib/*

WHY THIS WAVE EXISTS, AND IT IS THE WHOLE ARCHITECTURE. Oracles are bought in one wave and
spent in the next. A cheap agent cannot tell "my code is wrong" from "my oracle is wrong" —
that is measurement-validity judgement, reserved for Opus. Wave 1 did this for Wave 2 and it
worked: G1 watched all twelve assertions fail before a cheap agent touched them. You are doing
it for the controller, which is the most delicate thing in the programme.

THE ORACLES ARE HASH-FROZEN (58 files, tools/oracle-manifest.txt). You are AUTHORING new ones,
not editing existing ones. Never modify tests/**, tools/lib/quality-assertions.mjs,
tools/birb-quality.mjs or docs/perf/CONTRACT.md.

RULES: R1 never --test-name-pattern (exits 0 on no match) — name explicit files.
R2 never pipe a harness into grep. R4 red-first suites use dynamic import() INSIDE the test
body, gated { skip: !process.env.BIRB_PERF_IMPL } — a top-level static import of a
not-yet-existing module resolves before any skip and turns tests.yml red for humanoid/,
gauntlet/, sculpture/ and icon3d/. R6 no SwiftShader number is a device claim.
R8 a check is not trusted until it has been WATCHED FAILING.

CURRENT BASELINE, assert against it: npm test (env unset) -> exit 0, 485 tests, 399 pass,
0 fail, 86 skipped. BIRB_PERF_IMPL=1 npm test -> exit 0, 483 pass, 0 fail. Your new red-first
suites will ADD skips to the first and failures to the second; the first must stay exit 0.`

phase('Corpus')

const CORPUS = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    shape: { type: 'string', description: 'the sample/driver contract, precisely' },
    scenarios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          depicts: { type: 'string' },
          whyUnrepresentableAsFixedIntervals: { type: 'string', description: 'or "n/a" if it is representable' },
        },
        required: ['id', 'depicts', 'whyUnrepresentableAsFixedIntervals'],
      },
    },
    holdout: { type: 'string', description: 'how the holdout generator works and what keeps it honest' },
    deviations: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'shape', 'scenarios', 'holdout', 'deviations'],
}

const corpus = await agent(
`${REPO}

TASK P3.1 — the trace corpus. This is the foundation the whole controller is tested on and
getting its SHAPE wrong invalidates every later test.

IT MUST BE A CAPACITY MODEL, NOT A RECORDED INTERVAL ARRAY. Each sample carries the sustainable
frame cost AT EACH SETTING — costMs: {rung0: 22.0, rung1: 15.5, ...} — and the driver
synthesises dtMs from the controller's CURRENT profile at that moment.

Why this is not a preference: a fixed interval replay cannot depict recovery-when-capacity-
returns or a failed upgrade probe, because the trace does not RESPOND to the decision. Both are
named required regressions in the plan. Replay a recorded array and the controller's choice
changes nothing about what it then measures, so every test of a decision is vacuous.

Build tests/fixtures/perf-traces/ plus a driver. Scenarios required, each named and documented:
  overload; recovery-when-capacity-returns; oscillation-bait; misleading plateau (delivered 60
  on a 60Hz panel hiding zero headroom — the plan calls this out specifically); absent GPU timer;
  disjoint GPU results; manual->auto; resume; scene change; STUCK QUALITY (30s stable-but-degraded
  must produce a bounded probe — permanent degradation is the plan's named anti-success);
  boundary-interleaved-with-recurrent-hitch (the reset must not erase a recurrent gameplay
  hitch — the plan forbids that explicitly); cold start from a persisted profile (note DEF-1
  defers persistence — model the COLD START, not the store); corrupt store clamped to the
  approved range; delayed regression (an accepted change that degrades later); first-use shader
  compilation inside an evaluation window; and the instrumentation on/off pair (identical
  costMs, panel-on cpuMs strictly greater).

THE HOLDOUT. Also write a generator that produces fresh traces from a seed. The seed must NOT
be materialised in the worktree — the gate supplies it. A controller tuned until the committed
corpus goes green has learned the corpus; the holdout is the only thing that catches it.

Every threshold the driver needs is in CONTRACT §10 as PROVISIONAL with provenance 'unmeasured'.
Import them; never inline a number. Wave 4 changes them in one place.

No THREE, no DOM — this must run under plain node --test with the 4-class stub.`,
  { label: 'P3.1-corpus', phase: 'Corpus', model: 'opus', effort: 'xhigh', schema: CORPUS })

log(`Corpus: ${corpus?.scenarios?.length ?? 0} scenarios`)

phase('Specs')

const SPEC = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    assertions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          asserts: { type: 'string' },
          wouldCatch: { type: 'string', description: 'the concrete wrong implementation this rejects' },
          notVacuous: { type: 'string', description: 'why this cannot be satisfied by restating the implementation' },
        },
        required: ['id', 'asserts', 'wouldCatch', 'notVacuous'],
      },
    },
    skipGateVerified: { type: 'string', description: 'npm test env-unset: suite skips, repo stays exit 0' },
    redVerified: { type: 'string', description: 'BIRB_PERF_IMPL=1: red for module-absent, not for an import error' },
    deviations: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'assertions', 'skipGateVerified', 'redVerified', 'deviations'],
}

const CORPUS_NOTE = corpus ? `\nTHE CORPUS NOW EXISTS — build on it, do not invent a second one:\n${corpus.shape}\nScenarios: ${corpus.scenarios.map(s => s.id).join(', ')}\n` : '\nThe corpus task failed; say so and write suites that do not depend on it.\n'

const SPECS = [
  {
    key: 'policy', model: 'opus', effort: 'high',
    prompt: `TASK P3.2a — tests/adaptive-quality.test.js, red-first, for src/game/adaptive-quality.js.

CONTRACT §11 fixes its shape and the reason is load-bearing: it MUST be
createAdaptiveQuality({ apply, now, ... }) — imports nothing, side effects injected, the
createFlightRecovery({ onEnter }) pattern. node_modules/three is a 414-line stub exporting four
classes and CI runs npm test with no install; a controller that touches renderer directly is
untestable here and every task on it becomes Opus work.

Pin the plan's SEVEN-POINT state machine: observe -> reduce one cost -> settle -> evaluate ->
hold or revert. Assert at minimum:
- ONE cost reduced per step, never a bundle. Today's tier 0->1 changes DPR AND bloom AND cloud
  shell together, and the plan's first finding is that this is not a measured saving.
- Overload and recovery use SEPARATE timers. Today the averaging window is selected by the
  current tier, so at tier 1 a further downgrade waits for the same 4s window used for recovery.
- The ranked reduction ladder includes a CPU-side rung, and shaft/mist/post reductions come
  before scene DPR (the plan's "prefer low visual loss" ordering).
- Collision, input and flight-simulation fidelity are NEVER reduced. The plan states this
  outright. A controller that hits its frame budget by degrading input has failed.
- Thresholds are IMPORTED from CONTRACT §10, never inlined. Wave 4 must change one place.

THE COMPATIBILITY LADDER (CONTRACT §11) is a test, not a note: the controller must ship a
profile reproducing today's 55/58 three-tier behaviour EXACTLY, with the new policy reachable
only from the panel and a URL flag. Assert the compatibility profile's decisions match the
live IIFE's on the same input. That is what makes a no-device outcome safe.`,
  },
  {
    key: 'runtime-loop', model: 'opus', effort: 'high',
    prompt: `TASK P3.2b — the MANDATORY RUNTIME LOOP suites. The plan calls both loops required
deliverables and says a controller that changes settings without evaluating the result is
incomplete. Write tests/effect-verification.test.js, tests/perf-learning.test.js and
tests/loop-health.test.js.

The six steps, and the traps in each:
1. OBSERVE AND PREDICT — record settings, distribution, timings, biome, gameplay state, and the
   ONE bounded adjustment chosen with its expected benefit and confidence.
2. APPLY AND VERIFY — confirm the effective buffer sizes / effect activity / update rates
   ACTUALLY CHANGED. "A slider value changing is not evidence that rendering work changed" is
   the plan's own sentence and it is what effect-verification.js exists for. Assert it can
   detect a no-op apply.
3. EVALUATE — equal-duration windows in COMPARABLE conditions. A flight into a quieter area
   must NOT be credited to the adjustment. Scene-change, paused and input-heavy windows are
   INCONCLUSIVE, never credited. This is the assertion most likely to be written vacuously:
   make it reject a confounded comparison, not merely accept a clean one.
4. KEEP OR ROLL BACK — a reduction is retained only for a measurable benefit; an inconclusive
   probe returns to the prior stable state; emergency recovery takes priority.
5. LEARN — in-session action history: predicted vs observed, confidence, failed probes,
   cooldowns. DEF-1 DEFERS PERSISTENCE. Do not spec a localStorage store. Do spec that the
   history is bounded and that a "coarse capability bucket" must NOT reach for
   navigator.hardwareConcurrency (this repo's most expensive documented mistake, still live at
   index.html:3578).
6. EVALUATE THE EVALUATOR — adjustment frequency, reversals, time outside budget, time spent
   UNNECESSARILY DEGRADED, prediction error, recovery time. Excessive oscillation disables
   exploratory upgrades and selects the last stable profile while protective downshifts remain.
   And the plan's anti-success: "A stable frame rate with permanently poor quality is not
   success" — assert that a stable-but-degraded state schedules a recovery probe.

Exploration bounds (PRO-8): one outstanding probe, no probing during loading or high-input
gameplay, at most one upgrade probe per 30s.`,
  },
  {
    key: 'dev-loop', model: 'opus', effort: 'medium',
    prompt: `TASK P3.2c — tests/evidence-record.test.js, the DEVELOPMENT loop's half.

The plan requires every retained change to carry a short evidence record: hypothesis,
build/settings/seed, device/browser, warm/cold state, repeated results and variability, observed
visual tradeoff, decision, and the next unresolved issue. Spec the schema and assert every field
is present or carries a §3.1 sentinel — never 0, never a plausible default.

TWO THINGS THAT MAKE THIS REAL RATHER THAN A FORM:
1. THE EXPORT SCHEMA MUST BE A SUPERSET OF THE FIXTURE SCHEMA. A Wave 4 device capture has to
   drop into tests/fixtures/ unchanged and replay as a permanent deterministic regression. Three
   Wave-2 designs defined these as different shapes, which throws the device data away the moment
   it is collected. Assert the superset relationship mechanically, against the real fixture shape.
2. THE BUILD HASH. CONTRACT §8.2: the phone is served by a service worker whose
   staleWhileRevalidate hands back the PREVIOUS build's src/ modules on a session's first run.
   Without a build hash in the record, every device number is attributed to a build that may not
   have been running. Assert the record cannot be considered complete without it.

Also assert the record distinguishes CONCLUSIVE from INCONCLUSIVE, and that "inconclusive"
cannot be silently upgraded by a later field.`,
  },
]

const specs = (await parallel(SPECS.map(sp => () =>
  agent(`${REPO}${CORPUS_NOTE}\n\n${sp.prompt}

DELIVERABLE DISCIPLINE:
- Do NOT implement the modules. This wave buys oracles; Wave 3B spends them.
- Do NOT weaken an assertion to make it pass. Red is correct now.
- R4 is the one that breaks four sibling projects if you get it wrong. Prove BOTH states and
  paste the real output:
      npm test                     # your suite SKIPS, repo stays exit 0 (485/399/0/86 + your skips)
      BIRB_PERF_IMPL=1 npm test    # your suite is RED because the module is absent
- Give every assertion a stable id and say what wrong implementation it rejects.`,
    { label: `P3.2-${sp.key}`, phase: 'Specs', model: sp.model, effort: sp.effort, schema: SPEC })
))).filter(Boolean)

log(`Specs: ${specs.length}/${SPECS.length} suites, ${specs.reduce((n, s) => n + s.assertions.length, 0)} assertions`)

phase('Flip')

const G3O = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'STOP'] },
    reason: { type: 'string' },
    flipTests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          assertionId: { type: 'string' },
          howForcedTrue: { type: 'string' },
          flipped: { type: 'boolean' },
          evidence: { type: 'string' },
        },
        required: ['assertionId', 'howForcedTrue', 'flipped', 'evidence'],
      },
    },
    corpusRespondsToDecisions: { type: 'boolean', description: 'does the driver synthesise dt from the CURRENT profile, so a decision changes what is then measured?' },
    repoStillGreen: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    readyForWave3B: { type: 'boolean' },
  },
  required: ['verdict', 'reason', 'flipTests', 'corpusRespondsToDecisions', 'repoStillGreen', 'blockers', 'readyForWave3B'],
}

const g3o = await agent(
`${REPO}

You are GATE G3o, the anti-laundering gate for the controller. Wave 3B's cheap-tier tasks have
nothing protecting them but what this wave just wrote. Write docs/perf/gates/G3o.md, first line
exactly 'VERDICT: PASS' or 'VERDICT: STOP — <reason>'.

Verify by RUNNING, not by reading the agents' reports.

1. FLIP EVERY ASSERTION (R8). Write your OWN flip driver — do not import the spec agents'
   fixtures or helpers. For each assertion, build a minimal green implementation, confirm it
   passes, then force the assertion's TRUE state artificially and confirm it FLIPS.
   Specifically force these, because they are the ones most likely to be vacuous:
   - a controller that reduces a BUNDLE of costs in one step (must fail the one-cost rule)
   - a controller that uses ONE timer for both overload and recovery
   - an apply that is a no-op (effect-verification must detect it)
   - an evaluation that CREDITS a confounded window — a flight into a quieter area scored as a
     win (step 3 must mark it inconclusive)
   - a controller that reaches its budget by degrading input or collision fidelity
   - a stable-but-permanently-degraded state (must schedule a recovery probe, not report success)
   Any assertion that cannot be flipped is REJECTED. Name it and STOP.

2. THE CORPUS ACTUALLY RESPONDS TO DECISIONS. This is the finding that invalidates everything
   downstream if it is wrong. Drive the corpus with two different controller policies and
   confirm the synthesised dtMs DIFFERS. If the trace produces identical intervals regardless of
   what the controller decided, it is a recorded array wearing a capacity model's clothes, every
   test of a decision is vacuous, and that is a STOP.

3. THE HOLDOUT IS REAL. Confirm the generator produces traces the committed corpus does not
   contain, and that no seed is materialised in the worktree.

4. THRESHOLDS IMPORTED, NOT INLINED. Grep the new files for 1.2, 18.5, 25, 50, 55, 58, 2000,
   4000, 1500, 30. Every provisional number must come from CONTRACT §10.

5. THE REPO IS STILL GREEN FOR THE SIBLINGS. npm test env-unset must be exit 0 with 0 failures.
   If a static import broke humanoid/, gauntlet/, sculpture/ or icon3d/, that is a STOP.
   BIRB_PERF_IMPL=1 must be RED for module-absent reasons only — not import errors.

6. NO ORACLE WAS EDITED. sha256sum -c tools/oracle-manifest.txt.

7. DEF-1 AND DEF-2 ARE RESPECTED. No spec may require a localStorage persistence store or a GPU
   query pool. A suite that demands deferred work forces Wave 3B to build it.

'could-not-determine' is honest. A fabricated pass here hands Wave 3B a fake safety net.`,
  { label: 'G3o-flip', phase: 'Flip', model: 'opus', effort: 'high', schema: G3O })

const unflippable = (g3o?.flipTests ?? []).filter(f => !f.flipped).map(f => f.assertionId)
log(`G3o: ${g3o?.verdict} — corpus responds: ${g3o?.corpusRespondsToDecisions}, ready: ${g3o?.readyForWave3B}`)
if (unflippable.length) log(`UNFLIPPABLE: ${unflippable.join(', ')}`)
if (g3o?.blockers?.length) log(`Blockers: ${g3o.blockers.join(' | ')}`)

return { wave: '3A', corpus, specs, g3o, readyForWave3B: g3o?.readyForWave3B === true && g3o?.verdict === 'PASS' && unflippable.length === 0 }
