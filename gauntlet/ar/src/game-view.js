/**
 * game-view.js — Birb Gauntlet's world, rendered into a texture.
 *
 * This is a SECOND boot of the game, not a second copy of it. Everything here
 * imports the shipped modules from `/gauntlet/src/`; nothing is duplicated. It
 * is deliberately slimmer than `gauntlet/index.html`'s boot: on a screen that
 * occupies a fraction of a phone's view at 2m, the race course, rival AI, HUD,
 * minimap and mini-game systems are all detail you cannot resolve, and every
 * one of them costs draw calls that the AR composite pass now needs.
 *
 * What survives is the part the AR concept is actually about: a planet, a sky,
 * a bird, and the flight model, driven by the same joystick.
 *
 * WHY IT LIVES INSIDE gauntlet/ — `gauntlet/ARCHITECTURE.md` rule 1 says nothing
 * outside `gauntlet/` may import from inside it. The AR page needs these
 * modules, so the AR page lives in here and `/ar` routes to it. The invariant is
 * kept rather than relaxed.
 *
 * Ordering note carried over from the parent boot: the flight model owns the
 * bird's transform, and nothing else may write it in the same frame.
 */

import { PLANET_RADIUS, continentalHeight } from '/gauntlet/src/core/terrain.js';
import { PALETTE, birdColorById } from '/gauntlet/src/core/palette.js';
import { createLightRig } from '/gauntlet/src/core/toon.js';

/**
 * Fixed, modest, and PORTRAIT 9:16 to match ar-screen.js's plane. Portrait is
 * also the aspect Gauntlet is composed for — its chase camera and framing were
 * tuned against 390x844 phone captures — so rendering it landscape for the AR
 * screen was doubly off-design.
 */
export const RT_SIZE = Object.freeze({ low: [360, 640], mid: [504, 896], high: [648, 1152] });

const BIRD_SCALE = 2.0;

