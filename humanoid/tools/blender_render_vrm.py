"""Renders an exported .vrm/.glb through Blender's own importer.

The import oracle counts bones, vertices and weights; it cannot tell a body from
a bag of correctly-skinned triangles. This is the end-to-end picture: the file
that ships, reconstructed by a consumer, with nothing from the build pipeline in
the loop.

    blender --factory-startup --background --python this.py -- <file> <prefix>
"""
import bpy
import math
import sys
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
path, prefix = args[0], args[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

meshes = [o for o in bpy.data.objects
          if o.type == 'MESH' and any(m.type == 'ARMATURE' and m.object for m in o.modifiers)]
if not meshes:
    print("RENDER_FAIL no skinned mesh in", path)
    sys.exit(1)
for obj in list(bpy.data.objects):
    if obj not in meshes:
        obj.hide_render = True

material = bpy.data.materials.new("clay")
material.use_nodes = True
shader = material.node_tree.nodes["Principled BSDF"]
shader.inputs["Base Color"].default_value = (0.76, 0.71, 0.67, 1)
shader.inputs["Roughness"].default_value = 0.7
for mesh in meshes:
    mesh.data.materials.clear()
    mesh.data.materials.append(material)
    # Cycles' shadow-terminator fix. Without it a low-poly body self-shadows into
    # a dense black stipple that reads exactly like coincident geometry.
    mesh.cycles.shadow_terminator_offset = 0.2

world = bpy.data.worlds.new("w")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.18, 0.21, 1)

light = bpy.data.lights.new("key", 'SUN')
light.energy = 3.2
light.angle = math.radians(6.0)
light_object = bpy.data.objects.new("key", light)
bpy.context.collection.objects.link(light_object)

# World space, so whatever axis conversion the importer applied is included.
corners = [mesh.matrix_world @ Vector(c) for mesh in meshes for c in mesh.bound_box]
lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
centre = (lo + hi) / 2
size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
# Blender's glTF importer converts Y-up to its own Z-up, so the figure stands
# along +Z here even though the file describes it standing along +Y.
up = Vector((0, 0, 1))

camera_data = bpy.data.cameras.new("cam")
camera_data.lens = 50
camera = bpy.data.objects.new("cam", camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 32
scene.cycles.use_denoising = False
scene.render.resolution_x = 640
scene.render.resolution_y = 640

vfov = 2 * math.atan(18.0 / camera_data.lens)
distance = (size * 0.62) / math.tan(vfov / 2)
for name, angle in (("front", 0.0), ("threequarter", math.radians(38))):
    eye = centre + Vector((math.sin(angle) * distance, -math.cos(angle) * distance, 0))
    forward = (centre - eye).normalized()
    right = forward.cross(up).normalized()
    frame_up = right.cross(forward)
    camera.matrix_world = Matrix((
        (right.x, frame_up.x, -forward.x, eye.x),
        (right.y, frame_up.y, -forward.y, eye.y),
        (right.z, frame_up.z, -forward.z, eye.z),
        (0, 0, 0, 1)))
    # The key light is aimed per view rather than fixed in world space. Blender's
    # importer converts the file's Y-up to its own Z-up, so a hardcoded sun angle
    # arrives somewhere different from where it was aimed and renders the body
    # almost flat — which is the one thing a shading check must not do.
    key = (-forward + frame_up * 0.8 + right * 0.5).normalized()
    light_object.rotation_euler = (-key).to_track_quat('-Z', 'Y').to_euler()

    scene.render.filepath = f"{prefix}_{name}.png"
    bpy.ops.render.render(write_still=True)

print("RENDER_CAM", [tuple(round(v,3) for v in r) for r in camera.matrix_world])
print(f"RENDER_OK {path} bounds {tuple(round(v, 3) for v in (hi - lo))}")
