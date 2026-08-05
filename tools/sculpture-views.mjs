/**
 * sculpture-views.mjs — the four reference photographs, as camera poses.
 *
 * WHY THIS EXISTS. Every likeness judgement on this model until now was made by
 * rendering the model, looking at it, and comparing it against a memory of the
 * photograph. That is how a wrong landmark table once got solved to green while
 * the render visibly got worse, and it is why a torso that was correctly
 * modelled the whole time went four passes without anyone noticing it was
 * invisible. The fix that actually found every real bug in this model was the
 * matched A/B — shadows off, normal material, body without cloak — and the
 * likeness loop should work the same way: put the render and the photograph
 * side by side, at the same camera, and look at the pair.
 *
 * So each entry below pairs a crop of one reference photo with a camera pose
 * that frames the model the same way. `tools/sculpture-sheet.mjs` renders all of
 * them in one browser session and composites the pairs.
 *
 * HOW THE POSES WERE DERIVED, and how to correct one.
 *
 * The photographs are iPhone main-camera frames: 4:3, roughly 68 deg horizontal,
 * which is about 54 deg vertical. THE CROP'S fov is what matters, not the
 * photo's — a 950px-tall crop of a 1200px frame covers
 * 2*atan(tan(26.9 deg) * 950/1200) = 44 deg, and matching the render to 54 would
 * make the model look wrong in its perspective rather than in its shape.
 *
 * Distance follows from how much of the crop the 2.42m figure fills: visible
 * height = 2 * d * tan(fov/2). Camera height follows from what lands on the
 * crop's horizontal centre line, since a level camera puts its own height there.
 *
 * Yaw comes from the stagger — WHICH END OF THE DIAGONAL IS NEAREST. That one
 * observation separates the four photographs cleanly: in ref-a and ref-c the
 * nearest figure is at frame LEFT and the group recedes to the right, so the
 * camera is near the group's front; in ref-b and ref-d the nearest is at frame
 * RIGHT, so those are taken from round the group's right-hand side.
 *
 * These are approximations and they are ALLOWED to be. The point is a matched
 * framing, not a solved camera: two images at the same scale and roughly the
 * same angle make a difference of shape obvious, which is all the rubric needs.
 * If a pair is clearly mis-framed, nudge `yaw`/`pitch`/`distance` here rather
 * than reasoning about it — one sheet run shows you whether it helped.
 *
 * Crops are [x, y, w, h] in the 1600x1200 originals, chosen to hold the whole
 * group with a little air. The render is captured at the crop's aspect ratio so
 * the two sit at the same scale.
 */

export const REFERENCE_VIEWS = [
    {
        id: 'a-front',
        photo: 'ref-a-front.jpg',
        crop: [240, 250, 900, 950],
        note: 'Outward/community side: developing abdomen, newborn and visitor reliefs, with alternating hospital-side recesses.',
        fov: 44,
        yaw: -24,
        pitch: 4,
        distance: 3.75,
        target: [-0.16, 1.34, 0.04],
    },
    {
        id: 'b-threequarter',
        photo: 'ref-b-threequarter.jpg',
        crop: [200, 120, 900, 1080],
        note: 'Hospital side: badge, full pregnancy and doctor/stethoscope reliefs in reversed physical order.',
        fov: 49,
        yaw: 214,
        pitch: 5,
        distance: 3.55,
        target: [0.10, 1.24, -0.04],
    },
    {
        id: 'c-under',
        photo: 'ref-c-under.jpg',
        crop: [200, 120, 950, 1080],
        note: 'Low hospital-side view: three active reliefs, three recessed backs and the alternating planted feet.',
        fov: 49,
        yaw: 150,
        pitch: -7,
        distance: 3.55,
        target: [-0.12, 1.16, -0.03],
    },
    {
        id: 'd-wide',
        photo: 'ref-d-wide.jpg',
        crop: [440, 250, 620, 960],
        note: 'Oblique outward side: newborn, visitor and the foreground reverse-sheet edge.',
        fov: 44,
        yaw: 34,
        pitch: 3,
        distance: 4.15,
        target: [0.30, 1.30, 0.02],
    },
];

/**
 * Extra poses with no photograph behind them, for the parts of the object no
 * reference covers. Judged for internal consistency, not likeness.
 */
export const REVIEW_VIEWS = [
    { id: 'side', fov: 40, yaw: -92, pitch: 4, distance: 5.2, targetY: 1.25 },
    { id: 'back', fov: 40, yaw: 184, pitch: 6, distance: 5.2, targetY: 1.25 },
    { id: 'head', fov: 40, yaw: -8, pitch: 2, distance: 1.05, targetY: 2.10 },
];