export async function createGameView(THREE, renderer, opts = {}) {
    const quality = opts.quality || 'mid';
    const seed = opts.seed ?? 0x5eed;

    const [
        { createPlanet }, { createSky },
        { createBird }, { createBirdAnimator },
        { GauntletFlight }, { createChaseCamera },
        { createFeatherFX },
    ] = await Promise.all([
        import('/gauntlet/src/world/planet.js'),
        import('/gauntlet/src/world/sky.js'),
        import('/gauntlet/src/bird/bird-model.js'),
        import('/gauntlet/src/bird/bird-anim.js'),
        import('/gauntlet/src/bird/flight.js'),
        import('/gauntlet/src/camera/chase-camera.js'),
        import('/gauntlet/src/fx/feathers.js'),
    ]);

    // --- render target -----------------------------------------------------
    const [rtW, rtH] = RT_SIZE[quality] || RT_SIZE.mid;
    const target = new THREE.WebGLRenderTarget(rtW, rtH, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        // WebGL2 multisampling. Cheaper and better here than rendering at 2x
        // and downsampling, and the screen's edges are where aliasing shows.
        samples: quality === 'low' ? 0 : 4,
    });
    // The composite pass samples this as a plain colour map and writes sRGB
    // out. Without this the game renders through the screen visibly darker
    // than it does at /gauntlet — a double-decode that reads as "the AR mode
    // has worse lighting".
    target.texture.colorSpace = THREE.SRGBColorSpace;
    target.depthBuffer = true;

    // --- scene -------------------------------------------------------------
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PALETTE.fog, 45, 200);
    const camera = new THREE.PerspectiveCamera(62, rtW / rtH, 0.5, 3000);
    createLightRig(THREE, scene);

    const sky = createSky(THREE, { quality });
    scene.add(sky.group);

    const planet = createPlanet(THREE, { quality, seed });
    scene.add(planet.group);

    const feathers = createFeatherFX(THREE, { quality });
    scene.add(feathers.group);

    // --- bird --------------------------------------------------------------
    const plumage = birdColorById(opts.birdColor);
    const bird = createBird(THREE, {
        bodyColor: plumage.body,
        bellyColor: plumage.belly,
        scale: BIRD_SCALE,
        quality,
        outline: true,
    });
    scene.add(bird.group);
    const animator = createBirdAnimator(THREE, bird);

    // Spawn above the baseline. The flight floor is `PLANET_RADIUS + min(0,
    // terrainHeight)`, i.e. never above PLANET_RADIUS, so anything clear of the
    // radius cannot spawn inside the ground.
    const _startPos = new THREE.Vector3(0, 0, PLANET_RADIUS + 12);
    const flight = new GauntletFlight(THREE, {
        sphereRadius: PLANET_RADIUS,
        terrainHeightAt: continentalHeight,
        birdRadius: 1.6,
        position: _startPos,
    });

    // Heading must be TANGENT to the sphere or the first frame is a dive or a
    // climb. up x worldY gives a tangent; the degenerate case (spawning at a
    // pole) is guarded because it silently yields a zero vector.
    const _up = new THREE.Vector3().copy(_startPos).normalize();
    const _fwd = new THREE.Vector3(0, 1, 0).cross(_up);
    if (_fwd.lengthSq() < 1e-6) _fwd.set(1, 0, 0).cross(_up);
    _fwd.normalize();
    flight.setHeading(_fwd.x, _fwd.y, _fwd.z);

    // Casual's envelope: gentler rates, slower speed, so the world does not
    // arrive faster than you can read it — doubly true on a small floating
    // screen you are also holding a phone steady at.
    flight.yawRate *= 0.9;
    flight.pitchRate *= 0.9;
    flight.setSpeedScale(0.8);

    const chase = createChaseCamera(THREE, camera, { quality });
    chase.setMode('chase');
    chase.snapToTarget(flight.position, flight.quaternion);

    // --- pre-allocated frame scratch ---------------------------------------
    const animState = {
        speed01: 0.5, turn: 0, pitch: 0, boosting: false, flapImpulse: 0,
        tumbling: false, grounded: false, celebrating: false, phase: 0,
    };
    const _radial = new THREE.Vector3();
    /** Cost of the game pass only. Mutated in place; never replaced. */
    const frameStats = { calls: 0, triangles: 0 };
    let running = false;

    /**
     * Advance and render one frame into the target. Zero allocation.
     * @param {number} dt seconds, already clamped by the caller
     * @param {{x:number,y:number,boost:boolean}} input
     */
    function tick(dt, input) {
        const pose = flight.tick(running ? input : ZERO_INPUT, running ? dt : 0);

        bird.group.position.copy(pose.position);
        bird.group.quaternion.copy(pose.quaternion);

        animState.speed01 = flight.speed01 !== undefined ? flight.speed01 : 0.5;
        animState.turn = input.x;
        animState.pitch = input.y;
        animState.boosting = Boolean(flight.isBoosting);
        // Stick UP is +y and climbs, so the hardest flapping belongs to the
        // climb. The parent game had this inverted for months and the wings
        // read as decorative.
        animState.flapImpulse = input.y > 0 ? input.y : 0;
        animator.update(dt, animState);

        _radial.copy(pose.position).normalize();
        feathers.emitTrail(
            pose.position.x, pose.position.y, pose.position.z,
            _radial.x, _radial.y, _radial.z,
            plumage.feather
        );
        feathers.update(dt);

        sky.update(dt, camera);
        planet.update(dt, _radial.x, _radial.y, _radial.z);
        chase.update(dt, pose.position, pose.quaternion, animState.speed01, 0);

        // Clear colour is renderer-global state shared with the AR composite
        // pass, which clears TRANSPARENT so the camera feed shows through. This
        // pass must set its own or the game renders over a transparent void and
        // the screen shows the room through its own sky wherever the dome does
        // not cover — most visibly at the horizon seam.
        const prev = renderer.getRenderTarget();
        renderer.setClearColor(PALETTE.skyMid, 1);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        renderer.setRenderTarget(prev);

        // `renderer.info.render` resets on every render() call, so by the time
        // the AR composite pass has drawn, this pass's cost is gone. Read it
        // here or the HUD reports 3 draw calls for a frame that really cost
        // ~30 — an under-report that would hide a budget blowout completely.
        frameStats.calls = renderer.info.render.calls;
        frameStats.triangles = renderer.info.render.triangles;
    }

    function start() { running = true; }
    function stop() { running = false; }

    function dispose() {
        sky.dispose(); planet.dispose(); feathers.dispose();
        bird.dispose(); animator.dispose(); chase.dispose();
        target.dispose();
    }

    return {
        texture: target.texture,
        target,
        tick, start, stop, dispose,
        frameStats,
        get speed01() { return flight.speed01 || 0; },
        get position() { return flight.position; },
        stats: {
            planetDrawCalls: planet.drawCallCount || 0,
            planetTriangles: planet.triangleCount || 0,
            rtWidth: rtW, rtHeight: rtH,
        },
    };
}

/** Frozen so a subsystem cannot write to it and quietly steer the bird. */
const ZERO_INPUT = Object.freeze({ x: 0, y: 0, boost: false });
