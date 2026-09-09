VERDICT: STOP — nine of the eleven measured defects are genuinely closed and the CI is fixed, but `BIRB_PERF_IMPL=1 npm test` is RED on TWO frozen oracles (QS-A6, QS-A7) that were GREEN at G2c: the remediation implemented G2a §4.7's prose recommendation in preference to the frozen suite's own definition of `clamped`, which is the one thing R5 forbids

# G2d — Wave 2 remediation gate

Every number below was produced by running the code on this working tree. Nothing is
taken from a remediation agent's self-report; where a gate finding is re-checked I re-ran
**that gate's own fixture** and printed the old number beside the new one.

**R6 applies to this whole document.** Every frame rate that appears is SwiftShader and
none of it is a device claim. Draw calls, triangles, dimensions, heap bytes and exit codes
are the evidence that stands.

Working tree at gate time — **nothing committed**, `HEAD = a5fd190`:

```
 M .github/workflows/browser-health.yml   M .github/workflows/tests.yml
 M index.html                             M sw.js
 M src/effects/bloom-pass.js              M src/environment/collectibles.js
 M src/environment/spherical-world.js     M src/environment/weather.js
 M src/environment/world-shell.js         M src/game/frame-metrics.js
 M src/game/frame-stats.js                M src/game/gpu-timer.js
 M src/game/quality-settings.js
?? src/environment/seeded-random.js  ?? tests/seeded-random.test.js
?? tools/lib/quality-captures.mjs
```

---

## 1. The oracle run, every exit code

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm test` (`BIRB_PERF_IMPL` **unset**) | **0** | `# tests 485 / pass 399 / fail 0 / skipped 86` |
| 2 | `BIRB_PERF_IMPL=1 npm test` | **1** | `# tests 485 / pass 481 / fail 2 / skipped 2` — **QS-A6, QS-A7** |
| 3 | `node tools/birb-modes.mjs` | **0** | `all 5 modes ok in forest`, 18/18 rings, 3 lives, nesting reached, turret launched 1/3 |
| 4 | `node tools/birb-shaders.mjs` | **0** | `all shaders compile in 4 environments` |
| 5 | `node tools/birb-shot.mjs --start` | **0** | 64-71 calls, 75.3-77.1k tris, `[quality: tier 1 (adaptive)]` |
| 6 | `node tools/birb-shot.mjs --start --nest` | **0** | `nesting: "nested"`, `[quality: tier 2 (adaptive)]` |
| 7 | `node tools/birb-quality.mjs --selftest` | **1** | `25 catalogued, 25 applicable, 23 detected`; same 2 failures as G2c |
| 8 | `node tools/birb-quality.mjs --check all` | **1** | 5 pass (A4 A6 A7 A8 A9), 7 fail (A1 A2 A3 A5 A10 A11 A12) — unchanged |
| 9 | `node tools/birb-quality.mjs --check resize-restore` | **0** | A6 `pass`, four steps coherent, `matchesExpectedRed: false` |
| 10 | sibling suites (16 files, named per R1) | **0** | `# tests 216 / pass 214 / fail 0 / skipped 2` |
| 11 | `sha256sum -c tools/oracle-manifest.txt` | **1** | 53 of 56 OK; **only** the three pre-authorised files — see §6 |

### 1.1 The `npm test` invariant moved again, legitimately

The brief pins **464 / 378 / 0 / 86** (G2b §5.10, G2c §1.1). Measured: **485 / 399 / 0 / 86**,
exit 0. The delta is exactly `tests/seeded-random.test.js` — 21 tests, all of which run and
pass with the env unset, because `src/environment/seeded-random.js` imports nothing and
touches neither THREE nor the DOM. **Pass/fail/exit is what I confirm: fail 0, exit 0**, and
the four siblings are untouched (§5). Restate the invariant for Wave 3 as
**485 / 399 / 0 / 86**.

### 1.2 BLOCKING — the two failures, quoted, and why they are the verdict

