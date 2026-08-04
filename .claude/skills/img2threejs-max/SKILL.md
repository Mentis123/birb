---
name: img2threejs-max
description: Scope, estimate, build, repair, and optimize reference-accurate Three.js models and scenes from images with explicit fidelity thresholds, calibrated effort ranges, detail-first observability, representation-scale analysis, deterministic geometry checks, reproducible screenshots, desktop/mobile visual QA, strict zero-asset support, and honest closeout. Use when the user invokes /img2threejsMAX; asks how much work or how many tokens are needed to reach a stated likeness; asks to turn photos, screenshots, scans, or concept art into Three.js/WebGL/3D geometry; asks to improve a model's likeness or fine details; or reports clipping, see-through surfaces, missing geometry, incorrect order or orientation, weak faces/hair/body shape/hands/feet/accessories, poor materials/lighting, mobile framing, or an inability to reproduce visual defects.
---

# /img2threejsMAX

Build image-referenced Three.js work as an evidence-driven reconstruction, not
as an unobserved modelling exercise. Make each important visual claim
reproducible at the scale where a person will judge it.

## Required outcome

Deliver all of the following unless the user explicitly narrows the task:

- an upfront inventory, fidelity contract, supported fidelity ceiling and effort
  estimate for nontrivial reconstruction work;
- a functioning Three.js scene or targeted repair that follows the repository's
  existing architecture;
- exact diagnostic and delivery cameras for desktop and mobile;
- deterministic geometry checks for every changed semantic detail;
- screenshots that reproduce the reference-relevant views;
- framebuffer checks proving the canvas is nonblank, opaque and nonuniform;
- a feature-by-feature visual assessment with unresolved differences stated;
- relevant tests and performance statistics;
- no claim of likeness based only on tests, dimensions or a healthy framebuffer.

Do not close a feature because a later phase might clean it up.

## Preserve the representation contract

Read the repository's asset and runtime constraints before proposing a geometry
strategy. Treat a zero-asset requirement as immutable when the project declares
one:

- Do not ship imported or runtime-fetched meshes, reference images, textures,
  HDRIs, fonts, photogrammetry, data URIs or other external/bundled media.
- Keep photographs, crops, measurements and screenshots as development evidence
  only. Never import them from the production page.
- Do not disguise an imported mesh as a dense vertex dump or opaque encoded
  payload. Use auditable procedural builders, profiles, curves, primitives,
  fields and compact landmark parameters.
- Runtime-generated geometry and materials must be deterministic and traceable
  to named reference landmarks. Generated textures are acceptable only when the
  repository's own zero-asset definition permits them.
- Include the constraint in the fidelity ceiling and effort estimate. If the
  target cannot be defended under it, report the ceiling and the required
  procedural/topology work instead of quietly violating the constraint.

## 1. Inventory the original before editing

1. View every supplied image at original resolution. Inspect crops rather than
   relying on conversation thumbnails.
2. Inventory the references by viewpoint, crop, subject, occlusion and useful
   scale anchors.
3. Create a scene ledger with one row per subject or panel. Record physical
   order, front/back/side, facing direction, pose, body state, hair, facial
   identity, hands/feet, accessories, contacts and visible reverse surfaces.
4. Classify each form as freestanding volume, positive relief, negative relief,
   shell, sheet, tube, imported asset or hybrid. Reject imported assets when the
   representation contract forbids them. Do not substitute one class for
   another merely because it is easier to generate.
5. Inspect the repository, current rendered scene, Three.js version, geometry
   pipeline, test tools, browser harness and unrelated local changes.
6. Capture the current defect at exact desktop and mobile viewports before
   changing geometry. Save the camera parameters and the image.
7. Establish coordinate conventions, model units, subject height and the
   reference-facing direction. Never infer front/back from a single ambiguous
   image.
8. Mark every uncertain or occluded fact. Do not silently turn an inference into
   reference truth.

When the repository already has a rendering, testing or geometry pattern, use
it unless evidence shows that it cannot represent the required detail.

## 2. Define the fidelity threshold and estimate effort

