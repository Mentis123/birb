# Shipped templates

Two frozen templates, one container format (`BIRBTMP2`, documented in
`tools/template_format.py` and `Sources/HumanoidCore/TemplateFile.swift`). The
rig is an optional *section*: `clay-v1.bin` carries no bone table and no skin
block at all, rather than an empty one.

Check either with `python3 tools/check_template.py <file>` — an oracle that
shares no code with the bakers and re-derives everything from the written bytes.

## clay-v1.bin

A rounded, subdivided cube. 6,912 triangles, 3,750 vertices, no rig.
Generated with no external source material and no Blender:

    python3 tools/build_clay.py --out clay-v1.bin

The bake is byte-reproducible, and CI checks that the committed file still
matches what the generator produces.

Generated rather than modelled because it buys three things: exact mirror
symmetry by construction (an even division count puts the mirror plane on a
vertex line), a UV layout that is chosen rather than solved (six square islands
in a 3x2 atlas, inset so a brush at the edge of one face cannot bleed into its
neighbour), and a predictable vertex order for the offline adjacency tables the
brushes will need.

Two invariants are asserted at bake time rather than left to a render: every
triangle winds outward, and every vertex has an exact mirror partner. The first
caught four of the six faces wound inward on the first pass — 4,608 of 6,912
triangles — which renders as a cube you can see the inside of and nothing else
obviously wrong.

## body-v1.bin

Baked by `tools/build_template.py` from MakeHuman's `base.obj` (the hm08 base
mesh), which its authors release under **CC0 1.0** — public domain dedication,
no attribution required. It is recorded here because knowing the provenance of
a shipped asset matters more than the licence obliging it.

The pipeline that produced this file:

1. Import `base.obj`, keep the `body` group only. The file also carries helper
   volumes (tights, skirt, hair, eyes, teeth, tongue) and 125 anatomical
   landmark cubes; the landmarks are read for joint positions and the helpers
   are discarded.
2. Decimetres to metres, feet to `y = 0`, centred on X.
3. Bisect at `x = 0`, un-subdivide twice, triangulate, drop faces lying in the
   mirror plane, mirror. Symmetry then holds by construction rather than by
   tolerance.
4. Build the 51-bone Unity-named rig from the landmarks; bone-heat skinning.
5. Symmetrise the weights against each vertex's mirror partner.
6. Aim the arm chain along +/-X and bake the result as the new rest pose.
7. Prune to four influences per vertex, normalised and sorted descending.

Reproduce and check with:

    blender --factory-startup --background --python tools/build_template.py -- \
        --source path/to/base.obj --out template.bin --preview /tmp/tmpl
    python3 tools/check_template.py template.bin
