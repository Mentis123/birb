# The trace corpus

Wave 3 / task **P3.1** of [docs/ULTRACODE_PERFORMANCE_PLAN.md](../../../docs/ULTRACODE_PERFORMANCE_PLAN.md) §4,
under [docs/perf/CONTRACT.md](../../../docs/perf/CONTRACT.md).

This directory is the foundation `src/game/adaptive-quality.js` is tested on.
It is **not** a set of recorded frame times.

---

## 1. It is a capacity model, not a recorded interval array

Every sample in every scenario carries the **sustainable frame cost at each
setting**:

```js
{ atMs: 4000, cpuShare: 0.35, costMs: { rung0: 26.0, rung1: 14.4, rung2: 10.2 } }
```

The driver reads the rung the controller is **currently standing on**, takes the
cost at that rung, adds instrumentation / hitches / jitter, turns it into a
delivered interval through the presentation model, and hands that to the
controller. The controller's decision on frame *n* changes what frame *n+1*
measures.

**This is not a preference.** Replay a recorded array and the controller's
choice changes nothing about what it then measures, so every test of a decision
is vacuous. Two of the plan's named required regressions are literally
unrepresentable in a replay:

- **recovery when capacity returns** — the trace has to get cheaper *because*
  the controller stayed put and more expensive *because* it went back up. A tape
  plays the same numbers either way, so "restored" and "never noticed" score
  identically.
- **a failed upgrade probe** — a probe is a question about a rung the controller
  is *not* on. A tape has no answer to it, so every probe succeeds, and the
  corpus certifies a controller that would halve the frame rate on the phone.

There is a third, subtler one. `misleading-plateau` depends on 12 ms and 16 ms
being delivered identically on a 60 Hz panel while 19.5 ms is not — the plateau
*is* a flat array of 16.67 ms intervals, and replaying it makes the probe
succeed. The mechanism lives in `driver.js`'s vsync quantisation.

---

## 2. Layout

| File | What it is |
|---|---|
| `schema.js` | The scenario shape, the closed event/GPU/mode enums, `validateScenario()`, `capacityAt()`, `feasibleRung()` |
| `ladder.js` | What a rung is. `compatLadder` (today's three shipped tiers, CONTRACT §1.3) and `separatedLadder` (the plan's step-5 order, one lever at a time). Also the FORBIDDEN gameplay keys |
| `driver.js` | `runTrace()` and `runPair()`. The loop, the presentation model, the apply routing point, the violation ledger |
| `invariants.js` | INV-1 … INV-18. Every deadline is arithmetic on `PROVISIONAL`; percentiles and oscillation come from the shared `frame-metrics` / `frame-stats` |
| `reference-policies.js` | Eight small controllers, each wrong in one named way, used to prove the corpus can fail (R8). Plus `compat`, a faithful transcription of the shipped 55/58 policy |
| `scenarios/*.js` | The sixteen commissioned scenarios |
| `index.js` | `buildCorpus(K)`, `buildScenario(name, K)`, `REQUIRED_SCENARIOS` |
| `holdout.js` | `generateHoldout(seed)`. **No default seed, ever** |

Nothing here imports THREE or touches the DOM. It runs under plain
`node --test` against the tracked 4-class three stub, with no install step.

---

## 3. Every threshold is imported

`src/game/perf-constants.js` holds `PROVISIONAL`, the one object CONTRACT §10
rule 2 asks for, with a `PROVENANCE` row per field. PRO-10…PRO-13 are not
restated there — they already live in `src/game/frame-stats.js` and are imported
from it, because the same provisional number declared in two modules is a number
Wave 4 changes in one place and not the other.

Consequently **a scenario is a function of the constants, not a table of
milliseconds**:

```js
const onsetMs = 4 * K.evaluationWindowMs;                 // PRO-3
const durationMs = onsetMs + overloadResponseDeadlineMs(K) + 6 * K.evaluationWindowMs;
```

