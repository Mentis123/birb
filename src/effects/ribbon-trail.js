/**
 * Wingtip ribbons — the trail a bird leaves when it is really moving.
 *
 * The bird is the one object on screen a hundred per cent of the time, and
 * until now nothing about it changed when the player did something skilful.
 * Boost and a hard bank both altered the pose slightly; neither left a mark on
 * the world. A ribbon does, and it is the cheapest way to make speed legible:
 * it is the difference between a bird that is fast and a bird that LOOKS fast.
 *
 * ── Camera-facing, not body-facing ──────────────────────────────────────
 *
 * The obvious build is a flat band lying in some fixed plane of the bird —
 * take the wing's own up vector as the ribbon's width axis and extrude. That
 * band is invisible edge-on, which on a game where the camera sits behind and
 * slightly above the bird is most of the time it exists. So each point's width
 * axis is `cross(tangent, toCamera)` instead: the ribbon always presents its
 * face, whatever the bird is doing, exactly the way a line renderer would.
 *
 * ── Nothing is allocated after construction ─────────────────────────────
 *
 * Fixed vertex count, fixed index buffer, a rolling window of anchor points in
 * a plain Float32Array. A ribbon that is not currently shown is a mesh with
 * `visible = false`, not a mesh that gets built and thrown away. The rolling
 * window shifts by memmove — eighteen points is fifty-four floats, which is
 * far cheaper than the modular arithmetic a true ring buffer would need, and
 * it cannot get the wrap-around wrong.
 *
 * ── Why it is not additive ──────────────────────────────────────────────
 *
 * Every other glow in this game learned the same lesson the hard way (see
 * docs/VISUAL_UPGRADE_BUILD_PLAN.md 16.16): additive light on a bright sky is
 * grey, because every channel runs to the top of the range and the tone mapper
 * flattens what is left. Half of a ribbon's life is spent against the sky. So
 * it is ordinary alpha blending with a near-white head and a cyan tail, which
 * holds its colour on sky and on terrain alike, and the bloom pass turns the
 * bright head into the glow additive blending was reaching for.
 */

export const RIBBON_DEFAULTS = {
  // Points in the rolling window. Each one is a rib of the ribbon.
  segments: 20,
  // Half-width at the head, in world units. The bird is about two units
  // across. The first build used 0.13 and the capture is unambiguous: two
  // white bands about forty pixels wide running down the screen, reading as
  // painted runway markings rather than as anything the bird left behind. A
  // trail is thinner than it feels like it should be.
  width: 0.055,
  // How far the wingtip must travel before a new point is recorded. This
  // controls DENSITY along the ribbon; `life` below controls its length.
  minStep: 0.25,
  // How long the ribbon is, in WORLD UNITS, measured along its own path.
  //
  // This is the number that makes the ribbon frame-rate independent, and two
  // builds went out without it reading as painted runway stripes. Fading by
  // buffer position makes the length (points x per-frame travel), which at
  // 60fps is about five units and in the headless harness at 2fps is seventy.
  // Fading by AGE does not rescue it either, because `update` clamps its delta
  // to 50ms to survive a stall — so at 2fps a point ages twenty times slower
  // than the wall clock and the fade never arrives. Arc length is measured off
  // the geometry itself and cannot be fooled by either.
  reach: 5.5,
  // Seconds a recorded point survives. Age is what dissipates the trail of a
  // bird that has STOPPED; reach is what limits the trail of one that has not.
  //
  // This is what makes the ribbon frame-rate independent, and getting it wrong
  // is what made the first two builds read as painted runway stripes. Fade a
  // trail by DISTANCE along the buffer and its length becomes (points x
  // per-frame travel), which at 60fps is about five units and in the headless
  // harness at 2fps is seventy — the same code, a fourteen-fold difference,
  // and only one of the two was ever looked at. Fade it by AGE and the length
  // is (speed x life) at any frame rate: the slow case simply runs out of
  // life sooner, exactly as a real vapour trail dissipates on a clock rather
  // than on an odometer.
  life: 1.0,
  // Peak alpha at the head.
  opacity: 0.55,
  // Seconds to ramp in and out. Without these the ribbon pops into existence
  // at full length the instant the stick crosses the bank threshold.
  attack: 0.15,
  release: 0.4,
  // Cyan, not white. A white ribbon on a pale sky is a paint stripe.
  head: [0.62, 0.96, 1.0],
  tail: [0.14, 0.62, 0.98],
};

