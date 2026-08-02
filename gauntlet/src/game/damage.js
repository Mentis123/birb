/**
 * game/damage.js — the four-pip damage ring.
 *
 * Pure: no THREE, no DOM, no timers. The caller tells it "I am touching
 * something" and how much time passed; it decides what the ring shows and
 * whether the bird falls out of the sky. That split is what makes the whole
 * thing unit-testable, and the rules below are fiddly enough to want that.
 *
 * ---------------------------------------------------------------------------
 * THE RULES
 * ---------------------------------------------------------------------------
 *
 *   - Four pips. The ring does not exist until the first hit, because a full
 *     health bar on a bird that has never been touched is UI for its own sake.
 *   - The first contact costs a pip IMMEDIATELY. Hitting a tree and watching
 *     nothing happen for a second would read as the game missing the hit.
 *   - Sustained contact costs another pip every `CONTACT_INTERVAL`. Scraping along
 *     a canopy is a slow bleed, not an instant kill.
 *   - At zero the bird is DOWNED — the caller tumbles it out of the sky.
 *   - Damage heals. Break contact for `HEAL_DELAY` and pips come back one per
 *     `HEAL_INTERVAL`, so flying away from a drone is a real escape and not
 *     just a pause.
 *   - Healing back to full HIDES the ring again. The bird is fine; stop
 *     shouting about it.
 *
 * A NOTE ON THE COOLDOWN. `CONTACT_INTERVAL` is a floor on damage from
 * CONTINUOUS contact, and it is also what stops a single collision that spans
 * several frames from spending the whole ring in 50ms. It is deliberately NOT
 * reset by breaking contact for one frame: a drone clipping in and out of the
 * hit radius at 60fps would otherwise strip four pips in a quarter of a second.
 */

/** Pips in the ring. Four is the whole design — do not parameterise it away. */
export const MAX_PIPS = 4;

/** Seconds of sustained contact between successive pips. */
export const CONTACT_INTERVAL = 1.0;

/** Seconds clear of everything before healing starts. */
export const HEAL_DELAY = 2.5;

/** Seconds per pip once healing has started. */
export const HEAL_INTERVAL = 3.0;

/** Fresh damage state. Mutated in place forever after; allocates once. */
export function createDamageState() {
    return {
        /** Pips remaining, 0..MAX_PIPS. */
        pips: MAX_PIPS,
        /** Has the bird ever been hit? Drives whether the ring is shown. */
        engaged: false,
        /** Seconds until contact can cost another pip. */
        cooldown: 0,
        /** Seconds since contact was last made. */
        clearFor: 0,
        /** Accumulates toward the next healed pip. */
        healTimer: 0,
        /** True on the frame the last pip is spent. */
        downed: false,
        /** True on the single frame a pip is lost — for shake/sound. */
        hitThisFrame: false,
    };
}

export function resetDamage(s) {
    s.pips = MAX_PIPS;
    s.engaged = false;
    s.cooldown = 0;
    s.clearFor = 0;
    s.healTimer = 0;
    s.downed = false;
    s.hitThisFrame = false;
    return s;
}

/**
 * Advance one frame.
 *
 * @param {object} s        damage state, mutated
 * @param {number} dt       seconds
 * @param {boolean} touching is the bird in contact with something solid?
 * @returns {boolean} true on the frame a pip was lost
 */
export function updateDamage(s, dt, touching) {
    s.hitThisFrame = false;
    s.downed = false;
    if (!(dt > 0)) dt = 0;

    if (s.cooldown > 0) s.cooldown -= dt;

    if (touching) {
        s.clearFor = 0;
        s.healTimer = 0;
        if (s.cooldown <= 0 && s.pips > 0) {
            s.pips--;
            s.engaged = true;
            s.hitThisFrame = true;
            s.cooldown = CONTACT_INTERVAL;
            if (s.pips <= 0) s.downed = true;
        }
        return s.hitThisFrame;
    }

    // --- clear of everything: heal ----------------------------------------
    s.clearFor += dt;
    if (!s.engaged || s.pips >= MAX_PIPS) return false;
    if (s.clearFor < HEAL_DELAY) return false;

    s.healTimer += dt;
    while (s.healTimer >= HEAL_INTERVAL && s.pips < MAX_PIPS) {
        s.healTimer -= HEAL_INTERVAL;
        s.pips++;
    }
    // Back to full: the ring has nothing left to say, so it goes away.
    if (s.pips >= MAX_PIPS) {
        s.pips = MAX_PIPS;
        s.engaged = false;
        s.healTimer = 0;
    }
    return false;
}

/**
 * Should the ring be on screen? Hidden before the first hit and again once
 * fully healed.
 */
export function damageVisible(s) {
    return s.engaged;
}

/** 0..1 health, for the ring's arc. */
export function damage01(s) {
    return s.pips / MAX_PIPS;
}

/**
 * Put the bird back in the air after a downing: half a ring, and a full
 * contact cooldown so it cannot be immediately re-downed by the same tree it
 * just fell into.
 */
export function reviveDamage(s) {
    s.pips = Math.max(2, s.pips);
    s.engaged = true;
    s.cooldown = CONTACT_INTERVAL;
    s.clearFor = 0;
    s.healTimer = 0;
    s.downed = false;
    s.hitThisFrame = false;
    return s;
}

export default createDamageState;
