# Detail-first sculpture QA

This is the reusable observation and acceptance protocol derived from the Phase
4 correction history and exercised end to end during Phase 5. It records both
the process and its measured limits; the Phase 5 result is documented separately
in `validation/phase-5-closeout.md`.

## Executive conclusion

Phase 4 did not need repeated correction because Three.js could not represent
the details. It needed repeated correction because the observation scale and
the representation bandwidth were chosen after the geometry was built.

The stethoscope is the clearest example. Its tube is 17 mm in diameter. During
Phase 4 the torso distance field was sampled in 14.5 mm cells, so the original
feature was only 1.17 cells thick. A feature at that ratio can exist in field
math and still disappear or become meaningless slivers in the generated
surface. Making the instrument separate TubeGeometry solved the representation
error; adding a dedicated close camera solved the observability error.

The new rule is:

> No fine feature is implemented until its reference crop, physical scale,
> representation, isolation probe, exact camera and acceptance checks are
> written down.

This changes the feedback point from a deployed whole-scene complaint to a
local, feature-specific result. During Phase 4, a geometry result was available
in under 3 seconds and a reproducible browser view in about 26 seconds. Those
measurements do not apply unchanged to the larger six-relief scene; its final
capture wall time has not been re-baselined. The local method removes an entire
PR-and-deployment cycle from each detail iteration, but one project does not
support a mathematical claim of exponential improvement, so this document does
not make one.

## What the Phase 4 progression proved

| Commit | What it established | What it did not yet prove |
| --- | --- | --- |
| 812abb5 / PR #408 | Phase 4 candidate was available | Repository source and visual closeout |
| 5b3f869 / PR #409 | Phase 4 source was integrated | Bronze readability at real orbit angles |
| 4ddd0f4 / PR #410 | Bronze and lighting became readable | Closed, outward-wound surfaces |
| 79f7865 / PR #411 | Surface integrity removed clipping and inside-out faces | Fine-feature identity at close range |
| 753f618 / PR #412 | Broad visual acceptance and mobile framing improved | Infant, instrument, feet and whole-figure orientation |
| ea64330 / PR #413 | Detail-specific geometry and nine exact views corrected those defects | The remaining Phase 4 likeness score items |

Four process failures created the extra passes:

1. Broad scene views were treated as evidence for details they could not show.
2. Mesh existence was treated as evidence of recognizable shape.
3. Coarse sampled fields were used for features below their reliable bandwidth.
4. A detail-specific camera and rubric were added only after the detail failed.

The corrected process defines observation first, then geometry.

## The detail observation contract

Create one contract for every semantic detail before editing code. Keep it in
the relevant validation note or beside the reference evidence.

~~~text
detail_id:
semantic_read:       What a viewer must identify without explanation.
reference_asset:     Exact source image and crop bounds.
reference_landmarks: 3-8 named points or edges that establish the shape.
physical_bounds_mm:  Expected width, height and depth in model space.
smallest_signal_mm:  Smallest stroke, gap or relief that carries identity.
occlusion_contract:  What it touches, crosses, clears and may hide behind.
representation:      Sampled field, explicit mesh, tube, curve or texture.
sampling_ratio:      smallest_signal / voxel_size, or N/A for explicit mesh.
isolation_probe:     Exact page query, part selector and debug material.
integrated_views:    Exact view ids, viewport, DPR, target, yaw, pitch, distance.
mesh_assertions:     Components, bounds, volume, winding, boundary and gaps.
render_assertions:   Opaque/nonblank plus named silhouette and contact checks.
human_acceptance:    Pass/fail against the crop, with unresolved differences.
~~~

The semantic read is deliberately first. "A curved medical instrument with two
tubes and two terminals" is testable. "Some geometry is present on the chest"
is not.

## Representation bandwidth

For a sampled field, calculate:

~~~text
rho = smallest feature thickness / voxel size
~~~

Use these project-specific empirical limits:

| Sampling ratio | Decision |
| --- | --- |
| rho < 3 | Unsafe. Do not claim the feature from the generated surface. |
| 3 <= rho < 6 | Fragile. Allow only broad relief and require a normal-material close view. |
| rho >= 6 | Reasonable for stable silhouette or relief, still requiring visual evidence. |

