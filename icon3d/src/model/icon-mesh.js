/**
 * model/icon-mesh.js — an icon table → a group of extruded, gradient-lit plates.
 *
 * The pipeline is the one Blender's SVG importer runs, reproduced in about a
 * hundred lines of core Three: path data → closed rings → solids with holes →
 * `ExtrudeGeometry` with a bevel → one mesh per painted path, stacked in z by
 * paint order. Nothing here is loaded; the geometry is the table in
 * `icons/*.js` and the numbers below.
 *
 * Three things worth knowing:
 *
 *   - GEOMETRY STAYS IN SVG UNITS with y flipped (SVG is y-down, Three is y-up).
 *     Centring and scale live on the group, not in the vertices, so the fragment
 *     shader can read a vertex's SVG coordinate straight off `position` and
 *     evaluate the icon's own gradient at it. Flip the y back inside the shader
 *     and you are in the coordinate system the SVG's gradientTransform expects.
 *
 *   - THE BEVEL IS OFFSET INWARD (`bevelOffset = -bevelSize`). Three's default
 *     bevel grows the plate OUTWARD by `bevelSize`, so a bevelled extrusion is
 *     fatter than its outline and two pieces that share an edge in the SVG
 *     collide. With the offset the walls sit exactly on the outline and the
 *     caps are inset instead — the front-on silhouette is the SVG's, which is
 *     what the silhouette gate in `gate.js` measures.
 *
 *   - EVERY PIECE NEEDS ITS OWN PROGRAM CACHE KEY. Three caches compiled
 *     programs by material settings plus `onBeforeCompile.toString()`; four
 *     materials whose hook is the same closure with different captured GLSL
 *     look identical to the cache, and every plate renders with the first
 *     gradient compiled. `customProgramCacheKey` names the piece.
 */

import { parsePath, subpathsBounds } from './svg-path.js';
import { assignHoles } from './fill-shapes.js';
import { compileFill, fillGLSL } from './svg-gradient.js';

/** Fractions of the icon's larger viewBox dimension, so any viewBox scale works. */
export const EXTRUDE_DEFAULTS = {
    /** Plate thickness, front face to back face. 2/48 is the Blender plate look. */
    thicknessFrac: 0.042,
    /** Bevel size and depth. Small: the bevel is a highlight catcher, not a shape change. */
    bevelFrac: 0.0075,
    bevelSegments: 4,
    /** Points per cubic when flattening the outline. */
    curveSegments: 20,
    /** Clearance between stacked layers, in addition to the plate thickness. */
    gapFrac: 0.014,
    /** Material look. */
    roughness: 0.32,
    clearcoat: 0.55,
    clearcoatRoughness: 0.28,
    envMapIntensity: 1.0,
};

/** Flat, saturated, thresholdable colours for the silhouette gate. */
export const ID_COLOURS = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

function toThreePath(THREE, sub, target) {
    target.moveTo(sub.x, -sub.y);
    for (const s of sub.segments) {
        if (s.kind === 'L') target.lineTo(s.x, -s.y);
        else target.bezierCurveTo(s.x1, -s.y1, s.x2, -s.y2, s.x, -s.y);
    }
    if (sub.closed) target.closePath();
    return target;
}

/** SVG `d` (+ fill rule) → THREE.Shape[] with holes attached. */
export function shapesFromPath(THREE, d, fillRule = 'nonzero') {
    const subpaths = parsePath(d);
    return assignHoles(subpaths, { fillRule }).map(({ contour, holes }) => {
        const shape = toThreePath(THREE, contour, new THREE.Shape());
        for (const h of holes) shape.holes.push(toThreePath(THREE, h, new THREE.Path()));
        return shape;
    });
}

/**
 * Pull every vertex that strayed outside the outline back onto it.
 *
 * ExtrudeGeometry offsets the cap contour along a per-vertex bevel vector, and
 * at a CUSP — two edges meeting at ~0°, which is exactly what the artwork's
 * razor-tipped band corners are (the inner diagonal arrives tangent to the end
 * edge) — that vector is an arbitrary clamped direction, not an inset. The
 * band_blue cap grew a 0.35-unit burr above its own top edge; at the icon's
 * on-screen size that is a six-pixel spike. Snapping the offenders to the
 * nearest outline point costs nothing visible and makes "no vertex outside the
 * outline" an invariant the probe can assert.
 *
 * @returns {number} how many vertices were moved
 */
export function clampToOutline(geometry, shapes, curveSegments) {
    const rings = [];
    for (const shape of shapes) {
        const pts = shape.extractPoints(curveSegments);
        rings.push({ pts: pts.shape, hole: false });
        for (const h of pts.holes) rings.push({ pts: h, hole: true });
    }
    const inRing = (ring, x, y) => {
        let inside = false;
        const p = ring.pts;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
            const xi = p[i].x, yi = p[i].y, xj = p[j].x, yj = p[j].y;
            if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) inside = !inside;
        }
        return inside;
    };
    const insideOutline = (x, y) => {
        let solid = false, hole = false;
        for (const r of rings) {
            if (r.hole) { if (inRing(r, x, y)) hole = true; } else if (inRing(r, x, y)) solid = true;
        }
        return solid && !hole;
    };
    // Positions are float32: a point snapped onto an edge lands a few ulps off
    // it after rounding, and an ulp scales with the coordinate magnitude (a
    // 513-unit viewBox rounds ~10x coarser than a 48-unit one). Anything
    // within a millionth of the outline's extent IS on the outline.
    let ex0 = Infinity, ex1 = -Infinity, ey0 = Infinity, ey1 = -Infinity;
    for (const r of rings) for (const q of r.pts) {
        if (q.x < ex0) ex0 = q.x; if (q.x > ex1) ex1 = q.x; if (q.y < ey0) ey0 = q.y; if (q.y > ey1) ey1 = q.y;
    }
    const eps2 = Math.pow(1e-6 * Math.max(ex1 - ex0, ey1 - ey0, 1), 2);
    const pos = geometry.getAttribute('position');
    let moved = 0;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        if (insideOutline(x, y)) continue;
        // nearest point on any ring edge
        let best = Infinity, bx = x, by = y;
        for (const r of rings) {
            const p = r.pts;
            for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
                const ax = p[b].x, ay = p[b].y, dx = p[a].x - ax, dy = p[a].y - ay;
                const len2 = dx * dx + dy * dy || 1;
                const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
                const px = ax + t * dx, py = ay + t * dy;
                const d = (x - px) * (x - px) + (y - py) * (y - py);
                if (d < best) { best = d; bx = px; by = py; }
            }
        }
        if (best > eps2) { pos.setXY(i, bx, by); moved++; }
    }
    if (moved) pos.needsUpdate = true;
    return moved;
}

