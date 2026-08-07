/**
 * ar-screen.js — the virtual screen that hangs in your room.
 *
 * A screen, a bezel, and a soft glow, parented into one group so placement is a
 * single transform. It is positioned in SPHERICAL coordinates around a fixed
 * viewer origin (azimuth, elevation, distance) rather than in free cartesian
 * space, because gyro AR has no positional tracking: the viewer never moves, so
 * every reachable placement is a point on a sphere around them anyway. Storing
 * it that way makes "drag to move" a two-angle problem instead of a
 * raycast-and-project problem, and makes the screen automatically face the
 * viewer.
 *
 * Zero external assets: the splash art, the bezel and the glow are all painted
 * into canvases here.
 *
 * Materials are deliberately `MeshBasicMaterial` with `toneMapped: false`. The
 * screen is a light SOURCE, not a lit surface — there is no light rig in the AR
 * scene, so a lambert/standard material would render pure black.
 */

import { PALETTE, CSS } from '/gauntlet/src/core/palette.js';

/**
 * PORTRAIT, 9:16 — the shape of a phone, because that is what this object is:
 * a Birb Mobile screen hanging in the room. Width / height, so < 1.
 *
 * This was 16:10 landscape for one build and that was wrong three ways. The AR
 * illusion needs the room visible AROUND the screen, so the screen can only
 * occupy ~62% of the view; on a portrait phone that is 242 CSS px of width, and
 * a 16:10 plane inside it is 151px tall — a postage stamp you cannot play on.
 * Turned portrait the same width buys ~430px of height, near 3x the area. It
 * also frees the bottom third of the phone for the stick and boost pill, which
 * in landscape had nowhere to sit except on top of the game. And Birb Mobile is
 * itself a portrait game, so this reads as its screen rather than as a TV.
 */
export const SCREEN_ASPECT = 9 / 16;

/**
 * Metres-ish at scale 1. Physical size barely matters on its own because the
 * page SOLVES the distance to frame it (see framingDistance in ar/index.html);
 * what this really sets is how far away the screen ends up. 0.62 wide (so ~1.1
 * tall) lands it about 1.8m away — an object across a room, not across a hall.
 */
export const SCREEN_BASE_WIDTH = 0.62;

/** Frame thickness as a fraction of the screen's width. */
const BEZEL_MARGIN = 0.055;

