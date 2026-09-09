export const meta = {
  name: 'perf-wave-0',
  description: 'Wave 0 of docs/ULTRACODE_PERFORMANCE_PLAN.md — baseline, read-only probes, the contract, and the requirements verifier',
  whenToUse: 'First wave of the adaptive-realism programme. Run before any implementation wave. Produces docs/perf/{BASELINE,CONTRACT}.md and makes every later oracle observable.',
  phases: [
    { title: 'Baseline', detail: 'Record HEAD behaviour of every existing harness — exit codes AND console-noise lists' },
    { title: 'Probes', detail: 'Read-only observability hooks: effective(), frameTotals(), stats().pinned' },
    { title: 'Contract', detail: 'Opus authors docs/perf/CONTRACT.md + requirements.json, then the structural verifier' },
    { title: 'Gate', detail: 'G0 — prove the probes changed no pixel and report measured state, not intent' },
  ],
}

const REPO = `Repo /home/user/birb — Birb Mobile. Vanilla ES modules, CDN Three 0.183.2, NO build step.
Branch: claude/ultracode-sub-agents-plan-c9qmba.
Read docs/ULTRACODE_PERFORMANCE_PLAN.md (this wave is section 4, "Wave 0") and
docs/PERFORMANCE_REALISM_PLAN.md (what is ultimately being built).

GROUND TRUTH — trust this over your own assumptions:
- index.html is 9624 lines. Adaptive tier IIFE at ~6494 ("ADAPTIVE QUALITY TIER"). Resize handling ~6775.
  window.__BIRB registered at 8928, ONLY under ?debug. setBloom 9358, setLighting 9372, pinTier 9427, stats 9478.
  adaptiveTier.pin() sets state.pinned; isPinned() exists at ~6576; there is NO unpin and isPinned is NOT exposed on __BIRB.
- stats() reads bloomPass.frameStats only while adaptiveTier.getTier() < 1, else renderer.info.render — which
  resets on EVERY render() call, so after the composite it reports ~1 call. Whole-frame totals are therefore
  unreported at exactly the degraded tiers the controller exists to manage.
- src/effects/bloom-pass.js: 5 render() calls/frame without shafts, 8 with. blurA/blurB/rayTarget all sized from
  ONE constructor-only 'downscale' option; setSize(w,h,ratio) stores nothing, so a live setter needs new state.
- node_modules/three is a 414-line hand-written stub TRACKED IN GIT exporting only Vector3/Quaternion/Euler/Matrix4.
  CI runs 'npm test' (= node --test) with NO install step. Any npm install prunes the stub:
  always 'npm install --no-save <all packages in ONE command>' then 'git checkout -- node_modules/three/index.js'.
- Existing oracles: npm test; node tools/birb-shot.mjs --out X --start [--nest]; node tools/birb-modes.mjs
  (console WARNINGS are failures); node tools/birb-shaders.mjs. CI: .github/workflows/{tests,browser-health}.yml.
- birb-shot.mjs already supports --eval (before settle), --after (after settle), --afterSettle, and prints 'stats: {json}'.

ORACLE RULES — binding on everything you write:
R1 never use --test-name-pattern (exits 0 when it matches nothing); name explicit test files.
R2 never pipe a harness into grep (discards exit code; every harness here prints its summary BEFORE process.exit(1)).
   Run to a log, capture $?, assert the code, then grep the log.
R3 scope oracles to files you own; whole-suite runs happen at gates.
R6 no SwiftShader number may become a device claim.
R8 a check is not trusted until it has been watched failing.`

phase('Baseline')

const BASELINE = {
  type: 'object',
  properties: {
    harnesses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          exitCode: { type: 'integer' },
          consoleNoise: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['command', 'exitCode', 'consoleNoise', 'notes'],
      },
    },
    unitTests: { type: 'string', description: 'exact pass/fail/skip counts from npm test' },
    installRecipe: { type: 'string', description: 'the exact contents of tools/ensure-harness.sh you wrote' },
    surprises: { type: 'array', items: { type: 'string' }, description: 'anything not green on HEAD — report, do not fix' },
  },
  required: ['harnesses', 'unitTests', 'installRecipe', 'surprises'],
}

const baseline = await agent(
`${REPO}

TASK P0.1 — record what HEAD actually does, and make the harness install reproducible.

1. Write tools/ensure-harness.sh: ONE npm install --no-save of playwright + https-proxy-agent, then
   'git checkout -- node_modules/three/index.js', then 'npx playwright install --with-deps chromium'.
   Idempotent, set -euo pipefail. Make it executable.
2. Run it, then record HEAD's behaviour for EVERY existing oracle:
     npm test
     node tools/birb-shot.mjs --out /tmp/start.png --start
     node tools/birb-shot.mjs --out /tmp/nest.png --start --nest
     node tools/birb-modes.mjs
     node tools/birb-shaders.mjs
   For each: the exit code and the FULL console-noise list. Later waves assert "unchanged from baseline",
   never "exit 0" — birb-modes treats warnings as failures and nobody has established it is green on this branch.
3. Write docs/perf/BASELINE.md with all of it, including the date and commit sha.

Report honestly. If something is already red on HEAD, that is the single most valuable output of this task —
record it in 'surprises' and do NOT fix it. A later wave asserting "unchanged from baseline" needs the truth.`,
  { label: 'P0.1-baseline', phase: 'Baseline', model: 'sonnet', effort: 'low', schema: BASELINE }
)

