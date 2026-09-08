/**
 * model/gate.js — the deterministic likeness gate. Browser only.
 *
 * A vector source makes likeness measurable instead of arguable, and this
 * measures it two ways, both against an independent oracle:
 *
 *   SILHOUETTE — the plates are rendered front-on through an orthographic camera
 *   in flat ID colours, and the same `d` strings are filled by the browser's own
 *   `Path2D` into a 2D canvas with the same pixel mapping. Per-piece IoU of the
 *   two label images. The browser's path rasteriser shares no code with
 *   `svg-path.js`, so a wrong arc, a dropped segment, a mirrored axis or a bevel
 *   that grows the outline all show up as lost overlap.
 *
 *   COLOUR — the plates are rendered again in the unlit gradient material and
 *   every visible pixel is compared with `evaluateFill()`, the JS reference the
 *   GLSL was emitted from. Mean absolute error in 8-bit sRGB. This is the check
 *   that the shader — chained mixes, inverse transforms, premultiplied stops —
 *   says what the table says.
 *
 * Both renders reuse the production geometry and materials; a gate on a
 * different mesh proves nothing about the one on screen.
 */

import { evaluateFill } from './svg-gradient.js';
import { ID_COLOURS } from './icon-mesh.js';
import { buildExportScene } from './export.js';

function labelOf(r, g, b) {
    const bits = (r > 127 ? 1 : 0) | (g > 127 ? 2 : 0) | (b > 127 ? 4 : 0);
    if (!bits) return -1;
    const idx = ID_COLOURS.findIndex(([cr, cg, cb]) => ((cr ? 1 : 0) | (cg ? 2 : 0) | (cb ? 4 : 0)) === bits);
    return idx;
}

/**
 * @param {object} THREE
 * @param {object} renderer  the page's WebGLRenderer
 * @param {object} icon      the table (for `d` strings and viewBox)
 * @param {object} built     result of buildIcon()
 * @param {number} px        raster width in pixels
 */
