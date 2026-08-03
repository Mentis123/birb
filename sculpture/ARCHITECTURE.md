# Bronze — architecture and working notes

A 3D study of the bronze group outside **The Women's** (Royal Women's Hospital,
Parkville, Melbourne). Michael Meszaros, 2008, commissioned via the Harold
Mitchell Foundation for the hospital's opening; Google Maps lists it as
"Women's Sculpture".

Lives at `sculpture/`, deploys with the main site to
**birbmobile.vercel.app/sculpture**. Unlisted: `noindex`, linked from nowhere.

**Read this before touching anything.** Then read `LIKENESS.md`, which is the
scorecard, and the header comment of whichever module you are about to change —
most of the expensive lessons on this model are recorded at the site of the code
that caused them.

---

## What it is, in one paragraph

Four bronze women standing close in a crowded diagonal. Each is generated in
code from profile tables and signed distance fields — the running page loads no
model, image, font or texture assets. The repository's reference and validation
images are development evidence only. You drag to orbit, pinch to zoom, two
fingers to pan, double-tap to reset, and hold three fingers to raise a QR of the
production URL.

## Hard rules

1. **Zero production assets.** The running page imports no images, meshes, fonts
   or textures; every surface is generated. `reference/` and `validation/` hold
   development evidence only and must never be imported by the application.
   This is not purism: generated geometry is what makes every proportion a
   NUMBER in a table that can be tuned against a photograph.
2. **No build step.** Vanilla ES modules, Three pinned at 0.183.2 from esm.sh.
3. **Airtight against the rest of the repo.** Nothing in `sculpture/` imports
   from `src/` or `gauntlet/`, and nothing outside imports from inside it.
   `sw.js` explicitly bypasses `/sculpture` — that is a correctness fix, not
   tidiness: the service worker's `networkFirst` caches every navigation under
   the key `./index.html`, so one visit here would overwrite Birb Mobile's
   offline shell.
4. **The reference photographs are the authority.** Not memory of them, not
   reasoning about what a sculpture should look like. When you disagree with the
   photo, the photo wins; when the gate and your eye disagree, RE-MEASURE.

---

## Module map

```
sculpture/
  index.html            scene, renderer, ground, boot, harness hooks
  ARCHITECTURE.md       this file
  LIKENESS.md           the 41-check rubric and the current score
  reference/            Mentis's four photos, EXIF-transposed only
  validation/           committed closeout records and render evidence; not runtime
  dev/probe-parts.html  render any subset of ONE figure in isolation
  src/
    core/three-loader.js   CDN or local Three, per ?three=local
    core/noise.js          value noise + fbm3, deterministic
    core/rng.js            seeded RNG (shared shape with Gauntlet)
    model/sdf.js           sdEllipsoid/sdCapsule/sdRoundBox, smin/smax/subtract,
                           surfaceNets
    model/figure.js        ONE figure: shell, body field, head field, feet
    model/sculpture.js     the four of them, arranged, patinated, lit
    view/orbit.js          orbit / pinch / two-finger pan, hand-rolled
    ui/qr.js               QR encoder, byte mode, ECC M, versions 1-10
    ui/qr-overlay.js       three-finger gesture, Birb Labs convention
tools/
  sculpture-shot.mjs        one view, one browser boot
  sculpture-sheet.mjs       all seven views, ONE boot, composited vs the photos
  sculpture-views.mjs       the reference camera poses
  sculpture-proportions.mjs the measurable half of the likeness gate
tests/sculpture-orbit.test.js   panBasis
```

## The build pipeline

One figure, in order, all in `model/figure.js`:

```
SHELL_PROFILE + FRONT_OPENING + shellOffsetZ
      └─ buildShell()      swept crescent, two walls, hem closed, top left open
                           → roughen() x2 (broad ripple, then hammer marks)

TORSO_PROFILE + sdEllipsoid/sdCapsule primitives
      └─ buildBodyField()  ONE smin-blended field → surfaceNets @ 13.5mm voxel

skull/jaw/hair/bun/face primitives
      └─ buildHeadField()  separate field → surfaceNets @ 6.2mm voxel

buildFeet()                heel + toe spheres

      └─ mergeGeometries() → one BufferGeometry per figure
```

Then in `model/sculpture.js`: `paintPatina()` writes vertex colours, four meshes
share one `MeshStandardMaterial`, plus a base slab and the light rig.

Phase 3's measured scene cost is **490,840 triangles and 6 draw calls** for the
last rendered frame. Do not retain the old ~75k-per-figure / ~302k-total estimate:
the finer block-head fields raised the complete scene to roughly 491k, and the
four heads are not identical enough for a useful per-figure average. In the
simulated 390×844 Chromium baseline, navigation to `__SCULPT_READY` took 4.63s;
active software-rendered orbit measured 4.91 FPS. Those are CI/SwiftShader
numbers, not iPhone results — see `validation/phase-3-closeout.md`.

