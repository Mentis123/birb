# Performance workbench + adaptive controller — the contract

Wave 0 / task **P0.3** of [docs/ULTRACODE_PERFORMANCE_PLAN.md](../ULTRACODE_PERFORMANCE_PLAN.md) §4,
implementing [docs/PERFORMANCE_REALISM_PLAN.md](../PERFORMANCE_REALISM_PLAN.md).
Companion machine-readable file: [`requirements.json`](requirements.json).
Baseline this is asserted against: [`BASELINE.md`](BASELINE.md).

- **Authored against:** branch `claude/ultracode-sub-agents-plan-c9qmba`, commit `63959d6`
  (`index.html` = 9624 lines at that commit; the working tree at authoring time
  additionally carried the P0.2 probe edits and was 9703 lines).
- **Status:** binding on Waves 1–6. Every later wave implements *against this file*.
- **Amendment rule:** a wave may add rows. A wave may not silently change a comparator,
  a sentinel, a precedence order or a provisional number's provenance. Changing one of
  those is a gate decision, recorded in `docs/perf/gates/G<n>.md`.

> **What this document is for.** Cheap-tier agents are permitted to *transcribe* from
> here and forbidden to *decide*. Anything not written down here becomes a fabricated
> constant three waves later. Two things in this repo's own history are the reason:
> the 55/58 adaptive thresholds were tuned against a sampler that could not run, and
> the bloom pass was gated off on every iPhone by a probe nobody checked the return
> value of. Both were green the whole time.

---

## 0. Vocabulary, fixed here and used everywhere

| Term | Meaning in this programme |
|---|---|
| **requested** | A value some layer *asked for* — a panel slider, a tier decision, `DPR_CAP`. |
| **effective** | A value read back off the live object that renders — `renderer.getPixelRatio()`, `gl.drawingBufferWidth`, `target.width`. Never recomputed from intent. |
| **desync** | requested ≠ effective. This programme exists because of one (see §4, A6). |
| **sentinel** | The explicit "there is no source for this" value. Never `0`, never a plausible default. See §3.1. |
| **provisional** | A number the source plan marks "tune these numbers on phones". Provenance `unmeasured`, unlocked by Wave 4. See §10. |
| **shipped-unvalidated** | A number already live in `index.html` that was never validated against a working measurement (55/58 and friends). Not the same as `measured`. |
| **settled frame** | A frame on which the condition being asserted held on the previous frame too. Required by A7/A9 — see §4.1. |

---

## 1. The `adaptiveTier` callsite map — a SET, not a line count

Fifteen occurrences on fourteen lines at `63959d6`; the `pinTier` line carries two.
**A count pinned to a file that eight later tasks edit is not an oracle**, so each row
below is anchored by a *verbatim, unique* source fragment and by what the site
semantically is. Line numbers are provenance, not identity.

### 1.1 Re-derivation

```bash
# Membership check. Compare the SET, not the count.
grep -n 'adaptiveTier\.' index.html
# At 63959d6: 14 matching lines, 15 occurrences.
grep -c 'adaptiveTier\.' index.html          # 14  (lines)
grep -o 'adaptiveTier\.' index.html | wc -l  # 15  (occurrences)
```

At `63959d6` the occurrence breakdown is `getTier` ×12, `sampleFps` ×1, `pin` ×1,
`isPinned` ×1. Any wave that adds or removes a row updates §1.2 **and**
`requirements.json`'s `adaptiveTierSites` array in the same commit.

### 1.2 The set

R = reads the tier. W = writes/controls it. Precedence class per §7.

