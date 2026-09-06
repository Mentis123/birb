/**
 * Wingtip ribbons.
 *
 * A short strip of geometry trailing each wingtip while the bird is boosting
 * or banking hard — the cue that says "this turn is fast" without touching the
 * flight model. Two draw calls, and both are dropped at the first quality tier
 * because a decorative overlay is exactly what should go before resolution.
 *
 * Everything is pre-allocated. `update()` writes into fixed Float32Arrays and
 * never constructs a vector, an array or a geometry; the ribbon is a ring
 * buffer of anchor points that the vertex writer walks in order.
 *
 * Deliberately SHORT. A long ribbon on a mobile screen paints over the thing
 * the player is flying at, and in Drone Hunter that is the target.
 */

/**
 * How far along a ribbon a given segment sits, 0 at the oldest tail vertex and
 * 1 at the wingtip. Pure, so the taper and fade can be tested without a
 * renderer, and so the invariant that matters — the tail reaches exactly zero
 * alpha, leaving no hard edge hanging in the air — is pinned by a test.
 */
export function ribbonSegmentWeight(index, segments) {
  if (!(segments > 1)) return 1;
  const i = Math.min(Math.max(index, 0), segments - 1);
  return i / (segments - 1);
}

/** Alpha for a segment: zero at the tail, `intensity` at the wingtip. */
export function ribbonSegmentAlpha(index, segments, intensity = 1) {
  const w = ribbonSegmentWeight(index, segments);
  // Squared so the ribbon reads as a fading streak rather than a solid strip
  // with a sudden end.
  return Math.max(0, Math.min(1, intensity)) * w * w;
}

export function createRibbonTrail(THREE, {
  segments = 16,
  width = 0.24,
  color = 0xd8f6ff,
  minStep = 0.09,
} = {}) {
  const vertexCount = segments * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // One fixed index buffer: two triangles per rung, written once and never
  // touched again. Rebuilding indices per frame is the usual way this kind of
  // trail ends up allocating.
  const indices = new Uint16Array((segments - 1) * 6);
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.MeshBasicMaterial({
    color,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
    // NOT additive. This game's skies are pale cream and pale blue, and an
    // additive cyan ribbon against them adds almost nothing — the effect was
    // measurably present and visually absent. Normal blending with a near
    // white tint reads against both the sky and the grass.
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'wingtip-ribbon';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 3;

  // Ring buffer of anchor points and the side vector each was recorded with.
  const trail = new Float32Array(segments * 3);
  const sides = new Float32Array(segments * 3);
  let head = 0;
  let filled = 0;
  let intensity = 0;

  const _last = new THREE.Vector3();
  const _point = new THREE.Vector3();
  const _side = new THREE.Vector3();
  let hasLast = false;

  function reset() {
    head = 0;
    filled = 0;
    hasLast = false;
    geometry.setDrawRange(0, 0);
    mesh.visible = false;
  }

  return {
    mesh,
    reset,
    get intensity() { return intensity; },
    get length() { return filled; },

    /**
     * @param anchor    wingtip position in world space
     * @param sideDir   ribbon width direction (the wing's own out-of-plane axis)
     * @param delta     frame time
     * @param target    0..1 desired strength; 0 fades the ribbon out
     */
    update(anchor, sideDir, delta, target) {
      const want = Math.max(0, Math.min(1, target || 0));
      // Ramp in fast and out slow, so a flick of the stick does not strobe the
      // ribbon on and off once per frame.
      const rate = want > intensity ? 12 : 4;
      intensity += (want - intensity) * (1 - Math.exp(-Math.max(0, delta) * rate));

      if (intensity < 0.02) {
        // Fully faded: drop the history too. Without this the ribbon
        // reappears as one long streak across the map from wherever it was
        // last shown to wherever the bird is now.
        if (filled) reset();
        intensity = 0;
        return;
      }
      if (!anchor || !sideDir) return;

      // Only record a new rung once the wingtip has actually travelled, so a
      // hovering bird does not pile every rung on one point.
      const moved = !hasLast || _last.distanceToSquared(anchor) > minStep * minStep;
      if (moved) {
        _last.copy(anchor);
        hasLast = true;
        trail[head * 3] = anchor.x;
        trail[head * 3 + 1] = anchor.y;
        trail[head * 3 + 2] = anchor.z;
        sides[head * 3] = sideDir.x;
        sides[head * 3 + 1] = sideDir.y;
        sides[head * 3 + 2] = sideDir.z;
        head = (head + 1) % segments;
        if (filled < segments) filled++;
      }

      if (filled < 2) { mesh.visible = false; return; }

      // Walk oldest to newest so the taper runs tail to wingtip.
      const oldest = (head - filled + segments) % segments;
      for (let i = 0; i < filled; i++) {
        const src = (oldest + i) * 3;
        const dst = i * 2 * 3;
        const w = ribbonSegmentWeight(i, filled);
        const halfWidth = width * (0.25 + 0.75 * w);
        _point.set(trail[src], trail[src + 1], trail[src + 2]);
        _side.set(sides[src], sides[src + 1], sides[src + 2]).multiplyScalar(halfWidth);
        positions[dst] = _point.x - _side.x;
        positions[dst + 1] = _point.y - _side.y;
        positions[dst + 2] = _point.z - _side.z;
        positions[dst + 3] = _point.x + _side.x;
        positions[dst + 4] = _point.y + _side.y;
        positions[dst + 5] = _point.z + _side.z;
        const alpha = ribbonSegmentAlpha(i, filled, intensity);
        colors[dst] = colors[dst + 1] = colors[dst + 2] = alpha;
        colors[dst + 3] = colors[dst + 4] = colors[dst + 5] = alpha;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.setDrawRange(0, (filled - 1) * 6);
      mesh.visible = true;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
