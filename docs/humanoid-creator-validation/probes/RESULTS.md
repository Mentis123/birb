# Empirical findings from this container (Ubuntu 24.04 x86_64, 2026-09-02)

1. Swift 6.1.2 (swift.org Ubuntu 24.04 toolchain) installs and runs SwiftPM + XCTest headlessly.
   - A SwiftPM package with a C target (ufbx.c 33k lines) + Swift target + XCTest built and passed.
   - PITFALL: cSettings .define() applies only to the C compile, NOT to the header Swift imports.
     UFBX_REAL_IS_FLOAT in cSettings -> struct layout mismatch -> SIGSEGV. Put such defines in a
     config header included by the umbrella header (or don't use them).
2. Blender 4.5.13 LTS runs headless (`--background --python`) with FBX + glTF exporters/importers present.
   - Generated a 12-vert / 2-bone skinned FBX from bpy; ufbx (in Swift test) reads 2 bones, 1 skin,
     2 clusters, maxWeights=2, 1 BindPose.
3. Assimp HEAD (c76f95b, 2026-09-02) builds with FBX/glTF/COLLADA exporters only -> libassimp.a 9.7MB (x86_64, unstripped, static, Release).
   - Exported the same skinned scene: binary FBX 7500 OK, ASCII FBX OK, glTF2/GLB OK, DAE OK.
   - ufbx on Assimp FBX: bones=2 skins=1 clusters=2 weights correct, bind transforms correct,
     BUT poses=0 (Assimp deliberately omits the BindPose node, FBXExporter.cpp ~L2245: "legacy ... not included")
     and clusters have empty names.
   - Blender imports Assimp binary FBX as armature(2 bones)+skinned mesh, maxWeights=2. Blender rejects ASCII FBX (expected).
   - Blender imports Assimp COLLADA as skinned (armature+2 bones, 12 verts). Assimp glTF imported skinned but with a
     duplicated mesh (meshes=2, verts=54) — glTF exporter quirk worth noting.
4. Blender's FBX exporter is pure Python: encode_bin.py 434 lines, export_fbx_bin.py 3851, fbx_utils.py 1943,
   plus json2fbx.py (165) which proves an FBX can be authored as a plain tree and encoded generically.
5. Unity cannot be run in this container (Editor needs licence activation) — Unity import remains the Mac-side gate.

6. ufbx-write (github.com/ufbx/ufbx-write @ 2b65caa 2026-06-07, C99 single file, MIT/Unlicense) built with `clang -std=gnu99` (needs gnu99/_GNU_SOURCE for localtime_r).
   - Wrote the same 12-vert/2-bone limb with skin deformer, 2 clusters (Transform + TransformLink), explicit BindPose, Lambert material + relative texture path, FBX 7400 and 7500.
   - ufbx reopen: bones=2 skins=1 clusters=2 poses=1 verts=12 maxW=2 materials=1 textures=1 -- bind translations exact. (Assimp output had poses=0.)
   - PITFALL FOUND: typing Hips as UFBXW_BONE_ROOT made BOTH Blender importers (legacy Python + new C++/ufbx) drop the Hips bone (1 bone, 'Spine' only, maxWeights 1 in legacy). Re-typed as UFBXW_BONE_LIMB_NODE -> both importers read Hips+Spine, skinned, maxWeights=2. This is the shape of upstream issue #30. Rule: every skinned bone is a LimbNode; the armature parent is a plain Null node.
   - File sizes: 21.9 KB (7400) / 27.7 KB (7500) for 12 verts (deflate on by default).
7. Blender 4.5.13 exposes BOTH FBX importers headlessly: legacy `bpy.ops.import_scene.fbx` and the new C++ ufbx-based `bpy.ops.wm.fbx_import`. Both accept Assimp's and Blender's own FBX for the limb; two independent oracles + ufbx = three headless checks before any file goes to Unity.
