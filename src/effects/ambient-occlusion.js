/**
 * src/effects/ambient-occlusion.js — screen-space ambient occlusion for the
 * post pass (bloom-pass.js), the Ultra default (`?ao=0` / `?ao=1`).
 *
 * Why this, of every realism lever left: this world is lit by a sun, a sky
 * hemisphere and (on Ultra) a shadow map, and NOTHING darkens where two
 * surfaces meet. A trunk stands on the ground with the same light at its foot
 * as on open grass; a rock sits on a slope like a sticker; the inside of a
 * canyon bend, the gap between two towers, the crease where a cliff meets the
 * floor all read flat. Contact darkening is the cue the eye uses to put things
 * ON each other, and it is the one the frame had none of. It costs no
 * triangles and no draw calls in the scene: three full-screen triangles at
 * half resolution.
 *
 * The method is the range-limited, cosine-weighted horizon estimate that SAO
 * (McGuire et al. 2012) and Alchemy AO share, kept small for a phone:
 *
 *   - view position from the scene pass's own DEPTH TEXTURE (the multisample
 *     target resolves its depth into it, so MSAA costs nothing extra here);
 *   - the normal from the depth itself, taking whichever neighbour is CLOSER
 *     in depth on each axis, so a silhouette edge does not average the
 *     foreground's normal with the background's;
 *   - 12 taps on a spiral whose screen radius is a fixed WORLD radius
 *     projected at that pixel's depth (so a trunk's foot and a distant
 *     ridge occlude by the same physical reach), rotated per pixel by
 *     interleaved gradient noise;
 *   - each tap occludes by max(0, cos(angle to the normal) - bias), weighted
 *     to zero at the radius — so a tap far behind a silhouette (the sky, a
 *     valley floor 80 units down) contributes nothing, which is the halo
 *     every naive SSAO grows;
 *   - a separable depth-aware blur (the noise is the price of 12 taps; the
 *     blur is what turns it into a gradient), and a fade with distance, where
 *     depth precision and the fog both say there is nothing left to see.
 *
 * The pass writes AO to R and the linear view depth to G, so the blur weighs
 * by depth without sampling the depth texture again.
 *
 * Applied in the composite to the scene colour BEFORE the bloom is added
 * (an occluded crease does not get dimmer light from a glowing ring
 * nearby), never to the bloom or the shafts.
 *
 * Pure parts (the request parser, the radius maths, the composite patch,
 * the spiral) are exported for tests; createAmbientOcclusionStage owns the
 * targets and materials and allocates nothing per frame.
 */

/**
 * `?ao=1` forces it on at any preset, `?ao=0` forces it off; absent is
 * null (the caller decides — realism-defaults.js turns it on at Ultra).
 */
