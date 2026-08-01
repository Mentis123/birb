/**
 * world/sky.js — Birb Gauntlet's sky: gradient dome, graphic sun, cel clouds, stars.
 *
 * The sky is the single largest block of colour in every frame, so it carries
 * most of the art direction on its own. Four pieces, five draw calls:
 *
 *   1. A BackSide dome with a hand-written gradient shader. Not a lerp between
 *      two colours — a three-stop zenith/mid/horizon ramp with a *quantised*
 *      overlay so the gradient reads as painted bands rather than a smooth
 *      Photoshop wash, plus a warm wash and a hard glow band aimed along
 *      KEY_LIGHT_DIR so the visible sun and the shading light agree.
 *   2. A sun built from a hard-edged disc plus a separate halo quad whose
 *      shader draws quantised concentric rings and a stepped ray star. Every
 *      falloff in it is run through a step/smoothstep with a narrow band, which
 *      is what keeps it reading as graphic rather than as a lens bloom.
 *   3. Cel clouds: ONE InstancedMesh. Each cloud is a flat card built from
 *      overlapping lobes with a flat base — the classic drawn cumulus — carrying
 *      three baked layers in one geometry (warm top rim, cool underside, lit
 *      body) via vertex colours, so the hard two-tone edge costs no extra draw
 *      call. Drift happens in the vertex shader from a per-instance angular
 *      speed, giving real parallax with zero CPU work per frame.
 *   4. Stars as one Points cloud with a procedural four-point sparkle and a
 *      quantised (4-step) twinkle, faded in toward the zenith so they only
 *      appear in the deep blue.
 *
 * ORIENTATION. The group's *position* follows the camera every frame so the
 * dome can never be clipped or escaped, but its *rotation* stays world-fixed.
 * That is deliberate: the bird circles a small planet, so a world-fixed sky
 * means the sun rises and sets as you fly, and the sun stays exactly where
 * KEY_LIGHT_DIR says it is. A sky re-oriented to the local radial up would have
 * to drag the sun around with it and the lighting would stop agreeing with the
 * art.
 *
 * DEPTH. Everything here is depthTest:false / depthWrite:false with a very low
 * renderOrder, so the sky is painted first, in the order listed, and every
 * other object in the scene draws over it regardless of the dome's radius.
 *
 * Budget: <= 8 draw calls, <= 6k triangles. Actual: 5 draw calls, ~5.5k tris
 * at `high`.
 */

import { PALETTE, KEY_LIGHT_DIR } from '../core/palette.js';
import { makeRng, rngRange } from '../core/rng.js';

/** Per-tier counts. Read the tier you are handed; never sniff the user agent. */
const TIERS = {
    low: { clouds: 12, stars: 0, domeSeg: 22, cloudSeg: 8 },
    mid: { clouds: 20, stars: 120, domeSeg: 26, cloudSeg: 9 },
    high: { clouds: 34, stars: 260, domeSeg: 28, cloudSeg: 9 },
};

/** Shell radii. Small enough to sit inside any sane far plane. */
const R_DOME = 620;
const R_SUN = 545;
const R_STARS = 575;
const CLOUD_NEAR = 330;
const CLOUD_FAR = 500;

// ---------------------------------------------------------------------------
// Dome
// ---------------------------------------------------------------------------

