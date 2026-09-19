export const meta = {
  name: 'perf-wave-2r',
  description: 'Wave 2R — remediate the blocking findings from G2a/G2b/G2c before Wave 2 can merge',
  whenToUse: 'Run after perf-wave-2 when its gates returned STOP. Fixes the measured defects, re-runs the missing seeded-RNG task, and repairs the CI regression.',
  phases: [
    { title: 'Fix', detail: 'Parallel repairs, each against a measured finding' },
    { title: 'Regate', detail: 'G2d — re-verify every blocking finding is actually closed' },
  ],
}

const REPO = `Repo /home/user/birb — Birb Mobile. Branch claude/ultracode-sub-agents-plan-c9qmba.
Waves 0 and 1 are merged to main and live. WAVE 2 IS NOT MERGED: all three of its gates returned STOP.
You are the remediation wave. Nothing ships until these are closed.

READ FIRST:
  docs/perf/gates/G2a.md, G2b.md, G2c.md — the findings, each with MEASURED evidence and a stated fix
  docs/perf/CONTRACT.md  §0 vocabulary, §2.2 paused-as-validity, §3.1 SENTINEL PROTOCOL, §7 precedence,
                         §9 deferrals, §10 provisional constants, §11 names
  docs/ULTRACODE_PERFORMANCE_PLAN.md §4

WHAT THE GATES ESTABLISHED, so you do not relitigate it: the workbench itself WORKS. G2b drove all six
control classes through the real DOM controls and every one moved live rendering state, with numbers.
A6 is green for the right reason (the flip was re-run). Precedence holds across 30 frames and a tier
change. The gesture is reachable on a no-query load where window.__BIRB === undefined. Do not redesign
any of that. You are closing specific, measured defects.

THE ORACLES ARE HASH-FROZEN AND YOU MAY NOT EDIT THEM (R5): tests/**, tools/lib/quality-assertions.mjs,
tools/birb-quality.mjs, docs/perf/CONTRACT.md, and 56 files in tools/oracle-manifest.txt. If a frozen
oracle looks wrong, SAY SO IN 'deviations' and satisfy it anyway. Two agents last wave correctly
refused to edit a suite and reported the defect instead — that is the required behaviour.
(tools/birb-shot.mjs, birb-sheet.mjs and birb-lighting.mjs are intentionally modified under an
orchestrator exemption and will be re-frozen; leave them alone.)

ORACLE RULES: R1 never --test-name-pattern. R2 never pipe a harness into grep — capture the exit code,
then grep the log. R6 no SwiftShader number becomes a device claim. R8 a check is not trusted until it
has been watched failing.

VERIFY WITH REAL OUTPUT, and paste it:
  npm test                              # env unset — must stay exit 0, siblings unharmed
  BIRB_PERF_IMPL=1 npm test             # GREEN is this wave's deliverable
  node tools/birb-modes.mjs             # console WARNINGS are failures
  node tools/birb-shaders.mjs
  sha256sum -c tools/oracle-manifest.txt`

const FIX = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    findingsClosed: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          finding: { type: 'string', description: 'e.g. "G2a §4.3 ACC-2 reports a quantity it does not score"' },
          fix: { type: 'string' },
          proof: { type: 'string', description: 'the measurement showing it is closed — the same measurement the gate used, re-run' },
        },
        required: ['finding', 'fix', 'proof'],
      },
    },
    suiteResult: { type: 'string' },
    repoStillGreen: { type: 'string' },
    oraclesUntouched: { type: 'boolean' },
    deviations: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'findingsClosed', 'suiteResult', 'repoStillGreen', 'oraclesUntouched', 'deviations'],
}

phase('Fix')

