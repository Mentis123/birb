import bpy, bmesh
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
# Mesh: a 2-segment column (stand-in for an upper/lower limb)
mesh = bpy.data.meshes.new("Limb"); obj = bpy.data.objects.new("Limb", mesh)
bpy.context.collection.objects.link(obj)
bm = bmesh.new()
for z in (0.0, 1.0, 2.0):
    for (x,y) in ((-0.2,-0.2),(0.2,-0.2),(0.2,0.2),(-0.2,0.2)):
        bm.verts.new((x,y,z))
bm.verts.ensure_lookup_table()
for ring in range(2):
    for i in range(4):
        a=ring*4+i; b=ring*4+(i+1)%4; c=b+4; d=a+4
        bm.faces.new((bm.verts[a],bm.verts[b],bm.verts[c],bm.verts[d]))
bm.faces.new([bm.verts[i] for i in (3,2,1,0)]); bm.faces.new([bm.verts[8+i] for i in range(4)])
bm.to_mesh(mesh); bm.free()
bpy.ops.mesh.uv_texture_add() if False else None
# Armature: Hips -> Spine style two bones
arm = bpy.data.armatures.new("Rig"); rig = bpy.data.objects.new("Rig", arm)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
b0 = arm.edit_bones.new("Hips"); b0.head=(0,0,0); b0.tail=(0,0,1)
b1 = arm.edit_bones.new("Spine"); b1.head=(0,0,1); b1.tail=(0,0,2); b1.parent=b0; b1.use_connect=True
bpy.ops.object.mode_set(mode='OBJECT')
obj.parent = rig
mod = obj.modifiers.new("Armature", 'ARMATURE'); mod.object = rig
g0 = obj.vertex_groups.new(name="Hips"); g1 = obj.vertex_groups.new(name="Spine")
g0.add([0,1,2,3],1.0,'REPLACE'); g0.add([4,5,6,7],0.5,'REPLACE')
g1.add([4,5,6,7],0.5,'REPLACE'); g1.add([8,9,10,11],1.0,'REPLACE')
bpy.ops.object.select_all(action='SELECT')
import sys
out = sys.argv[sys.argv.index('--')+1]
bpy.ops.export_scene.fbx(filepath=out, use_selection=True, add_leaf_bones=False, bake_anim=False, apply_scale_options='FBX_SCALE_ALL', axis_forward='-Z', axis_up='Y')
print("WROTE", out)
