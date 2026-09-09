VERDICT: STOP — the module suite is red (FS-A1b), P2.1e shipped nothing, and three of the four modules report a number where the contract requires either a different number or a sentinel

# G2a — Wave 2 semantics gate

Gate for the Modules phase of `.claude/workflows/perf-wave-2.js` (P2.1a-d, P2.1e, P2.2a).
Everything below was produced by running the code and reading the diff. Nothing is taken
from an agent's self-report.

Working tree at gate time — nothing committed:

```
 M src/effects/bloom-pass.js      (P2.2a, +39/-3)
 M src/game/frame-metrics.js      (P2.1a, +223)
?? src/game/frame-stats.js        (P2.1d)
?? src/game/gpu-timer.js          (P2.1c)
?? src/game/quality-settings.js   (P2.1b)
```

---

## 1. Oracles untouched — PASS

```
$ sha256sum -c tools/oracle-manifest.txt ; echo $?
0                      # 56 hashed files, every line OK
```

`git status --porcelain` intersected against the manifest's path list is empty. No
`tests/**`, no `tools/lib/**`, no `tools/birb-*.mjs`, no `CONTRACT.md`. R5 held. The
only `src/` string in the manifest is prose inside a comment, not a hashed row.

## 2. The siblings are still green — PASS

```
$ npm test          # BIRB_PERF_IMPL unset
# tests 460 / pass 378 / fail 0 / skipped 82        exit 0
```

Exactly the required 460/378/0/82. `humanoid/`, `gauntlet/`, `sculpture/`, `icon3d/`
unaffected. All four new modules import nothing and touch neither `THREE` nor the DOM,
so R4's static-import hazard was not reintroduced.

Browser harnesses, run because `bloom-pass.js` is live in `index.html` and a shader that
fails to compile draws nothing while the page still screenshots:

```
$ node tools/birb-shaders.mjs   -> exit 0   "all shaders compile in 4 environments"
$ node tools/birb-modes.mjs     -> exit 0   "all 5 modes ok in forest"   (warnings = failures)
```

## 3. The suite is RED — BLOCKING

```
$ BIRB_PERF_IMPL=1 node --test tests/frame-metrics-stats.test.js tests/frame-metrics.test.js \
      tests/quality-settings.test.js tests/gpu-timer.test.js tests/frame-stats-totals.test.js
# tests 72 / pass 71 / fail 1        exit 1

not ok 28 - FS-A1b the acceptance gate and the controller share one percentile implementation
    one convention, one implementation — otherwise the loop is closed against itself
    51 !== 52
```

Green is the deliverable and it is not green. The failure is not cosmetic; see §4.1.

---

## 4. Findings

### 4.1 BLOCKING — two percentile implementations, and they disagree

`src/game/frame-stats.js` carries a private `nearestRankPercentile(values, q)`; it does
not import `percentile` from `frame-metrics.js`. CONTRACT, quoted in the oracle's own
header: *"the value the controller fires on and the value the acceptance gate scores must
be computed by the same module, or the loop is closed against itself."* Two
implementations is the defect; that they disagree is only how it surfaced.

The true nearest-rank p95 of the fixture is **51** (rank `ceil(0.95x137) = 131`;
cumulative count reaches 131 first at 51). `frame-stats` returns 51 and is right.
`frame-metrics.percentile(intervals, 95)` returns **52** — and returns 52 for p50 and p99
as well, because it reads `p` as a fraction, so `95` clamps to the last index.

**The oracle pair is inconsistent, and I am naming it rather than editing it (R5).**
Every one of P1.1a's fourteen calls in `tests/frame-metrics-stats.test.js` passes a
fraction (`0.5`, `0.95`, `0.99`, `1`), and its reference `refNearestRank` computes
`ceil(p * n) - 1`. FS-A1b in `tests/frame-stats-totals.test.js` calls the same helper with
`95`. On my reading FS-A1b is the defective assertion — its own file header says the
convention is *"pinned identically by P1.1a"* — but it is frozen and I have no authority
to change it.

