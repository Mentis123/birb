# Bronze — the likeness rubric

Thirty-two things that either read or do not, each with the photograph that
settles it. **90% is 29 of 32.**

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

- [ ] **A1** The figures are HEAVY. Shoulder, bust and waist spans are within
      0.03 of each other — a column, not an hourglass. *(Currently the model is
      ~20% narrow at every one of them; see the proportion gate.)*
- [ ] **A2** The head is roughly one fifth of the figure's height. These are
      squat, big-headed, stylised women, about five and a half heads tall.
- [ ] **A3** The neck is barely visible — chin almost on the shoulders.
- [ ] **A4** Seen head-on, each figure is a near-straight column from shoulder to
      hem. No bell, no flare, no triangular skirt panels.
- [ ] **A5** The group reads as ONE MASS from the front. No daylight between
      adjacent figures above waist height.
- [x] **A6** The whole front of each body is open to the air — face, throat,
      shoulders, breasts and belly all visible, cloak entirely behind.
- [ ] **A7** There is real negative space between the nearest figure's arm and
      her ribs. You can see through it.

## B · The cloak — `ref-c-under`, `ref-d-wide`

- [ ] **B1** The cloak is a PLATE, not cloth. Every free edge shows visible
      thickness; the rim reads as a cast section, not as a paper edge.
- [ ] **B2** It hugs close behind the body. Its width at chest height is barely
      more than her shoulders.
- [ ] **B3** The collar-arch behind the head is HOLLOW and you can see into it
      from three-quarter angles — a dark opening with a rim, not a solid slab.
- [ ] **B4** The hem does not flare sideways. What spreads, spreads BACKWARD.
- [ ] **B5** The trailing hem lies on the paving as a long low tail, flat to the
      ground, reaching well behind the figure.
- [ ] **B6** No two cloaks are swept alike. Height, sweep direction and how far
      each rises behind the head all differ.
- [x] **B7** The cowl height varies per figure: some stop at the shoulders and
      the head stands completely free.

## C · Pose and motion — `ref-c-under`, `ref-b-threequarter`

- [ ] **C1** The group is WALKING. Hems raked back off a planted forward foot.
- [ ] **C2** The torsos lean very slightly forward of vertical.
- [ ] **C3** The heads are not all level and not all facing the same way.
- [ ] **C4** At least one figure's weight is visibly on one leg.

## D · Arrangement — `ref-a-front`, `ref-d-wide`

- [x] **D1** A crowded diagonal running back and to the right, not a rank and not
      a zigzag.
- [ ] **D2** The turned-away, plain-headed figure is in the right position: she
      stands BEHIND the nearest figure, and is the nearest one from the group's
      right-hand side.
- [ ] **D3** From the front the figures overlap enough that you cannot count them
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
- [ ] **E6** Two figures carry a coiled top-knot; it sits ON the crown and is
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
- [ ] **H2** They read as feet — heel, instep, toes — not as pebbles.
- [ ] **H3** The group casts one connected shadow, as it does on the paving.

---

## Score

**12 / 32 at the time of writing** (2026-08-02), scored against
`shots/sculpt/sheet-v2.png`.

What the first matched-view sheet showed, that ninety unmatched renders had not:

- **The hem is the single biggest silhouette error.** Measured on the sheet, the
  model's hem spans 0.56 of figure height against the photograph's 0.39. The
  base profile is right — the gate puts `hemSpan` within 0.007 — so it is the
  TRAIN doing it, spreading sideways where the real cloth trails backward.
- **The heads are about a third too small**, which is most of why the model reads
  as elongated and the photographs read as squat.
- **Everything is too narrow.** Nine of twelve proportions fail, every width
  among them, all in the same direction.
- **The model reads as four separate objects; the sculpture reads as one mass.**

None of that was visible while judging renders against a memory of the photo.
All of it was obvious within one minute of the pair being side by side.