/** Inject the piece's SVG gradient as the material's albedo, evaluated per fragment. */
export function applyGradient(material, glsl, cacheKey) {
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vSvgPos;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSvgPos = vec2(position.x, -position.y);');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vSvgPos;\n' + glsl)
            .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = svgFill(vSvgPos);');
    };
    material.customProgramCacheKey = () => cacheKey;
    return material;
}

/**
 * Build the icon.
 * @param {object} THREE
 * @param {object} icon   a table from icons/
 * @param {object} [opts] EXTRUDE_DEFAULTS overrides plus `size` (world height of the icon)
 */
export function buildIcon(THREE, icon, opts = {}) {
    const cfg = { ...EXTRUDE_DEFAULTS, ...opts };
    const [, , vw, vh] = icon.viewBox;
    const unit = Math.max(vw, vh);
    const thickness = cfg.thicknessFrac * unit;
    const bevel = Math.min(cfg.bevelFrac * unit, thickness * 0.45);
    const depth = thickness - 2 * bevel;
    const layerStep = thickness + cfg.gapFrac * unit;

    const group = new THREE.Group();
    group.name = icon.id;
    const pieces = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let minLayer = Infinity, maxLayer = -Infinity;

    icon.pieces.forEach((piece, index) => {
        const subpaths = parsePath(piece.d);
        const bounds = subpathsBounds(subpaths);
        minX = Math.min(minX, bounds[0]); minY = Math.min(minY, bounds[1]);
        maxX = Math.max(maxX, bounds[2]); maxY = Math.max(maxY, bounds[3]);
        const layer = piece.layer || 0;
        minLayer = Math.min(minLayer, layer); maxLayer = Math.max(maxLayer, layer);

        const shapes = shapesFromPath(THREE, piece.d, piece.fillRule);
        const geometry = new THREE.ExtrudeGeometry(shapes, {
            depth,
            bevelEnabled: bevel > 0,
            bevelThickness: bevel,
            bevelSize: bevel,
            bevelOffset: -bevel,
            bevelSegments: cfg.bevelSegments,
            curveSegments: cfg.curveSegments,
        });
        clampToOutline(geometry, shapes, cfg.curveSegments);
        // Centre the plate on its own z so a layer index maps to a plane.
        geometry.translate(0, 0, -depth / 2);
        geometry.computeVertexNormals();

        const cf = compileFill(piece.fill, bounds);
        const glsl = fillGLSL('svgFill', cf);
        const key = `icon3d:${icon.id}:${piece.id}`;

        const materials = {
            colour: applyGradient(new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                roughness: cfg.roughness,
                metalness: 0,
                clearcoat: cfg.clearcoat,
                clearcoatRoughness: cfg.clearcoatRoughness,
                envMapIntensity: cfg.envMapIntensity,
            }), glsl, key + ':colour'),
            clay: new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.72, metalness: 0 }),
            unlit: applyGradient(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), glsl, key + ':unlit'),
            ids: new THREE.MeshBasicMaterial({
                color: new THREE.Color(...ID_COLOURS[index % ID_COLOURS.length]), toneMapped: false,
            }),
        };

        const mesh = new THREE.Mesh(geometry, materials.colour);
        mesh.name = piece.id;
        mesh.userData.d = piece.d;
        mesh.position.z = layer * layerStep;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        pieces.push({ id: piece.id, index, layer, mesh, geometry, materials, bounds, fill: cf });
    });

    const bounds = [minX, minY, maxX, maxY];
    const width = maxX - minX, height = maxY - minY;
    const size = opts.size || 2;
    const scale = size / Math.max(width, height);

    // Centre the artwork (not the viewBox) and stand it on y = 0.
    const inner = new THREE.Group();
    inner.name = 'artwork';
    group.children.slice().forEach((m) => inner.add(m));
    group.add(inner);
    inner.position.set(-(minX + maxX) / 2, maxY, 0);
    group.scale.setScalar(scale);

    const zMin = minLayer * layerStep - thickness / 2;
    const zMax = maxLayer * layerStep + thickness / 2;

    return {
        group,
        inner,
        pieces,
        bounds,
        scale,
        width: width * scale,
        height: height * scale,
        thickness: thickness * scale,
        depthExtent: [zMin * scale, zMax * scale],
        /** Swap every plate to one of: colour | clay | unlit | ids */
        setMode(mode) {
            for (const p of pieces) p.mesh.material = p.materials[mode] || p.materials.colour;
        },
        dispose() {
            for (const p of pieces) {
                p.geometry.dispose();
                Object.values(p.materials).forEach((m) => m.dispose());
            }
        },
    };
}
