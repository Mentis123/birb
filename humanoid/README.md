# Humanoid Creator — Phase 0

An iPad app that reshapes, sculpts and paints one protected humanoid mannequin
and exports an avatar Unity accepts as a Humanoid for VRChat.

**This directory is Phase 0: the export gate, not the editor.** The PRD's own rule
is that the format question gets settled before any editor code exists, because
every alternative was either broken or unproven. That question is now answered as
far as it can be answered without a Mac.

Background and evidence: [`../docs/humanoid-creator-validation/REPORT.md`](../docs/humanoid-creator-validation/REPORT.md).
The original product spec: [`../docs/PRD-humanoid-creator-v0.1.md`](../docs/PRD-humanoid-creator-v0.1.md).

## What works today

```
swift test                          # 53 tests, no Apple toolchain needed
swift run humanoid-cli gate         # rig report for the frozen skeleton
swift run humanoid-cli corpus out/  # write the golden corpus
./tools/verify.sh                   # the whole chain, six stages
```

`verify.sh` is the gate. It runs the unit tests, generates the corpus, then puts
every file through the Khronos glTF validator, a real PNG inflate, Blender's
glTF importer, and both of Blender's FBX importers.

## Layout

| Path | What it is |
|---|---|
| `Sources/HumanoidCore` | Math, skeleton contract, rig gate, placeholder mannequin, PNG writer. Pure Swift, no Apple frameworks. |
| `Sources/ExporterVRM` | VRM 1.0 (GLB + `VRMC_vrm`). The primary output. |
| `Sources/ExporterFBX` | FBX 7400 via ufbx-write, plus the ufbx reopen validator. |
| `Sources/UfbxWriteC`, `Sources/UfbxC` | Vendored at pinned commits. See `VENDORED.md` in each. |
| `Sources/humanoid-cli` | Corpus generator and gate runner, used by CI. |
| `app/` | Thin iPad shell and the XcodeGen spec. The only Apple-framework code. |
| `tools/` | The oracles: Blender import checks, PNG decode, `verify.sh`. |
| `docs/Import_into_Unity.md` | **The Mac session instructions.** |

## Why two export formats

They hedge each other's single unknown.

- **VRM 1.0** carries an explicit bone-name to node-index map, so UniVRM builds
  the Unity Humanoid deterministically with no Configure step and no name
  heuristics. Unknown: whether the VRChat SDK accepts a UniVRM-built avatar.
  There is no public precedent either way.
- **FBX 7400** needs no extra Unity package at all. Unknown: whether Unity's
  Autodesk-based importer is happy with ufbx-write's output. Nobody has published
  a test of it.

One passing unblocks the build. Both passing means the user picks.

## Decisions worth not re-litigating

Each of these was found the expensive way and is pinned by a test.

- **Foundation cannot write a PNG.** Its `.zlib` compression emits raw RFC 1951
  deflate with no header or Adler-32. PNG's IDAT needs an RFC 1950 stream. A PNG
  built the wrong way passes the Khronos validator, because that validator reads
  image headers and never inflates, and opens in no decoder. Hence the zlib shim
  and a test that inflates and compares pixels.
- **VRM 1.0 renamed the thumb chain.** Unity's `ThumbProximal/Intermediate/Distal`
  is VRM's `thumbMetacarpal/thumbProximal/thumbDistal`.
- **Never type a skinned bone `UFBXW_BONE_ROOT`.** Both Blender importers drop it
  silently. Every bone is a `LIMB_NODE` under a plain armature node.
- **VRChat needs 19 bones, not Unity's 15** — Chest, Neck and both Shoulders too,
  with shoulders and neck parented to the highest mapped chest bone. We do not map
  UpperChest, which keeps that parent unambiguously Chest.
- **`ufbxw_prepare_scene` never creates a skeleton root**, so the hierarchy is
  built by hand (upstream issue #30).
- **ufbx-write derives its FileId and footer hash from the creation time**, so the
  timestamp is pinned or no two exports match.
- **Blender's glTF importer invents a 42-vertex icosphere** as a bone-display
  widget for any skinned import. It is not file content. The oracles measure
  skinned meshes only.
- **Column-major matrices, translation at elements 12/13/14.** Both glTF and
  ufbx-write expect this; getting it wrong yields a file that imports and skins
  incorrectly.

## What is deliberately not here

- **The editor.** No Metal viewport, no Pencil input, no sculpt or paint tools.
  Phase 2.
- **The real body.** The mannequin is procedural swept tubes: no face, mitten
  hands, 8,272 triangles. It exists to exercise the pipeline. The retopologised
  MakeHuman CC0 body is Phase 1.
- **Morph targets.** The corpus varies proportions by moving rest joints, which
  exercises the same inverse-bind recompute path the real morphs will.

## The one thing that cannot be verified here

Unity and the VRChat SDK. Neither runs on this box — Unity Personal cannot be
activated headlessly, since offline activation is Enterprise-only and command-line
activation needs a serial that Personal seats do not have.

So the corpus goes to a Mac once. See [`docs/Import_into_Unity.md`](docs/Import_into_Unity.md).
Every verdict from that session, pass or fail, gets recorded so the rig gate can
be tested against reality from then on.
