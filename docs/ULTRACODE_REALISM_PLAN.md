# Ultracode execution plan — the realism programme

**How to run [`docs/realism/BUILD_BACKLOG.md`](realism/BUILD_BACKLOG.md) with a fleet of agents: what each tier may own, which checks have to exist before anything is spent against them, and what the owner is actually for.**

This is the execution layer. [The decision report](realism/README.md) makes the art and architecture calls; [the build handoff](realism/BUILD_BACKLOG.md) orders the work; [the profile protocol](realism/PROFILES.md) defines device acceptance; [the authored-asset brief](realism/AUTHORED_ASSETS.md) covers anything generated rather than coded. None of them says who runs it or how it is checked. That is here.

It is the successor to [`ULTRACODE_PERFORMANCE_PLAN.md`](ULTRACODE_PERFORMANCE_PLAN.md), which ran the workbench and controller programme. That plan's tiering law, oracle rules and wave discipline carry forward unchanged; what is new here is the art corollary in §3 and the fact that the deliverable this time is an *image*, which no model tier can score.

## Provenance

Produced by a 43-agent workflow against main at `011592b`: ten stage analysts (one per backlog row R0–R8 plus X1) → thirty adversarial verifiers (three lenses per stage — *oracle reality*, *aesthetic laundering*, *sequencing and file ownership*) → three critics (cost, honesty, wave sequencing). 7.4M tokens, zero agent errors, 297 findings of which 113 are stage-blocking. The design it critiques is its own first pass; what survives is below.

Every claim about this repo that the plan rests on was re-checked by hand before being written down here. Line numbers are as of `011592b` and will drift. The five that matter most:

| Claim | Verified |
|---|---|
| `tools/birb-sheet.mjs` pins the tier and **nothing else** — no world seed, no sun freeze, no pose capture | `grep -c "worldSeed\|setSunEnabled\|capturePose"` → **0** |
| `src/environment/seeded-random.js` returns `Math.random` when unseeded, so an unpinned world is a different world every run | `worldRng()`: `if (_worldSeed === null) return Math.random;` |
| `src/environment/spherical-world.js` line 2 is a CDN import, so it **cannot be imported under `node --test`** | `import * as THREEImported from "https://esm.sh/three@0.183.2"` |
| `tools/birb-lighting.mjs` has **zero exports**, so every task planning to "reuse its pattern" cannot import it | `grep -c "^export"` → **0** |
| `assertA10` filters its routed fields and only fails when **none** are present — a renamed field is silently skipped, not caught | `quality-assertions.mjs:853–856` |

Also measured: `tools/oracle-manifest.txt` carries **58** hashed files and `sha256sum -c` is green today; `index.html` is **11,211** lines with the `__BIRB` hook object starting at 10406.

---

## 1. The three findings that change what you would have done

### 1.1 The flip test the whole programme rests on cannot currently be run

R0 exists to buy oracles, and the tiering law says an oracle counts only once it has been **watched failing**. The two documented bad frames — the canyon flight tile and the mountain perch tile — are the discrimination example that every later stage plans to cite.

They are not reproducible. The sheet that produced them pinned only the tier, so the world seed was `Math.random`, the sun moved through its ten-minute cycle across a multi-minute eight-tile walk, and the flight tile was captured at whatever pose a free-flying bird happened to hold after a fixed settle. No pose, seed or sun time was recorded.

Worse, neither oracle the first-pass design proposed can go red on either frame even in principle:

- The canyon defect is **occlusion by foreground geometry**. A projected-size metric has no depth term and cannot express occlusion; and the chase camera holds a fixed damped offset, so projected size is near-constant across exactly the frames it must separate.
- The camera-outside-colliders check is blind to it too, because the obstructing geometry has no proxy: `addCollider()` is called for tree/rock/cloud/spire/tower/boulder/mountain props only, and **terrain has no collider at any radius** — ground is a separate path through `checkGroundCollision`/`terrainFloorDir`.
- Nothing proposed can go red on the mountain perch tile at all. Its central-band pixel standard deviation is 97.21 — the *second highest* of the eight tiles — so no image statistic flags it; the camera is outside every collider sphere; and all four perch tiles are the turret first-person view containing **no bird**, so a subject-in-frame check is red on four of eight for a reason that has nothing to do with the defect.

The defect on that tile is a **blocked aim sightline**, which is R8's check pulled four stages forward.

**So Wave 1 is determinism first, and the oracle is scored against the frozen pixels.** `docs/realism/evidence/manifest.json` already carries a sha256 for the committed contact sheet — that is a legitimate fixture even though the live poses are lost. Thresholds are written before the run, the honest count of "how many of eight does this flag" is reported rather than tuned toward two, and if the canyon frame cannot be re-derived under a pinned sweep the honest output is *the historical defect is unreproducible; the oracle was proven on the frozen pixels plus a synthesised occlusion*. Substituting an easier camera-inside-geometry case and presenting it as the same finding is the failure mode.

### 1.2 The target does not exist yet, and that is upstream of every tiering question

The deliverable is "a believable blue bird in a natural miniature world." No model tier can judge believability — the plan knew that. What it missed is that there is nothing to judge *against*: `docs/realism/` holds six documents and five PNGs of the **current** build. No reference imagery of a bluebird, a forest river, or any look being aimed at.