```
not ok 395 - QS-A6 a clamped request reports requested AND effective, and effective is read back
  location: 'tests/quality-settings.test.js:348:1'
  error: Expected values to be strictly equal:  false !== true
  stack: tests/quality-settings.test.js:364        <- assert.equal(record.clamped, true)

not ok 396 - QS-A7 a request that moves nothing reports changed:false
  location: 'tests/quality-settings.test.js:393:1'
  error: and the gap between the two is reported as a clamp   false !== true
  stack: tests/quality-settings.test.js:408        <- assert.equal(second.clamped, true)
```

**These two were GREEN at G2c.** G2c §1 measured `464 / 461 / 1 / 2` with *one* failure,
FS-A1b. FS-A1b is now fixed (§2, item 1) and two assertions that were passing are now
failing. This is a regression the remediation manufactured, not an inherited defect.

The cause, from the diff (`git diff HEAD -- src/game/quality-settings.js`):

```diff
-      // Clamped is true if the effective value differs from the requested value.
-      const clamped = value !== effectiveAfter;
+      // Clamped: the injected clamp function bounded the request.
+      const clamped = clampedValue !== value;
+      const desync = effectiveAfter !== clampedValue;
+      const applied = !desync;
-        applied: true,
+        applied,
```

That is G2a §4.7's recommendation implemented verbatim. **G2a §4.7 was wrong against the
frozen oracle and nobody checked.** `tests/quality-settings.test.js` is a manifest row.
QS-A6 injects `quantise` — which `makeRig` applies **inside `deps.apply`**, standing in for
"DPR rounding, texture-size rounding, a driver refusing a dimension" — and passes **no
`clamp` dep at all**, then asserts `clamped === true`. QS-A7 wires the live object to ignore
everything and asserts, in its own words, *"and the gap between the two is reported as a
clamp"*. The frozen suite's `clamped` means **`effective !== requested`**, full stop. The
new implementation means "the injected clamp function fired", which in both suites is never.

**The rule in my brief and in R5 is explicit: if a frozen oracle looks wrong, say so in
'deviations' and satisfy it anyway.** The remediation did the opposite — it satisfied a
gate's prose and broke the oracle. I am not authorising an edit to `quality-settings.test.js`.

**A reconciliation exists that satisfies BOTH the frozen suite and my item 6 requirement**,
and I verified each clause against the three fixtures by hand:

```
clamped = (effectiveAfter !== requested)      // the oracle's meaning; QS-A6 ✓  QS-A7 ✓
desync  = (clampedValue !== effectiveAfter)   // keep it, as a SEPARATE field — G2a §4.7's
                                              //   real point, and CONTRACT §0's word
applied = changed || (effectiveAfter === requested)
```

- QS-A6: readEffective before = `null`, after = `1.7`, requested `1.73`.
  `clamped` true ✓, `changed` true ✓, `applied` true ✓.
- QS-A7 second request: before `1.0`, after `1.0`, requested `2.0`.
  `clamped` true ✓, `changed` false ✓ (`applied` unasserted).
- G2a §4.7's unwired probe: requested `1.0`, effective `1.7`, `changed` false,
  `effectiveAfter !== requested` ⇒ **`applied: false`** — item 6's requirement met, without
  redefining the field the oracle owns.

That is one edit and it is the only thing standing between this tree and a green suite.

---

## 2. The blocking list, re-measured item by item

Each row re-runs the fixture the ORIGINAL gate ran, and prints that gate's number beside it.

### Item 1 — one percentile implementation — **CLOSED**

```
$ grep -rn "nearestRankPercentile" src/
src/game/frame-stats.js:16: * module used to carry its own private `nearestRankPercentile`;   <- a COMMENT
$ grep -n "^import" src/game/frame-stats.js
20:import { percentile as sharedPercentile, HITCH_THRESHOLD_MS } from './frame-metrics.js';

percentile(1..100, 1)    = 100     <- 1 is a FRACTION, not 1%. Held.
percentile(1..100, 0.95) = 95      percentile(1..100, 95) = 95
percentile(1..100, 0.5)  = 50      percentile(1..100, 100) = 100

FS-A1b: ok 112 — "the acceptance gate and the controller share one percentile implementation"
```

No private helper survives, `frame-stats` imports the shared one, and the `p > 1 ⇒ p/100`
reconciliation G2a wrote out satisfies both frozen suites as predicted. §4.11's O(n²)
acceptance evaluation goes with it (sort + one index now), and §4.12 is closed in the same
file: `spikeMs: HITCH_THRESHOLD_MS`, no longer a second literal 50.

