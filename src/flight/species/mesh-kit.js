// PORTED from Birb Gauntlet (gauntlet/src/bird/realistic/mesh-kit.js) for the root
// game's bird picker. Gauntlet stays airtight: this is a copy, not an import.
// Root-game adaptations are marked "ROOT:".
/**
 * realistic/mesh-kit.js — the geometry kit the realistic birds are built
 * from. PURE: no THREE, no DOM.
 *
 * Why pure. The realistic crow and owl are the two most expensive objects in
 * the race, and their budgets (draw calls, triangles, gear meshing) are the
 * contract. Building every vertex in plain arrays means the tests can measure
 * the real mesh — the one the game uploads — with no WebGL and no stub of
 * three's geometry classes. `realistic-bird.js` is the only place that turns
 * a MeshData into a BufferGeometry, and it copies the arrays verbatim.
 *
 * Vocabulary:
 *   - a PRIM is a local primitive: { pos, nrm, uv, idx } plain arrays.
 *   - a MESHDATA is one future draw call: named attribute arrays laid out by a
 *     LAYOUT, plus an index. `stamp()` transforms a prim into it and paints the
 *     per-vertex attributes (colour, surface, deformer weights) as it goes.
 *
 * Conventions match the rest of Gauntlet: forward is -Z, up is +Y, the bird's
 * right is +X. Every attribute a material's shader declares is present on
 * every vertex of every mesh that uses it — a missing attribute in WebGL reads
 * whatever the last program left in that slot, which is how a feather ends up
 * spinning like a gear.
 *
 * Build time only. Nothing here runs per frame, so it allocates freely.
 */

import { hexToLinear } from './film.js';

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

/**
 * Per-vertex attributes, by item size.
 *   aSurf  (metalness, roughness, film weight, clearcoat weight)
 *   aDef   wing deformer: (hand weight, splay factor, pivot x, pivot z)
 *   aMask  1 on the eye (blink), 0 elsewhere
 *   uv1    the owl's engraving atlas (plates), blank elsewhere
 *   aGear  (pivot x, y, z, ratio) for anything that spins rigidly
 *   aAxis  (axis x, y, z, kind): kind 0 none, 1 gear, 2 wind-up key
 */
export const LAYOUT_FEATHER = Object.freeze({
    position: 3, normal: 3, uv: 2, color: 3, aSurf: 4, aDef: 4, aMask: 1,
});
export const LAYOUT_MECH = Object.freeze({
    position: 3, normal: 3, uv: 2, uv1: 2, color: 3, aSurf: 4, aDef: 4, aMask: 1, aGear: 4, aAxis: 4,
});

/** uv1 for geometry that is not an engraved plate: the atlas's blank band. */
export const UV1_BLANK = Object.freeze([0.5, 0.965]);

const DEFAULTS = {
    uv1: UV1_BLANK,
    aSurf: [0, 0.6, 0, 0],
    aDef: [0, 0, 0, 0],
    aMask: [0],
    aGear: [0, 0, 0, 0],
    aAxis: [0, 0, 0, 0],
};

export function createMeshData(layout, name) {
    const arrays = {};
    for (const k in layout) arrays[k] = [];
    return { name: name || 'mesh', layout, arrays, index: [], vertexCount: 0 };
}

export function triangleCount(md) {
    return md.index.length / 3;
}

// ---------------------------------------------------------------------------
// 3x4 affine matrices (row-major, translation in [3], [7], [11])
// ---------------------------------------------------------------------------

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

/**
 * Compose translate * rotate(Euler 'YXZ') * scale — the same convention as
 * bird-model.js's `xform` (and three's Euler order 'YXZ': R = Ry * Rx * Rz).
 */
