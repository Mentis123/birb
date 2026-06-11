// Landmark valley — the dramatic carved feature's WATER, rebuilt for volume.
//
// The basin + canyon are carved into the terrain by valleyCarveAt() in
// spherical-world.js (the single source of truth for the mesh AND flight floor,
// Math.min(0,…) carve-down). This module only adds the water, and rides the real
// ground via the heightAt() probe so nothing here touches the floor.
//
// Technique (no custom GLSL — robust for YOLO-to-prod, no local test):
//  • a multi-octave, domain-warped TURBULENT streak texture (not straight lines)
//  • 3 forward-bowed, depth-offset cascade sheets scrolling at desynced speeds
//    for real parallax volume, with a baked lip (top) and foam (base)
//  • an additive THREE.Points MIST/SPLASH column at the impact line
//  • a real pool: depth-graded vertex colours + a scrolling caustic disc + a
//    frothy shoreline foam ring
//  • inflow + long outflow rivers that hug the carved canyon floor
//
// Returns { group, update(delta, timeMs) }; added to the world root.

// ── tiny procedural-texture toolkit ──────────────────────────────
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Tileable fBm value noise on a wrapped lattice (seamless for scrolling).
function makeNoise(seed, cellsX, cellsY, octaves) {
  const rng = makeRng(seed);
  const layers = [];
  let cx = cellsX, cy = cellsY, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = rng();
    layers.push({ lat, cx, cy, amp });
    norm += amp; amp *= 0.5; cx *= 2; cy *= 2;
  }
  return (u, v) => {
    u = ((u % 1) + 1) % 1; v = ((v % 1) + 1) % 1;
    let sum = 0;
    for (const L of layers) {
      const x = u * L.cx, y = v * L.cy;
      const x0 = Math.floor(x) % L.cx, y0 = Math.floor(y) % L.cy;
      const x1 = (x0 + 1) % L.cx, y1 = (y0 + 1) % L.cy;
      const fx = x - Math.floor(x), fy = y - Math.floor(y);
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const r0 = y0 * L.cx, r1 = y1 * L.cx;
      const a = L.lat[r0 + x0] + (L.lat[r0 + x1] - L.lat[r0 + x0]) * sx;
      const b = L.lat[r1 + x0] + (L.lat[r1 + x1] - L.lat[r1 + x0]) * sx;
      sum += (a + (b - a) * sy) * L.amp;
    }
    return sum / norm;
  };
}

