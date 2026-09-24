# Baby Blender — the build plan

2026-09-23, evening. **This is the plan of record** from here to Clay 1.0, Clay
1.1 and the Humanoid. It replaces this morning's version of this file, which
was a backlog with ten ideas attached; §10 shows where each of its items went.
The PRD (`docs/PRD-humanoid-creator-v0.1.md`) is still the spec for *what* the
product is. This file sets the order, the gates and the budgets, and §9 lists
every place it departs from the PRD, with the reason. Add new open items here;
the pass documents record what happened.

## 0. What five passes taught, and the rules this plan follows

| Finding | Rule it sets |
|---|---|
| Most defects found on the device were in `app/`, and so were nine of the ten the app-layer review found (Device_Pass_3 §10). That layer is 3,034 lines that CI compiles and nothing tests. The defects found in the core became tests and have stayed fixed. | **Decisions live in the core.** `app/` keeps the UIKit, Metal and SwiftUI plumbing. Each milestone moves named decision logic out of it, with tests. |
| Device reports arrive as sentences and take a round trip to decode. Two passes ran Debug builds, which was found only from the console afterwards. "The pencil wasn't working, then did" has had two diagnoses (Device_Pass_2 §8, Device_Pass_3 §10), and neither is confirmed on the glass. | **The iPad reports data, not adjectives.** A recorder and a one-tap device report ship before new features. |
| Some checks could not fail. The macOS job passed for months without compiling. The Blender step ran only on `main`, which hid a missing library until today. A watchdog was satisfied by its own reset. | **Every gate is seen failing once**, by a mutation check, before it is trusted. |
| Paint landed on the wrong face because the painter and the GPU disagreed about which way v runs, and each agreed with itself. | **When two components share a convention, a test holds one against the other**, and an independent reader checks both where one exists (Blender, the Khronos validator). |
| Timid defaults made working tools look broken: strength 0.5, a 0.15 pressure floor, a 46 pt brush. | **Every default is justified by a measurement, or chosen by the owner** from rendered variants. |
| This morning's plan retired tiled undo because its *time* cost was gone. Its *memory* cost had never been measured, and measured today it is the largest risk at 2048² (§1). | **An item is retired only when every cost it answered is measured.** |
| Every device pass has needed the Mac, Xcode and a cable, and the owner's time on the iPad sets the project's pace. | **One device pass per milestone**, each with a checklist and a report file. Installs move to TestFlight as soon as the account exists. |

## 1. Where it stands

| Built | How it is known to work |
|---|---|
| Export core: VRM 1.0 and FBX 7400 writers, skeleton, rig gate | `verify.sh`, eight stages: unit tests, the golden corpus, the Khronos validator, a PNG decode, Blender's glTF import (with the paint check), Blender's FBX import through both of its importers, the shipped body template, and a render. Unity built a Humanoid Avatar from the FBX on the first attempt, with Chest left unmapped. |
| Clay template: 3,750 vertices (3,458 welded), 6,912 triangles, mirror-exact | `tools/build_clay.py` and `check_template.py`, reproduced byte for byte in CI |
| Engine: tables; Grab, Inflate/Deflate and Smooth with X symmetry; picking; surface paint (world-space brush, taper, hardness, mirror); pressure; `StrokeEngine`; a document with undo, redo and discard | 314 tests on Linux. Each defect found on the device became a test that fails on the old code. |
| App: Metal viewport, camera gestures, Pencil input with coalesced and predicted touches, a low-latency loop with a fallback, a hover ring, palm rejection, two-finger undo, a readout that measures touch→glass, and Brush & Pencil settings | Built by CI in Release and Debug. Five device runs. The fifth (2026-09-24) found the low-latency loop holding up every stroke, so the display link is the default again (`Device_Pass_3.md` §11). |

**Not built, and blocking any real use:** Export Model writes no file, and
documents do not persist, so a force quit loses everything.

**Measured today for this plan** (build box, release build):

