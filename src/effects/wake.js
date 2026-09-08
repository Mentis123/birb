/**
 * Ripples on the water, under a bird flying low.
 *
 * The lakes are the most expensive thing this world gained and they are inert
 * — you can skim one at head height and the surface does not know you are
 * there. A wake is the cheapest possible fix and it is the one that makes the
 * water read as a SURFACE rather than as a blue floor: the ripple gives it a
 * plane, a scale, and a reaction.
 *
 * One InstancedMesh, one draw call, a fixed ring of instances reused round
 * robin. Nothing is allocated after construction and nothing is created or
 * destroyed at runtime — a ripple that has faded out is simply an instance
 * whose age has passed its life, waiting to be claimed again.
 *
 * The rings lie ON the water plane and never write depth. A ripple is light
 * on a surface, not an object floating above one, and depth-writing decals at
 * a grazing angle z-fight with the very surface they are drawn on.
 */

export const WAKE_DEFAULTS = {
  count: 16,
  // Seconds a single ripple lives. Long enough to still be spreading behind
  // you at cruise speed, short enough that the pool never runs dry.
  life: 1.9,
  startRadius: 0.9,
  endRadius: 6.2,
  // How far above the surface the bird can be and still disturb it. Generous
  // on purpose: this is a stylised bird, and a ripple that only appears when
  // you are within a metre is a ripple nobody ever sees.
  reach: 7.0,
  // Lifted clear of the water plane. Coplanar geometry z-fights, and on a
  // sphere the surface curves away underneath, so the lift also has to cover
  // the sagitta across the ring's own width.
  lift: 0.22,
  // Additive on water that is already pale, then amplified again by the
  // bloom pass — so this is far lower than it looks. At 0.34 a fresh ripple
  // clipped to a hard white ring; at 0.17 it could not be found. This is the
  // one number here worth re-judging on a real phone.
  opacity: 0.26,
};

/**
 * How a ripple looks at a given point in its life. Pure, so the curve can be
 * checked without a GPU.
 *
 * The radius eases OUT (fast spread, slowing) because that is what a real
 * ring wave does, and the opacity has an attack as well as a decay — a ripple
 * that starts at full strength pops, and pops are what make a decal read as a
 * sprite rather than as water moving.
 */
export function rippleAt(age, { life, startRadius, endRadius, opacity } = WAKE_DEFAULTS) {
  const l = life > 0 ? life : WAKE_DEFAULTS.life;
  const t = age / l;
  if (!(t >= 0) || t >= 1) return { alive: false, radius: 0, alpha: 0 };
  const spread = 1 - (1 - t) * (1 - t);              // ease out
  const attack = Math.min(1, t / 0.12);
  const decay = 1 - t;
  return {
    alive: true,
    radius: startRadius + (endRadius - startRadius) * spread,
    alpha: opacity * attack * decay * decay,
  };
}

export function createWake(THREE, options = {}) {
  const config = { ...WAKE_DEFAULTS, ...options };
  const { count } = config;

  // A unit ring; the instance scale sets the real radius. Thin, because a
  // wake is a line of disturbed water, not a disc.
  const geometry = new THREE.RingGeometry(0.88, 1.0, 24, 1);
  // RingGeometry lies in XY; the ripples lie on the ground, so rotate the
  // geometry once at build time rather than composing an extra quaternion
  // into every instance every frame.
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({
    // Cool white, not white. Added light on an already-pale lake clips
    // instantly, and once it clips the bloom pass finds it and the ripple
    // stops being a ripple and becomes a searchlight.
    color: 0xcdeaff,
    transparent: true,
    // ADDITIVE, and that is what makes the per-instance fade work at all.
    // An InstancedMesh has one material opacity for every instance, so the
    // fade has to ride in the instance COLOUR — and instanceColor tints, it
    // does not set alpha. Under normal blending a half-faded ripple is a
    // fully opaque dark grey ring, which is what the first build drew: a
    // stack of charcoal hoops on a pale lake. Added instead, a dark instance
    // colour contributes nothing, which is exactly a fade, and light added
    // to water is what a ripple catching the sun actually is.
    blending: THREE.AdditiveBlending,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'wake';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.raycast = () => {};
  // Per-instance alpha rides in the instance colour: one InstancedMesh cannot
  // give each instance its own material opacity, and the alternative is a
  // draw call per ripple.
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

  const ages = new Float32Array(count).fill(Infinity);
  const positions = [];
  const quaternions = [];
  for (let i = 0; i < count; i++) {
    positions.push(new THREE.Vector3());
    quaternions.push(new THREE.Quaternion());
  }

  // Pre-allocated. update() and spawn() allocate nothing.
  const _matrix = new THREE.Matrix4();
  const _scale = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _hidden = new THREE.Vector3(0, 0, 0);
  let next = 0;

  function hide(i) {
    _matrix.compose(positions[i], quaternions[i], _hidden);
    mesh.setMatrixAt(i, _matrix);
    mesh.instanceColor.setXYZ(i, 0, 0, 0);
  }
  for (let i = 0; i < count; i++) hide(i);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;

  return {
    mesh,
    config,

    /**
     * Start a ripple at a point on the surface.
     * @param point   world position on the water
     * @param normal  the surface normal there (radial, on a sphere)
     * @param tint    optional colour; defaults to the material's white
     */
    spawn(point, normal, tint) {
      const i = next;
      next = (next + 1) % count;
      positions[i].copy(point);
      // Lift along the normal so the ring sits proud of the plane it decorates.
      positions[i].addScaledVector(normal, config.lift);
      quaternions[i].setFromUnitVectors(_up, normal);
      ages[i] = 0;
      if (tint) mesh.instanceColor.setXYZ(i, tint.r, tint.g, tint.b);
    },

    /** Advance every live ripple. Returns how many are still alive. */
    update(delta) {
      let live = 0;
      for (let i = 0; i < count; i++) {
        const age = ages[i];
        if (!Number.isFinite(age)) continue;
        const nextAge = age + delta;
        ages[i] = nextAge;
        const state = rippleAt(nextAge, config);
        if (!state.alive) {
          ages[i] = Infinity;
          hide(i);
          continue;
        }
        live++;
        _scale.set(state.radius, 1, state.radius);
        _matrix.compose(positions[i], quaternions[i], _scale);
        mesh.setMatrixAt(i, _matrix);
        const a = state.alpha;
        mesh.instanceColor.setXYZ(i, a, a, a);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.visible = live > 0;
      return live;
    },

    /** Drop every ripple immediately — used on environment switch. */
    clear() {
      for (let i = 0; i < count; i++) { ages[i] = Infinity; hide(i); }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.visible = false;
    },

    dispose() { geometry.dispose(); material.dispose(); },
  };
}
