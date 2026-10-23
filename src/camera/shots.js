// Shots: camera flights through the world, as DATA.
//
// One entry per shot. Positions and look targets are references into the live
// world (landmarks, actors), never raw coordinates, so a shot holds on every
// world seed. The kernel is src/camera/flythrough.js; tools/birb-flythrough.mjs
// audits a shot (camera never in the ground or water, speed bounded) and
// renders it frame by frame; `?shot=<name>` plays it in the game and
// `?studio=1&shot=<name>&record=1` records a clean WebM in real time.
//
// Ref forms: { around: id, radius, height, angle } circles a landmark;
// { landmark: id, offset: [forward, up, side] } is in the landmark's own frame
// (an arch's forward runs THROUGH its opening); { actor: name, offset:
// [along, up, side] } chases something that moves. `bird: { lead }` puts the
// bird on the path `lead` seconds ahead of the camera, which then looks at it.

const FADE = (d) => [[0, 1], [1.6, 0], [d - 1.6, 0], [d, 1]];

// A reel's fade is short: a 15-second clip cannot spend three of them in black.
const REEL_FADE = (d) => [[0, 1], [0.5, 0], [d - 0.6, 0], [d, 1]];

export const SHOTS = [
  {
    // The 15-second portrait reel:
    // ?studio=1&aspect=9:16&seed=16160&shot=reel-forest&record=1
    // A drone pass, not a chase. It starts on the arch lit warm from the side,
    // threads the opening, lifts over the crown that stands right behind it,
    // rides the treetops and turns back onto the arch against the light.
    // Framed on world seed 16160; on another world the planner re-aims it.
    // Five rounds of stills chose it. Following the bird kept the lens on the
    // bird against the sky. An exit "14 up" at 90 units out is 40+ above the
    // forest, because the planet curves away d^2/2R under a landmark's
    // tangent plane.
    name: 'reel-forest',
    title: 'Reel: golden hour through the arch (15 s)',
    world: 'forest',
    fov: 60,
    sun: { elevation: 14, bearing: 125 },
    audit: { minClearance: 3, maxSpeed: 40 },
    fade: REEL_FADE(15),
    keys: [
      { t: 0, pos: { landmark: 'stone-arch', offset: [-70, 16, 22] }, look: { landmark: 'stone-arch', offset: [0, 9, 0] } },
      { t: 5, pos: { landmark: 'stone-arch', offset: [-26, 8, 5] }, look: { landmark: 'stone-arch', offset: [0, 8, 0] }, ease: 'inOut' },
      { t: 7.5, pos: { landmark: 'stone-arch', offset: [-4, 7, 0] }, look: { landmark: 'stone-arch', offset: [20, 22, -14] }, pin: true },
      { t: 10, pos: { landmark: 'stone-arch', offset: [10, 24, -12] }, look: { landmark: 'stone-arch', offset: [40, 14, -40] } },
      { t: 15, pos: { landmark: 'stone-arch', offset: [46, 38, -34] }, look: { landmark: 'stone-arch', offset: [0, 8, 0] }, ease: 'inOut' },
    ],
  },
  {
    name: 'valley',
    title: 'The falls — every biome',
    world: '*',
    fov: 50,
    audit: { minClearance: 4, maxSpeed: 40 },
    fade: FADE(32),
    keys: [
      // Down the valley's own axis, from downstream (-forward: the falls face
      // that way, and the planner turned the first draft round by PI on
      // nearly every world to get there). The pool sits in a cliff-walled bowl and
      // an ORBIT sees into it from almost nowhere (the audit measured 50-87%
      // of an orbit's frames looking at the rim, from any height up to +42);
      // along the river's cut the falls are in clear sight in every biome.
      { t: 0, pos: { landmark: 'waterfall', offset: [-150, 95, -20] }, look: { landmark: 'waterfall', offset: [0, 8, 0] } },
      { t: 9, pos: { landmark: 'waterfall', offset: [-85, 50, -10] }, look: { landmark: 'waterfall', offset: [0, 8, 0] }, ease: 'inOut' },
      { t: 17, pos: { landmark: 'waterfall', offset: [-48, 30, 6] }, look: { landmark: 'waterfall', offset: [0, 8, 0] } },
      { t: 24, pos: { landmark: 'waterfall', offset: [-34, 24, -14] }, look: { landmark: 'waterfall', offset: [0, 8, 0] } },
      { t: 32, pos: { landmark: 'waterfall', offset: [-70, 85, -50] }, look: { landmark: 'waterfall', offset: [0, 8, 0] }, ease: 'inOut' },
    ],
  },
  {
    name: 'forest-arch',
    title: 'Through the stone arch',
    world: 'forest',
    fov: 58,
    bird: { lead: 0.9, lift: 2.5 },
    audit: { minClearance: 3, maxSpeed: 40 },
    fade: FADE(30),
    keys: [
      { t: 0, pos: { landmark: 'stone-arch', offset: [-130, 46, 34] } },
      { t: 9, pos: { landmark: 'stone-arch', offset: [-48, 12, 6] }, ease: 'out' },
      // Through the opening: pinned, so a raise for the trees never lifts
      // the bird into the arch's crown.
      { t: 13, pos: { landmark: 'stone-arch', offset: [-8, 7, 0] }, pin: true },
      { t: 17, pos: { landmark: 'stone-arch', offset: [36, 12, -10] } },
      { t: 24, pos: { around: 'giant-tree', radius: 75, height: 46, angle: 0.4 } },
      // Linear into the last key: an ease-out lets the lens catch up with a
      // bird that is 0.9 s of PATH ahead, and the last frame was all bird.
      { t: 30, pos: { around: 'giant-tree', radius: 70, height: 58, angle: 1.3 } },
    ],
  },
  {
    name: 'city-tram',
    title: 'Riding with the sky-tram',
    world: 'city',
    fov: 55,
    audit: { minClearance: 4, maxSpeed: 45 },
    fade: FADE(28),
    keys: [
      { t: 0, pos: { actor: 'skytram', offset: [-70, 34, 46] }, look: { actor: 'skytram' } },
      { t: 7, pos: { actor: 'skytram', offset: [-26, 9, 17] }, look: { actor: 'skytram' }, ease: 'out' },
      { t: 14, pos: { actor: 'skytram', offset: [-13, 3.5, 7] }, look: { actor: 'skytram', offset: [6, 0, 0] } },
      { t: 21, pos: { actor: 'skytram', offset: [12, 7, 13] }, look: { actor: 'skytram' } },
      { t: 28, pos: { actor: 'skytram', offset: [34, 48, 30] }, look: { actor: 'skytram' }, ease: 'inOut' },
    ],
  },
  {
    name: 'mountain-cable',
    title: 'Up the cable car',
    world: 'mountain',
    fov: 55,
    clock: { actor: 'cablecar-0', phase: 'ascending', progress: 0, atShotTime: 3 },
    audit: { minClearance: 3, maxSpeed: 40 },
    fade: FADE(26),
    keys: [
      { t: 0, pos: { actor: 'cablecar-0', offset: [-32, 20, 24] }, look: { actor: 'cablecar-0' } },
      { t: 9, pos: { actor: 'cablecar-0', offset: [-13, 9, 11] }, look: { actor: 'cablecar-0' }, ease: 'out' },
      { t: 18, pos: { actor: 'cablecar-0', offset: [6, 5, 12] }, look: { actor: 'cablecar-0' } },
      { t: 26, pos: { actor: 'cablecar-0', offset: [28, 30, 26] }, look: { actor: 'cablecar-0' }, ease: 'inOut' },
    ],
  },
  {
    name: 'canyon-monolith',
    title: 'Round the leaning monolith',
    world: 'canyons',
    fov: 52,
    audit: { minClearance: 4, maxSpeed: 40 },
    fade: FADE(26),
    keys: [
      { t: 0, pos: { around: 'leaning-monolith', radius: 140, height: 90, angle: 0 }, look: { landmark: 'leaning-monolith' } },
      { t: 9, pos: { around: 'leaning-monolith', radius: 70, height: 40, angle: 1.1 }, look: { landmark: 'leaning-monolith' }, ease: 'inOut' },
      { t: 18, pos: { around: 'leaning-monolith', radius: 46, height: 26, angle: 2.3 }, look: { landmark: 'leaning-monolith' } },
      { t: 26, pos: { around: 'leaning-monolith', radius: 90, height: 85, angle: 3.3 }, look: { landmark: 'leaning-monolith', offset: [0, 50, 0] }, ease: 'inOut' },
    ],
  },
];

/** Shots that can play in a biome ('*' plays anywhere). */
export function shotsFor(biome) {
  return SHOTS.filter((s) => s.world === '*' || s.world === biome);
}

export function getShot(name) {
  return SHOTS.find((s) => s.name === name) || null;
}
