# G-AERO-FEEL — the roll's freeze, the loop's radius, the loop under

**Date:** 2026-09-13 (night). **Build:** `v69-2026-09-13-ultra-max-panel`.
**Decision:** SHIP. Measured with the new `flightProbe()` fields
(`rollFullDeg`, `pitchFullDeg`, `visualBankDeg`, `visualPitchDeg`,
`windup`), scratchpad `aero3.mjs`, SwiftShader at the Okay preset (the
flight math does not depend on quality; the frame rate is what limits
how finely a 1.3 s move can be sampled).

## The three reports, from the phone

> "On the side rolls, there's a moment where the birb freezes position on
> the wing tilt before it rolls — we want it smoother and a little slower…
> and on the back flip have the radius of the turn wider — it's almost
> pivoting on its own axis atm — and the nose dive into inverted isn't
> working yet."

## 1. The freeze was the dwell plus the mute

Two things, stacked. The trigger asks for the rail to be HELD for 0.55 s,
and a bank saturates at 63 degrees long before that — so the bird sat
motionless at full bank for half a second. Then, the frame the move fired,
`visual.update` was handed a zero stick (`_aeroNoInput`), so the model's
63-degree bank UNWOUND toward level while the flight-frame roll was easing
in from a zero rate. For the first quarter of the move the two motions
opposed each other; measured on the old build the apparent rotation went
the wrong way before it went the right way.

Fix, in `index.html`:

- **The bank is kept through the move.** A 63-degree cosmetic bank held
  through a 360-degree flight-frame roll is a constant offset: continuous
  at the start and continuous at the end, since the stick is still pinned
  when the move hands back.
- **The dwell is motion now.** `AERO_WINDUP = 0.4`: while the rail is held
  and the move is being earned, the stick reaching the model is scaled by
  `1 + 0.4 * progress`, so the bank keeps deepening (63 -> 88 degrees) until
  the roll takes over from it. The wind-up is handed over intact the frame
  the move fires and unwinds against the angle SWEPT (`1 - swept / PI`),
  which bounds its rate at 0.4/PI of the roll's own — the apparent
  rotation cannot reverse.
- **Slower:** roll duration 0.95 -> 1.3 s.

Measured (right stick; the sign convention is right-wing-down negative,
and `apparent = rollFullDeg + visualBankDeg`):

```
during the dwell the bank went -25.2 -> -80.6 (windup 0.364), move fired at windup 0.40 / bank -83.1
t=0.04  flight   -0  bank -83  apparent  -83
t=0.37  flight  -93  bank -80  apparent -172
t=0.74  flight  +35  bank -64  apparent  -29  (= -389 unwrapped)
end     flight    0  bank -66  apparent  -66  (= -426 unwrapped)
AFTER (stick released): roll 0 pitch 0 bank 0 windup 0
```

Monotonic from the first frame on the rail to the end of the move. The
probe's own "1 reversal (143.7 deg)" line is its ±180 unwrap misreading a
216-degree step — SwiftShader gave the 1.3 s move three frames — not a
reversal; the sequence above is the same data read by hand.

## 2. The loop's radius: two halves of one ratio

Radius is speed over angular rate. The first profile was a pure raised
cosine, whose peak rate is TWICE the average: 2 turns-per-second-equivalent
at the middle of a 2.0 s loop, 6.3 rad/s, and at cruise 11 that is a
1.75-unit circle for a 2-unit bird. Pivoting.

`sweptAngle(turns, t, ease)` is a trapezoid with raised-cosine ends now:
`ease` is the fraction of the move spent ramping at each end, the plateau
rate is `2PI / (duration * (1 - ease))`, and the integral is exactly
`turns * 2PI` whatever the ease (the closure tests still hold at 1e-12; at
`ease = 0.5` it is the original raised cosine to the last bit, and the
roll keeps that — a roll has no radius to widen). The loop is 2.6 s with
`ease 0.22` (plateau 3.1 rad/s) and flies at `speedMul 1.5` (16.5 at
cruise): 5.3-unit radius by arithmetic, and `cameraDistance` 2.6 to keep
the circle in frame.

Measured, loop over from altitude 90:

```
speed during move: 16.5 (was 11)
altitude above ground: 94.1 .. 105.8, span 11.7   (diameter; the old loop's was ~3.5)
apparent pitch: 8 -> 94 -> 131 -> 210 -> -76 -> -3 -> 72 -> 92; 0 reversals, 0 stalled frames
```

## 3. The loop under

`moveFromStick(0, -1)` now returns `{ move: 'loop', direction: -1 }`: a
dive pinned to the rail goes on through the vertical into inverted and
round. It needs more room than the loop over — it descends by the whole
diameter first — so `minAltitudeDown` is 24 (diameter 10.6 at cruise-with-
boost, plus margin) and `start()` picks the gate by direction; the refusal
still names the number.

Measured, from 91.8: fired after 14 frames on the rail, speed 16.5,
altitude 78.3 .. 90.0 (dip 13.5, gate 24), apparent pitch monotonic with
0 reversals, ends level (pitch -7 and recovering with the stick released).

## What the probe could not see

Frames. Three to seven per move under SwiftShader; the phone will show
sixty. The continuity argument is analytic (the wind-up's unwind rate is
bounded by the sweep's), the numbers above are consistent with it, and the
camera frames (`a6-loop-over-*.png`) show a level horizon with the bird
inverted mid-frame. Whether 1.3 s reads as "a little slower" and 88
degrees of wind-up reads as intent rather than twitch is the phone's call.

## Follow-up: the trigger was still too eager (2026-09-14)

From the phone, on the shipped build: *"the barrel rolls and dives and stuff
are too sensitive / trigger too soon"*. `STICK_EDGE` was `edge 0.94`,
`dwell 0.55 s`.

Half a second at the rail is inside an ordinary committed turn, and a pinned
DIVE is the most common thing anyone does with altitude — so the loop under,
which fires from exactly that, now asks for the longest hold of the three:

| | before | after |
|---|---|---|
| edge | 0.94 | 0.97 |
| dwell (roll, loop over) | 0.55 s | 1.0 s |
| dwell (loop under) | 0.55 s | 1.4 s |

`progress()` measures against whichever dwell applies, so the wind-up
(`AERO_WINDUP`) still deepens the bank or the climb across the whole hold and
the gesture reads as asking rather than as nothing happening. Measured live
after the change, sim time on the rail before the move fired: roll 1.1 s,
loop over 1.2 s, loop under 1.4 s.

Flight v2's rail moved to 0.97 in the same change. It is the same stick, and
under v2 the rail is where a held bank becomes a roll — the report applies
there just as much, even though v2 has no dwell at all.
