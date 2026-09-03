# Humanoid Creator for VRChat — PRD Validation Report

**Date:** 2026-09-03
**Subject:** `docs/PRD-humanoid-creator-v0.1.md` (2026-08-27)
**Method:** 15 web-research agents (one per assumption cluster, primary sources only, ~2.7M tokens, ~1,400 tool calls), plus hands-on probes run in a Linux container with no Apple toolchain (Swift 6.1.2, Blender 4.5 LTS, Assimp HEAD, ufbx, ufbx-write, Khronos glTF Validator, XcodeGen). Evidence for every hands-on claim is reproducible from `probes/`.
**Owner constraint this report optimises for:** an AI agent writes and tests the code on Linux; Mentis only opens the project in Xcode, builds to a physical iPad, and validates. Minimal owner involvement, great result.

---

## 0. What this document accomplishes

The PRD asked one question before any editor work: *can an iPad app emit a skinned humanoid that Unity/VRChat accepts, and can that be proven before building the editor?* This report answers it with evidence rather than plans:

1. Every load-bearing assumption in the PRD has a verdict (confirmed / refuted / refined) with a primary source and, where possible, a probe that ran here.
2. The single largest risk in the PRD (the FBX writer) is now **measured**, not estimated: three writers were exercised headlessly and their output round-tripped through three independent readers.
3. Five architectures were compared against Mentis's constraints and one is recommended, with a phase plan that names exactly what only the Mac/iPad/Unity can prove.
4. The reusable pieces (Swift package layout, C/C++ interop, headless oracles, project generator) already exist as passing code in `probes/`.

**Bottom line:** the product is buildable, the PRD's *shape* is right (protected topology, fixed skeleton, Unity remains mandatory), but two of its three foundational technical bets are wrong as written (the Autodesk iOS SDK cannot be linked, and the writer list misses the best candidate), and the architecture must change from Objective-C++ to Swift/C++ interop or nothing below the UI can be tested off-device. With those corrections, roughly 85–90% of the codebase is testable on Linux before Xcode ever opens.

---

## 1. Verdict summary

