VERDICT: STOP — the wave's own suite is still red on FS-A1b (third gate running, one edit), and the CI this wave shipped fails at its first added step, so on every push the browser-health job now dies before it reaches birb-modes, birb-shaders or birb-shot — deleting the repo's only "a rendering world is not a working world" check

# G2c — Wave 2 acceptance gate

Everything below was produced by running the code on this working tree. No number is taken
from an agent's self-report or from an earlier gate; where I re-checked a G2a/G2b finding I
re-ran it rather than citing it.

**R6 applies to the whole document.** Every frame rate here is SwiftShader (3–13 fps) and
none of it is a device claim. The CPU costs in §2 are wall-clock timings of specific
functions on this Linux x86 box and are quoted as *relations* (µs per frame against a
16.67 ms budget), never as a phone result.

Working tree at gate time — **nothing committed**, `HEAD = dd35ad5`:

```
 M .github/workflows/browser-health.yml   M .github/workflows/tests.yml
 M index.html                             M sw.js
 M src/effects/bloom-pass.js              M src/environment/weather.js
 M src/game/frame-metrics.js
 M tools/birb-shot.mjs   M tools/birb-sheet.mjs   M tools/birb-lighting.mjs   <- see §7
?? src/game/frame-stats.js  ?? src/game/gpu-timer.js  ?? src/game/quality-settings.js
?? src/ui/dev-quality-panel.js  ?? src/ui/dev-gesture.js  ?? tests/build-identity.test.js
?? docs/perf/gates/G2a.md  ?? docs/perf/gates/G2b.md
```

**Exactly one thing changed between G2b and this gate: the P2.4a capture-label task.** Every
other file is byte-identical to what G2b measured. None of G2a's seven blocking findings and
neither of G2b's two was remediated. That fact carries most of the verdict and §6 evidences
it one by one.

---

## 1. Item 3 — the full oracle run, every exit code

Run from the repository root, each to its own log, `$?` captured immediately, R2 respected
(nothing piped into `grep` before the code was read).

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm test` (`BIRB_PERF_IMPL` **unset**) | **0** | `# tests 464 / pass 378 / fail 0 / skipped 86` |
| 2 | `BIRB_PERF_IMPL=1 npm test` | **1** | `# tests 464 / pass 461 / fail 1 / skipped 2` — one failure, FS-A1b |
| 3 | `node tools/birb-modes.mjs` | **0** | `all 5 modes ok in forest`, 18/18 rings, 3 lives, nesting reached, turret launched 1/3 |
| 4 | `node tools/birb-shaders.mjs` | **0** | `all shaders compile in 4 environments` |
| 5 | `node tools/birb-shot.mjs --start` | **0** | 63–64 calls, 75 214 tris, `[quality: tier 1 (adaptive)]` |
| 6 | `node tools/birb-shot.mjs --start --nest` | **0** | `nesting: "nested"`, `[quality: tier 2 (adaptive)]` |
| 7 | `node tools/birb-quality.mjs --selftest` | **1** | `mutations: 25 catalogued, 25 applicable, 23 detected`; 2 failures |
| 8 | `node tools/birb-quality.mjs --check all` | **1** | 5 pass (A4 A6 A7 A8 A9), 7 fail (A1 A2 A3 A5 A10 A11 A12) |
| 9 | `node tools/birb-quality.mjs --check resize-restore` | **0** | A6 `pass`, all four steps coherent, `matchesExpectedRed: false` |
| 10 | `node tools/req-verify.mjs` | **0** | 59 requirements derived, every one covered |
| 11 | `sha256sum -c tools/oracle-manifest.txt` | **1** | 53 of 56 OK; **3 FAILED** — see §7 |

### 1.1 The `npm test` invariant

The brief pins **460 / 378 / 0 / 82**. Measured: **464 / 378 / 0 / 86**, exit 0. The delta is
exactly `tests/build-identity.test.js` — four tests, all skipped when the env is unset — which
CONTRACT §8.3 SW-2 names *by that filename* and §8.4 assigns to W2. Pass count, fail count and
exit code are unchanged. G2b §5.10 already recorded this. **I confirm it and restate the
invariant for Wave 3 as 464 / 378 / 0 / 86.** This is not the reason for the STOP.

### 1.2 The one failing test, quoted

```
not ok 112 - FS-A1b the acceptance gate and the controller share one percentile implementation
  location: 'tests/frame-stats-totals.test.js:235:1'
  error: one convention, one implementation — otherwise the loop is closed against itself
         51 !== 52
```

Re-derived at source, not inferred:

