VERDICT: PASS

# G3o — the anti-laundering gate for the controller (Wave 3A)

> **Superseded by the re-gate at the end of this file (G3o-2, VERDICT: PASS).**
> The original verdict line read:
>
> VERDICT: STOP — the holdout's INV-18 is unsatisfiable by a conforming controller on 9.2% of generated traces, and the only way past it is to violate PRO-8 by relabelling a probe as an upshift, which every other check in the wave scores as clean.
>
> The two defects it named are fixed and independently verified; §8 of the
> re-gate records the one residual gap. The STOP narrative in §8 below is
> kept as provenance, not as the current state.

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

---
---

## Re-gate — G3o-2

**VERDICT: PASS.** The two defects G3o stopped on are fixed and the fix has been
verified with an instrument G3o-2 wrote from scratch, not with the committed one.
One residual gap in the new `unlabelled-probe` guard is recorded below as a
non-blocking carry into Wave 3B; it does not affect satisfiability,
discrimination or determinism, and it no longer pays.

Everything below was produced by RUNNING on the working tree at
`claude/ultracode-sub-agents-plan-c9qmba` (7 modified files, `git diff --stat`
568/173). No committed instrument's output is taken as evidence for its own
correctness.

| # | Check the charter names | Result |
|---|---|---|
| 1 | Satisfiability, by G3o-2's OWN clairvoyant, ≥120 traces / ≥10 seeds | **PASS — 0 of 1,332** |
| 2 | Discrimination survived (idle AND thrash still fail) | **PASS — idle 100% of scored, thrash 100% of all** |
| 3 | The six named flips + the free climber still flip | **PASS — 7 of 7 watched failing AND watched passing** |
| 4 | The corpus still responds to decisions | **PASS — 16/16 on `costMs`, 12/16 on `dtMs`** |
| 5 | Determinism: five `npm test` runs | **PASS — 5/5 exit 0, plus 20/20 on the flaky suite** |
| 6 | No frozen oracle edited | **PASS — `sha256sum -c` exit 0, 58/58 OK, 0 FAILED** |
| 7 | DEF-1 and DEF-2 still respected | **PASS — by grep and by construction** |
| — | Residual finding (non-blocking) | §8 — the `unlabelled-probe` guard enforces PRO-4, not PRO-8 |

---

## 1. Satisfiability — G3o-2's own clairvoyant, and it agrees

**The instrument is independent by construction**, not by assertion. It lives in
the session scratchpad under `g3o2/my-clairvoyant.mjs` and differs from
`tools/perf-satisfiability.mjs` in three ways that matter:

- **It re-derives the segment timeline itself** from `scenario.samples`, the
  ladder depth and `budgetMs(targetFPS)`. It never reads
  `scenario.groundTruth.timeline`. So a wrong ground truth makes the two
  instruments disagree instead of making them agree wrongly.
- **Five strategies, not two.** `hold` and `greedy` correspond to the committed
  `metric`/`greedy`; `drift`, `drift-early` and `patient` are new. `drift` is
  the interesting one and it is a strictly tighter upper bound: while NOTHING on
  the ladder fits, both scored metrics are rung-independent, so repositioning
  toward the rung the next fitting regime wants is FREE — the committed `metric`
  strategy stands still there and pays PRO-8's rate to climb out afterwards.
  Satisfiability is "SOME conforming controller can do it", so a wider strategy
  set can only lower the failure count.
- **Its own fixed and idle arms**, so the comparison arm is the gate's too.

Conformance is judged from outside by `driver.js` and the invariants, exactly as
the holdout suite judges a real controller: one rung per move, PRO-6 hold, every
upward move `kind:'probe'` at PRO-8's rate with one outstanding, resolved with
`probe-keep`/`probe-rollback`.

### Result

```
seeds 20260909..20260918   120 traces    0 unsatisfiable
seeds 1..100             1,200 traces    0 unsatisfiable      <- never tuned against
gate seed fp b8d52699       12 traces    0 unsatisfiable
                         ------------
                          1,332 traces   0 unsatisfiable
```