Compare the one project in this repo that solved a likeness problem. `/sculpture` has `reference/` with matched photographs, `sculpture-sheet.mjs` compositing each render beside the photograph it was matched to, and `LIKENESS.md` — 41 binary checks **pre-committed before the work**, each citing the photograph that settles it, with the explicit note that every attempt to turn that judgement into a metric produced a number that lied. It also records, twice, the exact failure this programme is set up for: green gate, worse render.

This programme has neither half. R1's acceptance is "must clearly beat Shipping Reference," judged in one sitting against a memory. R3's is "does it feel like the five-second reference moment" — a moment nobody has committed to an image.

> **A stage with no pre-committed target does not have a hard oracle. It has an acceptance criterion written after the artefact exists, by the person who just spent three weeks making it.**

The fix is cheap and it is a prerequisite, not a nicety: **before R1 or R3 generates a single variant, commit reference images and a 20–30 item pre-committed binary rubric per stage** into `docs/realism/reference/`, evidence-only, never imported by the page. That converts about half of "is it beautiful" into "does this read, yes or no, against that photograph" — checkable by eye in ten minutes, and not re-negotiable afterwards.

### 1.3 About a quarter of the tasks can change a pixel; forty cannot, by construction

R0, R5, R6 and X1 are forty tasks covering measurement, profiles, the adaptive controller and a backend comparison. Not one of them makes the game look better. That is defensible — oracles are bought so they can be spent — but it means **a full quarter of the programme can report all-green with the shipped frame byte-identical**.

The honest taxonomy of the 123 tasks:

| Class | Count | What it means |
|---|---:|---|
| Genuinely agent-completable | 55–60 | Mechanically settleable; the owner reads a gate and nothing else |
| Agent-assisted, owner-decided | ~20 | Agents produce labelled comparable candidates; the owner picks. **These are the only tasks whose output is the deliverable.** |
| Pure device or human, no substitute at any tier | 7 | Thermals, cadence feel, touch latency, audible mix, the phone sessions |

And a precedent worth reading twice before committing to any of it: **the largest visual change of the entire previous session was one enum — tone mapping — and every geometry and overlay effort in that session failed.** This plan is almost entirely geometry and overlay effort.

---

## 2. The one check the programme must have

Everything else in this document is scaffolding. This is the check that can catch a stage that landed every green box and did not improve the game.

**A blind, paired, forced-choice discrimination test against a frozen Shipping Reference, run at every stage exit.**

1. **Freeze now**, at `011592b`, 10–14 captures under fully pinned conditions — world seed, sun frozen at a stated time, tier pinned 0, pose captured and restored, DPR fixed — covering the eight named checkpoints plus at least three short motion clips (cruise, bank, water skim). Each carries a sidecar recording every pin. Hash them into `docs/realism/evidence/manifest.json`, which already does exactly this for the current five PNGs. **That set is Shipping Reference and it never changes.**
2. **At every stage exit**, re-capture the identical set under identical pins.
3. **Present each pair unlabelled, in randomised left/right order.** Record which the owner picks and how long it takes.
4. **The stage's headline number is the fraction of pairs where the new build wins** — and the threshold is stated in advance. With twelve pairs, something like 10 of 12. Stated *before* the stage starts, not after the sheet exists.

Why this and not anything else: it measures the deliverable rather than a proxy; it runs on the shipped frame, so no amount of module-level green inflates it; it is the only check that can catch a correctness fix costing beauty, a variant sheet of identical tiles, a budget fence that strangled the art, or a stage that did forty tasks of infrastructure. It costs about ten minutes per stage — less than any one of the gate reports the owner is otherwise expected to read. And it forces the determinism work (seed, sun, pose, tier pinning, capture sidecars) to actually exist, which nothing else in the programme owns and which R0-5, R1's A/B, R2's sun sweeps, R3's variant sheets, R7, R8 and X1 all silently assume.

The blindness and the pairing are not fussiness. The owner is the one person who cannot self-correct for knowing which image he paid for; a labelled A/B measures anchoring, not discrimination. And the per-pair result is a regression tripwire for free: any checkpoint where the new build *loses* is a named finding with a reproducible pose.

> **"The owner scored at chance" has to be a legitimate, recordable, non-shameful stage outcome.** A stage that lands every green check and does not beat Shipping Reference has produced infrastructure, not beauty, and the honest report says so. As first written there was no state in the plan for that sentence, which is exactly why it would have been true and gone unsaid.

### The five mechanisms it exists to catch