| # | Anchor (verbatim, unique at `63959d6`) | HEAD line | Scope | R/W | What it decides | Must be routed in |
|---|---|---|---|---|---|---|
| **T1** | `if (bloomPass && bloomEnabled && adaptiveTier.getTier() < 1) {` | 4440 | `presentFrame()` | R | **The bloom pass itself is shed at tier ≥ 1.** This is a render gate, not a stats gate — the no-post branch below it is why `frameTotals()` had to exist. | W2 (P2.2 sizing) |
| **T2** | `adaptiveTier.sampleFps(fps, time)` | 6491 | `updateFpsReadout()` | W | The controller's **only** input today. Fed at the 250 ms `frameSampler` cadence, i.e. ~4 Hz, not per frame. | W3 (P3.3 — feed per frame at the top of the loop) |
| **T3** | `const pixelRatio = getQualityPixelRatio(window.devicePixelRatio, DPR_CAP, adaptiveTier.getTier())` | 6787 | `updateRendererSize()` | R | Renderer DPR + bloom target sizes + weather `uPixelRatio` on any resize. | W2 (P2.2 single sizing function) |
| **T4** | `visualUniforms.wind.value = reducedMotionState.enabled ? 0 : adaptiveTier.getTier() >= 2 ? 0.35 : 1` | 8350 | render loop | R | Wind strength. **Written every frame.** | W2 (P2.2/G2b precedence) |
| **T5** | `const tier = adaptiveTier.getTier();` | 8391 | weather block, render loop | R | Feeds T6. **N.B. this anchor is NOT unique in the working tree** once `frameTotals()` lands — disambiguate by enclosing block (`if (weather && birdPos) {`). | W2 |
| **T6** | *(same line as T5's consumer)* `weather.setDensity(… tier >= 2 ? 0 : tier === 1 ? 0.5 : 1)` | 8395 | weather block | R | Weather density. **Written every frame.** | W2 |
| **T7** | `if (mistBudgetTier !== adaptiveTier.getTier()) {` | 8474 | render loop | R | Change-detect guard for T8. | W2 |
| **T8** | `mistBudgetTier = adaptiveTier.getTier();` | 8475 | render loop | R→cache | Waterfall mist budget (0.35 / 0.65 / 1). Applied on tier change only. | W2 |
| **T9** | `const shadowOn = !!birdPos && !isNested && adaptiveTier.getTier() < 2` | 8497 | contact-shadow block | R | Contact shadow on/off. **Written every frame.** | W2 |
| **T10** | `&& adaptiveTier.getTier() < 2 && birbAnchor?.visible !== false` | 8523 | wingtip-ribbon block | R | Ribbon trails on/off. **Written every frame.** | W2 |
| **T11** | `return { enabled: bloomEnabled, present: !!bloomPass, tier: adaptiveTier.getTier() };` | 9366 | `__BIRB.setBloom` | R | Reporting only. | — |
| **T12** | `pinTier: (tier = 0) => { adaptiveTier.pin(tier); return adaptiveTier.getTier(); },` | 9427 | `__BIRB.pinTier` | **W + R** | **Two occurrences on one line.** The only external write. Sets `state.pinned` and there is **no unpin**. | W2 (P2.3 panel: Resume Auto) |
| **T13** | `calls: (bloomPass && bloomEnabled && adaptiveTier.getTier() < 1)` | 9482 | `__BIRB.stats` | R | Chooses `bloomPass.frameStats` vs `renderer.info.render`. | W2 |
| **T14** | `triangles: (bloomPass && bloomEnabled && adaptiveTier.getTier() < 1)` | 9484 | `__BIRB.stats` | R | As T13. | W2 |
| **T15** | `tier: adaptiveTier.getTier(),` | 9493 | `__BIRB.stats` | R | Reporting only. **Anchor is duplicated in the working tree** by `frameTotals()` — disambiguate by enclosing key (`stats:` vs `frameTotals:`). | — |

**Two sites the map deliberately does not contain**, because they are inside the IIFE
and not reachable through the `adaptiveTier.` handle. Both still write rendering state
and both are in scope for §7:

- `applyTier()` — three `renderer.setPixelRatio(getQualityPixelRatio(window.devicePixelRatio, DPR_CAP, newTier))`
  calls (HEAD 6523/6526/6529, one per tier branch) plus `cloudShell.mesh.visible`.
  **`applyTier` sets the renderer's pixel ratio and nothing else**: it does not touch
  `resizeState`, `bloomPass.setSize` or `weather.setPixelRatio`. That is the live desync.
- `state.pinned` — set by `pin()`, read by `isPinned()`, checked at the top of `sampleFps`.

### 1.3 Facts about `adaptiveTier` that later waves must not re-derive by guessing

- Constants (HEAD 6509–6513): `LOW_FPS_THRESHOLD = 55`, `RESTORE_FPS_THRESHOLD = 58`, `LOW_WINDOW_MS = 2000`,
  `HIGH_WINDOW_MS = 4000`, `MIN_INTERVAL_MS = 1500`. All `shipped-unvalidated` (§10).
- The averaging window is **selected by the current tier** (`state.tier >= 1 ? HIGH_WINDOW_MS : LOW_WINDOW_MS`, HEAD 6549),
  so at tier 1 a *further downshift* waits the 4 s recovery window. This is GAP-2.
- `sampleFps` averages `fps` values that are themselves 250 ms window averages.
  **Percentiles over that are meaningless** — P2.1 must add raw per-frame intervals.
- `pin(tier)` calls `applyTier` then latches `state.pinned = true`. **There is no unpin.**
- `isPinned()` exists (HEAD 6576) and is exposed on `stats().pinned` as of P0.2.
- Tier semantics as shipped: 0 = DPR ≤ `DPR_CAP` + bloom on + cloud shell on;
  1 = DPR 1.0, bloom **off**, cloud shell off, weather 0.5, mist 0.65;
  2 = DPR 0.85, no contact shadow, no ribbons, wind 0.35, weather 0, mist 0.35.

---

## 2. Reset tags, and `paused` as a validity state

Source: PERFORMANCE_REALISM_PLAN.md §"How intelligent up/down shifting should work" step 7 —
*"Reset all relevant history after bounded, explicitly tagged loading/resume/resize events.
Do not erase recurrent gameplay hitches."* — and the Workbench section —
*"Mark paused measurements invalid for adaptive decisions."*

### 2.1 The reset tag enum (closed set)

Every history reset carries **exactly one** tag from this set. An untagged reset is a
contract violation. The tag is recorded in the action history and in the evidence export.

| Tag | Fires when | Existing callsite at `63959d6` | Notes |
|---|---|---|---|
| `load` | First frames after the loop starts (Tap-to-Start / `startGameLoop`). | `createFrameSampler()` construction, index.html 3489; sampler's own first-call clock start. | The sampler already discards its first interval on purpose — module import + world build is not a frame rate. |
| `resume` | Return from a hidden tab / backgrounded app. | `frameSampler.reset()`, index.html 8763, inside the `document.hidden` branch of `visibilitychange`. | **Today the reset fires on HIDE, not on SHOW.** Equivalent for the sampler; the controller's own accumulated `state.fpsSum`/`windowStart` is *not* reset at all. That gap is GAP-5. |
| `resize` | Canvas CSS size change. | `ResizeObserver` → `scheduleRendererResize()` → `updateRendererSize()`, index.html ~6875. | No history reset exists here today. |
| `orientation` | `orientationchange`. | `window.addEventListener("orientationchange", …)`, index.html ~6891, calls `scheduleRendererResize(true)`. | Distinct from `resize` because it forces, and because it is the sequence that leaves bloom targets stale. |
| `contextRestore` | `webglcontextrestored`. | `handleContextRestored()`, index.html 8732. | Calls `scheduleRendererResize(true)` and re-enters the loop. Must reset history: every program recompiles. |
| `environment` | Biome switch / world rebuild. | `frameSampler.reset()`, index.html 5725. | Hundreds of ms of synchronous work; already commented as such. |
| `manual` | Panel actions: Resume Auto, Reset, Benchmark start/stop, Manual→Auto. | Does not exist. Wave 2 P2.3. | *"Resume Auto clears stale history."* |

**Rules.**

1. A reset clears the *adaptive decision windows* — the interval buffer, the overload
   and recovery timers, the pending probe. It does **not** clear the action history,
   the evidence record, or the recurrent-hitch log. *"Do not erase recurrent gameplay hitches."*
2. Resets are **coordinated**: `frameSampler`, the tier/controller accumulator and the
   percentile buffer reset together, in one call, with one tag. Today they do not —
   `frameSampler.reset()` fires at three sites and `adaptiveTier`'s `state.fpsSum` /
   `state.windowStart` at none. That is GAP-5 and Wave 3 P3.3 owns it.
3. A reset is a **bounded** event. If the tagged condition persists (a resize storm
   during a drag), the reset is idempotent, not re-armed per event.

### 2.2 `paused` is a validity state, not a reset

`paused` is **not** in the enum above and must never be implemented as one.

| | reset tag | `paused` |
|---|---|---|
| Effect on the interval buffer | cleared | **retained** |
| Effect on adaptive decisions | window restarts | samples are **excluded** (`valid: false`) |
| Effect on the export | recorded as a boundary | recorded, with the invalid samples still present |
| Recoverable by inspection | n/a | yes — you can see what the frame did while paused |

Sources that set `paused` (all must be OR-ed; any one is sufficient):

- `document.hidden === true`
- `motionState.animate === false` ("Flight paused")
- `controlState.systemPaused === true` (system motion preference)
- `contextState.lost === true`
- `__BIRB.freeze(true)` (HEAD 9266) and the panel's freeze
- Benchmark mode's own pause, and any panel-open art-comparison hold

**Why erasing is wrong.** *"Mark paused measurements invalid for adaptive decisions"* —
not "discard them". A 900 ms frame while the tab was hidden is real data about the
resume path; deleting it means the resume spike can never be studied, and the
controller learns nothing about a boundary it crosses every session. Invalid-for-decisions
and present-in-evidence are different properties and the implementation must carry both.

A sample carries `{ dtMs, tMs, valid: boolean, invalidReason: <enum|null> }` where
`invalidReason ∈ { hidden, flightPaused, systemPaused, contextLost, frozen, benchmarkHold, panelHold }`.
Percentiles reported to the controller are computed over `valid === true` only.
Percentiles reported in the export state both counts.

---

## 3. Telemetry field table

Every field named by PERFORMANCE_REALISM_PLAN.md's panel paragraphs. **A field with no
source in Wave 0 renders its sentinel.** This mirrors the plan's own treatment of GPU
time (*"GPU time or 'unavailable'"*) and extends it to every other sourceless field,
because the alternative — a plausible-looking zero — is indistinguishable from a
measurement and is exactly how this repo shipped a dead FPS sampler and a dead bloom pass.

### 3.1 The sentinel protocol

```js
// Panel display
"unavailable"                       // the literal string, in the field's slot
// JSON export / __BIRB.quality()
{ value: null, state: "unavailable", reason: "<reason enum>" }
```

`reason` is a **closed enum**, so a wiring bug is distinguishable from a platform fact:

`not-implemented` · `no-extension` · `no-context` · `disjoint` · `insufficient-samples` ·
`paused` · `not-applicable` · `stale`

**Forbidden sentinel substitutes**, each of which has a documented cost in this repo:
`0`, `-1`, `null` bare in a display slot, `"—"` with no `state`, `NaN`, the previous
frame's value, and **any value derived from what the code intended** (a DPR read back
off `DPR_CAP` and the tier rather than off `renderer.getPixelRatio()`).

