# Ordered build handoff

Implement this plan in reviewable stages on current main. [The tiered agent execution plan](../ULTRACODE_REALISM_PLAN.md) says who runs each row, what each model tier may own, and which checks have to be watched failing before anything is spent against them — read it before commissioning any stage below. [The decision report](README.md) defines the art/architecture direction; [the profile protocol](PROFILES.md) defines acceptance. The work begins with the ambitious image, after a short measurement prerequisite. It does not wait for a finished optimizer before doing art.

Effort ranges below are rough experienced-specialist person-days including local iteration, not elapsed-time promises, token estimates or evidence of feasibility. A technical artist and rendering engineer may work on independent deliverables, but integration and phone gates remain sequential. Asset sourcing, device access and substantial feedback changes can expand the ranges.

| ID / order | Owner discipline | Concrete deliverable | Rough effort | Dependencies and exit |
|---|---|---|---:|---|
| R0 — reference/measurement repairs | Rendering + QA | Fresh exact-main baseline, fixed named camera checkpoints, requested/resolved/active control readback, bounded trial reset, scoped allocation ledger | 2–4 days | No dependency. Existing tests/modes green, obstructed views reproducible, no claim that missing controller is complete |
| R1 — hero bird | Technical art + animation | Rebuilt continuous model, feather hierarchy, small rig, three LODs, material set, perch-contact animation and fallback switch | 5–10 days | R0 observation contract. Six-angle inspection plus chase/bank/landing clips; silhouette and contacts pass |
| R2 — coherent light/material foundation | Rendering + look development | Single output owner, AA independent of bloom, outdoor environment lighting, material chart, correct near shadow casters/proxies | 3–6 days | R0. Direct/post parity; same world illumination with shadows on/off except intended occlusion; no fake cone-support shadows |
| R3 — forest river slice | Environment art + rendering | Authored macro/medium terrain, near detail patch, branching trees/perch, grounded objects and forest route | 6–12 days | R0 surface/seed contract; integrate R1/R2. Water-bank/terrain/collision agreement and camera clearance at all checkpoints |
| R4 — responsive world and water | VFX + audio | Shared wind/surface event data, flow/foam/wetness, one hero reflection experiment, bounded low-pass/perch/impact effects, audio lifecycle probe | 3–6 days | R3 surface data, R2 lighting. Effects follow their causes and remain plausible when reduced |
| R5 — phone profile qualification | QA + performance | Actual 30 pacing, versioned profile apply/export/rollback, repeated phone sweeps, 20-minute candidate runs and a selected Pareto set | 3–5 days plus device sessions | R1–R4 reference accepted. Qualify at least one 60 candidate and evaluate deliberate 30 alternatives; if no 60 candidate passes, report failure and iterate |
| R6 — adaptive implementation | Performance engineer | Missing adaptive/learning modules wired to measured traces and existing quality owner | 4–8 days | Device-derived data and existing contract/gate amendments. Implementation-enabled tests/holdouts pass; Manual/Benchmark remain locked; real trace replay succeeds |
| R7 — other three biomes | Environment art + rendering | Canyon geology/river/arches, mountain ridge/snow, city building hierarchy/materials; one authored route each | 6–12 days | Forest profile costs established. Per-biome visual and sustained route checks, no loss of mode functionality |
| R8 — game feel and discovery | Gameplay + UX | Signature mode routes, useful perches, target/material-specific feedback, optional ghost and low-HUD exploration flow | 3–6 days | Geometry/visibility stable. Identical objectives, collision/scoring and touch semantics across profiles |
| X1 — WebGPU/TSL comparison | Rendering specialist | Isolated bird+terrain+output parity scene with both backends and phone evidence | 3–5 days, then a go/no-go | Starts after R3 provides a credible reference. Report measured gain and port scope before any full migration |

The core vertical slice R0–R4 is roughly 19–38 person-days before sustained profile/controller work. This is a substantial rebuild, not a one-session material tweak. Re-estimate after the bird and first hero patch are visible; do not treat these ranges as a fixed contract.

## Builder instructions by change boundary

### R0: buy only the missing evidence

Extend the existing `tools/birb-shot.mjs`, `birb-sheet.mjs`, `birb-quality.mjs` and shader/mode harnesses where appropriate. Do not add a rival capture framework. Preserve the historical gate reports, oracle manifest and source-of-truth performance contract. Any frozen-oracle amendment needs its stated provenance and an independent discrimination example, not an easier threshold that makes a new implementation pass.

