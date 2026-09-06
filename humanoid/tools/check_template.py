#!/usr/bin/env python3
"""Independent oracle for a BIRBHUM1 template.

Deliberately shares NO code with build_template.py. It re-derives everything
from the bytes on disk, so a bug in the writer cannot hide behind the same bug
in the reader.

It exists because build_template's own T-pose report is tautological: it
measures head->tail of the bones it has just aimed, which is the aiming, not the
result. Unity's AvatarAutoMapper and the Swift RigGate both measure the
direction from a bone's head to its CHILD's head, and that is a different
number the moment a chain is not perfectly straight. This checks that one.

    python3 tools/check_template.py template.bin
"""
import math
import os
import sys
from collections import defaultdict


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import template_format as fmt


# The direction each bone's head->child-head segment must point in a T-pose,
# in the template's Y-up space. Unity tolerates 5 deg on arms, 15-20 on legs
# (UnityCsReference AvatarSetupTool.sBonePoses); we hold everything to the
# tightest of those so there is headroom.
TARGETS = {
    "Hips": (0, 1, 0), "Spine": (0, 1, 0), "Chest": (0, 1, 0),
    "Neck": (0, 1, 0), "Head": (0, 1, 0),
    "LeftUpperArm": (1, 0, 0), "LeftLowerArm": (1, 0, 0), "LeftHand": (1, 0, 0),
    "RightUpperArm": (-1, 0, 0), "RightLowerArm": (-1, 0, 0), "RightHand": (-1, 0, 0),
    "LeftUpperLeg": (0, -1, 0), "LeftLowerLeg": (0, -1, 0),
    "RightUpperLeg": (0, -1, 0), "RightLowerLeg": (0, -1, 0),
}
TOLERANCE = {"arm": 5.0, "spine": 30.0, "leg": 15.0}


def band(name):
    if "Arm" in name or "Hand" in name:
        return "arm"
    if "Leg" in name:
        return "leg"
    return "spine"


def angle_between(a, b):
    la = math.sqrt(sum(c * c for c in a))
    lb = math.sqrt(sum(c * c for c in b))
    if la < 1e-9 or lb < 1e-9:
        return None
    dot = sum(x * y for x, y in zip(a, b)) / (la * lb)
    return math.degrees(math.acos(max(-1.0, min(1.0, dot))))


# Which child continues each chain. Unity's mapper measures a bone against the
# NEXT bone in its own chain, and "next" cannot be inferred from the hierarchy:
# the Chest branches to a neck and two shoulders, and a hand branches to five
# fingers. Picking the deepest subtree aims the chest at a shoulder (43 deg off,
# and correct anatomy) and the hand at a thumb. Naming it removes the guess.
CONTINUATION = {
    "Hips": "Spine", "Spine": "Chest", "Chest": "Neck", "Neck": "Head",
    "LeftUpperArm": "LeftLowerArm", "LeftLowerArm": "LeftHand",
    "LeftHand": "LeftMiddleProximal",
    "RightUpperArm": "RightLowerArm", "RightLowerArm": "RightHand",
    "RightHand": "RightMiddleProximal",
    "LeftUpperLeg": "LeftLowerLeg", "LeftLowerLeg": "LeftFoot",
    "RightUpperLeg": "RightLowerLeg", "RightLowerLeg": "RightFoot",
}


def check_pose(bones, problems, notes):
    by_name = {b["name"]: i for i, b in enumerate(bones)}

    worst = 0.0
    for name, target in TARGETS.items():
        index = by_name.get(name)
        if index is None:
            problems.append(f"missing bone {name}")
            continue
        child_name = CONTINUATION.get(name)
        if child_name is None:
            continue  # a leaf such as Head has no next bone to measure against
        child = by_name.get(child_name)
        if child is None:
            problems.append(f"missing bone {child_name} (continuation of {name})")
            continue
        if bones[child]["parent"] != index:
            problems.append(f"{child_name} is not a child of {name}")
            continue
        head = bones[index]["head"]
        tip = bones[child]["head"]
        direction = tuple(t - h for t, h in zip(tip, head))
        deviation = angle_between(direction, target)
        if deviation is None:
            problems.append(f"{name} and {child_name} are coincident")
            continue
        worst = max(worst, deviation)
        limit = TOLERANCE[band(name)]
        line = f"{name:18s} -> {child_name:18s} {deviation:6.2f} deg (limit {limit:.0f})"
        if deviation > limit:
            problems.append("T-pose: " + line)
        elif deviation > limit * 0.6:
            notes.append("close to limit: " + line)
    return worst


