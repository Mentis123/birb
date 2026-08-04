# Phase 5 reference reconstruction audit

Date: 2026-08-04
Branch: `agent/phase-5-reference-reconstruction`
Status: **COMPLETE at the Phase 5 major-landmark and contour threshold.** Phase 6 has not started.

## Why Phase 5 was reopened

The previous closeout described four freestanding women and recorded 41/41 acceptance. Full-resolution inspection shows a different object: one folded casting with six alternating positive and negative reliefs. The prior score and its four-figure evidence are retained as history but are not valid acceptance evidence for the reconstructed model.

Physical order from the outward side:

`developing | doctor(back) | mother/newborn | pregnant(back) | visitor | badge(back)`

The hospital side reverses that sequence and exposes badge, pregnancy and doctor.

## Current result

| Area | Result | Evidence |
| --- | --- | --- |
| Six-panel order and whole-body facing | Pass | Exact layout tests plus outward/hospital matched views. |
| Closed front and reverse relief topology | Pass | All six production body fields have 0 boundary and 0 non-manifold edges; eight-angle orbit has no read-through or impossible face reversal. |
| Stethoscope and badge | Pass for named Phase 5 contracts | Explicit paths/fine-field bounds plus integrated diagnostic views. |
| Pregnancy profile | Pass | Broad rounded abdomen is integrated into the torso; shallow flank arms do not cross or cup it. |
| Planted feet | Pass | Each relief has one rooted, tapered and asymmetric planted foot with no detached pebble or clipped wedge. |
| Role-specific body silhouettes | Pass | Six contour signatures, role-specific bust/abdomen states and authored arm gestures read in the outward and hospital matrices. |
| Face and hair identities | Pass | Active side, head turn, structural proportions and crown-roll count read in both identity close views and the full orbit. |
| Newborn and support | Pass | The newborn reads as one fully wrapped broad block with restrained end asymmetry, no exposed spherical head and one integrated U-shaped support. |

## Validation

- `node --test --test-isolation=none`: 208 passed, 0 failed.
- `node tools/sculpture-proportions.mjs`: 0 of 12 outside +/-0.03; worst error +0.024.
- Focused sculpture tests: 17 passed, 0 failed.
- Detail contract closeout validation: all 9 detail contracts pass, with 1 intentional fragile-scale warning for the 18 mm body-silhouette field. Its required normal-material close evidence is archived in the Phase 5 matrix.
- Phase 5 matrix: 10/10 opaque, non-uniform WebGL frames; no page or console errors.
- Identity orbit: 8/8 opaque, non-uniform frames at 45-degree increments; no wrong-side face or broken occlusion found.
- Scene: 2,070,904 triangles, 7 draw calls, 6 reliefs.
- Local Chromium/SwiftShader sample: 54-60 reported FPS in the Phase 5 matrix and 51-60 in the identity orbit. These are software-renderer observations, not phone performance claims.

## Evidence

- `phase-5-reference-reconstruction.png`: ten reference-relevant desktop/mobile views, including outward and hospital identity close views.
- `phase-5-identity-audit.png`: neutral 0-315 degree orbit in 45-degree increments.
- `phase-5-detail-contract.json`: nine scale, representation, camera and acceptance contracts.
- `tests/sculpture-phase5.test.js`: order, facing, topology, scene budget and camera gates.
- `tests/sculpture-figure-details.test.js`: foot, newborn, badge and stethoscope geometry gates.

## Closeout boundary

Phase 5 closes at contract level 3: reference-faithful major landmarks and
contours for the six-relief structure, role order, facing, body states,
gestures, face/hair direction, newborn, pregnancy, stethoscope, badge and
planted feet. All nine detail contracts now pass closeout validation and the
matched visual evidence has been reviewed at desktop and mobile delivery
sizes.

This is not a photogrammetric or portrait-level likeness claim. Exact
hand-beaten micro-surface, sub-feature facial asymmetry and hidden geometry
that is not observable in the references remain outside the Phase 5 threshold.
No numeric perceptual-likeness score is restored.

The remaining real-iPhone 12-or-newer initial-load and sustained-orbit check is
an explicit final ship/performance gate. It is not claimed by the local
SwiftShader evidence and does not block merging the completed Phase 5 model.
Phase 6 has not started.
