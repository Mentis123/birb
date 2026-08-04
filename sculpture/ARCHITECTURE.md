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
    model/figure.js        ONE figure: shell, body field, head field, integrated stride
    model/sculpture.js     the four of them, arranged, patinated, lit
    view/orbit.js          orbit / pinch / two-finger pan, hand-rolled
    ui/qr.js               QR encoder, byte mode, ECC M, versions 1-10
    ui/qr-overlay.js       three-finger gesture, Birb Labs convention
tools/
  sculpture-shot.mjs        one view, one browser boot
  sculpture-sheet.mjs       seven general or nine Phase 4 views, one browser boot
  sculpture-views.mjs       the reference camera poses
  sculpture-proportions.mjs the measurable half of the likeness gate
tests/sculpture-orbit.test.js   panBasis
```

## The build pipeline

One figure, in order, all in model/figure.js:

    SHELL_PROFILE + FRONT_OPENING + shellOffsetZ
      -> buildShell(): swept crescent, closed wall and hem
      -> roughen() twice: broad ripple, then hammer marks

    TORSO_PROFILE + ellipsoid/capsule primitives
      -> buildBodyField(): one smooth-union field
      -> surfaceNets at 14.5 mm

    carried newborn
      -> buildBabyField(): separate closed field at 5.5 mm

    skull, jaw, hair, bun and face primitives
      -> buildHeadField(): separate field at about 5.6 mm

    clinician instrument
      -> buildStethoscopeGeometry(): two Catmull-Rom TubeGeometry paths
         with independent ringed terminals

    buildFeet(): isolation/topology probe for the body-field foot

    mergeGeometries() -> one BufferGeometry per figure

Then in model/sculpture.js: `paintPatina()` writes vertex colours, four meshes
share one `MeshStandardMaterial`, plus a base slab and the light rig.

The current Phase 5 scene measures **525,912 triangles and 6 draw calls**
in the acceptance matrices. The Phase 4 increase was deliberate: the infant
has its own 5.5 mm closed field and the instrument uses actual curved tube
geometry instead of being erased into the coarse torso field. Phase 5 adds the
deeper triangular head cavities and revised cap/cowl surfaces without
adding draw calls. Do not restore the old ~75k-per-figure / ~302k-total estimate
or PR #412's 494,596 count. The figures are not identical enough for a useful
per-figure average. The historical simulated-mobile timing remains in
validation/phase-3-closeout.md; it is a CI/SwiftShader result, not an iPhone
measurement.

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
  turned-away head presents its back while retaining a complete face on the far
  side, and two carry a coiled top-knot. Faces are planar with a long nose ridge
  from the brow, shallow eye sockets and a wide flat mouth. Do not restore one
  identical cap to all four.

### Reference set

`sculpture/reference/` holds Mentis's four photos. Seven Google Maps community
photos were used TRANSIENTLY for measurement and deliberately **not committed** —
they are other people's copyrighted images, and only the landmarks extracted from
them feed the model. Everything they changed is written down above.

---

## Verification protocol

**Nothing is claimed without a captured frame.** These three tools exist because
every real bug in this model fell to an isolation test and none fell to tuning.
The feature-scale limits, detail observation contract, measured feedback budget
and closeout criteria are in [DETAIL-QA.md](DETAIL-QA.md). Apply that protocol
before implementing any new fine feature.

```bash
# The likeness loop. Photo | model at seven general matched/review cameras.
node tools/sculpture-sheet.mjs --out shots/sculpt/sheet.png

# The Phase 4 defect loop. Nine desktop/mobile/detail views, one boot.
node tools/sculpture-sheet.mjs --phase4 --out shots/sculpt/phase4.png

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

Both harnesses **exit non-zero on any page or console error**. The single-shot
harness also reads the live WebGL framebuffer and rejects blank, transparent or
uniform output, so a file existing on disk is no longer accepted as render
evidence by itself.

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
- The ~515k-triangle mesh can make a software-rendered Chromium screenshot
  exceed Playwright's 30-second default even after `__SCULPT_READY` is true.
  Readiness and PNG readback are separate deadlines; use the sheet harness's
  `--screenshot-timeout` rather than misreporting a slow readback as a model
  construction failure.
- `--eval` must be a single expression; wrap multi-statement scripts in an IIFE.
- `sculpture-shot.mjs` reads the live WebGL framebuffer after rendering and
  rejects blank, transparent or uniform output. A created PNG is not by itself
  evidence that a 3D scene rendered.
- The harness needs `npm install --no-save playwright three-real@npm:three@0.183.2`
  followed by `git checkout -- node_modules/three/index.js`, because any npm
  install prunes the hand-written Three test stub this repo tracks there and
  silently breaks `npm test`.

---

## Where the model is

