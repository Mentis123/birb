/**
 * model/export.js — bake the shader gradient into textures and hand the icon to
 * GLTFExporter, so the thing on screen can go into Blender, Visio or a game
 * engine as a GLB.
 *
 * The on-screen material paints its gradient in a fragment shader, which no
 * file format can carry. For export each plate gets a small texture painted by
 * `evaluateFill()` — the same JS reference the shader was generated from — and
 * a UV set that maps every vertex, walls included, by its SVG position, so the
 * colour wraps round the bevel exactly as it does on screen.
 *
 * `flipY` is false on purpose: glTF puts v = 0 at the TOP of an image, and the
 * bake writes its first row at the piece's minimum SVG y, which is also the
 * top. Leaving Three's default (true) exports a vertically mirrored gradient.
 *
 * GLTFExporter itself lives in Three's examples and is fetched from the CDN
 * only when the button is pressed — it is a tool, not part of the artefact.
 */

import { evaluateFill } from './svg-gradient.js';
import { threeUrl, THREE_LOCAL } from '../core/three-loader.js';

/** Paint a piece's fill over its bounds into a canvas. */
export function bakeFill(piece, px = 512) {
    const [minX, minY, maxX, maxY] = piece.bounds;
    const w = maxX - minX, h = maxY - minY;
    const pw = px, ph = Math.max(2, Math.round(px * h / w));
    const canvas = document.createElement('canvas');
    canvas.width = pw; canvas.height = ph;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(pw, ph);
    const d = img.data;
    for (let y = 0; y < ph; y++) {
        const sy = minY + (y + 0.5) * h / ph;
        for (let x = 0; x < pw; x++) {
            const sx = minX + (x + 0.5) * w / pw;
            const [r, g, b] = evaluateFill(piece.fill, sx, sy);
            const i = (y * pw + x) * 4;
            d[i] = Math.round(r * 255); d[i + 1] = Math.round(g * 255); d[i + 2] = Math.round(b * 255); d[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

/** A UV attribute that maps every vertex by its SVG position within the piece bounds. */
export function positionUVs(THREE, geometry, bounds) {
    const [minX, minY, maxX, maxY] = bounds;
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const pos = geometry.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = -pos.getY(i); // back to SVG y-down
        uv[i * 2] = (x - minX) / w;
        uv[i * 2 + 1] = (y - minY) / h;
    }
    return new THREE.BufferAttribute(uv, 2);
}

/**
 * Build a self-contained export scene: same geometry, baked materials,
 * same transforms. Nothing in it references the live scene.
 */
export function buildExportScene(THREE, built, opts = {}) {
    const root = new THREE.Group();
    root.name = built.group.name;
    const inner = new THREE.Group();
    inner.name = 'artwork';
    inner.position.copy(built.inner.position);
    root.add(inner);
    root.scale.copy(built.group.scale);
    root.position.copy(built.group.position);

    const textures = [];
    for (const p of built.pieces) {
        const geometry = p.geometry.clone();
        geometry.setAttribute('uv', positionUVs(THREE, geometry, p.bounds));
        const tex = new THREE.CanvasTexture(bakeFill(p, opts.px || 512));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.needsUpdate = true;
        textures.push(tex);
        const material = new THREE.MeshStandardMaterial({
            map: tex, roughness: 0.35, metalness: 0,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = p.id;
        mesh.position.copy(p.mesh.position);
        inner.add(mesh);
    }
    if (opts.tile) {
        const tile = new THREE.Mesh(opts.tile.geometry, new THREE.MeshStandardMaterial({
            color: opts.tile.material.color, roughness: opts.tile.material.roughness, metalness: 0,
        }));
        tile.name = 'tile';
        const wrap = new THREE.Group();
        wrap.name = 'export';
        wrap.add(root);
        wrap.add(tile);
        return { scene: wrap, textures };
    }
    return { scene: root, textures };
}

/** Fetch GLTFExporter from the CDN and produce GLB bytes. */
export async function exportGLB(THREE, threeVersion, built, opts = {}) {
    // Beside whichever Three the page is running on: the CDN copy rewrites its
    // own `three` import; the local copy relies on the page's import map.
    const url = threeUrl() === THREE_LOCAL
        ? '/node_modules/three-real/examples/jsm/exporters/GLTFExporter.js'
        : `https://esm.sh/three@${threeVersion}/examples/jsm/exporters/GLTFExporter.js`;
    const mod = await import(/* webpackIgnore: true */ url);
    const { scene, textures } = buildExportScene(THREE, built, opts);
    const exporter = new mod.GLTFExporter();
    try {
        const result = await exporter.parseAsync(scene, { binary: true });
        return result; // ArrayBuffer
    } finally {
        textures.forEach((t) => t.dispose());
    }
}

/** Trigger a browser download of GLB bytes. */
export function downloadGLB(bytes, filename) {
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}