Add explicit visual readiness to named snapshots: subject in frame at a minimum projected size, camera outside the relevant solid proxies, and a clear route/target region. A nonblank-frame test remains useful, but cannot substitute for these. Preserve the plain-start test path before calling `setEnvironment()`. Record crop/pose/seed/sun/frame so a future reviewer can reproduce the same defect.

Separate `decorativeDensity` semantics, distinguish target allocation from last-frame use, and fix the memory label/ledger before relying on them for tradeoffs. Save candidate settings and image evidence with an exact code commit and serving build; an unchanged human-readable cache label alone cannot identify all future content.

### R1–R4: deliver the maximum image

Use reference-based anatomy, geology and materials. The current low-poly style is a fallback/comparator; it is not a constraint that forbids the requested realism. Keep the blue/cyan character and clear game objectives. Buy detail where it changes an actual phone view. A beautiful isolated bird render does not accept a bad in-game shoulder seam, and an expensive terrain field does not accept water cutting through the bank.

First show the reference scene at the most convincing manually selected settings, including settings above the historic budget where needed. Then instrument and simplify it into the candidate ladder. Keep content variants behind explicit switches until accepted. Do not merge unrelated flight-controller changes into the art rebuild.

The initial shadow implementation should use one fitted near map and accurate or matching simplified hero casters. It must not create an extra lighting contribution when the operator requests only occlusion. If the current separate shadow light requires compensation, prove the lit material chart remains consistent across the toggle. Test soft filters with thin branches and roof edges rather than declaring the softest enum best.

Define the asset contract: units/scale, forward/up axes, bone names, material slots, LOD bounds, texture color spaces, encoded and decoded sizes, license/source and disposal. Root Birb may use authored assets under this decision. That contract is now written, with a brief an external generation agent can work from and a mechanical acceptance gate (`node tools/asset-check.mjs`), in [AUTHORED_ASSETS.md](AUTHORED_ASSETS.md). `/sculpture` and other apps retain their own contracts. First-load asset fallback must remain playable if the hero asset has not loaded or failed.

Avoid duplicated whole worlds, world-per-profile seeds, changing collision with visual LOD, unbounded particle pools, per-frame PMREM generation, per-frame geometry reconstruction, and broad recursive raycasts over new decoration. The existing prop sector experiment was rejected on measured cost; do not repeat it without a changed clustering premise and a fresh comparison.

### R5–R6: derive sustainable variants

Implement and test real frame pacing before claiming Cinematic 30 or Cool 30. Keep simulation/scoring time independent from render cadence; replay the same input/event trace under 30 and 60 and compare gameplay results. A 30 display target does not authorize lowering control-update quality indiscriminately.

Profiles need complete apply/restore semantics, including content LOD and output color. Capabilities are runtime inputs. If a requested render target or sample count fails, restore a valid path and record a fallback; do not black-screen the trial. Prewarm and apply heavy changes at declared boundaries, then start valid measurement windows.

R6 must consume actual device trace distributions as well as synthetic/holdout scenarios. Existing tests are valuable because they define failure cases; they do not prove the phone's sustained capacity. Preserve unfavorable traces, the quality values in force and the route/event markers. If the controller never raises quality, or rapidly alternates profiles, treat that as failure even when average FPS is good.

### R7–R8: extend the language, not the noise

Each biome gets one hero silhouette, one distinctive surface system and one memorable flight interaction. Density alone is not a biome identity. Expand the proven forest budgets conservatively; city reflection/windows and mountain sky silhouettes need their own failure tests. Keep landmarks discoverable from the minimap and from the environment itself.

Make effects support the existing game loops. Prefer a better launch/impact, responsive perch and readable course over an unrelated new game mode. Introduce a ghost/replay only after deterministic route capture is reliable and after verifying it neither collides nor enters production benchmark timings unintentionally.

## Acceptance package required from every builder

Each change reports the trigger/problem, before/after behavior, code/content revision, controlled screenshots or short motion captures, actual effective profile, mode/structural checks, and complete cost measurements with hardware and limitations. Include rejected variants when they explain a material tradeoff. Mark real-phone gates pending until run; a desktop renderer's FPS must not appear as phone evidence.

For runtime/shader changes, run the applicable existing unit, shader, mode, quality and plain-start checks. For art-only assets, prioritize actual render/LOD/contact and loading tests rather than source-text tests that merely repeat file contents. For docs-only changes, validate links/JSON/manifest consistency without inventing runtime tests.

Keep the final PR description centered on the resulting change, not the sequence of attempted fixes. Default promotion requires the phone protocol. The research plan itself is committed for implementation and does not promote any new rendering profile to production.