The page still renders **on demand**: `orbit.update()` returns whether anything
moved and no additional renderer pass is issued while the sculpture is still.
`renderer.info.render.calls` therefore remains the cost of the most recent
render, not a claim that the last frame contained zero draw calls.

### Why surface nets and not marching cubes

Marching cubes needs a 256-entry edge table and a 256×16 triangle table — a
screenful of magic numbers with no way to review them. Surface nets is sixty
readable lines, and on organic blobby fields it is smoother because each cell
contributes ONE vertex at the mean of its edge crossings rather than up to five
triangles pinned to the edges.

### Why a distance field and not a union of primitives

A union of surfaces has a crease wherever two surfaces meet. Cast bronze has no
creases, it has fillets. `smin` gives you one, with the radius as the modelling
decision.

---

## Invariants — do not undo these

Each cost at least one full pass to find.

**Every generated surface must be closed and outward-wound.** A FrontSide
material culls an inward-wound near surface and exposes the far interior, which
looks like clipping, transparency or missing bronze. The Phase 4 integrity
repair found negative signed volume in the body, head and cloak, plus open cloak
and head boundary rings. Keep the surface-nets and cloak winding outward, cap
both ends of the cloak wall, and preserve Three's normal closed-solid shadow
pass. Do not use `material.shadowSide` to mask broken topology.

**The blend radius must be well under the protrusion.** The one rule of
modelling with `smin`, broken by default, broken silently. A bust standing 0.02
proud of the chest wall blended at k = 0.10 is not a soft bust, it is no bust at
all. The first SDF pass lost the bust, the belly, the bundle, the brow, the nose
and the lips to exactly this.

**Every sampling box must clear its contents' caps.** `surfaceNets` leaves a
torn open rim wherever the box cuts through geometry. The body box topped out at
y = 2.13 while the neck capsule's cap reaches 2.167, and the resulting slab read
as a dark trapezoidal visor across every face. Three passes were spent hunting
it as a lighting bug, a shadow bug and a facial-geometry bug; one
`MeshNormalMaterial` render found it immediately. Sampling bounds are
world-axis-aligned, so they must also contain the full rotated head, not only its
forward-facing extent.

**Thin features do not survive the mesher, and it fails silently.** Surface nets
places one vertex per cell at the mean of its edge crossings, so a form three or
four cells thick is averaged into nothing. It defeats every check short of
looking: the field is correct under a numeric march, and a max-z sweep of the
MESH also finds the feature, because the few stray slivers that survive are still
the highest vertices in the band. Every measurement agrees it is there and no
render shows it. **A `MeshNormalMaterial` pass is what settles it** — it shows
the surface with nothing to argue about. Keep facial features at least six cells
thick, which for these faces means a brow that is a slab, not a line.

**`headField` works in HEAD units about `YC0`, never in world units about `yc`.**
Mixing them shifts every offset by the same amount, so the head stays internally
correct and simply sits 62mm below where `FIGURE_LANDMARKS` says — and the gate
goes green measuring a head that is not there.

**Two closed surfaces at equal radius intersect in a hard rim.** The head and
body are separate meshes, not one field. Wherever they overlap, the inner one
must be strictly thinner or you get a visible seam. The head's neck stub is
0.048 against the body's 0.062 for this reason.

**The patina's occlusion term uses a FIXED radius, not the geometry's extent.**
Normalising by max radius was fine until the cloaks grew trains: one vertex a
metre out rescaled everything, every point on the torso landed near r = 0, and
the bodies flooded with crevice black.

**Light intensity and albedo are one knob turned opposite ways.** Three's lights
are plain irradiance multipliers, so the body colour, runoff multiplier and fill
must be tuned as one system. The first Phase 4 pass combined a 0.148 body colour,
a 0.72 runoff floor and an orange 1.82 key; real orbit views collapsed into black
and tan slabs. The corrected rig uses a 0.215 olive-brown body, a 0.88 runoff
floor, a neutral-warm 1.60 key, a 0.90 hemisphere and a 0.78 cool rear fill. This
keeps the front modelled and the full orbit readable.

**The key light sits about 22° off-front at 28° elevation, and both brackets are
real.** Swing it out to the side and the cloak's flank — which runs the figure's
full height — throws a shadow straight across the chest, so the bust and belly
become the darkest part of the frame. Push it high and frontal to fix that and
every piece of relief flat-lights: the noses vanish and the only shadow left on a
head is the one under the chin, which reads as a black visor.

**The pan is clamped and the tap detector is gesture-scoped.** Counting every
`pointerup` toward the double-tap timer made the end of any two-finger gesture
look like a double tap — two fingers lift within milliseconds of each other — so
letting go of a pinch snapped the view back to default.

