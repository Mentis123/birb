/**
 * icon3d — the ribbon's 2D reasoning: how a band splits into edges, how a
 * strap's edges are recovered from an outline that is mostly clip, and how the
 * vector export projects and fits.
 *
 * These are the parts that decide whether the front view still reads as the
 * icon, and every one of them was wrong at least once during the build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePath } from '../icon3d/src/model/svg-path.js';
import { splitBand, splitFold, trimBetweenLines, reverseSplit, touchesLine, ribbonSection, polylineSampler } from '../icon3d/src/model/ribbon.js';
import { axonometricBasis, chainLoops, simplifyLoop, fitAffine, loopArea } from '../icon3d/src/model/export-svg.js';
import { ICONS } from '../icon3d/src/icons/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const path = (id) => parsePath(ICONS['copilot-2023'].pieces.find((p) => p.id === id).d)[0];

test('sampler: arc-length parameterisation is monotone and hits both ends', () => {
    const s = polylineSampler([[0, 0], [10, 0], [10, 10]]);
    near(s.length, 20);
    assert.deepEqual(s.at(0), [0, 0]);
    near(s.at(0.5)[0], 10); near(s.at(0.5)[1], 0);
    near(s.at(1)[0], 10); near(s.at(1)[1], 10);
    assert.deepEqual(s.at(-2), [0, 0]);
    assert.deepEqual(s.at(5), [10, 10]);
});

test('band: splits into two ends and two long edges running the same way', () => {
    const b = splitBand(path('band_blue'));
    near(b.lineA, 4); near(b.lineB, 32.8852, 1e-3);
    const [e1, e2] = b.edges;
    // Both edges start on line A and finish on line B.
    near(e1.at(0)[1], 4, 1e-3); near(e2.at(0)[1], 4, 1e-3);
    near(e1.at(1)[1], 32.8852, 1e-3); near(e2.at(1)[1], 32.8852, 1e-3);
    // The outer edge is the longer of the two — it takes the outside of the curl.
    assert.ok(e1.length > e2.length, `${e1.length} vs ${e2.length}`);
    // The widest ruling is the one the whole construction is scaled by.
    let widest = 0;
    for (let i = 0; i <= 200; i++) {
        const u = i / 200, a = e1.at(u), c = e2.at(u);
        widest = Math.max(widest, Math.hypot(a[0] - c[0], a[1] - c[1]));
    }
    assert.ok(widest > 17 && widest < 19, `ruling ${widest}`);
});

test('band: the two bands are 180° rotations of each other about (24, 24)', () => {
    const blue = splitBand(path('band_blue')), pink = splitBand(path('band_pink'));
    let worst = 0;
    for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        for (const k of [0, 1]) {
            const a = blue.edges[k].at(u), b = pink.edges[k].at(u);
            worst = Math.max(worst, Math.hypot((48 - a[0]) - b[0], (48 - a[1]) - b[1]));
        }
    }
    assert.ok(worst < 0.6, `C2 symmetry off by ${worst}`);
});

test('band: reverseSplit swaps the ends and runs the edges backwards', () => {
    const b = splitBand(path('band_pink'));
    const r = reverseSplit(b);
    near(r.lineA, b.lineB); near(r.lineB, b.lineA);
    assert.deepEqual(r.edges[0].at(0), b.edges[0].at(1));
    assert.deepEqual(r.edges[1].at(1), b.edges[1].at(0));
});

test('fold: both long edges are recovered and span the two transition lines', () => {
    for (const [id, yA, yB] of [['fold_red', 32.8852, 44], ['fold_blue', 15.1098, 4]]) {
        const f = splitFold(path(id), yA, yB, 0.08);
        assert.equal(f.edges.length, 2, id);
        for (const e of f.edges) {
            near(e.at(0)[1], yA, 0.12);
            near(e.at(1)[1], yB, 0.12);
            assert.ok(e.length > 8, `${id} edge too short: ${e.length}`);
            // and no point strays outside the two lines: that is the tuck,
            // and leaving it in is what made the strap project as a bow-tie.
            const lo = Math.min(yA, yB) - 0.2, hi = Math.max(yA, yB) + 0.2;
            for (let i = 0; i <= 40; i++) {
                const y = e.at(i / 40)[1];
                assert.ok(y >= lo && y <= hi, `${id} strays to y=${y}`);
            }
        }
    }
});

test('fold: touchesLine tells the loop which end of the next band it meets', () => {
    assert.ok(touchesLine(path('fold_red'), 44, 0.08));
    assert.ok(touchesLine(path('fold_red'), 32.8852, 0.08));
    assert.ok(!touchesLine(path('fold_red'), 15.1098, 0.08));
    assert.ok(touchesLine(path('fold_blue'), 4, 0.08));
    assert.ok(!touchesLine(path('fold_blue'), 44, 0.08));
});

test('trim: an excursion past the start line is cut at the crossing', () => {
    // out along the line, back up past it (the tuck), then down to line B
    const p = [[0, 10], [1, 6], [2, 4], [4, 14], [6, 20]];
    const out = trimBetweenLines(p, 10, 20, 0.08);
    near(out[0][1], 10);
    near(out[out.length - 1][1], 20);
    for (const [, y] of out) assert.ok(y >= 10 - 1e-9 && y <= 20 + 1e-9, `stray ${y}`);
    // an already-clean edge is returned unchanged in shape
    const clean = trimBetweenLines([[0, 10], [1, 15], [2, 20]], 10, 20, 0.08);
    assert.equal(clean.length, 3);
});

test('section: the lens is closed, inside its box, and symmetric front to back', () => {
    const s = ribbonSection(10, 1, 0.25, 0.2, 6, 3);
    assert.ok(s.length > 20);
    for (const [x, y] of s) {
        assert.ok(x >= -1e-9 && x <= 10 + 1e-9, `x ${x}`);
        assert.ok(y <= 0.2 + 1e-9 && y >= -1.2 - 1e-9, `y ${y}`);
    }
    // anticlockwise, so the loft's outward normals face out
    let a = 0;
    for (let i = 0; i < s.length; i++) { const p = s[i], q = s[(i + 1) % s.length]; a += p[0] * q[1] - q[0] * p[1]; }
    assert.ok(a > 0, `section winding ${a}`);
});

test('export: the axonometric basis is right-handed and up is up', () => {
    const f = axonometricBasis(0, 0);
    // Compared componentwise rather than with deepEqual: Math.sin(0) is -0 in
    // one of these and strict deep-equality separates -0 from 0.
    const same = (v, w) => v.forEach((n, i) => near(n, w[i], 1e-12));
    same(f.right, [1, 0, 0]);
    same(f.up, [0, 1, 0]);
    same(f.view, [0, 0, 1]);
    const iso = axonometricBasis(30, 15);
    assert.ok(iso.up[1] > 0.9, `up points up: ${iso.up}`);
    near(iso.right[0] * iso.up[0] + iso.right[1] * iso.up[1] + iso.right[2] * iso.up[2], 0, 1e-9);
});

test('export: boundary edges chain into loops, and slivers can be measured away', () => {
    const loops = chainLoops([[0, 1], [1, 2], [2, 3], [3, 0]]);
    assert.equal(loops.length, 1);
    assert.equal(loops[0].length, 4);
    near(loopArea([[0, 0], [4, 0], [4, 3], [0, 3]]), 12);
    near(loopArea([[0, 0], [0.01, 0], [0.01, 0.01]]), 0.00005, 1e-9);
});

test('export: simplify keeps the corners of a polygon and drops collinear runs', () => {
    const dense = [];
    for (let i = 0; i <= 20; i++) dense.push([i, 0]);
    for (let i = 1; i <= 20; i++) dense.push([20, i]);
    const out = simplifyLoop(dense, 0.01);
    assert.ok(out.length <= 4, `simplified to ${out.length}`);
    assert.deepEqual(out[0], [0, 0]);
    assert.deepEqual(out[out.length - 1], [20, 20]);
});

test('export: the affine fit recovers a known transform exactly', () => {
    const m = [1.7, 0.4, -0.6, 1.2, 12, -5];
    const src = [[0, 0], [10, 0], [0, 10], [7, 3], [-4, 6]];
    const dst = src.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const fit = fitAffine(src, dst);
    fit.forEach((v, i) => near(v, m[i], 1e-6));
    assert.equal(fitAffine([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 1], [2, 2]]), null, 'degenerate fits are refused');
});