| # | PRD assumption | Verdict | One-line evidence |
|---|---|---|---|
| 1 | Mobile ranks: 7,500 / 10,000 / 15,000 / 20,000 tris; ≤90 bones Good; 1 skinned mesh; 1 material | **Confirmed** | creators.vrchat.com ranking page, synced 2026-04-21. iOS shipped 2025-10-24 with the *same* mobile tier. |
| 2 | VCC-selected Unity version | **Confirmed, dated** | Still 2022.3.22f1. Unity 6 SDK is "in QA" (Dev Update 27 Aug 2026); uploads from Unity 6 are rejected today. |
| 3 | FBX is the format Unity/VRChat expect | **Confirmed** | Every official VRChat tutorial says FBX + armature. VRM needs a community converter. |
| 4 | Autodesk FBX SDK is a viable iOS writer (candidate B) | **Refuted** | The "iOS" packages 2020.3.7/.9/.10 contain **macOS-platform arm64 objects** (Mach-O `LC_BUILD_VERSION platform=1`), confirmed by parsing all 504 members of each archive and by an Apple DTS reply on forum thread 773350. Only **2020.3.4** has real iOS slices (armv7/arm64 device, x86_64 simulator, no arm64 simulator). Licence itself is fine (free, attribution clause §1.1.5). |
| 5 | ufbx is "loader only"; only Assimp and Autodesk can write FBX | **Refuted** | **`ufbx-write`** (same author, C99, single file, MIT/Unlicense, WIP) writes skins, clusters, bind poses, materials, textures. Probed here: full round-trip through ufbx and both Blender importers. |
| 6 | Assimp's FBX writer is a credible candidate A | **Refined** | Structurally correct skin output (probed here and by the research agent independently), but it deliberately omits `BindPose`, merges vertices by position (breaks the frozen-vertex-order invariant), has an open skinning bug (#5526) and needs master ≥ 2026-08-24 (PR #6754), not release v6.0.5. Demote to reference. |
| 7 | "Do not write a custom FBX writer in v0.1" | **Confirmed, reasoning corrected** | The byte encoder is ~400 lines and trivial; the undocumented part is what Unity's Autodesk-based importer wants *semantically*. Blender took years; ufbx-write is 372 commits in and still fixing armature roots. Use ufbx-write instead of writing bytes. |
| 8 | Metal + MTKView over RealityKit / SceneKit | **Confirmed, strongly** | SceneKit deprecated in iOS 26. RealityKit's `LowLevelMesh` has no joint semantics on iOS 18/26 (its deformer pipeline is iOS 27+), appears capped at 60 fps on ProMotion, and has static-only picking. Nomad, Valence and Satin are all hand-rolled GPU renderers. |
| 9 | Objective-C++ bridge to TinyBVH / ufbx / writers | **Refuted for this workflow** | No Objective-C runtime in Swift on Linux → the bridge would be untestable off-device. Swift **C/C++ interop** (`.interoperabilityMode(.Cxx)`) was probed here: real `ufbx.c` and real `tiny_bvh.h` called from Swift under XCTest on Linux. |
| 10 | MakeHuman assets are CC0 and usable | **Confirmed** | Base mesh, targets, rigs, weights are CC0; only program code is AGPL. The FAQ explicitly invites other character generators. |
| 11 | MakeHuman standard topology is "too dense" | **Confirmed, quantified** | Body group is **26,756 triangles** (13,378 quads), not ~13k — a 2.7× reduction to hit 10k, so retopo is mandatory. A CC0 **53-bone `game_engine` rig with authored weights** ships with MPFB2 and MakeHuman documents it auto-mapping in Unity. |
| 12 | Unity needs 15 bones; VRChat "requires" the same | **Refined** | Unity: 15. **VRChat additionally requires Chest, Neck and both Shoulders mapped**, Shoulders and Neck as direct children of Chest (re-confirmed by a VRChat moderator, Jan 2026). SDK 3.8.2 (2025-06) also **blocks nested armatures**. |
| 13 | "Install VRChat Creator Companion" as the user's first Unity step | **Refuted on macOS** | VCC's GUI is Windows-only. Mac users use Unity Hub + 2022.3.22f1 with the VPM CLI (Linux/Mac unblocked in VCC 2.5.0-beta.2, June 2026) or the community ALCOM client. This is Mentis's own path. |
| 14 | GLB/VRM + UniVRM is a "Plan B pivot only" | **Refined — undervalued** | UniVRM's VRM 1.0 importer builds the Humanoid Avatar **automatically from an explicit bone map** (no Configure step, no name heuristics). A minimal skinned GLB writer is ~80 lines and the Khronos Validator runs headless on Linux (probed: 0 errors). glTFast, by contrast, cannot create Avatars at all (#391 open since 2022). |
| 15 | A texture is a texture | **Refined** | **Texture memory is a ranked stat** (mobile Good ≤ 18 MB). Mesh Read/Write must be enabled or the avatar is Very Poor and upload is blocked. Mobile avatars must use VRChat/Mobile shaders and stay under a 10 MB bundle cap. Recommend a 1024² export preset for mobile. |
| 16 | 6–9 weeks for one strong engineer | **Plausible for the recut; the gates move** | Phase 0 shrinks (the writer question is largely answered here); the template/technical-art pass and the Unity/VRChat device gates are the real critical path. |

---

## 2. What was actually run here (empirical results)

All in an Ubuntu 24.04 x86_64 container, no Mac, no Xcode. Scripts and sources are in `probes/`; results in `probes/RESULTS.md`.

