# EXPECTED-RED — what `birb-quality --check resize-restore` must report failing on HEAD

> ## SUPERSEDED — the bug this file describes is FIXED (G2d gate decision, Wave 2R)
>
> `--check resize-restore` now exits **0** and A6 reports **pass**: all four steps are
> coherent, including `restored`. Wave 2's single sizing function (P2.2b) closed the
> `applyTier`/bloom/weather desync this manifest was written to pin down, and G2b proved
> the causation by reverting that one change and watching A6 go red again.
>
> **This file is retained as the historical record of the defect, not as a live expectation.**
> §4 of this document required that any revision be a gate decision rather than a harness
> convenience; G2c §7.1 authorised it and G2d took it.
>
> Two things it still governs, and they are the reason it is not deleted:
>
> 1. **`EXPECTED_RED_HEAD` in `tools/lib/quality-assertions.mjs` still encodes these values**,
>    and `matchesExpectedRed()` therefore now reports `matches: false` with the differences
>    listed. That is correct and expected: the tree no longer matches the broken manifest.
>    The frozen assertion was not edited to make it agree — R5 — and `--check resize-restore`
>    scores A6 on coherence, not on matching this file.
> 2. **The four-step sequence in §1 is still the required shape of the check.** A run
>    truncated at step 2 is red today for the right reason and would go green forever the
>    moment anyone touched the sizing path. If A6 is ever rewritten, it keeps all four steps.
>
> If A6 goes red again, this manifest is the description of the bug that came back.


Wave 1 / task **P1.2** of [docs/ULTRACODE_PERFORMANCE_PLAN.md](../ULTRACODE_PERFORMANCE_PLAN.md) §4.
Authority for everything below: [`CONTRACT.md`](CONTRACT.md) §4 (A6), §5.1 (harness context),
§7.2 (the routing register). Machine-readable twin: `EXPECTED_RED_HEAD` in
[`tools/lib/quality-assertions.mjs`](../../tools/lib/quality-assertions.mjs), pinned by
`tests/quality-assertions.test.js` (`QA-A6-RED`).

- **Captured against:** branch `claude/ultracode-sub-agents-plan-c9qmba`, working tree at
  Wave 0's `2cba6c4` (`index.html` 9624 lines + the P0.2 probes).
- **Captured how:** Playwright/Chromium/SwiftShader through `tools/birb-shot.mjs`'s own
  `startServer` / `startGame` helpers, at the CONTRACT §5.1 context
  (`390×844`, `deviceScaleFactor: 3`, `isMobile: true`, `hasTouch: true` ⇒ `DPR_CAP = 1.7`).
  Exit code 0, no page errors, no console errors. Raw log in §3.
- **R6:** every number here is a *dimension*, not a frame time. Nothing in this file is a
  device claim and nothing in it depends on how fast SwiftShader renders.

---

## 0. Why this file is the one that is easy to get subtly wrong

> - if `--check resize-restore` **passes** on HEAD, it is the wrong check and this wave has failed;
> - if it fails for any **other** reason, it is a false oracle and will license nine cheap tasks wrongly.

Both failure modes are reachable, and the second is reachable by an agent who is being careful.
`applyTier()` (index.html 6523/6526/6529) calls `renderer.setPixelRatio(...)` **and nothing else** —
not `resizeState`, not `bloomPass.setSize`, not `weather.setPixelRatio`. So a naive check that
degrades one tier and looks at `effective()` is red immediately, at **step 2**, for a reason that
is entirely genuine.

And it is worthless. **Step 3 heals step 2.** An ordinary canvas resize runs
`updateRendererSize()` (6822), which re-sizes the renderer, the bloom targets, the weather
uniform and `resizeState` together at whatever ratio the *current* tier asks for. Measured:
after resizing while pinned at tier 2, every field agreed at 0.85. So a check truncated at
step 2 is red today for the right reason and goes **green forever** the moment the Wave 2 sizing
fix lands, catching nothing thereafter — a green row that certifies a bug it can no longer see.

The permanent mismatch is **step 4**. Restoring the tier raises the renderer to 1.7 while every
offscreen target keeps the 0.85 sizes step 3 baked in, and nothing schedules another resize.
Measured: still desynced 2 seconds and 10 further frames later.

`assertA6` therefore refuses a run with fewer than four steps (`state: "invalid"`), refuses a run
whose CSS size did not change exactly once and exactly between steps 2 and 3, and refuses a run
whose tier did not go down at step 2 and back at step 4. Those guards exist because the four step
*labels* are supplied by the harness, and a mislabelled sequence is otherwise indistinguishable
from a correct one.

