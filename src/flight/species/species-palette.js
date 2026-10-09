/**
 * src/flight/species/species-palette.js — the colours and the seeded RNG the
 * ported species builders need, and nothing else.
 *
 * PORTED from Birb Gauntlet (gauntlet/src/core/palette.js, the `real*` entries,
 * and gauntlet/src/core/rng.js `makeRng`). Gauntlet is airtight in both
 * directions, so the root game carries its own copy rather than importing the
 * sibling's palette. The values are Gauntlet's, unchanged: they were tuned
 * there and the species look is judged against them.
 */

export const PALETTE = Object.freeze({
  realCrowBlack: 0x2b2d34,      // contour plumage: blue-black, ~0.025 linear
  realCrowFlight: 0x282b35,     // flight feathers, a shade bluer
  realCrowBill: 0x131418,
  realCrowLeg: 0x17171b,
  realCrowIris: 0x2e1c12,       // dark brown
  realCrowPupil: 0x050506,
  realCrowMembrane: 0x9aaabd,   // nictitating membrane: the crow's blink
  realCrowSheen: 0x161c2c,      // near-black blue: never greys the bird
  realHoodedGrey: 0x8b8c88,     // hooded crow mantle and underparts
  realHoodedSheen: 0x34363a,
  realBrass: 0xb08d57,          // brushed brass
  realBrassDark: 0x7a5f36,      // aged brass/bronze: panels, recesses, collars
  realOxide: 0x3a2e1e,          // oxidised seam grooves
  realOwlDisc: 0xe3d8bd,        // cream enamel facial disc (every tier)
  realCopper: 0xc98257,
  realSteel: 0xbcc0c6,
  realNickel: 0xcdcabf,
  realGunmetal: 0x4f555d,
  realBluedSteel: 0x3b475c,
  realEnamel: 0xd98a1c,         // amber enamel iris
  realEnamelPupil: 0x0a0a0d,
  realShutter: 0x5d636b,        // the owl's eye shutter (its blink)
  realBacking: 0x1c1d20,        // blackened steel: the plate the gears turn over
});

/** mulberry32: a small, fast, seedable PRNG in [0, 1). */
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
