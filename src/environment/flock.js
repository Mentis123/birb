/**
 * A distant flock.
 *
 * The world has weather, terrain, landmarks and a sun, and not one other
 * living thing in it. Nothing makes a place feel inhabited like something
 * else moving through it that the player does not control.
 *
 * Deliberately cheap and deliberately DISTANT. These are two-triangle
 * silhouettes in a single InstancedMesh — one draw call for the whole flock —
 * kept far enough away that they read as birds rather than as flat cards. At
 * this range a low-poly gull and a triangle are the same picture.
 *
 * They wheel on a shared orbit rather than running a boids simulation. Boids
 * is the obvious thing to reach for and it is the wrong trade here: it costs
 * per-bird neighbour queries every frame for behaviour nobody can resolve at
 * 200 units. A common orbit with per-bird phase offsets produces the same
 * read — a loose group turning together — for a handful of sines.
 *
 * Zero allocation per frame. THREE injected, as everywhere else in this repo.
 */

export const FLOCK_DEFAULTS = {
  count: 18,
  // Height above the ground, NOT a ring radius. The first version orbited a
  // circle of radius 165 at a fixed Y, which on a sphere puts the birds 120+
  // units from the player and about two pixels wide — present in the draw
  // call and invisible on screen. They now ride a great circle just above
  // cruise height, so the flock sweeps across the player's sky.
  altitude: 19,
  // Seconds for one lap AROUND THE PLAYER. Slow enough to read as soaring.
  period: 46,
  // How wide the wheel is, in radians of arc across the planet surface. At
  // radius 120 this is roughly a 40-unit circle centred on the player.
  arcRadius: 0.55,
  wingSpan: 4.8,
  flapRate: 2.7,
  // How far the group is strung out along the orbit, in radians.
  // Spread WIDE around the wheel, not clustered. A tight group on a circle
  // centred on the player is behind the camera most of the time — measured:
  // sixteen birds correctly positioned 74 units away and not one of them on
  // screen. Strung around the wheel, several are always in front.
  spreadArc: 6.283,
};

/**
 * Where one bird sits in the flock, as an angle along the shared great circle
 * plus its own height and wing phase. Pure — the caller turns the angle into
 * a position using the orbit's own basis, which is what keeps this on a
 * sphere instead of on a flat ring.
 */
export function flockOffset(index, count, seconds, options = {}) {
  const { altitude, period, spreadArc } = { ...FLOCK_DEFAULTS, ...options };
  const n = Math.max(1, count);
  const i = index % n;
  const t = Number.isFinite(seconds) ? seconds : 0;
  const lap = (t / period) * Math.PI * 2;
  // Strung along the orbit, with a slow personal drift so the formation
  // breathes rather than holding a rigid line.
  const along = ((i / n) - 0.5) * spreadArc + Math.sin(t * 0.23 + i * 1.7) * 0.035;
  // Fanned sideways off the orbit and staggered in height, so the group has
  // real depth instead of being a flat string of birds.
  const lateral = Math.sin(i * 2.39) * 0.10 + Math.sin(t * 0.17 + i) * 0.012;
  const rise = altitude + Math.sin(i * 1.31) * 11 + Math.sin(t * 0.31 + i * 0.9) * 4;
  return {
    angle: lap + along,
    lateral,
    height: rise,
    phase: i * 0.61,
  };
}

const ZERO = { x: 0, y: 0, z: 0 };

export function createFlock(THREE, { sphereRadius = 120, ...options } = {}) {
  const config = { ...FLOCK_DEFAULTS, ...options };
  const { count, wingSpan, flapRate } = config;

  // One bird: two triangles meeting at the body, the classic distant-gull
  // silhouette. Built in the XZ plane so a flap is a rotation of the outer
  // vertices about the body axis, done on the CPU into the instance matrix.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0.35, -1, 0, -0.25, -0.15, 0, 0,
    0, 0, 0.35, 0.15, 0, 0, 1, 0, -0.25,
  ]), 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0x1e2a33,
    side: THREE.DoubleSide,
    // Unlit and slightly transparent: at this distance a lit surface just
    // flickers as the orbit turns it through the light, and haze is what
    // actually sells the distance.
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'distant-flock';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  // Pre-allocated. update() runs every frame and allocates nothing.
  const _matrix = new THREE.Matrix4();
  const _position = new THREE.Vector3();
  const _quaternion = new THREE.Quaternion();
  const _scale = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _tangent = new THREE.Vector3();
  const _look = new THREE.Matrix4();

  // Rebuilt each frame from the player's up axis, so the wheel follows them.
  const _localUp = new THREE.Vector3();
  const _t1 = new THREE.Vector3();
  const _t2 = new THREE.Vector3();

  return {
    mesh,

    /**
     * @param seconds  elapsed time
     * @param center   planet centre (Vector3); the orbit is built around it
     */
    /**
     * @param seconds  elapsed time
     * @param birdPos  the player's world position; the flock wheels around
     *                 the player's own sky rather than a fixed great circle
     * @param center   planet centre (Vector3)
     */
    update(seconds, birdPos, center) {
      // A fixed orbit somewhere on the planet is a flock the player almost
      // never sees: the first version put one on a great circle and it was
      // simply on the far side most of the time. The wheel is anchored to the
      // PLAYER's up axis, so it is always overhead — which is also what a
      // real flock riding the same thermal would look like.
      if (birdPos) _localUp.copy(birdPos).normalize();
      else _localUp.set(0, 1, 0);
      // Any tangent basis will do; pick one that cannot degenerate.
      _t1.set(0, 1, 0);
      if (Math.abs(_localUp.y) > 0.9) _t1.set(1, 0, 0);
      _t1.crossVectors(_t1, _localUp).normalize();
      _t2.crossVectors(_localUp, _t1).normalize();

      for (let i = 0; i < count; i++) {
        const bird = flockOffset(i, count, seconds, config);
        const arc = config.arcRadius + bird.lateral;
        const sinArc = Math.sin(arc);
        // Tilt the wheel off the zenith so it crosses the sky rather than
        // sitting as a ring directly above the player's head.
        _dir.copy(_t1).multiplyScalar(Math.cos(bird.angle) * sinArc)
          .addScaledVector(_t2, Math.sin(bird.angle) * sinArc)
          .addScaledVector(_localUp, Math.cos(arc))
          .normalize();
        _position.copy(_dir).multiplyScalar(sphereRadius + bird.height);
        if (center) _position.add(center);

        // Face along the wheel, local up radial, so they read as birds flying
        // level over the ground beneath them.
        _tangent.copy(_t1).multiplyScalar(-Math.sin(bird.angle))
          .addScaledVector(_t2, Math.cos(bird.angle)).normalize();
        _look.lookAt(_tangent, ZERO, _dir);
        _quaternion.setFromRotationMatrix(_look);

        // At this distance a silhouette that narrows and widens IS the flap,
        // and it costs one sine.
        const beat = Math.sin(seconds * flapRate + bird.phase);
        const span = wingSpan * (0.74 + 0.26 * Math.abs(beat));
        _scale.set(span, span, span);
        _matrix.compose(_position, _quaternion, _scale);
        mesh.setMatrixAt(i, _matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
