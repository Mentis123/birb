// Contact decals — the soft dark patch where a prop meets the ground.
//
// From the tabletop worlds kit's realism notes (MAP-REALISM.md, "Grounding":
// "contact shadow is weak under the transformers, pylons and street
// furniture. Small baked ambient-occlusion decals (dark radial quads) under
// each are cheap and fix floating reads"). Same fix here, with two rules this
// game needs:
//
//   - ONE InstancedMesh for the whole biome, one draw call, two triangles per
//     prop, sharing contact-shadow.js's idea of a radial falloff texture;
//   - shown only while the SHADOW MAP IS OFF. Ultra draws real shadows (and
//     the forest at Ultra is within a few hundred triangles of the 80k hard
//     limit); Amazing, Okay and Light draw none, and that is where a trunk
//     standing on flat-lit grass reads as pasted on. The caller flips
//     `mesh.visible` with the shadow lever.
//
// Each quad lies on the TERRAIN's own slope under its prop (three samples of
// the ground around the base), not on the tangent plane, so it hugs a hill
// instead of slicing into its uphill side.

let _texture = null;

function radialTexture(THREE) {
  if (_texture) return _texture;
  const size = 64;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return null;
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.34)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  _texture = new THREE.CanvasTexture(c);
  _texture.colorSpace = THREE.SRGBColorSpace;
  return _texture;
}

/** Layers that stand on the ground and get a patch. */
export const DECAL_LAYERS = /^(forest-trunks|forest-rocks|mountain-pine-trunks|mountain-boulders|mountain-peaks-body|canyon-spires-\d+|canyon-needles|canyon-boulders|city-towers-\d+|city-pylons)$/;

/**
 * @param {object} o
 * @param {object} o.THREE
 * @param {object} o.root                 the world root (props are its descendants)
 * @param {number} o.sphereRadius
 * @param {(nx,ny,nz)=>number} o.heightDir terrain height delta at a unit direction
 * @param {number} [o.max]                instance cap
 * @returns {{ mesh, count } | null}
 */
export function createContactDecals({ THREE, root, sphereRadius, heightDir, max = 1400 }) {
  const tex = radialTexture(THREE);
  if (!tex) return null;
  const bases = [];   // [x, y, z, radius]
  const m = new THREE.Matrix4();
  const lo = new THREE.Vector3();
  const side = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isInstancedMesh || !DECAL_LAYERS.test(o.name)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    for (let i = 0; i < o.count && bases.length < max; i++) {
      o.getMatrixAt(i, m);
      m.premultiply(o.matrixWorld);
      if (Math.abs(m.elements[0]) + Math.abs(m.elements[5]) + Math.abs(m.elements[10]) < 1e-9) continue;
      lo.set(cx, b.min.y, cz).applyMatrix4(m);
      side.set(b.max.x, b.min.y, b.max.z).applyMatrix4(m);
      const r = side.distanceTo(lo);
      if (!(r > 0.05)) continue;
      bases.push([lo.x, lo.y, lo.z, r]);
    }
  });
  if (!bases.length) return null;

  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);   // lie in local XZ, facing +Y
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0x000000,
    transparent: true,
    depthWrite: false,
    // No fog: fog ADDS the fog colour, so a black patch at a distance turned
    // into a pale smudge (soloed, every decal read lighter than the ground).
    // A shadow under fog still darkens what the fog then hazes.
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, bases.length);
  mesh.name = 'contact-decals';
  mesh.renderOrder = 1;
  mesh.raycast = () => {};
  mesh.frustumCulled = true;

  const up = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const n = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const ground = (dir, out) => out.copy(dir).normalize().multiplyScalar(sphereRadius + heightDir(dir.x / dir.length(), dir.y / dir.length(), dir.z / dir.length()));
  bases.forEach(([x, y, z, r], i) => {
    up.set(x, y, z).normalize();
    t1.set(0, 1, 0).cross(up);
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
    t1.normalize();
    t2.crossVectors(up, t1);
    const reach = Math.max(1.5, r * 1.2) / sphereRadius;
    ground(pA.copy(up), pA);
    ground(pB.copy(up).addScaledVector(t1, reach), pB);
    ground(pC.copy(up).addScaledVector(t2, reach), pC);
    n.crossVectors(pC.sub(pA), pB.sub(pA)).normalize();
    if (n.dot(up) < 0) n.negate();
    if (!(n.lengthSq() > 0.5)) n.copy(up);
    q.setFromUnitVectors(Y, n);
    pos.copy(up).multiplyScalar(sphereRadius + heightDir(up.x, up.y, up.z) + 0.12);
    const d = Math.min(30, r * 3.2);
    s.set(d, 1, d);
    m.compose(pos, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  root.add(mesh);
  return { mesh, count: bases.length };
}
