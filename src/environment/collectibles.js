/**
 * Collectible Ring System for Ring Rush Mode
 *
 * Rings are placed at good flying altitudes around the sphere.
 * Only visible during Ring Rush mode.
 */

const SPHERE_RADIUS = 120;
const RING_ALTITUDE_MIN = 12;  // Above sphere surface (scaled for bigger world)
const RING_ALTITUDE_MAX = 24;
const RING_COUNT = 18;

// Mobile gate — set by index.html. Disables per-frame shimmer color lerp
// (10 uniform updates/frame × 60fps = 600 per sec) and drops the glow/core
// meshes so each ring is 1 draw call instead of 3.
function _isMobile() {
  return typeof window !== 'undefined' && window.__birbIsMobile === true;
}

// Ring visual config - environment-themed colors
const RING_CONFIGS = {
  mountain: { color: 0x44ddff, emissive: 0x22aaff, glow: 0x66eeff },
  forest: { color: 0x44ff88, emissive: 0x22dd66, glow: 0x66ffaa },
  canyons: { color: 0xffaa44, emissive: 0xff8822, glow: 0xffcc66 },
  city: { color: 0x44aaff, emissive: 0x2288ff, glow: 0x66ccff },
};

/**
 * Generate ring positions as an arc-ribbon that snakes around the sphere.
 *
 * Uses pure trig (no THREE imports available here). Builds an orthonormal basis
 * (base, oscUp, tangent) from a random unit vector, then advances around the
 * great-circle defined by (base, tangent) via Rodrigues' rotation, adding a
 * small sine-wave sway along oscUp so the path weaves. Player sees the next
 * 3-4 rings ahead of them forming a readable course to fly.
 */
function generateRingPositions(count = RING_COUNT) {
  const positions = [];

  // --- Build a random orthonormal basis using pure numbers ---
  // Random unit vector on the sphere (uniform via rejection-free method).
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = 1 - 2 * u1;
  const r0 = Math.sqrt(Math.max(0, 1 - z0 * z0));
  const phi0 = 2 * Math.PI * u2;
  let bx = r0 * Math.cos(phi0);
  let by = r0 * Math.sin(phi0);
  let bz = z0;

  // Pick a helper vector not parallel to base.
  let hx = 0, hy = 1, hz = 0;
  if (Math.abs(by) > 0.9) { hx = 1; hy = 0; hz = 0; }

  // oscUp = normalize(helper - (helper·base) * base)  (Gram-Schmidt)
  const dotHB = hx * bx + hy * by + hz * bz;
  let ox = hx - dotHB * bx;
  let oy = hy - dotHB * by;
  let oz = hz - dotHB * bz;
  const oLen = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
  ox /= oLen; oy /= oLen; oz /= oLen;

  // tangent = base × oscUp  (rotation axis for advancing around great circle)
  let tx = by * oz - bz * oy;
  let ty = bz * ox - bx * oz;
  let tz = bx * oy - by * ox;
  const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
  tx /= tLen; ty /= tLen; tz /= tLen;

  // Rodrigues' rotation: rotate vector v around unit axis k by angle a.
  // v_rot = v*cos + (k×v)*sin + k*(k·v)*(1-cos)
  function rotate(vx, vy, vz, kx, ky, kz, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dot = kx * vx + ky * vy + kz * vz;
    const cx = ky * vz - kz * vy;
    const cy = kz * vx - kx * vz;
    const cz = kx * vy - ky * vx;
    return [
      vx * c + cx * s + kx * dot * (1 - c),
      vy * c + cy * s + ky * dot * (1 - c),
      vz * c + cz * s + kz * dot * (1 - c),
    ];
  }

  const stepAngle = (2 * Math.PI * 0.85) / Math.max(1, count - 1); // ~85% of a full loop
  const oscAmplitude = 0.35; // radians of sway

  for (let i = 0; i < count; i++) {
    const t = i * stepAngle;
    const sway = Math.sin(t * 2) * oscAmplitude;

    // Step 1: rotate base around tangent by t (advance along great circle).
    const [ax, ay, az] = rotate(bx, by, bz, tx, ty, tz, t);

    // Step 2: tilt that direction around oscUp by sway (weave perpendicular).
    const [dx, dy, dz] = rotate(ax, ay, az, ox, oy, oz, sway);

    // Normalize (should already be unit, but guard against drift).
    const dLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const nx = dx / dLen;
    const ny = dy / dLen;
    const nz = dz / dLen;

    const altitude = SPHERE_RADIUS + RING_ALTITUDE_MIN +
                     Math.random() * (RING_ALTITUDE_MAX - RING_ALTITUDE_MIN);

    positions.push({
      x: nx * altitude,
      y: ny * altitude,
      z: nz * altitude,
      altitude,
    });
  }

  return positions;
}

/**
 * Create a single ring mesh - small, glowing torus.
 * Pre-allocates color scratch values for zero-alloc shimmer.
 *
 * Mobile: skip glow + core meshes. Rings are still visually obvious (bright
 * emissive torus against fog-tinted sky) and draw-call count drops from
 * 3 meshes × 10 rings = 30 calls to 1 × 10 = 10 calls.
 */
