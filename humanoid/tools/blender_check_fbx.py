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
        for v in m.data.vertices:
            n = len([g for g in v.groups if g.weight > 0])
            max_weights = max(max_weights, n)
            if n == 0:
                unweighted += 1
    # Counted over ALL meshes, not just skinned ones. Counting only skinned
    # meshes reported 0 vertices for an unrigged file, which combined with an
    # absence-only pass condition would have waved through an empty export.
    for m in meshes:
        verts += len(m.data.vertices)
    tris = sum(len(p.vertices) - 2 for m in meshes for p in m.data.polygons)

    return {
        "importer": label,
        "armatures": len(armatures),
        "bones": len(bones),
        "meshes": len(meshes),
        "skinnedMeshes": len(skinned),
        "verts": verts,
        "tris": tris,
        "maxWeights": max_weights,
        "unweightedVerts": unweighted,
        "missingRequired": [b for b in REQUIRED if b not in bones],
    }


results = [
    measure(lambda: bpy.ops.import_scene.fbx(filepath=path), "legacy-python"),
]
if hasattr(bpy.ops.wm, "fbx_import"):
    results.append(measure(lambda: bpy.ops.wm.fbx_import(filepath=path), "cxx-ufbx"))


# An unrigged export is checked for the absence of a rig rather than waved
# through: a stray armature or a zero-influence skin deformer writes without
# complaint and shows up in the importer's hierarchy.
rigged = "clay-" not in os.path.basename(path)


def good(r):
    if "error" in r:
        return False
    # Geometry first, in both cases. Everything below is a statement about the
    # rig, and none of it is worth anything if the file has no mesh in it.
    if r["meshes"] != 1 or r["verts"] == 0 or r["tris"] == 0:
        return False
    if rigged:
        return (r["armatures"] == 1 and r["skinnedMeshes"] == 1
                and not r["missingRequired"] and r["unweightedVerts"] == 0
                and r["maxWeights"] <= 4)
    return (r["armatures"] == 0 and r["skinnedMeshes"] == 0 and r["bones"] == 0)


ok = all(good(r) for r in results)
# The two importers must also agree, or one of them is reconstructing something
# different from the same bytes.
if len(results) == 2 and all("error" not in r for r in results):
    for key in ("bones", "meshes", "skinnedMeshes", "verts", "tris", "maxWeights"):
        if results[0][key] != results[1][key]:
            ok = False

print("FBX_IMPORT " + json.dumps(
    {"file": os.path.basename(path), "rigged": rigged, "ok": ok, "results": results},
    sort_keys=True))
sys.exit(0 if ok else 1)
