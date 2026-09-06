#!/usr/bin/env python3
"""Bakes the Clay template: a rounded, subdivided cube.

    python3 tools/build_clay.py --out clay-v1.bin [--divisions 24] [--round 0.42]

No Blender. The humanoid template needs Blender because it starts from a scanned
body and needs a bone-heat solve; a cube needs neither, and generating it in
plain Python buys three things that matter more than sharing a tool:

- **Exact symmetry, by construction.** With an even division count the mirror
  plane falls on a vertex line, so every vertex has a partner at exactly -x.
  The humanoid template lost its symmetry twice to numerical drift before it
  was fixed; here the drift cannot happen.
- **A UV layout chosen rather than solved.** Six square islands in a 3x2 atlas.
  Blender's unwrappers would produce something reasonable and unpredictable; a
  person painting this needs to know where the faces are.
- **A predictable vertex order**, which is half of what makes topology
  immutable useful — the offline adjacency and symmetry tables the brushes will
  need are indexable straight off the generation order.

**Why a rounded cube and not a sphere.** The cube reads instantly as "the thing
you start from" to anyone who has opened Blender, and a box unwrap gives a
paintable UV set. A UV sphere's pole pinch is worse to sculpt and worse to paint.

**Why pre-subdivided.** Sculpting only ever moves existing vertices — no
remeshing, no subdivide, no vertex created or destroyed. So the resolution is
fixed here, at bake time. Too coarse and a Grab stroke reads as denting a beach
ball; too dense and the per-stroke rebuild misses frame on an iPad. 24 divisions
lands at 6,912 triangles, inside the same 6-8k band the brush code is tuned for.
"""
import argparse
import math
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import template_format as fmt


# The six faces, each as an origin corner plus two edge vectors.
#
# A quad is emitted as (a, b, d) and (a, d, c), so a triangle's normal is
# edge_u x edge_v. Each row below is therefore chosen so that cross product
# equals the face's OUTWARD normal. Four of the six were wrong on the first
# pass — 4,608 of 6,912 triangles facing inward, which renders as a cube you
# can see the inside of and nothing else obviously amiss. `assert_outward`
# below now fails the bake rather than leaving it to a render.
FACES = [
    ("+X", (1, -1, 1), (0, 0, -2), (0, 2, 0)),
    ("-X", (-1, -1, -1), (0, 0, 2), (0, 2, 0)),
    ("+Y", (-1, 1, 1), (2, 0, 0), (0, 0, -2)),
    ("-Y", (-1, -1, -1), (2, 0, 0), (0, 0, 2)),
    ("+Z", (-1, -1, 1), (2, 0, 0), (0, 2, 0)),
    ("-Z", (1, -1, -1), (-2, 0, 0), (0, 2, 0)),
]

# Where each face sits in the 3x2 atlas. Islands are inset so a brush footprint
# at the edge of one face cannot bleed into its neighbour in the texture.
ATLAS = {"+X": (0, 0), "-X": (1, 0), "+Y": (2, 0),
         "-Y": (0, 1), "+Z": (1, 1), "-Z": (2, 1)}
ATLAS_INSET = 0.004


def build(divisions, roundness, radius):
    """Positions are shared between faces; UVs are not.

    Every vertex on a cube edge belongs to two faces with different UV islands,
    so it is emitted once per face and the copies are recorded as seam partners.
    That is the same shape as the humanoid template, where UV splitting happens
    at export: one position, several UVs.
    """
    if divisions % 2:
        raise SystemExit("divisions must be even so the mirror plane lands on vertices")

    position_index = {}
    positions = []
    verts = []          # (position index, uv)
    face_of_vert = []

    def rounded(x, y, z):
        # Blend the cube point toward the sphere of the same extent. At 0 this is
        # a hard cube, at 1 a quad-sphere; the interesting shapes are in between.
        length = math.sqrt(x * x + y * y + z * z)
        sx, sy, sz = x / length, y / length, z / length
        bx = x + (sx - x) * roundness
        by = y + (sy - y) * roundness
        bz = z + (sz - z) * roundness
        return (bx * radius, by * radius, bz * radius)

    def key(p):
        # Quantised so the two faces meeting at an edge agree on the position
        # exactly, rather than to within float error.
        return tuple(round(c * 1e6) for c in p)

    for name, origin, edge_u, edge_v in FACES:
        col, row = ATLAS[name]
        for j in range(divisions + 1):
            for i in range(divisions + 1):
                fu, fv = i / divisions, j / divisions
                raw = tuple(origin[k] + edge_u[k] * fu + edge_v[k] * fv for k in range(3))
                p = rounded(*raw)
                k = key(p)
                if k not in position_index:
                    position_index[k] = len(positions)
                    positions.append(p)
                span = 1.0 / 3.0 - 2 * ATLAS_INSET
                u = col / 3.0 + ATLAS_INSET + fu * span
                v = row / 2.0 + ATLAS_INSET + fv * (0.5 - 2 * ATLAS_INSET)
                verts.append((position_index[k], (u, v)))
                face_of_vert.append(name)

    stride = (divisions + 1) * (divisions + 1)
    indices = []
    for face in range(6):
        base = face * stride
        for j in range(divisions):
            for i in range(divisions):
                a = base + j * (divisions + 1) + i
                b = a + 1
                c = a + (divisions + 1)
                d = c + 1
                indices += [a, b, d, a, d, c]

    return positions, verts, indices


