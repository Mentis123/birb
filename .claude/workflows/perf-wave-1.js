export const meta = {
  name: 'perf-wave-1',
  description: 'Wave 1 of docs/ULTRACODE_PERFORMANCE_PLAN.md — buy the oracles: red-first spec suites, the assertion library, and the flip-test gate',
  whenToUse: 'Run only after Wave 0 (perf-wave-0) has written docs/perf/gates/G0.md with VERDICT: PASS. Authors every assertion Wave 2 implements against, and proves each one can fail before a cheap agent is allowed near it.',
  phases: [
    { title: 'Specs', detail: 'Opus authors red-first test suites and the assertion library' },
    { title: 'Harness', detail: 'Sonnet builds tools/birb-quality.mjs against those assertions' },
    { title: 'Flip', detail: 'G1 — every assertion is forced TRUE artificially and must flip' },
  ],
}

const REPO = `Repo /home/user/birb — Birb Mobile. Vanilla ES modules, CDN Three 0.183.2, NO build step.
Branch: claude/ultracode-sub-agents-plan-c9qmba.

READ FIRST, they are the authority and they now exist on disk:
  docs/ULTRACODE_PERFORMANCE_PLAN.md   (this wave is section 4, "Wave 1 — buy the oracles")
  docs/perf/CONTRACT.md                (Wave 0's contract — assertions, enums, sentinels, precedence)
  docs/perf/BASELINE.md                (what HEAD actually does; assert against THIS, never "exit 0")
  docs/PERFORMANCE_REALISM_PLAN.md     (what is ultimately being built)

WHY THIS WAVE EXISTS. A cheap agent cannot distinguish "my code is wrong" from "my oracle is wrong" —
that is measurement-validity judgement, which is Opus work by definition. So oracles are bought in this
wave and spent in the next. Wave 2 has ~11 cheap-tier tasks whose only protection is what you write here.
An assertion nobody has watched fail is not an oracle, it is a hope.

GROUND TRUTH:
- node_modules/three is a 414-line hand-written stub TRACKED IN GIT exporting only
  Vector3/Quaternion/Euler/Matrix4. CI runs 'npm test' (= node --test) with NO install step.
  A module is unit-testable here ONLY if it imports nothing and takes side effects as injected callbacks —
  the createFlightRecovery({ onEnter }) pattern in src/flight/flight-recovery.js. Copy that shape.
- tests/ uses plain node:test + node:assert. ~38 suites. No framework. See tests/frame-metrics.test.js.
- src/game/frame-metrics.js: createFrameSampler({windowMs=250}) with .sample(time)/.reset()/.value.
  It takes time as an ARGUMENT — already fake-clock friendly. It returns ONE AVERAGED FPS per 250ms window;
  percentiles over that are meaningless, which is why Wave 2 adds raw per-frame intervals.
- index.html 9624 lines. __BIRB registered 8928 under ?debug only. Wave 0 added effective(), frameTotals(),
  stats().pinned — read docs/perf/CONTRACT.md for their exact shape rather than assuming.

ORACLE RULES — binding, and G1 checks them:
R1 NEVER use --test-name-pattern. Verified on this tree (node 22.22.2): a pattern matching nothing prints
   '# fail 0' and EXITS 0. Name explicit test files: node --test tests/foo.test.js
R2 NEVER pipe a harness into grep — it discards the exit code, and every harness here prints its summary
   BEFORE process.exit(1). That is the 'all 5 modes ok on a run exiting 1' bug. Run to a log, capture $?,
   assert the code, THEN grep the log.
R4 Red-first suites MUST use dynamic import() INSIDE the test body, gated { skip: !process.env.BIRB_PERF_IMPL }.
   A top-level static import of a not-yet-existing module resolves BEFORE any skip is evaluated and turns
   tests.yml red for the WHOLE repo — humanoid/, gauntlet/, sculpture/, icon3d/ included. This is not
   stylistic; getting it wrong breaks four sibling projects' CI.
R6 No SwiftShader number may become a device claim. CI renders at 2-9 fps.
R8 A check is not trusted until it has been WATCHED FAILING.`

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
          id: { type: 'string', description: 'e.g. A3' },
          asserts: { type: 'string' },
          wouldCatch: { type: 'string', description: 'the concrete wrong implementation this rejects' },
          oracleIndependence: { type: 'string', description: 'why this cannot be satisfied by restating the implementation' },
        },
        required: ['id', 'asserts', 'wouldCatch', 'oracleIndependence'],
      },
    },
    skipGateVerified: { type: 'string', description: 'exact output of `npm test` proving the suite SKIPS cleanly with BIRB_PERF_IMPL unset and does not break the repo' },
    redVerified: { type: 'string', description: 'exact output with BIRB_PERF_IMPL=1 proving it is RED for the right reason (module absent), not for an import error' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'assertions', 'skipGateVerified', 'redVerified', 'notes'],
}

