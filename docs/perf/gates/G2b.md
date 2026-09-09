VERDICT: STOP — every control is wired to real rendering work and all three silent-failure checks hold, but `BIRB_PERF_IMPL=1` is still red on FS-A1b (G2a §4.1, unfixed) and the frozen harness cannot run 7 of its 12 assertions, so nothing in CI certifies the controls this gate had to measure by hand

# G2b — Wave 2 control-wiring gate

Gate for the question the wave exists for: **is each control wired to rendering work, or to a
label?** Everything below was produced by running the code. No number is taken from an agent's
self-report, and every number is a *relation* between two readings of the same live object
(CONTRACT §0 "effective"), never a recomputation of intent.

Working tree at gate time — nothing committed:

```
 M index.html                 M src/effects/bloom-pass.js
 M src/environment/weather.js  M src/game/frame-metrics.js   M sw.js
?? src/game/frame-stats.js   ?? src/game/gpu-timer.js  ?? src/game/quality-settings.js
?? src/ui/dev-quality-panel.js  ?? src/ui/dev-gesture.js  ?? tests/build-identity.test.js
?? docs/perf/gates/G2a.md
```

**R6 applies to this whole document.** Every figure below is a dimension, a draw count, a pass
count or a boolean. The two frame rates that appear (11–13 fps, p95 433–1500 ms) are SwiftShader
and are quoted only to show that a field was populated at all. Nothing here is a device claim.

---

## 0. How the controls were driven

The panel exposes no ids on its control rows and no handle on its public API, so each control was
located inside `#birb-dev-quality-panel` by its own `.bqp-control-label` text and driven by
setting `input.value` / `select.value` / `input.checked` and dispatching real `input` / `change`
events — i.e. **through the same listener a thumb reaches**, not through `qualitySettings.request`
and not through `__BIRB`. The three-finger gesture was synthesised with CDP
`Input.dispatchTouchEvent` (real trusted touch events), not with JS-constructed `TouchEvent`s.

Context is CONTRACT §5.1 verbatim: `390×844`, `deviceScaleFactor: 3`, `isMobile: true`,
`hasTouch: true`. SC-DPR passed on every boot (`tier0=1.7  tier1=1`), so the DPR discriminator was
alive for all of it (CONTRACT §5.2).

Confounds pinned per CONTRACT §4.2 before every A/B: `setSunEnabled(false)`, `freeze(true)`,
`pinTier(n)`.

---

## 1. The control table — one measurement per class

| Control | How driven | Measured effect | Verdict |
|---|---|---|---|
| **DPR slider** | real `<input type=range>`, 1.7 → 1.0 → 2.0 | `gl.drawingBufferWidth` **663 → 390 → 780**; `canvas.width` identical at each step; `bloom.sceneTarget` **663×1434 → 390×844 → 780×1688**; `weatherPixelRatio` **1.7 → 1.0 → 2.0**; `resizeState.pixelRatio` 1.7 → 1.0. `assertA3` **pass**. | **wired** |
| **Post quality** | real `<select>`, half → quarter → off → half | quarter: `blurA/blurB/rayTarget` **331×717 → 165×358**, `downscale` **2 → 4**, `assertA4` **pass at the new divisor** (165 = ⌊663/4⌋). off: `frameTotals().passes` **5 → 1**, whole-frame calls **−4** in 10/10 paired cycles (mean −4.1) at a **fixed tier 0**. half again: 5 passes, targets back to 331×717. | **wired** |
| **Weather density 0** | real slider, **18 alternating adjacent-frame pairs** | `weather.points.visible` **true → false in 18/18 pairs**. Scene draw calls fall by **exactly 1 in 15 of 18 pairs** (median 1, mean 0.72, range −2…+1). `assertA5` **pass**. | **wired** |
| **Shafts toggle** | real checkbox, sun forced on screen first | `bloomPass.getRays() > 0` **true → false**; `frameTotals().passes` **8 → 5**, and 5 held for **6 consecutive frames**. | **wired** |
| **Bloom strength** | real slider, 0.78 → 2.0 | `uStrength` **0.78 → 2.0**; `passes` 8 → **8**, whole-frame calls 67 → **67**, triangles 69 639 → **69 639**, all four target dimensions **unchanged**. Control text is `"Bloom strength 2.00"` — no cost claim; a regex for `cost\|saving\|cheaper\|faster` over the whole panel body returns **false**. | **look-only, correctly — claims no saving** |
| **30 FPS target** | inspected, not driven | Row **present**, `data-disabled="true"`, `<select disabled>` with the single option `60`, carrying the visible note `"DEF-3: 30/90/120 deferred — no real pacing mechanism exists, and iOS caps rAF at 60 Hz anyway."` `quality().effective.targetRate = {requested: 60, effective: 60}`. | **explicitly marked deferred — not silently fake.** See §5.4: CONTRACT §9 DEF-3 says *absent*, not present-and-disabled. |

