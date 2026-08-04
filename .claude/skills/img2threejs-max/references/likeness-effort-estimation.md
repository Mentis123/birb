# Likeness threshold and effort estimation

## Contents

1. What the estimate means
2. Build the fidelity contract
3. Establish the supported ceiling
4. Calculate validated iteration cycles
5. Calibrate time and token ranges
6. Interpret thresholds
7. Run and update the estimate
8. Lessons encoded from difficult reconstructions

## 1. What the estimate means

Estimate the work needed to satisfy a declared visual contract, not an
unobservable promise of perceptual similarity.

The estimator reports:

- current weighted contract score;
- the feature requirements that define each target;
- whether the available references and representation support that target;
- expected validated iteration cycles;
- active engineering time and model-token ranges;
- estimate confidence;
- dominant cost drivers, risks and acquisition needs.

A percentage is only meaningful inside its declared feature rubric. It is not
SSIM, LPIPS, a framebuffer score or a universal measure of artistic likeness.
Pixel or embedding metrics may supplement the rubric after camera, crop,
lighting and background are aligned, but they cannot replace semantic review.

## 2. Build the fidelity contract

Start with the scene ledger from the main skill. Create one feature row for each
independently judgeable visual claim. Split a feature when its representation,
reference support or acceptance view differs.

Useful categories are:

- `structure`: count, physical order, facing, front/back and relief direction;
- `silhouette`: full-scene or figure outline and spacing;
- `body`: pose, anatomy, pregnancy, infant contact and body contour;
- `face`: identity-carrying facial planes and landmarks;
- `hand-foot`: fingers, toes, plantar/dorsal form and contacts;
- `hair`: mass, hairline, profile and direction;
- `semantic-detail`: clothing, tools, tubes, pendants and other accessories;
- `surface`: relief depth, wrinkles, texture and local asymmetry;
- `material-lighting`: material response and readable illumination;
- `camera`: reference and delivery framing;
- `interaction` and `performance`: required delivery behavior.

Use five observable levels:

| Level | Name | Acceptance meaning |
| ---: | --- | --- |
| 0 | Absent/wrong | Missing, topologically wrong or contradicted by the reference |
| 1 | Structural | Correct count, order, facing, closure and broad placement |
| 2 | Semantic | An unprompted viewer recognizes the intended form |
| 3 | Reference-faithful | Major landmarks, contour ratios, pose and negative spaces match |
| 4 | High-fidelity | Identity, asymmetry, fine topology and required multi-view surfaces match |

Record `currentLevel`, `weight` and `critical` for every feature.
Weights express the user's judgment priorities and must sum to any positive
number; the estimator normalizes them.

The weighted contract score is:

```text
score = 100 * sum(weight * level / 4) / sum(weight)
```

A target profile declares a default level, category overrides and a minimum for
critical features. The script rejects a profile whose implied weighted score is
below its claimed target.

## 3. Establish the supported ceiling

Every feature needs `supportedLevel` and `supportReason`. This is a
pre-work feasibility statement, not an optimism setting.

Evaluate the ceiling from:

- reference resolution at the identity-carrying scale;
- view coverage and whether hidden surfaces must be invented;
- known scale and camera confidence;
- conflicting source images;
- representation bandwidth and topology;
- required acceptance views;
- whether authored sculpting, scanning or extra source capture is allowed.

Examples:

- A clear front view can support a faithful front-facing facial relief while
  remaining insufficient for a high-fidelity full orbit.
- A mostly occluded hand may support semantic placement but not exact finger
  topology.
- A sampled feature with `rho < 3` cannot support a semantic target in
  that representation.
- A target beyond the declared ceiling is blocked, even if its hypothetical
  implementation cost can be calculated.

Do not lower a ceiling merely because the work is expensive. Do not raise it
because the user wants a higher number. State the acquisition or representation
change that would raise it.

## 4. Calculate validated iteration cycles

A validated iteration cycle contains:

1. one scoped visual hypothesis;
2. one numeric or topology gate capable of disproving it;
3. one exact diagnostic render;
4. one comparison against named landmarks;
5. a recorded accept, reject or next change.

Raw code edits, blind renders and repeated unchanged screenshots are not cycles.

For each level increment, the estimator uses:

```text
difficulty =
  geometric_mean(
    complexity,
    representation,
    reference quality,
    visibility,
    contact risk,
    topology risk
  )

feature cycles =
  category base
  * level-step cost
  * difficulty
  * accepted-view multiplier
  * effective repeated count
```

The six difficulty factors describe correlated aspects of the same feature, so
the estimator combines them with a geometric mean. Multiplying all six directly
would repeatedly price the same hard geometry and produce unusably explosive
ranges. Count, required views and fidelity-level transitions remain explicit
because they represent additional accepted work.
Level-step cost is deliberately superlinear:

| Transition | Cost |
| --- | ---: |
| 0 -> 1 | 0.75 |
| 1 -> 2 | 1.00 |
| 2 -> 3 | 1.80 |
| 3 -> 4 | 3.60 |

The final transition costs more because identity-specific edits couple across
silhouette, topology, material and multiple views. This is why 90% can require
several times the work of 80% without assuming a universal exponential law.

Default category bases:

| Category | Base cycles |
| --- | ---: |
| structure | 0.8 |
| silhouette | 1.1 |
| body | 1.8 |
| face | 2.8 |
| hand-foot | 2.3 |
| hair | 1.6 |
| semantic-detail | 1.8 |
| surface | 1.5 |
| material-lighting | 0.9 |
| camera | 0.8 |
| interaction | 0.8 |
| performance | 1.0 |
| unlisted category | 1.5 |