- **Undo is bounded by count, not by bytes.**
  - The limit is 30 records, and each paint record holds its bounding
    rectangle twice, before and after.
  - One Fill records 8 MB at 1024² and 32 MB at 2048². Thirty Fills hold
    **240 MB**, or **960 MB** at 2048², on top of everything else the app
    holds.
  - A mirrored stroke on a side face records **18% of the texture** (1.44 MB
    at 1024², 5.76 MB at 2048²), because one rectangle spans both sides of
    the model. That is 6.5 times the same stroke without the mirror.
  - The PRD asked for changed-tile snapshots (§5), which would record only
    the two small patches.
- **PNG encoding is slow on busy textures.**

  | Texture | Lightly painted | Busy |
  |---|---|---|
  | 1024² | 28 ms | 261 ms |
  | 2048² | 75 ms | **1,054 ms** |

  So autosave must never encode PNG on the main thread, and must not encode
  on every stroke.

## 2. The finish lines

**Clay 1.0** is PRD §10 "Clay release", item for item, plus the two tools the
device passes need:

- **Sculpt and paint on the owner's iPad:**
  - Grab, Inflate/Deflate, Smooth and a **Reset brush**;
  - paint with pressure, eyedropper and erase;
  - mirror;
  - undo and redo, with memory bounded in bytes (§6).
- **Documents:** browse, rename, duplicate, delete, autosave and reopen. A
  force quit loses at most the active stroke.
- **Export:** Export Model writes `ModelName.zip` (FBX, GLB,
  `Textures/ModelName_Albedo.png`, and a manifest with hashes). The zip opens
  in Blender and Unity with the paint on the face it was painted on.
- **Viewport:** orthographic front, side and back views, a wireframe overlay,
  and a **matcap view that hides the paint**, so the form can be judged.
- **References:** reference planes and up to four pinned cards. They persist
  and are never exported.
- **Budgets:** the budgets in §6 hold on the device, measured by the app's own
  report.
- **Install:** from TestFlight, not from Xcode.

**Clay 1.1, a sculpting tool:**
- mask;
- the Flatten, Pinch, Crease and Clay brushes;
- sculpt layers;
- clay shapes;
- Pencil Pro barrel roll and haptics;
- turntable capture;
- AR Quick Look.

**Humanoid 1.0** is PRD §10 "Humanoid layer", unchanged. It adds the Windows
Unity/VRChat verdicts, recorded in `tools/unity-verdicts.json` and enforced by
the rig gate.

**Why this morning's ten ideas are split between 1.0 and 1.1:**
- None of them is in the PRD's release definition.
- Each one added before 1.0 delays the first build anyone else can use.
- The recorder will show which tools people actually reach for.

Two go into 1.0 because the device passes need them:
- **Reset** backs out a bad stroke without undoing the good ones made after it.
- **A matcap** is how you judge form under paint.

## 3. Order and pace

| Block | Builds | Ends with | Owner, in parallel |
|---|---|---|---|
| Now | the §11 and §12 fixes | **Pass 5 again**, on the fixed build: `Device_Pass_3.md` §8, §11 and §12 | D1: the Apple Developer account and API key. The Windows Unity session: its corpus is ready. |
| A | M0 + M1 | **Pass 6**, the first report file | D2, D3 |
| B | M2 | **Pass 7**: the PRD's Clay checklist, item by item | D5 |
| C | M3 | External TestFlight beta, then **Clay 1.0**; the App Store once D4 is settled | D4, D6 |
| D | M4 | **Pass 8**, then **Clay 1.1** | |
| E | M5 | **Pass 9**, plus Unity and VRChat, then **Humanoid 1.0** | D7 |

D and E swap if the owner picks the Humanoid first (D6).

**Rough agent effort, in sessions:** A 5–6, B 4–5, C 1–2, D 4–5, E 5–8.

