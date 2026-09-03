# Humanoid Creator — headless exporter probes (2026-09-02)

Everything here ran on a Linux x86_64 container with no Apple toolchain. It is the evidence behind
`../REPORT.md`. Re-run order:

```bash
# toolchains (not vendored): Swift 6.1.2 for Ubuntu 24.04, Blender 4.5 LTS linux-x64,
# clang 18, cmake 3.28. Clone: github.com/ufbx/ufbx, github.com/ufbx/ufbx-write, github.com/assimp/assimp
S=/path/to/scratch

# 1. Blender writes a rigged limb (the golden producer)
blender --background --python blender/make_rigged_limb.py -- $S/blender_rigged_limb.fbx

# 2. Assimp (trimmed: FBX/glTF/COLLADA exporters only) writes the same limb
cmake -S assimp -B assimp/build -DASSIMP_BUILD_ALL_IMPORTERS_BY_DEFAULT=OFF -DASSIMP_BUILD_ALL_EXPORTERS_BY_DEFAULT=OFF \
  -DASSIMP_BUILD_FBX_IMPORTER=ON -DASSIMP_BUILD_FBX_EXPORTER=ON -DASSIMP_BUILD_GLTF_EXPORTER=ON -DASSIMP_BUILD_COLLADA_EXPORTER=ON \
  -DASSIMP_BUILD_ZLIB=ON -DBUILD_SHARED_LIBS=OFF -DASSIMP_BUILD_TESTS=OFF -DASSIMP_BUILD_ASSIMP_TOOLS=OFF && cmake --build assimp/build -j4
clang++ -std=c++17 assimp/export_skinned.cpp -Iassimp/include -Iassimp/build/include -Lassimp/build/lib -Lassimp/build/contrib/zlib -lassimp -lz -lpthread -o assimp_probe
./assimp_probe $S

# 3. ufbx-write writes the same limb (FBX 7400 or 7500)
clang -std=gnu99 -Iufbx-write ufbx-write/export_skinned.c ufbx-write/ufbx_write.c -lm -o ufbxw_probe
./ufbxw_probe $S/ufbxw_limb.fbx 7400

# 4. Oracles: ufbx dump, Blender legacy importer, Blender C++ (ufbx) importer
clang -O1 ufbx_dump.c ufbx/ufbx.c -Iufbx -lm -o ufbx_dump && ./ufbx_dump $S/*.fbx
blender --background --python blender/check_import_legacy.py   -- $S/ufbxw_limb.fbx
blender --background --python blender/check_import_ufbx_cpp.py -- $S/ufbxw_limb.fbx

# 5. Swift package: ufbx as a C target + XCTest on Linux (copy ufbx.c / ufbx.h into Sources/UfbxC[/include])
cd swift-headless && swift test
```

Also included (from the research agents' own probes, same container):

- `gltf-vrm/` — ~80-line Python skinned-GLB writer + Khronos `gltf-validator` runner (`npm i` then `node val.js spike.glb`; expect 0 errors / 0 warnings).
- `swift-cxx-interop/` — SwiftPM package proving Swift ↔ C (ufbx) and Swift ↔ C++ (tiny_bvh.h via `.interoperabilityMode(.Cxx)`) on Linux with XCTest + Swift Testing. Copy `ufbx.c` into `Sources/UFBX/` and `tiny_bvh.h` into `Sources/GeometryBridge/` first. With Swift 6.3.3 set `SWIFT_FORCE_MODULE_LOADING=prefer-interface`.
- `xcodegen/` — the `project.yml` that XcodeGen (built from source on Linux) turned into an iOS application `.xcodeproj` depending on the local package. Needs `USER`/`LOGNAME` set. Opening in Xcode 26 is unverified.
- `autodesk-pkg-check/analyze_pkg.py` — parses every Mach-O member of an Autodesk FBX SDK `.pkg.tgz` and prints its `LC_BUILD_VERSION` platform. This is how the mis-built 2020.3.7/.9/.10 "iOS" packages were detected (platform=1 = macOS).

Results are summarised in `RESULTS.md`. Unity itself cannot run here; every file that passes all three
oracles still needs the Unity 2022.3.22f1 Humanoid import on the Mac.