For a reconstruction with multiple subjects, views or identity-carrying details,
or whenever the user asks how close it can get, copy
`assets/likeness-estimate.template.json` into the project validation
area and fill it from the scene ledger before substantial modelling.

Run:

```bash
node <skill-dir>/scripts/estimate-likeness-effort.mjs <estimate.json>
```

Use `--json` for machine-readable output,
`--threshold <id-or-score>` to inspect one target and
`--strict` when unsupported targets should fail the command.

The reported percentage is an auditable **contract score**, not a claim that a
computer has measured human perceptual similarity. Define what each target
requires by feature category and level:

0. absent or wrong;
1. structurally correct;
2. semantically recognizable;
3. reference-faithful in major landmarks and contours;
4. high-fidelity identity, asymmetry and multi-view surface behavior.

Estimate validated iteration cycles first. Derive active time and model-token
ranges from measured project samples when available. Without samples, label the
token estimate low-confidence and keep the range broad. Never promise an
unsupported threshold: state the reference, representation or topology change
needed to make it defensible.

Read
[references/likeness-effort-estimation.md](references/likeness-effort-estimation.md)
for the scoring formula, complexity factors, calibration procedure, feasibility
ceilings and interpretation of 80%, 90% and higher targets.

## 3. Define observability first

Copy `assets/detail-contract.template.json` into the project validation
area and create one entry per semantic detail. Fill it before implementing that
detail.

The contract must identify:

- what an unprompted viewer must recognize;
- the exact reference asset and crop;
- 3-8 landmarks that establish the shape;
- physical dimensions and the smallest identity-carrying signal;
- contact, clearance and occlusion relationships;
- representation choice and sampled-field voxel size when applicable;
- an isolation probe;
- exact diagnostic and delivery cameras;
- mesh and render assertions;
- human pass/fail status and unresolved differences.

Run:

```bash
node <skill-dir>/scripts/validate-detail-contract.mjs <contract.json>
```

Use `--closeout` before declaring completion.

Read [references/detail-first-qa.md](references/detail-first-qa.md) when defining
contracts, physical scale, projected pixel scale or acceptance boundaries.

## 4. Select a representation that can carry the signal

For sampled geometry calculate:

```text
rho = smallest identity-carrying thickness / voxel size
```

- `rho < 3`: reject the sampled representation.
- `3 <= rho < 6`: treat it as fragile broad relief and require an
  isolated normal-material close view.
- `rho >= 6`: consider it stable enough to test visually.

Use sampled fields for broad organic masses and fillets. Use explicit geometry
for narrow continuous paths, wires, rims, fingers, tubes, discs, gaps and small
objects whose identity depends on topology or silhouette. Preserve detail with
separate meshes first; optimize draw calls only after acceptance.

The isolation probe and production scene must use the same representation,
resolution, deformation limits and sampling bounds. A high-resolution probe
does not validate a coarser production mesh. Recompute sampling bounds from the
largest deformed or rotated extent; stale bounds can clip a feature while its
field math still passes.

Example: a 17 mm tube in a 14.5 mm voxel field has `rho = 1.17`. The
field may mathematically contain it, but the generated mesh cannot reliably show
it. Use TubeGeometry or another explicit curve mesh.

Read [references/threejs-implementation.md](references/threejs-implementation.md)
for camera matching, SDF/surface rules, topology tests, material diagnosis,
framebuffer sampling and mobile checks.

## 5. Build from isolation to integration

1. Lock count, order, facing, relief direction, camera and coarse silhouette
   before polishing anatomy or surface detail.
2. Build in dependency order: closed primary volumes, broad body silhouettes,
   pose and contacts, face/hair, hands/feet, semantic accessories, then surface,
   material and performance work.
3. Build each semantic detail in an isolation page or selector.
4. Render it first as silhouette or MeshNormalMaterial with shadows disabled.
5. Add geometry assertions for bounds, components, continuity, signed volume,
   winding, boundary edges, non-manifold edges and required clearances as
   applicable.
6. Render the final material in isolation.
7. Integrate it and verify contact, depth ordering, occlusion and surrounding
   silhouette.