**Per-strategy, 1,200 traces:** `hold` 1200/1200, `drift` 1200/1200,
`patient` 1200/1200, `greedy` **1189**/1200, `drift-early` 1190/1200.

That penultimate figure is the adjudication's central diagnosis reproduced
independently: **a greedy clairvoyant is not an upper bound.** My greedy
strategy — written without reading theirs — fails the same 11 traces per 1,200
for the same reason, and my `hold`/`drift`/`patient` strategies pass them. The
claim that G3o's residual 4-of-120 was the INSTRUMENT and not the ORACLE is
correct, and it is correct on a seed range the fix was never tuned against.

### The two instruments agree on every trace

```
instruments agree: my upper bound and the committed one reach the same
SAT verdict on every one of 1,320 traces
```

No disagreement anywhere. Both upper bounds say the same thing, which is what
"at least one of them is broken" was meant to detect and did not.

### The ground truth was re-derived, not trusted

`collectableGainMs` is the number the new INV-18 guard leans on, so it was
recomputed here from the capacity model — merge-consecutive-runs, `(N-1)` probe
intervals for a climb, `(N-1)` `settleHoldMin` for a descent, `!anyFits`
segments excluded — alongside `gainAvailableMs`, `decisiveMs`, `upwardSteps`,
`downwardSteps` and `regimeChanges`.

```
ground truth: my re-derivation agrees with holdout.js on every field of
every one of 1,320 traces
```

Worth noting because it is also a live check: under mutant **M-a** (below) the
re-derivation caught the tampering directly —
`20260910/holdout-6: groundTruth.collectableGainMs theirs=0 mine=22885`.

### The committed tool, for the record

```
$ node tools/perf-satisfiability.mjs
clairvoyant upper bound over 120 holdout traces (seeds 20260909..20260918)
  strategies satisfying every invariant: metric 120/120, greedy 118/120
  INV-18 scored 37/120 traces; a never-moving controller failed 37 of those 37
SATISFIABLE: ...                                                      EXIT=0

$ BIRB_PERF_HOLDOUT_SEED=<gate seed> node --test tests/perf-trace-corpus.test.js
# [TC-15b] holdout seed fingerprint b8d52699
ok 17 - TC-15b a conforming clairvoyant controller satisfies every invariant ...
# pass 21 # fail 0        (identical on a second run with the same seed)
```

Holdout seed used by this re-gate, by fingerprint only: **b8d52699**. It was
generated at run time from `/dev/urandom` and never written to a file.

---

## 2. Discrimination survived — and it is not thin

**Per seed, 12 traces each, on the gate's own decade.** `idle` is a controller
that never applies anything; `thrash` is `createThrashPolicy({everyMs:1200})`.

```
seed        traces skipped scored idle-failed thrash-failed mine-SAT committed-SAT
20260909        12       6      6           6            12       12            12
20260910        12       5      7           7            12       12            12
20260911        12       7      5           5            12       12            12
20260912        12       9      3           3            12       12            12
20260913        12      10      2           2            12       12            12
20260914        12      10      2           2            12       12            12
20260915        12      11      1           1            12       12            12
20260916        12       9      3           3            12       12            12
20260917        12       9      3           3            12       12            12
20260918        12       7      5           5            12       12            12
TOTAL          120      83     37          37           120      120           120
```

`scored == idle-failed` on **every single row**, on 100 further seeds
(513/513) and on a third decade (241/241). 1,332 traces, not one case of INV-18
scoring a trace that a never-adapting controller passed.

**Thrash fails 100% of ALL traces, and for the right reasons** — not by one
lucky check:

```
INV-1 120/120   (unlabelled-probe: it climbs every 1200 ms)
INV-5 120/120   (persistent oscillation)
INV-7 120/120
INV-14 46/120
INV-18  6/120
```

### On "if the guards now skip most traces, that is a STOP"

They do skip most traces — 69.2% on the gate decade, 57.3% over seeds 1..100 —
and I considered this the likeliest STOP of the re-gate. It is not one, on
measurement, for four reasons.

