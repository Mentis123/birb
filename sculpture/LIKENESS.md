# Bronze — the likeness rubric

Forty-one things that either read or do not, each with the photograph that
settles it. **90% is 37 of 41.**

This is the half of the gate `tools/sculpture-proportions.mjs` cannot measure.
Proportion is a number; whether a cloak reads as cast bronze rather than as
fabric is not, and every attempt on this model to turn that kind of judgement
into a metric produced a number that lied. So this list is scored **by eye,
against the matched-view contact sheet**, and the discipline is in the list being
binary and pre-committed rather than in the scoring being automated.

## How to score

```bash
node tools/sculpture-sheet.mjs --out shots/sculpt/sheet.png    # photo | model, matched cameras
node tools/sculpture-proportions.mjs                            # the measurable half
```

Look at each pair. A check passes only if you would notice its ABSENCE in the
photograph — "the hem rakes back" passes when the model's hem rakes back enough
that flattening it would visibly change the picture, not when you can argue that
it technically does.

Score the whole list every time, not just the items you worked on. Half the
regressions on this model were caused by fixing one thing.

---

## A · Silhouette and mass — `ref-a-front`

- [x] **A1** The figures are HEAVY. Shoulder, bust and waist spans are within
      0.03 of each other — a column, not an hourglass. *(Current model spans are
      shoulder 0.327, bust 0.350 and waist 0.349 against reference 0.327, 0.342
      and 0.356; all are inside the ±0.03 proportion tolerance.)*
- [x] **A2** The head is roughly one fifth of the figure's height. These are
      squat, big-headed, stylised women, about five and a half heads tall.
- [x] **A3** The neck is barely visible — chin almost on the shoulders.
- [x] **A4** Seen head-on, each figure is a near-straight column from shoulder to
      hem. No bell, no flare, no triangular skirt panels.
- [x] **A5** The group reads as ONE MASS from the front. No daylight between
      adjacent figures above waist height.
- [x] **A6** The whole front of each body is open to the air — face, throat,
      shoulders, breasts and belly all visible, cloak entirely behind.
- [ ] **A7** There is real negative space between the nearest figure's arm and
      her ribs. You can see through it.

## B · The cloak — `ref-c-under`, `ref-d-wide`

- [x] **B1** The cloak is a PLATE, not cloth. Every free edge shows visible
      thickness; the rim reads as a cast section, not as a paper edge.
- [x] **B2** It hugs close behind the body. Its width at chest height is barely
      more than her shoulders.
- [ ] **B3** The collar-arch behind the head is HOLLOW and you can see into it
      from three-quarter angles — a dark opening with a rim, not a solid slab.
- [x] **B4** The hem does not flare sideways. What spreads, spreads BACKWARD.
- [x] **B5** The trailing hem lies on the paving as a long low tail, flat to the
      ground, reaching well behind the figure.
- [x] **B6** No two cloaks are swept alike. Height, sweep direction and how far
      each rises behind the head all differ.
- [x] **B7** The cowl height varies per figure: some stop at the shoulders and
      the head stands completely free.

## C · Pose and motion — `ref-c-under`, `ref-b-threequarter`

- [x] **C1** The group is WALKING. Hems raked back off a planted forward foot.
- [x] **C2** The torsos lean very slightly forward of vertical.
- [x] **C3** The heads are not all level and not all facing the same way.
- [ ] **C4** At least one figure's weight is visibly on one leg.

## D · Arrangement — `ref-a-front`, `ref-d-wide`

- [x] **D1** A crowded diagonal running back and to the right, not a rank and not
      a zigzag.
- [ ] **D2** The turned-away, plain-headed figure is in the right position: she
      stands BEHIND the nearest figure, and is the nearest one from the group's
      right-hand side.
- [x] **D3** From the front the figures overlap enough that you cannot count them
      at a glance.
- [x] **D4** The base is a shallow slab that reads as part of the casting.

## E · Heads and faces — `ref-a-front`

- [x] **E1** The face reads HEAD-ON, at the group's normal viewing distance — not
      only at three-quarter and not only zoomed in.
- [x] **E2** A long straight nose ridge runs unbroken from the brow.
- [ ] **E3** The eye sockets are hollow triangles holding a shadow.
- [x] **E4** The mouth is a wide flat bar, not a bud.
- [ ] **E5** The hair is a smooth cap with a hard edge at the temple, clearly a
      separate mass from the face.
- [x] **E6** Two figures carry a coiled top-knot; it sits ON the crown and is
      unmistakable in silhouette.
