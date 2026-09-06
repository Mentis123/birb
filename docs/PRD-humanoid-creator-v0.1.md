# Humanoid Creator for VRChat — v0.1 Research PRD and Build Plan

**Status:** Recut proposal  
**Research date:** 2026-08-27  
**Platform:** iPadOS first; SwiftUI, MetalKit, Objective-C++/C++  
**Product promise:** Reshape, lightly sculpt, and paint a protected fixed-topology model on iPad, starting from either a rigged humanoid or an unrigged lump of clay; preview deformations on the humanoid; export a package Unity or any DCC can open — for the humanoid, one Unity configures as a Humanoid for the normal VRChat publishing step.

**Amended 2026-09-05 (Mentis).** Three changes, all recorded in full below: (1) a **New Project** screen offering **Clay** or **Humanoid**, so the app is no longer VRChat-only; (2) **pinned reference cards** — draggable, resizable, zoomable image panels — restored to scope after the recut had deferred them as "floating boards"; (3) **Clay ships first**, with the humanoid layered on after, reversing the original build order. §14 is the amendment log and states what these cost.

**Build order: Clay, then Humanoid.** §9 carries the phases. The short version is that Phase 0 retired the export unknowns — both writers work and Unity builds a Humanoid Avatar from our FBX — so the unproven half is now the editor, and the editor does not need a skeleton.

## 1. Executive decision

The product is feasible, but only if it remains a protected model customizer rather than a small Blender.

The immutable contract is the product: **a versioned template with fixed vertex/index/UV order**, authored UVs, and — where the template has one — a fixed skeleton with authored skin weights, morphs, and joint-fitting rules. Users may move existing vertices and paint the existing UV texture. They may not alter topology, rigs, weights, UVs, materials, or scene structure.

**That contract is what makes two starting points cheap.** A Clay document and a Humanoid document are the same engine over different frozen templates; Clay simply has no skeleton, so the rig-shaped features switch off rather than needing new machinery. What Clay is *not* is dynamic-topology sculpting: there is no remeshing, no adaptive subdivision, and no vertex is ever created or destroyed. A literal 8-vertex Blender cube would be unsculptable, so the Clay template ships pre-subdivided (§4).

The first engineering milestone is not the editor. It is a five-day export proof on a physical iPad. The proof must export a neutral and modified mannequin, reopen each with ufbx, import each into the Unity version selected by VRChat Creator Companion, auto-map as Humanoid, and survive elbow, knee, and finger poses. If neither exporter candidate passes, the FBX product promise must change before editor work begins.

### Important changes from the supplied proposal

| Area | Earlier proposal | v0.1 recut |
|---|---|---|
| Default mesh | 12,000–18,000 triangles | **8,000–10,000 triangles** |
| Mobile positioning | Near mobile recommendations | Designed to fit the current **Mobile Good triangle ceiling**, with no rank guarantee |
| Runtime mesh library | PMP considered | **No general mesh library**; fixed arrays plus precomputed adjacency |
| References | Six images and floating boards | Front, side, and back; one per view |
| Body controls | Broad anatomical control set | Eight authored macro controls |
| Painting | Full small paint application | Fill, one round brush, eraser, eyedropper, size, color, opacity |
| Validation | Self-intersection and extensive quality inference | Hard invariants plus local triangle and joint-region warnings |
| History | Deep persistent operation history | Current state persisted; bounded in-session undo |
| Starting choices | Several neutral bodies | One canonical mannequin |
| Export | Assimp with Autodesk fallback | Two-candidate gate; Assimp is experimental, Autodesk is compatibility/license gated |

The triangle correction is material. VRChat's current mobile thresholds are 7,500 triangles for Excellent, 10,000 for Good, 15,000 for Medium, and 20,000 for Poor. Mobile defaults block avatars below Medium. One skinned mesh, one material slot, and no more than 90 bones are also within the current Good ceilings. A 12k–18k template therefore starts between Medium and Poor, not near Good. See [VRChat Performance Ranks](https://creators.vrchat.com/avatars/avatar-performance-ranking-system/).

## 2. Product boundary

### In the iPad app

- Start a document from one of two frozen templates: **Clay** (unrigged) or **Humanoid** (rigged T-pose).
- Import reference images, both as aligned front/side/back scene planes and as pinned, resizable, zoomable cards.
- Use Grab, Inflate/Deflate, and Smooth without changing topology. *(Both templates.)*
- Paint one 2048×2048 sRGB albedo texture. *(Both templates.)*
- Adjust eight safe proportion controls. *(Humanoid only.)*
- Preview four authored poses and receive bounded deformation warnings. *(Humanoid only.)*
- Save documents locally and export a ZIP containing the model, PNG, manifest, and instructions.

### Outside the app

