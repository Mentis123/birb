VERDICT: STOP — the density lever above 1.0 is a label (`clamp()`'s fallthrough `Math.min(1, …)` caps `decorativeDensity` at 1, so slider 1.05–2.00 and MAX REALISM's `value: 2` all apply exactly 1.0: measured requested=1, effective=1, zero delta in draw calls, triangles and particles), and BACK TO SHIPPING DEFAULT is not reversible (bloom strength returns to 0.85 against a shipping 0.78, and `renderer.shadowMap.type` returns to the DEPRECATED PCFSoftShadowMap against a boot default of PCFShadowMap)

# G-ASCEND — the above-baseline realism wave

Gate for the wave that lets the workbench push quality **up**. Two questions decide it:
is each new lever wired to rendering work or to a label (G2b's standard, applied again),
and does the shipping default a player sees without ever opening the panel still move?

Everything below was produced by running the code in this container. No number is taken
from the wave's own report or from a source comment. Every control was driven through the
**panel's own listener** (locate `.bqp-control` by its `.bqp-control-label` text, set
`input.value`/`select.value`/`input.checked`, dispatch real `input`/`change` events) or
through `__BIRB`'s documented adapter, never by writing a renderer property directly.

Working tree at gate time (nothing committed):

```
 M index.html   M src/effects/bloom-pass.js   M src/environment/spherical-world.js
 M src/environment/weather.js   M src/ui/dev-quality-panel.js   M sw.js
```

**R6 applies to this whole document.** Everything reported below is **structural** — a
draw count, a triangle count, a program count, a render-target dimension, a texture
property, a sample count, a geometry segment count — or a **pixel statistic** over frames
captured under SwiftShader. No frame time appears anywhere and none was used. The one
place a device could disagree with a structural number is called out where it occurs
(`maxSamples`, `getMaxAnisotropy`).

**Instrumentation.** Both trees compared in §2 were served through one Playwright route
interception that inserts `window.__GATE = { scene, renderer, world, bloom, lighting }`
immediately before `window.__BIRB = {`. Nothing else in either page is altered, the same
rewrite is applied to both, and it exists because `renderer.info.render.calls` counts what
happened to be inside a moving camera's frustum — the scene graph itself is what has to be
compared. Context is CONTRACT §5.1 verbatim: `390×844`, `deviceScaleFactor: 3`,
`isMobile: true`, `hasTouch: true` (so `DPR_CAP` is 1.7 and SC-DPR stays alive).

---

## 0. Scoreboard

| # | Requirement | Result |
|---|---|---|
| 1 | Every lever moves rendering work | **4 of 5 pass. Densities > 1.0 FAIL — a label.** |
| 2 | The shipping default is untouched | **PASS** on all four named quantities (+ a noted, non-drawing scene-graph addition) |
| 3 | Shaders compile in every biome with the levers on | **PASS** — 16 combinations, zero shader/page/console *errors*. One warning class recorded in §3.1 |
| 4 | 12 assertions + modes + shots + `npm test` | **PASS** — 12/12, 5/5 modes, both shots exit 0, 419 pass / 0 fail |
| 5 | Nothing frozen was edited | **PASS** — 58 files OK, exit 0 |
| 6 | The preset is reversible | **FAIL** — two values do not come back |

---

## 1. Every lever moves rendering work

One measurement per lever class, each taken by this gate on the live page.

