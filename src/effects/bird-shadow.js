/**
 * The bird's sun shadow — three analytic ellipsoids, no shadow map.
 *
 * Below Ultra the bird's only shadow is contact-shadow.js: a soft disc laid
 * straight down the radial, whatever the sun is doing. That disc is an
 * ALTITUDE cue and it stays (it answers "how high am I", which a sun-projected
 * shadow 35 units off to one side does not). What it cannot be is a shadow:
 * at a 30-degree sun the bird's real shadow lands 1.7x its height away along
 * the ground, stretches, and falls across tree trunks and rock faces on the
 * way.
 *
 * So the bird is described to every world material as three ellipsoids — the
 * body and the two wings, read off the live rig every frame — and each
 * fragment asks how much of the sun those three solids hide. That is the
 * technique Iwanicki shipped in The Last of Us (2013) for character shadows,
 * and the one Unreal's capsule shadows use: an occluder you can intersect in
 * closed form is one you can shadow with in the fragment shader, at any
 * quality preset, with no depth pass and no draw call.
 *
 * Per ellipsoid the fragment moves itself and the sun ray into the unit
 * sphere's space (one 3x3), then takes Quilez's plausible sphere soft shadow:
 * the ray's closest miss distance d over its distance t to the occluder,
 * smoothstepped. d/t is an ANGLE, which is what a penumbra is — so the shadow
 * is sharp where the wing nearly touches the ground and softens with height
 * (contact hardening) without anybody tuning a blur. Past ~20 units from the
 * bird it fades out: the penumbra would be wider than the bird by then, and
 * the contact disc already covers what altitude is left to say.
 *
 * Uniform layout (shared objects, one upload per material per frame):
 *   uBirdShadowE[12]  per ellipsoid e: [4e] centre, [4e+1..3] the rows of
 *                     the world -> unit-sphere matrix (axis / halfExtent)
 *   uBirdShadowP      x strength (0 = off), y fade start, z fade end,
 *                     w softness k
 *
 * THREE is injected. The per-frame update allocates nothing.
 */

export function birdShadowRequested(search) {
  return !/[?&]birdshadow=0(?:&|$)/.test(search || '');
}

export const BIRD_SHADOW_DEFAULTS = Object.freeze({
  strength: 0.85,
  fadeStart: 12,
  fadeEnd: 20,
  // 2.5 k d / t in Quilez's form; larger is sharper.
  softness: 14,
  // Wing chord and thickness as fractions of the shoulder-to-tip length.
  // The parrot planform measures AR ~5.1 (docs: "measure the render, not the
  // constants"), so a half-span of s has a mean half-chord near s / 5.1.
  chordRatio: 0.2,
  thicknessRatio: 0.05,
});

/** The shared uniform objects. Values are filled by ensureBirdShadowUniforms. */
export const birdShadowUniforms = {
  uBirdShadowE: { value: null },
  uBirdShadowP: { value: null },
};

/** Idempotent: allocates the uniform VALUES once (THREE-free typed arrays). */
export function ensureBirdShadowUniforms(THREE) {
  if (!birdShadowUniforms.uBirdShadowE.value) {
    // Every row zero: the occlusion routine then sees an ellipsoid infinitely
    // far away and returns fully lit, so an un-updated uniform is inert.
    birdShadowUniforms.uBirdShadowE.value = new Float32Array(36);
  }
  if (!birdShadowUniforms.uBirdShadowP.value) {
    const d = BIRD_SHADOW_DEFAULTS;
    birdShadowUniforms.uBirdShadowP.value = THREE?.Vector4
      ? new THREE.Vector4(0, d.fadeStart, d.fadeEnd, d.softness)
      : { x: 0, y: d.fadeStart, z: d.fadeEnd, w: d.softness };
  }
  return birdShadowUniforms;
}

