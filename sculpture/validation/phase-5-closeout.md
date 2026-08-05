# Phase 5 reference reconstruction audit

Date: 2026-08-04
Branch: `agent/phase-5-evidence-closeout`
Status: **COMPLETE at the Phase 5 major-landmark and contour threshold.** Phase 6 has not started.

## Why Phase 5 was reopened

The previous closeout described four freestanding women and recorded 41/41
acceptance. Full-resolution inspection established a different object: one
folded casting with six alternating positive and negative reliefs. The prior
score and four-figure evidence remain development history, not acceptance
evidence for this reconstruction.

Physical order from the outward side:

`developing | doctor(back) | mother/newborn | pregnant(back) | visitor | badge(back)`

The hospital side reverses that sequence and exposes badge, pregnancy and
doctor.

## Current result

| Area | Result | Evidence |
| --- | --- | --- |
| Six-panel order and whole-body facing | Pass | Exact layout tests plus outward/hospital matched views. |
| Closed front and reverse relief topology | Pass | Six closed body/head fields, six closed recessed cowl backings, the normal diagnostic and eight-angle orbit. |
| Stethoscope | Pass | Two substantial seated tubes, low photo-left U terminal and higher solid photo-right chestpiece. |
| Hospital badge | Pass | Separate closed rectangular chest relief at diagnostic scale. |
| Pregnancy profile | Pass | Integrated pear contour with the photographed shallow flank arms; no invented crossing arm. |
| Planted feet | Pass | One attached rooted foot per relief with instep, broad forefoot and blunt tapered toe. |
| Role-specific body silhouettes | Pass | Six contour signatures and authored gestures remain distinct in both side matrices. |
| Face and hair identities | Pass | Developing frontal/bare; mother one roll/right profile; visitor two rolls/right profile. |
| Newborn and support | Pass | One wrapped newborn mass in one substantial continuous U-shaped cradle. |
| Mobile and material | Pass | Complete portrait initial views and dark near-black patinated bronze. |

## Validation

- `npm.cmd test`: 210 passed, 0 failed.
- Focused Phase 5 sculpture tests: 19 passed, 0 failed.
- `node tools/sculpture-proportions.mjs`: 0 of 12 outside +/-0.03; worst error +0.024.
- Detail contract closeout: 9 passed, 0 warnings.
- Phase 5 matrix: 14/14 opaque, non-uniform WebGL frames with no page or console errors.
- Identity orbit: 8/8 opaque, non-uniform frames at 45-degree increments.
- Scene: 2,060,504 triangles, 8 draw calls, 6 reliefs.
- Local Chromium/SwiftShader sample: 50-60 reported FPS in both final matrices. This is not a phone-performance claim.
- Independent visual acceptance: 10/10 pass, no demotion candidates. The stethoscope and foot were the narrowest-margin valid Level 3 passes.
- Likeness estimator: 79.09% observable-contract score against the 70% Phase 5 threshold. This is not perceptual similarity; token ranges remain low-confidence because no token telemetry exists.

## Evidence

- `phase-5-reference-reconstruction.png`: 14 matched desktop/detail/mobile views.
- `phase-5-identity-audit.png`: neutral 0-315 degree orbit in 45-degree increments.
- `phase-5-body-normal.png`: front-side closed-surface diagnostic.
- `phase-5-mobile-initial.png`: both portrait initial views.
- `phase-5-stethoscope-review.png`: matched final stethoscope close-up.
- `phase-5-detail-contract.json`: nine scale, representation, camera and acceptance contracts.
- `phase-5-independent-review.md`: fresh-context ten-item visual verdict.
- `phase-5-likeness-estimate.json`: calibrated effort bands and threshold boundary.
- `tests/sculpture-phase5.test.js` and `tests/sculpture-figure-details.test.js`: structural, topology and semantic gates.

## Closeout boundary

Phase 5 closes at contract level 3: reference-faithful major landmarks and
contours for the six-relief structure, role order, facing, body states,
gestures, face/hair direction, newborn, pregnancy, stethoscope, badge and
planted feet.

This is not a photogrammetric or portrait-level likeness claim. Exact
hand-beaten micro-surface, sub-feature facial asymmetry and hidden geometry
that is not observable in the references remain outside the Phase 5 threshold.
No numeric perceptual-likeness score is restored.

The remaining real-iPhone 12-or-newer initial-load, interaction and sustained
orbit check is an explicit final ship/performance gate. It is not claimed by
the local SwiftShader evidence and does not block merging the completed Phase 5
model. Phase 6 has not started.
