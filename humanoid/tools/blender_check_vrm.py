"""Independent import oracle.

Reads an exported .vrm/.glb in headless Blender and reports what a real consumer
receives: armature, bone names, skinning and weight counts. The Khronos validator
checks that the container and accessors are well formed; this checks that an
importer reconstructs the rig we meant to describe.

Run with:  blender --factory-startup --background --python this.py -- <file>

Note on helper objects: Blender's glTF importer creates its own 42-vertex
icosphere as the custom bone-display shape whenever it imports an armature. It is
not content from the file — it appears for any skinned glTF and never for an
unskinned one — so this script measures skinned meshes only and lists anything
else separately, rather than letting a widget inflate the vertex count.
"""
import bpy
import sys
import os
import json

path = sys.argv[sys.argv.index('--') + 1]
# An unrigged export must be checked for the ABSENCE of a rig, not merely let
# through: a stray armature is exactly the kind of thing that writes without
# complaint and turns up in someone's scene.
rigged = not path.endswith('.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    bpy.ops.import_scene.gltf(filepath=path)
except Exception as exc:
    print("IMPORT_FAIL", os.path.basename(path), repr(exc))
    sys.exit(1)

armatures = [o for o in bpy.data.objects if o.type == 'ARMATURE']
all_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
skinned = [m for m in all_meshes
           if any(md.type == 'ARMATURE' and md.object for md in m.modifiers)]
# With no armature the importer creates no bone-display widget either, so every
# mesh in an unrigged file is content.
measured = skinned if rigged else all_meshes
helpers = [m.name for m in all_meshes if m not in measured]

bones = [b.name for a in armatures for b in a.data.bones]
max_weights, verts, unweighted, tris = 0, 0, 0, 0
for m in measured:
    verts += len(m.data.vertices)
    tris += sum(len(p.vertices) - 2 for p in m.data.polygons)
    for v in m.data.vertices:
        n = len([g for g in v.groups if g.weight > 0])
        max_weights = max(max_weights, n)
        if n == 0:
            unweighted += 1

REQUIRED = ["Hips", "Spine", "Chest", "Neck", "Head",
            "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
            "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
            "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
            "RightUpperLeg", "RightLowerLeg", "RightFoot"]
missing = [b for b in REQUIRED if b not in bones] if rigged else []

materials = {s.material.name for m in measured for s in m.material_slots if s.material}

result = {
    "file": os.path.basename(path),
    "armatures": len(armatures),
    "bones": len(bones),
    "rigged": rigged,
    "meshes": len(measured),
    "skinnedMeshes": len(skinned),
    "verts": verts,
    "tris": tris,
    "maxWeights": max_weights,
    "unweightedVerts": unweighted,
    "missingRequired": missing,
    "materials": sorted(materials),
    "importerHelperObjects": sorted(helpers),
}
print("GLTF_IMPORT " + json.dumps(result, sort_keys=True))

if rigged:
    ok = (len(armatures) == 1 and len(skinned) == 1 and not missing
          and unweighted == 0 and len(materials) == 1)
else:
    ok = (len(armatures) == 0 and len(skinned) == 0 and len(measured) == 1
          and len(materials) == 1)
sys.exit(0 if ok else 1)
