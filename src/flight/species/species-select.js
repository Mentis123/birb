/**
 * src/flight/species/species-select.js — which bird the player flies.
 *
 * Three species: 'birb' (the v3 Bronze-winged Pionus, the DEFAULT and the bird
 * every other system was tuned on), 'crow' (Corvus) and 'owl' (Tock, the
 * clockwork owl). The choice lives in localStorage under `birb.species` and a
 * URL can override it for one load:
 *
 *   ?bird=crow | owl | birb   that species, this load only, NOT written back
 *   ?bird=v1 | v2 | v3        the Pionus A/B builds, exactly as before: the
 *                             species is birb and the variant is the one named
 *                             (a saved crow does not hijack a v1 comparison)
 *   anything else             ignored: the saved choice, else birb
 *
 * A saved value that is not one of the three is treated as absent.
 *
 * PURE: no DOM, no THREE. `storage` is anything with getItem/setItem (the
 * tests pass a Map-backed stub; the page passes localStorage). It is tiny on
 * purpose: index.html imports it on every boot, and the species builders
 * (species-bird.js and everything under it) are imported LAZILY, only when the
 * resolved species is not birb, so the default boot path fetches and runs
 * nothing new beyond this file.
 */

export const SPECIES = Object.freeze(['birb', 'crow', 'owl']);
export const DEFAULT_SPECIES = 'birb';
export const SPECIES_STORAGE_KEY = 'birb.species';

/** Settings-button labels, in cycle order. */
export const SPECIES_LABELS = Object.freeze({ birb: 'Birb', crow: 'Crow', owl: 'Clockwork Owl' });

const BIRD_PARAM = /[?&]bird=([^&#]*)/;

export function isSpecies(id) {
  return id === 'birb' || id === 'crow' || id === 'owl';
}

/** The raw `bird` query value (lower-cased), or null. */
export function birdParam(search) {
  const m = BIRD_PARAM.exec(search || '');
  if (!m) return null;
  let v = m[1];
  try { v = decodeURIComponent(v); } catch { /* keep the raw text */ }
  return v.toLowerCase();
}

/** The saved species, or null when absent, invalid or storage throws. */
export function readSavedSpecies(storage) {
  try {
    const v = storage && typeof storage.getItem === 'function' ? storage.getItem(SPECIES_STORAGE_KEY) : null;
    return isSpecies(v) ? v : null;
  } catch {
    return null;
  }
}

/** Persist a choice. Returns true when it was stored. Never throws. */
export function writeSavedSpecies(storage, id) {
  if (!isSpecies(id)) return false;
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    storage.setItem(SPECIES_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the species for this load.
 * @returns {{ species: 'birb'|'crow'|'owl', source: 'url'|'saved'|'default', variant: 'v1'|'v2'|'v3' }}
 *   `variant` is the Pionus build index.html constructs when species is birb.
 */
export function resolveSpecies(search, storage) {
  const p = birdParam(search);
  if (p === 'v1' || p === 'v2' || p === 'v3') return { species: 'birb', source: 'url', variant: p };
  if (isSpecies(p)) return { species: p, source: 'url', variant: 'v3' };
  const saved = readSavedSpecies(storage);
  if (saved) return { species: saved, source: 'saved', variant: 'v3' };
  return { species: DEFAULT_SPECIES, source: 'default', variant: 'v3' };
}

/** The next species in the settings cycle (birb -> crow -> owl -> birb). */
export function nextSpecies(id) {
  // An unknown id is treated as birb, the default.
  const i = Math.max(0, SPECIES.indexOf(id));
  return SPECIES[(i + 1) % SPECIES.length];
}