---

## 1. The sequence — all four steps, in order

| Step | id | Action | Tier | Canvas CSS | Requested pixel ratio |
|---|---|---|---|---|---|
| 1 | `tier0` | `__BIRB.pinTier(0)`, let the boot resize settle | 0 | 390×844 | `getQualityPixelRatio(3, 1.7, 0)` = **1.7** |
| 2 | `degraded` | `__BIRB.pinTier(2)` — **no resize** | 2 | 390×844 | `getQualityPixelRatio(3, 1.7, 2)` = **0.85** |
| 3 | `resizedWhileDegraded` | `page.setViewportSize({width:360,height:780})`, wait for the `ResizeObserver` → rAF → `updateRendererSize()` | 2 | 360×780 | **0.85** |
| 4 | `restored` | `__BIRB.pinTier(0)` — **no resize** | 0 | 360×780 | **1.7** |

Notes the harness author must not improvise around:

- The tier is **pinned** at every step (CONTRACT §4.2: the adaptive tier otherwise moves under
  the measurement). `pin()` latches and there is no unpin, which is fine here — every step pins.
- `pinTier(n)` where `n` already equals the current tier is a **no-op**: `applyTier` returns early
  on `newTier === state.tier`. Step 1 must therefore not be relied on to *cause* a resize; the
  boot's own `scheduleRendererResize(true)` is what sizes everything at 1.7.
- Step 3 must be a **real** canvas size change. `canvas` is `width:100%;height:100%` of
  `.canvas-wrapper`, so changing the viewport is enough; the observer is on the canvas.
- Step 3 must wait for the rAF that `scheduleRendererResize` schedules. Reading `effective()`
  in the same tick reports the pre-resize state and produces a *false* step-3 failure — which is
  the "fails for another reason" trap in its most likely concrete form.
- Steps 2 and 4 must **not** be followed by a resize of any kind. A resize after the restore
  re-syncs everything and hides the bug.

Expected sizes are `Math.floor(css × ratio)` for the drawing buffer and the scene target, and
`Math.floor(scene / downscale)` for the three blur targets, with `downscale = 2`
(`src/effects/bloom-pass.js:316-325`, `THREE.WebGLRenderer.setSize`). `844 × 1.7 = 1434.8 → 1434`
and `390 × 0.85 = 331.5 → 331` are the two places `floor` differs from `round`.

---

## 2. Field-by-field manifest

`effective()` fields as CONTRACT §3.2 TEL-6/7/17/18 define them. **✓** = agrees with the
requested ratio; **✗** = mismatch, and that field name must appear in the reported
`mismatches` array for that step.

### Step 1 — `tier0` · requested ratio **1.7** · css 390×844 · **coherent, must PASS**

| Field | Expected | Actual on HEAD | |
|---|---|---|---|
| `rendererPixelRatio` | 1.7 | 1.7 | ✓ |
| `drawingBufferWidth` | 663 | 663 | ✓ |
| `drawingBufferHeight` | 1434 | 1434 | ✓ |
| `bloom.sceneTarget.width` | 663 | 663 | ✓ |
| `bloom.sceneTarget.height` | 1434 | 1434 | ✓ |
| `bloom.blurA/blurB/rayTarget.width` | 331 | 331 | ✓ |
| `bloom.blurA/blurB/rayTarget.height` | 717 | 717 | ✓ |
| `weatherPixelRatio` | 1.7 | 1.7 | ✓ |
| `resizeStatePixelRatio` | 1.7 | 1.7 | ✓ |

`mismatches: []` · `coherent: true`

### Step 2 — `degraded` · requested ratio **0.85** · css 390×844 · **INCOHERENT, 10 fields**

| Field | Expected | Actual on HEAD | |
|---|---|---|---|
| `rendererPixelRatio` | 0.85 | 0.85 | ✓ |
| `drawingBufferWidth` | 331 | 331 | ✓ |
| `drawingBufferHeight` | 717 | 717 | ✓ |
| `bloom.sceneTarget.width` | 331 | **663** | ✗ |
| `bloom.sceneTarget.height` | 717 | **1434** | ✗ |
| `bloom.blurA.width` / `blurB.width` / `rayTarget.width` | 165 | **331** | ✗ |
| `bloom.blurA.height` / `blurB.height` / `rayTarget.height` | 358 | **717** | ✗ |
| `weatherPixelRatio` | 0.85 | **1.7** | ✗ |
| `resizeStatePixelRatio` | 0.85 | **1.7** | ✗ |