export function runGate(THREE, renderer, icon, built, px = 512) {
    const [minX, minY, maxX, maxY] = built.bounds;
    const w = maxX - minX, h = maxY - minY;
    const pw = px, ph = Math.max(1, Math.round(px * h / w));

    // --- 3D renders in raw SVG units: a private scene holding the plates only.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0, 0, 0);
    const holder = new THREE.Group();
    const parent = built.inner.parent;
    const savedPos = built.inner.position.clone();
    built.inner.position.set(0, 0, 0);
    holder.add(built.inner);
    scene.add(holder);

    const [zMin, zMax] = built.depthExtent.map((z) => z / built.scale);
    const camera = new THREE.OrthographicCamera(minX, maxX, -minY, -maxY, 1, 10 + (zMax - zMin));
    camera.position.set(0, 0, zMax + 5);
    camera.lookAt(0, 0, 0);

    const target = new THREE.WebGLRenderTarget(pw, ph, { depthBuffer: true, samples: 0 });
    // A render target is linear unless told otherwise; the oracle and the
    // reference evaluator both speak sRGB, so ask for sRGB encoding on output.
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const readPixels = () => {
        const buf = new Uint8Array(pw * ph * 4);
        renderer.readRenderTargetPixels(target, 0, 0, pw, ph, buf);
        return buf;
    };
    const prevTarget = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    const prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;

    built.setMode('ids');
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const idsGL = readPixels();

    built.setMode('unlit');
    renderer.render(scene, camera);
    const unlitGL = readPixels();

    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevTone;
    renderer.shadowMap.enabled = prevShadow;
    built.setMode('colour');
    target.dispose();

    // Put the artwork back exactly where it was.
    parent.add(built.inner);
    built.inner.position.copy(savedPos);

    // --- 2D oracle: the browser fills the same d strings, in paint order.
    const canvas = document.createElement('canvas');
    canvas.width = pw; canvas.height = ph;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, pw, ph);
    ctx.setTransform(pw / w, 0, 0, ph / h, -minX * pw / w, -minY * ph / h);
    const order = built.pieces.slice().sort((a, b) => a.layer - b.layer || a.index - b.index);
    for (const p of order) {
        const [r, g, b] = ID_COLOURS[p.index % ID_COLOURS.length];
        ctx.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`;
        const piece = icon.pieces[p.index];
        ctx.save();
        if (piece.translate) ctx.translate(piece.translate[0], piece.translate[1]);
        ctx.fill(new Path2D(piece.d), piece.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
        ctx.restore();
    }
    const ref = ctx.getImageData(0, 0, pw, ph).data;

    // --- compare. GL rows are bottom-up; the canvas is top-down.
    const n = built.pieces.length;
    const inter = new Array(n).fill(0), union = new Array(n).fill(0);
    let interAll = 0, unionAll = 0;
    const colourErr = new Array(n).fill(0), colourCount = new Array(n).fill(0);
    for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
            const gi = ((ph - 1 - y) * pw + x) * 4;
            const ri = (y * pw + x) * 4;
            const a = labelOf(idsGL[gi], idsGL[gi + 1], idsGL[gi + 2]);
            const b = labelOf(ref[ri], ref[ri + 1], ref[ri + 2]);
            if (a >= 0 || b >= 0) {
                unionAll++;
                if (a >= 0 && b >= 0) interAll++;
            }
            for (let k = 0; k < n; k++) {
                const inA = a === k, inB = b === k;
                if (inA || inB) union[k]++;
                if (inA && inB) inter[k]++;
            }
            // Colour: pixels both agree on, away from edges (all 8 neighbours same label).
            if (a >= 0 && a === b && x > 0 && y > 0 && x < pw - 1 && y < ph - 1) {
                let interior = true;
                for (let dy = -1; dy <= 1 && interior; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const ni = ((y + dy) * pw + (x + dx)) * 4;
                        if (labelOf(ref[ni], ref[ni + 1], ref[ni + 2]) !== b) { interior = false; break; }
                    }
                }
                if (!interior) continue;
                const sx = minX + (x + 0.5) * w / pw, sy = minY + (y + 0.5) * h / ph;
                const expect = evaluateFill(built.pieces[a].fill, sx, sy);
                const err = Math.abs(unlitGL[gi] - expect[0] * 255)
                    + Math.abs(unlitGL[gi + 1] - expect[1] * 255)
                    + Math.abs(unlitGL[gi + 2] - expect[2] * 255);
                colourErr[a] += err / 3;
                colourCount[a]++;
            }
        }
    }
    const pieces = built.pieces.map((p, k) => ({
        id: p.id,
        iou: union[k] ? inter[k] / union[k] : 0,
        pixels: union[k],
        colourMAE: colourCount[k] ? colourErr[k] / colourCount[k] : null,
        colourSamples: colourCount[k],
    }));
    return {
        raster: [pw, ph],
        iou: unionAll ? interAll / unionAll : 0,
        pieces,
        minIoU: Math.min(...pieces.map((p) => p.iou)),
        maxColourMAE: Math.max(...pieces.map((p) => p.colourMAE ?? 0)),
    };
}

/**
 * Render the EXPORT scene — baked textures, position UVs, flipY off — through
 * the same orthographic front camera and compare every plate pixel with the
 * reference evaluator. A vertically mirrored bake, a UV that measures from the
 * wrong corner or a texture left in linear space all show up here as a large
 * mean error; the shader gate above cannot see any of them because the shader
 * never touches a texture.
 */
export function runBakeCheck(THREE, renderer, built, px = 512) {
    const [minX, minY, maxX, maxY] = built.bounds;
    const w = maxX - minX, h = maxY - minY;
    const pw = px, ph = Math.max(1, Math.round(px * h / w));

    const { scene: exportRoot, textures } = buildExportScene(THREE, built, { px: 512 });
    const artwork = exportRoot.getObjectByName('artwork');
    artwork.position.set(0, 0, 0);
    // Unlit, so what comes back is the texture and nothing else.
    const lookup = new Map();
    artwork.traverse((o) => {
        if (!o.isMesh) return;
        o.material = new THREE.MeshBasicMaterial({ map: o.material.map, toneMapped: false });
        lookup.set(o.name, o);
    });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0, 0, 0);
    scene.add(artwork);

    const [zMin, zMax] = built.depthExtent.map((z) => z / built.scale);
    const camera = new THREE.OrthographicCamera(minX, maxX, -minY, -maxY, 1, 10 + (zMax - zMin));
    camera.position.set(0, 0, zMax + 5);
    camera.lookAt(0, 0, 0);

    const target = new THREE.WebGLRenderTarget(pw, ph, { depthBuffer: true, samples: 0 });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const gl = new Uint8Array(pw * ph * 4);
    renderer.readRenderTargetPixels(target, 0, 0, pw, ph, gl);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.enabled = prevShadow;
    target.dispose();

    // Which plate owns each pixel: the ids render from the main gate's oracle,
    // re-derived here with Path2D so this check stands on its own.
    const canvas = document.createElement('canvas');
    canvas.width = pw; canvas.height = ph;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, pw, ph);
    ctx.setTransform(pw / w, 0, 0, ph / h, -minX * pw / w, -minY * ph / h);
    const order = built.pieces.slice().sort((a, b) => a.layer - b.layer || a.index - b.index);
    for (const p of order) {
        const [r, g, b] = ID_COLOURS[p.index % ID_COLOURS.length];
        ctx.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`;
        ctx.save();
        const translate = p.mesh.userData.translate;
        if (translate) ctx.translate(translate[0], translate[1]);
        ctx.fill(new Path2D(p.mesh.userData.d || ''), 'nonzero');
        ctx.restore();
    }
    const ref = ctx.getImageData(0, 0, pw, ph).data;

    let err = 0, count = 0;
    for (let y = 1; y < ph - 1; y++) {
        for (let x = 1; x < pw - 1; x++) {
            const ri = (y * pw + x) * 4;
            const label = labelOf(ref[ri], ref[ri + 1], ref[ri + 2]);
            if (label < 0) continue;
            let interior = true;
            for (let dy = -1; dy <= 1 && interior; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const ni = ((y + dy) * pw + (x + dx)) * 4;
                    if (labelOf(ref[ni], ref[ni + 1], ref[ni + 2]) !== label) { interior = false; break; }
                }
            }
            if (!interior) continue;
            const gi = ((ph - 1 - y) * pw + x) * 4;
            const sx = minX + (x + 0.5) * w / pw, sy = minY + (y + 0.5) * h / ph;
            const expect = evaluateFill(built.pieces[label].fill, sx, sy);
            err += (Math.abs(gl[gi] - expect[0] * 255) + Math.abs(gl[gi + 1] - expect[1] * 255) + Math.abs(gl[gi + 2] - expect[2] * 255)) / 3;
            count++;
        }
    }
    textures.forEach((t) => t.dispose());
    artwork.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return { colourMAE: count ? err / count : null, samples: count };
}