**LIKENESS.md is the scorecard: 41 binary checks, 90% is 37 of them.
Phase 5 is locally complete at 41 / 41.** The proportion gate is GREEN at 0 of
12 outside tolerance, worst +0.024 - necessary and not sufficient, since this
gate has been green while the visual result was wrong. The current closeout is
in `validation/phase-5-closeout.md`; the seven-view acceptance sheet, broader
reference matrix and six-detail contract are in the same directory.

The Phase 4 closeout and correction artifacts remain historical provenance.
The real iPhone performance and interaction gate is still open.

Phase closeout history:

**Phase 1 — Mass. DONE (2026-08-02).** Every span widened ~20%, shoulder line
dropped 1.911 → 1.849, head grown 33%, bust dropped 0.07 of figure height, and
the torso table lost its waist — measured on the nearest figure the spans widen
monotonically from shoulder to hem, where every earlier version pinched and
flared. The train became a DISPLACEMENT rather than a radius scale, which was
the whole of the 0.56-vs-0.39 hem error. Group tightened to 0.40 spacing across
0.80-wide cloaks so it reads as one mass. Gate green, A1-A5 and B2/B4/D3/E6.

**Phase 2 — The cloak as cast bronze, and the stride. DONE (2026-08-02;
acceptance corrected 2026-08-03).** The front opening never closes and the
SKIRT is part of the body field running to the paving. Every free edge carries
a rounded bead built into one closed cross-section. Hems rake off a leading
stride and no two figures agree on rake, lean or head angle.

The first closeout still modeled a planted foot as a separate closed object.
Low-angle mobile evidence showed the join and bulbous instep. The current foot
belongs to the same field as the skirt: a buried root, instep and narrower
forefoot overlap the hem deeply, while a restrained toe edge interrupts the
front silhouette without detached pebbles or a paddle. Do not restore detached
heel/toe primitives or exposed legs; ref-c-under shows a smooth robe-to-ground
extension. Phase 5 retained this foot while adding the visible load-bearing
shift required by C4 and completing the crown arch required by B3.

**Phase 3 — Heads. DONE (2026-08-02; acceptance corrected 2026-08-03).**
The head is a rounded BLOCK, not an ovoid — flat front, flat sides, domed top.
The nearest is bare/plain. The rear-facing figure now rotates as one body,
cowl and head, retaining a complete face on the opposite side without an
impossible local neck twist. Two figures carry coiled top-knots. Phase 5
replaced the shallow sockets with triangular cavities and made the smooth hair
cap terminate at a hard temple edge, completing E3 and E5.

**Phase 4A — Arms and negative space. DONE (2026-08-03; acceptance
corrected 2026-08-03).** Four reference-led paths replace the generic vertical
pair. Their radii taper from shoulder to reduced cast tips. The infant is a
separate fine closed swaddle supported by a curved forearm, and the clinician's
instrument is two independent curved tubes with two small ringed terminals.
The chest remains one shallow shelf with restrained lobes rather than attached
spheres. A7 and F4 remain passes.

**Phase 4B — Surface and bronze. DONE (2026-08-03).** Shell roughness and
body-field noise are retained, and patina runoff stays subordinate to the
lighting. The reopened rear-orbit check added a second cool source so broad cowl
planes remain visible on mobile while the frontal key preserves facial relief.
`G2`, `G3` and `G5` remain passes.

The current reproducible scene statistics and nine-view artifact are recorded in
validation/phase-4-closeout.md. The simulated browser uses SwiftShader; a real
iPhone 12-or-newer load and orbit test remains part of the final ship gate.
Do not optimize geometry from software-rendered timings alone.

### Phase 5A — arrangement, weight and shadow

DONE (2026-08-04). The upper-column weight shift, right-side projected-depth
arrangement and connected-shadow diagnostic complete `C4`, `D2` and `H3`.
Exact cameras and mesh assertions live in the Phase 5 contract and closeout.

### Phase 5B — remaining form and facial refinements

DONE (2026-08-04). The broad hollow cowl crown, triangular socket cuts and
explicit hair-cap edge complete `B3`, `E3` and `E5`. Normal-material probes
separate their geometry proof from bronze and lighting.

### Final ship gate

- [x] 41 / 41, honestly rescored.
- [x] Proportion gate green: 0 of 12 outside tolerance, worst +0.024.
- [x] Full 203-test suite green.
- [x] Matched and acceptance sheets reproducibly archived.
- [ ] Real iPhone 12-or-newer interaction and load test.
- [x] No browser or console errors in local matrices.
- [ ] Initial construction and orbit performance accepted on a real phone.

### Process rules for future runs

- Probe or measure before tuning. Every real bug fell to an isolation test.
- One contact sheet per change, not five single renders.
- Score the WHOLE rubric each time. Half the regressions on this model came from
  fixing one thing.
- Use the Edit tool, not `python3 - <<PY` patch scripts. Two of those silently
  no-oped mid-session by asserting after the write had already been skipped.