export function trs(tx, ty, tz, rx, ry, rz, sx, sy, sz) {
    rx = rx || 0; ry = ry || 0; rz = rz || 0;
    sx = sx === undefined ? 1 : sx;
    sy = sy === undefined ? sx : sy;
    sz = sz === undefined ? sx : sz;
    const cx = Math.cos(rx), sxr = Math.sin(rx);
    const cy = Math.cos(ry), syr = Math.sin(ry);
    const cz = Math.cos(rz), szr = Math.sin(rz);
    // Ry * Rx
    const a00 = cy, a01 = syr * sxr, a02 = syr * cx;
    const a10 = 0, a11 = cx, a12 = -sxr;
    const a20 = -syr, a21 = cy * sxr, a22 = cy * cx;
    // (Ry * Rx) * Rz
    const r00 = a00 * cz + a01 * szr, r01 = -a00 * szr + a01 * cz, r02 = a02;
    const r10 = a10 * cz + a11 * szr, r11 = -a10 * szr + a11 * cz, r12 = a12;
    const r20 = a20 * cz + a21 * szr, r21 = -a20 * szr + a21 * cz, r22 = a22;
    return [
        r00 * sx, r01 * sy, r02 * sz, tx || 0,
        r10 * sx, r11 * sy, r12 * sz, ty || 0,
        r20 * sx, r21 * sy, r22 * sz, tz || 0,
    ];
}

/** a * b (b applied first). */
export function mul(a, b) {
    const o = new Array(12);
    for (let r = 0; r < 3; r++) {
        const i = r * 4;
        o[i] = a[i] * b[0] + a[i + 1] * b[4] + a[i + 2] * b[8];
        o[i + 1] = a[i] * b[1] + a[i + 1] * b[5] + a[i + 2] * b[9];
        o[i + 2] = a[i] * b[2] + a[i + 1] * b[6] + a[i + 2] * b[10];
        o[i + 3] = a[i] * b[3] + a[i + 1] * b[7] + a[i + 2] * b[11] + a[i + 3];
    }
    return o;
}

/** Rotation taking +Y onto the unit vector (ax, ay, az), then translate. */
export function alignY(tx, ty, tz, ax, ay, az, scale) {
    const l = Math.hypot(ax, ay, az) || 1;
    ax /= l; ay /= l; az /= l;
    // Rodrigues: rotate +Y onto a about k = y x a.
    let kx = az, ky = 0, kz = -ax;
    const s = Math.hypot(kx, kz);
    const c = ay;
    const k = scale === undefined ? 1 : scale;
    if (s < 1e-9) {
        const f = c >= 0 ? 1 : -1;
        return [k, 0, 0, tx, 0, f * k, 0, ty, 0, 0, f * k, tz];
    }
    kx /= s; kz /= s;
    const v = 1 - c;
    const m00 = c + kx * kx * v, m01 = -kz * s, m02 = kx * kz * v;
    const m10 = kz * s, m11 = c, m12 = -kx * s;
    const m20 = kz * kx * v, m21 = kx * s, m22 = c + kz * kz * v;
    return [m00 * k, m01 * k, m02 * k, tx, m10 * k, m11 * k, m12 * k, ty, m20 * k, m21 * k, m22 * k, tz];
}

export function applyPoint(m, x, y, z, out) {
    out[0] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[2] = m[8] * x + m[9] * y + m[10] * z + m[11];
    return out;
}

