"""Proves the paint in an exported .glb lands where it was painted, as Blender reads it.

The Swift tests sample the exported texture through the exporter's own UVs,
with glTF's convention written into the test. This asks a consumer instead:
Blender's glTF importer converts glTF's top-left texture origin back to its
own bottom-left one, and if the exporter got the convention wrong the texture
comes out upside down on the model. On the clay atlas upside down is not a
subtle mirror; it moves every stroke onto another face, which is exactly what
the app did on the iPad before 2026-09-23.

The golden corpus's `clay-sculpted.glb` is filled (196, 176, 210) and then
painted (40, 60, 120) along a diagonal through the middle of the front face,
so the vertex nearest the centre of that face must read as the paint, and the
vertex nearest the centre of the BACK face — where the raw UVs used to point —
must read as the fill.

    blender --factory-startup --background --python this.py -- <file.glb>
"""
import sys

import bpy
from mathutils import Vector

path = sys.argv[sys.argv.index('--') + 1]
PAINT = (40, 60, 120)
FILL = (196, 176, 210)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    print("PAINT_FAIL no mesh in", path)
    sys.exit(1)
obj = meshes[0]
mesh = obj.data
uv_layer = mesh.uv_layers.active
if uv_layer is None:
    print("PAINT_FAIL no UV layer")
    sys.exit(1)

images = [img for img in bpy.data.images if img.size[0] > 0]
if not images:
    print("PAINT_FAIL no texture imported")
    sys.exit(1)
image = images[0]
width, height = image.size
pixels = list(image.pixels)


def sample(uv):
    # Blender's pixel buffer starts at the BOTTOM row, matching its v-up UVs.
    x = min(width - 1, max(0, int(uv[0] * width)))
    y = min(height - 1, max(0, int(uv[1] * height)))
    i = (y * width + x) * 4
    return tuple(round(pixels[i + k] * 255) for k in range(3))


def nearest_loop(target):
    """The face corner nearest a world point, and its UV."""
    world = obj.matrix_world
    best, best_uv = None, None
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex = mesh.loops[loop_index].vertex_index
            d = (world @ mesh.vertices[vertex].co - target).length
            if best is None or d < best:
                best, best_uv = d, uv_layer.data[loop_index].uv
    return best, best_uv


def distance(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))


# Blender's importer turns glTF's +Y-up into +Z-up: the front face (+Z in
# the document) faces -Y here.
checks = [("front centre", Vector((0.0, -0.13, 0.0)), PAINT, FILL),
          ("back centre", Vector((0.0, 0.13, 0.0)), FILL, PAINT)]
failed = False
for name, target, expect, other in checks:
    d, uv = nearest_loop(target)
    shown = sample(uv)
    ok = distance(shown, expect) < distance(shown, other)
    print(f"PAINT {'ok  ' if ok else 'FAIL'} {name}: uv ({uv[0]:.3f}, {uv[1]:.3f}) "
          f"shows {shown}, expected nearer {expect} than {other}")
    failed = failed or not ok

print("PAINT_FAIL" if failed else "PAINT_OK", path)
sys.exit(1 if failed else 0)
