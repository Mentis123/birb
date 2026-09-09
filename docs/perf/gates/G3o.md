VERDICT: STOP — the holdout's INV-18 is unsatisfiable by a conforming controller on 9.2% of generated traces, and the only way past it is to violate PRO-8 by relabelling a probe as an upshift, which every other check in the wave scores as clean.

# G3o — the anti-laundering gate for the controller (Wave 3A)

Gate for the Wave 3A oracle wave: `src/game/perf-constants.js`, `tests/fixtures/perf-traces/**`,
and the six red-first suites (`adaptive-quality`, `adaptive-quality-traces`,
`adaptive-quality-holdout`, `perf-trace-corpus`, `perf-learning`, `loop-health`,
`evidence-record`, `effect-verification`).

Everything below was produced by RUNNING, not by reading the spec agents' reports. The
flip driver, every minimal implementation and every mutant are the gate's own work; none
of the spec agents' reference policies or helpers were used as the implementation under
test.

---

## Summary

| # | Check | Result |
|---|---|---|
| 1 | Every assertion flip-tested (R8) | **PASS** — 96 of 96 watched failing AND watched passing |
| 2 | The corpus responds to decisions | **PASS** — 12/16 scenarios produce different `dtMs`; the other 4 differ in the derived metrics |
| 3 | The holdout is real | **PASS** — structurally distinct, no seed in the worktree |
| 4 | Thresholds imported, not inlined | **PASS** — one non-blocking observation |
| 5 | Repo still green for the siblings | **PASS** — env-unset exit 0, 0 failures; IMPL red for module-absent only |
| 6 | No oracle was edited | **PASS** — `sha256sum -c` clean, 102/102 |
| 7 | DEF-1 and DEF-2 respected | **PASS** — proved by construction |
| **8** | **The oracles are satisfiable by a CONFORMING controller** | **FAIL — the STOP** |

---

## 1. Flip tests (R8) — 96 assertions, all flipped

For each suite the gate wrote its own minimal implementation from the surface pinned at
the top of the suite, confirmed it green, then forced each assertion's TRUE state and
confirmed the flip. Where an assertion was red on the first implementation it was made
green first, because a check nothing can pass is a broken oracle just as a check nothing
can fail is.

### The six flips the charter names

| Forced state | Assertion that caught it | Evidence |
|---|---|---|
| A controller that reduces a **bundle** of costs in one step | **AQP-4** | mutant `F1-bundle`: made `no-shafts` also drop `weatherDensity` and `cloudShell` → `not ok 4`, 25/26 |
| **ONE timer** for both overload and recovery | **AQP-13** (+ AQP-15) | mutant `F2-one-timer`: `recoveryMs = overloadMs` → `not ok 13`, `not ok 15` |
| An **apply that is a no-op** | **EV-1** | mutant `F3a-trust-request`: verify the request instead of the read-back → `not ok 2`. Also `F3b-any-changed` → EV-3, `F3c` → EV-3 |
| An evaluation that **credits a confounded window** (flight into a quieter area) | **PL-11** | mutant `F4-credit-confound`: deleted the scene-change guard → `not ok 12`. The fixture's own delta is >4× the noise band, so it is a large, real, genuinely uncreditable improvement |
| Reaching budget by **degrading input or collision fidelity** | **AQP-8** and **AQP-9** | mutant `F5-gameplay` (a `collisionRate` rung) → `not ok 6`, `not ok 8`; mutant `F5b-apply-gameplay` (`settings:{inputRate:30}` on the apply) → `not ok 9`. Driver-side: `INV-1` also flips (`gameplay-fidelity-write`) |
| **Stable but permanently degraded**, reported as success | **INV-8** | mutant `F6t-no-recovery`: disabled the recovery path → `AQ trace: stuck-quality` fails with *"stable and degraded from 0 ms with no upgrade probe by 47000 ms. Final rung 2; the capacity model says rung 0 would have fitted."* |

### Coverage

