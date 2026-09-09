export const meta = {
  name: 'perf-wave-2',
  description: 'Wave 2 of docs/ULTRACODE_PERFORMANCE_PLAN.md — the workbench: measurement modules, seeded world, single sizing function, three-finger panel',
  whenToUse: 'Run only after Wave 1 (perf-wave-1) has written docs/perf/gates/G1.md with VERDICT: PASS. First wave where cheap tiers do real volume, spending the oracles Wave 1 bought.',
  phases: [
    { title: 'Modules', detail: 'Parallel, no index.html — pure modules against Opus-authored red suites' },
    { title: 'Semantics', detail: 'G2a — did the modules mean what the contract says' },
    { title: 'Integration', detail: 'SERIAL — every task here edits index.html' },
    { title: 'Wired', detail: 'G2b — is each control wired to rendering work, or to a label' },
    { title: 'Harness', detail: 'Parallel — pinned labels and CI' },
    { title: 'Accept', detail: 'G2c — CI parses, instrumentation does not manufacture the bottleneck' },
  ],
}

const REPO = `Repo /home/user/birb — Birb Mobile. Vanilla ES modules, CDN Three 0.183.2, NO build step.
Branch: claude/ultracode-sub-agents-plan-c9qmba. Waves 0 and 1 are merged to main and live.

READ FIRST — these exist on disk and are the authority over your own assumptions:
  docs/perf/CONTRACT.md      §0 vocabulary, §1 callsite map, §2 reset tags + paused-as-validity,
                             §3 telemetry table + SENTINEL PROTOCOL, §4 assertions, §5 pinned harness
                             context, §6 THE PRODUCTION-PATH RULING, §7 precedence + routing register,
                             §8 sw.js + build hash, §9 deferrals, §10 provisional constants, §11 names
  docs/perf/ASSERTIONS.md    what each assertion checks and how it can fail
  docs/perf/EXPECTED-RED.md  what --check resize-restore must report on HEAD (your fix makes it green)
  docs/perf/gates/G0.md      §5 amendment — observed-not-derived, and the seeded-RNG finding
  docs/perf/gates/G1.md      the amendment — F1/F2/F3 and why they were fixed in Wave 1
  docs/ULTRACODE_PERFORMANCE_PLAN.md  §4 Wave 2
  docs/PERFORMANCE_REALISM_PLAN.md    the control table and telemetry paragraph you are implementing

THE ORACLES YOU ARE MEASURED BY ALREADY EXIST AND ARE HASH-FROZEN.
Wave 1 authored them and G1 watched all twelve assertions fail before you were allowed near them.
56 files are in tools/oracle-manifest.txt. **You may not edit any of them** — not tests/**, not
tools/lib/quality-assertions.mjs, not tools/birb-quality.mjs, not CONTRACT.md. \`sha256sum -c
tools/oracle-manifest.txt\` runs at every gate and a modified oracle is an automatic STOP for your
task. If an oracle looks wrong to you, SAY SO IN YOUR ANSWER and implement against it anyway. You are
not permitted to modify what grades you (R5).

Your suites are RED right now on purpose. Run yours with:
    BIRB_PERF_IMPL=1 node --test tests/<your file>.test.js
Green is the deliverable. \`npm test\` with the env unset must STAY at 460 tests / 378 pass / 82
skipped / exit 0 — that is four sibling projects (humanoid, gauntlet, sculpture, icon3d) whose CI you
can break from here.

ORACLE RULES, binding:
R1 never --test-name-pattern (exits 0 on no match). Name explicit files.
R2 never pipe a harness into grep (discards the exit code; every harness prints its summary BEFORE
   process.exit(1)). Run to a log, capture $?, assert the code, THEN grep the log.
R5 never modify your own oracle.
R6 no SwiftShader number becomes a device claim — CI renders at 2-9 fps.
R8 a check is not trusted until it has been watched failing.

REPO TRAPS THAT APPLY TO THIS WAVE SPECIFICALLY:
- A rendering world is not a working world. This repo shipped a world that screenshotted perfectly
  with its nesting and collectibles systems never created. Run tools/birb-modes.mjs (console WARNINGS
  are failures) and tools/birb-shaders.mjs, not just a screenshot.
- Zero-allocation game loop. No \`new\` in anything reachable per frame. Pre-allocate with an _ prefix.
- __BIRB exists ONLY under ?debug (index.html ~8928) and every harness loads ?debug=1. CONTRACT §6
  rules that the panel and gesture register on the PRODUCTION path. Read that section before you
  place a listener; getting it wrong means a workbench that is unreachable on the phone it was built
  for, while every assertion passes.`