export function createARScreen(THREE, opts = {}) {
    const quality = opts.quality || 'mid';

    const group = new THREE.Group();
    // Nothing is visible until placement runs once; avoids a one-frame flash of
    // the screen at the origin, which reads as a glitch on a camera background.
    group.visible = false;

    const w = SCREEN_BASE_WIDTH;
    const h = SCREEN_BASE_WIDTH / SCREEN_ASPECT;

    // The frame is a UNIFORM band around the display, so its plane is the
    // screen plus the same margin on every side. The previous form scaled each
    // axis by a different factor, which on a portrait screen produced a frame
    // noticeably fatter on the short sides than the long ones.
    const m = w * BEZEL_MARGIN;
    const bw = w + m * 2;
    const bh = h + m * 2;

    // --- glow (furthest back) ---------------------------------------------
    const glowTex = makeGlowTexture(THREE);
    const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(bw * 1.85, bh * 1.55),
        new THREE.MeshBasicMaterial({
            map: glowTex,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            opacity: 0.55,
        })
    );
    glow.position.z = -0.012;
    group.add(glow);

    // --- bezel -------------------------------------------------------------
    // Texture matches the frame plane's aspect so a uniform pad in canvas
    // pixels maps to a uniform margin in the world.
    // TWO textures, swapped — not one texture tinted. The corner ticks are
    // painted cyan into the bitmap, so tinting the material white (the old
    // "not placing" state) left them at full strength and the placement
    // affordance was on permanently, including mid-flight.
    const bezelPlacingTex = makeBezelTexture(THREE, bw, bh, m, true);
    const bezelPlainTex = makeBezelTexture(THREE, bw, bh, m, false);
    const bezel = new THREE.Mesh(
        new THREE.PlaneGeometry(bw, bh),
        new THREE.MeshBasicMaterial({
            map: bezelPlacingTex,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
        })
    );
    bezel.position.z = -0.004;
    group.add(bezel);

    // --- the display -------------------------------------------------------
    const splashTex = makeSplashTexture(THREE, quality);
    const screenMat = new THREE.MeshBasicMaterial({ map: splashTex, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat);
    group.add(screen);

    // --- placement state ---------------------------------------------------
    // Spherical around the viewer at the origin. Azimuth 0 = straight ahead
    // (-Z), which is where the phone points when you open the page.
    let azimuth = 0;
    let elevation = 0;
    let distance = opts.distance ?? 2.2;
    let scale = 1;

    const _pos = new THREE.Vector3();
    const _origin = new THREE.Vector3(0, 0, 0);

    function apply() {
        const ce = Math.cos(elevation);
        _pos.set(
            Math.sin(azimuth) * ce * distance,
            Math.sin(elevation) * distance,
            -Math.cos(azimuth) * ce * distance
        );
        group.position.copy(_pos);
        // Always square-on to the viewer. A screen you have to stand in front
        // of is a worse demo than one that turns to meet you, and with no
        // positional tracking there is no "off-axis" to reward anyway.
        group.lookAt(_origin);
        group.scale.setScalar(scale);
        group.visible = true;
    }

    /**
     * @param {object} p
     * @param {number} [p.azimuth]   radians, + is right
     * @param {number} [p.elevation] radians, + is up (clamped away from the poles)
     * @param {number} [p.distance]  metres-ish
     * @param {number} [p.scale]
     */
    function setPlacement(p) {
        if (p.azimuth !== undefined) azimuth = p.azimuth;
        if (p.elevation !== undefined) {
            // Past ~70 degrees the lookAt roll becomes unstable and the screen
            // spins about its own axis as it crosses the pole.
            elevation = Math.max(-1.2, Math.min(1.2, p.elevation));
        }
        if (p.distance !== undefined) distance = Math.max(0.9, Math.min(6, p.distance));
        if (p.scale !== undefined) scale = Math.max(0.35, Math.min(3.2, p.scale));
        apply();
    }

    function getPlacement() {
        return { azimuth, elevation, distance, scale };
    }

    /** Swap the display's texture — this is how the game takes over the screen. */
    function setTexture(tex) {
        screenMat.map = tex || splashTex;
        screenMat.needsUpdate = true;
    }

    function showSplash() { setTexture(splashTex); }

    /** Placement mode shows the corner ticks and lifts the glow: "armed". */
    let placing = true;
    function setPlacing(on) {
        placing = Boolean(on);
        bezel.material.map = placing ? bezelPlacingTex : bezelPlainTex;
        bezel.material.needsUpdate = true;
    }

    let t = 0;
    function update(dt) {
        // A slow breath on the glow. Static geometry on a live camera feed reads
        // as a decal stuck to the lens; a little motion sells it as an object.
        t += dt;
        glow.material.opacity = (placing ? 0.85 : 0.55) + Math.sin(t * 1.4) * 0.06;
    }

    function dispose() {
        [glow, bezel, screen].forEach((m) => {
            m.geometry.dispose();
            m.material.dispose();
        });
        glowTex.dispose();
        bezelPlacingTex.dispose();
        bezelPlainTex.dispose();
        splashTex.dispose();
    }

    return {
        group, screen, bezel, glow,
        setPlacement, getPlacement, setTexture, showSplash, setPlacing,
        update, dispose,
        get width() { return w * scale; },
        get height() { return h * scale; },
    };
}

// ---------------------------------------------------------------------------
// Painted textures. Every pixel generated here — house rule.
// ---------------------------------------------------------------------------

function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