---

## What the sculpture actually looks like

Written down because the first version of this model described a completely
different object. **The four reference photos arrive with EXIF orientation 3.**
`ImageOps.exif_transpose` alone is the correct fix; an extra flip
double-corrects and mirrors the signage, which is how you can tell you have got
it wrong. The original plan was written against un-rotated images and described
hooded figures with flared cloaks.

- **The cloak stands BEHIND the woman and the whole front is open.** It covers
  her back, curls a little round her sides, rises into a hollow collar-arch
  behind her head, and that is all it does. Her face, throat, shoulders, breasts
  and belly are in open air in front of it. Modelled with a 0.55 rad opening and
  a shared axis, the shell is a near-complete tube with a slot in it: the body
  was fully and correctly modelled the whole time and not one square millimetre
  was visible. The group rendered as four ghosts for four passes.
- **The figures are flat slabs.** Depth is about half the width; the cloak is a
  PANEL, and a thick cast one — every free edge shows section.
- **The group is a crowded diagonal**, nearest figure front-left, each of the
  others further back and further right, all facing roughly the same way and
  turning a little more right as they go back. Not a zigzag, not a rank.
- **They are WALKING.** Hems raked back off a planted forward foot.
- **They are heavy and big-headed** — about five and a half heads tall, shoulder,
  bust and waist spans all within 0.03 of each other. A column, not an hourglass.
- **Every figure carries a story**, and this is the subject of the piece: one
  heavily pregnant, one cradling a swaddled newborn on her forearms, one a
  clinician with a stethoscope round her neck. Building them is not the same as
  their reading — see `LIKENESS.md` F2 and F3 for how each one failed to read
  while being measurably present in the mesh.
- **The heads are intentionally non-uniform.** The nearest is bare/plain, the
  turned-away head is faceless, and two carry a coiled top-knot. Faces are
  planar with a long nose ridge from the brow, hollow triangular eye sockets and
  a wide flat mouth. Do not restore one identical cap to all four.

### Reference set

`sculpture/reference/` holds Mentis's four photos. Seven Google Maps community
photos were used TRANSIENTLY for measurement and deliberately **not committed** —
they are other people's copyrighted images, and only the landmarks extracted from
them feed the model. Everything they changed is written down above.

---

## Verification protocol

**Nothing is claimed without a captured frame.** These three tools exist because
every real bug in this model fell to an isolation test and none fell to tuning.

```bash
# The likeness loop. Photo | model at matched cameras, seven views, one boot.
node tools/sculpture-sheet.mjs --out shots/sculpt/sheet.png

# The measurable half of the gate. Exits non-zero when a proportion is off.
node tools/sculpture-proportions.mjs

# One view, when you need a specific angle or a debug material.
node tools/sculpture-shot.mjs --page sculpture/index.html --out shots/x.png \
  --query "three=local" --w 780 --h 950 --dpr 2 --wait 60000 \
  --eval "(()=>{const S=window.__SCULPT;S.orbit.setTarget(0,1.25,0);S.setView(0,4,5.1);S.renderer.render(S.scene,S.camera);})()"

# ONE figure, any subset of its parts.
node tools/sculpture-shot.mjs --page sculpture/dev/probe-parts.html \
  --out shots/probe.png --query "three=local&only=body,head&side=front" ...
```

Both harnesses **exit non-zero on any page or console error**, so a captured PNG
is evidence the code ran.

### The four moves that have actually found bugs here

1. **Render the pair.** Model beside the photograph at the same camera. Ninety
   unmatched renders missed a hem 40% too wide; the first sheet showed it in a
   minute.
2. **Turn one thing off.** Shadows off proved the "material problem" was the
   depth pass. `castShadow` off on the figures proved it was self-shadowing.
3. **Swap the material.** `MeshNormalMaterial` found the clipped neck after three
   passes of chasing it as light.
4. **Measure the mesh, not the render.** Walking the vertex buffer for the
   forward extent at belly height proved the swaddled bundle was present at
   0.261m and the problem was that it read as a pregnancy.

### Gotchas in the harness itself

- `page.evaluate(someString, arg)` **drops the argument.** Playwright treats a
  string as an expression. The first contact sheet rendered seven identical
  pictures under seven different labels, which is worse than no sheet because it
  looks like evidence. Pass a real function.
- The page keeps damping and, after nine idle seconds, starts a slow idle spin.
  A multi-view sheet takes longer than that, so re-park after the settle.
- Phase 3's ~491k-triangle mesh can make a software-rendered Chromium screenshot
  exceed Playwright's 30-second default even after `__SCULPT_READY` is true.
  Readiness and PNG readback are separate deadlines; use the sheet harness's
  `--screenshot-timeout` rather than misreporting a slow readback as a model
  construction failure.
