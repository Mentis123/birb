/**
 * Uniform spatial-hash grid for static sphere-world colliders.
 *
 * Replaces the per-frame O(n) linear scan over every collider (~700 mobile /
 * ~1,200 desktop after the density passes) with an O(1) cell lookup: colliders
 * are bucketed once per environment build, queries test only the 3×3×3 cell
 * neighborhood around the bird.
 *
 * Correctness contract: a query is complete for any entityRadius <= cellSize.
 * Each collider is inserted into every cell its bounding sphere overlaps, so
 * anything within (collider.radius + entityRadius) of the query point is
 * guaranteed to sit in one of the 27 neighbor cells. Callers must fall back
 * to a full scan for larger query radii (SphericalCollisionSystem does).
 *
 * Dependency-free on purpose: works on plain {x,y,z} positions (THREE.Vector3
 * satisfies that shape), so it unit-tests under plain `node --test`.
 * Zero-allocation queries: candidates are returned in a reused array.
 */

// Packs three small signed cell coordinates into one integer Map key.
// 10 bits per axis (±512 cells) — at cellSize 14 that covers ±7,168 units,
// far beyond the radius-120 world. Integer keys avoid per-query string allocs.
const KEY_OFFSET = 512;

export function createColliderGrid(cellSize = 14) {
  const cells = new Map();
  const _candidates = []; // reused query result — valid until the next query
  let _stamp = 0; // query stamp for zero-alloc dedupe of multi-cell colliders

  function cellKey(ix, iy, iz) {
    return ((ix + KEY_OFFSET) << 20) | ((iy + KEY_OFFSET) << 10) | (iz + KEY_OFFSET);
  }

  return {
    cellSize,

    clear() {
      cells.clear();
    },

    /**
     * Bucket a collider ({ position: {x,y,z}, radius }) into every cell its
     * bounding sphere overlaps. Build-time only — never call per frame.
     */
    insert(collider) {
      const { position: p, radius: r } = collider;
      const x0 = Math.floor((p.x - r) / cellSize);
      const x1 = Math.floor((p.x + r) / cellSize);
      const y0 = Math.floor((p.y - r) / cellSize);
      const y1 = Math.floor((p.y + r) / cellSize);
      const z0 = Math.floor((p.z - r) / cellSize);
      const z1 = Math.floor((p.z + r) / cellSize);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          for (let iz = z0; iz <= z1; iz++) {
            const key = cellKey(ix, iy, iz);
            let bucket = cells.get(key);
            if (!bucket) {
              bucket = [];
              cells.set(key, bucket);
            }
            bucket.push(collider);
          }
        }
      }
    },

    /**
     * Collect all colliders that could touch a sphere of radius <= cellSize
     * centered at (x, y, z). Returns a REUSED array — consume it immediately,
     * do not hold a reference across queries. Colliders spanning several
     * cells are deduped via a stamp marker (no per-query allocations).
     */
    query(x, y, z) {
      _candidates.length = 0;
      _stamp++;
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const cz = Math.floor(z / cellSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = cells.get(cellKey(cx + dx, cy + dy, cz + dz));
            if (!bucket) continue;
            for (let i = 0; i < bucket.length; i++) {
              const collider = bucket[i];
              if (collider._gridStamp === _stamp) continue;
              collider._gridStamp = _stamp;
              _candidates.push(collider);
            }
          }
        }
      }
      return _candidates;
    },
  };
}
