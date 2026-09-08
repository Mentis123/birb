/**
 * model/ribbon.js — the icon as ONE continuous ribbon.
 *
 * The plates in icon-mesh.js are what Blender's importer makes: four flat
 * cut-outs stacked in depth. This builds what the artwork DEPICTS: a single
 * strip of material that rolls over at four horizontal lines and alternates
 * between a front layer (the two rainbow curls) and a back layer (the two dark
 * straps), twisting as it goes.
 *
 * WHAT THE VECTOR SAYS, measured rather than assumed:
 *   - the two bands are 180° rotations of each other about (24, 24) to within
 *     0.006 units, so the mark is C2-symmetric and neither band is "in front";
 *   - the widest ruling anywhere is 17.7 units, in the middle of each band
 *     where the surface faces the viewer; the crests at y = 4 and y = 44
 *     measure 16.04 and those at y = 15.11 and y = 32.885 measure 6.93, which
 *     are that width times cos 25° and cos 67°. The narrowing is
 *     foreshortening, so the transitions are ROLLS about those lines;
 *   - all eight junctions between a long edge and its horizontal line are
 *     tangential, never cornered — rolls again, not knife creases;
 *   - all four fold "tips" lie on a band's outline to within 0.17 units, and
 *     the V notches are entirely hidden. They are occlusion clipping, not
 *     points of material: build no tips.
 *
 * THE CONSTRUCTION, and why the front view survives it. Every ring of the loft
 * is a ruling between the piece's own two edge paths, taken straight from the
 * artwork, and each END of that ruling carries its own DEPTH. Under the
 * orthographic front view the depths vanish and the projection is exactly the
 * region the artwork draws between those two edges; from anywhere else the
 * depths are the whole object — a band bows toward you and tilts, a strap
 * dives behind and twists, and at each transition line the ribbon turns over
 * through a rounded hairpin. Fidelity and physicality stop competing: the
 * silhouette gate still measures 0.99 against the vector while the thing you
 * orbit is a ribbon rather than a stack of plates.
 *
 * Two earlier readings were built and rejected against renders, and the
 * reasons are worth keeping:
 *   - a HELICOIDAL twist between band corners (`foldStyle` in the first draft)
 *     rotates the ruling out of the picture plane, so the strap projects to a
 *     bow-tie instead of the artwork's wedge: 0.76 IoU, and visibly not the
 *     icon from the front;
 *   - forcing a truly CONSTANT width by leaning each ruling out of plane until
 *     it measures 17.7 is geometrically exact and looks wrong: where the
 *     artwork's ruling is 1.4 units the lean is 18, and the strap explodes
 *     into a fan. The mark is a stylised drawing, not an isometry.
 *
 * Everything is derived from the icon table. Bands split at their two straight
 * ends. A fold is handed the line it leaves on and finds the line it arrives
 * on by asking which end of the next band its own outline touches; its two
 * long edges are the runs of its outline that connect those lines, the rest
 * being clip and tuck allowance that ends up behind a band exactly as drawn.
 */

import { parsePath, cubicPoint, subpathsBounds, flattenSubpath } from './svg-path.js';
import { compileFill, fillGLSL } from './svg-gradient.js';
import { applyGradient, buildIcon, EXTRUDE_DEFAULTS, ID_COLOURS } from './icon-mesh.js';

