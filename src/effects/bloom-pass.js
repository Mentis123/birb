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
    // The scene target holds LINEAR values: rendering into a render target
    // forces linearToOutputTexel to identity, so every material writes
    // tone-mapped linear and no material encodes. Writing that straight to an
    // sRGB canvas is a gamma the display then applies twice — measured on the
    // shipped build at mean 90 against 146 for the same frame with the pass
    // switched off. The whole game was rendering dark whenever bloom ran, and
    // it read as a moody grade rather than as a bug.
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
    const w = Math.max(1, Math.floor(width * ratio));
    const h = Math.max(1, Math.floor(height * ratio));
    sceneTarget.setSize(w, h);
    const bw = Math.max(1, Math.floor(w / downscale));
    const bh = Math.max(1, Math.floor(h / downscale));
    blurA.setSize(bw, bh);
    blurB.setSize(bw, bh);
    rayTarget.setSize(bw, bh);
  }
  setSize(size.x, size.y, pixelRatio);

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
    sceneTarget,
    frameStats,

    setSize,

    setStrength(value) { compositeMaterial.uniforms.uStrength.value = value; },
    setThreshold(value) { brightMaterial.uniforms.uThreshold.value = value; },
    setVignette(value) { compositeMaterial.uniforms.uVignette.value = value; },
    setRays(value) { compositeMaterial.uniforms.uRays.value = Math.max(0, value || 0); },
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
     */
    render(scene, camera) {
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

      // Bright pass and downsample, half res. This buffer is the input to
      // BOTH the bloom blur and the light shafts.
      drawWith(brightMaterial, blurA);

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
          blurMaterial.uniforms.tSource.value = blurB.texture;
          blurMaterial.uniforms.uDirection.value.set(0, 1 / rayTarget.height);
          drawWith(blurMaterial, rayTarget);
        }
        raysDirty = raysOn;
      }

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
      rayTarget.dispose();
      brightMaterial.dispose();
      raysMaterial.dispose();
      blurMaterial.dispose();
      compositeMaterial.dispose();
      triangle.dispose();
    },
  };
}