```
$ grep -n "nearestRankPercentile\|export function percentile" src/game/frame-stats.js src/game/frame-metrics.js
src/game/frame-stats.js:120:function nearestRankPercentile(values, q)
src/game/frame-stats.js:283:  p50 = nearestRankPercentile(validIntervals, 50);
src/game/frame-metrics.js:35:export function percentile(values, p)

$ percentile([1..100], 0.95) = 95      percentile([1..100], 95) = 100      percentile([1..100], 1) = 100
```

Two implementations, still not linked; `frame-metrics.percentile` still reads `p` as a
fraction only, so FS-A1b's `percentile(intervals, 95)` clamps to the last index. **This is
G2a §4.1 verbatim, unchanged across three gates, with the reconciliation that satisfies both
frozen suites already written out at G2a §4.1** (treat `p > 1` as a percentage; delete the
private helper; import the one function). Green is the deliverable and it is not green.

---

## 2. Item 2 — instrumentation cost. Measured, and the answer is mostly good

The plan requires measuring with telemetry both enabled and disabled. **There is no
telemetry-disable route in the product** (`grep` for `notelemetry|perfOff|telemetryEnabled`
returns nothing), so "disabled" was approximated as *panel closed*, and the per-frame
instrumentation — which runs unconditionally — was timed directly instead.

### 2.1 The 4 Hz cadence is real, and it is the only DOM path

`window.setInterval` / `clearInterval` were wrapped in an `addInitScript` **before any module
ran**, so every timer the page installs is recorded with its period.

```
panel CLOSED — live intervals: [ { ms: 60000 } ]                     <- no panel timer at all
panel OPEN   — live intervals: [ { ms: 60000 }, { ms: 250 } ]        <- exactly one, at 250 ms
```

One 250 ms timer, created in `openPanel()` and cleared in `close()` (`dev-quality-panel.js`
926–936, 955). `grep` finds no `requestAnimationFrame` and no render-loop DOM write anywhere
in the panel. **PRO-14's 4 Hz is implemented as 4 Hz and CONTRACT §3.4's "no per-frame DOM
work" holds** — the hard half of that rule, the half that is not provisional.

DOM mutation counts over a 4 s window (MutationObserver on `document.documentElement`):

```
panel closed   39 mutations / 4001 ms      (the game's own HUD)
panel open    433 mutations / 4000 ms      ≈ 27 per tick x 4 ticks/s
```

### 2.2 The panel tick costs 0.115 ms, at 4 Hz

The captured `tick` function was called directly, 40 times, on the live page:

```
tickCost = { intervalMs: 250, meanMs: 0.115 }
    ->  0.46 ms of main-thread work per second   (0.046 % duty cycle)
```

### 2.3 Per-frame instrumentation costs 0.855 µs — 0.005 % of a 16.67 ms budget

`index.html:6570` adds `currentPauseReason()` + `intervalRecorder.sample()` per frame, and
`index.html:9254–9257` adds `gpuTimer.beginFrame / endFrame / poll` around `presentFrame()`.
Both modules were re-imported **inside the live page** against the live WebGL2 context and
timed there, so this is browser JIT and a real GL context, not Node:

```
intervalRecorder.sample()                    0.050 us / frame   (100 000 calls)
gpuTimer.begin + end + poll                  0.805 us / frame   ( 20 000 calls)
                                             ---------
                                             0.855 us / frame  =  0.0009 ms
```

`qualitySettings.snapshot()`, which `currentPauseReason()` reaches **only in Benchmark
mode**, measures 0.327 µs. The GPU timer's per-frame path exits early at
`cap.state !== 'ok'`, which is what it does on every device without the extension — i.e.
Safari and CI both.

### 2.4 `evaluateAcceptanceGates` is O(n²) and costs 2.7 ms — but it is NOT on the 4 Hz path

G2a §4.11 flagged this as running "inside the panel whose own contract forbids
instrumentation that manufactures the bottleneck." **On this tree that is not so, and the
distinction matters.** Measured at the full 512-sample ring:

```
intervalRecorder.stats()          0.257 ms
intervalRecorder.exportIntervals()0.016 ms
evaluateAcceptanceGates()         2.705 ms      <- O(n^2): sorts, then rescans per value
```

`grep` places `evaluateAcceptanceGates` in exactly one place: `panelGetEvidence()`
(index.html 7957). The panel's `tick()` calls `getBuildStale`, `getTelemetry` and
`getControlState` — never `getEvidence`. So the 2.7 ms fires on the **Export** button, once.
**Wave 3 must not put it on a loop**: it is the controller that will want a gate score every
window, and 2.7 ms desktop is plausibly 8–25 ms on the target phone, which is more than the
frame it is scoring.