Retune `PROVISIONAL` and `buildCorpus(K)` produces a retuned corpus — every
duration, deadline and mark moves together, and nothing has to be edited. That
is CONTRACT §10 rule 1 made mechanical, and `tests/perf-trace-corpus.test.js`
asserts it by building the corpus twice with different constants and requiring
the scenarios to differ.

---

## 4. The adapter — what a controller has to look like

`runTrace(scenario, { policy })`. `policy` is an adapter, so the corpus does not
depend on `createAdaptiveQuality`'s internal shape:

```js
{
  // Optional. Called once, before the first frame.
  start({ ladder, depth, targetFPS, budgetMs, constants,
          startProfile: { rung, outOfRange },   // the COLD-START profile, exactly as stored
          instrumentation, apply, now }) {},

  // Required. Called once per synthesised frame, at the top of the loop.
  frame({ tMs, dtMs, valid, invalidReason, tag,
          cpuMs, updateMs, submitMs,
          gpu: { value, state, reason },        // matches gpu-timer.js read() exactly
          mode, rung,                           // `rung` is READ BACK off the world
          budgetMs, targetFPS, frameIndex }) {},

  reset(tag, tMs) {},                  // optional — a boundary from the closed enum
  setMode(mode, tMs) {},               // optional — 'auto' | 'manual' | 'benchmark'
  setPaused(paused, reason, tMs) {},   // optional
  snapshot() {},                       // optional — { hitches } enables INV-17
}
```

`apply(request)` is the **one routing point**:

```js
apply({ kind, rung, reason, source, settings })
  -> { effectiveRung, clamped, rejected, reason }
```

