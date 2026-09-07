/**
 * view/studio.js — a product-shot studio built from nothing.
 *
 * The environment map is not a file. It is a PMREM capture of a small scene of
 * unlit boxes — grey walls, a bright ceiling softbox, a key panel up-left and a
 * cool rim panel behind — which is exactly how Three's own `RoomEnvironment`
 * addon works, minus the addon. That map is what puts the sheen on the plates:
 * a clearcoat with nothing to reflect is invisible.
 *
 * The directional light exists for the shadow only; an environment map lights
 * but cannot cast. Its intensity is set with the environment in mind — the two
 * are one exposure system, and turning the sun up to fix a dull plate washes
 * the gradient out instead.
 */

const DEG = Math.PI / 180;

export const STUDIO_DEFAULTS = {
    /** Page background and fog colour. */
    backdrop: 0xe4e7ec,
    /** The tile the icon stands on, sized relative to the icon width. */
    tile: true,
    tileScale: 1.5,
    tileThicknessFrac: 0.055,
    tileCornerFrac: 0.09,
    tileColor: 0xf1f2f4,
    keyIntensity: 2.4,
    envIntensity: 1.0,
};

function roundedRectShape(THREE, w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x + w, y + h - r);
    s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    s.lineTo(x + r, y + h);
    s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x, y + r);
    s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
}

/** A radiance "room" for the PMREM generator. Unlit materials ARE the light. */
function buildRoom(THREE) {
    const room = new THREE.Scene();
    const panel = (w, h, color, pos, lookAt) => {
        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(...color), side: THREE.DoubleSide }),
        );
        m.position.set(...pos);
        m.lookAt(...lookAt);
        room.add(m);
        return m;
    };
    const walls = new THREE.Mesh(
        new THREE.BoxGeometry(24, 24, 24),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.30, 0.32, 0.36), side: THREE.BackSide }),
    );
    room.add(walls);
    // floor: a shade darker so the underside of things reads as underside
    panel(24, 24, [0.16, 0.17, 0.19], [0, -11.9, 0], [0, 0, 0]);
    // ceiling softbox
    panel(7, 4.5, [4.5, 4.5, 4.6], [0, 11.5, 1], [0, 0, 1]);
    // key panel, upper left, in front
    panel(6, 6, [6.5, 6.3, 6.0], [-9, 6.5, 8], [0, 0, 0]);
    // fill panel, right, lower and dimmer
    panel(5, 5, [1.6, 1.7, 1.9], [10, 2, 6], [0, 0, 0]);
    // rim panel behind, cool
    panel(8, 4, [2.2, 2.5, 3.2], [6, 5, -10], [0, 0, 0]);
    return room;
}

/**
 * Populate `scene` with the studio: environment, lights, backdrop and tile.
 * `iconWidth` sizes the tile and the shadow camera.
 */
export function createStudio(THREE, renderer, scene, iconWidth, opts = {}) {
    const cfg = { ...STUDIO_DEFAULTS, ...opts };

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const room = buildRoom(THREE);
    const envRT = pmrem.fromScene(room, 0.035);
    scene.environment = envRT.texture;
    scene.environmentIntensity = cfg.envIntensity;
    pmrem.dispose();

    scene.background = new THREE.Color(cfg.backdrop);

    const key = new THREE.DirectionalLight(0xffffff, cfg.keyIntensity);
    key.position.set(-3.2, 5.5, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const reach = iconWidth * cfg.tileScale * 0.75;
    key.shadow.camera.left = -reach;
    key.shadow.camera.right = reach;
    key.shadow.camera.top = reach;
    key.shadow.camera.bottom = -reach;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.015;
    key.shadow.radius = 4;
    scene.add(key);
    scene.add(key.target);

    let tile = null;
    if (cfg.tile) {
        const w = iconWidth * cfg.tileScale;
        const t = w * cfg.tileThicknessFrac;
        const bevel = t * 0.32;
        const geo = new THREE.ExtrudeGeometry(roundedRectShape(THREE, w, w, w * cfg.tileCornerFrac), {
            depth: t - 2 * bevel,
            bevelEnabled: true,
            bevelThickness: bevel,
            bevelSize: bevel,
            bevelOffset: -bevel,
            bevelSegments: 5,
            curveSegments: 24,
        });
        // Built in XY; lay it flat with its top face at y = 0.
        geo.rotateX(-Math.PI / 2);
        geo.computeBoundingBox();
        geo.translate(0, -geo.boundingBox.max.y, 0);
        geo.computeVertexNormals();
        tile = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
            color: cfg.tileColor, roughness: 0.82, metalness: 0,
        }));
        tile.name = 'tile';
        tile.receiveShadow = true;
        tile.castShadow = true;
        scene.add(tile);
    }

    // A wide, faint contact shadow catcher under everything so the tile reads
    // as resting on a surface rather than hovering in the backdrop.
    const catcher = new THREE.Mesh(
        new THREE.CircleGeometry(iconWidth * 6, 48),
        new THREE.ShadowMaterial({ color: 0x1a2030, opacity: 0.16 }),
    );
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = tile ? -iconWidth * cfg.tileScale * cfg.tileThicknessFrac : 0;
    catcher.receiveShadow = true;
    scene.add(catcher);

    return { key, tile, catcher, env: envRT.texture, DEG };
}
