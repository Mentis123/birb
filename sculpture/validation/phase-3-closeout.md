# Bronze Phase 3 closeout validation

- **Date:** 2026-08-02
- **Phase 3 production revision validated:** `2479163eb8e9900d9f0bde492949b9d4c79289fd`
- **Harness-only validation revision:** `c62c8e76917dfd856ec4e228ab53eb89d58cbc32`
- **GitHub Actions run:** `30750107143`
- **Decision:** Phase 3 is visually closed at **30 / 41**, with no detected
  regression. Phase 4 modelling is **NO-GO until the real-iPhone performance
  entry gate is run**. No Phase 4 modelling was performed in this closeout.

The harness revision changed only the contact-sheet screenshot deadline and the
temporary CI probe. The sculpture geometry, materials, lights, arrangement and
runtime behaviour under review are the Phase 3 production revision above. The
final closeout commit adds documentation, evidence and the persistent harness
timeout fix; it does not change modelling logic.

## Repository and preflight

- Repository confirmed as `Mentis123/birb`.
- Remote `main` was fetched and resolved to the Phase 3 revision above before
  validation; the closeout branch was based on that tip.
- Branch: `agent/bronze-phase-3-closeout`; no direct write to `main`.
- The isolated checkout had no unrelated tracked changes. The captured
  `git status -sb` showed only `closeout-artifact/`, which the validation workflow
  had created for its own logs immediately before the status command.
- GitHub CLI: `gh version 2.96.0 (2026-07-02)`.
- `gh auth status`: authenticated to `github.com` as the active
  `github-actions[bot]` account over HTTPS.

## Source and history reviewed

The review read `CLAUDE.md`, `sculpture/ARCHITECTURE.md`,
`sculpture/LIKENESS.md`, `sculpture/index.html`, the relevant source header
comments, all four sculpture harnesses and `tests/sculpture-orbit.test.js` in
full. It also inspected the cumulative sculpture diff and the patches at:

`3e7bd4e`, `5f506f3`, `baeed3c`, `9d1ff54`, `62afdac`, `304e94b`,
`388ea12`, `c9d0b7a`, `d8fe9af`, `df3c1fd`, `b495402`, `2479163`.

The history supports the recorded score progression: **10 / 41 → 19 / 41 →
26 / 41 → 30 / 41**. The ship threshold remains **37 / 41**.

## Commands and machine checks

The existing harness dependencies were installed exactly as documented:

```bash
npm install --no-save playwright three-real@npm:three@0.183.2
git checkout -- node_modules/three/index.js
npx playwright install --with-deps chromium
npm test
node tools/sculpture-proportions.mjs
node tools/sculpture-sheet.mjs --out shots/sculpt/sheet-p3-revalidated.png
```

The first exact contact-sheet invocation exposed a validation-harness defect:
Phase 3's larger mesh reached `window.__SCULPT_READY`, but Playwright's default
30-second **PNG readback** deadline expired under software rendering. No model or
page error occurred. `tools/sculpture-sheet.mjs` now gives screenshot readback a
separate 120-second default. The complete sheet was then regenerated with the
equivalent explicit command:

```bash
node tools/sculpture-sheet.mjs \
  --out shots/sculpt/sheet-p3-revalidated.png \
  --wait 120000 \
  --screenshot-timeout 120000
```

## Automated results

- `npm test`: **190 passed, 0 failed, 0 skipped**.
- Proportion gate: **0 of 12 outside ±0.03**, worst error **+0.023**.
- Current proportion values:

| Landmark | Reference | Model | Error |
|---|---:|---:|---:|
| headCrown | 1.000 | 1.000 | +0.000 |
| brow | 0.923 | 0.946 | +0.023 |
| nose | 0.888 | 0.892 | +0.004 |
| chin | 0.827 | 0.826 | -0.001 |
| shoulder | 0.797 | 0.797 | -0.000 |
| bust | 0.665 | 0.665 | -0.000 |
| headHeight | 0.175 | 0.174 | -0.001 |
| headWidth | 0.150 | 0.154 | +0.004 |
| shoulderSpan | 0.327 | 0.327 | -0.000 |
| bustSpan | 0.342 | 0.350 | +0.008 |
| waistSpan | 0.356 | 0.349 | -0.007 |
| hemSpan | 0.387 | 0.387 | -0.000 |

## Independent 41-check visual rescore

The regenerated **1217 × 4634** contact sheet was opened as a whole, then all
seven rows and the matched photo/model halves were inspected at native
resolution. Prior checkboxes were not treated as evidence.

### Confirmed passes — 30

- A: `A1 A2 A3 A4 A5 A6`
- B: `B1 B2 B4 B5 B6 B7`
- C: `C1 C2 C3`
- D: `D1 D3 D4`
- E: `E1 E2 E4 E6 E7`
- F: `F1 F2 F3`
- G: `G1 G4`
- H: `H1 H2`