function det3(m) {
    return m[0] * (m[5] * m[10] - m[6] * m[9])
        - m[1] * (m[4] * m[10] - m[6] * m[8])
        + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

/** Cofactor matrix of the 3x3 part: the inverse-transpose up to scale. */
function cofactor(m) {
    return [
        m[5] * m[10] - m[6] * m[9], -(m[4] * m[10] - m[6] * m[8]), m[4] * m[9] - m[5] * m[8],
        -(m[1] * m[10] - m[2] * m[9]), m[0] * m[10] - m[2] * m[8], -(m[0] * m[9] - m[1] * m[8]),
        m[1] * m[6] - m[2] * m[5], -(m[0] * m[6] - m[2] * m[4]), m[0] * m[5] - m[1] * m[4],
    ];
}

// ---------------------------------------------------------------------------
// Prims
// ---------------------------------------------------------------------------

export function emptyPrim() {
    return { pos: [], nrm: null, uv: [], idx: [] };
}

/**
 * Area-weighted vertex normals. `weld` averages vertices that share a
 * position (UV seams, the duplicated first column of a loft) so a seam does
 * not show as a crease in the shading.
 */
export function computeNormals(prim, weld) {
    const p = prim.pos, idx = prim.idx;
    const n = new Array(p.length).fill(0);
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
    }
    if (weld !== false) {
        const buckets = new Map();
        for (let i = 0; i < p.length; i += 3) {
            const key = Math.round(p[i] * 1e5) + '|' + Math.round(p[i + 1] * 1e5) + '|' + Math.round(p[i + 2] * 1e5);
            let list = buckets.get(key);
            if (!list) { list = []; buckets.set(key, list); }
            list.push(i);
        }
        buckets.forEach((list) => {
            if (list.length < 2) return;
            let x = 0, y = 0, z = 0;
            for (const i of list) { x += n[i]; y += n[i + 1]; z += n[i + 2]; }
            for (const i of list) { n[i] = x; n[i + 1] = y; n[i + 2] = z; }
        });
    }
    for (let i = 0; i < n.length; i += 3) {
        const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
        if (l > 1e-12) { n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; } else { n[i + 1] = 1; }
    }
    prim.nrm = n;
    return prim;
}

/**
 * Safety net for hand-wound closed shells (the same one bird-model.js has):
 * if the summed normal points INTO the centroid, reverse the winding.
 */
export function orientOutward(prim) {
    computeNormals(prim, true);
    const p = prim.pos, n = prim.nrm;
    const count = p.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
    cx /= count; cy /= count; cz /= count;
    let dot = 0;
    for (let i = 0; i < p.length; i += 3) dot += (p[i] - cx) * n[i] + (p[i + 1] - cy) * n[i + 1] + (p[i + 2] - cz) * n[i + 2];
    if (dot < 0) {
        const idx = prim.idx;
        for (let t = 0; t < idx.length; t += 3) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
        computeNormals(prim, true);
    }
    return prim;
}

/** Superellipse component: sign(c) * |c|^(2/p). p = 2 is a circle. */
function se(c, p) {
    return Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
}

/**
 * A lofted shell along Z: one ring per row, each an ellipse whose upper and
 * lower half-heights differ (`t`, `b`) and whose top and bottom can each be
 * flattened (`pTop`, `pBot` > 2 squares a half off; < 2 points it). Ring
 * vertex 0 is the top (+Y), and the ring runs toward +X.
 *
 * rows: [{ z, y, x?, w, t, b }] in order; uv: u = around the girth in
 * `uvScale` units, v = accumulated length. `uTiles` instead fixes u to that
 * many tiles around EVERY row — a whole number, so a tiling feather sheet
 * meets itself at the dorsal seam, and the feathers shrink where the girth
 * does (the neck), which is what real contour feathers do.
 */
export function loft(rows, segs, opts = {}) {
    const pTop = opts.pTop || 2, pBot = opts.pBot || 2;
    const us = opts.uvScale === undefined ? 1 : opts.uvScale;
    const uTiles = opts.uTiles || 0;
    const prim = emptyPrim();
    let run = 0;
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (r > 0) {
            const q = rows[r - 1];
            run += Math.hypot(row.z - q.z, row.y - q.y);
        }
        const girth = Math.PI * (row.w + (row.t + row.b) * 0.5);
        for (let k = 0; k <= segs; k++) {
            const a = (k / segs) * Math.PI * 2;
            const ca = Math.cos(a), sa = Math.sin(a);
            const top = ca >= 0;
            const p = top ? pTop : pBot;
            const x = (row.x || 0) + row.w * se(sa, p);
            const y = row.y + (top ? row.t : row.b) * se(ca, p);
            prim.pos.push(x, y, row.z);
            prim.uv.push(uTiles ? (k / segs) * uTiles : (k / segs) * girth * us, run * us);
        }
    }
    const stride = segs + 1;
    // Winding picked so the shell faces OUT whichever way the rows run;
    // orientOutward below makes that a guarantee rather than a hope.
    for (let r = 0; r < rows.length - 1; r++) {
        for (let k = 0; k < segs; k++) {
            const a = r * stride + k, b = a + 1, c = a + stride, d = c + 1;
            prim.idx.push(a, c, b, b, c, d);
        }
    }
    const cap = (r, flip) => {
        const row = rows[r];
        const centre = prim.pos.length / 3;
        prim.pos.push(row.x || 0, row.y, row.z);
        prim.uv.push(0.5 * Math.PI * row.w * us, (r === 0 ? 0 : run) * us);
        for (let k = 0; k < segs; k++) {
            const a = r * stride + k, b = a + 1;
            if (flip) prim.idx.push(centre, b, a); else prim.idx.push(centre, a, b);
        }
    };
    if (opts.capStart) cap(0, false);
    if (opts.capEnd) cap(rows.length - 1, true);
    return opts.open ? computeNormals(prim, true) : orientOutward(prim);
}