The device passes set the calendar, not the sessions. At one pass a week,
Clay 1.0 is about four weeks away.

## 4. Milestones

### M0 — Close the loop

*Goal: the next device pass returns data that a test can replay.*

1. **Session recorder.**
   - It records every touch, palms included: type, phase, location, force,
     altitude, azimuth, roll, major radius and timestamp.
   - It also records predicted and hover samples, the camera, brush options,
     frame timings and latency samples.
   - It writes to `Documents/Reports/`, which the Files app already shows
     (`UIFileSharingEnabled` is on).
   - It is a switch in the readout, off by default.
2. **Device report.** One button bundles the following and hands the bundle to
   the share sheet:
   - the recording;
   - the readout's numbers;
   - the device: model, iPadOS version, maximum frame rate, and the Pencil
     features seen (hover, squeeze, barrel roll);
   - the settings;
   - the app's own log lines (`OSLogStore(scope: .currentProcessIdentifier)`).

   It replaces "paste the console lines".
3. **`humanoid-cli replay`.**
   - It drives a recording through the core and prints the same summary the
     readout shows.
   - It turns recordings into test fixtures under
     `Tests/Fixtures/recordings/`.
   - It renders **variant sheets**: the owner's recorded strokes under several
     pressure curves or brush settings, side by side, so feel defaults are
     picked from pictures (D5).
4. **Move decisions out of `app/`, with tests.**
   - **`TouchPolicy`**: the Pencil taking over from a finger, palm size at
     landing and as the palm spreads, the ten-point slop, the window after the
     Pencil lifts, a tap versus a pinch, and `pencilSeen`. Tested with
     synthetic sequences and with the owner's recorded palms.
   - **`FrameWatchdog`**: the clock from a frame request to a presented frame,
     the first-frame check, and what happens when the app becomes active
     again. Tested with a fake clock. Its first pieces landed on 2026-09-24:
     `MainThreadMonitor`, which decides when frames are holding the main
     thread, and `FramePacing`, the readout's frame rate, which ignores the
     idle gaps between strokes.
   - **`EditorSession`**: the input queue, "ignore until the next stroke",
     settle, close and discard, commands that arrive mid-stroke, and the start
     and end of activity. Tested headless.
5. **CI.**
   - Run the Blender oracles on every `humanoid/` push, with the Blender
     download cached, instead of only on `main`.
   - Fix the warnings the app build prints, then set
     `SWIFT_TREAT_WARNINGS_AS_ERRORS` on the app target.
6. **TestFlight lane** (needs D1).
   - CI archives the app and uploads it on a tag, with an App Store Connect
     API key: `xcodebuild -exportArchive`, destination `upload`, and the
     `-authenticationKey…` flags.
   - Set `ITSAppUsesNonExemptEncryption = NO`, so uploads do not stop at the
     encryption question.
   - Internal testers need no review. Until the account exists, installs use
     the Mac copy-paste block.

**Gate:**
- Pass 6 returns a report file.
- Replay reproduces its strokes' summaries exactly on Linux.
- For each extracted policy, the old app behaviour fails its new tests.

### M1 — Keep and share the work

*This is the PRD's Phase 1 gate: sculpt, paint, export, and open the result in
Blender and Unity.*

1. **Document format.** A `.babyblender` package, with the reader and writer
   in the core and round-trip tests on Linux. It holds:
   - `manifest.json`: the format version, `templateKind`, `templateID`,
     `templateVersion`, the settings and the camera (PRD §6);
   - `sculpt/layer-0.delta`: binary. The format allows more layers from the
     start; their UI comes in 1.1;
   - `albedo/`: raw RGBA in 64² tiles, so autosave rewrites only the tiles
     that changed and never encodes PNG (§1);
   - `thumbnail.png`.

   The PRD's rule stands: template versions are immutable, and there is no
   silent geometry migration (§11).
