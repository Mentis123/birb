#!/usr/bin/env python3
"""Builds the frozen humanoid template from the MakeHuman CC0 base mesh.

    blender --factory-startup --background --python build_template.py -- \
        --source base.obj --out template.bin [--preview out_prefix]

What it does, and why each step is where it is:

1. **Reads the joint landmarks before touching the mesh.** MakeHuman embeds 125
   anatomical "joint cubes" in hidden helper geometry; each joint is the mean of
   its cube's eight vertices. That is where the skeleton comes from, so the
   proportions match the body rather than being guessed.
2. **Normalises units.** The base mesh is in decimetres with the origin at the
   hips. We work in metres with the feet on y = 0, which is what both exporters
   and VRChat expect.
3. **Halves, reduces, mirrors.** Reduction runs on one side only and the result
   is mirrored, which makes X-symmetry exact by construction. Remeshing the whole
   body instead gives a mesh that is 100% asymmetric — measured, not assumed —
   and sculpt mirroring would then have no vertex pairs to work with.
4. **Builds the armature at those landmarks and skins with bone heat**
   (Blender's implementation of Baran & Popovic's Pinocchio weighting).
5. **Converts A-pose to T-pose.** The MakeHuman base stands with its arms down.
   Unity accepts only 5 degrees of droop on the arm bones, so the arm chain is
   aimed along +/-X and the new pose is baked in as the rest pose. Legs and spine
   already sit inside Unity's tolerances and are left alone.
6. **Writes a versioned binary template** that the Swift package loads.

The mesh keeps MakeHuman's authored UV layout throughout: it is a proper
character unwrap, and a generated one would make painting materially worse.
"""
import bpy
import bmesh
import math
import struct
import sys
from collections import defaultdict
from mathutils import Vector, Matrix

# ---------------------------------------------------------------------------
# Bone table: our Unity-named skeleton mapped onto MakeHuman's landmarks.
#
# Names are Unity's HumanBodyBones spelling so the auto-mapper's keyword scoring
# resolves without manual Configure. The hierarchy is the one VRChat's SDK
# demands: 19 required bones, shoulders and neck on Chest, UpperChest unmapped.
# ---------------------------------------------------------------------------

FINGERS = [("Thumb", 1), ("Index", 2), ("Middle", 3), ("Ring", 4), ("Little", 5)]

def bone_table():
    """(bone, parent, landmark, tail-landmark) in MakeHuman landmark names."""
    rows = [
        ("Hips",  None,    "joint-pelvis",  "joint-spine-3"),
        ("Spine", "Hips",  "joint-spine-3", "joint-spine-1"),
        ("Chest", "Spine", "joint-spine-1", "joint-neck"),
        ("Neck",  "Chest", "joint-neck",    "joint-head"),
        ("Head",  "Neck",  "joint-head",    "joint-head-2"),
    ]
    for side, tag in (("Left", "l"), ("Right", "r")):
        rows += [
            (f"{side}Shoulder", "Chest",              f"joint-{tag}-clavicle",  f"joint-{tag}-shoulder"),
            (f"{side}UpperArm", f"{side}Shoulder",    f"joint-{tag}-shoulder",  f"joint-{tag}-elbow"),
            (f"{side}LowerArm", f"{side}UpperArm",    f"joint-{tag}-elbow",     f"joint-{tag}-hand"),
            (f"{side}Hand",     f"{side}LowerArm",    f"joint-{tag}-hand",      f"joint-{tag}-finger-3-1"),
            (f"{side}UpperLeg", "Hips",               f"joint-{tag}-upper-leg", f"joint-{tag}-knee"),
            (f"{side}LowerLeg", f"{side}UpperLeg",    f"joint-{tag}-knee",      f"joint-{tag}-ankle"),
            (f"{side}Foot",     f"{side}LowerLeg",    f"joint-{tag}-ankle",     f"joint-{tag}-foot-1"),
            (f"{side}Toes",     f"{side}Foot",        f"joint-{tag}-foot-1",    f"joint-{tag}-foot-2"),
        ]
        for name, index in FINGERS:
            # Unity's spelling. VRM 1.0 renames the thumb chain on export; that
            # translation lives in the Swift side, not here.
            joints = ["Proximal", "Intermediate", "Distal"]
            parent = f"{side}Hand"
            for j, joint in enumerate(joints):
                rows.append((f"{side}{name}{joint}", parent,
                             f"joint-{tag}-finger-{index}-{j + 1}",
                             f"joint-{tag}-finger-{index}-{j + 2}"))
                parent = f"{side}{name}{joint}"
    return rows