/** Lathe a [radius, y] profile about +Y. uv: u around, v along the profile. */
export function lathe(profile, segs, opts = {}) {
    const prim = emptyPrim();
    const a0 = opts.angle0 || 0, span = opts.span || Math.PI * 2;
    const closed = span >= Math.PI * 2 - 1e-6;
    const cols = closed ? segs + 1 : segs + 1;
    let run = 0;
    for (let r = 0; r < profile.length; r++) {
        if (r > 0) run += Math.hypot(profile[r][0] - profile[r - 1][0], profile[r][1] - profile[r - 1][1]);
        for (let k = 0; k < cols; k++) {
            const a = a0 + (k / segs) * span;
            const rad = profile[r][0];
            prim.pos.push(Math.sin(a) * rad, profile[r][1], Math.cos(a) * rad);
            prim.uv.push(k / segs, run);
        }
    }
    for (let r = 0; r < profile.length - 1; r++) {
        for (let k = 0; k < segs; k++) {
            const a = r * cols + k, b = a + 1, c = a + cols, d = c + 1;
            prim.idx.push(a, b, c, b, d, c);
        }
    }
    computeNormals(prim, true);
    if (opts.flip) {
        for (let t = 0; t < prim.idx.length; t += 3) { const k = prim.idx[t + 1]; prim.idx[t + 1] = prim.idx[t + 2]; prim.idx[t + 2] = k; }
        computeNormals(prim, true);
    }
    return prim;
}

/** UV sphere / ellipsoid of radii (rx, ry, rz). */
export function ellipsoid(rx, ry, rz, segU, segV) {
    const profile = [];
    for (let i = 0; i <= segV; i++) {
        const t = Math.PI * (i / segV);
        profile.push([Math.sin(t), -Math.cos(t)]);
    }
    const prim = lathe(profile, segU);
    for (let i = 0; i < prim.pos.length; i += 3) {
        prim.pos[i] *= rx; prim.pos[i + 1] *= ry; prim.pos[i + 2] *= rz;
    }
    return computeNormals(prim, true);
}

/** Cylinder along +Y from y0 to y1, optionally capped. */
export function cylinder(r0, r1, y0, y1, segs, capBottom, capTop) {
    const prim = lathe([[r0, y0], [r1, y1]], segs);
    const fan = (y, r, up) => {
        const c = prim.pos.length / 3;
        prim.pos.push(0, y, 0); prim.uv.push(0.5, 0.5);
        const start = prim.pos.length / 3;
        for (let k = 0; k <= segs; k++) {
            const a = (k / segs) * Math.PI * 2;
            prim.pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
            prim.uv.push(0.5 + Math.sin(a) * 0.5, 0.5 + Math.cos(a) * 0.5);
        }
        for (let k = 0; k < segs; k++) {
            if (up) prim.idx.push(c, start + k, start + k + 1);
            else prim.idx.push(c, start + k + 1, start + k);
        }
    };
    if (capBottom) fan(y0, r0, false);
    if (capTop) fan(y1, r1, true);
    return computeNormals(prim, false);
}