def check_mesh(positions, indices, influences, problems, notes, rigged=True):
    degenerate = 0
    seen = set()
    duplicate = 0
    for t in range(0, len(indices), 3):
        a, b, c = indices[t], indices[t + 1], indices[t + 2]
        if a == b or b == c or a == c:
            degenerate += 1
            continue
        pa, pb, pc = positions[a], positions[b], positions[c]
        u = tuple(pb[i] - pa[i] for i in range(3))
        v = tuple(pc[i] - pa[i] for i in range(3))
        cross = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        if math.sqrt(sum(x * x for x in cross)) < 1e-12:
            degenerate += 1
        key = tuple(sorted((a, b, c)))
        if key in seen:
            duplicate += 1
        seen.add(key)
    if degenerate:
        problems.append(f"{degenerate} degenerate triangles")
    if duplicate:
        problems.append(f"{duplicate} duplicate triangles (coincident surfaces)")

    # Coincident faces can also come from distinct indices at identical points,
    # which is what a mirror without a merge produces. Weld on position first.
    cell = 1e-5
    weld = {}
    welded = []
    for p in positions:
        key = (round(p[0] / cell), round(p[1] / cell), round(p[2] / cell))
        welded.append(weld.setdefault(key, len(weld)))
    seen_welded = set()
    overlapping = 0
    for t in range(0, len(indices), 3):
        tri = tuple(sorted(welded[i] for i in indices[t:t + 3]))
        if len(set(tri)) < 3:
            continue
        if tri in seen_welded:
            overlapping += 1
        seen_welded.add(tri)
    if overlapping:
        problems.append(f"{overlapping} overlapping triangles after welding at {cell} m")

    if not rigged:
        return set(), len(weld)

    used = set()
    for entry in influences:
        for bone, _ in entry:
            used.add(bone)
    unweighted = sum(1 for e in influences if not e)
    if unweighted:
        problems.append(f"{unweighted} unweighted vertices")
    bad_sum = sum(1 for e in influences if abs(sum(w for _, w in e) - 1.0) > 1e-4)
    if bad_sum:
        problems.append(f"{bad_sum} vertices whose weights do not sum to 1")
    too_many = sum(1 for e in influences if len(e) > 4)
    if too_many:
        problems.append(f"{too_many} vertices with more than 4 influences")
    unsorted = sum(1 for e in influences
                   if any(e[i][1] < e[i + 1][1] - 1e-6 for i in range(len(e) - 1)))
    if unsorted:
        problems.append(f"{unsorted} vertices whose influences are not sorted by weight")
    return used, len(weld)


def check_symmetry(positions, notes, problems):
    cell = 2e-4
    grid = defaultdict(list)
    for i, p in enumerate(positions):
        grid[(round(p[0] / cell), round(p[1] / cell), round(p[2] / cell))].append(i)
    worst = 0.0
    offenders = []
    for i, p in enumerate(positions):
        target = (-p[0], p[1], p[2])
        best = None
        base = tuple(round(t / cell) for t in target)
        # Widen the search until a partner is found, so an asymmetry is reported
        # as a distance rather than as an absence. "No partner" only ever means
        # "further away than I looked", which is not a useful thing to be told.
        span = 1
        while best is None and span <= 64:
            for dx in range(-span, span + 1):
                for dy in range(-span, span + 1):
                    for dz in range(-span, span + 1):
                        for j in grid.get((base[0] + dx, base[1] + dy, base[2] + dz), ()):
                            q = positions[j]
                            d = math.sqrt(sum((q[k] - target[k]) ** 2 for k in range(3)))
                            if best is None or d < best:
                                best = d
            span *= 4
        if best is None:
            offenders.append((float('inf'), i))
        else:
            worst = max(worst, best)
            if best > 1e-5:
                offenders.append((best, i))
    if offenders:
        offenders.sort(reverse=True)
        biggest, index = offenders[0]
        where = positions[index]
        problems.append(
            f"{len(offenders)} of {len(positions)} vertices are not mirror-symmetric; "
            f"worst {biggest * 1000:.2f} mm at "
            f"({where[0]:+.3f}, {where[1]:.3f}, {where[2]:+.3f})")
    else:
        notes.append(f"mirror symmetry exact to {worst * 1e6:.1f} um")


def main(path):
    t = fmt.read(path)
    bones, positions, normals = t["bones"], t["positions"], t["normals"]
    uvs, indices, influences = t["uvs"], t["indices"], t["influences"]
    rigged = t["kind"] == fmt.HUMANOID
    problems, notes = [], []

    if rigged:
        roots = [b["name"] for b in bones if b["parent"] < 0]
        if roots != ["Hips"]:
            problems.append(f"expected a single Hips root, found {roots}")
        for i, b in enumerate(bones):
            if b["parent"] >= i:
                problems.append(f"{b['name']} references a parent that is not earlier in the list")
    else:
        # An unrigged template is checked for the ABSENCE of a rig, not merely
        # skipped. A stray bone table would mean the baker wrote the wrong kind.
        if bones:
            problems.append(f"clay template carries {len(bones)} bones; it must carry none")
        if influences is not None:
            problems.append("clay template carries skin weights; it must carry none")

    worst = check_pose(bones, problems, notes) if rigged else 0.0
    used, welded = check_mesh(positions, indices, influences, problems, notes,
                              rigged=rigged)
    check_symmetry(positions, notes, problems)

    height = max(p[1] for p in positions) - min(p[1] for p in positions)
    span = max(p[0] for p in positions) - min(p[0] for p in positions)

    print(f"TEMPLATE {path}  [{t['kindName']}]")
    print(f"  bones {len(bones)}  vertices {len(positions)} ({welded} welded)  "
          f"triangles {len(indices) // 3}")
    line = f"  height {height:.3f} m  width {span:.3f} m"
    if rigged:
        line += f"  worst T-pose deviation {worst:.2f} deg"
    print(line)
    if rigged:
        unused = [b["name"] for i, b in enumerate(bones) if i not in used]
        if unused:
            print(f"  bones carrying no weight: {', '.join(unused)}")
    for note in notes:
        print("  note: " + note)
    for problem in problems:
        print("  FAIL: " + problem)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