const IMPL = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    contractSections: { type: 'array', items: { type: 'string' }, description: 'sections implemented, e.g. "§3.1 sentinel protocol"' },
    suiteResult: { type: 'string', description: 'exact output of BIRB_PERF_IMPL=1 node --test <your files> — must be GREEN' },
    repoStillGreen: { type: 'string', description: 'exact counts of `npm test` with the env UNSET — must stay 460/378/0/82 exit 0' },
    harnessResults: { type: 'string', description: 'birb-modes / birb-shaders exit codes where applicable, or why not applicable' },
    oraclesUntouched: { type: 'boolean', description: 'sha256sum -c tools/oracle-manifest.txt passed' },
    deviations: { type: 'array', items: { type: 'string' }, description: 'anywhere you could not follow the contract, and why. Empty is suspicious.' },
  },
  required: ['files', 'summary', 'contractSections', 'suiteResult', 'repoStillGreen', 'harnessResults', 'oraclesUntouched', 'deviations'],
}

const TAIL = `
DELIVERABLE DISCIPLINE:
- Implement ONLY your files. Another agent owns the others and you will collide.
- Make YOUR suite green without editing it. If it cannot be satisfied as written, that is a finding:
  report it in 'deviations' and implement the closest correct thing.
- Verify and paste real output (R2 — capture exit codes, never pipe into grep):
    BIRB_PERF_IMPL=1 node --test <your test files>     # green
    npm test                                            # 460/378/0/82 exit 0, siblings unharmed
    sha256sum -c tools/oracle-manifest.txt              # exit 0
- 'deviations' being empty is suspicious. Contracts written before implementation are never perfect.`

// ---------------------------------------------------------------- MODULES
phase('Modules')

