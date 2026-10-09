// PORTED from Birb Gauntlet (gauntlet/src/bird/realistic/gears.js) for the root
// game's bird picker. Gauntlet stays airtight: this is a copy, not an import.
// Root-game adaptations are marked "ROOT:".
/**
 * realistic/gears.js — Tock's gear trains, as arithmetic first. PURE.
 *
 * A gear that turns at the wrong speed for its neighbour is the one detail
 * that gives a clockwork model away, so the trains are solved here, not
 * eyeballed, and the tests hold them to it:
 *
 *   - Every meshing pair shares one MODULE (tooth size). Pitch radius is
 *     m * N / 2, so the centre distance of a pair is m * (Na + Nb) / 2.
 *   - Angular speed follows tooth count: a gear driven by a neighbour turns
 *     at -ratio(driver) * Ndriver / N. One phase uniform (`uGearAngle`, the
 *     animator's gear angle) drives every gear on the bird through its ratio.
 *   - Rest phases are solved so a tooth of the driver sits in a GAP of the
 *     driven gear on the line of centres, and rolling keeps it there: the
 *     pitch-arc offsets satisfy rA*eA + rB*eB = 0 at every phase.
 *   - The animator wraps its angle at 2*pi. Every gear here has
 *     |ratio| * teeth and |ratio| * spokes integral, so that wrap jumps each
 *     gear by a whole number of teeth AND spokes — a visual no-op.
 *
 * Gear geometry (`gearPrim`) is real tooth geometry: a trapezoidal tooth on
 * an addendum/dedendum of 1 and 1.25 modules (the standard proportions), on a
 * rim with spokes and a raised hub, or a solid web for a pinion.
 *
 * Local frame of a gear prim: axis +Y, teeth in the XZ plane, polar angle phi
 * with x = r sin(phi), z = r cos(phi) — so a positive rotation about +Y
 * increases phi, which is the sense the shader rotates in.
 */

import { emptyPrim, computeNormals } from './mesh-kit.js';

/** Tooth size shared by every gear on the owl (bird units). */
export const GEAR_MODULE = 0.0085;

/** Rigid-spin kinds carried in aAxis.w. */
export const SPIN = Object.freeze({ NONE: 0, GEAR: 1, KEY: 2 });

export function pitchRadius(teeth, m = GEAR_MODULE) { return (m * teeth) / 2; }
export function tipRadius(teeth, m = GEAR_MODULE) { return pitchRadius(teeth, m) + m; }
export function rootRadius(teeth, m = GEAR_MODULE) { return pitchRadius(teeth, m) - 1.25 * m; }

/**
 * The trains. Each gear either is a train's DRIVER (`ratio` given: turns
 * that many times per turn of the animator's gear phase) or `meshes` a
 * previously listed gear at `dir` degrees (direction from that gear's centre,
 * in the train plane, measured as phi).
 *
 * BACK: the mainspring barrel (24) drives a 12-tooth pinion and a 16-tooth
 * third wheel. Ratios: 1, -2, -1.5.
 * WING: a 12-tooth wheel on the shoulder arbor (driven 1:1 off the barrel
 * through the shoulder, so it turns with the back train) drives an 8-tooth
 * idler. Ratios: 1, -1.5.
 */
export const OWL_BACK_TRAIN = Object.freeze([
    Object.freeze({ id: 'barrel', teeth: 24, spokes: 6, ratio: 1, at: [0, 0] }),
    Object.freeze({ id: 'pinion', teeth: 12, spokes: 0, meshes: 'barrel', dir: 62 }),
    Object.freeze({ id: 'third', teeth: 16, spokes: 4, meshes: 'barrel', dir: -118 }),
]);
export const OWL_WING_TRAIN = Object.freeze([
    Object.freeze({ id: 'shoulder', teeth: 12, spokes: 5, ratio: 1, at: [0, 0] }),
    Object.freeze({ id: 'idler', teeth: 8, spokes: 4, meshes: 'shoulder', dir: 128 }),
]);

