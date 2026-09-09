# Ultracode execution plan — delivering `PERFORMANCE_REALISM_PLAN.md`

How to build the adaptive-realism workbench and controller with a tiered agent
fleet: cheap models doing the volume, Opus 5 owning every judgement that a
cheap model cannot be checked on. Companion to
[docs/PERFORMANCE_REALISM_PLAN.md](PERFORMANCE_REALISM_PLAN.md) (commit
`653d855`), which says *what* to build. This says *who builds it, in what
order, and what has to fail before any of it is believed*.

Produced by a 29-agent workflow: 6 survey agents mapped the subsystems, 5 Opus
agents designed the decomposition, 15 Opus verifiers adversarially attacked it
across three lenses, 3 Opus critics costed and sequenced the result. **All 15
verdicts came back `needs-correction`, with 52 blocking findings.** The design
below is what survived, not what was first proposed.

---

## 1. The headline: tiering is not the main lever

The premise of the request — cheap sub-agents for volume, Opus for validation —
is sound but its economics are much weaker than they look, and saying so up
front changes what this plan optimises.

**Verified first-party pricing, per MTok in/out:** Opus 5 `$5/$25`, Sonnet 5
`$2/$10`, Haiku 4.5 `$1/$5`. That is exactly **5:2:1 in both directions**.
Haiku is five times cheaper than Opus, not twenty. A Haiku task that needs one
extra attempt plus one unplanned Opus diagnosis has already cost more than
doing it once at Opus.

Three consequences, in increasing order of importance:

1. **Model tiering saves ~40%, and only after deduplication.** The first
   decomposition produced 72 tasks and *29 Opus gate passes* — the gates alone
   cost ten times every Haiku task combined, and ate most of the delta. Cutting
   the gates from 29 to 12 and the tasks from 72 to ~43 (below) is what makes
   the tiering pay at all.
2. **The real currency is gate-reading attention.** Twelve gates at 10–20
   minutes of Mentis's reading is 2–4 hours. At any plausible rate that exceeds
   the entire token bill several times over. **Minimise human gates, not Opus
   tokens.** That is why gates are batched at wave boundaries rather than
   sprinkled per task.
3. **The dominant financial risk is not tier choice at all — it is ordering.**
   Every threshold in the source plan (`1.2×B` overload, 5% missed for two
   windows, 10–15 s restore, 20% headroom, p95 ≤ 18.5 ms) is explicitly marked
   "tune these numbers on phones". The first decomposition treated all of them
   as contract constants and derived every fixture, trace and test from them.
   If one device pass contradicts them, the rework is not a task — it is the
   corpus, the fixtures, the contracts and everything greened against them:
   **40–60% of the spend.** That is an order of magnitude larger than any tier
   decision here.

CLAUDE.md already records this exact failure once: *"The thresholds (55 to
downshift, 58 to restore) were tuned against a system that could not run."*
The plan as first decomposed was on course to repeat it at ten times the
surface area.

**So the ordering is inverted from the source plan.** Measurement and a single
device pass come *before* the contract fixes any threshold. Wave 4 is a hard
gate, not an input to the last batch.

---

## 2. The tiering law

> A cheap agent (Haiku or Sonnet) may own a task **only if** a check exists
> that (a) can fail, (b) was authored by someone other than that agent, and
> (c) has been *watched failing* before the task starts. If any of the three
> is missing, the task is promoted to Opus, or paired with an Opus gate that
> inspects the artefact rather than the check's exit code.

Point (c) is the one the first decomposition missed, and it drives the whole
wave structure. **A cheap agent cannot distinguish "my code is wrong" from "my
oracle is wrong"** — that is measurement-validity judgement, which the law
itself reserves for Opus. So oracles are bought in one wave and spent in the
next: Wave 1 authors and *flip-tests* the assertions, Wave 2 implements against
them. An assertion nobody has watched fail is not an oracle, it is a hope.

Corollaries, each paid for by a finding in this repo's own history:

- **An agent that writes both the code and its test is a closed loop that
  proves nothing.** Specs and tests for cheap-tier work are authored upstream
  by Opus, or already exist.
- **"It rendered / exited zero / the number moved" is not an oracle.** This
  repo shipped a world that screenshotted perfectly with its nesting and
  collectibles systems never created, and a modes harness that printed
  `all 5 modes ok` on a run exiting 1.
- **Thresholds, measurement validity and causality are never cheap-tier.**
  Deciding whether an A/B was confounded by flying somewhere quieter, or
  whether a GPU timer result is disjoint, is Opus work by definition.
- **Mechanical transcription, inventory, and plumbing against a pre-existing
  exit-code contract are cheap-tier, and should be, aggressively.**

### Tier assignment

| Tier | Owns | Never |
|---|---|---|
| **Haiku 4.5**<br>`$1/$5`, 200K ctx | New standalone pure modules against an Opus-authored contract *and* an Opus-authored red test file; mechanical transcription; CI YAML; runbook generation | **Never opens `index.html`.** Never authors an assertion. Never picks a number |
| **Sonnet 5**<br>`$2/$10`, 1M ctx | Module implementation needing real code semantics; `index.html` surgery under a contract; harness extension; panel UI; the controller policy itself | Never authors its own oracle. Never rules on causality or measurement validity |
| **Opus 5**<br>`$5/$25`, 1M ctx | Contracts, thresholds, the trace corpus, every assertion, every gate, all causality judgement | — |

**Why Haiku never opens `index.html`:** measured, every subagent eats CLAUDE.md
unconditionally (82,222 bytes ≈ 20k tokens) and `index.html` is 378,585 bytes
≈ 94k tokens. That is ~114k of Haiku's 200K window gone before a line of work,
in the most trap-dense file in the repo. It is a context-arithmetic rule, not a
taste one.

**The one structural constraint that makes any of this testable.**
`node_modules/three` is a 414-line hand-written stub *tracked in git*,
exporting only `Vector3`, `Quaternion`, `Euler`, `Matrix4`; CI runs `npm test`
with no install step. A module is unit-testable here **only if it imports
nothing and takes its side effects as injected callbacks** — the
`createFlightRecovery({ onEnter })` pattern already in
`src/flight/flight-recovery.js`. So `src/game/adaptive-quality.js` must be
`createAdaptiveQuality({ apply, now, ... })`. Extract it as anything that
touches `renderer` directly and `npm test` stops being an oracle for it, and
**every task on it becomes Opus work**. This single design decision is worth
more than the entire tier table.

---

## 3. Oracle rules (R1–R8)

The most repeated defect across all five designs was oracle *form*, not tier
choice. These are enforced mechanically in every wave's preflight, and the
wave gate runs `git diff` against them.

```bash
# preflight — first lines of every wave script
set -euo pipefail
bash tools/ensure-harness.sh            # ONE npm install, then stub restore, then chromium
npm test > /tmp/baseline.log 2>&1       # must match docs/perf/BASELINE.md exactly
sha256sum -c tools/oracle-manifest.txt  # frozen: tests/**, tools/lib/**, tools/birb-*.mjs
```