**(a) The failure mode that rule targets is absent.** What TC-15 caught twice
was a guard so wide that a never-adapting controller passed EVERYTHING (10/12
and 12/12 skipped). Here 37-43% of traces are still scored and idle fails 100%
of them. Every one of 110 seeds tested scores at least one trace.

**(b) This wave's new guard contributes 1.3-1.7% of it.** Measured by
re-implementing the guard ladder so each can be switched off individually — the
replica reproduces the real INV-18's skip decision on **every** trace of both
decades, asserted, so it is measuring the real thing:

```
guard set                                skipped  scored  scored-but-UNWINNABLE
                                          120 / 600 traces (two disjoint decades)
none (INV-18 with no guard at all)         0/  0   120/600        28 / 130
gain only                                 38/164    82/436        13 /  53
gain+decisive (pre-8b1df27)               69/309    51/291         3 /   9
gain+decisive+bestFixed (HEAD a050e0b)    81/351    39/249         0 /   3
ALL FOUR (working tree)                   83/359    37/241         0 /   0
ALL minus collectable                     81/351    39/249         0 /   3
```

The new `collectableGain` guard adds **2 of 120 (1.7%)** and **8 of 600 (1.3%)**.
The bulk is `gainAvailableMs` and `decisiveMs`, which are G3o's own and which
G3o validated.

**(c) Every one of the four guards is load-bearing** — the last column is the
satisfiability bar, and it only reaches 0 with all four. `collectableGain`
removes the last 3 unsatisfiable traces on the 1000-decade for 8 skips.
Independently confirmed by watching it fail (M-b, §3).

**(d) The two-sided measurement, on 720 traces across two disjoint decades**,
against the empirical question "can ANY conforming clairvoyant strategy of mine
beat standing still here?":

```
seeds 20260909..18 (120):  TP=37   FP=0   TN=28    FN=55
seeds 1000..1049   (600):  TP=241  FP=0   TN=130   FN=229
```

**FP = 0 both times** — the guards never score a trace no conforming controller
can win. That is the bar, and it is met. The FN column is real coverage lost and
is worth stating plainly: **most of it is the pre-existing guards, not the new
one** (gate decade: `gainAvailable` 23, `decisive` 21, `bestFixed` 7,
`collectableGain` 4).

**(e) INV-18 is not the only anti-idle check.** INV-14 catches the idle
controller independently where a better fixed profile dominates it:

```
seed        traces  INV-18-scored  INV-18-caught  INV-14-caught  EITHER-caught
20260915        12              1              1              1              2   <- the thinnest seed
TOTAL (gate)   120             37             37             15             39
TOTAL (1000)   600            241            241            105            264
```

The thinnest seed in 110 still catches an idle controller on 2 of its 12 traces.

**Stated limitation, not a blocker:** a gate that draws an unlucky seed gets
INV-18 scoring as few as 1 trace in 12. `tools/perf-satisfiability.mjs` prints
the scored count on every run and exits 1 on `DISCRIMINATION LOST`, so this is
visible rather than silent — but a future gate should read that line and not
only its exit code.

---

## 3. The flips still hold — 7 of 7, each watched failing AND watched passing

Four of the six named modes live in suites the working tree does not touch and
whose hashes are in the frozen manifest, so they were re-run against minimal
implementations G3o-2 wrote from the surface pinned at the top of each suite
(`src/game/adaptive-quality.js`, `effect-verification.js`, `perf-learning.js`,
created, driven, then **deleted** — `git status` shows only the 7 expected
modified files and nothing untracked under `src/`). The other three live in
`driver.js` and `invariants.js`, which is where this wave's edits are.

