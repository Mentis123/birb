import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFigure } from '../sculpture/src/model/figure.js';
import { FIGURE_LAYOUT } from '../sculpture/src/model/sculpture.js';
import { sdTriPrism } from '../sculpture/src/model/sdf.js';
import { PHASE5_ACCEPTANCE_VIEWS } from '../tools/sculpture-views.mjs';
import { SCULPTURE_THREE as THREE } from './helpers/sculpture-three.js';

function bounds(geometry) {
    const p = geometry.attributes.position;
    const out = {
        minX: Infinity, maxX: -Infinity,
        minY: Infinity, maxY: -Infinity,
        minZ: Infinity, maxZ: -Infinity,
    };
    for (let i = 0; i < p.count; i++) {
        out.minX = Math.min(out.minX, p.getX(i));
        out.maxX = Math.max(out.maxX, p.getX(i));
        out.minY = Math.min(out.minY, p.getY(i));
        out.maxY = Math.max(out.maxY, p.getY(i));
        out.minZ = Math.min(out.minZ, p.getZ(i));
        out.maxZ = Math.max(out.maxZ, p.getZ(i));
    }
    return out;
}

function edgeCounts(geometry) {
    const edges = new Map();
    const idx = geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
        for (const [a, b] of [
            [idx[i], idx[i + 1]],
            [idx[i + 1], idx[i + 2]],
            [idx[i + 2], idx[i]],
        ]) {
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            edges.set(key, (edges.get(key) || 0) + 1);
        }
    }
    return {
        boundary: [...edges.values()].filter((count) => count === 1).length,
        nonmanifold: [...edges.values()].filter((count) => count > 2).length,
    };
}

test('C4 shifts the upper column over the support side while the planted hem stays fixed', () => {
    const common = { seed: 11, only: ['body'], stride: -1, strideAngle: 0.10 };
    const neutral = buildFigure(THREE, { ...common, weightShift: 0 });
    const weighted = buildFigure(THREE, { ...common, weightShift: -0.110 });
    const a = neutral.attributes.position;
    const b = weighted.attributes.position;
    assert.equal(a.count, b.count);

    let groundMax = 0;
    let upperDx = 0;
    let upperCount = 0;
    for (let i = 0; i < a.count; i++) {
        const dx = b.getX(i) - a.getX(i);
        assert.ok(Number.isFinite(dx));
        if (a.getY(i) <= 0.18) groundMax = Math.max(groundMax, Math.abs(dx));
        if (a.getY(i) >= 1.35) {
            upperDx += dx;
            upperCount++;
        }
    }
    assert.ok(groundMax < 1e-6, 'support foot and ground hem must not slide');
    assert.ok(upperCount > 100);
    assert.ok(upperDx / upperCount < -0.105, 'upper mass must settle toward the left support foot');
});

test('D2 keeps the turned figure behind at the front and dominant from group right', () => {
    const anchor = FIGURE_LAYOUT[0];
    const turned = FIGURE_LAYOUT.find((figure) => figure.pregnant);
    assert.ok(turned);
    assert.ok(turned.z < anchor.z, 'turned figure must stand behind the front anchor');

    const yaw = 62 * Math.PI / 180;
    const projectedDepth = (figure) => figure.x * Math.sin(yaw) + figure.z * Math.cos(yaw);
    const depths = FIGURE_LAYOUT.map(projectedDepth);
    const turnedDepth = projectedDepth(turned);
    assert.equal(turnedDepth, Math.max(...depths));
    assert.ok(turnedDepth - Math.max(...depths.filter((depth) => depth !== turnedDepth)) > 0.035,
        'right-side dominance needs a visible depth margin');

    const faceX = Math.sin(turned.turn), faceZ = Math.cos(turned.turn);
    const awayX = -Math.sin(yaw), awayZ = -Math.cos(yaw);
    assert.ok(faceX * awayX + faceZ * awayZ > 0.98,
        'the whole figure must present its broad back, not its narrow side, to the right camera');
});

