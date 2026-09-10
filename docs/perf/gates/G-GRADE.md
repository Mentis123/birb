VERDICT: STOP — the grade does not reach the frame on the shipping render path. With the bloom post pass active (tier 0, what a healthy phone renders), Three compiles every scene material with `NoToneMapping` because the pass renders into an offscreen target, so `renderer.toneMapping` and `toneMappingExposure` are absent from the programs that draw the world: measured, a 0.5 → 2.2 exposure sweep moves the mean pixel by **−0.51/255** against a same-settings repeat-capture noise floor of **±2.07/255**, while the identical requests at tier 1 (post pass dropped) move it by **+81.4/255**. The four candidate sheets an owner is being asked to choose from were shot in that state: their tile-to-tile differences track capture ORDER, not the grade

# G-GRADE — the per-biome colour grade wave

Gate for `docs/VISUAL_UPGRADE_BUILD_PLAN.md` §16.10, "per-biome colour grade". The wave
adds a `grade` block (`tone` / `exposure` / `bloomThreshold`) to each of the four
`ENVIRONMENT_VARIANTS`, routes it through `applyColorGrade` and `qualitySettings`, adds a
Grade section to the workbench's Look tab, adds a `--grades` mode to
`tools/birb-lighting.mjs`, and ships four candidate sheets plus
`docs/visual-upgrade/GRADE-CHOICE.md` for an owner to pick from.

Every number below was produced by running this tree in this container. Nothing is taken
from the implementing agents' reports, and nothing is taken from a source comment.

Working tree at gate time (the wave is uncommitted; commit `6112544` carries only
`.claude/workflows/perf-grade.js`):

```
 M docs/VISUAL_UPGRADE_BUILD_PLAN.md   M index.html
 M src/environment/world-shell.js      M src/ui/dev-quality-panel.js
 M tools/birb-lighting.mjs             M tools/oracle-manifest.txt
?? docs/visual-upgrade/GRADE-CHOICE.md ?? docs/visual-upgrade/grade-{forest,canyons,mountain,city}.png
?? src/environment/grade-candidates.js ?? tests/grade-candidates.test.js
```

**R6 applies to this whole document, and it cuts both ways here.** A *colour* rendered by
SwiftShader is not a claim about what the owner's phone will show. But the central finding
below is not a colour claim: it is (a) a line of Three's own source, (b) a program-compile
count, and (c) a *within-pipeline* delta — the same harness, the same pose, the same
frame, the only variable being the setting under test. "Did the frame change at all"
survives the software rasteriser; "is this the right green" does not. Each finding is
labelled structural or phone-settled in §8.

**Harness.** `tools/birb-shot.mjs`'s server/boot/CDN-cache helpers, driven by four
purpose-written probes in the gate's scratch directory. Every capture pins the world seed
(`__BIRB.worldSeed(20260910)`), the sun (`setSunTime(150)` then `setSunEnabled(false)`, the
same pinning `birb-lighting.mjs --grades` uses), the tier, and the pose
(`goToSlalom` sets position *and* orientation deterministically, so two trees and two runs
frame the same thing; `teleport` would not, it sets position only). Grade requests go
through `__BIRB.setLighting`, which this wave made a one-line adapter onto
`qualitySettings.request({ source: PANEL, … })` — the same path a slider drag takes — and
item 4 additionally drives the real panel DOM.

---

## 1. THE DEFAULT IS UNTOUCHED — **PASS**

Two trees: the working tree (wave), and a `git worktree` at `6112544` (pre-wave —
`index.html`, `world-shell.js` and the panel are all untouched there). Identical harness,
identical seed, identical sun, identical pose, one boot per tree, **no panel interaction of
any kind**, all four biomes.

Read back through `__BIRB.setLighting({})`, which is a pure read in both trees:

| biome | wave `renderer.toneMapping` | pre-wave | wave exposure | pre-wave | wave bloom knee | pre-wave |
|---|---|---|---|---|---|---|
| forest   | 7 (`NeutralToneMapping`) | 7 | 1.12 | 1.12 | 0.78 | 0.78 † |
| canyons  | 7 | 7 | 1.12 | 1.12 | 0.78 | 0.78 † |
| mountain | 7 | 7 | 1.12 | 1.12 | 0.78 | 0.78 † |
| city     | 7 | 7 | 1.12 | 1.12 | 0.78 | 0.78 † |

