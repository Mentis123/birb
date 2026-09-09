export const meta = {
  name: 'perf-wave-3a-regate',
  description: 'Wave 3A re-gate — adjudicate the residual INV-18 unsatisfiability and the flaky TC-15, then verify independently',
  whenToUse: 'Run after the orchestrator fixed G3o BLOCKERs 1-3. Decides whether the controller oracles are sound enough for Wave 3B to implement against.',
  phases: [
    { title: 'Adjudicate', detail: 'Settle what "beats standing still" means when PRO-8 eats the gain, and de-flake TC-15' },
    { title: 'Regate', detail: 'G3o-2 — independent verification with the gate\'s own clairvoyant' },
  ],
}

const REPO = `Repo /home/user/birb — Birb Mobile. Branch claude/ultracode-sub-agents-plan-c9qmba.
Waves 0-2 are merged to main and live. WAVE 3A IS NOT MERGED and its default test suite is
currently RED — that is deliberate and documented, not an accident to tidy away.

READ FIRST:
  docs/perf/gates/G3o.md   the STOP and its four blockers
  docs/perf/CONTRACT.md    §9 DEFERRALS, §10 PROVISIONAL CONSTANTS (PRO-4, PRO-6, PRO-8 matter most)
  docs/ULTRACODE_PERFORMANCE_PLAN.md §4 Wave 3
  git log -1 8b1df27       the orchestrator's own account of what was fixed and what was got wrong
  tests/fixtures/perf-traces/{holdout,driver,invariants,schema}.js
  tests/perf-trace-corpus.test.js  (TC-15 is the discriminator test)
  tools/perf-satisfiability.mjs    the clairvoyant instrument

WHAT G3o FOUND, AND IT IS THE BEST FINDING OF THIS PROGRAMME. It built a CLAIRVOYANT controller
— one reading feasibleRung straight out of the capacity model, an upper bound no real controller
can beat — and proved the oracle set was UNSATISFIABLE on 9.2% of holdout traces (11 of 120).
Nine of the eleven passed the instant PRO-8's probe budget was ignored. The oracles were pushing
every implementer toward the one behaviour the contract forbids while every other check scored
them clean. The principle it established is now permanent:
  BEFORE SHIPPING AN ORACLE, PROVE A CONFORMING IMPLEMENTATION CAN SATISFY IT.

WHAT THE ORCHESTRATOR THEN FIXED (all verified in both directions, all committed at 8b1df27):
1. THE ESCAPE HATCH. driver.js enforced PRO-8 only when the controller labelled its own move
   'probe', so a policy climbing a rung every 3 s with kind:'upshift' scored ZERO probes and
   passed INV-7 vacuously. An upward move must now be a probe under PRO-8 or a restore justified
   by PRO-4's stability window; otherwise it raises 'unlabelled-probe'. Verified BOTH ways: the
   free climber is caught, and the conforming clairvoyant still passes.
2. THE GENERATOR. holdout.js demanded climbs PRO-8 makes impossible (six rungs in 78 s) because
   nothing counted the budget its own comment described. It now extends the TAIL to fit the climb
   — not thinning regime changes, which would make holdout traces systematically calmer than the
   committed corpus and that is a shape a controller could learn. startRung was moved earlier so
   the first leg of the climb counts.
3. A NARROW INV-18 GUARD: skip only where the starting rung is already the best of every fixed
   profile, because there standing still is optimal and nothing can beat it.

TWO THINGS THE ORCHESTRATOR GOT WRONG, RECORDED SO YOU DO NOT REPEAT THEM:
- Two WIDER guards were tried first and both gutted the holdout: "skip when the climb does not
  fit" skipped 10 of 12 traces; "skip when gain minus toll is small" skipped 12 of 12. TC-15
  caught both within a minute by finding that a controller which never adapts passed everything.
  A GUARD WIDE ENOUGH TO HIDE AN UNSATISFIABLE TRACE IS WIDE ENOUGH TO HIDE A BAD CONTROLLER.
- The first clairvoyant instrument left probes outstanding forever, so after its first probe it
  never moved again, scored identically to standing still, and reported SATISFIABLE. An
  instrument that cannot move is not an upper bound, and its green was an artifact.

WHERE IT STANDS NOW, measured:
  node tools/perf-satisfiability.mjs  -> 4 of 120 traces still fail INV-18 (3.3%, was 11)
  Their signature: the clairvoyant matches standing still almost exactly, e.g.
    "outside 0 vs 0 ms, degraded 80700 vs 80700 ms" — identical, or the clairvoyant slightly worse.
  TC-15 draws a RANDOM holdout seed per run, so it fails intermittently:
    three consecutive npm test runs gave exit 0, 1, 1.

RULES: R1 no --test-name-pattern. R2 never pipe a harness into grep. R6 no SwiftShader number is
a device claim. R8 a check is not trusted until it has been WATCHED FAILING.
The 58 files in tools/oracle-manifest.txt are frozen; the Wave 3A fixture/test files are NOT
frozen (they are this wave's own deliverable) and may be edited.`

