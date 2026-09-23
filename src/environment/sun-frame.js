/**
 * sun-frame.js — one sun for a PLANET.
 *
 * `sun-cycle.js` describes the sun in a horizon frame — x = cos(az)cos(e),
 * y = sin(e), z = sin(az)cos(e) — and promises it never sets. The game used
 * to copy those numbers straight into WORLD space, which is only a horizon
 * frame at the +Y pole: measured on 54b1961, at the south pole the sun sat
 * 19-58 degrees BELOW the local horizon for the whole cycle, and on the
 * equator for half of it. Up on this world is radial, so the sun needs a
 * tangent frame (East, Up, North) at the bird to be mapped through.
 *
 * The frame is PARALLEL-TRANSPORTED as the bird moves: each frame, East and
 * North are rotated by the minimal rotation that carries last frame's up onto
 * this frame's up, then re-orthonormalised. That is the one choice that keeps
 * the sun still in the sky while you fly — along any great circle the sun
 * keeps its elevation AND its bearing relative to the path — rather than
 * swinging it round whenever a fixed reference axis passes overhead, which is
 * what a frame built from `cross(worldAxis, up)` does at its poles. The price
 * is holonomy: fly a closed loop and the frame comes back turned by the solid
 * angle the loop enclosed, so the sun's AZIMUTH depends on the route. Its
 * elevation never does, and elevation is the promise sun-cycle.js makes.
 *
 * A jump (teleport, restorePose, an environment switch) is not flight: when
 * up moves more than `resetAngle` in one update the frame is rebuilt
 * deterministically from the canonical pole frame (E=+X, U=+Y, N=+Z) by the
 * minimal rotation +Y -> U, so the same place always gets the same sky
 * whatever route a harness took to get there. At the +Y pole that rotation is
 * the identity and the mapping is exact, so the spawn looks exactly as it did
 * before this module existed. At the exact south pole the minimal rotation is
 * undefined; the fallback is a half turn about +X.
 *
 * Pure: no THREE, no DOM, and zero allocation after `createSunFrame()` —
 * every method writes into objects the caller owns or the frame already owns.
 */

import { SUN_CYCLE_DEFAULTS } from './sun-cycle.js';

export const SUN_FRAME_DEFAULTS = Object.freeze({
  // Flight moves up by well under a degree a frame (26 units/s of boost at
  // radius ~125 is 12 degrees a SECOND). Ten degrees in one update is a jump.
  resetAngle: (10 * Math.PI) / 180,
});

// 1 + cos(angle) below this is "exactly antipodal": the minimal rotation from
// +Y has no defined axis.
const ANTIPODAL_EPS = 1e-12;

/**
 * A tangent frame that follows a moving point on a sphere.
 *
 * @param {{ resetAngle?: number }} [options]
 * @returns {{
 *   east: {x:number,y:number,z:number}, up: {x:number,y:number,z:number},
 *   north: {x:number,y:number,z:number}, initialized: boolean, resets: number,
 *   update(px:number, py:number, pz:number): boolean,
 *   resetTo(ux:number, uy:number, uz:number): void,
 *   toWorld(cx:number, cy:number, cz:number, out:object): object,
 *   toLocal(wx:number, wy:number, wz:number, out:object): object,
 *   elevationOf(wx:number, wy:number, wz:number): number,
 * }}
 */