/**
 * A flat polygon (CCW in XZ seen from +Y) extruded from y = 0 to y = h. Top
 * face as a fan from the centroid, side walls with their own (hard) normals.
 * Bottom omitted unless asked: most of these sit on a surface.
 */
export function extrude(poly, h, opts = {}) {
    const prim = emptyPrim();
    const n = poly.length;
    let cx = 0, cz = 0;
    for (const p of poly) { cx += p[0]; cz += p[1]; }
    cx /= n; cz /= n;
    const face = (y, up) => {
        const c = prim.pos.length / 3;
        prim.pos.push(cx, y, cz); prim.uv.push(0.5, 0.5);
        const s = prim.pos.length / 3;
        for (const p of poly) { prim.pos.push(p[0], y, p[1]); prim.uv.push(p[0], p[1]); }
        for (let k = 0; k < n; k++) {
            const a = s + k, b = s + ((k + 1) % n);
            if (up) prim.idx.push(c, b, a); else prim.idx.push(c, a, b);
        }
    };
    face(h, true);
    if (opts.bottom) face(0, false);
    // Walls: separate verts per quad so the rim stays a hard edge.
    for (let k = 0; k < n; k++) {
        const p = poly[k], q = poly[(k + 1) % n];
        const s = prim.pos.length / 3;
        prim.pos.push(p[0], 0, p[1], q[0], 0, q[1], q[0], h, q[1], p[0], h, p[1]);
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        prim.uv.push(0, 0, len, 0, len, h, 0, h);
        prim.idx.push(s, s + 2, s + 1, s, s + 3, s + 2);
    }
    computeNormals(prim, false);
    return prim;
}

/**
 * One feather (or one engraved metal plate): a cambered strip with a raised
 * rachis, lying along +Z from its root, width across X, top face +Y.
 *
 * UVs are per-feather, the convention the vane texture is drawn in: u runs
 * across the WHOLE feather (0 outer edge, 0.5 rachis, 1 inner edge), v runs
 * root (0) to tip (1). So the barb chevron in the texture mirrors across the
 * shaft on every feather — the thing Birb Mobile could not do with one UV
 * frame per plate (see plumage.js, "anisotropy is deliberately not used").
 *
 * opts:
 *   len          length
 *   wOut, wIn    half-widths of the outer (-X) and inner (+X) vane
 *   segs         rows along the length (the tip is the last row)
 *   cols         2 (edge-rachis-edge) or 4 (adds a mid-vane row each side)
 *   tip          0 pointed .. 1 round
 *   root         width fraction at the root
 *   emarg        { at, neg, pos } past `at` along the shaft, narrow the -X
 *                vane by `neg` and the +X vane by `pos` (fractions removed) —
 *                the emargination and notch that turn a crow's outer
 *                primaries into FINGERS with open slots between them.
 *   bow          camber along the length (+Y at mid-length)
 *   droop        how far the vane edges sit below the rachis
 *   curve        rachis bend toward +X at the tip (primaries curve back)
 *   twist        rotation about the shaft, growing to the tip (radians)
 *   rachis       ridge height
 */