The other default multipliers are encoded in
`scripts/estimate-likeness-effort.mjs` and emitted in JSON output. They
cover complexity 1-5, representation type, reference quality, visibility,
contact risk, topology risk and required views.

Repeated objects receive partial reuse, never free duplication:

```text
effective count = 1 + (count - 1) * (1 - 0.75 * reuseFraction)
view multiplier = min(1.75, 1 + 0.09 * (acceptedViews - 1))
```

Use a low reuse fraction for faces, bodies or poses that merely look similar.
Use a high fraction only when geometry and acceptance behavior are genuinely
shared.

## 5. Calibrate time and token ranges

Cycles are the primary estimate because they correspond to observable progress.
Time and tokens depend on repository size, browser startup, render cost, tool
latency, context compaction and the model in use.

The template's uncalibrated starting priors are intentionally broad:

- 10,000-40,000 model tokens per validated cycle;
- 0.2-1.0 active engineering hours per cycle;
- 3-8 audit cycles;
- 2-6 closeout cycles.

These are planning defaults, not benchmark claims. Replace them with project
telemetry as soon as possible.

Add successful and failed cycle samples to `calibration.samples`:

```json
{
  "tokens": 18400,
  "activeHours": 0.42,
  "accepted": true
}
```

The estimator derives widened quantile ranges from samples:

- fewer than 4 samples: low confidence;
- 4-11 samples: medium calibration confidence;
- 12 or more representative samples: high calibration confidence.

Record rejected cycles too; they are real effort. Exclude unrelated setup,
waiting for user input and deployment queue time. If token telemetry is
unavailable, omit sample tokens and retain the fallback range with low token
confidence.

The final uncertainty band also expands for hidden surfaces, conflicting
references, poor coverage and unmeasured sampled features. Report active hours,
not calendar promises.

## 6. Interpret thresholds

Do not assign a universal meaning to 80% or 90%. Define the profile first.

A defensible project-specific 80% profile commonly requires:

- all critical structure at level 3 or 4;
- exact count, order, facing and broad silhouette;
- body, face, hands/feet and accessories at least reference-faithful where they
  carry identity;
- accepted diagnostic and delivery cameras;
- no topology defects hidden by material settings.

A defensible 90% profile commonly requires:

- critical identity features at level 4;
- consistent contours and surfaces across all required views;
- exact contacts, negative spaces, asymmetry and fine semantic topology;
- stable materials and lighting that do not hide shape;
- mobile and desktop framing accepted at delivery scale.

A 95%+ profile may be possible, but sparse images and browser-generated
procedural geometry often cannot support it. The estimator should recommend
additional orthographic views, calibrated photography, photogrammetry, a scan
or an authored sculpt/retopology workflow when those are the honest route.

Statements such as "1M tokens to 80%" or "5M to 90%" are valid only after the
feature inventory, target profiles and calibration produce those ranges. Never
hard-code attractive round numbers.

## 7. Run and update the estimate

1. Copy `assets/likeness-estimate.template.json`.
2. Complete the reference and delivery inventory.
3. Define each feature's current level, supported ceiling and reason.
4. Define target profiles from the user's threshold, not from implementation
   convenience.
5. Run the estimator and review blockers before modelling.
6. Acquire missing evidence or change representation when a target is blocked.
7. After 4-6 cycles, add telemetry and re-estimate.
8. At each checkpoint, update current levels and compare actual effort with the
   previous range.
9. At closeout, report estimate error and preserve the calibration for the next
   comparable project.

Use:

```bash
node scripts/estimate-likeness-effort.mjs validation/likeness-estimate.json
node scripts/estimate-likeness-effort.mjs validation/likeness-estimate.json --threshold 90
node scripts/estimate-likeness-effort.mjs validation/likeness-estimate.json --json
node scripts/estimate-likeness-effort.mjs validation/likeness-estimate.json --strict
```

## 8. Lessons encoded from difficult reconstructions

The estimator and workflow deliberately price or block these failure modes:

- Modelling from thumbnails before performing a full-resolution subject census.
- Treating a sequence of directional relief panels as interchangeable
  freestanding figures.
- Correct subject count but wrong physical order, face direction or reverse
  surface.
- A semantically recognizable face, pregnancy, infant, accessory or foot being
  mistaken for reference fidelity.
- Fine tubes, toes, fingers or facial strokes placed in a sampled field below
  its usable signal-to-voxel ratio.
- An isolation probe using denser geometry than production and creating a false
  pass.
- Sampling bounds remaining fixed after a feature grows or rotates, producing
  clipping or open surfaces.
- A near face appearing transparent because the mesh is open or inward-wound.
- Diagnostic angles hiding the contour or axis being edited.
- Vertical-FOV-only framing that clips wide geometry on mobile.
- Closing a phase with unresolved critical human-review items because later
  polish is expected.
- Scoring the full acceptance checklist in the same session that built the
  geometry: a complete 41-item self-scored pass has been invalidated wholesale
  by one independent full-resolution re-read of the references.
- Treating a green numeric gate beside a visibly worse render as progress; both
  recorded occurrences meant the measurement or its normalization was wrong,
  and the fix was to re-measure, not to keep modelling.
- Declaring a detail's diagnostic pixel scale by copying the scene's width into
  `objectWidthPx`, or back-deriving `smallestSignalMm` from the chosen voxel so
  the sampling ratio clears the gate. The contract validator now cross-checks
  declared widths against the declared camera and asks for signal provenance.

The fastest route is early observability: identify the exact feature, choose a
representation that can carry it, render the axis that reveals it and reject
weak work before it spreads into integration.