- Install VRChat Creator Companion and its selected Unity version.
- Import the package and configure the material.
- Confirm Unity's Humanoid mapping.
- Add the VRChat Avatar Descriptor, viewpoint, eye/viseme settings when available, and SDK-specific configuration.
- Validate, test, and upload through the VRChat SDK.

A Humanoid document's export action is named **Export for VRChat**, never Publish. A Clay document has no VRChat path at all — it exports as a static mesh for any engine or DCC, and its export button reads **Export Model**. Presenting Clay under VRChat language would be a straightforward lie: without a skeleton there is no avatar.

On the VRChat wording, VRChat's own avatar flow still requires Unity rig configuration, materials, an Avatar Descriptor, validation, and upload; those SDK components are not generic FBX content. See [VRChat Avatars](https://creators.vrchat.com/avatars/) and [VCC Getting Started](https://vcc.docs.vrchat.com/guides/getting-started/).

## 3. v0.1 user journey

### Starting a document

1. Tap **New Project**. Two cards, side by side, nothing else on the screen:

   | | **Clay** | **Humanoid** |
   |---|---|---|
   | Shows | A rounded, subdivided cube slowly rotating | The T-pose figure slowly rotating |
   | Says | "Start from a lump. No rig." | "Start from a body. Rigged and ready." |
   | Gives you | Sculpt, paint, symmetry | Sculpt, paint, symmetry, proportions, poses |
   | Exports | A static mesh for any engine | A skinned avatar Unity maps as a Humanoid |

   The choice is made once and is **permanent for that document**. Converting Clay into a Humanoid would mean generating a skeleton and skin weights for arbitrary sculpted geometry — that is automatic rigging, a genuinely hard problem, and it is not in v0.1. The New Project screen must say so in one line rather than letting someone sculpt for an hour and then discover it.

2. Name the document. It opens on the chosen template.

### Then, in either document type

3. Optionally add reference images: front, side and back scene planes, and/or pinned cards you can drag to a corner, resize and zoom (§5).
4. Use mirrored Grab, Inflate/Deflate, and Smooth brushes.
5. Fill the model with a base colour and optionally paint with a round brush.
6. Resolve blocking checks and review warnings.

### Humanoid documents also

7. Adjust Height, Head, Shoulders, Torso, Hips, Arms, Legs, and Build.
8. Cycle through T-pose, arms-down, elbow/knee bend, and squat.

### Export

9. **Humanoid** → `AvatarName.zip`:
   - `AvatarName.fbx`
   - `AvatarName.vrm`
   - `Textures/AvatarName_Albedo.png`
   - `Import_into_Unity.md`
   - `AvatarName_manifest.json`
10. **Clay** → `ModelName.zip`:
   - `ModelName.fbx`
   - `ModelName.glb`
   - `Textures/ModelName_Albedo.png`
   - `ModelName_manifest.json`
11. Move the ZIP to a computer. Humanoid documents then complete the Unity/VCC/VRChat steps; Clay documents are already usable in any engine or DCC.

## 4. Template contracts

### 4.1 Humanoid template

| Property | v0.1 target |
|---|---|
| Pose | Symmetric T-pose |
| Geometry | One body mesh, including simplified eye geometry if practical |
| Triangle target | 8,000–10,000 |
| Renderers/materials | One skinned mesh, one material slot |
| UV | One non-overlapping UV0 set with authored seam and mirror correspondence |
| Texture | One 2048×2048 sRGB albedo PNG; optional 1024 export preset |
| Skinning | One to four normalized influences per vertex |
| Skeleton | Fixed Unity-Humanoid-compatible hierarchy, targeted below 75 bones |
| Face | Eyes and jaw bones may ship; no facial blendshapes in v0.1 |
| Versioning | Immutable `templateID` plus semantic `templateVersion` |

Use MakeHuman's core CC0 assets as reference/source material, then create and freeze a dedicated game template. MakeHuman explicitly permits building another character generator from its system assets, while its program code remains AGPL. The standard higher-detail topology is too dense for this target after triangulation. See [MakeHuman reuse guidance](https://static.makehumancommunity.org/mpfb/faq/build_other_chargen.html), [MakeHuman license](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md), and [professional mesh topology](https://static.makehumancommunity.org/makehuman/docs/professional_mesh_topology.html).

The shipping asset still needs deliberate retopology, UVs, weighting, safe morphs, joint landmarks, and Unity pose QA by someone competent in character technical art. That work is not eliminated by open source.

### 4.2 Clay template