| Lever | Driven by | Measured effect | Verdict |
|---|---|---|---|
| **Real shadows** | Ultra tab, real checkbox | `renderer.shadowMap.enabled` false→true; **program count 46→67** (second run 48→76); meshes flagged `castShadow` **0→45**, `receiveShadow` **0→1**; `shadowLight.shadow.map` **allocated**, `mapSize` **512 / 1024 / 2048** exactly as the Shadow-map-size control asks; scene draw calls **+1** and scene triangles **+216** in **7 of 8** paired off/on samples at a 700 ms settle (19 proxy instances × 12 tris = 228, so 18 of 19 instances rasterised in the sampled frame) | **wired** — see §1.1 for what could *not* be shown |
| **Antialiasing (scene MSAA)** | Ultra tab, real `<select>` | `bloomPass.getSizes().sceneSamples` **0 → 2 → 4**, read off the live `WebGLRenderTarget.samples`, not echoed from the request; `renderer.capabilities` reports `isWebGL2 true, maxSamples 4, EXT_color_buffer_float true`. **Pixel-confirmed**: mean \|Laplacian\| edge energy over the whole frame, 10 frames per block — off **0.6732** (sd 0.0148), 4x **0.6517** (sd 0.0005), off again **0.6781** (sd 0.0004). 4x sits **0.024 below** the mean of the two off blocks, ~50× the sd of the stable blocks | **wired, and the resolve reaches the frame** |
| **Anisotropic filtering** | Ultra tab, real slider | **9 textures** carry a `map` (`bird-contact-shadow`, `slalom-line`, 7 unnamed). Every one read back **1 → 8 → 16 → 1** as the slider went 8, 16, 0. `renderer.capabilities.getMaxAnisotropy()` = 16 here; the clamp is against the device's own ceiling, so a phone may cap lower | **wired** |
| **Terrain mesh resolution** | Ultra tab, real `<select>` | Ground geometry **112×72 / 15 904 tris → 160×104 / 32 960 → 208×136 / 56 160**, matching `GROUND_RESOLUTION_PRESETS`' stated counts exactly. Whole-scene geometry **91 168 → 108 224 → 131 424**. **Drawn** scene triangles standard/ultra/standard = **68 806 / 108 870 / 68 614** (+40 064 against the +40 256 the geometry predicts) | **wired — real triangles, not a filter** |
| **Densities > 1.0** (`decorativeDensity`, max raised 1→2) | Performance tab, real slider | **Nothing above 1.0 is applied.** Slider 0.5 → requested 0.5, effective 0.675. Slider **1.5 → requested 1, effective 1**. Slider **2.0 → requested 1, effective 1**, while the panel readout displays **"2.00"**. Scene calls, scene triangles, whole-frame calls and whole-frame triangles all **0 delta** over 12 adjacent-frame pairs | **LABEL — blocking** |

### 1.1 What the shadows lever could NOT be shown to do

Requirement 1 asks additionally that *something actually casts a shadow*. That is a
pixel question, and **this harness cannot answer it.** Three independent attempts:

- **Whole-frame A/B** (shadows off vs on): 82% of pixels changed — but the **control**
  (two shots of the *same* settings, 700 ms apart) changed **47.6%** and **47.97%**.
- **Shadow-map-only A/B** (512 vs 2048, which changes nothing but the map): treatment
  74.7% against a control of 80.4%.