export function featherPlate(o) {
    const segs = Math.max(2, o.segs | 0);
    const cols = o.cols === 4 ? 4 : 2;
    const len = o.len;
    const tip = o.tip === undefined ? 0.6 : o.tip;
    const root = o.root === undefined ? 0.55 : o.root;
    const prim = emptyPrim();
    // Column positions as a fraction of each vane's half-width, from the
    // outer edge (-1) through the rachis (0) to the inner edge (+1).
    const fr = cols === 4 ? [-1, -0.5, 0, 0.5, 1] : [-1, 0, 1];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        // Width envelope: narrow root, full by ~20%, then a tip that is
        // round (ellipse) or pointed (linear) by `tip`.
        let env = root + (1 - root) * Math.min(1, t / 0.2);
        const tipStart = 0.62;
        if (t > tipStart) {
            const k = (t - tipStart) / (1 - tipStart);
            const round = Math.sqrt(Math.max(0, 1 - k * k));
            env *= tip * round + (1 - tip) * (1 - k);
        }
        let notchOut = 1, notchIn = 1;
        if (o.emarg) {
            const e = o.emarg;
            const s = Math.min(1, Math.max(0, (t - (e.at - 0.10)) / 0.14));
            const sm = s * s * (3 - 2 * s);
            notchOut = 1 - (e.neg || 0) * sm;
            notchIn = 1 - (e.pos || 0) * sm;
        }
        const bow = (o.bow || 0) * Math.sin(Math.PI * t);
        const bend = (o.curve || 0) * t * t;
        const tw = (o.twist || 0) * t;
        const ct = Math.cos(tw), st = Math.sin(tw);
        for (let c = 0; c < fr.length; c++) {
            const f = fr[c];
            const half = f < 0 ? o.wOut * notchOut : o.wIn * notchIn;
            let x = f * half * env;
            // The vanes droop away from the shaft: a tent, not a board.
            let y = bow + (f === 0 ? (o.rachis || 0) * (1 - t * 0.7) : -(o.droop || 0) * Math.abs(f) * env);
            // Twist about the shaft.
            const xr = x * ct - y * st, yr = x * st + y * ct;
            prim.pos.push(xr + bend, yr, t * len);
            prim.uv.push((f + 1) * 0.5, t);
        }
    }
    const w = fr.length;
    for (let i = 0; i < segs; i++) {
        for (let c = 0; c < w - 1; c++) {
            const a = i * w + c, b = a + 1, d = a + w, e = d + 1;
            // Top face +Y with length along +Z and width along +X.
            prim.idx.push(a, d, b, b, d, e);
        }
    }
    return computeNormals(prim, false);
}

/** The tip of a featherPlate in its own frame (its root is the origin). */
export function featherTip(o) {
    return [o.curve || 0, 0, o.len];
}

// ---------------------------------------------------------------------------
// Stamping
// ---------------------------------------------------------------------------

const _lin = new Map();
function lin(hex) {
    let c = _lin.get(hex);
    if (!c) { c = hexToLinear(hex); _lin.set(hex, c); }
    return c;
}

/**
 * Transform `prim` by `o.m` and append it to `md`, painting every attribute
 * in md's layout. Paint values are constants or functions
 * (x, y, z, u, v, lx, ly, lz) -> value, called with the TRANSFORMED position
 * and the prim's own uv and local position.
 *
 *   o.color   sRGB hex, or fn -> hex | linear [r,g,b]
 *   o.surf    [metal, rough, film, coat] or fn
 *   o.def     [hand, splay, pivotX, pivotZ] or fn
 *   o.mask    number or fn
 *   o.uv1     [u, v] or fn (owl plates)
 *   o.gear    [px, py, pz, ratio]   o.axis [ax, ay, az, kind]
 *   o.uvScale [su, sv] applied to the prim uv
 */