| Suite | Assertions | Green baseline | Flipped |
|---|---|---|---|
| `tests/adaptive-quality.test.js` (AQP-1…26) | 26 | 26/26 | 26/26 |
| `tests/effect-verification.test.js` (EV-0…12) | 13 | 13/13 | 13/13 |
| `tests/perf-learning.test.js` (PL-0…25) | 26 | 26/26 | 26/26 |
| `tests/loop-health.test.js` (LH-0…14) | 14 claims | 13/13 tests | 14/14 claims (LH-4/5/6 flipped separately) |
| `tests/evidence-record.test.js` (ER-0…24) | 25 | 25/25 | 25/25 |
| `tests/fixtures/perf-traces/invariants.js` (INV-1…18) | 18 | 18/18 | 18/18 |
| `tests/perf-trace-corpus.test.js` (TC-1…19) | 20 | 20/20 in-repo | its own discriminator matrix, run and green |

The committed discriminator matrix covers 10 of the 18 invariants (9 in both directions,
INV-7 mustPass-only). The gate's own flip driver closed the rest: INV-6, 10, 12, 13, 14,
15, 17, 18 had no discriminator cell at all and were flipped here. **INV-14 and INV-18 —
the two holdout headline checks — had no committed discriminator whatsoever**, which is
how the defect in §8 survived to this gate.

Two flips that did **not** work first time, recorded because they are the shape of a
vacuous check and were not:

- `M18-no-hold` (clearing `cooldownUntil`) left AQP-18 green — because the settle *phase*
  independently enforces the hold. AQP-18 was then flipped by `M16-react-first-window`,
  which produces adjustments 0 ms apart. The assertion is sound; the first mutant was.
- `EV12-global` reading `globalThis.performance` at import time left EV-12 green, because
  the ESM cache means an import-time read fires before the spy is installed. Flipped with
  `EV12b-localstorage`, a read inside `snapshot()`. **Note for Wave 3B: EV-12 and PL-22
  cannot see an import-time global read.** Not a blocker — AQP-1's source scan catches the
  same thing for the controller — but the two spy tests are narrower than they look.

---

## 2. The corpus responds to decisions — PASS

Driven with three of the gate's own policies (never move; go to the ladder floor on the
first frame; flip-flop 0↔floor every 40 frames) across all sixteen committed scenarios.

- **12 of 16 scenarios produce a materially different delivered-interval stream** per
  policy. Example, `overload`: never-move gives 631 frames and 13,000 ms outside budget;
  floor gives 1,021 frames and 0 ms outside budget.
- The four that do not (`stuck-quality`, `cold-start-from-persisted-profile`,
  `corrupt-store-clamped`, `first-use-shader-compilation`) are correct, not inert.
  `stuck-quality` and `corrupt-store-clamped` start **already at the floor**, so
  "go to floor" is a no-op; the flip-flop policy moves them (degraded time 85,000 → 43,000
  ms and 20,000 → 10,667 ms). For the other two the underlying `costMs` stream differs
  (mean CPU 3.621 vs 2.734 ms, 5.658 vs 3.359 ms) and only the **vsync quantisation**
  hides it in the delivered interval — which is the `misleading-plateau` mechanism working
  as designed, not a tape.

`driver.js` reads `cap.costMs[rung]` where `rung` moves only through `apply()`, and never
asks the controller what rung it believes it is on. This is a capacity model.

## 3. The holdout is real — PASS

Three arbitrary seeds, 12 traces each, fingerprinted:

```
seed=alpha      fp=71dd17bc  nameOverlap=0 contentOverlap=0 ladderDepths=[3,4,5,6] deadRungTraces=7 cpuBoundTraces=4
seed=beta-9971  fp=4b661f93  nameOverlap=0 contentOverlap=0 ladderDepths=[3,4,5,6] deadRungTraces=2 cpuBoundTraces=8
seed=12345      fp=948a70c3  nameOverlap=0 contentOverlap=0 ladderDepths=[3,4,5,6] deadRungTraces=5 cpuBoundTraces=7
```

