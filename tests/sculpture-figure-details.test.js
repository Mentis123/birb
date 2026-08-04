import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFigure, STETHOSCOPE_PATHS } from '../sculpture/src/model/figure.js';
import { FIGURE_LAYOUT } from '../sculpture/src/model/sculpture.js';
import { PHASE4_ACCEPTANCE_VIEWS } from '../tools/sculpture-views.mjs';

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
    const length = result.bounds.maxZ - result.bounds.minZ;
    const width = result.bounds.maxX - result.bounds.minX;
    assert.ok(length > 0.48, 'foot should read heel-to-toe beyond the hem');
    assert.ok(length < 0.68, 'foot should not extend into a long pointed slug');
    assert.ok(width > 0.15, 'forefoot should remain visibly broad');
    assert.ok(width < 0.20, 'foot should not read as a paddle');
    assert.ok(length > width * 2.2, 'foot should retain a planted heel-to-toe proportion');
    assert.ok(result.bounds.maxY - result.bounds.minY > 0.10, 'foot should include an instep');
});

test('production figures retain the fine foot field beside the closed body field', () => {
    const opts = {
        seed: 11,
        stride: -1,
        strideAngle: 0.10,
    };
    const body = buildFigure(THREE, { ...opts, only: ['body'] });
    const foot = buildFigure(THREE, { ...opts, only: ['feet'] });
    const assembled = buildFigure(THREE, { ...opts, only: ['body', 'feet'] });
    const result = inspectGeometry(assembled);

    assert.equal(assembled.index.count, body.index.count + foot.index.count);
    assert.equal(result.components, 2, 'body and fine foot remain independent closed surfaces');
    assert.equal(result.boundaryEdges, 0);
    assert.equal(result.nonmanifoldEdges, 0);
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

function buildBaby() {
    return buildFigure(THREE, {
        seed: 37,
        baby: true,
        only: ['baby'],
    });
}

test('the carried newborn is a closed fully wrapped block with restrained end asymmetry', () => {
    const result = inspectGeometry(buildBaby());
    const width = result.bounds.maxX - result.bounds.minX;
    const height = result.bounds.maxY - result.bounds.minY;
    const depth = result.bounds.maxZ - result.bounds.minZ;
    assert.equal(result.components, 1);
    assert.equal(result.boundaryEdges, 0);
    assert.equal(result.nonmanifoldEdges, 0);
    assert.ok(result.signedVolume > 0);
    assert.ok(width > 0.42, 'swaddle should span the full support gesture');
    assert.ok(width > height * 2.2, 'swaddle should remain broad rather than read as another belly');
    assert.ok(depth > 0.17, 'wrapped volume should stand proud of the body');
    assert.ok(result.bounds.minY > 1.25, 'newborn should be carried above the abdomen');
    const positions = buildBaby().attributes.position;
    let leftTop = -Infinity, rightTop = -Infinity;
    for (let i = 0; i < positions.count; i++) {
        if (positions.getX(i) < -0.10) leftTop = Math.max(leftTop, positions.getY(i));
        if (positions.getX(i) > 0.10) rightTop = Math.max(rightTop, positions.getY(i));
    }
    assert.ok(rightTop - leftTop > 0.015 && rightTop - leftTop < 0.045,
        'wrapped ends should be unequal without inventing an exposed spherical head');
});

test('the hospital badge is a separate fine closed relief at readable scale', () => {
    const result = inspectGeometry(buildFigure(THREE, {
        seed: 79,
        badge: true,
        only: ['badge'],
    }));
    const width = result.bounds.maxX - result.bounds.minX;
    const height = result.bounds.maxY - result.bounds.minY;
    const depth = result.bounds.maxZ - result.bounds.minZ;
    assert.equal(result.components, 1);
    assert.equal(result.boundaryEdges, 0);
    assert.equal(result.nonmanifoldEdges, 0);
    assert.ok(width > 0.11 && width < 0.125);
    assert.ok(height > 0.045 && height < 0.055);
    assert.ok(depth > 0.026 && depth < 0.032);
});
test('stethoscope control points form two raised reference-matched tubes', () => {
    const { left, right, terminals } = STETHOSCOPE_PATHS;
    assert.equal(left.length, 4);
    assert.equal(right.length, 4);
    assert.equal(terminals.length, 2);
    assert.deepEqual(left[0].map(Math.abs), right[0].map(Math.abs));
    assert.ok(left.at(-1)[1] < left[0][1], 'left tube should hang from the neck');
    assert.ok(right.at(-1)[1] < right[0][1], 'right tube should hang from the neck');
    assert.ok([...left.slice(2), ...right.slice(2)].every((point) => point[2] > 0.24),
        'lower tubing should stand proud of the torso');
    assert.ok(terminals.every((point) => point[1] < 1.56 && point[2] > 0.28),
        'small terminals should rest separately over the breasts');
});

test('all six reliefs turn as complete bodies without impossible neck twists', () => {
    assert.equal(FIGURE_LAYOUT.length, 6);
    for (const figure of FIGURE_LAYOUT) {
        assert.ok(Math.abs(figure.headTurn) < 0.35,
            `${figure.id} keeps an anatomical local head turn`);
        if (figure.side === 'outward') {
            assert.ok(Math.cos(figure.turn) > 0.90, `${figure.id} faces the outward side`);
        } else {
            assert.ok(Math.cos(figure.turn) < -0.90, `${figure.id} faces the hospital side`);
        }
    }
});

test('the Phase 4 visual gate retains every critical desktop and mobile view', () => {
    assert.equal(PHASE4_ACCEPTANCE_VIEWS.length, 9);
    const byId = new Map(PHASE4_ACCEPTANCE_VIEWS.map((view) => [view.id, view]));
    for (const id of [
        '03-whole-figure-turn',
        '04-infant-instrument',
        '05-ground-level-feet',
        '06-fused-foot-close',
        '07-opposite-rear',
        '08-mobile-full',
        '09-mobile-detail',
    ]) {
        assert.ok(byId.has(id), `missing critical acceptance view: ${id}`);
    }
    assert.deepEqual(byId.get('08-mobile-full').viewport, [390, 844]);
    assert.deepEqual(byId.get('09-mobile-detail').viewport, [390, 844]);
    assert.ok(PHASE4_ACCEPTANCE_VIEWS.every((view) => view.target.length === 3));
});