phase('Adjudicate')

const FIX = {
  type: 'object',
  properties: {
    decision: { type: 'string', description: 'what "beats standing still" now means, and why' },
    files: { type: 'array', items: { type: 'string' } },
    satisfiability: { type: 'string', description: 'clairvoyant failures out of 120, before and after' },
    discrimination: { type: 'string', description: 'across >=5 seeds: skipped/scored/idle-failed per seed. The idle controller MUST still fail where scored.' },
    determinism: { type: 'string', description: 'proof TC-15 is no longer flaky — repeated npm test runs with exit codes' },
    guardWidth: { type: 'string', description: 'what fraction of traces the guards now skip, and why that is not too wide' },
    deviations: { type: 'array', items: { type: 'string' } },
  },
  required: ['decision', 'files', 'satisfiability', 'discrimination', 'determinism', 'guardWidth', 'deviations'],
}

const fix = await agent(
`${REPO}

TASK — settle the two open items. You have a free hand on the Wave 3A fixture and test files.

ITEM 1 — THE RESIDUAL 3.3%. Decide what INV-18 ("beats standing still") should mean when PRO-8's
probe toll consumes the gain on offer, and make the oracle say that.

Do the diagnosis before the fix. For each of the 4 failing traces, establish WHY a clairvoyant
cannot beat standing still. Candidate causes, and they need different answers:
  (a) the start rung is already optimal — the existing narrow guard should catch it; if it does
      not, find out why rather than widening it;
  (b) a better rung exists but PRO-8's toll to reach it exceeds the benefit — standing still is
      genuinely competitive and the trace should not score;
  (c) the metric itself is wrong — timeUnnecessarilyDegradedMs may charge the controller for the
      probe time PRO-8 forces it to spend, which is the same number pointing the wrong way that
      INV-18's own comment warns about for the climb allowance;
  (d) the generator still under-extends.
State which cause each failure has. If it is (c), fixing the METRIC is better than guarding the
invariant, because a metric that charges a controller for obeying the contract poisons INV-14 and
the evaluator's own RL-6 numbers too.

The bar: the clairvoyant upper bound must pass ALL 120 traces, AND the idle controller must still
fail on a healthy fraction of scored traces. Both, or you have not fixed it. Report the numbers.

ITEM 2 — TC-15 IS FLAKY AND THAT IS UNACCEPTABLE. It draws a random holdout seed per run, so it
fails intermittently in the DEFAULT npm test — which is four sibling projects' CI (humanoid,
gauntlet, sculpture, icon3d). A nondeterministic test in a shared suite is worse than no test.

But do NOT simply pin a seed into the file: TC-14 asserts the holdout has no committed default
seed, and a committed seed turns the holdout into more committed scenarios, deleting the only
check that catches a controller tuned to the corpus. Resolve that tension properly. Options worth
weighing: make TC-15 sample MANY seeds and assert a statistical property rather than a
per-seed one; or separate "the holdout discriminates" (deterministic, seed-swept, default suite)
from "this specific seed's traces are satisfiable" (gate-supplied seed, gate-only). Say which you
chose and why the other was worse.

VERIFY, and paste real output:
  node tools/perf-satisfiability.mjs                  # must reach SATISFIABLE
  npm test                                            # exit 0, run it FIVE times, all exit 0
  BIRB_PERF_IMPL=1 npm test                           # red only for module-absent reasons
  sha256sum -c tools/oracle-manifest.txt              # exit 0`,
  { label: 'adjudicate', phase: 'Adjudicate', model: 'opus', effort: 'xhigh', schema: FIX })