def target_direction(bone):
    """Where each bone must point in the finished T-pose.

    These mirror Unity's own sBonePoses table. Only the arm chain is actually
    re-posed; the rest is listed so the script can report how far the source
    already sits from each target.
    """
    sign = 1.0 if bone.startswith("Left") else -1.0
    if any(bone.endswith(s) for s in ("Shoulder", "UpperArm", "LowerArm", "Hand")):
        return Vector((sign, 0, 0))
    if "Thumb" in bone:
        return Vector((sign, 0, 1)).normalized()   # 45 degrees forward
    if any(f[0] in bone for f in FINGERS[1:]):
        return Vector((sign, 0, 0))
    return None


# ---------------------------------------------------------------------------

def read_landmarks(path):
    """Mean of each joint cube's vertices, in the source's own units."""
    verts = []
    groups = defaultdict(set)
    current = None
    for line in open(path):
        parts = line.split()
        if not parts:
            continue
        if parts[0] == 'v':
            verts.append(Vector((float(parts[1]), float(parts[2]), float(parts[3]))))
        elif parts[0] == 'g':
            current = parts[1] if len(parts) > 1 else None
        elif parts[0] == 'f' and current and current.startswith('joint'):
            for token in parts[1:]:
                groups[current].add(int(token.split('/')[0]) - 1)
    out = {}
    for name, indices in groups.items():
        total = Vector((0, 0, 0))
        for i in indices:
            total += verts[i]
        out[name] = total / len(indices)
    return out


def import_body(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=path, use_split_objects=True, use_split_groups=True)
    body = bpy.data.objects['body']
    for obj in list(bpy.data.objects):
        if obj is not body:
            bpy.data.objects.remove(obj, do_unlink=True)
    # The importer stores a Y-up to Z-up rotation on the OBJECT rather than in
    # the vertex data. Clearing it keeps every coordinate in one Y-up space, so
    # local and world agree and nothing silently reads the wrong one.
    body.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return body


def normalise(body, landmarks, scale=0.1):
    """Decimetres to metres, feet on the ground, centred on X."""
    mesh = body.data
    for v in mesh.vertices:
        v.co *= scale
    lowest = min(v.co.y for v in mesh.vertices)
    lo_x = min(v.co.x for v in mesh.vertices)
    hi_x = max(v.co.x for v in mesh.vertices)
    shift_x = (lo_x + hi_x) / 2
    for v in mesh.vertices:
        v.co.y -= lowest
        v.co.x -= shift_x
    return {k: Vector((p.x * scale - shift_x, p.y * scale - lowest, p.z * scale))
            for k, p in landmarks.items()}


# Vertices this close to the mirror plane are welded to their own reflection.
MIRROR_MERGE_THRESHOLD = 0.0005


