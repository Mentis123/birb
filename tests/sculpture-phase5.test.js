import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARM_POSES,
    FACE_STYLES,
    PREGNANCY_SHAPE,
    ROLE_BODY_STYLES,
    buildFigure,
} from '../sculpture/src/model/figure.js';
import { FIGURE_LAYOUT } from '../sculpture/src/model/sculpture.js';
import {
    IDENTITY_AUDIT_VIEWS,
    PHASE5_ACCEPTANCE_VIEWS,
} from '../tools/sculpture-views.mjs';
import { SCULPTURE_THREE as THREE } from './helpers/sculpture-three.js';

function bounds(geometry) {
    const p = geometry.attributes.position;
    const out = {
        minX: Infinity, maxX: -Infinity,
        minY: Infinity, maxY: -Infinity,
        minZ: Infinity, maxZ: -Infinity,
    };
    for (let i = 0; i < p.count; i++) {
        out.minX = Math.min(out.minX, p.getX(i));
        out.maxX = Math.max(out.maxX, p.getX(i));
        out.minY = Math.min(out.minY, p.getY(i));
        out.maxY = Math.max(out.maxY, p.getY(i));
        out.minZ = Math.min(out.minZ, p.getZ(i));
        out.maxZ = Math.max(out.maxZ, p.getZ(i));
    }
    return out;
}

function edgeCounts(geometry) {
    const edges = new Map();
    const idx = geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
        for (const [a, b] of [
            [idx[i], idx[i + 1]],
            [idx[i + 1], idx[i + 2]],
            [idx[i + 2], idx[i]],
        ]) {
            const key = a < b ? a + ':' + b : b + ':' + a;
            edges.set(key, (edges.get(key) || 0) + 1);
        }
    }
    return {
        boundary: [...edges.values()].filter((count) => count === 1).length,
        nonmanifold: [...edges.values()].filter((count) => count > 2).length,
    };
}

test('six alternating reliefs preserve the photographed physical order and facing', () => {
    assert.deepEqual(
        FIGURE_LAYOUT.map((figure) => figure.id),
        [
            'outward-developing',
            'hospital-doctor',
            'outward-mother',
            'hospital-pregnant',
            'outward-visitor',
            'hospital-badge',
        ],
    );
    assert.deepEqual(
        FIGURE_LAYOUT.map((figure) => figure.side),
        ['outward', 'hospital', 'outward', 'hospital', 'outward', 'hospital'],
    );
    assert.equal(FIGURE_LAYOUT.length, 6);

    const visitor = FIGURE_LAYOUT.find((figure) => figure.identity === 'visitor');
    assert.ok(visitor.turn > 0.30, 'visitor panel retains the photographed profile turn');
    assert.ok(visitor.headTurn > 0.10, 'visitor face continues the profile turn');
    for (const figure of FIGURE_LAYOUT) {
        assert.ok(Math.abs(figure.headTurn) < 0.75, figure.id + ' keeps an anatomical local head turn');
        if (figure.side === 'outward') {
            assert.ok(Math.cos(figure.turn) > 0.90, figure.id + ' faces the outward side');
        } else {
            assert.ok(Math.cos(figure.turn) < -0.90, figure.id + ' faces the hospital side');
        }
    }
});

