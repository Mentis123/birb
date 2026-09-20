# G-STUNT-3 — an elevator does not roll you

**Date:** 2026-09-20. **Build:** `v79-2026-09-20-flat-turn`.
**Decision:** SHIP. Authorises adding tests to the frozen
`tests/bird-flight-stunt.test.js` (manifest regenerated in this commit).

## The owner's words

> "I still can't seem to even just fly direction on that knife edge… I want to
> roll 90 degrees then pull back (down on the stick) to hard bank along the
> horizon."

[G-STUNT-2](G-STUNT-2.md) made a released knife edge HOLD, and it does. This
is the other half, and it is a different defect: the bank held until the
player pulled, and then the pull rolled the bird.

## The cause is geometric, and it is exactly twice the pitch offset

`_pitchBy` rotates about the **bird's own X axis**. That axis is the local
radial — and the pull therefore a flat turn — only when the nose is exactly on
the horizon. Tip the nose a few degrees off and the bird rotates about a
tilted axis: it **cones**, and the measured bank sweeps by twice the offset.
Unit sim, knife edge, 6 s of 0.7 pull with **zero roll input**:

| nose off the horizon | bank ranged | swing |
|---|---|---|
| 0° | −89.6 .. −89.6 | 0.8° |
| 2° | −92.0 .. −88.0 | **4.1°** |
| 6° | −96.0 .. −84.0 | **12.0°** |
| 11° | −101.0 .. −79.0 | **22.0°** |

Past −90° the bird is inverted: lift goes negative and the sink jumps from
3.4 to 4.8 units/s. On the live page the manoeuvre ran bank −79.5 → −101.4 →
−84 and pitch ±11° as a clean out-of-phase pair — the signature of a body
coning about a fixed tilted axis — while the heading swept steadily. It turned;
it just would not stay on the wing, and it fell sideways out of the sky.

**Nothing resisted it, because every stabiliser is gated off exactly there:**
`_bankSoftStep` runs only inside `if (sx)` (a roll input), `_rightingStep`
only with the whole stick idle, `_pitchSoftStep` only while upright. A player
rolling hard and then pulling satisfies none of the three.

**A thumb cannot deliver 0°.** That is why this read as "I can't fly a
direction" rather than as a tuning complaint.

## The change

`_flatTurnStep(bankBefore)`: the bank is sampled before the pitch command and
whatever the elevator moved is rolled straight back out. One line of real
aerodynamics — **an elevator changes pitch, not bank** — and the turn is flat
by construction at any bank and any nose attitude.

It cannot fight the player: the roll command is applied earlier in `tick` and
is outside the measurement, so only the elevator's own side-effect is
cancelled.

**Faded out near the vertical, and that is load-bearing.** Bank is degenerate
when the nose points at the sky — it jumps by 180° as the pitch passes 90° —
so the correction is at full strength below `flatTurnFull` (55°) and gone by
`flatTurnNone` (80°). A loop, a hammerhead and the stall all pass through
there and must not meet a term reading a meaningless angle.

Measured after: swing **0.0°** at every offset from 0 to 20°, bank pinned at
−89.6. Live page: swung **7.1°** (−74.0..−66.9), still hard banked at −66.9,
and swept **108°** of turn in 4 s.

## A load factor was built, measured and REFUTED

`lift × (1 + gLoad·|pull|)` — a wing makes more lift when you pull on it — was
implemented on the reasoning that "along the horizon" needs a hard bank to
hold height. Measured over a 6 s turn it moves almost nothing, because the
speed the climb bleeds cancels it, and at a knife edge it is zero by
construction (the cosine is zero at any G):

| bank | pull | altitude, gLoad 0 | altitude, gLoad 1.8 |
|---|---|---|---|
| 60° | 0.5 | +19 | +26 |
| 75° | 0.5 | +11 | +15 |
| 88° | 0.5 | **−19** | **−19** |

It was removed. The turn already holds height where it should: at 75° bank a
0.3–0.5 pull sweeps 135–201° in 6 s for +2 to +11 units. **The coning was the
whole bug**, and a change whose effect is inside its own noise is not a fix.

## What did not move

Relaxed flight is untouched — hands-off 10 s holds altitude to 0.03 units, a
gentle climb gains 45, a gentle turn holds 24° of bank and loses nothing
(the G-STUNT-1 numbers). A loop still goes all the way round; inverted plus a
pull still dives.

## Oracle changes (the reason this is a gate)

Three tests ADDED per site to the frozen `tests/bird-flight-stunt.test.js`,
nothing weakened, nothing removed:

1. a pull at a knife edge does not roll the bird (swing < 3° at 2/6/11/20° of
   nose offset);
2. a hard bank plus a pull carves a FLAT turn (sweeps > 120°, bank held
   within 3°, still past 60°);
3. the flat-turn term is OFF near the vertical, so a loop still closes.

Mutation-tested by neutering `_flatTurnStep`: **4 failures**, each naming the
defect, with the loop check correctly still green. Four live checks added to
`tools/birb-stunt.mjs` (not frozen); 39/39 pass.