const SPECS = [
  {
    key: 'metrics', model: 'opus', effort: 'high',
    prompt: `TASK P1.1a — author tests/frame-metrics-stats.test.js, red-first, for the interval statistics
Wave 2 will implement in src/game/frame-metrics.js.

It must pin, against an INDEPENDENT reference (compute the expected value a different way in the test —
sort-and-index over ~200 seeded arrays, not by calling the implementation's own helper):
- p50/p95/p99 with the convention NAMED AND PINNED (nearest-rank vs linear interpolation). Four separate
  modules were proposed for this across the original designs with three different conventions, so the value
  the controller fires on and the value the acceptance gate scores would have differed. Pin one, cite it.
- missed-target-frame percentage against a target budget B = 1000/targetFPS.
- the tagged reset enum from docs/perf/CONTRACT.md: an interval recorded before a tagged boundary is absent
  after it, one recorded after survives, and a recurrent gameplay hitch is NOT erased (the plan forbids that
  explicitly — "Do not erase recurrent gameplay hitches").
- a STRUCTURAL zero-allocation assertion. Not merely "the ring buffer is the same object": exportIntervals()
  invites a parallel unbounded plain Array, and at 60fps a 15-minute soak reaches ~54,000 entries. Assert the
  ring's capacity is fixed AND that repeated sampling does not grow any array reachable from the module.
- exportIntervals() returns a COPY of the ring, so a caller cannot mutate live measurement state.

Use a fake clock (time is already an argument to sample()). Seed any randomness deterministically.`,
  },
  {
    key: 'settings', model: 'opus', effort: 'high',
    prompt: `TASK P1.1b — author the red-first suites for the settings/telemetry/gesture surface:
tests/quality-settings.test.js, tests/frame-stats-totals.test.js, tests/dev-gesture.test.js.

quality-settings: Auto/Manual/Benchmark. Manual suspends Auto. Benchmark freezes seed, route, settings AND
SUN — the game has a ten-minute sun cycle, so an A/B taken three minutes apart is confounded and a device day
is wasted. Resume Auto clears stale history. Requested-vs-effective must be distinguishable: a requested value
that was clamped must report BOTH, because "the slider moved" is not evidence that rendering work changed.

frame-stats-totals: evaluateAcceptanceGates(samples, {targetFPS}) over TAGGED samples so "no recurring
unexplained >50ms spike" is computable (a spike tagged as a load boundary is explained; an untagged one is
not). And evaluateOscillation(tierChangeLog) as a SEPARATE function — the fourth acceptance gate is a property
of the change log, not of an interval array, and a single-signature contract ships it as a hardcoded true.

dev-gesture: three fingers arriving together and holding briefly, opening on RELEASE. Must NOT fire on one
finger (the stick) or two (boost/sprint). Must respect touchcancel. Pure state machine over synthetic pointer
events — no DOM, injected callbacks only, so it runs under node --test.

Each is red-first per R4. Keep them independent: one module's absence must not fail another's suite.`,
  },
  {
    key: 'gputimer', model: 'opus', effort: 'medium',
    prompt: `TASK P1.1c — author tests/gpu-timer.test.js over a FAKE WebGL context.

This module is the plan's highest-risk capability probe and this repo has the scar:
EXT_disjoint_timer_query_webgl2 is exposed by neither iOS Safari nor headless SwiftShader, so the whole
implementation will ship permanently on its null branch, green, on the target device AND in CI. That is the
hardwareConcurrency/bloom trap exactly — a feature gated on a probe nobody proved returns what they assumed.

So the suite's job is to make the UNAVAILABLE path first-class and precisely diagnosable:
- {state, reason} from a CLOSED enum: no-extension | no-context | not-webgl2 | disjoint | ok.
  A wiring bug must be distinguishable from a platform fact. "gpuMs is null" is not an acceptable report.
- results are read on a LATER frame, never the frame they were issued.
- disjoint results are DISCARDED, not averaged in.
- queries are cleaned up; at most one in flight.
- A CONTEXT-LOSS TRACE: no read against a pre-loss query, the leak count returns to zero, and the extension
  is re-detected after restore.

Fake the GL context entirely; assert on the sequence of calls made to it.`,
  },
]