log(`Baseline: ${baseline ? baseline.harnesses.map(h => `${h.command.split(' ').slice(-2).join(' ')}=${h.exitCode}`).join(' ') : 'FAILED'}`)
if (baseline?.surprises?.length) log(`HEAD is not clean: ${baseline.surprises.join(' | ')}`)

phase('Probes')

const BASE_FACTS = baseline
  ? `\nBASELINE (from P0.1 — assert against this, never against "exit 0"):\n${JSON.stringify(baseline, null, 2)}`
  : '\nBASELINE: P0.1 failed; re-run it before trusting anything here.'

const PROBE = {
  type: 'object',
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    surface: { type: 'string', description: 'the exact hook signature(s) added, as they appear in the code' },
    readsFrom: {
      type: 'array',
      description: 'For each reported field: the LIVE object property it reads. Not a recomputation.',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          source: { type: 'string', description: 'e.g. "bloomPass.sceneTarget.width (live property)"' },
          derivedFromTierOrCap: { type: 'boolean', description: 'MUST be false — a hook derived from tier reports intent, not reality' },
        },
        required: ['field', 'source', 'derivedFromTierOrCap'],
      },
    },
    writesToRenderState: { type: 'boolean', description: 'MUST be false' },
    verification: { type: 'string', description: 'exact commands run and their exit codes' },
  },
  required: ['filesChanged', 'surface', 'readsFrom', 'writesToRenderState', 'verification'],
}

const PROBES = [
  {
    key: 'effective', model: 'sonnet', effort: 'medium',
    prompt: `TASK P0.2a — add __BIRB.effective(), a READ-ONLY snapshot of what is ACTUALLY sized right now.

Fields: renderer pixel ratio; gl.drawingBufferWidth/Height; a new bloomPass.getSizes() returning the LIVE
.width/.height of sceneTarget, blurA, blurB, rayTarget plus the current downscale; weather uPixelRatio;
resizeState.pixelRatio; and statsPath: 'bloom-frameStats' | 'renderer-info'.

THE ONE RULE THAT MATTERS: every field reads a live object property. Not a recomputation, not a value derived
from tier or DPR_CAP. The entire programme exists to catch a desync between what the code intended and what the
buffers are; a hook that recomputes intent cannot see it. getSizes() must read target.width, never
Math.round(w * downscale).`,
  },
  {
    key: 'pinned', model: 'haiku', effort: 'low',
    prompt: `TASK P0.2b — expose pin state.

adaptiveTier.isPinned() already exists (~index.html:6576) and is not reachable from window.__BIRB.
Add a 'pinned' field to the object returned by __BIRB.stats() (~9478), reading adaptiveTier.isPinned().

That is the whole task. Do not add an unpin, do not touch the tier logic, do not change any other field.
Capture harnesses pin tier 0 so art review is not done against degraded output; a later task makes them
print which state they captured in, and it must read this rather than assume.`,
  },
  {
    key: 'frametotals', model: 'sonnet', effort: 'medium',
    prompt: `TASK P0.2c — add __BIRB.frameTotals(): whole-frame draw calls and triangles, at EVERY tier.

Today stats() reads bloomPass.frameStats only while adaptiveTier.getTier() < 1, and otherwise reads
renderer.info.render — which resets on every render() call, so after the composite it reports ~1 call for the
whole world. Whole-frame totals are unreported at exactly the degraded tiers the controller manages.

Build an accumulator OWNED BY THE FRAME, not by the bloom pass: sum renderer.info.render across every render()
call in a frame, reset once at the top of the frame. It must count the no-post branch at tier >= 1.
Report {calls, triangles, passes} where passes is the observed render() count — 5 without shafts, 8 with
(see bloom-pass.js), and the shaft branch counted only when raysOn.

Report scene-only totals alongside whole-frame ones; do not replace one with the other.`,
  },
]