export const RIBBON_DEFAULTS = {
    /** All lengths are fractions of the icon's larger viewBox dimension. */
    thicknessFrac: 0.019,
    cornerFrac: 0.0048,
    /** How far each face bows outward at mid-width (a lens, not a slab). */
    bulgeFrac: 0.0035,
    /** How far a band bows toward the viewer at its middle. */
    bowFrac: 0.055,
    /** Differential depth across a band at its middle: the ribbon's own tilt. */
    tiltFrac: 0.045,
    /** How far behind the bands a strap sits, and how much further it sags. */
    gapFrac: 0.055,
    sagFrac: 0.075,
    /** Differential depth across a strap at its middle: the visible twist. */
    foldTiltFrac: 0.16,
    /**
     * How far the hairpin reaches past its transition line, as a fraction of
     * the full half-circle. A real fold-over reaches a bend radius past the
     * line; the artwork draws no overhang at all, so this trades a little
     * roundness for silhouette and 0.55 is where the turn still reads as a
     * turn.
     */
    turnReach: 0.55,
    /** Rings along a band, along a fold, and through each hairpin turn. */
    bandRings: 80,
    foldRings: 44,
    turnRings: 7,
    frontSamples: 9,
    cornerSamples: 3,
    /** Tolerance for "this outline point sits on a transition line", in units. */
    lineEps: 0.08,
    roughness: EXTRUDE_DEFAULTS.roughness,
    clearcoat: EXTRUDE_DEFAULTS.clearcoat,
    clearcoatRoughness: EXTRUDE_DEFAULTS.clearcoatRoughness,
    envMapIntensity: EXTRUDE_DEFAULTS.envMapIntensity,
};

// ---------------------------------------------------------------- 2D edges

/** Sample one segment (start point excluded) into 2D points. */
function samplePoints(x0, y0, seg, divisions) {
    if (seg.kind === 'L') return [[seg.x, seg.y]];
    const pts = [];
    for (let i = 1; i <= divisions; i++) {
        pts.push(cubicPoint(x0, y0, seg.x1, seg.y1, seg.x2, seg.y2, seg.x, seg.y, i / divisions));
    }
    return pts;
}

/** A polyline with an arc-length sampler `at(u)` for u in [0, 1]. */
export function polylineSampler(points) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    const total = cum[cum.length - 1] || 1;
    return {
        length: total,
        points,
        at(u) {
            const s = Math.max(0, Math.min(1, u)) * total;
            let lo = 0, hi = cum.length - 1;
            while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
            const span = cum[hi] - cum[lo] || 1;
            const t = (s - cum[lo]) / span;
            return [points[lo][0] + (points[hi][0] - points[lo][0]) * t, points[lo][1] + (points[hi][1] - points[lo][1]) * t];
        },
    };
}

/**
 * Split a band outline into end A, one long edge, end B and the other long
 * edge. A band is a closed path with exactly two straight segments (its ends).
 * Both long edges are returned running from end A to end B.
 */
export function splitBand(subpath, divisions = 32) {
    const segs = subpath.segments;
    const straight = [];
    segs.forEach((s, i) => { if (s.kind === 'L') straight.push(i); });
    if (straight.length !== 2) throw new Error(`ribbon: a band needs exactly two straight ends, found ${straight.length}`);
    const [eA, eB] = straight;
    const startOf = (i) => (i === 0 ? [subpath.x, subpath.y] : [segs[i - 1].x, segs[i - 1].y]);
    const n = segs.length;
    const endA = [startOf(eA), [segs[eA].x, segs[eA].y]];
    const endB = [startOf(eB), [segs[eB].x, segs[eB].y]];
    const pivotPts = [endA[1]];
    for (let i = eA + 1; i < eB; i++) pivotPts.push(...samplePoints(...startOf(i), segs[i], divisions));
    const farPts = [endB[1]];
    for (let k = 1; k < n; k++) {
        const i = (eB + k) % n;
        if (i === eA) break;
        farPts.push(...samplePoints(...startOf(i), segs[i], divisions));
    }
    farPts.reverse();
    return {
        endA, endB,
        edges: [polylineSampler(pivotPts), polylineSampler(farPts)],
        lineA: endA[0][1], lineB: endB[0][1],
    };
}

/** Reverse a split so the loop travels through it the other way (B → A). */
export function reverseSplit(split) {
    return {
        ...split,
        edges: split.edges.map((e) => ({ length: e.length, points: e.points, at: (u) => e.at(1 - u) })),
        lineA: split.lineB, lineB: split.lineA,
    };
}