function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Ropey, wavering vertical streaks — the core "this is falling water" texture.
function makeCascadeTexture(THREE, seed) {
  const W = 256, H = 512;
  const c = makeCanvas(W, H); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  const base = makeNoise(seed, 5, 22, 3);
  const warp = makeNoise(seed + 911, 3, 7, 2);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const lip = smooth(0.1, 0.0, v);   // bright crest near canvas top
    const foam = smooth(0.84, 1.0, v); // froth near canvas bottom
    for (let x = 0; x < W; x++) {
      let u = x / W;
      u += (warp(u, v) - 0.5) * 0.2;    // domain-warp so streaks waver
      const n = smooth(0.42, 0.72, base(u, v)); // carve distinct ropes
      const bright = clamp01(n * 0.85 + lip * 0.6 + foam * 0.75);
      const i = (y * W + x) * 4;
      img.data[i] = lerp(38, 236, bright);
      img.data[i + 1] = lerp(126, 247, bright);
      img.data[i + 2] = lerp(158, 255, bright);
      img.data[i + 3] = Math.min(255, (n * 0.8 + lip * 0.55 + foam * 0.65) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Blobby cellular foam (pool shoreline + crest).
function makeFoamTexture(THREE, seed, size = 256) {
  const c = makeCanvas(size, size); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  const rng = makeRng(seed);
  const pts = [];
  for (let i = 0; i < 28; i++) pts.push([rng(), rng()]);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let nearest = 9;
      for (const p of pts) {
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const dx = u - (p[0] + ox), dy = v - (p[1] + oy);
          const d = dx * dx + dy * dy;
          if (d < nearest) nearest = d;
        }
      }
      const cell = 1 - smooth(0.0, 0.05, nearest); // bright near cell centres
      const i = (y * size + x) * 4;
      img.data[i] = 245; img.data[i + 1] = 252; img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, cell * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Bright caustic veins for the pool floor.
function makeCausticTexture(THREE, seed, size = 256) {
  const c = makeCanvas(size, size); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  const n1 = makeNoise(seed, 6, 6, 3);
  const n2 = makeNoise(seed + 7, 8, 8, 2);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const veins = 1 - Math.abs(n1(u, v) - n2(u, v)) * 4; // thin bright veins
      const cau = clamp01(veins);
      const i = (y * size + x) * 4;
      img.data[i] = 210; img.data[i + 1] = 245; img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, cau * cau * 220);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Gentle ripple for the river ribbons (with foam-bright banks).
function makeRippleTexture(THREE, seed) {
  const W = 128, H = 256;
  const c = makeCanvas(W, H); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  const n = makeNoise(seed, 4, 10, 2);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const ripple = n(u, v);
      const bank = Math.max(smooth(0.18, 0.0, u), smooth(0.82, 1.0, u)); // froth at banks
      const bright = clamp01(ripple * 0.6 + 0.25 + bank * 0.6);
      const i = (y * W + x) * 4;
      img.data[i] = lerp(46, 210, bright);
      img.data[i + 1] = lerp(132, 240, bright);
      img.data[i + 2] = lerp(176, 255, bright);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Soft radial sprite for additive mist droplets.
function makeSoftSprite(THREE) {
  const s = 64;
  const c = makeCanvas(s, s); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(234,246,255,1)');
  g.addColorStop(0.4, 'rgba(210,238,255,0.55)');
  g.addColorStop(1, 'rgba(210,238,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
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
  const dirTo = (ang, towardF) =>
    A.clone().multiplyScalar(Math.cos(ang)).addScaledVector(F, (towardF ? 1 : -1) * Math.sin(ang)).normalize();
  const surfacePoint = (dir, extra = 0) =>
    dir.clone().multiplyScalar(sphereRadius + safeHeight(dir.x, dir.y, dir.z) + extra);

  const animated = []; // { tex, sx, sy }
  const scroll = (tex, sx, sy) => { if (tex) animated.push({ tex, sx, sy }); };

  // ── Geometry frame for the falls (planted ON the carved headwall) ──
  // The bowl wall at the rim is a SLOPE, not a vertical cliff — a vertical
  // sheet hanging at the rim reads as a free-floating billboard (the bug in
  // the 2026-06-11 playtest screenshots). Instead the sheet leans down the
  // headwall: TOP at the rim lip (where the inflow river ends), BASE at the
  // pool surface just inside the pool's upstream edge.
  const rimAng = params.radiusAng * 0.92;
  const rimDir = dirTo(rimAng, true);
  const rimTop = surfacePoint(rimDir, 0.4);
  const poolCenter = surfacePoint(A, 1.2);
  const poolLevelR = poolCenter.length();
  const baseDir = dirTo((params.poolRadius * 0.55) / sphereRadius, true);
  const fallBase = baseDir.clone().multiplyScalar(poolLevelR + 0.2);
  const fallSpan = rimTop.clone().sub(fallBase);
  const drop = Math.max(8, fallSpan.length());

  const yAxis = fallSpan.clone().normalize();    // local +Y = up along the slope
  const zRaw = F.clone().negate();               // faces the downstream approach
  const xAxis = new Vector3().crossVectors(yAxis, zRaw).normalize();
  const zFix = new Vector3().crossVectors(xAxis, yAxis).normalize();
  const fallBasis = new Matrix4().makeBasis(xAxis, yAxis, zFix);
  const fallCenter = fallBase.clone().addScaledVector(fallSpan, 0.5);

  // ── Cascade sheets (parallax volume) ──────────────────────────
  // Sized to the channel, not the whole basin mouth — and translucent enough
  // that the terrain reads through the back layers (no white wall).
  const fallWidth = params.poolRadius * 1.25;
  const fallHeight = drop + 2;
  const layerCount = isMobile ? 2 : 3;
  const layerSpeed = [0.62, 1.07, 1.63];
  const layerOpacity = [0.85, 0.6, 0.42];
  const layerColor = [0x1d6f86, 0x3fa3c4, 0xbfe6f2];
  const cascadeTex = [makeCascadeTexture(THREE, 7), makeCascadeTexture(THREE, 23), makeCascadeTexture(THREE, 51)];
  const sheets = [];
  for (let i = 0; i < layerCount; i++) {
    const geo = new THREE.PlaneGeometry(fallWidth, fallHeight, 1, 16);
    const pos = geo.getAttribute('position');
    for (let vi = 0; vi < pos.count; vi++) {
      const ly = pos.getY(vi);
      const uvY = ly / fallHeight + 0.5;            // 0 base → 1 top
      const bow = Math.sin(Math.PI * uvY) * 1.6;    // forward-bow for volume
      const flare = smooth(0.2, 0.0, uvY) * 1.2;    // flare at the base
      pos.setZ(vi, bow + flare);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const tex = cascadeTex[i] || cascadeTex[0];
    if (tex) tex.repeat.set(1, 2.4);
    const mat = new THREE.MeshBasicMaterial({
      map: tex || null, color: layerColor[i], transparent: true,
      opacity: layerOpacity[i], depthWrite: false, side: THREE.DoubleSide,
    });
    const sheet = new THREE.Mesh(geo, mat);
    sheet.quaternion.setFromRotationMatrix(fallBasis);
    sheet.position.copy(fallCenter).addScaledVector(zFix, i * 0.5);
    sheet.renderOrder = 3 + i;
    group.add(sheet);
    sheets.push(sheet);
    scroll(tex, 0, -layerSpeed[i]);
  }

  // ── Mist / splash column (additive Points) ────────────────────
  const sprite = makeSoftSprite(THREE);
  const mistCount = isMobile ? 140 : 360;
  const mPos = new Float32Array(mistCount * 3);
  const mCol = new Float32Array(mistCount * 3);
  const mVel = new Float32Array(mistCount * 3);
  const mLife = new Float32Array(mistCount);
  const mMax = new Float32Array(mistCount);
  const P0 = fallBase.clone();                // local origin (the impact line)
  const upA = A.clone(), riA = Rt.clone(), fwA = F.clone();
  const seedRng = makeRng(1337);
  // Particle state lives in a local (right,up,fwd) frame; world pos is derived
  // each frame so the mist stays anchored to the falls as the world rotates.
  const lCoord = new Float32Array(mistCount * 3);
  const spawnLocal = (k, initial) => {
    lCoord[k * 3] = (seedRng() - 0.5) * fallWidth * 0.9;
    lCoord[k * 3 + 1] = initial ? seedRng() * drop : seedRng() * 2.0;
    lCoord[k * 3 + 2] = (seedRng() - 0.5) * params.poolRadius * 0.5;
    mVel[k * 3] = (seedRng() - 0.5) * 1.2;
    mVel[k * 3 + 1] = 1.0 + seedRng() * 2.4;
    mVel[k * 3 + 2] = (seedRng() - 0.5) * 1.2;
    mMax[k] = 1.2 + seedRng() * 1.8;
    mLife[k] = initial ? seedRng() * mMax[k] : mMax[k];
  };
  for (let k = 0; k < mistCount; k++) { spawnLocal(k, true); }
  const writeWorld = () => {
    for (let k = 0; k < mistCount; k++) {
      const lx = lCoord[k * 3], ly = lCoord[k * 3 + 1], lz = lCoord[k * 3 + 2];
      mPos[k * 3] = P0.x + riA.x * lx + upA.x * ly + fwA.x * lz;
      mPos[k * 3 + 1] = P0.y + riA.y * lx + upA.y * ly + fwA.y * lz;
      mPos[k * 3 + 2] = P0.z + riA.z * lx + upA.z * ly + fwA.z * lz;
      const f = clamp01(mLife[k] / mMax[k]);
      const b = smooth(0, 0.3, f) * smooth(1, 0.6, f) * 0.9; // fade in/out
      mCol[k * 3] = b * 0.92; mCol[k * 3 + 1] = b * 0.97; mCol[k * 3 + 2] = b;
    }
  };
  writeWorld();
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  mistGeo.setAttribute('color', new THREE.BufferAttribute(mCol, 3));
  const mistMat = new THREE.PointsMaterial({
    size: 2.2, map: sprite || null, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const mist = new THREE.Points(mistGeo, mistMat);
  mist.frustumCulled = false;
  mist.renderOrder = 8;
  group.add(mist);

  // ── Pool: depth-graded surface + caustics + foam ring ─────────
  const poolGeo = new THREE.CircleGeometry(params.poolRadius, 40);
  const pcol = new Float32Array(poolGeo.getAttribute('position').count * 3);
  const ppos = poolGeo.getAttribute('position');
  const deep = new THREE.Color(0x0c4a63), shallow = new THREE.Color(0x2f9fc8);
  const tmpC = new THREE.Color();
  for (let i = 0; i < ppos.count; i++) {
    const r = Math.hypot(ppos.getX(i), ppos.getY(i)) / params.poolRadius;
    tmpC.copy(deep).lerp(shallow, smooth(0.1, 1.0, r));
    pcol[i * 3] = tmpC.r; pcol[i * 3 + 1] = tmpC.g; pcol[i * 3 + 2] = tmpC.b;
  }
  poolGeo.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
  const poolMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.position.copy(poolCenter);
  pool.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), A);
  pool.renderOrder = 2;
  group.add(pool);

  const causticTex = makeCausticTexture(THREE, 88, isMobile ? 128 : 256);
  if (causticTex) causticTex.repeat.set(3, 3);
  const caustic = new THREE.Mesh(
    new THREE.CircleGeometry(params.poolRadius * 0.96, 40),
    new THREE.MeshBasicMaterial({
      map: causticTex || null, color: 0x9fe8ff, transparent: true, opacity: 0.34,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
  );
  caustic.position.copy(poolCenter).addScaledVector(A, 0.3);
  caustic.quaternion.copy(pool.quaternion);
  caustic.renderOrder = 4;
  group.add(caustic);
  scroll(causticTex, 0.018, 0.012);

  const foamTex = makeFoamTexture(THREE, 12, isMobile ? 128 : 256);
  if (foamTex) foamTex.repeat.set(8, 1);
  const foamRing = new THREE.Mesh(
    new THREE.RingGeometry(params.poolRadius * 0.86, params.poolRadius * 1.06, 56),
    new THREE.MeshBasicMaterial({
      map: foamTex || null, color: 0xf2fbff, transparent: true, opacity: 0.85,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  foamRing.position.copy(poolCenter).addScaledVector(A, 0.4);
  foamRing.quaternion.copy(pool.quaternion);
  foamRing.renderOrder = 5;
  const foamRingMat = foamRing.material;
  group.add(foamRing);
  scroll(foamTex, 0.25, 0);

  // ── Inflow + outflow river ribbons ────────────────────────────
  // The old ribbons had only LEFT/RIGHT vertex columns, each sampling terrain
  // at its OWN direction — which lands on the channel WALLS (carve tapers to
  // zero at the channel half-angle), so the water bridged flat across the TOP
  // of the carve instead of lying in it. The outflow was even built WIDER
  // (riverHalfAng*1.5 = 0.075) than its canyon carve (canyonHalfAng = 0.062).
  // Fix: three columns (L/C/R), edges tucked at 65% of the CARVE half-angle,
  // every column riding the CENTERLINE floor height (+lift) with a slight
  // center dip — the water now sits down inside the channel and follows it.
  const buildRibbon = (towardF, fromAng, toAng, carveHalf, segs, tex, opacity, color) => {
    const half = carveHalf * 0.65;
    const positions = [], uvs = [];
    for (let k = 0; k <= segs; k++) {
      const a = fromAng + (toAng - fromAng) * (k / segs);
      const center = dirTo(a, towardF);
      const floorH = safeHeight(center.x, center.y, center.z);
      const rad = sphereRadius + floorH + 0.55;
      const eL = center.clone().multiplyScalar(Math.cos(half)).addScaledVector(Rt, Math.sin(half)).normalize();
      const eR = center.clone().multiplyScalar(Math.cos(half)).addScaledVector(Rt, -Math.sin(half)).normalize();
      const pL = eL.multiplyScalar(rad);
      const pC = center.clone().multiplyScalar(rad - 0.3); // gentle U cross-section
      const pR = eR.multiplyScalar(rad);
      positions.push(pL.x, pL.y, pL.z, pC.x, pC.y, pC.z, pR.x, pR.y, pR.z);
      const v = k / segs; uvs.push(0, v, 0.5, v, 1, v);
    }
    const index = [];
    for (let k = 0; k < segs; k++) {
      const l0 = k * 3, c0 = k * 3 + 1, r0 = k * 3 + 2;
      const l1 = l0 + 3, c1 = c0 + 3, r1 = r0 + 3;
      index.push(l0, c0, l1, c0, c1, l1, c0, r0, c1, r0, r1, c1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    if (tex) tex.repeat.set(1, segs * 0.5);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex || null, color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    }));
    mesh.renderOrder = 1;
    group.add(mesh);
    return mesh;
  };
  const inTex = makeRippleTexture(THREE, 5);
  buildRibbon(true, rimAng, params.riverReachAng, params.riverHalfAng, isMobile ? 14 : 22, inTex, 0.82, 0xffffff);
  scroll(inTex, 0, -0.25);
  const outTex = makeRippleTexture(THREE, 9);
  buildRibbon(false, (params.poolRadius / sphereRadius) * 0.85, params.canyonReachAng || 0.5,
    params.canyonHalfAng || params.riverHalfAng, isMobile ? 24 : 38, outTex, 0.82, 0xffffff);
  scroll(outTex, 0, -0.32);

  // ── Per-frame ─────────────────────────────────────────────────
  const update = (delta, timeMs) => {
    const t = (timeMs || 0) * 0.001;
    const dt = Math.min(Math.max(delta || 0, 0), 0.05);
    for (const a of animated) {
      if (a.sx) a.tex.offset.x = (t * a.sx) % 1;
      if (a.sy) a.tex.offset.y = (t * a.sy) % 1;
    }
    if (foamRingMat) foamRingMat.opacity = 0.7 + Math.sin(t * 1.6) * 0.15;
    // integrate mist (in-place, zero alloc)
    for (let k = 0; k < mistCount; k++) {
      mLife[k] -= dt;
      if (mLife[k] <= 0 || lCoord[k * 3 + 1] < -1) { spawnLocal(k, false); }
      else {
        lCoord[k * 3] += mVel[k * 3] * dt;
        lCoord[k * 3 + 1] += mVel[k * 3 + 1] * dt;
        lCoord[k * 3 + 2] += mVel[k * 3 + 2] * dt;
        mVel[k * 3 + 1] -= 2.2 * dt; // gravity
      }
    }
    writeWorld();
    mistGeo.getAttribute('position').needsUpdate = true;
    mistGeo.getAttribute('color').needsUpdate = true;
  };

  return { group, update };
}