/**
 * Alpha and half-width for one rib, given its position in the buffer (t), its
 * age in seconds, and its distance from the head measured ALONG the ribbon.
 *
 * Pure, so the taper can be checked without a GPU. Two independent terminators
 * — age ends the trail of a bird that has stopped, arc length bounds the trail
 * of one that has not — and whichever runs out first wins.
 */
export function ribbonProfile(t, intensity = 1, age = 0, dist = 0, config = RIBBON_DEFAULTS) {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const life = config.life > 0 ? config.life : RIBBON_DEFAULTS.life;
  const reach = config.reach > 0 ? config.reach : RIBBON_DEFAULTS.reach;
  const byAge = 1 - Math.min(1, Math.max(0, age) / life);
  const byDist = 1 - Math.min(1, Math.max(0, dist) / reach);
  // Whichever ran out first ends the ribbon there.
  const f = Math.min(byAge, byDist);
  // Squared, so the tail reaches zero rather than ending in a straight cut —
  // a linear fade leaves a visible last row, because the eye finds it.
  const shape = f * f * (1 - u * 0.15);
  return { alpha: shape * intensity, halfWidth: (1 - u * 0.55) * Math.min(1, f * 2) * intensity };
}

/**
 * Ramp `current` toward `target` over attack/release time constants.
 * Pure, and the reason a ribbon neither pops on nor snaps off.
 */