export function stamp(md, prim, o = {}) {
    if (!prim.nrm) computeNormals(prim, true);
    const m = o.m || IDENTITY;
    const cof = cofactor(m);
    const flip = det3(m) < 0;
    const A = md.arrays, L = md.layout;
    const base = md.vertexCount;
    const count = prim.pos.length / 3;
    const su = o.uvScale ? o.uvScale[0] : 1, sv = o.uvScale ? o.uvScale[1] : 1;
    const P = [0, 0, 0];
    for (let i = 0; i < count; i++) {
        const lx = prim.pos[i * 3], ly = prim.pos[i * 3 + 1], lz = prim.pos[i * 3 + 2];
        applyPoint(m, lx, ly, lz, P);
        const x = P[0], y = P[1], z = P[2];
        const nx0 = prim.nrm[i * 3], ny0 = prim.nrm[i * 3 + 1], nz0 = prim.nrm[i * 3 + 2];
        let nx = cof[0] * nx0 + cof[1] * ny0 + cof[2] * nz0;
        let ny = cof[3] * nx0 + cof[4] * ny0 + cof[5] * nz0;
        let nz = cof[6] * nx0 + cof[7] * ny0 + cof[8] * nz0;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const sg = flip ? -1 : 1;
        nx = nx / nl * sg; ny = ny / nl * sg; nz = nz / nl * sg;
        const u = prim.uv[i * 2] * su, v = prim.uv[i * 2 + 1] * sv;
        A.position.push(x, y, z);
        A.normal.push(nx, ny, nz);
        A.uv.push(u, v);
        // colour
        let c = o.color === undefined ? 0xffffff : o.color;
        if (typeof c === 'function') c = c(x, y, z, u, v, lx, ly, lz);
        const rgb = typeof c === 'number' ? lin(c) : c;
        A.color.push(rgb[0], rgb[1], rgb[2]);
        for (const name of ['aSurf', 'aDef', 'aMask', 'uv1', 'aGear', 'aAxis']) {
            if (!L[name]) continue;
            const key = name === 'aSurf' ? 'surf' : name === 'aDef' ? 'def' : name === 'aMask' ? 'mask'
                : name === 'uv1' ? 'uv1' : name === 'aGear' ? 'gear' : 'axis';
            let val = o[key];
            if (typeof val === 'function') val = val(x, y, z, u, v, lx, ly, lz);
            if (val === undefined) val = DEFAULTS[name];
            if (typeof val === 'number') A[name].push(val);
            else for (let k = 0; k < L[name]; k++) A[name].push(val[k]);
        }
    }
    const idx = prim.idx;
    for (let t = 0; t < idx.length; t += 3) {
        if (flip) md.index.push(base + idx[t], base + idx[t + 2], base + idx[t + 1]);
        else md.index.push(base + idx[t], base + idx[t + 1], base + idx[t + 2]);
    }
    md.vertexCount += count;
    return md;
}

/**
 * A mirror copy across X (the left wing from the right). Reflection reverses
 * winding, so the index is rewound — the same trap bird-model.js's mirrorX
 * documents. Deformer pivots and rigid-spin axes are mirrored with it, and a
 * spin's direction is negated (a reflected rotation turns the other way).
 */
export function mirrorX(md, name) {
    const out = createMeshData(md.layout, name || md.name);
    for (const k in md.arrays) out.arrays[k] = md.arrays[k].slice();
    const A = out.arrays;
    for (let i = 0; i < A.position.length; i += 3) { A.position[i] = -A.position[i]; A.normal[i] = -A.normal[i]; }
    if (A.aDef) for (let i = 0; i < A.aDef.length; i += 4) { A.aDef[i + 1] = -A.aDef[i + 1]; A.aDef[i + 2] = -A.aDef[i + 2]; }
    if (A.aGear) for (let i = 0; i < A.aGear.length; i += 4) { A.aGear[i] = -A.aGear[i]; A.aGear[i + 3] = -A.aGear[i + 3]; }
    if (A.aAxis) for (let i = 0; i < A.aAxis.length; i += 4) A.aAxis[i] = -A.aAxis[i];
    for (let t = 0; t < md.index.length; t += 3) out.index.push(md.index[t], md.index[t + 2], md.index[t + 1]);
    out.vertexCount = md.vertexCount;
    return out;
}

/** Axis-aligned bounds of a MeshData's positions. */
export function bounds(md) {
    const p = md.arrays.position;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            if (p[i + k] < min[k]) min[k] = p[i + k];
            if (p[i + k] > max[k]) max[k] = p[i + k];
        }
    }
    return { min, max };
}

/** Smoothstep, for painters. */
export function smooth(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/** Linear mix of two sRGB hexes in LINEAR space, returned as linear rgb. */
export function mixLin(hexA, hexB, t, out) {
    const a = lin(hexA), b = lin(hexB);
    const o = out || [0, 0, 0];
    o[0] = a[0] + (b[0] - a[0]) * t;
    o[1] = a[1] + (b[1] - a[1]) * t;
    o[2] = a[2] + (b[2] - a[2]) * t;
    return o;
}