const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const DOME_FRAG = /* glsl */`
precision mediump float;
uniform vec3  uZenith;
uniform vec3  uMid;
uniform vec3  uHorizon;
uniform vec3  uGlow;
uniform vec3  uSunTint;
uniform vec3  uSunDir;
varying vec3  vDir;

vec3 ramp( float h ) {
    vec3 c = mix( uHorizon, uMid, smoothstep( -0.05, 0.26, h ) );
    // Reach full zenith blue EARLY (by h=0.55) so that the deepening below
    // starts from a saturated blue. Overlapping the two transitions drags the
    // midsky through a desaturated grey-mauve — the single ugliest thing a
    // gradient sky can do.
    return mix( c, uZenith, smoothstep( 0.16, 0.55, h ) );
}

void main() {
    vec3 d = normalize( vDir );
    float h = d.y;

    // Smooth ramp, then the same ramp evaluated on a quantised height. Mixing
    // the two gives painted-looking steps that still read as a gradient — a
    // pure quantise posterises into wallpaper, a pure lerp reads as a default.
    vec3 col = ramp( h );
    float steps = 7.0;
    vec3 banded = ramp( floor( clamp( h, -0.2, 1.0 ) * steps ) / steps );
    // Bands are strongest low in the sky where painted skies actually band,
    // and fade out toward the zenith so the top stays a clean field.
    col = mix( col, banded, 0.38 * ( 1.0 - smoothstep( 0.22, 0.62, h ) ) );

    // Below the true horizon the dome keeps going (the planet does not fill it
    // when you look down past the limb), so sink it into a cooler underlight
    // rather than letting the warm band wrap the whole lower hemisphere.
    col = mix( col, uHorizon * 0.62 + uMid * 0.20, smoothstep( 0.0, -0.35, h ) );

    // One hard, deliberately visible haze band sitting on the horizon line.
    float hb = 1.0 - smoothstep( 0.0, 0.10, abs( h + 0.01 ) );
    col = mix( col, uGlow, hb * 0.42 );

    // A second, thinner band just above it — two bands read as drawn
    // atmosphere; one reads as a bug.
    float hb2 = 1.0 - smoothstep( 0.0, 0.035, abs( h - 0.115 ) );
    col = mix( col, mix( uGlow, uMid, 0.45 ), hb2 * 0.30 );

    // Deepen the very top so the star field has something to sit against.
    // Darken by pulling red and green down far harder than blue — a flat
    // multiply desaturates into grey-mauve and the whole zenith goes muddy.
    vec3 deep = uZenith * vec3( 0.34, 0.52, 0.98 );
    col = mix( col, deep, smoothstep( 0.55, 1.0, h ) * 0.90 );

    // Golden-hour wash around the key light. Applied LAST, on top of the zenith
    // deepening — do it before and the deep-blue mix dilutes it back to grey,
    // which is what leaves a mauve smudge instead of a warm sun pocket.
    // QUANTISED: three hard concentric plateaus of warm air around the sun,
    // not a smooth bloom. This is the term that decides whether the sun reads
    // as painted or as a lens flare, so it gets the same step() treatment as
    // everything else in the cel pipeline.
    // ADD warmth rather than mixing toward cream: over a deep blue zenith a
    // mix-to-cream desaturates straight to grey, which put a dead grey disc
    // the size of the frame around the sun. Adding keeps the hue.
    float sd = max( dot( d, uSunDir ), 0.0 );
    // Mix toward the SATURATED gold, not toward cream, and keep it tight. Warm
    // light added on top of blue always desaturates toward lavender; replacing
    // the blue with gold is what makes the pocket read as sunlit air.
    float halo = smoothstep( 0.9885, 0.99965, sd );   // ~8.7 degrees of arc
    halo = floor( halo * 2.0 + 0.001 ) / 2.0;
    col = mix( col, uSunTint, halo * 0.42 );
    col = mix( col, uGlow, pow( sd, 140.0 ) * 0.70 );
    col += uSunTint * pow( sd, 420.0 ) * 0.35;

    gl_FragColor = vec4( col, 1.0 );
    #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Sun halo
// ---------------------------------------------------------------------------

const HALO_VERT = /* glsl */`
varying vec2 vP;
void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/**
 * Every term here is stepped. The only smoothstep widths are ~0.01-0.02 of the
 * quad, which antialiases the edge without softening the shape — the difference
 * between "graphic flare" and "photographic bloom" is entirely in these widths.
 */