const FIXES = [
  {
    key: 'metrics-stats', model: 'sonnet', effort: 'high',
    prompt: `TASK P2R.1 — src/game/frame-metrics.js and src/game/frame-stats.js. These are ONE task because
the central defect is that they disagree.

(1) G2a §4.1 / G2b §5.1 / G2c §1.2 — THREE GATES BLOCKED ON THIS. BIRB_PERF_IMPL=1 is red:
    FS-A1b "the acceptance gate and the controller share one percentile implementation" 51 !== 52.
frame-stats.js carries a private nearestRankPercentile; CONTRACT requires ONE implementation, because
the value the controller fires on and the value the acceptance gate scores must be the same number.
The two frozen suites disagree on units: every P1.1a call passes a FRACTION (0.5/0.95/0.99/1), FS-A1b
passes 95. Both are frozen and both must pass. The reconciliation G2a wrote out and verified:
make frame-metrics.percentile treat p > 1 as a percentage (p = p/100) and p <= 1 as a fraction — note
percentile(1..100, 1) must still be 100, i.e. 1 stays a fraction. Then DELETE nearestRankPercentile
from frame-stats.js and import the one helper. That also fixes G2a §4.11: the private version is
O(n^2) (sorts, then rescans per value) at 1.94 ms/call over 512 samples vs 0.08 ms for the shared one,
inside the panel whose whole job is measuring frame time.

(2) G2a §4.3 — ACC-2 reports a quantity it does not score. acc2Pass comes from longFraction
(intervals > 25 ms) but the gate reports value: missedTargetPct (> B = 16.67 ms) against
threshold: longIntervalMaxFraction * 100. Measured: 200 samples, 80 at 20 ms, none over 25 ms gives
{"pass":true,"value":40,"threshold":1} — a gate displaying 40 against a threshold of 1, and passing.
The danger is downstream: someone "fixes" the pass computation to match the printed number and
silently turns ACC-2 into a 16.67 ms test. Report ONE pair of units for the value and its threshold.

(3) G2a §4.4 — ACC-3 counts PAUSED samples as unexplained spikes. The loop tests
\`sample.dtMs > T.spikeMs && !sample.tag\` and never checks validity, so a hidden-tab frame
(valid:false, invalidReason:'hidden', no tag) counts as unexplained. CONTRACT §2.2: tags EXPLAIN
spikes, validity EXCLUDES samples — different axes. Add the validity test.

(4) G2a §4.5 — unexplainedSpikes renders 0 where there is no measurement. It is only assigned inside
\`if (sufficient)\`. With 10 samples all at 900 ms, p95 correctly renders the sentinel and this renders
0 — and CONTRACT §3.1 lists 0 FIRST among forbidden sentinel substitutes, because a zero reads as a
clean run. Return the insufficient-samples sentinel like its siblings.

(5) G2a §4.9 — evaluateOscillation counts reversals outside the window it advertises. \`settled\` is
filtered below by settleWindow and never bounded above, while the result advertises
{startMs: settleMs, endMs: settleMs + windowMs}. Entries at 6/7/80/81/82 s with observedMs 100000 give
4 reversals for a window closing at 35 s. Either bound the filter by endMs or report the window
actually measured. Pick one and say which.

(6) G2a §4.10 / G2b §5.5 — PER-FRAME ALLOCATION, now LIVE in the render loop at index.html:6570.
createIntervalRecorder().sample() allocates a fresh \`{dtMs, tMs, valid, invalidReason}\` literal every
frame, plus a second on a hitch: 0.915 MB per 60,000 calls, ~55 KB/s at 60fps. CLAUDE.md house rule 4
is "reuse objects with _ prefix, never allocate in update()", in the one module that measures the
frame. The ring is already new Array(capacity) — pre-fill it with record objects and mutate fields.
Keep __buffers() returning the LIVE buffers, which the oracle requires.

(7) G2a §4.12 — HITCH_THRESHOLD_MS = 50 in frame-metrics and spikeMs: 50 in frame-stats are the same
PRO-12 number declared twice. Derive frame-stats' from the exported constant.

BIRB_PERF_IMPL=1 npm test GREEN is the deliverable. Do not edit either frozen suite to get there.`,
  },
  {
    key: 'quality-settings', model: 'haiku', effort: 'medium',
    prompt: `TASK P2R.2 — src/game/quality-settings.js. Two blocking findings, both measured.

(1) G2a §4.6 — Benchmark's freeze leaks and the sun never thaws. setMode thaws BENCHMARK_FROZEN only
on the exact transition benchmark -> auto. Measured: setMode('benchmark') freezes all four;
setMode('manual') leaves all four frozen; setMode('auto') STILL leaves all four frozen, because
oldMode === BENCHMARK is false on the manual -> auto hop. There is no path back. Leave Benchmark via
Manual and the sun is pinned for the rest of the session with nothing saying so — and every capture
after that is silently taken at one time of day, which is exactly the confound Benchmark exists to
prevent. FIX: thaw on ANY exit from benchmark (test oldMode === BENCHMARK before dispatching on
newMode).

(2) G2a §4.7 — an UNWIRED control reports clamped:true, applied:true. request() computes
\`clamped = value !== effectiveAfter\`. With apply wired to nothing — the exact failure G2b exists to
detect — request({source:'panel', key:'dpr', value:1.0}) returns
{"requested":1,"effective":1.7,"clamped":true,"changed":false,"applied":true,"rejected":false}.
Nothing happened and the record says the request was applied and merely clamped. CONTRACT §0 already
has the word for requested !== effective. FIX: make \`clamped\` mean the injected clamp() bounded the
request (clampedValue !== value), add a separate \`desync: effectiveAfter !== clampedValue\` for the
other case, and stop setting applied:true unconditionally.

(3) Carry-forward: BENCHMARK_FROZEN includes 'seed' and calls freeze('seed', true), but the seeded RNG
does not exist yet — another agent in this wave is building it. Do NOT remove the seed entry. Make
sure that when the mechanism is absent the state is reported honestly (the sentinel), never as a
successful freeze of a mechanism that is not there.

Pure module: imports nothing, side effects injected. Your oracle is tests/quality-settings.test.js.`,
  },
  {
    key: 'gpu-and-bloom', model: 'haiku', effort: 'medium',
    prompt: `TASK P2R.3 — two small, independent, precisely located fixes.

(1) G2a §4.8 — src/game/gpu-timer.js reports state 'ok' after its context goes away.
probeCapability() re-probes only when isContextLost() is true, and isContextLost() opens with
\`if (!gl) return false\` — so "there is no context at all" is not counted as lost. Measured: probe ok
-> {state:'ok'}; getContext() then returns null -> STILL {state:'ok', reason:null, available:true}.
This module was commissioned precisely so a wiring bug could not wear a platform fact's clothes, and
it currently does the opposite. FIX: re-check getContext() before returning the cached probeState
(treat a null context as invalidating the cache) and cache the extension object from the probe.

Note for your report: gpu-timer returns reason 'not-webgl2', which is NOT in CONTRACT §3.1's closed
reason enum (G2b §5.4b). You may not edit CONTRACT. Report it in 'deviations' as needing a §3.1
amendment row; the orchestrator owns that.

(2) G2a §4.13 — src/effects/bloom-pass.js: setDownscale before the first setSize collapses every
target to 1x1, because lastWidth/lastHeight/lastRatio initialise to 1 and setDownscale re-derives
against 1x1x1. index.html sizes on init so it is unreachable today, but a panel control firing early
reaches it. FIX: guard setDownscale on "no size cached yet" and skip the re-derive until the first
setSize has run.

Verify with node tools/birb-shaders.mjs and node tools/birb-modes.mjs (capture exit codes; console
warnings are failures). A shader that fails to compile draws NOTHING while the page still screenshots
fine, so a screenshot is not verification here.`,
  },
  {
    key: 'ci', model: 'sonnet', effort: 'medium',
    prompt: `TASK P2R.4 — repair the CI regression. THIS IS THE MOST URGENT FIX IN THE WAVE and it is the
reason Wave 2 cannot merge.

G2c §3.4, measured: the CI this wave shipped puts three birb-quality steps at positions 6-8 of the
browser-health job. Two of them (--selftest at step 6, --check all at step 8) exit 1 on this tree with
NO continue-on-error. So the job dies at step 6 and steps 9-12 — birb-shot --start, birb-shot --start
--nest, birb-modes and birb-shaders — NEVER EXECUTE on any push touching index.html, src/** or sw.js.

birb-modes is the warnings-are-failures check that exists because this repo shipped a world which
rendered perfectly with its nesting and collectibles systems never created. This wave disabled it.
That is strictly worse than adding no CI at all, and it must not reach main.

FIX, in this order of principle:
(a) The pre-existing game-health checks run FIRST and unconditionally. Nothing this programme adds may
    prevent them from running. Put the birb-quality steps AFTER them.
(b) A step that is expected to fail today carries continue-on-error AND a comment naming the wave that
    removes it. A step that is expected to pass carries neither. Decide per step, from measured exit
    codes — run each one and record what it actually returns before you write the YAML.
(c) G2c §3.5 — the step NAMES and comments state the opposite of the truth. One reads "Resize-restore
    bug still present on HEAD ... exits 0 on HEAD (expected red), exits 1 otherwise (regression)".
    A6 now PASSES because Wave 2 FIXED the bug; G2b proved it by reverting the one-line sizing change
    and watching it go red again. Rewrite every name and comment to describe what the step now does.
(d) G2c §3.3 — the timeout raise 12 -> 24 is adequate, but its justifying comment cites ~4m/~3m/~5m for
    steps that actually measure 60s/21s/31s. In a programme whose first principle is that an unmeasured
    number becomes a fabricated constant three waves later, do not leave invented figures in a
    justification. Measure them and quote the real ones.
(e) tests.yml: the BIRB_PERF_IMPL suites must run in CI. Add the step. If they are not yet green when
    you run them, use continue-on-error with a comment naming Wave 2R — never silently.

VERIFY WITH A REAL YAML PARSER, both files:
    python3 -c "import yaml; yaml.safe_load(open('.github/workflows/browser-health.yml'))"
    python3 -c "import yaml; yaml.safe_load(open('.github/workflows/tests.yml'))"
node -e readFileSync is a no-op that passes on malformed YAML.

Then SIMULATE THE JOB ORDER LOCALLY: run the steps in the order the YAML lists them, capture each exit
code, and show that a failing birb-quality step cannot prevent birb-modes and birb-shaders from
running. That simulation is the deliverable, not the diff.`,
  },
  {
    key: 'seeded-rng', model: 'sonnet', effort: 'high',
    prompt: `TASK P2R.5 — the seeded world RNG. This task was assigned in Wave 2, hit an API error, and
shipped NOTHING. Confirmed: src/environment/seeded-random.js does not exist and src/environment/ still
makes 76 raw Math.random() calls (spherical-world 52, world-shell 17, weather 4, collectibles 3).

WHY IT MATTERS (G0 found it; nothing in the original decomposition owned it): the plan's control table
requires Benchmark to freeze "seed, route, settings and sun" — but THERE IS NO SEED. Every page load
builds a different world, so any two-page-load A/B in Wave 5 compares two worlds rather than two
settings, and it is why G0's own mean-pixel check could not resolve a small change. quality-settings
already calls freeze('seed', true) on a mechanism that does not exist.

BUILD IT:
1. src/environment/seeded-random.js — mulberry32 or equivalent. Deterministic, imports nothing, unit
   testable under plain node --test. Export a factory so independent streams do not interfere.
2. Thread it through every builder that calls Math.random() in spherical-world.js, world-shell.js,
   weather.js and collectibles.js. Independent streams per subsystem, so adding a call to one builder
   does not reshuffle another's world — a single shared stream makes every future edit a world change.
3. Export whatever __BIRB.worldSeed(n) needs. Do NOT edit index.html; report the surface you exported.
4. tests/seeded-random.test.js — determinism, independence, and that a stream is not order-coupled to
   its siblings.

PROVE THE WORLD IS REPRODUCIBLE — this is the deliverable, not the diff. Two builds at the same seed
must produce identical geometry. Sum instanced-mesh translations across two builds at one seed and
diff them; show the numbers. Then show two DIFFERENT seeds produce different worlds, or you have
proved only that you disabled the randomness.

Report the Math.random() count you started with, the count remaining, and a reason for every survivor.
A survivor outside world construction (a UI jitter, a sound variation) is legitimate; one inside a
builder silently reintroduces the nondeterminism this task exists to remove.

Verify with node tools/birb-modes.mjs and node tools/birb-shaders.mjs — you are touching every
environment builder, so a broken world is the risk. Capture exit codes.`,
  },
  {
    key: 'capturers', model: 'sonnet', effort: 'high',
    prompt: `TASK P2R.6 — the seven missing live capturers. G2b §5.2 and G2c's stated decision.

Creating src/ui/dev-quality-panel.js and src/ui/dev-gesture.js flipped seven assertions to "available"
in tools/birb-quality.mjs, but LIVE_CAPTURES has no capturer for any of them. So --check all and
--selftest both exit 1 for a HARNESS reason, and A1, A2, A3, A5, A10, A11 and A12 currently have no CI
oracle at all — the panel this wave built is ungraded.

tools/birb-quality.mjs is FROZEN and you may not edit it. G2c's decision, which you are implementing:
put the seven capturers in a NEW file, tools/lib/quality-captures.mjs, which is neither frozen nor in
the manifest. Structure it so the frozen harness can consume it — read how LIVE_CAPTURES is shaped and
match that contract exactly. If wiring it in genuinely requires a one-line import in the frozen
harness, STOP and report that in 'deviations' rather than editing it; the orchestrator owns the
re-freeze.

Each capturer drives the REAL page through playwright and returns the snapshot shape its assertion
needs. Read docs/perf/ASSERTIONS.md and tools/lib/quality-assertions.mjs for each one's required
fields. A1 and A2 must be captured on the PRODUCTION path (no ?debug) per CONTRACT §6 — that is the
whole point of those two assertions, and A1's snapshot needs debugParamPresent false.

Known trap, from G2b §5.9 (GAP-A2): sprintState.active has no reader on __BIRB, so half of A2 is
unreadable and assertA2 returns unavailable. Note also that updateSprintState only engages the sprint
in GAME_MODES.RING_RUSH, so a capturer that checks it in Casual will read false for a legitimate
reason and must not score that as a failure. Expose what you need via the ?debug surface in index.html
(that is allowed — it is a harness hook, not the panel), and say what you added.

R8: prove each capturer discriminates. For at least A1, A2 and A5, force the assertion's TRUE state
artificially and show the assertion flips. A capturer that always returns a passing snapshot is worse
than no capturer, because it converts an honest "unavailable" into a false green.`,
  },
]