2. **The app side.**
   - SwiftUI `DocumentGroup` gives browse, rename, duplicate, delete and
     reopen, with thumbnails. A document is named when it is created.
   - Autosave runs after every stroke. The changed tiles are copied on the
     main thread and written off it.
   - On iPadOS 18, `DocumentGroupLaunchScene` has a template picker; that is
     where the clay shapes land in 1.1.
3. **Undo bounded by bytes, with the changed-tile snapshots the PRD specified
   (§5).**
   - A record holds only the 64² tiles its stroke changed, and holds them
     once. Undo and redo swap the stored tiles with the image's, so no record
     keeps a before *and* an after.
   - A tile of one colour is stored as that colour. A Fill, and every tile of
     an unpainted model, then costs almost nothing.
   - A byte ceiling of 128 MB drops the oldest records first. The PRD's count
     targets (30 sculpt strokes, 20 paint strokes) must fit under it at 2048².
   - Tests:
     - thirty Fills at 2048² stay under the ceiling;
     - twenty mirrored side strokes at 2048² are all kept;
     - undo and redo restore every texel exactly.
4. **Export.** `ExportBundle` in the core.
   - A store-only ZIP writer, about 150 lines on the CRC32 already in
     `CZlibShim`.
   - A manifest with SHA-256 hashes, from a SHA-256 in the core. Both are
     departures from the PRD; §9 gives the reasons.
   - The Linux oracle unpacks the zip with Python's `zipfile`, checks the hashes
     with `hashlib`, and runs the existing Khronos and Blender checks on the
     files inside.
   - The app runs the pre-flight, shows progress, can cancel, and hands the zip
     to the share sheet and to Files.
5. **2048² textures (D2).** Decided after items 3 and 4 land. Pass 6 measures
   the paint map's build time and memory at 2048² on the iPad, and checks that
   the stroke budget in §6 holds.

**Gate (pass 6):**
- Sculpt and paint, force-quit, reopen: nothing is lost but the active stroke.
- Export, AirDrop the zip to the Mac, open it in Blender and in Unity: the UVs
  are correct and the paint is on the face it was painted on.

### M2 — Finish Clay

*The rest of the PRD's Clay release definition, plus the two tools the device
passes need.*

1. **Viewport.** Orthographic front, side and back views, and a wireframe
   overlay (PRD §5).
2. **Matcap, cavity and hide-paint views**: form is judged by how light rolls
   over it, and paint hides that.
3. **Reset brush.** It blends the sculpt back toward the template under the
   brush falloff, and respects the mirror. A few hours of work.
4. **Paint.** An eyedropper control (the core function already exists) and
   recent colours.
5. **Reference images** (PRD §5). Import from PhotosPicker or Files; the
   originals are copied into the package, with previews at a bounded
   resolution.
   - **Scene planes**, front, side and back:
     - position, uniform scale, horizontal flip, opacity, visibility, lock and
       delete;
     - they snap to the matching orthographic view, and hide when the camera
       faces away.
   - **Up to four pinned cards**:
     - drag, with snaps to the corners and edges; resize the frame; zoom and
       pan inside it; double-tap to fit;
     - opacity, lock, and collapse to a tab;
     - they persist with the document;
     - the Pencil always passes through a card to the model.
6. **The rest of Phase 2.**
   - Reset sculpt and reset paint, both undoable.
   - Mesh warnings: flipped or near-zero-area triangles, and excessive stretch.
   - Error reporting when an export fails.
   - A regression corpus built from the owner's recordings and documents,
     replayed in CI.

**Gates:**
- A Linux test proves that an export zip carries no reference bytes, filenames
  or paths (PRD §5).
- With four cards open on the oldest test iPad, the stroke budget in §6 holds.
  This is the PRD's own condition (§11).
- Pass 7 walks the PRD §10 Clay-release checklist, item by item, with the
  report.

### M3 — Ship Clay 1.0

- The icon and the launch screen, and the name (D4).
- A privacy manifest (`PrivacyInfo.xcprivacy`). `UserDefaults` is a
  required-reason API and needs reason CA92.1. The upload check names any other
  API the binary uses.