const HALO_FRAG = /* glsl */`
precision mediump float;
uniform vec3  uCore;
uniform vec3  uHalo;
uniform float uTime;
varying vec2  vP;

float ring( float r, float at, float w ) {
    return smoothstep( at - w - 0.012, at - w, r ) - smoothstep( at + w, at + w + 0.012, r );
}

void main() {
    float r = length( vP );
    float ang = atan( vP.y, vP.x );

    // Broad, low atmospheric bloom. Quantised into 3 plateaus so even the soft
    // part of the flare has edges.
    float g = 1.0 - smoothstep( 0.06, 0.86, r );
    g = floor( g * 3.0 ) / 3.0;
    // Kept low: the dome shader already supplies a warm, stepped air pocket.
    // Doubling up put a soft grey-white ring around the gold.
    float a = g * 0.07;

    // Hard concentric rings.
    a += ring( r, 0.300, 0.026 ) * 0.40;
    a += ring( r, 0.430, 0.012 ) * 0.34;
    a += ring( r, 0.610, 0.007 ) * 0.24;

    // Stepped ray star. Each spoke is a WEDGE whose angular width shrinks with
    // radius and stops dead at a hard outer edge, so it reads as a drawn
    // triangle. A constant-width spoke with a soft radial fade is exactly what
    // a photographic lens starburst looks like — the thing to avoid.
    float spin = uTime * 0.045;

    float wedge8 = abs( sin( ang * 4.0 + spin ) );
    float t8 = smoothstep( 0.20, 0.86, r );             // 0 at the core, 1 outside
    float thr8 = 0.94 + t8 * 0.055;
    float ray8 = smoothstep( thr8, thr8 + 0.006, wedge8 )
               * ( 1.0 - smoothstep( 0.84, 0.855, r ) ) * smoothstep( 0.205, 0.215, r );
    a += ray8 * 0.62;

    float wedge16 = abs( sin( ang * 8.0 + spin + 0.19 ) );
    float t16 = smoothstep( 0.21, 0.40, r );
    float thr16 = 0.900 + t16 * 0.085;
    float ray16 = smoothstep( thr16, thr16 + 0.006, wedge16 )
                * ( 1.0 - smoothstep( 0.385, 0.40, r ) ) * smoothstep( 0.215, 0.228, r );
    a += ray16 * 0.44;

    a = clamp( a, 0.0, 1.0 );
    if ( a <= 0.001 ) discard;

    // Gold everywhere but the innermost ring — the rays have to read as sun,
    // and a cream ray on blue reads as a grey asterisk.
    vec3 col = mix( uHalo, uCore, smoothstep( 0.26, 0.10, r ) );
    gl_FragColor = vec4( col * a, a );
    #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Clouds
// ---------------------------------------------------------------------------

/**
 * A drawn cumulus in unit space: overlapping lobes sitting on a flat base.
 * The flat bottom is what makes it read as an illustrated cloud instead of a
 * bunch of circles.
 */
const CLOUD_LOBES = [
    [-0.72, -0.02, 0.30],
    [-0.36, 0.16, 0.45],
    [0.02, 0.30, 0.54],
    [0.44, 0.13, 0.41],
    [0.79, -0.04, 0.28],
];
const CLOUD_BASE_Y = -0.24;

/** Push one lobe fan + the shared flat base into the growing arrays. */
function pushCloudLayer(pos, col, segs, dx, dy, scale, r, g, b) {
    for (let i = 0; i < CLOUD_LOBES.length; i++) {
        const cx = CLOUD_LOBES[i][0] * scale + dx;
        const cy = CLOUD_LOBES[i][1] * scale + dy;
        const rad = CLOUD_LOBES[i][2] * scale;
        // Stagger each lobe's fan phase so the polygon facets never line up
        // across lobes — that alignment is what makes low-poly discs read as
        // "low-poly" instead of as a drawn bump.
        const phase = i * 0.7;
        for (let s = 0; s < segs; s++) {
            const a0 = ((s / segs) * Math.PI * 2) + phase;
            const a1 = (((s + 1) / segs) * Math.PI * 2) + phase;
            pos.push(cx, cy, 0);
            pos.push(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad, 0);
            pos.push(cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad, 0);
            for (let k = 0; k < 3; k++) col.push(r, g, b);
        }
    }
    // Flat base slab, so the underside is a straight drawn line.
    const bx = 0.58 * scale;
    const by0 = CLOUD_BASE_Y * scale + dy;
    const by1 = 0.14 * scale + dy;
    const x0 = -bx + dx;
    const x1 = bx + dx;
    pos.push(x0, by0, 0, x1, by0, 0, x1, by1, 0);
    pos.push(x0, by0, 0, x1, by1, 0, x0, by1, 0);
    for (let k = 0; k < 6; k++) col.push(r, g, b);
}

function buildCloudGeometry(THREE, segs) {
    const pos = [];
    const col = [];

    const warm = new THREE.Color(PALETTE.skyGlow);
    // The underside needs to sit a clear step below the lit body or the edge
    // reads as a sticker outline instead of shadow — pull it toward the sky's
    // own mid blue rather than inventing a colour.
    const shade = new THREE.Color(PALETTE.cloudShade).lerp(new THREE.Color(PALETTE.skyMid), 0.30);
    const lit = new THREE.Color(PALETTE.cloudLit);

    // Draw order inside the buffer IS the layer order (depthTest is off), so:
    // warm rim first (peeks out along the top), cool shade second (peeks out
    // along the bottom and sides), lit body last on top of both.
    pushCloudLayer(pos, col, segs, 0, 0.055, 1.0, warm.r, warm.g, warm.b);
    pushCloudLayer(pos, col, segs, 0, -0.095, 1.028, shade.r, shade.g, shade.b);
    pushCloudLayer(pos, col, segs, 0, 0, 1.0, lit.r, lit.g, lit.b);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    return geo;
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

const STAR_VERT = /* glsl */`
precision mediump float;
attribute float aPhase;
attribute float aSize;
attribute float aBase;
uniform float uTime;
uniform float uScale;
varying float vA;
void main() {
    // Quantised twinkle: four discrete brightness levels, never a sine fade.
    float t = sin( uTime * ( 0.7 + fract( aPhase ) * 1.9 ) + aPhase * 6.2831 );
    float q = floor( t * 2.0 + 2.0 ) / 3.0;
    vA = aBase * ( 0.34 + 0.66 * q );
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_PointSize = aSize * uScale * ( 0.72 + 0.28 * q );
    gl_Position = projectionMatrix * mv;
}
`;

const STAR_FRAG = /* glsl */`
precision mediump float;
uniform vec3 uTint;
varying float vA;
void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float core = 1.0 - smoothstep( 0.10, 0.30, length( p ) );
    float bx = ( 1.0 - smoothstep( 0.05, 0.13, abs( p.y ) ) ) * ( 1.0 - smoothstep( 0.25, 0.95, abs( p.x ) ) );
    float by = ( 1.0 - smoothstep( 0.05, 0.13, abs( p.x ) ) ) * ( 1.0 - smoothstep( 0.25, 0.95, abs( p.y ) ) );
    float s = clamp( core + bx + by, 0.0, 1.0 );
    s = smoothstep( 0.40, 0.58, s );
    float a = s * vA;
    if ( a <= 0.004 ) discard;
    gl_FragColor = vec4( uTint * a, a );
    #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------