`mismatches:` `bloom.sceneTarget.width`, `bloom.sceneTarget.height`, `bloom.blurA.width`,
`bloom.blurA.height`, `bloom.blurB.width`, `bloom.blurB.height`, `bloom.rayTarget.width`,
`bloom.rayTarget.height`, `weatherPixelRatio`, `resizeStatePixelRatio` · `coherent: false`

> `rendererPixelRatio` and the drawing buffer are **correct** here, because
> `THREE.WebGLRenderer.setPixelRatio` internally re-runs `setSize` on the stored CSS size.
> Anyone hunting this bug by watching the canvas dimensions will find nothing at all.

### Step 3 — `resizedWhileDegraded` · requested ratio **0.85** · css 360×780 · **coherent, must PASS**

| Field | Expected | Actual on HEAD | |
|---|---|---|---|
| `rendererPixelRatio` | 0.85 | 0.85 | ✓ |
| `drawingBufferWidth` / `Height` | 306 / 663 | 306 / 663 | ✓ |
| `bloom.sceneTarget.width` / `height` | 306 / 663 | 306 / 663 | ✓ |
| `bloom.blur*/rayTarget.width` / `height` | 153 / 331 | 153 / 331 | ✓ |
| `weatherPixelRatio` | 0.85 | 0.85 | ✓ |
| `resizeStatePixelRatio` | 0.85 | 0.85 | ✓ |

`mismatches: []` · `coherent: true`

**This step passing is load-bearing.** It is the evidence that step 2's failure is transient and
that a two-step check is worthless. If step 3 ever reports a mismatch on HEAD, this manifest no
longer describes the tree and the check must be re-derived before it is trusted.

### Step 4 — `restored` · requested ratio **1.7** · css 360×780 · **INCOHERENT, 10 fields — THE PERMANENT ONE**

| Field | Expected | Actual on HEAD | |
|---|---|---|---|
| `rendererPixelRatio` | 1.7 | 1.7 | ✓ |
| `drawingBufferWidth` | 612 | 612 | ✓ |
| `drawingBufferHeight` | 1326 | 1326 | ✓ |
| `bloom.sceneTarget.width` | 612 | **306** | ✗ |
| `bloom.sceneTarget.height` | 1326 | **663** | ✗ |
| `bloom.blurA.width` / `blurB.width` / `rayTarget.width` | 306 | **153** | ✗ |
| `bloom.blurA.height` / `blurB.height` / `rayTarget.height` | 663 | **331** | ✗ |
| `weatherPixelRatio` | 1.7 | **0.85** | ✗ |
| `resizeStatePixelRatio` | 1.7 | **0.85** | ✗ |

`mismatches:` the same ten field names as step 2 · `coherent: false`

**What this is, in the game.** The renderer draws the world at 1.7, the bloom pass composites it
from a target sized for 0.85, and the whole frame is therefore presented at 36% of the pixels it
paid for — permanently, until the next real resize. `weather`'s `uPixelRatio` is half what
`gl_PointSize` needs, so every snowflake and mote is drawn at half size. And **nothing recovers
it**: `updateRendererSize` is only ever called from `scheduleRendererResize`
(index.html 6875/6885), never from the render loop.

### The check's verdict

```
A6  state: fail
    tier0                  coherent=true   mismatches=[]
    degraded               coherent=false  mismatches=[10 fields]
    resizedWhileDegraded   coherent=true   mismatches=[]
    restored               coherent=false  mismatches=[10 fields]
    restoredCoherent: false
```

`matchesExpectedRed(verdict)` must return `{ matches: true, differences: [] }`.
`exitCodeFor([verdict])` must return **1**.

---

## 3. The raw capture this manifest was written from

Reproduce with the CONTRACT §5.1 context, through `birb-shot.mjs`'s own helpers
(`startServer`, `findChromium`, `installCdnCache`, `CHROMIUM_ARGS`, `startGame`) — do not write a
second boot path (R7). Run to a log, capture `$?`, assert the code, then grep the log (R2).

```
boot      rpr=1     DB=390x844    scene=663x1434 blur=331x717 weather=1.7  resize=1.7  tier=1 pinned=false
step1     rpr=1.7   DB=663x1434   scene=663x1434 blur=331x717 weather=1.7  resize=1.7  tier=0 pinned=true
step2     rpr=0.85  DB=331x717    scene=663x1434 blur=331x717 weather=1.7  resize=1.7  tier=2 pinned=true
step3     rpr=0.85  DB=306x663    scene=306x663  blur=153x331 weather=0.85 resize=0.85 tier=2 pinned=true   css 360x780
step4     rpr=1.7   DB=612x1326   scene=306x663  blur=153x331 weather=0.85 resize=0.85 tier=0 pinned=true
step4+2s  rpr=1.7   DB=612x1326   scene=306x663  blur=153x331 weather=0.85 resize=0.85 tier=0 pinned=true
```