| Property | v0.1 target |
|---|---|
| Shape | Rounded subdivided cube — recognisably the Blender cube, smoothed enough to sculpt |
| Geometry | One mesh, no skeleton |
| Triangle target | 6,000–8,000 |
| Renderers/materials | One mesh, one material slot |
| UV | One non-overlapping UV0 set, box-unwrapped with authored seams and mirror correspondence |
| Texture | One 2048×2048 sRGB albedo PNG; optional 1024 export preset |
| Skinning | None |
| Versioning | Immutable `templateID` plus semantic `templateVersion`, same scheme as the humanoid |

**Why a subdivided cube and not a sphere.** The cube reads instantly as "the thing you start from" to anyone who has opened Blender, and its box unwrap gives a UV set a person can actually paint against without a checker texture. A UV sphere's pole pinch is a worse painting surface and a worse sculpting surface.

**The density is a real constraint, not a preference.** Sculpting only moves existing vertices, so resolution is fixed at authoring time: too coarse and a Grab stroke looks like denting a beach ball, too dense and the iPad's per-stroke rebuild misses frame. 6–8k is the same band the humanoid sits in and the same band the brush code is tuned for, which is the point — one engine, two templates.

## 5. v0.1 functional scope

### New Project

- Two template cards, Clay and Humanoid, as described in §3. No third option, no "advanced" disclosure, no file import.
- Each card shows its template rotating live in a small Metal view. Both templates are already loaded to draw the cards, so opening a document from either is instant.
- One line of copy under the pair states that the choice cannot be changed later.
- The last choice is remembered and pre-selected; it is never auto-confirmed.

### Documents and viewport

- Every document records its `templateKind` (`clay` or `humanoid`) alongside `templateID` and `templateVersion`. Features that need a skeleton read this one field; nothing else in the app branches on document type.
- SwiftUI document browser: create, rename, duplicate, save, reopen, delete. Document thumbnails distinguish the two kinds at a glance.
- Autosave flattened current state after meaningful operations; a crash may lose the active stroke only.
- Metal viewport: orbit, pan, pinch zoom, frame, orthographic front/side/back.
- Solid, textured, and wireframe-overlay display.
- Apple Pencil edits; fingers navigate unless an explicit finger-edit toggle is enabled.
- Target responsive interaction on the oldest selected test iPad; measure rather than promise 60 fps everywhere.

### Reference images

Two separate mechanisms, because they answer different questions. **Scene planes** sit in the 3D world behind the model and are for tracing proportion and silhouette. **Pinned cards** float over the interface and are for looking closely at detail — an ear, a hand, a fold of cloth — while your other hand is sculpting. Building only the first is the mistake the recut made; a plane you have to orbit the camera to read is useless as a detail reference.

Common to both:

- Import JPEG, PNG, or HEIC using PhotosPicker or Files.
- Copy originals into the document package and make bounded-resolution GPU previews.
- Never include reference bytes, filenames, or paths in export snapshots.

**Scene planes**

- One front, one side, one back plane.
- Position, uniform scale, horizontal flip, opacity, visibility, lock, and delete.
- Snap to the matching orthographic view; hidden automatically when the camera faces away from the plane.

**Pinned cards** *(restored to scope 2026-09-05; the recut had deferred these as "floating boards")*

- Up to four cards at once. The cap is deliberate: each is a live texture over the viewport, and the fill-rate cost is what pushes an iPad off frame during a stroke.
- Drag anywhere; magnetic snap to any of the four corners and to the screen edges.
- Pinch the card to resize its frame. Pinch **inside** the card to zoom the image within the frame, with two-finger pan to move around a zoomed image. Double-tap to fit.
- Per-card opacity, lock (ignores all touches so a stroke near it is not stolen), and collapse to a labelled thumbnail tab on the nearest edge.
- Cards persist with the document: position, size, zoom, pan offset and collapsed state are all saved.
- Cards never receive Pencil input. The Pencil always reaches the model underneath, so a card resting over the shoulder you are sculpting does not block the stroke; move it with a finger.

Still deferred: rotation, crop, perspective calibration, more than four cards, and per-card colour adjustment.
### Proportions *(Humanoid documents only)*

Eight authored, reversible controls:

1. Height
2. Head size
3. Shoulder width
4. Torso length/volume
5. Hip width
6. Arm length/thickness
7. Leg length/thickness
8. Overall build

Each control is a sparse vertex delta plus joint-landmark rules. Structural controls update joint translations and inverse-bind matrices without exposing bone scale or hierarchy. Safe ranges are authored and tested; reset control and reset all are undoable.

### Surface shaping

- Grab, Inflate/Deflate, and Smooth.
- Radius, strength, and pressure-to-strength; one fixed smooth falloff.
- X symmetry enabled by default.
- Brush clamps and warnings near shoulders, elbows, wrists, hips, knees, ankles, eyes, and mouth.
- No topology, UV, weight, bone, or material mutation.
- Incremental affected-normal and GPU-buffer updates.
- Bounded in-session undo target: 30 sculpt strokes, grouped one record per stroke.