The committed corpus is uniformly 3-rung; the holdout spans 3–6 and contains dead rungs
and CPU-bound regimes no committed scenario has. Same seed reproduces; different seed
differs; `generateHoldout()` throws `RangeError` with no seed. **No seed is materialised
anywhere in the worktree** — the only occurrences are `process.env[HOLDOUT_ENV_VAR]`, the
`<seed>` placeholders in docs, and run-time-derived seeds in `perf-trace-corpus.test.js`.

## 4. Thresholds imported, not inlined — PASS

Grepped `1.2 · 18.5 · 25 · 50 · 55 · 58 · 2000 · 4000 · 1500 · 30` across every new file.
Every hit is one of: inside `src/game/perf-constants.js` itself (the one authorised home,
each with a `PROVENANCE` row and a verbatim source quote); a scenario's `costMs` /
`instrumentation` / `cpuShare`, which are properties of the depicted *device* and belong
in the trace by `schema.js`'s own rule; or AQP-12's forbidden-literal map and AQP-24's
55/58 drive script, both of which are checks *against* the literals.

`AQP-11` is the live proof rather than the grep: quartering `PROVISIONAL.evaluationWindowMs`
must move the first reduction by more than 40%. It flipped under `M-inline-window`
(a hardcoded 1000) and under `M16`.

One non-blocking observation: `tests/evidence-record.test.js:195` writes
`thresholdMs: B * 1.2` as a test fixture's *hypothesis success gate*. It is test data for
an experimenter's stated gate, not the controller's overload rule, and nothing depends on
it — but it is PRO-1's value typed out in a file that imports `PROVISIONAL`. Worth one
line of cleanup; not a gate condition.

## 5. Repo still green for the siblings — PASS

```
npm test                 -> EXIT=0   628 tests, 419 pass, 0 fail, 209 skipped
BIRB_PERF_IMPL=1 npm test -> EXIT=1   628 tests, 503 pass, 122 fail, 3 skipped
```

All 122 failures are module-absent: 120 `ERR_MODULE_NOT_FOUND` for the five Wave 3B
deliverables (`adaptive-quality` 43, `evidence-record` 25, `perf-learning` 26,
`effect-verification` 13, `loop-health` 13) and 2 `ENOENT` from AQP-1/AQP-12 reading the
controller's source as text. **No import errors, no syntax errors, nothing from
`humanoid/`, `gauntlet/`, `sculpture/` or `icon3d/`.** The sibling suites were run
directly under both settings: 46 pass, 0 fail, 2 skipped, identically.

R4 is honoured throughout: every `import()` of a Wave 3B module is inside a test body
behind `{ skip: !BIRB_PERF_IMPL }`.

## 6. No oracle was edited — PASS

`sha256sum -c tools/oracle-manifest.txt` exits 0, 102/102 entries OK, 0 mismatches.
The manifest's only change since Wave 2 (`f3a362c`) is the `docs/perf/CONTRACT.md` hash,
updated in the same commit as the two recorded G2e amendments (`not-webgl2`; DEF-3's
present-and-disabled Target rate row). That is the amendment rule followed, not an oracle
edited: the Wave 3A files are all untracked additions and touch nothing frozen.

## 7. DEF-1 and DEF-2 respected — PASS

Proved by construction rather than by grep. The gate's minimal implementations carry **no
persistence layer of any kind** and **no GPU query lifecycle** — no query pool, no
deferred read, no `createQuery`/`beginQuery` — and they pass PL-0…25, LH-0…14, ER-0…24,
EV-0…12, AQP-1…26 and all sixteen committed trace scenarios including
`cold-start-from-persisted-profile`, `corrupt-store-clamped`, `absent-gpu-timer` and
`disjoint-gpu-results`.

