# Bronze — architecture and working notes

> **2026-08-04 reconstruction notice:** Phase 5 has been rebuilt and closed at the major-landmark and contour threshold. The former four-figure architecture and 41/41 closeout were based on a structural misread of the references. Production now models six alternating positive/negative reliefs; current status is in `validation/phase-5-closeout.md`.

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

Six alternating bronze reliefs form one folded casting: three active figures on
the outward/community side and three different figures on the hospital side.
Each relief is generated from profile tables, sampled fields and explicit detail
geometry; the running page loads no model, image, font or texture assets. The
repository's reference and validation images are development evidence only. You
drag to orbit, pinch to zoom, use two fingers to pan, double-tap to reset, and
hold three fingers to raise a QR of the production URL.
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
  LIKENESS.md           historical rubric and current acceptance boundary
  reference/            Mentis's four photos, EXIF-transposed only
  validation/           committed closeout records and render evidence; not runtime
  dev/probe-parts.html  render any subset of ONE figure in isolation
  src/
    core/three-loader.js   CDN or local Three, per ?three=local
    core/noise.js          value noise + fbm3, deterministic
    core/rng.js            seeded RNG (shared shape with Gauntlet)
    model/sdf.js           SDF primitives, smooth booleans, surfaceNets,
                           marchingTetrahedra
    model/figure.js        ONE relief: body/reverse fields, head, roles and foot
    model/sculpture.js     six alternating reliefs, ordered, patinated and lit
    view/orbit.js          orbit / pinch / two-finger pan, hand-rolled
    ui/qr.js               QR encoder, byte mode, ECC M, versions 1-10
    ui/qr-overlay.js       three-finger gesture, Birb Labs convention
tools/
  sculpture-shot.mjs        one view, one browser boot
  sculpture-sheet.mjs       general, Phase 4, Phase 5 and identity matrices
  sculpture-views.mjs       the reference camera poses
  sculpture-proportions.mjs the measurable half of the likeness gate
tests/sculpture-orbit.test.js   panBasis
```

## The build pipeline

One relief, in production order:

    TORSO_PROFILE + bust/shoulder/arm/narrative primitives
      -> buildBodyField(): front relief, long rear sweep, full negative relief,
         role gesture and pregnancy when authored
      -> marchingTetrahedra at 18 mm

    planted foot
      -> buildFeet(): separate closed field at 7.5 mm, rooted beneath the hem

    skull, jaw, hair, crown rolls and facial relief
      -> buildHeadField(): separate closed field at 5.607 mm

    carried newborn
      -> buildBabyField(): separate closed field at 5.5 mm

    hospital badge
      -> buildBadgeField(): separate closed field at 3.5 mm

    clinician instrument
      -> buildStethoscopeGeometry(): two Catmull-Rom TubeGeometry paths
         with independent ringed terminals

    mergeGeometries() -> one BufferGeometry per relief

`model/sculpture.js` builds six meshes in the exact alternating physical order,
applies one vertex-coloured `MeshStandardMaterial`, and adds the light/ground
scene. The acceptance matrices measure **2,060,504 triangles and 8 draw calls**
for six reliefs plus the ground draw. Do not restore the obsolete 525,912 / six
draw-call or four-figure figures.

The 18 mm body field is the deliberate cost centre. Fine role details stay in
smaller sampled fields or explicit geometry because they do not survive that
sampling scale. The historical simulated-mobile timings remain useful only as
software-renderer comparisons; they are not iPhone measurements.
The page still renders **on demand**: `orbit.update()` returns whether anything
moved and no additional renderer pass is issued while the sculpture is still.
`renderer.info.render.calls` therefore remains the cost of the most recent
render, not a claim that the last frame contained zero draw calls.

### Why two meshing paths

The compound body field previously used surface nets. Its ambiguous saddle
cells produced edges shared by four triangles even when the field and bounds
were correct. Production bodies now use a face-consistent six-tetrahedra split
with lattice-edge vertex reuse; all six report zero boundary and non-manifold
edges.

Surface nets remains appropriate for isolated fine fields whose sampling ratio
is stable: heads, newborn, foot probe and badge. Narrow continuous paths such as
the stethoscope use explicit geometry. Representation is chosen per signal
scale, not globally.
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
and head boundary rings. Keep body tetrahedra, fine-field and swept-surface winding outward; cap
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

Written down because two accepted implementations described the wrong object.
**The four reference photos arrive with EXIF orientation 3.**
`ImageOps.exif_transpose` alone is the correct fix; an extra flip mirrors the
signage and reverses the physical order.

- **This is one folded sheet carrying six alternating reliefs**, not four
  freestanding women. From the outward side the physical sequence is
  `developing | doctor(back) | mother/newborn | pregnant(back) | visitor |
  badge(back)`. The hospital side reverses it.
- **Each inactive side is a real negative relief.** It has a broad closed head
  and torso impression, thick surrounding wall and long swept fin. It is not
  transparency, a missing backface or an empty shell.
- **The active bodies are heavy, columnar reliefs.** Heads are large, shoulders
  broad, breasts low and wide, and hems widen into planted cast sheets.
- **The six roles are specific.** Developing fullness, badge, swaddled newborn,
  full pregnancy, visitor and doctor/stethoscope each occur exactly once on
  their authored side.
- **The three outward and three hospital faces are not interchangeable.** Head
  width/height, jaw, feature spacing, turn and hair differ. Mother has one crown
  roll, visitor two; the authored bare heads remain bare.
- **One tapered planted foot belongs to each body field.** Its root stays under
  the hem and the inactive side never invents a detached second shoe.
- **Phase 5 is closed at reference-faithful major landmarks and contours.**
  Body contours, gestures, structural face/hair identities, the fully wrapped
  newborn and support, pregnancy profile and planted feet pass the nine-detail
  contract. Portrait-level likeness and hand-beaten micro-surface are not
  claimed.

### Reference set

`sculpture/reference/` holds Mentis's four photos. Seven Google Maps community
photos were used TRANSIENTLY for measurement and deliberately **not committed** —
they are other people's copyrighted images, and only the landmarks extracted from
them feed the model. Everything they changed is written down above.

---

## Verification protocol

**Nothing is claimed without a captured frame.** These tools exist because
every real bug in this model fell to an isolation test and none fell to tuning.
The feature-scale limits, detail observation contract, measured feedback budget
and closeout criteria are in [DETAIL-QA.md](DETAIL-QA.md). Apply that protocol
before implementing any new fine feature.

```bash
# The likeness loop. Photo | model at seven general matched/review cameras.
node tools/sculpture-sheet.mjs --out shots/sculpt/sheet.png

