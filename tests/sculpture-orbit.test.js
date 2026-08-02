import test from 'node:test';
import assert from 'node:assert/strict';

import { panBasis } from '../sculpture/src/view/orbit.js';

/**
 * Two-finger pan moves the point the camera orbits along the camera's own
 * screen axes. That is one small piece of maths and a sign error in it is
 * invisible in review: the pan works perfectly from the front and then goes
 * backwards the moment you orbit round behind the group. These pin the basis
 * against the same camera placement `update()` uses, so the two can never drift
 * apart silently.
 */

const DEG = Math.PI / 180;

/** Where update() puts the camera, for a target at the origin. */
function cameraOffset(yaw, pitch, distance) {
    const cp = Math.cos(pitch);
    return {
        x: Math.sin(yaw) * cp * distance,
        y: Math.sin(pitch) * distance,
        z: Math.cos(yaw) * cp * distance,
    };
}

function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function near(a, b, eps = 1e-9) {
    assert.ok(Math.abs(a - b) < eps, `${a} !~= ${b}`);
}

const CASES = [
    { yaw: 0, pitch: 0 },
    { yaw: 0, pitch: 40 * DEG },
    { yaw: 90 * DEG, pitch: 12 * DEG },
    { yaw: 180 * DEG, pitch: 30 * DEG },
    { yaw: -125 * DEG, pitch: 55 * DEG },
    { yaw: 2.9, pitch: -4 * DEG },
];

test('panBasis returns unit vectors', () => {
    for (const { yaw, pitch } of CASES) {
        const b = panBasis(yaw, pitch);
        near(Math.hypot(b.rx, b.ry, b.rz), 1);
        near(Math.hypot(b.ux, b.uy, b.uz), 1);
    }
});

test('right and up are perpendicular to each other and to the view direction', () => {
    for (const { yaw, pitch } of CASES) {
        const b = panBasis(yaw, pitch);
        const right = { x: b.rx, y: b.ry, z: b.rz };
        const up = { x: b.ux, y: b.uy, z: b.uz };
        // The camera looks from its offset back to the target, so the view
        // direction is the negated offset.
        const off = cameraOffset(yaw, pitch, 5);
        const view = { x: -off.x, y: -off.y, z: -off.z };
        near(dot(right, up), 0, 1e-12);
        near(dot(right, view), 0, 1e-9);
        near(dot(up, view), 0, 1e-9);
    }
});

test('screen right is world +X when looking along -Z at the group front', () => {
    const b = panBasis(0, 0);
    near(b.rx, 1);
    near(b.ry, 0);
    near(b.rz, 0);
    // And screen up is world +Y with no pitch.
    near(b.ux, 0);
    near(b.uy, 1);
    near(b.uz, 0);
});

test('screen right flips when you orbit to the far side', () => {
    const front = panBasis(0, 10 * DEG);
    const back = panBasis(Math.PI, 10 * DEG);
    near(front.rx, -back.rx);
    near(front.rz, -back.rz, 1e-12);
});

test('up tilts away from world up as pitch rises, and never below the horizon', () => {
    // A camera looking down at the group has a screen-up that leans backward
    // over the top of it, so uy shrinks but stays positive across the pitch
    // range the viewer is clamped to (-4 to 62 degrees).
    let prev = Infinity;
    for (const deg of [-4, 0, 20, 40, 62]) {
        const b = panBasis(0, deg * DEG);
        assert.ok(b.uy > 0, `up.y should stay positive at ${deg} deg`);
        if (deg >= 0) {
            assert.ok(b.uy <= prev, `up.y should not grow as pitch rises (${deg} deg)`);
            prev = b.uy;
        }
    }
});

test('right stays horizontal at every pitch — panning sideways never changes height', () => {
    for (const { yaw, pitch } of CASES) {
        near(panBasis(yaw, pitch).ry, 0);
    }
});