| # | Rule | Why |
|---|---|---|
| **R1** | No `--test-name-pattern`. Every test oracle names explicit files. | Verified on this tree (node 22.22.2): a pattern matching nothing prints `# fail 0` and **exits 0**. Six tasks used it as their sole oracle. |
| **R2** | No harness piped into `grep`. Run to a log, capture `$?`, assert the code, then grep. | `(echo hi; exit 1) \| grep -q hi` exits 0. Every harness here prints its summary *before* `process.exit(1)` — this is the `all 5 modes ok` bug, reproduced in the verification layer. |
| **R3** | Implementation oracles are scoped to owned files; whole-suite runs only at gates. | A bare `npm test` while a sibling spec suite is deliberately red pays a cheap agent to stub out its neighbour's module. |
| **R4** | Red-first suites use dynamic `import()` inside the test body, gated `{ skip: !process.env.BIRB_PERF_IMPL }`. | A top-level static import of a not-yet-existing module resolves before any skip is evaluated and turns `tests.yml` red for the whole repo — `humanoid/`, `gauntlet/`, `sculpture/`, `icon3d/` included. |
| **R5** | No agent may modify its own oracle. Enforced by the manifest, not by instruction. | |
| **R6** | No SwiftShader number ever becomes a device claim. | CI renders at 2–9 fps; `birb-shot.mjs` says so in its own comments. |
| **R7** | One harness, one panel, one controller: `tools/birb-quality.mjs`, `src/ui/dev-quality-panel.js`, `src/game/adaptive-quality.js`. | The five designs independently proposed `birb-workbench.mjs`, `birb-quality.mjs` **twice with incompatible CLIs**, `birb-resize-check.mjs` and `birb-loop.mjs` — four harnesses for the one check the plan asks for once. |
| **R8** | **A check must be shown to fail before it is trusted.** Every new assertion is *flipped* — its TRUE state produced artificially — at the gate that introduces it. | Red-because-nothing-is-implemented is not proof of discrimination. |

---

## 4. Wave plan

Seven waves. Each is one `Workflow` invocation; the human reads one gate file
before launching the next. Waves 0–3 build the workbench and controller,
because the source plan's own budget stop rule forbids commissioning effects
before both are done. **Wave 4 is not an agent wave** — it is Mentis and a
phone — and Waves 5–6 do not exist as launchable scripts until it has put a
file on disk.

| Wave | What | Tasks | Gates |
|---|---|---|---|
| **0** | Ground truth, read-only probes, one contract | 6 | G0 |
| **1** | Buy the oracles: red-first specs, assertion library, flip tests | 5 | G1 |
| **2** | The workbench (source plan batch 1) | 11 | G2a·G2b·G2c |
| **3** | The controller + both mandatory loops (batch 2) | 11 | G3a·G3b·G3c |
| **4** | **Device evidence — human, not agents** | 1 | hard stop |
| **5** | Measurement rig + Experiments 1 & 5 | ~6 | G5 |
| **6** | Effects, and only here | ~4 | per-effect |

### Wave 0 — ground truth, probes, one contract

Three of the five designs contained a task whose acceptance criterion was
unreachable at its position in the graph: a harness told to read
`bloomPass.sceneTarget` through hooks that do not exist; a pinned-state label
with no `isPinned()` on `window.__BIRB`; a DPR experiment arm with no
`setPixelRatio` that isn't `pinTier`. **Each of those resolves into a
fabricated constant.** Wave 0 makes the later oracles observable, in a change
that provably alters no pixel.

- **P0.1** `sonnet/low` — `tools/ensure-harness.sh`, `docs/perf/BASELINE.md`.
  Record on HEAD the exit code *and full console-noise list* for every harness.
  Later waves assert *unchanged from baseline*, never "exit 0" —
  `birb-modes.mjs` treats warnings as failures and nobody has established it is
  green on this branch.
- **P0.2a** `sonnet/med` — `__BIRB.effective()`: renderer pixel ratio,
  `gl.drawingBufferWidth/Height`, `bloomPass.getSizes()` returning **live
  `.width`/`.height`** of every target (never a recomputation), weather
  `uPixelRatio`, `resizeState.pixelRatio`.
- **P0.2b** `haiku/low` — `stats().pinned` from the existing `isPinned()`.
- **P0.2c** `sonnet/med` — `__BIRB.frameTotals()`, a `renderer.render`
  accumulator **owned by the frame, not the bloom pass**, so it counts the
  no-post branch at tier ≥ 1. Today `stats()` reads `bloomPass.frameStats` only
  while `getTier() < 1` and otherwise reads `renderer.info.render`, which after
  a composite reports ~1 call — so whole-frame totals are unreported at exactly
  the degraded tiers the controller exists to manage.