> **`reason: "no-context"` on the GPU timer is a STOP condition, not a result.**
> ULTRACODE §4 Wave 3: it is a wiring bug wearing a platform fact's clothes — the
> `hardwareConcurrency` trap exactly. `no-extension` is a legitimate platform fact.

### 3.2 The fields

`W0` = a live source exists today (built by P0.2). `Wn` = the wave that supplies the source;
until then the field renders the sentinel with the stated reason.

| ID | Field (as the plan names it) | Source hook | Wave | Sentinel until then |
|---|---|---|---|---|
| **TEL-1** | Delivered FPS | `stats().fps` ← `fpsState.value` ← `frameSampler.sample()` (250 ms window) | **W0** | — |
| **TEL-2** | p50 / p95 / p99 frame interval | **none.** Needs raw per-frame intervals; today's sampler emits one averaged rate per 250 ms and percentiles over that are meaningless. | W2 (P2.1 `frame-metrics.js`) | `not-implemented` |
| **TEL-3** | Missed-target-frame percentage | **none.** Needs TEL-2's buffer and a target budget `B`. | W2 (P2.1) | `not-implemented` |
| **TEL-4** | CPU update time / render-submission time (separate accumulators) | **none.** No timing brackets exist around the update step or the submission step. | W2 (P2.1) | `not-implemented` |
| **TEL-5** | GPU time | **none.** `EXT_disjoint_timer_query_webgl2` is not probed anywhere. | W2 probe only (§9 DEF-2) | `no-extension` / `not-implemented` / `disjoint` — never `no-context` (see §3.1) |
| **TEL-6** | Drawing-buffer pixels | `effective().drawingBufferWidth × .drawingBufferHeight` ← `renderer.getContext().drawingBuffer*` | **W0** | — |
| **TEL-7** | Effective render DPR + native-resolution % | `effective().rendererPixelRatio` ← `renderer.getPixelRatio()`; native % = that ÷ `window.devicePixelRatio` | **W0** | — |
| **TEL-8** | Scene calls / triangles | `frameTotals().scene.calls` / `.triangles` | **W0** | — |
| **TEL-9** | Total (whole-frame) calls / triangles | `frameTotals().calls` / `.triangles` / `.passes` | **W0** | — |
| **TEL-10** | Program count | `stats().programs` ← `renderer.info.programs?.length ?? 0` | **W0** | — |
| **TEL-11** | Resource counts (geometries, textures) | `renderer.info.memory.geometries` / `.textures` — **exists on the renderer, not yet exposed.** | W2 (P2.3) | `not-implemented` |
| **TEL-12** | Estimated owned render-target memory | Computable from `effective().bloom.*` (`w×h×4` per target, ×2 where a depth buffer is attached) — **not computed today.** Plan: *"Resource counts are not byte-accurate GPU memory readings."* Label it estimated, always. | W2 (P2.3) | `not-implemented` |
| **TEL-13** | **Last adjustment / reason** | **NONE, AND NONE IS AVAILABLE.** `adaptiveTier` records `state.lastTierChange` (a timestamp) and no reason at all, and neither is exposed. **This field renders the sentinel in Waves 0–2.** Fabricating it from `tier` + `pinned` is forbidden. | W3 (P3.3 policy machine) | `not-implemented` |
| **TEL-14** | **Cooldown** | **NONE, AND NONE IS AVAILABLE.** `MIN_INTERVAL_MS = 1500` is a constant inside the IIFE; no *remaining* cooldown is computed, and the constant is not the field. **Renders the sentinel in Waves 0–2.** | W3 (P3.3) | `not-implemented` |
| **TEL-15** | Active mode (Auto / Manual / Benchmark) | **NONE.** No mode concept exists; `isPinned()` is a boolean latch with no unpin. **Reporting `pinned === true` as "Manual" is an inference and is forbidden** — a harness pin and a user's Manual are different states with different exit paths. | W2 (P2.3 panel) | `not-implemented` |
| **TEL-16** | Pinned state | `stats().pinned` ← `adaptiveTier.isPinned()` | **W0** | — |
| **TEL-17** | Bloom / post target dimensions + downscale | `effective().bloom.{sceneTarget,blurA,blurB,rayTarget,downscale}` ← `bloomPass.getSizes()`, read off the live `WebGLRenderTarget`s | **W0** | — |
| **TEL-18** | Requested-vs-effective pixel ratio triple | `effective().rendererPixelRatio` / `.resizeStatePixelRatio` / `.weatherPixelRatio` | **W0** | — |
| **TEL-19** | Stats path taken | `effective().statsPath` ∈ `{ "bloom-frameStats", "renderer-info" }`, **latched by `presentFrame()` in the branch it actually took** (`frameRenderTotals.statsPath`) — never recomputed from `adaptiveTier.getTier()`. Corroborated by `frameTotals().passes` (5 vs 1), which is counted by a different mechanism. | **W0** | — |
| **TEL-20** | Build identity | **NONE.** No build hash exists anywhere in the repo. See §8. | W2 (P2.4) | `not-implemented` |

### 3.3 Improvement-loop panel fields (plan: *"The dev panel shall expose …"*)

All six are Wave 3. **All six render the sentinel `not-implemented` in Waves 0–2**, and
a panel that ships in Wave 2 must show them as sentinels rather than omitting them —
an absent row reads as "not part of the product", a sentinel reads as "not measured yet".

| ID | Field | Wave |
|---|---|---|
| **PNL-1** | Last hypothesis | W3 |
| **PNL-2** | Measured outcome | W3 |
| **PNL-3** | Confidence | W3 |
| **PNL-4** | Recent decisions | W3 |
| **PNL-5** | Learning on/off + reset learned profile | W3 (in-session only — see §9 DEF-1) |
| **PNL-6** | Export evidence | W2 shell, W3 content |

### 3.4 Panel update cadence

*"Update panel telemetry about four times per second; avoid per-frame DOM work."*
Four times per second is `provisional` only in its exact value; **"no per-frame DOM
write" is not provisional** — it is a hard rule, because instrumentation that
manufactures the bottleneck invalidates every measurement taken with the panel open,
and the plan requires measuring with the panel both enabled and disabled.

---

## 4. The assertion table

