"""The `BIRBTMP2` template container, shared by every baker and oracle.

One format for both document kinds. The rig is an optional *section*, not a
zero-bone section: a Clay template carries no bone table and no skin block at
all, so code that reads a rig cannot accidentally read an empty one and carry
on. That is the same reasoning that makes `rig` optional in the Swift document
model, applied to the bytes.

    magic      8 bytes  "BIRBTMP2"
    kind       u8       0 = clay, 1 = humanoid
    reserved   3 bytes  zero
    header     3 x u32  boneCount, vertexCount, indexCount
    bones      boneCount x { u16 nameLength, utf8 name,
                             i32 parentIndex (-1 for the root),
                             3 x f32 head position }
    positions  vertexCount x 3 x f32
    normals    vertexCount x 3 x f32
    uvs        vertexCount x 2 x f32
    indices    indexCount x u32
    skin       ONLY when boneCount > 0:
               vertexCount x { u8 count, count x { u16 bone, f32 weight } }

Little-endian throughout, so a load is bounds-checked reads with no parsing.

Version 1 was `BIRBHUM1` and had no kind byte, because at the time there was
only one kind. It is not read anywhere any more; both templates are baked as v2.
"""
import struct

MAGIC = b'BIRBTMP2'
CLAY = 0
HUMANOID = 1
KIND_NAMES = {CLAY: "clay", HUMANOID: "humanoid"}


def write(path, kind, positions, normals, uvs, indices, bones=None, influences=None):
    """Writes a template. `bones` and `influences` are given together or not at all."""
    if (bones is None) != (influences is None):
        raise SystemExit("a rigged template needs both a bone table and skin weights")
    if kind == HUMANOID and bones is None:
        raise SystemExit("a humanoid template must carry a rig")
    if kind == CLAY and bones is not None:
        raise SystemExit("a clay template must not carry a rig")

    count = len(positions)
    if not (len(normals) == len(uvs) == count):
        raise SystemExit("positions, normals and uvs must be the same length")
    if influences is not None and len(influences) != count:
        raise SystemExit("one influence set per vertex")
    if len(indices) % 3:
        raise SystemExit("indices must be a whole number of triangles")

    bones = bones or []
    with open(path, 'wb') as f:
        f.write(MAGIC)
        f.write(struct.pack('<B3x', kind))
        f.write(struct.pack('<III', len(bones), count, len(indices)))

        for name, parent, head in bones:
            raw = name.encode('utf-8')
            f.write(struct.pack('<H', len(raw)))
            f.write(raw)
            f.write(struct.pack('<i', parent))
            f.write(struct.pack('<3f', *head))

        for p in positions:
            f.write(struct.pack('<3f', *p))
        for n in normals:
            f.write(struct.pack('<3f', *n))
        for uv in uvs:
            f.write(struct.pack('<2f', *uv))
        for i in indices:
            f.write(struct.pack('<I', i))

        if influences is not None:
            for entry in influences:
                f.write(struct.pack('<B', len(entry)))
                for bone, weight in entry:
                    f.write(struct.pack('<Hf', bone, weight))


def read(path):
    """Returns a dict. Deliberately strict: trailing bytes are a layout mismatch,
    not something to shrug at, because they mean the writer and reader disagree
    and every field after the disagreement is suspect."""
    data = open(path, 'rb').read()
    if data[:8] != MAGIC:
        raise SystemExit(f"{path}: bad magic {data[:8]!r} (expected {MAGIC!r})")
    off = 8
    (kind,) = struct.unpack_from('<B3x', data, off)
    off += 4
    if kind not in KIND_NAMES:
        raise SystemExit(f"{path}: unknown template kind {kind}")
    bone_count, vertex_count, index_count = struct.unpack_from('<III', data, off)
    off += 12

    bones = []
    for _ in range(bone_count):
        (name_len,) = struct.unpack_from('<H', data, off)
        off += 2
        name = data[off:off + name_len].decode('utf-8')
        off += name_len
        (parent,) = struct.unpack_from('<i', data, off)
        off += 4
        head = struct.unpack_from('<3f', data, off)
        off += 12
        bones.append({"name": name, "parent": parent, "head": head})

    positions = [struct.unpack_from('<3f', data, off + i * 12) for i in range(vertex_count)]
    off += vertex_count * 12
    normals = [struct.unpack_from('<3f', data, off + i * 12) for i in range(vertex_count)]
    off += vertex_count * 12
    uvs = [struct.unpack_from('<2f', data, off + i * 8) for i in range(vertex_count)]
    off += vertex_count * 8
    indices = list(struct.unpack_from(f'<{index_count}I', data, off))
    off += index_count * 4

    influences = None
    if bone_count:
        influences = []
        for _ in range(vertex_count):
            (n,) = struct.unpack_from('<B', data, off)
            off += 1
            entry = []
            for _ in range(n):
                bone, weight = struct.unpack_from('<Hf', data, off)
                off += 6
                entry.append((bone, weight))
            influences.append(entry)

    if off != len(data):
        raise SystemExit(f"{path}: {len(data) - off} trailing bytes — layout mismatch")

    return {"kind": kind, "kindName": KIND_NAMES[kind], "bones": bones,
            "positions": positions, "normals": normals, "uvs": uvs,
            "indices": indices, "influences": influences}
