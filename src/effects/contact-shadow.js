/**
 * The bird's contact shadow.
 *
 * Global shadow maps are off in this game and stay off — they are the single
 * most expensive thing a mobile GPU can be asked for, and a whole-world depth
 * pass to ground ONE moving object is a bad trade. What the frame actually
 * lacked was the cue that tells you how high you are: without it the bird
 * hangs in front of the terrain rather than over it, and altitude is
 * unreadable until you hit something.
 *
 * So this is a single decal — one draw call, one 16-segment disc, painted once
 * into a canvas at construction. It follows the bird's radial direction down
 * to the terrain floor, and it fades and spreads with altitude the way a real
 * penumbra does. THREE is injected so the maths is testable in Node without
 * the game's pinned CDN import.
 */

/**
 * Opacity and scale for a given altitude, as pure numbers.
 *
 * Split out from the mesh so the falloff can be tested without a renderer, and
 * so the one thing worth getting right — that the shadow disappears completely
 * before the bird is high enough for it to look wrong — is pinned by a test.
 */
export function shadowFalloff(altitude, { maxAltitude = 34, baseOpacity = 0.5, spread = 0.028 } = {}) {
  if (!Number.isFinite(altitude)) return { opacity: 0, scale: 1 };
  const height = Math.max(0, altitude);
  const t = Math.max(0, 1 - height / maxAltitude);
  return {
    // Squared falloff: a real penumbra loses contrast faster than it loses
    // size, so a linear fade reads as a sticker that shrinks.
    opacity: baseOpacity * t * t,
    scale: 1 + height * spread,
  };
}

export function createContactShadow(THREE, {
  // Roughly the bird's wingspan. Sized smaller it reads as a dark blob on the
  // grass rather than as this bird's shadow, which is worse than none.
  radius = 2.6,
  // Tuned against the world, not against intuition. The continental carve
  // takes the ground 24 to 46 units below the base radius, and the bird
  // cruises just above that baseline, so its height over ACTUAL terrain is
  // routinely 10-30 units. A 14-unit falloff — a sensible number on a flat
  // world — left the shadow at 6% opacity in ordinary flight, which is to say
  // invisible, which is to say the feature did not exist.
  maxAltitude = 34,
  baseOpacity = 0.5,
  segments = 16,
} = {}) {
  const texture = createShadowTexture(THREE);
  const geometry = new THREE.CircleGeometry(1, segments);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0x2a3326,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    // The ground is a displaced sphere with real curvature between vertices,
    // so a decal laid exactly on it z-fights in bands. Offset wins that
    // without lifting the disc far enough to float visibly.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'bird-contact-shadow';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.matrixAutoUpdate = true;

  // Pre-allocated: update() runs every frame and allocates nothing.
  const _up = new THREE.Vector3();
  const _planeNormal = new THREE.Vector3(0, 0, 1);
  const _quat = new THREE.Quaternion();

  return {
    mesh,

    /**
     * @param birdPosition  world position of the bird (Vector3-like)
     * @param floorRadius   distance from the planet centre to the ground
     *                      beneath the bird, i.e. sphereRadius + terrainHeight
     * @param enabled       false hides it outright (nested, low tier, no bird)
     */
    update(birdPosition, floorRadius, enabled = true) {
      if (!enabled || !birdPosition || !Number.isFinite(floorRadius)) {
        mesh.visible = false;
        return;
      }
      const distance = birdPosition.length();
      if (!(distance > 1e-4)) { mesh.visible = false; return; }

      const { opacity, scale } = shadowFalloff(distance - floorRadius, {
        maxAltitude, baseOpacity, spread: 0.028,
      });
      // Below the threshold the disc is invisible anyway; skipping the
      // transform keeps a high-flying bird completely free of cost.
      if (opacity < 0.02) { mesh.visible = false; return; }

      _up.copy(birdPosition).divideScalar(distance);
      // A shade above the floor. The polygon offset handles the rest; lifting
      // it further would detach the shadow from the ground on a slope.
      mesh.position.copy(_up).multiplyScalar(floorRadius + 0.06);
      // CircleGeometry faces local +Z, so rotate that onto the radial up.
      _quat.setFromUnitVectors(_planeNormal, _up);
      mesh.quaternion.copy(_quat);
      mesh.scale.setScalar(radius * scale);
      material.opacity = opacity;
      mesh.visible = true;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/** Soft radial falloff painted once. No download, no atlas, no asset. */
function createShadowTexture(THREE) {
  const size = 64;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) {
    // Node (tests): a 1x1 white data texture keeps the module importable.
    const data = new Uint8Array([255, 255, 255, 255]);
    return new THREE.DataTexture(data, 1, 1);
  }
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.82)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
