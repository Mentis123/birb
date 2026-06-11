/**
 * Minimap radar — extracted verbatim from index.html as the first "seam"
 * extraction recommended by CODEBASE_EVALUATION.md.
 *
 * Design: the module owns the canvas (sizing, dragging, drawing) but NO game
 * state — bird pose, rings, drones, nests, and the current mode all arrive as
 * update() arguments. THREE is injected (no CDN import), so the pure
 * projection helpers below unit-test under plain `node --test`.
 *
 * Zero-allocation: all scratch vectors/points are created once in the
 * factory; update() allocates nothing.
 */

/**
 * Great-circle ground distance² from the bird to a world position, using the
 * bird's ground direction (birdUp = normalized birdPos). Altitude-invariant —
 * a tall nest's radial offset no longer dominates "nearest" / arrow gating.
 * Zero-allocation (primitives only).
 */
export function minimapGroundDist2(worldPos, birdUp, sphereRadius) {
  const len = worldPos.length() || 1;
  let cos = (worldPos.x * birdUp.x + worldPos.y * birdUp.y + worldPos.z * birdUp.z) / len;
  cos = cos < -1 ? -1 : cos > 1 ? 1 : cos;
  const arc = sphereRadius * Math.acos(cos);
  return arc * arc;
}

/**
 * Clamp a projected point to the radar circle; out.clamped marks targets that
 * sit beyond the rim (drawn as directional edge arrows).
 */
export function clampMinimapPoint(point, half, out) {
  const dx = point.x - half;
  const dy = point.y - half;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxR = half - 10;
  if (dist > maxR) {
    const s = maxR / dist;
    out.x = half + dx * s;
    out.y = half + dy * s;
    out.clamped = true;
  } else {
    out.x = point.x;
    out.y = point.y;
    out.clamped = false;
  }
  return out;
}

/**
 * Project a world position into radar pixels via the bird's tangent basis.
 * Maps by GROUND position, not raw 3D: the target is dropped onto the
 * reference sphere first, so its ALTITUDE (a nest high on a tree, a high
 * drone) can't push it outward — without this the tangential projection
 * scales with the target's radius, so a lifted nest reads ~2x too far and
 * piles on the rim. (The bird's own radius already cancels — right/forward
 * are ⊥ to its up.) Scratch vectors are caller-provided so this stays pure
 * and zero-alloc.
 */
export function projectMinimapPoint(worldPos, birdPos, right, forward, half, scale, sphereRadius, scratchSurf, scratchDelta, out) {
  scratchSurf.copy(worldPos);
  const len = scratchSurf.length();
  if (len > 1e-6) scratchSurf.multiplyScalar(sphereRadius / len);
  scratchDelta.copy(scratchSurf).sub(birdPos);
  const rx = scratchDelta.dot(right);
  const rz = scratchDelta.dot(forward);
  out.x = half + rx * scale;
  out.y = half - rz * scale;
  return out;
}

const MINIMAP_POS_KEY = 'birb_minimap_pos';

/**
 * Create the minimap. `canvas` is the retina-sized <canvas> element; `THREE`
 * is injected; `sphereRadius` is the world's reference radius.
 */
