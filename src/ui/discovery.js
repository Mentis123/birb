// Discovery — places worth finding, remembered.
//
// Casual flight had no goal. Every biome now has places (its landmarks, the
// falls, the extremes the world built, the cable car), and a place is FOUND
// when the bird has been near it with it in view for a moment. Found places
// are remembered per device, counted on the title page, styled on the
// minimap (whose arrow points at the nearest one not yet found) and labelled
// by a soft pin in the world (src/ui/pins-layer.js).
//
// The tabletop worlds kit's pins were signposts you click to fly to; this is
// a game, so a pin is a reward for having gone there, never a shortcut.
//
// Pure: storage and the "is it in view" test are injected. No THREE, no DOM.

export const FOUND_KEY = 'birb.found.v1';
/** Seconds the place must be near AND in view before it counts. */
export const DWELL_SECONDS = 1.2;
/** "Near" is this many of the place's own viewDistance. */
export const NEAR_FACTOR = 1.25;

export function loadFound(storage) {
  try {
    const raw = storage?.getItem?.(FOUND_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [biome, ids] of Object.entries(parsed)) {
      if (Array.isArray(ids)) out[biome] = ids.filter((x) => typeof x === 'string').slice(0, 64);
    }
    return out;
  } catch {
    return {};
  }
}

export function createDiscovery({ storage = null } = {}) {
  const found = loadFound(storage);
  const dwell = new Map();   // `${biome}:${id}` -> seconds accumulated

  function save() {
    try { storage?.setItem?.(FOUND_KEY, JSON.stringify(found)); } catch { /* private mode: still works this session */ }
  }
  const isFound = (biome, id) => !!found[biome]?.includes(id);

  return {
    isFound,
    /** Every place found, every biome. */
    total() { return Object.values(found).reduce((n, ids) => n + ids.length, 0); },
    progress(biome, landmarks) {
      const ids = (landmarks || []).map((l) => l.id);
      return { found: ids.filter((id) => isFound(biome, id)).length, total: ids.length };
    },
    /** Mark each landmark entry's `found` flag (the minimap reads it). */
    flag(biome, landmarks) {
      for (const l of landmarks || []) l.found = isFound(biome, l.id);
    },
    /**
     * Advance the dwell timers. `inView(landmark)` says whether it is on
     * screen and unobstructed right now. Returns the landmarks found THIS
     * call (usually none). dt in seconds; a stalled frame cannot complete a
     * dwell by itself.
     */
    update(dt, biome, landmarks, birdPos, inView) {
      const step = Math.min(Math.max(0, dt || 0), 0.25);
      const fresh = [];
      for (const l of landmarks || []) {
        if (!l?.position || isFound(biome, l.id)) continue;
        const key = `${biome}:${l.id}`;
        const reach = (l.viewDistance || 34) * NEAR_FACTOR;
        const dx = birdPos.x - l.position.x, dy = birdPos.y - l.position.y, dz = birdPos.z - l.position.z;
        const near = dx * dx + dy * dy + dz * dz <= reach * reach;
        if (near && inView(l)) {
          const t = (dwell.get(key) || 0) + step;
          if (t >= DWELL_SECONDS) {
            (found[biome] ||= []).push(l.id);
            dwell.delete(key);
            l.found = true;
            fresh.push(l);
          } else dwell.set(key, t);
        } else if (dwell.has(key)) {
          // Leaving resets: a find is a moment of looking, not a sum of glances.
          dwell.delete(key);
        }
      }
      if (fresh.length) save();
      return fresh;
    },
    /** Forget everything (the settings "reset" and the harness). */
    reset() {
      for (const k of Object.keys(found)) delete found[k];
      dwell.clear();
      save();
    },
    snapshot() { return JSON.parse(JSON.stringify(found)); },
  };
}