# The Phase 4 defect loop. Nine desktop/mobile/detail views, one boot.
node tools/sculpture-sheet.mjs --phase4 --out shots/sculpt/phase4.png

# The Phase 5 semantic loop. Twelve matched/detail views plus two mobile views.
node tools/sculpture-sheet.mjs --phase5 --out shots/sculpt/phase5.png

# Whole-object side/facing audit at eight neutral orbit angles.
node tools/sculpture-sheet.mjs --identity --out shots/sculpt/identity.png

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
- The page keeps damping but idle rotation is disabled. The harness still parks
  every stored camera explicitly before readback.
- The ~2.07M-triangle mesh can make a software-rendered Chromium screenshot
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

**Phase 5 is complete after the six-relief reference reconstruction.** The
proportion gate is green at 0 of 12 outside tolerance, worst +0.024, but that is
necessary and not sufficient. The full project suite is 210/210; all six
production body fields and all six cowl backings are closed manifolds.

Current evidence is `validation/phase-5-reference-reconstruction.png`, the
eight-angle `validation/phase-5-identity-audit.png`, and the nine-detail
`validation/phase-5-detail-contract.json`. All nine detail contracts pass at
the declared major-landmark and contour threshold with zero warnings. The
fresh independent ten-item visual review also passes with no demotions.

The Phase 3-5 historical artifacts remain provenance for earlier decisions,
not current closeout evidence. Phase 6 has not started and the real iPhone
performance/interaction gate remains open.

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

The first closeout modeled a coarse detached foot, then the reconstruction
folded the foot into the 18 mm body field. Low-angle evidence showed that the
fine 7.5 mm probe looked correct while the production foot still collapsed into
a pointed wedge. Production now uses that same fine closed foot field, with its
root buried beneath and intersecting the closed skirt. Do not restore detached
heel/toe primitives, the coarse body-field toe or exposed legs. Instep and toe
asymmetry now pass the Phase 5 low and front-orbit views.

**Phase 3 — Heads. DONE (2026-08-02; acceptance corrected 2026-08-03).**
The head is a rounded BLOCK, not an ovoid — flat front, flat sides, domed top.
The nearest is bare/plain. The rear-facing figure now rotates as one body,
cowl and head, retaining a complete face on the opposite side without an
impossible local neck twist. Mother carries one flattened crown roll and visitor
two. Phase 5
replaced the shallow sockets with triangular cavities and made the smooth hair
cap terminate at a hard temple edge, completing E3 and E5.

**Phase 4A — Arms and negative space. DONE (2026-08-03; acceptance
corrected 2026-08-03).** Six role-specific arm definitions replace the generic vertical
pair. Their radii taper from shoulder to reduced cast tips. The infant is a
separate fine closed fully wrapped block supported by one curved forearm, and the clinician's
instrument is two independent curved tubes ending in a low shallow U terminal
and a higher solid circular chestpiece.
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

### Phase 5 reconstruction — current status

Reopened on 2026-08-04. The structural reconstruction, topology and role order
are implemented and reproducibly rendered in fourteen matched/detail/mobile views
and eight neutral orbit angles. All nine detail contracts pass closeout
validation with zero warnings; the independent ten-item acceptance pass records
no demotion candidates.

### Phase 5 closeout gate

- [x] Six alternating reliefs in exact physical order.
- [x] Whole-body side/facing contract and eight-angle occlusion audit.
- [x] Zero boundary and non-manifold edges on all six production body fields.
- [x] Stethoscope and badge semantic contracts.
- [x] Body contours, hands and arm transitions accepted at the major-landmark threshold.
- [x] Face/hair direction, proportions and crown count accepted in matched identity views.
- [x] Fully wrapped newborn and one U-shaped support accepted in matched close view.
- [x] Pregnancy projection and flank-arm relationship accepted against the source contour.
- [x] Foot instep/toe asymmetry accepted in the low and front-orbit views.
- [x] Proportion gate: 0 of 12 outside tolerance, worst +0.024.
- [x] Full 210-test suite and 14+8 render matrices green.
- [ ] Real iPhone 12-or-newer construction, interaction and sustained orbit accepted.

Phase 5 may merge at this declared threshold. Do not start Phase 6 or restore a
numeric perceptual-likeness score. The real-device item remains a final
ship/performance gate and is not implied by the SwiftShader results.

### Process rules for future runs

- Probe or measure before tuning. Every real bug fell to an isolation test.
- One contact sheet per change, not five single renders.
- Score the WHOLE rubric each time. Half the regressions on this model came from
  fixing one thing.
- Use the Edit tool, not `python3 - <<PY` patch scripts. Two of those silently
  no-oped mid-session by asserting after the write had already been skipped.