- **P0.3** `opus/xhigh` — `docs/perf/CONTRACT.md` + `requirements.json`. The
  `adaptiveTier.` callsite map as a **set** (15 occurrences on 14 lines — 9427
  carries two); the reset-tag enum `{load, resume, resize, orientation,
  contextRestore, environment, manual}` with `paused` as a *validity state*,
  not a reset; every telemetry field with no source yet given an explicit
  sentinel; assertions with comparison operator and source pinned verbatim; the
  ruling that **the panel and gesture register on the production path, not
  inside the `?debug` block**; and the deferral ledger.
- **P0.4** `opus/med` — `tools/req-verify.mjs`, deriving expected coverage
  *structurally from the plan markdown* (8 control rows, 7 state-machine
  points, 6 runtime-loop steps, 5 experiments, 4 acceptance gates). A verifier
  checking an ID list the same task authored cannot fail.

**G0 must decide:** the probe diff contains zero writes to rendering state
(mechanically: no assignment to any renderer/bloom/weather uniform; noise list
identical to baseline; `birb-sheet --views flight` tiles unchanged in mean
pixel); no field of `effective()` is derived from `tier` or `DPR_CAP` — *a hook
that reports what the code meant to do cannot catch the desync this whole
programme is about*; `req-verify` goes red when a requirement row is deleted.

**STOP if** the baseline is not reproducible across two runs, or tier-0 and
tier-1 pixel ratios are equal at the pinned harness context (fix the context;
do not proceed with a dead check).

### Wave 1 — buy the oracles

This wave exists because of rule (c). The human reads G1 before Wave 2
launches, because **a wrongly-red harness silently licenses nine cheap tasks.**

- **P1.1a–c** `opus/high ×2, opus/med` — red-first spec suites (R4):
  percentiles checked against an independent reference over ~200 seeded arrays;
  a *structural* zero-allocation assertion, not just ring-buffer identity,
  since `exportIntervals()` invites a parallel unbounded plain Array; a GPU
  timer suite over a fake GL context **including a context-loss trace**.
- **P1.2** `opus/high` — `tools/lib/quality-assertions.mjs` (implementations,
  so the harness author transcribes rather than decides comparator direction),
  the A1–A12 table, the page-side mutation catalogue, and
  `docs/perf/EXPECTED-RED.md`: the field-by-field manifest of what
  `--check resize-restore` must report **failing on HEAD**. That check exists
  to catch the live `applyTier`/`bloomPass` desync — *if it passes today it is
  the wrong check*.
- **P1.3** `sonnet/high` — `tools/birb-quality.mjs` plumbing. Sub-modes
  targeting the not-yet-built panel return **exit 2 (skipped)** and print
  `mutations: N catalogued, M applicable, M detected`. Never a silent pass for
  absence.

**G1 is the anti-laundering gate** and does *positive control*: for each key
assertion, produce its TRUE state artificially in a scratch copy — a stub panel
that opens on any touch, a hand-desynced bloom target dimension, a forced
8-pass frame — and confirm the assertion **flips**. Any assertion that cannot
be flipped is rejected before a single cheap task starts.

### Wave 2 — the workbench

- **P2.1** `haiku ×4` (parallel) — `frame-metrics.js` extension with raw
  per-frame intervals and **separate CPU-update / render-submission
  accumulators** (the existing sampler returns one averaged FPS per 250 ms
  window; percentiles over that are meaningless); `quality-settings.js`
  (Benchmark freezes seed, route, settings **and sun** — the game has a
  ten-minute sun cycle, so an A/B taken three minutes apart is confounded);
  `gpu-timer.js` reporting `{state, reason}` from a closed enum so a wiring bug
  is distinguishable from a platform fact; `frame-stats.js`, with
  `evaluateOscillation(tierChangeLog)` **separate** from the interval maths —
  the fourth acceptance gate is a property of the change log, and a
  single-signature contract ships it as a hardcoded `true`.
- **P2.2** `sonnet ×3` (parallel) — bloom control split (`setDownscale(n)` with
  cached last w/h/ratio; `downscale` is constructor-only today and `setSize`
  keeps no state); **the single sizing function**, through which every quality
  and viewport change routes, including `handleContextRestored`; and
  `dev-gesture.js` — document-level, passive, **production path**, coexisting
  with the two-finger sprint tracker and nipplejs.
