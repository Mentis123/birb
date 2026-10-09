/**
 * palette.js — Birb Gauntlet's committed colour palette and lighting ramps.
 *
 * The art direction is a single, deliberately limited, high-saturation
 * golden-hour palette applied across sky, terrain, birds, gates and UI. Every
 * colour in the game comes from here. If you need a new colour, add it here and
 * check it against the rest of the set — do not inline a hex somewhere.
 *
 * Ramps are the heart of the cel look: 3-4 hard bands, NearestFilter, no
 * interpolation. Tuned by eye against captured frames, not by defaults.
 */

/** Core colours as hex ints (Three.js native). */
export const PALETTE = {
    // --- Sky & atmosphere ------------------------------------------------
    skyZenith: 0x1f5f9e,
    skyMid: 0x62c9e4,
    skyHorizon: 0xffd9a0,
    skyGlow: 0xfff0c4,
    sunCore: 0xfff8dc,
    sunHalo: 0xffd469,
    starTint: 0xdff2ff,
    cloudLit: 0xfffdf6,
    cloudShade: 0xbcd9ef,
    fog: 0xa8dced,

    // --- Terrain ---------------------------------------------------------
    meadowLit: 0x8fd85c,
    meadowMid: 0x54ac47,
    meadowDeep: 0x2f7a3f,
    canyonLit: 0xe0a85f,
    canyonMid: 0xb87a42,
    canyonDeep: 0x7d4b2c,
    alpineLit: 0xe8ecf2,
    alpineMid: 0xa9bccd,
    alpineDeep: 0x6b8399,
    waterDeep: 0x1c6d8f,

    // --- Props -----------------------------------------------------------
    foliageLit: 0x69c750,
    foliageMid: 0x3f9440,
    foliageDeep: 0x27633a,
    pineLit: 0x3f9b6b,
    pineDeep: 0x1f5c47,
    trunk: 0x6b4a32,
    rock: 0x8d8578,
    snow: 0xf4f8fd,

    // --- Birds -----------------------------------------------------------
    // Player is Birb-brand cyan; the AI trio are chosen to stay readable
    // against both green lowland and pale alpine crest.
    birdPlayer: 0x4ec9f5,
    birdPlayerBelly: 0xdff4ff,
    birdRival1: 0xf2764b, // "Talon" — aggressive
    birdRival2: 0xb47ff0, // "Zephyr" — clean
    birdRival3: 0xf5d84e, // "Pip"    — erratic
    // The two newer rivals are dark/metal birds, so their minimap and results
    // swatches are tuned a few steps lighter than the in-world plumage — a
    // true crow black would vanish on the minimap's ink dish.
    birdRival4: 0x2a3550, // "Corvus" — clever; glossy blue-black
    birdRival5: 0xc98a3d, // "Tock"   — clockwork; brass
    birdRival4Ui: 0x6f86c2,
    birdRival5Ui: 0xe0a85a,
    // Alternate tints, used only when the player picks the same species so the
    // rival can never be mistaken for you: a rook-grey crow and a cold steel
    // owl. Both still separate from green lowland and pale alpine.
    birdRival4Alt: 0x8f98ab, // hooded-crow ash
    birdRival5Alt: 0x7f93ad, // cold steel
    crowRim: 0x7fb6ff,    // iridescent blue rim for the crow's toon rim term
    crowBeak: 0x262c3a,
    crowBelly: 0x46557a,  // barely lighter than the body: crows are not two-tone
    owlBrass: 0xd9a441,
    owlCopper: 0xb8683a,
    owlDisc: 0xf6ead0,    // pale facial disc
    owlGear: 0x8a6a33,
    owlKey: 0xf2d27a,
    // Realistic Corvus and Tock (src/bird/realistic/). These are physically
    // lit ALBEDOS and metal base colours, not cel art colours: a crow's black
    // is ~3% reflectance and brass is its own F0. The toon trio never read
    // them. Their readability comes from size, value, a restrained gloss and
    // the sky reflection, so these sit darker than anything in the cel set.
    realCrowBlack: 0x2b2d34,      // contour plumage: blue-black, ~0.025 linear
    realCrowFlight: 0x282b35,     // flight feathers, a shade bluer
    realCrowBill: 0x131418,
    realCrowLeg: 0x17171b,
    realCrowIris: 0x2e1c12,       // dark brown
    realCrowPupil: 0x050506,
    realCrowMembrane: 0x9aaabd,   // nictitating membrane: the crow's blink
    realCrowSheen: 0x161c2c,      // near-black blue: never greys the bird
    realHoodedGrey: 0x8b8c88,     // hooded crow mantle and underparts
    realHoodedSheen: 0x34363a,
    realBrass: 0xb08d57,          // brushed brass
    realBrassDark: 0x7a5f36,      // aged brass/bronze: panels, recesses, collars
    realOxide: 0x3a2e1e,          // oxidised seam grooves
    realOwlDisc: 0xe3d8bd,        // cream enamel facial disc (every tier)
    realCopper: 0xc98257,
    realSteel: 0xbcc0c6,
    realNickel: 0xcdcabf,
    realGunmetal: 0x4f555d,
    realBluedSteel: 0x3b475c,
    realEnamel: 0xd98a1c,         // amber enamel iris
    realEnamelPupil: 0x0a0a0d,
    realShutter: 0x5d636b,        // the owl's eye shutter (its blink)
    realBacking: 0x1c1d20,        // blackened steel: the plate the gears turn over
    realGround: 0x4d6b3c,         // the planet below, in the bird's sky probe
    beak: 0xffb03a,
    foot: 0xf09a2e,
    eyeWhite: 0xffffff,
    eyeDark: 0x14243f,

    // --- Course ----------------------------------------------------------
    ribbon: 0x5ffbd0,
    ribbonEdge: 0xd9fff4,
    gateIdle: 0x3dffd0,
    gateNext: 0xfff27a,
    gatePassed: 0x8a9bb5,
    boostPad: 0xff7ad9,

    // --- FX --------------------------------------------------------------
    featherPlayer: 0xbfeeff,
    featherWarm: 0xffe6b0,
    speedLine: 0xeafcff,
    sparkCyan: 0x7ff5ff,
    impactPuff: 0xffe9c9,

    // --- Ink & UI --------------------------------------------------------
    // Deep navy, never pure black — reads as illustrated ink rather than a
    // hard outline, and keeps shadow areas from going dead on OLED.
    ink: 0x0f1c33,
    inkSoft: 0x24344f,
    uiGold: 0xffdd44,
    uiCyan: 0x00d4ff,
    uiCream: 0xfff6dc,
    uiPanel: 0x0a1324,
};

