import * as THREE from "https://esm.sh/three@0.183.2";

/**
 * Creates a sky dome with a painterly 3-stop vertical gradient shader.
 * Gradient: horizon (warm cream) -> mid (soft blue) -> zenith (deep indigo).
 * Renders as a large inverted sphere that always surrounds the camera.
 *
 * Single low-poly mesh, no per-frame allocations.
 */
export function createSkyDome(options = {}) {
  const {
    // Painterly golden-hour palette defaults. Horizon cream -> soft blue -> deep indigo.
    topColor = new THREE.Color(0x1b2a55),     // deep indigo zenith
    midColor = new THREE.Color(0x6d9ed0),     // soft painterly blue
    horizonColor = new THREE.Color(0xf5d8a6), // warm cream horizon band
    bottomColor = new THREE.Color(0x2a1a28),  // muted plum below horizon
    offset = 0.0,    // shifts gradient up/down (-1 to 1)
    radius = 450,
  } = options;

  const vertexShader = `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  // 3-stop gradient: bottom -> horizon (warm band) -> mid -> zenith.
  // The horizon band lives around h ~= 0 with a narrow falloff, giving a
  // painterly golden-hour glow without full sunset orange.
  // The view direction is measured from the dome center (uCenter == camera),
  // so the gradient and sun stay anchored as the bird flies the sphere.
  const fragmentShader = `
    uniform vec3 uTopColor;
    uniform vec3 uMidColor;
    uniform vec3 uHorizonColor;
    uniform vec3 uBottomColor;
    uniform vec3 uSunDirection;
    // An authored equirectangular sky, mixed OVER the gradient rather than
    // replacing it. uSkyMix is the whole point: the stylised four-stop
    // gradient and a photographic panorama are two different art directions,
    // and which one this game wants is an eye's call, not a number this file
    // can settle. 0 is exactly today's sky, so the flag is safe by default.
    uniform sampler2D uSkyTexture;
    uniform float uSkyMix;
    uniform float uSkyRotation;
    uniform vec3 uSunColor;
    uniform vec3 uCenter;
    uniform vec3 uSkyUp;
    uniform float uOffset;
    uniform float uTime;
    uniform float uRadius;
    varying vec3 vWorldPosition;

    void main() {
      vec3 dir = normalize(vWorldPosition - uCenter);
      float h = clamp(dot(dir, uSkyUp) + uOffset, -1.0, 1.0);

      vec3 color;
      if (h < 0.0) {
        // Below horizon: blend bottom -> horizon (warm band bleeds below)
        color = mix(uBottomColor, uHorizonColor, pow(h + 1.0, 2.2));
      } else if (h < 0.35) {
        // Low sky: horizon cream -> mid blue (painterly lift)
        float t = smoothstep(0.0, 0.35, h);
        color = mix(uHorizonColor, uMidColor, t);
      } else {
        // Upper sky: mid blue -> zenith indigo
        float t = smoothstep(0.35, 1.0, h);
        color = mix(uMidColor, uTopColor, t);
      }

      // The authored sky replaces the gradient's COLOUR only. Everything below
      // -- horizon band, sun disc, halo, stars -- still runs on top, so the
      // sky's sun and the scene's key light cannot drift apart just because a
      // panorama was dropped in.
      if (uSkyMix > 0.0) {
        // three's own equirect convention, so a map authored for
        // scene.environment and one authored for this dome are the same file.
        float su = atan(dir.z, dir.x) * 0.15915494 + 0.5 + uSkyRotation;
        float sv = asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5;
        vec3 texSky = texture2D(uSkyTexture, vec2(fract(su), clamp(sv, 0.0, 1.0))).rgb;
        color = mix(color, texSky, uSkyMix);
      }

      // ── Self-limiting glows ──────────────────────────────────────────
      // How much room the sky still has before it clips. Both the horizon
      // band and the sun's broad halo are ADDITIVE, and additive light onto a
      // sky that is already near white does not glow — it clips, and a wide
      // soft term clips over a wide soft area. The mountain's pale cream
      // horizon (0xf3e9ce is 0.89 in linear) plus a 0.18 band plus the sun's
      // outer lobe turned the upper third of that world into a flat white
      // slab. Scaling by the remaining headroom keeps the forest's deep
      // sunset glow at full strength and lets the pale skies keep their
      // gradient.
      float skyRoom = 1.0 - clamp(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);

      // Subtle warm horizon glow peak (non-photoreal golden-hour bloom).
      //
      // Faded out as an authored sky takes over, because a photographed or
      // painted panorama ALREADY contains its own horizon glow -- adding this
      // on top applies it twice, which measured as a 9/255 mean error against
      // a placeholder generated from this very function. The stylised gradient
      // needs the band; a real sky brought its own.
      float horizonBand = exp(-pow((h - 0.02) * 8.0, 2.0)) * 0.22 * (1.0 - uSkyMix);
      color += uHorizonColor * horizonBand * skyRoom;

      // Sun: soft disc + two-lobe atmospheric halo. Pure shader math on the
      // existing dome — a golden-hour anchor with zero extra draw calls.
      float sd = clamp(dot(dir, uSunDirection), 0.0, 1.0);
      // ~2.6 degrees across. Five times the real sun, which is the right lie:
      // a physically-sized disc is 20 pixels on a phone and reads as a stuck
      // dead pixel rather than as the light source the whole scene is lit by.
      float disc = smoothstep(0.99880, 0.99962, sd);
      // The tight lobe is the sun's own corona and stays; the broad one is
      // atmospheric scatter and is what smears across a pale sky, so it is
      // both narrower than it was and pays the headroom tax.
      // The tight lobe is the DISC and it always draws: it is the anchor that
      // keeps the sky's sun and the scene's key light in the same place, which
      // matters more once an authored panorama has its own bright quadrant
      // somewhere else. The broad lobe is atmospheric haze, which a real sky
      // already has, so it fades out with the gradient.
      float halo = pow(sd, 160.0) * 0.55 + pow(sd, 30.0) * 0.20 * skyRoom * (1.0 - uSkyMix);
      // The disc is deliberately HDR — over 1.0 in scene-linear, before tone
      // mapping. It has to be: the bloom pass thresholds the TONE-MAPPED
      // frame, and Neutral tone mapping rolls anything near 1.0 back under
      // the knee. A disc at 1.15 was the brightest thing in the world and
      // still bloomed by nothing. It is also the only source the light
      // shafts have, so its brightness sets their whole strength.
      color += uSunColor * (disc * 4.5 + halo);

      // Star-like noise for the top hemisphere, with a slow gentle twinkle.
      float starNoise = fract(sin(dot(vWorldPosition.xz * 0.1, vec2(12.9898, 78.233))) * 43758.5453);
      float twinkle = 0.7 + 0.3 * sin(uTime * 2.1 + starNoise * 41.7);
      float starMask = smoothstep(0.55, 0.95, h) * step(0.997, starNoise) * 0.35 * twinkle;
      color += vec3(starMask);

      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  const geometry = new THREE.SphereGeometry(radius, 32, 24);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTopColor: { value: topColor },
      uMidColor: { value: midColor },
      uHorizonColor: { value: horizonColor },
      uBottomColor: { value: bottomColor },
      // Default matches the scene keyLight at (7.5, 8.2, 5.2); env switches
      // re-aim it via setSunDirection so sky sun == lighting sun.
      uSunDirection: { value: new THREE.Vector3(7.5, 8.2, 5.2).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.92, 0.74) },
      uCenter: { value: new THREE.Vector3() },
      uSkyUp: { value: new THREE.Vector3(0, 1, 0) },
      uOffset: { value: offset },
      uTime: { value: 0 },
      uSkyTexture: { value: null },
      uSkyMix: { value: 0 },
      uSkyRotation: { value: 0 },
      uRadius: { value: radius },
    },
    side: THREE.BackSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1000; // Render behind everything
  mesh.frustumCulled = false;

  // Pre-allocated scratch colors for setColors() — avoid churn on env switch.
  const _scratchTop = new THREE.Color();
  const _scratchBottom = new THREE.Color();
  const _scratchMid = new THREE.Color();
  const _scratchHorizon = new THREE.Color();
  const _white = new THREE.Color(1, 1, 1);

  /**
   * Bind (or clear) the dome's authored panorama. Named closure rather than a
   * method on the returned object so `dispose()` can reuse it without going
   * through `this` -- `const { dispose } = createSkyDome()` is a perfectly
   * ordinary thing for a caller to write, and a `this.setSkyTexture(null)` in
   * dispose would throw on it.
   */
  function setSkyTexture(texture, { mix = 1, rotation = 0 } = {}) {
    // Dispose the OUTGOING panorama before rebinding. Three frees a
    // texture's GPU storage only on .dispose(), never on unbind, so without
    // this every environment switch leaked the previous biome's 1024x512
    // sky -- 2.67 MB decoded with mips -- and the "one biome resident at a
    // time" model the asset budget rests on was quietly false. Found by an
    // adversarial verifier auditing that model, not by a leak report; the
    // regression oracle is `node tools/birb-textures.mjs`, which hooks the
    // driver's own createTexture/deleteTexture and measures +4 live textures
    // per four-biome lap with these three lines removed.
    const previous = material.uniforms.uSkyTexture.value;
    if (previous && previous !== texture && typeof previous.dispose === 'function') {
      previous.dispose();
    }
    material.uniforms.uSkyTexture.value = texture || null;
    material.uniforms.uSkyMix.value = texture ? Math.max(0, Math.min(1, mix)) : 0;
    material.uniforms.uSkyRotation.value = rotation;
    material.needsUpdate = true;
  }

  return {
    mesh,
    /**
     * Update sky colors for a new environment.
     * Accepts { top, bottom, mid?, horizon?, glow? } — mid and horizon
     * are derived from top/bottom if not provided, biased warm.
     */
    setColors(skyConfig) {
      if (!skyConfig) return;
      _scratchTop.set(skyConfig.top);
      _scratchBottom.set(skyConfig.bottom);

      if (skyConfig.mid !== undefined) {
        _scratchMid.set(skyConfig.mid);
      } else {
        // Mid sits ~40% between top and bottom (lighter/bluer than mean)
        _scratchMid.copy(_scratchTop).lerp(_scratchBottom, 0.4);
      }

      if (skyConfig.horizon !== undefined) {
        _scratchHorizon.set(skyConfig.horizon);
      } else {
        // Horizon: warm cream tint blended with the bottom for env harmony.
        // Base cream #f5d8a6, blended 55% toward env's bottom to stay cohesive.
        _scratchHorizon.setRGB(0.96, 0.85, 0.65).lerp(_scratchBottom, 0.35);
      }

      material.uniforms.uTopColor.value.copy(_scratchTop);
      material.uniforms.uMidColor.value.copy(_scratchMid);
      material.uniforms.uHorizonColor.value.copy(_scratchHorizon);
      material.uniforms.uBottomColor.value.copy(_scratchBottom);

      // Use glow to shift gradient offset slightly
      if (skyConfig.glow !== undefined) {
        material.uniforms.uOffset.value = (skyConfig.glow - 0.3) * 0.15;
      }

      // Sun tint follows the env horizon, lifted toward white so the disc
      // reads hot against the warm band it sits in.
      material.uniforms.uSunColor.value.copy(_scratchHorizon).lerp(_white, 0.45);
    },

    /**
     * Aim the shader sun. Pass the keyLight position/direction so the visible
     * sun and the scene's directional lighting agree.
     */
    setSunDirection(direction) {
      if (!direction) return;
      material.uniforms.uSunDirection.value.copy(direction).normalize();
    },

    /**
     * Point the dome at an authored equirectangular sky.
     *
     * `mix` 0 is exactly the shipped gradient, so this is inert until asked
     * for. `rotation` is in TURNS and exists because an authored panorama has
     * its bright quadrant wherever the artist put it, while this game's sun is
     * wherever `keyLight` is -- and a sky whose glow disagrees with the light
     * on the ground reads as a bug even when both halves are lovely.
     */
    setSkyTexture,

    /** Read back what is actually in force, for the harness and the panel. */
    skyTextureState() {
      return {
        present: !!material.uniforms.uSkyTexture.value,
        mix: material.uniforms.uSkyMix.value,
        rotation: material.uniforms.uSkyRotation.value,
      };
    },

    /** Expose mid color so the scene can tint fog to match the sky. */
    getMidColor() {
      return material.uniforms.uMidColor.value;
    },

    /** Keep dome centered on camera; optional elapsed time drives star twinkle. */
    followCamera(cameraPosition, elapsedTime) {
      mesh.position.copy(cameraPosition);
      material.uniforms.uCenter.value.copy(cameraPosition);
      // Radial up keeps the blue sky above the local horizon all around the
      // planet, including nests on the equator and southern hemisphere.
      material.uniforms.uSkyUp.value.copy(cameraPosition).normalize();
      if (elapsedTime !== undefined) {
        material.uniforms.uTime.value = elapsedTime;
      }
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      // The bound panorama too. `material.dispose()` frees the PROGRAM, not the
      // textures its uniforms point at -- three has no ownership relationship
      // between a ShaderMaterial and a sampler uniform's value, so a uniform is
      // the one place a texture can sit where disposing everything around it
      // still leaks it. Routed through setSkyTexture(null) rather than repeating
      // the dispose here, so there is exactly ONE place in this file that knows
      // how to let a sky go and it cannot drift from the rebind path.
      //
      // Latent today: nothing calls this, because the dome deliberately outlives
      // every environment switch (it is added straight to `scene`, not to the
      // world `spherical-world.js` tears down) and the page is gone by the time
      // it would matter. It is here so that whoever DOES start disposing the dome
      // -- a teardown for the mode-switch path, a test that builds domes in a
      // loop -- does not have to rediscover the leak that cost this file a pass.
      setSkyTexture(null);
    }
  };
}