def reduce_symmetric(body, iterations):
    """Halve, reduce, mirror. Symmetry then holds by construction."""
    mesh = body.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                           plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=True)
    bm.to_mesh(mesh)
    bm.free()

    modifier = body.modifiers.new("reduce", 'DECIMATE')
    modifier.decimate_type = 'UNSUBDIV'
    modifier.iterations = iterations
    bpy.ops.object.modifier_apply(modifier="reduce")

    # Triangulate BEFORE culling in-plane faces, because the export triangulates
    # and a quad can hide an in-plane triangle inside itself. The face that
    # reached the lip came from a quad with three vertices on the plane and one
    # 5 mm off it: not in-plane as a quad, and one of its two triangles lying
    # exactly in the plane. Culling what will actually be exported closes that
    # gap, and costs nothing since the template ships triangles regardless.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()

    # Drop anything lying flat in the mirror plane before mirroring it.
    #
    # bisect_plane leaves one zero-area quad per cut edge (188 of them here),
    # which is harmless until un-subdivide fuses each into a neighbour and turns
    # them into 98 real triangles, up to 274 mm2, forming a lid across the
    # midline. Mirroring a lid gives two coincident back-to-back copies. Blender
    # drops most of them as duplicates, but one survived into the exported
    # template as a pair of z-fighting faces on the lip.
    #
    # They are interior walls: the surrounding surface is continuous across the
    # plane, so removing them and mirroring gives a closed manifold with no
    # boundary and no non-manifold edge, which is asserted below.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    # The test threshold is the MERGE threshold, not zero. Mirror-merge snaps
    # every vertex within that distance of the plane onto the plane exactly, so
    # a face sitting 0.2 mm off it is not in-plane when tested and is in-plane
    # by the time it is duplicated. That is the pair that reached the lip.
    flat = [f for f in bm.faces
            if all(abs(v.co.x) < MIRROR_MERGE_THRESHOLD for v in f.verts)]
    # 'FACES', not 'FACES_ONLY': the latter keeps the lid's interior edges and
    # vertices as loose wires, which mirror into 144 edges belonging to no face.
    bmesh.ops.delete(bm, geom=flat, context='FACES')
    bm.to_mesh(mesh)
    bm.free()

    mirror = body.modifiers.new("mirror", 'MIRROR')
    mirror.use_axis[0] = True
    mirror.use_mirror_merge = True
    mirror.merge_threshold = MIRROR_MERGE_THRESHOLD
    mirror.use_mirror_u = True
    bpy.ops.object.modifier_apply(modifier="mirror")

    bm = bmesh.new()
    bm.from_mesh(mesh)
    open_edges = sum(1 for e in bm.edges if len(e.link_faces) != 2)
    seen = set()
    doubled = 0
    for face in bm.faces:
        key = tuple(sorted(v.index for v in face.verts))
        if key in seen:
            doubled += 1
        seen.add(key)
    bm.free()
    if open_edges or doubled:
        raise SystemExit(f"mirrored body is unsound: {open_edges} edges are not "
                         f"shared by exactly two faces, {doubled} faces are "
                         "duplicated")


def build_armature(landmarks):
    armature_data = bpy.data.armatures.new("Rig")
    armature = bpy.data.objects.new("Armature", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='EDIT')

    created = {}
    for name, parent, head_key, tail_key in bone_table():
        head = landmarks.get(head_key)
        tail = landmarks.get(tail_key)
        if head is None or tail is None:
            raise SystemExit(f"missing landmark for {name}: {head_key} / {tail_key}")
        if (tail - head).length < 1e-4:
            tail = head + Vector((0, 0.01, 0))
        bone = armature_data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.use_connect = False
        if parent:
            bone.parent = created[parent]
        created[name] = bone
    bpy.ops.object.mode_set(mode='OBJECT')
    return armature


def skin(body, armature):
    """Bone-heat weights, Blender's implementation of Pinocchio's diffusion."""
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def mirror_bone_name(name):
    if name.startswith("Left"):
        return "Right" + name[4:]
    if name.startswith("Right"):
        return "Left" + name[5:]
    return name


