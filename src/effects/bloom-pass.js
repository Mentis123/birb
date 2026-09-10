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
 *
 * ---------------------------------------------------------------------------
 * SCENE-TARGET MSAA (perf-wave-3b, "antialiasing on mobile")
 * ---------------------------------------------------------------------------
 * `index.html`'s WebGL context is created `antialias: !isMobile` — a
 * context-creation flag that cannot be toggled after the fact, so it cannot
 * be a live panel lever. But this pass never draws the scene straight to
 * that context: it draws to `sceneTarget`, an offscreen `WebGLRenderTarget`,
 * first. `WebGLRenderTarget` accepts a `samples` option, and — verified
 * against the exact pinned CDN build (three@0.183.2) with the exact target
 * options used below (RGBA HalfFloatType, depthBuffer, no stencil) under a
 * real (SwiftShader/ANGLE) WebGL2 context — sampling that target's texture
 * from a later full-screen pass (exactly what `brightMaterial`/
 * `compositeMaterial` do) triggers an automatic multisample resolve with NO
 * extra draw call and NO extra pass: a probe scanline across a rasterised
 * diagonal edge went from 0 blended pixels at `samples: 0` to 2 blended
 * pixels at `samples: 2` and `samples: 4`, with zero console warnings.
 * That is real hardware MSAA on the one pass that matters (the scene pass,
 * where every world edge is drawn) without recreating the WebGL context —
 * the third route the task brief asked to weigh, and it beats both an
 * FXAA-style resolve (which blurs; PERFORMANCE_REALISM_PLAN Experiment 2's
 * own caveat) and a full context rebuild (which tears down every material,
 * texture and render target mid-session).
 *
 * `samples` defaults to 0 — identical to today's plain `WebGLRenderTarget`,
 * so a page that never calls `setSamples` is byte-for-byte unchanged.
 * `setSamples(n)` clamps to `renderer.capabilities.maxSamples` AND requires
 * `EXT_color_buffer_float` to be present (probed once, here, not assumed —
 * `RGBA16F` multisample renderbuffers need it even under WebGL2, and this
 * repo has shipped a capability probe nobody checked the return value of
 * before). A device lacking either reports `samples` back as 0 for any
 * request — an honest requested-vs-effective desync per CONTRACT §0, never
 * a console warning and never a broken frame. Only `sceneTarget` gets
 * `samples`; `blurA`/`blurB`/`rayTarget` stay single-sample — they are
 * half-res full-screen quads with no geometric edges to smooth.
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
 * Volumetric light shafts, as a post-process (Mitchell, GPU Gems 3).
 *
 * The expensive way to do god rays is to march a depth buffer. The cheap way
 * exploits something this pipeline already computed: the BRIGHT buffer is
 * already an occlusion mask. The sun disc is over the knee and blazing; every
 * mountain, tree and drone in front of it is under the knee and black. Blur
 * that radially away from the sun's screen position and you have shafts that
 * are correctly interrupted by whatever is standing in front of the sun, for
 * one extra half-resolution pass and no depth read at all.
 *
 * Sixteen taps, decaying, with a per-pixel dither on the start offset.
 *
 * The dither is not polish. At twelve undithered taps every pixel samples the
 * same fractions of the same path, so the tree standing in front of the sun
 * came out as EIGHT discrete copies of itself marching down the screen — a
 * flip-book, not a shaft. Offsetting each pixel's march by a fraction of one
 * step turns that banding into noise, and the half-resolution buffer's own
 * bilinear upscale then smooths the noise away.
 *
 * A second knee runs inside the march. The bright buffer is shared with the
 * bloom, whose threshold is set so that a lit hillside does not glow; that is
 * still low enough to admit the sun's whole atmospheric halo, and dragging a
 * halo across the frame is a smear rather than a beam. The knee keeps the
 * disc and drops the halo, without a second bright pass to pay for.
 */
