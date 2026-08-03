# Phase 5 closeout

Date: 2026-08-04
Branch: `agent/phase-5-likeness`
Status: Phase 5 locally complete; final real-device performance gate remains open.

## Scope

| Criterion | Result | Implementation and evidence |
| --- | --- | --- |
| C4 weight on one leg | Pass | Height-eased lateral shear fixes the hem/support side while shifting the upper column. `phase-5-weight-normal.png`. |
| D2 turned figure arrangement | Pass | Whole figure is behind from front and has a measured projected-depth lead from group right. `phase-5-final.png`. |
| H3 connected shadow | Pass | Production view plus neutral diagnostic show one continuous cast footprint. `phase-5-shadow-mask.png`. |
| B3 hollow collar arch | Pass | Upper shell wraps the head, closes over a broad crown, exposes inner wall/rim and remains watertight. `phase-5-collar-normal-final.png`. |
| E3 triangular sockets | Pass | Mirrored triangular-prism cuts retain 27-28mm cavity depth. `phase-5-final.png`. |
| E5 hard temple hair edge | Pass | Explicit smooth cap extends beyond the skull and uses a hard CSG union at the temple. `phase-5-hair-normal.png`. |

## Validation

- `npm test`: 203 passed, 0 failed.
- `node tools/sculpture-proportions.mjs`: 0 of 12 outside +/-0.03; worst error +0.024.
- Phase 5 detail contract: 6 details passed, 0 warnings; E3 sampling ratio 6.42.
- Phase 5 matrix: 7/7 complete opaque, non-uniform WebGL frames; no page or console errors.
- Reference matrix: 7 paired high-resolution views; no page or console errors.
- Phase 4 regression matrix: 9/9 desktop/mobile defect views retained after the mobile camera was aligned to the complete-group delivery framing.
- Scene: 525,912 triangles, 6 draw calls, 4 figures. Local SwiftShader matrix FPS ranged from 38 to 60.

## Evidence

- `phase-5-final.png`: seven Phase 5 diagnostic/delivery views beside source crops.
- `phase-5-matched-final.png`: broader seven-view reference comparison.
- `phase-4-regression-phase5.png`: prior-phase desktop/mobile regression matrix.
- `phase-5-detail-contract.json`: physical scale, cameras, representation and acceptance contract.
- `phase-5-weight-normal.png`, `phase-5-collar-normal-final.png`, `phase-5-hair-normal.png`: isolated normal-material geometry checks.
- `phase-5-shadow-mask.png`: high-contrast connected-shadow diagnostic.

## Remaining ship gate

A real iPhone 12-or-newer initial-load and full-orbit interaction test remains outstanding. SwiftShader confirms rendering correctness, not phone construction time, sustained frame rate, thermal behavior or touch feel. Phase 6 was not started.