† the pre-wave `setLighting` read-back has no `bloomThreshold` field (the wave added it).
The pre-wave value is the constructor literal, verified by hand:
`prewave/index.html:4440` and `index.html:4451` are both `threshold: 0.78`, and the diff
does not touch that call.

Pixel comparison of the same pinned frame, and — because a frame containing drifting cloud
shadows, weather and pulsing rings is never bit-identical to itself — the same-tree
run-to-run noise floor measured the same way:

| biome | wave mean | pre-wave mean | Δ | **same-tree noise floor (two wave runs)** |
|---|---|---|---|---|
| forest   | 144.536 | 144.796 | **−0.259** | +0.045 |
| canyons  | 137.227 | 137.437 | **−0.210** | +0.035 |
| mountain | 149.987 | 150.154 | **−0.167** | **−0.343** |
| city     | 130.585 | 130.479 | **+0.106** | −0.091 |

Every cross-tree delta is at or inside the harness's own noise. `DEFAULT_GRADE` is
`{ neutral, 1.12, 0.78 }` and all four variants carry exactly that. A player who never
opens the workbench sees precisely what they saw before. **The invariant holds.**

---

## 2. THE GRADE IS REAL — **FAIL. This is the STOP.**

Same pinned pose, forest, tier pinned, only the grade varying. `renderer.toneMapping` and
`renderer.toneMappingExposure` both read back correctly every time (`effective` matches
`requested` in all 21 rows) — the request arrives. The pixels do not move.

### 2.1 The measurement

Mean pixel over the whole 390×620 frame, one boot, one pose, tier pinned:

| tier | post pass | `neutral` 0.5 | `neutral` 2.2 | **Δ for a 4.4× exposure sweep** | `aces` 1.12 | `agx` 1.12 |
|---|---|---|---|---|---|---|
| **0** | **active (shipping)** | 143.365 | 142.855 | **−0.51** | 146.280 (+2.92) | 146.134 (+2.77) |
| 1 | dropped | 97.342 | 178.778 | **+81.44** | 160.290 (+62.95) | 148.020 (+50.68) |
| 2 | dropped | 97.191 | 178.795 | **+81.60** | 160.790 (+63.60) | 148.404 (+51.21) |

The tier-0 numbers are the noise floor, not a signal. Measured directly by re-capturing
the *shipping* setting at the end of each biome's sweep, same conditions:

| biome | first `neutral 1.12` | repeat `neutral 1.12`, 7 captures later | drift |
|---|---|---|---|
| forest   | 143.895 | 145.968 | **+2.07** |
| canyons  | 139.255 | 138.863 | −0.39 |
| mountain | 149.171 | 148.445 | −0.73 |
| city     | 130.169 | 129.473 | −0.70 |

So at tier 0 the largest effect any candidate curve produced (+2.92, `aces`) is smaller
than the drift produced by capturing the *same* settings twice (+2.07), and the exposure
sweep produced *less* than zero. Independently confirmed with the post pass switched off by
hand at the same pose — `neutral` 0.5 / 1.12 / 2.2 → **96.83 / 145.73 / 178.84**;
`aces` 1.12 → **161.16**; `agx` 1.12 → **148.86**. The curves are powerful. They are simply
not connected.

### 2.2 Why — read off Three's source, not inferred from a render

`three@0.183.2/build/three.module.js`, `WebGLRenderer.setProgram` (line 18077) and
`WebGLPrograms.getParameters` (line 7587), verbatim:

```js
let toneMapping = NoToneMapping;
if ( material.toneMapped ) {
    if ( _currentRenderTarget === null || _currentRenderTarget.isXRRenderTarget === true ) {
        toneMapping = _this.toneMapping;
    }
}
```

and line 7047–7049:

```js
( parameters.toneMapping !== NoToneMapping ) ? '#define TONE_MAPPING' : '',
( parameters.toneMapping !== NoToneMapping ) ? ShaderChunk[ 'tonemapping_pars_fragment' ] : '',
( parameters.toneMapping !== NoToneMapping ) ? getToneMappingFunction( 'toneMapping', parameters.toneMapping ) : '',
```

`src/effects/bloom-pass.js:551` renders the world with
`renderer.setRenderTarget(sceneTarget); renderer.render(scene, camera)`. `sceneTarget` is a
plain `WebGLRenderTarget`, not an XR one — so **every scene material compiles with
`NoToneMapping`, and neither the tone curve nor `toneMappingExposure` exists in the
programs that draw the world.** The composite that blits the target to the canvas contains
`#include <colorspace_fragment>` and no tone mapping at all (grep of
`src/effects/bloom-pass.js`: `colorspace_fragment` at lines 196 and 237; no
`tonemapping_fragment` anywhere).

