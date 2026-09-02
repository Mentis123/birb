import bpy, sys, os
path = sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
try: bpy.ops.wm.fbx_import(filepath=path)
except Exception as e: print("CPP_IMPORT_FAIL", os.path.basename(path), repr(e)); sys.exit(0)
arms=[o for o in bpy.data.objects if o.type=='ARMATURE']; meshes=[o for o in bpy.data.objects if o.type=='MESH']
skinned=[m for m in meshes if any(md.type=='ARMATURE' and md.object for md in m.modifiers)]
maxw=0; nv=0
for m in meshes:
    nv+=len(m.data.vertices)
    for v in m.data.vertices: maxw=max(maxw,len([g for g in v.groups if g.weight>0]))
print(f"CPP_IMPORT_OK {os.path.basename(path)} armatures={len(arms)} bones={sum(len(a.data.bones) for a in arms)} meshes={len(meshes)} skinned={len(skinned)} verts={nv} maxWeights={maxw} bones={[b.name for a in arms for b in a.data.bones]}")