| Probe | Result |
|---|---|
| Swift 6.1.2 toolchain + SwiftPM + XCTest on Linux | Works. A C target wrapping the real `ufbx.c` (33k lines) parsed a skinned Blender FBX from a Swift test. **Pitfall found:** a `cSettings .define()` applies to the C compile but not to the header Swift imports; `UFBX_REAL_IS_FLOAT` caused a struct-layout mismatch and SIGSEGV. Put such defines in a config header. |
| Swift ↔ C++ interop (research agent, Swift 6.3.3) | Real `tiny_bvh.h` (C++20) wrapped in a small C++ class, imported via `.interoperabilityMode(.Cxx)`, ray hit a triangle at t=5.0 under both XCTest and Swift Testing. **Pitfall found:** the 6.3.3 Ubuntu 24.04 tarball ships a stale `Testing.swiftmodule`; `SWIFT_FORCE_MODULE_LOADING=prefer-interface` fixes it. |
| Blender 4.5.13 LTS headless | Runs `--background --python`; both the legacy Python FBX importer and the **new C++ ufbx-based importer** are available. Generated a rigged 12-vertex / 2-bone limb FBX from `bpy`. |
| Assimp HEAD (c76f95b, 2026-09-02), trimmed to FBX/glTF/COLLADA exporters | 9.7 MB unstripped static lib (x86_64). Skinned export: binary FBX 7500 OK, glTF/GLB OK, DAE OK. ufbx read 2 bones, 2 clusters, correct weights and bind transforms, **`poses=0`** (BindPose deliberately omitted, `FBXExporter.cpp` ~L2245). Blender imports the FBX and the DAE as skinned; the glTF import duplicated the mesh (exporter quirk). |
| **ufbx-write** (2b65caa, 2026-06-07) | Same limb, FBX 7400 and 7500, explicit BindPose, Lambert material, relative texture path. ufbx: bones=2, clusters=2, **poses=1**, weights and bind translations exact. **Pitfall found:** typing Hips as `UFBXW_BONE_ROOT` made *both* Blender importers drop the Hips bone (this is upstream issue #30's shape). With every bone typed `UFBXW_BONE_LIMB_NODE` and the armature as a plain node, both importers read Hips+Spine, skinned, 2 influences. Needs `-std=gnu99` (uses `localtime_r`). |
| Khronos glTF Validator (research agent) | `npm i gltf-validator`, runs on Node 22. An ~80-line Python skinned-GLB writer (2 joints, IBMs, embedded PNG, PBR material) validated with **0 errors / 0 warnings**. |
| XcodeGen on Linux (research agent) | Built from source with Swift 6.3.3; `xcodegen generate` produced an iOS application `.xcodeproj` with a local package dependency, iPad-only device family, `SWIFT_OBJC_INTEROP_MODE=objcxx`. Needs `USER`/`LOGNAME` set. Opening it in Xcode 26 is unverified (no Mac). |
| Autodesk FBX SDK packages (research agent) | Downloaded 2020.3.2/.4/.7/.9/.10 iOS packages and parsed every Mach-O member: **.7/.9/.10 are macOS-platform**; .4 is genuinely iOS (device fat armv7/armv7s/arm64, x86_64 sim). Licence text read (§1.1.1–1.1.5, §2.1). |
| Unity | **Cannot run here** (Editor licence activation needs an interactive login). Remains the Mac-side oracle. Research established the exact acceptance rules from Unity's open-source `AvatarAutoMapper.cs` / `AvatarSetupTool.cs`, which lets us build a pre-flight validator that mirrors them. |

**The oracle chain that now exists on Linux, for any exporter:** writer → ufbx (structure, weights, bind transforms) → Blender legacy importer → Blender C++/ufbx importer → CPU-skinning comparison. For GLB/VRM: writer → Khronos Validator → VRMC_vrm JSON-schema → cgltf/tinygltf reopen. Only *Unity itself* is missing from this chain, and it is the one thing Mentis's Mac contributes in Phase 0.

---

## 3. The export route, decided on evidence

This was the PRD's stated gate and its biggest unknown. Ranked:

| Route | Status after this pass | Linux-testable | End-user Unity friction | Verdict |
|---|---|---|---|---|
| **A. FBX via ufbx-write** | Round-trips through 3 readers here; API covers the full PRD scope incl. bind pose; MIT/Unlicense; C99, no OS code, own deflate. WIP: pin a commit, track issue #30, never use `BONE_ROOT` for skinned bones. Godot's V-Sekai team is adopting it. | Yes (ufbx + 2× Blender) | None (drag in, Humanoid, Create From This Model) | **Primary FBX candidate** |
| **B. VRM 1.0 (GLB + VRMC_vrm)** | Writer is trivial (Foundation only); Validator + schema fully headless; UniVRM builds the Humanoid **from the explicit bone map** with no heuristics. Cost to user: install UniVRM via UPM git URL (one MIT package). VRChat SDK acceptance of a UniVRM-built Avatar is inferred, not yet observed. | Yes (fully) | One package install | **Co-equal second output**, not Plan B |
| C. FBX via Autodesk SDK 2020.3.4 | Only genuinely-iOS build; iOS 7 min-version objects, static `.a`, no arm64 simulator, ~14 MB object code, security fixes after .4 are reader-side only. Licence permits free redistribution with attribution. Same API ships for Linux so the writer code can be tested here. | Yes (Linux SDK) | None | **Comparison/legal fallback only.** Mentis would have to confirm Xcode 26 links it. |
| D. FBX via Assimp | Works structurally; no BindPose; vertex merging; open skinning bug; 1.2–1.5 MB stripped; bitcode flags must be patched for iOS. | Yes | None | **Reference/oracle only** (it is a useful second writer to diff against). |
| E. COLLADA (.dae) | Unity-native import (same FBX-SDK chain), XML so hand-rollable; Assimp's DAE imported skinned in Blender here. Unity DAE skinning fidelity for Humanoid has no modern primary evidence either way. | Partly (Blender) | None | **Contingency** if A fails in Unity. |
| glTF via glTFast | No Avatar creation (#391, "Planned" since 2022). | — | — | Dead |
| glTF via UnityGLTF | Humanoid import exists (name-table + reflection into Unity internals); fragile; precedence fights with glTFast. | — | git URL + override | Not preferred over VRM |
| USD | `com.unity.formats.usd` deprecated; successor requires Unity 2023.1+, cannot install in 2022.3.22f1. | — | — | Dead |
| Apple-native (ModelIO / SceneKit / RealityKit writers) | ModelIO documents only .obj/.stl output, no skeleton export, cannot write .usdz; SceneKit deprecated; RealityKit has no writer. Untestable on Linux by definition. | No | — | Dead |

**Decision:** ship **both A and B from the same `ExportSnapshot`**. They cost little extra (the snapshot is the same arrays; the writers are ~1–2k lines each), they hedge each other's single unknown (does Unity accept ufbx-write's FBX? does the VRChat SDK accept a UniVRM-built avatar?), and both are provable on Linux up to the Unity step. Whichever Unity accepts first on Mentis's Mac becomes the documented default; the other stays as the interop file.

---

## 4. Alternative architectures considered

Five approaches were framed for the design panel. My assessment (the automated Opus panel's scores are appended in §11 when they complete):

| Approach | Feasibility | Headless-testable | Mentis effort | End-user result | Notes |
|---|---|---|---|---|---|
| **1. PRD-faithful** (SwiftUI + Metal + ObjC++ bridge + Assimp/Autodesk FBX) | Medium | **Low** (ObjC++ untestable on Linux; Autodesk .7–.10 won't link) | High (device debugging of the bridge) | Good if it works | Two of three bets are broken as written. |
| **2. No-FBX** (VRM-only via UniVRM) | High | **Very high** | Low | Good, +1 package for user | Loses the "drag an FBX in" promise; VRChat SDK acceptance of UniVRM-built avatars unobserved. |
| **3. Own Swift FBX writer** | Medium | High | Low | Good if Unity accepts | Encoder trivial, semantics not; ufbx-write already *is* this, maintained by the best FBX reverse-engineer alive. Redundant. |
| **4. Web PWA** (Three.js/WebGPU in iPad Safari, Vercel, Birb Labs house style) | High for the editor | Very high (Playwright, existing harness) | **Lowest** (no Xcode at all) | Weaker: Safari has no Pencil pressure/tilt via Pointer Events reliability issues, no file-system access, Share-sheet-only export, no Wake Lock guarantees, memory limits for a 2048² paint pipeline; and it contradicts the PRD's stated platform. | Genuinely attractive for a *prototype of the editor UX*, and the GLB/VRM writer is language-neutral so nothing is wasted. Not the product. |
| **5. Desktop companion** (iPad sculpts, Mac/Blender or Unity script does final-mile) | High | High | Medium (Mentis operates the companion) | Adds a second install and a second tool for every user | Contradicts "minimal intervention" for *users*, not just for Mentis. |
| **6. Recommended: Linux-first native, dual-format** (below) | High | **~85–90%** | Low (4 scripted device sessions) | Best: native Pencil/Metal, no user-side tooling beyond Unity | Takes the PRD's shape, fixes bets 4/5/9, adds B. |

Why not the web route, given this repo's house style? Because the differentiator of this product is Pencil-grade sculpt/paint feel (pressure, tilt, hover, 120 Hz, sub-2-frame latency) and a 2048² projective paint pipeline. Those are exactly the things iPad Safari does not expose or guarantee, and the PRD names them as the product. The web *is* the right place for a throwaway UX prototype of the eight sliders and the export flow if Mentis wants to see it before the native build.

---

## 5. Recommended architecture: "Linux-first native, dual-format"

### 5.1 Repository layout

```
humanoid/
  Package.swift                    # ONE SwiftPM package; everything here builds + tests on Linux
  Sources/
    HumanoidCore/                  # pure Swift: template arrays, morphs, joint refit, IBMs, LBS oracle,
                                   #   brush kernels, symmetry, seam-partner stamping, dilation, validators,
                                   #   ExportSnapshot, manifest (Codable), PNG encoder (zlib)
    UfbxC/                         # vendored ufbx.c/.h (C target)  — reader/validator
    UfbxWriteC/                    # vendored ufbx_write.c/.h (C target) — FBX writer
    GeometryBridge/                # C++ wrapper around tiny_bvh.h (POD API, catches its own exceptions)
    ExporterFBX/                   # Swift adapter: ExportSnapshot -> ufbx-write calls
    ExporterVRM/                   # Swift adapter: ExportSnapshot -> GLB + VRMC_vrm (Foundation only)
    Validation/                    # ufbx reopen compare, Unity pre-flight (mirrors AvatarSetupTool), VRM schema
  Tests/                           # XCTest + Swift Testing; golden corpus; negatives
  app/
    project.yml                    # XcodeGen spec (committed); the .xcodeproj is generated, not committed
    HumanoidApp/                   # thin SwiftUI + MTKView shell, .metal files, UITouch Pencil input, ImageIO
  tools/                           # blender -b scripts: template build, weight transfer, pose corpus, oracles
  template/                        # frozen canonical template (versioned, immutable arrays)
```

Rules that keep it testable: no `simd`, `Metal`, `UIKit`, `CoreGraphics`, `ImageIO`, `CryptoKit` imports below `app/` (use stdlib `SIMD3<Float>`, a hand-rolled 4×4, `swift-crypto`); C++ only behind small POD wrappers; libstdc++ on Linux vs libc++ on Apple is fine because the wrappers expose no STL types; shaders are a transcription of tested Swift math and stay tiny.

### 5.2 Rendering and input (unchanged from PRD, made concrete)

Raw Metal + MTKView hosted in SwiftUI. Triple-buffered position/normal ring updated per dirty range; static index/UV/joint/weight buffers; GPU LBS with T-pose = identity so rest positions render untouched; UV-space rasterisation for painting (vertex shader emits `uv*2-1` as clip position) so seams are handled natively, with the PRD's seam-partner map kept as the test oracle; jump-flood gutter dilation at export; TinyBVH on the CPU with refit per stroke. Input is `UITouch` (not PencilKit) with coalesced + predicted touches, `touchType == .pencil`, `altitudeAngle`/`azimuthAngle`, `rollAngle` and squeeze behind `#available(17.5)`. Deployment target iPadOS 17.5 (or 18 to simplify).

### 5.3 The template (the real critical path)

- Source: MakeHuman hm08 body (CC0, 26.7k tris) → loop-preserving retopo to ~4.5–5k quads (9–10k tris) → single non-overlapping UV0 with 8–16 px gutters → weights transferred by nearest-surface from MakeHuman's CC0 `default_weights.mhw` / `weights.game_engine.json`, with Blender bone-heat as regional fallback → limit 4, X-mirror, smooth, normalise, sort descending → frozen.
- Skeleton: start from the CC0 53-bone `game_engine` rig, **rename to Unity `HumanBodyBones` names** (Hips, Spine, Chest, UpperChest?, Neck, Head, LeftShoulder, LeftUpperArm, LeftLowerArm, LeftHand, 5×3 fingers, LeftUpperLeg, LeftLowerLeg, LeftFoot, LeftToes; mirror right), keep Shoulders and Neck as direct children of Chest, LowerArm the first child of UpperArm, Foot the first child of LowerLeg, armature root a *sibling* of the mesh under the FBX root (no wrapper above Hips — SDK 3.8.2 blocks nested armatures), every mapped bone owns ≥ 1 weighted vertex, every node name unique, no `_end` leaves. Optional eye/jaw bones only if weighted. ~55–60 bones.
- Joint model: MakeHuman's landmark-mean scheme (each joint = mean of a fixed vertex ring, authored roll copied not recomputed). Per morph/sculpt commit: joints ← means; local = inv(parent) · global; IBM = inv(global); vertices and weights untouched; skinning at rest reproduces the mesh bit-for-bit (asserted in tests).
- All of this runs headlessly via `blender -b` / the `bpy` wheel and `Anny` (Apache-2.0, PyTorch over the same CC0 assets) if a code-only morph source is wanted. Exclude Anny's SMPL/SMPL-X topologies (non-commercial).

### 5.4 Validators that make Unity's silent failures loud (on the iPad and in CI)

Mirrors of Unity's open-source rules: ≥ 15 Unity bones + VRChat's Chest/Neck/Shoulders mapped and weighted; hierarchy depth windows (Hips 1–3 below root, never the root); T-pose tolerances (upper/lower arm within **5°** of ±X, hands 10°, fingers 10/5/5, legs 15/20° of −Y, spine chain 30° of +Y, hips frame 15°); minimum inter-joint distance ≥ 5 mm (no "bone length is zero"); unique names; Σw = 1, descending, ≤ 4 influences; node rest == cluster bind == T-pose per bone (ufbx `bind_to_world == node_to_world`); UpAxis Y, UnitScaleFactor consistent with metres; height 0.5–5 m. Plus a **pose corpus** (T, arms-down, elbow/knee bend, squat, **forearm pronation 90°, thigh internal rotation**) skinned on the CPU with area-ratio, flipped-normal and joint-collapse metrics that *derive* the safe slider ranges instead of authoring them.

### 5.5 Exports

`Export for VRChat` produces `AvatarName.zip` with `AvatarName.fbx` (ufbx-write, **7400**, BindPose present, Blender/Unity conventions), `AvatarName.vrm` (GLB + `VRMC_vrm`, T-pose, +Z facing, explicit bone map, metres), `Textures/AvatarName_Albedo.png` (2048 or 1024 preset), `manifest.json` (SHA-256 via swift-crypto), and `Import_into_Unity.md` that is **platform-aware** (Windows: VCC; macOS: Unity Hub + 2022.3.22f1 + VPM CLI or ALCOM) and lists the VRChat gates (Mesh Read/Write on, VRChat/Mobile shader, Lip Sync Default or Jaw Flap, View Position, 10 MB Android cap, build Windows + Android + iOS).

---

## 6. Division of labour

**The agent (Linux, no Mac), continuously:** everything in `humanoid/Sources`, `Tests`, `tools`, `template`; the golden corpus; the Blender/ufbx/Validator oracles in CI; the XcodeGen spec; the `.metal` sources (transcribed from tested Swift, so errors are typos, not logic); a GitHub Actions `macos-26` job (Xcode 26.6 + iPad simulators preinstalled) that runs `xcodegen generate` + `xcodebuild build/test` on every push so Xcode-side breakage is caught before Mentis is asked to look.

**Mentis, four scripted sessions, each ≤ 1 hour:**

| Session | What Mentis does | What it proves that Linux cannot |
|---|---|---|
| **M1 — Unity gate** (before any editor code) | Unity Hub → 2022.3.22f1; VPM CLI or ALCOM avatar project; drag in the golden corpus (neutral + proportion extremes + joint-relocated, as FBX **and** VRM); Rig → Humanoid → Create From This Model; add Avatar Descriptor; run SDK validation; Build & Test to VRChat. Paste console output back. | Whether ufbx-write's FBX and/or a UniVRM-built Avatar pass Unity + VRChat SDK. This single session retires the PRD's top risk. |
| **M2 — first device run** | Open generated `.xcodeproj`, set signing team, Run on iPad. Report the on-screen latency probe number and any shader compile error text. | Metal shaders compile on device; Pencil input path; paint latency. |
| **M3 — vertical-slice playtest** | Complete the user journey once (reshape, grab, paint, poses, export), AirDrop the ZIP to the Mac, repeat M1 on it, upload to VRChat, screenshot the avatar in-world. | The whole loop end to end with real hands. |
| **M4 — v0.1 acceptance** | Same as M3 across the proportion extremes; TestFlight build. | Definition-of-done items that mention "physical iPad" or "VRChat". |

Optional, not required: if Mentis is willing to activate a Unity Personal licence once on the Linux box (an interactive login), Unity 2022.3.22f1 for Linux can run `-batchmode -nographics` and assert `Avatar.isValid && isHuman` plus the exact T-pose verdict in CI, collapsing M1 into an automated check. Licensing and headless FBX import on Ubuntu 24.04 are unverified, so it is upside, not the plan.

---

## 7. Phased plan (revised)

**Phase 0 — Export gate, ~1 week agent time, ends at M1.** Vendor ufbx + ufbx-write; `ExportSnapshot`; both writers; ufbx/Blender/Validator oracles; a *procedural* placeholder mannequin (limb sweeps, 15+VRChat bones, deterministic weights) so the gate does not wait on the art template; golden corpus incl. negatives; Unity pre-flight validator; `Import_into_Unity.md`. Gate: **M1 green on at least one format.** If FBX fails and VRM passes, FBX becomes "later"; if both fail, the COLLADA contingency spike runs before any editor work (the PRD's stop rule stands).

**Phase 1 — Template, ~1–2 weeks agent time, parallel with Phase 0.** Headless Blender pipeline from MakeHuman CC0 → frozen 9–10k template with weights, landmarks, UVs, symmetry pairs, seam partners, adjacency. Pose-corpus metrics. One human look at elbow/knee/shoulder renders in Blender (Preserve Volume off) is the only non-automatable step; Mentis can do it from PNGs in the PR.

**Phase 2 — Golden vertical slice, ~2–3 weeks, ends at M2 then M3.** Metal viewport, references, Height + Shoulders morphs with joint fitting, Grab with symmetry, base fill + round brush, four poses, invariants, ZIP export. CI on `macos-26` from the first commit of the app shell.

**Phase 3 — v0.1 completion, ~3–4 weeks, ends at M4.** Remaining controls, Inflate/Smooth, seam stamping + dilation, eraser/eyedropper, undo, autosave, warnings, progress/cancel, TestFlight.

Total agent time is in the PRD's 6–9 week band; Mentis's time is four sessions.

---

## 8. Risks that remain (and who can close them)

| Risk | Closer |
|---|---|
| Unity's importer rejects or mis-skins ufbx-write output in some way the three Linux readers accept (footer, layer encoding, BindPose contents) | **M1.** Mitigated by writing Blender's proven conventions (7400, identity normal index array per Blender #123088, always emit BindPose). |
| VRChat SDK 3.10.x objects to a UniVRM-built Humanoid | **M1.** If so, VRM stays as interop only. |
| ufbx-write is WIP (issue #30; header 0.2.0; breaking changes) | Pin a commit; run its own test suite + our corpus on every bump; the `BONE_ROOT` pitfall is already documented. |
| Retopologised template deforms poorly at joints | Phase 1 metrics + one human look; loop-preserving retopo (QuadriFlow / Instant Meshes with guides) rather than blind decimation. |
| Unity 6 SDK lands mid-build | Auto-mapper code is identical between 2022.3 and Unity 6 branches (diffed); thresholds live in a versioned validation-data file; re-run corpus the week it ships. |
| Metal shader errors only surface on device | Shaders are transcriptions of tested Swift; `macos-26` CI compiles them before Mentis sees them. |
| Texture rank on mobile | 1024² preset default for mobile; document ASTC compression. |
| XcodeGen-on-Linux project doesn't open cleanly in Xcode 26 | First `macos-26` CI run answers it; XcodeGen also runs natively on that runner. |

---

## 9. Concrete PRD amendments

1. **§7/§8:** Replace candidate B (Autodesk) with the truth: only 2020.3.4 links on iOS; .7–.10 are mis-built. Add **ufbx-write** as candidate A; demote Assimp to reference. Add **VRM 1.0 via UniVRM** as a first-class second output with its own pass-matrix row. Delete USD/Apple-native/glTFast from consideration with one sentence each.
2. **§6:** Replace "Objective-C++ bridge" with "C/C++ targets consumed via Swift C++ interop"; restructure the five Xcode targets into one SwiftPM package + one thin app target generated by XcodeGen.
3. **§4:** Body-only hm08 is 26,756 tris; add the CC0 53-bone `game_engine` rig + weights and Anny as named sources; specify the skeleton per §5.3 above; require every mapped bone weighted; forbid nested armature roots.
4. **§5 Rig preview:** add pronation and thigh-roll poses; state LBS-only preview (matches Unity/VRChat); derive safe ranges by CI sweep.
5. **§5 Painting:** add export-time gutter dilation; make UV-space rasterisation the primary stamping mechanism and seam-partners the oracle.
6. **§2/§3 Unity steps:** platform-aware (VCC is Windows-only); add Mesh Read/Write, VRChat/Mobile shader, texture-memory rank, 10 MB Android cap, Lip Sync Default/Jaw Flap, multi-platform Build & Publish; Humanoid mapping is a prerequisite for impostors on mobile.
7. **§8 Pass matrix:** enumerate the concrete acceptance criteria (15 Unity bones + Chest/Neck/Shoulders, zero pose error at Unity's tolerances, no zero-length, unique names, no nested armature, `Avatar.isValid && isHuman`).
8. **§9/§12:** Phase 0 is done on Linux, not on an iPad; the first PR is the export gate package with M1 as its acceptance test; add a `macos-26` CI job.
9. **§11 risks:** add "ufbx-write WIP", "texture memory rank", "Unity 6 SDK timing"; remove "no reliable distributable iPad FBX writer" as a blocking unknown — it is now a pinned dependency with a known pitfall list.
10. Add a **Competitive landscape** paragraph: VRoid Studio for iPad (VRM only, Very Poor raw, export crashes), Nomad/ZBrush for iPad (no skinning; Nomad's FBX took 4 years and is "basic"), MakeAvatar/Vket (Unity-free but preset-locked), Prisma3D/ISD (rigging exists, low quality), Blender for iPad (**on hold, unfunded for 2026, Android-first**), Ready Player Me (shut down 2026-01-31). The gap is real and narrow: protected topology + authored weights + mobile-Good-by-construction + Unity-ready export.

---

## 10. What was not completed in this pass

- The automated adversarial-verification stage (three refuters per load-bearing claim) and the five-proposal design panel with three judges were interrupted twice by session usage limits. They were relaunched on Opus at 04:10 UTC and their output is appended in §11 when it lands; where they contradict this report, §11 wins and the text above will be revised. The claims most exposed to that stage (Autodesk packaging, ufbx-write viability, Assimp behaviour, Swift-on-Linux, VRChat bone requirements) were independently reproduced by hand here or by a second agent, so the core verdicts do not rest on a single unverified source.
- The Blender-for-iPad status was researched inside the competitive-landscape agent (paused, unfunded, Android-first) rather than by its own dedicated agent, which failed on the usage limit.
- Nothing has run on a Mac, an iPad, or in Unity. Every place that matters is marked M1–M4 above.

---

## 11. Panel results

*(Pending — the Opus verify/design/judge stage is running; this section is filled when it completes.)*

---

## 12. Evidence index (primary sources read during this pass)

VRChat: creators.vrchat.com performance ranks (synced 2026-04-21), rig requirements, current Unity version (2025-10-03), releases 3.8.1/3.8.2/3.10.x, Android limitations/optimisation, impostors, iOS Platform FAQ, Dev Updates 25 Jun / 27 Aug 2026, roadmap (1 Sep 2026); vcc.docs.vrchat.com getting-started, VPM CLI, release 2.5.0. Unity: manual pages (UsingHumanoidChars, ConfiguringtheAvatar, 3D-formats, FBXImporter-Rig/Model, BoneWeight, Mesh.bindposes, HumanDescription twists, ModelImporter.fileScale, EditorCommandLineArguments, system requirements), UnityCsReference `AvatarAutoMapper.cs` / `AvatarSetupTool.cs` / `AvatarMappingEditor.cs` (2022.3 and master, diffed), com.unity.formats.fbx known issues, Companion License v1.4, glTFast #391/#359 and 6.17 changelog, UnityGLTF changelog/HumanoidSetup.cs, usd-unity-sdk deprecation, com.unity.importer.usd 1.0. Autodesk: APS FBX SDK page, packages 2020.3.2/.4/.7/.9/.10 (Mach-O parsed), License.rtf 2020.3.10, CVE-2026-10709/10710, Apple forum 773350. Writers: ufbx-write repo (API, tests, issue #30), ufbx, Assimp master (`FBXExporter.cpp`, epic #6142, PR #6754, #5526, #5337, #5866), Blender `io_scene_fbx` (encode_bin/export_fbx_bin/fbx_utils, #123088), Blender Code FBX spec (2013), fbxcel, FbxWriter, Comfy fbx-exporter-three, needle three-fbx-exporter. glTF/VRM: glTF 2.0 spec, glTF-Validator ISSUES.md and npm, vrm-specification VRMC_vrm-1.0 humanoid.md, UniVRM Vrm10Importer/HumanoidLoader, VRM Converter for VRChat package.json/releases, VRChat VRM feature request. Apple: ModelIO/SceneKit/RealityKit doc JSON (availability/deprecation), Xcode 26 release notes, WWDC15 233 / WWDC16 220 / WWDC19 221, 602 / WWDC24 10104 / WWDC25 287, 288, iOS 18 SDK headers, UITouch/UIHoverGestureRecognizer/UIPencilInteraction docs, Metal Best Practices (triple buffering), Apple Support 102894, developer.apple.com/metal/tools. Toolchain: swift.org install/platform-support, swift-testing, swift-corelibs-foundation, swift-foundation #4619, cxx-interop docs, swiftlang/swift #62550, PackageDescription, XcodeGen repo/PR #988/releases, Tuist Linux post, actions/runner-images macos-26, Unity Linux batchmode docs. Assets/tech-art: MakeHuman LICENSE.md, build_other_chargen FAQ, base.obj (counted), default.mhskel, default_weights.mhw, algos3d.py, skeleton.py, humanmodifier.py; MPFB2 LICENSE.md, rig/weights.game_engine.json, rig.mixamo_unity.json; Anny (naver) README/LICENSE/arXiv 2511.03589; Blender Human Base Meshes bundle; Quaternius, Kenney, Mixamo FAQ, Unreal Content EULA, Ready Player Me shutdown coverage, VRoid sample licences, MB-Lab licensing, Pinocchio 2007, Kavan 2007, SculptGL sources, Blender `paint_image_proj.cc` / `meshlaplacian.cc` / `brush.cc`, PyPI bpy. Competitors: App Store listings and manuals for VRoid Studio, Nomad Sculpt, ZBrush for iPad, Valence 3D, Shapr3D, uMake, Sculptura, Putty 3D, Prisma3D, ISD Studio, MakeAvatar, Vket Avatar Maker, Meshy; Forger discontinuation coverage; Blender task #142346 and Q1-2026 Lab report.