const MODULES = [
  {
    key: 'frame-metrics', model: 'haiku', effort: 'medium',
    prompt: `TASK P2.1a — extend src/game/frame-metrics.js with raw per-frame interval statistics.
Your oracle: tests/frame-metrics-stats.test.js (FM-A1..FM-A11). Read it first; it names every export
it needs and pins the percentile convention as an exported string.

Key points it will hold you to: nearest-rank percentiles (p50 of [10,20] is 10, not 15); separate CPU
update and render-submission accumulators; a FIXED-capacity ring; exportIntervals() returns a COPY;
percentile() must not sort the caller's array in place; budgetMs = 1000/targetFPS, never a hardcoded
16.67; a missed frame is STRICTLY over budget; paused samples are MARKED, not discarded, and excluded
from percentiles while still appearing in the export; the reason string comes from a closed 7-member
set. With no samples the sentinel is {value:null,state:'unavailable',reason:'insufficient-samples'} —
explicitly NOT 0, because a zero p95 reads as a perfect frame budget.

The existing 250ms createFrameSampler must keep working unchanged — tests/frame-metrics.test.js is
frozen and still has to pass. This module imports nothing and takes time as an argument.`,
  },
  {
    key: 'quality-settings', model: 'haiku', effort: 'medium',
    prompt: `TASK P2.1b — create src/game/quality-settings.js.
Your oracle: tests/quality-settings.test.js.

Auto / Manual / Benchmark. Manual suspends Auto. Resume Auto clears stale history. Requested vs
effective must be separately readable — a value that was clamped reports BOTH, because "the slider
moved" is not evidence that rendering work changed, and G2b exists entirely to catch that.

Benchmark freezes seed, route, settings AND SUN. The sun matters and is not decoration: the game runs
a ten-minute sun cycle, so an A/B taken three minutes apart is confounded and a device day is wasted.

Pure module: imports nothing, side effects injected as callbacks (the createFlightRecovery pattern).`,
  },
  {
    key: 'gpu-timer', model: 'haiku', effort: 'medium',
    prompt: `TASK P2.1c — create src/game/gpu-timer.js.
Your oracle: tests/gpu-timer.test.js, which drives a FAKE GL context.

Report {state, reason} from the closed enum: no-extension | no-context | not-webgl2 | disjoint | ok.
This is the whole point of the module. EXT_disjoint_timer_query_webgl2 is exposed by neither iOS
Safari nor headless SwiftShader, so this will ship on its unavailable branch on the target device AND
in CI, permanently, green. A bare "gpuMs is null" cannot be told apart from a wiring bug — which is
this repo's most expensive recorded mistake (bloom gated off on every iPhone by a probe nobody proved
returned what they assumed). Make the unavailable path first-class and precisely diagnosable.

Results read on a LATER frame, disjoint results DISCARDED, queries cleaned up, at most one in flight,
and a context-loss path that leaks nothing and re-detects after restore.

CONTRACT §9 defers the query POOL. Build the probe and the single-query path; do not build a pool.`,
  },
  {
    key: 'frame-stats', model: 'haiku', effort: 'medium',
    prompt: `TASK P2.1d — create src/game/frame-stats.js, the acceptance-gate maths.
Your oracle: tests/frame-stats-totals.test.js.

TWO separate exported functions, and this is the point:
  evaluateAcceptanceGates(samples, {targetFPS}) over TAGGED samples, so "no recurring UNEXPLAINED
  >50ms spike" is computable — a spike tagged as a load boundary is explained, an untagged one is not.
  evaluateOscillation(tierChangeLog) — the fourth acceptance gate is a property of the CHANGE LOG,
  not of an interval array. A single-signature contract ships it as a hardcoded true.

Every threshold you need is in CONTRACT §10 as a PROVISIONAL constant with provenance 'unmeasured'.
Import them from there; do not inline a number. They are unmeasured on purpose and Wave 4 sets them.`,
  },
  {
    key: 'bloom-split', model: 'sonnet', effort: 'medium',
    prompt: `TASK P2.2a — split the bloom controls in src/effects/bloom-pass.js. You own that file only.

The plan's control table needs INDEPENDENT: post resolution scale, shafts on/off, bloom strength.
Today setStrength/setThreshold/setRays exist but 'downscale' is CONSTRUCTOR-ONLY, and setSize(w,h,ratio)
stores nothing — so a live setDownscale(n) needs new cached state or it cannot re-derive the size.
Add that state and setDownscale(n). blurA/blurB/rayTarget currently share one divisor; keep them
sharing it unless CONTRACT says otherwise (they are numerically identical today only because both
derive from 'downscale', not because the shader maths requires it).

Do NOT change getSizes() or the onRenderPass tally hook — Wave 0 shipped both, they are live on main,
and A4/A7 read them. Preserve the pass structure: 5 render() calls without shafts, 8 with.

Verify with tools/birb-shaders.mjs (a shader that fails to compile draws NOTHING and the page still
screenshots fine) and tools/birb-modes.mjs. Capture exit codes.`,
  },
  {
    key: 'seeded-rng', model: 'sonnet', effort: 'high',
    prompt: `TASK P2.1e — a seeded world RNG. Found by G0; nothing in the original decomposition owned it.

src/environment/ makes 76 unseeded Math.random() calls and there is no seeded generator anywhere, so
the control table's "Benchmark fixes seed, route, settings and sun" is UNSATISFIABLE — there is no
seed. Every page load builds a different world, which is why G0's own mean-pixel check could not
resolve a small change, and which makes any two-page-load A/B in Wave 5 a comparison of two worlds
rather than two settings.

Create src/environment/seeded-random.js (mulberry32 or equivalent — deterministic, no imports, unit
testable) and thread it through every environment builder that currently calls Math.random(). Default
seed reproduces a sensible world; the point is determinism, not a specific world.

You own src/environment/**. Do NOT touch index.html — a later serial task adds the __BIRB.worldSeed
hook. Export what that hook will need.

PROVE IT, and this is the deliverable, not the diff: two builds at the same seed must produce
identical geometry. Write tests/seeded-random.test.js asserting the generator's determinism and
sequence independence, and report how you verified the WORLD is reproducible (e.g. summing instanced
mesh translations across two builds at one seed and diffing).

Watch for: any Math.random() left in a builder silently reintroduces nondeterminism, so grep and
report the count you started with and the count remaining, with a reason for each survivor.`,
  },
]

const modules = (await parallel(MODULES.map(m => () =>
  agent(`${REPO}\n\n${m.prompt}\n${TAIL}`, {
    label: `P2-${m.key}`, phase: 'Modules', model: m.model, effort: m.effort, schema: IMPL })
))).filter(Boolean)

log(`Modules: ${modules.length}/${MODULES.length} landed; deviations reported: ${modules.reduce((n, m) => n + m.deviations.length, 0)}; oracles untouched: ${modules.every(m => m.oraclesUntouched)}`)