- App Store metadata and screenshots.
- An external TestFlight beta, which goes through Beta App Review. Then submit
  to the App Store, once D4 is settled.

**Gate:** the Clay 1.0 definition in §2 holds on a TestFlight build.

### M4 — Clay 1.1: a sculpting tool

In this order:

1. **Mask**, with clear, invert and blur. It is also the mechanism for the
   Humanoid's joint clamps.
2. **The Flatten, Pinch, Crease and Clay brushes.** They share the existing
   dab machinery: resampling, symmetric weighting, the reference surface and
   undo.
3. **Sculpt layers.** The UI only; the format has held layers since M1.
4. **Clay shapes.** A sphere, an egg and a bust blank from the same generator,
   offered as templates. A rounded cube is the worst start for a head, and a
   head is what people sculpt first.
5. **Pencil Pro.**
   - The barrel roll sets the brush size (`UITouch.rollAngle`).
   - Haptics come through the Pencil via `UICanvasFeedbackGenerator`:
     alignment when the brush crosses the mirror plane, completion at the end
     of a stroke.
   - The squeeze opens the palette at the Pencil tip, not at the toolbar.
6. **Turntable capture.** A 360° video, rendered offscreen in Metal and written
   through `AVAssetWriter`. It is for sharing, and also serves as device-pass
   evidence.
7. **AR Quick Look.**
   - USDZ is an uncompressed zip with its files aligned to 64 bytes, so M1's
     writer plus a USD layer written by the core produces it.
   - Blender's USD importer checks the file on Linux; AR Quick Look checks it
     on the iPad.

**Gates:**
- A property test for every brush.
- The frame-batching invariance test runs over every brush.
- Masked vertices never move.
- A single layer at weight 1 reproduces today's result bit for bit.
- Pass 8: sculpt a face from the bust blank, with the report.

### M5 — The Humanoid

*PRD Phase 3.*

**Prerequisite:** the Windows session settles four things, recorded in
`tools/unity-verdicts.json`:
- why Unity's auto-mapper leaves Chest unmapped;
- which way the avatar faces, and whether it is mirrored;
- what the VRChat SDK panel says;
- VRM or FBX as the primary format (D7).

**Then build:**
- the eight proportion controls;
- the pose preview, with GPU skinning;
- the New Project chooser: Clay or Humanoid, stated as permanent;
- rig checks in the export pre-flight;
- brush clamps near the joints, eyes and mouth, as authored masks (M4);
- the Humanoid zip, with `Import_into_Unity.md` inside (PRD §3).

**Gate:** PRD §10, "Humanoid layer".

## 5. How every milestone runs

1. **CI stays green.** The Linux tests, all eight `verify.sh` stages and the
   app build in CI all pass. The Humanoid template, the rig gate and both
   writers stay green the whole way, which is the PRD's guard (§9) against
   building a Clay app the Humanoid cannot slot into.
2. **Fixes and gates are proven.** Every fix is mutation-checked, and every new
   gate is seen failing once.
3. **Review before the iPad.** An adversarial review of `app/` runs before each
   device pass; before pass 5 it found ten real defects.
4. **One device pass per milestone**, with its checklist and a report file.
   Findings go into this file; the pass document records what shipped.
5. **CLAUDE.md gets one short paragraph per pass**: the invariants and a
   pointer, not the story.
6. **Commands for the owner come as one copy-paste block**, from `cd` to the
   app opening.

## 6. Budgets

