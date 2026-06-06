// Slalom "Run" — a procedural course planted in every environment.
//
//  • A weaving spline path on the sphere surface.
//  • Two walls of instanced gate trees hugging the path edges → a tunnel
//    through the forest (one InstancedMesh, zero draw-call growth).
//  • A glowing neon arch + canvas "RUN" sign marking the entrance.
//  • A line of neon ring-gates down the centerline that CHIME as you fly
//    through them (self-contained pass-through detection, so it works in free
//    flight in every biome — it calls window.playRingSynthChime()).
//
// Built once per environment by createSphericalWorld, added to the world root
// (rotates + disposes with the world). All geometry rides the real ground via
// the heightAt() probe.

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeRunSignTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(8,4,16,0.82)';
  roundRect(ctx, 6, 6, w - 12, h - 12, 16); ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 84px system-ui, -apple-system, sans-serif';
  ctx.shadowColor = '#ff2bd6';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#ff7be6';
  ctx.fillText('RUN', w / 2, h / 2 + 4);
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#fff0fb';
  ctx.fillText('RUN', w / 2, h / 2 + 4);
  return new THREE.CanvasTexture(c);
}

export function createSlalomRun({
  THREE, sphereRadius, collisionSystem, anchor, forward, right, heightAt, isMobile,
}) {
  const { Vector3, Quaternion, Matrix4, Object3D } = THREE;
  const group = new THREE.Group();
  group.name = 'slalom-run';

  const A = new Vector3(anchor.x, anchor.y, anchor.z).normalize();
  const F0 = new Vector3(forward.x, forward.y, forward.z).normalize();
  const R0 = new Vector3(right.x, right.y, right.z).normalize();
  const up0 = new Vector3(0, 1, 0);
  const safeHeight = (nx, ny, nz) => {
    try { return heightAt ? heightAt(nx, ny, nz) : 0; } catch (e) { return 0; }
  };

  // ── Weaving path: advance along F0, swing across R0 with a sine ──
  const N = isMobile ? 22 : 34;       // long run through the forest
  const stepAng = isMobile ? 0.018 : 0.016;
  const weaveAmp = 0.034;
  const weaveFreq = 0.7;               // gentler, longer S-curves over the longer path
  const corridorHalf = 0.058;         // gate offset across (~7 units) — wide enough to fly through
  const samples = [];
  for (let k = 0; k <= N; k++) {
    const a = k * stepAng;
    const weave = Math.sin(k * weaveFreq) * weaveAmp;
    const c = A.clone().multiplyScalar(Math.cos(a)).addScaledVector(F0, Math.sin(a)).normalize();
    const cw = c.clone().multiplyScalar(Math.cos(weave)).addScaledVector(R0, Math.sin(weave)).normalize();
    samples.push(cw);
  }
  const tangentAt = (i) => {
    const next = samples[Math.min(i + 1, samples.length - 1)];
    const prev = samples[Math.max(i - 1, 0)];
    return next.clone().sub(prev).normalize();
  };
  const acrossAt = (i) => new Vector3().crossVectors(samples[i], tangentAt(i)).normalize();

  // ── Gate-tree walls (single InstancedMesh) ────────────────────
  const rows = isMobile ? 1 : 2;
  const capacity = (N + 1) * 2 * rows + 4;
  const gateGeo = new THREE.ConeGeometry(1, 1, 7);
  gateGeo.translate(0, 0.5, 0); // base at origin, grows +Y
  const gateMat = new THREE.MeshLambertMaterial({ color: 0x12351f, flatShading: true });
  const gates = new THREE.InstancedMesh(gateGeo, gateMat, capacity);
  gates.name = 'slalom-gate-trees';
  const dummy = new Object3D();
  let gc = 0;
  // Start the walls a couple of samples IN so the mouth under the arch is a
  // clear, open gateway you can fly straight into (was walled at sample 0).
  for (let i = 2; i <= N; i++) {
    const acr = acrossAt(i);
    for (let side = -1; side <= 1; side += 2) {
      for (let row = 0; row < rows; row++) {
        const offAng = corridorHalf + row * 0.024;
        const dir = samples[i].clone()
          .multiplyScalar(Math.cos(offAng))
          .addScaledVector(acr, side * Math.sin(offAng))
          .normalize();
        const h = safeHeight(dir.x, dir.y, dir.z);
        const pos = dir.clone().multiplyScalar(sphereRadius + h);
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(up0, dir);
        const height = 16 + (row === 0 ? 6 : 0) + ((i * 7) % 5);
        const rad = 2.2 + (row === 0 ? 0.6 : 0);
        dummy.scale.set(rad, height, rad);
        dummy.updateMatrix();
        if (gc < capacity) gates.setMatrixAt(gc++, dummy.matrix);
        if (collisionSystem && collisionSystem.addCollider) {
          // Small colliders only — clip a trunk and you bump, but the centre of
          // the corridor stays clearly open so the Run is flyable.
          collisionSystem.addCollider(pos, Math.min(rad * 0.35, 0.9), 'tree');
        }
      }
    }
  }
  gates.count = gc;
  gates.instanceMatrix.needsUpdate = true;
  if (gates.computeBoundingSphere) gates.computeBoundingSphere();
  group.add(gates);

  // ── Neon arch + RUN sign at the entrance ──────────────────────
  const entry = samples[0].clone();
  const entryUp = entry.clone();
  const entryAcross = acrossAt(0);
  const entryTan = tangentAt(0);
  const baseR = sphereRadius + safeHeight(entry.x, entry.y, entry.z);
  const archHalf = 10;   // wider than the corridor so you fly THROUGH the arch into it
  const archH = 18;
  const neonMat = new THREE.MeshBasicMaterial({ color: 0xff2bd6 });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff7be6, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pillarGeo = new THREE.CylinderGeometry(0.45, 0.45, archH, 8);
  const glowPillarGeo = new THREE.CylinderGeometry(1.0, 1.0, archH, 8);
  const archGroup = new THREE.Group();
  archGroup.name = 'run-arch';
  const footAng = archHalf / baseR;
  for (let side = -1; side <= 1; side += 2) {
    const footDir = entry.clone()
      .multiplyScalar(Math.cos(footAng))
      .addScaledVector(entryAcross, side * Math.sin(footAng))
      .normalize();
    const foot = footDir.clone().multiplyScalar(
      sphereRadius + safeHeight(footDir.x, footDir.y, footDir.z) + archH / 2);
    const q = new Quaternion().setFromUnitVectors(up0, footDir);
    const pillar = new THREE.Mesh(pillarGeo, neonMat);
    pillar.position.copy(foot); pillar.quaternion.copy(q);
    archGroup.add(pillar);
    const gp = new THREE.Mesh(glowPillarGeo, glowMat);
    gp.position.copy(foot); gp.quaternion.copy(q); gp.renderOrder = 2;
    archGroup.add(gp);
  }
  // Lintel across the top
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(archHalf * 2, 1.0, 1.0), neonMat);
  lintel.position.copy(entry.clone().multiplyScalar(baseR + archH));
  lintel.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(entryAcross, entryUp, entryTan));
  archGroup.add(lintel);
  // "RUN" sign on the lintel, facing the approach (−tangent). RH basis:
  // x = −across, y = up, z = −tangent  (so the text isn't mirrored).
  const signTex = makeRunSignTexture(THREE);
  const signMat = signTex
    ? new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide })
    : new THREE.MeshBasicMaterial({ color: 0xff7be6, side: THREE.DoubleSide });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), signMat);
  sign.position.copy(entry.clone().multiplyScalar(baseR + archH - 1.5));
  sign.quaternion.setFromRotationMatrix(
    new Matrix4().makeBasis(entryAcross.clone().negate(), entryUp, entryTan.clone().negate()));
  sign.renderOrder = 3;
  archGroup.add(sign);
  group.add(archGroup);

  // ── Neon ring-gates down the centerline ───────────────────────
  const ringEvery = isMobile ? 4 : 3;
  const ringAlt = 11;
  const ringR = 4.2, ringTube = 0.5;
  const ringGeo = new THREE.TorusGeometry(ringR, ringTube, 8, 20);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x37e0ff });
  const ringGlowGeo = new THREE.TorusGeometry(ringR, ringTube * 2.2, 8, 20);
  const ringGates = [];
  for (let i = 2; i <= N; i += ringEvery) {
    const dir = samples[i].clone();
    const h = safeHeight(dir.x, dir.y, dir.z);
    const center = dir.clone().multiplyScalar(sphereRadius + h + ringAlt);
    const tan = tangentAt(i);
    const across = new Vector3().crossVectors(dir, tan).normalize();
    // Torus hole faces +Z local → map local Z to the path tangent.
    const rm = new Matrix4().makeBasis(across, dir.clone(), tan);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(center); ring.quaternion.setFromRotationMatrix(rm);
    const glow = new THREE.Mesh(ringGlowGeo, new THREE.MeshBasicMaterial({
      color: 0x9af3ff, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.position.copy(center); glow.quaternion.copy(ring.quaternion); glow.renderOrder = 2;
    group.add(ring); group.add(glow);
    ringGates.push({ ring, glow, center, passed: false, popT: 0 });
  }

  // ── Per-frame: neon pulse, ring spin, pass-through chime ──────
  const update = (birdPos, delta, timeMs) => {
    const t = (timeMs || 0) * 0.001;
    const dt = delta || 0;
    glowMat.opacity = 0.3 + 0.18 * (0.5 + 0.5 * Math.sin(t * 4));
    for (const g of ringGates) {
      g.ring.rotateZ(dt * 1.2);          // spin in the ring's own plane
      g.glow.quaternion.copy(g.ring.quaternion);
      if (g.popT > 0) {
        g.popT -= dt;
        const s = 1 + Math.max(0, g.popT) * 0.8;
        g.ring.scale.setScalar(s);
        g.glow.scale.setScalar(s);
      }
      if (birdPos) {
        const dx = birdPos.x - g.center.x, dy = birdPos.y - g.center.y, dz = birdPos.z - g.center.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (!g.passed && d2 < 36) {        // flew within ~6 units of the hole
          g.passed = true;
          g.popT = 0.35;
          if (typeof window !== 'undefined' && window.playRingSynthChime) {
            try { window.playRingSynthChime(); } catch (e) { /* no-op */ }
          }
        } else if (g.passed && d2 > 1600) { // re-arm once well clear (>40 units)
          g.passed = false;
        }
      }
    }
  };

  return { group, update };
}