**It is satisfiable without touching either oracle.** No P1.1a assertion ever passes
`p > 1`, and FS-A1b passes `95`, so one helper that treats `p > 1` as a percentage
(`p = p / 100`) and anything else as a fraction satisfies both suites, including
`percentile(oneToHundred, 1) === 100`. Implement `percentile` that way in
`frame-metrics.js`, delete `nearestRankPercentile` from `frame-stats.js`, and import the
one helper. That collapses the duplication and turns FS-A1b green in the same edit.

### 4.2 BLOCKING — P2.1e did not land. There is no seed.

Item 7 of this gate's brief is not "could-not-determine"; it is negative.

```
$ ls src/environment/seeded-random.js   -> No such file
$ ls tests/seeded-random.test.js        -> No such file
$ git status --porcelain src/environment/   -> (empty)
$ grep -rn "Math.random()" src/environment/ | wc -l
76                       # spherical-world 52, world-shell 17, weather 4, collectibles 3
$ grep -rn "mulberry32\|seededRandom\|createRng\|worldSeed" src/ index.html
(no matches)
```

Seventy-six unseeded calls — the same count G0 recorded — and no seeded generator
anywhere in the repo. I could not "build twice at one seed and compare real geometry"
because there is no seed to build at.

This is not a missing nicety. `src/game/quality-settings.js` ships
`BENCHMARK_FROZEN = ['seed', 'route', 'settings', 'sun']` and calls `freeze('seed', true)`
on entering Benchmark. Benchmark mode now *claims* to fix a seed that does not exist. Per
ULTRACODE §4 this blocks Benchmark mode in Wave 2 and Experiments 1 and 5 in Wave 5, and
it is why G0's own mean-pixel check could not resolve a small change.

### 4.3 BLOCKING — ACC-2 reports a number that is not the quantity it scores

`src/game/frame-stats.js`, the `gates` object:

```js
'ACC-2': { pass: acc2Pass, value: missedTargetPct, threshold: T.longIntervalMaxFraction * 100 }
```

`acc2Pass` is computed from `longFraction` — the fraction of intervals over
`longIntervalMs` (25 ms), which is correct. The **value** reported beside it is
`missedTargetPct` — the percentage of intervals over `B = 1000/targetFPS` (16.67 ms).
Different quantities, presented as one.

Measured, 200 samples, eighty at 20 ms and the rest at 12 ms, none over 25 ms:

```
ACC-2 gate: {"pass":true,"value":40,"threshold":1}
```

A gate that displays `40` against a threshold of `1` and says `pass: true`. On the panel
this reads as a broken gate; the likelier outcome is that someone later "fixes" the pass
computation to match the number printed next to it, and ACC-2 silently becomes a 16.67 ms
test. Report `longFraction * 100` as the value (or the fraction against the fraction —
either, but one pair of units).

### 4.4 BLOCKING — ACC-3 counts PAUSED samples as unexplained spikes

`unexplainedSpikes` iterates `samples`, not the valid ones:

```js
if (sample.dtMs > T.spikeMs && !sample.tag) spikeOccurrences.push(i);
```

CONTRACT §2.2 draws the line the oracle's own header restates: *"Tags explain spikes;
validity excludes samples. They are different axes."* A hidden-tab frame is `valid:false`
and carries no tag, so it is counted as an unexplained spike.

Run against **FS-A2's own fixture** — 120 good frames plus eight 900 ms backgrounded
frames correctly marked `valid:false, invalidReason:'hidden'`:

```
clean ACC-3: {"pass":true, "value":0,"threshold":3}
dirty ACC-3: {"pass":false,"value":8,"threshold":3}
```

FS-A2 asserts p95, p99, the counts and ACC-1 across that pair and never looks at ACC-3,
which is the only reason the suite is green here. Any session that backgrounds the tab
three times reports "recurring unexplained >50 ms spikes" against a device that was fine —
and ACC-3 is the gate whose entire purpose is to be *unexplained*. Filter to
`sample.valid !== false` alongside the tag test.

