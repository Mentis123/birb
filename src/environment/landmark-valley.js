// Landmark valley — overlaid WATER for the carved valley feature.
//
// The basin + inflow groove themselves are carved into the terrain by
// valleyCarveAt() in spherical-world.js (the single source of truth for the
// sphere MESH and the flight FLOOR — see the Math.min(0,…) invariant). This
// module only adds the *water*: a shimmering pool at the basin floor, a
// scrolling waterfall sheet hanging at the inflow rim, and a river ribbon
// leading into it. Every vertex rides on the real ground via the heightAt()
// probe, so the water hugs the carve and nothing here touches the flight floor.
//
// Built once per environment by createSphericalWorld and added to the world
// root, so it rotates with the world and is disposed with it.

function makeWaterTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const w = 64, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);
  // Deterministic soft vertical streaks (no Math.random — stable across reloads).
  for (let i = 0; i < 42; i++) {
    const x = (i * 53) % w;
    const a = (0.06 + ((i * 37) % 28) / 100 * 0.6);
    const ww = 1 + ((i * 17) % 3);
    ctx.fillStyle = `rgba(222,240,255,${a.toFixed(3)})`;
    ctx.fillRect(x, 0, ww, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createValleyFeature({
  THREE, sphereRadius, anchor, forward, right, params, heightAt, isMobile,
}) {
  const { Vector3, Matrix4 } = THREE;
  const group = new THREE.Group();
  group.name = 'landmark-valley';

  const A = new Vector3(anchor.x, anchor.y, anchor.z).normalize();
  const F = new Vector3(forward.x, forward.y, forward.z).normalize();
  const Rt = new Vector3(right.x, right.y, right.z).normalize();

  const safeHeight = (nx, ny, nz) => {
    try { return heightAt ? heightAt(nx, ny, nz) : 0; } catch (e) { return 0; }
  };
  // Unit direction rotated from the anchor toward F by `ang` (F is tangent, so
  // this is a clean rotation in the anchor→forward plane and stays unit-length).
  const dirAt = (ang) =>
    A.clone().multiplyScalar(Math.cos(ang)).addScaledVector(F, Math.sin(ang)).normalize();
  const surfacePoint = (dir, extra = 0) =>
    dir.clone().multiplyScalar(sphereRadius + safeHeight(dir.x, dir.y, dir.z) + extra);

  // ── Pool at the basin floor ───────────────────────────────────
  const poolTex = makeWaterTexture(THREE);
  if (poolTex) { poolTex.rotation = Math.PI / 4; poolTex.repeat.set(2, 2); }
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0x1f6fb8, map: poolTex || null, transparent: true, opacity: 0.84,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(params.poolRadius, 28), poolMat);
  const poolCenter = surfacePoint(A, 0.6);
  pool.position.copy(poolCenter);
  pool.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), A); // circle normal → radial
  pool.renderOrder = 2;
  group.add(pool);

  // ── Waterfall sheet at the inflow rim ─────────────────────────
  const rimAng = params.radiusAng * 0.92;
  const rimDir = dirAt(rimAng);
  const rimTop = surfacePoint(rimDir, 1.0);
  const poolLevelR = poolCenter.length();
  const fallTex = makeWaterTexture(THREE);
  if (fallTex) fallTex.repeat.set(1.5, 2.2);
  const fallMat = new THREE.MeshBasicMaterial({
    color: 0xeaf6ff, map: fallTex || null, transparent: true, opacity: 0.95,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const fallWidth = params.poolRadius * 1.8;
  const fallHeight = Math.max(8, rimTop.length() - poolLevelR + 3);
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(fallWidth, fallHeight, 1, 1), fallMat);
  // Basis: local +Y → outward radial at the rim (sheet stands vertically); local
  // +Z → faces the approach (−forward). Right-handed: x = y × z.
  const yAxis = rimDir.clone();
  const zAxis = F.clone().negate();
  const xAxis = new Vector3().crossVectors(yAxis, zAxis).normalize();
  const zFix = new Vector3().crossVectors(xAxis, yAxis).normalize();
  fall.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, zFix));
  fall.position.copy(rimDir).multiplyScalar((rimTop.length() + poolLevelR) / 2);
  fall.position.addScaledVector(F, -params.poolRadius * 0.15); // hang slightly into the basin
  fall.renderOrder = 3;
  group.add(fall);

  // ── River ribbon leading down to the rim ──────────────────────
  const riverTex = makeWaterTexture(THREE);
  if (riverTex) { riverTex.rotation = Math.PI / 2; riverTex.repeat.set(1, 6); }
  const riverMat = new THREE.MeshBasicMaterial({
    color: 0x3a8fd0, map: riverTex || null, transparent: true, opacity: 0.8,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const segs = isMobile ? 10 : 16;
  const halfW = params.riverHalfAng;
  const positions = [];
  const uvs = [];
  for (let k = 0; k <= segs; k++) {
    const a = rimAng + (params.riverReachAng - rimAng) * (k / segs);
    const center = dirAt(a);
    const eL = center.clone().multiplyScalar(Math.cos(halfW)).addScaledVector(Rt, Math.sin(halfW)).normalize();
    const eR = center.clone().multiplyScalar(Math.cos(halfW)).addScaledVector(Rt, -Math.sin(halfW)).normalize();
    const pL = surfacePoint(eL, 0.6);
    const pR = surfacePoint(eR, 0.6);
    positions.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
    const v = k / segs;
    uvs.push(0, v, 1, v);
  }
  const index = [];
  for (let k = 0; k < segs; k++) {
    const a0 = k * 2, b0 = k * 2 + 1, a1 = k * 2 + 2, b1 = k * 2 + 3;
    index.push(a0, b0, a1, b0, b1, a1);
  }
  const riverGeo = new THREE.BufferGeometry();
  riverGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  riverGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  riverGeo.setIndex(index);
  riverGeo.computeVertexNormals();
  const river = new THREE.Mesh(riverGeo, riverMat);
  river.renderOrder = 2;
  group.add(river);

  // ── Outflow river along the downstream canyon ─────────────────
  // The valley continues well past the pool: a long river running through the
  // carved canyon (−forward), hugging the deepening floor via heightAt so it
  // descends with the terrain instead of ending at the basin.
  const outTex = makeWaterTexture(THREE);
  if (outTex) { outTex.rotation = Math.PI / 2; outTex.repeat.set(1, 12); }
  const outMat = new THREE.MeshBasicMaterial({
    color: 0x2f86cf, map: outTex || null, transparent: true, opacity: 0.8,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const outSegs = isMobile ? 18 : 30;
  const outHalf = params.riverHalfAng * 1.5;
  const outStart = (params.poolRadius / sphereRadius) * 0.5;
  const dirOut = (ang) =>
    A.clone().multiplyScalar(Math.cos(ang)).addScaledVector(F, -Math.sin(ang)).normalize();
  const opos = [];
  const ouv = [];
  for (let k = 0; k <= outSegs; k++) {
    const a = outStart + ((params.canyonReachAng || 0.5) - outStart) * (k / outSegs);
    const center = dirOut(a);
    const eL = center.clone().multiplyScalar(Math.cos(outHalf)).addScaledVector(Rt, Math.sin(outHalf)).normalize();
    const eR = center.clone().multiplyScalar(Math.cos(outHalf)).addScaledVector(Rt, -Math.sin(outHalf)).normalize();
    const pL = surfacePoint(eL, 0.6);
    const pR = surfacePoint(eR, 0.6);
    opos.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
    const v = k / outSegs;
    ouv.push(0, v, 1, v);
  }
  const oidx = [];
  for (let k = 0; k < outSegs; k++) {
    const a0 = k * 2, b0 = k * 2 + 1, a1 = k * 2 + 2, b1 = k * 2 + 3;
    oidx.push(a0, b0, a1, b0, b1, a1);
  }
  const outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute('position', new THREE.Float32BufferAttribute(opos, 3));
  outGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ouv, 2));
  outGeo.setIndex(oidx);
  outGeo.computeVertexNormals();
  const outflow = new THREE.Mesh(outGeo, outMat);
  outflow.renderOrder = 2;
  group.add(outflow);

  // ── Per-frame water animation (driven by features.update) ─────
  const update = (timeMs) => {
    const t = (timeMs || 0) * 0.001;
    if (fallTex) fallTex.offset.y = (-t * 0.9) % 1;   // water plunges downward
    if (riverTex) riverTex.offset.y = (-t * 0.25) % 1; // flow toward the falls
    if (outTex) outTex.offset.y = (-t * 0.3) % 1;       // flow down the canyon
    if (poolTex) { poolTex.offset.x = (t * 0.03) % 1; poolTex.offset.y = (t * 0.02) % 1; }
    poolMat.opacity = 0.6 + Math.sin(t * 1.3) * 0.06;
  };

  return { group, update };
}