/**
 * Build the sky.
 *
 * @param {object} THREE
 * @param {object} opts
 * @param {'low'|'mid'|'high'} [opts.quality]
 * @param {number} [opts.seed]
 * @returns {{ group: object, update: Function, drawCallCount: number,
 *             triangleCount: number, dispose: Function }}
 */
export function createSky(THREE, opts = {}) {
    const tier = TIERS[opts.quality] || TIERS.high;
    const seed = opts.seed ?? 90210;
    const rng = makeRng(seed);

    const group = new THREE.Group();
    group.name = 'gauntlet-sky';
    group.frustumCulled = false;
    group.renderOrder = -1000;
    group.matrixAutoUpdate = true;

    const sunDir = new THREE.Vector3(KEY_LIGHT_DIR.x, KEY_LIGHT_DIR.y, KEY_LIGHT_DIR.z).normalize();

    const disposables = [];
    let triangleCount = 0;
    let drawCallCount = 0;

    // Build-time scratch (allowed to allocate here; never in update()).
    const orient = new THREE.Object3D();
    const tmpDir = new THREE.Vector3();
    const tmpColor = new THREE.Color();
    const tmpMat = new THREE.Matrix4();

    // --- 1. gradient dome ---------------------------------------------------
    const domeGeo = new THREE.SphereGeometry(R_DOME, tier.domeSeg, Math.round(tier.domeSeg * 0.66));
    const domeMat = new THREE.ShaderMaterial({
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        uniforms: {
            uZenith: { value: new THREE.Color(PALETTE.skyZenith) },
            uMid: { value: new THREE.Color(PALETTE.skyMid) },
            uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
            uGlow: { value: new THREE.Color(PALETTE.skyGlow) },
            uSunTint: { value: new THREE.Color(PALETTE.sunHalo) },
            uSunDir: { value: sunDir.clone() },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    group.add(dome);
    disposables.push(domeGeo, domeMat);
    triangleCount += domeGeo.index ? domeGeo.index.count / 3 : 0;
    drawCallCount += 1;

    // --- 2. sun halo (behind) + hard disc (front) ---------------------------
    const haloSize = 150;
    // Unit quad (-1..1) so the shader can work in normalised radius; the mesh
    // scale carries the world size.
    const haloGeo = new THREE.PlaneGeometry(2, 2);
    const haloMat = new THREE.ShaderMaterial({
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        uniforms: {
            uCore: { value: new THREE.Color(PALETTE.sunCore) },
            uHalo: { value: new THREE.Color(PALETTE.sunHalo) },
            uTime: { value: 0 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(sunDir).multiplyScalar(R_SUN);
    halo.lookAt(0, 0, 0);
    halo.scale.setScalar(haloSize * 0.5);
    halo.frustumCulled = false;
    halo.renderOrder = -996;
    group.add(halo);
    disposables.push(haloGeo, haloMat);
    triangleCount += 2;
    drawCallCount += 1;

    const discGeo = new THREE.CircleGeometry(haloSize * 0.145, 44);
    const discMat = new THREE.MeshBasicMaterial({
        color: PALETTE.sunCore,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.copy(sunDir).multiplyScalar(R_SUN - 6);
    disc.lookAt(0, 0, 0);
    disc.frustumCulled = false;
    disc.renderOrder = -995;
    group.add(disc);
    disposables.push(discGeo, discMat);
    triangleCount += 44;
    drawCallCount += 1;

    // --- 3. stars -----------------------------------------------------------
    let stars = null;
    let starMat = null;
    if (tier.stars > 0) {
        const n = tier.stars;
        const sPos = new Float32Array(n * 3);
        const sPhase = new Float32Array(n);
        const sSize = new Float32Array(n);
        const sBase = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            // Upper sky only — stars in the warm horizon band look like dirt.
            const y = rngRange(rng, 0.45, 0.995);
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const a = rngRange(rng, 0, Math.PI * 2);
            sPos[i * 3] = Math.cos(a) * r * R_STARS;
            sPos[i * 3 + 1] = y * R_STARS;
            sPos[i * 3 + 2] = Math.sin(a) * r * R_STARS;
            sPhase[i] = rng();
            sSize[i] = rngRange(rng, 2.2, 6.2);
            // Fade in toward the zenith; kill anything close to the sun.
            const dot = (sPos[i * 3] * sunDir.x + sPos[i * 3 + 1] * sunDir.y + sPos[i * 3 + 2] * sunDir.z) / R_STARS;
            // `away` only has to clear the sun's own glow pocket (~16 degrees).
            // A wide gate silently deletes every star in the half of the sky
            // the camera is actually pointed at.
            const zen = Math.min(1, Math.max(0, (y - 0.44) / 0.34));
            const away = Math.min(1, Math.max(0, (0.962 - dot) / 0.055));
            sBase[i] = Math.pow(zen, 1.5) * away * rngRange(rng, 0.80, 1.0);
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
        starGeo.setAttribute('aPhase', new THREE.BufferAttribute(sPhase, 1));
        starGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
        starGeo.setAttribute('aBase', new THREE.BufferAttribute(sBase, 1));
        starMat = new THREE.ShaderMaterial({
            vertexShader: STAR_VERT,
            fragmentShader: STAR_FRAG,
            uniforms: {
                uTime: { value: 0 },
                uScale: { value: 6.0 },
                uTint: { value: new THREE.Color(PALETTE.starTint) },
            },
            transparent: true,
            // NOT AdditiveBlending. Three's additive preset is (SrcAlpha, One),
            // which multiplies an already premultiplied colour by alpha a
            // SECOND time — a star at alpha 0.3 contributes 0.09 and vanishes.
            // (One, One) with premultiplied output is linear in alpha.
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneFactor,
            blendEquation: THREE.AddEquation,
            depthWrite: false,
            depthTest: false,
            fog: false,
        });
        stars = new THREE.Points(starGeo, starMat);
        stars.frustumCulled = false;
        stars.renderOrder = -998;
        group.add(stars);
        disposables.push(starGeo, starMat);
        drawCallCount += 1;
    }

    // --- 4. cel clouds ------------------------------------------------------
    const cloudGeo = buildCloudGeometry(THREE, tier.cloudSeg);
    const cloudCount = tier.clouds;
    const cloudTris = cloudGeo.getAttribute('position').count / 3;

    // Per-sky drift clock, shared into the patched cloud shader.
    const cloudTimeUniform = { value: 0 };

    const cloudMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: false,
        // Cards are built facing the camera anchor, so back faces never show.
        // DoubleSide would double the reported triangle count for nothing.
        side: THREE.FrontSide,
        fog: false,
        toneMapped: false,
    });
    // Per-instance angular drift about world +Y, applied in the vertex shader.
    // Rotating every vertex of a card by the same angle about the origin is a
    // rigid motion, so the card keeps facing the camera for free.
    cloudMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = cloudTimeUniform;
        shader.vertexShader = 'attribute float aDrift;\nattribute vec2 aShape;\n' + shader.vertexShader.replace(
            '#include <project_vertex>',
            /* glsl */`
            // Per-instance silhouette warp. One shared cloud geometry repeated
            // 34 times reads as wallpaper, so each instance gets a shear and a
            // sinusoidal re-profiling of its TOPS only (the flat base has to
            // stay flat or the cloud stops reading as a drawn cloud).
            transformed.y += transformed.x * aShape.x;
            transformed.y += max( 0.0, transformed.y ) * aShape.y
                           * sin( transformed.x * 2.6 + aShape.x * 9.0 );

            vec4 mvPosition = vec4( transformed, 1.0 );
            #ifdef USE_INSTANCING
                mvPosition = instanceMatrix * mvPosition;
            #endif
            float vyA = uTime * aDrift;
            float vyC = cos( vyA );
            float vyS = sin( vyA );
            mvPosition.xyz = vec3(
                vyC * mvPosition.x + vyS * mvPosition.z,
                mvPosition.y,
                -vyS * mvPosition.x + vyC * mvPosition.z
            );
            mvPosition = modelViewMatrix * mvPosition;
            gl_Position = projectionMatrix * mvPosition;
            `
        ).replace('void main() {', 'uniform float uTime;\nvoid main() {');
    };
    cloudMat.customProgramCacheKey = () => 'gauntlet-cloud-v1';

    const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudCount);
    clouds.frustumCulled = false;
    clouds.renderOrder = -997;
    clouds.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const drift = new Float32Array(cloudCount);
    const shape = new Float32Array(cloudCount * 2);
    for (let i = 0; i < cloudCount; i++) {
        // STRATIFIED, not random. Two reasons. (1) The budget is 34 cards for
        // a whole sphere; scattered at random they clump and leave holes the
        // size of the viewport, which is what makes a sky read as empty.
        // (2) They are concentrated into the -6 to +52 degree band the player
        // actually looks at — overhead cards are edge-on slivers anyway.
        // Elevation walks the band in even steps while azimuth advances by the
        // golden angle, so any view gets its fair share.
        const u = (i + 0.5) / cloudCount;
        const elev = Math.sin(-0.11 + (0.92 + 0.11) * u + rngRange(rng, -0.05, 0.05));
        const az = (i * 2.399963) % (Math.PI * 2) + rngRange(rng, -0.28, 0.28);
        const horiz = Math.sqrt(Math.max(0, 1 - elev * elev));
        const dist = rngRange(rng, CLOUD_NEAR, CLOUD_FAR);
        tmpDir.set(Math.cos(az) * horiz, elev, Math.sin(az) * horiz);

        orient.position.copy(tmpDir).multiplyScalar(dist);
        orient.up.set(0, 1, 0);
        if (Math.abs(tmpDir.y) > 0.9) orient.up.set(1, 0, 0);
        orient.lookAt(0, 0, 0);

        // Size is expressed as a fraction of the distance, i.e. as an ANGULAR
        // size — otherwise a distant cloud and a near one of the same world
        // size read as wildly different and the far band swallows the frame.
        // A cloud's half-width lands between ~3.5 and ~11 degrees of arc.
        const flat = Math.min(1, Math.max(0, 1 - elev * 2.2));
        const ang = rngRange(rng, 0.075, 0.185) * (0.90 - 0.22 * flat);
        const sx = dist * ang * rngRange(rng, 1.0, 1.35 + flat * 0.45);
        const sy = dist * ang * rngRange(rng, 0.40, 0.66) * (1 - flat * 0.22);
        orient.scale.set(sx, sy, 1);
        orient.rotateZ(rngRange(rng, -0.08, 0.08));
        orient.updateMatrix();
        tmpMat.copy(orient.matrix);
        clouds.setMatrixAt(i, tmpMat);

        // Aerial perspective, done as a tint rather than a fog term: distant
        // clouds sink toward the sky value, and clouds sitting in the low warm
        // band pick up the horizon's gold so they belong to the gradient.
        const far01 = (dist - CLOUD_NEAR) / (CLOUD_FAR - CLOUD_NEAR);
        const low = Math.min(1, Math.max(0, 1 - elev * 3.2));
        const v = 1.0 - far01 * 0.14;
        tmpColor.setRGB(
            v * (1 + low * 0.03),
            v * (1 - far01 * 0.02 - low * 0.02),
            v * (1 - far01 * 0.005 - low * 0.10)
        );
        clouds.setColorAt(i, tmpColor);

        drift[i] = rngRange(rng, 0.0045, 0.0165) * (rng() < 0.5 ? -1 : 1);
        shape[i * 2] = rngRange(rng, -0.15, 0.15);
        shape[i * 2 + 1] = rngRange(rng, -0.34, 0.42);
    }
    clouds.instanceMatrix.needsUpdate = true;
    if (clouds.instanceColor) clouds.instanceColor.needsUpdate = true;
    cloudGeo.setAttribute('aDrift', new THREE.InstancedBufferAttribute(drift, 1));
    cloudGeo.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 2));

    group.add(clouds);
    disposables.push(cloudGeo, cloudMat);
    triangleCount += cloudTris * cloudCount;
    drawCallCount += 1;

    // --- runtime ------------------------------------------------------------
    let time = 0;

    /**
     * @param {number} dt seconds
     * @param {object} camera the rendering camera — the group tracks its position
     */
    function update(dt, camera) {
        time += dt;
        cloudTimeUniform.value = time;
        haloMat.uniforms.uTime.value = time;
        if (starMat) starMat.uniforms.uTime.value = time;
        if (camera) {
            group.position.x = camera.position.x;
            group.position.y = camera.position.y;
            group.position.z = camera.position.z;
        }
    }

    function dispose() {
        for (let i = 0; i < disposables.length; i++) {
            const d = disposables[i];
            if (d && typeof d.dispose === 'function') d.dispose();
        }
        disposables.length = 0;
        if (group.parent) group.parent.remove(group);
        group.clear();
    }

    return {
        group,
        update,
        drawCallCount,
        triangleCount: Math.round(triangleCount),
        dispose,
    };
}

export default createSky;