const probes = (await parallel(PROBES.map(p => () =>
  agent(`${REPO}${BASE_FACTS}

${p.prompt}

CONSTRAINTS. This is a read-only observability change and G0 will verify that mechanically:
- Write NOTHING to rendering state. No assignment to any renderer/bloom/weather property or uniform.
- Keep the zero-allocation rule: no 'new' in anything reachable from the frame loop.
- These hooks live in the ?debug block for now; the panel/gesture production-path question is P0.3's to rule on.
VERIFY (R2 — capture exit codes, never pipe into grep):
  node tools/birb-modes.mjs            # console noise list must equal the baseline's, exactly
  node tools/birb-shaders.mjs
  node tools/birb-shot.mjs --out /tmp/p.png --start --after "JSON.stringify(window.__BIRB.<your hook>())"
Report the exact commands and exit codes in 'verification'.`,
    { label: `P0.2-${p.key}`, phase: 'Probes', model: p.model, effort: p.effort, schema: PROBE })
))).filter(Boolean)

const derived = probes.flatMap(p => p.readsFrom.filter(r => r.derivedFromTierOrCap).map(r => `${r.field} <- ${r.source}`))
const writers = probes.filter(p => p.writesToRenderState).map(p => p.surface)
log(`Probes: ${probes.length}/3 landed. ${derived.length ? `DERIVED-FROM-INTENT: ${derived.join(', ')}` : 'no intent-derived fields'}. ${writers.length ? `WRITES RENDER STATE: ${writers.join(', ')}` : 'all read-only'}`)

phase('Contract')

const PROBE_DIGEST = probes.map(p => `- ${p.surface}\n  files: ${p.filesChanged.join(', ')}\n  fields: ${p.readsFrom.map(r => `${r.field}<-${r.source}`).join('; ')}\n  verified: ${p.verification}`).join('\n')

const contract = await agent(
`${REPO}${BASE_FACTS}

PROBE SURFACE NOW AVAILABLE (built by P0.2):
${PROBE_DIGEST}

TASK P0.3 — author docs/perf/CONTRACT.md and docs/perf/requirements.json.

This is the document every later wave implements against, and the thing cheap-tier agents are allowed to
transcribe rather than decide. Be exact; ambiguity here becomes a fabricated constant three waves later.

MUST CONTAIN:
1. The adaptiveTier. callsite map as a SET, not a line count — 15 occurrences on 14 lines (9427 carries two).
   A count pinned to a file that eight later tasks edit is not an oracle.
2. The reset-tag enum {load, resume, resize, orientation, contextRestore, environment, manual}, with 'paused'
   as a VALIDITY STATE, not a reset. Paused measurements must be invalid for adaptive decisions, not erased.
3. The telemetry field table. Every field the source plan names, with its source hook — and for every field
   with no source yet, an explicit SENTINEL (mirroring the GPU 'unavailable' treatment). "last adjustment/
   reason" and "cooldown" have no source in Wave 0 and must render the sentinel, never a fabricated value.
4. The assertion table, with comparison operator and source pinned VERBATIM. e.g.
   'frameTotals().calls > sceneOnly.calls && frameTotals().passes === (raysOn ? 8 : 5)'.
5. The harness context pinned (deviceScaleFactor 3, isMobile, hasTouch) plus a self-check that FAILS if tier-0
   and tier-1 pixel ratios come out equal there — a dead discriminator must not pass silently.
6. THE RULING: the dev panel and its three-finger gesture register on the PRODUCTION path, not inside the
   ?debug block. window.__BIRB exists only under ?debug (index.html:8927) and every harness loads ?debug=1 —
   so a workbench built to be used on a phone at birbmobile.vercel.app would be unreachable there while every
   assertion passed. This is the hardwareConcurrency/bloom trap in a new costume; rule on it explicitly.
7. Precedence. isLowEnd (index.html:3578) still reads navigator.hardwareConcurrency, and wind (~8350), weather
   density (~8395), contact shadow (~8497) and ribbons (~8523) write these same values, several per frame.
   State the order: panel request > adaptive tier > capability probe. Name every site that must be routed.
8. sw.js. It hand-enumerates every module in CORE_ASSETS and CACHE_VERSION is a literal string. Later waves add
   8-12 new src/ modules and nothing currently owns this — the result is a blank page offline. ALSO: the phone
   used for measurement is served by a service worker, and staleWhileRevalidate serves the CACHED module first,
   so a device session's first run executes the PREVIOUS build's src/** against the new index.html. Require a
   build hash in the quality export and specify who updates sw.js in which wave.
9. The deferral ledger: persisted learning store, GPU timer query lifecycle (probe only), the 30 FPS pacing row
   — each with the reason and what evidence would reopen it.

DO NOT invent threshold values. Every number the source plan marks "tune these numbers on phones" (1.2xB,
5% missed, 10-15s restore, 20% headroom, p95 <= 18.5ms) is recorded as PROVISIONAL, with its provenance field
set to 'unmeasured' and a pointer to Wave 4. This is the single most expensive mistake available in this
programme: CLAUDE.md records that the existing 55/58 thresholds were tuned against a sampler that could not run.

requirements.json carries a stable ID per requirement, derived from the source plan's structure.`,
  { label: 'P0.3-contract', phase: 'Contract', model: 'opus', effort: 'xhigh' }
)