/**
 * GLSL: needs `uBirdShadowE`, `uBirdShadowP` declared (BIRD_SHADOW_UNIFORMS_GLSL).
 * Returns 1 lit .. 0 shadowed for world point `p` and unit sun direction `l`.
 */
export const BIRD_SHADOW_UNIFORMS_GLSL = 'uniform vec3 uBirdShadowE[12]; uniform vec4 uBirdShadowP;\n';

export const BIRD_SHADOW_GLSL = `
  float birbEllipsoidVis( vec3 p, vec3 l, vec3 c, vec3 r0, vec3 r1, vec3 r2, float k ) {
    vec3 q = p - c;
    vec3 ro = vec3( dot( r0, q ), dot( r1, q ), dot( r2, q ) );
    vec3 rd = vec3( dot( r0, l ), dot( r1, l ), dot( r2, l ) );
    float rl = length( rd );
    if ( rl < 1e-6 ) return 1.0;
    rd /= rl;
    float b = dot( ro, rd );
    // The occluder is behind the point, toward the ground: no shadow.
    if ( b >= 0.0 ) return 1.0;
    float h = b * b - ( dot( ro, ro ) - 1.0 );
    // Closest approach of the sun ray's line to the centre, in the unit
    // sphere's space; a hit is full shadow.
    float dist = sqrt( max( 0.0, 1.0 - h ) );
    if ( dist <= 1.0 ) return 0.0;
    // Back to WORLD units before taking the ratio, so the penumbra is an
    // angle and not stretched along whichever axis is thinnest: the miss
    // scales by the half-extent along the miss direction, the distance by
    // the ray's own scale.
    vec3 u = ( ro - b * rd ) / dist;
    vec3 inv = vec3( 1.0 / length( r0 ), 1.0 / length( r1 ), 1.0 / length( r2 ) );
    float missW = ( dist - 1.0 ) * length( u * inv );
    float alongW = -b / rl;
    return smoothstep( 0.0, 1.0, k * missW / alongW );
  }
  float birbBirdShadow( vec3 p, vec3 l ) {
    if ( uBirdShadowP.x <= 0.0 ) return 1.0;
    float far = length( p - uBirdShadowE[ 0 ] );
    if ( far >= uBirdShadowP.z ) return 1.0;
    float k = uBirdShadowP.w;
    float v = birbEllipsoidVis( p, l, uBirdShadowE[ 0 ], uBirdShadowE[ 1 ], uBirdShadowE[ 2 ], uBirdShadowE[ 3 ], k );
    v = min( v, birbEllipsoidVis( p, l, uBirdShadowE[ 4 ], uBirdShadowE[ 5 ], uBirdShadowE[ 6 ], uBirdShadowE[ 7 ], k ) );
    v = min( v, birbEllipsoidVis( p, l, uBirdShadowE[ 8 ], uBirdShadowE[ 9 ], uBirdShadowE[ 10 ], uBirdShadowE[ 11 ], k ) );
    float fade = smoothstep( uBirdShadowP.y, uBirdShadowP.z, far );
    return mix( 1.0, v, uBirdShadowP.x * ( 1.0 - fade ) );
  }
`;

// ── JS reference (tests, debug readback) ────────────────────────────────────

const smooth01 = (x) => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };

/** JS mirror of birbEllipsoidVis. `rows` = [r0, r1, r2] as [x,y,z]. */
export function ellipsoidVisibility(p, l, c, rows, k = BIRD_SHADOW_DEFAULTS.softness) {
  const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const ro = rows.map((r) => dot(r, q));
  let rd = rows.map((r) => dot(r, l));
  const rl = Math.hypot(...rd);
  if (rl < 1e-6) return 1;
  rd = rd.map((v) => v / rl);
  const b = dot(ro, rd);
  if (b >= 0) return 1;
  const h = b * b - (dot(ro, ro) - 1);
  const dist = Math.sqrt(Math.max(0, 1 - h));
  if (dist <= 1) return 0;
  const u = ro.map((v, i) => (v - b * rd[i]) / dist);
  const inv = rows.map((r) => 1 / Math.hypot(...r));
  const missW = (dist - 1) * Math.hypot(u[0] * inv[0], u[1] * inv[1], u[2] * inv[2]);
  const alongW = -b / rl;
  return smooth01((k * missW) / alongW);
}