const specs = (await parallel(SPECS.map(s => () =>
  agent(`${REPO}

${s.prompt}

DELIVERABLE DISCIPLINE:
- R4 is the one that breaks other projects if you get it wrong. Prove BOTH states and paste the real output:
    npm test                       # suite SKIPS, whole repo still green
    BIRB_PERF_IMPL=1 npm test      # suite is RED because the module is absent
- Do NOT implement the modules under test. This wave buys oracles; Wave 2 spends them.
- Do NOT weaken an assertion to make it pass. Red is the correct state right now.
- Every assertion gets a stable id (A1, A2, ...) matching docs/perf/CONTRACT.md where one already exists.`,
    { label: `P1.1-${s.key}`, phase: 'Specs', model: s.model, effort: s.effort, schema: SPEC })
))).filter(Boolean)

log(`Specs: ${specs.length}/3 suites, ${specs.reduce((n, s) => n + s.assertions.length, 0)} assertions authored`)

const assertLib = await agent(
`${REPO}

The red-first suites now exist:
${specs.map(s => `- ${s.files.join(', ')}\n  ${s.assertions.map(a => `${a.id}: ${a.asserts}`).join('\n  ')}`).join('\n')}

TASK P1.2 — author tools/lib/quality-assertions.mjs, the A1-A12 table, the page-side mutation catalogue,
and docs/perf/EXPECTED-RED.md.

quality-assertions.mjs holds the ASSERTION IMPLEMENTATIONS, so that the Sonnet agent building the harness in
P1.3 TRANSCRIBES rather than decides comparator direction. Each export takes a page-state snapshot and returns
{id, pass, actual, expected, message}. Cover at minimum:
  A2  a two-finger touch must NOT open the panel (the sprint gesture must survive)
  A6  buffer coherence: after tier0 -> degrade -> resize WHILE DEGRADED -> restore, every render target's
      LIVE .width/.height agrees with the requested pixel ratio. This is the desync the whole programme is
      about — read docs/perf/CONTRACT.md for which objects to interrogate.
  A7  frameTotals().calls > sceneOnly.calls, and passes === (raysOn ? 8 : 5)

docs/perf/EXPECTED-RED.md is the important one and is easy to get subtly wrong. It is the field-by-field
manifest of what 'birb-quality --check resize-restore' must report FAILING ON HEAD TODAY. That check exists
to catch the live applyTier/bloomPass desync:
  - if it PASSES on HEAD, it is the wrong check and this wave has failed;
  - if it fails for any OTHER reason, it is a false oracle and will license nine cheap tasks wrongly.
The permanent mismatch lives in step 4 (restore). A check truncated at step 2 is red today for the right
reason and goes green forever the moment the sizing fix lands, catching nothing thereafter. Specify all four
steps and the exact expected field values at each.

The mutation catalogue lists page-side mutations that --selftest applies to prove each assertion discriminates.

Verify your assertions against the REAL page before you claim they work:
  node tools/birb-shot.mjs --out /tmp/a.png --start --after "JSON.stringify(window.__BIRB.effective())"
Capture exit codes; do not pipe into grep (R2).`,
  { label: 'P1.2-assertions', phase: 'Specs', model: 'opus', effort: 'high' }
)

phase('Harness')

const harness = await agent(
`${REPO}

The assertion library and EXPECTED-RED manifest now exist:
${assertLib}

TASK P1.3 — build tools/birb-quality.mjs.

You are TRANSCRIBING assertions someone else authored. Do not invent an assertion, do not change a comparator
direction, do not relax a threshold. If an assertion in tools/lib/quality-assertions.mjs looks wrong to you,
report that in your answer — do NOT fix it. You are not permitted to modify your own oracle (R5).

Sub-modes: --check <id>, --selftest, --hooks-only, --emit-samples, --capture-intervals.

Follow the existing harness contract in tools/birb-shot.mjs exactly: playwright, ?debug=1, the splash ->
vibe -> title -> tap-to-start flow, non-zero exit on ANY page error or console error, artefacts on failure.
Reuse its helpers rather than reimplementing the boot sequence.

THE RULE THAT MATTERS MOST HERE — never a silent pass for absence. Sub-modes targeting the not-yet-built
panel return EXIT 2 (skipped), and always print a coverage line:
    mutations: N catalogued, M applicable, M detected
--selftest exits non-zero if applicable < catalogued while the panel file exists on disk. A harness that
reports success because the thing it tests does not exist yet is precisely how this repo shipped a world that
screenshotted perfectly with its nesting and collectibles systems never created.

Prove --check resize-restore is RED ON HEAD and that its failure matches docs/perf/EXPECTED-RED.md field for
field. Paste the real output. If it passes on HEAD, stop and say so loudly — that is a wave-level STOP.`,
  { label: 'P1.3-harness', phase: 'Harness', model: 'sonnet', effort: 'high' }
)