const RAYS_FRAG = `
  uniform sampler2D tBright;
  uniform vec2 uSunUv;
  uniform float uVisible;
  uniform float uDensity;
  uniform float uDecay;
  uniform float uWeight;
  uniform float uKnee;
  varying vec2 vUv;

  const int SAMPLES = 16;

  void main() {
    if (uVisible < 0.001) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    // March from this pixel toward the sun, in equal steps.
    vec2 delta = (vUv - uSunUv) * (uDensity / float(SAMPLES));
    // Interleaved gradient noise: one fract chain, no texture, and it is
    // stable per pixel so the shafts do not crawl between frames.
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec2 uv = vUv - delta * dither;
    vec3 sum = vec3(0.0);
    float illum = 1.0;
    for (int i = 0; i < SAMPLES; i++) {
      uv -= delta;
      // Off-buffer taps must contribute nothing. Clamped sampling would smear
      // the edge texel down the whole march instead, which reads as a
      // rectangular frame of light around the screen.
      vec2 fromCentre = abs(uv - 0.5);
      float inside = step(max(fromCentre.x, fromCentre.y), 0.5);
      vec3 tap = texture2D(tBright, uv).rgb;
      float l = dot(tap, vec3(0.2126, 0.7152, 0.0722));
      sum += tap * smoothstep(uKnee, uKnee + 0.30, l) * illum * inside;
      illum *= uDecay;
    }
    gl_FragColor = vec4(sum * uWeight * uVisible, 1.0);
  }
`;

/**
 * The one full-resolution pass. Bloom add and vignette are merged here rather
 * than being two passes, which is the whole reason this is hand-written.
 */