1. **Correctness fixes that are visual regressions.** Removing double illumination makes the world darker. Replacing the uniform cone proxy with fitted proxies makes shadows more and larger. Adding an environment probe with no ambient rebalance makes everything flatter. Each is a real bug fixed with a green parity check, and each may make the frame worse. Nothing else in the plan can express *the fix was correct and the image got worse*.
2. **Fences set before the art.** Choose the triangle ceiling, generate every variant inside it, then validate the ceiling on the phone. The budget check goes green because the art was constrained to fit a number invented before anyone looked.
3. **Sheets whose tiles are identical.** This repo has already shipped ground tints "about 0.1 apart per channel — measurably present, visually absent." A shadow sheet can produce twelve tiles where two options alias to the same Three constant. Five photographs of one option is a passing sheet and a blind pick. **Every variant sheet needs a mechanical non-degeneracy filter** — per-tile pixel hash plus a minimum pairwise difference over the region of interest — that refuses to emit the sheet rather than annotating it.
4. **Provisional picks that are never reopened.** R1's palette is provisional pending R2's rebalance; R2's shadow and probe picks pending R5's phone; R3's geology pending R5. No task reopens any of them. A provisional pick never revisited is a pick made under the wrong lighting.
5. **Fixing the photograph instead of the world.** "Adjust each checkpoint's pose until the predicate passes" is a search for the camera that hides the problem. `HANDOFF.md` already names it.

---

## 3. The tiering law, and its art corollary

**The law.** A cheap agent (Haiku, Sonnet) may own a task only if a check exists that (a) can fail, (b) was authored by someone else, and (c) has been *watched failing*. All three, or the tier moves up.

**The art corollary.** Structural correctness is mechanically checkable and therefore cheap-tier eligible. Aesthetic judgement is checkable by no model tier and is owner-only. The programme's job is to keep those two apart — in both directions, because **laundering runs both ways**: a structural label on an eye-call, and owner attention spent on something a script already settled.

**The file rule.** `CLAUDE.md` is ~20k tokens and every subagent eats it unconditionally. `index.html` is ~94k. Together that is 57% of a 200K window before any work. **Haiku never opens `index.html`** — not a difficulty judgement, a context-arithmetic one, and it is what sets the floor on tasks as small as a two-line change.

**The cost consequence of the file rule.** A Sonnet task that must open `index.html` costs about **8×** a Haiku module task, while the rate differential between the tiers is only 2×. Volume, set by file context, is the dominant cost variable; tier is second-order.

### Where cheap tiers genuinely pay

A real Haiku surface of 12–16 tasks exists: pure-function modules with no THREE, no DOM, no `index.html`, graded against a test someone else wrote and watched fail. Rig joint solves, contact solves, event pools, hysteresis detectors, gain curves, the effect-verification assertions, requirements bookkeeping. Plus CLI driving where the harness already exists and the exit code is the answer, and sheet generation over exported helpers.

**Every one of them is conditional on a Sonnet task authoring the test first.** The first-pass design asserted that condition in prose and assigned it to nobody — in one case naming a Haiku task as the authority that authors another Haiku task's oracle. Add one Sonnet oracle-authoring task per cheap cluster. It costs about $1.50 and it is the only thing that makes the $0.38 real.

### Where reaching for cheap is false economy

- **Tasks where the tolerance is the task.** The recorded cheap-agent failure mode is widening a threshold until green. Keep the sampling boilerplate cheap; move threshold derivation and the flip-test mutation up a tier.
- **Tasks whose method is "tune a parameter until the predicate passes."** That is exactly what a cheap agent does enthusiastically and wrongly — and see §2 mechanism 5.
- **Tasks whose oracle is not in the manifest.** Five adaptive-controller tasks were priced on 96 flip-tested assertions that are real and **not one of which is hashed in `tools/oracle-manifest.txt`**. `sha256sum -c` exits 0 today and would still exit 0 after any of them was quietly edited, so clause (b) of the law is unenforced from the moment the implementer opens the file. Freeze them first or those tasks are not cheap-tier eligible.

### The single highest-ROI item in the whole programme

**Extract the terrain and placement maths out of `spherical-world.js` into a THREE-free module.** One Sonnet task. It unblocks six downstream tasks that today have no Node oracle at all, because that file's line 2 is a CDN import.

---

## 4. The wave plan

Sixteen waves, **max 7 agents each** — the 16-agent wave that lost four agents to API errors is the anti-pattern. Waves 1–6 are runnable today and are specified in detail. Waves 7+ are re-planned at their entry gate, because their inputs are owner picks that do not exist yet.

### Standing preamble — paste into every wave script

```js
const RULES = {
  unitTest: "npm test",             // `node --test --test-isolation=none` exits 9 on node v22 here
  baseline: "648 tests / 438 pass / 210 skip / 0 fail",
  modeSweep: ["forest","canyons","mountain","city"],  // NOT "canyon"; default run is forest only
  haikuNeverOpens: ["index.html"],  // 11,211 lines ~94k tok + CLAUDE.md ~20k = 57% of a 200K window
  oneIndexOwnerPerWave: true,       // named in each phase; no two index.html tasks in flight
  frozen: 58,                       // sha256sum -c tools/oracle-manifest.txt
  frozenRule: "every frozen edit lands via THIS wave's single opus gate, manifest regenerated in the "
            + "same commit. A red `sha256sum -c` between the edit and the gate is EXPECTED — do not "
            + "regenerate, read the gate log.",
  noSelfOracle: true,               // no agent authors the check it is graded by
  captureRule: "every capture goes through __BIRB.pinCheckpoint and emits a sidecar "
             + "{seed, env, view, pose, quat, sunTime, tier, build}. A capture without a sidecar is "
             + "not evidence.",
  artRule: "an art phase that ships one option has failed. Score = labelled comparable variants per "
         + "unit of owner attention."
};
```