/**
 * Rows of the world -> unit-sphere map for an ellipsoid with orthonormal
 * axes (a0, a1, a2) and half-extents (h0, h1, h2): row_i = a_i / h_i.
 */
export function ellipsoidRows(axes, halves) {
  return axes.map((a, i) => [a[0] / halves[i], a[1] / halves[i], a[2] / halves[i]]);
}

// ── The per-frame driver ────────────────────────────────────────────────────

/**
 * Reads the live rig and writes the three ellipsoids. `update(anchor,
 * enabled)` is the whole per-frame cost: two getWorldPosition calls per wing,
 * a handful of dot products, no allocation.
 *
 * The body box is measured ONCE per model, in the anchor's own space, from
 * every mesh that is not under a wing — so it follows whichever bird build is
 * live (v1/v2/v3, a GLB that passed the contract) without a constant per
 * build. A wing is its shoulder (the wing group's origin) to its tip feather
 * (`userData.tipFeather`, the rig contract's ribbon anchor), so the ellipsoid
 * flaps, folds and sweeps with the wing it stands for.
 */
export function createBirdShadowDriver(THREE, options = {}) {
  const cfg = { ...BIRD_SHADOW_DEFAULTS, ...options };
  const U = ensureBirdShadowUniforms(THREE);
  const E = U.uBirdShadowE.value;
  const P = U.uBirdShadowP.value;
  P.x = 0; P.y = cfg.fadeStart; P.z = cfg.fadeEnd; P.w = cfg.softness;

  let strength = cfg.strength;
  let model = null;          // the anchor child the body box was measured on
  let leftWing = null; let rightWing = null;
  const bodyCenterLocal = new THREE.Vector3();
  const bodyHalfLocal = new THREE.Vector3(0.3, 0.25, 0.5);
  let bodyValid = false;

  const _m = new THREE.Matrix4();
  const _inv = new THREE.Matrix4();
  const _box = new THREE.Box3();
  const _v = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _ax = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const _s = new THREE.Vector3(); const _t = new THREE.Vector3();
  const _u = new THREE.Vector3(); const _f = new THREE.Vector3();
  const _n = new THREE.Vector3();

  function isUnderWing(o, anchor) {
    for (let p = o; p && p !== anchor; p = p.parent) {
      if (p.name === 'leftWing' || p.name === 'rightWing') return true;
    }
    return false;
  }

  function measure(anchor) {
    model = anchor.children[0] || null;
    leftWing = anchor.getObjectByName('leftWing') || null;
    rightWing = anchor.getObjectByName('rightWing') || null;
    bodyValid = false;
    anchor.updateWorldMatrix(true, true);
    _inv.copy(anchor.matrixWorld).invert();
    const total = new THREE.Box3();
    anchor.traverse((o) => {
      if (!o.isMesh || !o.geometry || isUnderWing(o, anchor)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _m.multiplyMatrices(_inv, o.matrixWorld);
      _box.copy(o.geometry.boundingBox).applyMatrix4(_m);
      total.union(_box);
    });
    if (!total.isEmpty()) {
      total.getCenter(bodyCenterLocal);
      total.getSize(bodyHalfLocal).multiplyScalar(0.5 * 0.92);
      bodyHalfLocal.x = Math.max(bodyHalfLocal.x, 0.05);
      bodyHalfLocal.y = Math.max(bodyHalfLocal.y, 0.05);
      bodyHalfLocal.z = Math.max(bodyHalfLocal.z, 0.05);
      bodyValid = true;
    }
  }

  function writeRows(slot, cx, cy, cz, a0, h0, a1, h1, a2, h2) {
    const o = slot * 12;
    E[o] = cx; E[o + 1] = cy; E[o + 2] = cz;
    E[o + 3] = a0.x / h0; E[o + 4] = a0.y / h0; E[o + 5] = a0.z / h0;
    E[o + 6] = a1.x / h1; E[o + 7] = a1.y / h1; E[o + 8] = a1.z / h1;
    E[o + 9] = a2.x / h2; E[o + 10] = a2.y / h2; E[o + 11] = a2.z / h2;
  }

  function clearSlot(slot) {
    const o = slot * 12;
    for (let i = 0; i < 12; i++) E[o + i] = 0;
  }

  function writeWing(slot, wing, birdUp) {
    const tip = wing?.userData?.tipFeather;
    if (!wing || !tip) { clearSlot(slot); return; }
    wing.getWorldPosition(_s);
    tip.getWorldPosition(_t);
    _u.subVectors(_t, _s);
    const len = _u.length();
    if (!(len > 1e-4)) { clearSlot(slot); return; }
    _u.divideScalar(len);
    // Chord: across the span, in the plane the bird's own up is normal to.
    // Built from up x span rather than from a forward axis, because the
    // model's forward is local +X for the procedural birds and -Z for a GLB,
    // while local +Y is up for both (the orientation offset turns about Y).
    _f.crossVectors(birdUp, _u);
    if (_f.lengthSq() < 1e-8) _f.set(_u.y, -_u.x, 0);
    _f.normalize();
    _n.crossVectors(_u, _f);
    _c.addVectors(_s, _t).multiplyScalar(0.5);
    const half = len * 0.5 * 1.04;
    writeRows(slot, _c.x, _c.y, _c.z,
      _u, half, _f, Math.max(0.05, len * cfg.chordRatio), _n, Math.max(0.02, len * cfg.thicknessRatio));
  }

  return {
    uniforms: U,
    get strength() { return strength; },
    setStrength(s) { strength = Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : cfg.strength; return strength; },
    /** Per frame. `enabled` false hides the shadow (nested, cockpit, no bird). */
    update(anchor, enabled = true) {
      if (!enabled || !anchor || strength <= 0) { P.x = 0; return false; }
      if (anchor.children[0] !== model || !bodyValid) measure(anchor);
      if (!bodyValid) { P.x = 0; return false; }
      anchor.updateWorldMatrix(true, false);
      const me = anchor.matrixWorld.elements;
      // Body: the anchor-space box, carried by the anchor's world matrix.
      _v.copy(bodyCenterLocal).applyMatrix4(anchor.matrixWorld);
      _ax[0].set(me[0], me[1], me[2]);
      _ax[1].set(me[4], me[5], me[6]);
      _ax[2].set(me[8], me[9], me[10]);
      const s0 = _ax[0].length() || 1; const s1 = _ax[1].length() || 1; const s2 = _ax[2].length() || 1;
      _ax[0].divideScalar(s0); _ax[1].divideScalar(s1); _ax[2].divideScalar(s2);
      writeRows(0, _v.x, _v.y, _v.z,
        _ax[0], bodyHalfLocal.x * s0, _ax[1], bodyHalfLocal.y * s1, _ax[2], bodyHalfLocal.z * s2);
      // _ax[1] is the bird's own up (local +Y for every build).
      writeWing(1, leftWing, _ax[1]);
      writeWing(2, rightWing, _ax[1]);
      P.x = strength;
      return true;
    },
    /** Readback for __BIRB: plain numbers. */
    state() {
      return {
        strength, active: P.x > 0, bodyValid,
        body: { center: [E[0], E[1], E[2]] },
        wings: [1, 2].map((s) => ({ center: [E[s * 12], E[s * 12 + 1], E[s * 12 + 2]] })),
      };
    },
  };
}