Exit code 0. No page errors, no console errors.

Running the real `assertA6` over exactly those readings, live in the page, gives:

```
SC-DPR ok: tier0=1.7 tier1=1

A6 state=fail
   tier0                  ratio=1.7  coherent=true  mismatches=0
   degraded               ratio=0.85 coherent=false mismatches=10
   resizedWhileDegraded   ratio=0.85 coherent=true  mismatches=0
   restored               ratio=1.7  coherent=false mismatches=10
   matchesExpectedRed: true []
   restoredCoherent: false

A4 state=pass — blurA/blurB/rayTarget are all 331x717 = sceneTarget / 2.
A7(rays off) state=pass — 75 whole-frame calls against 71 scene calls, 5 passes with rays off.
A7(rays on)  state=pass — 68 whole-frame calls against 61 scene calls, 8 passes with rays on.
A9 state=pass — before=8 after=6,5,5,5 and stayed collapsed.
A8(tier1) state=pass — one pass, 61 whole-frame calls equal to the scene.
A8(tier2) state=pass — one pass, 59 whole-frame calls equal to the scene.

M-A6-desync-scene-target: page hook installed; step tier0 now coherent=false
   mismatches=[bloom.sceneTarget.width]  (was coherent=true)

mutations: 24 catalogued, 22 applicable
unavailable-on-HEAD rows: A1=invalid A2=unavailable/not-implemented
   A3=unavailable/not-implemented A5=unavailable/not-implemented
   A10=unavailable/not-implemented A11=unavailable/not-implemented
   A12=unavailable/not-implemented

exitCodeFor(all) = 1
```

The draw-call totals move run to run (the bird is somewhere else, and the world is unseeded until
P2.1e) — which is exactly why every assertion above compares a *relation* between two numbers from
the same frame, never a number against a constant. The dimensions do not move, and those are what
A6 asserts.

Putting the sun on screen for the `A7(rays on)` and `A9` rows is not free and cost four attempts;
the measured recipe and the three traps around it are in
[ASSERTIONS.md §2](ASSERTIONS.md#2-what-was-measured-and-the-four-things-that-were-surprising).

**The `boot` row is a finding, and it is not the check.** On HEAD the desync is already present
before any of the four steps: `startGameLoop` sizes everything at tier 0's 1.7, the adaptive tier
then downshifts to 1 on measured frame rate, and `applyTier` moves the renderer alone — leaving
bloom and weather at 1.7 while the renderer draws at 1.0. That is the same bug, arrived at without
touching anything. It is deliberately **not** what `--check resize-restore` asserts, because it
depends on SwiftShader being slow enough to trigger a downshift; a phone holding 60 fps would boot
coherent and the check would flake. Pinned steps are what make the oracle deterministic.

---

## 4. Acceptance rules for this check

**On HEAD (Wave 1, and until the P2.2 sizing fix lands):**

1. `--check resize-restore` exits **1**.
2. Its A6 verdict is `state: "fail"`.
3. All four steps are present, in order, with the CSS size changing exactly once, between
   steps 2 and 3. A run of fewer than four steps is `state: "invalid"` and also exits 1 — but it
   is a **harness** defect and must be reported as one, never as evidence of the product bug.
4. `matchesExpectedRed()` returns `matches: true`.
5. **`restored.coherent === false`.** This is the row a gate reads first. A verdict in which only
   `degraded` fails is a truncated check wearing a correct-looking red bar.

**After the Wave 2 sizing fix (P2.2):** all four steps coherent, A6 `pass`, exit 0, and
`matchesExpectedRed()` returns `matches: false` — a fixed tree must not match this manifest.
`tests/quality-assertions.test.js::QA-A6-RED` will go **red** at that moment, on purpose:
revising this file is a **gate decision recorded in `docs/perf/gates/`**, not a harness convenience.
The fixed expectations are already written down in that test as `fixedResizeRestore()`
(step 2: scene 331×717, blur 165×358, weather/resizeState 0.85; step 4: scene 612×1326,
blur 306×663, weather/resizeState 1.7), so the revision is a swap, not a re-derivation.

**A6 is a check on `effective()`, and `effective()` is a Wave 0 probe.** If a later wave changes
what `effective()` reads — recomputing any field from `tier` or `DPR_CAP` instead of off the live
object — this check silently becomes a tautology that can never fail. G0 rejected exactly that
once already. Any edit to `__BIRB.effective()` re-opens this file.