### Item 2 — ACC-2 units — **CLOSED**

G2a §4.3's own fixture: 200 samples, eighty at 20 ms, the rest at 12 ms, none over 25 ms.

```
G2a measured : {"pass":true,"value":40,"threshold":1}
NOW          : {"pass":true,"value":0, "threshold":1}
missedTargetPct (the other quantity, reported separately) : 40
thresholds: longIntervalMs 25, longIntervalMaxFraction 0.01   count >25ms: 0
```

The value is `longFraction * 100` scored against `longIntervalMaxFraction * 100`. One pair of
units. The 16.67 ms quantity is still exported, under its own name, where it cannot be
mistaken for the gate's.

### Item 3 — ACC-3 validity — **CLOSED, and for the right reason**

FS-A2's own fixture: 120 good frames plus eight at 900 ms marked `valid:false,
invalidReason:'hidden'`.

```
G2a measured  clean {"pass":true,"value":0,"threshold":3}   dirty {"pass":false,"value":8,"threshold":3}
NOW           clean {"pass":true,"value":0,"threshold":3}   dirty {"pass":true, "value":0,"threshold":3}
              clean and dirty AGREE: true
```

And the control that matters — the filter must exclude invalid samples, not all spikes:

```
CONTROL 120 good + 8 UNTAGGED 900ms frames left VALID:
              {"pass":false,"value":8,"threshold":3}
```

A backgrounded tab no longer reads as a recurring unexplained spike; a real one still does.

### Item 4 — `unexplainedSpikes` sentinel — **CLOSED**

Ten samples, all 900 ms, untagged, targetFPS 60:

```
p95               {"value":null,"state":"unavailable","reason":"insufficient-samples"}
gates ACC-3       {"value":null,"state":"unavailable","reason":"insufficient-samples"}
unexplainedSpikes {"value":null,"state":"unavailable","reason":"insufficient-samples"}   <- was 0
missedTargetPct   {"value":null,"state":"unavailable","reason":"insufficient-samples"}
```

CONTRACT §3.1's first-named forbidden substitute is gone from the one place it survived.

### Item 5 — Benchmark thaw — **CLOSED**

```
G2a: setMode('benchmark') -> {"seed":true,"route":true,"settings":true,"sun":true}
     setMode('manual')    -> {"seed":true,"route":true,"settings":true,"sun":true}
     setMode('auto')      -> {"seed":true,"route":true,"settings":true,"sun":true}

NOW: setMode('benchmark') -> {"seed":true, "route":true, "settings":true, "sun":true}
     setMode('manual')    -> {"seed":false,"route":false,"settings":false,"sun":false}
     setMode('auto')      -> {"seed":false,"route":false,"settings":false,"sun":false}
     anything still frozen? false
     benchmark -> auto (direct) -> {"seed":false,"route":false,"settings":false,"sun":false}
```

The sun thaws on any exit from Benchmark. QS-A4 (which asserts the frozen SET contains
'sun') is green.

### Item 6 — clamped / applied — **the narrow requirement is met; it broke two oracles**

```
apply wired to nothing, readEffective stuck at 1.7, request dpr 1.0:
G2a: {"requested":1,"effective":1.7,"clamped":true, "changed":false,"applied":true, "rejected":false}
NOW: {"requested":1,"effective":1.7,"clamped":false,"desync":true,"changed":false,"applied":false,"rejected":false}
```

`applied: true` is gone — my item 6 bar ("the record must not claim `applied:true`") is met,
and `desync` now exists as CONTRACT §0's own word. **But `clamped` was redefined to do it,
and `clamped` belongs to the frozen suite.** See §1.2. This is the STOP.

### Item 7 — GPU timer with a null context — **CLOSED**

```
probe with live WebGL2 + ext  {"state":"ok","reason":null,"available":true}
then getContext() -> null     G2a: {"state":"ok","reason":null,"available":true}
                              NOW: {"state":"no-context","reason":"no-context","available":false}
