/**
 * icon3d — the lift kernel: planar refinement, rims, watertight thickening.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subdividePlanar, boundaryLoops, thickenSheet, gridSheet } from '../icon3d/src/model/lift.js';
import { edgeAudit, signedVolume6 } from '../icon3d/src/model/sweep.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

function longestEdge(vertices, triangles) {
    let worst = 0;
    for (const t of triangles) for (let e = 0; e < 3; e++) {
        const a = vertices[t[e]], b = vertices[t[(e + 1) % 3]];
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    return worst;
}
function area2(vertices, triangles) {
    let s = 0;
    for (const [a, b, c] of triangles) {
        const A = vertices[a], B = vertices[b], C = vertices[c];
        s += ((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
    }
    return s;
}

test('subdivide: a square splits until no edge exceeds the limit, area is preserved, mesh stays manifold', () => {
    const verts = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const tris = [[0, 1, 2], [0, 2, 3]];
    const out = subdividePlanar(verts, tris, 1.6);
    assert.ok(longestEdge(out.vertices, out.triangles) <= 1.6 + 1e-9);
    near(area2(out.vertices, out.triangles), 100, 1e-9);
    const audit = edgeAudit(new Uint32Array(out.triangles.flat()));
    assert.equal(audit.nonManifold, 0);
    const loops = boundaryLoops(out.triangles);
    assert.equal(loops.length, 1);
    // the rim still lies on the square's edges
    for (const i of loops[0]) {
        const [x, y] = out.vertices[i];
        assert.ok(Math.abs(x) < 1e-9 || Math.abs(x - 10) < 1e-9 || Math.abs(y) < 1e-9 || Math.abs(y - 10) < 1e-9);
    }
    assert.ok(out.triangles.length > 60);
});

test('subdivide: a sliver triangle is split without inverting', () => {
    const verts = [[0, 0], [20, 0], [10, 0.2]];
    const out = subdividePlanar(verts, [[0, 1, 2]], 3);
    assert.ok(longestEdge(out.vertices, out.triangles) <= 3 + 1e-9);
    for (const [a, b, c] of out.triangles) {
        const A = out.vertices[a], B = out.vertices[b], C = out.vertices[c];
        const s = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
        assert.ok(s > 0, 'orientation preserved');
    }
});

test('thicken: a curved grid sheet becomes a closed outward solid of the right volume', () => {
    const w = 4, h = 2, t = 0.1;
    const sheet = gridSheet(20, 10, (u, v) => [u * w, v * h, 0.3 * Math.sin(u * Math.PI)]);
    const solid = thickenSheet(sheet.positions, sheet.triangles, t);
    const audit = edgeAudit(solid.indices);
    assert.equal(audit.boundary, 0);
    assert.equal(audit.nonManifold, 0);
    const vol = signedVolume6(solid.positions, solid.indices) / 6;
    // area of the bent sheet × thickness, area slightly over w·h because of the bend
    assert.ok(vol > w * h * t && vol < w * h * t * 1.1, `volume ${vol}`);
});

test('thicken: an annulus (two rims) is closed too', () => {
    // ring made of quads between an inner and outer circle
    const n = 40, verts = [], tris = [];
    for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        verts.push([2 * Math.cos(a), 2 * Math.sin(a), 0], [3 * Math.cos(a), 3 * Math.sin(a), 0]);
    }
    for (let i = 0; i < n; i++) {
        const i0 = 2 * i, o0 = 2 * i + 1, i1 = 2 * ((i + 1) % n), o1 = 2 * ((i + 1) % n) + 1;
        tris.push([i0, o0, i1], [i1, o0, o1]);
    }
    const loops = boundaryLoops(tris);
    assert.equal(loops.length, 2);
    const solid = thickenSheet(verts.flat(), tris, 0.2);
    const audit = edgeAudit(solid.indices);
    assert.equal(audit.boundary, 0);
    assert.equal(audit.nonManifold, 0);
    assert.ok(signedVolume6(solid.positions, solid.indices) > 0);
});
