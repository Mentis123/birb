# The A1–A12 assertion table, the snapshot contract, and the mutation catalogue

Wave 1 / task **P1.2** of [docs/ULTRACODE_PERFORMANCE_PLAN.md](../ULTRACODE_PERFORMANCE_PLAN.md) §4.
Implementations: [`tools/lib/quality-assertions.mjs`](../../tools/lib/quality-assertions.mjs).
Their own oracle: [`tests/quality-assertions.test.js`](../../tests/quality-assertions.test.js).
Companion: [`EXPECTED-RED.md`](EXPECTED-RED.md). Authority: [`CONTRACT.md`](CONTRACT.md) §4.

> **The one rule.** The harness author (P1.3) **transcribes** these. They do not choose a
> comparator direction, relax a threshold, or decide what "settled" means. Every operator below
> was fixed against a measured capture of the running page (§2), not against a reading of the
> source. If one looks wrong, say so in the report — changing it is a CONTRACT amendment and a
> gate decision (R5: no agent modifies its own oracle).

---

## 1. The table

`state` is one of `pass` · `fail` · `unavailable` · `invalid`. The fourth is not decoration:
`unavailable` means *the product has not built this yet*, `invalid` means *this run was set up
wrongly*, and conflating them is how a harness reports success for a surface that does not exist.

| ID | Export | The comparison, verbatim | On HEAD | Mutations |
|---|---|---|---|---|
| **A1** | `assertA1` | `panel.openedAfterGesture === true` **and** `debugParamPresent === false` | `unavailable` — no `src/ui/dev-quality-panel.js`. A run *with* `?debug` is `invalid`, not weaker evidence. | `M-A1-gesture-behind-debug` |
| **A2** | `assertA2` | `panel.openedAfterGesture === false` **and** `sprintActive === true` | `unavailable` ×2 — no panel, and `sprintState.active` has no reader (GAP-A2) | `M-A2-panel-opens-on-any-touch`, `M-A2-panel-eats-the-sprint` |
| **A3** | `assertA3` | `after.drawingBufferWidth !== before.drawingBufferWidth` **and** `after.rendererPixelRatio === requestedDpr` | `unavailable` — no DPR control. `invalid` if SC-DPR failed for the context. | `M-A3-label-only` |
| **A4** | `assertA4` | for each of `blurA`,`blurB`,`rayTarget`: `w === max(1, floor(sceneTarget.w / downscale))`, same for `h` | **runs, passes** | `M-A4-downscale-drift`, `M-A4-blurA-odd` |
| **A5** | `assertA5` | `densityZero.weather.visible === false` **and** `densityZero.scene.calls < densityOne.scene.calls` | `unavailable` — density is written per frame from the tier (T5/T6), so no same-tier pair exists. Cross-tier pairs are `invalid`. | `M-A5-uniform-not-visibility`, `M-A5-tier-confound` |
| **A6** | `assertA6` | every field of `effective()` at all four steps equals `expectedTargetSizes(css, getQualityPixelRatio(dpr, cap, requestedTier))` | **runs, FAILS — and must.** See [EXPECTED-RED.md](EXPECTED-RED.md) | `M-A6-desync-scene-target`, `M-A6-truncate-to-two-steps`, `M-A6-resize-after-restore`, `M-A6-never-degraded` |
| **A7** | `assertA7` | `frameTotals().calls > frameTotals().scene.calls` **and** `passes === (raysOn ? 8 : 5)` | **runs, passes** (tier 0, settled) | `M-A7-forced-8-pass`, `M-A7-last-pass-only`, `M-A7-unsettled` |
| **A8** | `assertA8` | `passes === 1` **and** `calls === scene.calls` **and** `calls > 0` | **runs, passes** (tier ≥ 1) | `M-A8-renderer-info-after-composite`, `M-A8-zero-at-degraded-tier` |
| **A9** | `assertA9` | `before.passes === 8`; first post-toggle frame ∈ {6, 5}; every later frame `=== 5` | **runs, passes** (needs the sun on screen) | `M-A9-rays-dirty-latched`, `M-A9-never-collapsed` |
| **A10** | `assertA10` | every routed field read at frame *n+2* equals the value read at frame *n* | `unavailable` — no panel request to issue | `M-A10-reverted-next-frame` |
| **A11** | `assertA11` | every sentinel field `=== {value: null, state: "unavailable", reason: <closed enum>}` | `unavailable` — no `__BIRB.quality()` | `M-A11-zero-for-cooldown`, `M-A11-manual-inferred-from-pinned` |
| **A12** | `assertA12` | `build.stale === (build.requested !== build.serving)`, and a visible warning when stale; absent SW ⇒ `stale === false` | `unavailable` — no build identity anywhere in the repo | `M-A12-stale-not-flagged`, `M-A12-absent-sw-called-stale` |