Confirmed at runtime by wrapping `gl.shaderSource` before page load and counting compiles:

| action | new shaders | new fragment programs | tone-mapping function compiled |
|---|---|---|---|
| page load, bloom on | 112 | 56 | 19 × `NeutralToneMapping` (the canvas-path set, built during the pre-pass startup frames) |
| **request `aces`, bloom on** | **+2** | **+1** | **1 × `ACESFilmicToneMapping`** |
| bloom **off**, then request `agx` | +68 | +34 | 18 × `ACESFilmicToneMapping` + 17 × `AgXToneMapping` |

Requesting a different curve while the post pass is running recompiles **one** program.
Turning the pass off recompiles thirty-four, because the render target changed and with it
the program cache key. Note also that `toneMappingExposure` is a plain *uniform* — it needs
no recompile at all — and it still does nothing at tier 0. That is the cleanest single fact
in this gate: the one lever that cannot fail for want of a recompile fails anyway, because
the chunk that reads it is not in the shader.

### 2.3 What this means beyond the wave

This is a **pre-existing** engine fact, not something the wave broke — `index.html:4268-4269`
(`NeutralToneMapping`, exposure `1.12`) has been dead on the tier-0 path for as long as the
bloom pass has been running there, and item 1 confirms the wave changes nothing about it.
Three consequences the owner needs, in order of importance:

1. **The game currently renders with no tone mapping at all on a healthy device.** The
   "one enum was the largest visual change of the whole session" result recorded in
   CLAUDE.md was obtained before the post pass shipped, or with it off.
2. **A committed grade would be visible only on struggling phones.** The post pass is
   dropped at tier ≥ 1. A biome graded `aces` would look identical to today at tier 0 and
   then jump by ~63/255 in the mean the moment the adaptive tier shed bloom — a picture
   that changes with frame rate.
3. **"The bright pass thresholds the TONE-MAPPED frame" is false on this build.** That
   sentence is load-bearing in CLAUDE.md, in `world-shell.js`'s new `DEFAULT_GRADE` comment,
   in the panel's two hint strings and in `GRADE-CHOICE.md` §4.2. The bright pass reads
   `sceneTarget`, which is not tone mapped. The whole "changing the curve changes what
   blooms" hazard the brief warned about cannot occur, for the wrong reason.

---

## 3. IT IS PER-BIOME AND IT STICKS — **PASS** (structurally; see §2 for what "it" is worth)

Forest graded, then a full environment switch (which rebuilds every mesh), then back.
Read through `__BIRB.quality()`.

| step | effective tone / exposure / knee | `grade.biome` | `grade.source` |
|---|---|---|---|
| forest, untouched | neutral / 1.12 / 0.78 | forest | `biome` |
| forest, set `aces` / 1.41 / 0.62 | **aces / 1.41 / 0.62** | forest | `panel` |
| → switch to **city** | **neutral / 1.12 / 0.78** | city | `biome` |
| → switch back to **forest** | **aces / 1.41 / 0.62** | forest | `panel` |
| → switch to **mountain** (never touched) | **neutral / 1.12 / 0.78** | mountain | `biome` |
| → `resetOverrides()`, back to forest | **neutral / 1.12 / 0.78** | forest | `biome` |

The forest's grade came back across a rebuild; the city did not inherit it; a third biome
the panel never touched stayed on its own default; and the reset cleared every biome's
bucket, not just the active one. `gradeOverridesByBiome` + the resync block in
`setEnvironment` are correct.

**One defect found here, non-blocking.** `__BIRB.quality().requested.tone` is the flat
`panelOverrides` map, which `qualitySettings.apply()` writes on every request regardless of
which biome was active. While the city was showing `neutral`, that map still read `aces`:

```
cityAfterSwitch   effective.tone = neutral      requested.tone = aces
```

The per-field `effective.tone.requested` and `grade.source` are both correct (`null` /
`biome`), and the panel and the evidence export both read the per-biome store — so nothing
user-facing is wrong. But an evidence envelope captured in the city after grading the
forest records a requested/effective **desync that is not one**, and CONTRACT §0 defines
`desync` as the thing this whole programme exists to catch. Either scope
`panelOverrides.{tone,exposure,bloomThreshold}` per biome too, or drop them from the flat
map and let the per-field objects be the only report.

