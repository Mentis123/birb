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
  const fragmentShader = `
    uniform vec3 uTopColor;
    uniform vec3 uMidColor;
    uniform vec3 uHorizonColor;
    uniform vec3 uBottomColor;
    uniform float uOffset;
    uniform float uRadius;
    varying vec3 vWorldPosition;

    void main() {
      float h = normalize(vWorldPosition).y;
      h = clamp(h + uOffset, -1.0, 1.0);

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

      // Subtle star-like noise for top hemisphere
      float starNoise = fract(sin(dot(vWorldPosition.xz * 0.1, vec2(12.9898, 78.233))) * 43758.5453);
      float starMask = smoothstep(0.55, 0.95, h) * step(0.997, starNoise) * 0.35;
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
      uOffset: { value: offset },
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
    },

    /** Expose mid color so the scene can tint fog to match the sky. */
    getMidColor() {
      return material.uniforms.uMidColor.value;
    },

    /** Keep dome centered on camera */
    followCamera(cameraPosition) {
      mesh.position.copy(cameraPosition);
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    }
  };
}