- `--eval` must be a single expression; wrap multi-statement scripts in an IIFE.
- The harness needs `npm install --no-save playwright three-real@npm:three@0.183.2`
  followed by `git checkout -- node_modules/three/index.js`, because any npm
  install prunes the hand-written Three test stub this repo tracks there and
  silently breaks `npm test`.

---

## Where the model is, and what is left

**`LIKENESS.md` is the scorecard: 41 binary checks, 90% is 37 of them.
Phase 4 independently revalidated at 35 / 41.** The proportion gate is GREEN at
0 of 12 outside tolerance, worst +0.023 — which is necessary and not sufficient,
since this gate has been green and wrong twice. The full closeout record and
committed evidence are in `validation/phase-4-closeout.md`,
`validation/phase-4-revalidated.png` and `validation/phase-4-arm-probes.png`.

The remaining work, in the order the evidence says to do it:

**Phase 1 — Mass. DONE (2026-08-02).** Every span widened ~20%, shoulder line
dropped 1.911 → 1.849, head grown 33%, bust dropped 0.07 of figure height, and
the torso table lost its waist — measured on the nearest figure the spans widen
monotonically from shoulder to hem, where every earlier version pinched and
flared. The train became a DISPLACEMENT rather than a radius scale, which was
the whole of the 0.56-vs-0.39 hem error. Group tightened to 0.50 spacing across
0.80-wide cloaks so it reads as one mass. Gate green, A1-A5 and B2/B4/D3/E6.

**Phase 2 — The cloak as cast bronze, and the stride. DONE (2026-08-02).** The
front opening now never closes and the SKIRT is part of the body field running to
the paving — that is what the V-notch up every figure's front actually was, and
it could not be tuned away because a cloak that closes has to close somewhere.
Every free edge carries a rounded bead built into one closed cross-section. Hems
rake off a leading foot, columns shear forward of vertical, and no two figures
agree on stride, rake, lean or head angle. Feet resized 3x — at 0.10m long they
read as pebbles wherever they were put. B3 and C4 remain.

Add to the invariants: **the feet are seated against the SKIRT's front face, not
the cloak's.** The cloak stopped reaching the front of the figure when its
opening was run full height, and anything still positioned against the old
outline stands a fifth of a metre clear of the model.

**Phase 3 — Heads. DONE (2026-08-02).** The head is a rounded BLOCK, not an
ovoid — flat front, flat sides, domed top. The nearest is bare/plain, the
turned-away head is faceless, and two carry coiled top-knots. E3 and E5 remain:
the eye sockets are lenses where the reference has hollow triangles, and the
hair's temple edge is not legible at group distance.
**Phase 4A — Arms and negative space. DONE (2026-08-03).** Four reference-led
arm paths replace the generic vertical pair: the nearest arm opens a visible
wedge beside the ribs, the pregnant figure supports the belly, the mother's
forearms cross beneath the baby, and the clinician's far arm sweeps back. `A7`
and `F4` now pass.

**Phase 4B — Surface and bronze. DONE (2026-08-03).** Existing shell roughness
and body-field noise were strengthened rather than replaced. Patina runoff
combines broad and fine vertical bands, but its contrast is bounded so it cannot
replace the scene's shadows. A neutral-warm key, stronger sky floor and cool rear
fill keep the weathered bronze readable through the full orbit. `G2`, `G3` and
`G5` pass after the post-merge lighting correction.

**The current Phase 4 scene is 498,028 triangles, 6 draw calls and 4 figures.**
The committed simulated-mobile record is internally clean but is still a
SwiftShader result. A real iPhone 12-or-newer load and orbit test remains
outstanding and is part of the final ship gate. Do not optimize geometry from
the software-rendered timings alone; if a real phone reproduces poor
interaction, test a lower mobile DPR cap before changing mesh resolution.

### Phase 5A — arrangement, weight and shadow

Target `C4`, `D2` and `H3`.

### Phase 5B — remaining form and facial refinements

Target `B3`, `E3` and `E5`.

### Final ship gate

- at least 37 / 41, honestly rescored;
- proportions still green;
- full test suite green;
- matched contact sheet committed or reproducibly archived;
- real iPhone 12-or-newer interaction and load test;
- no console errors;
- acceptable initial construction time and orbit performance.

### Process rules for that run

- Probe or measure before tuning. Every real bug fell to an isolation test.
- One contact sheet per change, not five single renders.
- Score the WHOLE rubric each time. Half the regressions on this model came from
  fixing one thing.
- Use the Edit tool, not `python3 - <<PY` patch scripts. Two of those silently
  no-oped mid-session by asserting after the write had already been skipped.
