/**
 * Weather — snow, pollen, dust, drizzle.
 *
 * Four worlds that have never had any air in them. Nothing sells "you are
 * somewhere" faster than something drifting between the camera and the
 * scenery, and nothing is cheaper: this is one Points draw call whose entire
 * motion lives in the vertex shader, so the CPU cost per frame is four
 * uniform writes regardless of how many flakes are on screen.
 *
 * ── The box follows the camera; the particles do not ────────────────────
 *
 * The naive build parents the particles to the camera, and then they travel
 * with it — snow that hangs in front of your face at any speed, which reads
 * as dirt on the lens rather than as weather. The fix is to keep every
 * particle's position in WORLD space and wrap it into a box centred on the
 * camera:
 *
 *     wrapped = mod(world - camera + half, box) - half + camera
 *
 * A flake you fly past leaves the box out the back and reappears out the
 * front as a different flake. Density stays constant, the count stays fixed,
 * and the motion is genuinely the world's rather than the viewer's.
 *
 * The box is oriented by the player's own up axis rather than by world Y,
 * because this is a planet: "down" is a different direction on the other side
 * of it, and snow that falls toward world-negative-Y is snow falling sideways
 * for three quarters of the map.
 *
 * ── No texture ──────────────────────────────────────────────────────────
 *
 * Round particles come from gl_PointCoord and a smoothstep, per the repo's
 * zero-asset rule. A point sprite texture would be a download, a decode and
 * a megabyte of VRAM for a circle.
 */

/**
 * Per-biome air. Every field is deliberate:
 *  - fall/drift/sway: what the medium does. Snow settles, pollen hangs, dust
 *    blows sideways, rain falls hard and straight.
 *  - size/stretch: stretch elongates a particle along its fall, which is what
 *    makes rain read as rain rather than as white dots.
 *  - box: how large a volume is kept populated around the camera. Bigger
 *    boxes need more particles for the same density.
 */
export const WEATHER_PROFILES = {
  forest: {
    // Pollen and midges in warm air: barely falls, wanders, catches the light.
    count: 820, color: [1.0, 0.94, 0.66], size: 2.6, stretch: 0,
    fall: 1.1, drift: 1.5, sway: 2.4, swayRate: 0.55,
    box: [70, 50, 70], opacity: 0.55, glow: 1.0,
  },
  canyons: {
    // Dust on a hot wind: mostly horizontal, coarse, ochre.
    count: 1000, color: [0.86, 0.68, 0.44], size: 2.2, stretch: 0.35,
    fall: 3.2, drift: 9.0, sway: 1.2, swayRate: 0.9,
    box: [80, 55, 80], opacity: 0.4, glow: 0.6,
  },
  mountain: {
    // Snow: slow, heavy, wandering, and the one that has to be unmistakable.
    count: 1900, color: [0.96, 0.98, 1.0], size: 3.4, stretch: 0.15,
    fall: 5.5, drift: 2.6, sway: 3.0, swayRate: 0.7,
    box: [64, 46, 64], opacity: 0.8, glow: 0.9,
  },
  city: {
    // Drizzle: fast, straight, stretched into streaks, nearly colourless.
    count: 1500, color: [0.72, 0.82, 0.92], size: 1.9, stretch: 1.0,
    fall: 26.0, drift: 3.0, sway: 0.4, swayRate: 1.4,
    box: [60, 44, 60], opacity: 0.45, glow: 0.5,
  },
};

const VERT = `
  // Per-particle constants, all baked at build time: seed.x/y/z spread the
  // particle through the box, seed.w gives it a personal phase so the whole
  // field does not sway as one sheet.
  attribute vec4 aSeed;

  uniform vec3 uCamera;
  uniform vec3 uUp;
  uniform vec3 uSide;
  uniform vec3 uFwd;
  uniform vec3 uBox;
  uniform float uTime;
  uniform float uFall;
  uniform float uDrift;
  uniform float uSway;
  uniform float uSwayRate;
  uniform float uSize;
  uniform float uPixelRatio;

  varying float vFade;

  void main() {
    // Position in the box's own frame: x across, y along the local up, z
    // forward. The frame turns with the player because down is radial on a
    // planet, not world-negative-Y.
    vec3 p = aSeed.xyz * uBox;
    float phase = aSeed.w * 6.2831853;

    p.y -= uTime * uFall;
    p.x += uTime * uDrift + sin(uTime * uSwayRate + phase) * uSway;
    p.z += sin(uTime * uSwayRate * 0.73 + phase * 1.7) * uSway;

    // The camera in the same frame, so the wrap is around the viewer.
    vec3 camLocal = vec3(dot(uCamera, uSide), dot(uCamera, uUp), dot(uCamera, uFwd));
    // Deliberately not called "half" -- that is a reserved word in GLSL ES
    // 1.00, so the shader fails to compile and Three draws nothing for the
    // material. The weather is then simply absent, with no visible error.
    // (And no backticks in here: this whole shader is a JS template literal,
    // so a backtick in a comment ends the string and takes the module out
    // with it.)
    vec3 halfBox = uBox * 0.5;
    // mod() of a negative operand is well defined in GLSL (it returns a
    // positive remainder), which is what makes this work for particles that
    // have fallen past the bottom of the box.
    vec3 wrapped = mod(p - camLocal + halfBox, uBox) - halfBox + camLocal;

    vec3 world = uSide * wrapped.x + uUp * wrapped.y + uFwd * wrapped.z;
    vec4 mv = viewMatrix * vec4(world, 1.0);

    // Fade in with distance. A flake one unit from the lens is a screen-wide
    // blob, and it is always the one thing a viewer notices.
    float dist = -mv.z;
    vFade = smoothstep(1.5, 7.0, dist) * (1.0 - smoothstep(uBox.x * 0.36, uBox.x * 0.5, dist));

    gl_Position = projectionMatrix * mv;
    // Clamped, and the clamp is the point. Unclamped perspective sizing makes
    // the nearest flake a hundred pixels across, and a single hundred-pixel
    // blob is the only thing anyone sees in the frame.
    float px = uSize * uPixelRatio;
    gl_PointSize = clamp(px * (34.0 / max(dist, 1.0)), 1.0, px * 2.2);
  }
`;

