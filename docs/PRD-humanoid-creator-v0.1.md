# Humanoid Creator for VRChat — v0.1 Research PRD and Build Plan

**Status:** Recut proposal  
**Research date:** 2026-08-27  
**Platform:** iPadOS first; SwiftUI, MetalKit, Objective-C++/C++  
**Product promise:** Reshape, lightly sculpt, and paint one protected humanoid mannequin on iPad; preview several deformations; export a skinned FBX package that Unity can configure as a Humanoid for the normal VRChat publishing step.

## 1. Executive decision

The product is feasible, but only if it remains a protected character customizer rather than a small Blender.

The immutable contract is the product: one versioned mesh, one fixed skeleton, fixed vertex/index/UV order, authored skin weights, authored morphs, and authored joint-fitting rules. Users may move existing vertices and paint the existing UV texture. They may not alter topology, rigs, weights, UVs, materials, or scene structure.

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

- Open one protected T-pose humanoid.
- Import aligned front, side, and back reference images.
- Adjust eight safe proportion controls.
- Use Grab, Inflate/Deflate, and Smooth without changing topology.
- Paint one 2048×2048 sRGB albedo texture.
- Preview four authored poses and receive bounded deformation warnings.
- Save documents locally and export FBX, PNG, manifest, and instructions in a ZIP.

### Outside the app

- Install VRChat Creator Companion and its selected Unity version.
- Import the package and configure the material.
- Confirm Unity's Humanoid mapping.
- Add the VRChat Avatar Descriptor, viewpoint, eye/viseme settings when available, and SDK-specific configuration.
- Validate, test, and upload through the VRChat SDK.

The export action must be named **Export for VRChat**, never Publish. VRChat's own avatar flow still requires Unity rig configuration, materials, an Avatar Descriptor, validation, and upload; those SDK components are not generic FBX content. See [VRChat Avatars](https://creators.vrchat.com/avatars/) and [VCC Getting Started](https://vcc.docs.vrchat.com/guides/getting-started/).

## 3. v0.1 user journey

1. Tap **New Humanoid**, name the document, and see the canonical mannequin in T-pose.
2. Optionally add one front, side, and back image; position, scale, flip, fade, and lock each.
3. Adjust Height, Head, Shoulders, Torso, Hips, Arms, Legs, and Build.
4. Use mirrored Grab, Inflate/Deflate, and Smooth brushes.
5. Fill the body with a base color and optionally paint with a round brush.
6. Cycle through T-pose, arms-down, elbow/knee bend, and squat.
7. Resolve blocking checks and review warnings.
8. Export `AvatarName.zip` containing:
   - `AvatarName.fbx`
   - `Textures/AvatarName_Albedo.png`
   - `Import_into_Unity.md`
   - `AvatarName_manifest.json`
9. Move the ZIP to a Mac or PC and complete the Unity/VCC/VRChat steps.

## 4. Canonical mannequin contract

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

## 5. v0.1 functional scope

### Documents and viewport

- SwiftUI document browser: create, rename, duplicate, save, reopen, delete.
- Autosave flattened current state after meaningful operations; a crash may lose the active stroke only.
- Metal viewport: orbit, pan, pinch zoom, frame, orthographic front/side/back.
- Solid, textured, and wireframe-overlay display.
- Apple Pencil edits; fingers navigate unless an explicit finger-edit toggle is enabled.
- Target responsive interaction on the oldest selected test iPad; measure rather than promise 60 fps everywhere.

### Reference images

- Import JPEG, PNG, or HEIC using PhotosPicker or Files.
- One front, side, and back reference plane.
- Position, uniform scale, horizontal flip, opacity, visibility, lock, and delete.
- Copy originals into the document package and make bounded-resolution GPU previews.
- Never include reference bytes, filenames, or paths in export snapshots.
- Defer rotation, crop, calibration, floating boards, and six-image support.

### Proportions

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

### Rig preview and validation

- GPU skinning for T-pose, arms-down, elbow/knee bend, and squat.
- Returning to T-pose exactly restores editable rest positions.
- Blocking checks: finite values; exact array counts; valid indices; required bones; hierarchy; one-to-four influences; normalized weights; valid transforms; texture present; exporter validation passed.
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
  positions, normals, indices, uv0
  vertexFaces, oneRingNeighbors
  symmetryPairs, seamPartners
  morphDeltas, jointLandmarkRules
  boneHierarchy, restTransforms
  boneIndices[4], boneWeights[4]
  validationPoses

HumanoidDocument
  templateID, templateVersion
  morphValues[8]
  sculptDelta[vertex]
  albedoTexture
  referenceImages[3]
  cameraState
  flattenedCheckpoint
```

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
- Deliberately malformed negative cases for validator tests.

### Pass matrix

| Check | Required result |
|---|---|
| Physical iPad build/export | Succeeds without private APIs or runtime downloads |
| ufbx reopen | Counts, hierarchy, weights, bind transforms, material path, and finite values match |
| Unity import | No material transform or FBX hierarchy warnings attributable to exporter |
| Humanoid Configure | Required mappings resolve and T-pose is accepted |
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

### Phase 1 — Golden vertical slice: 2–3 weeks

- Freeze draft 8–10k template and offline-generated tables.
- SwiftUI document shell and Metal viewport.
- Front/side/back references.
- Height and Shoulders morphs with joint fitting.
- Grab brush with symmetry.
- Base fill plus basic round paint brush.
- Four pose previews, hard invariants, ZIP package export.

**Gate:** a user can complete the entire journey and locally test the avatar in VRChat.

### Phase 2 — v0.1 completion: 3–5 additional weeks

- Complete all eight proportion controls.
- Inflate/Deflate and Smooth.
- Seam partner paint stamping, eraser, eyedropper, bounded undo.
- Autosave/reopen, resets, warnings, export progress/cancellation.
- Import guide, manifest hashes, error reporting, regression corpus.
- Device QA and TestFlight hardening.

**Total:** approximately **6–9 weeks including the export spike** for one strong iOS/Metal engineer with part-time character technical-art support. A solo developer learning Metal, skinning, and FBX should budget roughly **3–5 months**. The 10–16 week estimate in the broader PRD remains plausible for its larger paint, history, reference, validation, and polish scope; it is not the v0.1 described here.

### Codex/Sol Extra High planning budget

These are engineering-session budgets, not guarantees and not a substitute for device/Unity judgment:

| Milestone | Input tokens | Output/reasoning tokens |
|---|---:|---:|
| Exporter spike | 1–2.5M | 250k–600k |
| Golden vertical slice, cumulative | 3–7M | 700k–1.6M |
| Completed v0.1, cumulative | 8–18M | 1.8–4M |

Use one lead coding agent and short, bounded review/test passes. More parallel agents will not remove the serial bottlenecks: Xcode linking, physical-device Pencil testing, Unity import, and technical-art corrections.

## 10. Definition of done

v0.1 is done only when all of the following are true:

- One canonical template has frozen IDs, vertices, indices, UVs, weights, skeleton, morphs, landmarks, and validation poses.
- Every edit preserves vertex/index/UV/weight array sizes and ordering.
- All eight proportion extremes and representative sculpt cases pass authored in-app pose tests.
- Documents survive force quit with no more than the active stroke lost.
- Reference assets never enter export content or metadata.
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

