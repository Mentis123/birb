/**
 * icon3d — the ribbon sweep kernel: Bishop frames, holonomy, closure, solids.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    frameCurve, roundedSection, sweepSection, seamError, edgeAudit, signedVolume6, lemniscate, rotateAbout,
} from '../icon3d/src/model/sweep.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
const circle = (n, R = 2) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return [R * Math.cos(a), 0, R * Math.sin(a)]; });

test('frames: orthonormal everywhere, planar loop has zero holonomy', () => {
    const { frames, holonomy } = frameCurve(circle(120));
    assert.equal(frames.length, 121);
    for (const f of frames) {
        near(Math.hypot(...f.tangent), 1); near(Math.hypot(...f.normal), 1); near(Math.hypot(...f.binormal), 1);
        near(f.tangent[0] * f.normal[0] + f.tangent[1] * f.normal[1] + f.tangent[2] * f.normal[2], 0, 1e-9);
    }
    near(holonomy, 0, 1e-9);
});

test('frames: a lifted figure-eight carries holonomy and the seed normal is honoured', () => {
    const pts = Array.from({ length: 220 }, (_, i) => lemniscate(1, 0.3, i / 220));
    const { frames, holonomy } = frameCurve(pts, { seed: [0, 0, 1] });
    assert.ok(Math.abs(holonomy) > 1e-3, `expected non-zero holonomy, got ${holonomy}`);
    assert.ok(Math.abs(holonomy) < Math.PI);
    // The seed is projected perpendicular to the first tangent, which has a z
    // component from the lift, so the normal keeps most of the seed's z.
    const f0 = frames[0];
    assert.ok(f0.normal[2] > 0.9, `seed honoured: ${f0.normal}`);
    near(f0.normal[0] * f0.tangent[0] + f0.normal[1] * f0.tangent[1] + f0.normal[2] * f0.tangent[2], 0, 1e-9);
    const flat = frameCurve(Array.from({ length: 220 }, (_, i) => lemniscate(1, 0, i / 220)), { seed: [0, 0, 1] });
    near(flat.holonomy, 0, 1e-9);
});

test('frames: open curves get one frame per point and no holonomy', () => {
    const { frames, holonomy } = frameCurve([[0, 0, 0], [1, 0, 0], [2, 0.5, 0], [3, 1.5, 0]], { closed: false });
    assert.equal(frames.length, 4);
    assert.equal(holonomy, 0);
    near(frames[0].tangent[0], 1);
});

test('rotateAbout: a quarter turn about z takes x to y', () => {
    const v = rotateAbout([1, 0, 0], [0, 0, 1], Math.PI / 2);
    near(v[0], 0, 1e-12); near(v[1], 1, 1e-12);
});

test('section: rounded rectangle has 4(k+1) points inside its box, front face up', () => {
    const sec = roundedSection(1, 0.2, 0.05, 3);
    assert.equal(sec.length, 16);
    for (const [x, y] of sec) { assert.ok(Math.abs(x) <= 1 + 1e-12); assert.ok(Math.abs(y) <= 0.1 + 1e-12); }
    // the first point is on the right edge at the start of the front-right corner
    near(sec[0][0], 1); near(sec[0][1], 0.05);
});

test('sweep: a closed loop of a closed section is a watertight solid with the torus volume', () => {
    const R = 2, hw = 0.3, t = 0.1, r = 0.03;
    const { frames } = frameCurve(circle(200, R));
    const mesh = sweepSection({ frames: frames.slice(0, 200), roll: () => 0, section: () => roundedSection(hw, t, r, 3), closed: true });
    assert.equal(mesh.vertexCount, 200 * 16);
    const audit = edgeAudit(mesh.indices);
    assert.equal(audit.boundary, 0);
    assert.equal(audit.nonManifold, 0);
    const area = 2 * hw * t - (4 - Math.PI) * r * r;
    const expected = 2 * Math.PI * R * area;
    const vol = signedVolume6(mesh.positions, mesh.indices) / 6;
    assert.ok(vol > 0, 'wound outward');
    near(vol, expected, expected * 0.03);
});

test('sweep: an open sweep has exactly two boundary rings', () => {
    const { frames } = frameCurve([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], { closed: false });
    const mesh = sweepSection({ frames, roll: () => 0, section: () => roundedSection(0.5, 0.1, 0.02, 2), closed: false });
    const audit = edgeAudit(mesh.indices);
    assert.equal(audit.boundary, 2 * 12);
    assert.equal(audit.nonManifold, 0);
});

test('sweep: holonomy-corrected roll closes the seam for even and odd half-twists', () => {
    const pts = Array.from({ length: 240 }, (_, i) => lemniscate(2, 0.5, i / 240));
    const { frames, holonomy } = frameCurve(pts);
    const m = 16;
    for (const half of [0, 1, 2, 3]) {
        const total = half * Math.PI - holonomy;
        const mesh = sweepSection({ frames, roll: (u) => u * total, section: () => roundedSection(0.4, 0.08, 0.02, 3), closed: false });
        const shift = half % 2 === 1 ? m / 2 : 0;
        const err = seamError(mesh, m, shift);
        assert.ok(err < 1e-6, `half-twists ${half}: seam error ${err}`);
        // and the uncorrected roll does NOT close (unless holonomy happens to be tiny)
        if (Math.abs(holonomy) > 1e-3) {
            const bad = sweepSection({ frames, roll: (u) => u * half * Math.PI, section: () => roundedSection(0.4, 0.08, 0.02, 3), closed: false });
            assert.ok(seamError(bad, m, shift) > 1e-3, 'ignoring holonomy should leave a gap');
        }
    }
});

test('sweep: aux attribute rides along with every vertex of a ring', () => {
    const { frames } = frameCurve([[0, 0, 0], [1, 0, 0], [2, 0, 0]], { closed: false });
    const mesh = sweepSection({ frames, roll: () => 0, section: () => roundedSection(0.5, 0.1, 0.02, 1), closed: false, aux: (u) => [u * 10, -u] });
    assert.equal(mesh.aux.length, mesh.vertexCount * 2);
    near(mesh.aux[0], 0); near(mesh.aux[mesh.aux.length - 2], 10); near(mesh.aux[mesh.aux.length - 1], -1);
});
