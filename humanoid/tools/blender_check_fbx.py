#!/usr/bin/env python3
"""Imports an FBX with BOTH of Blender's importers and reports what each sees.

Two importers rather than one because they are not independent in the way they
look: since Blender 5.0 the default FBX importer is ufbx-backed, which is the
same library our own reopen validator uses. The legacy Python importer is a
genuinely separate implementation, so agreement between the two is worth more
than either alone.

Run with:  blender --factory-startup --background --python this.py -- <file.fbx>
"""
import bpy
import sys
import os
import json

path = sys.argv[sys.argv.index('--') + 1]

REQUIRED = ["Hips", "Spine", "Chest", "Neck", "Head",
            "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
            "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
            "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
            "RightUpperLeg", "RightLowerLeg", "RightFoot"]


def measure(import_call, label):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        import_call()
    except Exception as exc:
        return {"importer": label, "error": repr(exc)}

    armatures = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    skinned = [m for m in meshes
               if any(md.type == 'ARMATURE' and md.object for md in m.modifiers)]
    bones = [b.name for a in armatures for b in a.data.bones]

    max_weights, verts, unweighted = 0, 0, 0
    for m in skinned:
        verts += len(m.data.vertices)
        for v in m.data.vertices:
            n = len([g for g in v.groups if g.weight > 0])
            max_weights = max(max_weights, n)
            if n == 0:
                unweighted += 1

    return {
        "importer": label,
        "armatures": len(armatures),
        "bones": len(bones),
        "skinnedMeshes": len(skinned),
        "verts": verts,
        "maxWeights": max_weights,
        "unweightedVerts": unweighted,
        "missingRequired": [b for b in REQUIRED if b not in bones],
    }


results = [
    measure(lambda: bpy.ops.import_scene.fbx(filepath=path), "legacy-python"),
]
if hasattr(bpy.ops.wm, "fbx_import"):
    results.append(measure(lambda: bpy.ops.wm.fbx_import(filepath=path), "cxx-ufbx"))


def good(r):
    return ("error" not in r and r["armatures"] == 1 and r["skinnedMeshes"] == 1
            and not r["missingRequired"] and r["unweightedVerts"] == 0
            and r["maxWeights"] <= 4)


ok = all(good(r) for r in results)
# The two importers must also agree, or one of them is reconstructing something
# different from the same bytes.
if len(results) == 2 and all("error" not in r for r in results):
    for key in ("bones", "skinnedMeshes", "verts", "maxWeights"):
        if results[0][key] != results[1][key]:
            ok = False

print("FBX_IMPORT " + json.dumps(
    {"file": os.path.basename(path), "ok": ok, "results": results}, sort_keys=True))
sys.exit(0 if ok else 1)
