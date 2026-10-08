/**
 * game/settings.js — the persisted settings object. PURE.
 *
 * index.html owns localStorage; this module owns what the stored JSON means,
 * so the back-compat rules can be unit-tested without a DOM. Saves written
 * before a field existed must keep loading: an old save simply lacks the new
 * key, and the default fills it in.
 */

import { BIRD_COLORS } from '../core/palette.js';
import { DEFAULT_SPECIES, parseSpecies } from '../bird/species.js';

/** Never bump this for an additive field — that is what the defaults are for. */
export const SETTINGS_KEY = 'gauntlet.settings.v1';

export function defaultSettings() {
    return {
        music: true,
        sfx: true,
        haptics: true,
        birdColor: BIRD_COLORS[0].id,
        bird: DEFAULT_SPECIES,
    };
}

/**
 * Read a stored settings string. Anything unparseable, or a value that is not
 * a plain object, gives the defaults. Unknown keys ride through untouched so a
 * newer build's save is not stripped by an older one. A stored `bird` that is
 * not a known species falls back to the default rather than poisoning boot.
 */
export function parseSettings(raw) {
    const out = defaultSettings();
    if (typeof raw !== 'string' || !raw) return out;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { return out; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    Object.assign(out, parsed);
    out.bird = parseSpecies(out.bird) || DEFAULT_SPECIES;
    return out;
}

/**
 * The species this run flies. A valid `?bird=` wins for this load only and is
 * never written back, so a screenshot URL cannot silently change someone's
 * saved choice.
 */
export function resolvePlayerSpecies(settings, queryValue) {
    return parseSpecies(queryValue)
        || parseSpecies(settings && settings.bird)
        || DEFAULT_SPECIES;
}