null from the start           {"state":"no-context","reason":"no-context","available":false}
WebGL1                        {"state":"not-webgl2","reason":"not-webgl2","available":false}
WebGL2, no extension          {"state":"no-extension","reason":"no-extension","available":false}
```

`probeCapability()` invalidates the cache on `!gl` as well as on `isContextLost()`, and the
three distinct reasons are still precedence-ordered and never collapse to `null`.

### Item 8 — `evaluateOscillation` outside its window — **CLOSED**

G2a §4.9's fixture: entries at 6 s, 7 s, 80 s, 81 s, 82 s, `observedMs 100000`.

```
G2a: {"pass":false,"reversals":4,"window":{"startMs":5000,"endMs":35000}}
NOW: {"pass":true, "reversals":1,"window":{"startMs":5000,"endMs":35000}}
```

Only the 6 s/7 s pair is inside 5 000-35 000, and one reversal is what it reports. The
control proves the bound did not simply disable counting:

```
CONTROL entries at 6/7/8/9/10 s, all inside the window:
     {"pass":false,"reversals":4,"window":{"startMs":5000,"endMs":35000}}
```

### Item 9 — per-frame allocation — **CLOSED**

`createIntervalRecorder().sample()`, 60 000 calls, node 22, `--expose-gc`, warmed and
GC-settled before the `before` reading, exactly as G2c ran it:

```
G2c measured delta : 0.915 MB   (~55 KB/s of garbage at 60 fps)
NOW                : 0.125 MB
hitch path (every call a hitch) : 0.011 MB / 60 000 calls
```

**And the measurement's own noise floor, which G2c did not establish:** a provably
non-allocating loop of the same shape and length reads **0.487 MB** on this box. The
residual 0.125 MB is under the floor — it is the harness, not the recorder. Confirmed at
source: the ring is pre-filled with record objects in the factory and `sample()` mutates the
slot in place (`const record = intervals[intervalWritePos]; record.dtMs = dtMs; ...`), with
the hitch ring done the same way. House rule 4 holds.

### Item 10 — the seeded world — **CLOSED, verified by me, not accepted on report**

```
$ grep -rn "Math\.random" src/environment/       (LIVE code, not comments)
src/environment/seeded-random.js:178:  if (_worldSeed === null) return Math.random;
src/environment/world-shell.js:36:    let _activeRng = Math.random;
src/environment/spherical-world.js:30: let _activeRng = Math.random;
```

**Zero call sites**, down from the 76 G0/G2a/G2c counted. The three survivors are the
unseeded fallback *references* — `worldRng()` returns `Math.random` itself when no seed is
set, which is what makes an unseeded world byte-for-byte as nondeterministic as it always was.

I built worlds in a real browser against real THREE and hashed **real geometry**: every
object's position/quaternion/scale, every `InstancedMesh`'s full `instanceMatrix` array, and
every geometry's `position` attribute, FNV-1a over float32 (≈47 000-61 000 floats per build).
Four biomes, two builds per seed, two seeds, plus an unseeded control:

```
variant   | seed 1234 reproduces | seeds 1234/9999 differ | unseeded still random | hashes
forest    | true                 | true                   | true                  | 5b3e0b84 5b3e0b84 | 0ef20010 0ef20010 | unseeded 492ba6c5 vs 110b76c6
canyons   | true                 | true                   | true                  | 72adaa2d 72adaa2d | 37e797c7 37e797c7 | unseeded 04be8d65 vs 482acb92
mountain  | true                 | true                   | true                  | 0199dbb7 0199dbb7 | 0649ff52 0649ff52 | unseeded f515c4d6 vs b12daaa6
city      | true                 | true                   | true                  | dfc0daeb dfc0daeb | a22a637b a22a637b | unseeded 3451200b vs 97533bdf
zero page errors, zero console errors across all 24 builds
```

The third column is the check the brief demanded and the one that catches "the randomness
was merely disabled": with `setWorldSeed(null)` two consecutive builds of the same biome
still differ, in every biome. The diff confirms why — the environment changes are mechanical
(`Math.random()` → `rng()`, plus threading an `id` into `createWeather` and
`generateRingPositions` for a named stream); no placement formula moved.

**Open, and recorded rather than charged against item 10 as written:** the *product* has no
route to the seed. `__BIRB.worldSeed(1234)` on a live page still returns
`{"value":null,"state":"unavailable","reason":"not-implemented"}` and `getWorldSeed()` reads
`null` afterwards. The sentinel is honest, but its justification comment in `index.html`
(~10 176) still asserts as present fact: *"`src/environment/` still has 76 raw
`Math.random()` call sites and no `seeded-random.js` exists on disk"*. **Both clauses are now
false**, and this is the same defect class G2c §3.5 blocked on — a comment stating the
opposite of what the tree does — relocated from CI into the shipped page. Benchmark mode
still calls `freeze('seed', true)` on a seed nothing in the product can set. Wiring the hook
is `setWorldSeed(n)` plus a rebuild; correcting the comment is free.

### Item 11 — the CI — **CLOSED. This was the shipping decider and it is fixed.**

Both files parse structurally with `yaml.safe_load` (`humanoid.yml` too, untouched):

```
browser-health.yml  job "health"  timeout-minutes 24  13 steps
 1 checkout | 2 setup-node | 3 Install browser harness | 4 Restore the tracked Three stub
 5 Install Chromium
 6 Game starts and is actually playable ............ birb-shot --start          coe=None
 7 A nest can be landed on ......................... birb-shot --start --nest   coe=None
 8 Every game mode enters, reports sane state ....... birb-modes.mjs             coe=None
 9 Every shader compiles, in every environment ...... birb-shaders.mjs           coe=None