Surface nets places one vertex at the mean crossing in each cell. Three- or
four-cell features have already vanished in this project, so six cells is the
operating floor, not a universal theorem.

### Current physical limits

| Generated part | Voxel | Stable sampled feature at 6 cells |
| --- | ---: | ---: |
| Body field | 18 mm | 108 mm |
| Production and isolation planted foot | 7.5 mm | 45 mm |
| Head field (0.0042 * 1.335) | 5.61 mm | 33.6 mm |
| Infant field | 5.5 mm | 33 mm |
| Badge field | 3.5 mm | 21 mm |

Anything finer must either be intentionally exaggerated or moved to explicit
geometry. Current explicit instrument geometry demonstrates the distinction:

- tube radius: 8.5 mm, or 17 mm diameter;
- tube tessellation: 30 longitudinal by 8 radial segments;
- terminal radius: 21-24 mm;
- terminal thickness: 12 mm.

Those dimensions are encoded exactly to normal floating-point precision. They
are not a claim that an 8.5 mm radius is visually legible at every camera or on
every device.

Use sampled fields for broad organic masses and fillets. Use curves, tubes,
lathed or conventional meshes for wires, rims, discs, fingers, narrow gaps and
objects whose identity depends on a thin continuous path. Do not blend a
semantic object into a coarse torso field merely to reduce draw calls.

## Observation scale

Each level answers a different question. Passing one level never substitutes
for another.

| Level | Typical model scale | Required evidence |
| --- | ---: | --- |
| Scene | 1-5 m | Grouping, lighting, framing and all-orbit readability |
| Figure | 0.5-2.3 m | Pose, whole-body orientation and silhouette |
| Object | 30-600 mm | Infant, foot, hand or instrument in an exact close camera |
| Surface | 5-100 mm | Isolated part with normal material, then final bronze |
| Raster | pixels | Framebuffer health and recognizable projected shape |

For granular visual judgment, frame the complete object at roughly 150-250 CSS
pixels across and keep its smallest identity-carrying stroke at 8 pixels or
more. These are operating targets, not similarity scores. If the real delivery
camera cannot provide that many pixels, validate in both the close diagnostic
view and the delivery view: the former proves geometry, the latter proves the
feature still reads in context.

Store all camera numbers in tools/sculpture-views.mjs. A manually orbited
screenshot is useful for exploration but is not reproducible evidence.

## The optimized loop

1. Crop the reference before modelling. Name the landmarks and the semantic
   read.
2. Add the exact diagnostic camera before modelling. Confirm that the empty or
   old geometry is framed at the required pixel scale.
3. Measure the intended feature and calculate rho. Choose sampled or explicit
   geometry from that result.
4. Build the feature in isolation. Do not begin with the full six-relief scene.
5. Add numeric and topology assertions for bounds, continuity, winding, volume,
   component count and required clearances.
6. Render an isolated silhouette and MeshNormalMaterial frame. This separates
   geometry defects from bronze, lighting and shadow defects.
7. Render the isolated final material, then integrate it with contact and
   occlusion geometry.
8. Run only the affected exact view. Compare it with the stored reference crop
   at the same scale.
9. At a visual checkpoint, run all fourteen Phase 5 views and the eight-angle
   identity orbit. Use the nine Phase 4 views as historical regression evidence.
10. Before closeout, run tests, proportions, the full visual matrix and the
    critical production views. Record both passes and unresolved differences.

### Fast diagnosis table

| Evidence | Likely fault |
| --- | --- |
| Field march says present, normal-material mesh does not read | Sampling ratio, blend radius or bounds |
| Normal material reads, bronze does not | Material, lighting, shadow or contrast |
| Isolation reads, integrated view does not | Occlusion, contact, camera scale or competing silhouette |
| Desktop reads, mobile does not | Responsive camera target, FOV or projected pixel scale |
| Far interior is visible through the near face | Open boundary or inward winding, not transparency |
| Bounds pass but identity fails | Test asserts existence instead of semantic shape |

## Measured feedback budget

Measurements below are from the Phase 4 closeout machine on 2026-08-03. They
are wall times unless noted and should be re-baselined if the scene or runner
changes.

