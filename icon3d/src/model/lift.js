/**
 * model/lift.js — turn a flat outline into a curved, thick, watertight sheet.
 *
 * Pure: no THREE, no DOM. The plates builder relies on ExtrudeGeometry, whose
 * cap is a handful of triangles spanning the whole outline — fine for a flat
 * plate, useless the moment the plate has to BEND, because a z-field sampled at
 * the outline vertices alone leaves the interior flat. Everything here exists
 * to give a plate an interior:
 *
 *   subdividePlanar  — longest-edge bisection of a 2D triangulation until no
 *                      edge is longer than `maxEdge`. Edge splits are shared
 *                      between neighbours so the mesh stays a valid manifold and
 *                      the outline stays exactly on its original segments
 *                      (midpoints of straight edges lie on them).
 *   boundaryLoops    — the ordered rims of a triangle sheet, from edges used once.
 *   thickenSheet     — front sheet, back sheet offset along the vertex normals,
 *                      and walls along every rim: one closed, outward-wound solid.
 *   gridSheet        — a (u,v) grid of any parametric patch, for ruled bands.
 *
 * Triangulating the outline itself is left to the caller (THREE.ShapeUtils in
 * the browser, three-real in tests): earcut is the one thing not worth
 * re-implementing.
 */

/** Split a 2D triangulation until every edge is at most `maxEdge` long. */
export function subdividePlanar(vertices, triangles, maxEdge, maxRounds = 12) {
    let verts = vertices.map((v) => [v[0], v[1]]);
    let tris = triangles.map((t) => [t[0], t[1], t[2]]);
    const max2 = maxEdge * maxEdge;
    for (let round = 0; round < maxRounds; round++) {
        const mids = new Map();
        const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
        let any = false;
        for (const t of tris) {
            for (let e = 0; e < 3; e++) {
                const a = t[e], b = t[(e + 1) % 3];
                const dx = verts[a][0] - verts[b][0], dy = verts[a][1] - verts[b][1];
                if (dx * dx + dy * dy > max2) {
                    const k = key(a, b);
                    if (!mids.has(k)) {
                        mids.set(k, verts.length);
                        verts.push([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2]);
                    }
                    any = true;
                }
            }
        }
        if (!any) break;
        const next = [];
        for (const t of tris) {
            const [a, b, c] = t;
            const mab = mids.get(key(a, b)), mbc = mids.get(key(b, c)), mca = mids.get(key(c, a));
            const n = (mab !== undefined) + (mbc !== undefined) + (mca !== undefined);
            if (n === 0) { next.push(t); continue; }
            if (n === 3) {
                next.push([a, mab, mca], [mab, b, mbc], [mca, mbc, c], [mab, mbc, mca]);
                continue;
            }
            // Rotate so the split edges come first: cases (ab), (ab,bc).
            let v = [a, b, c], m = [mab, mbc, mca];
            const rot = () => { v = [v[1], v[2], v[0]]; m = [m[1], m[2], m[0]]; };
            if (n === 1) {
                while (m[0] === undefined) rot();
                // split ab only: (a, mab, c) (mab, b, c)
                next.push([v[0], m[0], v[2]], [m[0], v[1], v[2]]);
            } else {
                while (!(m[0] !== undefined && m[1] !== undefined)) rot();
                // split ab and bc: (a, mab, c) (mab, mbc, c) (mab, b, mbc)
                next.push([v[0], m[0], v[2]], [m[0], m[1], v[2]], [m[0], v[1], m[1]]);
            }
        }
        tris = next;
    }
    return { vertices: verts, triangles: tris };
}