Comparison operator and source pinned **verbatim**. Wave 1 P1.2 authors the
implementations in `tools/lib/quality-assertions.mjs`; Wave 1's harness agent
**transcribes** these and may not change a comparator direction. G1 flip-tests every row.

`A2`, `A6`, `A7` are pinned by `.claude/workflows/perf-wave-1.js` and are reproduced
here **unaltered**. The rest are authored here.

| ID | Assertion (verbatim expression) | Source of each operand | Preconditions | Flip (how G1 forces TRUE-state failure) |
|---|---|---|---|---|
| **A1** | `panelOpenedAfterThreeFingerHoldRelease === true` **and** it opened on a page loaded **without** `?debug` | `dev-gesture.js` listener on `document`; panel element presence in the DOM | Production path (§6). Touch context (`hasTouch: true`, `isMobile: true`). | Register the gesture inside the `?debug` block and load without `?debug` — must fail. |
| **A2** | *(pinned)* **a two-finger touch must NOT open the panel (the sprint gesture must survive)** | Synthesised 2-touch sequence; panel visibility; `sprintState.active` | Production path. | Stub a panel that opens on ANY touch — must fail. |
| **A3** | `effective().drawingBufferWidth` **changes** when the DPR control changes, and `effective().rendererPixelRatio === requestedDpr` (within float equality of `getQualityPixelRatio`'s output) | `renderer.getContext().drawingBufferWidth`; `renderer.getPixelRatio()` | Harness context §5, self-check SC-DPR passed. | Wire the control to a label variable only — must fail. |
| **A4** | `effective().bloom.blurA.width === Math.max(1, Math.floor(effective().bloom.sceneTarget.width / effective().bloom.downscale))` **and** `blurA`, `blurB`, `rayTarget` are all equal in both dimensions | `bloomPass.getSizes()`, read off the live `WebGLRenderTarget`s | Bloom present and enabled; tier 0. | Change `downscale` without re-running `setSize` — must fail. |
| **A5** | at weather density `0`: `weather.points.visible === false` **and** `frameTotals().scene.calls` **decreases** versus density `1` in the same pose | `weather.points.visible`; `frameTotals()` | Same biome, same pose, same tier, sun frozen (§4.2). | Set the uniform to 0 but leave `points.visible === true` — must fail (a uniform is not a skipped draw). |
| **A6** | *(pinned)* **buffer coherence: after tier0 → degrade → resize WHILE DEGRADED → restore, every render target's effective dimensions equal what the restored tier requests** | `effective()` before/after; `bloomPass.getSizes()`; `renderer.getPixelRatio()` | Harness context §5. **Must FAIL on HEAD** — see `docs/perf/EXPECTED-RED.md` (Wave 1 P1.2). If it passes today it is the wrong check. | It is already TRUE-state on HEAD; G1 flips it the other way by hand-desyncing a target dimension and confirming a *fixed* tree also fails. |
| **A7** | *(pinned)* `frameTotals().calls > sceneOnly.calls` **and** `passes === (raysOn ? 8 : 5)` | `__BIRB.frameTotals()`; `sceneOnly` = `frameTotals().scene`; `raysOn` per §4.1 | **Tier 0 and `bloomEnabled`** (§4.1). **Settled frame** (§4.1). | Force an 8-pass frame where 5 is expected — must fail. |
| **A8** | at tier ≥ 1: `frameTotals().passes === 1` **and** `frameTotals().calls === frameTotals().scene.calls` | `__BIRB.frameTotals()` | `pinTier(1)` or `pinTier(2)`. | Report `renderer.info.render` after the composite instead of the accumulator — must fail (it reports ~1 call). |
| **A9** | toggling shafts off: `frameTotals().passes` goes `8 → 5` across two settled frames, and `> 5` never recurs while shafts stay off | `__BIRB.frameTotals().passes`; `setBloom({ rays })` | Tier 0, `bloomEnabled`, sun on screen for the `8` sample. Skip the single `6`-pass transitional frame (§4.1). | Leave `raysDirty` latched true — must fail. |
| **A10** | after a panel request, the value **still holds on the frame after next**: `effective()`/`getSizes()`/`weather.points.visible` read at frame *n+2* equal the values read at frame *n* | `effective()`, `weather.getPixelRatio()`, `weather.points.visible`, `visualUniforms.wind.value` | Panel request issued while the loop is running; tier pinned so the tier does not legitimately change. | Let the per-frame writers at T4/T6/T9/T10 run unrouted — must fail on the next frame. |
| **A11** | every field in §3.2/§3.3 marked sentinel-until-`Wn` serialises as `{ value: null, state: "unavailable", reason: <enum> }` and **no** such field serialises a number | the export produced by `__BIRB.quality()` / the panel's export | Any. | Emit `0` for `cooldown` or `"Manual"` for active mode — must fail. |
| **A12** | `quality().build.requested === quality().build.serving`, else `quality().build.stale === true` **and** the panel shows the warning | §8 | Service worker registered and controlling. | Force a stale SW cache name — must fail (i.e. `stale` must become true). |

### 4.1 Preconditions that A7 and A9 cannot be evaluated without

Read off `src/effects/bloom-pass.js` `render()` at `63959d6`. **Do not re-derive these by
counting in your head; they were counted from the source and one of them is a trap.**

```
raysOn  = compositeMaterial.uniforms.uRays.value > 0.001
       && raysMaterial.uniforms.uVisible.value > 0.001
```

| Branch | Passes | Composition |
|---|---|---|
| `raysOn === true` | **8** | scene, bright, rays, ray-blur×2, bloom-blur×2, composite |
| `raysOn === false`, `raysDirty === false` | **5** | scene, bright, bloom-blur×2, composite |
| `raysOn === false`, `raysDirty === true` | **6** | as 5, **plus one clearing rays pass** on the single frame the sun leaves |

So `passes === (raysOn ? 8 : 5)` is **only** true on a *settled* frame — one where
`raysOn` also held on the previous frame. A7/A9 sample two consecutive frames and use
the second. A harness that samples one frame at an arbitrary moment will flake at
exactly the rate the sun crosses the screen edge.

And **A7's `>` requires tier 0**: at tier ≥ 1 `presentFrame()` takes the no-post branch,
`passes === 1` and `calls === scene.calls`, so `>` is correctly false. That is A8's job,
not a bug. Measured evidence from P0.2 on this tree:

```
tier 1: {"calls":66,"triangles":75834,"passes":1,"scene":{"calls":66,...},"tier":1}
tier 0: {"calls":68,"triangles":75858,"passes":5,"scene":{"calls":64,...},"tier":0}
```

### 4.2 Confounds that invalidate any A/B assertion in this table

- **The sun cycle is ten minutes long.** An A/B taken three minutes apart is confounded.
  Freeze it: `__BIRB.setSunEnabled(false)` and/or `setSunTime(s)`. Benchmark mode must
  freeze seed, route, settings **and sun** (plan, Control table row 1).
- **Terrain carves down to −46 units** and the bird holds altitude inertially, so "flying
  somewhere quieter" changes draw calls without any setting changing. Pin the pose
  (`capturePose`/`restorePose`, `teleport`, `goToProp`, `goToWater`).
- **Adaptive tier moves under you.** Every assertion in this table that reads a
  rendering quantity runs under `pinTier(n)`.

---

## 5. Harness context, pinned — and the dead-discriminator self-check

### 5.1 The pinned context

`tools/birb-quality.mjs` (R7: **one** harness) opens its browser context with exactly:

```js
{ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
```

This matches `tools/birb-shot.mjs`'s mobile defaults (`390×844 @3x`, `hasTouch: !desktop`,
`isMobile: !desktop`). `isMobile: true` is load-bearing twice over: `index.html:3568`
derives `isMobile` from the UA and `(pointer: coarse)`, which selects `DPR_CAP = 1.7`
rather than `1.8`; and `hasTouch: true` is what makes the three-finger gesture
synthesisable at all.