- [x] **E7** The four heads are individually distinguishable at group distance.

## F · The stories each figure carries — `ref-b`, `ref-c`, `ref-d`

- [x] **F1** One figure is heavily pregnant and reads as pregnant, not as stout.
- [x] **F2** One carries a swaddled newborn, distinguishable from a pregnancy:
      held at the forearms, oblong across the body, with a hard seam.
- [x] **F3** One wears a stethoscope, cord round the neck and bell standing clear
      of the chest.
- [ ] **F4** Each figure's arms do something different, and the difference is
      legible.

## G · Surface, patina and light — all four

- [x] **G1** The bronze is dark. Sunlit faces read mid-grey-green, not plaster.
- [ ] **G2** The surface is hand-worked. Every panel holds pushes and hollows;
      nothing reads as a lathe or a moulded shell.
- [ ] **G3** Vertical run-off streaks mark the standing surfaces.
- [x] **G4** Up-facing edges are washed pale; crevices go black.
- [ ] **G5** The lit bronze is faintly WARM against a cold sky, as in every
      photograph.

## H · Feet and ground

- [x] **H1** Bare feet emerge from under the hem at the front, heel hidden.
- [x] **H2** They read as feet — heel, instep, toes — not as pebbles.
- [ ] **H3** The group casts one connected shadow, as it does on the paving.

---

## Score

**30 / 41**, independently revalidated after Phase 3 on 2026-08-02 against the
committed matched sheet `validation/phase-3-revalidated.png`. The complete
command log, pass/fail classification, render statistics and evidence checksum
are in `validation/phase-3-closeout.md`. The score progression is 10 before the
phased work, 19 after Phase 1, 26 after Phase 2 and 30 after Phase 3.

The closeout confirmed 30 passes, 10 failures and one ambiguous item counted as
a non-pass. The confirmed failures are `A7 C4 D2 E3 E5 F4 G2 G3 G5 H3`;
`B3` remains ambiguous because a narrow dark gap is present but does not read
unambiguously as the reference's broad hollow collar-arch. No Phase 3 visual
regression was detected.

> The denominator was wrong when this file was written: the header said 32 and
> the list has 41. Counted, not estimated, from this point on. A score over a
> made-up denominator is precisely the kind of lying number the gate beside this
> file exists to avoid, and it took writing "20 / 32" against a list of 41 to
> notice.

### What the first matched-view sheet showed, that ninety unmatched renders had not

- **The hem was the single biggest silhouette error.** The model spanned 0.56 of
  figure height against the photograph's 0.39, while the base profile measured
  correct to within 0.007. All of that error was one line: the train scaled the
  ring's RADIUS, so it pushed the hem out in every direction on the trailing
  half, sideways included. Real cloth trailing off a walking figure goes
  backward. It is a displacement now.
- **The heads were about a third too small**, which was most of why the model
  read as elongated where the photographs read as squat.
- **Every width was short by roughly the same fraction** — the tell that it was
  one systematic error rather than four independent ones.
- **The model read as four separate objects; the sculpture reads as one mass.**

None of that was visible while judging renders against a memory of the photo. All
of it was obvious within a minute of the pair being side by side.

### Phase 1 — mass. Done.

Every span widened about 20%, the shoulder line dropped from 1.911 to 1.849, the
head grew 33% and the bust came down 0.07 of figure height. The torso table lost
its waist: measured on the nearest figure the spans run shoulder 0.327, bust
0.342, waist 0.356, hem 0.387 — monotonically wider all the way down, where every
previous version pinched at the waist and flared below it. That is a fashion
croquis, not these women, and it is most of why the model read as four mannequins.

The head was rescaled by a COORDINATE CHANGE rather than by rescaling its thirty
constants: `field()` maps world space into the head's own units and the constants
— tuned against the photographs over several passes — are untouched. Thirty
numbers rescaled by hand is thirty chances to miss one, and a missed one is a
feature that silently stops matching its neighbours.

The gate is green at 0 of 12, worst +0.023. **That is necessary and not
sufficient**, and the file it lives in says so: this gate has been green and
wrong twice. The rubric above is what makes the difference; Phase 1 closed at
19 of 41.

### Phase 2 — cast section and the stride. Done.