const fixes = (await parallel(FIXES.map(f => () =>
  agent(`${REPO}\n\n${f.prompt}

DELIVERABLE DISCIPLINE:
- Own ONLY your files. Another agent owns the rest and you will collide.
- For every finding you close, re-run THE GATE'S OWN MEASUREMENT and paste the result. "Fixed" without
  the measurement that showed it broken is not evidence.
- 'deviations' being empty is suspicious.`,
    { label: `P2R-${f.key}`, phase: 'Fix', model: f.model, effort: f.effort, schema: FIX })
))).filter(Boolean)

log(`Fixes: ${fixes.length}/${FIXES.length} returned; ${fixes.reduce((n, f) => n + f.findingsClosed.length, 0)} findings closed; oracles untouched: ${fixes.every(f => f.oraclesUntouched)}`)

phase('Regate')

const G2D = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'STOP'] },
    reason: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the original finding, e.g. "G2a §4.3"' },
          closed: { type: 'boolean' },
          evidence: { type: 'string', description: 'the re-run measurement' },
        },
        required: ['id', 'closed', 'evidence'],
      },
    },
    ciSafe: { type: 'boolean', description: 'do the pre-existing game-health checks still run unconditionally?' },
    perfImplGreen: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
    safeToMerge: { type: 'boolean' },
  },
  required: ['verdict', 'reason', 'findings', 'ciSafe', 'perfImplGreen', 'blockers', 'safeToMerge'],
}