const G2A = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'STOP'] },
    reason: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      module: { type: 'string' }, problem: { type: 'string' }, severity: { type: 'string', enum: ['blocking', 'major', 'minor'] }, fix: { type: 'string' },
    }, required: ['module', 'problem', 'severity', 'fix'] } },
    readyForIntegration: { type: 'boolean' },
  },
  required: ['verdict', 'reason', 'findings', 'readyForIntegration'],
}

phase('Semantics')
const g2a = await agent(
`${REPO}

You are GATE G2a — SEMANTICS. Five cheap-tier agents just implemented modules against suites they did
not write. A green suite proves the assertions hold; it does not prove the module MEANS what the
contract says. Write docs/perf/gates/G2a.md, first line exactly 'VERDICT: PASS' or 'VERDICT: STOP — <reason>'.

Verify by RUNNING and by READING THE DIFF, not from the agents' self-reports:

1. ORACLES UNTOUCHED. \`sha256sum -c tools/oracle-manifest.txt\`. Any modified oracle is an automatic
   STOP naming the task. Also \`git diff --stat\` the frozen paths.
2. THE REPO IS STILL GREEN FOR THE SIBLINGS. \`npm test\` env-unset must be 460/378/0/82 exit 0. If a
   static import broke humanoid/ gauntlet/ sculpture/ icon3d/, STOP.
3. SENTINELS ARE NOT ZEROS. Read every "unavailable" path. CONTRACT §3.1 forbids substituting 0 or a
   plausible default for an absent measurement; a zero p95 reads as a perfect frame budget and is the
   shape of this repo's two most expensive bugs. Grep for \`|| 0\` and \`?? 0\` in the new modules.
4. PAUSED IS A VALIDITY STATE, NOT A RESET (CONTRACT §2.2). A paused sample must be MARKED and
   excluded from percentiles while STILL PRESENT in the export. An implementation that drops it
   passes a naive reading and deletes the resume-path evidence the plan explicitly wants kept.
5. THRESHOLDS ARE IMPORTED, NOT INLINED. Every number CONTRACT §10 marks provisional must be imported
   from there. An inlined 18.5 or 16.67 is a STOP: Wave 4 must be able to change one place.
6. THE GPU TIMER'S UNAVAILABLE PATH IS DIAGNOSABLE. {state, reason} from the closed enum, distinct
   reasons for no-extension vs no-context vs not-webgl2. If it collapses to null, STOP — that is the
   hardwareConcurrency trap and it will be invisible on the device and in CI.
7. THE WORLD IS ACTUALLY SEEDED. Do not accept the agent's word. Build twice at one seed and compare
   real geometry yourself. Then grep src/environment/ for surviving Math.random() and judge whether
   each survivor is legitimately outside world construction.
8. ZERO-ALLOCATION. No \`new\` on any per-frame path in the new modules.

'could-not-determine' is honest; a fabricated pass is not.`,
  { label: 'G2a-semantics', phase: 'Semantics', model: 'opus', effort: 'high', schema: G2A })

log(`G2a: ${g2a?.verdict} — ${g2a?.reason?.slice(0, 200)}`)
const g2aBlocking = (g2a?.findings ?? []).filter(f => f.severity === 'blocking')
if (g2aBlocking.length) log(`G2a blocking: ${g2aBlocking.map(f => `[${f.module}] ${f.problem}`).join(' | ')}`)

// ---------------------------------------------------------------- INTEGRATION (SERIAL)
phase('Integration')

const INTEGRATION_NOTE = `
YOU ARE IN THE SERIAL PHASE. Every task here edits index.html (9600+ lines), and the plan's own cost
analysis found file ownership — not the agent cap — is this programme's binding constraint. Tasks
before you have already landed their edits; tasks after you will land theirs. So:
- Re-read the regions you touch. Do NOT assume line numbers from the contract are still exact.
- Make the SMALLEST edit that satisfies your task. Do not reformat, do not "tidy" adjacent code.
- After editing, run tools/birb-modes.mjs AND tools/birb-shaders.mjs. Console warnings are failures.
- If you find a previous task's work broken or missing, REPORT IT — do not silently repair it.
${g2a?.findings?.length ? `\nG2a findings you inherit:\n${g2a.findings.map(f => `- [${f.module}] ${f.problem} -> ${f.fix}`).join('\n')}` : ''}`