/** The same palette as CSS strings, for HUD/DOM work. */
export const CSS = Object.fromEntries(
    Object.entries(PALETTE).map(([k, v]) => [k, '#' + v.toString(16).padStart(6, '0')])
);

/**
 * Canonical key-light direction (world space, pointing FROM the light TOWARD
 * the scene is the negation of this). Sky sun disc, toon ramps, banded
 * specular and outline tinting all read this one vector so the whole frame
 * agrees on where the sun is.
 */
export const KEY_LIGHT_DIR = Object.freeze({ x: 0.42, y: 0.78, z: 0.46 });

/**
 * Ramp definitions. Each entry is an array of [threshold, r, g, b] stops in
 * 0..1 space, ordered dark -> light. `makeRampTexture` bakes them into a 1D
 * NearestFilter texture that MeshToonMaterial samples with N·L.
 *
 * Band thresholds are tuned by eye. The 0.5 band is where the terminator
 * lands — nudging it moves the shadow line across every rounded form in the
 * game at once, so change it deliberately.
 */
export const RAMPS = {
    // 4 bands: deep shadow, core shadow, lit, hot rim of the lit side.
    hero: [
        [0.00, 0.42, 0.46, 0.62],
        [0.38, 0.68, 0.72, 0.84],
        [0.62, 0.95, 0.96, 1.00],
        [0.86, 1.00, 1.00, 1.00],
    ],
    // 3 bands, softer floor — terrain wants less contrast so props read.
    terrain: [
        [0.00, 0.55, 0.60, 0.72],
        [0.45, 0.84, 0.88, 0.94],
        [0.72, 1.00, 1.00, 1.00],
    ],
    // 2 hard bands — maximum graphic punch for gates and course furniture.
    graphic: [
        [0.00, 0.62, 0.66, 0.78],
        [0.52, 1.00, 1.00, 1.00],
    ],
    // Near-flat: for self-lit things (ribbon, sparks) that should not read as
    // shaded at all but still pick up a hint of form.
    emissive: [
        [0.00, 0.88, 0.90, 0.95],
        [0.55, 1.00, 1.00, 1.00],
    ],
};