const verifier = await agent(
`${REPO}${BASE_FACTS}

The contract now exists at docs/perf/CONTRACT.md + docs/perf/requirements.json:
${contract}

TASK P0.4 — build tools/req-verify.mjs, plus tools/oracle-manifest.txt.

req-verify.mjs derives EXPECTED coverage STRUCTURALLY by parsing docs/PERFORMANCE_REALISM_PLAN.md — 8 control
table rows, 7 state-machine points, 6 runtime-loop steps, 5 experiment rows, 4 acceptance gates, 3 batches,
every telemetry field named in the telemetry paragraph, all 7 dev-panel items — and checks requirements.json
covers them. A verifier that checks an ID list authored by the same task cannot fail; derive from the markdown.

It must exit non-zero, with a useful message, when a requirement is uncovered.

PROVE IT DISCRIMINATES (R8), and put the transcript in your report: delete one control-table row's IDs from
requirements.json, run it, confirm RED, restore, confirm GREEN. An assertion nobody has watched fail is not
an oracle. If you cannot make it red, say so plainly — that is a STOP condition for this wave.

Also write tools/oracle-manifest.txt: sha256 of every file later waves must not modify —
tests/**, tools/birb-shot.mjs, tools/birb-sheet.mjs, tools/birb-lighting.mjs, tools/birb-modes.mjs,
tools/birb-shaders.mjs, docs/perf/CONTRACT.md. Verified with 'sha256sum -c' in later preflights.`,
  { label: 'P0.4-req-verify', phase: 'Contract', model: 'opus', effort: 'medium' }
)

phase('Gate')

const G0 = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'STOP'] },
    reason: { type: 'string' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          method: { type: 'string', description: 'the exact command or diff inspection performed' },
          result: { type: 'string', enum: ['pass', 'fail', 'could-not-determine'] },
          evidence: { type: 'string' },
        },
        required: ['name', 'method', 'result', 'evidence'],
      },
    },
    blockers: { type: 'array', items: { type: 'string' } },
    readyForWave1: { type: 'boolean' },
  },
  required: ['verdict', 'reason', 'checks', 'blockers', 'readyForWave1'],
}

const gate = await agent(
`${REPO}${BASE_FACTS}

You are GATE G0. You decide whether Wave 1 launches. Be adversarial: your job is to find the reason to STOP,
and PASS only if you cannot. Write docs/perf/gates/G0.md whose FIRST LINE is exactly
'VERDICT: PASS' or 'VERDICT: STOP — <reason>'.

Verify these MECHANICALLY. Run the commands; do not reason from the agents' own reports.

1. ZERO PIXEL CHANGE. 'git diff' shows no assignment to any renderer/bloom/weather property or uniform.
   node tools/birb-modes.mjs — console-noise list IDENTICAL to the baseline (not merely "exit 0"; the baseline
   is the authority and it may not have been green).
   node tools/birb-shaders.mjs — unchanged.
   Capture a frame before and after and compare mean pixel value.
2. THE PROBES REPORT REALITY, NOT INTENT. Read the code. No field of effective() may be computed from another
   field of the same snapshot, or derived from tier or DPR_CAP. getSizes() must read target.width as a live
   property. If a probe recomputes what the code meant to do, it cannot catch the desync the whole programme
   is about — that is a STOP.
3. THE DISCRIMINATOR IS ALIVE. At the contract's pinned harness context, tier-0 and tier-1 pixel ratios must
   differ. If they are equal, the check is dead: STOP and fix the context rather than proceeding.
4. req-verify.mjs GOES RED when a requirement row is deleted. Reproduce it yourself; do not take P0.4's word.
5. NO THRESHOLD WAS INVENTED. Every number in CONTRACT.md that the source plan marks "tune on phones" carries
   provenance 'unmeasured'. A contract that hardcodes 18.5ms as settled is a STOP — it is the exact mistake
   CLAUDE.md records for the 55/58 thresholds.
6. frameTotals() reports at tier >= 1, where renderer.info.render alone would report ~1 call.

State plainly what you could not determine. 'could-not-determine' is an honest result; a fabricated pass is not.`,
  { label: 'G0-gate', phase: 'Gate', model: 'opus', effort: 'high', schema: G0 }
)

log(`G0: ${gate?.verdict ?? 'NO VERDICT'} — ${gate?.reason ?? 'gate agent returned nothing'}`)
if (gate?.blockers?.length) log(`Blockers: ${gate.blockers.join(' | ')}`)

return {
  wave: 0,
  baseline,
  probes,
  contract,
  verifier,
  gate,
  readyForWave1: gate?.readyForWave1 === true && gate?.verdict === 'PASS',
}