const INTEGRATION = [
  {
    key: 'one-sizing', model: 'sonnet', effort: 'high',
    prompt: `TASK P2.2b — the SINGLE SIZING FUNCTION. This is the wave's most valuable fix and A6 is red
on HEAD because of exactly this bug.

Today applyTier() calls renderer.setPixelRatio() directly while the resize handler separately sizes
the bloom targets, so nothing tells the post chain or the weather uniform. Wave 0 MEASURED the
consequence: pin tier 1 and rendererPixelRatio goes 1.7 -> 1.0 while resizeState.pixelRatio and the
weather uniform both stay 1.7 and the bloom scene target stays 663x1434.

Route EVERY quality and viewport change through one function: tier changes, resize, orientation, and
handleContextRestored (index.html ~8693, which must re-apply requested settings and issue a
'contextRestore' tagged reset). Resolution changes commit at intervals, not on every input event —
repeated reallocation creates the very stalls being measured. Keep HTML controls at CSS resolution.

CONTRACT §1 has the callsite map as a SET: 15 occurrences on 14 lines, 9427 carrying two. Work the
set, not a line count.

YOUR ORACLE IS A6, AND IT IS CURRENTLY RED BY DESIGN:
    node tools/birb-quality.mjs --check resize-restore    # exit 1 on HEAD today
Your job makes it GREEN. It runs tier0 -> degrade -> resize WHILE DEGRADED -> restore and compares
every render target's LIVE dimensions. docs/perf/EXPECTED-RED.md is the field-by-field manifest of
what it reports today — read it, then make each of those fields agree.

Do not touch tools/lib/quality-assertions.mjs to get there (R5). Making the check green by weakening
it is the one unrecoverable failure in this wave.`,
  },
  {
    key: 'gesture', model: 'sonnet', effort: 'medium',
    prompt: `TASK P2.2c — create src/ui/dev-gesture.js and register it.
Your oracle: tests/dev-gesture.test.js (pure state machine, already green-able) plus A1/A2 live.

READ CONTRACT §6 IN FULL BEFORE PLACING A LISTENER. It rules that the gesture registers on the
PRODUCTION path, not inside the ?debug block. __BIRB exists only under ?debug and every harness loads
?debug=1, so a gesture registered there yields a workbench that is unreachable at
birbmobile.vercel.app — on the very phone it was built for — while every assertion passes. That is
this repo's capability-probe trap in a new costume.

Three fingers arriving together, held briefly, opening on RELEASE. Must NOT fire on one finger (the
stick) or two (boost/sprint — there is an existing two-finger sprint tracker around index.html
7477-7522; find it and coexist with it). Respect touchcancel. "Cancel gameplay pointers when it opens"
is an INJECTED CALLBACK the game implements — never synthesise a touchcancel.

Document-level, passive listeners. Coexist with nipplejs. Keyboard fallback and a debug-URL button,
because OS gestures can intercept touch.

A2 asserts that after an open/close cycle a two-finger touchdown STILL engages sprint and a one-finger
drag still moves the bird. Breaking flight input to add a dev panel is the worst outcome available here.

Wave 1's harness will now REQUIRE a live capturer for A1/A2 the moment this file exists (G1/F2) — but
tools/birb-quality.mjs is FROZEN and you cannot add one. Report that in 'deviations'; the orchestrator
owns it.`,
  },
  {
    key: 'panel-shell', model: 'sonnet', effort: 'medium',
    prompt: `TASK P2.3a — create src/ui/dev-quality-panel.js: the shell only, wired to the gesture.

Three views: Performance, Look, Capture. Opens/closes cleanly, returns control to the game on close
(A2 depends on this). Telemetry updates about FOUR TIMES PER SECOND, never per frame — CONTRACT §3.4.
Per-frame DOM work in a panel that exists to measure frame time is self-defeating, and G2c measures
instrumentation cost.

Structure it so P2.3b can add controls without restructuring: a view registry and a render-on-tick
loop. Read CONTRACT §3.2/§3.3 for the exact field list you must eventually display, and stub every
field with its SENTINEL from §3.1 — never 0, never a plausible default. Several fields legitimately
have no source until Wave 3 ("last adjustment/reason", "cooldown") and must render the sentinel.

Mobile-first: it is operated by a thumb on a phone, in flight. Do not build a desktop inspector.`,
  },
  {
    key: 'panel-controls', model: 'sonnet', effort: 'high',
    prompt: `TASK P2.3b — the panel's controls, telemetry and evidence export.

Implement the plan's control table: Auto/Manual/Benchmark, target rate, absolute render-DPR slider
(0.85-2.0 in 0.05 steps, bounded by native DPR, default ceiling 1.7 mobile, showing effective buffer
dimensions and native-resolution percentage), post quality off/quarter/half with independent shafts
toggle and bloom strength, weather/mist/decorative density sliders, surface detail, Look controls, and
compare/export/reset.

EVERY control routes through P2.2b's single sizing function and P2.1b's quality-settings. Respect
CONTRACT §7 PRECEDENCE — panel request > adaptive tier > capability probe — and §7.2's routing
register lists every site that already writes these quantities, several per frame (wind ~8350, weather
density ~8395, contact shadow ~8497, ribbons ~8523, isLowEnd 3578). A panel value clobbered on the
next frame is exactly what G2b hunts for.

Telemetry verified by INJECTION, not by eye: expose __BIRB.injectIntervals([...]) so a known series
whose p95 is far from its mean can be fed in and the displayed p50/p95/p99 checked against it.

Export JSON: build, seed, device/browser, requested AND effective values, timing. CONTRACT §8.3
requires a BUILD HASH — without it a device number is attributed to a build that may not have been
running, because the service worker's staleWhileRevalidate serves the previous build's src/ modules.
Make the export schema a SUPERSET of the fixture schema in tests/, so a device capture drops into
tests/fixtures/ and replays as a permanent regression rather than being a one-time reading.

Sliders commit at intervals, not per input event.`,
  },
  {
    key: 'hooks-and-sw', model: 'sonnet', effort: 'medium',
    prompt: `TASK P2.1f — the __BIRB surface for the new systems, and sw.js.

1. __BIRB.worldSeed(n) using P2.1e's seeded RNG, plus __BIRB.quality() exposing requested vs effective
   settings and the build hash (A11/A12 need it). Keep these in the ?debug block — they are harness
   hooks, unlike the panel, which CONTRACT §6 puts on the production path.
2. sw.js — CONTRACT §8, and NOTHING in the original decomposition owned this. It hand-enumerates every
   module in CORE_ASSETS and CACHE_VERSION is a literal string. This wave added several src/ modules
   (frame-metrics is already listed; quality-settings, gpu-timer, frame-stats, seeded-random,
   dev-gesture, dev-quality-panel are not). Missing modules mean a BLANK PAGE offline — the exact /AR
   failure the file's own comment memorialises. Add every new module and bump CACHE_VERSION.
3. The measurement hazard, which is worse than the offline one (CONTRACT §8.2): the phone used for
   Wave 4 is served by a service worker, and staleWhileRevalidate serves the CACHED module first — so
   a device session's first run executes the PREVIOUS build's src/** against the new index.html. The
   build hash in __BIRB.quality() is what makes that detectable. Make sure it reflects the running
   code, not a constant someone edits by hand.

Verify offline behaviour is not broken: birb-modes.mjs and birb-shot.mjs must stay green.`,
  },
]

