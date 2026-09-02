# Imports a file into headless Blender and reports what a Unity-like importer would need: armature, bones, skinned mesh, weights.
import bpy, sys, os
path = sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(path)[1].lower()
try:
    if ext == '.fbx': bpy.ops.import_scene.fbx(filepath=path)
    elif ext in ('.gltf', '.glb'): bpy.ops.import_scene.gltf(filepath=path)
    elif ext == '.dae': bpy.ops.wm.collada_import(filepath=path)
except Exception as e:
    print("IMPORT_FAIL", os.path.basename(path), repr(e)); sys.exit(0)
arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bones = sum(len(a.data.bones) for a in arms)
skinned = [m for m in meshes if any(md.type == 'ARMATURE' and md.object for md in m.modifiers)]
maxw = 0; nverts = 0
for m in meshes:
    nverts += len(m.data.vertices)
    for v in m.data.vertices: maxw = max(maxw, len([g for g in v.groups if g.weight > 0]))
print(f"IMPORT_OK {os.path.basename(path)} armatures={len(arms)} bones={bones} meshes={len(meshes)} skinned={len(skinned)} verts={nverts} maxWeights={maxw} boneNames={[b.name for a in arms for b in a.data.bones]}")