export function ambientOcclusionRequested(search) {
  const m = /[?&]ao=([01])(?:&|#|$)/.exec(typeof search === 'string' ? search : '');
  return m ? m[1] === '1' : null;
}

export const AO_DEFAULTS = Object.freeze({
  // World units. The bird is ~2 across, trunks 1-3, a shrub 2-4: three
  // units reaches across a foot, a crease and a rock's contact without
  // turning a whole tree into one dark blob.
  radius: 3.2,
  // Cosine below which a tap does not occlude. Stops a flat facet
  // self-occluding through depth quantisation (low-poly terrain is ALL flat
  // facets, so this is not a nicety).
  bias: 0.12,
  // Occlusion strength; the composite multiplies by mix(1, ao, strength).
  // Solved against a box-on-a-plane test scene, then raised a step in the
  // game: 2.0 put the contact under a 2-unit box at ~0.5 linear and a
  // wall/floor crease at ~0.7, and the canyon's dune folds read only just;
  // 2.4 gives them form without inking anything in. (`__BIRB.ao({debug:1})`
  // shows the factor raw: the grey on screen is the multiply.)
  intensity: 2.4,
  strength: 0.85,
  // Screen radius ceiling, in UV. A pixel on the bird at the chase camera's
  // 4-unit stand-off would otherwise ask for a 60%-of-the-screen spiral that
  // 12 taps cannot sample.
  maxScreen: 0.16,
  // View-depth fade: full AO to fadeStart, none past fadeEnd. Past ~220
  // units the terrain is in the fog and a 24-bit depth step is ~0.03 units.
  fadeStart: 140,
  fadeEnd: 260,
  samples: 12,
  // Spiral turns over the 12 taps. 7 is the SAO paper's choice for its
  // tap counts; any value coprime-ish with the count avoids lining taps up.
  turns: 7,
});

/**
 * The spiral's i-th tap, as (unit direction angle in turns, radius fraction).
 * Mirrors the GLSL exactly (`alpha = (i + 0.5) / N`), noise excluded.
 */
export function spiralTap(i, n = AO_DEFAULTS.samples, turns = AO_DEFAULTS.turns) {
  const alpha = (i + 0.5) / n;
  return { angle: alpha * turns, radius: alpha };
}

/**
 * Screen radius in UV of a world radius at view depth z (positive, units in
 * front of the camera), for a projection whose [0][0] / [1][1] are px / py.
 * Clamped to `max` on both axes, preserving the aspect.
 */
export function aoScreenRadius(radius, px, py, z, max = AO_DEFAULTS.maxScreen) {
  const zz = Math.max(1e-4, z);
  let rx = 0.5 * radius * px / zz;
  let ry = 0.5 * radius * py / zz;
  const m = Math.max(rx, ry);
  if (m > max) { rx *= max / m; ry *= max / m; }
  return { x: rx, y: ry };
}

/** The tap weight: cosine past the bias, falling to zero at the radius. */
export function aoTapWeight(vx, vy, vz, nx, ny, nz, radius, bias = AO_DEFAULTS.bias) {
  const vv = vx * vx + vy * vy + vz * vz;
  const falloff = Math.max(0, 1 - vv / (radius * radius));
  const cos = (vx * nx + vy * ny + vz * nz) / Math.sqrt(vv + 1e-4);
  return falloff * Math.max(0, cos - bias);
}

const AO_FRAG = `
  uniform sampler2D tDepth;
  uniform mat4 uInvProj;
  uniform vec2 uProjScale;
  uniform vec2 uTexel;
  uniform float uRadius;
  uniform float uBias;
  uniform float uIntensity;
  uniform float uMaxScreen;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  varying vec2 vUv;

  const int SAMPLES = ${AO_DEFAULTS.samples};
  const float TURNS = ${AO_DEFAULTS.turns.toFixed(1)};

  // Snapped to the depth texel's CENTRE before unprojecting. The depth
  // texture is sampled nearest, so a tap at an arbitrary uv reads the depth
  // of a texel whose centre is up to half a texel away — and unprojecting
  // that depth at the tap's own uv puts the point where it is not. On ground
  // seen at a grazing angle depth changes fast down the screen, and the
  // error came out as regular horizontal BANDS of false occlusion across
  // every hillside, one per texel row the taps straddled.
  vec3 viewPos(vec2 uv) {
    uv = (floor(uv / uTexel) + 0.5) * uTexel;
    float d = texture2D(tDepth, uv).r;
    vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }

  void main() {
    // The centre, snapped ONCE, and its neighbours stepped from it. A
    // half-res pixel's centre lands exactly on a full-res texel BOUNDARY, so
    // snapping it and its neighbour independently could round both to the
    // same texel: a zero edge vector, a NaN normal, and a whole line of
    // broken occlusion down the screen.
    vec2 uvC = (floor(vUv / uTexel) + 0.5) * uTexel;
    float depth = texture2D(tDepth, uvC).r;
    // The sky (and anything at the far plane) is never occluded. G carries a
    // huge depth so the blur never borrows from it — 6e4, NOT 1e5: the target
    // is HALF float, whose largest finite value is 65504. 1e5 stored as
    // +Inf, the blur's Inf - Inf made NaN, and NaN times the scene painted
    // the whole sky (and every pixel whose blur touched it) black.
    if (depth >= 0.99999) { gl_FragColor = vec4(1.0, 6.0e4, 0.0, 1.0); return; }
    vec3 P = viewPos(uvC);
    float z = -P.z;

    // Normal from depth, one-sided on each axis toward the CLOSER neighbour,
    // so an edge does not blend the two surfaces it separates.
    vec3 pr = viewPos(uvC + vec2(uTexel.x, 0.0));
    vec3 pl = viewPos(uvC - vec2(uTexel.x, 0.0));
    vec3 pu = viewPos(uvC + vec2(0.0, uTexel.y));
    vec3 pd = viewPos(uvC - vec2(0.0, uTexel.y));
    vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
    vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
    vec3 nc = cross(dx, dy);
    float nl = dot(nc, nc);
    // A degenerate pair (both neighbours on the far side of an edge) gets
    // the view vector: never a NaN, which the composite would multiply in.
    vec3 N = nl > 1.0e-20 ? nc * inversesqrt(nl) : normalize(-P);

    vec2 r = 0.5 * uRadius * uProjScale / max(z, 1.0e-4);
    float rm = max(r.x, r.y);
    if (rm > uMaxScreen) r *= uMaxScreen / rm;

    // Interleaved gradient noise rotates the spiral per pixel.
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float rr = uRadius * uRadius;
    float occlusion = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      float alpha = (float(i) + 0.5) / float(SAMPLES);
      float angle = (alpha * TURNS + noise) * 6.28318530718;
      vec2 uv = uvC + vec2(cos(angle), sin(angle)) * r * alpha;
      vec3 v = viewPos(uv) - P;
      float vv = dot(v, v);
      float falloff = max(0.0, 1.0 - vv / rr);
      occlusion += falloff * max(0.0, dot(v, N) * inversesqrt(vv + 1.0e-4) - uBias);
    }
    float ao = clamp(1.0 - uIntensity * occlusion / float(SAMPLES), 0.0, 1.0);
    ao = mix(ao, 1.0, smoothstep(uFadeStart, uFadeEnd, z));
    gl_FragColor = vec4(ao, z, 0.0, 1.0);
  }
`;

/** Depth-aware separable blur: 9 taps folded to 5 offsets per side pair. */
const AO_BLUR_FRAG = `
  uniform sampler2D tAO;
  uniform vec2 uDirection;
  varying vec2 vUv;
  void main() {
    vec2 c = texture2D(tAO, vUv).rg;
    float sum = c.r * 0.2270270270;
    float wsum = 0.2270270270;
    // Depth tolerance grows with depth: 4% of the view distance.
    float tol = 1.0 / max(0.04 * c.g, 0.05);
    for (int k = 1; k <= 4; k++) {
      float w = k == 1 ? 0.1945945946 : (k == 2 ? 0.1216216216 : (k == 3 ? 0.0540540541 : 0.0162162162));
      vec2 o = uDirection * float(k);
      vec2 a = texture2D(tAO, vUv + o).rg;
      vec2 b = texture2D(tAO, vUv - o).rg;
      float wa = w * max(0.0, 1.0 - abs(a.g - c.g) * tol);
      float wb = w * max(0.0, 1.0 - abs(b.g - c.g) * tol);
      sum += a.r * wa + b.r * wb;
      wsum += wa + wb;
    }
    gl_FragColor = vec4(sum / wsum, c.g, 0.0, 1.0);
  }
`;

export const AO_COMPOSITE_UNIFORM_ANCHOR = '  uniform float uDebug;\n';
export const AO_COMPOSITE_MAIN_ANCHOR = '  void main() {\n    vec2 d = vUv - 0.5;\n';
export const AO_COMPOSITE_APPLY_ANCHOR = '    vec3 bloom = texture2D(tBloom, vUv).rgb;\n';

/**
 * The composite with AO multiplied into the scene colour before the bloom.
 * Throws on a missing anchor: a patch that silently no-ops ships invisible.
 */
export function patchCompositeAO(source) {
  for (const anchor of [AO_COMPOSITE_UNIFORM_ANCHOR, AO_COMPOSITE_MAIN_ANCHOR, AO_COMPOSITE_APPLY_ANCHOR]) {
    if (source.indexOf(anchor) < 0) throw new Error(`ambient-occlusion: composite anchor not found: ${JSON.stringify(anchor)}`);
  }
  return source
    .replace(AO_COMPOSITE_UNIFORM_ANCHOR, () => `${AO_COMPOSITE_UNIFORM_ANCHOR}  uniform sampler2D tAO;\n  uniform float uAO;\n  uniform float uAODebug;\n`)
    .replace(AO_COMPOSITE_MAIN_ANCHOR, () => `${AO_COMPOSITE_MAIN_ANCHOR}    if (uAODebug > 0.5) {
      // Written RAW, no output transform: the grey on screen IS the factor
      // the scene is multiplied by (sRGB-encoded, 0.33 read as 155/255 and
      // the AO looked a third as strong as it was).
      gl_FragColor = vec4(vec3(texture2D(tAO, vUv).r), 1.0);
      return;
    }
`)
    .replace(AO_COMPOSITE_APPLY_ANCHOR, () => `    scene *= mix(1.0, texture2D(tAO, vUv).r, uAO);\n${AO_COMPOSITE_APPLY_ANCHOR}`);
}

/**
 * The stage. `vertexShader` is the pass's full-screen triangle; render()
 * gets the pass's own drawWith. Targets are RGBA half float at the pass's
 * blur resolution.
 */
export function createAmbientOcclusionStage(THREE, { vertexShader, options = {} } = {}) {
  const cfg = { ...AO_DEFAULTS, ...options };
  const targetOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  };
  const aoA = new THREE.WebGLRenderTarget(1, 1, targetOptions);
  const aoB = new THREE.WebGLRenderTarget(1, 1, targetOptions);
  // Linear, deliberately: the blur's taps land on texel centres (same-size
  // target, whole-texel offsets), where linear IS nearest, so its depth
  // weights see real depths; the composite, upsampling 2x, gets a bilinear
  // gradient instead of 2x2 blocks.

  const aoMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: AO_FRAG,
    uniforms: {
      tDepth: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uProjScale: { value: new THREE.Vector2(1, 1) },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: cfg.radius },
      uBias: { value: cfg.bias },
      uIntensity: { value: cfg.intensity },
      uMaxScreen: { value: cfg.maxScreen },
      uFadeStart: { value: cfg.fadeStart },
      uFadeEnd: { value: cfg.fadeEnd },
    },
    depthTest: false,
    depthWrite: false,
  });
  const blurMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: AO_BLUR_FRAG,
    uniforms: { tAO: { value: null }, uDirection: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
  });

  // Shared with the composite (patchCompositeAO's uniforms).
  const compositeUniforms = {
    tAO: { value: aoA.texture },
    uAO: { value: cfg.strength },
    uAODebug: { value: 0 },
  };

  let enabled = true;
  let passes = 0;
  let frames = 0;

  function setSize(width, height) {
    aoA.setSize(width, height);
    aoB.setSize(width, height);
  }

  /** depthTexture: the scene's; camera: the one the scene was drawn with. */
  function render(depthTexture, camera, depthWidth, depthHeight, drawWith, tally) {
    passes = 0;
    if (!enabled || !depthTexture || !camera) return;
    const u = aoMaterial.uniforms;
    u.tDepth.value = depthTexture;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    const e = camera.projectionMatrix.elements;
    u.uProjScale.value.set(e[0], e[5]);
    u.uTexel.value.set(1 / Math.max(1, depthWidth), 1 / Math.max(1, depthHeight));
    drawWith(aoMaterial, aoA);
    if (tally) tally(false);
    blurMaterial.uniforms.tAO.value = aoA.texture;
    blurMaterial.uniforms.uDirection.value.set(1 / aoA.width, 0);
    drawWith(blurMaterial, aoB);
    if (tally) tally(false);
    blurMaterial.uniforms.tAO.value = aoB.texture;
    blurMaterial.uniforms.uDirection.value.set(0, 1 / aoA.height);
    drawWith(blurMaterial, aoA);
    if (tally) tally(false);
    compositeUniforms.tAO.value = aoA.texture;
    passes = 3;
    frames += 1;
  }

  /** Live switch (preset changes): off skips the passes and neutralises the multiply. */
  function setEnabled(on) {
    enabled = !!on;
    compositeUniforms.uAO.value = enabled ? cfg.strength : 0;
  }

  /** Debug/tuning hook (`__BIRB.ao({...})`). */
  function configure(opts = {}) {
    if (!opts || typeof opts !== 'object') return;
    if (opts.enabled !== undefined) setEnabled(opts.enabled);
    if (Number.isFinite(opts.debug)) compositeUniforms.uAODebug.value = opts.debug;
    if (Number.isFinite(opts.strength)) {
      cfg.strength = Math.max(0, Math.min(1, opts.strength));
      if (enabled) compositeUniforms.uAO.value = cfg.strength;
    }
    const u = aoMaterial.uniforms;
    for (const [k, name] of [['radius', 'uRadius'], ['bias', 'uBias'], ['intensity', 'uIntensity'],
      ['maxScreen', 'uMaxScreen'], ['fadeStart', 'uFadeStart'], ['fadeEnd', 'uFadeEnd']]) {
      if (Number.isFinite(opts[k])) { cfg[k] = opts[k]; u[name].value = opts[k]; }
    }
  }

  function info() {
    return {
      enabled, passes, frames,
      size: { width: aoA.width, height: aoA.height },
      params: { ...cfg },
      strength: compositeUniforms.uAO.value,
      debug: compositeUniforms.uAODebug.value,
    };
  }

  function dispose() {
    aoA.dispose(); aoB.dispose();
    aoMaterial.dispose(); blurMaterial.dispose();
  }

  return {
    compositeUniforms,
    patchComposite: patchCompositeAO,
    setSize,
    render,
    setEnabled,
    get enabled() { return enabled; },
    configure,
    info,
    dispose,
  };
}