/** Does this outline have sampled points on the horizontal line y = value? */
export function touchesLine(subpath, y, eps = 0.08, divisions = 24) {
    return flattenSubpath(subpath, divisions).some(([, py]) => Math.abs(py - y) <= eps);
}

/**
 * Split a fold outline into its two long edges.
 *
 * A fold sits between two horizontal transition lines and its drawn outline is
 * the true strip CLIPPED by the bands in front of it: runs that lie on a
 * transition line are the clip, the V notch is a run that leaves and returns
 * to the same line, and the two runs that actually connect line A to line B
 * are the strip's own edges. Both are returned running A → B.
 */
export function splitFold(subpath, yA, yB, eps = 0.08, divisions = 24) {
    const pts = flattenSubpath(subpath, divisions);
    const cls = pts.map(([, y]) => (Math.abs(y - yA) <= eps ? 'A' : Math.abs(y - yB) <= eps ? 'B' : ''));
    const n = pts.length;
    if (!cls.includes('A') || !cls.includes('B')) throw new Error('ribbon: fold does not touch both transition lines');
    // Walk from a point that IS on a line so runs are not split across the wrap.
    const origin = cls.findIndex(Boolean);
    const runs = [];
    let run = null;
    for (let k = 0; k <= n; k++) {
        const i = (origin + k) % n;
        const c = cls[i];
        if (c) {
            if (run) { run.to = c; run.toPt = pts[i]; if (run.from !== run.to) runs.push(run); run = null; }
            run = { from: c, fromPt: pts[i], pts: [] };
        } else if (run) {
            run.pts.push(pts[i]);
        }
    }
    const long = runs.filter((r) => r.pts.length);
    if (long.length < 2) throw new Error(`ribbon: expected two long fold edges, found ${long.length}`);
    long.sort((a, b) => b.pts.length - a.pts.length);
    const two = long.slice(0, 2).map((r) => {
        const path = [r.fromPt, ...r.pts, r.toPt];
        return r.from === 'A' ? path : path.reverse();
    });
    return { edges: two.map((path) => polylineSampler(trimBetweenLines(path, yA, yB, eps))), lineA: yA, lineB: yB };
}

/**
 * Clip an edge to the run that actually crosses from line A to line B.
 *
 * A fold's long edge often OVERSHOOTS: the strap's real edge continues past
 * the transition line as tuck allowance and is drawn as a thin sliver that a
 * band covers completely — fold_red's right edge climbs 5.5 units back up
 * before turning down. Left in, that excursion eats half the edge's arc
 * length, so the loft's rulings fan across the wrong region and the strap
 * projects nothing like the artwork (0.76 IoU, and visibly a bow-tie).
 * Keeping only the monotone crossing costs nothing visible: the trimmed part
 * is under a band in every view of the icon.
 */
export function trimBetweenLines(path, yA, yB, eps) {
    const dir = Math.sign(yB - yA) || 1;
    // Where the path last leaves line A heading for line B, and where it first
    // reaches line B. Both are taken as the exact crossing, interpolated
    // between samples, so the trimmed edge starts and ends ON the lines the
    // neighbouring bands end on rather than at whichever sample happened to
    // be nearest.
    const cross = (i, y) => {
        const a = path[i], b = path[i + 1];
        const span = b[1] - a[1];
        const t = Math.abs(span) < 1e-12 ? 0 : (y - a[1]) / span;
        return [a[0] + (b[0] - a[0]) * t, y];
    };
    // Take the LAST time the edge leaves line A heading for line B, and the
    // FIRST time it reaches line B, both as exact interpolated crossings.
    // Starting instead at the edge's own first point — which is on line A, so
    // it looks like the right answer — keeps the far side of the tuck and
    // measures 4 points of IoU worse: the drawn boundary a viewer actually
    // sees below the line is where the tuck comes back, not where it left.
    let i0 = -1;
    for (let i = 0; i + 1 < path.length; i++) {
        if (dir * (path[i][1] - yA) <= 0 && dir * (path[i + 1][1] - yA) > 0) i0 = i;
    }
    let i1 = -1;
    for (let i = Math.max(0, i0); i + 1 < path.length; i++) {
        if (dir * (path[i][1] - yB) < 0 && dir * (path[i + 1][1] - yB) >= 0) { i1 = i; break; }
    }
    const head = i0 >= 0 ? [cross(i0, yA)] : [path[0]];
    const tail = i1 >= 0 ? [cross(i1, yB)] : [path[path.length - 1]];
    const middle = path.slice(i0 >= 0 ? i0 + 1 : 1, i1 >= 0 ? i1 + 1 : path.length - 1);
    const out = [...head, ...middle, ...tail];
    return out.length >= 2 ? out : path;
}

