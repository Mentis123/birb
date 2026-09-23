# Baby Blender — the plan, consolidated

2026-09-23. **One live backlog.** Everything still open was scattered across
the PRD's delivery plan (§9–§11), `Editor_Feel_Plan.md` "Still open",
`Device_Pass_2.md` §7.6 and §8.5, `Device_Pass_3.md` §9, the Unity hand-off in
`Import_into_Unity.md` and the Unity notes in `CLAUDE.md`. It is all here now,
with ten new ideas in §3. The pass documents stay as history and evidence; the
PRD stays the spec for scope. **New open items go in this file**, not into the
next pass document.

## 1. Where it stands

| Built | How it is known to work |
|---|---|
| Export core: VRM 1.0 and FBX 7400 writers, skeleton, rig gate | 8 `verify.sh` stages: Khronos validator, PNG inflate, Blender's glTF and both FBX importers, a render. Unity built a Humanoid Avatar from the FBX first time (Chest left unmapped, §2D). |
| Clay template: 3,750 vertices (3,458 welded), 6,912 triangles, mirror-exact | `tools/build_clay.py` + `check_template.py`; reproducible in CI. |
| Engine: tables, Grab / Inflate / Deflate / Smooth with X symmetry, picking, surface paint (world-space brush, taper, hardness, mirror), pressure, `StrokeEngine`, document with bounded undo/redo and discard | 270 tests on Linux; every device defect so far became a test that fails on the old code. |
| App: Metal viewport (MSAA 4×), orbit / pan / pinch / re-pivot / frame / flick, Pencil with coalesced and predicted touches, low-latency `UIUpdateLink` loop with fallback, hover ring, palm rejection, two-finger undo, three-finger readout with measured touch→glass, Brush & Pencil settings persisted, Pencil tap and squeeze honouring Settings | Compiled by CI in Release and Debug. Run on the iPad through four device passes; the fifth (2026-09-23) is unmeasured — `Device_Pass_3.md` §8 is the checklist. |

## 2. Open items, consolidated

### A. Blocking the Clay release (PRD Phase 1 and 2 gates)

1. **Export from the iPad produces nothing.** "Export Model" runs the
   pre-flight and dismisses the sheet; nothing in `app/` writes a file, though
   the app already links `ExporterVRM` and `ExporterFBX`. Needed: write
   `ModelName.zip` (FBX, GLB, `Textures/…_Albedo.png`, manifest) into the
   document's folder, hand it to the share sheet and Files, with progress and
   cancellation. This is the PRD's own Phase 1 gate: sculpt, paint, export,
   open in Blender and Unity. The file is already proven (`blender_check_paint.py`
   reads our GLB); the missing half is the file reaching the iPad.
2. **Documents do not persist.** No document shell, browser, autosave or
   reopen; a force quit loses everything, not "the active stroke". Shape: a
   `UIDocument` package holding template id and version, the sculpt delta
   (3,750 × 24 bytes), the albedo PNG (written off the main thread), settings;
   autosave after each stroke.
3. **Naming a document** at creation, once documents exist. The New Project
   chooser itself waits for the Humanoid (§2E); until then a new document is
   Clay, by the PRD's rule that a picker with one option is furniture.
4. **Orthographic front / side / back views and a wireframe overlay** (PRD §5).
   `Camera` is perspective-only; the renderer has one display mode.
5. **Reference images**: scene planes and up to four pinned cards (PRD §5,
   restored 2026-09-05). Nothing built.
6. **Paint UI gaps**: the eyedropper exists in the core (`Paint.swift`) with no
   control; no palette or recent colours. Erase exists.
7. **Phase 2's list**: resets, warnings, export progress and cancellation,
   manifest hashes, error reporting, a regression corpus of real documents.
8. **2048 texture.** The app builds `Document.clay()` at 1024; the PRD says
   2048. What blocked it — the two ends of a stroke at 16.9 ms — is 4.9 ms
   now, so it is a product decision plus one device measurement: the paint
   map (185 ms at 1024 in Release on the iPad) and memory both scale ×4.
9. **Shipping**: TestFlight hardening, icon, launch screen; the name (PRD §14
   flags the "Blender" mark; App Store review is its own gate); the rename of
   `humanoid/` the PRD defers to Phase 1's restructure.

### B. Unmeasured on the iPad

- **The fifth pass has not been run.** `Device_Pass_3.md` §8, fourteen steps.
  The two numbers to send back are touch→glass with the low-latency loop on
  and off, with the iPad model.
- Whether `wantsImmediatePresentation` brings a frame forward on this iPad
  (Apple says it does; one forum thread could not make it report so).
- The pressure defaults (`fullForce` 0.5, Soft, 20% floors), the palm size
  (40 pt), the ten-point slop, the 0.3 s window after the Pencil lifts. A
  five-second calibration ("press as you normally would") would settle the
  first by measurement rather than by four sliders.