**Harness exit-code mapping** (`exitCodeFor`, transcribe it):
any `fail` **or** `invalid` → **1**; else any `unavailable` → **2**; all `pass` → **0**.
An all-unavailable run must never exit 0. `exitCodeFor(runAssertions({}))` is pinned to 1.

---

## 2. What was measured, and the four things that were surprising

Captured through `tools/birb-shot.mjs`'s own helpers at the CONTRACT §5.1 context
(390×844, `deviceScaleFactor: 3`, `isMobile`, ⇒ `DPR_CAP = 1.7`), Playwright/SwiftShader,
exit 0 with no page or console errors. Dimensions and pass counts only — **R6: nothing here is a
frame-time claim.**

```
tier 0, rays off, settled   frameTotals {calls: 74, passes: 5, scene: {calls: 70}}
tier 0, rays ON,  settled   frameTotals {calls: 70, passes: 8, scene: {calls: 63}}   sunUv[2] = 0.71
after setBloom({rays: 0})   passes:  6, 5, 5, 5      <- exactly one clearing frame
tier 1                      frameTotals {calls: 87, passes: 1, scene: {calls: 87}}
tier 2                      frameTotals {calls: 85, passes: 1, scene: {calls: 85}}   weather.visible = false
```

1. **`renderer.setPixelRatio` re-runs `setSize`.** So at every step of the resize-restore
   sequence the *drawing buffer* is correct and only the offscreen targets are wrong. A6's
   mismatch list deliberately contains no `drawingBuffer*` row. Anyone diagnosing this from the
   canvas dimensions finds a healthy canvas.
2. **A4 passes on the very frame A6 fails.** After the restore, `sceneTarget` is 306×663 and
   `blurA` is 153×331 — exactly `floor(scene/2)`, internally consistent, and half the resolution
   the renderer is drawing at. A4 is a *relative* check; A6 is an *absolute* one. Pinned by
   `QA-A6-BLIND-SPOT`.