### 4.5 BLOCKING — `unexplainedSpikes: 0` where there is no measurement

`let unexplainedSpikes = 0;` is only overwritten inside `if (sufficient)`. Below
`minSamples`, every sibling field renders the §3.1 sentinel and this one renders a zero:

```
10 samples, all 900 ms untagged spikes, targetFPS 60:
  p95               = {"value":null,"state":"unavailable","reason":"insufficient-samples"}
  gates ACC-3       = {"value":null,"state":"unavailable","reason":"insufficient-samples"}
  unexplainedSpikes = 0
```

Ten 900 ms frames is the worst run this repo could produce, and the top-level field says
zero spikes. CONTRACT §3.1 lists `0` first among the forbidden sentinel substitutes, for
the documented reason that a zero is indistinguishable from a measurement. `p95: 0` is the
example the contract gives; `unexplainedSpikes: 0` is the same shape. Return the sentinel.

Note for the record: **this is the only zero-for-absent-measurement in the wave.** Item 3's
grep is otherwise clean — `|| 0` and `?? 0` appear only as argument coercion in
`bloom-pass.js`'s pre-existing setters and as `observedMs ?? 0` in `evaluateOscillation`,
where a zero observed duration correctly *produces* the sentinel rather than replacing it.

### 4.6 BLOCKING — Benchmark's freeze leaks, and the sun never thaws

`setMode` thaws `BENCHMARK_FROZEN` only on the exact transition `benchmark -> auto`.
Every other exit leaves all four frozen, with no path back:

```
setMode('benchmark') -> {"seed":true,"route":true,"settings":true,"sun":true}
setMode('manual')    -> {"seed":true,"route":true,"settings":true,"sun":true}
setMode('auto')      -> {"seed":true,"route":true,"settings":true,"sun":true}
```

Once you leave Benchmark through Manual the sun is frozen for the rest of the session and
nothing in the module can release it — `oldMode === BENCHMARK` is false on the later
`manual -> auto` hop. The sun is the item this task was told twice not to get wrong: a
ten-minute cycle silently pinned means every subsequent capture in that session is taken
at one time of day and the person reading the contact sheet has no way to know. Thaw on
any exit from Benchmark, not on one transition.

### 4.7 BLOCKING — an unwired control reports `clamped: true, applied: true`

`request()` computes `clamped = value !== effectiveAfter`. With `apply` wired to nothing
at all — the exact failure G2b exists to detect:

```
request({source:'panel', key:'dpr', value:1.0})
-> {"requested":1,"effective":1.7,"clamped":true,"changed":false,"applied":true,"rejected":false}
```