The only `localStorage`/`indexedDB` references in the whole wave are the spy setups in
PL-22 and EV-12, which assert the module touches **none** of them. `corrupt-store-clamped`
states in its own prose that it depicts "the boundary where untrusted input arrives, not a
persistence layer", and it is satisfied by clamping `startProfile.rung` — three lines, no
store. The GPU side reaches the controller as `{ value, state, reason }`, exactly
`gpu-timer.js`'s probe contract.

---

## 8. THE STOP — INV-18 forbids what PRO-8 mandates, and rewards violating it

### What was run

The other seven checks were green, so the gate asked the one question left: **is a
conforming controller able to satisfy these oracles?** An oracle that is red for a correct
implementation is worse than no oracle, because the implementer's only route to green is
to break something else.

First, satisfiability of the committed suites was established. The gate's own controller
(≈200 lines, written from the pinned surface) reaches **26/26 on `adaptive-quality.test.js`
and 19/19 on `adaptive-quality-traces.test.js`**. Two failures along the way were the
oracles working exactly as commissioned and are worth recording:

- `disjoint-gpu-results` failed a controller that set a **permanent barrier** after a
  failed probe. The scenario's deadline is deliberately two PRO-8 intervals because SM-3
  says "roll back and **lengthen** its retry cooldown", not "never again". Correct catch.
- Four holdout traces failed a controller whose effectiveness test read **delivered p95**.
  On a 60 Hz panel a 40 ms frame and a 35 ms frame are both presented at 50 ms, so a real
  saving is invisible in the delivered interval; judging on the continuous work signal
  (`cpuMs` + `gpu.value`) that the driver already supplies fixed it. That is a genuine
  design lesson the corpus surfaced, and Wave 3B should have it.

Then the gate built an **upper bound**: a *clairvoyant* controller that reads
`feasibleRung` straight out of the capacity model — it cannot be beaten by any real
controller — while still obeying the contract: one rung per move, PRO-6 hold, no move
inside the first evaluation window, and **PRO-8's one optional upgrade probe per 30 s** on
every upward move.

### The result

Over **120 holdout traces (10 seeds × 12)**:

```
PRO-8-CONFORMING clairvoyant      : 11 traces fail the holdout check set   (9.2%)
PRO-8-IGNORING 'upshift' climber  :  2 traces fail
```

**9 of the 11 conforming failures pass the moment PRO-8's climb budget is ignored.** Every
one is INV-18, and every message has the same shape — the adaptive run ties standing still
or beats it by less than the 1000 ms tolerance:

```
holdout-4: outside 10000 vs 10017 ms, degraded 0 vs 0 ms
holdout-5: outside 46194 vs 46194 ms, degraded 0 vs 0 ms
```

### Why

`holdout.js`'s generator places regimes freely and never constrains the trace's length
against the climb it demands:

```
s1/holdout-0 : upwardSteps=6 needs 180000 ms of probe budget in a  78756 ms trace
s1/holdout-10: upwardSteps=4 needs 120000 ms of probe budget in a  50454 ms trace
s5/holdout-0 : upwardSteps=5 needs 150000 ms of probe budget in a  76377 ms trace
```

A trace that opens in a `collapsing` regime forces a correct controller to descend; the
regime then improves; and PRO-8 caps the climb back at one rung per thirty seconds. The
controller runs out of trace before it runs out of ladder, ends deep, and INV-18 records
it as having failed to beat never moving — **for obeying the contract.**

`README.md` §7 and INV-18's own comment show this was reasoned about: the climb allowance
is on INV-14 and deliberately not on INV-18, because there "it would become a hurdle the
controller has to clear", and INV-18 already skips when `decisiveMs < restoreStabilityMaxMs`.
That reasoning is right and the measurement behind it is right. What was never run is a
**conforming clairvoyant against INV-18**, which is why the remaining hole — traces where
the climb is arithmetically impossible in the time available — was not found. INV-14 and
INV-18 have no committed discriminator cell, so nothing in the wave would have found it.

### Why this is a STOP and not a note

