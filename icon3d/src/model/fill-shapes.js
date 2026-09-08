/**
 * model/fill-shapes.js — turn the subpaths of one SVG fill into solids-with-holes.
 *
 * Pure, no THREE. An SVG `d` can carry any number of closed rings and the fill
 * rule decides which ring bounds a hole. This implements both rules properly:
 *
 *   nonzero  — a ring is a hole when the winding number just inside it is zero
 *              and just outside it is not. Rings nested with the SAME
 *              orientation are invisible under nonzero (the region is filled on
 *              both sides), so they are dropped rather than extruded twice.
 *   evenodd  — a ring is a hole when its nesting depth is odd.
 *
 * Three's own `ShapePath.toShapes(isCCW)` decides by winding alone, which is
 * right for well-behaved exports and wrong for the very common Figma/Illustrator
 * case of an evenodd path whose hole ring runs the same way as its outer ring:
 * that comes out as two overlapping solids and the hole silently fills in.
 *
 * Containment is decided by a majority vote of a ring's sampled vertices inside
 * the other ring — one vertex can legitimately sit ON another ring (shapes that
 * share an edge), so a single-point test flips on rounding.
 */

import { flattenSubpath, signedArea } from './svg-path.js';

/** Even-odd ray-casting point-in-polygon. */
export function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py)) {
            const xInt = xi + (py - yi) * (xj - xi) / (yj - yi);
            if (px < xInt) inside = !inside;
        }
    }
    return inside;
}

/** Fraction of `inner`'s vertices that lie inside `outer`. */
function containmentScore(inner, outer) {
    let hit = 0;
    for (const [x, y] of inner) if (pointInPolygon(x, y, outer)) hit++;
    return hit / inner.length;
}

/**
 * @param {import('./svg-path.js').Subpath[]} subpaths
 * @param {{fillRule?:'nonzero'|'evenodd', divisions?:number}} [opts]
 * @returns {{contour:object, holes:object[]}[]}  solids, each with its holes
 */
export function assignHoles(subpaths, opts = {}) {
    const fillRule = opts.fillRule || 'nonzero';
    const divisions = opts.divisions || 8;

    const rings = [];
    subpaths.forEach((sub, index) => {
        const pts = flattenSubpath(sub, divisions);
        if (pts.length < 3) return;
        const area = signedArea(pts);
        if (Math.abs(area) < 1e-12) return;
        rings.push({ index, sub, pts, area, orient: area > 0 ? 1 : -1, ancestors: [] });
    });

    // Ancestry: which rings contain which.
    for (const r of rings) {
        for (const o of rings) {
            if (o === r) continue;
            if (Math.abs(o.area) <= Math.abs(r.area)) continue; // a container is bigger
            if (containmentScore(r.pts, o.pts) > 0.5) r.ancestors.push(o);
        }
        r.depth = r.ancestors.length;
        // Immediate parent = the deepest ancestor.
        r.parent = r.ancestors.reduce((best, a) => (!best || a.ancestors.length > best.ancestors.length ? a : best), null);
    }

    // Classify each ring boundary.
    for (const r of rings) {
        if (fillRule === 'evenodd') {
            r.role = r.depth % 2 === 0 ? 'solid' : 'hole';
        } else {
            const outside = r.ancestors.reduce((w, a) => w + a.orient, 0);
            const inside = outside + r.orient;
            if (inside !== 0 && outside === 0) r.role = 'solid';
            else if (inside === 0 && outside !== 0) r.role = 'hole';
            else r.role = 'invisible';
        }
    }

    // Attach holes to the nearest solid ancestor.
    const solids = new Map();
    for (const r of rings) if (r.role === 'solid') solids.set(r, { contour: r.sub, holes: [] });
    for (const r of rings) {
        if (r.role !== 'hole') continue;
        let p = r.parent;
        while (p && p.role !== 'solid') p = p.parent;
        if (p && solids.has(p)) solids.get(p).holes.push(r.sub);
    }
    return [...solids.values()];
}