---

## 4. PANEL PRECEDENCE — **PASS**

Driven through the **real panel DOM**: locate `#birb-dev-quality-panel`, click the `Look`
tab, set the tone `<select>` to `agx` and dispatch `change`, set the Exposure
`<input type=range>` (min 0.7 / max 1.8) to `1.5` and dispatch `input`.

| reading | effective tone / exposure | requested | `grade.source` |
|---|---|---|---|
| before | neutral / 1.12 | — / — | `biome` |
| after the panel, +3 frames | **agx / 1.5** | agx / 1.5 | `panel` |
| +10 more frames | **agx / 1.5** | agx / 1.5 | `panel` |
| after `pinTier(2)` | **agx / 1.5** | agx / 1.5 | `panel` |
| back to `pinTier(0)` | **agx / 1.5** | agx / 1.5 | `panel` |

The panel request outranks the biome's grade, survives repeated frames, and survives tier
churn in both directions. `applyColorGrade` skips a non-null tracker and `setEnvironment`
re-applies a resynced one, so the adaptive layer never writes these. CONTRACT §7.1 holds.

Coverage note: `A10_ROUTED_FIELDS` in `tools/lib/quality-assertions.mjs` (a frozen oracle,
correctly not modified by this wave) does not include `tone`, `exposure` or
`bloomThreshold`, so `birb-quality --check all` passing 12/12 says nothing about these
three. The table above is the only check that covers them.

---

## 5. BLOOM IS STILL COHERENT — **vacuously true, and therefore no assurance**

Measured at a slalom checkpoint gate, camera pinned, tier pinned. The ring pixels are
isolated exactly: `__BIRB.solo('slalom-ring')` against `solo('__nothing__')`, differenced —
**23,147 px, 9.57 % of the frame**. "Crosses the knee" = a pixel non-black in
`setBloom({view:1})`, the bright buffer itself.

| curve | ring luma | ring saturation | ring − background luma | % ring blown (min ch ≥ 250) | **% of ring px crossing the knee** | bright-buffer ring luma | frame-wide % crossing |
|---|---|---|---|---|---|---|---|
| neutral 1.12 (shipping) | 131.98 | 0.301 | −24.88 | 0.00 % | **44.90 %** | 35.14 | 20.02 % |
| aces 1.12    | 129.82 | 0.294 | −27.20 | 0.00 % | 44.83 % | 35.86 | 20.09 % |
| agx 1.12     | 129.87 | 0.294 | −27.04 | 0.02 % | 44.05 % | 35.53 | 20.10 % |
| agx 1.34     | 128.79 | 0.295 | −28.08 | 0.00 % | 46.84 % | 39.15 | 20.46 % |
| aces 0.95    | 127.71 | 0.296 | −29.12 | 0.00 % | 46.82 % | 38.40 | 20.42 % |
| neutral 1.40 | 131.58 | 0.299 | −25.16 | 0.00 % | 46.42 % | 37.32 | 20.34 % |
| neutral 0.80 | 129.72 | 0.294 | −27.20 | 0.00 % | 46.77 % | 38.55 | 20.44 % |

**Answering the brief's question directly: no candidate curve turns the slalom gates into
headlights (blown pixels 0.00–0.02 % throughout) and none turns them into concrete (ring
saturation 0.294–0.301, a 2 % spread; crossing fraction 44.0–46.8 %).** A 75 % exposure
swing (0.80 → 1.40) moves the ring's mean luminance by 1.9/255 and its crossing fraction by
0.35 points.

That is a clean bill of health with no evidence value, and it must not be read as one. The
reason nothing changed is §2: no curve reached the frame. The moment the tone map is
reconnected, every number in this table has to be measured again, and *then* the hazard the
brief describes is live.