function finishTexture(THREE, canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/** Radial cyan bloom behind the screen. */
function makeGlowTexture(THREE) {
    const c = canvasOf(256, 256);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 10, 128, 128, 126);
    grad.addColorStop(0, 'rgba(120, 240, 255, 0.85)');
    grad.addColorStop(0.45, 'rgba(90, 190, 255, 0.28)');
    grad.addColorStop(1, 'rgba(60, 140, 255, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return finishTexture(THREE, c);
}

/**
 * Rounded ink frame with corner ticks, in the Birb Labs cel language.
 * @param {number} bw frame width in world units
 * @param {number} bh frame height in world units
 * @param {number} margin band thickness in world units
 */
function makeBezelTexture(THREE, bw, bh, margin, withTicks) {
    // Match the plane's aspect, so one pad value in pixels is one uniform band.
    const W = 512;
    const H = Math.round(W * (bh / bw));
    const c = canvasOf(W, H);
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);

    const pad = (margin / bw) * W;      // the band, in canvas pixels
    const r = pad * 2.4;

    roundRect(g, 1, 1, W - 2, H - 2, r);
    g.fillStyle = CSS.ink || '#0d1b2a';
    g.fill();

    // Inner cream hairline so the frame reads as a moulded edge, not a slab.
    g.lineWidth = Math.max(2, pad * 0.16);
    g.strokeStyle = 'rgba(245, 240, 225, 0.55)';
    roundRect(g, pad * 0.34, pad * 0.34, W - pad * 0.68, H - pad * 0.68, r * 0.8);
    g.stroke();

    // Corner ticks — the visual grammar of "this thing is placeable". Only on
    // the placing variant; once the run starts they are noise around the game.
    if (withTicks) {
        g.strokeStyle = CSS.uiCyan || '#78f0ff';
        g.lineWidth = Math.max(3, pad * 0.26);
        g.lineCap = 'round';
        const t = pad * 1.9, off = pad * 0.5;
        const corners = [
            [off, off, 1, 1], [W - off, off, -1, 1],
            [off, H - off, 1, -1], [W - off, H - off, -1, -1],
        ];
        for (const [x, y, sx, sy] of corners) {
            g.beginPath();
            g.moveTo(x + sx * t, y);
            g.lineTo(x, y);
            g.lineTo(x, y + sy * t);
            g.stroke();
        }
    }

    // Punch the middle out so the display shows through the frame.
    g.globalCompositeOperation = 'destination-out';
    roundRect(g, pad, pad, W - pad * 2, H - pad * 2, r * 0.55);
    g.fill();

    return finishTexture(THREE, c);
}

/**
 * The Birb Mobile splash shown on the screen before the run starts. Painted,
 * not loaded: the parent game's splash.jpg is a real asset and importing it
 * would break the artefact's zero-asset rule for the sake of one still frame.
 */