function wrapPi(a) {
    return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

/**
 * Place a train: centres (in the train plane, x = sin(phi) side), rest phase
 * phi0 (angle of tooth 0's centre), and ratio for each gear.
 */
export function solveTrain(train, m = GEAR_MODULE) {
    const out = [];
    const byId = new Map();
    for (const g of train) {
        let cx, cz, ratio, phi0;
        if (g.meshes) {
            const a = byId.get(g.meshes);
            if (!a) throw new Error('gear train: ' + g.id + ' meshes unknown ' + g.meshes);
            const th = (g.dir * Math.PI) / 180;
            const d = (m * (a.teeth + g.teeth)) / 2;
            cx = a.center[0] + Math.sin(th) * d;
            cz = a.center[1] + Math.cos(th) * d;
            ratio = (-a.ratio * a.teeth) / g.teeth;
            // Driver rotated by alpha off "tooth on the line" => driven gear
            // rotated by -alpha * Na / Nb off "gap on the line".
            const alpha = a.phi0 - th;
            phi0 = th + Math.PI + Math.PI / g.teeth - alpha * (a.teeth / g.teeth);
        } else {
            cx = g.at ? g.at[0] : 0;
            cz = g.at ? g.at[1] : 0;
            ratio = g.ratio;
            phi0 = g.phi0 || 0;
        }
        const placed = {
            id: g.id, teeth: g.teeth, spokes: g.spokes, ratio,
            center: [cx, cz], phi0,
            pitchR: pitchRadius(g.teeth, m), meshes: g.meshes || null, dir: g.dir || 0,
        };
        byId.set(g.id, placed);
        out.push(placed);
    }
    return out;
}

/**
 * Meshing error of placed gears a, b at animator phase `phase`, as pitch-arc
 * length: rA * eA + rB * eB, where eA is the angle from the line of centres
 * to A's nearest tooth centre and eB from the opposite direction to B's
 * nearest GAP centre. Zero (mod a circular pitch) means the teeth interleave.
 */
export function meshError(a, b, phase, m = GEAR_MODULE) {
    const th = Math.atan2(b.center[0] - a.center[0], b.center[1] - a.center[1]);
    const angA = a.phi0 + a.ratio * phase;
    const angB = b.phi0 + b.ratio * phase;
    const pA = (Math.PI * 2) / a.teeth, pB = (Math.PI * 2) / b.teeth;
    const eA = wrapPi(((angA - th) / pA) * Math.PI * 2) / (Math.PI * 2) * pA;
    const gapB = angB + Math.PI / b.teeth;
    const eB = wrapPi(((gapB - (th + Math.PI)) / pB) * Math.PI * 2) / (Math.PI * 2) * pB;
    const err = a.pitchR * eA + b.pitchR * eB;
    const pitch = Math.PI * m;
    return Math.abs(err - pitch * Math.round(err / pitch));
}

/**
 * The tooth outline, as [r, phi] pairs in increasing phi. `perTooth` is 4
 * (root, tip, tip, root — a trapezoid) or 6 (adds the pitch-circle flank
 * point, a closer stand-in for the involute).
 */
export function gearOutline(teeth, perTooth = 4, m = GEAR_MODULE, phi0 = 0) {
    const rp = pitchRadius(teeth, m), ra = rp + m, rr = rp - 1.25 * m;
    const wp = Math.PI / (2 * teeth);      // half tooth thickness at the pitch circle
    const wt = wp * 0.55, wr = wp * 1.28;
    const pts = [];
    for (let k = 0; k < teeth; k++) {
        const c = phi0 + (k * Math.PI * 2) / teeth;
        if (perTooth === 6) {
            pts.push([rr, c - wr], [rp, c - wp], [ra, c - wt], [ra, c + wt], [rp, c + wp], [rr, c + wr]);
        } else {
            pts.push([rr, c - wr], [ra, c - wt], [ra, c + wt], [rr, c + wr]);
        }
    }
    return { pts, rp, ra, rr };
}

/** Count teeth in an outline: tip points come in pairs, one pair per tooth. */
export function countTeeth(outline) {
    let tips = 0;
    for (const p of outline.pts) if (Math.abs(p[0] - outline.ra) < 1e-9) tips++;
    return tips / 2;
}

/** Orient-and-add: winds a triangle so its face normal agrees with `dir`. */
function triToward(prim, a, b, c, dx, dy, dz) {
    const p = prim.pos;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * dx + ny * dy + nz * dz >= 0) prim.idx.push(a, b, c); else prim.idx.push(a, c, b);
}