- **Receiver-only A/B** (shadows on throughout, same light, same map, same casters; only
  the ground's `receiveShadow` flipped, with a 6 s settle and a 45 s warm-up first):
  treatment 90.5% against an ON-vs-ON-again control of 82.9%.

The scene is never static long enough. Weather points, water, drones, mist and the
atmosphere pass's time-driven cloud drift all animate, and enabling shadows adds its own
frame-to-frame variance (whole-frame luminance sd **0.002** across 10 frames with shadows
off in one quiet window, **5.7–20.6** with shadows on over comparable windows). The AA
result above survived only because it happened to land in one of those quiet windows and
repeated across three blocks with sds of 0.0005–0.0148.

So the honest statement is: **the shadow pass runs, allocates its map at the requested
size and rasterises caster geometry into it every frame, and every material in the scene
recompiled to sample it — but whether the resulting shadow is legible on screen was not
established here and needs the device the owner has in hand.** That is a gap in the
evidence, not a defect found; it is not why this gate says STOP.

Separately worth the owner's attention before a device session: with shadows on, whole-
frame luminance moved 5–20 units between consecutive frames of a frozen bird under a
disabled sun. Under SwiftShader that is not a device claim (R6), but shadow flicker is
what it looks like, and `shadow.bias = -0.0018` / `normalBias = 0.4` are recorded in the
source itself as "eyeballed under SwiftShader, not device-measured".

### 1.2 The density defect, exactly

`index.html`'s `clamp()` inside `createQualitySettings` special-cases `dpr`,
`bloomStrength`, `postQuality`, `shafts`, `antialiasing`, `shadowsEnabled`, `shadowType`,
`shadowMapSize`, `anisotropy` and `terrainResolution`, then falls through to:

```js
return Math.min(1, Math.max(0, value));
```

`decorativeDensity` has no case, so it takes that fallthrough. The wave raised the panel
slider's `max` from 1 to 2 (`dev-quality-panel.js`), taught the wind writer to accept 2
(`0.35 + Math.min(2, panelOverrides.decorativeDensity) * 0.65`, index.html ~9377) and made
MAX REALISM request `value: 2` — but the request never survives `clamp()`. Measured, at
the panel:

```
slider 0.5  readout "0.50"  requested 0.5  effective 0.675
slider 1    readout "1.00"  requested 1    effective 1
slider 1.5  readout "1.50"  requested 1    effective 1
slider 2    readout "2.00"  requested 1    effective 1
```

The panel displays a number that is not applied. That is precisely the class G2b exists to
catch, and it is the only above-baseline lever this wave shipped that fails it.

**A second point survives even if the clamp is fixed**, and should be settled before the
slider's ceiling is trusted: above 1.0 `decorativeDensity` only scales
`visualUniforms.wind`, which `addFoliageWind` uses as
`transformed.x += sin(...) * 0.022 * weight² * uBirbWind`. At 2.0 that is a **14 mm**
increase in foliage sway on a radius-120 planet. It moves no particle, no draw and no
triangle — the two other consumers (`T9` contact shadow, `T10` ribbons) are booleans
gated on `> 0.001` and are already on at 1.0. Requirement 1's wording for this class
("particle or draw count RISES above the 1.0 baseline") is not satisfiable by the current
wiring even with the clamp corrected.

---

## 2. The shipping default is untouched

Three fresh boots of the working tree against three fresh boots of a `git worktree` at
HEAD (`f1d611f` — the wave is entirely uncommitted, so HEAD *is* pre-wave). **No panel is
ever opened.** Identical treatment on both: `setSunEnabled(false)`, `setSunTime(120)`,
`freeze(true)`, `pinTier(0)`, 2.5 s settle.

| Structural quantity | wave (3 boots) | pre-wave (3 boots) | |
|---|---|---|---|
| drawing buffer | 663 × 1434 | 663 × 1434 | **same** |
| canvas | 663 × 1434 | 663 × 1434 | **same** |
| `renderer.getPixelRatio()` | 1.7 | 1.7 | **same** |
| bloom sceneTarget / blurA / blurB / rayTarget | 663×1434 / 331×717 ×3 | identical | **same** |
| bloom `downscale` | 2 | 2 | **same** |
| bloom `sceneSamples` | **0** | (field did not exist) | **same behaviour** |
| ground segments / triangles | 112 × 72 / 15 904 | 112 × 72 / 15 904 | **same** |
| `renderer.shadowMap.enabled` | false | false | **same** |
| `renderer.shadowMap.type` | 1 (PCFShadowMap) | 1 | **same** |
| meshes with `castShadow` / `receiveShadow` | 0 / 0 | 0 / 0 | **same** |
| `renderer.info.memory.textures` | 8 | 8 | **same** |
| program count | 43, 43, 43 | 42, 39, 43 | overlapping — see note |
| scene draw calls (12 samples/boot) | 87–91 | 89–95 | overlapping — see note |
| drawn triangles | 76 978–77 472 | 76 570–78 640 | overlapping — see note |
| console errors / warnings | none | none | **same** |

**Note on the three overlapping rows.** Draw calls, drawn triangles and program count are
all frustum- and boot-dependent in this game (drones move, the chase camera drifts, a
program is only compiled when something is first drawn with it). Across three boots each
the ranges overlap and the wave tree is, if anything, marginally *lower*. There is no
systematic drift in either direction — which is what the scene-graph comparison predicts,
below.

**What the wave does add to a page that never opens the panel**, and why none of it draws:

- one `InstancedMesh` named `shadow-caster-proxy`, 19 instances, rebuilt per biome —
  `visible = false`, `castShadow = false`;
- one `DirectionalLight` (`shadowLight`) — `visible = false`, `intensity 0`,
  `castShadow = false`, plus its `.target` `Object3D`;
- so scene-graph totals differ deterministically by **+1 instanced mesh, +1 light,
  +1 named mesh** (13 vs 12, 6 vs 5, 17 vs 16 across all three boots each).

Three's `projectObject` returns on its first line for `object.visible === false`, so
neither the proxy nor the light is submitted, uploaded, lit, counted for shader defines,
or collected into the shadow array. A paired adjacent-frame A/B flipping only the proxy's
`visible` produced a median draw-call delta of **0** over 10 pairs. The cost of both is a
per-frame visibility test and a small constant CPU allocation (one 6-segment cone geometry
and 19 instance matrices per biome build).

**Verdict on requirement 2: PASS.** The four quantities the requirement names — draw
calls, triangles, program count, buffer dimensions — do not move, and neither do canvas
size, pixel ratios, every post target, the ground mesh, or the console. The scene-graph
addition is recorded because it is real and because a future wave that flips either object
visible by accident would move the default; it is not itself drift.

---

## 3. Shaders compile in every biome, with the new levers ON

`tools/birb-shaders.mjs` is frozen and takes no lever arguments, so this gate ran its own
copy of the same procedure with the levers turned on **before** the biome walk — shadows
on at 2048 px, AA 4x, anisotropy 16, terrain **ultra** — and then visited every biome
against **every shadow filter**, because each filter is a different program define and
enabling shadow maps recompiles every material in the scene.

```
levers: shadowsEnabled 4x/true  shadowType vsm  shadowMapSize high
        antialiasing 4x  anisotropy 16  terrainResolution ultra   (all effective == requested)

  forest / shadow=basic: ok      canyons / shadow=basic: ok
  forest / shadow=pcf: ok        canyons / shadow=pcf: ok
  forest / shadow=pcfsoft: ok    canyons / shadow=pcfsoft: ok
  forest / shadow=vsm: ok        canyons / shadow=vsm: ok
  mountain / shadow=basic: ok    city / shadow=basic: ok
  mountain / shadow=pcf: ok      city / shadow=pcf: ok
  mountain / shadow=pcfsoft: ok  city / shadow=pcfsoft: ok
  mountain / shadow=vsm: ok      city / shadow=vsm: ok

all shaders compile in 4 environments x 4 shadow filters, WITH LEVERS ON     exit 0
```

Zero `program not valid`, zero shader errors, zero page errors, zero console **errors**.
The stock `node tools/birb-shaders.mjs` at the default is also green (exit 0, 4 biomes).

### 3.1 One console warning class, and what it means

The levers-on run produced four console **warnings**, all the same:

```
THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.
```

Two consequences, neither of which blocks requirement 3 but both of which the owner should
know before this reaches a phone:

1. **The panel's "PCF Soft" filter option is a label in three@0.183.2.** Selecting it sets
   `renderer.shadowMap.type = THREE.PCFSoftShadowMap`, `readEffective` reads that value
   back and reports `"pcfsoft"`, and Three renders **PCFShadowMap**. Requested and
   effective agree with each other and disagree with what is drawn.
2. **`tools/birb-modes.mjs` treats console warnings as failures.** It is green today only
   because shadows default off. Any future harness or CI step that enables shadows with
   this filter selected will fail on a warning — and §6 shows the reset path is exactly
   what leaves `pcfsoft` selected.

---

## 4. The existing oracles

All run to a log file with the exit code captured separately; no harness was piped into
`grep` (R2).

| Oracle | Exit | Result |
|---|---|---|
| `npm test` | **0** | 629 tests, **419 pass, 0 fail**, 210 skipped, 0 todo. Every skip is a `BIRB_PERF_IMPL unset` / Wave-3-deliverable gate or the two documented `three-real` icon3d skips — no new skip class |
| `node tools/birb-quality.mjs --check all` | **0** | **A1–A12 all `state=pass`**; `SC-DPR ok: tier0=1.7 tier1=1`; 25 mutations catalogued, 25 applicable |
| `node tools/birb-modes.mjs` | **0** | 5/5 modes ok in forest, no console warnings |
| `node tools/birb-shaders.mjs` | **0** | 4/4 biomes ok |
| `node tools/birb-shot.mjs --start` | **0** | `calls 64, triangles 75402, programs 38, tier 1` |
| `node tools/birb-shot.mjs --start --nest` | **0** | `nesting: nested`, `calls 15, triangles 62928, tier 2` |

A6 still reports `matchesExpectedRed: false` with the note that `EXPECTED-RED.md` must be
revised by a gate decision — unchanged from G2b, not this wave's business.

---

## 5. Nothing frozen was edited

```
$ sha256sum -c tools/oracle-manifest.txt      ->  exit 0, 58 files OK, 0 failures
$ git status --porcelain tools/ tests/        ->  empty
$ git diff HEAD~2 --stat -- tools/ tests/     ->  empty
```

**PASS.** Every measurement in this document was taken with the manifest verified.

---

## 6. The preset is reversible — it is not

MAX REALISM works. Clicked through the real button on the Ultra tab, everything it
promises lands and reads back:

```
dpr              requested 3        effective 3          (native; devicePixelRatio 3)
postQuality      requested full     effective full       downscale 1
                 all four post targets 1170x2532 (were 663x1434 / 331x717)
antialiasing     requested 4x       effective 4x         sceneSamples 4
shadowsEnabled   requested true     effective true       shadowMap.type 3 (VSM)
shadowMapSize    requested high     effective high
anisotropy       requested 16       effective 16         all 12 map textures at 16
terrainResolution requested high    effective high       ground 160x104 / 32 960 tris
programs 83
decorativeDensity requested 1       effective 1          <- the §1.2 clamp; asked for 2
```

Then BACK TO SHIPPING DEFAULT, against a snapshot of the same page before MAX REALISM:

| Value | Shipping default (boot) | After BACK TO SHIPPING | |
|---|---|---|---|
| `bloomPass.getStrength()` | **0.78** (`index.html:4438`, the value the pass is constructed with) | **0.85** | **does not return** |
| `renderer.shadowMap.type` | **1** — `PCFShadowMap`, Three's own default, never set at boot | **2** — `PCFSoftShadowMap` | **does not return** |
| shadows enabled | false | false | ok |
| anisotropy (all textures) | 1 | 1 | ok |
| `sceneSamples` | 0 | 0 | ok |
| `downscale` | 2 | 2 | ok |
| ground segments / triangles | 112×72 / 15 904 | 112×72 / 15 904 | ok |
| every `panelOverrides` key | null | null | ok |

**Defect 6a — bloom strength.** `resetVisualOverridesToShipping()` calls
`bloomPass.setStrength(0.85)` with the comment *"bloom-pass.js constructor default"*. It is
the **module's** default; `index.html` constructs the pass with `strength: 0.78`. So the
one button whose entire promise is *"exactly what a player who never opens this panel
sees"* leaves the game 9% brighter in the bloom than shipping, permanently, for the rest of
the session. This line **pre-exists the wave** (identical at `prewave/index.html:8029`) and
is the bug G2b §5.7 flagged for this exact control — the wave's own comment claims to have
addressed it ("every branch below calls the REAL setter") and the branch it calls is
carrying the wrong number. Not introduced here, but this wave puts a large orange/green
button pair in front of it and asserts the round trip is exact.

**Defect 6b — shadow filter type.** New this wave. Boot never touches
`renderer.shadowMap.type`, so it is `PCFShadowMap`. `resetVisualOverridesToShipping()`
calls `shadowsSetType('pcfsoft')`, and `clamp()`'s `shadowType` default is `'pcfsoft'` as
well. After one round trip the renderer sits on a value it never had, and — per §3.1 — that
value is **deprecated in the pinned Three build**, so the next time shadows are enabled the
console fills with warnings and the filter silently is not the one the panel reports.
Three's program cache key includes `shadowMapType` whether or not shadows are enabled, so
this is not inert state.

Neither is a one-way door in the sense of "the app is broken" — both are recoverable by
reloading. But the button exists so that a phone in a park does not need a reload, and it
does not deliver that.

---

## 7. Blockers, in the order they should be fixed

1. **`decorativeDensity` is clamped to 1.** Add a case to `clamp()` in `index.html`
   alongside the other nine, bounded at 2. Then re-answer requirement 1's actual question:
   at 2.0 the lever must raise a particle or a draw count, and today the only thing above
   1.0 reaches is a 14 mm foliage sway. Either give it something above 1.0 that costs
   rendering work, or return the slider's ceiling to 1.0 and say so — a slider whose top
   half is indistinguishable from its midpoint is the failure this programme is named for.
2. **BACK TO SHIPPING DEFAULT must land on the shipping values.** `bloomPass.setStrength`
   should take the same constant `index.html` constructs the pass with (0.78), not
   `bloom-pass.js`'s module default; and the shadow-type reset should restore what boot
   leaves in place. Both belong in one named `SHIPPING_DEFAULTS` object read by the
   constructor *and* by the reset, so they cannot drift again — the fix G2b asked for.
3. **Decide what "PCF Soft" means on three@0.183.2.** Either drop the option, or map it to
   `PCFShadowMap` and label it honestly. As shipped, `readEffective` reports a filter the
   renderer is not using and the console says so four times a run.

## 8. Non-blocking, worth folding into the fix

- `src/environment/weather.js`'s JSDoc now reads `setDensity(0..1)` in the header and
  `@returns … setDensity(0..2)` in the module doc, while the implementation still clamps
  `Math.max(0, Math.min(1, amount))`. Text asserting the opposite of the code is the defect
  class G2d caught in CI step names; it is one line either way.
- The same edit deleted the recorded rationale for `getDensity()` (why `uOpacity` cannot be
  inverted back to `amount`). That comment was paid for; it should come back.
- `shadow.bias = -0.0018` / `normalBias = 0.4` are, by their own comment, eyeballed under
  SwiftShader. They belong in CONTRACT §10's provisional register with a Wave 4 unlock,
  not as bare literals — this programme exists because 55/58 were tuned against a sampler
  that could not run.
- `GROUND_RESOLUTION_PRESETS`' triangle table was checked against the live geometry and is
  exactly right at every entry (15 904 / 32 960 / 56 160 mobile). Recorded because a table
  of numbers in a comment is normally where this repo's claims go to rot, and this one
  holds.

## 9. What this gate could not determine

- **Whether a cast shadow is visible on screen.** §1.1. Needs the device.
- **Whether MSAA is available at 4x on the target phone.** `maxSamples` is 4 under
  SwiftShader and `EXT_color_buffer_float` is present; iOS Safari may report either
  differently, in which case `setSamples` correctly reports 0 back and the control is an
  honest requested-vs-effective desync rather than a broken lever. Unverified on hardware.
- **`getMaxAnisotropy()` on the target phone** — 16 here, device value unknown.
- **Any cost claim whatsoever.** No frame time, no fps and no thermal figure appears in
  this document, and MAX REALISM at native DPR 3 with post at full resolution, 4x MSAA,
  2048 px VSM shadows and a 32 960-triangle ground is exactly the configuration whose cost
  nobody has measured on a phone. That is the wave's stated intent — an opt-in envelope —
  but the panel currently states no budget next to it.