def symmetrise_weights(body, armature):
    """Averages each vertex's weights with its mirror partner's.

    Bone heat is a diffusion solve over the whole mesh, and it does not return
    an exactly symmetric answer even from an exactly symmetric mesh and rig: on
    this body the two shoulders disagreed by enough to drag midline vertices
    6.2 mm sideways once the arms were posed. The mesh is mirror-exact at this
    point, so every vertex has a partner and the average is well defined; the
    weights on both sides sum to one, so their average does too.
    """
    mesh = body.data
    cell = 1e-6
    index_at = {}
    for v in mesh.vertices:
        index_at[(round(v.co.x / cell), round(v.co.y / cell), round(v.co.z / cell))] = v.index

    partner = {}
    for v in mesh.vertices:
        key = (round(-v.co.x / cell), round(v.co.y / cell), round(v.co.z / cell))
        if key not in index_at:
            raise SystemExit(f"vertex {v.index} at {v.co[:]} has no mirror partner; "
                             "the mesh must be symmetric before weights are symmetrised")
        partner[v.index] = index_at[key]

    group_name = {g.index: g.name for g in body.vertex_groups}
    weights = [{group_name[g.group]: g.weight for g in v.groups} for v in mesh.vertices]

    averaged = []
    for i, own in enumerate(weights):
        other = weights[partner[i]]
        names = set(own) | {mirror_bone_name(n) for n in other}
        merged = {}
        for name in names:
            value = 0.5 * (own.get(name, 0.0) + other.get(mirror_bone_name(name), 0.0))
            if value > 0.0:
                merged[name] = value
        averaged.append(merged)

    for group in list(body.vertex_groups):
        body.vertex_groups.remove(group)
    groups = {}
    for i, merged in enumerate(averaged):
        for name, value in merged.items():
            if name not in groups:
                groups[name] = body.vertex_groups.new(name=name)
            groups[name].add([i], value, 'REPLACE')


def aim(pose_bone, direction):
    """Points a pose bone along a world direction, keeping its head in place.

    It applies the MINIMAL-ARC rotation from where the bone currently points to
    where it should, rather than constructing a fresh basis. Both reach the same
    target, and the difference is the roll about the bone's own axis — which is
    exactly what has to be mirror-consistent.

    Building a basis from a fixed world reference is not. For the left arm,
    reference x target gives +Y as the side axis; for the right arm the target
    is negated, so the same cross product gives -Y. That is not the mirror of
    +Y, so the two arms end up rolled differently, the skin twists differently
    on each side, and the mesh loses the symmetry the bisect-and-mirror step
    established: measured at 287 of 3798 vertices, up to 9.8 mm.

    A minimal-arc rotation has no such freedom. Mirroring the input mirrors the
    rotation axis and preserves the angle, so mirrored inputs give mirrored
    results by construction, whatever the source pose happens to be.
    """
    matrix = pose_bone.matrix
    head = matrix.translation.copy()
    basis = matrix.to_3x3()
    current = (basis @ Vector((0, 1, 0))).normalized()
    target = direction.normalized()
    if current.dot(target) < -0.999:
        raise SystemExit(f"{pose_bone.name} needs a 180 degree flip; the axis "
                         "of that rotation is undefined and would not mirror")
    posed = (current.rotation_difference(target).to_matrix() @ basis).to_4x4()
    posed.translation = head
    pose_bone.matrix = posed
    bpy.context.view_layer.update()


def to_t_pose(body, armature):
    """Aims the arm chain along +/-X and bakes the result as the new rest pose."""
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')

    ordered = [name for name, *_ in bone_table()]
    for name in ordered:                       # parents precede children
        direction = target_direction(name)
        if direction is None:
            continue
        pose_bone = armature.pose.bones.get(name)
        if pose_bone:
            aim(pose_bone, direction)

    bpy.ops.object.mode_set(mode='OBJECT')

    # Bake the deformed shape into the mesh, then make the pose the rest pose.
    # Order matters: applying the modifier first captures the posed geometry.
    bpy.context.view_layer.objects.active = body
    for modifier in list(body.modifiers):
        if modifier.type == 'ARMATURE':
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    new_modifier = body.modifiers.new("Armature", 'ARMATURE')
    new_modifier.object = armature

    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply()
    bpy.ops.object.mode_set(mode='OBJECT')