### Wave 1 — determinism substrate + the visibility oracle, grounded on frozen pixels

One Sonnet owner for `index.html` (every probe below is one file region), then three parallel authoring tasks, then the flip test, then one Opus gate.

The `index.html` owner delivers: `__BIRB.worldSeed(n)` honoured **at world build**; `__BIRB.pinCheckpoint({seed, env, view, sunTime})` which sets the seed, disables and sets the sun, forces the nest for perch views, captures the pose — **not `freeze()`, whose own comment says it does not hold the bird** — and returns the full record for the harness to write beside the PNG; `cameraProbe()`; `colliders()` and `clearanceAt(x,y,z)` using the exported mesh-height sampler, not the analytic floor; `subjectOcclusion({subject})` casting a ray grid from camera to subject bbox; `aimSightline()`; and `trial({seconds})`, the bounded reset that is R0's missing fifth deliverable.

The header on that work must state the thing that invalidated the first design: **the collider grid is a PROP index, not a solidity index** — 32 `addCollider` sites against 54 instanced prop layers, and the terrain mesh has no collider at any radius.

`tools/lib/frame-visibility.mjs` gets three checks: in-frustum and not near-clipped (named honestly, cheap); occlusion as unoccluded-subject-pixels over subject-projected-pixels, **plus foreground coverage** — the fraction of frame pixels at depth under half the subject's; and a pixel mode over the committed tiles. The **subject contract per view class is written before the first run**: flight is the bird bbox, perch is the aim target region plus a horizon. All four nest tiles contain no bird, so a bird-keyed check is red on four of eight, and that is a finding about perch views rather than a bug in the oracle. Thresholds are derived from the accepted distribution *after* the run, never reverse-fitted before it.

`tools/lib/perch-sightline.mjs` is R8's check pulled forward, and it is the only thing that can go red on the mountain perch tile. March the ray at a step no larger than the grid's cell size — `collider-grid.query` is documented complete only for an entity radius up to 14 and a sightline is 60–200 units. Its header must say it certifies *no solid collider on the ray*, never *the view is clear*.

**Gate: read-only, ~20 min.** Is the red genuine or a loosened threshold? Is the mountain perch covered, or honestly uncovered — a half pair labelled beats a full pair reverse-engineered. **STOP** if the flip test flags 0 of 8 or 8 of 8, or if the subject contract had to be rewritten after seeing the tiles.

### Wave 2 — one owner for the panel, the checkpoint pick, the capture surface

Four separate first-pass tasks wrote into one ~130-line region of `index.html`, three of them into the same object literal within six lines. They are one deliverable — *the readback stops claiming things it does not do* — and they collapse into one task.

That task keeps `decorativeDensity` as a live derived **alias**: deleting it makes the frozen A10 assertion pass on seven fields instead of failing, which is a silent downgrade of the only guard on the code being edited. It splits the routed semantics, gives the label the name of the quantity actually routed, and adds a four-stage readback — requested → resolved → configured → active — with the AA state exposed as two fields with two sentinels, **read only, no render-path surgery**. It renames the memory estimate to its real scope and itemises every render target and shadow map with format, dimensions and sample count.

Three cheap tests ride on it, and each replaces a grep oracle that could not work:

- A **declaration table** test: call the real resolver for every panel key, fail on any key resolving to something undeclared, and fail on any key whose resolvable set has size one while it serialises a live-looking number. Neither "what the code implements" nor "has zero runtime variants" is a lexical property, so the greps were never going to hold.
- A **ledger completeness** test, not an arithmetic one: enumerate every renderer-owned target and shadow map at capture time and fail on any unledgered one. An arithmetic check cannot detect a missing term — and the current code already reproduces the protocol's worked example exactly, so a renamed function with zero new terms would pass it.
- A **clearance** test consuming the Wave 1 hook.

Then: give `tools/birb-lighting.mjs` its exports and extract the scene-pinning helper into `tools/lib/pin-scene.mjs`, with the discrimination that the extracted helpers reproduce the existing grade run byte-identically. Six later tasks plan to "reuse that pattern" and today cannot import it.

