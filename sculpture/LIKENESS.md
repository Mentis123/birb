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
      0.03 of each other — a column, not an hourglass. *(Currently the model is
      ~20% narrow at every one of them; see the proportion gate.)*
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

- [ ] **E1** The face reads HEAD-ON, at the group's normal viewing distance — not
      only at three-quarter and not only zoomed in.
- [ ] **E2** A long straight nose ridge runs unbroken from the brow.
- [ ] **E3** The eye sockets are hollow triangles holding a shadow.
- [ ] **E4** The mouth is a wide flat bar, not a bud.
- [ ] **E5** The hair is a smooth cap with a hard edge at the temple, clearly a
      separate mass from the face.
- [x] **E6** Two figures carry a coiled top-knot; it sits ON the crown and is
      unmistakable in silhouette.
- [ ] **E7** The four heads are individually distinguishable at group distance.

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

**26 / 41** after Phase 2 (2026-08-02), scored against
`shots/sculpt/sheet-p2e.png`. Was 19 after Phase 1 and 10 before either.

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
wrong twice. The rubric above is what makes the difference, and it is 20.

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

### What is left, in the order the evidence says to do it

**Phase 3 — heads.** E1-E5, E7. Worth doing now and not earlier, because the
head has just changed size by a third. Key insight to apply: under a
near-frontal key a nose reads from the shadows carved BESIDE it, not from its own
protrusion, so cut the flanks rather than raising the ridge.

**Phase 4 — arms and surface.** A7, F4, G2, G3, G5. Negative space between arm
and ribs; each figure's arms doing something different; stronger hand-working and
the vertical run-off streaks.

**Phase 5 — B3, C4, D2, H3, mobile perf, ship.** The collar-arch hollow still
does not read; only one figure carries an arch and its interior is not legible
as an opening. No figure shows a weight shift onto one leg.