10 Quality harness initializes; two capturers are
   still missing (Wave 2R) ......................... --selftest                 coe=True
11 Resize-restore bug is fixed and must stay fixed .. --check resize-restore     coe=None
12 Implemented quality assertions pass; the rest
   await capturers (Wave 2R) ....................... --check all                coe=True
13 Upload frames on failure (if: failure())
```

Read as step order: **the four game-health checks are 6-9, ahead of every birb-quality step.
A failing birb-quality step cannot prevent `birb-shot`, `birb-modes` or `birb-shaders` from
running, because they have already run.** `birb-modes` — the warnings-are-failures check
that exists because this repo shipped a world with its nesting and collectibles systems
never created — is reachable on every push again. G2c §3.4 is closed, twice over: by
ordering *and* by guarding the two steps that exit 1 today.

`continue-on-error` audit — three occurrences repo-wide, each commented, each naming the
wave that removes it:

| File | Step | Comment names |
|---|---|---|
| browser-health.yml | `--selftest` | "…until the task that ships each capturer lands alongside it — **Wave 2R** — at which point remove this" |
| browser-health.yml | `--check all` | "continue-on-error until **Wave 2R** ships the remaining capturers; remove it then" |
| tests.yml | `BIRB_PERF_IMPL=1 npm test` | "remaining failures are in-flight elsewhere in this same wave (**Wave 2R**)… Once the full BIRB_PERF_IMPL suite is green, remove continue-on-error" |

Step names against the tree — no step states the opposite of what happens:

- step 11 "Resize-restore bug is fixed and must stay fixed", ungated. I ran it: **exit 0**,
  A6 `pass`, four steps coherent, `restoredCoherent: true`. G2c §3.5's inverted name is gone
  and the comment now says explicitly that a future exit 1 is a regression of the fix, not
  the documented bug returning.
- step 10's name claims exactly two missing capturers. Measured: `23 detected` of 25, the two
  failures being `M-A1-gesture-behind-debug` and `M-A2-panel-opens-on-any-touch`. True.
- step 12's name claims the implemented assertions pass and the rest await capturers.
  Measured: A4 A6 A7 A8 A9 pass, A1 A2 A3 A5 A10 A11 A12 report "no live capturer". True.

The timeout comment's per-step figures were re-derived on this tree rather than reasserted,
and it now cites G2c §3.3's differing numbers alongside its own instead of overwriting them.
G2c §3.3's finding (a justification comment quoting times nobody timed) is closed.

### Item 12 — the capturers — **NOT CLOSED in CI, and the reason is a frozen file**

```
$ node tools/birb-quality.mjs --check all   -> exit 1
   A4 A6 A7 A8 A9 pass
   A1 A2 A3 A5 A10 A11 A12 fail:
     "<id> reports available (<file> on disk) but this harness has no live capturer for it."