### Albedo painting

- Base fill, one antialiased round brush, eraser, eyedropper, color, size, and opacity.
- Pencil path resampled to distance-based dabs so event rate does not alter appearance.
- Ray hit converted through barycentric coordinates to UV.
- Precomputed seam partners stamp corresponding UV islands where a brush footprint crosses a canonical seam.
- Changed-tile snapshots for bounded in-session undo; target 20 paint strokes.
- Defer hardness, textured brushes, layers, masks, decals, flood-fill regions, 2D UV view, and non-albedo channels.

### Rig preview and validation *(Humanoid documents only)*

- GPU skinning for T-pose, arms-down, elbow/knee bend, and squat.
- Returning to T-pose exactly restores editable rest positions.
- Blocking checks split into two sets. **Mesh checks run on every document:** finite values; exact array counts; valid indices; valid transforms; texture present; exporter validation passed. **Rig checks run on Humanoid documents only:** required bones; hierarchy; one-to-four influences; normalized weights; T-pose tolerances; shoulder height. A Clay document is not "missing bones" — it has no rig, and reporting one as an error would train users to ignore the panel.
- Warnings: flipped/near-zero-area triangles, excessive local stretch, joint-region collapse, mannequin height outside the authored range, and likely body penetration at selected pose samples.
- Do **not** promise comprehensive continuous self-intersection detection in v0.1.

## 6. Technical architecture

```text
SwiftUI document/UI
        |
MTKView + Metal renderer/painting
        |
Swift fixed-topology document model
        |
Objective-C++ bridge
   |          |           |
TinyBVH     FBX writer    ufbx validator
```

### Runtime data model

```text
CanonicalTemplate (read-only)
  templateKind                     // clay | humanoid
  positions, normals, indices, uv0
  vertexFaces, oneRingNeighbors
  symmetryPairs, seamPartners
  rig?                             // absent on clay
    morphDeltas, jointLandmarkRules
    boneHierarchy, restTransforms
    boneIndices[4], boneWeights[4]
    validationPoses

Document
  templateKind, templateID, templateVersion
  sculptDelta[vertex]
  albedoTexture
  scenePlanes[3]                   // front, side, back
  pinnedCards[0...4]               // frame rect, corner anchor, zoom,
                                   // pan offset, opacity, locked, collapsed
  cameraState
  flattenedCheckpoint
  morphValues[8]?                  // humanoid only
```

**`rig` is optional, not empty.** Making Clay a humanoid with a zero-bone skeleton would put `if boneCount > 0` branches through the skinning, export and validation paths, and every one of them is a place to get it wrong silently. An absent `rig` makes the rig-shaped code unreachable for Clay by construction, which is the same reasoning that made topology immutable in the first place.

Both templates use this one structure, so the brush, paint, symmetry, undo, autosave and mesh-validation code is written once and neither knows which template it is holding.

Because topology is immutable, all adjacency, vertex-to-face incidence, X-symmetry pairs, joint masks, and UV seam partners should be generated offline and stored in the template. Runtime editing then uses compact arrays, not a half-edge mesh. This removes a large dependency and makes illegal topology operations structurally impossible.

### Native Apple tools

Use platform APIs where they already solve the problem:

- SwiftUI `DocumentGroup`/document packages for local files.
- PhotosUI `PhotosPicker`, SwiftUI `fileImporter`, UniformTypeIdentifiers, and security-scoped URLs for references.
- ImageIO/CoreGraphics for JPEG, PNG, and HEIC decode plus PNG output.
- MetalKit/Metal for rendering, dynamic buffers, GPU skinning, UV paint targets, and overlays.
- CryptoKit SHA-256 for manifest hashes.
- Codable JSON for manifests.

This avoids unnecessary image, hashing, JSON, document, and animation dependencies.

## 7. Open-source and external component decisions