phase('Flip')

const G1 = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'STOP'] },
    reason: { type: 'string' },
    flipTests: {
      type: 'array',
      description: 'One per assertion. The TRUE state must be produced ARTIFICIALLY and the assertion must flip.',
      items: {
        type: 'object',
        properties: {
          assertionId: { type: 'string' },
          howForcedTrue: { type: 'string', description: 'the artificial defect injected into a scratch copy' },
          flipped: { type: 'boolean' },
          evidence: { type: 'string' },
        },
        required: ['assertionId', 'howForcedTrue', 'flipped', 'evidence'],
      },
    },
    expectedRedMatches: { type: 'boolean', description: 'does --check resize-restore fail on HEAD field-for-field per EXPECTED-RED.md' },
    repoStillGreen: { type: 'string', description: 'npm test with BIRB_PERF_IMPL unset — sibling projects unaffected' },
    blockers: { type: 'array', items: { type: 'string' } },
    readyForWave2: { type: 'boolean' },
  },
  required: ['verdict', 'reason', 'flipTests', 'expectedRedMatches', 'repoStillGreen', 'blockers', 'readyForWave2'],
}

const gate = await agent(
`${REPO}

You are GATE G1, the ANTI-LAUNDERING GATE. Wave 2 has ~11 cheap-tier tasks and these assertions are their only
protection. Write docs/perf/gates/G1.md whose FIRST LINE is exactly 'VERDICT: PASS' or 'VERDICT: STOP — <reason>'.

Your job is POSITIVE CONTROL, not red-bar shape. Red-because-nothing-is-implemented proves nothing about
whether an assertion can discriminate.

1. FLIP EVERY ASSERTION. For each, produce its TRUE state ARTIFICIALLY in a scratch copy of the tree and
   confirm the assertion flips from pass to fail:
     A2  — stub a panel that opens on ANY touch; the sprint assertion must fail
     A6  — hand-desync a bloom render target's dimension; the coherence assertion must fail
     A7  — force an 8-pass frame where 5 is expected; the pass-count assertion must fail
   Do the same for every assertion the spec agents authored. ANY assertion that cannot be flipped is REJECTED
   before a single cheap task starts — say which, and STOP.
2. --check resize-restore is RED ON HEAD and matches EXPECTED-RED.md FIELD FOR FIELD. Confirm the sequence
   executes all four steps (tier0 -> degrade -> resize while degraded -> restore). A check truncated at step 2
   is red today for the right reason and goes green forever once the sizing fix lands. That is a STOP.
3. THE REPO IS STILL GREEN for everyone else. 'npm test' with BIRB_PERF_IMPL unset must be unchanged from
   docs/perf/BASELINE.md. If a static import broke humanoid/ or gauntlet/ or sculpture/ or icon3d/, STOP.
4. NO AGENT MODIFIED ITS OWN ORACLE. git diff tools/lib/ and tests/ against what P1.1/P1.2 reported writing.
   P1.3 was explicitly forbidden from touching the assertion library — verify it did not.
5. R1/R2 COMPLIANCE in every oracle command written this wave: no --test-name-pattern, no harness piped into
   grep. Grep the diff for both and report what you find.

Verify by RUNNING things, not by reading the agents' reports about themselves. 'could-not-determine' is an
honest result; a fabricated pass is not.`,
  { label: 'G1-flip-gate', phase: 'Flip', model: 'opus', effort: 'high', schema: G1 }
)

const unflippable = (gate?.flipTests ?? []).filter(f => !f.flipped).map(f => f.assertionId)
log(`G1: ${gate?.verdict ?? 'NO VERDICT'} — ${gate?.reason ?? 'gate returned nothing'}`)
if (unflippable.length) log(`UNFLIPPABLE (rejected): ${unflippable.join(', ')}`)
if (gate?.blockers?.length) log(`Blockers: ${gate.blockers.join(' | ')}`)

return {
  wave: 1,
  specs,
  assertLib,
  harness,
  gate,
  unflippableAssertions: unflippable,
  readyForWave2: gate?.readyForWave2 === true && gate?.verdict === 'PASS' && unflippable.length === 0,
}