| Forced state | Assertion | Green baseline | Flipped |
|---|---|---|---|
| A controller that reduces a **bundle** of costs in one step | **AQP-4** | `ok 4` | `not ok 4` under `F1-bundle` (rung 1 drops shafts + weatherDensity + cloudShell together). AQP-8/9/13 stay green — the flip is isolated |
| **ONE timer** for both overload and recovery | **AQP-13** | `ok 13` | `not ok 13` under `F2-one-timer` (`recoveryWindowMs = overloadWindowMs`). AQP-4/8/9 stay green |
| An **apply that is a no-op** | **EV-1** | `ok 2` | `not ok 2` under `F3a-trust-request` (score the REQUEST, not the read-back). EV-3 flips with it; **EV-2 stays green**, so the flip is not "return no-op always" |
| An evaluation **crediting a confounded window** | **PL-11** | `ok 12` | `not ok 12` under `F4-credit-confound` (scene-change guard deleted). **PL-10 stays green** on the same mutant |
| Reaching budget by **degrading input or collision fidelity** | **AQP-8**, **AQP-9**, **INV-1** | `ok 8`, `ok 9`, INV-1 PASS | `not ok 8` under `F5-gameplay` (a `collisionRate` rung); `not ok 9` under `F5b-apply-gameplay` (`apply({settings:{inputRate:30}})`); driver-side, the SAME polite descender goes from `INV-1 no contract violations` to `2 contract violation(s)` the moment its apply names `collisionRate`/`inputRate` |
| **Stable but permanently degraded**, reported as success | **INV-8** | `probe-only`: *"2 recovery attempt(s) after 0 ms; first at 10017 ms (probe)"* | `static` on `stuck-quality`: *"stable and degraded from 0 ms with no upgrade probe by 47000 ms. Final rung 2; the capacity model says rung 0 would have fitted."* |
| **The free climber** (`kind:'upshift'` every 3 s) — the fix new at 8b1df27 | **INV-1 + INV-7** | `probe-only`: INV-1 PASS, INV-7 *"2 upgrade probe(s), each at least 30000 ms apart"* | free climber: INV-1 FAIL, INV-7 FAIL, `unlabelled-probe`. Over 120 traces it is caught on **69** of them; on the rest it never gets a second upward move to make |

### The oracle changes this wave made, also watched failing

| Mutant | What was forced | What went red |
|---|---|---|
| **M-a** | `groundTruth.collectableGainMs` forced to `0` — the guard skips everything | `not ok 16 - TC-15 ... 'no holdout trace out of 48 was scoreable at all (48 skipped) — the guards are too wide'`; my instrument `DISCRIMINATION LOST: scored=0 idleFailed=0`; and my ground-truth re-derivation named the tampered field |
| **M-b** | INV-18's `collectableGainMs` guard disabled | On seeds 1000..1049 the REAL INV-18 scores **3 traces no conforming strategy of mine can win** (`1006/holdout-5`, `1027/holdout-0`, `1038/holdout-3`), FP 0 → 3, exit 1. Restored: FP=0 |
| **M-c** | INV-18's `betterOutside` forced `true` | `not ok 16 - TC-15 ... 'INV-18 scored this trace and a controller that NEVER ADAPTS passed it — beat standing still: outside 49117 vs 49117 ms'`; my instrument, 13 findings, exit 1 |
| **M-d** | INV-14's `extraDescentHoldsMs` removed | Over seeds 1..150, a conforming reference is recorded DOMINATED on 2 traces, both strategies: *"(7000 ms outside / 7000 ms degraded, for 0 regime change(s), 0 upward and 4 downward step(s)). Adaptive: outside=29283 ms, degraded=0 ms. Dominated by: fixed(rung 4) outside=21717"* — for descending four rungs at exactly PRO-6's rate. `TOOL_EXIT=1` |

INV-14's descent allowance is non-zero on 51 of 120 traces and averages 32% of
the base allowance when it fires (max 129%). INV-14 still catches `thrash` on
46/120 and `static` on 15/120 with it in place, so it has not been widened into
uselessness.

---

## 4. The corpus still responds to decisions

Driven with three policies (never move; go to the ladder floor on frame one;
flip-flop) across all sixteen committed scenarios, and with three (idle;
clairvoyant; fixed-floor) across a 12-trace holdout seed.

- **16 of 16** committed scenarios produce a different `costMs` stream.
- **12 of 16** produce a different delivered-interval (`dtMs`) stream. The four
  that do not — `stuck-quality`, `cold-start-from-persisted-profile`,
  `corrupt-store-clamped`, `first-use-shader-compilation` — differ in `costMs`
  and are hidden only by vsync quantisation. That is the `misleading-plateau`
  mechanism working, which is exactly G3o's finding, reproduced.