`kind` is a closed set (`driver.js` `APPLY_KINDS`): `downshift`, `emergency`,
`upshift`, `probe`, `probe-keep`, `probe-rollback`, `revoke`, `manual`,
`startup`. Probes are distinguishable from ordinary adjustments because PRO-8's
budget ("at most one optional upgrade probe per 30 seconds", "one outstanding
probe") is otherwise unenforceable from outside.

**Rendering work changes when, and only when, `apply()` is called.** The driver
never asks the controller what rung it believes it is on. That is
`PERFORMANCE_REALISM_PLAN.md`'s runtime-loop step 2 made mechanical: *"A slider
value changing is not evidence that rendering work changed."*

### Violations

The driver records, rather than throws, on:

`unknown-apply-kind` · `gameplay-fidelity-write` · `adaptive-write-while-locked`
· `probe-overlap` · `probe-too-soon` · `probe-resolution-without-probe` ·
`non-integer-rung` · `out-of-range-rung`

INV-1 asserts the list is empty. Throwing on the first would hide the other
nine.

---

## 5. The sixteen scenarios

| Scenario | What it depicts |
|---|---|
| `overload` | Capacity collapses and stays collapsed |
| `recovery-when-capacity-returns` | …and then comes back |
| `oscillation-bait` | The top rung misses the refresh by half a millisecond |
| `misleading-plateau` | A flat, perfect 60 that hides zero headroom |
| `absent-gpu-timer` | No `EXT_disjoint_timer_query_webgl2` — i.e. every iPhone |
| `disjoint-gpu-results` | The timer answers and the answer must be discarded |
| `manual-to-auto` | The panel takes the lock; the adaptive layer may not write |
| `resume` | Six seconds hidden, and nothing was ever wrong |
| `scene-change` | A biome switch: a 420 ms boundary and a different world after it |
| `stuck-quality` | 30 s stable and degraded — must produce a bounded probe |
| `boundary-interleaved-with-recurrent-hitch` | A resize storm on top of a hitch the reset must not erase |
| `cold-start-from-persisted-profile` | Warm-up, a 380 ms construction frame, yesterday's profile |
| `corrupt-store-clamped` | The stored profile says rung 97 |
| `delayed-regression` | The upgrade was right when it was made and wrong later |
| `first-use-shader-compilation` | One 260 ms frame, inside an evaluation window |
| `instrumentation-pair` | The same world twice: panel closed, panel open |

Each module exports `build(K)`, `invariants(result, K)` and `discriminators`.

---

## 6. R8 — the corpus has been watched failing

`discriminators` is a matrix of claims: *this reference policy must FAIL this
invariant on this scenario, and this one must PASS it.*
`tests/perf-trace-corpus.test.js` runs every cell. A check nothing can fail is
not an oracle, and a check nothing can pass is a broken one — the matrix asserts
both directions.

The policies and the defect each embodies:

| Policy | The defect, and where this repo already paid for it |
|---|---|
| `static` | Decisions never reach the renderer. Shipped: `if (!fpsMetric) return;` in front of the only `sampleFps()` call site, for the entire life of the adaptive tier |
| `thrash` | Persistent oscillation |
| `twitchy` | Reacts to one frame instead of a window; never restores. Ignores `valid`, so a hidden-tab frame is a measurement |
| `naive-gpu` | `gpu.value \|\| 0` — "unavailable" read as "zero GPU work, infinite headroom". This is `(navigator.hardwareConcurrency \|\| 4)`, which gated bloom off on every iPhone ever made. Also applies a stored profile without clamping |
| `compat` | The shipped 55/58 policy, transcribed. Fails `misleading-plateau` (restores on delivered FPS, has no memory of the failure) and `manual-to-auto` (no mode concept at all) |
| `fire-and-forget` | No post-acceptance watchdog |
| `probe-only` | Deliberately incomplete — no overload response whatsoever. It exists to prove INV-7/INV-8/INV-9 are *satisfiable*, because an invariant nothing can satisfy is a broken oracle |
| `fixed-N` | Not a defect: the fixed reference profiles the development loop requires |

---

## 7. The holdout

```bash
BIRB_PERF_IMPL=1 BIRB_PERF_HOLDOUT_SEED=<the gate's seed> \
  node --test tests/adaptive-quality-holdout.test.js
```

`generateHoldout(seed)` has **no default seed and throws without one**. The seed
lives in the gate prompt and nowhere else. Committing one — as a default
argument, a fallback, a fixture, a CI default, or an "example" in a comment —
turns the holdout into more committed scenarios and deletes the only check in
this wave that catches a controller tuned to the corpus.
`holdoutFingerprint(seed)` exists so a gate file can record *which* seed it used
without the seed reaching the repository.

What makes it honest rather than merely random:

1. **Dead rungs** — a setting that costs exactly what the setting above it
   costs. The plan warns that *"uniform intensity changes alone may leave the
   expensive shader work intact"*, and this repo has shipped exactly that. A
   controller that assumes every downshift helps descends the whole ladder for
   nothing.
2. **CPU-bound regimes** — cost nearly flat across the ladder, `cpuShare` up to
   0.93. Nothing on the ladder helps; the correct behaviour is to stop
   descending.
3. **Randomised event placement**, including boundaries inside decision windows.
4. **No per-trace expected outcome.** Every holdout check is a contract
   violation, an oscillation count, or a comparison against the FIXED profiles
   run on the identical trace — so nothing can be satisfied by recognising the
   trace.

The headline check is **INV-14, Pareto non-domination**: the controller fails
only if some fixed profile is no worse on *both* of the plan's own evaluator
metrics (time outside budget, time spent unnecessarily degraded) and strictly
better on one, beyond a discovery allowance. No weights, no invented trade-off —
it is the development loop's own question, *"verify that adaptation earns its
overhead"*, asked without a threshold. **INV-18** closes its one hole: a
controller that never moves ties with a fixed profile and is therefore not
dominated, so where the ground truth says there was something to win, it must
beat standing still.

Four allowances on INV-14, each added because a controller that had the
capacity model in its hand, or one that passed all sixteen committed scenarios,
failed without it. All four were measured, not guessed:

- a segment where every rung fits, or none does, is not *decisive* — the ladder
  decides nothing there and no controller can beat a fixed profile on it;
- every change in the correct rung costs at least one response deadline,
  because the controller has to measure a world a fixed profile was born
  knowing;
- every rung the trace requires the controller to **climb** costs one PRO-8
  probe interval, and that time scores as degraded. At one optional upgrade
  probe per thirty seconds a three-rung climb takes ninety seconds however good
  the controller is; an oracle without this term demands behaviour the contract
  forbids.
- every rung it requires the controller to **descend** beyond one per regime
  change costs one PRO-6 hold, and that time scores as outside budget. This one
  was missing for a whole gate cycle because "downward steps are cheap" is true
  per rung and false per descent: a response deadline covers ONE adjustment,
  and a four-rung descent is four of them with a hold between each. Measured, a
  clairvoyant reference starting on rung 0 of a five-rung ladder whose first
  segment needs rung 4 was recorded as DOMINATED — 29283 ms outside budget
  against fixed(4)'s 21717 — for descending at exactly the rate PRO-6 mandates.

The climb allowance is on INV-14 only, and deliberately **not** on INV-18.
There it excuses the adaptive controller's extra cost; here it would become a
hurdle the controller has to clear — the same number pointing the wrong way.
Measured: with it applied to INV-18, a controller that beat standing still by
twenty-three seconds of degraded time was recorded as having failed.

INV-18 charges the toll on the other side of the comparison instead, where it
belongs: to the question of whether the trace had anything to offer at all.
`gainAvailableMs` — the time the correct rung differs from the starting one —
is a duration, and the contract's rates are not free, so it over-counts twice
over. It counts segments where NOTHING on the ladder meets the budget, where
both scored metrics are rung-independent and no controller can gain anything
(one trace reported 217239 ms of gain available and had 18068 ms of it); and it
charges nothing for reaching the better rung, when PRO-8 caps the climb at one
rung per thirty seconds and `timeUnnecessarilyDegradedMs` is a PREDICATE, so
the partial climb that DOES fit in a short window earns literally zero. So the
ground truth now also carries **`collectableGainMs`**: the same segments, net of
the contract's own rate limits, merged so an opportunity is charged its toll
once. Where it falls under the noise tolerance, INV-18 declines to score the
trace and says so.

Measured in both directions over 2,400 generated traces before it shipped: it
declines 10 traces that no conforming reference can win and 0 that any
reference can win, and costs 7 of 513 previously scored traces. Over an
independent 1,800-trace sweep the clairvoyant reference satisfies every
invariant on 1800 of 1800, INV-18 scores 761 of 1800, and a controller that
never adapts fails all 761 of those. The two wider guards tried at G3o skipped
10 of 12 traces and 12 of 12: **a guard wide enough to hide an unsatisfiable
trace is wide enough to hide a bad controller**, and the arithmetic above is
derived from the capacity model alone precisely so that
`tools/perf-satisfiability.mjs` stays an independent check of it rather than a
mirror.

---

## 8. Adding a scenario

1. Write `scenarios/<name>.js` exporting `name`, `build(K)`, `invariants(result, K)`
   and `discriminators`.
2. Express every time as arithmetic on `K`. If you find yourself typing a
   millisecond figure that is not a property of the depicted device, it belongs
   in `PROVISIONAL`.
3. `whyCapacityModel` is required prose and the validator enforces a minimum
   length. If the honest answer is "it does not need one", say so — 
   `corrupt-store-clamped` does — and make sure the scenario still checks
   something a fixed array could not.
4. Register it in `index.js` and add it to `REQUIRED_SCENARIOS`.
5. Add its cells to `discriminators`, and run
   `node --test tests/perf-trace-corpus.test.js` until the matrix holds. A
   scenario with no discriminator is a scenario nobody has watched fail.
