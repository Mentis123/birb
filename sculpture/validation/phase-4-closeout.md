# Bronze Phase 4 closeout validation

Phase 4A (arms and negative space) and Phase 4B (surface and bronze) were
integrated on 2026-08-03. Phase 5 was not started.

## Source and archive provenance

The supplied `birb-phase4-complete-working-tree.zip` is not a complete Git
working tree. It has no repository metadata and contains only these three
validation files plus a size-only manifest:

- `phase-4-arm-probes.png`
- `phase-4-performance.json`
- `phase-4-revalidated.png`

The actual two-file source patch was stored by merged PR #408 in
`.github/phase4-candidate-patch/part-00`. Its published transport hashes were
verified before use:

- base64 payload SHA-256: `ef0ce414bed1e8f2fcaf37c59dc5408f831daa555381c5d65ed4dfd8960fadf7`
- gzip payload SHA-256: `ca833adc73a35fe05194b4ed7ac858f6b89b08c928a71a2c45f661da7c045240`
- decoded patch SHA-256: `0107a32554137cd328ea9e2aa3c6dd47102d966de1f815abde58c86eacc6d7ce`

The decoded patch applied cleanly to current `origin/main` and changed only
`sculpture/src/model/figure.js` and `sculpture/src/model/sculpture.js`, matching
the candidate validation workflow. The temporary candidate payload and export
workflow were then removed. The supplied evidence files were copied unchanged:

- `phase-4-arm-probes.png`: `0f14762f8e31c9f4138b5a99571ff978c31216be58abb478a5ab45d4f1a5dec8`
- `phase-4-performance.json`: `36fcc2ca1563f5bbeda1ba7f66c2e06779c0f825bb2ad50fe9183eefc67ff33a`
- `phase-4-revalidated.png`: `9f090d61920d5ee2ffa307dc207683a513828bcd70248bb447e19671b4bffa89`

## Implementation

Phase 4A replaces the repeated arm treatment with four named, reference-led
paths. The nearest figure opens a visible gap beside the ribs, the pregnant
figure supports the belly, the mother's forearms cross beneath the newborn, and
the clinician's far arm sweeps back to keep the stethoscope readable.

Phase 4B strengthens the existing hand-worked displacement and body-field noise,
adds broad and fine vertical runoff bands, warms the bronze and sun against the
cold environment, and tunes the material toward rough weathered bronze.

## Validation

- `npm test`: 190 passed, 0 failed.
- `node tools/sculpture-proportions.mjs`: 0 of 12 outside tolerance; worst
  error `+0.023`.
- `node --check sculpture/src/model/figure.js`: passed.
- `node --check sculpture/src/model/sculpture.js`: passed.
- `git diff --check`: passed.
- The matched sheet and isolated probes were reviewed against all 41 likeness
  checks. `A7`, `F4`, `G2`, `G3` and `G5` moved from fail to pass,
  with no observed Phase 1-3 regression.

The supplied simulated-mobile record reports 6 draw calls, 497,176 triangles,
4 figures, 4.535 seconds from navigation to ready, and no console, page or
request errors. Its scripted orbit measured 5.83 FPS under SwiftShader. This is
not representative of a real iPhone GPU.

## Score and remaining gate

Phase 4 closes at **35 / 41**: 35 passes, five confirmed failures
(`C4 D2 E3 E5 H3`) and one ambiguous item (`B3`) counted as a non-pass.

A real iPhone 12-or-newer load and orbit test is still outstanding. It remains a
final ship gate and must be recorded before drawing performance conclusions or
changing geometry for performance. Phase 5 remains unstarted.