### 5.2 SC-DPR — the self-check that must FAIL rather than pass silently

`getQualityPixelRatio(dpr, cap, tier)` is
`Math.min(dpr || 1, tier >= 2 ? 0.85 : tier === 1 ? 1 : cap)` (`src/environment/visual-style.js:368`).

| Context | tier 0 | tier 1 | tier 2 | Verdict |
|---|---|---|---|---|
| `deviceScaleFactor: 3`, mobile (cap 1.7) | **1.7** | **1.0** | **0.85** | usable |
| `deviceScaleFactor: 2`, mobile | 1.7 | 1.0 | 0.85 | usable |
| `deviceScaleFactor: 1`, mobile | **1.0** | **1.0** | 0.85 | **DEAD — tier 0 ≡ tier 1** |
| `deviceScaleFactor: 1`, desktop (cap 1.8) | **1.0** | **1.0** | 0.85 | **DEAD** |

`tools/birb-modes.mjs` runs at `deviceScaleFactor: 1`. **The quality harness must not
inherit that context**, and must not be "fixed" by copying it.

**Required behaviour.** Before any assertion runs, the harness pins tier 0, reads
`effective().rendererPixelRatio`, pins tier 1, reads it again, and:

```
if (ratioAtTier0 === ratioAtTier1) {
  console.error('SC-DPR FAILED: tier 0 and tier 1 pixel ratios are both ' + ratioAtTier0 +
                ' at deviceScaleFactor=' + dsf + ' — the DPR discriminator is dead in this context.');
  process.exit(1);   // NOT exit 0, NOT a skip, NOT a warning
}
```

`exit 1`, not `exit 2`. A skipped check and a dead check look identical in a log and
this repo has already shipped one summary line that said `ok` on a failing run.
ULTRACODE §4 Wave 0 makes this a **STOP**: *"fix the context; do not proceed with a
dead check."*

### 5.3 Oracle-form rules that bind this harness

R1 (no `--test-name-pattern`; name explicit test files), R2 (never pipe a harness into
`grep` — run to a log, capture `$?`, assert the code, then grep the log), R3 (scope
oracles to owned files), R6 (**no SwiftShader number may become a device claim** — CI
renders at 2–9 fps; the baseline records `fps=3` and `fps=11`), R8 (a check is not
trusted until it has been watched failing).

---

## 6. RULING — the panel and the gesture register on the PRODUCTION path

**This is a ruling, not a preference. It is not open to a later wave's convenience.**

### The trap

`window.__BIRB` is created inside

```js
if (new URLSearchParams(location.search).has('debug')) {      // index.html:8966 (worktree) / 8927 (HEAD)
  window.__BIRB = { … };
}
```

and **every harness in this repo loads the page with `?debug=1`.** So a dev panel and a
three-finger gesture registered inside that block would:

- pass every automated assertion in §4, in CI, on every run;
- and **be unreachable on a phone at `https://birbmobile.vercel.app`** — which is the
  one place the workbench exists to be used, since the entire point is live tuning
  while flying, on the device whose frame budget is in question.

This is the `hardwareConcurrency`/bloom trap in a new costume: *a feature gated on a
condition the shipping device never satisfies has not shipped, and the gate passes.*
CLAUDE.md: *"A feature gated on a capability probe is not shipped until you have proof
the probe returns what you think it does."* Here the probe is `?debug` and the proof is
that the production URL has no query string.

### The ruling

1. **`src/ui/dev-quality-panel.js` and `src/ui/dev-gesture.js` register unconditionally,
   outside the `?debug` block, on the production path.** The panel's DOM is created
   hidden; the gesture listener is attached at `document` level, `passive`, always.
2. **`?debug` gates only `window.__BIRB`** — the scriptable handle — exactly as today.
   It does not gate the panel, the gesture, the keyboard fallback, or the panel's own
   telemetry collection.
