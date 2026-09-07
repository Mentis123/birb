/**
 * icon3d — the pure SVG maths under the extruder: path grammar, hole
 * assignment and gradient evaluation. No THREE, no DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    parsePath, arcToCubics, flattenSubpath, signedArea, subpathsBounds, cubicPoint,
} from '../icon3d/src/model/svg-path.js';
import { assignHoles, pointInPolygon } from '../icon3d/src/model/fill-shapes.js';
import {
    parseTransform, apply, invert, multiply, compileGradient, gradientParam, sampleStops,
    compileFill, evaluateFill, fillGLSL, hexToRgb,
} from '../icon3d/src/model/svg-gradient.js';
import { ICONS } from '../icon3d/src/icons/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const nearPt = (p, q, eps = 1e-6) => { near(p[0], q[0], eps); near(p[1], q[1], eps); };

// ---------------------------------------------------------------- svg-path

test('path: absolute M/L/Z square', () => {
    const [sub] = parsePath('M0 0 L10 0 L10 10 L0 10 Z');
    assert.equal(sub.x, 0); assert.equal(sub.y, 0);
    assert.equal(sub.segments.length, 3);
    assert.ok(sub.closed);
    assert.deepEqual(sub.segments.map((s) => s.kind), ['L', 'L', 'L']);
});

test('path: relative l and h/v', () => {
    const [sub] = parsePath('m10 10 l5 0 l0 5 z');
    nearPt([sub.segments[0].x, sub.segments[0].y], [15, 10]);
    nearPt([sub.segments[1].x, sub.segments[1].y], [15, 15]);
    const [box] = parsePath('M0 0h10v10h-10z');
    assert.deepEqual(flattenSubpath(box), [[0, 0], [10, 0], [10, 10], [0, 10]]);
});

test('path: implicit lineto after moveto and compact numbers', () => {
    const [a] = parsePath('M0 0 10 0 10 10');
    assert.equal(a.segments.length, 2);
    nearPt([a.segments[1].x, a.segments[1].y], [10, 10]);
    const [b] = parsePath('M1.5.5-1-2');
    nearPt([b.x, b.y], [1.5, 0.5]);
    nearPt([b.segments[0].x, b.segments[0].y], [-1, -2]);
    const [c] = parsePath('M1e1 2E-1L3 4');
    nearPt([c.x, c.y], [10, 0.2]);
});

test('path: cubic + smooth reflection', () => {
    const [sub] = parsePath('M0 0 C1 1 2 1 3 0 S5 -1 6 0');
    const s = sub.segments[1];
    assert.equal(s.kind, 'C');
    nearPt([s.x1, s.y1], [4, -1]);
    nearPt([s.x2, s.y2], [5, -1]);
    // S without a preceding cubic uses the current point as its first control.
    const [t] = parsePath('M0 0 L1 1 S3 3 4 4');
    nearPt([t.segments[1].x1, t.segments[1].y1], [1, 1]);
});

test('path: quadratics elevate exactly and T reflects', () => {
    const [sub] = parsePath('M0 0 Q5 10 10 0 T20 0');
    const q = sub.segments[0];
    nearPt([q.x1, q.y1], [10 / 3, 20 / 3]);
    nearPt([q.x2, q.y2], [20 / 3, 20 / 3]);
    nearPt([q.x, q.y], [10, 0]);
    // The elevated cubic passes through the quadratic's midpoint.
    nearPt(cubicPoint(0, 0, q.x1, q.y1, q.x2, q.y2, q.x, q.y, 0.5), [5, 5]);
    const t = sub.segments[1];
    // reflected control (15,-10) → c1 = 10 + 2/3·5, 0 + 2/3·-10
    nearPt([t.x1, t.y1], [10 + 2 / 3 * 5, -20 / 3]);
});

test('path: arc → cubic lands on the right circle and the right side', () => {
    const [sub] = parsePath('M0 0 A10 10 0 0 1 10 10');
    assert.equal(sub.segments.length, 1);
    const s = sub.segments[0];
    nearPt([s.x, s.y], [10, 10]);
    // sweep=1, large=0 from (0,0) to (10,10) is the arc centred on (0,10).
    const mid = cubicPoint(0, 0, s.x1, s.y1, s.x2, s.y2, s.x, s.y, 0.5);
    nearPt(mid, [10 * Math.SQRT1_2, 10 - 10 * Math.SQRT1_2], 0.02);
    // The other sweep picks the other centre.
    const [o] = parsePath('M0 0 A10 10 0 0 0 10 10');
    const os = o.segments[0];
    const omid = cubicPoint(0, 0, os.x1, os.y1, os.x2, os.y2, os.x, os.y, 0.5);
    nearPt(omid, [10 - 10 * Math.SQRT1_2, 10 * Math.SQRT1_2], 0.02);
});

test('path: arc flags without separators, degenerate arcs', () => {
    const [sub] = parsePath('M0 0a1 1 0 00-1 1');
    nearPt([sub.segments.at(-1).x, sub.segments.at(-1).y], [-1, 1]);
    assert.deepEqual(arcToCubics(1, 1, 5, 5, 0, false, false, 1, 1), []);
    assert.deepEqual(arcToCubics(0, 0, 0, 5, 0, false, false, 3, 4), [{ kind: 'L', x: 3, y: 4 }]);
});

test('path: a full circle from two arcs has the area of a circle', () => {
    const [sub] = parsePath('M-5 0A5 5 0 1 0 5 0A5 5 0 1 0 -5 0Z');
    assert.equal(sub.segments.length, 4); // two half-turns, two quarter cubics each
    const area = Math.abs(signedArea(flattenSubpath(sub, 16)));
    near(area, Math.PI * 25, Math.PI * 25 * 0.002);
});

test('path: several subpaths, and a segment after Z starts a new one at the start point', () => {
    const subs = parsePath('M0 0h1v1h-1z M5 5h1v1h-1z');
    assert.equal(subs.length, 2);
    nearPt([subs[1].x, subs[1].y], [5, 5]);
    const again = parsePath('M2 3h1v1z h2 v2');
    assert.equal(again.length, 2);
    nearPt([again[1].x, again[1].y], [2, 3]);
    assert.throws(() => parsePath('10 10'));
    assert.throws(() => parsePath('M0 0 Z 5 5'));
});

test('path: bounds and area sign', () => {
    const subs = parsePath('M0 0h10v10h-10z');
    assert.deepEqual(subpathsBounds(subs), [0, 0, 10, 10]);
    // y-down SVG: this ring is clockwise on screen, positive by the shoelace in raw coordinates.
    assert.ok(signedArea(flattenSubpath(subs[0])) > 0);
});

test('path: every Copilot piece is one closed subpath inside its viewBox', () => {
    for (const icon of Object.values(ICONS)) {
        const [vx, vy, vw, vh] = icon.viewBox;
        for (const piece of icon.pieces) {
            const subs = parsePath(piece.d);
            assert.equal(subs.length, 1, `${icon.id}/${piece.id}`);
            assert.ok(subs[0].closed, `${icon.id}/${piece.id} closed`);
            const [minX, minY, maxX, maxY] = subpathsBounds(subs);
            assert.ok(minX >= vx - 1 && maxX <= vx + vw + 1, `${piece.id} x within viewBox`);
            assert.ok(minY >= vy - 1 && maxY <= vy + vh + 1, `${piece.id} y within viewBox`);
        }
    }
    const [fold] = parsePath(ICONS['copilot-2023'].pieces[0].d);
    assert.equal(fold.segments.length, 12);
    const b = subpathsBounds([fold]);
    near(b[0], 21.4805, 1e-3); near(b[1], 4, 1e-3); near(b[2], 40.8213, 1e-3); near(b[3], 20.4072, 1e-3);
});

// ------------------------------------------------------------- fill-shapes

const ring = (x, y, s, cw) => cw
    ? `M${x} ${y}h${s}v${s}h${-s}z`
    : `M${x} ${y}v${s}h${s}v${-s}z`;

test('holes: nonzero, opposite winding → hole', () => {
    const solids = assignHoles(parsePath(ring(0, 0, 10, true) + ring(2, 2, 6, false)));
    assert.equal(solids.length, 1);
    assert.equal(solids[0].holes.length, 1);
});

test('holes: nonzero, same winding → nested ring is invisible', () => {
    const solids = assignHoles(parsePath(ring(0, 0, 10, true) + ring(2, 2, 6, true)));
    assert.equal(solids.length, 1);
    assert.equal(solids[0].holes.length, 0);
});

test('holes: evenodd ignores winding', () => {
    const solids = assignHoles(parsePath(ring(0, 0, 10, true) + ring(2, 2, 6, true)), { fillRule: 'evenodd' });
    assert.equal(solids.length, 1);
    assert.equal(solids[0].holes.length, 1);
});

test('holes: an island inside a hole is a solid of its own', () => {
    const d = ring(0, 0, 20, true) + ring(2, 2, 16, false) + ring(6, 6, 8, true);
    const solids = assignHoles(parsePath(d));
    assert.equal(solids.length, 2);
    const outer = solids.find((s) => s.holes.length === 1);
    const island = solids.find((s) => s.holes.length === 0);
    assert.ok(outer && island);
    assert.equal(island.contour.x, 6);
    // and the same under evenodd
    const eo = assignHoles(parsePath(d), { fillRule: 'evenodd' });
    assert.equal(eo.length, 2);
});

test('holes: disjoint rings are separate solids; degenerate rings are dropped', () => {
    const solids = assignHoles(parsePath(ring(0, 0, 5, true) + ring(20, 20, 5, false) + 'M50 50h3z'));
    assert.equal(solids.length, 2);
    assert.ok(pointInPolygon(2, 2, [[0, 0], [5, 0], [5, 5], [0, 5]]));
    assert.ok(!pointInPolygon(7, 2, [[0, 0], [5, 0], [5, 5], [0, 5]]));
});

test('holes: every Copilot piece is a single solid without holes', () => {
    for (const icon of Object.values(ICONS)) {
        for (const piece of icon.pieces) {
            const solids = assignHoles(parsePath(piece.d));
            assert.equal(solids.length, 1, `${icon.id}/${piece.id}`);
            assert.equal(solids[0].holes.length, 0, `${icon.id}/${piece.id}`);
        }
    }
});

// ------------------------------------------------------------ svg-gradient

test('transform: parse, compose, invert', () => {
    nearPt(apply(parseTransform('translate(10 20)'), 0, 0), [10, 20]);
    nearPt(apply(parseTransform('rotate(90)'), 1, 0), [0, 1]);
    nearPt(apply(parseTransform('translate(10 0) scale(2)'), 1, 0), [12, 0]);
    nearPt(apply(parseTransform('rotate(90 5 5)'), 5, 0), [10, 5]);
    nearPt(apply(parseTransform('matrix(1 0 0 1 3 4)'), 1, 1), [4, 5]);
    nearPt(apply(parseTransform('skewX(45)'), 0, 1), [1, 1]);
    const m = parseTransform('translate(-402710.6509 -405348.4949) rotate(116.7194) scale(232.2644 -445.8898) skewX(-9.7245)');
    const p = [123.4, 456.7];
    nearPt(apply(invert(m), ...apply(m, ...p)), p, 1e-6);
    nearPt(apply(multiply(m, invert(m)), 7, 9), [7, 9], 1e-6);
    assert.throws(() => parseTransform('spin(3)'));
});

test('gradient: linear and radial parameters, clamped', () => {
    const lin = compileGradient({ type: 'linear', units: 'userSpaceOnUse', x1: 0, y1: 0, x2: 10, y2: 0, stops: [[0, '#000'], [1, '#fff']] });
    near(gradientParam(lin, 5, 0), 0.5);
    near(gradientParam(lin, -3, 7), 0);
    near(gradientParam(lin, 20, 0), 1);
    const rad = compileGradient({ type: 'radial', units: 'userSpaceOnUse', cx: 0, cy: 0, r: 1, transform: 'translate(5 5) scale(10)', stops: [[0, '#000'], [1, '#fff']] });
    near(gradientParam(rad, 5, 5), 0);
    near(gradientParam(rad, 15, 5), 1);
    near(gradientParam(rad, 10, 5), 0.5);
    near(gradientParam(rad, 5, 0), 0.5);
    const bbox = compileGradient({ type: 'linear', stops: [[0, '#000'], [1, '#fff']] }, [10, 10, 30, 20]);
    near(gradientParam(bbox, 20, 15), 0.5);
    near(gradientParam(bbox, 30, 11), 1);
    assert.throws(() => compileGradient({ type: 'linear', stops: [[0, '#000'], [1, '#fff']] }));
});

test('gradient: stops interpolate in premultiplied sRGB', () => {
    const cg = compileGradient({ type: 'linear', units: 'userSpaceOnUse', x2: 1, stops: [[0, '#000000'], [1, '#ffffff']] });
    assert.deepEqual(sampleStops(cg.stops, 0.5), [0.5, 0.5, 0.5, 1]);
    assert.deepEqual(sampleStops(cg.stops, -1), [0, 0, 0, 1]);
    assert.deepEqual(sampleStops(cg.stops, 2), [1, 1, 1, 1]);
    const fade = compileGradient({ type: 'linear', units: 'userSpaceOnUse', x2: 1, stops: [[0, '#ff0000', 1], [1, '#0000ff', 0]] });
    const [r, g, b, a] = sampleStops(fade.stops, 0.5);
    // The colour stays red while only the alpha fades — no dark blue band.
    near(r, 1); near(g, 0); near(b, 0); near(a, 0.5);
    assert.deepEqual(hexToRgb('#fff'), [1, 1, 1]);
});

test('gradient: overlay composites over the base', () => {
    const cf = compileFill({
        base: '#000000',
        overlay: { type: 'linear', units: 'userSpaceOnUse', x1: 0, y1: 0, x2: 10, y2: 0, stops: [[0, '#ffffff', 1], [1, '#ffffff', 0]] },
    }, [0, 0, 10, 10]);
    const c = evaluateFill(cf, 5, 3);
    near(c[0], 0.5); near(c[1], 0.5); near(c[2], 0.5);
});

test('gradient: the Copilot blue band runs cyan sheen → blue → yellow, top to bottom', () => {
    const icon = ICONS['copilot-2023'];
    const band = icon.pieces.find((p) => p.id === 'band_blue');
    const cf = compileFill(band.fill, subpathsBounds(parsePath(band.d)));
    const top = evaluateFill(cf, 14.5, 4.2);      // under the sheen
    assert.ok(top[2] > 0.9 && top[0] < 0.4, `top is cyan: ${top}`);
    const mid = evaluateFill(cf, 13, 18);         // green belt
    assert.ok(mid[1] > mid[0] && mid[1] > mid[2], `middle is green: ${mid}`);
    const bottom = evaluateFill(cf, 10, 32);      // yellow hem
    assert.ok(bottom[0] > 0.9 && bottom[1] > 0.7 && bottom[2] < 0.2, `bottom is yellow: ${bottom}`);
    const pink = icon.pieces.find((p) => p.id === 'band_pink');
    const pf = compileFill(pink.fill, subpathsBounds(parsePath(pink.d)));
    const purple = evaluateFill(pf, 42, 16);
    assert.ok(purple[2] > purple[1] && purple[0] < purple[2], `top right is purple: ${purple}`);
    const orange = evaluateFill(pf, 22, 42);
    assert.ok(orange[0] > 0.9 && orange[2] < 0.5, `bottom left is orange: ${orange}`);
});

test('gradient: GLSL emitter produces finite, named code for every piece', () => {
    for (const icon of Object.values(ICONS)) {
        for (const piece of icon.pieces) {
            const cf = compileFill(piece.fill, subpathsBounds(parsePath(piece.d)));
            const src = fillGLSL('fill_' + piece.id, cf);
            assert.ok(src.startsWith('vec3 fill_' + piece.id + '(vec2 p)'));
            assert.ok(!/NaN|Infinity|undefined|null/.test(src), src);
            assert.ok(src.includes('mix('));
            // every literal carries a decimal point so GLSL never sees an int where a float is due
            for (const lit of src.match(/-?\d+(\.\d+)?(e[-+]?\d+)?/g)) {
                if (/^\d+$/.test(lit) && !src.includes(lit + '.')) { /* exponents are fine */ }
            }
        }
    }
});