Requested 1.0, effective 1.7, nothing happened, and the record says the request was
*applied* and merely *clamped*. CONTRACT §0 already has the word for `requested !==
effective`: **desync** — *"This programme exists because of one."* Naming a desync
"clamped" converts the wave's headline defect class into a routine bound, and `changed:
false` is the only honest field in the record with nothing pointing at it.

`clamped` should mean "the injected `clamp()` bounded the request" — i.e.
`clampedValue !== value` — and a separate `desync: effectiveAfter !== clampedValue` should
carry the other case. `applied: true` should not be unconditional.

### 4.8 MAJOR — the GPU timer reports `ok` after its context goes away

Item 6 otherwise passes, and passes well: the three unavailable reasons are distinct,
precedence-ordered and never collapse to `null`.

```
null context   -> {"state":"no-context",  "reason":"no-context"}
WebGL1         -> {"state":"not-webgl2",  "reason":"not-webgl2"}
WebGL2, no ext -> {"state":"no-extension","reason":"no-extension"}
```

But the cache invalidation is inverted. `probeCapability()` re-probes only when
`isContextLost()` is true, and `isContextLost()` opens with `if (!gl) return false` — so
"there is no context at all" is not lost:

```
probe ok            -> {"state":"ok","reason":null,"available":true}
getContext() -> null-> {"state":"ok","reason":null,"available":true}
```

A module commissioned specifically so that a wiring bug cannot wear a platform fact's
clothes reports `ok` for a context that is gone. `onContextLost()` covers the path where
the integration remembers to call it, which is not the same thing as the probe seeing
what is in front of it. Re-check `getContext()` before returning the cached probe.

Two smaller notes on the same module. `not-webgl2` is **not** in CONTRACT §3.1's closed
reason enum (`not-implemented, no-extension, no-context, disjoint, insufficient-samples,
paused, not-applicable, stale`); the P2.1c task prompt added it, so the module is right
and the contract row needs the added value under the §amendment rule before A11 scores
the export. And `beginFrame`/`endFrame`/`poll` each call `gl.getExtension(...)` per frame
instead of caching the object the probe already fetched.

### 4.9 MAJOR — `evaluateOscillation` counts outside its own reported window

`settled` filters `entry.tMs >= settleWindow` and is never bounded above, but the returned
`window` advertises `{ startMs: settleMs, endMs: settleMs + windowMs }`:

```
log entries at 6 s, 7 s, 80 s, 81 s, 82 s;  observedMs 100 000
-> {"pass":false,"reversals":4,"window":{"startMs":5000,"endMs":35000}}
```

Four reversals reported for a window that closes at 35 s, three of them counted from
entries at 80-82 s. Either bound the filter by `endMs`, or report the window that was
actually measured. As it stands the field describes something the number did not come
from — the same defect class as §4.3.

### 4.10 MAJOR — per-frame object allocation in the one module that measures the frame

`createIntervalRecorder().sample()` runs once per frame and allocates a fresh record
literal (plus a second literal on a hitch) into a fixed-capacity ring:

```
heap delta over 60 000 sample() calls (~16 min of play): 610 KB
```

House rule 4 is *"reuse objects with `_` prefix, never allocate in update()"*. The ring is
already `new Array(capacity)` with fixed capacity, so the fix is to fill it with record
objects once in the factory and mutate the fields in `sample()`. `__buffers()` returning
*live* buffers — which the oracle requires — is easier to satisfy afterwards, not harder.

### 4.11 MAJOR — the acceptance evaluation is O(n^2) and costs a frame budget

`nearestRankPercentile` sorts, then for each sorted value rescans the whole array:

```
evaluateAcceptanceGates over 512 samples:  1.94 ms per call   (Linux x86, node 22)
frame-metrics.percentile x3 over the same: 0.08 ms per call
```

At PRO-14's ~4 Hz panel cadence that is ~8 ms/s of pure waste on a desktop and plausibly
5-15 ms *per call* on the target phone — inside the panel whose own contract (§3.4) says
*"instrumentation that manufactures the bottleneck invalidates every measurement taken
with the panel open."* Fixed for free by §4.1's shared helper, which is `sort` + one index.

### 4.12 MAJOR — one provisional number declared twice, in two modules

`HITCH_THRESHOLD_MS = 50` in `frame-metrics.js` and `spikeMs: 50` in `frame-stats.js` are
the same PRO-12 number with no link between them. CONTRACT §10 rule 2: *"Every provisional
value is read from ONE named constant object."* Wave 4 will change one and not the other,
and nothing will say so. Have `frame-stats` derive `spikeMs` from the exported
`HITCH_THRESHOLD_MS`.

### 4.13 MINOR — thresholds are named and cited, but not yet in one place

Item 5 is **substantially met**: `grep` for `16.6|18.5|55|58|1500|2000|4000` across the
four modules matches only `p95MaxMs: 18.5` inside `ACCEPTANCE_THRESHOLDS`, annotated
`// PRO-10`, with a parallel `ACCEPTANCE_PROVENANCE` marking every entry `unmeasured`.
Budgets are `1000 / targetFPS` throughout; there is no hardcoded 16.67 anywhere.