/** Ordered boundary loops of a triangle sheet (edges used by exactly one triangle). */
export function boundaryLoops(triangles) {
    const count = new Map();
    const dir = new Map(); // directed boundary edge a→b in the winding order of its triangle
    for (const [a, b, c] of triangles) {
        for (const [p, q] of [[a, b], [b, c], [c, a]]) {
            const k = p < q ? `${p}_${q}` : `${q}_${p}`;
            count.set(k, (count.get(k) || 0) + 1);
            dir.set(k, [p, q]);
        }
    }
    const nextOf = new Map();
    for (const [k, c] of count) if (c === 1) { const [p, q] = dir.get(k); nextOf.set(p, q); }
    const loops = [];
    const used = new Set();
    for (const start of nextOf.keys()) {
        if (used.has(start)) continue;
        const loop = [];
        let cur = start;
        while (cur !== undefined && !used.has(cur)) {
            used.add(cur);
            loop.push(cur);
            cur = nextOf.get(cur);
        }
        if (loop.length >= 3) loops.push(loop);
    }
    return loops;
}

function accumulateNormals(positions, triangles) {
    const n = new Float64Array(positions.length);
    for (const [a, b, c] of triangles) {
        const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
        const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
        const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // area-weighted
        for (const i of [a, b, c]) { n[i * 3] += nx; n[i * 3 + 1] += ny; n[i * 3 + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
        const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
        n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    return n;
}

/**
 * Give a lifted sheet real thickness.
 *
 * The walls reuse the rim vertices of the front and back sheets rather than
 * carrying copies of their own. That keeps the solid watertight BY INDEX (the
 * audit in sweep.js can prove it) and shades the rim as a soft edge — the wall
 * interpolates from the front normal to the back normal across its height, the
 * look of a small fillet without the triangles for one.
 *
 * @param {ArrayLike<number>} positions  xyz of the FRONT sheet (already lifted)
 * @param {number[][]} triangles  front sheet triangles, wound so their normal
 *   faces the viewer (+z for a front-facing plate)
 * @param {number} thickness  offset of the back sheet along −normal
 * @param {{loops?: number[][]}} [opts]  precomputed boundary loops
 * @returns {{positions: Float32Array, normals: Float32Array, indices: Uint32Array, frontCount: number}}
 */
export function thickenSheet(positions, triangles, thickness, opts = {}) {
    const count = positions.length / 3;
    const normals = accumulateNormals(positions, triangles);
    const loops = opts.loops || boundaryLoops(triangles);

    const out = new Float32Array(count * 6);
    const outN = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
        out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
        outN[i * 3] = nx; outN[i * 3 + 1] = ny; outN[i * 3 + 2] = nz;
        const j = count + i;
        out[j * 3] = x - nx * thickness; out[j * 3 + 1] = y - ny * thickness; out[j * 3 + 2] = z - nz * thickness;
        outN[j * 3] = -nx; outN[j * 3 + 1] = -ny; outN[j * 3 + 2] = -nz;
    }

    const indices = [];
    for (const [a, b, c] of triangles) {
        indices.push(a, b, c);                         // front
        indices.push(count + a, count + c, count + b); // back, reversed
    }
    // Walls. A rim loop runs in the front sheet's winding order, so the quad
    // (front k, back k, front k+1, back k+1) wound as below faces outward.
    for (const loop of loops) {
        const L = loop.length;
        for (let k = 0; k < L; k++) {
            const i0 = loop[k], i1 = loop[(k + 1) % L];
            indices.push(i0, count + i0, i1, i1, count + i0, count + i1);
        }
    }
    return { positions: out, normals: outN, indices: new Uint32Array(indices), frontCount: count };
}

/**
 * A (u,v) grid over a parametric patch. `pointAt(u, v)` returns [x, y, z].
 * Triangles are wound so that (∂/∂u × ∂/∂v) is the front.
 */
export function gridSheet(nu, nv, pointAt) {
    const positions = new Float64Array((nu + 1) * (nv + 1) * 3);
    const uvs = [];
    let p = 0;
    for (let i = 0; i <= nu; i++) {
        for (let j = 0; j <= nv; j++) {
            const u = i / nu, v = j / nv;
            const pt = pointAt(u, v);
            positions[p++] = pt[0]; positions[p++] = pt[1]; positions[p++] = pt[2];
            uvs.push([u, v]);
        }
    }
    const triangles = [];
    for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
            const a = i * (nv + 1) + j, b = a + 1, c = a + (nv + 1), d = c + 1;
            triangles.push([a, c, b], [b, c, d]);
        }
    }
    return { positions, triangles, uvs };
}