def assert_outward(positions, verts, indices):
    """Every triangle's normal must point away from the centre.

    The shape is convex and centred on the origin, so "outward" is simply a
    positive dot product with the face centre — no ambiguity, and it costs one
    pass over the mesh at bake time to make an inverted winding impossible to
    ship.
    """
    inward = 0
    for t in range(0, len(indices), 3):
        pa = positions[verts[indices[t]][0]]
        pb = positions[verts[indices[t + 1]][0]]
        pc = positions[verts[indices[t + 2]][0]]
        u = [pb[k] - pa[k] for k in range(3)]
        v = [pc[k] - pa[k] for k in range(3)]
        n = (u[1] * v[2] - u[2] * v[1],
             u[2] * v[0] - u[0] * v[2],
             u[0] * v[1] - u[1] * v[0])
        centre = [(pa[k] + pb[k] + pc[k]) / 3 for k in range(3)]
        if sum(n[k] * centre[k] for k in range(3)) <= 0:
            inward += 1
    if inward:
        raise SystemExit(f"{inward} of {len(indices) // 3} triangles wind inward; "
                         "check the edge vectors in FACES")


def assert_symmetric(positions):
    """Mirror symmetry has to be exact, not close.

    With an even division count the mirror plane falls on a vertex line, so this
    is a property of the generator rather than a tolerance to tune. If it ever
    fails, the cause is a change to the division parity or the rounding, not
    float noise.
    """
    cell = 1e-6
    present = {tuple(round(c / cell) for c in p) for p in positions}
    missing = sum(1 for p in positions
                  if (round(-p[0] / cell), round(p[1] / cell), round(p[2] / cell)) not in present)
    if missing:
        raise SystemExit(f"{missing} of {len(positions)} vertices have no exact mirror partner")


def normals(positions, verts, indices):
    """Area-weighted vertex normals. The un-normalised cross product is already
    area-weighted, which is what stops a dense corner from out-voting a large
    flat face."""
    acc = [[0.0, 0.0, 0.0] for _ in verts]
    for t in range(0, len(indices), 3):
        ia, ib, ic = indices[t], indices[t + 1], indices[t + 2]
        pa = positions[verts[ia][0]]
        pb = positions[verts[ib][0]]
        pc = positions[verts[ic][0]]
        u = [pb[k] - pa[k] for k in range(3)]
        v = [pc[k] - pa[k] for k in range(3)]
        n = [u[1] * v[2] - u[2] * v[1],
             u[2] * v[0] - u[0] * v[2],
             u[0] * v[1] - u[1] * v[0]]
        for index in (ia, ib, ic):
            for k in range(3):
                acc[index][k] += n[k]
    out = []
    for n in acc:
        length = math.sqrt(sum(c * c for c in n)) or 1.0
        out.append(tuple(c / length for c in n))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--divisions', type=int, default=24)
    parser.add_argument('--round', dest='roundness', type=float, default=0.42)
    parser.add_argument('--radius', type=float, default=0.12,
                        help="half-extent in metres; 0.12 is a 24 cm lump, about "
                             "what fits in two hands")
    args = parser.parse_args()

    positions, verts, indices = build(args.divisions, args.roundness, args.radius)
    assert_outward(positions, verts, indices)
    assert_symmetric(positions)
    out_positions = [positions[v[0]] for v in verts]
    out_uvs = [v[1] for v in verts]
    out_normals = normals(positions, verts, indices)

    fmt.write(args.out, fmt.CLAY, out_positions, out_normals, out_uvs, indices)

    print(f"CLAY divisions={args.divisions} roundness={args.roundness} "
          f"radius={args.radius}")
    print(f"     unique positions={len(positions)} vertices={len(out_positions)} "
          f"triangles={len(indices) // 3} -> {args.out}")


if __name__ == '__main__':
    main()
