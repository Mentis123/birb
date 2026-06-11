// Slalom "Run" — an exciting neon flythrough course through a forest tunnel.
//
// Rebuilt from the sparse cone-corridor into a real course (no custom GLSL, so
// nothing can ship black under the no-local-test workflow):
//  • dense, inward-leaning, tint-varied gate trees (walls)
//  • overhead ARCH RIBS (instanced half-tori) that close the canopy → a tunnel
//  • two glowing EDGE STRIPS with a traveling light-wave (texture-scroll)
//  • reactive CHECKPOINT GATES that pulse/pop + fire an expanding shockwave and
//    chime as you fly through (self-contained — works in free flight)
//  • a START neon arch (RUN sign) and a FINISH gate (checker banner)
//  • floor BOOST CHEVRONS scrolling toward you for speed
//  • a dim backdrop TUBE wrapping the lane (desktop) for tunnel enclosure
//
// Built once per environment by createSphericalWorld, added to the world root.
// Returns { group, update(birdPos, delta, timeMs) }.

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Glowing edge-strip texture: a soft line across U, a bright travelling band
// along V (scroll offset.y to send the pulse down the course).
function makeStripTexture(THREE, hex) {
  const W = 32, H = 256;
  const c = makeCanvas(W, H); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  const col = '#' + hex.toString(16).padStart(6, '0');
  // base soft glow line
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.5, col);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.45; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  // bright travelling band
  const band = ctx.createLinearGradient(0, 0, 0, H * 0.28);
  band.addColorStop(0, 'rgba(255,255,255,0)');
  band.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  band.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = band; ctx.fillRect(0, 0, W, H * 0.28);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Chevrons pointing down-course; scroll toward the player for a speed cue.