test('the six narratives and hair treatments occur exactly once on the correct side', () => {
    const byIdentity = new Map(FIGURE_LAYOUT.map((figure) => [figure.identity, figure]));
    assert.deepEqual([...byIdentity.keys()].sort(), [
        'badge', 'developing', 'doctor', 'mother', 'pregnant', 'visitor',
    ]);

    assert.equal(byIdentity.get('developing').side, 'outward');
    assert.ok(byIdentity.get('developing').belly > 0 && byIdentity.get('developing').belly < 0.35);
    assert.equal(byIdentity.get('mother').side, 'outward');
    assert.equal(byIdentity.get('mother').baby, true);
    assert.equal(byIdentity.get('visitor').side, 'outward');

    assert.equal(byIdentity.get('badge').side, 'hospital');
    assert.equal(byIdentity.get('badge').badge, true);
    assert.equal(byIdentity.get('pregnant').side, 'hospital');
    assert.equal(byIdentity.get('pregnant').belly, 1);
    assert.equal(byIdentity.get('doctor').side, 'hospital');
    assert.equal(byIdentity.get('doctor').stethoscope, true);

    assert.deepEqual(
        Object.fromEntries([...byIdentity].map(([id, figure]) => [id, figure.hair])),
        {
            developing: 'none',
            doctor: 'cap',
            mother: 'capbun',
            pregnant: 'cap',
            visitor: 'capbun',
            badge: 'none',
        },
    );

    assert.equal(FIGURE_LAYOUT.filter((figure) => figure.baby).length, 1);
    assert.equal(FIGURE_LAYOUT.filter((figure) => figure.stethoscope).length, 1);
    assert.equal(FIGURE_LAYOUT.filter((figure) => figure.badge).length, 1);
    assert.equal(FIGURE_LAYOUT.filter((figure) => figure.belly === 1).length, 1);
});
test('role contours and arm gestures encode the photographed six narratives', () => {
    const identities = FIGURE_LAYOUT.map((figure) => figure.identity).sort();
    assert.deepEqual(Object.keys(ROLE_BODY_STYLES).sort(), identities);

    const contourSignatures = Object.values(ROLE_BODY_STYLES)
        .map((style) => JSON.stringify(style.contour));
    const bustSignatures = Object.values(ROLE_BODY_STYLES)
        .map((style) => JSON.stringify(style.bust));
    assert.equal(new Set(contourSignatures).size, 6, 'every role needs its own height contour');
    assert.equal(new Set(bustSignatures).size, 6, 'every role needs its own chest proportions');

    const developing = ARM_POSES.developing;
    const maxContour = (identity, column) => Math.max(
        ...ROLE_BODY_STYLES[identity].contour.map((row) => row[column]),
    );
    const [, upperY, , upperRx, upperRy] = PREGNANCY_SHAPE.upper;
    const [, lowerY, , lowerRx, lowerRy] = PREGNANCY_SHAPE.lower;
    const pregnancyHeight = Math.max(upperY + upperRy, lowerY + lowerRy)
        - Math.min(upperY - upperRy, lowerY - lowerRy);
    assert.ok(
        pregnancyHeight > 0.50 && pregnancyHeight < 0.55,
        'localized pregnancy must retain the measured half-metre vertical zone',
    );
    assert.ok(
        Math.max(upperRx, lowerRx) * 2 > 0.36
            && Math.max(upperRx, lowerRx) * 2 < 0.41,
        'localized pregnancy must retain its measured broad cast width',
    );
    assert.ok(
        PREGNANCY_SHAPE.joinBlend >= 0.09 && PREGNANCY_SHAPE.torsoBlend >= 0.08,
        'pregnancy volumes must blend deeply into each other and the trunk',
    );
    assert.ok(
        maxContour('pregnant', 2) > maxContour('doctor', 2) + 0.10,
        'pregnant trunk remains locally fuller where the blended volume attaches',
    );
    assert.ok(
        maxContour('developing', 1) > maxContour('doctor', 1) + 0.10,
        'developing and clinical silhouettes must remain visibly distinct',
    );

    assert.ok(developing[1].wrist[0] < developing[1].elbow[0] - 0.10,
        'developing forearm must cross inward over the lower abdomen');
    assert.ok(developing[1].tip[0] < 0,
        'developing gesture must finish across the centre line');

    const pregnancy = ARM_POSES.pregnant;
    assert.ok(pregnancy.every((arm) => !arm.tip && !arm.support),
        'pregnancy references do not show a cupping arm');
    assert.ok(pregnancy.every((arm) => arm.depth <= 0.42),
        'pregnancy arms must remain shallow flank reliefs');
    assert.ok(ARM_POSES.clinical.every((arm) => arm.depth <= 0.44
        && arm.wrist[1] >= 1.05),
    'clinical arms must remain integrated flank reliefs rather than hanging rails');

});

test('face and crown parameters preserve six structural identities', () => {
    const identities = FIGURE_LAYOUT.map((figure) => figure.identity).sort();
    assert.deepEqual(Object.keys(FACE_STYLES).sort(), identities);

    const signatures = Object.values(FACE_STYLES).map((face) => JSON.stringify([
        face.headWidth, face.headHeight, face.faceWidth, face.nose, face.noseWidth,
        face.noseLean, face.mouth, face.browWidth, face.eyeSpacing, face.jaw,
        face.cheekAsym,
    ]));
    assert.equal(new Set(signatures).size, 6);
    assert.equal(FACE_STYLES.mother.rolls, 1);
    assert.equal(FACE_STYLES.visitor.rolls, 2);
    for (const identity of ['developing', 'doctor', 'pregnant', 'badge']) {
        assert.equal(FACE_STYLES[identity].rolls, 0);
    }

    const byIdentity = new Map(FIGURE_LAYOUT.map((figure) => [figure.identity, figure]));
    assert.ok(byIdentity.get('mother').headTurn >= 0.60,
        'mother retains the reference right-profile head turn');
    assert.ok(byIdentity.get('visitor').headTurn >= 0.25,
        'visitor retains the reference profile head turn');
});

test('all six production heads are closed manifold identity meshes', () => {
    for (const figure of FIGURE_LAYOUT) {
        const head = buildFigure(THREE, { ...figure, only: ['head'] });
        assert.deepEqual(edgeCounts(head), { boundary: 0, nonmanifold: 0 }, figure.id);
        assert.ok(head.index.count / 3 < 250000, figure.id + ' exceeds head triangle budget');
    }
});

