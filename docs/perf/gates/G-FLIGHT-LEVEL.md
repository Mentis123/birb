# G-FLIGHT-LEVEL — level turns, and re-hashing `tests/bird-flight.test.js`

**Date:** 2026-09-13
**Oracle touched:** `tests/bird-flight.test.js` (listed under R5 in `tools/oracle-manifest.txt`)
**Also added:** `tests/bird-plumage.test.js` (new file; the manifest's regenerator
picks up unpinned `tests/**` additively, which is the designed behaviour)
**Verdict:** re-hash approved. Every pre-existing assertion is kept verbatim and
five are added.

## The defect

Reported from the phone: "when we are up high and pull straight down, it doesn't
continue to nose down straight, it twists and kinda spirals and ends up sort of
looping around."

`BirdFlight.yaw()` rotated about the bird's OWN up (`quaternion.multiply` on
local Y). That is right for an aircraft in open sky and wrong here: once the
nose is 60-70 degrees down, the bird's own up points mostly backward along the
ground, so a yaw input stops being a turn and becomes a world-space ROLL. Roll
was never corrected — `_applyZenAutoLevelRoll` existed only in Zen mode AND only
while the stick was near-centred, which is exactly when roll does not
accumulate.

Measured on the real page, holding stick (x 0.25, y -1) from 200 units up:

| | roll | heading swing | deepest pitch | final pitch |
|---|---|---|---|---|
| shipped | 0.5° → **40°** | **173°** and wrapping | -69.7° | **-10.8°, climbing** |
| fixed | **0.0°** throughout | 74°, at a constant rate | -80.0° | **-80.0°, held** |

With no yaw input at all the two are identical (roll 0, pitch -80 held,
heading constant) — the change only bites where the old axis was already wrong,
which is the property that makes it safe.

## What changed

1. `yaw()` rotates about the PLANET's up, brought into the bird's own frame.
   Off with `?levelturn=0`.
2. `_levelRoll()` runs every frame in every mode at 2.2/sec. Zen's stick-gated
   settling now delegates to the same function at its old 1.2, so there is one
   implementation rather than two that drift.
3. `FLIGHT_DEFAULTS.maxPitch` 72° → 80°. **This is NOT gated by
   `?levelturn=0`** — that flag names the turn axis and the leveller, and
   conflating a third knob into it would make the A/B unreadable. 80 and not 90
   on purpose: at exactly vertical the tangent-plane heading is undefined and
   the auto-level term has no sign to work with.
4. `node_modules/three/index.js` (the repo's tracked hand-written stub) gained
   `Quaternion.conjugate`/`invert`. Bringing a world axis into the bird's frame
   needs the inverse, and the stub lacked a method three has always had — two
   existing flight tests failed on `s.quatInv.copy(...).invert is not a
   function` until it was added.

## The test diff

Kept byte for byte: all five existing tests, including the `maxPitch` bound,
which is written against `bird.maxPitch` rather than a literal and so still
holds at 80.

Added five:

- a held diving turn must not accumulate roll, and must still be a dive four
  seconds later;
- **the legacy model must still reproduce the defect** (`levelTurns: false`
  rolls past 0.3 rad). Without this the test above proves only that the current
  code is self-consistent, not that it fixed anything;
- a level turn must be within a unit of the legacy model's, so the new axis is
  a no-op where the old one was right;
- roll levelling must recover a hand-rolled bird and must not oscillate past
  level — an overshoot reads as a wobble, which is worse than the tilt;
- the deepest dive must measure 80 degrees and still be clamped short of
  vertical.

## Not covered

The bank the player SEES is `src/flight/bird-visual.js` rolling the model, a
separate thing from the flight quaternion this touches. Aerobatics — barrel
rolls, inverted flight — remain out: they need the pitch clamp lifted entirely,
an explicit roll input, a camera that survives inversion, and a ground floor
that behaves when the bird is upside down. None of that is in this change.