const COMPOSITE_FRAG = `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tRays;
  uniform float uStrength;
  uniform float uRays;
  uniform float uVignette;
  uniform float uSpeed;
  // 0 normal, 1 show the bright buffer, 2 show the shaft buffer. Debug only —
  // set from the console, never from the game.
  uniform float uDebug;
  varying vec2 vUv;
  void main() {
    vec2 d = vUv - 0.5;
    if (uDebug > 0.5) {
      vec3 dbg = uDebug < 1.5 ? texture2D(tBloom, vUv).rgb : texture2D(tRays, vUv).rgb;
      gl_FragColor = vec4(dbg, 1.0);
      #include <colorspace_fragment>
      return;
    }
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
    // Shafts are added, never mixed: light through a gap does not replace what
    // is behind it, it sits on top of it.
    c += texture2D(tRays, vUv).rgb * uRays;
    // Vignette costs two instructions here and would cost an entire
    // full-screen pass on its own. It tightens under boost, which is what
    // actually sells the tunnel.
    float v = 1.0 - dot(d, d) * (uVignette + uSpeed * 0.85);
    gl_FragColor = vec4(c * v, 1.0);
    // ── The output transform, and it is not optional ─────────────────────
    // The scene target holds RAW LINEAR values, and BOTH halves of the output
    // transform have to happen here.
    //
    // The comment that used to sit here said "every material writes tone-mapped
    // linear". That was false, and it hid the second half of this bug for as
    // long as the pass has run. Three forces toneMapping = NoToneMapping
    // whenever the render target is non-null and not XR, so the scene materials
    // are compiled WITHOUT the tone-mapping chunk: renderer.toneMapping and
    // toneMappingExposure never reach a single program that draws the world.
    // The colourspace half was found and fixed; the tone half was asserted to be
    // handled and was not.
    //
    // Measured on the shipped build, mean frame pixel over a 4.4x exposure sweep
    // (0.5 -> 2.2): tier 0, where this pass runs, moved 1.89/255 — noise. Tier 1,
    // where the game renders straight to the canvas and Three applies the curve
    // normally, moved 72.03/255. So the tone curve was inert on the shipping path
    // and live the moment the adaptive tier shed bloom, which also means the
    // frame visibly changed character at the tier boundary.
    //
    // <tonemapping_fragment> is injected by Three for a material drawn to the
    // CANVAS (null target), which is exactly what this composite is — so the
    // curve the renderer is set to is the curve applied, and it recompiles when
    // that enum changes because toneMapping is part of the program cache key.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createBloomPass(THREE, renderer, {
  threshold = 0.72,
  softness = 0.26,
  strength = 0.85,
  vignette = 0.45,
  // Light shafts. `rays` is the additive strength; 0 disables the pass
  // entirely (it is skipped, not multiplied by zero).
  rays = 0.62,
  rayDensity = 0.70,
  rayDecay = 0.95,
  rayWeight = 0.115,
  rayKnee = 0.42,
  // Half the canvas in each axis, so a quarter of the pixels per blur tap.
  downscale = 2,
  // Scene-target MSAA. 0 is today's plain single-sample target — the
  // shipping default on every platform. Never pass non-zero here from a
  // constructor call; raise it live via setSamples() from a panel request
  // only (see the file-header note above).
  samples = 0,
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

  // Cached inputs of the last setSize() call, so a live setDownscale(n) can
  // re-derive the blur/ray target dimensions without the caller re-supplying
  // width/height/ratio. `downscale` itself becomes mutable state here (it was
  // constructor-only before): the closed-over `downscale` param is shadowed
  // by this cache's own field the moment setSize/setDownscale run.
  let lastWidth = 1;
  let lastHeight = 1;
  let lastRatio = 1;
  let hasSizeBeenSet = false;
  let currentDownscale = downscale;

  // Probed ONCE, not assumed: RGBA16F multisample renderbuffers need
  // EXT_color_buffer_float even on a WebGL2 context, and this repo has
  // shipped a capability probe nobody checked before (the
  // hardwareConcurrency/bloom trap CLAUDE.md records). A device missing
  // either half of this reports every setSamples() request back as 0.
  const gl = renderer.getContext();
  const msaaSupported = !!(
    renderer.capabilities.isWebGL2 &&
    renderer.capabilities.maxSamples > 0 &&
    gl.getExtension('EXT_color_buffer_float')
  );

  // `sceneTarget` is `let`, not `const`: raising samples recreates it
  // (WebGLRenderTarget's multisample renderbuffer is allocated at
  // construction, not re-derivable by mutating `.samples` after the fact),
  // so every closure below that needs the CURRENT target reads this binding
  // rather than capturing the original object.
  let currentSamples = msaaSupported ? Math.max(0, Math.min(Math.floor(samples) || 0, renderer.capabilities.maxSamples)) : 0;
  let sceneTarget = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, samples: currentSamples });
  // The blur targets need no depth buffer at all; they are full-screen
  // triangle passes over a texture.
  const blurA = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
  const blurB = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
  // Shafts get their own half-res buffer: the bloom blur destroys the sharp
  // radial structure the march depends on, so the two cannot share one.
  const rayTarget = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
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

  const raysMaterial = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: RAYS_FRAG,
    uniforms: {
      tBright: { value: null },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uVisible: { value: 0 },
      uDensity: { value: rayDensity },
      uDecay: { value: rayDecay },
      uWeight: { value: rayWeight },
      uKnee: { value: rayKnee },
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
      tRays: { value: rayTarget.texture },
      uStrength: { value: strength },
      uRays: { value: rays },
      uVignette: { value: vignette },
      uSpeed: { value: 0 },
      uDebug: { value: 0 },
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
    lastWidth = width;
    lastHeight = height;
    lastRatio = ratio;
    hasSizeBeenSet = true;
    const w = Math.max(1, Math.floor(width * ratio));
    const h = Math.max(1, Math.floor(height * ratio));
    sceneTarget.setSize(w, h);
    const bw = Math.max(1, Math.floor(w / currentDownscale));
    const bh = Math.max(1, Math.floor(h / currentDownscale));
    blurA.setSize(bw, bh);
    blurB.setSize(bw, bh);
    rayTarget.setSize(bw, bh);
  }
  setSize(size.x, size.y, pixelRatio);

  /**
   * Recreate `sceneTarget` at a new sample count. A `WebGLRenderTarget`'s
   * multisample renderbuffer is allocated once, at construction, from its
   * `samples` option — there is no live setter that re-derives it, unlike
   * `downscale` above — so a sample-count change disposes the old target
   * and builds a new one, then re-runs `setSize` against the cached last
   * width/height/ratio so the new target lands at the SAME dimensions the
   * old one had, not 1x1. Every closure that reads `tScene` off the old
   * target's texture (brightMaterial, compositeMaterial) is repointed here;
   * `render()` and `getSizes()` close over the `sceneTarget` BINDING, not a
   * snapshot, so they pick the new object up with no further change.
   */
  function recreateSceneTarget(nextSamples) {
    sceneTarget.dispose();
    sceneTarget = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, samples: nextSamples });
    sceneTarget.texture.colorSpace = THREE.NoColorSpace;
    brightMaterial.uniforms.tScene.value = sceneTarget.texture;
    compositeMaterial.uniforms.tScene.value = sceneTarget.texture;
    if (hasSizeBeenSet) setSize(lastWidth, lastHeight, lastRatio);
  }

  // True while the ray buffer holds shafts that must be cleared once the sun
  // leaves the frame.
  let raysDirty = false;

  function drawWith(material, target) {
    quadMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  }

  // Draw calls and triangles for the SCENE pass alone, refreshed every frame.
  const frameStats = { calls: 0, triangles: 0 };

  return {
    get enabled() { return true; },
    // Getter, not a plain data property: `sceneTarget` (the closure
    // variable) is reassigned by recreateSceneTarget() whenever setSamples
    // changes the sample count, and a snapshot taken here at construction
    // time would go stale the moment that happens.
    get sceneTarget() { return sceneTarget; },
    frameStats,

    setSize,

    /**
     * Live sizes of every offscreen target, read from the targets
     * themselves — never recomputed from `downscale` and the canvas size.
     * `downscale` is reported alongside as the divisor actually applied by
     * the last `setSize()` call, not the constructor option in isolation.
     * `sceneSamples` is `sceneTarget.samples` itself — the EFFECTIVE sample
     * count the live render target actually holds, already clamped against
     * `renderer.capabilities.maxSamples` and gated on `msaaSupported` by
     * `setSamples()` below, never recomputed from what was requested.
     */
    getSizes() {
      return {
        sceneTarget: { width: sceneTarget.width, height: sceneTarget.height },
        blurA: { width: blurA.width, height: blurA.height },
        blurB: { width: blurB.width, height: blurB.height },
        rayTarget: { width: rayTarget.width, height: rayTarget.height },
        downscale: currentDownscale,
        sceneSamples: sceneTarget.samples,
      };
    },

    /**
     * Raise or lower the scene pass's hardware MSAA sample count live (see
     * the file-header note). 0 disables it — the shipping default, and
     * always the effective result on a device that lacks `EXT_color_buffer_
     * float` or WebGL2, no matter what is requested; `getSizes().
     * sceneSamples` / `getSamples()` report the true effective value so a
     * caller can see that clamp happen rather than assume the request took.
     */
    setSamples(n) {
      const requested = Math.max(0, Math.floor(n) || 0);
      const next = msaaSupported ? Math.min(requested, renderer.capabilities.maxSamples) : 0;
      if (next === currentSamples) return;
      currentSamples = next;
      recreateSceneTarget(next);
    },
    getSamples() { return sceneTarget.samples; },

    /**
     * Change the post-resolution divisor live. `downscale` used to be
     * constructor-only because `setSize(w,h,ratio)` stored nothing — there
     * was no way to re-derive the half-res target dimensions from a new
     * divisor alone. Now it re-runs `setSize` against the cached last
     * width/height/ratio, exactly as if the caller had called `setSize`
     * again with the new divisor already in effect.
     *
     * blurA, blurB and rayTarget keep sharing one divisor here (unchanged
     * from before): CONTRACT does not ask for them to diverge, and they are
     * numerically identical today only as a consequence of that shared
     * derivation, not because the shader maths requires it.
     */
    setDownscale(n) {
      // Guard against setDownscale being called before the first setSize
      if (!hasSizeBeenSet) return;

      const next = Math.max(1, Math.floor(n) || 1);
      if (next === currentDownscale) return;
      currentDownscale = next;
      setSize(lastWidth, lastHeight, lastRatio);
    },

    setStrength(value) { compositeMaterial.uniforms.uStrength.value = value; },
    getStrength() { return compositeMaterial.uniforms.uStrength.value; },
    setThreshold(value) { brightMaterial.uniforms.uThreshold.value = value; },
    setVignette(value) { compositeMaterial.uniforms.uVignette.value = value; },
    setRays(value) { compositeMaterial.uniforms.uRays.value = Math.max(0, value || 0); },
    /**
     * Live read of the composite's own shaft-strength uniform (P2.3b — the
     * dev panel's shafts toggle needs an EFFECTIVE readback, never a mirror
     * of what it last requested, per CONTRACT §0 "effective").
     */
    getRays() { return compositeMaterial.uniforms.uRays.value; },
    /**
     * Where the sun is on screen, in UV, and how much of the shaft effect to
     * apply. The caller owns this because only it knows where the sun is; the
     * pass has no scene knowledge at all.
     *
     * `visible` must fall to 0 as the sun leaves the frame. A hard cut-off
     * pops an entire screen of light off in one frame; the caller ramps it.
     */
    setSun(u, v, visible) {
      raysMaterial.uniforms.uSunUv.value.set(u, v);
      raysMaterial.uniforms.uVisible.value = Math.max(0, Math.min(1, visible || 0));
    },
    /** Debug: 0 normal, 1 the bright buffer, 2 the shaft buffer. */
    setDebugView(mode) { compositeMaterial.uniforms.uDebug.value = mode || 0; },
    /** 0..1 boost amount: drives the radial smear, bloom lift and vignette. */
    setSpeed(value) {
      compositeMaterial.uniforms.uSpeed.value = Math.max(0, Math.min(1, value || 0));
    },

    /**
     * Render the scene through the pass. Replaces `renderer.render(scene, camera)`.
     *
     * `onRenderPass`, if given, is called with a boolean (true only for the
     * scene pass) immediately after EVERY real renderer.render() call this
     * method makes — while renderer.info.render still holds that call's own
     * numbers, before the next render() resets them. It exists so a caller
     * can own a whole-frame accumulator without this pass owning it: see
     * index.html's `frameRenderTotals` / `tallyRenderPass`. Purely an
     * observability hook — it never touches rendering state itself.
     */
    render(scene, camera, onRenderPass) {
      const tally = typeof onRenderPass === 'function' ? onRenderPass : null;
      // The world, into an offscreen buffer at full resolution.
      renderer.setRenderTarget(sceneTarget);
      renderer.clear();
      renderer.render(scene, camera);
      // renderer.info.render RESETS on every render() call, and this pass
      // makes four of them. Read after the composite and the whole world
      // reports as one draw call and one triangle — which is exactly what the
      // capture harness printed the first time bloom was switched on, turning
      // the draw-call budget check into a rubber stamp. Snapshot it here,
      // between the scene and the post passes, and that is the real number.
      frameStats.calls = renderer.info.render.calls;
      frameStats.triangles = renderer.info.render.triangles;
      if (tally) tally(true);

      // Bright pass and downsample, half res. This buffer is the input to
      // BOTH the bloom blur and the light shafts.
      drawWith(brightMaterial, blurA);
      if (tally) tally(false);

      // Light shafts, from the un-blurred bright buffer. Skipped outright
      // when the sun is off screen, which is most of the time — the cost is
      // paid only in the frames that show something for it.
      //
      // One extra pass runs on the frame the sun LEAVES, to blank the buffer;
      // the shader early-outs to black when uVisible is 0, so it clears
      // itself. A renderer.clear() would have been cheaper and wrong: the
      // clear colour belongs to the scene, and setting it here to black would
      // have leaked out and painted the sky's clear black on the next frame.
      const raysOn = compositeMaterial.uniforms.uRays.value > 0.001
        && raysMaterial.uniforms.uVisible.value > 0.001;
      if (raysOn || raysDirty) {
        raysMaterial.uniforms.tBright.value = blurA.texture;
        drawWith(raysMaterial, rayTarget);
        if (tally) tally(false);
        if (raysOn) {
          // The dither that fixed the ghosting leaves its own signature: a
          // fine diagonal weave, chunky because the buffer is half resolution
          // and every texel covers four screen pixels. One separable blur
          // erases it, and softening shafts is the right direction anyway —
          // light through dust has no hard edge. Borrows blurB, which the
          // bloom has not written yet.
          blurMaterial.uniforms.tSource.value = rayTarget.texture;
          blurMaterial.uniforms.uDirection.value.set(1 / rayTarget.width, 0);
          drawWith(blurMaterial, blurB);
          if (tally) tally(false);
          blurMaterial.uniforms.tSource.value = blurB.texture;
          blurMaterial.uniforms.uDirection.value.set(0, 1 / rayTarget.height);
          drawWith(blurMaterial, rayTarget);
          if (tally) tally(false);
        }
        raysDirty = raysOn;
      }

      // Separable blur, half res, two passes.
      blurMaterial.uniforms.tSource.value = blurA.texture;
      blurMaterial.uniforms.uDirection.value.set(1 / blurA.width, 0);
      drawWith(blurMaterial, blurB);
      if (tally) tally(false);
      blurMaterial.uniforms.tSource.value = blurB.texture;
      blurMaterial.uniforms.uDirection.value.set(0, 1 / blurA.height);
      drawWith(blurMaterial, blurA);
      if (tally) tally(false);

      // Composite plus vignette, the one full-resolution pass.
      compositeMaterial.uniforms.tBloom.value = blurA.texture;
      drawWith(compositeMaterial, null);
      if (tally) tally(false);
    },

    dispose() {
      sceneTarget.dispose();
      blurA.dispose();
      blurB.dispose();
      rayTarget.dispose();
      brightMaterial.dispose();
      raysMaterial.dispose();
      blurMaterial.dispose();
      compositeMaterial.dispose();
      triangle.dispose();
    },
  };
}