test('the swept negative relief adds rear depth without moving the tuned front plane', () => {
    const common = {
        seed: 37,
        identity: 'mother',
        only: ['body'],
        torsoWidth: 0.98,
        torsoDepth: 0.80,
        stride: -1,
        strideAngle: 0.06,
        hemRake: 0.038,
    };
    const flat = buildFigure(THREE, { ...common, sheetDepth: 0 });
    const swept = buildFigure(THREE, { ...common, sheetDepth: 0.43 });
    const a = bounds(flat);
    const b = bounds(swept);

    assert.ok(b.minZ < a.minZ - 0.30, 'rear fin should add substantial depth');
    assert.ok(Math.abs(b.maxZ - a.maxZ) < 0.025, 'front relief plane should remain fixed');
    assert.deepEqual(edgeCounts(swept), { boundary: 0, nonmanifold: 0 });
});

test('all six production body fields remain closed manifolds within the mobile triangle budget', () => {
    const byIdentity = new Map();
    for (const figure of FIGURE_LAYOUT) {
        const body = buildFigure(THREE, { ...figure, only: ['body'] });
        assert.deepEqual(edgeCounts(body), { boundary: 0, nonmanifold: 0 }, figure.id);
        assert.ok(body.index.count / 3 < 178000, figure.id + ' exceeds body triangle budget');
        byIdentity.set(figure.identity, bounds(body));
    }

    assert.ok(
        byIdentity.get('pregnant').maxZ > byIdentity.get('doctor').maxZ + 0.08,
        'full pregnancy must remain a distinct forward body silhouette',
    );
});
test('identity audit covers a complete neutral orbit without duplicate angles', () => {
    assert.equal(IDENTITY_AUDIT_VIEWS.length, 8);
    assert.deepEqual(
        IDENTITY_AUDIT_VIEWS.map((view) => view.yaw),
        [0, 45, 90, 135, 180, 225, 270, 315],
    );
    assert.ok(IDENTITY_AUDIT_VIEWS.every((view) => view.viewport[0] === view.viewport[1]));
    assert.ok(IDENTITY_AUDIT_VIEWS.every((view) => view.target.length === 3));
});

test('Phase 5 visual gate retains both sides, fine details, feet and mobile views', () => {
    assert.equal(PHASE5_ACCEPTANCE_VIEWS.length, 14);
    const byId = new Map(PHASE5_ACCEPTANCE_VIEWS.map((view) => [view.id, view]));
    for (const id of [
        'p5-01-outward-order',
        'p5-02-hospital-order',
        'p5-03-negative-relief',
        'p5-04-newborn-support',
        'p5-05-pregnancy-instrument',
        'p5-06-grounded-feet',
        'p5-07-mobile-outward',
        'p5-08-mobile-hospital',
        'p5-09-outward-identities',
        'p5-10-hospital-identities',
        'p5-11-developing-face',
        'p5-12-badge-close',
        'p5-13-stethoscope-close',
        'p5-14-foot-close',
    ]) assert.ok(byId.has(id), 'missing Phase 5 view: ' + id);

    assert.deepEqual(byId.get('p5-07-mobile-outward').viewport, [390, 844]);
    assert.deepEqual(byId.get('p5-08-mobile-hospital').viewport, [390, 844]);
    assert.ok(byId.get('p5-07-mobile-outward').distance >= 5.2
        && byId.get('p5-07-mobile-outward').distance <= 6.0,
    'narrow outward view must fill the phone without clipping the group');
    assert.ok(byId.get('p5-08-mobile-hospital').distance >= 5.2
        && byId.get('p5-08-mobile-hospital').distance <= 6.0,
    'narrow hospital view must fill the phone without clipping the group');
    assert.ok(['p5-11-developing-face', 'p5-12-badge-close', 'p5-13-stethoscope-close', 'p5-14-foot-close']
        .every((id) => byId.get(id).distance <= 1.7 && byId.get(id).fov <= 22));
    assert.ok(byId.get('p5-07-mobile-outward').fov >= 48);
    assert.ok(byId.get('p5-08-mobile-hospital').fov >= 48);
    const mobileAxisDelta = Math.abs(byId.get('p5-08-mobile-hospital').yaw
        - byId.get('p5-07-mobile-outward').yaw);
    assert.equal(mobileAxisDelta, 180, 'phone views must inspect opposite ends of the folded axis');
    assert.ok(byId.get('p5-04-newborn-support').fov <= 28);
    const identityViews = [
        byId.get('p5-09-outward-identities'),
        byId.get('p5-10-hospital-identities'),
    ];
    assert.ok(identityViews.every((view) => view.photo && view.target[1] >= 2));
    assert.ok(identityViews.every((view) => view.distance <= 3.1));
    const feetView = byId.get('p5-06-grounded-feet');
    const cameraY = feetView.target[1]
        + Math.sin(feetView.pitch * Math.PI / 180) * feetView.distance;
    assert.ok(cameraY > 0.12, 'feet camera must stay above the paving');
    assert.ok(cameraY < 0.35, 'feet camera should retain the photographed low viewpoint');
});
