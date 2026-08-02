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
        note: 'Front, standing height. The clearest read of all four faces and the bare torsos.',
        fov: 44,
        yaw: -2,
        pitch: 4,
        distance: 3.9,
        targetY: 1.34,
    },
    {
        id: 'b-threequarter',
        photo: 'ref-b-threequarter.jpg',
        crop: [200, 120, 900, 1080],
        note: 'Front-left, close. Shows the cloaks as panels behind the bodies and the stethoscope.',
        fov: 49,
        yaw: 56,
        pitch: 5,
        distance: 3.3,
        targetY: 1.24,
    },
    {
        id: 'c-under',
        photo: 'ref-c-under.jpg',
        crop: [200, 120, 950, 1080],
        note: 'Low, from the front-left, group silhouetted against sky. THE structural reference: '
            + 'the open front, the hollow collar-arch, the feet, the raked hems.',
        fov: 49,
        yaw: -12,
        pitch: -7,
        distance: 3.1,
        targetY: 1.16,
    },
    {
        id: 'd-wide',
        photo: 'ref-d-wide.jpg',
        crop: [440, 250, 620, 960],
        note: 'From the group\'s right. The plain turned-away head and the long trailing hem.',
        fov: 44,
        yaw: 62,
        pitch: 3,
        distance: 4.4,
        targetY: 1.30,
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

export default REFERENCE_VIEWS;