function makeChevronTexture(THREE, hex) {
  const W = 64, H = 128;
  const c = makeCanvas(W, H); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  const col = '#' + hex.toString(16).padStart(6, '0');
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.shadowColor = col; ctx.shadowBlur = 10;
  for (let i = 0; i < 3; i++) {
    const y = 20 + i * 40;
    ctx.beginPath();
    ctx.moveTo(10, y + 16); ctx.lineTo(W / 2, y); ctx.lineTo(W - 10, y + 16);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Dark tunnel backdrop with faint neon longitudinal lines + rings.
function makeTubeTexture(THREE) {
  const W = 128, H = 256;
  const c = makeCanvas(W, H); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  ctx.fillStyle = '#05080f'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(60,200,255,0.5)'; ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) { const x = (i + 0.5) * (W / 6); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,80,210,0.55)'; ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) { const y = (i + 0.5) * (H / 4); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeCheckerTexture(THREE) {
  const N = 8, S = 16, size = N * S;
  const c = makeCanvas(size, size / 2); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  for (let y = 0; y < N / 2; y++) for (let x = 0; x < N; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#fff' : '#111';
    ctx.fillRect(x * S, y * S, S, S);
  }
  return new THREE.CanvasTexture(c);
}

function makeSignTexture(THREE, text, glow) {
  // Hi-res so the banner reads from down the course (was 256x128/72px —
  // mushy at distance per playtest).
  const W = 512, H = 192;
  const c = makeCanvas(W, H); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(8,4,16,0.85)';
  roundRect(ctx, 8, 8, W - 16, H - 16, 24); ctx.fill();
  // neon border so the sign reads as signage, not a floating word
  ctx.strokeStyle = glow; ctx.lineWidth = 6;
  ctx.shadowColor = glow; ctx.shadowBlur = 22;
  roundRect(ctx, 12, 12, W - 24, H - 24, 20); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 116px system-ui, -apple-system, sans-serif';
  ctx.shadowBlur = 34;
  ctx.fillStyle = glow; ctx.fillText(text, W / 2, H / 2 + 6);
  ctx.shadowBlur = 12; ctx.fillStyle = '#fff'; ctx.fillText(text, W / 2, H / 2 + 6);
  return new THREE.CanvasTexture(c);
}

function makeHaloSprite(THREE, hex) {
  const s = 64;
  const c = makeCanvas(s, s); if (!c) return null;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  const col = ((hex >> 16) & 255) + ',' + ((hex >> 8) & 255) + ',' + (hex & 255);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, `rgba(${col},0.9)`);
  g.addColorStop(0.5, `rgba(${col},0.3)`);
  g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export function createSlalomRun({
  THREE, sphereRadius, collisionSystem, anchor, forward, right, heightAt, isMobile,
}) {
  const { Vector3, Quaternion, Matrix4, Object3D, Color } = THREE;
  const group = new THREE.Group();
  group.name = 'slalom-run';

  const A = new Vector3(anchor.x, anchor.y, anchor.z).normalize();
  const F0 = new Vector3(forward.x, forward.y, forward.z).normalize();
  const R0 = new Vector3(right.x, right.y, right.z).normalize();
  const up0 = new Vector3(0, 1, 0);
  const safeHeight = (nx, ny, nz) => {
    try { return heightAt ? heightAt(nx, ny, nz) : 0; } catch (e) { return 0; }
  };
  const groundR = (dir) => sphereRadius + safeHeight(dir.x, dir.y, dir.z);

  const CYAN = 0x37e0ff, MAGENTA = 0xff2bd6, AMBER = 0xffaa22, GREEN = 0x33ff88, GOLD = 0xffd34d;
  const FLIGHT_ALT = 7;     // bird flies ~this high over the corridor floor
  const animated = [];      // travelling-pulse textures: { tex, sy }

  // ── Weaving path ──────────────────────────────────────────────
  // Longer course with SWEEPING S-turns. The old weave was per-INDEX
  // (sin(k*0.65) → a new wiggle every ~10 samples ≈ jittery zigzag); the new
  // one is arc-length driven: a slow primary sine (wavelength ~0.36 rad ≈ 43u,
  // max deviation ~30°) plus a faint secondary, with an ease envelope so both
  // arches sit on straight, readable entries.
  const N = isMobile ? 32 : 48;
  const stepAng = 0.015;
  const courseAng = N * stepAng;
  const corridorHalf = 0.058;
  const samples = [];
  for (let k = 0; k <= N; k++) {
    const a = k * stepAng;
    const u = a / courseAng;
    const ease = smooth(0, 0.12, u) * smooth(1, 0.88, u);
    const weave = (Math.sin((a * Math.PI * 2) / 0.36) * 0.034
                 + Math.sin((a * Math.PI * 2) / 0.15 + 1.7) * 0.004) * ease;
    const c = A.clone().multiplyScalar(Math.cos(a)).addScaledVector(F0, Math.sin(a)).normalize();
    samples.push(c.clone().multiplyScalar(Math.cos(weave)).addScaledVector(R0, Math.sin(weave)).normalize());
  }
  const tangentAt = (i) => samples[Math.min(i + 1, N)].clone().sub(samples[Math.max(i - 1, 0)]).normalize();
  const acrossAt = (i) => new Vector3().crossVectors(samples[i], tangentAt(i)).normalize();
  const corridorWidth = corridorHalf * sphereRadius; // ~7 units

  // ── Gate-tree walls (instanced, tinted, leaning inward) ───────
  const rows = isMobile ? 2 : 3;
  const treeCap = (N + 1) * 2 * rows + 8;
  const treeGeo = new THREE.ConeGeometry(1, 1, 7);
  treeGeo.translate(0, 0.5, 0);
  const treeMat = new THREE.MeshLambertMaterial({ flatShading: true });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCap);
  trees.name = 'slalom-gate-trees';
  const dummy = new Object3D();
  const tintA = new Color(0x16401f), tintB = new Color(0x0e2f18), tintC = new Color(0x24532b);
  const tmpCol = new Color();
  let tc = 0;
  for (let i = 2; i <= N; i++) {              // leave the mouth open under the arch
    const acr = acrossAt(i);
    for (let side = -1; side <= 1; side += 2) {
      for (let row = 0; row < rows; row++) {
        const offAng = corridorHalf + row * 0.026;
        const dir = samples[i].clone().multiplyScalar(Math.cos(offAng)).addScaledVector(acr, side * Math.sin(offAng)).normalize();
        const pos = dir.clone().multiplyScalar(groundR(dir));
        // lean the crown inward toward the lane centre
        const lean = 0.18 + row * 0.04;
        const up = dir.clone().multiplyScalar(Math.cos(lean)).addScaledVector(acr, -side * Math.sin(lean)).normalize();
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(up0, up);
        const height = 18 + (row === 0 ? 8 : row * 2) + ((i * 7) % 6);
        const rad = 2.4 + (row === 0 ? 0.7 : 0);
        dummy.scale.set(rad, height, rad);
        dummy.updateMatrix();
        if (tc < treeCap) {
          trees.setMatrixAt(tc, dummy.matrix);
          tmpCol.copy(((i + row) % 3 === 0) ? tintC : (side < 0 ? tintA : tintB));
          trees.setColorAt(tc, tmpCol);
          tc++;
        }
        // Only the innermost row gets a (small) collider — outer rows are
        // decorative depth so the lane centre stays clearly flyable.
        if (row === 0 && collisionSystem && collisionSystem.addCollider) {
          collisionSystem.addCollider(pos, Math.min(rad * 0.3, 0.85), 'tree');
        }
      }
    }
  }
  trees.count = tc;
  trees.instanceMatrix.needsUpdate = true;
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
  if (trees.computeBoundingSphere) trees.computeBoundingSphere();
  group.add(trees);

  // ── Overhead arch ribs (instanced) — closes the canopy ────────
  const ribEvery = isMobile ? 4 : 3;
  const ribR = corridorWidth * 1.12;
  const ribGeo = new THREE.TorusGeometry(ribR, 0.32, 6, 22, Math.PI); // upper half
  const ribMat = new THREE.MeshLambertMaterial({ color: 0x1a140f, flatShading: true });
  const ribAccentGeo = new THREE.TorusGeometry(ribR + 0.35, 0.14, 6, 22, Math.PI);
  const ribAccentMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  let ribN = 0; for (let i = 1; i < N; i += ribEvery) ribN++;
  const ribs = new THREE.InstancedMesh(ribGeo, ribMat, ribN + 2);
  const ribAccents = new THREE.InstancedMesh(ribAccentGeo, ribAccentMat, ribN + 2);
  ribAccents.renderOrder = 2;
  let ri = 0;
  for (let i = 1; i < N; i += ribEvery) {
    const dir = samples[i];
    const up = dir.clone();
    const tan = tangentAt(i);
    const acr = new Vector3().crossVectors(up, tan).normalize();
    const pos = dir.clone().multiplyScalar(groundR(dir));
    dummy.position.copy(pos);
    dummy.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(acr, up, tan)); // torus XY = (across,up)
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    if (ri < ribN + 2) { ribs.setMatrixAt(ri, dummy.matrix); ribAccents.setMatrixAt(ri, dummy.matrix); }
    ri++;
  }
  ribs.count = ri; ribAccents.count = ri;
  ribs.instanceMatrix.needsUpdate = true; ribAccents.instanceMatrix.needsUpdate = true;
  group.add(ribs); group.add(ribAccents);

  // ── Glowing edge strips with travelling light-wave ────────────
  const buildEdgeStrip = (side, hex) => {
    const positions = [], uvs = [];
    const stripHalf = 0.0026; // angular half-width (~0.3 units)
    for (let i = 0; i <= N; i++) {
      const acr = acrossAt(i);
      const edge = samples[i].clone().multiplyScalar(Math.cos(corridorHalf * 1.04)).addScaledVector(acr, side * Math.sin(corridorHalf * 1.04)).normalize();
      const eL = edge.clone().multiplyScalar(Math.cos(stripHalf)).addScaledVector(acr, Math.sin(stripHalf)).normalize();
      const eR = edge.clone().multiplyScalar(Math.cos(stripHalf)).addScaledVector(acr, -Math.sin(stripHalf)).normalize();
      const pL = eL.clone().multiplyScalar(groundR(eL) + 0.4);
      const pR = eR.clone().multiplyScalar(groundR(eR) + 0.4);
      positions.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
      const v = i / N; uvs.push(0, v, 1, v);
    }
    const index = [];
    for (let i = 0; i < N; i++) { const a0 = i * 2, b0 = i * 2 + 1, a1 = i * 2 + 2, b1 = i * 2 + 3; index.push(a0, b0, a1, b0, b1, a1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    const tex = makeStripTexture(THREE, hex);
    if (tex) tex.repeat.set(1, N * 0.18);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex || null, color: hex, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    mesh.renderOrder = 3;
    group.add(mesh);
    if (tex) animated.push({ tex, sy: -0.5 }); // pulse races down-course
  };
  buildEdgeStrip(-1, CYAN);
  buildEdgeStrip(1, MAGENTA);

  // ── Turn-direction arrow boards (signage on the OUTSIDE of each sweep) ──
  // One InstancedMesh (single draw call); the chevron texture scrolls so each
  // board reads as a flowing "this way" arrow pointing INTO the turn, placed
  // at flight altitude on the outer edge — racing-game corner signage.
  const turnTex = makeChevronTexture(THREE, AMBER);
  if (turnTex) turnTex.repeat.set(1, 1);
  const boardGeo = new THREE.PlaneGeometry(3.2, 4.6);
  const boardMat = new THREE.MeshBasicMaterial({
    map: turnTex || null, color: AMBER, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const maxBoards = 10;
  const boards = new THREE.InstancedMesh(boardGeo, boardMat, maxBoards);
  boards.renderOrder = 4;
  let bi = 0, lastBoard = -10;
  for (let i = 4; i <= N - 4 && bi < maxBoards; i++) {
    // Lateral second difference along R0 = turn curvature; sign = direction.
    const curv = samples[i - 3].dot(R0) - 2 * samples[i].dot(R0) + samples[i + 3].dot(R0);
    if (Math.abs(curv) < 0.008 || i - lastBoard < 5) continue;
    lastBoard = i;
    const acr = acrossAt(i);
    const tan = tangentAt(i);
    // Board stands on the OUTSIDE of the turn; chevrons point INTO it.
    const sideSign = curv > 0 ? -1 : 1;
    const off = corridorHalf * 1.3;
    const dirB = samples[i].clone().multiplyScalar(Math.cos(off)).addScaledVector(acr, sideSign * Math.sin(off)).normalize();
    const yB = acr.clone().multiplyScalar(curv > 0 ? 1 : -1).normalize();
    const zB = tan.clone().negate();
    const xB = new Vector3().crossVectors(yB, zB).normalize();
    const zFixB = new Vector3().crossVectors(xB, yB).normalize();
    dummy.position.copy(dirB.clone().multiplyScalar(groundR(dirB) + FLIGHT_ALT - 0.5));
    dummy.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(xB, yB, zFixB));
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    boards.setMatrixAt(bi++, dummy.matrix);
  }
  boards.count = bi;
  boards.instanceMatrix.needsUpdate = true;
  group.add(boards);
  if (turnTex) animated.push({ tex: turnTex, sy: -1.6 });

  // ── Boost chevrons on the floor ───────────────────────────────
  if (!isMobile) {
    const chevTex = makeChevronTexture(THREE, AMBER);
    if (chevTex) chevTex.repeat.set(1, 3);
    const chevGeo = new THREE.PlaneGeometry(corridorWidth * 0.9, 5);
    const chevCount = Math.floor(N / 3);
    const chevs = new THREE.InstancedMesh(chevGeo, new THREE.MeshBasicMaterial({
      map: chevTex || null, color: AMBER, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }), chevCount + 2);
    let ci = 0;
    for (let i = 3; i < N; i += 3) {
      const dir = samples[i]; const up = dir.clone(); const tan = tangentAt(i);
      const acr = new Vector3().crossVectors(up, tan).normalize();
      dummy.position.copy(dir.clone().multiplyScalar(groundR(dir) + 0.3));
      // plane lies flat on the ground (local +Z = up = surface normal). RH basis
      // with local +Y = +tan so the chevrons point DOWN-COURSE (forward).
      dummy.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(acr.clone().negate(), tan, up));
      dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      if (ci < chevCount + 2) chevs.setMatrixAt(ci++, dummy.matrix);
    }
    chevs.count = ci; chevs.instanceMatrix.needsUpdate = true;
    chevs.renderOrder = 2;
    group.add(chevs);
    if (chevTex) animated.push({ tex: chevTex, sy: -0.9 });
  }

  // ── Backdrop tube (desktop) — tunnel wrap ─────────────────────
  if (!isMobile) {
    const curvePts = samples.map((d) => d.clone().multiplyScalar(groundR(d) + FLIGHT_ALT * 0.6));
    const curve = new THREE.CatmullRomCurve3(curvePts);
    const tubeTex = makeTubeTexture(THREE);
    if (tubeTex) tubeTex.repeat.set(1, 10);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, N * 3, corridorWidth * 1.5, 14, false),
      new THREE.MeshBasicMaterial({
        map: tubeTex || null, color: 0x223044, transparent: true, opacity: 0.32,
        side: THREE.BackSide, depthWrite: false,
      }),
    );
    tube.renderOrder = 1;
    group.add(tube);
    if (tubeTex) animated.push({ tex: tubeTex, sy: -0.45 });
  }

  // ── Neon arches: START (RUN) + FINISH (checker) ───────────────
  const haloSprite = makeHaloSprite(THREE, MAGENTA);
  const buildArch = (sampleIdx, label, glow, bannerTex) => {
    const dir = samples[sampleIdx].clone();
    const up = dir.clone();
    const acr = acrossAt(sampleIdx);
    const tan = tangentAt(sampleIdx);
    const base = groundR(dir);
    const archHalf = corridorWidth + 3;
    const archH = FLIGHT_ALT + 12;
    const neon = new THREE.MeshBasicMaterial({ color: glow });
    const glowMat = new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const ag = new THREE.Group();
    const pillarGeo = new THREE.CylinderGeometry(0.5, 0.5, archH, 8);
    const glowPillarGeo = new THREE.CylinderGeometry(1.1, 1.1, archH, 8);
    const footAng = archHalf / base;
    for (let side = -1; side <= 1; side += 2) {
      const fd = dir.clone().multiplyScalar(Math.cos(footAng)).addScaledVector(acr, side * Math.sin(footAng)).normalize();
      const foot = fd.clone().multiplyScalar(groundR(fd) + archH / 2);
      const q = new Quaternion().setFromUnitVectors(up0, fd);
      const p = new THREE.Mesh(pillarGeo, neon); p.position.copy(foot); p.quaternion.copy(q); ag.add(p);
      const gp = new THREE.Mesh(glowPillarGeo, glowMat); gp.position.copy(foot); gp.quaternion.copy(q); gp.renderOrder = 2; ag.add(gp);
      if (haloSprite) {
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloSprite, color: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        halo.position.copy(fd.clone().multiplyScalar(groundR(fd) + archH)); halo.scale.set(6, 6, 1); ag.add(halo);
      }
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(archHalf * 2, 1.1, 1.1), neon);
    lintel.position.copy(dir.clone().multiplyScalar(base + archH));
    lintel.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(acr, up, tan));
    ag.add(lintel);
    const bannerMat = bannerTex
      ? new THREE.MeshBasicMaterial({ map: bannerTex, transparent: true, side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({ color: glow, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(archHalf * 1.8, 8), bannerMat);
    banner.position.copy(dir.clone().multiplyScalar(base + archH - 2.0));
    banner.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(acr.clone().negate(), up, tan.clone().negate()));
    banner.renderOrder = 4;
    ag.add(banner);
    group.add(ag);
    return { group: ag, glowMat };
  };
  const startArch = buildArch(0, 'RUN', MAGENTA, makeSignTexture(THREE, 'RUN', '#ff7be6'));
  const finishArch = buildArch(N, 'FINISH', GOLD, makeCheckerTexture(THREE));

  // ── Checkpoint gates (instanced rings + glow), reactive ───────
  const gateIdx = [];
  for (let i = 4; i < N - 2; i += isMobile ? 5 : 4) gateIdx.push(i);
  const gateR = corridorWidth * 0.82;
  const gateGeo = new THREE.TorusGeometry(gateR, 0.5, 8, 28);
  const gateMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  const gateGlowGeo = new THREE.TorusGeometry(gateR, 1.3, 8, 28);
  const gateGlowMat = new THREE.MeshBasicMaterial({ color: 0x9af3ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
  const gateInst = new THREE.InstancedMesh(gateGeo, gateMat, gateIdx.length + 1);
  const gateGlow = new THREE.InstancedMesh(gateGlowGeo, gateGlowMat, gateIdx.length + 1);
  gateInst.renderOrder = 5; gateGlow.renderOrder = 4;
  const gates = [];
  gateIdx.forEach((i, gi) => {
    const dir = samples[i];
    const center = dir.clone().multiplyScalar(groundR(dir) + FLIGHT_ALT);
    const up = dir.clone(); const tan = tangentAt(i);
    const acr = new Vector3().crossVectors(up, tan).normalize();
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(acr, up, tan));
    dummy.position.copy(center); dummy.quaternion.copy(q); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    gateInst.setMatrixAt(gi, dummy.matrix); gateGlow.setMatrixAt(gi, dummy.matrix);
    gates.push({ center, q, gi, passed: false, popT: 0 });
  });
  gateInst.instanceMatrix.needsUpdate = true; gateGlow.instanceMatrix.needsUpdate = true;
  group.add(gateInst); group.add(gateGlow);

  // Pooled expanding shockwave rings (reused on pass — no per-pass alloc).
  const shockPool = [];
  for (let s = 0; s < 3; s++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(gateR * 0.9, gateR, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.visible = false; m.renderOrder = 6;
    group.add(m);
    shockPool.push({ mesh: m, t: 0, life: 0.45 });
  }
  const fireShock = (center, q) => {
    const s = shockPool.find((x) => x.t <= 0) || shockPool[0];
    s.mesh.position.copy(center); s.mesh.quaternion.copy(q); s.mesh.visible = true;
    s.t = s.life;
  };

  // ── Per-frame ─────────────────────────────────────────────────
  const update = (birdPos, delta, timeMs) => {
    const t = (timeMs || 0) * 0.001;
    const dt = Math.min(Math.max(delta || 0, 0), 0.05);
    for (const a of animated) a.tex.offset.y = (t * a.sy) % 1;
    const pulse = 0.55 + 0.25 * (0.5 + 0.5 * Math.sin(t * 3));
    gateGlowMat.opacity = 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(t * 4));
    gateMat.opacity = pulse;
    ribAccentMat.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.2));
    if (startArch.glowMat) startArch.glowMat.opacity = 0.4 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.6));
    if (finishArch.glowMat) finishArch.glowMat.opacity = 0.4 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.6 + 1));

    let gateDirty = false;
    for (const g of gates) {
      if (g.popT > 0) {
        g.popT -= dt;
        const s = 1 + Math.max(0, g.popT) * 1.4;
        dummy.position.copy(g.center); dummy.quaternion.copy(g.q); dummy.scale.set(s, s, s); dummy.updateMatrix();
        gateInst.setMatrixAt(g.gi, dummy.matrix); gateGlow.setMatrixAt(g.gi, dummy.matrix);
        gateDirty = true;
      }
      if (birdPos) {
        const dx = birdPos.x - g.center.x, dy = birdPos.y - g.center.y, dz = birdPos.z - g.center.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (!g.passed && d2 < 49) {
          g.passed = true; g.popT = 0.4;
          fireShock(g.center, g.q);
          if (typeof window !== 'undefined' && window.playRingSynthChime) {
            try { window.playRingSynthChime(); } catch (e) { /* no-op */ }
          }
        } else if (g.passed && d2 > 2500) { g.passed = false; }
      }
    }
    if (gateDirty) { gateInst.instanceMatrix.needsUpdate = true; gateGlow.instanceMatrix.needsUpdate = true; }

    for (const s of shockPool) {
      if (s.t > 0) {
        s.t -= dt;
        const f = clamp01(1 - s.t / s.life);
        const sc = 1 + f * 2.4;
        s.mesh.scale.set(sc, sc, sc);
        s.mesh.material.opacity = (1 - f) * 0.9;
        if (s.t <= 0) s.mesh.visible = false;
      }
    }
  };

  return { group, update };
}