const FRAG = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uStretch;
  uniform float uGlow;
  varying float vFade;

  void main() {
    // A round particle from gl_PointCoord, stretched along its fall so that
    // rain reads as a streak and snow does not.
    vec2 c = gl_PointCoord - 0.5;
    c.y /= (1.0 + uStretch * 3.0);
    float d = length(c) * 2.0;
    // The falloff starts early on purpose. A flake is only three or four
    // device pixels across at the phone's DPR cap, and a disc that stays
    // solid to 0.55 of its radius reads as a hard little square at that size.
    float alpha = (1.0 - smoothstep(0.18, 1.0, d)) * uOpacity * vFade;
    if (alpha < 0.004) discard;
    // The core is brighter than the edge, so a flake has a centre rather than
    // being a flat disc.
    vec3 color = uColor * (1.0 + uGlow * (1.0 - d) * 0.6);
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * @param profile one of WEATHER_PROFILES
 * @returns { points, update(seconds, cameraPos, localUp), setDensity(0..1), dispose() }
 */
export function createWeather(THREE, { profile, count, pixelRatio = 1 } = {}) {
  const p = profile || WEATHER_PROFILES.forest;
  const total = Math.max(1, Math.floor(count ?? p.count));

  const geometry = new THREE.BufferGeometry();
  // position is required by Three's Points, but every coordinate this shader
  // uses comes from aSeed; keeping position at the origin means the bounding
  // sphere is a point, so the whole field is one frustum test that always
  // passes rather than a box that pops at the screen edge.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(total * 3), 3));
  const seeds = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) {
    seeds[i * 4] = Math.random();
    seeds[i * 4 + 1] = Math.random();
    seeds[i * 4 + 2] = Math.random();
    seeds[i * 4 + 3] = Math.random();
  }
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCamera: { value: new THREE.Vector3() },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uSide: { value: new THREE.Vector3(1, 0, 0) },
      uFwd: { value: new THREE.Vector3(0, 0, 1) },
      uBox: { value: new THREE.Vector3(...p.box) },
      uTime: { value: 0 },
      uFall: { value: p.fall },
      uDrift: { value: p.drift },
      uSway: { value: p.sway },
      uSwayRate: { value: p.swayRate },
      uSize: { value: p.size },
      uPixelRatio: { value: pixelRatio },
      uColor: { value: new THREE.Color(...p.color) },
      uOpacity: { value: p.opacity },
      uStretch: { value: p.stretch },
      uGlow: { value: p.glow },
    },
    transparent: true,
    // Depth TEST so a flake behind a mountain is behind it; no depth WRITE so
    // flakes do not occlude each other into hard-edged discs.
    depthTest: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'weather';
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.raycast = () => {};

  // Pre-allocated; update() runs every frame and allocates nothing.
  const _side = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _ref = new THREE.Vector3();

  return {
    points,
    profile: p,
    count: total,

    /**
     * @param seconds   elapsed time
     * @param cameraPos the viewer's world position — the box centres on it
     * @param localUp   the player's up axis; the direction weather falls FROM
     */
    update(seconds, cameraPos, localUp) {
      const u = material.uniforms;
      u.uTime.value = seconds;
      if (cameraPos) u.uCamera.value.copy(cameraPos);
      if (localUp) u.uUp.value.copy(localUp).normalize();
      // Any stable tangent basis will do; pick one that cannot degenerate as
      // the bird passes over a pole.
      _ref.set(0, 1, 0);
      if (Math.abs(u.uUp.value.y) > 0.9) _ref.set(1, 0, 0);
      _side.crossVectors(_ref, u.uUp.value).normalize();
      _fwd.crossVectors(u.uUp.value, _side).normalize();
      u.uSide.value.copy(_side);
      u.uFwd.value.copy(_fwd);
    },

    /** 0 hides the weather entirely; 1 is the profile's own opacity. */
    setDensity(amount) {
      const a = Math.max(0, Math.min(1, amount));
      material.uniforms.uOpacity.value = p.opacity * a;
      points.visible = a > 0.01;
    },

    setPixelRatio(ratio) { material.uniforms.uPixelRatio.value = ratio; },
    /** Live read of the uniform actually bound to the shader right now. */
    getPixelRatio() { return material.uniforms.uPixelRatio.value; },

    dispose() { geometry.dispose(); material.dispose(); },
  };
}
