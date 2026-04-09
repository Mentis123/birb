import * as THREE from "https://esm.sh/three@0.183.2";

/**
 * Creates a sky dome with a smooth gradient shader.
 * Renders as a large inverted sphere that always surrounds the camera.
 */
export function createSkyDome(options = {}) {
  const {
    topColor = new THREE.Color(0x4d80c0),
    bottomColor = new THREE.Color(0x071323),
    midColor = null, // optional mid-gradient color
    offset = 0.0,    // shifts gradient up/down (-1 to 1)
    radius = 450,
  } = options;

  // Use midColor if provided, otherwise blend top and bottom
  const mid = midColor || new THREE.Color().copy(topColor).lerp(bottomColor, 0.55);

  const vertexShader = `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    uniform vec3 uTopColor;
    uniform vec3 uMidColor;
    uniform vec3 uBottomColor;
    uniform float uOffset;
    uniform float uRadius;
    varying vec3 vWorldPosition;

    void main() {
      float h = normalize(vWorldPosition).y;
      h = clamp(h + uOffset, -1.0, 1.0);

      // Two-stop gradient: bottom->mid->top
      vec3 color;
      if (h < 0.0) {
        color = mix(uBottomColor, uMidColor, h + 1.0);
      } else {
        color = mix(uMidColor, uTopColor, h);
      }

      // Subtle star-like noise for top hemisphere
      float starNoise = fract(sin(dot(vWorldPosition.xz * 0.1, vec2(12.9898, 78.233))) * 43758.5453);
      float starMask = smoothstep(0.35, 0.8, h) * step(0.997, starNoise) * 0.4;
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
      uMidColor: { value: mid },
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

  return {
    mesh,
    /**
     * Update sky colors for a new environment
     * @param {object} skyConfig - { top: hexColor, bottom: hexColor, glow: number }
     */
    setColors(skyConfig) {
      if (!skyConfig) return;
      const top = new THREE.Color(skyConfig.top);
      const bottom = new THREE.Color(skyConfig.bottom);
      const mid = new THREE.Color().copy(top).lerp(bottom, 0.55);

      material.uniforms.uTopColor.value.copy(top);
      material.uniforms.uMidColor.value.copy(mid);
      material.uniforms.uBottomColor.value.copy(bottom);

      // Use glow to shift gradient offset slightly
      if (skyConfig.glow !== undefined) {
        material.uniforms.uOffset.value = (skyConfig.glow - 0.3) * 0.15;
      }
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
