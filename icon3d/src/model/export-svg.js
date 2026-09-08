/**
 * model/export-svg.js — the 3D object back out as a VECTOR drawing.
 *
 * A PNG of a 3D render is not a Visio object. What a diagram needs is real
 * paths, one group per component, with the brand gradients still gradients —
 * something you can drop on a page, scale to any size and recolour. This
 * projects the actual meshes the page is showing and emits exactly that.
 *
 * How, and why this is honest vector rather than a traced bitmap:
 *
 *   1. Project every vertex through the same orthographic axonometric the
 *      viewer is looking along. Orthographic, not perspective, because a
 *      diagram icon must tile and scale without a vanishing point, and because
 *      the projection of a plane is then an exact affine map.
 *   2. Keep the front-facing triangles of each piece, and extract the boundary
 *      of that set — the edges used by exactly one triangle, chained into
 *      loops. That boundary IS the visible silhouette of the piece, computed
 *      from geometry rather than sampled from pixels.
 *   3. Fill it with the piece's own SVG gradient, carried across by a
 *      `gradientTransform` fitted by least squares from the mesh's own
 *      SVG-space coordinates to their projected positions. For the flat
 *      plates that fit is exact (a plane projects affinely); for the ribbon it
 *      is the best affine approximation of a curved surface, which is what an
 *      illustrator would draw anyway.
 *   4. Add shading as a small number of semi-transparent overlay paths, one
 *      per luminance band, so the drawing reads as a lit 3D object instead of
 *      a flat sticker — still vector, still editable, no raster anywhere.
 *
 * Pieces are emitted back to front by mean depth, so the straps sit behind the
 * bands exactly as the depth buffer put them.
 */

import { evaluateFill, parseTransform, multiply as composeAffine } from './svg-gradient.js';

const DEG = Math.PI / 180;

/**
 * Orthographic axonometric basis for a yaw/pitch camera.
 * Returns right/up/view unit vectors; project with dot products.
 */
export function axonometricBasis(yawDeg, pitchDeg) {
    const y = yawDeg * DEG, p = pitchDeg * DEG;
    const view = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
    const right = [Math.cos(y), 0, -Math.sin(y)];
    // view × right, not right × view: the other order points DOWN, and the
    // whole drawing comes out mirrored top to bottom — gradients included,
    // which is what makes it look like a colour bug rather than an axis one.
    const up = [
        view[1] * right[2] - view[2] * right[1],
        view[2] * right[0] - view[0] * right[2],
        view[0] * right[1] - view[1] * right[0],
    ];
    return { right, up, view };
}

/** Chain undirected boundary edges into closed loops of vertex indices. */
export function chainLoops(edges) {
    const next = new Map();
    for (const [a, b] of edges) {
        if (!next.has(a)) next.set(a, []);
        next.get(a).push(b);
    }
    const loops = [];
    const remaining = new Map([...next].map(([k, v]) => [k, v.slice()]));
    for (const start of next.keys()) {
        while (remaining.get(start) && remaining.get(start).length) {
            const loop = [start];
            let cur = start;
            for (let guard = 0; guard < 200000; guard++) {
                const outs = remaining.get(cur);
                if (!outs || !outs.length) break;
                const nxt = outs.pop();
                if (nxt === start) { break; }
                loop.push(nxt);
                cur = nxt;
            }
            if (loop.length >= 3) loops.push(loop);
        }
    }
    return loops;
}

/** Absolute area of a closed polygon (shoelace). */
export function loopArea(points) {
    let a = 0;
    for (let i = 0, n = points.length; i < n; i++) {
        const p = points[i], q = points[(i + 1) % n];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
}

/** Ramer–Douglas–Peucker on a closed polygon. */
export function simplifyLoop(points, tolerance) {
    if (points.length < 4 || tolerance <= 0) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = 1; keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [i0, i1] = stack.pop();
        const [x0, y0] = points[i0], [x1, y1] = points[i1];
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        let worst = -1, at = -1;
        for (let i = i0 + 1; i < i1; i++) {
            const d = Math.abs((points[i][0] - x0) * dy - (points[i][1] - y0) * dx) / len;
            if (d > worst) { worst = d; at = i; }
        }
        if (worst > tolerance && at > 0) {
            keep[at] = 1;
            stack.push([i0, at], [at, i1]);
        }
    }
    return points.filter((_, i) => keep[i]);
}

