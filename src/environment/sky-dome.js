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
    uniform vec3 uSunColor;
    uniform vec3 uCenter;
    uniform float uOffset;
    uniform float uTime;
    uniform float uRadius;
    varying vec3 vWorldPosition;

    void main() {
      vec3 dir = normalize(vWorldPosition - uCenter);
      float h = clamp(dir.y + uOffset, -1.0, 1.0);

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

      // Subtle warm horizon glow peak (non-photoreal golden-hour bloom).
      float horizonBand = exp(-pow((h - 0.02) * 8.0, 2.0)) * 0.18;
      color += uHorizonColor * horizonBand;

      // Sun: soft disc + two-lobe atmospheric halo. Pure shader math on the
      // existing dome — a golden-hour anchor with zero extra draw calls.
      float sd = clamp(dot(dir, uSunDirection), 0.0, 1.0);
      float disc = smoothstep(0.99955, 0.99988, sd);
      float halo = pow(sd, 160.0) * 0.45 + pow(sd, 18.0) * 0.16;
      color += uSunColor * (disc * 1.15 + halo);

      // Star-like noise for the top hemisphere, with a slow gentle twinkle.
      float starNoise = fract(sin(dot(vWorldPosition.xz * 0.1, vec2(12.9898, 78.233))) * 43758.5453);
      float twinkle = 0.7 + 0.3 * sin(uTime * 2.1 + starNoise * 41.7);
      float starMask = smoothstep(0.55, 0.95, h) * step(0.997, starNoise) * 0.35 * twinkle;
      color += vec3(starMask);

      gl_FragColor = vec4(color, 1.0);
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
      uOffset: { value: offset },
      uTime: { value: 0 },
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

    /** Expose mid color so the scene can tint fog to match the sky. */
    getMidColor() {
      return material.uniforms.uMidColor.value;
    },

    /** Keep dome centered on camera; optional elapsed time drives star twinkle. */
    followCamera(cameraPosition, elapsedTime) {
      mesh.position.copy(cameraPosition);
      material.uniforms.uCenter.value.copy(cameraPosition);
      if (elapsedTime !== undefined) {
        material.uniforms.uTime.value = elapsedTime;
      }
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    }
  };
}