/**
 * Neutral eight-angle identity audit. These views are deliberately independent
 * of the reference-camera guesses: they expose which figure, face and narrative
 * detail is physically present at every azimuth before a matched camera is
 * accepted. Keeping this grid reproducible prevents a good crop from hiding a
 * wrong body turn or an occluded figure.
 */
export const IDENTITY_AUDIT_VIEWS = Array.from({ length: 8 }, (_, index) => {
    const yaw = index * 45;
    return {
        id: `identity-${String(yaw).padStart(3, '0')}`,
        viewport: [900, 900],
        fov: 40,
        target: [0, 1.25, -0.10],
        yaw,
        pitch: 4,
        distance: 4.70,
        note: `Neutral ${yaw} degree identity and occlusion audit.`,
    };
});


/**
 * Phase 4 visual-acceptance poses. These reproduce the close desktop/mobile
 * views that exposed the whole-figure turn, infant, instrument and foot defects.
 * They are intentionally separate from the seven general matched/review views.
 */
export const PHASE4_ACCEPTANCE_VIEWS = [
    {
        id: '01-desktop-front', viewport: [1600, 1000], fov: 40,
        target: [0, 1.25, -0.10], yaw: 0, pitch: 4, distance: 4.70,
        note: 'Complete front grouping and coherent rear-facing figure.',
    },
    {
        id: '02-desktop-threequarter', viewport: [1600, 1000], fov: 40,
        target: [0, 1.25, -0.10], yaw: 48, pitch: 5, distance: 4.70,
        note: 'Opposite face evidence, group overlap and trailing cowls.',
    },
    {
        id: '03-whole-figure-turn', viewport: [1200, 900], fov: 40,
        target: [-0.25, 1.58, 0.06], yaw: 0, pitch: 2, distance: 2.45,
        note: 'Rear-facing body, cowl and head rotate together.',
    },
    {
        id: '04-infant-instrument', viewport: [1400, 900], fov: 40,
        target: [0.42, 1.56, -0.48], yaw: 2, pitch: 2, distance: 2.55,
        note: 'Closed swaddle, curved support and two separate instrument tubes.',
    },
    {
        id: '05-ground-level-feet', viewport: [1500, 720], fov: 40,
        target: [0, 0.19, -0.12], yaw: 0, pitch: 2, distance: 3.05,
        note: 'Robe-rooted feet across the full group.',
    },
    {
        id: '06-fused-foot-close', viewport: [1200, 700], fov: 40,
        target: [-0.93, 0.09, 0.82], yaw: 0, pitch: 5, distance: 1.35,
        note: 'Buried root, instep, narrow forefoot and restrained toe edge.',
    },
    {
        id: '07-opposite-rear', viewport: [1600, 1000], fov: 40,
        target: [0, 1.25, -0.10], yaw: 180, pitch: 4, distance: 4.70,
        note: 'Closed rear surfaces and readable cowl planes.',
    },
    {
        id: '08-mobile-full', viewport: [390, 844], fov: 40,
        target: [0, 1.22, -0.10], yaw: 0, pitch: 4, distance: 6.50,
        note: 'Full group at the production mobile viewport.',
    },
    {
        id: '09-mobile-detail', viewport: [390, 844], fov: 40,
        target: [0.38, 1.45, -0.46], yaw: 1, pitch: 3, distance: 2.75,
        note: 'Infant, support and instrument at the production mobile viewport.',
    },
];

/**
 * Phase 5 likeness poses. Each diagnostic view isolates one remaining rubric
 * item at a camera and pixel scale that can expose a false positive. Source
 * crops are paired with the render wherever the photographs contain evidence.
 */