The drone rings were captured the same way (`goToDrone(22)` re-aimed before every shutter,
centre 130×130 crop) but the drones move between shots and the background behind them
changes with them, so those readings are **not comparable across curves** and are excluded.
The gate rings are static geometry and are the sound measurement; the drone ring uses the
same `addEnergyRing` injection with the same `base` (0.34 vs the gate's 0.30) and the same
HDR glow construction, so it is subject to whatever the gates are subject to.

---

## 6. THE OWNER CAN ACTUALLY CHOOSE — **FAIL**

The *mechanics* are good, and they are better than the brief asked for:

- Four sheets exist, 1230 × ~2270 each, seven tiles, three columns.
- Every tile is labelled **in the image** with its name, the exact tone/exposure/multipliers
  used, and `tier 0 (pinned)`. There is a title, a subtitle explaining what is held
  constant, and a footer naming the file that says how to act on it.
- `current (Neutral 1.12)` is first, and it is genuinely untouched.
- The workbench's Look tab really does carry a `GRADE` sub-section with Tone mapping,
  Exposure, Bloom threshold, Next candidate and Copy grade (screenshot captured).
- **Next candidate** cycles the same seven names the sheet shows, from a fixed per-biome
  baseline, resetting on a biome switch — driven eight times it reported
  `1/7 current (Neutral 1.12)` → … → `7/7 Cool — misty blue dawn` → `1/7 …`.
- **Copy grade** put exactly this on the clipboard:
  `{"biome":"forest","tone":"neutral","exposure":1.12,"bloomThreshold":0.78}`.

Two things nevertheless make the sheets unusable as a decision instrument.

### 6.1 The five tone/exposure tiles differ by capture order, not by grade

Measured on the committed PNGs by cropping the tiles (383 × 616 each) and differencing them
against the `current` tile:

| tile (in capture order) | forest mean\|Δ\| | canyons | mountain | city |
|---|---|---|---|---|
| 1 current | 0.000 | 0.000 | 0.000 | 0.000 |
| 2 AgX | 7.11 | 3.25 | 6.78 | 14.81 |
| 3 AgX brighter (exp ×1.2) | 12.29 | 5.36 | 10.22 | 17.67 |
| 4 ACES | 13.74 | 5.92 | 10.78 | 19.46 |
| 5 ACES darker (exp ×0.85) | 15.35 | 6.05 | 10.92 | 19.69 |
| 6 Warm | 16.47 | 6.04 | 13.64 | 20.38 |
| 7 Cool | 15.23 | 13.21 | 13.29 | 20.57 |

The difference grows monotonically with tile index in all four biomes. `ACES darker` is a
15 % exposure cut away from `ACES` and differs from it by ~1.6 units of mean\|Δ\| — about
what one more tile's worth of drifting cloud shadow, weather and ring pulse costs. That is
the signature of a time series, not a grade series. It is the same result §2 measured
live, seen in the shipped artefact.

### 6.2 The two tiles that *do* change the picture change it with settings the commit path throws away

`Warm` and `Cool` are the only candidates that alter the frame for a reason other than
elapsed time — because they move `key` / `rim` / `fill` / `hemiSky`, which are light
intensities and colours, and those *do* reach the renderer. But `DEFAULT_GRADE`'s schema is
`{ tone, exposure, bloomThreshold }` and `applyColorGrade` applies only those three.
`GRADE-CHOICE.md` §4 step 1 says the winning tile's "exact `{ tone, exposure }` … gets
written into that biome's `grade` block".

So an owner who says *"forest: Warm — sunrise breaks through"* gets
`{ tone: 'neutral', exposure: 1.21 }` committed — and the `key ×1.2, rim ×0.75` that is the
entire visible content of that tile has nowhere to go. The committed result is not the tile
they picked; on the tier-0 path it is not anything at all. A choice document whose most
persuasive options cannot be committed is worse than one that does not offer them.

---

## 7. HOUSEKEEPING — **all green**

Every exit code captured; nothing piped into `grep`.

| check | result | exit |
|---|---|---|
| `npm test` | **423 pass / 0 fail** / 210 skipped (baseline on the stashed tree: 419/0/210; the wave's `tests/grade-candidates.test.js` is exactly the +4) | 0 |
| `node tools/birb-shaders.mjs` | `forest: ok, canyons: ok, mountain: ok, city: ok` — all shaders compile in 4 environments | 0 |
| `node tools/birb-modes.mjs` | all 5 modes ok in forest (casual / ring_rush / drone_hunter / turret_defense / zen), warnings treated as failures | 0 |
| `node tools/birb-quality.mjs --check all` | **12/12 pass** (A1–A12) | 0 |
| `sha256sum -c tools/oracle-manifest.txt` | all OK | 0 |

Zero page errors and zero console errors across every probe run in this gate.

**Manifest ruling.** The wave modified a frozen oracle, `tools/birb-lighting.mjs`, and
regenerated its hash in the same diff, arguing in a manifest comment that this is not an
`ULTRACODE_PERFORMANCE_PLAN` wave and so has no `G<n>.md`. The manifest's own rule is that
such an edit is "a GATE DECISION recorded in `docs/perf/gates/G<n>.md`". **Recorded here,
and allowed**: the brief explicitly directs reusing that tool rather than writing a second
one, the legacy `--out/--env/--view` path is preserved (the diff moves it into shared
`pinScene`/`captureVariants`/`composeSheet` helpers and adds `--grades`), and one genuine
bug was fixed in passing (the `current (ACES)` label, which had been naming the wrong
shipping default). The edit is loud, which is what the manifest is for.

---

## 8. Structural vs phone-settled

**Structural — a phone cannot overturn these:**

- Every biome's default is `NeutralToneMapping` / `1.12` / `0.78`, unchanged from pre-wave
  (§1) — enum and float read off the live renderer in both trees.
- `toneMapping = NoToneMapping` whenever `_currentRenderTarget !== null` (§2.2) — Three's
  own source, quoted.
- Requesting a different tone curve while the post pass runs recompiles one program instead
  of nineteen (§2.2) — a compile count.
- The per-biome store, the round trip, the reset, and panel precedence over frames and tier
  changes (§3, §4) — all readbacks of renderer/settings state.
- The stale flat `panelOverrides.tone` (§3) — a field comparison.
- `Warm`/`Cool` move `key`/`rim`/`fill`, which `applyColorGrade` does not apply (§6.2) — a
  schema fact, readable in `world-shell.js` and `index.html` without rendering anything.
- The sheets' tile deltas growing monotonically with capture index (§6.1) — a property of
  the committed PNGs.

**Within-pipeline pixel deltas — valid as "did the frame change", not as "what colour":**

- Every mean-pixel number in §1, §2.1 and §5. Same harness, same pose, same frame; the only
  variable is the setting. SwiftShader's absolute colours are not claimed anywhere.

**Needs the phone, and is untouched by this gate:**

- Whether any candidate grade is the *right* look for any biome. That was always the
  owner's decision and it remains unmade — correctly, per the wave's own invariant.
- Whether the shipping default is pleasant on a real display.
- Every frame-time consequence of reconnecting the tone map (one extra ALU block per
  fragment in the composite, or per fragment in every scene material).

---

## 9. Blockers, in the order they should be cleared

1. **Reconnect the tone map to the shipping render path.** The cheapest correct fix is to
   apply the tone curve in `src/effects/bloom-pass.js`'s composite, where the frame reaches
   the canvas — one `<tonemapping_pars_fragment>` + `<tonemapping_fragment>` pair, driven
   by the same `renderer.toneMapping` / `toneMappingExposure` the wave already routes,
   *before* `<colorspace_fragment>`. Whatever the route, prove it with the §2.1 table:
   a 0.5 → 2.2 exposure sweep must move the tier-0 mean by tens of units, not by −0.51.
   Note this **changes the shipping look** on every device that runs the post pass — today's
   frame is untone-mapped — so it is itself an owner decision, not a silent fix.
2. **Re-measure §5 after (1), and only then decide whether any grade needs its own knee.**
   The bright pass will finally be thresholding a tone-mapped frame, which is what every
   comment in this wave already asserts. Re-run the gate-ring mask table; the drone rings
   need a static capture route before they can be measured at all.
3. **Regenerate the four sheets after (1) and (2).** The current ones cannot be used and
   should not be left on disk to be picked from. Two fixes while regenerating: the toast
   ("Mini games in Settings!") is present in tiles 1–2 of the forest sheet and absent from
   3–7, which is a between-tile difference that is not the grade; and the tile-order drift
   in §6.1 argues for shooting `current` again as the last tile and printing its delta on
   the sheet, so the sheet carries its own noise floor.
4. **Decide what `Warm`/`Cool` are.** Either extend the grade schema (and `applyColorGrade`,
   and `Copy grade`'s payload, and `GRADE-CHOICE.md` §4) to carry the light-rig multipliers,
   or drop those two candidates. As shipped they are the only tiles that show the owner
   anything and the only ones that cannot be committed.
5. **Fix the stale flat `panelOverrides.{tone,exposure,bloomThreshold}`** (§3), so an
   evidence capture never reports a desync that is not one.
6. *(optional, cheap)* Consider whether `A10_ROUTED_FIELDS` should grow the three Look
   fields. It is a frozen oracle, so that is a separate gate decision — but §4 is currently
   the only thing standing between these controls and a silent per-frame revert.

Items 1, 3 and 4 must land before an owner is asked to look at anything. Items 2, 5 and 6
can follow.