// ---------------------------------------------------------------- section

/**
 * Cross-section in the (across, front) plane: x from 0 (edge 1) to w (edge 2);
 * the front face sits on 0 and bows to +bulge at mid-width, the back sits on
 * −t and bows to −t−bulge — a lens, so the ribbon reads the same whichever
 * face is toward the viewer after a roll. Anticlockwise, so the loft's
 * outward normals face out.
 */
export function ribbonSection(w, t, r, bulge, frontSamples, cornerSamples) {
    r = Math.min(r, w * 0.25, t * 0.45);
    const pts = [];
    const corner = (cx, cy, a0) => {
        for (let i = 0; i <= cornerSamples; i++) {
            const a = a0 + (i / cornerSamples) * (Math.PI / 2);
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
    };
    const inner = Math.max(1e-9, w - 2 * r);
    for (let i = 0; i <= frontSamples; i++) {
        const x = w - r - (i / frontSamples) * inner;
        pts.push([x, bulge * Math.sin(Math.PI * (x - r) / inner)]);
    }
    corner(r, -r, Math.PI / 2);
    corner(r, -t + r, Math.PI);
    for (let i = 0; i <= frontSamples; i++) {
        const x = r + (i / frontSamples) * inner;
        pts.push([x, -t - bulge * Math.sin(Math.PI * (x - r) / inner)]);
    }
    corner(w - r, -t + r, Math.PI * 1.5);
    corner(w - r, -r, 0);
    return pts;
}

// ---------------------------------------------------------------- helpers

const lerp = (a, b, t) => a + (b - a) * t;
const flip = (p, z = 0) => [p[0], -p[1], z]; // SVG (y down) → Three (y up)
const v3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

// ---------------------------------------------------------------- builder

/**
 * Build the ribbon. Falls back to the plates for a table without a `ribbon`
 * descriptor (the 2026 mark is two separate lobes, not one strip).
 */
export function buildRibbon(THREE, icon, opts = {}) {
    if (!icon.ribbon) return buildIcon(THREE, icon, opts);
    const cfg = { ...RIBBON_DEFAULTS, ...(icon.ribbon.defaults || {}), ...opts };
    const [, , vw, vh] = icon.viewBox;
    const unit = Math.max(vw, vh);
    const thickness = cfg.thicknessFrac * unit;
    const cornerR = cfg.cornerFrac * unit;
    const bulge = cfg.bulgeFrac * unit;

    const byId = Object.fromEntries(icon.pieces.map((p, index) => [p.id, { ...p, index }]));
    const parts = icon.ribbon.loop.map((entry) => {
        const id = typeof entry === 'string' ? entry : entry.id;
        const piece = byId[id];
        if (!piece) throw new Error(`ribbon: loop names unknown piece ${id}`);
        return { id, piece, subpaths: parsePath(piece.d), spec: typeof entry === 'string' ? {} : entry };
    });

    // --- 1. edges, and the direction the loop runs through each piece.
    //
    // Bands split at their two straight ends. A fold is then told the line it
    // leaves on (the previous band's exit) and finds the line it arrives on by
    // asking which of the NEXT band's two ends its own outline actually
    // touches — so the travel direction of every band after the first is
    // derived from the artwork rather than assumed from path order.
    const nParts = parts.length;
    parts.forEach((part) => {
        part.rings = part.spec.fold ? cfg.foldRings : cfg.bandRings;
        if (!part.spec.fold) part.split = splitBand(part.subpaths[0]);
    });
    if (parts[0].spec.fold) throw new Error('ribbon: the loop must start on a band');
    for (let k = 0; k < nParts; k++) {
        const part = parts[k];
        if (!part.spec.fold) continue;
        const prev = parts[(k - 1 + nParts) % nParts], next = parts[(k + 1) % nParts];
        if (prev.spec.fold || next.spec.fold) throw new Error('ribbon: a fold must sit between two bands');
        const yA = prev.split.lineB;
        const candidates = [next.split.lineA, next.split.lineB]
            .filter((y) => Math.abs(y - yA) > cfg.lineEps && touchesLine(part.subpaths[0], y, cfg.lineEps));
        if (!candidates.length) throw new Error(`ribbon: ${part.id} touches neither end of ${next.id}`);
        const yB = candidates[0];
        part.split = splitFold(part.subpaths[0], yA, yB, cfg.lineEps);
        // Point the next band the way the fold arrives.
        if (Math.abs(next.split.lineA - yB) > cfg.lineEps) next.split = reverseSplit(next.split);
    }

    // --- 2. edge correspondence. A fold's two edges come out of the outline
    //        walk in whatever order the path happened to be drawn; pair them
    //        with the previous band's by proximity at the line they share, or
    //        the strap crosses itself.
    for (let k = 0; k < nParts; k++) {
        const part = parts[k];
        if (!part.spec.fold) continue;
        const prev = parts[(k - 1 + nParts) % nParts];
        const anchor = prev.split.edges[0].at(1);
        const d = (e) => { const q = e.at(0); return Math.hypot(q[0] - anchor[0], q[1] - anchor[1]); };
        if (d(part.split.edges[1]) < d(part.split.edges[0])) part.split.edges.reverse();
    }

    // --- 3. rings. Each ring is a ruling between the two edge paths with a
    //        depth at EACH end: the in-plane part is the artwork, the depths
    //        are the object. `bump` is zero at both transition lines so the
    //        pieces meet the hairpins cleanly.
    const bump = (u) => Math.sin(Math.PI * u);
    const bow = cfg.bowFrac * unit, tilt = cfg.tiltFrac * unit;
    const gap = cfg.gapFrac * unit, sag = cfg.sagFrac * unit, foldTilt = cfg.foldTiltFrac * unit;
    const ringAt = (part, u) => {
        const [e1, e2] = part.split.edges;
        const a = e1.at(u), b = e2.at(u);
        const s = part.spec.lean === undefined ? 1 : part.spec.lean;
        let z1, z2;
        if (part.spec.fold) {
            z1 = -gap - sag * bump(u);
            z2 = z1 + s * foldTilt * bump(u);
        } else {
            z1 = bow * bump(u);
            z2 = z1 + s * tilt * bump(u);
        }
        return { p1: [a[0], -a[1], z1], p2: [b[0], -b[1], z2] };
    };
    const rings = [];
    const ranges = [];
    parts.forEach((part, k) => {
        const first = rings.length;
        for (let i = 0; i <= part.rings; i++) {
            const r = ringAt(part, i / part.rings);
            r.part = k;
            rings.push(r);
        }
        // The hairpin into the next piece: the ribbon turns over about the
        // transition line, so its ends slide along that line while the body
        // swings through a half-circle of radius gap/2 in depth. Projected
        // that is a sliver a unit wide on a line the artwork already draws,
        // which is why the silhouette barely notices a real fold-over.
        const next = parts[(k + 1) % nParts];
        const from = ringAt(part, 1), to = ringAt(next, 0);
        const mid1 = (from.p1[2] + to.p1[2]) / 2, mid2 = (from.p2[2] + to.p2[2]) / 2;
        const r1 = Math.abs(to.p1[2] - from.p1[2]) / 2, r2 = Math.abs(to.p2[2] - from.p2[2]) / 2;
        const s1 = Math.sign(from.p1[2] - to.p1[2]) || 1, s2 = Math.sign(from.p2[2] - to.p2[2]) || 1;
        // Travel direction of the outgoing piece, per end, in the picture plane.
        const t1 = (() => { const a = ringAt(part, 1 - 1 / part.rings).p1, b = from.p1; const d = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; })();
        const t2 = (() => { const a = ringAt(part, 1 - 1 / part.rings).p2, b = from.p2; const d = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; })();
        const reach = cfg.turnReach;
        for (let i = 1; i < cfg.turnRings; i++) {
            const t = i / cfg.turnRings, phi = Math.PI * t;
            const lerp3 = (a, b) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
            const q1 = lerp3(from.p1, to.p1), q2 = lerp3(from.p2, to.p2);
            rings.push({
                p1: [q1[0] + t1[0] * reach * r1 * Math.sin(phi), q1[1] + t1[1] * reach * r1 * Math.sin(phi), mid1 + s1 * r1 * Math.cos(phi)],
                p2: [q2[0] + t2[0] * reach * r2 * Math.sin(phi), q2[1] + t2[1] * reach * r2 * Math.sin(phi), mid2 + s2 * r2 * Math.cos(phi)],
                part: k, turn: true,
            });
        }
        ranges.push([first, rings.length - 1]);
    });
    const N = rings.length;

    // --- 4. ruling, travel and section axes per ring, then the loft.
    for (let i = 0; i < N; i++) {
        const r = rings[i];
        const across = v3.sub(r.p2, r.p1);
        r.width = Math.hypot(across[0], across[1], across[2]);
        r.acrossUnit = v3.norm(across);
        const a = rings[(i - 1 + N) % N], b = rings[(i + 1) % N];
        const mid = (q) => [(q.p1[0] + q.p2[0]) / 2, (q.p1[1] + q.p2[1]) / 2, (q.p1[2] + q.p2[2]) / 2];
        const t = v3.norm(v3.sub(mid(b), mid(a)));
        let front = v3.cross(t, r.acrossUnit);
        if (Math.hypot(front[0], front[1], front[2]) < 1e-6) front = [0, 0, 1];
        r.front = v3.norm(front);
    }
    // `front` is cross(travel, across), so (across, front, travel) is
    // right-handed at every ring by construction and the lofted tube keeps one
    // orientation all the way round. Forcing "continuity" by flipping the
    // sign instead — the obvious-looking fix when a ribbon turns over — is
    // what inverts the winding, and a piece then renders as its own inside:
    // lit from behind, washed grey, unmistakable once seen.
    let W = 0;
    for (const r of rings) W = Math.max(W, r.width);

    const sectionCache = new Map();
    const sectionFor = (w) => {
        const key = Math.round(w * 200);
        let sec = sectionCache.get(key);
        if (!sec) { sec = ribbonSection(w, thickness, cornerR, bulge, cfg.frontSamples, cfg.cornerSamples); sectionCache.set(key, sec); }
        return sec;
    };
    const m = sectionFor(W).length;
    const ringVerts = rings.map((r) => {
        const sec = sectionFor(r.width);
        const pos = new Float32Array(m * 3), nrm = new Float32Array(m * 3);
        for (let j = 0; j < m; j++) {
            const s = sec[j];
            for (let c = 0; c < 3; c++) pos[j * 3 + c] = r.p1[c] + r.acrossUnit[c] * s[0] + r.front[c] * s[1];
            const prev = sec[(j - 1 + m) % m], next = sec[(j + 1) % m];
            const ex = next[0] - prev[0], ey = next[1] - prev[1];
            const nl = Math.hypot(ex, ey) || 1;
            for (let c = 0; c < 3; c++) nrm[j * 3 + c] = r.acrossUnit[c] * (ey / nl) + r.front[c] * (-ex / nl);
        }
        return { pos, nrm };
    });

    // --- 5. one geometry per painted piece, each owning the span to the next.
    const group = new THREE.Group();
    group.name = icon.id + ':ribbon';
    const inner = new THREE.Group();
    inner.name = 'artwork';
    group.add(inner);
    const pieces = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let zMin = Infinity, zMax = -Infinity;

    parts.forEach((part, k) => {
        const [first, last] = ranges[k];
        const ringIds = [];
        for (let r = first; r <= last; r++) ringIds.push(r);
        ringIds.push((last + 1) % N);
        const count = ringIds.length * m;
        const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
        ringIds.forEach((ring, ri) => {
            for (let j = 0; j < m; j++) {
                const src = j * 3, dst = (ri * m + j) * 3;
                pos[dst] = ringVerts[ring].pos[src]; pos[dst + 1] = ringVerts[ring].pos[src + 1]; pos[dst + 2] = ringVerts[ring].pos[src + 2];
                nrm[dst] = ringVerts[ring].nrm[src]; nrm[dst + 1] = ringVerts[ring].nrm[src + 1]; nrm[dst + 2] = ringVerts[ring].nrm[src + 2];
                if (pos[dst + 2] < zMin) zMin = pos[dst + 2]; if (pos[dst + 2] > zMax) zMax = pos[dst + 2];
            }
        });
        const idx = [];
        for (let ri = 0; ri < ringIds.length - 1; ri++) {
            const a0 = ri * m, b0 = (ri + 1) * m;
            for (let j = 0; j < m; j++) {
                const jn = (j + 1) % m;
                idx.push(a0 + j, a0 + jn, b0 + j, a0 + jn, b0 + jn, b0 + j);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        geometry.setIndex(idx);

        const bounds = subpathsBounds(part.subpaths);
        minX = Math.min(minX, bounds[0]); minY = Math.min(minY, bounds[1]);
        maxX = Math.max(maxX, bounds[2]); maxY = Math.max(maxY, bounds[3]);
        const cf = compileFill(part.piece.fill, bounds);
        const glsl = fillGLSL('svgFill', cf);
        const key = `icon3d:${icon.id}:ribbon:${part.id}`;
        const materials = {
            colour: applyGradient(new THREE.MeshPhysicalMaterial({
                color: 0xffffff, roughness: cfg.roughness, metalness: 0,
                clearcoat: cfg.clearcoat, clearcoatRoughness: cfg.clearcoatRoughness, envMapIntensity: cfg.envMapIntensity,
            }), glsl, key + ':colour'),
            clay: new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.72, metalness: 0 }),
            unlit: applyGradient(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), glsl, key + ':unlit'),
            ids: new THREE.MeshBasicMaterial({ color: new THREE.Color(...ID_COLOURS[part.piece.index % ID_COLOURS.length]), toneMapped: false }),
        };
        const meshObj = new THREE.Mesh(geometry, materials.colour);
        meshObj.name = part.id;
        meshObj.userData.d = part.piece.d;
        meshObj.castShadow = true;
        meshObj.receiveShadow = true;
        inner.add(meshObj);
        pieces.push({ id: part.id, index: part.piece.index, layer: 0, mesh: meshObj, geometry, materials, bounds, fill: cf });
    });
    pieces.sort((a, b) => a.index - b.index);

    const bounds = [minX, minY, maxX, maxY];
    const width = maxX - minX, height = maxY - minY;
    const size = opts.size || 2;
    const scale = size / Math.max(width, height);
    inner.position.set(-(minX + maxX) / 2, maxY, 0);
    group.scale.setScalar(scale);

    return {
        group, inner, pieces, bounds, scale,
        width: width * scale, height: height * scale, thickness: thickness * scale,
        depthExtent: [zMin * scale, zMax * scale],
        rings: N, sectionPoints: m, ribbonWidth: W,
        setMode(mode) { for (const p of pieces) p.mesh.material = p.materials[mode] || p.materials.colour; },
        dispose() { for (const p of pieces) { p.geometry.dispose(); Object.values(p.materials).forEach((mm) => mm.dispose()); } },
    };
}