- **P2.3** `sonnet ×2` (serial) — panel shell, then controls and evidence
  export. Every telemetry field is verified by **injection**:
  `__BIRB.injectIntervals([...])` feeds a series whose p95 is far from its mean
  and the panel must display that exact p50/p95/p99.
- **P2.4** `haiku ×2` — pinned-state line in `birb-shot`, `birb-sheet` **and
  `birb-lighting`** (it pins tier 0 too); nest tiles stamped `NOT LANDED — not
  visual evidence` on timeout; CI wiring.

**G2b is the gate this wave exists for**, and no automated check settles it:
**is each control wired to rendering work, or to a label?** One capture per
control class — DPR slider vs `renderer.domElement.width`; post quality vs
`getSizes()`; weather density 0 vs the points draw actually skipped; shafts
toggle vs the 8-call path collapsing to 5. Plus **precedence**: six sites
already write these values, several per frame (`isLowEnd` at 3578 still reads
`navigator.hardwareConcurrency`), so a pinned-tier-1 + panel-density-100%
capture must not be clobbered on the following frame.

**STOP if** any control is a label; frame totals are unreported at tier ≥ 1; or
the gesture registered inside the `?debug` block.

### Wave 3 — the controller and both mandatory loops

- **P3.1** `opus/xhigh` — the trace corpus, and it must be a **capacity model,
  not a recorded interval array**: each sample carries the sustainable frame
  cost *at each setting* and the driver synthesises `dtMs` from the
  controller's current profile. A fixed replay cannot depict
  recovery-when-capacity-returns or a failed upgrade probe, because the trace
  does not respond to the decision — and both are named required regressions.
  Corpus includes overload, oscillation-bait, misleading plateau, absent and
  disjoint GPU timers, manual→auto, resume, scene change, **stuck quality**
  (30 s stable-but-degraded must produce a bounded probe — permanent
  degradation is the plan's named anti-success), and the instrumentation on/off
  pair. Holdout traces' seed lives only in the gate prompt.
- **P3.2** `haiku ×4` — `effect-verification`, `evidence-record`,
  `perf-learning` (**with its own authored suite** — three designs assigned the
  privacy deny-list, entry cap and age-out to a module with no test file),
  `loop-health`.
- **P3.3–3.4** `sonnet ×3` — the policy machine, the post-acceptance watchdog,
  and the `index.html` rewire. The controller is fed **per frame at the top of
  the loop**, not behind the 250 ms `fps === null` early return.
- **P3.5** `haiku ×2` — `tools/birb-perf-ab.mjs`: Auto vs a reference
  implementation of today's 55/58 policy vs fixed profiles. This is the only
  check that answers whether any of this was worth building, and it was named
  as missing by two designs and owned by none.

**G3b** rules on what no fixture supplies: does `evaluate()` compare
equal-duration windows in comparable conditions; are scene-change and
input-heavy windows marked *inconclusive* rather than credited; is any
collision, input or flight fidelity reduced. Plus **connectivity**:
`samplesObserved` within an order of magnitude of frames rendered (catches the
4 Hz cadence bug), `lastSampleMs` interval-shaped not rate-shaped.

**STOP if** `gpuMs` is permanently null with reason `no-context` — that is a
wiring bug wearing a platform fact's clothes, the `hardwareConcurrency`/bloom
trap exactly — or if Auto is measurably worse than a fixed profile and the
controller cannot report it.

### Wave 4 — device evidence (human)

One `haiku/low` task transcribes `docs/perf-device-runbook.md`: every
experiment cell adjacent to a copy-paste `__BIRB.` block and a `?debug` URL.
A bare cell index is decorative — the phone session must be button-pressing,
not thinking. Everything else is Mentis, an iPhone 12-or-newer, and a midrange
Android.

Traces are written in the **fixture schema**, so a device-observed failure
becomes a deterministic regression *by file copy* rather than by hand-authoring
an approximation. Three designs defined those as different shapes, which throws
the device data away the moment it is collected.

```bash
# literal first line of wave5.sh
test -s evidence/device/manifest.json || { echo "WAVE 5 BLOCKED: no device evidence"; exit 1; }
```

**This is the hard stop.** An agent handed the Wave 5 script without it will
produce well-formed noise and a confident ranking.

### Waves 5–6 — experiments, then effects

Only Experiments **1** (factor cost ranking) and **5** (allocation, shader
compilation, staggered updates — the one evidence class that survives software
rendering) are buildable from what exists. Experiments 2, 3 and 4 have no
mechanism anywhere in the repo and are Wave 6, commissioned one at a time, each
with a device-measured headroom figure as its stated budget.

Wave 6 is unlocked mechanically:

```bash
for g in G2c G3c G5; do grep -q '^VERDICT: PASS' docs/perf/gates/$g.md || exit 1; done
test -s evidence/device/manifest.json
node tools/req-verify.mjs --deferrals-closed batch1,batch2
```

---

## 5. What the adversarial pass killed

The 52 blocking findings collapse into six patterns. Each is now a rule above,
and each was independently rediscovered in three or more units:

1. **Vacuous oracles** — `--test-name-pattern` exiting 0 on no match; harnesses
   piped into `grep`, discarding exit codes; `A; test $? -eq 0 && B` which
   exits 0 when A *fails*. (→ R1, R2)
2. **Invented oracles** — flags (`--lint`, `--cells`, `BIRB_ROUTE_JSON`) no
   task builds; `playwright` assumed present in a `node_modules` that contains
   exactly `three`. 31 task-instances had an oracle that was unrunnable,
   invented or self-contradictory.
3. **Closed loops** — Haiku authoring the oracle for two more Haiku tasks; the
   p95 convention (nearest-rank vs interpolated) never pinned, so the value the
   controller fires on and the value the acceptance gate scores are computed by
   different modules.
4. **Unreachable dependencies** — tasks reading state a later task exposes.
   Guaranteed to hardcode.
5. **Collisions** — `tools/birb-quality.mjs` claimed twice with incompatible
   CLIs; four percentile modules; three tasks printing pin state in three
   formats; the GPU timer simultaneously assigned to Haiku and listed as
   unowned by three other units.
6. **Repeating this repo's own scars** — a capability probe assumed to return
   what you think (the GPU timer is exposed by neither Safari nor SwiftShader,
   so the whole implementation ships permanently on its `null` branch, green);
   `setFeature` toggles never run through `birb-modes.mjs` with everything off,
   against the plan's own "preserve gameplay targets and collision geometry".

**Two findings no unit owned, and both would have shipped broken:**

- **`sw.js` is unowned.** It enumerates every module by hand in `CORE_ASSETS`
  and `CACHE_VERSION` is a literal. These waves add 8–12 new `src/` modules and
  **not one task touches it** — a blank page offline, the exact `/AR` failure
  the file's own comment memorialises. Worse: *the phone you take to the park
  is served by a service worker*, and `staleWhileRevalidate` serves the cached
  module first — so the first run of a device session executes the **previous**
  build's `src/**` against the new `index.html`. Add a build hash to
  `__BIRB.quality()` and assert it in the export, or every device number is
  attributed to a build that may not have been running.
- **CI cannot absorb what these waves add.** `browser-health.yml` has
  `timeout-minutes: 12` and already runs four browser commands after a Chromium
  install; three units each wanted to add their own steps to the same
  twenty-line block. Revisit the timeout in Wave 2, not at the end.

---

## 6. What not to build

Cut on this repo's own evidence. Each is recorded in the deferral ledger rather
than dropped silently.

- **The persisted learning store.** Largest new surface in the plan; its
  "coarse capability bucket" will reach for `hardwareConcurrency` — this repo's
  most expensive documented mistake — and its benefit is unmeasurable without
  the device access that gates everything else. **Ship the in-session action
  history; defer persistence.**
- **The GPU timer query lifecycle.** Build the probe and report
  `available: false, reason: <…>`. That is one line and it is the part that
  must be verified on hardware. Defer pools and deferred reads until a phone
  says the extension exists. The bounded-probe fallback has to work anyway and
  is what will actually run.
- **The 30 FPS row, unless the pacing mechanism is named.**
  `docs/CUTTING_EDGE_2026.md` records that iOS caps rAF at 60, and half-rate
  skipping on a 60 Hz panel produces judder that scores *worse* on the very
  interval statistics this plan adopts.
- **The "richer experimental surface detail" variant.** Uncommissioned shader
  authorship whose only oracle is a human looking at a contact sheet, in a repo
  that has shipped two whole systems invisible because a shader failed to
  compile at exit zero.
- **The anti-laundering meta-infrastructure** (held-out fixture directories
  materialised outside the worktree, sha256 oracle manifests as a product,
  mutation catalogues). Two units proposed building a second product alongside
  the first. **One cheap rule buys most of it:** implementation tasks land on a
  branch where `tests/**` and `tools/*.mjs` are read-only, and every oracle
  addresses a test *file path*.

**And one structural safeguard, which is the answer to "what if the phone never
happens":** the new controller ships with a profile that **reproduces today's
55/58 three-tier behaviour exactly**, with the new policy reachable only from
the panel and a URL flag, and the switchover gated on a recorded device
session. A no-device outcome then ships a workbench and a measurement rig —
genuinely valuable, fully verifiable in CI — and nothing riskier than today.

---

## 7. Cost and schedule

Modelled from the verified rates and measured context sizes; **ranges, not
point estimates.** Every subagent carries a ~20k-token CLAUDE.md floor before
its brief.

| | Tasks | Modelled cost |
|---|---|---|
| Haiku 4.5 | ~15 | $3–6 |
| Sonnet 5 | ~17 | $20–35 |
| Opus 5 (tasks) | ~11 | $55–90 |
| Opus 5 (12 gates) | — | $18–30 |
| **Tiered total, first pass** | **~43** | **$95–160** |
| All-Opus alternative | ~43 | $250–290 |
| Realistic with rework | | **$160–260** |

**~40% saved, and the deduplication from 72 → 43 tasks saves more than the
tiering does.** For calibration: designing this plan cost 4.06M subagent tokens
across 29 agents in 67 minutes.

**Wall clock is tool-latency-bound, not token-bound.** `npm test` is 36 s;
`birb-modes` 3–6 min; `birb-sheet` with nest views 6–12 min. Peak useful
parallelism is ~12 agents for perhaps 90 minutes of the run; average
utilisation 3–5. **The binding constraint is file ownership** — ten tasks touch
`index.html`, most of them the same two regions (the debug block at 8927–9512
and the tier IIFE at 6494–6580). Serialise every `index.html` task on a fresh
rebase, re-running `birb-modes.mjs` *after rebasing*, not just after editing.
Orchestrated wall clock is **40–55 h**, not the ~20 h the parallel shape
implies.

**What no agent tier can reach.** CI renders through SwiftShader at 2–9 fps.
All four acceptance gates; whether adaptation beats a fixed profile; whether
`EXT_disjoint_timer_query_webgl2` exists anywhere real; whether the three-finger
gesture survives iOS gesture interception; sustained thermal slowdown;
Experiment 2 entirely. **4–8 human-days across three devices, uncompressible,
and 100% of the schedule risk.**

---

## 8. Running it

Each wave is one `Workflow` invocation. Each gate writes
`docs/perf/gates/G<n>.md` whose first line is exactly `VERDICT: PASS` or
`VERDICT: STOP — <reason>`, followed by the flip-test result for every new
assertion and the `git diff --stat` of frozen paths.

**That file, not the wave's exit code, is the launch authority for the next
script** — because this repo has already shipped a harness whose tail said
`all 5 modes ok` on a run that was exiting 1, and this entire plan is an
attempt not to do that again with numbers.