The second line of the table is the whole problem. A controller that **never emits
`kind: 'probe'` and climbs freely via `kind: 'upshift'`** fails 2 traces where the
conforming one fails 11 — and it is scored as clean by everything else in the wave:

- `driver.js` enforces `probe-overlap` and `probe-too-soon` **only for `kind === 'probe'`**
  (lines 217–226). `upshift` is unpoliced.
- `INV-7 boundedProbes` filters `a.kind === 'probe'`, so a controller with zero probes
  passes it vacuously — measured: **0 INV-7 violations** for the free-climbing controller.
- `INV-8 attemptsRecoveryWhenStuck` explicitly accepts `a.kind === 'probe' || a.kind === 'upshift'`,
  so the relabelled climb still counts as a recovery attempt.

So PRO-8 — "at most one optional upgrade probe per 30 seconds", one of the seventeen
provisional constants §10 exists to protect — is enforceable only against a controller
that volunteers the label. A Wave 3B agent told "make the holdout pass" has one cheap,
green, entirely undetected route: stop calling it a probe. **The wave's only
anti-laundering check currently rewards laundering.** That is the exact failure mode this
gate was commissioned to prevent, and it cannot be handed to a cheap tier.

### What fixes it (Wave 3A remediation — both files are the fixture's, not the contract's)

1. **`tests/fixtures/perf-traces/holdout.js`** — constrain the generator so no unwinnable
   trace is produced: require
   `upwardSteps * K.probeIntervalMs + K.restoreStabilityMaxMs <= durationMs`, either by
   lengthening `durationMs` or by capping the regime sequence's upward span. This is
   preferable to adding a tolerance, because it keeps INV-18 strict and tolerance-free,
   which is its entire value. A skip in `beatsStandingStill` — the same *shape* of guard it
   already has for `decisiveMs` — is an acceptable alternative, but it makes the check
   quieter rather than the fixture correct.
2. **`tests/fixtures/perf-traces/driver.js` + `invariants.js`** — apply the PRO-8 budget to
   **every upward move**, not only to `kind: 'probe'`. `upshift` and `probe` differ in
   whether the move is being *judged*, not in whether it costs probe budget. Then INV-7's
   count must include them, or the same relabelling defeats it again.
3. **Add discriminator cells for INV-14 and INV-18.** The gate's own driver
   (`scratchpad/g3o/inv-flip2.mjs`) has working both-direction cases for both: a
   worst-rung fixed policy flips INV-14, a correct-rung one greens it; a never-moves policy
   flips INV-18, a correct-rung one greens it. A check with no cell in the matrix is a
   check nobody has watched, and these two are the holdout's headline.
4. **Re-run this gate**, including the conforming-clairvoyant upper bound, which should be
   kept as a permanent instrument: *before shipping an oracle, prove a conforming
   implementation can satisfy it.*

Everything else in Wave 3A is sound and should not be rebuilt. The corpus is a real
capacity model, the holdout is genuinely held out, ninety-six assertions all discriminate
in both directions, the thresholds are imported, DEF-1 and DEF-2 are respected, and the
repo is green for the siblings. The defect is narrow, it is in two fixture files, and it
is fixable in a single pass.

---

## Reproduction

```bash
npm test                                    # exit 0, 628 tests, 0 fail, 209 skipped
BIRB_PERF_IMPL=1 npm test                   # exit 1, 122 fail, ALL module-absent
sha256sum -c tools/oracle-manifest.txt      # 102/102 OK
```

The gate's flip driver, minimal implementations, mutants and the clairvoyant upper-bound
probe are in the session scratchpad under `g3o/`; none of it is committed, and
`src/game/` is back to exactly the state it was found in (`git status` shows only the
pre-existing `index.html` / `sw.js` modifications and the untracked Wave 3A files).

Holdout seeds used by this gate, by fingerprint only:
`alpha` 71dd17bc · `beta-9971` 4b661f93 · `12345` 948a70c3, plus `s1`…`s10` and
`g3o-seed-one` / `g3o-seed-two` / `8675309` for the satisfiability sweeps.
