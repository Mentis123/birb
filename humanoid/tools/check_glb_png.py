#!/usr/bin/env python3
"""Extracts every embedded PNG from a GLB and decodes it for real.

The Khronos validator parses image headers only and never inflates the pixel
data, so a PNG whose IDAT is raw RFC 1951 deflate (which is what Foundation's
`.zlib` compression produces) passes validation and opens in no decoder. This
closes that gap.
"""
import json
import struct
import sys
import zlib


def check(path):
    data = open(path, 'rb').read()
    if data[0:4] != b'glTF':
        return f"{path}: not a GLB"
    json_len = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + json_len].decode('utf-8'))
    bin_offset = 20 + json_len + 8

    images = gltf.get('images', [])
    if not images:
        return f"{path}: no embedded images"

    for index, image in enumerate(images):
        if 'bufferView' not in image:
            return f"{path}: image {index} is not embedded in the buffer"
        view = gltf['bufferViews'][image['bufferView']]
        start = bin_offset + view['byteOffset']
        png = data[start:start + view['byteLength']]

        if png[:8] != b'\x89PNG\r\n\x1a\x0a':
            return f"{path}: image {index} is not a PNG"

        idat = b''
        width = height = depth = colour = None
        offset = 8
        while offset < len(png):
            length = struct.unpack_from('>I', png, offset)[0]
            kind = png[offset + 4:offset + 8]
            if kind == b'IHDR':
                width, height, depth, colour = struct.unpack_from('>IIBB', png, offset + 8)
            elif kind == b'IDAT':
                idat += png[offset + 8:offset + 8 + length]
            offset += 12 + length

        if not idat:
            return f"{path}: image {index} has no IDAT"
        if idat[0] != 0x78:
            return f"{path}: image {index} IDAT is not an RFC 1950 zlib stream"
        try:
            raw = zlib.decompress(idat)
        except zlib.error as exc:
            return f"{path}: image {index} IDAT failed to inflate — {exc}"

        channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(colour)
        if channels is None:
            return f"{path}: image {index} unexpected colour type {colour}"
        expected = height * (1 + width * channels * (depth // 8))
        if len(raw) != expected:
            return (f"{path}: image {index} inflated to {len(raw)} bytes, "
                    f"expected {expected} for {width}x{height} type {colour}")
    return None


def main(paths):
    problems = [p for p in (check(path) for path in paths) if p]
    for problem in problems:
        print("  " + problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