**Gate — the first real pick. 24 tiles** (8 checkpoints × 3 candidates), each stamped with unoccluded fraction, foreground coverage, nearest-collider clearance, sightline distance, seed and sun time. The owner freezes the eight canonical checkpoints. **Removed from the gate:** the label wording (determined by the code) and the ledger arithmetic (the completeness test's job). **A hard spread requirement applies** — candidates for a checkpoint must differ by a stated margin in unoccluded fraction and foreground coverage, because projected size is near-constant across chase and perch poses and cannot separate the tiles. Unmet spread is an escalation, not a sheet.

### Wave 3 — extract the bird, buy its oracles, six silhouettes

`createProceduralBirb` is 377 lines inside `index.html`, called once. Four variant-producing tasks cannot parallelise inside a 94k-token file, and there is no bird model module — `bird-visual.js` is a 118-line quaternion helper with no geometry.

Barrier first: a **verbatim** extraction to `src/flight/bird-model.js`, accepted only on pixel-identical and node-identical before/after under a Wave 1 pinned capture. It also lands `__BIRB.pinPose({elapsed, stick, beatPhase})`, because the flap phase comes from a render-loop counter exposed on no hook — so every silhouette comparison in the stage would otherwise be taken at a different wing-beat phase.

The asset contract is **authorship, not transcription** — no skeleton or LOD system exists in this repo. It must pin `userData.baseRotation` and the `scale.z = -1` mirror rule as contract surface rather than node names: about 130 lines of the animation path are guarded on that userData key existing, so a rig satisfying every name still falsifies the guard. It must forbid duplicate joint names across LOD levels, because `getObjectByName` returns the first traversal match regardless of visibility — three levels each carrying `leftWing` means LOD0 is posed forever while the visible level renders in bind pose.

The oracles include the **mirror-symmetry sweep nobody currently asserts**, per contributing term so a regression names the term; a red-first perch-contact suite; and silhouette IoU at a stated mask resolution with **per-level printed floors plus a landmark-retention check**, because IoU is structurally blind to the eye and the beak — they are interior.

**Gate — pick: 6 body + 6 feather tiles, with the shipping procedural bird as the mandated comparator.** Static only; no rig, no clips, no material pick.

### Wave 4 — rig, contacts, LODs, fallback, the clip reel

Nothing in `tools/` records motion today. The filmstrip extension must run at a **fixed simulated timestep** — the ribbon arc-length trap measured 5 units at 60fps and 70 in a 2fps harness, and a beat cadence captured at the harness's frame rate misreports itself the same way.

Rig and contact wiring **merge into one `index.html` task** because they write the same region. Joints resolve once into cached handles and re-resolve on LOD switch, which removes five per-frame subtree string compares.

The fallback oracle is stated as **three runs with three expected exit codes**, never "both stay green": `birb-modes.mjs` fails on any warning, so a fallback that announces itself makes it red by construction. Forced failure → modes exits 1 with the fallback warning as the sole noise entry, asserted by text; the same run's shot exits 0 and reads `procedural-fallback`; a normal load → modes exits 0 and reads `hero`. And it must test **load-succeeds-validation-fails**, since a failed hero load leaves a working game today.

**Gate — pick: 2 LOD strategies rendered at 1×, 2× and 4× real projected size** (at 1× alone the owner cannot physically resolve the question), plus 8 clips, plus believability scored as named citable binary checks — the `LIKENESS.md` method, never an invented percentage. The contact epsilon is **printed as context, not put in the decision list**; it is a number the solve already settled. What is eye-only is head stabilisation, grip and settle time.

### Wave 5 — light-rig spec, the material chart, and two oracles that are red on main today

The cross-consumer register **must include the key light's intensity**, not just its position and colour: the visual uniforms are fed from colour × intensity, the base intensity is re-latched on every environment switch and rewritten every frame, so a naive rebalance is reverted one frame later and the parity probe cannot see it. Constrain the fix to write the shadow light only.

The material chart must be **`MeshStandardMaterial` swatches** — a Basic-material chart cannot catch a PBR double-lighting regression. One reference swatch with `receiveShadow = false`, so "never in shadow" is a *material fact* rather than a geometric coincidence against a shadow camera re-aimed at the bird every frame; **and one swatch with `receiveShadow = true` plus a known caster**, or the occlusion half of the exit criterion has no observable at all. All swatches inside a documented central radius, because the vignette runs only in the composite. Also: extract the material-program invalidation out of the shadow-enable setter and **call it from the shadow-type setter too** — the map type is a program-cache-key input and the type setter does no flush today.

Three cheap probes, all importing the shared pin helper:

- **Parity**: the direct path is bloom disabled at pinned tier 0, *not* a pinned tier 1. Tolerance pinned and printed with its discrimination margin.
- **Double lighting**: assert a **pair** — the unshadowed swatch equal within epsilon *and* the occluded swatch darker by a stated delta. The single-swatch version is fully satisfied by a fix that deletes shadows entirely. Sweep the sun, do not pin one angle.
- **AA scanline**: pin mobile emulation and assert the mobile flag before sampling, because the context is created with antialiasing off on mobile and a desktop run silently measures context MSAA. It certifies that scene MSAA reached the scene pass, **not which level** — 2× and 4× measured identically at two blended pixels.

Re-record the colorspace revert as a catalogued mutation across an exposure sweep. At the shipping exposure the broken-vs-fixed gap is about **10/255, not the famous 52**; an unpinned tolerance is fatal here.

**Gate: read-only. STOP if the double-lighting probe is green on unmodified main** — the bug is documented live, so green means the probe is wrong.

### Wave 6 — fix, fit, probe, and two picks

The shadow rebalance (never writing the key light's intensity), the AA/bloom decoupling, and PMREM `scene.environment` **plus** the probe hook routed through the quality-settings request path — a later task depends on a hook no first-pass task built — plus a PMREM stats readout.

Publish host dimensions **and a base offset** onto the nestable positions. This is load-bearing: that list holds *perch points*, so today's proxy is anchored on top of the crown — a 20-unit cone standing above the canopy casting the shadow of nothing, while the 14–58-unit trunk below casts none. The fit check therefore asserts proxy **base world position** against ground contact, not just dimensions; it is red on main, where every instance decomposes to unit scale against one fixed cone.

The PMREM call-count guard is a permanent regression test, and its strawman — a version that regenerates per frame — is authored here rather than left to the implementer.

Sheets: apply shadow settings **after** pinning the scene (pinning turns shadows off); every tile reads back and prints its effective triple, and a tile where requested ≠ effective is **disqualified before the owner sees it**; a pixel-hash dedup pass collapses candidates identical by construction on the pinned Three version. The probe sheet varies probe intensity alone at each biome's **shipped grade re-applied after pinning** — exposure was settled at the grade gate and must not be silently re-litigated.

**Relabel R2 as not device-gated**, and record both picks as provisional, reopened at the profile-selection gate. As first written R2's gate waited on R5 and R5 waited on R2; that cycle has to be cut here.

### Waves 7–11 — the forest slice and the responsive world (compressed, re-planned at entry)

**W7 — extract the terrain field, then author its oracles.** Order is load-bearing: extract a THREE-free `src/environment/terrain-field.js` on the injected-dependency shape `water.js` already uses → publish a world-surface interface **plus a reference implementation re-exporting today's behaviour unchanged** → only then author the invariant checks, watched failing against a deliberately perturbed reference. The floor invariant is sampled over a **uniform sphere distribution**, not the capture region; pole continuity gets its own test, which the profile protocol names and nothing currently checks.

**W8 — geology and hero tree, one sitting.** Six terrain and six tree candidates on **one** sheet at the same two forest checkpoints, all pre-fenced: floor invariant, height-field agreement, triangle and draw ceiling, **collider correspondence** (points in canopy gaps query clear, points in trunk query solid — the arch lesson: a centre collider makes an arch a wall with a picture of a hole on it), and perch admissibility against the already-frozen horizon-dip maths. Failing candidates are excluded from the sheet, not annotated on it.

**W9 — near patch, grounded objects, route, checkpoints, forest budget.** Adds the **allocation-discipline check** the risk lists demand and nobody owns: count over ~120 frames of route, buffer identities stable, counts flat after warmup. A naming convention is not an oracle. The route lint is authored **once** as a biome-generic suite deriving canopy clearance from the live prop table, never a transcribed literal. Checkpoints are expressed as (surface anchor, back, lift, aim target) resolved through the world-surface interface at runtime — hardcoded world coordinates rot the first time terrain moves.

**W10 — one field, one pool, honest audio scope.** Collapse the two proposed event pools into one with a closed event enum, and state whether the two that already ship migrate onto it or are permanent documented exceptions. Field consistency becomes **provenance** — a monotonic revision each consumer records — never value equality, because the foliage wind *aliases* the shared uniform and equality holds by construction even if the field is never consulted. The audio scope was wrong in the first pass: the continuous-sound registry is a three-key object literal that structurally cannot grow, a visibility handler already exists, and the only audio context already self-resumes; the real probe targets preloaded-slot reuse under rapid fire and needs an audio hook added first.

**W11 — water flow, reflection, effects, sheets.** The reflection renders as an explicit top-level render call with an explicit pass tally, **never** from `onBeforeRender` — that nests inside the outer render and resets the renderer's info mid-frame, so the reflection's calls vanish and the world pass under-reports. The frozen exact pass-count assertion is **parameterised by reflection mode under a gate**, never relaxed to a `>=`. The reflection sheet is **clips, not stills** — lag during flight is the defect that separates the three representations, and a still cannot show it. Add mirror-parity and update-cadence assertions so the owner picks on looks rather than on whether one is upside down.

### Wave 12 — the pre-device wave, then a **hard stop**

Frame pacing must sample **presented** frames, not rAF callbacks, and the target rate has to become an *input* to the tier comparison — the interval recorder, the acceptance gates and the tier thresholds are all 60-absolute today. Per-profile thresholds are **injected at the call site**, never by editing the frozen absolute constants, and require a discrimination pair before they are trusted: a synthetic paced-30 trace that passes and a 60 Hz half-rate judder trace with the same mean that fails.

Pull the evidence-record module **forward** from R6, against its already-frozen suite; without it the owner's sessions export a shape carrying no ladder, no per-rung cost and no provenance, and two later stages both consume it. Add bounded per-segment session summaries — the existing ring buffer is about 8.5 seconds and structurally cannot express a 20-minute session. Replace the blob-download retrieval path, which wraps everything in a silent catch and is unreliable on WebKit, which every iOS browser is.

Regenerate the manifest to cover the eight adaptive-controller suites, the trace fixtures, the constants module and the satisfiability instrument — **none of which is in the 58 today**, so every oracle the controller wave plans to spend is currently unprotected.

> **The device hard stop.** No R5 conclusion, no R6, no budget expansion until a device evidence file exists carrying at least one record with a device-performance claim scope and a software-renderer flag of false. `docs/realism/evidence/` is desktop composition evidence and must never be mistaken for it.

**The owner's device sweep is not a wave.** iPhone 16 Pro / Chrome 152. Order: the export round-trip smoke test **first** — do not spend a 20-minute session before one round-trip has been observed — then short segments across all survivors, then 20-minute sustained on at most three candidates plus recovery, then 30 minutes on the chosen default. **One trip carries three payloads**: the profile Pareto rows, the controller's evidence fixture, and the backend comparison's per-backend readings with the **iOS version** recorded, because WebGPU on iOS is gated by OS version and not by the Chrome string. Five separate trips is the failure mode.

### Waves 13–16 and X (terse, each re-planned at entry)

**W13 — profile selection.** The Pareto tool contributes only the dominance function, against a hand-worked fixture authored by a *different* agent. It **prints the derived default** under the protocol's stated rule and the owner confirms or overrides, rather than deriving it by hand. Non-comparable pairs are flagged as both retained. Exactly one gate for the stage.

**W14 — the adaptive controller.** Order is load-bearing: manifest regen → close the fixture gap → **re-derive the contract's site census** (the pinned counts no longer match the file, and one clause states in bold that a function has no call sites when it has three) → **capture a golden fixture from the legacy inline controller before the wiring task deletes it** → comparator, watched red against a perturbed copy of that fixture, never against a missing module → the modules → wiring → the A/B harness. Parity is a **rung-vs-time timeline diff**, not a per-rung value map: "exactly" is a property of *when* rungs flip, and per-frame feeding changes exactly that. The holdout seed is supplied only in the gate prompt, drawn outside the defaults, and the run must report zero skipped.

**W15 — the other three biomes.** **No new checkpoint oracle** — this stage supplies checkpoint *tables* to Wave 1's module. Note `canyons`, not `canyon`: the mode sweep discards the environment setter's return value today, so an unknown id silently drives the forest and exits 0. That is a frozen edit with its own gate, and that run is its discrimination example. The city window check is a **pixel differential against a forced-off state**, not a userData flag that stays true when the shader fails to compile. Add a **course-anchor invariance** task: the slalom anchor is one fixed direction added to every environment, so a canyon or mountain terrain change moves gates — including the forest course R3 signed off and R5 phone-qualified.

**W16 — game feel and discovery.** The cross-profile outcome-parity harness as first specced is **vacuous**: every adaptive tier site is decorative, nothing reads collision, LOD or spawns, so the fault it is told to inject does not exist. Ship instead a **structural invariant** over the requirements' tier-site list — no tier site reads or writes collider radius or position, collectible spawn count or proximity radius, drone counts or radii, muzzle clearance, collision-target membership, nest positions or scoring constants — watched failing by adding a site that gates a collider. Delete the mode lint as written (it compares an enum with its own values). Retarget the perch check at per-perch aim reachability and shots per wave, which can fail on a relocated perch, rather than a constant snapshot that cannot.

**WX — the backend comparison, gated on Wave 1's recorded probe.** Measured in *this* container, and to be re-checked rather than believed: `navigator.gpu` is undefined under default args and under the unsafe-WebGPU flag, and the capture harness forces ANGLE/SwiftShader, which guarantees no adapter. If that holds, the CI half of this stage does not exist and no port may be commissioned until the owner's device capture produces real WebGPU frames. **Backend attestation is mandatory on every capture** — a WebGPU renderer falls back to WebGL2 silently, and such a run reports 0.0 parity error and identical draw calls, which reads as a triumph. It lives in its own top-level directory on the `/gauntlet`, `/sculpture`, `/icon3d` precedent, and acceptance includes a diff that touches nothing outside it.

### Cross-wave ownership register — publish at the top of every script

```
index.html          — exactly one owner per wave. Named in the wave. No exceptions.
spherical-world.js  — one owner per wave (W6, W7/W8/W9, W15). Never two in flight.
frame-visibility.mjs, perch-sightline.mjs
                    — authored ONCE in W1. R1, R3, R7 and R8 are CONSUMERS that supply
                      checkpoint tables and thresholds. Their authoring language is deleted;
                      that alone removes two Opus gate passes and two frozen-file amendments.
birb-lighting.mjs   — exported in W2, one owner across R2/R3/R4/R5/R7.
gates               — one Opus gate per wave, maximum.
```

---

## 5. Cost

Verified pricing (checked against the live API, not recalled): **Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5** per MTok — exactly 5:2:1 in both directions.

| Archetype | Haiku | Sonnet | Opus |
|---|---:|---:|---:|
| module task (250k in / 25k out) | $0.38 | $0.75 | $1.88 |
| Sonnet-volume module (500k/50k) | — | $1.50 | $3.75 |
| **`index.html` task (1.2M/60k)** | **barred** | **$3.00** | **$7.50** |
| oracle / gate (1.5M/80k) | — | — | ~$9.50 |

Base cost of the 123-task design with no retries: **≈ $302**, against **≈ $567** for the same volumes run entirely on Opus — a **1.88×** tiering multiple.

That multiple is a fiction until retries are priced. Scoring every task against the four conditions that make cheap work actually cheap — the oracle exists today, it has been observed red today, its file is hash-frozen, and the task excludes `index.html` — **roughly 55 of 115 agent tasks fail one of the first two**. The oracle is absent, unrunnable (six tasks have no Node oracle at all because of that one CDN import), tautological, or vacuous. At two retries plus one Opus diagnosis per defective task that is **≈ $720 of retry tail**.

| | As written | With oracles repaired and duplicates collapsed |
|---|---:|---:|
| Tiered | ~$1,022 (70% of it oracle repair) | **~$432** |
| All-Opus | ~$1,307 | ~$752 |
| **Tiering multiple** | **1.28×** | **1.74×** |

> **Fixing the oracles is worth about $720. The entire tiering decision is worth about $265.** And they are not independent: a defective oracle converts a $0.38 Haiku task into a $13 Opus incident — a 34× overrun.

### Duplication, which is Opus-priced

The checkpoint-visibility predicate was authored **four times**, and three of those claimed the same discrimination example — which can only be spent once, so two of the three could not be watched failing at all and would silently have become vacuous-oracle tasks. Six separate things were called a parity harness. Two event pools sat on top of two that already ship. Four biome routes were authored twice. Seven tasks extended a sheet compositor that exports nothing.

Collapsing these removes three Opus authorings, four frozen-file gate cycles and about fourteen duplicate task-instances — and it removes more retry tail than it removes base cost.

### Gates

The first pass carried 14 Opus tasks but implied about **22 gates**, because six stages amend manifest-frozen files with no gate task at all. Honoured, that is roughly $210 in tokens and 5.5 hours of the owner reading. **One gate document per wave**, covering every frozen-file amendment in it, with one provenance section and one discrimination section. 22 → 8.

### Wall clock

Tool latency, measured: unit tests ~36s; shader check 1–2 min per biome; mode sweep 3–6 min; contact sheet 6–10 min; a browser gate 15–25 min; a full frozen-file gate cycle 45–70 min with zero rework.

The binding constraint is three regions of one file — the panel readback (~200 lines, six tasks), the present/tier/render-loop region (nine tasks, one of which deletes what another just built into), and the single 680-line hook object (nine separate appends). At 20–40 min per `index.html` task inclusive of verification and rebase, **25–33 serialised tasks is 12–17 hours of pure sequence** before a single retry. Merging the panel region to one task, ordering the render region strictly with a single named owner, and batching the hook appends to one per wave takes it to about eight, and the file-ownership critical path from ~14 hours to ~4–5.

---

## 6. Owner attention — the resource that is actually scarce

Counted from the first-pass gate texts: **≈ 67 discrete decisions across 10 sittings**, plus 22 gate reports at ~15 minutes each, plus **five separate physical device sessions** (one of which had no task assigned to it at all). At 5 minutes per informed pick that is 5.5h deciding, 5.5h reading and 12–18h of device sessions.

> **23–29 hours of the owner, against ~$1,000 of tokens. The token bill is a rounding error on this.**

Five cuts, none of which reduce the number of variants seen:

1. **Delete the reverse-laundered decisions** — the ones a script already settles. Label wording determined by a lint; ledger arithmetic that is its own oracle (and hand-checking supplied numbers cannot detect an omitted term anyway); a contact epsilon the solve already produced; a "gameplay unchanged" call that is a harness's job; a default-profile pick the protocol states as a rule, so show the derived answer and let it be overridden. **−8 to −10 decisions, zero loss of choice.**
2. **Five device sessions → two.** Pull the runbook and the evidence schema to the *front*, then ride the audio judgement, the controller's evidence trace, the budget requalification and the backend timings as extra rows on the sustained runs that have to happen anyway. Saves 6–10 hours, and removes the situation where the programme's first phone session runs with no runbook and no schema.
3. **22 gate reads → 8.**
4. **Selection → elimination, then reconfirm.** Cull six candidates to two per axis on desktop in one sitting — still six variants seen — and let the surviving two ride into the phone session as one extra sheet. Same exposure, half the sittings, and the final call made where the protocol says it must be.
5. **One sheet per gate, numbers pre-stamped, illegal candidates excluded before display.** Eight checkpoint picks is one sitting, not eight, if every tile carries its own numbers and nothing failing a structural gate is on the page.

Then spend the freed capacity on the axis that is currently starved: **raise the variant count to at least 4 everywhere it is below** — including the one system with no sheet at all. Adding variants costs Haiku capture minutes, not owner minutes, **provided** the non-degeneracy filter from §2 refuses to emit a sheet whose tiles are the same picture twice. The ground-tint precedent says that filter is not theoretical.

**Net: 67 → ~30 decisions, 10 sittings → 6, 5 device sessions → 2, 22 gate reads → 8, owner time 23–29h → 10–13h — with more variants seen than the plan as first written offered.**

---

## 7. How to start

1. **Commit the reference imagery and the pre-committed rubric** (§1.2). Nothing in R1 or R3 should generate a variant before this exists. It is the cheapest item in the programme and the one everything else is measured against.
2. **Freeze Shipping Reference** (§2) — 10–14 pinned captures plus three motion clips, hashed into the existing evidence manifest. This is Wave 1's real output as much as the oracle is.
3. **Run Wave 1.** Determinism, then the visibility and sightline oracles, then the honest flip-test count.
4. **Read the Wave 1 gate.** If the flip test flags 0 of 8 or 8 of 8, stop — the oracle is wrong, and every stage that plans to spend it is scheduled against a check that cannot fail.

The rest is re-planned at each wave's entry gate, deliberately: waves 7 onward take owner picks as inputs, and those picks do not exist yet.