function createRing(THREE, config) {
  const mobile = _isMobile();
  const group = new THREE.Group();
  group.name = 'collectible-ring';

  // Main ring - small torus. Mobile uses a slightly brighter base (lerp toward
  // white once at build) to compensate for the missing glow/core overlays.
  const ringGeo = new THREE.TorusGeometry(2.5, 0.3, mobile ? 8 : 12, mobile ? 16 : 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: mobile
      ? new THREE.Color(config.color).lerp(new THREE.Color(0xffffff), 0.35)
      : config.color,
    transparent: true,
    opacity: 0.95,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  group.add(ring);

  let glowMat = null;
  let coreMat = null;
  let baseColor = null;
  let brightColor = null;

  if (!mobile) {
    // Outer glow
    const glowGeo = new THREE.TorusGeometry(2.9, 0.15, 8, 24);
    glowMat = new THREE.MeshBasicMaterial({
      color: config.glow,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    group.add(glow);

    // Inner bright core
    const coreGeo = new THREE.TorusGeometry(2.3, 0.12, 8, 24);
    coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    // Pre-allocated color endpoints for shimmer (no per-frame allocs).
    // Base = config color (slightly dimmed); bright = base lifted toward white
    // so the ring reads as an emissive pulse rather than a hue shift.
    baseColor = new THREE.Color(config.color).multiplyScalar(0.85);
    brightColor = new THREE.Color(config.color).lerp(new THREE.Color(0xffffff), 0.55);
  }

  // Store for animation
  group.userData.ringMat = ringMat;
  group.userData.glowMat = glowMat;
  group.userData.coreMat = coreMat;
  group.userData.baseColor = baseColor;
  group.userData.brightColor = brightColor;
  group.userData.collected = false;

  return group;
}

/**
 * Main collectibles system
 */
export function createCollectiblesSystem(THREE, scene, environmentId) {
  const config = RING_CONFIGS[environmentId] || RING_CONFIGS.mountain;
  const positions = generateRingPositions(RING_COUNT);

  const container = new THREE.Group();
  container.name = 'collectibles';
  container.visible = false; // Hidden by default - only show in Ring Rush
  scene.add(container);

  const rings = [];
  let animationTime = 0;

  // Scratch vectors for collision detection
  const _scratchPos = new THREE.Vector3();

  // Create rings
  positions.forEach((pos, index) => {
    const ring = createRing(THREE, config);
    ring.position.set(pos.x, pos.y, pos.z);

    // Orient ring to face outward from sphere center
    const radial = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, radial);
    if (right.lengthSq() < 0.01) {
      right.set(1, 0, 0);
    }
    right.normalize();
    const forward = new THREE.Vector3().crossVectors(radial, right).normalize();

    // Make ring face radially (fly through it toward/away from center)
    ring.lookAt(ring.position.x + radial.x, ring.position.y + radial.y, ring.position.z + radial.z);

    ring.userData.index = index;
    container.add(ring);
    rings.push(ring);
  });

  return {
    rings,
    container,

    /**
     * Show/hide all rings (for Ring Rush mode toggle)
     */
    setVisible(visible) {
      container.visible = visible;
    },

    /**
     * Update ring animations.
     * Classic for-loop (no closure alloc per frame). Mobile skips the per-ring
     * shimmer/glow pulse entirely — rings still rotate so they remain alive.
     */
    update(delta) {
      if (!container.visible) return;

      animationTime += delta;
      const mobile = _isMobile();

      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        if (ring.userData.collected) continue;

        // Gentle rotation (cheap — just sets a Euler angle)
        ring.rotation.z += delta * 2;

        if (mobile) {
          // Mobile rings have no glow/core overlays, so they breathe instead:
          // opacity shimmer + slight scale pulse. Transform + uniform updates
          // only — no extra draw calls or fill, and zero per-frame allocs.
          const beat = Math.sin(animationTime * 2.4 + i * 0.9) * 0.5 + 0.5;
          ring.userData.ringMat.opacity = 0.8 + beat * 0.2;
          ring.scale.setScalar(1 + beat * 0.05);
          continue;
        }

        // Pulse glow
        const pulse = Math.sin(animationTime * 3 + i * 0.5) * 0.3 + 0.7;
        ring.userData.glowMat.opacity = 0.4 * pulse;
        ring.userData.coreMat.opacity = 0.6 * pulse;

        // Ring shimmer: subtle sine-wave emissive pulse on the main torus.
        // MeshBasicMaterial has no emissive prop, so we lerp the existing
        // color in place between pre-allocated base/bright endpoints.
        // shimmerT in [0, 1], biased low so it glimmers, not strobes.
        const shimmerT = (Math.sin(animationTime * 2.2 + i * 1.37) * 0.5 + 0.5) * 0.55;
        ring.userData.ringMat.color.lerpColors(
          ring.userData.baseColor,
          ring.userData.brightColor,
          shimmerT
        );
      }
    },

    /**
     * Check for ring collection.
     * Squared-distance compare (no Math.sqrt). Classic for-loop (no closure).
     */
    checkCollection(birbPosition, radius = 1.2) {
      if (!container.visible) return [];

      const collected = [];
      const threshold = radius + 2.5; // ring outer radius
      const threshSq = threshold * threshold;

      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        if (ring.userData.collected) continue;

        ring.getWorldPosition(_scratchPos);
        const dx = birbPosition.x - _scratchPos.x;
        const dy = birbPosition.y - _scratchPos.y;
        const dz = birbPosition.z - _scratchPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < threshSq) {
          ring.userData.collected = true;
          ring.visible = false;
          collected.push(i);
        }
      }

      return collected;
    },

    /**
     * Get collection stats
     */
    getStats() {
      const total = rings.length;
      const collected = rings.filter(r => r.userData.collected).length;
      return { collected, total };
    },

    /**
     * Reset all rings
     */
    reset() {
      rings.forEach((ring) => {
        ring.userData.collected = false;
        ring.visible = true;
      });
    },

    /**
     * Dispose resources
     */
    dispose() {
      rings.forEach((ring) => {
        ring.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      });
      scene.remove(container);
    },
  };
}