export function rampIntensity(current, target, delta, { attack, release } = RIBBON_DEFAULTS) {
  const time = target > current ? attack : release;
  if (!(time > 0)) return target;
  const step = delta / time;
  if (target > current) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

export function createRibbonTrail(THREE, options = {}) {
  const config = { ...RIBBON_DEFAULTS, ...options };
  const N = Math.max(3, config.segments | 0);

  // Rolling window, newest first. Position only — the width axis is derived
  // per frame from the camera, so storing it would go stale the moment the
  // player orbited without moving.
  const pts = new Float32Array(N * 3);
  const ages = new Float32Array(N);
  let filled = 0;

  const positions = new Float32Array(N * 2 * 3);
  // Four components, which is how Three carries per-vertex ALPHA: a 4-wide
  // `color` attribute switches the shader to USE_COLOR_ALPHA. With a 3-wide
  // one the ribbon is a solid band that ends in a hard edge.
  const colors = new Float32Array(N * 2 * 4);
  const index = new Uint16Array((N - 1) * 6);
  for (let i = 0; i < N - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    index.set([a, b, c, b, d, c], i * 6);
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 4);
  posAttr.setUsage?.(THREE.DynamicDrawUsage);
  colAttr.setUsage?.(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colAttr);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;   // the geometry is rewritten in world space
  mesh.renderOrder = 3;
  mesh.raycast = () => {};
  mesh.visible = false;

  // Scratch. Nothing below this line allocates.
  const _tan = new THREE.Vector3();
  const _view = new THREE.Vector3();
  const _side = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const head = config.head, tail = config.tail;

  let intensity = 0;
  let needReset = true;

  const pushPoint = (x, y, z) => {
    pts.copyWithin(3, 0, (N - 1) * 3);
    ages.copyWithin(1, 0, N - 1);
    pts[0] = x; pts[1] = y; pts[2] = z;
    ages[0] = 0;
    if (filled < N) filled++;
  };

  const fill = (x, y, z) => {
    for (let i = 0; i < N; i++) {
      pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z;
      // Born already spent, so a freshly shown ribbon grows out of the wingtip
      // instead of appearing at full length.
      ages[i] = config.life;
    }
    ages[0] = 0;
    filled = N;
  };

  /**
   * @param anchor  wingtip world position
   * @param camPos  camera world position (the ribbon faces it)
   * @param delta   seconds
   * @param want    0..1 target intensity — how hard the player is working
   */
  const update = (anchor, camPos, delta, want) => {
    const dt = Math.min(Math.max(delta || 0, 0), 0.05);
    intensity = rampIntensity(intensity, Math.min(Math.max(want || 0, 0), 1), dt, config);

    if (intensity <= 0.001) {
      intensity = 0;
      mesh.visible = false;
      // Reset on the way out, not on the way in. Keeping the stale window
      // means the next show streaks a ribbon across the map from wherever the
      // bird happened to be when it last faded.
      needReset = true;
      return;
    }
    if (!anchor) return;

    if (needReset) { fill(anchor.x, anchor.y, anchor.z); needReset = false; }

    for (let i = 0; i < N; i++) ages[i] += dt;

    const dx = anchor.x - pts[0], dy = anchor.y - pts[1], dz = anchor.z - pts[2];
    if (dx * dx + dy * dy + dz * dz > config.minStep * config.minStep) {
      pushPoint(anchor.x, anchor.y, anchor.z);
    } else {
      // Always keep the head glued to the wingtip, so the ribbon does not
      // detach from the bird between recorded points.
      pts[0] = anchor.x; pts[1] = anchor.y; pts[2] = anchor.z;
    }

    let arc = 0;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      if (i > 0) {
        const ax = pts[o] - pts[o - 3], ay = pts[o + 1] - pts[o - 2], az = pts[o + 2] - pts[o - 1];
        arc += Math.sqrt(ax * ax + ay * ay + az * az);
      }
      _p.set(pts[o], pts[o + 1], pts[o + 2]);
      const prev = Math.max(i - 1, 0) * 3;
      const next = Math.min(i + 1, N - 1) * 3;
      _tan.set(pts[prev] - pts[next], pts[prev + 1] - pts[next + 1], pts[prev + 2] - pts[next + 2]);
      if (_tan.lengthSq() < 1e-8) _tan.set(0, 0, 1);
      _tan.normalize();
      if (camPos) _view.copy(camPos).sub(_p); else _view.set(0, 1, 0);
      _side.crossVectors(_tan, _view);
      if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0); else _side.normalize();

      const t = i / (N - 1);
      const { alpha, halfWidth } = ribbonProfile(t, intensity, ages[i], arc, config);
      const w = halfWidth * config.width;
      const v = i * 6;
      positions[v] = _p.x - _side.x * w;
      positions[v + 1] = _p.y - _side.y * w;
      positions[v + 2] = _p.z - _side.z * w;
      positions[v + 3] = _p.x + _side.x * w;
      positions[v + 4] = _p.y + _side.y * w;
      positions[v + 5] = _p.z + _side.z * w;

      const r = head[0] + (tail[0] - head[0]) * t;
      const g = head[1] + (tail[1] - head[1]) * t;
      const b = head[2] + (tail[2] - head[2]) * t;
      const a = alpha * config.opacity;
      const ci = i * 8;
      colors[ci] = r; colors[ci + 1] = g; colors[ci + 2] = b; colors[ci + 3] = a;
      colors[ci + 4] = r; colors[ci + 5] = g; colors[ci + 6] = b; colors[ci + 7] = a;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    mesh.visible = true;
  };

  const dispose = () => { geometry.dispose(); material.dispose(); };

  return {
    mesh,
    update,
    dispose,
    get intensity() { return intensity; },
    // For tests and the debug hooks: how many points the window holds.
    get pointCount() { return filled; },
  };
}
