import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFigure } from '../sculpture/src/model/figure.js';

class BufferAttribute {
    constructor(array, itemSize) {
        this.array = array;
        this.itemSize = itemSize;
        this.count = array.length / itemSize;
    }

    getX(i) { return this.array[i * this.itemSize]; }
    getY(i) { return this.array[i * this.itemSize + 1]; }
    getZ(i) { return this.array[i * this.itemSize + 2]; }
    setX(i, value) { this.array[i * this.itemSize] = value; }
    setY(i, value) { this.array[i * this.itemSize + 1] = value; }
    setZ(i, value) { this.array[i * this.itemSize + 2] = value; }
}

class BufferGeometry {
    constructor() {
        this.attributes = {};
        this.index = null;
    }

    setAttribute(name, attribute) {
        this.attributes[name] = attribute;
        return this;
    }

    setIndex(attribute) {
        this.index = attribute;
        return this;
    }

    scale(x, y, z) {
        const p = this.attributes.position;
        for (let i = 0; i < p.count; i++) {
            p.setX(i, p.getX(i) * x);
            p.setY(i, p.getY(i) * y);
            p.setZ(i, p.getZ(i) * z);
        }
        return this;
    }

    computeVertexNormals() {}
    dispose() {}
}

const THREE = {
    BufferGeometry,
    Float32BufferAttribute: BufferAttribute,
    Uint32BufferAttribute: BufferAttribute,
};

function inspectGeometry(geometry) {
    const p = geometry.attributes.position;
    const idx = geometry.index.array;
    const parent = new Int32Array(p.count);
    const edges = new Map();
    let volume6 = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (start) => {
        let node = start;
        while (parent[node] !== node) {
            parent[node] = parent[parent[node]];
            node = parent[node];
        }
        return node;
    };
    const union = (a, b) => {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent[rb] = ra;
    };

    for (let i = 0; i < p.count; i++) {
        minX = Math.min(minX, p.getX(i)); maxX = Math.max(maxX, p.getX(i));
        minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i));
        minZ = Math.min(minZ, p.getZ(i)); maxZ = Math.max(maxZ, p.getZ(i));
    }

    for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i], b = idx[i + 1], c = idx[i + 2];
        union(a, b); union(b, c); union(c, a);
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const key = u < v ? `${u}:${v}` : `${v}:${u}`;
            edges.set(key, (edges.get(key) || 0) + 1);
        }
        const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
        const bx = p.getX(b), by = p.getY(b), bz = p.getZ(b);
        const cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
        volume6 += ax * (by * cz - bz * cy)
            + ay * (bz * cx - bx * cz)
            + az * (bx * cy - by * cx);
    }

    const roots = new Set();
    for (let i = 0; i < parent.length; i++) roots.add(find(i));
    return {
        components: roots.size,
        boundaryEdges: [...edges.values()].filter((count) => count === 1).length,
        nonmanifoldEdges: [...edges.values()].filter((count) => count > 2).length,
        signedVolume: volume6 / 6,
        bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    };
}

function buildFoot(stride) {
    return buildFigure(THREE, {
        seed: 11,
        only: ['feet'],
        stride,
        strideAngle: 0.10,
    });
}

test('each figure exposes one closed, connected and outward-wound planted foot', () => {
    const result = inspectGeometry(buildFoot(-1));
    assert.equal(result.components, 1);
    assert.equal(result.boundaryEdges, 0);
    assert.equal(result.nonmanifoldEdges, 0);
    assert.ok(result.signedVolume > 0);
    assert.ok(result.bounds.maxZ - result.bounds.minZ > 0.30, 'foot should read heel-to-toe');
    assert.ok(result.bounds.maxY - result.bounds.minY > 0.10, 'foot should include an instep');
});

test('stride selects one leading side instead of exposing a detached pair', () => {
    const left = inspectGeometry(buildFoot(-1)).bounds;
    const right = inspectGeometry(buildFoot(1)).bounds;
    assert.ok(left.maxX < 0, 'left stride should expose only the left foot');
    assert.ok(right.minX > 0, 'right stride should expose only the right foot');
    const leftWidth = left.maxX - left.minX;
    const rightWidth = right.maxX - right.minX;
    assert.ok(Math.abs(leftWidth - rightWidth) < 0.005, 'stride should preserve foot width');
});