The residual is structural, not a fabrication: CONTRACT §10 rule 2 puts the one constants
object in `src/game/adaptive-quality.js`, which is Wave 3 and does not exist, while the
frozen oracle pins `export const ACCEPTANCE_THRESHOLDS` on `frame-stats.js`. Correct call
by the agent. **Wave 3 must make `adaptive-quality.js` re-export these rather than restate
them**, or the register splits in two.

Also unregistered: `spikeRecurrenceCount: 3`, `minSamples: 100`, `OSCILLATION_DEFAULTS`
(5 000 / 30 000 / 3) and `GPU_QUERY_TIMEOUT_FRAMES: 120` are new provisional numbers with
no CONTRACT §10 row. §10's amendment rule permits adding rows; nobody did.

### 4.14 MINOR — two sufficiency rules over the same data

`frame-stats` refuses to compute below `minSamples: 100`. `frame-metrics.stats()` has no
floor at all and will hand the controller a p95 built from three intervals. The controller
would then fire on a number the acceptance gate would refuse to score. Wave 3 should
settle on one floor.

### 4.15 MINOR — `setDownscale` before the first `setSize`

`bloom-pass.js` initialises `lastWidth/lastHeight/lastRatio` to `1`, so a `setDownscale(n)`
issued before any `setSize` re-derives every target to 1x1 and leaves them there until the
next resize. `index.html` sizes on init so this is not reachable today; a panel control
that fires early would reach it. Guard on "no size cached yet".

---

## 5. What passed, stated plainly

- **Item 1** oracle manifest, exit 0, 56 files. **Item 2** 460/378/0/82, exit 0.
- **Item 3** sentinels: one violation (§4.5), everything else clean. No `|| 0` or `?? 0`
  substituting for a measurement anywhere in the four modules.
- **Item 4** paused-as-validity: `frame-metrics` marks, excludes from percentiles and
  retains in `exportIntervals()` with `valid` and `invalidReason` intact; `reset()` refuses
  the tag `'paused'` and refuses an untagged reset; a paused stall is not logged as a
  gameplay hitch; `quality-settings.setPaused()` deliberately emits no reset. The one
  place validity is ignored is ACC-3 (§4.4).
- **Item 6** three distinct, precedence-ordered unavailable reasons; nothing collapses to
  `null`. Weakened only by the stale-cache path in §4.8.
- **Item 8** no `new` on any per-frame path — every `new` is factory-time or a throw. The
  allocation in §4.10 is an object literal, not a `new`, and is flagged under house rule 4
  rather than under this item.
- **P2.2a (bloom split)** is the clean piece of this wave. `getSizes()` shape and the
  `onRenderPass` tally are untouched, `downscale` is reported from the new mutable state so
  A4 still holds, the 5/8 pass structure is unchanged, and both browser harnesses exit 0.
- All four new modules import nothing and take side effects as injected callbacks, so
  `npm test` remains an oracle for them.

## 6. Carry-forward, not charged against this gate

`src/game/frame-stats.js`, `gpu-timer.js` and `quality-settings.js` are absent from
`sw.js`'s `CORE_ASSETS` and `CACHE_VERSION` is unbumped. CONTRACT §8.4 assigns that to
P2.4, which runs after this gate, and nothing is committed yet, so the *"same commit as
the module"* rule is still satisfiable — but only if P2.4 lands before the modules do.
SW-3's test is what makes forgetting loud; it does not exist yet either.

---

## 7. Verdict

**STOP.** Seven blocking findings, six of which are the module reporting a number where
the contract requires a different number or a sentinel — which is the precise failure mode
this gate was interposed to catch, and none of which a green suite would have shown. The
suite is not green either.

Fixes §4.1 and §4.11 are the same edit. §4.3, §4.4 and §4.5 are one clause each. §4.6 and
§4.7 are small and local. §4.2 is a whole task that has to be re-run.

Nothing here needs an oracle changed. The one place the oracles contradict each other
(§4.1) has a reconciliation that satisfies both frozen suites as written.