function vtx(prim, x, y, z, u, v) {
    prim.pos.push(x, y, z);
    prim.uv.push(u, v);
    return prim.pos.length / 3 - 1;
}

/**
 * A gear in its local frame (axis +Y, bottom face at y = 0 omitted: it sits
 * on a backing plate). Rim top + outer tooth walls + spokes (or a solid web
 * when spokes = 0) + a raised hub and arbor. Hard edges: walls and faces have
 * their own vertices so the machined corners stay crisp.
 *
 * uv: u around (one brushed tile per ~0.1 units of rim), v radial.
 */
export function gearPrim(teeth, opts = {}) {
    const m = opts.module || GEAR_MODULE;
    const h = opts.thick || 0.014;
    const perTooth = opts.perTooth || 4;
    const spokes = opts.spokes || 0;
    const hubSegs = opts.hubSegs || 10;
    const outline = gearOutline(teeth, perTooth, m, opts.phi0 || 0);
    const { pts, rr } = outline;
    const rimIn = rr - 1.7 * m;
    const prim = emptyPrim();
    const P = pts.length;
    const uvK = 1 / 0.1;

    // --- rim top: outline ring to an inner ring at the same angles ---------
    const solid = spokes === 0;
    const top0 = prim.pos.length / 3;
    for (let i = 0; i < P; i++) {
        const [r, ph] = pts[i];
        vtx(prim, Math.sin(ph) * r, h, Math.cos(ph) * r, ph * r * uvK, r * uvK);
    }
    const in0 = prim.pos.length / 3;
    const innerR = solid ? Math.max(rimIn, 0.001) : rimIn;
    for (let i = 0; i < P; i++) {
        const ph = pts[i][1];
        vtx(prim, Math.sin(ph) * innerR, h, Math.cos(ph) * innerR, ph * innerR * uvK, innerR * uvK);
    }
    for (let i = 0; i < P; i++) {
        const j = (i + 1) % P;
        triToward(prim, top0 + i, top0 + j, in0 + i, 0, 1, 0);
        triToward(prim, top0 + j, in0 + j, in0 + i, 0, 1, 0);
    }
    if (solid) {
        // Web: fan the inner ring to the centre.
        const c = vtx(prim, 0, h, 0, 0, 0);
        for (let i = 0; i < P; i++) triToward(prim, c, in0 + i, in0 + (i + 1) % P, 0, 1, 0);
    }

    // --- outer walls: the teeth's flanks and lands -------------------------
    // Skippable for small gears seen from above (`walls: false`), where the
    // flanks are a pixel tall and the triangles are better spent elsewhere.
    for (let i = 0; i < (opts.walls === false ? 0 : P); i++) {
        const j = (i + 1) % P;
        const [r0, p0] = pts[i], [r1, p1] = pts[j];
        const x0 = Math.sin(p0) * r0, z0 = Math.cos(p0) * r0;
        const x1 = Math.sin(p1) * r1, z1 = Math.cos(p1) * r1;
        const a = vtx(prim, x0, 0, z0, 0, 0), b = vtx(prim, x1, 0, z1, 1, 0);
        const c = vtx(prim, x1, h, z1, 1, 1), d = vtx(prim, x0, h, z0, 0, 1);
        const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
        triToward(prim, a, b, c, mx, 0, mz);
        triToward(prim, a, c, d, mx, 0, mz);
    }

    // --- spokes: flat bars, recessed a touch below the rim ------------------
    const hubR = Math.max(m * 2.2, rimIn * 0.28);
    if (!solid) {
        const sw = Math.max(m * 1.3, rimIn * 0.16);
        const sh = h * 0.78;
        for (let s = 0; s < spokes; s++) {
            const ph = (opts.phi0 || 0) + (s * Math.PI * 2) / spokes + Math.PI / teeth;
            const dx = Math.sin(ph), dz = Math.cos(ph);
            const sx = Math.cos(ph), sz = -Math.sin(ph);   // across the spoke
            const r0 = hubR * 0.8, r1 = rimIn + m * 0.4;
            const q = [
                [dx * r0 - sx * sw * 0.5, dz * r0 - sz * sw * 0.5],
                [dx * r1 - sx * sw * 0.5, dz * r1 - sz * sw * 0.5],
                [dx * r1 + sx * sw * 0.5, dz * r1 + sz * sw * 0.5],
                [dx * r0 + sx * sw * 0.5, dz * r0 + sz * sw * 0.5],
            ];
            const t = q.map((p) => vtx(prim, p[0], sh, p[1], p[0] * uvK, p[1] * uvK));
            triToward(prim, t[0], t[1], t[2], 0, 1, 0);
            triToward(prim, t[0], t[2], t[3], 0, 1, 0);
            for (const [i0, i1] of [[0, 1], [2, 3]]) {
                const p0 = q[i0], p1 = q[i1];
                const a = vtx(prim, p0[0], 0, p0[1], 0, 0), b = vtx(prim, p1[0], 0, p1[1], 1, 0);
                const c = vtx(prim, p1[0], sh, p1[1], 1, 1), d = vtx(prim, p0[0], sh, p0[1], 0, 1);
                const ox = i0 === 0 ? -sx : sx, oz = i0 === 0 ? -sz : sz;
                triToward(prim, a, b, c, ox, 0, oz);
                triToward(prim, a, c, d, ox, 0, oz);
            }
        }
    }

    // --- hub + arbor: a raised boss with a domed pin ------------------------
    const hubH = h * 1.35;
    const ring = (r, y) => {
        const s = prim.pos.length / 3;
        for (let k = 0; k <= hubSegs; k++) {
            const a = (k / hubSegs) * Math.PI * 2;
            vtx(prim, Math.sin(a) * r, y, Math.cos(a) * r, k / hubSegs, y * uvK);
        }
        return s;
    };
    const lo = ring(hubR, 0), hi = ring(hubR, hubH);
    for (let k = 0; k < hubSegs; k++) {
        const a = (k + 0.5) / hubSegs * Math.PI * 2;
        triToward(prim, lo + k, lo + k + 1, hi + k + 1, Math.sin(a), 0, Math.cos(a));
        triToward(prim, lo + k, hi + k + 1, hi + k, Math.sin(a), 0, Math.cos(a));
    }
    const capRing = ring(hubR, hubH);
    const pinR = hubR * 0.45;
    const pinRing = ring(pinR, hubH);
    for (let k = 0; k < hubSegs; k++) {
        triToward(prim, capRing + k, capRing + k + 1, pinRing + k + 1, 0, 1, 0);
        triToward(prim, capRing + k, pinRing + k + 1, pinRing + k, 0, 1, 0);
    }
    const pinTop = vtx(prim, 0, hubH + pinR * 0.7, 0, 0.5, 0.5);
    for (let k = 0; k < hubSegs; k++) triToward(prim, pinTop, pinRing + k, pinRing + k + 1, 0, 1, 0);

    computeNormals(prim, false);
    prim.outline = outline;
    prim.teeth = teeth;
    return prim;
}

/** The backing plate a gear sits on: a shallow disc, static. */
export function backingPrim(radius, segs) {
    const prim = emptyPrim();
    const c = vtx(prim, 0, 0, 0, 0.5, 0.5);
    const s = prim.pos.length / 3;
    for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        vtx(prim, Math.sin(a) * radius, 0, Math.cos(a) * radius, 0.5 + Math.sin(a) * 0.5, 0.5 + Math.cos(a) * 0.5);
    }
    for (let k = 0; k < segs; k++) triToward(prim, c, s + k, s + k + 1, 0, 1, 0);
    return computeNormals(prim, false);
}

/** Orient-and-add, exported for the other hand-built mechanism parts. */
export { triToward, vtx };
