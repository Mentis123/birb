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
  // A dozen in a V, not eighteen scattered. Playtest read on the scattered
  // version was "not sure what the little arrow things in the sky are" — and
  // that is the correct read of what it was: evenly spaced dark chevrons at a
  // uniform distance, with no formation to group them and a flap that scaled
  // the whole bird uniformly, so they pulsed in size instead of beating their
  // wings. Nothing about it said "creature".
  count: 13,
  // Height above the ground, NOT a ring radius. The first version orbited a
  // circle of radius 165 at a fixed Y, which on a sphere puts the birds 120+
  // units from the player and about two pixels wide — present in the draw
  // call and invisible on screen. They now ride a great circle just above
  // cruise height, so the flock sweeps across the player's sky.
  altitude: 21,
  // Seconds for one sweep across the player's view and back.
  period: 52,
  // How far each way, in radians of bearing, the flock swings relative to the
  // direction the player is facing. A tight V that orbits a full circle is in
  // frame for about nine per cent of a portrait phone's narrow field of view
  // — which is to say, never. Swinging it across the forward view instead
  // means the player actually sees the thing.
  sweep: 1.05,
  // How wide the wheel is, in radians of arc across the planet surface. At
  // radius 120 this is roughly a 40-unit circle centred on the player.
  // Closer than it was (0.55). At radius 120 that put the flock 66 units out,
  // where a bird is a few pixels of dark grey and unreadable as anything.
  arcRadius: 0.52,
  wingSpan: 3.1,
  flapRate: 2.35,
  // How far the group is strung out along the orbit, in radians.
  // Spread WIDE around the wheel, not clustered. A tight group on a circle
  // centred on the player is behind the camera most of the time — measured:
  // sixteen birds correctly positioned 74 units away and not one of them on
  // screen. Strung around the wheel, several are always in front.
  spreadArc: 6.283,
  // How far back and out each rank of the V sits from the leader, in radians
  // of arc. A V is the one bird formation everyone recognises instantly, and
  // it does the job no amount of per-bird detail could at this distance.
  // These have to be several times the wingspan in arc terms or the ranks
  // overlap and the V collapses into a pile of darts — which is exactly what
  // 0.030/0.024 against a 7.4 wingspan produced. At radius 120 these put
  // about nine units between ranks for a bird under four across.
  vBack: 0.075,
  vOut: 0.055,
};

/**
 * Where one bird sits in the flock, as an angle along the shared great circle
 * plus its own height and wing phase. Pure — the caller turns the angle into
 * a position using the orbit's own basis, which is what keeps this on a
 * sphere instead of on a flat ring.
 */
export function flockOffset(index, count, seconds, options = {}) {
  const { altitude, period, vBack, vOut } = { ...FLOCK_DEFAULTS, ...options };
  const n = Math.max(1, count);
  const i = index % n;
  const t = Number.isFinite(seconds) ? seconds : 0;
  const lap = Math.sin((t / period) * Math.PI * 2) * (options.sweep ?? FLOCK_DEFAULTS.sweep);

  // ── The V ─────────────────────────────────────────────────────────────
  // Bird 0 leads; the rest alternate to the left and right wing, each rank
  // one step further back and further out. It is the single most legible
  // arrangement of flying birds there is: a viewer who cannot resolve a
  // single silhouette still reads the shape as geese.
  const rank = Math.floor((i + 1) / 2);
  const side = i === 0 ? 0 : (i % 2 === 0 ? 1 : -1);
  // A little personal slop so the formation breathes instead of looking
  // stamped out.
  const jitterBack = Math.sin(t * 0.6 + i * 2.1) * 0.004;
  const jitterOut = Math.sin(t * 0.47 + i * 1.3) * 0.003;

  const along = -rank * vBack + jitterBack;
  const lateral = side * (rank * vOut + jitterOut);
  // Ranks trail slightly below the leader, as they do in a real V, plus a
  // slow bob.
  const rise = altitude - rank * 0.55 + Math.sin(t * 0.31 + i * 0.9) * 1.6;

  return {
    angle: lap + along,
    lateral,
    height: rise,
    // Each rank beats a little behind the one ahead, so the flap runs down
    // the formation as a wave rather than the whole V clapping in unison.
    phase: rank * 0.42 + (side < 0 ? 0.12 : 0),
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
    // Warm dark brown-grey rather than slate: a cold grey chevron on a warm
    // sky reads as a UI mark, and this one was being mistaken for one.
    color: 0x2a2119,
    side: THREE.DoubleSide,
    // Unlit and slightly transparent: at this distance a lit surface just
    // flickers as the orbit turns it through the light, and haze is what
    // actually sells the distance.
    transparent: true,
    opacity: 0.88,
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
    update(seconds, birdPos, center, forward) {
      // A fixed orbit somewhere on the planet is a flock the player almost
      // never sees: the first version put one on a great circle and it was
      // simply on the far side most of the time. The wheel is anchored to the
      // PLAYER's up axis, so it is always overhead — which is also what a
      // real flock riding the same thermal would look like.
      if (birdPos) _localUp.copy(birdPos).normalize();
      else _localUp.set(0, 1, 0);
      // The basis is anchored to the direction the player is FACING, so
      // bearing zero means straight ahead and the sweep crosses the view.
      // Anchored to an arbitrary world axis instead, the flock spends almost
      // all of its time behind the camera.
      if (forward) {
        _t1.copy(forward).addScaledVector(_localUp, -forward.dot(_localUp));
        if (_t1.lengthSq() < 1e-6) _t1.set(0, 1, 0);
      } else {
        _t1.set(0, 1, 0);
        if (Math.abs(_localUp.y) > 0.9) _t1.set(1, 0, 0);
        _t1.crossVectors(_t1, _localUp);
      }
      _t1.normalize();
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

        // The flap is a change of SPAN alone. Scaling all three axes together
        // — which is what this did — makes the bird grow and shrink, and a
        // dark shape pulsing in size at a fixed distance does not read as a
        // wingbeat, it reads as a glitch. Holding the body length fixed while
        // the wings sweep in and out is the whole silhouette of a bird flying.
        const beat = Math.sin(seconds * flapRate + bird.phase);
        const span = wingSpan * (0.42 + 0.58 * Math.abs(beat));
        // Wings dip slightly below the body on the downstroke, which is what
        // stops the flat card reading as flat.
        _scale.set(span, wingSpan * (0.10 + 0.06 * beat), wingSpan * 0.82);
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
