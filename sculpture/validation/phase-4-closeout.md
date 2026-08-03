# Bronze Phase 4 closeout and visual-acceptance correction

Phase 4A (arms and negative space) and Phase 4B (surface and bronze) were
integrated on 2026-08-03. The first post-merge correction repaired crushed
lighting, inward triangle winding, open boundary rings and undersized head
sampling bounds. Later production desktop and mobile close-ups showed that this
was still not an acceptable visual closeout: arm ends read as pipes or mittens,
chest forms read as attached balls, stride pieces sat in front of the hems, a
turned head looked unfinished, and rear views collapsed toward black.

PR #412 reopens only the Phase 4 acceptance decision and corrects those defects.
It does not claim any Phase 5 item, and Phase 5 was not started.

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

The decoded patch applied cleanly to the then-current `origin/main` and changed
only `sculpture/src/model/figure.js` and
`sculpture/src/model/sculpture.js`, matching the candidate validation
workflow. The temporary candidate payload and export workflow were then
removed. The supplied evidence files were copied unchanged:

- `phase-4-arm-probes.png`: `0f14762f8e31c9f4138b5a99571ff978c31216be58abb478a5ab45d4f1a5dec8`
- `phase-4-performance.json`: `36fcc2ca1563f5bbeda1ba7f66c2e06779c0f825bb2ad50fe9183eefc67ff33a`
- `phase-4-revalidated.png`: `9f090d61920d5ee2ffa307dc207683a513828bcd70248bb447e19671b4bffa89`

Those files remain provenance. They are not the acceptance evidence for the
corrected implementation.

## Original implementation and integrity repair

Phase 4A replaced the repeated arm treatment with four named,
reference-led paths. Phase 4B strengthened hand-worked displacement,
body-field noise and vertical runoff bands. The first corrective pass then
reversed the procedural surface-net and cloak triangle winding, capped the
cloak wall at hem and crown, expanded head sampling around every turn, and
restored normal closed-solid shadowing.

Those changes fixed actual clipping and missing-surface defects, but the later
close-ups proved that topology alone had been mistaken for visual acceptance.

## Visual-acceptance correction

The reopened review found six specific causes and corrected each one:

- Constant-radius arm capsules and explicit hand ellipsoids produced pipe ends
  and mitten blobs. Arms now taper from shoulder to reduced cast tips, and
  support wrists end inside the pregnancy and newborn gestures.
- Independent chest lobes read as balls attached to the body. One broad,
  shallow chest shelf with restrained relief now belongs to the body field.
- A separately generated foot could still show a join even after draw-time
  geometry merging. The leading stride is now three smoothly joined tapered
  sections in the same signed-distance field as the skirt, with no exposed leg
  or detached heel/toe geometry.
- The `faceless` option omitted facial geometry. The turned-away figure now has
  a complete skull, facial plane, eye cuts, nose and mouth on the far side; the
  reference-facing camera intentionally sees the back of her head.
- One weak rear light left the broad cowls almost black. A restrained opposing
  rear fill now keeps those planes readable without flattening the front faces.
- The screenshot harness previously accepted any created PNG. It now reads the
  live WebGL framebuffer and fails on transparent, blank or near-uniform
  output.

The first correction attempt was deliberately rejected after visual review.
GitHub Actions run `30803618186`, artifact `8851864877`, digest
`sha256:967a16e6c76fdf2f17a9783334112e90c6b090e62110d24f67ed1512a49cc958`
still showed the unfinished head, shelf-like chest forms, mitten hands and
detached-looking feet. It was not merged.

## Final validation

- `npm test`: 193 passed, 0 failed.
- `node tools/sculpture-proportions.mjs`: 0 of 12 outside tolerance; worst
  error `+0.024`.
- `node --check sculpture/src/model/figure.js`: passed.
- `node --check sculpture/src/model/sculpture.js`: passed.
- `node --check tools/sculpture-shot.mjs`: passed.
- `git diff --check`: passed.
- All 12 figure components have positive signed volume and zero boundary edges.
  Every cloak has zero non-manifold edges. Surface-net ambiguity remains at
  four to six non-manifold edges in each body and three in the turned head; the
  record therefore does not claim that every generated component is fully
  manifold.
- GitHub Actions Node Tests run `30805880950`: passed.
- GitHub Actions Phase 4 Likeness QA run `30805881057`: passed and captured
  desktop front, three-quarter, side, rear and ground-detail views plus mobile
  full, face/body and rear-close views.
- Final artifact `8852788470` has digest
  `sha256:d6dfc906cfde719d757be80671426f1d1c03f838496f7fd3360c2f26b742887f`.
  All eight captures report 6 draw calls, 494,596 triangles and 4 figures.
- Every framebuffer check sampled at least 4,102 pixels; every sample was
  opaque. The narrowest view still had a 96.7 luminance range and 13.9 standard
  deviation, so no transparent, blank or uniform canvas passed.
- The final images were reviewed individually. Front and mobile close-ups show
  closed body surfaces, tapered arm ends and integrated chest relief. The
  three-quarter view shows the turned head's far-side face. Side and low views
  show the stride growing from the hem. Rear desktop and mobile views retain
  readable blue-grey surface planes.
- `validation/phase-4-likeness-corrected.png` records the source photographs
  beside the exact final CI frames. Its SHA-256 is
  `8329b71b058d0d91063a008527941b42f804c0ad616d4c227f93035fbefe1e82`.

The older supplied simulated-mobile record reports 6 draw calls, 497,176
triangles, 4.535 seconds to ready and 5.83 FPS under SwiftShader. Its geometry
and timing predate this correction and are retained only as history. The final
CI render reported 54-56 FPS under a different SwiftShader environment; neither
result represents a real iPhone GPU.

## Score and remaining gate

Phase 4 remains honestly scored at **35 / 41**: 35 passes, five confirmed
failures (`C4 D2 E3 E5 H3`) and one ambiguous item (`B3`) counted as a
non-pass. The correction validates existing Phase 4 passes; it does not promote
any remaining item.

A real iPhone 12-or-newer load and orbit test is still outstanding. It remains a
final ship gate and must be recorded before drawing performance conclusions or
changing geometry for performance. Phase 5 remains unstarted.