export function createSunFrame(options = {}) {
  const resetAngle = Number.isFinite(options.resetAngle) ? options.resetAngle : SUN_FRAME_DEFAULTS.resetAngle;
  const cosReset = Math.cos(resetAngle);

  const east = { x: 1, y: 0, z: 0 };
  const up = { x: 0, y: 1, z: 0 };
  const north = { x: 0, y: 0, z: 1 };

  /** N -= (N.U)U, normalise, E = U x N. Keeps the frame orthonormal forever. */
  function orthonormalise() {
    const d = north.x * up.x + north.y * up.y + north.z * up.z;
    let nx = north.x - d * up.x;
    let ny = north.y - d * up.y;
    let nz = north.z - d * up.z;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-9) {
      // North collapsed onto up (cannot happen from a valid frame; guard
      // anyway). Rebuild it from east.
      nx = east.y * up.z - east.z * up.y;
      ny = east.z * up.x - east.x * up.z;
      nz = east.x * up.y - east.y * up.x;
      const l2 = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l2; ny /= l2; nz /= l2;
    } else if (len !== 1) {
      nx /= len; ny /= len; nz /= len;
    }
    north.x = nx; north.y = ny; north.z = nz;
    east.x = up.y * nz - up.z * ny;
    east.y = up.z * nx - up.x * nz;
    east.z = up.x * ny - up.y * nx;
  }

  /**
   * Rotate `v` in place by the minimal rotation that takes unit `a` to unit
   * `b`: v' = v c + k x v + k (k.v) / (1 + c), with k = a x b and c = a.b.
   * Exact for c > -1; callers never get near -1 (a jump resets instead).
   */
  function rotateMinimal(v, kx, ky, kz, c) {
    const inv = 1 / (1 + c);
    const kv = kx * v.x + ky * v.y + kz * v.z;
    const cx = ky * v.z - kz * v.y;
    const cy = kz * v.x - kx * v.z;
    const cz = kx * v.y - ky * v.x;
    v.x = v.x * c + cx + kx * kv * inv;
    v.y = v.y * c + cy + ky * kv * inv;
    v.z = v.z * c + cz + kz * kv * inv;
  }

  const frame = {
    east,
    up,
    north,
    initialized: false,
    // How many times the frame was rebuilt rather than transported. The
    // harness reads it to prove a teleport took the reset path.
    resets: 0,

    /**
     * Rebuild from the canonical pole frame by the minimal rotation +Y -> U.
     * `ux, uy, uz` need not be normalised.
     */
    resetTo(ux, uy, uz) {
      const len = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (!(len > 0) || !Number.isFinite(len)) {
        ux = 0; uy = 1; uz = 0;
      } else {
        ux /= len; uy /= len; uz /= len;
      }
      up.x = ux; up.y = uy; up.z = uz;
      const c = uy;
      if (1 + c < ANTIPODAL_EPS) {
        // The exact south pole: +Y -> -Y has no minimal axis. A half turn
        // about +X keeps East = +X and sends North to -Z.
        east.x = 1; east.y = 0; east.z = 0;
        north.x = 0; north.y = 0; north.z = -1;
        up.x = 0; up.y = -1; up.z = 0;
      } else {
        // k = (+Y) x U = (uz, 0, -ux); expanded for E = +X and N = +Z.
        const inv = 1 / (1 + c);
        east.x = c + uz * uz * inv;
        east.y = -ux;
        east.z = -ux * uz * inv;
        north.x = -ux * uz * inv;
        north.y = -uz;
        north.z = c + ux * ux * inv;
      }
      orthonormalise();
      frame.initialized = true;
      frame.resets += 1;
    },

    /**
     * Follow the point (px, py, pz) — the bird's position, relative to the
     * planet's centre. Returns true when the frame was RESET (a jump) rather
     * than transported.
     */
    update(px, py, pz) {
      const len = Math.sqrt(px * px + py * py + pz * pz);
      if (!(len > 0) || !Number.isFinite(len)) return false;   // keep the last frame
      const ux = px / len;
      const uy = py / len;
      const uz = pz / len;
      if (!frame.initialized) {
        frame.resetTo(ux, uy, uz);
        return true;
      }
      // Hovering (or frozen) exactly in place: nothing to transport. Early
      // out so a still bird's frame is bit-stable, not re-normalised forever.
      if (ux === up.x && uy === up.y && uz === up.z) return false;
      const c = up.x * ux + up.y * uy + up.z * uz;
      if (c < cosReset) {
        frame.resetTo(ux, uy, uz);
        return true;
      }
      const kx = up.y * uz - up.z * uy;
      const ky = up.z * ux - up.x * uz;
      const kz = up.x * uy - up.y * ux;
      rotateMinimal(east, kx, ky, kz, c);
      rotateMinimal(north, kx, ky, kz, c);
      up.x = ux; up.y = uy; up.z = uz;
      orthonormalise();
      return false;
    },

    /** Horizon-frame components (E, U, N order — sun-cycle.js's x, y, z) to world. */
    toWorld(cx, cy, cz, out) {
      out.x = cx * east.x + cy * up.x + cz * north.x;
      out.y = cx * east.y + cy * up.y + cz * north.y;
      out.z = cx * east.z + cy * up.z + cz * north.z;
      return out;
    },

    /** World vector to horizon-frame components (x along East, y Up, z North). */
    toLocal(wx, wy, wz, out) {
      out.x = wx * east.x + wy * east.y + wz * east.z;
      out.y = wx * up.x + wy * up.y + wz * up.z;
      out.z = wx * north.x + wy * north.y + wz * north.z;
      return out;
    },

    /** Elevation (radians) of a world direction above this frame's horizon. */
    elevationOf(wx, wy, wz) {
      const len = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (!(len > 0)) return 0;
      const s = (wx * up.x + wy * up.y + wz * up.z) / len;
      return Math.asin(s > 1 ? 1 : s < -1 ? -1 : s);
    },
  };
  return frame;
}

/**
 * `sunDirectionAt` without the allocation: the same components, written into
 * `out` ({x, y, z, height, elevation}). sunDirectionAt returns a fresh object
 * (and spreads its options) on every call, which is fine once per frame in a
 * block that already allocated and is not fine in a path that must run every
 * frame. tests/sun-frame.test.js pins this bit-for-bit against sunDirectionAt,
 * so the two cannot drift apart silently.
 */
export function sunCycleInto(seconds, out, params = SUN_CYCLE_DEFAULTS) {
  const periodSeconds = params.periodSeconds;
  const minElevation = params.minElevation;
  const maxElevation = params.maxElevation;
  const t = Number.isFinite(seconds) ? seconds : 0;
  const period = periodSeconds > 0 ? periodSeconds : SUN_CYCLE_DEFAULTS.periodSeconds;
  const phase = (t / period) * Math.PI * 2;
  const climb = (1 - Math.cos(phase)) * 0.5;
  const elevation = minElevation + (maxElevation - minElevation) * climb;
  const azimuth = phase;
  const cosE = Math.cos(elevation);
  out.x = Math.cos(azimuth) * cosE;
  out.y = Math.sin(elevation);
  out.z = Math.sin(azimuth) * cosE;
  out.height = climb;
  out.elevation = elevation;
  return out;
}

/**
 * `sunWarmth` without the allocation — the `?atmos=0` path's key tint, the
 * heuristic the physical atmosphere replaces. Pinned against sunWarmth by the
 * same test.
 */
export function sunWarmthInto(height, out) {
  const h = Number.isFinite(height) ? Math.max(0, Math.min(1, height)) : 0;
  out.r = 1;
  out.g = 0.90 + 0.10 * h;
  out.b = 0.72 + 0.28 * h;
  out.intensity = 0.86 + 0.28 * h;
  return out;
}
