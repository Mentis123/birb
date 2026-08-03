/**
 * model/sdf.js — signed distance fields and a surface-nets mesher.
 *
 * WHY THIS EXISTS. Every pass before this one built the figures by unioning
 * ellipsoids and capsules into one geometry, and every render showed the seams:
 * the pregnant belly sat ON the torso like an applied egg, the shoulders read
 * as two balls stuck to the ribs, the bust floated. You cannot fix that by
 * moving primitives around, because a union of surfaces has a crease wherever
 * two surfaces meet, and a cast bronze has no creases — it has fillets.
 *
 * A distance field does. `smin` blends two shapes with a controllable radius,
 * so a belly can grow OUT of a torso and an arm can grow out of a shoulder. The
 * blend radius is the modelling tool: small for a jawline, large for a
 * pregnancy.
 *
 * MESHING is naive surface nets rather than marching cubes. Marching cubes
 * needs a 256-entry edge table and a 256x16 triangle table — a screenful of
 * magic numbers with no way to review them — whereas surface nets is about
 * sixty lines you can read, and on organic blobby fields it produces a
 * noticeably smoother surface because each cell contributes ONE vertex placed
 * at the average of its edge crossings rather than up to five triangles pinned
 * to the edges.
 *
 * Everything here is plain numbers: no THREE, no DOM. The mesher returns flat
 * arrays the caller turns into a BufferGeometry.
 */

// ---------------------------------------------------------------------------
// Primitives — all return signed distance, negative inside.
// ---------------------------------------------------------------------------

/**
 * Ellipsoid. This is the standard bound, not an exact distance: it is exact on
 * the surface and slightly over-estimates elsewhere, which is harmless for
 * meshing and is what every real-time SDF uses.
 */
export function sdEllipsoid(px, py, pz, rx, ry, rz) {
    const kx = px / rx, ky = py / ry, kz = pz / rz;
    const k0 = Math.sqrt(kx * kx + ky * ky + kz * kz);
    if (k0 === 0) return -Math.min(rx, Math.min(ry, rz));
    const lx = px / (rx * rx), ly = py / (ry * ry), lz = pz / (rz * rz);
    const k1 = Math.sqrt(lx * lx + ly * ly + lz * lz);
    return (k0 - 1) / k1;
}

/** Capsule between a and b with radius r. Exact. */
export function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, r) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const denom = abx * abx + aby * aby + abz * abz;
    let t = denom > 1e-9 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/** Box with rounded corners. Exact outside, approximate inside. */
export function sdRoundBox(px, py, pz, hx, hy, hz, r) {
    const qx = Math.abs(px) - hx + r;
    const qy = Math.abs(py) - hy + r;
    const qz = Math.abs(pz) - hz + r;
    const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
    const outside = Math.sqrt(mx * mx + my * my + mz * mz);
    const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
    return outside + inside - r;
}

/**
 * Triangular prism extruded by `halfDepth` along Z.
 *
 * The triangle distance is exact in XY and orientation-independent. Combining
 * it with the slab distance gives a closed carving tool with planar walls and
 * a real triangular mouth instead of three blended capsules approximating one.
 */
