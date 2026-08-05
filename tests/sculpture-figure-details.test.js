import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCowlBacking, buildFigure, PLANTED_FOOT_PROFILE, STETHOSCOPE_PATHS,
} from '../sculpture/src/model/figure.js';
import { buildFoldedScreen, FIGURE_LAYOUT } from '../sculpture/src/model/sculpture.js';
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

    toNonIndexed() {
        if (!this.index) return this;
        const sourceIndex = this.index.array || this.index;
        const expanded = new BufferGeometry();
        for (const [name, attribute] of Object.entries(this.attributes)) {
            const values = new attribute.array.constructor(sourceIndex.length * attribute.itemSize);
            for (let i = 0; i < sourceIndex.length; i++) {
                const source = sourceIndex[i] * attribute.itemSize;
                const target = i * attribute.itemSize;
                for (let component = 0; component < attribute.itemSize; component++) {
                    values[target + component] = attribute.array[source + component];
                }
            }
            expanded.setAttribute(name, new BufferAttribute(values, attribute.itemSize));
        }
        return expanded;
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

function inspectTriangleSoup(geometry) {
    const positions = geometry.attributes.position;
    const edges = new Map();
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    const key = (index) => [
        positions.getX(index), positions.getY(index), positions.getZ(index),
    ].map((value) => value.toFixed(6)).join(',');

    for (let i = 0; i < positions.count; i++) {
        minX = Math.min(minX, positions.getX(i));
        maxX = Math.max(maxX, positions.getX(i));
        minY = Math.min(minY, positions.getY(i));
        maxY = Math.max(maxY, positions.getY(i));
        minZ = Math.min(minZ, positions.getZ(i));
        maxZ = Math.max(maxZ, positions.getZ(i));
    }
    for (let i = 0; i < positions.count; i += 3) {
        const triangle = [key(i), key(i + 1), key(i + 2)];
        for (const [a, b] of [
            [triangle[0], triangle[1]],
            [triangle[1], triangle[2]],
            [triangle[2], triangle[0]],
        ]) {
            const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
            edges.set(edge, (edges.get(edge) || 0) + 1);
        }
    }
    return {
        boundaryEdges: [...edges.values()].filter((count) => count === 1).length,
        boundarySamples: [...edges.entries()].filter(([, count]) => count === 1).slice(0, 6),
        nonmanifoldEdges: [...edges.values()].filter((count) => count > 2).length,
        bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    };
}

test('the six reliefs share a closed folded screen and full-height cast shells', () => {
    assert.ok(FIGURE_LAYOUT.every((figure) => figure.shell === true));
    const result = inspectTriangleSoup(buildFoldedScreen(THREE));
    assert.equal(result.boundaryEdges, 0, JSON.stringify(result.boundarySamples));
    assert.equal(result.nonmanifoldEdges, 0);
    assert.ok(result.bounds.minY < 0, 'connector closes below the paving');
    assert.ok(result.bounds.maxY >= 2.08 && result.bounds.maxY <= 2.11,
        'the shared ribbon closes shoulder-height daylight without a flat crown wall');
    assert.ok(result.bounds.maxX - result.bounds.minX > 2.5);
    assert.ok(result.bounds.maxZ - result.bounds.minZ > 0.5);
});


test('each collar arch has a closed recessed backing plate', () => {
    const result = inspectTriangleSoup(buildCowlBacking(THREE, {
        cowlTop: 2.42,
        openScale: 1,
        sweepLean: 0,
    }));
    assert.equal(result.boundaryEdges, 0, JSON.stringify(result.boundarySamples));
    assert.equal(result.nonmanifoldEdges, 0);
    assert.ok(result.bounds.maxY >= 2.41 && result.bounds.maxY <= 2.43);
    assert.ok(result.bounds.maxX - result.bounds.minX >= 0.59);
    assert.ok(result.bounds.maxZ - result.bounds.minZ >= 0.049);
});
test('each figure exposes one closed, connected and outward-wound planted foot', () => {
    const result = inspectGeometry(buildFoot(-1));
    assert.equal(result.components, 1);
    assert.equal(result.boundaryEdges, 0);
    assert.equal(result.nonmanifoldEdges, 0);
    assert.ok(result.signedVolume > 0);
    const totalLength = result.bounds.maxZ - result.bounds.minZ;
    const visibleRows = PLANTED_FOOT_PROFILE.filter((row) => row[0] >= 0);
    const visibleSpan = visibleRows.at(-1)[0] - visibleRows[0][0];
    const width = result.bounds.maxX - result.bounds.minX;
    const profileWidth = Math.max(...PLANTED_FOOT_PROFILE.map((row) => row[1])) * 2;
    assert.ok(totalLength > 0.54 && totalLength < 0.57, 'reference-measured root-to-toe length stays compact');
    assert.ok(visibleSpan > 0.44 && visibleSpan < 0.46, 'visible heel-to-point span matches the crop');
    assert.ok(profileWidth >= 0.175 && profileWidth <= 0.185,
        'instep and forefoot stay broad without becoming a paddle');
    assert.ok(width < 0.22, 'yawed world footprint stays compact');
    assert.ok(visibleSpan > profileWidth * 2.4, 'visible cast wedge must taper decisively heel-to-toe');
    assert.ok(result.bounds.maxY - result.bounds.minY > 0.33, 'foot root should bury high inside the hem');
});

test('production figures retain the fine foot field beside the closed body field', () => {
    const opts = { ...FIGURE_LAYOUT[0] };
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
    assert.ok(Math.abs(left.minX + right.maxX) < 0.005, 'opposed strides should mirror the foot placement');
    assert.ok(Math.abs(left.maxX + right.minX) < 0.005, 'opposed strides should mirror the foot placement');
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
    const endDelta = Math.abs(rightTop - leftTop);
    assert.ok(endDelta > 0.015 && endDelta < 0.045,
        `wrapped ends should differ subtly without inventing an exposed spherical head (delta ${endDelta.toFixed(3)}m)`);
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
    assert.equal(left.length, 5);
    assert.equal(right.length, 5);
    assert.equal(terminals.length, 2);
    assert.deepEqual(left[0].map(Math.abs), right[0].map(Math.abs));
    assert.ok(left[0][2] <= 0.06 && right[0][2] <= 0.06,
        'upper tube ends should disappear into the collar instead of floating above it');
    assert.ok(right[1][0] - left[1][0] <= 0.06,
        'visible upper runs should emerge together before separating across the chest');
    assert.ok(Math.abs(left.at(-1)[0]) < Math.abs(left[3][0])
        && Math.abs(right.at(-1)[0]) < Math.abs(right[3][0]),
        'both lower runs should return slightly inward into their fittings');
    assert.ok(left.at(-1)[1] < left[0][1], 'left tube should hang from the neck');
    assert.ok(right.at(-1)[1] < right[0][1], 'right tube should hang from the neck');
    assert.ok([...left.slice(2, -1), ...right.slice(2, -1)].every((point) => point[2] >= 0.125 && point[2] <= 0.145),
        'middle tubing centres should remain embedded in the chest surface');
    assert.ok([left.at(-1), right.at(-1)].every((point) => point[2] >= 0.145 && point[2] <= 0.155),
        'lower tube ends should settle back into their chest fittings');
    assert.ok(terminals[0][1] > 1.51 && terminals[0][1] < 1.54);
    assert.ok(terminals[1][1] > 1.54 && terminals[1][1] < 1.58);
    assert.ok(terminals[1][1] - terminals[0][1] > 0.015
        && terminals[1][1] - terminals[0][1] < 0.035,
        'the photographed chest pieces should retain their asymmetric hang');
    const terminalSpan = terminals[1][0] - terminals[0][0];
    assert.ok(terminalSpan > 0.16 && terminalSpan < 0.20,
        'terminal separation should match the compact reference hang');
    assert.ok(terminals.every((point) => point[2] >= 0.145 && point[2] <= 0.160),
        'terminal backs should be embedded in the chest relief, not floating in front');

    const doctor = FIGURE_LAYOUT.find((figure) => figure.stethoscope);
    const body = buildFigure(THREE, { ...doctor, only: ['body'] });
    const positions = body.attributes.position;
    const toBuiltSpace = ([x, y, z]) => {
        const t = Math.min(1, Math.max(0, (y - 0.18) / 1.17));
        const eased = t * t * (3 - 2 * t);
        return [
            (x + doctor.weightShift * eased) * doctor.scale,
            y * doctor.scale,
            (z + y * doctor.lean) * doctor.scale,
        ];
    };
    const contactPoints = [
        ...left.slice(2),
        ...right.slice(2),
        ...terminals,
    ];
    for (const point of contactPoints) {
        const [px, py, pz] = toBuiltSpace(point);
        let surfaceZ = -Infinity;
        let samples = 0;
        for (let i = 0; i < positions.count; i++) {
            if (Math.hypot(positions.getX(i) - px, positions.getY(i) - py) < 0.018) {
                surfaceZ = Math.max(surfaceZ, positions.getZ(i));
                samples++;
            }
        }
        assert.ok(samples > 10, 'contact probe must resolve the clinician torso');
        const centreGap = pz - surfaceZ;
        assert.ok(centreGap >= -0.012 && centreGap <= 0.012,
            'tube/fitting centre must intersect the cast chest surface at ' + JSON.stringify(point) + ': ' + centreGap);
    }
});

test('all six reliefs turn as complete bodies without impossible neck twists', () => {
    assert.equal(FIGURE_LAYOUT.length, 6);
    for (const figure of FIGURE_LAYOUT) {
        assert.ok(Math.abs(figure.headTurn) < 0.75,
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