export function createMinimap({ THREE, canvas, sphereRadius }) {
  const ctx = canvas ? canvas.getContext('2d') : null;

  // Force CSS display size - canvas intrinsic size (200) is for retina,
  // display must be large enough to read on mobile. Bumped up so
  // icons/chevron are legible at arm's length.
  if (canvas) {
    const mapDisplaySize = window.innerWidth >= 768 ? '152px' : '128px';
    canvas.style.width = mapDisplaySize;
    canvas.style.height = mapDisplaySize;
    canvas.style.maxWidth = mapDisplaySize;
    canvas.style.maxHeight = mapDisplaySize;
  }

  // ===== Draggable minimap (position persisted across sessions) =====
  let mmDragging = false, mmStartX = 0, mmStartY = 0, mmOrigLeft = 0, mmOrigBottom = 0;

  const applyPosition = (left, bottom) => {
    const clampedLeft = Math.max(0, Math.min(window.innerWidth - canvas.offsetWidth, left));
    const clampedBottom = Math.max(0, Math.min(window.innerHeight - canvas.offsetHeight, bottom));
    canvas.style.left = clampedLeft + 'px';
    canvas.style.bottom = clampedBottom + 'px';
    canvas.style.right = 'auto';
    canvas.style.top = 'auto';
  };

  const mmPointerDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    mmDragging = true;
    const touch = e.touches ? e.touches[0] : e;
    mmStartX = touch.clientX; mmStartY = touch.clientY;
    const rect = canvas.getBoundingClientRect();
    mmOrigLeft = rect.left;
    mmOrigBottom = window.innerHeight - rect.bottom;
    canvas.classList.add('is-dragging');
  };
  const mmPointerMove = (e) => {
    if (!mmDragging) return;
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    applyPosition(mmOrigLeft + (touch.clientX - mmStartX), mmOrigBottom - (touch.clientY - mmStartY));
  };
  const mmPointerUp = () => {
    if (!mmDragging) return;
    mmDragging = false;
    canvas.classList.remove('is-dragging');
    // Persist where the player parked it (quality-of-life: survives reloads).
    try {
      const rect = canvas.getBoundingClientRect();
      localStorage.setItem(MINIMAP_POS_KEY, JSON.stringify({
        left: rect.left,
        bottom: window.innerHeight - rect.bottom,
      }));
    } catch (_) { /* private mode etc. */ }
  };

  if (canvas) {
    canvas.addEventListener('mousedown', mmPointerDown);
    canvas.addEventListener('touchstart', mmPointerDown, { passive: false });
    window.addEventListener('mousemove', mmPointerMove);
    window.addEventListener('touchmove', mmPointerMove, { passive: false });
    window.addEventListener('mouseup', mmPointerUp);
    window.addEventListener('touchend', mmPointerUp);
    // Restore the persisted position, clamped to the current viewport.
    try {
      const saved = JSON.parse(localStorage.getItem(MINIMAP_POS_KEY) || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.bottom)) {
        applyPosition(saved.left, saved.bottom);
      }
    } catch (_) { /* ignore bad saved state */ }
  }

  // ===== Drawing state =====
  let minimapPulseTime = 0;
  // Zero-alloc scratch: tangent-plane basis at the bird's location on the sphere.
  // A world-XZ projection only matches the bird's local tangent plane near the
  // top pole of the sphere — anywhere else the rings, drones, and nest icon
  // would drift relative to the actual world.
  const _fwd = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _delta = new THREE.Vector3();
  const _surf = new THREE.Vector3(); // scratch: target dropped onto the reference sphere
  const _nestPos = new THREE.Vector3(); // scratch for per-nest world pos
  const _rawPoint = { x: 0, y: 0 };
  const _edgePoint = { x: 0, y: 0, clamped: false };

  function project(worldPos, birdPos, half, scale) {
    return projectMinimapPoint(worldPos, birdPos, _right, _fwd, half, scale, sphereRadius, _surf, _delta, _rawPoint);
  }

  function drawEdgeArrow(point, half, fill) {
    const adx = point.x - half;
    const ady = point.y - half;
    const a = Math.atan2(ady, adx);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-3, -4);
    ctx.lineTo(-3, 4);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw one radar frame.
   * @param birdPos / birdQuat — bird world pose
   * @param collectibles — array of { position, collected } (or null)
   * @param drones — array of objects with .position (or null)
   * @param nestPos — legacy single nest position fallback (or null)
   * @param delta — frame dt (drives the pulse)
   * @param mode / modes — current game mode + the GAME_MODES enum (what to draw)
   * @param nestList — array of nest groups (THREE.Object3D) or null
   */
  function update(birdPos, birdQuat, collectibles, drones, nestPos, delta, mode, modes, nestList) {
    if (!ctx || !canvas) return;
    minimapPulseTime += (delta || 0.016);
    const size = canvas.width;  // 200 (2x resolution for retina)
    const half = size / 2;

    // Mode flags — decide what to draw. Falls through to legacy "show all"
    // if mode / modes aren't provided for some reason.
    let showRings = true, showDrones = true, showNest = true, showBird = true;
    if (mode != null && modes) {
      if (mode === modes.ZEN || mode === modes.CASUAL) {
        showRings = false; showDrones = false; showNest = true; showBird = true;
      } else if (mode === modes.RING_RUSH) {
        showRings = true; showDrones = false; showNest = false; showBird = true;
      } else if (mode === modes.DRONE_HUNTER) {
        showRings = false; showDrones = true; showNest = false; showBird = true;
      } else if (mode === modes.TURRET_DEFENSE) {
        // Bird is stationary on nest — nest is the reference, bird arrow adds nothing.
        showRings = false; showDrones = true; showNest = true; showBird = false;
      }
    }

    // Tighter radii — playtest feedback was the old map showed essentially
    // the whole hemisphere, so nearby targets sat clustered in the middle.
    // Aim for "next 2-3 rings / incoming drones" worth of context.
    const visibleRadius = (mode === modes?.RING_RUSH)
      ? 70
      : (mode === modes?.TURRET_DEFENSE)
        ? 95
        : (mode === modes?.DRONE_HUNTER)
          ? 80
          : 65;
    const scale = (half - 12) / visibleRadius;

    ctx.clearRect(0, 0, size, size);

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.clip();

    // Background — darker for better icon contrast
    const bgGrad = ctx.createRadialGradient(half, half, 0, half, half, half);
    bgGrad.addColorStop(0, 'rgba(10, 18, 34, 0.92)');
    bgGrad.addColorStop(1, 'rgba(3, 7, 18, 0.96)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // Subtle range rings
    ctx.strokeStyle = 'rgba(110, 170, 220, 0.14)';
    ctx.lineWidth = 1;
    for (let r = 1; r <= 3; r++) {
      ctx.beginPath();
      ctx.arc(half, half, (half / 3.5) * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Build a sphere-tangent basis at the bird so projection is correct
    // anywhere on the world (not just near the +Y pole). Up = radial out
    // from sphere center (origin); forward = bird forward projected to the
    // tangent plane; right = forward × up.
    _up.copy(birdPos);
    if (_up.lengthSq() < 1e-6) {
      _up.set(0, 1, 0);
    } else {
      _up.normalize();
    }
    _fwd.set(0, 0, -1).applyQuaternion(birdQuat);
    _fwd.addScaledVector(_up, -_fwd.dot(_up));
    if (_fwd.lengthSq() < 1e-6) {
      // Bird looking straight up/down at the surface — fall back to a tangent.
      _fwd.set(1, 0, 0);
      _fwd.addScaledVector(_up, -_fwd.dot(_up));
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
    }
    _fwd.normalize();
    _right.crossVectors(_fwd, _up).normalize();

    const pulse = 0.5 + 0.5 * Math.sin(minimapPulseTime * 4);

    // ===== Rings (yellow) =====
    if (showRings && collectibles) {
      // Find nearest uncollected ring
      let nearestDist = Infinity;
      let nearestIdx = -1;
      for (let i = 0; i < collectibles.length; i++) {
        const ring = collectibles[i];
        if (ring.collected) continue;
        const dx = ring.position.x - birdPos.x;
        const dy = ring.position.y - birdPos.y;
        const dz = ring.position.z - birdPos.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
      }

      for (let i = 0; i < collectibles.length; i++) {
        const ring = collectibles[i];
        if (ring.collected) continue;
        const isNearest = (i === nearestIdx);
        const raw = project(ring.position, birdPos, half, scale);
        const p = clampMinimapPoint(raw, half, _edgePoint);
        const dotR = isNearest ? 7 : 6;

        // Yellow glow for nearest; cyan-yellow ambient glow for all
        if (isNearest) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, dotR + 6 + pulse * 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 224, 80, ${0.20 + pulse * 0.12})`;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, dotR + 2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 224, 80, 0.18)';
          ctx.fill();
        }

        if (p.clamped) {
          drawEdgeArrow(p, half, isNearest ? '#ffe866' : '#ffd84a');
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
          ctx.fillStyle = isNearest ? '#ffe866' : '#ffd84a';
          ctx.fill();
          ctx.strokeStyle = isNearest ? 'rgba(20,20,20,0.85)' : 'rgba(20,20,20,0.6)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // ===== Drones (red, pulsing) =====
    if (showDrones && drones) {
      for (const drone of drones) {
        const raw = project(drone.position, birdPos, half, scale);
        const p = clampMinimapPoint(raw, half, _edgePoint);
        // Pulsing red halo
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 + pulse * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 70, 70, ${0.22 + pulse * 0.15})`;
        ctx.fill();

        if (p.clamped) {
          drawEdgeArrow(p, half, '#ff4d4d');
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#ff3b3b';
          ctx.fill();
          ctx.strokeStyle = 'rgba(20,0,0,0.75)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // ===== Nests (orange-red, matching the in-world nest markers) =====
    // Show ALL nests within range, not just the nearest — players asked to
    // see more of them. Nests inside the radius draw as orange-red dots (the
    // nearest gets a target reticle); off-screen nests near enough to matter
    // get a directional edge arrow (capped by distance to avoid rim clutter).
    // Colour matches the in-world nest markers (red/orange glow).
    const NEST_FILL = '#ff5a3c';
    const NEST_EDGE = '#ff7a4a';
    const NEST_GLOW = '255, 110, 70';
    if (showNest) {
      if (nestList && nestList.length) {
        // Pass 1: find the nearest nest (gets the highlighted reticle).
        let nearIdx = -1, nearD2 = Infinity;
        for (let i = 0; i < nestList.length; i++) {
          const ng = nestList[i];
          if (!ng || ng.visible === false) continue;
          ng.getWorldPosition(_nestPos);
          const d2 = minimapGroundDist2(_nestPos, _up, sphereRadius);
          if (d2 < nearD2) { nearD2 = d2; nearIdx = i; }
        }
        // Only arrow reasonably-close off-screen nests, so the rim doesn't fill up.
        const arrowMaxD2 = (visibleRadius * 1.7) * (visibleRadius * 1.7);

        // Pass 2: draw.
        for (let i = 0; i < nestList.length; i++) {
          const ng = nestList[i];
          if (!ng || ng.visible === false) continue;
          ng.getWorldPosition(_nestPos);
          const d2 = minimapGroundDist2(_nestPos, _up, sphereRadius);
          const isNearest = (i === nearIdx);
          const raw = project(_nestPos, birdPos, half, scale);
          const p = clampMinimapPoint(raw, half, _edgePoint);

          if (p.clamped) {
            if (isNearest || d2 <= arrowMaxD2) {
              drawEdgeArrow(p, half, isNearest ? NEST_EDGE : NEST_FILL);
            }
            continue;
          }

          // Glow halo (nearest pulses brighter and larger)
          const haloR = isNearest ? 10 + pulse * 3 : 7;
          ctx.beginPath();
          ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${NEST_GLOW}, ${isNearest ? 0.22 + pulse * 0.12 : 0.16})`;
          ctx.fill();

          if (isNearest) {
            // Target reticle + cross hairs in nest colour
            ctx.strokeStyle = NEST_EDGE;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(40, 8, 0, 0.85)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(p.x - 10, p.y); ctx.lineTo(p.x - 3, p.y);
            ctx.moveTo(p.x + 3, p.y);  ctx.lineTo(p.x + 10, p.y);
            ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x, p.y - 3);
            ctx.moveTo(p.x, p.y + 3);  ctx.lineTo(p.x, p.y + 10);
            ctx.stroke();
          }

          // Solid orange-red dot
          ctx.beginPath();
          ctx.arc(p.x, p.y, isNearest ? 4 : 3.5, 0, Math.PI * 2);
          ctx.fillStyle = isNearest ? NEST_EDGE : NEST_FILL;
          ctx.fill();
          ctx.strokeStyle = 'rgba(30, 6, 0, 0.7)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      } else if (nestPos) {
        // Fallback: legacy single nestPos (e.g. TURRET_DEFENSE passes it in).
        const raw = project(nestPos, birdPos, half, scale);
        const p = clampMinimapPoint(raw, half, _edgePoint);
        if (p.clamped) {
          drawEdgeArrow(p, half, NEST_EDGE);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${NEST_GLOW}, 0.18)`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = NEST_EDGE;
          ctx.fill();
          ctx.strokeStyle = 'rgba(30, 6, 0, 0.7)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    }

    // ===== Bird (white chevron, ~12px across) =====
    if (showBird) {
      ctx.save();
      ctx.translate(half, half);
      // Chevron pointing up (forward is up on the rotated minimap)
      ctx.beginPath();
      ctx.moveTo(0, -8);     // nose
      ctx.lineTo(-6, 6);     // back-left
      ctx.lineTo(0, 3);      // notch
      ctx.lineTo(6, 6);      // back-right
      ctx.closePath();
      // Dark outline for contrast
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Bright fill
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      // Inner cyan edge for recognisability
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore(); // Undo clip

    // Outer ring border — slightly brighter
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  return {
    update,

    /** Show/hide the radar (drives the .is-visible CSS transition). */
    setVisible(visible) {
      if (canvas) canvas.classList.toggle('is-visible', visible);
    },

    /** Whether the radar can draw at all (canvas + 2d context present). */
    isReady() {
      return !!(ctx && canvas);
    },

    dispose() {
      if (!canvas) return;
      canvas.removeEventListener('mousedown', mmPointerDown);
      canvas.removeEventListener('touchstart', mmPointerDown);
      window.removeEventListener('mousemove', mmPointerMove);
      window.removeEventListener('touchmove', mmPointerMove);
      window.removeEventListener('mouseup', mmPointerUp);
      window.removeEventListener('touchend', mmPointerUp);
    },
  };
}