/** Least-squares affine [a b c d e f] mapping source 2D points to target 2D points. */
export function fitAffine(source, target) {
    // Solve independently for x' and y': [x y 1] · [p q r]ᵀ = x'
    const n = source.length;
    let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, s1 = n;
    let tx = 0, ty = 0, txx = 0, txy = 0, tyx = 0, tyy = 0;
    for (let i = 0; i < n; i++) {
        const [x, y] = source[i], [u, v] = target[i];
        sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
        txx += x * u; tyx += y * u; tx += u;
        txy += x * v; tyy += y * v; ty += v;
    }
    const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, s1]];
    const solve = (rhs) => {
        const A = M.map((row, i) => [...row, rhs[i]]);
        for (let c = 0; c < 3; c++) {
            let piv = c;
            for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
            [A[c], A[piv]] = [A[piv], A[c]];
            if (Math.abs(A[c][c]) < 1e-12) return null;
            for (let r = 0; r < 3; r++) {
                if (r === c) continue;
                const f = A[r][c] / A[c][c];
                for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
            }
        }
        return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
    };
    const cx = solve([txx, tyx, tx]);
    const cy = solve([txy, tyy, ty]);
    if (!cx || !cy) return null;
    // SVG matrix(a b c d e f): x' = a·x + c·y + e ; y' = b·x + d·y + f
    return [cx[0], cy[0], cx[1], cy[1], cx[2], cy[2]];
}

const fmt = (n) => {
    const r = Math.round(n * 100) / 100;
    return Object.is(r, -0) ? '0' : String(r);
};

function gradientMarkup(id, g, transform) {
    const stops = g.stops.map(([offset, hex, opacity]) =>
        `<stop offset="${fmt(offset * 100)}%" stop-color="${hex}"${opacity === undefined ? '' : ` stop-opacity="${opacity}"`}/>`).join('');
    const t = ` gradientUnits="userSpaceOnUse" gradientTransform="matrix(${transform.map(fmt).join(' ')})"`;
    if (g.type === 'radial') {
        return `<radialGradient id="${id}" cx="${fmt(g.cx ?? 0)}" cy="${fmt(g.cy ?? 0)}" r="${fmt(g.r ?? 1)}"${t}>${stops}</radialGradient>`;
    }
    return `<linearGradient id="${id}" x1="${fmt(g.x1 ?? 0)}" y1="${fmt(g.y1 ?? 0)}" x2="${fmt(g.x2 ?? 1)}" y2="${fmt(g.y2 ?? 0)}"${t}>${stops}</linearGradient>`;
}

/**
 * Project one built icon into an SVG document.
 *
 * @param {object} built    result of buildIcon / buildRibbon
 * @param {object} icon     the icon table (for the source gradient definitions)
 * @param {object} [opts]   { yaw, pitch, size, light, shadeBands, tolerance, background }
 * @returns {{svg: string, stats: object}}
 */