log(`Adjudicated: ${fix?.decision?.slice(0, 160) ?? 'FAILED'}`)

phase('Regate')

const G = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'STOP'] },
    reason: { type: 'string' },
    ownClairvoyantResult: { type: 'string', description: 'YOUR clairvoyant, not the committed instrument: failures out of N' },
    discriminationHolds: { type: 'boolean' },
    flipsHold: { type: 'boolean', description: 'the six named failure modes still flip after all the edits' },
    corpusRespondsToDecisions: { type: 'boolean' },
    deterministic: { type: 'boolean', description: 'npm test exit 0 on five consecutive runs' },
    blockers: { type: 'array', items: { type: 'string' } },
    readyForWave3B: { type: 'boolean' },
  },
  required: ['verdict', 'reason', 'ownClairvoyantResult', 'discriminationHolds', 'flipsHold', 'corpusRespondsToDecisions', 'deterministic', 'blockers', 'readyForWave3B'],
}

const gate = await agent(
`${REPO}

The adjudication is done:
${JSON.stringify(fix, null, 2)}

You are GATE G3o-2. Append your verdict to docs/perf/gates/G3o.md under a clear
"## Re-gate" heading, and make the FILE'S FIRST LINE 'VERDICT: PASS' or 'VERDICT: STOP — <reason>'.

DO NOT TRUST THE COMMITTED INSTRUMENT. tools/perf-satisfiability.mjs was written by the same
orchestrator whose first version silently never moved and reported SATISFIABLE. WRITE YOUR OWN
CLAIRVOYANT, independently, and use it as the upper bound. If yours disagrees with the committed
one, say so loudly — a disagreement between two upper bounds means at least one is broken.

1. SATISFIABILITY, with your own clairvoyant over at least 120 traces across at least 10 seeds.
   Zero failures is the bar. Report the number.
2. DISCRIMINATION SURVIVED. An idle controller and a thrash controller must still FAIL on a
   healthy fraction of scored traces. Report skipped/scored/failed per seed. If the guards now
   skip most traces, that is a STOP however green the clairvoyant is — the orchestrator has
   already made this exact mistake twice and TC-15 caught it both times.
3. THE FLIPS STILL HOLD after all these edits (R8). Re-force the six named modes and confirm each
   flips: a controller reducing a BUNDLE of costs in one step; one timer serving both overload and
   recovery; a no-op apply; an evaluation crediting a confounded window; a controller reaching
   budget by degrading input or collision fidelity; a stable-but-permanently-degraded state
   reported as success. Also re-confirm the free climber (kind:'upshift' every 3 s) is still
   caught — that fix is new and nothing else guards it.
4. THE CORPUS STILL RESPONDS TO DECISIONS. Drive it with two different policies and confirm the
   synthesised dtMs DIFFERS. If it does not, it is a recorded array wearing a capacity model's
   clothes and every test of a decision is vacuous.
5. DETERMINISM. Run npm test FIVE times. Five exit zeros, or it is still flaky. Confirm TC-14's
   no-committed-seed assertion still passes — a fix that pins a seed into the worktree deletes the
   holdout's entire purpose.
6. NO FROZEN ORACLE WAS EDITED: sha256sum -c tools/oracle-manifest.txt.
7. DEF-1 AND DEF-2 STILL RESPECTED: no suite may demand a localStorage persistence store or a GPU
   query pool. A suite that requires deferred work forces Wave 3B to build it.

'could-not-determine' is honest. A fabricated pass here hands Wave 3B a fake safety net, and Wave
3B is the controller — the most delicate thing in the programme.`,
  { label: 'G3o-2', phase: 'Regate', model: 'opus', effort: 'high', schema: G })

log(`G3o-2: ${gate?.verdict} — own clairvoyant: ${gate?.ownClairvoyantResult}, discriminates: ${gate?.discriminationHolds}, deterministic: ${gate?.deterministic}`)
if (gate?.blockers?.length) log(`Blockers: ${gate.blockers.join(' | ')}`)

return { wave: '3A-regate', fix, gate, readyForWave3B: gate?.verdict === 'PASS' && gate?.readyForWave3B === true }