function makeSplashTexture(THREE, quality) {
    // Portrait, matching SCREEN_ASPECT. Laid out top-down: sky and title in the
    // upper half where the eye lands first, the planet's shoulder anchoring the
    // bottom, bird between them.
    const W = 576, H = 1024;
    const c = canvasOf(W, H);
    const g = c.getContext('2d');

    // Sky, using the game's own palette so the splash and the live game that
    // replaces it read as the same product.
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, hex(PALETTE.skyZenith, '#1a3a6b'));
    sky.addColorStop(0.55, hex(PALETTE.skyMid, '#4a90d9'));
    sky.addColorStop(1, hex(PALETTE.skyHorizon, '#bfe3f5'));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Sun disc + halo, matching sky.js's graphic treatment.
    g.fillStyle = 'rgba(255, 240, 190, 0.30)';
    g.beginPath(); g.arc(W * 0.78, H * 0.13, 92, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff3c4';
    g.beginPath(); g.arc(W * 0.78, H * 0.13, 48, 0, Math.PI * 2); g.fill();

    // Cel clouds.
    g.fillStyle = 'rgba(255,255,255,0.9)';
    cloud(g, W * 0.20, H * 0.11, 46);
    cloud(g, W * 0.62, H * 0.235, 34);
    // Kept clear of the title block below. At H*0.40 this one sat directly
    // behind "MOBILE" and only a sliver escaped past the letters, which read as
    // a rendering artefact rather than a cloud.
    cloud(g, W * 0.16, H * 0.235, 28);

    // The planet's shoulder across the bottom — the signature of the game.
    const ground = g.createLinearGradient(0, H * 0.66, 0, H);
    ground.addColorStop(0, hex(PALETTE.meadowMid, '#54ac47'));
    ground.addColorStop(1, hex(PALETTE.meadowDeep, '#2f7a3f'));
    g.fillStyle = ground;
    g.beginPath();
    g.ellipse(W * 0.5, H * 1.30, W * 1.15, H * 0.56, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = hex(PALETTE.ink, '#0d1b2a');
    g.stroke();

    // A bird in silhouette, facing left, mid-flap.
    drawBird(g, W * 0.46, H * 0.585, 1.05, hex(PALETTE.ink, '#0d1b2a'));

    // Title block. Two lines, because "BIRB MOBILE" on one line at 576px wide
    // has to shrink to ~52px to fit and stops reading as a title.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';

    const titleAt = (text, y, size, fill) => {
        g.font = `900 ${size}px ui-rounded, "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif`;
        g.lineWidth = size * 0.17;
        g.strokeStyle = hex(PALETTE.ink, '#0d1b2a');
        g.strokeText(text, W / 2, y);
        g.fillStyle = fill;
        g.fillText(text, W / 2, y);
    };

    titleAt('BIRB', H * 0.335, 104, '#f7f1de');
    titleAt('MOBILE', H * 0.425, 104, '#f7f1de');
    titleAt('A R   M O D E', H * 0.495, 34, hex(PALETTE.uiCyan, '#78f0ff'));

    g.font = '700 23px ui-rounded, "Trebuchet MS", system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    // Must match the on-glass hint bar in ar/index.html. Pinch changes DISTANCE,
    // not scale — telling the player "resize" and then moving the screen away
    // from them is a small lie that makes the control feel broken.
    g.fillText('Drag to move', W / 2, H * 0.885);
    g.fillText('Pinch to push away', W / 2, H * 0.925);

    return finishTexture(THREE, c);
}

function cloud(g, x, y, r) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.arc(x + r * 0.9, y + r * 0.14, r * 0.72, 0, Math.PI * 2);
    g.arc(x - r * 0.86, y + r * 0.18, r * 0.62, 0, Math.PI * 2);
    g.fill();
}

function drawBird(g, x, y, s, ink) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.fillStyle = ink;
    // body
    g.beginPath(); g.ellipse(0, 0, 46, 34, -0.12, 0, Math.PI * 2); g.fill();
    // head
    g.beginPath(); g.arc(-40, -22, 25, 0, Math.PI * 2); g.fill();
    // beak
    g.beginPath(); g.moveTo(-62, -22); g.lineTo(-88, -14); g.lineTo(-60, -8); g.closePath(); g.fill();
    // tail
    g.beginPath(); g.moveTo(40, 4); g.lineTo(84, -6); g.lineTo(80, 22); g.closePath(); g.fill();
    // upper wing, mid-downstroke
    g.beginPath(); g.moveTo(-4, -14); g.quadraticCurveTo(26, -76, 62, -60);
    g.quadraticCurveTo(30, -34, 12, -6); g.closePath(); g.fill();
    // eye
    g.fillStyle = '#f7f1de';
    g.beginPath(); g.arc(-44, -26, 8, 0, Math.PI * 2); g.fill();
    g.restore();
}

function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    if (typeof g.roundRect === 'function') { g.roundRect(x, y, w, h, r); return; }
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

/** PALETTE values are numbers; canvas wants '#rrggbb'. */
function hex(v, fallback) {
    if (typeof v === 'number') return '#' + v.toString(16).padStart(6, '0');
    if (typeof v === 'string') return v;
    return fallback;
}
