import { addEnergyRing } from '../effects/energy-ring.js';
import { visualUniforms } from './visual-style.js';

// Slalom "Run" — an OPEN aerial slalom over the landscape.
//
// The previous version was a tunnel: a seven-unit-wide lane walled by two or
// three rows of inward-leaning trees, roofed with half-torus arch ribs,
// wrapped in a backdrop tube, and signed with chevron boards, floor chevrons
// and a checker banner. Playtest, verbatim: "horrible and too dense and
// doesn't vibe well at all". That is the right read. Six systems competed for
// the same seven units of space, the bird is two units across, and a chase
// camera at the player's own altitude sat INSIDE the wall — which is not a
// framing problem, it is the course telling you it has no room in it.
//
// This is the opposite shape. The course is a line of glowing gates arcing
// through open sky, offset alternately left and right so weaving through them
// IS the game, over a landscape you can see the whole time. What used to be a
// wall is now a sparse line of slim marker pylons set well outside the lane —
// enough to read the course from the air, not enough to fly into.
//
// Everything that enclosed the player is gone: no tree walls, no canopy ribs,
// no backdrop tube, no floor chevrons, no signage boards, no checker banner.
// It costs fewer draw calls and far fewer triangles than the tunnel did.
//
// Built once per environment by createSphericalWorld, added to the world root.
// Returns { group, update(birdPos, delta, timeMs), gates }.

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
  const groundR = (dir) => sphereRadius + safeHeight(dir.x, dir.y, dir.z);

  const CYAN = 0x37e0ff, MAGENTA = 0xff2bd6, GOLD = 0xffd34d;
  // Gates ride at a FIXED radius, not at a fixed height above the ground.
  // That distinction is the whole difference between a course you can fly and
  // one you cannot. The terrain carves DOWNWARD by up to 46 units, so a course
  // pinned to `groundR(dir) + 15` plunges into every valley it crosses and
  // climbs back out — while the bird, which has no gravity and cruises just
  // above the base radius, holds a near-constant altitude. Pinned to the
  // ground the course kept leaving the band the player actually flies in, and
  // every gate it dropped into a valley landed inside the canopy of trees
  // rooted on the rim above it. Pinned to the sphere it stays in the flight
  // band the whole way and reads as one level ribbon from any angle.
  // 30, not 11. The forest's ordinary trees run 14-58 units tall (trunk 8-16
  // plus canopy 8-16, scaled 1-2x) and are rooted at or near the base radius,
  // so a course 11 units up is INSIDE the canopy — every capture had a conifer
  // standing in a gate. At 30 the run clears roughly two thirds of them and
  // the ones that do reach it are emergents standing beside a gate, which
  // reads as a course threading the treetops rather than one buried in them.
  // The bird has no ceiling (the sphere clamp is a floor only), so a course
  // the player has to climb to is a course, not an obstacle.
  const FLIGHT_ALT = 30;              // units above the base radius
  const MIN_CLEAR = 24;               // never closer than this to the ground
  const courseR = (dir, lift = 0) =>
    Math.max(sphereRadius + FLIGHT_ALT + lift, groundR(dir) + MIN_CLEAR + lift);
  const animated = [];      // travelling-pulse textures: { tex, sy }
  const dummy = new Object3D();

  // ── Path ──────────────────────────────────────────────────────
  // A long great-circle sweep with a slow, wide weave. The weave is bigger
  // than the tunnel's (0.034 rad -> 0.055, about 6.6 units of lateral swing)
  // because it no longer has to fit inside a corridor: the whole point is that
  // the course visibly snakes across open country.
  // The old course was 40 samples at 0.016 rad — 77 units end to end, which
  // is shorter than four gate diameters. Everything was crammed because there
  // was nowhere to put it. This is 250-300 units: long enough that gates can
  // sit well apart and the weave has room to actually swing.
  const N = isMobile ? 105 : 130;
  const stepAng = 0.02;
  const courseAng = N * stepAng;
  const samples = [];
  for (let k = 0; k <= N; k++) {
    const a = k * stepAng;
    const u = a / courseAng;
    // Eased at both ends so the start and finish arches sit on straight,
    // readable entries.
    const ease = smooth(0, 0.14, u) * smooth(1, 0.86, u);
    const weave = Math.sin((a * Math.PI * 2) / 0.85) * 0.055 * ease;
    const c = A.clone().multiplyScalar(Math.cos(a)).addScaledVector(F0, Math.sin(a)).normalize();
    samples.push(c.clone().multiplyScalar(Math.cos(weave)).addScaledVector(R0, Math.sin(weave)).normalize());
  }
  const tangentAt = (i) => samples[Math.min(i + 1, N)].clone().sub(samples[Math.max(i - 1, 0)]).normalize();
  const acrossAt = (i) => new Vector3().crossVectors(samples[i], tangentAt(i)).normalize();

  /** A direction offset sideways from the centreline, in world units. */
  const offsetDir = (i, units) => {
    if (!units) return samples[i].clone();
    const ang = units / sphereRadius;
    return samples[i].clone().multiplyScalar(Math.cos(ang))
      .addScaledVector(acrossAt(i), Math.sin(ang)).normalize();
  };

  // ── The race line on the ground ───────────────────────────────
  // One glowing ribbon following the centreline, with a pulse running down it.
  // The tunnel had two of these at the lane EDGES, where they doubled as walls;
  // a single centre line reads as a track from the air and encloses nothing.
  {
    const positions = [], uvs = [], index = [];
    const halfW = 1.6;   // world units
    for (let i = 0; i <= N; i++) {
      const l = offsetDir(i, -halfW), r = offsetDir(i, halfW);
      const pL = l.clone().multiplyScalar(groundR(l) + 0.35);
      const pR = r.clone().multiplyScalar(groundR(r) + 0.35);
      positions.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
      const v = i / N; uvs.push(0, v, 1, v);
    }
    for (let i = 0; i < N; i++) {
      const a0 = i * 2, b0 = i * 2 + 1, a1 = i * 2 + 2, b1 = i * 2 + 3;
      index.push(a0, b0, a1, b0, b1, a1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    const tex = makeStripTexture(THREE, CYAN);
    if (tex) tex.repeat.set(1, N * 0.16);
    const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex || null, color: CYAN, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    line.name = 'slalom-line';
    line.renderOrder = 3;
    group.add(line);
    if (tex) animated.push({ tex, sy: -0.5 });
  }

  // ── Gate beacons ──────────────────────────────────────────────
  // What is left of the walls. The first cut of this rewrite kept a running
  // fence of pylons every five samples at 19 units out — thirty-odd posts —
  // and that reproduced the tunnel's own problem at a wider radius: a line of
  // pale vertical bars threading the trees, dense enough to read as clutter
  // and carrying no information the race line did not already carry.
  //
  // There is now ONE beacon per gate, planted on the outside of that gate's
  // swing, so a post on the ground means "the next gate is over here" and
  // nothing else. Eight posts instead of thirty. No colliders: the lane is
  // open sky and stays that way.
  //
  // They are also NOT the near-white HDR the pylons used. A MeshBasicMaterial
  // at (0.30, 1.55, 2.10) tone-maps to a pale grey-blue stick against a bright
  // dusk sky — the same trap the gates themselves fell into. Just under 1.0
  // keeps the cyan.
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.86, 0.99) });

  // ── Start and finish arches ───────────────────────────────────
  const haloSprite = makeHaloSprite(THREE, MAGENTA);
  const buildArch = (sampleIdx, glow, bannerTex) => {
    const dir = samples[sampleIdx].clone();
    const acr = acrossAt(sampleIdx);
    const tan = tangentAt(sampleIdx);
    const base = groundR(dir);
    const archHalf = 23;
    // Tall enough that the lintel clears the course, wherever the course
    // radius ended up over this piece of ground.
    const archH = (courseR(dir) - base) + 12;
    const neon = new THREE.MeshBasicMaterial({ color: glow });
    const glowMat = new THREE.MeshBasicMaterial({
      color: glow, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ag = new THREE.Group();
    ag.name = 'slalom-arch';
    const pillarGeo = new THREE.CylinderGeometry(0.45, 0.45, archH, 8);
    const glowPillarGeo = new THREE.CylinderGeometry(1.0, 1.0, archH, 8);
    const footAng = archHalf / base;
    for (let side = -1; side <= 1; side += 2) {
      const fd = dir.clone().multiplyScalar(Math.cos(footAng)).addScaledVector(acr, side * Math.sin(footAng)).normalize();
      const foot = fd.clone().multiplyScalar(groundR(fd) + archH / 2);
      const q = new Quaternion().setFromUnitVectors(up0, fd);
      const p = new THREE.Mesh(pillarGeo, neon); p.position.copy(foot); p.quaternion.copy(q); ag.add(p);
      const gp = new THREE.Mesh(glowPillarGeo, glowMat); gp.position.copy(foot); gp.quaternion.copy(q); gp.renderOrder = 2; ag.add(gp);
      if (haloSprite) {
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: haloSprite, color: glow, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        halo.position.copy(fd.clone().multiplyScalar(groundR(fd) + archH));
        halo.scale.set(7, 7, 1);
        ag.add(halo);
      }
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(archHalf * 2, 1.0, 1.0), neon);
    lintel.position.copy(dir.clone().multiplyScalar(base + archH));
    lintel.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(acr, dir.clone(), tan));
    ag.add(lintel);
    // The start gets its RUN sign. The finish used to get a black-and-white
    // checker banner, which at this scale read as construction tape; it is a
    // gold arch now and nothing else.
    if (bannerTex) {
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(archHalf * 1.4, 7),
        new THREE.MeshBasicMaterial({ map: bannerTex, transparent: true, side: THREE.DoubleSide }),
      );
      banner.position.copy(dir.clone().multiplyScalar(base + archH - 2.0));
      banner.quaternion.setFromRotationMatrix(
        new Matrix4().makeBasis(acr.clone().negate(), dir.clone(), tan.clone().negate()),
      );
      banner.renderOrder = 4;
      ag.add(banner);
    }
    group.add(ag);
    return { group: ag, glowMat };
  };
  const startArch = buildArch(0, MAGENTA, makeSignTexture(THREE, 'RUN', '#ff7be6'));
  const finishArch = buildArch(N, GOLD, null);

  // ── The gates, which ARE the course ───────────────────────────
  // Offset alternately left and right of the centreline, and alternately up
  // and down, so getting through them is a weave. On the centreline — where
  // the tunnel put them — a slalom is just a straight line with hoops on it.
  // Spacing has to be several times the gate DIAMETER or consecutive rings
  // overlap on screen and the course reads as a tangle of hoops — which is
  // exactly what a 2-3 sample step gave against a 12.8-unit gate. At 2.4 units
  // per sample, 13 samples is about 31 units between gates.
  const gateIdx = [];
  // Start at 12, not 6: at 2.4 units per sample the first gate was 14 units
  // past the start arch, so the arch's own pillar stood inside it.
  for (let i = 12; i < N - 8; i += 13) gateIdx.push(i);
  const gateR = 6.4;
  const gateGeo = new THREE.TorusGeometry(gateR, 0.42, 8, 28);
  // OPAQUE, and lit by an HDR energy shader rather than by additive blending.
  // Additive cyan on a pale dusk sky is grey — every channel runs to the top
  // of the range and the tone mapper flattens what is left — so these gates,
  // the most important things to see on the whole course, rendered as
  // concrete lifebuoys. An opaque ring has a silhouette against any sky, and
  // the bloom pass supplies the glow the additive blend was reaching for.
  const gateMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  addEnergyRing(gateMat, THREE, visualUniforms.time, {
    tag: 'slalom-gate', glow: [0.32, 1.75, 2.30], base: 0.30, pulses: 12, speed: 0.75,
  });
  // The halo stays additive — it IS a glow and has no silhouette to protect —
  // but faint, because it was most of what muddied the ring.
  const gateGlowGeo = new THREE.TorusGeometry(gateR, 0.8, 8, 28);
  const gateGlowMat = new THREE.MeshBasicMaterial({
    color: 0x9af3ff, transparent: true, opacity: 0.11,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  // Named so the capture harness can solo them.
  const gateInst = new THREE.InstancedMesh(gateGeo, gateMat, gateIdx.length + 1);
  const gateGlow = new THREE.InstancedMesh(gateGlowGeo, gateGlowMat, gateIdx.length + 1);
  gateInst.name = 'slalom-ring'; gateGlow.name = 'slalom-ring-glow';
  gateInst.renderOrder = 5; gateGlow.renderOrder = 4;
  gateInst.raycast = () => {}; gateGlow.raycast = () => {};
  const gates = [];
  gateIdx.forEach((i, gi) => {
    // Swing has to beat the gate DIAMETER or consecutive gates nest inside one
    // another when the camera looks down the course and the weave is invisible.
    // At 9 units each way the centres are 18 apart against a 12.8-unit ring.
    const swing = (gi % 2 === 0 ? 1 : -1) * 9;
    const climb = (gi % 4 < 2 ? 1 : -1) * 3.4;
    const dir = offsetDir(i, swing);
    const center = dir.clone().multiplyScalar(courseR(dir, climb));
    const up = dir.clone();
    const tan = tangentAt(i);
    const acr = new Vector3().crossVectors(up, tan).normalize();
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(acr, up, tan));
    dummy.position.copy(center); dummy.quaternion.copy(q); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    gateInst.setMatrixAt(gi, dummy.matrix); gateGlow.setMatrixAt(gi, dummy.matrix);
    gates.push({ center, q, gi, passed: false, popT: 0 });
  });
  gateInst.count = gates.length; gateGlow.count = gates.length;

  // One beacon per gate, on the outside of that gate's swing.
  {
    const geo = new THREE.CylinderGeometry(0.24, 0.55, 1, 6);
    geo.translate(0, 0.5, 0);
    const posts = new THREE.InstancedMesh(geo, beaconMat, gates.length);
    posts.name = 'slalom-beacons';
    posts.raycast = () => {};
    gateIdx.forEach((i, gi) => {
      const swing = (gi % 2 === 0 ? 1 : -1) * 9;
      const dir = offsetDir(i, swing + Math.sign(swing) * 10);
      dummy.position.copy(dir.clone().multiplyScalar(groundR(dir)));
      dummy.quaternion.setFromUnitVectors(up0, dir);
      // Tall enough to reach its gate: a post that stops at treetop height
      // under a gate 30 units up is two unrelated objects.
      const gateDir = offsetDir(i, swing);
      dummy.scale.set(1, (courseR(gateDir) - groundR(dir)) * 0.88, 1);
      dummy.updateMatrix();
      posts.setMatrixAt(gi, dummy.matrix);
    });
    posts.instanceMatrix.needsUpdate = true;
    if (posts.computeBoundingSphere) posts.computeBoundingSphere();
    group.add(posts);
  }

  gateInst.instanceMatrix.needsUpdate = true; gateGlow.instanceMatrix.needsUpdate = true;
  if (gateInst.computeBoundingSphere) gateInst.computeBoundingSphere();
  if (gateGlow.computeBoundingSphere) gateGlow.computeBoundingSphere();
  group.add(gateInst); group.add(gateGlow);

  // Pooled expanding shockwave rings (reused on pass — no per-pass alloc).
  const shockPool = [];
  for (let s = 0; s < 3; s++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(gateR * 0.9, gateR, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    m.visible = false; m.renderOrder = 6;
    m.raycast = () => {};
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
    gateGlowMat.opacity = 0.07 + 0.07 * (0.5 + 0.5 * Math.sin(t * 4));
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
        // Trigger radius follows the gate: a hardcoded 7 was tuned for a
        // smaller ring and would have gone off outside this one.
        if (!g.passed && d2 < gateR * gateR) {
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

  // gates[] is exposed for the capture harness: photographing a course that
  // sits at one fixed anchor otherwise means flying around until you find it.
  return { group, update, gates };
}