- Holdout: **10 of 12** differ in both. The two that do not are explained and
  are correct: `holdout-3` has dead rungs 1 and 3 on a 4-rung ladder and
  `holdout-9` has dead rungs 3, 4 and 5 on a 6-rung ladder, so several rungs
  cost *literally the same number*:
  `{"rung0":21.82,"rung1":21.82,"rung2":21.28,"rung3":21.28}`. A dead rung is a
  thing the holdout's own header promises to contain. This is a capacity model,
  not a tape.

Example magnitudes: `overload` 631 frames / 13,000 ms outside budget under
never-move against 1,021 frames / 0 ms under floor.

---

## 5. Determinism

```
npm test x5 (on the final restored tree):
  run 1: EXIT=0 | # tests 629 # pass 419 # fail 0 # skipped 210
  run 2..5: identical, byte for byte
```

Five runs of a 39-second suite is a weak instrument for a test that flaked one
run in three, so the discriminating suite was run on its own **twenty times**,
each drawing fresh runtime seeds:

```
node --test tests/perf-trace-corpus.test.js  x20
  non-zero exits = 0 / 20 ; '# fail 0' seen = 20 / 20
```

> **A note for whoever reads this next.** My FIRST 20-run batch reported 7/20
> non-zero and I nearly wrote that down. It had been launched in the background
> and was still running when I applied mutants M-a and M-b to the very files it
> was testing. The result was an artifact of my own harness, not of the code.
> It was re-run in the foreground on the restored tree — md5 verified against a
> backup taken before the first mutation — and came back 0/20. **Do not run a
> flake census in the background while mutating the tree.**

The seedless assertions still hold, so no seed was pinned to buy this:

```
ok 14 - TC-14 the holdout is deterministic per seed and has no default seed
ok 15 - TC-14b holdout traces validate, run, and contain the shapes the corpus lacks
ok 20 - TC-18 no holdout seed is materialised in the worktree
```

Gate path, and the module-absent baseline:

```
BIRB_PERF_IMPL=1 npm test
  EXIT=1 | # tests 629 # pass 503 # fail 122 # skipped 4
  120 x ERR_MODULE_NOT_FOUND + 2 x ENOENT = 122.  Every failure is module-absent,
  which is G3o's recorded baseline exactly (120 + 2).
```

---

## 6. No frozen oracle was edited

```
sha256sum -c tools/oracle-manifest.txt   ->  EXIT=0, 58 entries OK, 0 FAILED
git status --short                       ->  exactly the 7 Wave 3A fixture/test files
```

The three minimal implementations this gate wrote under `src/game/` were deleted
before the final runs; `git status` shows nothing untracked there.

---

## 7. DEF-1 and DEF-2 still respected

**DEF-1 (no persisted learning store).** Every occurrence of
`localStorage`/`sessionStorage`/`indexedDB` in the Wave 3A suites and fixtures is
either a check that the module touches NONE of them (`adaptive-quality.test.js`
AQP-1's forbidden-pattern list, `perf-learning.test.js:785`,
`effect-verification.test.js:554`) or prose in a scenario's `depicts`. No suite
demands a store. Proved constructively as well: the `perf-learning.js` and
`effect-verification.js` this gate wrote carry no persistence layer of any kind
and satisfy PL-10, PL-11 and EV-1/2/3.

**DEF-2 (GPU timer query lifecycle).** `createQuery`, `beginQuery`, `endQuery`,
`queryPool`, `getQueryParameter` appear NOWHERE in any Wave 3A suite or fixture.
The only mentions of the extension are two pieces of prose naming its absence.
GPU reaches the controller as `driver.js:422` writes it —
`{ value: null, state: 'unavailable', reason: gpuState }` — which is
`gpu-timer.js`'s probe contract and nothing more.

---

## 8. Residual finding — non-blocking, and Wave 3B should have it

**The `unlabelled-probe` guard enforces PRO-4's 10-second stability window, not
PRO-8's 30-second probe cap.** `driver.js` raises the violation only when an
upward move comes sooner than `restoreStabilityMinMs` after the last adjustment.
Measured, over 120 traces:

```
free climber, kind:'upshift', every  3000 ms:  INV-7 catches it on 69/120 traces
free climber, kind:'upshift', every 12000 ms:  INV-7 catches it on  0/120 traces
                                               (227 upward moves, 0 probes, 0 violations)
```

So a controller can still climb one rung every 10-12 s — **2.5 to 3 times faster
than PRO-8 permits** — score zero probes, record zero violations, and collect
`ok - INV-7: 0 upgrade probe(s), each at least 30000 ms apart`, a message that is
literally true and materially misleading. The guard's own comment says it
classifies on the GPU state ("DEF-2 ships the GPU timer on its unavailable branch
on every target device, so in practice headroom is unmeasurable and every upward
move is a probe. Classify on the last GPU state the world actually reported") —
**the code never reads `gpuState`.** A comment that describes a check the code
does not implement is the shape this repo keeps paying for.

**Why this is not a STOP.** G3o's STOP was not that the guard was imperfect; it
was that the oracle set *forced* the violation — a conforming clairvoyant failed
11 traces where the PRO-8-ignoring climber failed 2, so relabelling was the
implementer's only route to green. That differential is now zero:

```
                                        fails, of 120 holdout traces
PRO-8-CONFORMING clairvoyant (mine)                    0
PRO-8-IGNORING climber @ 10 s                          0
PRO-8-IGNORING climber @ 12 s                          0
PRO-8-IGNORING climber @  3 s                         63   (caught: unlabelled-probe)
```

Laundering buys **nothing**. A conforming controller passes every trace, so
there is no trace on which breaking PRO-8 is the only way through. The perverse
incentive G3o stopped on is gone; what remains is a guard that is narrower than
its comment claims.

**Recommended for Wave 3B (fixture edit, not contract):** bind PRO-8's
`probeIntervalMs` to every unlabelled upward adaptive move as well, or implement
the classification the comment already describes. Either is a few lines in
`driver.js`. Add a discriminator cell for it while you are there — `INV-7` and
`INV-1` had no committed cell for the free climber before 8b1df27 and still have
none.

---

## 9. On the adjudication's own deviations

Checked, and each is supported by this gate's independent measurement:

- **"The diagnosis did not land on (a)-(d); the instrument was not an upper
  bound."** Confirmed. My independently written greedy strategy fails 11 per
  1,200 and my hold/drift/patient strategies pass those same traces.
- **"I fixed the oracle anyway."** Confirmed and it was right: without
  `collectableGainMs`, the real INV-18 scores 3 traces per 600 on a decade the
  fix was never tuned against that no conforming strategy of mine can win.
- **"I went beyond INV-18 and changed INV-14 too."** Confirmed by M-d.
- **"I did not update G3o.md; declaring PASS is not a sub-agent's call."** Right
  call, and this section is the consequence: the gate reached its own verdict by
  running, with an instrument the orchestrator did not write.
- **"Nothing is committed."** Confirmed: 7 modified files, nothing staged.

## 10. Reproduction

```bash
npm test                                       # exit 0, 629 tests, 0 fail, 210 skipped
BIRB_PERF_IMPL=1 npm test                      # exit 1, 122 fail, ALL module-absent
sha256sum -c tools/oracle-manifest.txt         # exit 0, 58/58 OK
node tools/perf-satisfiability.mjs             # exit 0, 120/120, 37 scored, 37 idle failures
node tools/perf-satisfiability.mjs --seed 1 --seeds 150
BIRB_PERF_HOLDOUT_SEED=<seed> node --test tests/perf-trace-corpus.test.js   # TC-15b
for i in $(seq 1 20); do node --test tests/perf-trace-corpus.test.js; done  # 0 non-zero
```

G3o-2's own clairvoyant, guard-attribution and flip drivers are in the session
scratchpad under `g3o2/`; none of it is committed, and the working tree is
exactly the 7 Wave 3A files the orchestrator left.

**Wave 3B is cleared to implement against these oracles**, carrying §8 with it.