const integration = []
for (const t of INTEGRATION) {
  const r = await agent(`${REPO}\n${INTEGRATION_NOTE}\n\n${t.prompt}\n${TAIL}`,
    { label: `P2-${t.key}`, phase: 'Integration', model: t.model, effort: t.effort, schema: IMPL })
  if (r) integration.push({ key: t.key, ...r })
  log(`  ${t.key}: ${r ? 'done' : 'FAILED'}${r?.deviations?.length ? ` (${r.deviations.length} deviations)` : ''}`)
}

// ---------------------------------------------------------------- G2b
phase('Wired')

const G2B = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'STOP'] },
    reason: { type: 'string' },
    controls: {
      type: 'array',
      description: 'One row per control class. Wired to rendering work, or to a label?',
      items: {
        type: 'object',
        properties: {
          control: { type: 'string' },
          observedEffect: { type: 'string', description: 'the MEASURED change in a live buffer/draw count, with numbers' },
          wired: { type: 'boolean' },
          method: { type: 'string' },
        },
        required: ['control', 'observedEffect', 'wired', 'method'],
      },
    },
    a6NowGreen: { type: 'boolean', description: 'does --check resize-restore now pass, WITHOUT the assertion being weakened' },
    precedenceHolds: { type: 'boolean', description: 'a panel request survives the next frame against the per-frame writers in CONTRACT §7.2' },
    productionPathHolds: { type: 'boolean', description: 'panel + gesture reachable on a load with NO ?debug' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'reason', 'controls', 'a6NowGreen', 'precedenceHolds', 'productionPathHolds', 'blockers'],
}