- "Nothing yet proves the loop stays alive under a long stroke" (Device_Pass_2
  §7.6): the readout's queue depth is a reading, not a check. Idea 1 below is
  the check.
- Review finding 9 (a late low-latency confirmation delays one frame's
  samples): shows as two clusters in the touch→glass readout if it happens
  at all. Device-only.

### C. Engine and performance

- **A BVH for picking.** Raycasts are brute force over 6,912 triangles at
  0.044 ms, which is fine for this Clay and is what caps a denser template.
- **Sparse undo — superseded.** Undo records already carry only the dirty
  rectangle and copy it as rows (0.017 ms). What actually blocked 2048 was
  the stroke-end cost, fixed 2026-09-23.
- **Squeeze → palette at the tip — partial.** The squeeze opens Brush & Pencil
  at the toolbar; Apple's intent, and `Editor_Feel_Plan`'s, is a palette at
  the hover point.
- **Per-frame allocations**: re-audit after the fifth pass. The colour
  conversion was one (fixed); the engine's pending arrays are preallocated.

### D. Unity and VRChat (Phase 0 loose ends)

- Unity's auto-mapper leaves **Chest unmapped**; Unity tolerates it, VRChat's
  `AnalyzeIK` does not. Assign by hand for now; find out what about the bone
  (name, position, parent) makes the mapper skip it.
- **Mirror handedness is unverified** — the one thing `Import_into_Unity.md`
  asks the Unity session to look at first.
- **The VRChat SDK panel is unverified**, and `tools/unity-verdicts.json`
  does not exist yet: every verdict, pass or fail, should be recorded so the
  rig gate is tested against reality.

### E. Phase 3 — the Humanoid layer (PRD §9)

- Eight proportion controls: authored deltas plus joint-fitting rules.
- Pose preview, four poses, GPU skinning (`Skinning.deform` exists in the core).
- New Project chooser: two live cards and the one-line "permanent" warning.
- Rig checks in the export pre-flight; "Export for VRChat" wording;
  `Import_into_Unity.md` in the zip.
- Brush clamps near joints, eyes and mouth — see idea 3, which is the same
  mechanism.

## 3. Ten more ideas (2026-09-23)

Each with why it belongs in this app, a cost, and how we would know it worked.