3. **The panel must be reachable by at least two independent routes**, because iOS can
   intercept multi-touch gestures (plan: *"Supply a debug-URL button and keyboard
   fallback because OS gestures can intercept touch input"*): (a) the three-finger
   hold-and-release gesture, (b) a keyboard fallback, (c) a URL flag. **The URL flag
   must not be `?debug`** — routes (a) and (b) must work without it, or the ruling is
   defeated by the back door.
4. **A1's acceptance requires a page loaded WITHOUT `?debug`.** An assertion that opens
   the panel on a `?debug` page proves nothing about the production path and is
   rejected at G1.
5. Three fingers is chosen because it is the first touch count this game can never
   produce: one is the stick, two is stick + boost / the sprint tracker. The gesture
   must **not** break the two-finger sprint path (A2), must cancel gameplay pointers on
   open, must respect `touchcancel`, and must coexist with nipplejs — which owns
   `touchZone` and is constructed at index.html ~6917.
6. Production-path code carries production-path obligations: no `console.log` on the
   happy path (`birb-modes.mjs` treats **warnings** as failures), no per-frame DOM work
   while closed, and no measurable cost when the panel has never been opened.

**G2b STOP condition (ULTRACODE §4):** *"STOP if … the gesture registered inside the
`?debug` block."*

---

## 7. Precedence, and the routing register

### 7.1 The order

```
panel request   >   adaptive tier   >   capability probe
   (explicit)        (measured)          (guessed)
```

- **Panel request wins.** A human looking at the frame has better information than any
  of this. Manual suspends Auto; Benchmark suspends Auto and learning.
- **Adaptive tier wins over the probe**, because it measures rather than guesses.
  This is already the shipped intent — `isLowEnd` was deliberately demoted to advisory
  when it turned out to classify every iPhone as low-end.
- **The capability probe supplies initial defaults only**, never a per-frame value, and
  never overrides either layer above it after the first frame.

Corollaries:

- **A panel request is not a suggestion.** Once Manual is active, the adaptive tier must
  not write the quantities the panel owns — not once, not on the next frame.
  Assertion **A10** exists to catch exactly this.
- **Auto is restored explicitly**, by Resume Auto, which clears stale history with the
  `manual` reset tag (§2.1).
- **Emergency downshifts** during severe sustained overload are the one documented
  exception, and only in Auto — never over an active Manual/Benchmark lock.

### 7.2 The routing register — every site that writes a quantity the panel will own

Wave 2 P2.2 routes all of these through **one** sizing/quality application function.
"Per frame" is the hazard: an unrouted per-frame writer silently reverts a panel request
on the very next frame while every static assertion still passes.

| Site | Line (HEAD) | Quantity | Cadence | Current authority | Must become |
|---|---|---|---|---|---|
| `isLowEnd` | 3578 | advisory low-end flag; reads `navigator.hardwareConcurrency` | once at load | capability probe | **probe → default only.** Do not delete it and do not let it grow a new consumer. On iOS Safari `hardwareConcurrency` is `undefined`. |
| `DPR_CAP` | 3634 | 1.7 mobile / 1.8 desktop | once at load | capability probe | probe → **ceiling**, overridable upward only by an explicit, labelled-experimental panel request (plan: *"Values above today's cap are experimental"*) |
| `applyTier` → `renderer.setPixelRatio` ×3 | 6523 / 6526 / 6529 | renderer pixel ratio | on tier change | adaptive tier | routed through the single sizing function — **today it bypasses `resizeState`, `bloomPass.setSize` and `weather.setPixelRatio` entirely, which is the desync A6 tests** |
| `applyTier` → `cloudShell.mesh.visible` | inside `applyTier` | cloud shell | on tier change | adaptive tier | routed |
| `updateRendererSize` (**T3**) | 6787 | pixel ratio, canvas size, `bloomPass.setSize`, `weather.setPixelRatio`, camera aspect | on resize, dirty-flag gated | adaptive tier | **this becomes the single sizing function**, and `applyTier` calls it rather than duplicating it |
| `presentFrame` bloom gate (**T1**) | 4440 | whole post pass on/off | per frame | adaptive tier | routed (panel post-quality Off must win) |
| wind (**T4**) | 8350 | `visualUniforms.wind.value` | **per frame** | adaptive tier + reduced-motion | routed |
| weather density (**T5/T6**) | 8391 / 8395 | `weather.setDensity` | **per frame** | adaptive tier + reduced-motion | routed |
| mist budget (**T7/T8**) | 8474–8478 | `setMistBudget` | on tier change | adaptive tier | routed |
| contact shadow (**T9**) | 8497 | shadow on/off | **per frame** | adaptive tier | routed |
| wingtip ribbons (**T10**) | 8523 | ribbons on/off | **per frame** | adaptive tier | routed |
| `handleContextRestored` | 8732 | forces a resize + re-enters the loop | on context restore | — | must route through the same sizing function and emit the `contextRestore` reset tag |
| `__BIRB.pinTier` (**T12**) | 9427 | tier latch, **no unpin** | manual | debug hook | panel Manual/Resume Auto supersedes; the hook stays for harnesses |
| `__BIRB.setBloom` / `setLighting` | 9358 / 9372 | bloom + lighting | manual | debug hook | **remain as adapters** onto the settings API (plan, batch 1: *"Existing `setLighting`/`setBloom` hooks remain adapters"*) |

**`reducedMotionState` is not in this hierarchy.** It is an accessibility preference and
it wins over all three layers for the decorative motion it gates. It must never be used
as a performance lever, and performance must never turn it on.

**Never reduce collision, input or flight simulation fidelity** to conceal a rendering
bottleneck (plan, state-machine step 4). No route in this register touches
`bird-flight.js`, `touch-input.js`, `collider-grid.js` or any gameplay target.

---

## 8. `sw.js` — ownership, and the build hash

### 8.1 The state at `63959d6`

- `CACHE_VERSION = 'v42-2026-09-08-ground-and-ribbons'` — a **literal string**, bumped by hand.
- `CORE_ASSETS` **hand-enumerates 45 `src/**` modules**. The repo has 46 `.js` files under
  `src/`; the one absentee is `src/controls/simple-flight-controller.js`, which is
  deliberately unwired legacy. **That absence is correct — do not "fix" it.**
- Navigations use `networkFirst`; everything else uses `staleWhileRevalidate`.
- `SIBLING_ARTEFACTS` bypass: `/gauntlet`, `/sculpture`, `/grokrogue`, `/icon3d`, `/svg`, `/AR`, `/ar`.

**Nothing in Waves 1–6 currently owns this file, and these waves add 8–12 new `src/`
modules.** A new module absent from `CORE_ASSETS` is a blank page offline — the exact
`/AR` failure `sw.js`'s own comment memorialises.

### 8.2 The measurement hazard, which is worse than the offline one

**The phone taken to the park is served by a service worker, and `staleWhileRevalidate`
serves the CACHED module first.** So the first run of a device session executes the
**previous** build's `src/**` against the new `index.html`. Every number from that
session is attributed to a build that was not running. Wave 4 is the hard gate for the
whole programme; poisoning it is the most expensive available failure after fabricating
a threshold.

### 8.3 Requirements

**SW-1 — a build identity exists.** With no build step (House Rule 5), it is a literal:

```js
const BIRB_BUILD = 'v42-2026-09-08-ground-and-ribbons';   // index.html, must equal sw.js CACHE_VERSION
```

**SW-2 — a unit test asserts the two literals are equal.** It reads `index.html` and
`sw.js` as **text** (no browser, no import), so it runs under `node --test` against the
tracked three-stub and in `tests.yml` with no install step. Test file:
`tests/build-identity.test.js`.

**SW-3 — the same test asserts `CORE_ASSETS` covers `src/**`.** Enumerate `src/**/*.js`
on disk, subtract an explicit, commented allow-list of deliberate omissions
(`src/controls/simple-flight-controller.js` today), and require the remainder to appear
in `CORE_ASSETS`. **This is the row that makes `sw.js` owned.**

**SW-4 — `__BIRB.quality()` and the panel export carry build identity, both halves:**

```js
build: {
  requested: BIRB_BUILD,          // what this index.html is
  serving:   <string|null>,       // what the controlling SW's caches say it is
  stale:     requested !== serving
}
```

`serving` is read page-side, with no build step, by either: (a) `caches.keys()` →
the `birb-core-<CACHE_VERSION>` entry, or (b) a `postMessage` to
`navigator.serviceWorker.controller`. Wave 2 P2.4 picks one and states which.
If neither is available (no SW registered, e.g. `localhost` or a harness), `serving`
is the sentinel with `reason: "not-applicable"` and `stale` is `false` — **absence of a
service worker is not staleness.**

**SW-5 — `stale === true` renders a visible panel warning and is recorded in every
evidence export.** A device number carrying `stale: true` is discarded, not adjusted.

**SW-6 — assertion A12** covers SW-4/SW-5.

### 8.4 Who updates it, in which wave

| Wave | Obligation |
|---|---|
| **W1** | None. Adds no `src/` module (`tools/lib/**`, `tests/**` only — neither is in `CORE_ASSETS` and neither should be). |
| **W2** | **Owns SW-1…SW-4 and `tests/build-identity.test.js`** (task P2.4, which already owns CI wiring). Adds every new `src/` module of the wave to `CORE_ASSETS` and bumps `CACHE_VERSION` + `BIRB_BUILD` **in the same commit as the module**, never in a follow-up. |
| **W3** | Same obligation for its own modules (`adaptive-quality.js`, `frame-stats.js`, `gpu-timer.js`, `quality-settings.js`, `perf-learning.js`, `loop-health.js`, `evidence-record.js`, `effect-verification.js`). The SW-3 test is what makes forgetting fail loudly. |
| **W4** | The device runbook's first step is: hard-reload, then read `__BIRB.quality().build` and **record both halves in the manifest**. A session whose `stale` is `true` is re-run, not analysed. |
| **W5–6** | Same as W2/W3 for anything new. |

### 8.5 Related, and not to be discovered late

`.github/workflows/browser-health.yml` has `timeout-minutes: 12` and already runs four
browser commands after a Chromium install. ULTRACODE §5: **revisit it in Wave 2, not at
the end.** Adding `birb-quality.mjs` to that job without raising the timeout converts a
real failure into a timeout, which reads as flake.

---

## 9. The deferral ledger

Deferred, not dropped. Each row states the reason and **what evidence reopens it** — a
deferral with no reopening condition is a silent cut.

| ID | Deferred | Reason | What reopens it | Ships instead |
|---|---|---|---|---|
| **DEF-1** | **Persisted learning store** (cross-session profiles in `localStorage`) | Largest new surface in the plan. Its "coarse capability bucket" will reach for `navigator.hardwareConcurrency` — this repo's most expensive documented mistake, still live at index.html:3578 — and its benefit is unmeasurable without the device access that gates everything else. Privacy deny-list, entry cap and age-out were assigned by three designs to a module with no test file. | A Wave 4 device session showing that a **cold** session's first 60 s are materially worse than a warm one's, **and** an authored test suite covering deny-list, entry cap and age-out. | **In-session action history**, in memory: predicted vs observed benefit, confidence, failed probes, cooldowns. Wave 3 P3.2 (`perf-learning.js`). Everything the runtime loop needs, minus persistence. Panel exposes learning on/off and reset (PNL-5) over the in-session store. |
| **DEF-2** | **GPU timer query lifecycle** — query pools, deferred multi-frame reads, disjoint handling at scale | `EXT_disjoint_timer_query_webgl2` is exposed by **neither Safari nor SwiftShader**, so a full implementation ships permanently on its `null` branch, green, unexercised. A timer around `renderer.render()` is not GPU execution time anyway. | A phone reporting the extension present **and** returning non-disjoint results across a Wave 4 session. | **The probe only**: feature-detect and report `{ state, reason }` from the §3.1 closed enum. One line, and it is the part that must be verified on hardware. `reason: "no-context"` is a **STOP** (wiring bug), `"no-extension"` is a platform fact. The **bounded-probe fallback** (occasional deliberate upgrade probes to discover headroom without GPU timing) has to work anyway and is what will actually run — it is **not** deferred. |
| **DEF-3** | **The 30 FPS target-rate row**, with real render pacing | `docs/CUTTING_EDGE_2026.md`: iOS caps rAF at 60 Hz. Half-rate skipping on a 60 Hz panel produces judder that scores **worse** on the very interval statistics this plan adopts (p95, >25 ms count). Shipping it as a menu entry that makes the measured tail worse is an anti-feature. | A **named pacing mechanism** plus device evidence that a 30 FPS profile improves p95/p99 and sustained thermals against the 60 FPS profile on the same route. Until then the row is absent from the panel — not present-and-disabled. | Nothing. The panel's Target rate control ships 60 only. 90/120 likewise deferred (plan: *"only after observed browser cadence and device testing justify them"*). |
| **DEF-4** | **The "richer experimental surface detail" shader variant** (Surface detail control, third option) | Uncommissioned shader authorship whose only oracle is a human looking at a contact sheet — in a repo that shipped **two whole systems invisible** because a shader failed to compile at exit zero (the weather's `half`; the city ground's doubly-declared varying). | A device-measured headroom figure from Wave 4 large enough to state as its budget, **and** `tools/birb-shaders.mjs` green on the variant. Commissioned one at a time in Wave 6. | Surface detail ships **baseline / simplified** only. |
| **DEF-5** | **Anti-laundering meta-infrastructure**: held-out fixture directories materialised outside the worktree, sha256 oracle manifests as a product, mutation catalogues as a maintained artefact | Two designs proposed building a second product alongside the first. | Evidence that a cheap-tier agent actually laundered an oracle past G1 — i.e. the cheap rule below demonstrably failing. | **One cheap rule**: implementation tasks land on a branch where `tests/**` and `tools/*.mjs` are read-only, and every oracle addresses a test **file path** (R1, R5). Wave 1's flip-test gate (G1) supplies the discrimination proof that the mutation catalogue was going to. |
| **DEF-6** | **Experiments 2, 3 and 4** (image stability / AA; compute-vs-texture; spend detail where visible) | No mechanism for any of them exists anywhere in the repo, and each needs a device-measured headroom figure as its stated budget. | Wave 4 evidence + G5 pass. Wave 6, one at a time. | Experiments **1** (factor cost ranking) and **5** (allocation, shader compilation, staggered updates) only — the two buildable from what exists, and 5 is the one evidence class that survives software rendering. |
| **DEF-7** | **Spatial instance sectors** | Already measured and rejected: draw calls rose past the 100 budget for a 17–22% triangle saving, because this world's props are deliberately scattered evenly and sector culling only rejects the far hemisphere. | A **changed scene distribution** plus new evidence. Not reopened by "we have a workbench now". | Nothing. Do not rebuild it blind. |

---

## 10. Provisional constants — the register of numbers nobody has measured

> **This section is the single most expensive mistake available in this programme.**
> CLAUDE.md records that the shipped 55/58 thresholds were tuned against a sampler that
> could not run. Every number below is recorded as **provisional** so that the same
> thing cannot happen at ten times the surface area.

**Rules.**

1. **No fixture, corpus, test, contract or default may treat a `provisional` value as
   fixed.** Traces are authored as *capacity models* parameterised on the threshold, not
   as arrays baked against one.
2. Every provisional value is read from **one** named constant object in
   `src/game/adaptive-quality.js`, so a Wave 4 device pass changes numbers in one place
   and nothing else moves.
3. **Wave 4 unlocks them.** Until `evidence/device/manifest.json` exists, a wave may use
   these values to make code *run*; it may not use them to make a claim *true*.
4. `shipped-unvalidated` ≠ `measured`. The 55/58 family is live in production and has
   never been validated against a working measurement. Do not cite it as a baseline of
   correctness — only as a baseline of *behaviour* (the compatibility profile, §11).

| ID | Value | Verbatim source | Provenance | Unlocked by |
|---|---|---|---|---|
| **PRO-1** | overload: p95 interval **> 1.2 × B** | *"initial overload rule: p95 interval >1.2×B or >5% missed-target frames for two windows"* | `unmeasured` | Wave 4 |
| **PRO-2** | overload: **> 5% missed-target frames**, for **two** one-second windows | as PRO-1 | `unmeasured` | Wave 4 |
| **PRO-3** | evaluation window: **one second** | *"Evaluate one-second windows"* | `unmeasured` | Wave 4 |
| **PRO-4** | restore after **10–15 s** of stability | *"Restore one small step only after 10–15 seconds of stability"* | `unmeasured` | Wave 4 |
| **PRO-5** | **~20%** measured CPU/GPU headroom before restoring | *"with roughly 20% measured CPU/GPU work headroom where available"* | `unmeasured` | Wave 4 |
| **PRO-6** | hold **2–3 s** after ordinary adjustments | *"Hold for 2–3 seconds after ordinary adjustments"* | `unmeasured` | Wave 4 |
| **PRO-7** | DPR reduction step **0.05–0.10** | *"then reduce scene DPR in 0.05–0.10 steps"* | `unmeasured` | Wave 4 |
| **PRO-8** | at most **one** upgrade probe per **30 s**, **one** outstanding probe | *"initially at most one optional upgrade probe per 30 seconds"* | `unmeasured` | Wave 4 |
| **PRO-9** | DPR slider range **0.85–2.0** in **0.05** steps; default ceiling **1.7** mobile | *"Absolute render-DPR slider, initially 0.85–2.0 in 0.05 steps"* | `unmeasured` (the 1.7 ceiling itself is `shipped-validated` — it was raised from 1.2 on positive device feedback) | Wave 4 |
| **PRO-10** | acceptance: **p95 ≤ 18.5 ms** | *"initial sustained acceptance is p95 frame interval ≤18.5 ms"* — *"These are proposed gates, not current measured results."* | `unmeasured` | Wave 4 |
| **PRO-11** | acceptance: **< 1% of intervals > 25 ms** | as PRO-10 | `unmeasured` | Wave 4 |
| **PRO-12** | acceptance: no recurring unexplained **> 50 ms** spikes | as PRO-10 | `unmeasured` | Wave 4 |
| **PRO-13** | acceptance: no persistent quality oscillation after settling | as PRO-10 | `unmeasured` (the *definition* of "persistent" is itself unmeasured — it is a property of the tier change log, evaluated by `evaluateOscillation(tierChangeLog)`, **separate** from the interval maths) | Wave 4 |
| **PRO-14** | panel telemetry cadence **~4 Hz** | *"Update panel telemetry about four times per second"* | `unmeasured` (the *no per-frame DOM work* rule is **not** provisional — §3.4) | Wave 4 |
| **PRO-15** | **three** candidate revisions per experiment | *"initially allow three candidate revisions per experiment"* | `unmeasured` | Wave 4 |
| **PRO-16** | `LOW_FPS_THRESHOLD 55` / `RESTORE_FPS_THRESHOLD 58` / `LOW_WINDOW_MS 2000` / `HIGH_WINDOW_MS 4000` / `MIN_INTERVAL_MS 1500` | live at index.html 6509–6513 (HEAD) | **`shipped-unvalidated`** | Wave 4 |
| **PRO-17** | bloom `downscale = 2` (half-res post) | `src/effects/bloom-pass.js:219`, constructor-only | `shipped-unvalidated` — never A/B'd against quarter-res | Wave 4 / Experiment 1 |

**Values that are NOT provisional** and must not be relabelled as such: the pass counts
5/6/8 (§4.1, read from source), the `getQualityPixelRatio` table (§5.2, read from
source), the 15-site callsite set (§1), the tier semantics (§1.3), and the sentinel enum
(§3.1). These are facts about the code, re-derivable by `grep`.

---

## 11. Names, ownership, and the compatibility profile

**R7 — one harness, one panel, one controller.** Five designs independently proposed
four different harnesses for the one check the plan asks for once.

| Thing | The one name | Wave |
|---|---|---|
| Harness | `tools/birb-quality.mjs` | W1 plumbing, W2 checks |
| Assertion implementations | `tools/lib/quality-assertions.mjs` | W1 (P1.2) |
| Panel | `src/ui/dev-quality-panel.js` | W2 (P2.3) |
| Gesture | `src/ui/dev-gesture.js` | W2 (P2.2) |
| Controller | `src/game/adaptive-quality.js` | W3 |
| A/B harness | `tools/birb-perf-ab.mjs` | W3 (P3.5) |
| Requirement verifier | `tools/req-verify.mjs` | W0 (P0.4) |

**Testability constraint that decides the controller's shape.** `node_modules/three` is a
414-line hand-written stub **tracked in git**, exporting only `Vector3`, `Quaternion`,
`Euler`, `Matrix4`; CI runs `npm test` with no install step. A module is unit-testable
here **only if it imports nothing and takes its side effects as injected callbacks** —
the `createFlightRecovery({ onEnter })` pattern in `src/flight/flight-recovery.js`.
So `src/game/adaptive-quality.js` **must** be `createAdaptiveQuality({ apply, now, … })`.
Extract it as anything that touches `renderer` directly and `npm test` stops being an
oracle for it, and every task on it becomes Opus work.

**Harness install recipe** (any `npm install` prunes the tracked stub):

```bash
bash tools/ensure-harness.sh   # ONE npm install --no-save, then git checkout of the stub, then chromium
```

**The compatibility profile — the answer to "what if the phone never happens".**
The new controller ships with a profile that **reproduces today's 55/58 three-tier
behaviour exactly**. The new policy is reachable only from the panel and a URL flag, and
the switchover is gated on a recorded device session. A no-device outcome then ships a
workbench and a measurement rig — fully verifiable in CI — and nothing riskier than
today. `tools/birb-perf-ab.mjs` compares Auto against that reference profile and against
fixed profiles; it is the only check that answers whether any of this was worth building.

---

## 12. How `requirements.json` is keyed

IDs are derived **structurally from the source plan's own sections**, so
`tools/req-verify.mjs` (P0.4) can re-derive the expected coverage from the markdown
rather than from a list the same task authored.

| Prefix | Derived from | Count |
|---|---|---|
| `GAP-n` | PERFORMANCE_REALISM_PLAN.md — "Specific gaps in the current implementation" table rows | 7 |
| `CTL-n` | — "The three-finger workbench" control table rows | 8 |
| `TEL-n` | — the telemetry sentence ("Show delivered FPS, …") + §3.2 additions | 20 |
| `PNL-n` | — "The dev panel shall expose …" | 6 |
| `SM-n` | — "How intelligent up/down shifting should work", numbered steps | 7 |
| `RL-n` | — "Runtime loop — improve decisions during play", numbered steps | 6 |
| `DL-n` | — "Development loop — improve the controller and the visuals" | 4 |
| `EXP-n` | — "Experiments with the highest expected return" table rows | 5 |
| `BAT-n` | — "Small implementation batches and acceptance gates" numbered batches | 3 |
| `ACC-n` | — the acceptance sentence (p95 ≤18.5 ms; <1% >25 ms; no >50 ms spikes; no oscillation) | 4 |
| `A-n` | this contract §4 | 12 |
| `PRO-n` | this contract §10 | 17 |
| `DEF-n` | this contract §9 | 7 |
| `SW-n` | this contract §8 | 6 |
| `RUL-n` | this contract's rulings (§2, §5, §6, §7) | 6 |

**The counts P0.4 must re-derive from the markdown and match:** 8 control rows,
7 state-machine points, 6 runtime-loop steps, 5 experiments, 4 acceptance gates.
`req-verify.mjs` must go **red when a requirement row is deleted** — that is its G0
acceptance, and a verifier checking an ID list the same task authored cannot fail.
