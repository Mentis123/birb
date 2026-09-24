/**
 * The erosion prefetch, off the main thread (?erosion=1).
 *
 * erosion.js is baked synchronously at world build, because the world build
 * is synchronous and every prop, the water and the horizon bake sample the
 * terrain the moment it exists — an erosion that landed after them would
 * leave the forest standing on the ground as it was before the rivers.
 * That leaves the main thread paying for every biome's first visit. This
 * worker pays instead: spherical-world.js starts it once, when that module
 * LOADS with the flag on, and it bakes every eroded biome into the module's
 * cache — so a world build, the first one included when the worker wins the
 * race to it, finds its erosion done. If it has not landed yet, the build
 * bakes on the main thread and this result goes unused — the worker is never
 * needed for correctness, and the bake is deterministic, so both paths give
 * the same bytes.
 *
 * It imports spherical-world.js for the terrain function itself: the terrain
 * has one definition, and a worker with a copy of it would drift. The price
 * is that module's whole import graph (three.js included) evaluated once in
 * the worker, off the main thread, and freed when the worker is terminated
 * after its last biome; none of it touches the DOM at load. The results —
 * the field's per-face arrays and the wetness bytes, so the page needs no
 * grid of its own to receive them — are TRANSFERRED back, one message per
 * biome.
 */
import { bakeErosionForVariant } from './spherical-world.js';

self.onmessage = (event) => {
  const variants = (event.data && event.data.variants) || [];
  for (const variant of variants) {
    try {
      const t0 = performance.now();
      const out = bakeErosionForVariant(variant);
      if (!out) { self.postMessage({ ok: true, variant, skipped: true }); continue; }
      const stats = { ...out.stats, workerMs: performance.now() - t0 };
      // The field's own face arrays, so the page rebuilds it with no grid.
      const { n, deltaFaces, wetFaces } = out.field;
      self.postMessage({
        ok: true, variant, stats, n, deltaFaces, wetFaces, wetBytes: out.wetBytes,
      }, [deltaFaces.buffer, wetFaces.buffer, out.wetBytes.buffer]);
    } catch (err) {
      self.postMessage({ ok: false, variant, error: String((err && err.message) || err) });
      return;
    }
  }
};
