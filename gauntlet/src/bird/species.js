/**
 * bird/species.js — which kind of bird a model is. PURE.
 *
 * No THREE, no DOM. The table drives three things that must never disagree:
 * the settings picker (built from this list, like the plumage picker is built
 * from BIRD_COLORS), `createBird`'s `opts.species`, and the `?bird=` query
 * override the screenshot harness uses.
 *
 * Species is cosmetic for the player: the flight model never reads it. A rival
 * gets its species from its personality in ai-racer.js.
 */

import { PALETTE } from '../core/palette.js';

/**
 * `query` is the short form accepted by `?bird=`; `rivalKey` is the
 * personality that flies this species, so the integrator can find the rival
 * that would clash with the player's choice. `swatch`/`swatchBelly` preview
 * the bird in the picker.
 */
export const BIRD_SPECIES = Object.freeze([
    Object.freeze({ id: 'birb', name: 'Birb', query: 'birb', rivalKey: null,
        swatch: PALETTE.birdPlayer, swatchBelly: PALETTE.birdPlayerBelly }),
    Object.freeze({ id: 'crow', name: 'Crow', query: 'crow', rivalKey: 'clever',
        swatch: PALETTE.birdRival4, swatchBelly: PALETTE.crowRim }),
    Object.freeze({ id: 'clockwork-owl', name: 'Clockwork Owl', query: 'owl', rivalKey: 'clockwork',
        swatch: PALETTE.owlBrass, swatchBelly: PALETTE.owlDisc }),
]);

export const DEFAULT_SPECIES = 'birb';

/** Look up a species by id, never returning undefined. */
export function speciesById(id) {
    for (let i = 0; i < BIRD_SPECIES.length; i++) {
        if (BIRD_SPECIES[i].id === id) return BIRD_SPECIES[i];
    }
    return BIRD_SPECIES[0];
}

/**
 * Turn anything a user, an old save or a URL might hand us into a valid
 * species id. Accepts ids and query aliases, case-insensitively; anything else
 * (undefined, a typo, a number) is null so the caller can fall back.
 */
export function parseSpecies(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim().toLowerCase();
    if (!v) return null;
    for (let i = 0; i < BIRD_SPECIES.length; i++) {
        const s = BIRD_SPECIES[i];
        if (v === s.id || v === s.query) return s.id;
    }
    if (v === 'clockwork' || v === 'clockworkowl' || v === 'tock') return 'clockwork-owl';
    if (v === 'corvus') return 'crow';
    return null;
}

/** As parseSpecies, but always a valid id. */
export function normaliseSpecies(value) {
    return parseSpecies(value) || DEFAULT_SPECIES;
}
