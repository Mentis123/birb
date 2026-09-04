# body-v1.bin

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