8. Run only the affected exact camera after each meaningful change. Choose a
   camera that exposes the axis or contour just edited; a flattering angle is
   not a diagnostic view.
9. Run the complete desktop/mobile matrix at checkpoints and before closeout.

Do not use DoubleSide, transparency, shadow-side overrides or aggressive
smoothing to hide broken geometry. Diagnose winding, open boundaries, sampling
bounds and self-shadowing directly.

## 6. Use the shortest trustworthy feedback loop

Apply this cadence:

| Change | Immediate gate |
| --- | --- |
| Formula, control point or dimension | Targeted numeric test |
| Generated mesh | Topology and bounds test |
| Fine visual feature | One exact diagnostic view |
| Integration, material or lighting | Diagnostic plus delivery view |
| Camera or responsive behavior | Desktop and mobile pair |
| Checkpoint | Full view matrix and project tests |
| Deployment | Critical production views in fresh contexts |

Keep a browser/scene alive when the project permits it. Scene construction
often dominates capture time; a persistent observer can make repeated camera
settle and readback much faster. Measure that gain before reporting it.

Count a validated iteration cycle only when it includes one scoped visual claim,
the cheapest deterministic gate that can disprove it, an exact render and a
recorded comparison decision. Do not count raw edits or repeated blind renders.

## 7. Diagnose from evidence

- Field evaluation passes but the normal-material mesh is missing: inspect
  sampling ratio, blend radius and sampling bounds.
- Normal material reads but bronze does not: inspect material, light, shadow and
  contrast.
- Isolation reads but integration does not: inspect projected size, occlusion,
  contact and competing silhouette.
- Desktop reads but mobile does not: inspect FOV, target, distance and projected
  pixel scale.
- Far interior appears through a near surface: inspect boundaries and winding;
  do not call it transparency without evidence.
- Bounds pass but identity fails: rewrite the test around semantic shape rather
  than existence.
- A probe passes but production fails: compare the exact geometry factory,
  voxel size, deformation bounds and feature flags used by both paths.
- The object fits desktop but crops on mobile: calculate horizontal FOV from
  vertical FOV and aspect ratio, then fit both width and height explicitly.
- A feature reads correctly but still looks unlike the reference: semantic
  recognition has passed; compare identity landmarks, asymmetry and contour
  ratios at the next fidelity level.

## 8. Self-evaluate visually

For each detail, compare the stored crop and rendered crop side by side at a
matched viewpoint. Score named landmarks and relationships, not general mood.

Review in two passes:

1. **Structural:** subject count/order, facing, front/back, closure, silhouette,
   body state, pose, contacts and projected scale.
2. **Identity:** face and hair landmarks, exact body contour, hands/feet,
   accessories, negative spaces, asymmetry, relief depth and surface character.

A recognizable pregnancy, infant, face or medical accessory is not by itself a
reference-faithful match. Record which level passed and which did not.

Separate these confidence classes in the report:

- **Deterministic:** topology, components, bounds, control points and encoded
  dimensions for the exact mesh.
- **Empirical:** sampled-field stability and performance on the tested renderer.
- **Reproducible:** camera parameters, viewport, DPR and framebuffer thresholds.
- **Human judgment:** semantic likeness against named references.

Never convert framebuffer health, dimensions or topology into a fake likeness
percentage. If likeness needs a percentage, use the predeclared weighted
contract, record each feature level and state the denominator and evidence.

## 9. Close out honestly

Before completion:

1. Run the contract validator with `--closeout`.
2. Run targeted geometry tests, full project tests and any proportion gates.
3. Capture all exact diagnostic and delivery views.
4. Confirm no page or console errors and nonblank/nonuniform framebuffer data.
5. Record triangles, draw calls and device/browser context.
6. List unresolved visual differences and whether they are in or out of scope.
7. Re-run the estimator with actual cycle samples and current feature levels;
   report estimate error and recalibrate future ranges.
8. Preserve unrelated local changes.
9. Commit, push, open/merge a PR or deploy only when the user requests those
   repository actions.

Completion means the named details are observable and accepted now, not merely
present in code.
