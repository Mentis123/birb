/**
 * icon3d — the extruded-plate builder, run against the REAL Three build.
 *
 * The tracked node_modules/three is a hand-written stub for the game's own
 * tests and has no ExtrudeGeometry; the real build is installed beside it as
 * `three-real` by the harness setup (see icon3d/ARCHITECTURE.md). When it is
 * absent these tests skip rather than fail, so `npm test` stays green on a
 * fresh clone and CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

let THREE = null;
try {
    THREE = await import('three-real');
} catch {
    THREE = null;
}

const { shapesFromPath, clampToOutline, buildIcon } = await import('../icon3d/src/model/icon-mesh.js');
const { ICONS } = await import('../icon3d/src/icons/index.js');

test('plates: a bevelled band grows a burr at its cusp and clampToOutline removes it', { skip: !THREE && 'three-real not installed' }, () => {
    const piece = ICONS['copilot-2023'].pieces.find((p) => p.id === 'band_blue');
    const shapes = shapesFromPath(THREE, piece.d);
    const b = 0.36;
    const geometry = new THREE.ExtrudeGeometry(shapes, {
        depth: 2 - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 4, curveSegments: 20,
    });
    geometry.computeBoundingBox();
    // The razor tip at (29.5, 4) pokes the cap above the top edge (y = -4 in the flipped frame).
    assert.ok(geometry.boundingBox.max.y > -4 + 0.2, `burr expected, got max y ${geometry.boundingBox.max.y}`);
    const moved = clampToOutline(geometry, shapes, 20);
    assert.ok(moved > 0, 'some vertices should have been pulled back');
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.max.y <= -4 + 1e-6, `after clamp max y ${geometry.boundingBox.max.y}`);
    assert.equal(clampToOutline(geometry, shapes, 20), 0, 'idempotent');
});

test('plates: every piece of every icon stays inside its outline and stacks by layer', { skip: !THREE && 'three-real not installed' }, () => {
    for (const icon of Object.values(ICONS)) {
        const built = buildIcon(THREE, icon, { size: 2 });
        assert.equal(built.pieces.length, icon.pieces.length);
        for (const p of built.pieces) {
            const recipePiece = icon.pieces[p.index];
            const shapes = shapesFromPath(THREE, recipePiece.d, recipePiece.fillRule, recipePiece.translate);
            assert.equal(clampToOutline(p.geometry, shapes, 20), 0, `${icon.id}/${p.id} has vertices outside its outline`);
            p.geometry.computeBoundingBox();
            const bb = p.geometry.boundingBox;
            const [minX, minY, maxX, maxY] = p.bounds;
            assert.ok(bb.min.x >= minX - 0.05 && bb.max.x <= maxX + 0.05, `${p.id} x within bounds`);
            assert.ok(bb.min.y >= -maxY - 0.05 && bb.max.y <= -minY + 0.05, `${p.id} y within bounds`);
        }
        const zs = built.pieces.map((p) => p.mesh.position.z);
        const layers = built.pieces.map((p) => p.layer);
        for (let i = 0; i < zs.length; i++) for (let j = 0; j < zs.length; j++) {
            if (layers[i] < layers[j]) assert.ok(zs[i] < zs[j], 'lower layer sits further back');
        }
        assert.ok(built.width > 0 && built.height > 0 && built.thickness > 0);
        built.dispose();
    }
});