export function sdTriPrism(
    px, py, pz,
    ax, ay, bx, by, cx, cy,
    halfDepth
) {
    const edges = [
        [ax, ay, bx - ax, by - ay],
        [bx, by, cx - bx, cy - by],
        [cx, cy, ax - cx, ay - cy],
    ];
    const orientation = Math.sign(
        (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    ) || 1;

    let minDistanceSq = Infinity;
    let inside = true;
    for (const [vx, vy, ex, ey] of edges) {
        const wx = px - vx, wy = py - vy;
        const edgeLengthSq = ex * ex + ey * ey;
        const t = edgeLengthSq > 0
            ? Math.min(1, Math.max(0, (wx * ex + wy * ey) / edgeLengthSq))
            : 0;
        const dx = wx - ex * t, dy = wy - ey * t;
        minDistanceSq = Math.min(minDistanceSq, dx * dx + dy * dy);
        if (orientation * (ex * wy - ey * wx) < 0) inside = false;
    }

    const triangleDistance = Math.sqrt(minDistanceSq) * (inside ? -1 : 1);
    const slabDistance = Math.abs(pz) - halfDepth;
    const ox = Math.max(triangleDistance, 0);
    const oz = Math.max(slabDistance, 0);
    return Math.hypot(ox, oz) + Math.min(Math.max(triangleDistance, slabDistance), 0);
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

/**
 * Polynomial smooth minimum: a union with a fillet of radius ~`k`.
 *
 * This one operator is the whole reason the file exists. `k` is in metres and
 * is a MODELLING DECISION, not a tolerance: 0.02 gives a crisp jaw, 0.12 melts
 * a belly into a torso the way a thumb does in clay.
 */
export function smin(a, b, k) {
    if (k <= 0) return Math.min(a, b);
    let h = 0.5 + 0.5 * (b - a) / k;
    if (h < 0) h = 0; else if (h > 1) h = 1;
    return b * (1 - h) + a * h - k * h * (1 - h);
}

/** Smooth subtraction: carve `b` out of `a` with a soft rim. */
export function smax(a, b, k) {
    if (k <= 0) return Math.max(a, b);
    let h = 0.5 - 0.5 * (b - a) / k;
    if (h < 0) h = 0; else if (h > 1) h = 1;
    return b * (1 - h) + a * h + k * h * (1 - h);
}

/** Carve `tool` out of `solid`. */
export function subtract(solid, tool, k) {
    return smax(solid, -tool, k);
}

// ---------------------------------------------------------------------------
// Surface nets
// ---------------------------------------------------------------------------

/** Which two corners each of a cell's 12 edges connects, as corner indices. */
const EDGE_CORNERS = [
    [0, 1], [1, 3], [2, 3], [0, 2],
    [4, 5], [5, 7], [6, 7], [4, 6],
    [0, 4], [1, 5], [2, 6], [3, 7],
];
/** Corner index -> (di, dj, dk). Bit 0 = i, bit 1 = j, bit 2 = k. */
const CORNER_OFFSET = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

/**
 * Mesh an isosurface of `field` over a box.
 *
 * @param {function} field   (x, y, z) => signed distance, negative inside
 * @param {object} opts
 * @param {number[]} opts.min  [x, y, z] lower corner
 * @param {number[]} opts.max  [x, y, z] upper corner
 * @param {number} opts.voxel  edge length of one cell, in metres
 * @returns {{positions: Float32Array, indices: Uint32Array, samples: number}}
 */
export function surfaceNets(field, opts) {
    const [x0, y0, z0] = opts.min;
    const [x1, y1, z1] = opts.max;
    const h = opts.voxel;

    const nx = Math.max(1, Math.ceil((x1 - x0) / h));
    const ny = Math.max(1, Math.ceil((y1 - y0) / h));
    const nz = Math.max(1, Math.ceil((z1 - z0) / h));
    const sx = nx + 1, sy = ny + 1, sz = nz + 1;

    // --- sample the field on the grid corners ------------------------------
    // One pass, stored flat. This is the expensive part of the whole build, so
    // it happens exactly once and everything downstream reads the cache.
    const g = new Float32Array(sx * sy * sz);
    const idx = (i, j, k) => (k * sy + j) * sx + i;
    for (let k = 0; k < sz; k++) {
        const z = z0 + k * h;
        for (let j = 0; j < sy; j++) {
            const y = y0 + j * h;
            for (let i = 0; i < sx; i++) {
                g[idx(i, j, k)] = field(x0 + i * h, y, z);
            }
        }
    }

    // --- one vertex per surface-crossing cell ------------------------------
    const cellVert = new Int32Array(nx * ny * nz).fill(-1);
    const cidx = (i, j, k) => (k * ny + j) * nx + i;
    const positions = [];

    for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                // Gather the eight corner values.
                let mask = 0;
                const c = [];
                for (let n = 0; n < 8; n++) {
                    const o = CORNER_OFFSET[n];
                    const v = g[idx(i + o[0], j + o[1], k + o[2])];
                    c.push(v);
                    if (v < 0) mask |= 1 << n;
                }
                if (mask === 0 || mask === 255) continue;   // fully in or out

                // Average every edge crossing. Placing the vertex at the mean
                // of the crossings — rather than at the cell centre — is what
                // makes surface nets follow the surface instead of stair-
                // stepping along the grid.
                let ax = 0, ay = 0, az = 0, count = 0;
                for (let e = 0; e < 12; e++) {
                    const [ca, cb] = EDGE_CORNERS[e];
                    const va = c[ca], vb = c[cb];
                    if ((va < 0) === (vb < 0)) continue;
                    const t = va / (va - vb);
                    const oa = CORNER_OFFSET[ca], ob = CORNER_OFFSET[cb];
                    ax += oa[0] + (ob[0] - oa[0]) * t;
                    ay += oa[1] + (ob[1] - oa[1]) * t;
                    az += oa[2] + (ob[2] - oa[2]) * t;
                    count++;
                }
                if (!count) continue;
                cellVert[cidx(i, j, k)] = positions.length / 3;
                positions.push(
                    x0 + (i + ax / count) * h,
                    y0 + (j + ay / count) * h,
                    z0 + (k + az / count) * h
                );
            }
        }
    }

    // --- stitch quads across every crossing grid edge -----------------------
    // A grid edge with a sign change is pierced by the surface, and the four
    // cells around that edge each hold a vertex, so they form one quad.
    const indices = [];
    const quad = (a, b, c, d, flip) => {
        if (a < 0 || b < 0 || c < 0 || d < 0) return;
        // Negative values are inside, so normals must point toward the positive
        // side. The previous order exposed the far interior through a culled
        // near surface whenever the material rendered FrontSide.
        if (flip) indices.push(a, b, c, a, c, d);
        else indices.push(a, c, b, a, d, c);
    };

    for (let k = 0; k < sz; k++) {
        for (let j = 0; j < sy; j++) {
            for (let i = 0; i < sx; i++) {
                const v = g[idx(i, j, k)];
                const solid = v < 0;

                if (i < nx && j > 0 && k > 0) {
                    if (solid !== (g[idx(i + 1, j, k)] < 0)) {
                        quad(
                            cellVert[cidx(i, j - 1, k - 1)],
                            cellVert[cidx(i, j, k - 1)],
                            cellVert[cidx(i, j, k)],
                            cellVert[cidx(i, j - 1, k)],
                            solid
                        );
                    }
                }
                if (j < ny && i > 0 && k > 0) {
                    if (solid !== (g[idx(i, j + 1, k)] < 0)) {
                        quad(
                            cellVert[cidx(i - 1, j, k - 1)],
                            cellVert[cidx(i, j, k - 1)],
                            cellVert[cidx(i, j, k)],
                            cellVert[cidx(i - 1, j, k)],
                            !solid
                        );
                    }
                }
                if (k < nz && i > 0 && j > 0) {
                    if (solid !== (g[idx(i, j, k + 1)] < 0)) {
                        quad(
                            cellVert[cidx(i - 1, j - 1, k)],
                            cellVert[cidx(i, j - 1, k)],
                            cellVert[cidx(i, j, k)],
                            cellVert[cidx(i - 1, j, k)],
                            solid
                        );
                    }
                }
            }
        }
    }

    return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        samples: sx * sy * sz,
    };
}

export default surfaceNets;
