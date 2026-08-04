# Detail-first QA reference

## Contents

1. Observation contract
2. Representation bandwidth
3. Observation scale
4. Feedback cadence
5. Diagnosis matrix
6. Confidence boundaries
7. Closeout evidence

## 1. Observation contract

Define a semantic detail before modelling it. A useful semantic read tells an
unprompted viewer what must be recognizable, such as "two curved medical tubes
with separate terminals." "Geometry exists on the chest" is not sufficient.

Every contract needs:

- exact reference image and pixel crop;
- 3-8 stable landmarks, edges or negative spaces;
- model-space width, height and depth;
- the smallest stroke, gap or relief carrying identity, with the measurement
  provenance that produced it (crop and px-to-mm conversion);
- contact, crossing, clearance and occlusion expectations;
- representation and its resolution;
- isolated and integrated render routes;
- fixed camera and viewport values;
- mesh, render and human acceptance criteria.

The two most gameable numbers get explicit rules. `smallestSignalMm` is a
reference measurement made BEFORE choosing the voxel size; deriving it from
the voxel so the sampling ratio clears the gate defeats the gate, and a batch
of ratios that all land just above the boundary is itself a review flag.
`objectWidthPx` is what the declared camera projects for THIS object
(`px = widthInModelUnits * viewportHeight / (2 * distance * tan(fov / 2))`),
not the scene's width. Relabelling a whole-scene camera as a small detail's
diagnostic view satisfies the pixel floor on paper while the detail renders at
a fraction of it; the validator cross-checks every view's declared width
against its camera and warns on impossible claims and on diagnostic cameras
that cannot reach the 150 px floor at all.

Before per-detail contracts, build a scene ledger covering every subject or
panel. Record physical order, front/back, facing, pose, body state, hair,
hands/feet, accessories, contact relationships and whether the source depicts a
freestanding volume or directional relief. Treat uncertainty as data rather than
silently filling it with a generic form.

Use `assets/detail-contract.template.json`, then run
`scripts/validate-detail-contract.mjs` before implementation and again with
`--closeout` at completion.

## 2. Representation bandwidth

For sampled fields use:

```text
rho = smallest identity-carrying thickness / voxel size
```

Project operating limits:

| Ratio | Interpretation | Action |
| --- | --- | --- |
| rho < 3 | Unsafe | Reject sampled geometry |
| 3 <= rho < 6 | Fragile | Broad relief only; require normal-material proof |
| rho >= 6 | Reasonably stable | Continue to visual validation |

These are empirical guardrails, not a universal theorem. Surface nets and
similar methods average crossings within cells. Thin features can leave numeric
or vertex extrema while having no recognizable rendered surface.

An isolation probe is only evidence for production when both paths use the same
geometry factory, voxel size, deformation limits, blend behavior and sampling
bounds. Derive bounds from the maximum final rotated or deformed extent. A dense
probe or stale production bounds can create a false pass.

Example: a 17 mm stethoscope tube sampled at 14.5 mm has rho=1.17. Its field can
be mathematically correct while the surface disappears. Explicit TubeGeometry
preserves the continuous path and terminal topology.

Use sampled fields for bodies, cloth masses, broad facial planes and organic
fillets. Prefer explicit meshes for:

- wires, tubes and narrow curves;
- fingers, toes, rims and discs;
- holes or gaps whose negative space carries identity;
- accessories that must remain separate from the body;
- features requiring exact connected-component behavior.

An explicit mesh can encode dimensions below a field voxel. That does not prove
the feature is visible at delivery distance.

## 3. Observation scale

| Level | Typical scale | Question |
| --- | ---: | --- |
| Scene | 1-5 m | Is composition, lighting and orbit readability correct? |
| Figure | 0.5-2.5 m | Is pose, facing and silhouette correct? |
| Object | 30-600 mm | Does the accessory, infant, hand or foot read? |
| Surface | 5-100 mm | Does relief exist with clean topology and normals? |
| Raster | pixels | Can the delivery camera carry the visual signal? |

For a diagnostic view, target:

