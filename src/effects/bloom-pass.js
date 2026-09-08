/**
 * Half-resolution bloom, hand-written, one merged pass.
 *
 * This is the only post-processing effect in the game and it is deliberately
 * NOT built on EffectComposer. Composer stacks a full-screen pass per effect,
 * and on a fill-rate-bound phone each full-screen pass is the whole budget.
 * Everything here happens in three small passes at HALF the canvas dimensions
 * plus one composite, and the composite also does the vignette — so there is
 * exactly one full-resolution fragment pass, not four.
 *
 * The pipeline:
 *
 *   scene -> HDR target (full res, the frame we would have shown)
 *          -> bright-pass + downsample to half res
 *          -> separable blur, horizontal then vertical, at half res
 *          -> composite to screen: scene + bloom, then vignette
 *
 * At half res each blur touches a quarter of the pixels. The three cheap
 * passes together cost less than one full-resolution blur would.
 *
 * Zero dependencies, in keeping with the rest of the repo. Everything is
 * pre-allocated in the constructor; `render()` allocates nothing.
 */

const FULLSCREEN_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Bright pass and downsample in one. Reading the full-res buffer while
 * writing the half-res one IS the downsample, so it is free.
 */
const BRIGHT_FRAG = `
  uniform sampler2D tScene;
  uniform float uThreshold;
  uniform float uSoftness;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    // Perceptual luminance, not a channel max: a saturated red ring and a
    // white spark of the same brightness should bloom by the same amount.
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Soft knee, so a surface drifting past the threshold fades in rather
    // than popping the moment the sun moves.
    float contribution = smoothstep(uThreshold, uThreshold + uSoftness, luma);
    gl_FragColor = vec4(c * contribution, 1.0);
  }
`;

/** Separable Gaussian. Two 9-tap passes beat one 81-tap in both cost and quality. */
const BLUR_FRAG = `
  uniform sampler2D tSource;
  uniform vec2 uDirection;
  varying vec2 vUv;
  void main() {
    // Weights for a 9-tap Gaussian, folded to 5 texture reads using linear
    // sampling between taps.
    vec3 sum = texture2D(tSource, vUv).rgb * 0.227027;
    vec2 o1 = uDirection * 1.3846153846;
    vec2 o2 = uDirection * 3.2307692308;
    sum += texture2D(tSource, vUv + o1).rgb * 0.3162162162;
    sum += texture2D(tSource, vUv - o1).rgb * 0.3162162162;
    sum += texture2D(tSource, vUv + o2).rgb * 0.0702702703;
    sum += texture2D(tSource, vUv - o2).rgb * 0.0702702703;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

/**
 * The one full-resolution pass. Bloom add and vignette are merged here rather
 * than being two passes, which is the whole reason this is hand-written.
 */
const COMPOSITE_FRAG = `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float uStrength;
  uniform float uVignette;
  uniform float uSpeed;
  varying vec2 vUv;
  void main() {
    vec2 d = vUv - 0.5;
    vec3 scene = texture2D(tScene, vUv).rgb;

    // ── Radial speed smear ───────────────────────────────────────────────
    // Only while boosting, and only in the OUTER frame: the centre stays
    // sharp so the thing the player is flying at is never smeared, which is
    // the mistake that makes speed effects unplayable rather than exciting.
    // Four extra taps, and they cost nothing at all when uSpeed is zero
    // because the branch is uniform across the draw.
    if (uSpeed > 0.001) {
      float edge = smoothstep(0.12, 0.5, length(d));
      float amount = uSpeed * edge * 0.055;
      vec3 smear = scene;
      smear += texture2D(tScene, vUv - d * amount * 0.5).rgb;
      smear += texture2D(tScene, vUv - d * amount * 1.0).rgb;
      smear += texture2D(tScene, vUv - d * amount * 1.7).rgb;
      smear += texture2D(tScene, vUv - d * amount * 2.6).rgb;
      scene = mix(scene, smear * 0.2, edge * uSpeed);
    }

    vec3 bloom = texture2D(tBloom, vUv).rgb;
    // Boost also lifts the bloom, so speed reads as light as well as motion.
    vec3 c = scene + bloom * (uStrength * (1.0 + uSpeed * 0.5));
    // Vignette costs two instructions here and would cost an entire
    // full-screen pass on its own. It tightens under boost, which is what
    // actually sells the tunnel.
    float v = 1.0 - dot(d, d) * (uVignette + uSpeed * 0.85);
    gl_FragColor = vec4(c * v, 1.0);
  }