### 1.1 The one measurement that needed a second pass

The first weather A/B read 69 scene calls at density 1 against 68 at density 0 — a clean +1. It
was **not trustworthy**, and the second pass is why this section exists. Over 20 settled frames at
a fixed pose with `freeze(true)` and the sun off, the scene call count still ranged **64–68**
(mean 65.75) at density 1 and **65–67** (mean 65.60) at density 0. `freeze(true)` zeroes the
bird's speed; it does not stop the chase camera and the frustum from drifting. **The unpaired
means differ by 0.15 calls — inside the noise, and a −1 result was reachable.**

The measurement that settles it alternates the slider on **adjacent frames**, so the drift is
common-mode: 18 pairs, deltas
`[1,1,1,1,1,1,0,-2,0,1,1,1,1,1,1,1,1,1]`, median **1**. The weather points are one draw; one draw
is what disappears. Recorded here because A5's second clause ("scene calls decrease") is a
**one-call** signal against a ±2 free-running scene, and any future run of it that samples two
arbitrary frames will flake.

The post-quality control was measured the same way as a positive control: `deltaPasses` was 4 in
**10/10** pairs. A real effect survives this method; a one-call effect only survives it paired.

---

## 2. Item A — A6 is green FOR THE RIGHT REASON

This was the most important thing in the brief and the answer is unambiguous.

**The oracles are untouched.** `sha256sum -c tools/oracle-manifest.txt` → **exit 0, 56 files OK**,
verified before and after every run in this gate. `git status --porcelain` intersects the
manifest's path list at nothing.

**The check now passes:**

```
$ node tools/birb-quality.mjs --check resize-restore    -> exit 0
SC-DPR ok: tier0=1.7 tier1=1
A6 state=pass
   tier0                 ratio=1.7   coherent=true  mismatches=0
   degraded              ratio=0.85  coherent=true  mismatches=0
   resizedWhileDegraded  ratio=0.85  coherent=true  mismatches=0
   restored              ratio=1.7   coherent=true  mismatches=0
   restoredCoherent: true
   matchesExpectedRed: false
```

**And it still fails when the bug comes back.** Two independent flips:

1. `--selftest`'s catalogued page-hook mutation, two fresh boots:
   `M-A6-desync-scene-target -> tier0 step after hook: coherent=false
   mismatches=["bloom.sceneTarget.width"]`, against a baseline boot whose `tier0` was coherent.

2. **The definitive one, run for this gate.** The P2.2 sizing fix is exactly one line —
   `applyTier`'s `updateRendererSize(true)` where HEAD had a bare
   `renderer.setPixelRatio(getQualityPixelRatio(window.devicePixelRatio, DPR_CAP, newTier))`.
   Reverting *only that line*, by Playwright route interception so nothing on disk moves, and
   re-running the four-step sequence transcribed from `captureResizeRestore`:

```
CLEAN TREE   A6 pass    all four steps coherent          exitCodeFor = 0   matchesExpectedRed false
FLIPPED      A6 fail    degraded  coherent=false, 10 mismatches
                        restored  coherent=false, 10 mismatches
                        resizedWhileDegraded coherent=true   <- step 3 still HEALS step 2
                        restoredCoherent = false
                        matchesExpectedRed { matches: true, differences: [] }
                        exitCodeFor = 1
```

The ten mismatched fields are `bloom.sceneTarget.{width,height}`, `bloom.blurA.{width,height}`,
`bloom.blurB.{width,height}`, `bloom.rayTarget.{width,height}`, `weatherPixelRatio`,
`resizeStatePixelRatio` — **EXPECTED-RED.md's manifest, field for field, in both steps 2 and 4**,
with `drawingBufferWidth` and `rendererPixelRatio` correctly absent from the list.

**The assertion was not weakened, `effective()` was not turned into a tautology, and step 3 still
heals step 2 exactly as the manifest says it must.** A6 is green because the code was fixed.

The fix is visible in the control table too: the DPR slider moves `weatherPixelRatio` and
`resizeState.pixelRatio` in lockstep with the drawing buffer, which is the whole content of A6.