const g2b = await agent(
`${REPO}

You are GATE G2b, and this is the gate the whole wave exists for. No automated check settles it:
**is each control wired to rendering work, or to a label?** A slider that moves a number is not
evidence that a single pixel changed. Write docs/perf/gates/G2b.md, first line exactly
'VERDICT: PASS' or 'VERDICT: STOP — <reason>'.

Take ONE MEASUREMENT PER CONTROL CLASS on the live page, and report the numbers:
- DPR slider          -> renderer.domElement.width / gl.drawingBufferWidth actually change
- post quality        -> bloomPass.getSizes() targets actually resize
- weather density 0   -> the points draw is actually SKIPPED (scene call count drops)
- shafts toggle       -> frameTotals().passes collapses 8 -> 5
- bloom strength      -> a LOOK change only; confirm it does NOT claim a cost saving
- 30 FPS target       -> mean delivered interval near twice the 60 target, i.e. real pacing.
  CONTRACT §9 may have deferred this. If deferred, confirm the row is absent or explicitly marked,
  not silently fake.

THEN THE THREE THINGS THAT CAN FAIL SILENTLY:

A. A6 IS GREEN FOR THE RIGHT REASON. \`--check resize-restore\` must now pass. Verify the assertion was
   NOT weakened: sha256sum the manifest, and re-run the G1 flip — hand-desync a render target and
   confirm A6 still goes red. A check that can no longer fail certifies nothing. This is the single
   most important thing you do.
B. PRECEDENCE HOLDS ACROSS A FRAME. CONTRACT §7.2 lists per-frame writers (wind ~8350, weather density
   ~8395, contact shadow ~8497, ribbons ~8523, isLowEnd 3578). Set a panel value, let several frames
   pass, read it back. A value clobbered on the next frame is a label.
C. THE PRODUCTION PATH. Load with NO ?debug and confirm the panel and gesture are reachable and
   \`window.__BIRB === undefined\` on that same load. CONTRACT §6 is the ruling; a workbench that only
   works under ?debug is unreachable on the phone it was built for while every assertion passes.

Also run: birb-modes.mjs (console warnings are failures), birb-shaders.mjs, npm test env-unset
(460/378/0/82), BIRB_PERF_IMPL=1 npm test (should now be GREEN or much closer), --selftest, --check all.

Report measured numbers, not impressions. 'could-not-determine' is honest.`,
  { label: 'G2b-wired', phase: 'Wired', model: 'opus', effort: 'high', schema: G2B })

log(`G2b: ${g2b?.verdict} — A6 green: ${g2b?.a6NowGreen}, precedence: ${g2b?.precedenceHolds}, production path: ${g2b?.productionPathHolds}`)
const labels = (g2b?.controls ?? []).filter(c => !c.wired).map(c => c.control)
if (labels.length) log(`CONTROLS THAT ARE LABELS: ${labels.join(', ')}`)

// ---------------------------------------------------------------- HARNESS + CI
phase('Harness')

const harnessTasks = (await parallel([
  () => agent(`${REPO}

TASK P2.4a — pinned-state labels on the capture harnesses.

tools/birb-shot.mjs, tools/birb-sheet.mjs AND tools/birb-lighting.mjs (it is a visual capture tool and
it pins tier 0 too, around line 77) must PRINT which quality state a capture was taken in, read from
stats().pinned and stats().tier — never a hardcoded string. A visual capture that does not say whether
quality was pinned is not usable as evidence, and the plan requires captures to state it.

Also: birb-sheet nest tiles must be stamped 'NOT LANDED — not visual evidence' when the landing times
out, because the city-nest capture timeout is a documented pre-existing issue and a tile that silently
shows the wrong view has been mistaken for evidence before.

EXPLICIT ORCHESTRATOR EXEMPTION — read this carefully, it is the only one in this wave.
All three files ARE in tools/oracle-manifest.txt. You are granted a NARROW exemption to edit exactly
these three, and nothing else on that list. The freeze exists so an implementer cannot weaken what
grades it; these three are CAPTURE tools and your change only ADDS printed output.

The exemption is conditional and the conditions are the deliverable:
- Do NOT change any assertion, any exit-code path, any timeout, or any wait condition in them.
- Their exit-code contract must be provably unchanged. Run each BEFORE and AFTER your edit, capture
  both exit codes, and show they match. sha256sum -c tools/oracle-manifest.txt WILL now fail on
  these three files and that is expected — say so in 'deviations' and report the new hashes so the
  orchestrator can re-freeze. Do not edit the manifest yourself.

Prove the label is not a constant: run birb-sheet (or birb-shot) at two different pinned tiers and show
the printed line DIFFERS. A constant passes a grep and tells you nothing.`,
    { label: 'P2-pinned-line', phase: 'Harness', model: 'haiku', effort: 'low', schema: IMPL }),
  () => agent(`${REPO}

TASK P2.4b — CI wiring.

.github/workflows/browser-health.yml has timeout-minutes: 12 and already runs four browser commands
after a Chromium install. This wave adds birb-quality checks. CONTRACT and the plan both flag that
nothing revisited the timeout, and three separate designs each wanted to add steps to the same
twenty-line block.

Add the birb-quality steps (--selftest, --check resize-restore, --check all) INSIDE the existing
health job, AFTER the Chromium install and the Three-stub restore. Raise timeout-minutes with a
comment justifying the new figure. Do not add a second job that reinstalls Chromium.

Also: tests.yml runs a bare \`npm test\` with no env, so the BIRB_PERF_IMPL suites never run in CI at
all. Add a second step that runs them explicitly with the env set, so the red-first suites actually
guard something. If they are not yet fully green, mark that step with continue-on-error AND a comment
naming the wave that removes it — never silently.

VERIFY THE YAML PARSES WITH A REAL PARSER:
    python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/browser-health.yml'))"
\`node -e readFileSync\` is a no-op that passes on malformed YAML. Do both workflow files.`,
    { label: 'P2-ci', phase: 'Harness', model: 'haiku', effort: 'low', schema: IMPL }),
])).filter(Boolean)