| | Budget | Now |
|---|---|---|
| CPU per frame during a stroke | ≤ 4 ms (half a 120 Hz frame) | a paint dab (r = 0.04, 1024²) takes 0.72 ms; a raycast over 6,912 triangles takes 0.044 ms; an Inflate or Deflate frame of three dabs, crossing check included, 0.20 ms at a 22 mm brush and 0.47 ms at 56 mm (build box) |
| A paint stroke's begin, one dab and end | ≤ 2 ms at 1024², ≤ 5 ms at 2048² | 1.73 ms and 4.91 ms (build box) |
| Undo memory | ≤ 128 MB at 2048², holding the PRD's 30 sculpt and 20 paint strokes | no byte bound: 30 Fills take 240 MB at 1024² and 960 MB at 2048² |
| Autosave | ≤ 5 ms on the main thread per stroke, with no encoding there | none exists yet |
| Export at 2048² | ≤ 3 s, with progress and cancel | writes no file |
| Paint map ready after opening a document | ≤ 0.5 s at 1024², ≤ 1 s at 2048² | 185 ms at 1024² on the iPad (pass 4) |
| Touch→glass | pass 5's median; after that, 2 ms slower fails | 37 ms median, 41 ms p90, on the display link with two drawables, which held every frame back a refresh (`Device_Pass_3.md` §12); unmeasured with three |
| Launch to first frame, in Release | ≤ 1 s | unmeasured |

## 7. Owner decisions

| | Decision | Default until decided | Needed by |
|---|---|---|---|
| D1 | An Apple Developer Program membership and an App Store Connect API key, so CI can ship TestFlight builds | the Mac copy-paste block | the end of M0 |
| D2 | 2048² textures | 1024², until pass 6 measures 2048² with M1's undo | the end of M1 |
| D3 | The oldest iPad to support, which sets the deployment target. iPadOS 18 removes the availability branches around the low-latency loop and brings the template launch scene. | 18.0 if every test iPad runs it; otherwise 17.0 | M1 |
| D4 | The App Store name (PRD §14 flags the Blender mark) | "Baby Blender" on TestFlight | M3 |
| D5 | Pressure and feel defaults | chosen from replay variant sheets | M2 |
| D6 | After Clay 1.0, which comes next: Clay 1.1 or the Humanoid | 1.1, because the Humanoid is sculpted with the same brushes and its joint clamps are 1.1's mask | M3 |
| D7 | The Humanoid's primary format, VRM or FBX | decided after the Windows session | M5 |

## 8. Risks

| Risk | Mitigation |
|---|---|
| Pass 5's feel is wrong in ways a recording cannot show: glare, fatigue, latency you feel but cannot see | Run pass 5 now, with the readout's numbers; variant sheets for everything a recording can show |
| Regressions in `app/` between passes | M0's extractions, the review before every pass, and warnings as errors |
| Memory at 2048² | M1's tiled, byte-bounded undo, gated by a test at 2048² |
| Autosave causes a hitch | Only changed raw tiles, written off the main thread, held to the §6 budget |
| The low-latency loop misbehaves on the owner's iPad | It did, on the fifth device run: 0.3–5 s hangs during strokes. It is off by default. It gives way by itself when its waits keep the main thread busy or the Pencil's samples stop. Every slow or saturated second is logged with where its time went |
| Pinned cards cost frame time during a stroke | The PRD's cap of four; M2's gate measures the stroke budget with four cards open |
| TestFlight stalls on the account | Nothing else depends on it; the Mac block keeps working |
| App Store rejection | D4 for the name, the privacy manifest, the encryption key, and an external beta first |
| The Humanoid is blocked on Windows | Run that session now; its corpus is ready |
| Scope creep | Everything outside the PRD's release definition waits for 1.1 or later, and each item has a cost and a proof |

## 9. Where this plan departs from the PRD