**The V-notch was structural, not cosmetic.** A dark wedge ran up the front of
every figure where the cloak's two rims converged, and no amount of moving the
opening's keyframes removed it, because a cloak that closes has to close
somewhere. The photographs show it never closes: she wears a long SKIRT — that
smooth continuous surface down her front in `ref-a-front.jpg` — and the cloak is
a panel hanging behind it, open its whole height. The skirt is now part of the
body field, running to the paving, and the opening holds at 1.1 rad even at the
ground.

**Every free edge carries a rounded bead** at half the wall thickness, built as
one closed cross-section — outer wall, bead, inner wall, bead — instead of two
walls meeting in a fold. Those edges draw the collar-arch and both sides of the
open front; with no section to show they read as cut paper.

**The walk.** Hems lift clear of a leading foot (a lift only — dropping the back
edge pushes it through the paving), each column shears forward of vertical, and
no two figures agree on stride side, rake, lean, head turn or head tilt.

**The feet were three times too small** — 0.10m long on a 2.3m figure. They read
as pebbles wherever they were placed, which was diagnosed as a placement problem
twice and was never one. They also had to be re-seated against the SKIRT's front
face, since the cloak stopped reaching the front of the figure when its opening
was opened to full height.

### Phase 3 — the heads. Done, and it cost more than the other two together.

**The head is a rounded BLOCK, not an ovoid.** Read off the nearest figure at
4x: flat front, flat sides, domed top, broad flat jaw — a loaf standing on end.
Built as an egg the face has nowhere flat to sit and every feature slides off the
curvature. The nearest is bare/plain, the turned-away head is faceless, and two
carry a coiled top-knot. Giving every figure one identical cap was part of what
made the four interchangeable. The top-knot is a thick rolled plait lying across
the crown, not a knob on top of it.

**THIN FEATURES DO NOT SURVIVE THE MESHER, AND IT FAILS SILENTLY.** This is the
lesson worth the whole phase. Surface nets places ONE vertex per cell at the mean
of its edge crossings, so a form three or four cells thick is averaged into
nothing. What makes it expensive is that it defeats every check short of looking:

- the field is correct — a numeric march finds a 25mm brow and a 30mm eye socket;
- a max-z sweep of the MESH also finds them, because the few stray slivers that
  survive are still the highest vertices in the band;
- so every measurement agrees the feature is there, and no render shows it.

Four separate hypotheses were tested and discarded first — cheek hollows too
large, blend radii exceeding protrusions, the mesher's voxel, and `normalBias`
exceeding the facial relief. Two of those were real bugs and worth fixing; none
was the cause. A `MeshNormalMaterial` pass is what settles it, because it shows
the surface with no lighting to argue about: the brow rendered as a few isolated
fins. Doubling every feature's thickness fixed it immediately.

**A real coordinate bug fell out of the same hunt.** When the head was scaled by
a coordinate change, `headField` kept using `yc` — the head's origin in WORLD
space — for offsets, while its own `y` is in head units centred on `YC0`. Every
offset shifted by the same amount, so the head stayed internally correct and
simply sat 62mm below where FIGURE_LANDMARKS said. The gate was measuring a head
that was not there, and it was GREEN.

### What is left, in the order the evidence says to do it

#### Entry gate before Phase 4

- full tests green;
- proportions green;
- independently rescored contact sheet;
- no visual Phase 3 regression;
- simulated mobile baseline recorded;
- real-phone validation clearly marked complete or outstanding.

The first five are complete. The simulated SwiftShader orbit result was poor and
is not representative of an iPhone GPU, so Phase 4 modelling remains **NO-GO**
until an iPhone 12-or-newer load and orbit test is recorded. Preserve the current
490,840-triangle geometry meanwhile; if the real phone reproduces poor
interaction, test a lower mobile renderer-DPR cap before changing mesh structure.

#### Phase 4A — arms and negative space

Target `A7` and `F4`. Replace the generic treatment with per-figure,
reference-led arm poses when implementation begins. Preserve the baby's crossed
supporting forearms and the four narrative identities.

#### Phase 4B — surface and bronze

Target `G2`, `G3` and `G5`. Noise and runoff systems already exist. Make them
legible at group viewing distance rather than adding complexity merely because a
check fails.

#### Phase 5A — arrangement, weight and shadow

Target `C4`, `D2` and `H3`.

#### Phase 5B — remaining form and facial refinements

Target `B3`, `E3` and `E5`.

#### Final ship gate

- at least 37 / 41, honestly rescored;
- proportions still green;
- full test suite green;
- matched contact sheet committed or reproducibly archived;
- real iPhone 12-or-newer interaction and load test;
- no console errors;
- acceptable initial construction time and orbit performance.
