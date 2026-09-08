/**
 * model/sweep.js — rotation-minimising frames and ribbon sweeps.
 *
 * Pure: no THREE, no DOM. Ported from the band kernel of Dave, the one-way
 * mirror box at adamrappaport.vercel.app/dave (src/lib/dave/mirrorbox.ts),
 * where a Möbius band on a figure-eight closes with EXACTLY the requested
 * number of half-twists. Copied rather than imported on purpose: this artefact
 * is airtight, and the Dave kernel is TypeScript inside a Next.js app.
 *
 * Why not a Frenet frame: a centreline with an inflection (any S-curve, any
 * figure-eight) flips its Frenet normal there and a band built on it kinks
 * through 180° in one segment. The Bishop (parallel-transport) frame rotates
 * as little as possible from sample to sample, so the band carries no twist
 * the curve did not ask for. The frame does pick up HOLONOMY going round a
 * closed loop — a net rotation that depends on the curve's shape — and the
 * band builder subtracts it, otherwise "two half-twists" is two half-twists
 * plus whatever the loop smuggled in and the seam does not close.
 *
 * Two generalisations over Dave: the centreline is any list of points, open
 * or closed; and the strip can have real thickness, swept as a closed
 * cross-section polygon so the edges catch light and the object is a solid.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => { const l = length(a); return l > 0 ? scale(a, 1 / l) : [0, 0, 0]; };

/** Rotate vector v about unit axis k by angle theta (Rodrigues). */
export function rotateAbout(v, k, theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/**
 * Parallel-transport a normal along a polyline.
 *
 * @param {number[][]} points  [x,y,z] samples. For a closed curve the last
 *   point must NOT repeat the first; a closure frame at t = 1 is appended.
 * @param {{closed?: boolean, seed?: number[], tangents?: number[][]}} [opts]
 *   `seed` is the preferred initial normal (projected perpendicular to the
 *   first tangent); `tangents` supplies analytic unit tangents per point
 *   instead of finite differences (an open curve with a known derivative).
 * @returns {{frames: {point, tangent, normal, binormal}[], holonomy: number}}
 *   For a closed curve there are points.length + 1 frames, the last being the
 *   transported frame back at the start; `holonomy` is the angle it has
 *   turned relative to the first. Open curves have one frame per point and
 *   holonomy 0.
 */
export function frameCurve(points, opts = {}) {
    const closed = opts.closed !== false;
    const n = points.length;
    if (n < 2) throw new Error('sweep: need at least two points');
    const count = closed ? n + 1 : n;
    const pt = (i) => points[((i % n) + n) % n];

    const tangents = [];
    for (let i = 0; i < count; i++) {
        let t;
        if (opts.tangents) t = opts.tangents[i % n];
        else if (closed) t = sub(pt(i + 1), pt(i - 1));
        else if (i === 0) t = sub(points[1], points[0]);
        else if (i === n - 1) t = sub(points[n - 1], points[n - 2]);
        else t = sub(points[i + 1], points[i - 1]);
        tangents.push(normalize(t));
    }

    const t0 = tangents[0];
    const seed = opts.seed || (Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    let normal = normalize(sub(seed, scale(t0, dot(seed, t0))));
    if (length(normal) < 1e-9) normal = normalize(cross(t0, [0, 0, 1]));

    const frames = [];
    for (let i = 0; i < count; i++) {
        if (i > 0) {
            const tp = tangents[i - 1], tc = tangents[i];
            const axis = cross(tp, tc);
            const s = length(axis);
            const c = Math.max(-1, Math.min(1, dot(tp, tc)));
            if (s > 1e-12) normal = rotateAbout(normal, scale(axis, 1 / s), Math.atan2(s, c));
            normal = normalize(sub(normal, scale(tc, dot(normal, tc))));
        }
        const tangent = tangents[i];
        frames.push({ point: closed ? pt(i) : points[i], tangent, normal, binormal: cross(tangent, normal) });
    }

    let holonomy = 0;
    if (closed) {
        const a = frames[0], z = frames[n];
        holonomy = Math.atan2(dot(z.normal, a.binormal), dot(z.normal, a.normal));
    }
    return { frames, holonomy };
}

/**
 * A rounded-rectangle cross-section in the (across, normal) plane: width 2·hw,
 * thickness t, corner radius r, `k` samples per corner. Corners are listed
 * counter-clockwise starting at the front-face centre so the front face is
 * the run around v = 0 of the section parameter.
 */
export function roundedSection(hw, t, r, k = 3) {
    r = Math.min(r, hw, t / 2);
    const pts = [];
    const corner = (cx, cy, a0) => {
        for (let i = 0; i <= k; i++) {
            const a = a0 + (i / k) * (Math.PI / 2);
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
    };
    // Anticlockwise in the (across, normal) plane, "up" being the FRONT face:
    // front-right, front-left, back-left, back-right corners.
    corner(hw - r, t / 2 - r, 0);
    corner(-hw + r, t / 2 - r, Math.PI / 2);
    corner(-hw + r, -t / 2 + r, Math.PI);
    corner(hw - r, -t / 2 + r, Math.PI * 1.5);
    return pts;
}

/**
 * Sweep a cross-section along frames.
 *
 * @param {object} p
 * @param {{point,tangent,normal,binormal}[]} p.frames
 * @param {(u:number, i:number) => number} p.roll  angle of the section's
 *   across-axis from the frame normal, radians (twist goes here)
 * @param {(u:number, i:number) => number[][]} p.section  the 2D section at u,
 *   as [across, normalOffset] pairs (use `roundedSection`); may vary per u
 * @param {boolean} [p.closed]  join the last frame to the first
 * @param {(u:number, i:number) => number[]} [p.aux]  optional per-frame extra
 *   attribute (e.g. the SVG-space centre), copied to every vertex of the ring
 * @param {(u:number, i:number) => {across:number[], front:number[]}} [p.basis]
 *   explicit section axes per ring, replacing the frame-derived ones — for
 *   a ruled band whose rulings are not perpendicular to its edge, or a crease
 *   ring that shares a point with its neighbour but not an orientation
 * @returns {{positions:Float32Array, normals:Float32Array, uvs:Float32Array,
 *   aux:Float32Array|null, indices:Uint32Array, vertexCount:number, triangleCount:number}}
 */
export function sweepSection(p) {
    const frames = p.frames;
    const nu = frames.length;
    const rings = nu;
    const section0 = p.section(0, 0);
    const m = section0.length;
    const auxSize = p.aux ? p.aux(0, 0).length : 0;
    const vertexCount = rings * m; // one vertex per section point; the ring wraps by index
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const aux = auxSize ? new Float32Array(vertexCount * auxSize) : null;

    let vp = 0, vn = 0, vu = 0, va = 0;
    for (let i = 0; i < rings; i++) {
        const u = nu > 1 ? i / (nu - 1) : 0;
        const f = frames[i];
        let across, outward;
        if (p.basis) {
            ({ across, front: outward } = p.basis(u, i));
        } else {
            const theta = p.roll(u, i);
            across = add(scale(f.normal, Math.cos(theta)), scale(f.binormal, Math.sin(theta)));
            outward = cross(f.tangent, across); // the "front" of the strip
        }
        const section = p.section(u, i);
        const auxVal = p.aux ? p.aux(u, i) : null;
        for (let j = 0; j < m; j++) {
            const s = section[j];
            const pos = add(f.point, add(scale(across, s[0]), scale(outward, s[1])));
            positions[vp++] = pos[0]; positions[vp++] = pos[1]; positions[vp++] = pos[2];
            // Section normal: perpendicular to the section edge, from the
            // neighbouring points (smooth shading around the rounded profile).
            const prev = section[(j - 1 + m) % m], next = section[(j + 1) % m];
            const ex = next[0] - prev[0], ey = next[1] - prev[1];
            const nl = Math.hypot(ex, ey) || 1;
            const n2 = [ey / nl, -ex / nl]; // rotate the edge direction by -90° (outward for an anticlockwise section)
            const nrm = add(scale(across, n2[0]), scale(outward, n2[1]));
            normals[vn++] = nrm[0]; normals[vn++] = nrm[1]; normals[vn++] = nrm[2];
            uvs[vu++] = u; uvs[vu++] = j / m;
            if (aux) for (let a = 0; a < auxSize; a++) aux[va++] = auxVal[a];
        }
    }

    const spans = p.closed ? rings : rings - 1;
    const indices = new Uint32Array(spans * m * 6);
    let k = 0;
    for (let i = 0; i < spans; i++) {
        const r0 = i * m, r1 = ((i + 1) % rings) * m;
        for (let j = 0; j < m; j++) {
            const jn = (j + 1) % m;
            const a = r0 + j, b = r0 + jn, c = r1 + j, d = r1 + jn;
            indices[k++] = a; indices[k++] = b; indices[k++] = c;
            indices[k++] = b; indices[k++] = d; indices[k++] = c;
        }
    }
    return { positions, normals, uvs, aux, indices, vertexCount, triangleCount: spans * m * 2 };
}

/**
 * Distance between the last ring and the first of an UNJOINED sweep
 * (closed:false over a closed curve). With the right roll the rings coincide
 * point for point; after an odd number of half-twists they coincide rotated
 * half a section round, which `shift` expresses (m/2 for a symmetric section).
 */
export function seamError(mesh, m, shift = 0) {
    const last = mesh.vertexCount - m;
    let worst = 0;
    for (let j = 0; j < m; j++) {
        const a = j * 3;
        const b = (last + ((j + shift) % m)) * 3;
        worst = Math.max(worst, Math.hypot(
            mesh.positions[a] - mesh.positions[b],
            mesh.positions[a + 1] - mesh.positions[b + 1],
            mesh.positions[a + 2] - mesh.positions[b + 2]));
    }
    return worst;
}

/** Count boundary edges (used once) and non-manifold edges (used 3+ times) of an indexed mesh. */
export function edgeAudit(indices) {
    const seen = new Map();
    for (let i = 0; i < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]];
        for (let e = 0; e < 3; e++) {
            const a = tri[e], b = tri[(e + 1) % 3];
            const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
            seen.set(key, (seen.get(key) || 0) + 1);
        }
    }
    let boundary = 0, nonManifold = 0;
    for (const c of seen.values()) { if (c === 1) boundary++; else if (c > 2) nonManifold++; }
    return { boundary, nonManifold, edges: seen.size };
}

/** Signed volume ×6 of an indexed mesh (positive when wound outward under a right-handed rule). */
export function signedVolume6(positions, indices) {
    let v = 0;
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
        const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
        const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
        const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
        v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    return v;
}

/** Lemniscate of Bernoulli in the x–y plane with a z lift, as Dave draws it: t in [0,1). */
export function lemniscate(radius, lift, t) {
    const a = t * Math.PI * 2;
    const denom = 1 + Math.sin(a) * Math.sin(a);
    return [(radius * Math.cos(a)) / denom, (radius * Math.sin(a) * Math.cos(a)) / denom, lift * Math.sin(a)];
}