/**
 * Bake a ramp definition into a NearestFilter DataTexture suitable for
 * MeshToonMaterial.gradientMap.
 *
 * @param {object} THREE  the Three.js module
 * @param {Array}  stops  ramp definition from RAMPS
 * @param {number} width  texel count (keep small — the steps ARE the look)
 */
export function makeRampTexture(THREE, stops, width = 64) {
    const data = new Uint8Array(width * 4);
    for (let i = 0; i < width; i++) {
        const t = i / (width - 1);
        // Walk to the last stop whose threshold we have passed. No blending —
        // the hard step between stops is the entire point.
        let stop = stops[0];
        for (let s = 0; s < stops.length; s++) {
            if (t >= stops[s][0]) stop = stops[s];
        }
        const o = i * 4;
        data[o] = Math.round(stop[1] * 255);
        data[o + 1] = Math.round(stop[2] * 255);
        data[o + 2] = Math.round(stop[3] * 255);
        data[o + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

// Ramp textures are shared across every material that asks for them — one
// DataTexture per ramp for the whole game, created lazily on first use.
const _rampCache = new Map();

/** Get (and memoise) the ramp texture for a named RAMPS entry. */
export function getRamp(THREE, name = 'hero') {
    let tex = _rampCache.get(name);
    if (!tex) {
        tex = makeRampTexture(THREE, RAMPS[name] || RAMPS.hero);
        _rampCache.set(name, tex);
    }
    return tex;
}

/** Drop cached ramp textures (used when the renderer is torn down). */
export function disposeRamps() {
    _rampCache.forEach((tex) => tex.dispose());
    _rampCache.clear();
}

/**
 * Selectable player plumage.
 *
 * Every entry has to survive the same two backgrounds the rival colours were
 * chosen against — green lowland and pale alpine crest — because the player
 * bird is the one thing on screen you must never lose. That rules out mid
 * greens and anything close to the terrain's sand. Index 0 is the default and
 * is Birb-brand cyan; `feather` is the trail colour, kept a few steps lighter
 * than the body so the trail reads as feathers rather than as a smear.
 */
export const BIRD_COLORS = Object.freeze([
    { id: 'cyan', name: 'Birb Blue', body: 0x4ec9f5, belly: 0xdff4ff, feather: 0xbfeeff },
    { id: 'ember', name: 'Ember', body: 0xf2764b, belly: 0xffe0cd, feather: 0xffc6a8 },
    { id: 'orchid', name: 'Orchid', body: 0xb47ff0, belly: 0xf0e2ff, feather: 0xdcc4ff },
    { id: 'sunny', name: 'Sunny', body: 0xf5d84e, belly: 0xfff6d0, feather: 0xffeba6 },
    { id: 'mint', name: 'Mint', body: 0x4fe0a8, belly: 0xdcfff1, feather: 0xa8f5d6 },
    { id: 'rose', name: 'Rose', body: 0xff7fa8, belly: 0xffe2ec, feather: 0xffbdd2 },
    { id: 'ink', name: 'Midnight', body: 0x3d5a9e, belly: 0xc3d4f5, feather: 0x9fb8e8 },
    { id: 'snow', name: 'Snow', body: 0xeef4fb, belly: 0xffffff, feather: 0xdcecff },
]);

/** Look up a plumage by id, never returning undefined. */
export function birdColorById(id) {
    for (let i = 0; i < BIRD_COLORS.length; i++) {
        if (BIRD_COLORS[i].id === id) return BIRD_COLORS[i];
    }
    return BIRD_COLORS[0];
}