3. **The 8-pass branch is reachable, and getting there took four attempts.** Three separate
   traps sit between "freeze the sun for the A/B" (CONTRACT §4.2) and "put the sun on screen"
   (A7's `raysOn` arm, and all of A9). The measured recipe:

   ```js
   window.__BIRB.setSunEnabled(true);   // the cycle must be RUNNING...
   window.__BIRB.setSunTime(0);         // ...for this to move the sun at all
   // -> one requestAnimationFrame, so the render loop writes keyLight.position
   window.__BIRB.setSunEnabled(false);  // NOW freeze it
   window.__BIRB.faceSun(0.22);         // in the SAME evaluate as the frames you sample
   ```

   - **`setSunTime()` is inert while the cycle is disabled.** `lightingRig.keyLight.position` is
     only written inside `if (sunState.enabled …)` (index.html 8453). Measured: with the cycle
     disabled, nine different sun times all left the key light in exactly the same direction.
   - **`faceSun(0.22)` only works on a low sun.** At `setSunTime(0)` the sun is at elevation 0.33
     (19°) and 0.22 rad of pitch-up puts it on screen at `sunUv[2] = 1.0`. At `setSunTime(450)` it
     is at 0.63 (39°) and 0.22 gives `sunUv[2] = 0` — measured; 0.5 is the first pitch-up that
     works there. Freeze at `t = 0`, or retry with a growing `pitchUp`.
   - **`faceSun()` does not latch.** The flight system rewrites the quaternion (`capturePose()`'s
     own comment says so). Call it inside the same `page.evaluate` that awaits the frames you
     sample. This is CLAUDE.md's own recorded trap — "three light-shaft captures in a row came
     back with the sun behind the camera" — reproduced exactly, twice, while writing this file.

   Always re-read `stats().sunUv[2]` on the sampled frames and **refuse** the sample if it is 0.
   A `before.passes` of 5 is not evidence about the shafts; it is evidence about the camera.
4. **The desync is already present at boot**, before any pinning: the loop sizes everything at
   tier 0's 1.7, the adaptive tier downshifts on measured frame rate, and `applyTier` moves the
   renderer alone. It is deliberately **not** the check, because it depends on the renderer being
   slow enough to downshift — a phone holding 60 fps boots coherent and the check would flake.
   See EXPECTED-RED.md §3.

---

## 3. The snapshot contract

Every assertion is a pure function of one plain object. The harness's whole job is to fill these
in honestly; a field it could not read must be **absent**, never defaulted — an assertion given
`0` for a field it cannot read will score it, and that is the fabricated-measurement failure the
sentinel protocol exists to prevent.

| Field | Source hook | Used by |
|---|---|---|
| `effective` | `__BIRB.effective()` | A4, A6 |
| `steps[]` | one `{id, requestedTier, requestedPixelRatio?, cssWidth, cssHeight, effective}` per A6 step | A6 |
| `context.devicePixelRatio` / `context.dprCap` | `window.devicePixelRatio`; `DPR_CAP` = 1.7 mobile / 1.8 desktop (index.html 3634) | A6 |
| `frameTotals` / `frameTotalsPrev` | `__BIRB.frameTotals()` on two consecutive frames | A7, A8 |
| `bloomEnabled` | the value last set through `setBloom({enabled})`; default true | A7 |
| `raysOn`, or `raysStrength` + `sunVisible` | `raysStrength` = the value last **requested** via `setBloom({rays})`; `sunVisible` = `stats().sunUv[2]` (observed) | A7 |
| `before` / `samplesAfter[]` | `{passes, tier}` per frame around the shafts toggle | A9 |
| `densityOne` / `densityZero` | `{tier, weather: __BIRB.weather(), frameTotals}` | A5 |
| `panel` | `{present, open, openedAfterGesture}` — `present` is *the module is on disk and registered*, not *the DOM node exists* | A1, A2 |
| `gesture` | `{performed: 'three-finger-hold-release' \| 'two-finger-hold'}` | A1, A2 |
| `debugParamPresent` | whether the URL under test carried `?debug` | A1 |
| `sprintActive` | **no reader exists — GAP-A2** | A2 |
| `before`/`after`/`requestedDpr`/`selfCheckDprPassed` | the DPR control, plus SC-DPR's verdict (CONTRACT §5.2) | A3 |
| `request` / `atN` / `atN2` | a panel request, then the routed fields at frame *n* and *n+2* | A10 |
| `quality` / `sentinelFields` | `__BIRB.quality()`; the field list derived from CONTRACT §3.2/§3.3 | A11, A12 |
| `panelShowsStaleWarning` | the panel's own stale banner | A12 |

`A10_ROUTED_FIELDS` names the eight quantities A10 compares. They are the routing register's
per-frame writers (CONTRACT §7.2 T4/T6/T9/T10) plus the three pixel ratios and the scene target —
the per-frame ones are the hazard, because a static assertion passes on the frame the request
lands and the writer reverts it on the next.

---

## 4. The page-side mutation catalogue

What `--selftest` applies to prove each assertion **discriminates**. R8: a check is not trusted
until it has been watched failing, and red-because-nothing-is-implemented proves nothing about
discrimination.

Three classes, and the class is what makes the coverage line honest:

- **`snapshot`** — mutate the captured object before the assertion sees it. Always applicable,
  needs no page hooks, proves the comparator direction. This is the class that lets G1 flip every
  row **today**, and it is exercised on every `npm test` run by `QA-FLIP`.
- **`page-hook`** — replace a `__BIRB` reader in the live page. Applicable today on any hook that
  exists, and it exercises the harness's read path as well as the comparator.
- **`page-real`** — a real behavioural defect (a stub panel that opens on any touch). Needs a
  module that does not exist yet, so `applicable: false` until Wave 2. **This is what makes
  `mutations: N catalogued, M applicable, M detected` mean something** instead of reading
  `0 catalogued, 0 applicable, 0 detected` and being called full coverage.

`mutationCoverage(existingFiles)` computes the line. With no Wave 2 files on disk it reports
**24 catalogued, 22 applicable**; with `src/ui/dev-gesture.js` and `src/ui/dev-quality-panel.js`
present, 24/24. `QA-FLIP2` pins that `applicable < catalogued` while those files are absent.

| Mutation | Targets | Class | Must produce | What it imitates |
|---|---|---|---|---|
| `M-A4-downscale-drift` | A4 | snapshot | `fail` | `downscale` changed without re-running `setSize` |
| `M-A4-blurA-odd` | A4 | page-hook | `fail` | one target of the three left at a stale width |
| `M-A6-desync-scene-target` | A6 | page-hook | `fail` | G1's named recipe: a hand-desynced target dimension. **Must fail on a FIXED tree too** — that is how A6 is flipped once the bug is gone. |
| `M-A6-truncate-to-two-steps` | A6 | snapshot | `invalid` | the truncation trap: red today for the right reason, green forever after the fix |
| `M-A6-resize-after-restore` | A6 | snapshot | `invalid` | the resize landing after the restore. The four step **labels** are still correct; only the CSS sizes give it away, which is why A6 checks the sequence shape rather than the names. |
| `M-A6-never-degraded` | A6 | snapshot | `invalid` | step 2 never lowered the tier, so nothing was degraded to restore from |
| `M-A7-forced-8-pass` | A7 | snapshot | `fail` | G1's named recipe: an 8-pass frame where 5 is expected |
| `M-A7-last-pass-only` | A7 | snapshot | `fail` | the original bug: `renderer.info.render` read after the composite, so the world costs one call |
| `M-A7-unsettled` | A7 | snapshot | `invalid` | one frame sampled across the 8→6→5 transition; refused, not scored |
| `M-A8-renderer-info-after-composite` | A8 | snapshot | `fail` | as above, at a degraded tier |
| `M-A8-zero-at-degraded-tier` | A8 | snapshot | `fail` | the pre-P0.2c state: whole-frame totals unreported at exactly the tiers the controller manages |
| `M-A9-rays-dirty-latched` | A9 | snapshot | `fail` | G1's named recipe: `raysDirty` latched true, ray chain running forever |
| `M-A9-never-collapsed` | A9 | snapshot | `fail` | the shafts toggle is a label |
| `M-A1-gesture-behind-debug` | A1 | page-real | `fail` | the §6 ruling's own trap: the gesture registered inside `if (has('debug'))` |
| `M-A2-panel-opens-on-any-touch` | A2 | page-real | `fail` | G1's named recipe: a stub panel that opens on ANY touch |
| `M-A2-panel-eats-the-sprint` | A2 | snapshot | `fail` | a gesture implemented as "2 or more fingers": panel shut, boost dead |
| `M-A3-label-only` | A3 | snapshot | `fail` | the DPR control writes a label; the buffer never moves |
| `M-A5-uniform-not-visibility` | A5 | snapshot | `fail` | density 0 zeroes the uniform and still draws every point |
| `M-A5-tier-confound` | A5 | snapshot | `invalid` | the pair taken at two different tiers |
| `M-A10-reverted-next-frame` | A10 | snapshot | `fail` | an unrouted per-frame writer overwriting the panel |
| `M-A11-zero-for-cooldown` | A11 | snapshot | `fail` | §3.1's first forbidden substitute, and the one a default-initialised counter produces |
| `M-A11-manual-inferred-from-pinned` | A11 | snapshot | `fail` | TEL-15: reporting `pinned === true` as "Manual" |
| `M-A12-stale-not-flagged` | A12 | snapshot | `fail` | the serving build differs and `stale` stays false |
| `M-A12-absent-sw-called-stale` | A12 | snapshot | `fail` | SW-4: absence of a service worker reported as staleness |

---

## 5. Gaps found while writing this — Wave 2 must close them or the assertion stays unreadable

Each is a source named by CONTRACT §4 that has no reader. They are listed here rather than
worked around, because the workaround in every case is to infer the value, and an inferred
operand is a fabricated measurement with a citation attached.

| ID | Gap | Blocks | What is needed |
|---|---|---|---|
| **GAP-A2** | `sprintState.active` (index.html 4974) has **no reader**. `__BIRB.setSprint` writes it; `stats()` does not report it. | A2's second half — the half with teeth | expose it on `stats()` or on the panel export |
| **GAP-A7** | `uRays` has no reader. `setBloom({rays})` writes it and returns only `{enabled, present, tier}`. So `raysOn` is half **requested** (the value the harness set) and half **observed** (`sunUv[2]`). | A7's branch selection | extend `setBloom`'s return with `rays` and the composite's live `uVisible`, making `raysOn` fully effective rather than half-intended |
| **GAP-A5** | Weather density has no control independent of the tier (written per frame at index.html 8391–8395). The only way to reach density 0 is a tier change, which also drops the contact shadow and the ribbons — measured 87 → 85 scene calls, and the weather points are one of those two. | A5 entirely | P2.2's single routing function + a panel density control |
| **GAP-A3** | No absolute DPR control exists; `pinTier` is the only lever and it moves five other things at once. | A3 | P2.3's DPR slider (PRO-9: 0.85–2.0 in 0.05 steps) |
| **GAP-A11/12** | `__BIRB.quality()` does not exist, and no build identity exists anywhere in the repo. | A11, A12 | P2.3 export shell + P2.4 SW-1…SW-4 |
| **GAP-A1/2** | No panel, no gesture module. | A1, A2 | P2.2 `dev-gesture.js`, P2.3 `dev-quality-panel.js`, **registered on the production path** (§6 ruling) |

One more, not an assertion gap but a live production-path note: `updateSprintState` logs
`console.log('Sprint:', …)` on every sprint transition (index.html 7550). A `--selftest` run that
synthesises two-finger touches will emit it. `birb-shot.mjs` fails on console **errors** only, so
this is survivable — but `birb-modes.mjs` treats **warnings** as failures, and CONTRACT §6.6
forbids `console.log` on the production happy path for the new modules. Do not add a second one.

---

## 6. Oracle-form rules that bind anything built on this file

- **R1** — never `--test-name-pattern`. A pattern matching nothing prints `# fail 0` and exits 0.
  Name the file: `node --test tests/quality-assertions.test.js`.
- **R2** — never pipe a harness into `grep`; it discards the exit code, and every harness here
  prints its summary *before* `process.exit(1)`. Run to a log, capture `$?`, assert the code,
  then grep the log.
- **R5** — the harness author does not modify the assertion library. If an assertion looks wrong,
  report it.
- **R6** — no SwiftShader number becomes a device claim. Everything measured in §2 is a dimension
  or a pass count, both of which are resolution-independent facts about the code.
- **R7** — one harness (`tools/birb-quality.mjs`), built on `birb-shot.mjs`'s exported
  `startServer` / `findChromium` / `installCdnCache` / `CHROMIUM_ARGS` / `startGame`. Do not write
  a second boot path.
- **R8** — a check is not trusted until it has been watched failing. §4 is how; `QA-FLIP` is where
  it happens on every test run.
