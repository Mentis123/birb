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