The Phase 3 result is confirmed: the heads read as rounded blocks rather than
eggs, head-on facial marks survive the surface-nets mesh, and the four head
silhouettes are distinguishable at group distance. The previously checked
borderline items `A3`, `D3`, `E6`, `H1` and `H2` were specifically challenged in
native-resolution crops and remained passes.

### Confirmed failures — 10

- `A7` — no clear see-through gap between the nearest arm and ribs.
- `C4` — no figure visibly settles its weight onto one leg.
- `D2` — the turned-away plain head does not yet occupy the reference position
  convincingly from the matched right-hand view.
- `E3` — the eyes read as small lens/slit cuts, not hollow triangles holding
  shadow.
- `E5` — no hard temple edge clearly separates hair from face at group distance.
- `F4` — the baby carrier differs, but four distinct arm poses are not legible.
- `G2` — existing displacement remains too smooth to read as hand-worked bronze
  at group distance.
- `G3` — vertical runoff is not legible.
- `G5` — the lit metal does not yet carry the reference's clearly readable warm
  bias against the cold environment.
- `H3` — the paving does not receive one clearly connected group shadow.

### Ambiguous and counted as non-pass — 1

- `B3` — a narrow dark gap and rim are present in the three-quarter render, but
  they do not read unambiguously as the broad hollow collar-arch in the photo.
  Under the binary rule it remains unchecked.

**Independent score: 30 / 41.** There were **no confirmed visual regressions**
from the recorded Phase 3 state.

## Render and simulated-mobile baseline

Raw output is committed as `phase-3-performance.json` beside this record.
Chromium mobile emulation is **simulated** and is not equivalent to Safari on a
real iPhone.

- Emulated viewport: **390 × 844 CSS px**.
- Emulated device pixel ratio: **3**.
- Renderer DPR: **2** (the production cap).
- Drawing buffer: **780 × 1688 px**.
- Browser: headless Chromium 151 on a GitHub Actions Linux runner, launched with
  SwiftShader software-rendering flags. WebGL exposed generic `WebKit` /
  `WebKit WebGL` strings.
- Navigation to `window.__SCULPT_READY`: **4626 ms**.
- `window.__SCULPT_STATS()` after initial settle: **490,840 triangles, 6 draw
  calls, 54 reported FPS, 4 figures**.
- Contact-sheet final stats: **490,840 triangles, 6 draw calls, 21 reported FPS,
  4 figures**.
- Scripted active orbit: **31 rendered frames over 6.92 s; 4.91 measured FPS;
  203.85 ms mean frame time; 1390.7 ms p95; 1413.1 ms p99; 6 frames over 25 ms;
  5 frames over 50 ms**.
- `window.__SCULPT_STATS()` after orbit and settle: **490,840 triangles, 6 draw
  calls, 47 reported FPS, 4 figures**. The explicit active-orbit measurement is
  the meaningful interaction number; the page's reported FPS includes idle
  animation frames when no render is requested.
- Console errors: **0**. Page errors: **0**. Failed requests: **0**.

The total triangle count confirms the documented rise from roughly **302k to
491k**. The software-rendered orbit result is poor, but it is not valid evidence
for a geometry rewrite: SwiftShader is not an iPhone GPU. Preserve the current
geometry until a real-device run settles the question. The smallest safe first
remedy, only if a real phone reproduces poor interaction, is to test a lower
mobile renderer-DPR cap before changing mesh resolution or model structure.

## Evidence

- Matched contact sheet: `phase-3-revalidated.png`
- Contact-sheet SHA-256:
  `25598b07e595630832a4bdc19af12edb1e877f5437587d7597f101edb9f65047`
- Raw simulated-mobile measurements: `phase-3-performance.json`
- Exact regeneration command: shown above.

Neither evidence file is imported by the production application.

## Gated continuation plan

### Entry gate before Phase 4

- full tests green;
- proportions green;
- independently rescored contact sheet;
- no visual Phase 3 regression;
- simulated mobile baseline recorded;
- **real iPhone 12-or-newer load and orbit validation completed**.

The first five are complete. The real-phone item is outstanding and is the only
current blocker to beginning Phase 4 modelling.

### Phase 4A — arms and negative space

Target `A7` and `F4`. Replace the generic arm treatment with per-figure,
reference-led poses. Preserve the baby's crossed supporting forearms and all four
narrative identities.

### Phase 4B — surface and bronze

Target `G2`, `G3` and `G5`. The noise and runoff systems already exist; make them
legible at group viewing distance rather than adding complexity merely because a
check fails.

### Phase 5A — arrangement, weight and shadow

Target `C4`, `D2` and `H3`.

### Phase 5B — remaining form and facial refinements

Target `B3`, `E3` and `E5`.

### Final ship gate

- at least **37 / 41**, honestly rescored;
- proportions still green;
- full test suite green;
- matched contact sheet committed or reproducibly archived;
- real iPhone 12-or-newer interaction and load test;
- no console errors;
- acceptable initial construction time and orbit performance on the real device.