export function exportSVG(built, icon, opts = {}) {
    const yaw = opts.yaw ?? 30, pitch = opts.pitch ?? 15;
    const size = opts.size ?? 512;
    const shadeBands = opts.shadeBands ?? 4;
    const { right, up, view } = axonometricBasis(yaw, pitch);
    const light = (() => {
        const l = opts.light || [-0.45, 0.72, 0.53];
        const n = Math.hypot(l[0], l[1], l[2]) || 1;
        return [l[0] / n, l[1] / n, l[2] / n];
    })();

    const pieces = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const piece of built.pieces) {
        const geo = piece.geometry;
        const pos = geo.getAttribute('position');
        const nrmAttr = geo.getAttribute('normal');
        const index = geo.index ? geo.index.array : null;
        const count = index ? index.length : pos.count;
        const zOffset = piece.mesh.position.z || 0;

        // Project vertices once. Model space is SVG units with y flipped, and
        // the mesh sits at its layer's z, so the SVG-space coordinate a vertex
        // came from is (x, −y) — which is what the gradient fit needs.
        const px = new Float64Array(pos.count), py = new Float64Array(pos.count), pd = new Float64Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i) + zOffset;
            px[i] = x * right[0] + y * right[1] + z * right[2];
            py[i] = x * up[0] + y * up[1] + z * up[2];
            pd[i] = x * view[0] + y * view[1] + z * view[2];
        }

        // Front-facing triangles, bucketed by how the light strikes them.
        const buckets = Array.from({ length: shadeBands }, () => []);
        const edgeUse = new Map();
        const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
        let depthSum = 0, depthN = 0;
        const srcPts = [], dstPts = [];
        for (let t = 0; t < count; t += 3) {
            const a = index ? index[t] : t, b = index ? index[t + 1] : t + 1, c = index ? index[t + 2] : t + 2;
            const area = (px[b] - px[a]) * (py[c] - py[a]) - (px[c] - px[a]) * (py[b] - py[a]);
            if (area <= 0) continue; // back-facing under this projection
            let nx = 0, ny = 0, nz = 0;
            for (const v of [a, b, c]) { nx += nrmAttr.getX(v); ny += nrmAttr.getY(v); nz += nrmAttr.getZ(v); }
            const nl = Math.hypot(nx, ny, nz) || 1;
            const lambert = Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / nl);
            const band = Math.min(shadeBands - 1, Math.floor(lambert * shadeBands));
            buckets[band].push([a, b, c]);
            depthSum += (pd[a] + pd[b] + pd[c]) / 3; depthN++;
            for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                const k = key(u, v);
                const e = edgeUse.get(k);
                if (e) e.n++; else edgeUse.set(k, { n: 1, a: u, b: v });
            }
            if (srcPts.length < 4000) {
                for (const v of [a, b, c]) { srcPts.push([pos.getX(v), -pos.getY(v)]); dstPts.push([px[v], py[v]]); }
            }
        }
        if (!depthN) continue;

        // Outer boundary of the visible surface: the edges used once, chained.
        const boundary = [];
        for (const { n, a, b } of edgeUse.values()) if (n === 1) boundary.push([a, b]);
        // Direct the boundary consistently by walking the front-facing triangles.
        const directed = [];
        for (const band of buckets) {
            for (const [a, b, c] of band) {
                for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                    if (edgeUse.get(key(u, v)).n === 1) directed.push([u, v]);
                }
            }
        }
        // A bevelled plate's front-facing set is speckled with slivers where
        // the bevel turns away, and each one chains into its own loop: the
        // plates build came out at 4162 loops and 450 KB before this filter,
        // which is a drawing no diagram tool wants to open. Areas are compared
        // against the piece's own footprint, so the threshold means the same
        // thing at any icon scale.
        let loops = chainLoops(directed)
            .map((loop) => simplifyLoop(loop.map((i) => [px[i], py[i]]), opts.tolerance ?? 0.004))
            .filter((l) => l.length >= 3);
        if (!loops.length) continue;
        const biggest = loops.reduce((m, l) => Math.max(m, loopArea(l)), 0);
        const minArea = biggest * (opts.minLoopArea ?? 0.004);
        loops = loops.filter((l) => loopArea(l) >= minArea);
        if (!loops.length) continue;

        const affine = fitAffine(srcPts, dstPts);
        for (const l of loops) for (const [x, y] of l) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }

        // Shading overlays: the boundary of each luminance bucket.
        const shades = [];
        for (let bi = 0; bi < shadeBands; bi++) {
            const tris = buckets[bi];
            if (!tris.length) continue;
            const use = new Map();
            for (const [a, b, c] of tris) {
                for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                    const k = key(u, v);
                    const e = use.get(k);
                    if (e) e.n++; else use.set(k, { n: 1, a: u, b: v });
                }
            }
            const dir = [];
            for (const [a, b, c] of tris) {
                for (const [u, v] of [[a, b], [b, c], [c, a]]) if (use.get(key(u, v)).n === 1) dir.push([u, v]);
            }
            let shadeLoops = chainLoops(dir)
                .map((loop) => simplifyLoop(loop.map((i) => [px[i], py[i]]), (opts.tolerance ?? 0.004) * 1.5))
                .filter((l) => l.length >= 3);
            if (!shadeLoops.length) continue;
            const shadeBiggest = shadeLoops.reduce((m, l) => Math.max(m, loopArea(l)), 0);
            shadeLoops = shadeLoops.filter((l) => loopArea(l) >= shadeBiggest * (opts.minLoopArea ?? 0.004));
            if (!shadeLoops.length) continue;
            // band 0 = facing away from the light, darkest.
            const t = shadeBands > 1 ? bi / (shadeBands - 1) : 1;
            shades.push({ loops: shadeLoops, dark: 1 - t });
        }

        pieces.push({
            id: piece.id, index: piece.index, depth: depthSum / depthN, loops, shades,
            affine, fill: piece.resolvedFill || icon.pieces[piece.index].fill, compiledBase: piece.fill.base,
        });
    }

    // Painter's order: furthest from the eye first.
    pieces.sort((a, b) => a.depth - b.depth);

    const w = maxX - minX, h = maxY - minY;
    const pad = Math.max(w, h) * 0.04;
    const scale = size / (Math.max(w, h) + 2 * pad);
    const toPath = (loops) => loops.map((l) =>
        'M' + l.map(([x, y], i) => `${i ? 'L' : ''}${fmt((x - minX + pad) * scale)} ${fmt((maxY - y + pad) * scale)}`).join(' ') + 'Z').join(' ');
    // Model → SVG-document affine, for carrying the gradients across.
    const docOf = (m) => m && [
        m[0] * scale, -m[1] * scale, m[2] * scale, -m[3] * scale,
        (m[4] - minX + pad) * scale, (maxY - m[5] + pad) * scale,
    ];

    const defs = [];
    const body = [];
    pieces.forEach((p, i) => {
        const gid = `g${i}_${p.id}`;
        const doc = docOf(p.affine);
        let fill;
        if (typeof p.fill.base === 'string') {
            fill = p.fill.base;
        } else if (!doc) {
            // No affine could be fitted (a degenerate projection); fall back to
            // the gradient's own midpoint colour rather than emitting nothing.
            const [r, g, b] = evaluateFill({ base: p.compiledBase, overlay: null }, 0, 0);
            fill = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        } else {
            // The source gradient's own gradientTransform still applies in SVG
            // space; the fitted affine takes SVG space to the page, so the two
            // compose — model-space first, then the projection.
            const g = p.fill.base;
            defs.push(gradientMarkup(gid, g, composeAffine(doc, parseTransform(g.transform))));
            fill = `url(#${gid})`;
        }
        const parts = [`  <path d="${toPath(p.loops)}" fill="${fill}"/>`];
        if (p.fill.overlay && doc) {
            const oid = gid + '_sheen';
            defs.push(gradientMarkup(oid, p.fill.overlay, composeAffine(doc, parseTransform(p.fill.overlay.transform))));
            parts.push(`  <path d="${toPath(p.loops)}" fill="url(#${oid})"/>`);
        }
        for (const s of p.shades) {
            const alpha = 0.26 * s.dark;
            if (alpha < 0.02) continue;
            parts.push(`  <path d="${toPath(s.loops)}" fill="#0b1020" fill-opacity="${fmt(alpha)}"/>`);
        }
        body.push(`<g id="${p.id}" data-piece="${p.id}">\n${parts.join('\n')}\n</g>`);
    });

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(size)} ${fmt(size * (h + 2 * pad) / (w + 2 * pad))}" width="${fmt(size)}">`,
        `<title>${icon.name} — axonometric, yaw ${fmt(yaw)}° pitch ${fmt(pitch)}°</title>`,
        `<defs>\n${defs.join('\n')}\n</defs>`,
        ...(opts.background ? [`<rect width="100%" height="100%" fill="${opts.background}"/>`] : []),
        ...body,
        '</svg>',
    ].join('\n');

    return {
        svg,
        stats: {
            pieces: pieces.length,
            loops: pieces.reduce((n, p) => n + p.loops.length, 0),
            points: pieces.reduce((n, p) => n + p.loops.reduce((k, l) => k + l.length, 0), 0),
            shadePaths: pieces.reduce((n, p) => n + p.shades.length, 0),
            bytes: svg.length,
            order: pieces.map((p) => p.id),
        },
    };
}

/** Trigger a browser download of an SVG string. */
export function downloadSVG(svg, filename) {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Evaluate a compiled fill at a point — re-exported so callers need one import. */
export { evaluateFill };