1. **A stroke recorder, and a Linux replay of it.** A switch in the readout
   writes every `StrokeSample` (phase, location, force, timestamp, kind), the
   camera and the brush options of a session to a file in the document's
   folder; `humanoid-cli replay` drives them through `StrokeEngine` against
   the same document, headless, and prints the summary the readout shows.
   *Why:* every device pass so far started from a sentence ("the pencil
   wasn't working, then did") and ended with a choice between three guesses.
   The engine is already a pure function of samples, camera and document, so
   a recording makes the owner's exact strokes reproducible on the build box,
   where the tests are, and turns a report into a test case. It is also the
   long-stroke liveness check §2B asks for. *Cost:* about a day. *Proof:* a
   recording from the iPad replays to the identical summary (samples, dabs,
   texels) and, for sculpt, identical positions to 1e-9.

2. **Sculpt layers.** N delta arrays instead of one — the shape is
   `template + Σ layer.delta × layer.weight` — with a layer list, a weight
   slider, visibility and merge-down; strokes land on the active layer.
   *Why:* fixed topology makes this almost free (a layer is 3,750 × Vec3),
   and it is the control ZBrush and Nomad users lean on most: block the form
   on one layer, details on another, dial either back without undo. It also
   gives "reset all" a gentler form. *Cost:* two to three days. *Proof:* the
   sum at weight 1 equals the single-delta result bit for bit; weight 0
   restores the template; the exporters see the summed mesh, so every oracle
   is unchanged.

3. **Masking.** A per-vertex mask (0–1) painted with a Mask tool — same
   falloff and mirror as the brushes — shown as a tint and honoured by every
   sculpt brush as `weight × (1 − mask)`; clear, invert, blur. *Why:* the
   other half of every sculpting workflow, and the PRD's "brush clamps near
   joints" for the Humanoid is exactly an authored mask, so this builds the
   mechanism Phase 3 needs anyway. *Cost:* one to two days. *Proof:* a fully
   masked region does not move under a full-strength Inflate; the joint
   clamp is expressed as a mask and tested on the rig corpus.

4. **Four more brushes: Flatten, Pinch, Crease, Clay.** Flatten moves toward
   the brush's local plane, Pinch toward the stroke path, Crease is Pinch
   with a push inward, Clay lays a capped thickness along the stroke. *Why:*
   Grab, Inflate and Smooth make lumps; Flatten and Pinch are what turn a
   lump into a face. Each is a few lines in `Sculpt`, because the dab
   machinery — resampling, symmetric weighting, the reference surface, undo —
   is shared. *Cost:* about half a day each. *Proof:* a property test per
   brush (Flatten lowers local variance, Pinch shortens distance to the path,
   Crease is Pinch plus inward, Clay is bounded per pass) and the existing
   frame-batching invariance test run over every brush.

5. **A Reset brush.** Blends the delta toward zero under the falloff — "back
   to the lump", locally, mirror-aware. *Why:* undo is by stroke and in
   order; a reset brush is the spatial undo every sculptor reaches for, and
   with deltas it is one multiply. *Cost:* hours. *Proof:* a full-strength
   pass returns the vertices under it to the template within the falloff and
   touches nothing else.

6. **Matcap, cavity and "hide paint".** Matcap shading (clay, red wax, grey
   chrome) from a small baked sphere image; a cavity term from the one-ring
   curvature, updated with the normals; a toggle to view the model without
   its paint. *Why:* form is judged by how light rolls over it, and paint
   hides it. Every sculpting app defaults to a matcap; this renderer has one
   Lambert light over the shoulder, and cavity darkening is what makes fine
   strokes visible at all. *Cost:* one to two days. *Proof:* the same
   capture discipline as the game: render one pose under each mode and
   measure that cavity raises local contrast on a sculpted bump; no extra
   draw calls.

7. **Clay shapes from the same generator.** `tools/build_clay.py` gains a
   sphere, an egg and a bust blank (head and neck with a nose ridge) at the
   same vertex count with mirror-exact tables; the Clay card offers the
   shape. *Why:* a rounded cube is the worst start for a head, which is what
   most people sculpt first; the generator, the tables and the tests exist,
   and the app can only ever load one template. *Caveat:* the PRD's New
   Project has exactly two cards, so the shape choice sits inside the Clay
   card, not beside it. *Cost:* a day. *Proof:* `check_template.py` on every
   shape; the sculpt and paint suites run on all of them.

8. **Pencil Pro: barrel roll sets the brush, haptics say what happened.**
   Roll the Pencil to change the brush size (hardness, for paint) with the
   hand still on the model; a haptic tick through the Pencil
   (`UIFeedbackGenerator` given the view, iPadOS 17.5) on tool switch, undo,
   crossing the symmetry plane, and when a stroke is refused because the
   paint map is not ready. *Why:* every visit to a settings panel is a break
   in flow, the roll axis is the one control the Pencil has that this app
   ignores, and three device passes have shown that a silent refusal reads
   as "broken". *Cost:* a day. *Proof:* on the device only; the roll-to-size
   mapping is logged, and the checklist gains two lines.

9. **AR Quick Look of the sculpt.** Write a USDZ (ModelIO, with the albedo)
   and present it with `QLPreviewController`: the model on the desk, through
   the camera. *Why:* Birb AR shows this owner wants things in the room;
   Quick Look is built in and needs no ARKit code; and Apple's USD reader is
   a fourth independent reader of our mesh and UVs. *Cost:* a day (if
   ModelIO's USDZ writer disappoints, the fallback is GLB → Reality Converter
   on the Mac, which is not an iPad feature). *Proof:* the paint is on the
   front face in Quick Look — the same front/back test `blender_check_paint.py`
   makes — and a ModelIO round trip in CI's macOS job.

10. **Turntable capture and share.** One tap renders a 360° turntable to a
    short video (offscreen Metal into `AVAssetWriter`) with a share sheet, and
    a matcap still. *Why:* building in public — every device pass ends with
    "send a screenshot", a turntable is what people actually post, and it is
    the evidence a device pass needs; the game's capture harnesses are the
    precedent. *Cost:* a day. *Proof:* frame times are recorded during the
    capture, and a three-second capture at 30 fps completes without the
    editor loop falling back.

## 4. Suggested order

- **Pass 6 — a product.** §2A.1 export, §2A.2 persistence, the 2048 decision
  (§2A.8), and idea 1 first, so that the fifth pass's measurements (§2B) and
  every report after them are reproducible.
- **Pass 7 — a sculpting tool.** Ideas 3, 5, 4, 2, 6 in that order: mask and
  reset are hours, the brushes reuse everything, layers and matcap are the
  larger pieces.
- **Pass 8 — delight.** Ideas 7, 8, 9, 10; then §2A.4–7 and §2A.9 to release.
- **Phase 3 — the Humanoid** (§2E), with §2D settled on the Windows box first.

## 5. What was folded in

`docs/PRD-humanoid-creator-v0.1.md` §9 (Phases 1–3), §10, §11, §14;
`Editor_Feel_Plan.md` "Still open"; `Device_Pass_2.md` §7.6 and §8.5;
`Device_Pass_3.md` §9 and §10; `Import_into_Unity.md` "What I need back"; the
Unity state in `CLAUDE.md`. Two items were retired on the evidence: sparse undo
(the cost that motivated it is gone) and the `lockWorldSize` control (it is the
"Size fixed on the model" switch, and the Size slider drives it since 2026-09-23).