- complete object width of at least 150-250 CSS pixels;
- smallest identity-carrying stroke of at least 8 CSS pixels;
- explicit viewport, DPR, FOV, target, yaw, pitch and distance;
- a reference crop presented at comparable scale.

These targets enable judgment; they are not similarity scores. Validate both a
close diagnostic view and a real delivery view. The diagnostic view proves the
geometry; the delivery view proves contextual readability.

The diagnostic camera must expose the axis, contour or negative space changed
in the current iteration. A three-quarter view that hides foot direction, relief
depth or facial orientation is not adequate merely because the overall render
looks attractive.

## 4. Feedback cadence

Use the cheapest gate that can disprove the current claim:

1. Run numeric assertions after changing dimensions or control points.
2. Run topology checks after generating a mesh.
3. Capture one exact detail camera after a meaningful visual change.
4. Capture diagnostic plus delivery views after integration or material work.
5. Run the full matrix only at checkpoints and closeout.
6. Run production views after deployment, preferably in fresh contexts.

Keep the browser and scene alive when possible. Rebuilding a complex scene can
dominate a one-view capture. Measure local load, settle, render and readback
separately before claiming an optimization multiplier.

## 5. Diagnosis matrix

| Observation | Likely cause | First probe |
| --- | --- | --- |
| Field math passes; mesh is absent | Resolution, blend or sampling bounds | MeshNormalMaterial isolation |
| Normal mesh reads; final material does not | Light, material, shadow or contrast | Neutral material, shadows off |
| Isolation reads; integrated view does not | Occlusion, contact or projected scale | Part toggle and depth inspection |
| Desktop reads; mobile does not | FOV, target, distance or responsive crop | Exact mobile camera |
| Near face looks transparent | Open boundary or inward winding | Boundary count and signed volume |
| Extremum/bounds pass; identity fails | Existence test is semantically weak | Landmark/silhouette assertion |
| Camera labels differ but images do not | Harness did not apply parameters | Read live camera state into result |
| PNG exists but scene is blank | Capture did not inspect WebGL pixels | Framebuffer readback |

Do not tune several systems at once. Disable one thing, swap one material or
isolate one component so each result identifies a cause.

## 6. Confidence boundaries

Report certainty by class:

| Claim | Defensible certainty |
| --- | --- |
| Components, boundaries, winding, volume | Deterministic for exact tested mesh |
| Parametric values and control points | Floating-point exactness |
| Sampled detail | Empirical at stated voxel ratio |
| Camera | Exact parameters and viewport; raster may vary by GPU |
| Framebuffer | Deterministic thresholds for opacity and variation |
| Likeness | Human score against named references and landmarks |

A framebuffer can prove that pixels rendered, not that they depict the intended
object. A proportion gate can prove selected ratios, not overall likeness.

When reporting a likeness percentage, define the weighted observable contract
before scoring. Record each feature level, weight, evidence and denominator.
Use `assets/likeness-estimate.template.json` and
`scripts/estimate-likeness-effort.mjs` for threshold planning. Call the result
a contract score, not measured perceptual similarity.

## 7. Closeout evidence

Require for each named fine feature:

- reference crop and semantic read;
- representation justified at physical scale;
- passing geometry assertions;
- isolated normal or silhouette capture;
- isolated final-material capture;
- integrated diagnostic capture;
- desktop/mobile delivery capture as applicable;
- explicit human pass or recorded unresolved difference.

Require for the scene:

- a subject ledger re-verified against the FULL-RESOLUTION references at
  closeout — count, order, facing and relief class. A complete detail-contract
  pass built on a wrong structural census is void, not partially credited; a
  41-item self-scored acceptance has been invalidated wholesale by one
  independent full-resolution re-read;
- an independent acceptance pass by a reviewer who did not build the geometry,
  judging only the matched photo|model pairs, with every demotion recorded;
- no page or console errors;
- nonblank, sufficiently opaque and nonuniform framebuffer samples;
- fixed view matrix with live camera values recorded;
- triangle and draw-call statistics;
- relevant tests and performance results;
- preservation of unrelated repository changes.

Do not call a phase complete because geometry is present, the broad scene looks
acceptable, or a later phase might improve it.
