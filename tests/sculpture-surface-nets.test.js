import test from 'node:test';
import assert from 'node:assert/strict';

import { sdEllipsoid, surfaceNets } from '../sculpture/src/model/sdf.js';

function meshReport(mesh) {
    const pos = mesh.positions;
    const idx = mesh.indices;
    const edges = new Map();
    let volume = 0;

    const edge = (a, b) => {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(key, (edges.get(key) || 0) + 1);
    };

    for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i], b = idx[i + 1], c = idx[i + 2];
        edge(a, b); edge(b, c); edge(c, a);
        const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
        const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
        const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
        volume += (
            ax * (by * cz - bz * cy)
            - ay * (bx * cz - bz * cx)
            + az * (bx * cy - by * cx)
        ) / 6;
    }

    const boundaryEdges = [...edges.values()].filter((count) => count === 1).length;
    const nonManifoldEdges = [...edges.values()].filter((count) => count > 2).length;
    return { volume, boundaryEdges, nonManifoldEdges };
}

test('surface nets produce a closed, outward-wound isosurface', () => {
    const mesh = surfaceNets(
        (x, y, z) => sdEllipsoid(x, y, z, 0.30, 0.24, 0.20),
        { min: [-0.36, -0.30, -0.26], max: [0.36, 0.30, 0.26], voxel: 0.025 }
    );
    const report = meshReport(mesh);

    assert.equal(report.boundaryEdges, 0);
    assert.equal(report.nonManifoldEdges, 0);
    assert.ok(report.volume > 0, `expected outward winding, got volume ${report.volume}`);
});