export const PHASE5_ACCEPTANCE_VIEWS = [
    {
        id: 'p5-01-outward-order', photo: 'ref-a-front.jpg', crop: [240, 250, 900, 950],
        viewport: [1400, 900], fov: 44, target: [-0.16, 1.34, 0.04],
        yaw: -24, pitch: 4, distance: 3.25,
        note: 'Outward side shows developing abdomen, swaddled newborn and visitor in the photographed order.',
    },
    {
        id: 'p5-02-hospital-order', photo: 'ref-b-threequarter.jpg', crop: [200, 120, 900, 1080],
        viewport: [1400, 900], fov: 49, target: [0.10, 1.24, -0.04],
        yaw: 214, pitch: 5, distance: 3.10,
        note: 'Hospital side shows badge, full pregnancy and clinician in the reversed physical order.',
    },
    {
        id: 'p5-03-negative-relief', photo: 'ref-d-wide.jpg', crop: [440, 250, 620, 950],
        viewport: [1100, 900], fov: 44, target: [1.05, 1.10, -0.20],
        yaw: -28, pitch: 2, distance: 2.45,
        note: 'End-on oblique view exposes the badge reverse as a closed blank head and full-height recessed sheet.',
    },
    {
        id: 'p5-04-newborn-support', photo: 'ref-a-front.jpg', crop: [620, 300, 600, 560],
        viewport: [1200, 900], fov: 26, target: [-0.23, 1.44, 0.42],
        yaw: -24, pitch: 2, distance: 2.45,
        note: 'Fully wrapped newborn block remains distinct above one substantial U-shaped support.',
    },
    {
        id: 'p5-05-pregnancy-instrument', photo: 'ref-b-threequarter.jpg', crop: [200, 240, 900, 700],
        viewport: [1400, 900], fov: 32, target: [-0.15, 1.48, -0.04],
        yaw: 214, pitch: 2, distance: 2.95,
        note: 'Full pregnancy and two-ended stethoscope remain distinct at one delivery scale.',
    },
    {
        id: 'p5-06-grounded-feet', photo: 'ref-c-under.jpg', crop: [180, 690, 1000, 510],
        viewport: [1400, 800], fov: 40, target: [0.10, 0.62, -0.10],
        yaw: 204, pitch: -7, distance: 3.60,
        note: 'Alternating planted feet and thin closed fin bases survive the low view.',
    },
    {
        id: 'p5-09-outward-identities', photo: 'ref-a-front.jpg', crop: [220, 240, 1080, 430],
        viewport: [1400, 780], fov: 30, target: [-0.24, 2.08, 0.08],
        yaw: -24, pitch: 0, distance: 2.75,
        note: 'Matched head-level view exposes the developing, mother and visitor face and crown silhouettes.',
    },
    {
        id: 'p5-10-hospital-identities', photo: 'ref-c-under.jpg', crop: [180, 190, 1220, 450],
        viewport: [1400, 780], fov: 30, target: [0.20, 2.08, -0.08],
        yaw: 204, pitch: 0, distance: 2.75,
        note: 'Matched head-level reverse view exposes badge, pregnant and clinician identities and facing.',
    },
    {
        id: 'p5-11-developing-face', photo: 'ref-a-front.jpg', crop: [270, 250, 320, 320],
        viewport: [1000, 800], fov: 22, target: [-1.20, 2.10, 0.28],
        yaw: -24, pitch: 0, distance: 1.40,
        note: 'True close-up resolves the developing face silhouette, brow, sockets, nose and mouth.',
    },
    {
        id: 'p5-12-badge-close', photo: 'ref-b-threequarter.jpg', crop: [170, 350, 390, 300],
        viewport: [1000, 800], fov: 16, target: [1.06, 1.70, -0.43],
        yaw: 214, pitch: 1, distance: 1.45,
        note: 'True close-up resolves the hospital badge as a separate rectangular chest relief.',
    },
    {
        id: 'p5-13-stethoscope-close', photo: 'ref-b-threequarter.jpg', crop: [560, 365, 190, 210],
        viewport: [1000, 800], fov: 18, target: [-0.70, 1.68, -0.20],
        yaw: 214, pitch: 1, distance: 1.60,
        note: 'True close-up resolves two substantial cast tubes and their separate terminals.',
    },
    {
        id: 'p5-14-foot-close', photo: 'ref-a-front.jpg', crop: [850, 760, 500, 420],
        viewport: [1000, 800], fov: 20, target: [0.71, 0.10, 0.39],
        yaw: -24, pitch: 5, distance: 1.70,
        note: 'True close-up resolves the visitor foot root, instep, forefoot and tapered toe.',
    },
    {
        id: 'p5-07-mobile-outward', viewport: [390, 844], fov: 50,
        target: [-0.15, 1.22, 0], yaw: -55, pitch: 4, distance: 5.40,
        note: 'Production mobile framing preserves all three outward narratives.',
    },
    {
        id: 'p5-08-mobile-hospital', viewport: [390, 844], fov: 50,
        target: [0.15, 1.22, 0], yaw: 125, pitch: 4, distance: 5.40,
        note: 'Production mobile framing preserves all three hospital narratives.',
    },
];
export default REFERENCE_VIEWS;