test('B3 collar shell remains closed and terminates as a broad crown arch', () => {
    const shell = buildFigure(THREE, {
        only: ['shell'], seed: 23, cowlTop: 2.44, openScale: 0.94,
        folds: 8, foldDepth: 0.86, foldPhase: 1.7,
        sweepLean: 0.018, strideAngle: -0.14, hemRake: 0.038,
        trainAngle: 3.10, trainAmount: 0.44,
    });
    assert.deepEqual(edgeCounts(shell), { boundary: 0, nonmanifold: 0 });

    const p = shell.attributes.position;
    const maxY = bounds(shell).maxY;
    let minX = Infinity, maxX = -Infinity, count = 0;
    for (let i = 0; i < p.count; i++) {
        if (p.getY(i) < maxY - 0.025) continue;
        minX = Math.min(minX, p.getX(i));
        maxX = Math.max(maxX, p.getX(i));
        count++;
    }
    assert.ok(count > 40);
    assert.ok(maxX - minX > 0.36, 'crown must stay broad instead of collapsing to a point');
});

test('E3 uses a closed triangular carving tool with real depth', () => {
    const socket = (x, y, z) => sdTriPrism(
        x, y, z,
        -0.032, 0.013, 0.030, 0.009, 0.009, -0.020,
        0.029
    );
    assert.ok(socket(0.002, 0.001, 0) < 0, 'triangle centroid should be inside');
    assert.ok(socket(0.060, 0, 0) > 0, 'point beside the triangle should be outside');
    assert.ok(socket(0.002, 0.001, 0.040) > 0, 'point beyond the back wall should be outside');

    const head = buildFigure(THREE, {
        only: ['head'], hair: 'none', seed: 11, headTurn: 0, headTilt: 0,
    });
    const p = head.attributes.position;
    for (const side of [-1, 1]) {
        let minZ = Infinity, count = 0;
        for (let i = 0; i < p.count; i++) {
            if (Math.abs(p.getX(i) - side * 0.0694) < 0.050
                && p.getY(i) > 2.085 && p.getY(i) < 2.165
                && p.getZ(i) > 0.080 && p.getZ(i) < 0.130) {
                minZ = Math.min(minZ, p.getZ(i));
                count++;
            }
        }
        assert.ok(count > 300, `socket ${side} should survive surface nets`);
        assert.ok(0.12015 - minZ > 0.024, `socket ${side} should retain at least 24mm depth`);
    }
});

test('E5 hair cap extends past the skull at the temple and preserves the cut edge', () => {
    const common = { only: ['head'], seed: 37, headTurn: 0, headTilt: 0 };
    const bare = bounds(buildFigure(THREE, { ...common, hair: 'none' }));
    const cap = bounds(buildFigure(THREE, { ...common, hair: 'cap' }));
    assert.ok(cap.maxX - bare.maxX > 0.012);
    assert.ok(bare.minX - cap.minX > 0.012);
    assert.ok(bare.minZ - cap.minZ > 0.035, 'smooth cap must remain a substantial rear mass');
});

test('Phase 5 visual gate retains all diagnostic and delivery cameras', () => {
    assert.equal(PHASE5_ACCEPTANCE_VIEWS.length, 7);
    const byId = new Map(PHASE5_ACCEPTANCE_VIEWS.map((view) => [view.id, view]));
    for (const id of [
        'p5-01-weight-front', 'p5-02-arrangement-right', 'p5-03-connected-shadow',
        'p5-04-collar-under', 'p5-05-eye-sockets', 'p5-06-hair-temple',
        'p5-07-mobile-full',
    ]) assert.ok(byId.has(id), `missing Phase 5 view: ${id}`);
    assert.deepEqual(byId.get('p5-07-mobile-full').viewport, [390, 844]);
    assert.ok(byId.get('p5-05-eye-sockets').fov <= 16);
    assert.ok(byId.get('p5-05-eye-sockets').distance >= 2.05);
});