---

## 3. Item B — precedence holds across a frame

CONTRACT §7.2 lists five per-frame or per-tier-change writers of quantities the panel now owns:
wind (T4, ~8350), weather density (T5/T6, ~8395), contact shadow (T9, ~8497), ribbons (T10,
~8523), and `applyTier` itself.

Every panel override was cleared first (the panel's own **Reset overrides + history** button), then
`pinTier(2)` — the tier that sheds all of them — and the natural state read off a settled frame:

```
tier 2, no overrides:
  rendererPixelRatio 0.85   weatherPixelRatio 0.85   resizeStatePixelRatio 0.85
  bloom.sceneTarget.width 331   passes 1
  weather.points.visible false   contactShadow.visible false
  visualUniforms.wind.value 0.35   mistBudget 0.35
```

Then, still pinned at tier 2, the panel's Weather density / Decorative density / Mist budget
sliders were set to 1 and Render DPR to 1.7, and **30 consecutive frames** were sampled:

```
tier                  [2]      <- unchanged; the tier is not what moved
rendererPixelRatio    [1.7]
weatherPixelRatio     [1.7]
resizeStatePixelRatio [1.7]
bloom.sceneTarget.w   [663]
wind value            [1]
weather visible       [true]
contactShadow visible [true]
mist budget           [1]
frames                30
```

Every one of those is a **set of size one across 30 frames**. `assertA10` **pass** at n vs n+2 and
again at n vs n+29, over the 7 routed fields this page can read.

Note what this proves beyond A10's two-frame window: `pinTier` runs `applyTier`, which now calls
`updateRendererSize(true)`, which reads `panelOverrides.dpr` first — so a **tier change** also
fails to clobber the panel, not just a frame boundary.

**Not covered:** `ribbonsVisible` is one of `A10_ROUTED_FIELDS` and there is **no reader for it on
`__BIRB`** — `wingRibbons` is a bare local. A10 therefore scored 7 of its 8 fields. The ribbon
branch reads the same `panelOverrides.decorativeDensity` expression as the contact shadow, which
did hold, so this is a coverage gap rather than a suspected failure.

---

## 4. Item C — the production path

Loaded at `http://127.0.0.1:<port>/index.html` — **no query string at all**. This is the shape of
`https://birbmobile.vercel.app`.

```
location.search            ""
typeof window.__BIRB       "undefined"
typeof window.__BIRB_READY "undefined"
panel element              present in the DOM, hidden: true
```

| Route | Result |
|---|---|
| Three-finger hold (600 ms) then release | panel **opened**. `assertA1` **pass** — *"three-finger hold-and-release opened the panel on a page with no ?debug flag."* |
| Two-finger hold, and again after release | panel **stayed closed** in both readings |
| `` ` `` (Backquote) after closing the panel | panel **reopened** |
| `?devpanel` flag (a separate boot) | panel **opened**, and it is not `?debug` |

The panel's telemetry ran live on that load, with the sourceless fields showing the CONTRACT §3.1
literal:

```
Delivered FPS 13.3 · p50/p95/p99 83.4 / 433.3 / 1666.6 ms · Missed-target 100.0%
CPU update / render-submission time  unavailable
GPU time                             unavailable
Scene calls / triangles              61 calls / 75356 tris
Total calls / triangles / passes     61 calls / 75356 tris / 1 passes
Program count 38 · Last adjustment/reason unavailable · Cooldown unavailable
Active mode auto · Pinned state false · Stats path taken renderer-info
Last hypothesis / Measured outcome / Confidence / Recent decisions / Learning  all unavailable
```

(SwiftShader numbers. R6.)

**And a control moved real pixels on that load**, with no debug handle anywhere in the page: the
Render DPR slider took `canvas.width × height` from **331×717 to 390×844**. The page had already
downshifted to tier 2 under SwiftShader, which is why it started at 0.85.

**`?debug` gates only `window.__BIRB`, exactly as the ruling requires.** The G2b STOP condition
"the gesture registered inside the `?debug` block" does **not** fire.

### 4.1 Frame totals at tier ≥ 1 — the other STOP condition, also clear

At `pinTier(2)`: `frameTotals()` reports `calls 66, triangles 75762, passes 1, scene.calls 66`.
Real whole-frame numbers on the no-post branch, not `renderer.info.render`'s post-composite 1.
`--check A8` **pass** at both tier 1 and tier 2. This STOP condition does not fire either.

---

## 5. Findings

### 5.1 BLOCKING — the wave's own suite is still red, on G2a's finding §4.1 verbatim

```
$ BIRB_PERF_IMPL=1 node --test tests/frame-metrics-stats.test.js tests/frame-metrics.test.js \
    tests/quality-settings.test.js tests/gpu-timer.test.js tests/frame-stats-totals.test.js \
    tests/dev-gesture.test.js tests/quality-assertions.test.js tests/build-identity.test.js
# tests 112 / pass 111 / fail 1        exit 1

not ok - FS-A1b the acceptance gate and the controller share one percentile implementation
    51 !== 52
```

`src/game/frame-stats.js` still carries a private `nearestRankPercentile` and still does not import
`percentile` from `frame-metrics.js`; `frame-metrics.percentile` still reads `p` as a fraction only,
so FS-A1b's `percentile(intervals, 95)` clamps to the last index. This is G2a §4.1 unchanged, four
weeks of gate time later, and G2a wrote out the reconciliation that satisfies **both** frozen suites
without touching either (`p > 1` ⇒ treat as a percentage; delete the private helper; import the one
function). It also fixes G2a §4.11 — the 1.94 ms O(n²) acceptance evaluation running inside a panel
whose own contract forbids instrumentation that manufactures the bottleneck.

Green is the deliverable. It is not green. **This is the primary reason for the STOP verdict**, and
it is one edit.

### 5.2 BLOCKING — the named harness cannot run 7 of its 12 assertions, and cannot be fixed

```
$ node tools/birb-quality.mjs --check all      -> exit 1
A4 pass · A6 pass · A7 pass · A8 pass · A9 pass
A1 fail · A2 fail · A3 fail · A5 fail · A10 fail · A11 fail · A12 fail
   "... reports available (<file> on disk) but this harness has no live capturer for it.
    The Wave 2 task that created that file must ship its capturer in the same change."

$ node tools/birb-quality.mjs --selftest       -> exit 1
   23 of 25 mutations detected
   FAIL M-A1-gesture-behind-debug        -> applicable, no live verifier
   FAIL M-A2-panel-opens-on-any-touch    -> applicable, no live verifier
```

The instruction the harness prints is **unsatisfiable**: `tools/birb-quality.mjs` is one of the 56
hashed rows in `tools/oracle-manifest.txt`, and R5 forbids the implementing wave from editing it.
So the moment Wave 2 created `src/ui/dev-quality-panel.js` and `src/ui/dev-gesture.js`,
`checkStaticAvailability()` flipped seven assertions to "available", `LIVE_CAPTURES` had no
capturer for any of them, and the board went from *five green and seven honestly unavailable* to
*five green and seven failing for a harness reason*.

**This is exactly the shape of failure the harness's own G1/F1 comment memorialises, inverted:** a
summary line that is red for a reason that is not the product. It does not launder a green — it
fails loudly — but the practical effect is that **A1, A2, A3, A5, A10, A11 and A12 have no CI
oracle at all**, and every one of them is a G2b question. Everything in §1–§4 above was measured by
this gate writing throwaway Playwright code against the frozen `ASSERTIONS` table. That is not a
repeatable check; it is a gate agent's notebook.

**I am naming this rather than editing the harness (R5), and I implemented against it.** G2c needs
a decision: either add the seven capturers to `birb-quality.mjs` and re-freeze the manifest as a
recorded gate action, or put them in a new, unfrozen `tools/lib/quality-captures.mjs` the harness
already knows how to reach. The second is cheaper and keeps R5 intact for Wave 3.

### 5.3 GATE DECISION REQUIRED — `EXPECTED-RED.md` no longer describes the tree

`docs/perf/EXPECTED-RED.md` §4 anticipated this precisely and made its own revision a gate
decision, so this section is that decision being *raised*, not taken:

- On this tree `--check resize-restore` exits **0**, A6 is **pass**, and `matchesExpectedRed()`
  returns `matches: false` with six differences — the file's own stated post-fix expectation.
- §2 above supplies the evidence the file asks for before it may be revised: on a tree with the
  sizing fix reverted, the manifest still reproduces **field for field, `differences: []`**.

Note that `tests/quality-assertions.test.js::QA-A6-RED` did **not** go red at this moment, contrary
to what §4 of EXPECTED-RED predicts. It runs `ASSERTIONS.A6.run(headResizeRestore())` — a **static
fixture**, not a live capture — so it is an oracle for the *assertion*, never for the tree. Both it
and `QA-A6-FIXED` pass, correctly. Whoever revises EXPECTED-RED.md should not expect a red test to
tell them when to.

### 5.4 CONTRACT §9 DEF-3 deviation, unrecorded

DEF-3, verbatim: *"Until then the row is absent from the panel — not present-and-disabled."* The
panel ships it present-and-disabled, with a visible reason. `CONTROL_REGISTRY`'s own comment argues
the opposite case from CONTRACT §3.3's reasoning about sentinel telemetry rows.

The implementation's behaviour is **honest** — a disabled single-option select carrying
"DEF-3: 30/90/120 deferred" cannot be mistaken for a working 30 fps mode, and
`quality().effective.targetRate` reports `{requested: 60, effective: 60}` with no fabricated 30
anywhere. My brief's bar ("absent or explicitly marked, not silently fake") is met. But CONTRACT
§9 is binding and its amendment rule requires a recorded gate decision, and none was recorded.
Add the DEF-3 row amendment, or move the row out.

The same applies, without comment, to `not-webgl2`: `src/game/gpu-timer.js` returns it as a
`reason`, and it is not in CONTRACT §3.1's closed enum. G2a §4.8 already flagged that the contract
row needs the added value; it still does. (Measured on this tree: WebGL2 present, extension absent
⇒ the reason is `no-extension`, the legitimate platform fact, **not** the `no-context` STOP.)

### 5.5 MAJOR — G2a §4.10's per-frame allocation is now LIVE

`createIntervalRecorder().sample()` allocates a fresh record object literal every call
(`src/game/frame-metrics.js`, `const record = { dtMs, tMs, valid, invalidReason }`), plus a second
literal on every hitch. G2a flagged it at 610 KB per 60 000 calls when the module was not yet wired
to anything. `index.html`'s `renderFrame` now calls it **once per frame, unconditionally**. House
rule 4: *"reuse objects with `_` prefix, never allocate in update()"*. The ring is already
`new Array(capacity)`; filling it with records once in the factory and mutating fields is the fix,
and it makes `__buffers()` returning live buffers easier, not harder.

I could not put a number on it in the browser: a heap probe over 600 live frames read a delta of
**0 bytes**, which is `performance.memory`'s granularity and the GC, not evidence of no
allocation. Could-not-determine by measurement; unambiguous in source.

### 5.6 MAJOR — A11 is graded against a list the implementation supplies

`assertA11` takes `sentinelFields` from the snapshot, and the only available source is
`__BIRB.quality().sentinelFields`, which the implementation writes. It contains **two** entries:
`cooldown` and `lastAdjustment.reason`. A11 passed over those two.

TEL-4 (CPU update / submission time), TEL-5 (GPU time) and PNL-1…PNL-6 are all sourceless in Wave 2
and none of them appears in `quality()` at all, so A11 cannot see them. **An implementation that
omitted a field from its own list would pass A11 trivially** — the precise self-grading shape the
programme exists to prevent.

The product itself is honest, verified independently for this gate: the panel renders all eight of
those rows as the literal `"unavailable"` (§4), and the evidence export runs
`collectTelemetrySnapshot()`, which iterates `FIELD_REGISTRY` and emits
`{value: null, state: 'unavailable', reason}` for every id it is not given — so the GPU timer's
reason *is* serialised where CONTRACT §3.1 says it should be (export, not display). The defect is
in the coupling, not the behaviour. Wave 3 should derive the sentinel list from CONTRACT §3.2/§3.3
on the harness side.

### 5.7 MINOR — "Reset overrides" changes the look instead of restoring it

`panelOnRequest`'s `reset` action calls `bloomPass.setStrength(0.85)`, commented
*"bloom-pass.js constructor default"*. The live value before any panel interaction measured
**0.78**. So Reset moves bloom strength from 0.78 to 0.85 on a page that never touched the slider.
Small, but a reset that does not reset is worth an assertion of its own later.

### 5.8 MINOR — "Active mode: auto" while seven overrides are in force

`TEL-15` reads `qualitySettings.mode`, which is the right source (CONTRACT §3.2 forbids only
*inferring* it from `isPinned()`). But after driving six sliders and a select, the panel still
reads **Active mode: auto**, because a control request does not itself enter Manual. A reader is
told the adaptive tier is in charge of quantities it can no longer write. `requested` in the export
does disclose them. Worth settling in Wave 3, when Manual/Benchmark actually gate the policy
machine.

### 5.9 MINOR — GAP-A2 is still open

`sprintState.active` has no reader on `__BIRB`, so `assertA2` returns
`unavailable / not-implemented` — *"Half of A2 is unreadable, so A2 as a whole is unreadable."*
I verified the first half directly (two fingers left the panel closed, during the hold and after
release). Note for whoever closes it: `updateSprintState` only engages the sprint in
`GAME_MODES.RING_RUSH`, so the check needs a mode switch as well as a reader.

### 5.10 NOTE — the `npm test` invariant moved, legitimately

```
$ npm test            (BIRB_PERF_IMPL unset)
# tests 464 / pass 378 / fail 0 / skipped 86     exit 0
```

The wave brief pins 460/378/0/82. The delta is exactly `tests/build-identity.test.js` — 4 tests,
all skipped when the env is unset — which CONTRACT §8.3 **SW-2 names by that filename** and §8.4
assigns to W2. Pass count, fail count and exit code are unchanged; the four siblings (`humanoid`,
`gauntlet`, `sculpture`, `icon3d`) are untouched. This is a contract-required addition, not a
regression, but the invariant quoted to later waves should be restated as **464 / 378 / 0 / 86**.

---

## 6. What passed, stated plainly

- **Oracles untouched.** `sha256sum -c tools/oracle-manifest.txt` exit 0, 56 files, before and
  after every run in this gate. No `tests/**`, no `tools/lib/**`, no `tools/birb-*.mjs`, no
  `CONTRACT.md` in `git status`.
- **Every control in the brief is wired to rendering work**, measured on the live page through the
  real DOM control, and the one control that is a look adjustment says so and claims nothing else.
- **A6 green for the right reason**, proved by reverting the one-line fix and watching the manifest
  reproduce field for field.
- **Precedence holds for 30 frames and across a tier change**, against five writers.
- **The production path is real**: panel + gesture + keyboard + `?devpanel`, all with
  `window.__BIRB === undefined` on the same load, and a control that moves the drawing buffer there.
- **Frame totals are reported at tier ≥ 1** (66 calls / 75 762 tris / 1 pass at tier 2).
- `node tools/birb-shaders.mjs` → **exit 0**, "all shaders compile in 4 environments".
- `node tools/birb-modes.mjs` → **exit 0**, "all 5 modes ok in forest", all five modes with
  18/18 rings, 3 lives, nesting reached. **Console warnings are failures for that tool and it is
  green.** The only warnings any of my own runs produced were SwiftShader driver messages
  (`GPU stall due to ReadPixels`); zero console errors and zero page errors on every boot.
- `node tools/req-verify.mjs` → **exit 0**.
- **No `console.*` in any of the five new `src/` modules**, and no new `console.*` anywhere in the
  `index.html` diff. No new `new` on a per-frame path in `index.html` (the two additions are the
  gesture's `CustomEvent` and a load-time `URLSearchParams`). The panel does no DOM work while
  closed — its 4 Hz interval is created in `openPanel()` and cleared in `close()`.
- `sw.js` `CACHE_VERSION` and `index.html` `BIRB_BUILD` both read `v43-2026-09-09-perf-workbench`,
  all five new modules are in `CORE_ASSETS`, and `assertA12` passed against a live controlling
  service worker with `serving === requested`.
- **The GPU timer reports the platform fact, not the wiring bug.** WebGL2 present, extension
  absent ⇒ `no-extension`. `no-context` — CONTRACT §3.1's STOP — did not occur.

---

## 7. Verdict

**STOP.** None of G2b's three named STOP conditions fired: no control is a label, frame totals are
reported at tier ≥ 1, and the gesture is not inside the `?debug` block. On the question this gate
exists for, the wave is **good work** — the sizing fix is real and provably still catchable, the
routing register is genuinely routed, and the workbench reaches the phone.

It stops on two things instead:

1. **§5.1** — `BIRB_PERF_IMPL=1` is red on FS-A1b, the same two-percentile-implementations defect
   G2a blocked on, with the reconciliation already written down. One edit.
2. **§5.2** — the harness the contract names as the single oracle (R7) cannot run seven of its
   twelve assertions, including every assertion covering the controls, the precedence and the
   production path. `--selftest` and `--check all` both exit 1 for a harness reason. Everything in
   §1–§4 of this document was therefore measured by hand and is not repeatable in CI.

§5.3 (revise `EXPECTED-RED.md`) and §5.4 (record the DEF-3 amendment) are gate decisions to take,
not defects to fix. §5.5 and §5.6 should land before Wave 3 builds the policy machine on top of
them.