### 2.5 The one real cost: the game loop allocates every frame

This is where instrumentation does touch the thing it measures.

```
createIntervalRecorder().sample() x 60 000   (~16 min of play at 60 fps)
   heapUsed before                3.594 MB
   heapUsed after, no GC          4.509 MB
   delta                          0.915 MB          ~55 KB/s of garbage
   after two forced GCs           0.064 MB          (all of it collectable, none retained)
```

`src/game/frame-metrics.js:89` allocates `const record = { dtMs, tMs, valid, invalidReason }`
per call, plus a second literal per hitch, into a ring that is already
`new Array(capacity)`. `index.html:6570` calls it **once per frame, unconditionally, with
the panel closed and never opened**. House Rule 4: *"reuse objects with `_` prefix, never
allocate in update()"*. G2a §4.10 flagged it before it was wired; G2b §5.5 flagged it live
and could not put a number on it because `performance.memory` reported 0 (I reproduced that
— `heapDelta` over 200 000 in-browser calls read exactly `0`, which is the counter's
granularity, not an absence). **The Node measurement above is the number G2b could not get.**

It is not a CPU-time bottleneck. It is GC pressure in the game loop, and the quantity this
whole programme is built to measure is the frame-interval *tail* — p95/p99 and the >25 ms
count — which is precisely what a GC pause moves. Instrumenting the tail with something that
feeds the tail is the defect class, at a small magnitude. The fix is the one already written
down: fill the ring with records once in the factory and mutate the fields.

### 2.6 What I could NOT determine

The panel-open-vs-closed **frame rate** A/B is inconclusive and I am not reporting it as a
result. Under SwiftShader at ~3 fps, six seconds per arm yielded 18 and 17 intervals:

```
panel closed   mean 314.81 ms   p50 316.7   p95 416.6   (18 frames)
panel open     mean 333.32 ms   p50 300.0   p95 816.7   (17 frames)
```

Two-frame sample noise on a software rasteriser, and the p50s move in the opposite direction
to the means. R6 forbids turning it into a claim in either direction. §2.2 and §2.3 are the
evidence that stands: 0.46 ms/s open, 0.0009 ms/frame always.

---

## 3. Item 1 — CI. Parses, and is wrong in three ways

### 3.1 It parses — PASS

```
$ python3 -c "import yaml; yaml.safe_load(open('.github/workflows/browser-health.yml'))"   -> OK
$ python3 -c "import yaml; yaml.safe_load(open('.github/workflows/tests.yml'))"            -> OK
$ (also parsed .github/workflows/humanoid.yml — OK, untouched)
```

Parsed structurally, not textually: `browser-health.yml` has one job `health`,
`timeout-minutes: 24`, thirteen steps in order; `tests.yml` has one job `unit-tests`, three
steps, exactly one carrying `continue-on-error: true`.

### 3.2 Placement — PASS

The three `birb-quality` steps sit inside the existing `health` job at positions 6–8, after
`Install browser harness` (3), `Restore the tracked Three stub` (4) and `Install Chromium`
(5). No second job, no second Chromium install, no second `npm install`. Exactly as asked.

### 3.3 The timeout was revisited — PASS on the raise, FAIL on the arithmetic

12 → 24 with a comment. The comment's per-step figures are **not measured**:

| Step | Comment claims | Measured here |
|---|---|---|
| `--selftest` | ~4 m | **60 s** |
| `--check resize-restore` | ~3 m | **21 s** |
| `--check all` | ~5 m | **31 s** |
| (context: `birb-modes`) | — | 47 s |
| (context: `birb-shaders`) | — | 27 s |

Added cost ≈ 112 s locally against a claimed ≈ 12 min. A GitHub runner is slower than this
box but not tenfold. **24 minutes is safe and I am not asking for it to change** — the
finding is that a justification comment states numbers nobody timed, in a programme whose
first principle is that an unmeasured number becomes a fabricated constant three waves later.
Two minutes with `date +%s` would have produced the real ones.

### 3.4 BLOCKING — the two added steps that exit 1 have no guard, and they gate the checks that matter

Steps run in order and a failed step without `continue-on-error` fails the job. On this tree:

```
step 6  Quality harness can initialize                 node tools/birb-quality.mjs --selftest      -> EXIT 1
step 7  Resize-restore bug still present on HEAD       --check resize-restore                      -> exit 0
step 8  All quality assertions pass or match expected  --check all                                 -> EXIT 1
step 9  Game starts and is actually playable           birb-shot --start          NEVER RUNS
step 10 A nest can be landed on                        birb-shot --start --nest   NEVER RUNS
step 11 Every game mode enters ...                     birb-modes                 NEVER RUNS
step 12 Every shader compiles ...                      birb-shaders               NEVER RUNS
```

`browser-health.yml`'s own header says why it exists: a world that rendered perfectly with
nesting and collectibles never created shipped to production because *"nothing was watching
for warnings."* `birb-modes.mjs` — the tool that treats console **warnings** as failures — is
the check that would have caught it, and this wave has placed two currently-red steps in
front of it. **Every push to `index.html`, `src/**` or `sw.js` from now on goes red at step 6
and the four game-health checks never execute.** That is not "CI is red because the work is
unfinished"; it is the wave switching off the repo's most expensive lesson while the board
still shows a red X, which is exactly the failure this project already paid for once in the
opposite direction (`all 5 modes ok` printed on a run exiting 1).

Two orderings fix it and either is acceptable: put the four existing health steps first, or
give the two red steps `continue-on-error: true` **with a comment naming Wave 3** (which is
the rule the brief states and which `tests.yml` already follows). Both are one-line changes.

### 3.5 BLOCKING — the step names and comments assert the opposite of what the tree does

```yaml
- name: Resize-restore bug still present on HEAD
  # A6 asserts that tier restoration without a canvas resize leaves bloom
  # and weather targets desynchronized. This is the permanent bug that Wave 2
  # will fix. Exits 0 on HEAD (expected red), exits 1 otherwise (regression).
```

Measured on this tree: A6 **passes**, all four steps coherent, and it exits 0 **because the
bug is fixed** — G2b proved that by reverting the one-line `updateRendererSize(true)` fix
through route interception and watching EXPECTED-RED's ten-field manifest reproduce
`differences: []`. The step's name and its comment both tell a reader that green means the
bug is still there. That is a log whose tail says the opposite of the truth about the single
most important defect in the programme.

```yaml
- name: All quality assertions pass or match expected-RED
  # Runs all twelve assertions. A1–A3, A5, A10–A12 are not-yet-implemented.
  # A6 is expected to fail (documented in docs/perf/EXPECTED-RED.md).
```

Three claims, all false now: those seven **are** implemented (their files are on disk — that
is precisely why the harness flipped them to "available" and they now fail for want of a
capturer, G2b §5.2); A6 passes; and the step does not in fact tolerate an expected-RED, it
just exits 1.

### 3.6 `continue-on-error` in `tests.yml` — PASS on the letter