def collect(body, armature, max_influences=4):
    """Per-vertex influences, pruned to four, normalised and sorted descending."""
    mesh = body.data
    group_names = {g.index: g.name for g in body.vertex_groups}
    bone_index = {name: i for i, (name, *_) in enumerate(bone_table())}

    influences = []
    for v in mesh.vertices:
        pairs = []
        for g in v.groups:
            name = group_names.get(g.group)
            if name in bone_index and g.weight > 1e-5:
                pairs.append((bone_index[name], float(g.weight)))
        pairs.sort(key=lambda p: (-p[1], p[0]))
        pairs = pairs[:max_influences]
        total = sum(w for _, w in pairs)
        if total <= 0:
            # Never leave a vertex unweighted: Unity's auto-mapper and our own
            # gate both treat that as a defect, and it renders as a frozen shard.
            pairs = [(bone_index["Hips"], 1.0)]
            total = 1.0
        influences.append([(b, w / total) for b, w in pairs])
    return influences


def write_template(path, body, armature, influences):
    """Versioned little-endian binary. Layout documented in TemplateFile.swift."""
    mesh = body.data
    mesh.calc_loop_triangles()
    uv_layer = mesh.uv_layers.active.data

    # Split any vertex whose UVs differ between loops, so one vertex carries one
    # UV. Positions and weights are copied to the duplicates, which keeps the
    # skin identical while making the buffers renderable as-is.
    vertex_uv = {}
    remap = {}
    positions, normals, uvs, out_influences = [], [], [], []
    for tri in mesh.loop_triangles:
        for loop_index, vertex_index in zip(tri.loops, tri.vertices):
            uv = uv_layer[loop_index].uv
            key = (vertex_index, round(uv.x, 6), round(uv.y, 6))
            if key not in remap:
                remap[key] = len(positions)
                v = mesh.vertices[vertex_index]
                positions.append(v.co.copy())
                normals.append(v.normal.copy())
                uvs.append((uv.x, uv.y))
                out_influences.append(influences[vertex_index])
            vertex_uv[key] = remap[key]

    indices = []
    for tri in mesh.loop_triangles:
        for loop_index, vertex_index in zip(tri.loops, tri.vertices):
            uv = uv_layer[loop_index].uv
            indices.append(remap[(vertex_index, round(uv.x, 6), round(uv.y, 6))])

    bones = bone_table()
    name_to_index = {name: i for i, (name, *_) in enumerate(bones)}

    with open(path, 'wb') as f:
        f.write(b'BIRBHUM1')
        f.write(struct.pack('<III', len(bones), len(positions), len(indices)))

        for name, parent, *_ in bones:
            raw = name.encode('utf-8')
            f.write(struct.pack('<H', len(raw)))
            f.write(raw)
            f.write(struct.pack('<i', name_to_index[parent] if parent else -1))
            head = armature.data.bones[name].head_local
            f.write(struct.pack('<3f', head.x, head.y, head.z))

        for p in positions:
            f.write(struct.pack('<3f', p.x, p.y, p.z))
        for n in normals:
            f.write(struct.pack('<3f', n.x, n.y, n.z))
        for u, v in uvs:
            f.write(struct.pack('<2f', u, v))
        for i in indices:
            f.write(struct.pack('<I', i))
        for inf in out_influences:
            f.write(struct.pack('<B', len(inf)))
            for bone, weight in inf:
                f.write(struct.pack('<Hf', bone, weight))

    return len(bones), len(positions), len(indices) // 3


def report(armature):
    """How far each bone sits from the direction Unity will measure."""
    print("T-POSE CHECK")
    worst = 0.0
    for name, parent, *_ in bone_table():
        target = target_direction(name)
        if target is None:
            continue
        bone = armature.data.bones[name]
        direction = (bone.tail_local - bone.head_local)
        if direction.length < 1e-9:
            continue
        angle = math.degrees(direction.angle(target))
        worst = max(worst, angle)
        if angle > 4.0:
            print(f"   {name:26s} {angle:6.2f} deg off target")
    print(f"   worst deviation: {worst:.2f} deg")