| PRD | This plan | Why |
|---|---|---|
| ZIPFoundation for the export zip (§7) | a store-only ZIP writer in the core | The core has no package dependencies. The CRC32 it needs is already in `CZlibShim`, and the PNG is already compressed. USDZ (M4) needs its files aligned to 64 bytes, which a general zip library does not do. |
| CryptoKit SHA-256 for manifest hashes (§6) | SHA-256 in the core, checked against the NIST vectors and Python's `hashlib` | CryptoKit does not exist on Linux, where the export bundle is tested. |
| TinyBVH for picking (§7) | brute force | A raycast over 6,912 triangles takes 0.044 ms. Revisit if a template grows several-fold. |
| Undo count targets: 30 sculpt, 20 paint (§5) | the same counts, under a byte ceiling | A Fill at 2048² records 32 MB, so a count alone does not bound memory. |
| Surface shaping: Grab, Inflate/Deflate, Smooth (§5) | plus a Reset brush in 1.0; mask, four more brushes and layers in 1.1 | These come from this morning's ten ideas. 1.0 takes only what the device passes need. |
| Paint hardness deferred (§5) | built | It shipped in the 2026-09-23 paint pass, and the tests cover it. |
| Rename `humanoid/` at the start of Phase 1, "or not at all" (§14) | not at all | The moment passed when the app target was created inside it. The App Store name (D4) is the one users see. |

## 10. Where every item went

| Item (source) | Now |
|---|---|
| A1: export writes no file | M1.4 |
| A2: documents do not persist | M1.1–2 |
| A3: naming a document | M1.2, through `DocumentGroup` |
| A4: orthographic views and wireframe | M2.1 |
| A5: reference planes and pinned cards | M2.5 |
| A6: eyedropper control and recent colours | M2.4 |
| A7: Phase 2's list | progress, cancel and hashes in M1.4; resets, warnings, error reporting and the corpus in M2.6 |
| A8: 2048² textures | M1.5 and D2, after the undo fix |
| A9: TestFlight, icon, launch screen, name, renaming `humanoid/` | TestFlight in M0.6; icon and launch screen in M3; the name is D4; renaming is dropped (§9) |
| B: fifth pass unmeasured; immediate presentation; feel defaults; loop liveness; review finding 9 | pass 5 now; the recorder and `FrameWatchdog` in M0; D5 |
| C: a BVH for picking | not doing (§9) |
| C: sparse undo, marked "superseded" | reinstated as M1.3 (see §0 and §1) |
| C: squeeze opens the palette at the tip | M4.5 |
| C: per-frame allocations | the review before every pass (§5) |
| D: Chest mapping, handedness, the SDK panel, `unity-verdicts.json` | the Windows session, now; a prerequisite of M5 |
| E: Phase 3, the Humanoid | M5 |
| Idea 1: stroke recorder and Linux replay | M0.1–3, extended to all touches, a device report and variant sheets |
| Idea 2: sculpt layers | the format in M1.1, the UI in M4.3 |
| Idea 3: masking | M4.1, reused for the joint clamps in M5 |
| Idea 4: Flatten, Pinch, Crease, Clay | M4.2 |
| Idea 5: Reset brush | M2.3 |
| Idea 6: matcap, cavity, hide paint | M2.2 |
| Idea 7: clay shapes | M4.4 |
| Idea 8: Pencil Pro roll and haptics | M4.5 |
| Idea 9: AR Quick Look | M4.7, through the core's zip writer instead of ModelIO |
| Idea 10: turntable capture | M4.6 |
| New today: undo memory | M1.3 |
| New today: autosave cost | M1.1–2 |
| New today: decisions out of `app/` | M0.4 |
| New today: Blender on every push, warnings as errors | M0.5 |
| New today: privacy manifest | M3 |
| New today: deployment target | D3 |
| New today: a review before every pass | §5 |
| New today: budgets and owner decisions | §6 and §7 |

## 11. Deliberately not doing

- **Dynamic topology, converting Clay to a Humanoid, and a VRChat path for
  Clay.** The PRD rules all three out (§14), and the architecture depends on
  topology being immutable.
- **Paint layers, paint masks, textured brushes, decals, a 2D UV view and
  non-albedo channels.** The PRD defers them (§5), and they stay deferred past
  1.1.
- **A BVH, and renaming `humanoid/`.** See §9.