const g2d = await agent(
`${REPO}

You are GATE G2d. Wave 2 will be MERGED TO MAIN AND DEPLOYED TO PRODUCTION if you pass it, so the
question is not "did the agents try" but "is this safe to ship and is each measured defect actually
closed". Write docs/perf/gates/G2d.md, first line exactly 'VERDICT: PASS' or 'VERDICT: STOP — <reason>'.

Re-run the GATES' OWN MEASUREMENTS. Do not accept a fix report; reproduce the number that showed the
bug and show it has moved. Work the blocking list from G2a/G2b/G2c:

1. FS-A1b / one percentile implementation. BIRB_PERF_IMPL=1 npm test must be GREEN. Confirm
   frame-stats imports the shared helper and no private nearestRankPercentile survives. Check
   percentile(1..100, 1) is still 100 (1 is a fraction, not 1%).
2. ACC-2 units. Re-run: 200 samples, 80 at 20 ms, none over 25 ms. The value and its threshold must be
   the same quantity.
3. ACC-3 validity. Re-run FS-A2's own fixture: 120 good frames plus 8 at 900 ms marked valid:false.
   Clean and dirty must now agree.
4. unexplainedSpikes sentinel. 10 samples at 900 ms must render the insufficient-samples sentinel, not 0.
5. Benchmark thaw. setMode benchmark -> manual -> auto must leave nothing frozen.
6. clamped/applied. With apply wired to nothing, the record must not claim applied:true.
7. GPU timer with a null context must not report ok.
8. evaluateOscillation must not count outside its advertised window.
9. Per-frame allocation. Measure the heap delta over ~60,000 sample() calls; it was 0.915 MB.
10. THE SEEDED WORLD. Build twice at one seed and compare real geometry YOURSELF — do not accept the
    agent's word, this task already failed once. Then build at two different seeds and confirm they
    DIFFER, or the randomness was merely disabled. Count surviving Math.random() in src/environment/.
11. THE CI, and this is the one that decides shipping. Parse both YAML files with python3 yaml. Then
    confirm by reading the step order that a failing birb-quality step CANNOT prevent birb-shot,
    birb-modes and birb-shaders from running. birb-modes is the warnings-are-failures check that
    exists because this repo shipped a world rendering perfectly with its systems never created;
    a CI that skips it is worse than no CI. Confirm no continue-on-error lacks a comment naming the
    wave that removes it, and that no step name states the opposite of what the tree does.
12. The capturers. --check all and --selftest exit codes, and whether the seven previously-ungraded
    assertions now report a real verdict. R8: confirm at least one capturer was watched flipping.

THEN THE SHIPPING CHECKS:
- npm test env-unset exit 0, siblings (humanoid/gauntlet/sculpture/icon3d) unharmed. Note the baseline
  legitimately moved to 464/378/0/86 with tests/build-identity.test.js; confirm pass/fail/exit, not the
  raw total.
- birb-modes, birb-shaders, birb-shot --start, birb-shot --start --nest all exit 0.
- sha256sum -c tools/oracle-manifest.txt: the ONLY acceptable failures are tools/birb-{shot,sheet,
  lighting}.mjs under the recorded orchestrator exemption. Any other modified oracle is an automatic STOP.
- CONTRACT §11 compatibility ladder: confirm Wave 2 did NOT change live adaptive behaviour. The
  workbench must not have altered the thing it exists to measure.

'could-not-determine' is honest. A fabricated pass here ships to production.`,
  { label: 'G2d-regate', phase: 'Regate', model: 'opus', effort: 'high', schema: G2D })

log(`G2d: ${g2d?.verdict} — CI safe: ${g2d?.ciSafe}, PERF_IMPL green: ${g2d?.perfImplGreen}, safe to merge: ${g2d?.safeToMerge}`)
const open = (g2d?.findings ?? []).filter(f => !f.closed).map(f => f.id)
if (open.length) log(`STILL OPEN: ${open.join(', ')}`)
if (g2d?.blockers?.length) log(`Blockers: ${g2d.blockers.join(' | ')}`)

return { wave: '2R', fixes, g2d, safeToMerge: g2d?.safeToMerge === true && g2d?.verdict === 'PASS' }
