# Bronze Phase 4 closeout and second visual-acceptance correction

Phase 4A (arms and negative space) and Phase 4B (surface and bronze) were
integrated on 2026-08-03. The first corrective merge, PR #412, fixed real
topology, clipping, sampling-bound and lighting defects. Later close desktop and
mobile views still disproved its visual acceptance: one face had been forced
backward with an extreme neck twist, the carried infant and stethoscope were
erased into the coarse body field, and the feet read as detached pebbles or long
paddles.

The follow-up on branch agent/phase-4-detail-correction reopens only that
acceptance decision. It corrects those four forms, adds focused geometry
assertions, and replaces the superseded visual evidence. It does not claim any
Phase 5 item, and Phase 5 was not started.

## Source and archive provenance

The supplied birb-phase4-complete-working-tree.zip is not a complete Git working
tree. It has no repository metadata and contains only these three validation
files plus a size-only manifest:

- phase-4-arm-probes.png
- phase-4-performance.json
- phase-4-revalidated.png

The actual two-file source patch was stored by merged PR #408 in
.github/phase4-candidate-patch/part-00. Its published transport hashes were
verified before use:

- base64 payload SHA-256: ef0ce414bed1e8f2fcaf37c59dc5408f831daa555381c5d65ed4dfd8960fadf7
- gzip payload SHA-256: ca833adc73a35fe05194b4ed7ac858f6b89b08c928a71a2c45f661da7c045240
- decoded patch SHA-256: 0107a32554137cd328ea9e2aa3c6dd47102d966de1f815abde58c86eacc6d7ce

The decoded patch applied cleanly to the then-current origin/main and changed
only sculpture/src/model/figure.js and sculpture/src/model/sculpture.js,
matching the candidate validation workflow. The temporary candidate payload and
export workflow were then removed. The supplied evidence files were copied
unchanged:

- phase-4-arm-probes.png: 0f14762f8e31c9f4138b5a99571ff978c31216be58abb478a5ab45d4f1a5dec8
- phase-4-performance.json: 36fcc2ca1563f5bbeda1ba7f66c2e06779c0f825bb2ad50fe9183eefc67ff33a
- phase-4-revalidated.png: 9f090d61920d5ee2ffa307dc207683a513828bcd70248bb447e19771b4bffa89

Those files remain provenance. They are not acceptance evidence for the current
implementation.

## What PR #412 fixed

Phase 4A replaced the repeated arm treatment with four named, reference-led
paths. Phase 4B strengthened hand-worked displacement, body-field noise and
vertical runoff bands. PR #412 then reversed procedural surface-net and cloak
triangle winding, capped cloak boundaries, expanded head sampling around every
turn, restored closed-solid shadowing, tapered the arms, integrated the chest
relief and added a readable rear-light floor.

Those changes fixed actual missing-surface and black-orbit failures. The later
close-ups proved that topology alone had still been mistaken for visual
acceptance.

## Second visual-acceptance correction

The reopened review used the four committed source photos and nine repeatable
browser views. It found four remaining structural causes:

- The pregnant figure's torso still faced the camera while its head twisted 132
  degrees locally. Her complete body, cowl and head now rotate together by 2.72
  radians, while the local neck turn stays at 0.06 radians. Front views therefore
  show the back of a coherent figure; the opposite orbit proves that a complete
  face remains on the other side.
- The infant had been blended into the 14.5 mm body field, where the wrap,
  contact crease and raised head could not survive. It is now one separate,
  closed 5.5 mm field: a horizontal swaddle with two broad wrap folds, a deeply
  integrated head end, and a curved supporting forearm beneath it.
- The stethoscope had also been blended into the body and read as cuts, a loop or
  a central ball. It now uses two independent Catmull-Rom tube geometries with
  two small ringed terminals, matching the source sculpture.
- The stride shape was too long and too blunt. Each planted foot remains unioned
  into its robe field, but now has a buried root, instep, narrower forefoot and a
  restrained four-lobe toe edge. There are no detached shoes, exposed legs or
  floating toe pieces.

The visual harness now checks the live WebGL framebuffer for opacity, contrast
and variation before accepting each PNG. It also captures dedicated
whole-figure-turn, infant/instrument and low/close foot views rather than judging
those details from a distant group frame.

## Current local validation

- npm test: 197 passed, 0 failed.
- node tools/sculpture-proportions.mjs: 0 of 12 outside tolerance; worst error
  +0.024.
- node --check sculpture/src/model/figure.js: passed.
- node --check sculpture/src/model/sculpture.js: passed.
- node --check tools/sculpture-shot.mjs: passed.
- git diff --check: passed.
- The isolated planted foot is one connected, closed, outward-wound component
  with zero boundary and zero non-manifold edges. Its asserted length, width,
  instep and stride-side bounds prevent both a detached pebble and a paddle.
- The isolated infant is one connected, closed, outward-wound component with
  zero boundary and zero non-manifold edges. Its asserted horizontal proportions
  and height keep it distinct from the pregnancy.
- The orientation assertion requires the complete figure turn to exceed 2.4
  radians and the local neck turn to remain below 0.35 radians.
- The nine-view Chromium matrix ran against Three.js 0.183.2 with no page or
  console errors. Its permanent entry point is node tools/sculpture-sheet.mjs
  --phase4 --out shots/sculpt/phase4.png. Every sampled framebuffer was opaque, nonblank and
  non-uniform.
- Every view reported 6 draw calls, 514,780 triangles and 4 figures. Local
  software-rendered frame readings ranged roughly from 44 to 60 FPS; they are
  not a real-device performance result.
- sculpture/validation/phase-4-detail-correction.png contains the exact desktop,
  mobile, opposite, detail and ground-level frames. Its SHA-256 is
  13db524bf34d4bf7d849e782cf3e2eb4c21682134bbb7813b265d2f978a86864.

The PR #412 artifact and its 494,596-triangle count are retained only as
superseded history. The supplied simulated-mobile record at 497,176 triangles,
4.535 seconds to ready and 5.83 FPS also predates this correction.

## Score and remaining gate

Phase 4 remains honestly scored at 35 / 41: 35 passes, five confirmed failures
(C4 D2 E3 E5 H3) and one ambiguous item (B3) counted as a non-pass. This
correction validates existing Phase 4 passes; it does not promote any remaining
item.

A real iPhone 12-or-newer load and orbit test is still outstanding. It remains a
final ship gate and must be recorded before drawing device-performance
conclusions or changing geometry for performance. Further arrangement, facial,
hair and connected-shadow refinement belongs to the already documented Phase 5
targets. Phase 5 remains unstarted.