`;

export function createBloomPass(THREE, renderer, {
  threshold = 0.72,
  softness = 0.26,
  strength = 0.85,
  vignette = 0.45,
  // Half the canvas in each axis, so a quarter of the pixels per blur tap.
  downscale = 2,
} = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const pixelRatio = renderer.getPixelRatio();
  const targetOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
  };

  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, targetOptions);
  // The blur targets need no depth buffer at all; they are full-screen
  // triangle passes over a texture.
  const blurA = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
  const blurB = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
  // The scene target carries the depth the world needs to draw correctly.
  sceneTarget.texture.colorSpace = THREE.NoColorSpace;

  const brightMaterial = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: BRIGHT_FRAG,
    uniforms: {
      tScene: { value: sceneTarget.texture },
      uThreshold: { value: threshold },
      uSoftness: { value: softness },
    },
    depthTest: false,
    depthWrite: false,
  });

  const blurMaterial = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: BLUR_FRAG,
    uniforms: {
      tSource: { value: null },
      uDirection: { value: new THREE.Vector2() },
    },
    depthTest: false,
    depthWrite: false,
  });

  const compositeMaterial = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: COMPOSITE_FRAG,
    uniforms: {
      tScene: { value: sceneTarget.texture },
      tBloom: { value: blurB.texture },
      uStrength: { value: strength },
      uVignette: { value: vignette },
      uSpeed: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });

  // One triangle, not a quad. A quad rasterises the screen diagonal twice;
  // a single oversized triangle covers the viewport with no seam and no
  // duplicated fragments.
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3,
  ));
  triangle.setAttribute('uv', new THREE.BufferAttribute(
    new Float32Array([0, 0, 2, 0, 0, 2]), 2,
  ));

  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadMesh = new THREE.Mesh(triangle, brightMaterial);
  quadMesh.frustumCulled = false;
  quadScene.add(quadMesh);

  function setSize(width, height, ratio) {
    const w = Math.max(1, Math.floor(width * ratio));
    const h = Math.max(1, Math.floor(height * ratio));
    sceneTarget.setSize(w, h);
    const bw = Math.max(1, Math.floor(w / downscale));
    const bh = Math.max(1, Math.floor(h / downscale));
    blurA.setSize(bw, bh);
    blurB.setSize(bw, bh);
  }
  setSize(size.x, size.y, pixelRatio);

  function drawWith(material, target) {
    quadMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  }

  return {
    get enabled() { return true; },
    sceneTarget,

    setSize,

    setStrength(value) { compositeMaterial.uniforms.uStrength.value = value; },
    setThreshold(value) { brightMaterial.uniforms.uThreshold.value = value; },
    setVignette(value) { compositeMaterial.uniforms.uVignette.value = value; },
    /** 0..1 boost amount: drives the radial smear, bloom lift and vignette. */
    setSpeed(value) {
      compositeMaterial.uniforms.uSpeed.value = Math.max(0, Math.min(1, value || 0));
    },

    /**
     * Render the scene through the pass. Replaces `renderer.render(scene, camera)`.
     */
    render(scene, camera) {
      // The world, into an offscreen buffer at full resolution.
      renderer.setRenderTarget(sceneTarget);
      renderer.clear();
      renderer.render(scene, camera);

      // Bright pass and downsample, half res.
      drawWith(brightMaterial, blurA);

      // Separable blur, half res, two passes.
      blurMaterial.uniforms.tSource.value = blurA.texture;
      blurMaterial.uniforms.uDirection.value.set(1 / blurA.width, 0);
      drawWith(blurMaterial, blurB);
      blurMaterial.uniforms.tSource.value = blurB.texture;
      blurMaterial.uniforms.uDirection.value.set(0, 1 / blurA.height);
      drawWith(blurMaterial, blurA);

      // Composite plus vignette, the one full-resolution pass.
      compositeMaterial.uniforms.tBloom.value = blurA.texture;
      drawWith(compositeMaterial, null);
    },

    dispose() {
      sceneTarget.dispose();
      blurA.dispose();
      blurB.dispose();
      brightMaterial.dispose();
      blurMaterial.dispose();
      compositeMaterial.dispose();
      triangle.dispose();
    },
  };
}