def preview(body, armature, prefix):
    """Renders the posed body. The numbers say the bones point the right way;
    only a picture says the BODY followed them."""
    for obj in list(bpy.data.objects):
        if obj.type == 'ARMATURE':
            obj.hide_render = True

    material = bpy.data.materials.new("clay")
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (0.76, 0.71, 0.67, 1)
    shader.inputs["Roughness"].default_value = 0.7
    body.data.materials.clear()
    body.data.materials.append(material)

    world = bpy.data.worlds.new("w")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.18, 0.21, 1)

    light = bpy.data.lights.new("key", 'SUN')
    light.energy = 3.2
    light.angle = math.radians(6.0)
    light_object = bpy.data.objects.new("key", light)
    bpy.context.collection.objects.link(light_object)
    light_object.rotation_euler = (math.radians(-55), math.radians(25), 0)

    # Without this the render grows a dense black stipple over the face, throat,
    # ribs and inner thigh, which reads exactly like coincident geometry and was
    # chased as one. It is shadow acne: interpolated normals face the sun while
    # the faceted surface occludes itself, so a low-poly body self-shadows along
    # every grazing-angle run. Turning the sun off made it vanish, which is what
    # identified it. The offset is Cycles' own fix for the shadow terminator.
    body.cycles.shadow_terminator_offset = 0.2

    coords = [v.co for v in body.data.vertices]
    lo = Vector((min(c.x for c in coords), min(c.y for c in coords), min(c.z for c in coords)))
    hi = Vector((max(c.x for c in coords), max(c.y for c in coords), max(c.z for c in coords)))
    centre = (lo + hi) / 2
    size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)

    camera_data = bpy.data.cameras.new("cam")
    camera = bpy.data.objects.new("cam", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera_data.lens = 50

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640

    vfov = 2 * math.atan(18.0 / camera_data.lens)
    distance = (size * 0.62) / math.tan(vfov / 2)
    for name, angle in (("front", 0.0), ("threequarter", math.radians(38)),
                        ("side", math.radians(90))):
        eye = centre + Vector((math.sin(angle) * distance, 0, math.cos(angle) * distance))
        # The basis is built by hand rather than with to_track_quat, whose roll
        # for a horizontal view put the figure on its side in two of these three
        # frames. A camera looks down its own -Z with +Y up, so naming the three
        # axes leaves nothing for a helper to choose differently.
        forward = (centre - eye).normalized()
        right = forward.cross(Vector((0, 1, 0))).normalized()
        up = right.cross(forward)
        camera.matrix_world = Matrix((
            (right.x, up.x, -forward.x, eye.x),
            (right.y, up.y, -forward.y, eye.y),
            (right.z, up.z, -forward.z, eye.z),
            (0, 0, 0, 1)))
        scene.render.filepath = f"{prefix}_{name}.png"
        bpy.ops.render.render(write_still=True)
    print("PREVIEW", prefix)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    source = argv[argv.index('--source') + 1]
    out = argv[argv.index('--out') + 1]
    iterations = int(argv[argv.index('--iterations') + 1]) if '--iterations' in argv else 2

    landmarks = read_landmarks(source)
    body = import_body(source)
    landmarks = normalise(body, landmarks)

    print(f"SOURCE polys={len(body.data.polygons)} verts={len(body.data.vertices)}")
    reduce_symmetric(body, iterations)
    print(f"REDUCED polys={len(body.data.polygons)} verts={len(body.data.vertices)}")

    armature = build_armature(landmarks)
    skin(body, armature)
    symmetrise_weights(body, armature)
    to_t_pose(body, armature)
    report(armature)

    influences = collect(body, armature)
    bones, vertices, triangles = write_template(out, body, armature, influences)
    print(f"TEMPLATE bones={bones} vertices={vertices} triangles={triangles} -> {out}")

    if '--preview' in argv:
        preview(body, armature, argv[argv.index('--preview') + 1])


main()