| Gate | Observed time | Use |
| --- | ---: | --- |
| Targeted semantic test pair | 0.7-0.9 s | Every geometric edit |
| Full 197-test suite | 2.1-2.7 s | Every local checkpoint |
| Twelve-measure proportion gate | 0.6-0.9 s | Any figure-scale edit |
| One exact infant/instrument browser view | 25.6 s | Every meaningful detail edit |
| Nine-view local visual matrix | 28-59 s | Visual checkpoint and pre-merge |
| Five fresh-context production views | 123.5 s | Deployed closeout |

The one-view benchmark passed with a 1400x900 framebuffer, 4,105 samples, 100%
opaque samples, luminance range 133.17 and deviation 24.75. The scene reported
514,780 triangles, 6 draw calls and 4 figures.

### Phase 5 reconstruction re-baseline

On 2026-08-04 the six-relief reconstruction was measured again on the same local
machine. Browser FPS is from Chromium/SwiftShader and is not a real-device
performance result.

| Gate | Current result |
| --- | --- |
| Focused sculpture tests | 19/19 pass |
| Full project suite | 210/210 pass in about 27 s |
| Twelve-measure proportion gate | 0/12 outside tolerance; worst +0.024 |
| Six exact production body fields | zero boundary and non-manifold edges |
| Fourteen-view Phase 5 matrix | opaque, non-uniform, no errors; 50-60 reported FPS |
| Eight-angle identity orbit | opaque, non-uniform, no errors; 50-60 reported FPS |

The current scene reports 2,060,504 triangles, 8 draw calls and 6 reliefs.

The final local wall times were about 197 s for the fourteen-view matrix and
122 s for the eight-angle orbit. These are machine-specific. The efficient
cadence remains one focused test, one exact camera, then one complete matrix.
Real-device construction and sustained orbit performance remain unmeasured.

## What can be verified, and how accurately

| Claim | Confidence boundary |
| --- | --- |
| Component count, boundary edges, non-manifold edges, winding and positive volume | Deterministic for the exact generated mesh under test |
| Parametric dimensions and control points | Exact to normal floating-point precision |
| Sampled-field detail | Reliable only at the empirical cell ratios above |
| Twelve normalized proportions | Automated tolerance is +/-0.03; current worst error is +0.024 |
| Camera reproduction | Exact stored numeric parameters and CSS viewport; minor raster differences can occur across GPU and driver combinations |
| Framebuffer health | Automated opacity, range and deviation thresholds detect blank, transparent and uniform output |
| Semantic likeness | Human pass/fail against the named crop and landmarks; no honest percentage exists without annotated ground truth and repeated raters |

The framebuffer gate is necessary but does not recognize a baby, foot or
stethoscope. The proportion gate is necessary but has previously been green
while the rendered model was visibly wrong. Neither may be presented as a
likeness score.

## Reproducible commands

~~~bash
# Fast checks for the corrected semantic details.
node --test --test-name-pattern="newborn|stethoscope" tests/sculpture-figure-details.test.js
node --test --test-name-pattern="planted foot|stride" tests/sculpture-figure-details.test.js

# One exact detail view during iteration.
node tools/sculpture-sheet.mjs --phase5 --only p5-04-newborn-support --out shots/sculpt/newborn.png

# Full local gates before closeout.
node --test tests/sculpture-phase5.test.js tests/sculpture-figure-details.test.js
npm test
node tools/sculpture-proportions.mjs
node tools/sculpture-sheet.mjs --phase5 --out shots/sculpt/phase5.png
node tools/sculpture-sheet.mjs --identity --out shots/sculpt/identity.png
node tools/sculpture-sheet.mjs --phase4 --out shots/sculpt/phase4.png
~~~

The isolated probe remains the first stop when geometry is ambiguous:

~~~bash
node tools/sculpture-shot.mjs --page sculpture/dev/probe-parts.html --out shots/sculpt/probe.png --query "three=local&only=body,head&side=front"
~~~

## Closeout rule

A named fine feature cannot close on code review, topology tests, a general
scene frame or a statement that later phases will clean it up. It closes only
when its observation contract has:

- a reference crop and semantic read;
- a representation justified at the feature's physical scale;
- passing mesh assertions;
- an isolated normal-material frame;
- an integrated final-material detail frame;
- a delivery-scale desktop or mobile frame;
- an explicit human pass or an explicitly recorded unresolved difference.

That sequence makes the first implementation observable at the scale where it
will be judged, and makes every later reproduction use the same evidence.