| Component | License | v0.1 use | Decision |
|---|---|---|---|
| [MakeHuman system assets](https://static.makehumancommunity.org/mpfb/faq/build_other_chargen.html) | CC0 core assets | Source/reference for body, targets, rig ideas | Use as source material; create and version a dedicated template. Do not embed AGPL application code. |
| [TinyBVH](https://github.com/jbikker/tinybvh) | MIT | Indexed ray/triangle picking and BVH refit | **Use.** Single-header, dependency-light, moving-geometry refit, and Apple/ARM paths fit this editor better than a broad mesh library. |
| [ufbx](https://github.com/ufbx/ufbx) | MIT or public domain | Independent FBX reopen and structural comparison | **Use.** Loader only; also useful as a CPU skinning oracle in tests. |
| [Assimp](https://github.com/assimp/assimp/blob/master/code/AssetLib/FBX/FBXExporter.cpp) | BSD-3-Clause | FBX writer candidate A | **Spike only.** Its writer contains skeleton/pose/deformer support, but the project maintains an open [FBX export bug epic](https://github.com/assimp/assimp/issues/6142). It must pass the golden corpus. |
| [Autodesk FBX SDK](https://aps.autodesk.com/developer/overview/fbx-sdk) | Proprietary EULA | FBX writer candidate B | **Spike and legal review.** Autodesk lists iOS and current SDK 2020.3.10, but current Xcode/device/simulator slices and distribution terms must be proven. |
| [MaLiang](https://github.com/Harley-xk/MaLiang) | MIT | Stroke resampling, pressure, dab, and undo reference | Selectively reuse ideas or isolated code after audit; do not adopt its 2D canvas as the viewport. |
| [SculptGL](https://github.com/stephomi/sculptgl) | MIT | Brush behavior and UX reference | Reference only; archived JavaScript/WebGL code is not the engine. |
| [ZIPFoundation](https://github.com/weichsel/ZIPFoundation) | MIT | Create the export ZIP with progress/cancellation | **Use**, unless deployment-target testing proves a simpler first-party archive API sufficient. |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) | MIT | Offline template optimization experiments | Offline only; never optimize a user's live topology. |
| [PMP Library](https://github.com/pmp-library/pmp-library) | MIT | Offline retopology/analysis experiments | Remove from runtime. A general half-edge structure is unnecessary and enlarges the unsafe surface. |
| [cgltf](https://github.com/jkuhlmann/cgltf) | MIT | Optional diagnostic GLB writer | Development-only escape hatch for comparing skin transforms; not part of the promised package. |
| [UniVRM](https://github.com/vrm-c/UniVRM) | MIT | Contingency Unity-side VRM/glTF import | Plan B product pivot only. It adds a Unity package and changes the no-extra-importer FBX promise. |

### Components deliberately not needed

- No animation engine: a small fixed skeleton and four authored poses are simple matrices.
- No runtime mesh-processing framework: all topology tables are precomputed.
- No general 3D scene engine: one mesh, image planes, grid, camera, and overlays are better owned directly in Metal.
- No third-party PNG, JSON, hashing, or photo library.
- No Blender or MakeHuman runtime.

## 8. Export-provider gate

Define the editor boundary before choosing a writer:

```swift
protocol FBXExporting {
    var providerID: String { get }
    func export(_ snapshot: ExportSnapshot, to url: URL) throws -> ExportReport
}
```

### Five-day spike

Build a minimal iPad app containing only a known-good skinned mannequin, one authored morph, one rest-joint adjustment, a flat PNG, export buttons for each candidate, and ufbx validation.

Test two separate integrations:

1. **Assimp candidate:** compile the smallest practical feature set; write one mesh, one material, one skeleton, weights, bind pose, and relative PNG path.
2. **Autodesk candidate:** prove static linking on physical arm64 hardware, test the simulator separately, record binary-size impact, and review EULA/App Store implications. Simulator export may be stubbed if the official package lacks a compatible simulator slice, but device export may not be.

### Golden corpus

- Neutral T-pose.
- Minimum and maximum authored height/shoulders.
- Local vertex displacement near elbow and knee.
- Joint-rest relocation plus recomputed inverse binds.
- Finger-weight sample.
- **Clay neutral and Clay sculpted**, exercising the unrigged export path: no skeleton, no skin, static mesh in FBX and GLB.
- Deliberately malformed negative cases for validator tests.

### Pass matrix

| Check | Required result |
|---|---|
| Physical iPad build/export | Succeeds without private APIs or runtime downloads |
| ufbx reopen | Counts, hierarchy, weights, bind transforms, material path, and finite values match |
| Unity import | No material transform or FBX hierarchy warnings attributable to exporter |
| Humanoid Configure | Required mappings resolve and T-pose is accepted *(humanoid cases only)* |
| Clay import | Opens in Unity and Blender as a static mesh with its UVs and texture, and carries no stray skeleton or skin node |
| Pose test | Elbows, knees, shoulders, and fingers deform consistently with in-app preview |
| Scale/axes | Height within 1%; upright, centered, expected handedness |
| VRChat SDK | Avatar Descriptor can be added; no rig-related blocking validation |
| Licensing | Shipping and App Store distribution are acceptable |

Unity remains the source of truth. Passing ufbx is necessary but not sufficient.

### Decision rule

- Choose Autodesk if it passes technically and legally and the integration burden is acceptable.
- Choose Assimp only if every constrained case passes and a pinned fork plus regression corpus is acceptable maintenance.
- If neither passes, **stop the editor build**. Recut the promise to either:
  - GLB/VRM plus a documented UniVRM Unity package;
  - an iPad project file plus small desktop/Unity exporter companion; or
  - optional Blender/desktop final-mile export.

Do not begin a custom FBX writer during v0.1. It is a separate format-engineering project, not a quick fallback.

## 9. Delivery plan

### Phase 0 — Export and asset feasibility: 5 engineering days

- Select one known-good rigged sample and freeze expected Unity results.
- Integrate and compare Assimp and Autodesk candidates.
- Add ufbx structural validation.
- Measure physical-device build, export time, memory, binary size, and file size.
- Complete the pass matrix and licensing decision.

**Gate:** one provider passes neutral and modified samples on physical iPad and current VCC-selected Unity.

### Phase 1 — Clay vertical slice: 2–3 weeks

The whole editor, proved against the simplest possible content.

- Author and freeze the Clay template and its offline tables, using the **same generator** that will later produce the humanoid's.
- SwiftUI document shell, document browser, autosave and reopen.
- Metal viewport: orbit, pan, pinch zoom, frame, orthographic views.
- Apple Pencil input; Grab brush with X symmetry.
- Base fill plus a round paint brush; ray hit to UV.
- Front/side/back reference scene planes.
- Clay export: static FBX and GLB plus the albedo PNG, mesh-only pre-flight, **Export Model** wording.

**Gate:** on a physical iPad, sculpt the cube, paint it, export it, and open the result in both Blender and Unity with correct UVs and texture.

**Why Clay and not the Humanoid.** Reversed 2026-09-05, and the reversal is a consequence of Phase 0 landing. The original ordering put the Humanoid first because it carried every hard unknown — but those unknowns are now retired: both writers work, three independent readers agree, and Unity has built a Humanoid Avatar from the FBX. What has never been built is the editor. Metal, Pencil, a brush that holds frame rate on fixed topology, UV-seam painting and bounded undo are the unproven half now, and none of them need a skeleton. Proving them against Clay means that when a stroke looks wrong it is the brush, because there is no skinning in the picture to blame.

There is also a shippable product at the end of it, which there is not halfway through a humanoid.

### Phase 2 — Clay completion: 2–3 weeks

- Inflate/Deflate and Smooth.
- Pinned reference cards: drag, corner snap, frame resize, in-card zoom and pan, opacity, lock, collapse, persistence.
- Seam partner paint stamping, eraser, eyedropper, bounded undo.
- Resets, warnings, export progress and cancellation.
- Manifest hashes, error reporting, regression corpus.
- Device QA and TestFlight hardening.

**Gate:** Clay is a complete, releasable app. No chooser screen yet — a new document is a Clay document, because a picker with one option is furniture.

### Phase 3 — The Humanoid layer: 2–3 weeks

Additive. Most of the expensive parts already exist and are under test from Phase 0.

| Piece | State |
|---|---|
| Humanoid template, 51 bones, T-posed, mirror-exact | **Built** (`body-v1.bin`, its own oracle, 8 verify stages green) |
| Skeleton, rig gate transcribed from Unity + VRChat sources | **Built and tested** |
| VRM 1.0 and FBX 7400 writers, skinned | **Built**, three readers agree, Unity accepts the FBX |
| Joint-move-drives-the-skin deformation | **Built** (`Skinning.deform`, tested) |
| Eight proportion controls | To build — authored deltas plus joint-fitting rules |
| Pose preview, four poses, GPU skinning | To build |
| New Project chooser, two live cards | To build |
| Rig checks surfaced in the export pre-flight | Gate exists; needs the UI |

**Gate:** the original Humanoid journey end to end — proportions, sculpt, paint, poses, export, Unity Humanoid, VRChat SDK, Build & Test.

### Keeping the retrofit honest

Clay-first has exactly one failure mode: building a Clay-shaped app that the Humanoid cannot slot into. Three things prevent it, and all three cost nothing now.

1. **`templateKind` and optional `rig` exist from the first commit of Phase 1**, even though nothing reads `rig` until Phase 3. Retrofitting a document format is expensive; declaring a field nobody uses yet is free.
2. **One table generator, two templates.** Adjacency, symmetry pairs and seam partners for Clay come out of the same offline tool that will produce the humanoid's, so the runtime only ever learns one layout.
3. **The Phase 0 humanoid work stays in CI.** The template, the gate, both writers and all eight verify stages keep running on every commit through Phases 1 and 2. It cannot rot while unattended, and Phase 3 starts from something known-green rather than something last seen working in September.

**Total:** approximately **6–9 weeks** for a complete Humanoid-capable v0.1 — but now with a **releasable Clay app at roughly 5–6 weeks** and the humanoid layered on after, rather than nothing shippable until the end. Phase 0 is already spent. For one strong iOS/Metal engineer with part-time character technical-art support; a solo developer learning Metal, skinning and FBX should budget roughly **3–5 months**. The 10–16 week estimate in the broader PRD remains plausible for its larger paint, history, reference, validation, and polish scope; it is not the v0.1 described here.

### Codex/Sol Extra High planning budget

These are engineering-session budgets, not guarantees and not a substitute for device/Unity judgment:

| Milestone | Input tokens | Output/reasoning tokens |
|---|---:|---:|
| Exporter spike | 1–2.5M | 250k–600k |
| Golden vertical slice, cumulative | 3–7M | 700k–1.6M |
| Completed v0.1, cumulative | 8–18M | 1.8–4M |

Use one lead coding agent and short, bounded review/test passes. More parallel agents will not remove the serial bottlenecks: Xcode linking, physical-device Pencil testing, Unity import, and technical-art corrections.

## 10. Definition of done

Two gates now, in build order.

### Clay release (Phases 1–2)

- The Clay template has frozen IDs, vertices, indices, UVs and adjacency tables, generated by the same offline tool that will produce the humanoid's.
- Documents carry `templateKind` and an optional `rig`, even though nothing reads `rig` yet.
- Every edit preserves vertex/index/UV array sizes and ordering.
- Sculpt, paint, symmetry, undo, autosave and reopen all work on a physical iPad; a force quit loses no more than the active stroke.
- Reference scene planes and pinned cards work, persist, and never enter export content or metadata.
- Clay neutral and Clay sculpted samples export and open in Unity and Blender as static meshes with correct UVs and texture, carrying no skeleton or skin node.
- The app ships no chooser screen, no rig control, no pose preview and no proportion slider, and never reports a rig error.
- The Phase 0 humanoid template, rig gate and both writers are still green in CI.

### Humanoid layer (Phase 3)

v0.1 is complete only when all of the following are additionally true:

- The Humanoid template has frozen weights, skeleton, morphs, landmarks, and validation poses on top of the shared mesh contract.
- New Project offers exactly Clay and Humanoid, states that the choice is permanent, and opens either without a loading pause.
- A Clay document still never surfaces a rig control, a pose preview, a proportion slider, or a rig validation message.
- Every edit preserves vertex/index/UV/weight array sizes and ordering.
- All eight proportion extremes and representative sculpt cases pass authored in-app pose tests.
- Documents survive force quit with no more than the active stroke lost.
- Pinned cards drag, snap, resize, zoom, pan, lock and collapse; their state survives close and reopen; and Pencil strokes pass through them to the model.
- Export succeeds on the baseline physical iPad and reopens with ufbx.
- Neutral, proportion-extreme, elbow/knee sculpt, finger, and painted samples import into current VCC-selected Unity as accepted Humanoids.
- The VRChat SDK reports no rig-related blocker for the golden samples.
- Counts are shown as guidance; the app does not claim a VRChat performance rank.
- Onboarding and export instructions state that Unity/VCC remains mandatory.

## 11. Top risks after the recut

| Risk | Mitigation |
|---|---|
| No reliable distributable iPad FBX writer | Export gate before editor; two providers; explicit product-pivot choices |
| MakeHuman source material does not yield a good 8–10k avatar automatically | Dedicated technical-art pass; freeze and certify one curated template |
| Joint fitting and sculpt produce ugly bends | Safe morph ranges, joint-region brush clamps, four poses, Unity boundary tests |
| UV seam painting feels broken | Authored seam partner map, seam corpus, narrower round-brush scope |
| Users infer “direct VRChat publishing” | Export naming, onboarding, included Unity checklist |
| Current VRChat thresholds or Unity version changes | Keep target values in documented validation data; verify during releases; never hard-code a marketing guarantee |
| Template update breaks saved deltas | Immutable template versions; no silent geometry migration |
| **Clay is read as "a small Blender"** and users expect remeshing, booleans, or adding geometry | The New Project card says "Start from a lump. No rig." and the density is fixed; the app never offers a subdivide or remesh control, so the boundary is visible rather than discovered |
| **Users pick Clay, sculpt a character, then want it rigged** | The choice screen states in one line that it cannot be changed later. Automatic rigging of arbitrary sculpted geometry is a research problem, not a v0.1 feature; the honest answer is "start a Humanoid document" |
| **Pinned cards cost frame time during a stroke** | Capped at four; live textures at bounded resolution; measure with four open on the oldest test iPad before the cap is raised |
| **Scope creep from two document types** | `templateKind` is one field and `rig` is optional; if any feature needs a third branch on document type, that is the signal the split has gone wrong |

## 12. Recommended first repository milestone

Create an Xcode workspace with five targets/modules:

1. `HumanoidApp` — minimal SwiftUI iPad host.
2. `HumanoidCore` — fixed arrays, snapshot, invariant checks.
3. `GeometryBridge` — TinyBVH and ufbx Objective-C++ bridge.
4. `ExporterAssimp` — isolated candidate.
5. `ExporterAutodesk` — isolated candidate, excluded when SDK is unavailable.

The first pull request should contain no sculpting UI. Its only success criterion is: **a physical iPad exports a deliberately modified skinned mannequin that ufbx and Unity agree is the expected Humanoid**. That result determines whether the rest of this PRD is an implementation plan or merely an attractive interface around an unproven output format.

## 13. Primary research links

- [VRChat avatar overview](https://creators.vrchat.com/avatars/)
- [VRChat rig requirements](https://creators.vrchat.com/avatars/rig-requirements/) — the page itself warns that parts are outdated; certify in current Unity/SDK.
- [VRChat performance ranks](https://creators.vrchat.com/avatars/avatar-performance-ranking-system/)
- [VRChat Creator Companion getting started](https://vcc.docs.vrchat.com/guides/getting-started/)
- [Autodesk FBX SDK overview](https://aps.autodesk.com/developer/overview/fbx-sdk)
- [Autodesk FBX SDK platform requirements](https://help.autodesk.com/cloudhelp/2020/ENU/FBX-Developer-Help/files/welcome_to_the_fbx_sdk/FBX_Developer_Help_welcome_to_the_fbx_sdk_platform_requirements_html.html)
- [Assimp FBX exporter source](https://github.com/assimp/assimp/blob/master/code/AssetLib/FBX/FBXExporter.cpp)
- [Assimp FBX export issue epic](https://github.com/assimp/assimp/issues/6142)
- [ufbx](https://github.com/ufbx/ufbx)
- [TinyBVH](https://github.com/jbikker/tinybvh)
- [MakeHuman system-asset reuse](https://static.makehumancommunity.org/mpfb/faq/build_other_chargen.html)
- [ZIPFoundation](https://github.com/weichsel/ZIPFoundation)
- [UniVRM](https://github.com/vrm-c/UniVRM)

## 14. Amendment log

### 2026-09-05 — Clay documents and pinned reference cards (Mentis)

**What changed and why.**

1. **A New Project screen with two starting points, Clay or Humanoid.** The original PRD assumed every user wanted a VRChat avatar. Not everyone does, and the engine does not care: sculpt, paint, symmetry, undo and mesh validation are all template-agnostic already. Clay is the same product with the rig switched off, exporting a static mesh instead of an avatar.

2. **Pinned reference cards restored to scope.** §5 of the recut listed "floating boards" among the deferred items, alongside rotation, crop and calibration. On review that was the wrong cut. Scene planes and pinned cards are not two versions of one feature — planes are for tracing silhouette, cards are for reading detail while you work — and shipping only planes means anyone wanting to check a photograph mid-stroke has to orbit the camera away from what they are sculpting. Rotation, crop and calibration stay deferred.

3. **Clay ships first; the humanoid is layered on after.** Reversed later the same day, after the Unity session. The original ordering built the Humanoid first on the reasoning that it carried every hard unknown. Phase 0 then retired those unknowns: both writers work, three independent readers agree, and Unity built a Humanoid Avatar from our FBX on the first attempt. The unproven half is now the **editor** — Metal, Pencil, a brush that holds frame rate, UV-seam painting, bounded undo — and none of it needs a skeleton. Building it against Clay removes skinning as a confounder when something looks wrong, and produces a releasable app at roughly 5–6 weeks instead of nothing shippable until the end.

   The one failure mode is building a Clay-shaped app the Humanoid cannot slot into. §9 names the three guards: `templateKind` and optional `rig` from the first commit, one table generator for both templates, and the Phase 0 humanoid work staying green in CI throughout.

**What this costs:** about 1 week for Clay and the New Project screen, about half a week for the cards. Re-ordering costs nothing on the total — §9 carries the revised phases and a first release date that arrives earlier.

**What was explicitly *not* added:**

- **Converting Clay to Humanoid.** Automatic rigging of arbitrary sculpted geometry is a research problem. The choice is permanent and the UI says so up front.
- **Dynamic topology.** No remeshing, no subdivide, no adding geometry. The immutable-topology contract is the thing that makes the whole architecture — offline adjacency tables, no half-edge mesh, structurally impossible illegal operations — work at all. Clay is a *pre-subdivided* template, not a dynamic one.
- **A VRChat path for Clay.** No skeleton means no avatar. Clay exports as a model and its button says so.

**Naming.** "Humanoid Creator for VRChat" no longer describes the product, since half of it is neither humanoid nor for VRChat. The document keeps its filename so existing links survive; the product name is an open question for Mentis.