$ node tools/birb-quality.mjs --selftest    -> exit 1
   25 catalogued, 25 applicable, 23 detected
   FAIL M-A1-gesture-behind-debug      -> applicable, no live verifier
   FAIL M-A2-panel-opens-on-any-touch  -> applicable, no live verifier
```

Byte-identical to G2b §5.2 and G2c §8. **The seven previously-ungraded assertions still do
not report a real verdict through the harness.**

But the work is not absent, and this matters for what the next pass has to do.
`tools/lib/quality-captures.mjs` (530 lines, untracked, not a manifest row) exports
`captureA1/A2/A3/A5/A10/A11/A12` and a `LIVE_CAPTURES` object in exactly the shape
`tools/birb-quality.mjs` consumes. **I drove all seven myself** against a page booted with
CONTRACT §5.1's pinned context, feeding each snapshot to the frozen assertion in
`tools/lib/quality-assertions.mjs`:

```
capturers exported: A1,A2,A3,A5,A10,A11,A12
A3 state=pass   A5 state=pass   A10 state=pass   A11 state=pass
A12 state=pass  A1 state=pass   A2 state=pass
errors during capture: none
```

**R8 — one capturer watched flipping.** `index.html`'s `panelOverrides.dpr` read (line ~7029)
neutered to `false ? panelOverrides.dpr : …` by Playwright route interception, so nothing on
disk moved — the M-A3 "the slider is a label" mutation:

```
CLEAN   : state=pass  effective 1.7 -> 1.3  requested 1.3  drawingBufferWidth 507
FLIPPED : state=fail  effective 1.7 -> 1.7  requested 1.3  drawingBufferWidth 663
```

The capturer is real; it is simply not connected. Connecting it is one line **inside
`tools/birb-quality.mjs`, a manifest row**, and the remediation agent correctly refused to
make it and said so instead — the required behaviour under R5. G2c's decision (§8) assumed
"the harness already knows how to reach it"; it does not, and that premise was wrong.

**GATE DECISION, taken here.** The manifest's own header permits a listed file to be edited
under a gate decision recorded in `docs/perf/gates/`, with the manifest regenerated in the
same commit. **I authorise exactly one edit to `tools/birb-quality.mjs`:** spread
`tools/lib/quality-captures.mjs`'s `LIVE_CAPTURES` into the harness's own object alongside
the existing five, and add the two `--selftest` verifiers those capturers make possible.
No assertion, threshold, exit-code path or `ASSERTIONS` entry may change. Re-freeze
`tools/birb-quality.mjs` in the same commit and report the new hash. Nothing else in
`tests/**` or `tools/lib/quality-assertions.mjs` is authorised.

---

## 3. Shipping checks

### 3.1 `npm test`, env unset, and the siblings — PASS

```
$ npm test                                       exit 0   485 / 399 / 0 / 86
$ node --test <16 sibling files, named per R1>   exit 0   216 / 214 / 0 / 2
      gauntlet-{damage,flight,modes,nesting,qr,race-logic}
      icon3d-{catalogue,lift,mesh,ribbon,svg,sweep}
      sculpture-{figure-details,orbit,phase5,surface-nets}
$ git status --porcelain humanoid/ gauntlet/ sculpture/ icon3d/     (empty)
```

All five new/changed `src/game/` and `src/environment/` modules import nothing outside
`src/` and take side effects as injected callbacks, so R4's static-import hazard — the one
that turns `tests.yml` red for all four siblings — was not reintroduced. `node_modules/three`
is still the tracked stub.

### 3.2 The browser harnesses — PASS

```
node tools/birb-modes.mjs      exit 0   all 5 modes ok in forest, 18/18 rings, 3 lives,
                                        nesting reached, turret launched 1/3
                                        zero console warnings in the log (warnings are failures for this tool)
node tools/birb-shaders.mjs    exit 0   forest / canyons / mountain / city all ok
node tools/birb-shot.mjs --start          exit 0
node tools/birb-shot.mjs --start --nest   exit 0   nesting: "nested"
```

Four `--start` runs measured **64, 66, 68, 71 draw calls and 75 330-77 098 triangles**. G2c
recorded 63-64/75 214 for a single run; the spread is the free-running pose/frustum variance
G2b §1.1 documented (±2-4 scene calls at a *fixed* pose), and every reading is inside the
repo's stated 62-71 calls / 76-77k tris and well inside the <100 / <80k budget. The capture
label varied across runs (`tier 1`, `tier 2`), so it is still derived and not a constant.

### 3.3 The oracle manifest — PASS

```
$ sha256sum -c tools/oracle-manifest.txt ; echo $?
tools/birb-shot.mjs: FAILED
tools/birb-sheet.mjs: FAILED
tools/birb-lighting.mjs: FAILED
1
```

**Only** the three files under P2.4a's recorded orchestrator exemption, and their current
hashes are **byte-identical to the three replacement rows G2c §7 recorded and authorised** —
they have not moved since:

```
a8c11a1e313c1e33ae5329ed87245b4994a0759e3d2c63c3bc68ffc9f2ca8f41  tools/birb-shot.mjs
e4b61079ee3feb11062eb889bcc8bbfae3fa23dc1ba456acb2c900c6fbd43887  tools/birb-sheet.mjs
ef02bf80a755f505703284905ab97aa88681cee6b6b667cfb2f635fea7409db7  tools/birb-lighting.mjs
```

`git status --porcelain tests/ tools/ docs/perf/CONTRACT.md` shows two **untracked** additions
and nothing modified:

```
?? tests/seeded-random.test.js        <- a new file, not a manifest row
?? tools/lib/quality-captures.mjs     <- a new file, not a manifest row
```

No `tests/**` row, no `tools/lib/quality-assertions.mjs`, no `tools/birb-quality.mjs`, no
`tools/birb-modes.mjs`, no `tools/birb-shaders.mjs`, no `CONTRACT.md`. **R5 held at the level
of the filesystem.** It did not hold in substance for `quality-settings.js` (§1.2): the
implementation was changed to contradict a frozen assertion instead of satisfying it.

### 3.4 CONTRACT §11 compatibility ladder — PASS

Re-derived against `9888147` (Wave 1, before any of this), not cited from G2c:

| Constant | Wave 1 | This tree |
|---|---|---|
| `LOW_FPS_THRESHOLD` | 55 | **55** |
| `RESTORE_FPS_THRESHOLD` | 58 | **58** |
| `LOW_WINDOW_MS` | 2000 | **2000** |
| `HIGH_WINDOW_MS` | 4000 | **4000** |
| `MIN_INTERVAL_MS` | 1500 | **1500** |
| `DPR_CAP` | `isMobile ? 1.7 : 1.8` | **identical** |
| `getQualityPixelRatio` | — | `git diff 9888147 -- src/environment/visual-style.js` is **EMPTY** |

The tier→DPR table (`tier >= 2 ? 0.85 : tier === 1 ? 1 : cap`) is unchanged, and SC-DPR was
alive on every harness boot in this gate (`tier0=1.7 tier1=1` at `deviceScaleFactor: 3`), so
the discriminator was not dead for any reading above.

**The remediation's entire `index.html` diff is +6 lines** and it is a read-only telemetry
addition — `sprintActive: !!(sprintState && sprintState.active)` inside `stats()`, closing
GAP-A2's missing reader. No gameplay path, no adaptive path, no render path. The
environment diffs are mechanical RNG threading (§2 item 10). **The workbench did not alter
the thing it exists to measure**, and the unseeded world is provably as nondeterministic as
it was.

`sw.js`: `CACHE_VERSION` and `BIRB_BUILD` both read `v43-2026-09-09-perf-workbench`, and
`./src/environment/seeded-random.js` is in `CORE_ASSETS` alongside the five Wave 2 modules —
CONTRACT §8.3/8.4's "same commit as the module" rule is satisfied for the one module this
wave added.

---

## 4. Carry-forward, not charged against this gate

- **G2c §8.1** — `currentPauseReason()` still produces only four of the seven
  `INVALID_REASONS`; `contextLost`, `frozen` and `panelHold` remain unreachable, and
  `__BIRB.freeze(true)` — the pose-pinning method CONTRACT §4.2 mandates for every A/B —
  still produces no reason at all. Not on this gate's blocking list; Wave 3's controller will
  consume it.
- **`docs/perf/EXPECTED-RED.md` was not revised.** G2c §7.1 authorised the revision and said
  it belonged in the remediation commit alongside the CI naming fix. The CI naming fix landed;
  the file did not, so `--check resize-restore` still prints
  *"EXPECTED-RED.md must be revised by a gate decision, not by the harness."* The
  authorisation from G2c stands and needs no re-argument.
- **CONTRACT §3.1's reason enum still lacks `not-webgl2`**, and **§9 DEF-3** still says the
  30 fps row must be *absent*, not present-and-disabled. Both are one-line contract
  amendments G2a/G2b/G2c raised and nobody has written. Neither is a defect in the code.
- **G2b §5.6** — A11 is still graded against a `sentinelFields` list the implementation
  supplies. **§5.7** — "Reset overrides" still sets bloom strength to 0.85 against a live 0.78.
  **§5.8** — the panel still reads "Active mode: auto" while overrides are in force.

---

## 5. What passed, stated plainly

- **Nine of the eleven measured module defects are genuinely closed**, each re-measured on
  its originating gate's own fixture, and five of them with a control that proves the fix did
  not simply disable the check (items 3, 8 especially).
- **The CI is fixed and it is the thing that decides shipping.** `birb-shot`, `birb-modes`
  and `birb-shaders` run first and unconditionally; the two red quality steps are behind them
  and guarded with comments naming Wave 2R; every step name describes what the tree does.
- **The seeded world is real**, verified by this gate against real geometry in four biomes,
  with the unseeded control that distinguishes determinism from disabled randomness.
- **Zero live `Math.random()` call sites in `src/environment/`**, down from 76.
- **The seven capturers exist, run, return real verdicts, and one was watched flipping.**
- **`npm test` env-unset is exit 0 with fail 0**, and the four siblings are untouched.
- **No adaptive threshold, DPR value or tier semantic moved**, and the only `index.html`
  change is six read-only lines.
- **The manifest fails on exactly the three pre-authorised files, at exactly the hashes G2c
  recorded.**

---

## 6. Verdict

**STOP.**

This is close, and most of it is good. The remediation closed nine measured defects with
real fixes rather than with weakened checks, fixed the CI failure that was the last gate's
shipping blocker, and shipped a seeded world I verified myself rather than took on report.

It stops on one thing, and it is the thing the wave was told was its deliverable:

**`BIRB_PERF_IMPL=1 npm test` is RED, and it is red on two frozen oracles that were GREEN at
G2c.** QS-A6 and QS-A7 are the assertions that grade whether a control is wired to rendering
work or to a label — QS-A7's own header says *"This is the exact failure G2b exists to stop
… and it is how a whole wave of quality controls can ship green."* They were passing. The
remediation broke them by implementing G2a §4.7's prose recommendation over the frozen
suite's definition of `clamped`, which is precisely what R5 forbids and what two agents last
wave were commended for refusing to do. A programme whose first principle is that the
measuring instrument must not be adjusted to fit the measurement cannot ship with its own
control-wiring oracle red.

The fix is small and §1.2 writes it out, verified clause by clause against all three
fixtures: restore `clamped = effectiveAfter !== requested`, keep `desync` as the separate
field it should always have been, and derive `applied` from `changed || effectiveAfter ===
requested` so the unwired case still reports `applied: false`. That satisfies QS-A6, QS-A7
and this gate's item 6 simultaneously, and needs no oracle edited.

Two smaller things should land in the same pass:

1. **Item 12.** Wire `tools/lib/quality-captures.mjs` into `tools/birb-quality.mjs` under the
   gate decision recorded in §2 item 12, and re-freeze that row. Seven of twelve assertions —
   every assertion covering the controls, the precedence and the production path — still have
   no CI oracle, and the capturers that close them are written, working and one line away.
2. **The `worldSeed` comment in `index.html` is now false** about the two facts it cites, and
   Benchmark still freezes a seed the product cannot set. Either wire
   `__BIRB.worldSeed(n)` to `setWorldSeed(n)` + rebuild, or correct the comment to say the
   library shipped and only the hook is outstanding. Do not leave a shipped comment asserting
   that a file which exists does not.

Do not re-litigate the workbench, the wiring, the precedence, the production path or A6.
G2b established those with measurements and this gate re-confirmed A6, the ladder and the
production harnesses without finding drift.