One occurrence, commented, and the comment names a wave (*"Wave 2 (P2.1–P2.4) will complete
them"*). The rule is met. Note for the record that the named wave is **this** one, and it is
ending with the suite still red, so the removal condition expires at acceptance — whoever
lands the FS-A1b fix removes this line in the same commit, and if that fix slips to Wave 3
the comment must be rewritten to say Wave 3 rather than left to rot.

---

## 4. Item 4 — the siblings are unharmed — PASS

```
$ npm test                                                    exit 0   464 / 378 / 0 / 86
$ node --test <16 sibling files, named explicitly per R1>     exit 0   216 / 214 / 0 / 2
      gauntlet-{damage,flight,modes,nesting,qr,race-logic}
      icon3d-{catalogue,lift,mesh,ribbon,svg,sweep}
      sculpture-{figure-details,orbit,phase5,surface-nets}
```

`humanoid/` is a Swift package on its own workflow (`humanoid.yml`, parsed OK above, two
jobs, untouched by this wave — no file under `humanoid/` appears in `git status`). All five
new `src/` modules import nothing and take their side effects as injected callbacks, so R4's
static-import hazard — the one that turns `tests.yml` red for all four siblings — was not
reintroduced. `node_modules/three` is still the tracked 414-line stub.

---

## 5. Item 5 — nothing shipped that only paints — PASS

```
node tools/birb-modes.mjs    exit 0    all 5 modes ok in forest
   casual        rings 18/18, lives 3, nesting flying
   ring_rush     rings 18/18, lives 3, nesting flying
   drone_hunter  rings 18/18, lives 3, nesting flying
   turret_defense rings 18/18, lives 3, nesting landing, launched 1/3
   zen           rings 18/18, lives 3, nesting nested
node tools/birb-shaders.mjs  exit 0    forest / canyons / mountain / city all ok
node tools/birb-shot.mjs --start        exit 0   (asserts nesting + collectibles exist)
node tools/birb-shot.mjs --start --nest exit 0   nesting: "nested"
```

Console warnings are failures for `birb-modes` and it is green. Zero console errors, zero
console warnings and zero page errors across every browser run I made for this gate,
including a production-path boot with no query string. Ring Rush's win condition still reads
the spawner (18/18, not 10).

**The production path holds** — re-verified rather than inherited, because it is a named STOP
condition. Loaded at `http://127.0.0.1:<port>/index.html`, **no query string**:

```
location.search               ""
typeof window.__BIRB          "undefined"
typeof window.__BIRB_READY    "undefined"
#birb-dev-quality-panel       present in the DOM, hidden: true
three-finger hold (800 ms) then release, via CDP Input.dispatchTouchEvent
                              -> panel.hidden === false        PANEL OPENED
```

`?debug` gates `window.__BIRB` and nothing else. G2b's STOP condition — *the gesture
registered inside the `?debug` block* — does not fire. (My two-finger control was
inconclusive because my close-button selector missed and the panel was still open when I
dispatched it; G2b measured that case properly with the panel confirmed closed first, and
`--selftest` detects `M-A2-panel-eats-the-sprint`. I am not re-litigating it, but I did not
independently reproduce it and say so.)

---

## 6. Item 6 — the compatibility ladder (CONTRACT §11) — PASS, with one authorised change named

**No threshold moved.** Re-derived against commit `9888147` (Wave 1, before any of this):

| Constant | Wave 1 | This tree |
|---|---|---|
| `LOW_FPS_THRESHOLD` | 55 | **55** |
| `RESTORE_FPS_THRESHOLD` | 58 | **58** |
| `LOW_WINDOW_MS` | 2000 | **2000** |
| `HIGH_WINDOW_MS` | 4000 | **4000** |
| `MIN_INTERVAL_MS` | 1500 | **1500** |
| `DPR_CAP` | `isMobile ? 1.7 : 1.8` | **identical** |
| `getQualityPixelRatio` | untouched | **untouched** (`src/environment/visual-style.js`) |

The tier→DPR table is unchanged and SC-DPR confirmed it live on every harness boot in this
gate: `tier0=1.7 tier1=1` at `deviceScaleFactor: 3`, so the discriminator was alive for all
of it (CONTRACT §5.2).

**One live-behaviour change, and it is the one the contract orders.** `applyTier` no longer
calls `renderer.setPixelRatio(...)` three times; it calls `updateRendererSize(true)` once.
The resulting pixel ratio is identical — the same `getQualityPixelRatio(devicePixelRatio,
DPR_CAP, newTier)` — but the bloom targets, `weather.uPixelRatio` and `resizeState` now
commit with it instead of staying stale. CONTRACT §7.2's routing register requires exactly
this (*"routed through the single sizing function — today it bypasses `resizeState`,
`bloomPass.setSize` and `weather.setPixelRatio` entirely, which is the desync A6 tests"*),
and it is the fix G2b proved by reverting. **This is not a STOP: it is the wave's product.**
I name it so Wave 3 does not later mistake it for drift.

Two smaller items in the same family, both authorised in substance and both needing a
contract row that nobody has written:

- **`adaptiveTier.unpin()` now exists.** CONTRACT §1.3 states as fact *"There is no unpin"*,
  and §7.2's T12 row requires *"panel Manual/Resume Auto supersedes"*, which cannot be built
  without one. It is required, it is correct, and §1.3's sentence is now false. Amend §1.3.
- **`updateRendererSize` reads `panelOverrides.dpr` before the tier.** That is §7.1
  precedence (panel > tier), verified by G2b over 30 consecutive frames and across a tier
  change. A page that never opens the panel leaves every override `null` and falls through
  to the tier-derived value, so the shipped adaptive path is unchanged.

`reducedMotionState` is untouched and is still not a performance lever. No route in the diff
reaches `bird-flight.js`, `touch-input.js` or `collider-grid.js`.

---

## 7. Gate decision — the three modified capture harnesses

`sha256sum -c tools/oracle-manifest.txt` exits **1** on:

```
tools/birb-shot.mjs: FAILED     tools/birb-sheet.mjs: FAILED     tools/birb-lighting.mjs: FAILED
```

This is **not** the automatic STOP the brief describes, and I checked before ruling.
`.claude/workflows/perf-wave-2.js`, task **P2.4a**, carries an *"EXPLICIT ORCHESTRATOR
EXEMPTION — the only one in this wave"* for exactly these three files, and states
*"sha256sum -c will now fail on these three files and that is expected — say so in
'deviations' and report the new hashes so the orchestrator can re-freeze. Do not edit the
manifest yourself."* The manifest's own header agrees: a listed file may be edited under a
**gate decision recorded in `docs/perf/gates/`**, with the manifest regenerated in the same
commit as the change it blesses.

**I verified the exemption's conditions rather than taking them on trust.**

| Condition | Finding |
|---|---|
| No assertion, exit-code path, timeout or wait condition changed | Held. `birb-shot`: one `console.log` line. `birb-lighting`: one `page.evaluate(stats())` plus a caption. `birb-sheet`: a `landingFailed` flag set inside the **existing** `.catch`, which still pushes to `problems` — the exit-code path is byte-for-byte the same. |
| Exit codes unchanged | Verified for `birb-shot` in both modes (`--start` 0, `--start --nest` 0). **Could not determine for `birb-sheet` and `birb-lighting`** — I did not run them; `birb-sheet` needs a nest landing in all four biomes and the city-nest timeout is a documented pre-existing issue. Both load `?debug=1` and both already call `window.__BIRB.stats()` / `pinTier(0)` unguarded elsewhere, so the added call introduces no failure mode the file did not already have. |
| The label is not a constant | **Proved.** Two `birb-shot` runs on this tree printed `[quality: tier 1 (adaptive)]` and `[quality: tier 2 (adaptive)]`. Note `birb-lighting` pins tier 0 at its line 77, so its label can only ever read `tier 0 (pinned)` — derived, not hardcoded, which satisfies the requirement, but that tool cannot itself demonstrate variance. |

**DECISION: the exemption is confirmed and the re-freeze is authorised**, to be applied in the
same commit as the remediation below, never before it. The three replacement rows:

```
a8c11a1e313c1e33ae5329ed87245b4994a0759e3d2c63c3bc68ffc9f2ca8f41  tools/birb-shot.mjs
e4b61079ee3feb11062eb889bcc8bbfae3fa23dc1ba456acb2c900c6fbd43887  tools/birb-sheet.mjs
ef02bf80a755f505703284905ab97aa88681cee6b6b667cfb2f635fea7409db7  tools/birb-lighting.mjs
```

The other 53 rows verified OK before and after every run in this gate. No `tests/**`, no
`tools/lib/**`, no `tools/birb-quality.mjs`, no `tools/birb-modes.mjs`, no
`tools/birb-shaders.mjs`, no `CONTRACT.md`. **R5 otherwise held: I modified nothing that
grades this wave, and I implemented against the oracles I disagree with.**

### 7.1 Two further gate decisions raised by G2b, taken here

**`EXPECTED-RED.md` may be revised.** Its §4 sets the condition itself: *"After the Wave 2
sizing fix: all four steps coherent, A6 `pass`, exit 0, and `matchesExpectedRed()` returns
`matches: false`."* Measured above: exactly that. G2b supplied the other half — a
line-reverted tree reproduces the manifest field-for-field with `differences: []`. The
revision is a swap to the `fixedResizeRestore()` expectations already written in
`tests/quality-assertions.test.js`, and `EXPECTED-RED.md` is itself a manifest row, so it
re-freezes with the three above. **I authorise it; I have not taken it, because it belongs in
the remediation commit alongside the CI naming fix in §3.5 — the file and the step name
describe the same stale world and should stop doing so together.** I also confirm the
condition that would have re-opened it: `__BIRB.effective()` is **unchanged** and still reads
`renderer.getPixelRatio()`, `gl.drawingBufferWidth`, `bloomPass.getSizes()` and
`frameRenderTotals.statsPath` off live objects. It has not become a tautology.

**CONTRACT §3.1's reason enum needs `not-webgl2` added** (G2a §4.8, G2b §5.4). The module is
right and the contract row is short. **CONTRACT §9 DEF-3 needs amending or the row moving**:
DEF-3 says *"the row is absent from the panel — not present-and-disabled"* and the panel ships
it present-and-disabled with a visible reason. The behaviour is honest; the contract is
binding and its amendment rule requires this to be recorded. Both are one-line amendments and
neither is a defect in the code.

---

## 8. Item 6 of the brief's spirit — what was actually remediated since G2b: nothing

Each re-run here, not cited from G2a.

| Finding | Status | Evidence produced for this gate |
|---|---|---|
| G2a §4.1 / G2b §5.1 — two percentile implementations | **OPEN** | FS-A1b `51 !== 52`; `nearestRankPercentile` still private in `frame-stats.js` |
| G2a §4.2 — no seeded RNG | **OPEN** | `src/environment/seeded-random.js` absent; 76 raw `Math.random()` in `src/environment/`. *Now reported honestly*: `__BIRB.worldSeed(n)` returns the `not-implemented` sentinel and `panelGetEvidence().seed` likewise — correct behaviour for an unshipped feature, but Benchmark still sets `freeze('seed', true)` on a mechanism that does not exist |
| G2a §4.3 — ACC-2 reports a quantity it does not score | **OPEN** | 200 samples, 80 at 20 ms, none over 25 ms: `{"pass":true,"value":40,"threshold":1}` |
| G2a §4.4 — ACC-3 counts PAUSED samples as unexplained spikes | **OPEN** | 120 good frames + 8 `valid:false, invalidReason:'hidden'` → clean `{"pass":true,"value":0}`, dirty `{"pass":false,"value":8,"threshold":3}` |
| G2a §4.5 — `unexplainedSpikes: 0` where there is no measurement | **OPEN** | 10 samples all 900 ms: `p95` = sentinel, `unexplainedSpikes` = `0` |
| G2a §4.6 — Benchmark's freeze leaks; the sun never thaws | **OPEN** | `benchmark → manual → auto` leaves `{"seed":true,"route":true,"settings":true,"sun":true}` with no path back |
| G2a §4.7 — a desync reported as `clamped: true, applied: true` | **OPEN** | unwired `apply`: `{"requested":1,"effective":1.7,"clamped":true,"changed":false,"applied":true}` |
| G2a §4.8 — GPU timer reports `ok` after its context goes away | **OPEN** | `isContextLost()` still opens `if (!gl) return false`, so `probeCapability()` returns the stale cache |
| G2a §4.9 — `evaluateOscillation` counts outside its own window | **OPEN** | entries at 6/7/80/81/82 s → `{"reversals":4,"window":{"startMs":5000,"endMs":35000}}` |
| G2a §4.10 / G2b §5.5 — per-frame allocation, live | **OPEN** | 0.915 MB per 60 000 `sample()` calls (§2.5) |
| G2a §4.12 — one PRO-12 number declared twice | **OPEN** | `spikeMs: 50` in `frame-stats.js` still a literal, not derived from `HITCH_THRESHOLD_MS` |
| G2b §5.2 — the harness cannot run 7 of 12 assertions | **OPEN** | `--check all` exit 1: A1 A2 A3 A5 A10 A11 A12 all *"reports available … but this harness has no live capturer"* |

G2b's §5.2 needs a decision from this gate and I give it: **put the seven capturers in a new,
unfrozen `tools/lib/quality-captures.mjs`.** `tools/birb-quality.mjs` is a manifest row and
`tools/lib/quality-assertions.mjs` is too; a new file under `tools/lib/` is neither, so R5
stays intact for Wave 3 and no re-freeze is needed for it. G2b reached the same conclusion and
called it the cheaper of the two; I concur, and I note the cost of not doing it — **A1, A2,
A3, A5, A10, A11 and A12 have no CI oracle at all today.** Everything G2b measured about the
controls, the precedence and the production path, and everything I measured in §5 above, is a
gate agent's notebook rather than a repeatable check.

### 8.1 One finding of my own, not previously recorded

**`currentPauseReason()` produces four of the seven `INVALID_REASONS` and can never produce
the other three.**

```
src/game/frame-metrics.js:25
  INVALID_REASONS = ['hidden','flightPaused','systemPaused','contextLost','frozen','benchmarkHold','panelHold']

index.html:6809  currentPauseReason()
  document.hidden                                     -> 'hidden'
  benchmarkFreezes.settings && snapshot().paused      -> 'benchmarkHold'
  controlState.systemPaused                           -> 'systemPaused'
  !motionState.animate                                -> 'flightPaused'
  otherwise                                           -> null
```

`contextLost`, `frozen` and `panelHold` are declared and unreachable. CONTRACT §2.2 lists
seven sources and says *"all must be OR-ed; any one is sufficient."* The consequential one is
`frozen`: `__BIRB.freeze(true)` (index.html 9858) sets the controller's speed to 0 and does
**not** clear `motionState.animate`, so it produces no reason at all — and `freeze(true)` is
the pose-pinning method CONTRACT §4.2 mandates for *every* A/B in the assertion table. Every
frame G2b sampled under `freeze(true)`, and every frame I sampled in §2.6, was recorded
`valid: true`. It does not invalidate those measurements — they are frame-interval readings,
not paused ones — but a validity flag that is off during the one operation the contract
requires for measurement is a hole in §2.2, and Wave 3's controller will consume it.

Related and smaller: `currentPauseReason()` calls `qualitySettings.snapshot()` **per frame**
whenever `benchmarkFreezes.settings` is true, i.e. throughout Benchmark mode, and `snapshot()`
builds a fresh object (0.327 µs). An allocation on the frame path, in the mode whose whole
purpose is clean measurement.

---

## 9. What passed, stated plainly

- **The workbench reaches the phone.** Panel + gesture + keyboard + `?devpanel` all live on a
  page with no query string and `window.__BIRB === undefined`. Re-verified here, not inherited.
- **A6 is green because the code was fixed**, and G2b proved it still catches the bug by
  reverting the one-line fix. `effective()` is unchanged and has not become a tautology.
- **The 4 Hz cadence is real** and is the panel's only DOM path: one 250 ms `setInterval`,
  created on open, cleared on close, 0.115 ms per tick, nothing while closed.
- **Per-frame instrumentation costs 0.855 µs**, 0.005 % of a 60 fps budget, measured in the
  live browser against the live GL context.
- **The expensive O(n²) gate evaluation is on the Export button, not the tick.**
- **No adaptive threshold, no DPR value and no tier semantic moved.** SC-DPR alive on every
  boot (`tier0=1.7 tier1=1`).
- **The siblings are untouched**: 216 / 214 / 0 / 2, exit 0, plus `npm test` 464 / 378 / 0 / 86.
- **Nothing ships that only paints**: `birb-modes` exit 0 with warnings-as-failures, all five
  modes, 18/18 rings; `birb-shaders` exit 0 in four biomes; both `birb-shot` modes exit 0.
- **`req-verify`** exit 0, 59 requirements, full coverage.
- **`sw.js`** — `CACHE_VERSION` and `BIRB_BUILD` both `v43-2026-09-09-perf-workbench`, all
  five new modules in `CORE_ASSETS`, `tests/build-identity.test.js` green under
  `BIRB_PERF_IMPL=1`.
- **Both workflow files parse** with `yaml.safe_load`, steps correctly placed, one commented
  `continue-on-error`.

---

## 10. Verdict

**STOP.** Not for the workbench, which is good work and which G2b already established is
wired to real rendering rather than to labels. It stops on three things:

1. **§1.2 — `BIRB_PERF_IMPL=1 npm test` is red on FS-A1b.** Third gate in a row, same
   defect, with the reconciliation that satisfies both frozen suites written out in full at
   G2a §4.1 and repeated at G2b §5.1. It is one edit and it also disposes of the O(n²)
   evaluation. Green is the deliverable.
2. **§3.4 — the CI shipped by this wave turns `browser-health` red at step 6 and the four
   game-health checks never run.** `birb-modes` — the warnings-are-failures check that exists
   because this repo shipped a world with its nesting and collectibles systems never created —
   is now unreachable on every push. Either reorder the steps or guard the two red ones with a
   comment naming Wave 3.
3. **§3.5 — the added CI step names and comments state the opposite of what the tree does**
   about A6 and about which assertions are implemented. This repo's own most-cited defect is a
   log whose summary line disagrees with the run.

**Not** counted against the wave: the manifest's three failures (§7 — pre-authorised, and I
confirm the re-freeze), the 464/86 test-count shift (§1.1 — contract-required), and the
`applyTier` routing change (§6 — it is the wave's product).

**Not ready for Wave 3.** Wave 3 builds the policy machine directly on `frame-stats.js` and
`frame-metrics.js`, and it would inherit: two percentile implementations that disagree, an
ACC-2 that displays a quantity it does not score, an ACC-3 that calls a backgrounded tab a
recurring unexplained spike, an oscillation window that counts outside itself, a Benchmark
mode that pins the sun permanently on any exit through Manual, a per-frame allocation in the
loop whose tail it is measuring, and seven assertions with no CI oracle. Every one of those is
a number the controller will fire on.

The remediation is small and mostly written down already: one edit for §1.2 (which closes G2a
§4.1, §4.11 and §4.12 together), one or two lines for §3.4, a comment and a name for §3.5,
one clause each for G2a §4.3/§4.4/§4.5, small local fixes for §4.6/§4.7/§4.8/§4.9, the ring
pre-fill for §4.10, three reasons added to `currentPauseReason()` for §8.1, and
`tools/lib/quality-captures.mjs` for §8's seven capturers. P2.1e (the seeded RNG) is a whole
task that has to be re-run. Then re-freeze the manifest with §7's three rows and revise
`EXPECTED-RED.md` in the same commit.