// ---------------------------------------------------------------- G2c
phase('Accept')

const G2C = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'STOP'] },
    reason: { type: 'string' },
    ciParses: { type: 'boolean' },
    instrumentationCost: { type: 'string', description: 'measured: does the panel/telemetry manufacture the bottleneck it measures?' },
    fullOracleRun: { type: 'string', description: 'every oracle command and its exit code' },
    blockers: { type: 'array', items: { type: 'string' } },
    readyForWave3: { type: 'boolean' },
  },
  required: ['verdict', 'reason', 'ciParses', 'instrumentationCost', 'fullOracleRun', 'blockers', 'readyForWave3'],
}

const g2c = await agent(
`${REPO}

You are GATE G2c — wave acceptance. Write docs/perf/gates/G2c.md, first line exactly
'VERDICT: PASS' or 'VERDICT: STOP — <reason>'.

1. CI PARSES WITH A REAL YAML PARSER (python3 -c "import yaml; yaml.safe_load(...)") for BOTH workflow
   files. Steps sit inside the health job after the Chromium install and the stub restore. No
   continue-on-error without a comment naming the wave that removes it. The timeout was revisited.
2. INSTRUMENTATION DOES NOT MANUFACTURE THE BOTTLENECK. Measure with the panel open and closed. The
   plan requires measuring with telemetry both enabled and disabled. Check the 4Hz cadence is real
   (not per-frame DOM work) and that nothing allocates per frame. Report numbers.
3. FULL ORACLE RUN, every exit code: npm test (env unset, 460/378/0/82); BIRB_PERF_IMPL=1 npm test;
   birb-modes; birb-shaders; birb-shot --start; birb-shot --start --nest; birb-quality --selftest;
   --check all; --check resize-restore; req-verify; sha256sum -c oracle-manifest.
4. THE SIBLINGS ARE UNHARMED. humanoid/ gauntlet/ sculpture/ icon3d/ tests still pass.
5. NOTHING SHIPPED THAT ONLY PAINTS. birb-modes treats console warnings as failures — that is the
   check that catches a world which renders while a system was never created.
6. THE COMPATIBILITY LADDER (CONTRACT §11): confirm nothing in this wave changed the live adaptive
   behaviour. Wave 2 is a workbench; the controller is Wave 3. If tier thresholds or DPR behaviour
   moved, that is a STOP — it means the workbench changed the thing it exists to measure.

Report what you could not determine.`,
  { label: 'G2c-accept', phase: 'Accept', model: 'opus', effort: 'high', schema: G2C })

log(`G2c: ${g2c?.verdict} — ${g2c?.reason?.slice(0, 200)}`)
if (g2c?.blockers?.length) log(`Blockers: ${g2c.blockers.join(' | ')}`)

return {
  wave: 2,
  modules, g2a, integration, g2b,
  harness: harnessTasks, g2c,
  readyForWave3: g2c?.readyForWave3 === true && g2c?.verdict === 'PASS' && g2b?.verdict === 'PASS',
}
