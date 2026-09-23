# G-REALISM-AERO-POSE — let the air pose the bird

**Date:** 2026-09-23. **Branch:** `realism/aero-pose` on `e252ca1`.
**Flag:** `?aeropose=0` restores the old rig exactly (a Flags-tab switch,
"Air poses the bird"). **Decision asked for:** SHIP as the default.
**Not claimed:** anything about the phone. Every number below is SwiftShader
or the unit suite.

## What the base was doing

`tools/realism-checks/flap-follows-climb.mjs` was red on the base by design,
and the reason is one line: the pose block read the RAW STICK
(`climbing = pitchInput > 0.2`, `tailPitchOffset(stick.y)`) while the shipping
stunt model inverts pitch INSIDE the controller (pull back = stick down = nose
up). Only the body tilt had been handed `pitchSign`. So the wings beat on a
dive and glided on a climb, and the elevator went the wrong way. Measured
with that check's own method under `?aeropose=0` (90 frames of 0.6 stick,
left-wingtip height in the bird's own frame):

| | climb | dive |
|---|---|---|
| tip travel SD (two runs) | **0.141 / 0.142** | **0.336 / 0.335** |

— a dive flapping 2.4x harder than a climb, as the check's header says.
`node tools/birb-realism.mjs --only aero-pose-off` reproduces these; it boots
`?aeropose=0`, proves the old rig is what runs (the tail's rotation.x equals
`tailPitchOffset(raw stick y)` to 0.00006 on every frame) and logs them.

Measuring it properly turned up three more defects the Euler angles had
hidden. Each is the lesson this repo keeps relearning: **a rotation value does
not say where a part went; evaluating a point on the part does.**

1. **The "elevator" never moved the tail.** The tail is built along −X, so the
   `rotation.x` the rig wrote its elevator (and the perch's "tail drops")
   into is a TWIST about the tail's own long axis. A point near the tip
   (`birdPose().tailTip`, new) read **−0.060 on the climb and −0.059 on the
   dive** — nothing — while `tail.x` swung 0.059 → −0.078. The check had been
   reading the Euler angle, so it could never have seen this.
2. **The two hands bent opposite ways.** The hand is a child INSIDE the arm's
   `scale.z = −1`, so the mirror is already in its frame and its terms must be
   SAME-signed. The rig negated the right one: under the forced flap the tips
   read 0.269 vs 0.386 at the top and 1.249 vs 0.896 at mid-downstroke, and in
   flight **max |leftTip.y − rightTip.y| = 0.51–0.54** — half a unit of wingtip
   height difference on a bird whose wing is 1.5 long. It is visible in the
   old bird sheet's `top` tile: two different-coloured wingtips.
3. **The "downstroke" went UP.** `wingBeat()`'s fast 38% phase carries a
   negative angle, and a negative `rotation.x` raises the left wing (measured:
   phase 0.19 → left tip +1.25). So the power stroke lifted the wings, and the
   span folded on the stroke that came down. `wingBeat()` is frozen by
   `tests/bird-pose.test.js`, so it is left exactly as it was for
   `?aeropose=0`; the new stroke is a new function.

## What shipped

`src/flight/aero-pose.js` (pure functions + one smoother, pre-allocated,
returns the same object every frame) and a guarded block in index.html's pose
code that feeds it and applies it. The old rig still runs first, its lines
untouched; the aero block runs after it and overwrites every term the stroke
owns, so with the flag off the block is skipped and the pose is the base's
exactly (`aero-pose-off` proves the old elevator formula holds to 0.00006).

**Inputs**, measured rather than assumed: airspeed from the controller;
reference cruise `sprintState.baseSpeed`; the energy target (`cruise ×
throttle01` for stunt/v2, the speed itself for classic); the stunt pad's
throttle; the stall (the controller's own flag, gated off during a boost — see
traps); the elevator INTENT (`stick.y × pitchSign`, the controller's own
sign); and climb, pitch and roll RATES read off the flight frame's own motion
frame to frame (`q_prev⁻¹ q_now` in the body frame), which works the same for
classic, v2 and stunt and sees what the nest auto-fly and the launch boost do.

**The beat is a power output, not a timer.** Frequency near constant — 3.9 →
4.5 Hz across effort, because cockatiels vary theirs only ~1.2x between 1 and
13 m/s (Hedrick, Tobalske & Biewener 2003); AMPLITUDE follows power demand:
Pennycuick's U-shaped curve (induced ~n²/V, parasite ~V³, minimum at cruise),
plus the power to climb (radial climb rate) and to accelerate toward the energy
target, times the throttle. Idle throttle glides. The burst DUTY follows demand
too (intermittent flyers flap a larger fraction of the time as demand rises):
cruise is a 0.22-deep stroke flown about half the time — the old idle beat's
size and duty — and a climb is a full stroke, continuously.

**The stroke is a Bronze-winged Pionus's** — "very deep wingbeats seem to
almost touch on the downstroke and barely come above horizontal on the
upstroke" (eBird). Anchored at the TOP: 0.22 rad above the glide line, 0.90
below it at full depth, so more effort only goes DOWN. Fully spread on the
downstroke, flexed on the upstroke (span −26%, hand swept back 0.30), the hand
trailing the arm by 0.09 of a beat (the same stroke evaluated late, so it
cannot drift), pronated going down and supinated coming up.

**Speed morphs the wing** — the jackdaw's slope (Rosen & Hedenström 2001,
0.25 span per unit of V/Vstall) anchored at CRUISE, floored at 0.62, with the
wing swept aft as it shortens (swifts, Lentink et al. 2007). The literal
intercept would have flown the owner's signed-off parrot planform at 75% span
for most of the game. A sprint or a dive reads as a falcon's partial tuck.

**High lift opens the hand.** CL/CLmax = n / (V/Vstall)²; as it runs up to
1 the primaries splay (the hand group's chord ×1.35, swept forward 0.10) and
the tail fans (×1.55; pigeons spread theirs to ~151° for take-off and landing,
Berg & Biewener 2010). Fast, the tail furls to ×0.74.

**The tail is an elevator on the right axis and the right sign**: pitch on
`rotation.z`, following the elevator intent through `tailPitchOffset`'s own
convention (×1.5, since 0.16 rad at full climb is under the chase camera's
threshold), plus a flare at high lift; the perch "drop" moves to the same
axis. `rotation.x` now carries a twist INTO a roll (0.12 rad per rad/s).

**Load flexes the wing up** (0.07 rad per g of pitch-rate × airspeed, bounded
−0.12..0.30) and a gust FLICKS it (a high-pass of the vertical gust speed, so
a held updraft is not a held flex). The gust input is wired to **0** — an air
field is being built in parallel.

**The feet are landing gear**: down when contact is about 1–3 beats away on a
slow descent (time to contact 1.4 → 0.7 s, under 1.25x cruise), down when
skimming slowly within a few units, always down on the nest auto-fly, tucked
again climbing away. Down on the ground and while falling exactly as before;
in the nest they now stand where the old rig kept them tucked — invisible
either way, since the nest is a cockpit view, but it means a take-off starts
gear-down and retracts as the bird climbs out.

**Everything scales by `1 − perchBlend`**, so the perch fold and the tumble
still own the grounded, nested and falling poses.

`__BIRB.aeroPose()` reports it (`phase01, beats, downstroke, depth, envelope,
demand, span, sweep, splay, tailFan, feet, gear, …` plus the inputs), and the
live object for game code — audio keyed off a downstroke — is `aeroPose.out`,
the same object every frame. `__BIRB.setRecovery(state)` and
`birdPose().tailTip` are new debug hooks.

## The checks

- `flap-follows-climb` (the red-first check this package was given) now
  judges the tail by its TIP (`birdPose().tailTip`, with a 0.05 floor on the
  gap so a tail that does not move cannot pass on noise) instead of by
  `tail.rotation.x`, which the section above shows measures a twist; and each
  hold starts from FLYING and asserts it stayed there. The wing assertion is
  unchanged.
- `aero-pose-beat` — the beat by effort (cruise bursts, full continuous
  climb, dive and idle glide), the Pionus shape, near-constant frequency,
  left/right tip symmetry.
- `aero-pose-morph` — cruise planform, sprint tuck/sweep/furl read off the
  rig itself, slow-flight spread, the stall's splay and fan.
- `aero-pose-gear` — up at altitude, down on a flown approach while still
  flying, up again on the go-around.
- `aero-pose-tail` — the tail twists into a measured roll; load flexes the
  wing and level flight does not.
- `aero-pose-off` — boots `?aeropose=0`, proves the old rig is what runs,
  and logs the before; it asserts nothing about the defect itself.

## The numbers

Method: `node tools/birb-realism.mjs --only 'flap-follows-climb,aero-pose-*'`
(SwiftShader, `quality=amazing`, frames not milliseconds). **Control**: the
same check on the same final build twice — climb SD 0.458 / 0.459, dive
0.087 / 0.068 — so the method's own noise is ±0.001 on a climb and ±0.01 on
a dive (the dive's residual depends on where the cruise burst was when the
push began). The before is the same pair under `?aeropose=0`.

| flap-follows-climb | before (`aeropose=0`) | after |
|---|---|---|
| tip travel SD, climb vs dive | 0.141 / 0.142 vs **0.336 / 0.335** | **0.458 / 0.459** vs 0.087 / 0.068 |
| tail TIP height, climb vs dive | −0.060 vs −0.059 (did not move) | **−0.153 vs +0.010** |
| max left/right tip mismatch | **0.51 / 0.54** | **0.00000** |

The rest, on the final tree (52/52 green across both boots): cruise demand
1.00, depth 0.22, envelope mean 0.51–0.56; climb depth 0.99, envelope 1.00;
the climbing stroke reaches 1.140 below the glide line and 0.416 above it
(2.7:1; the first cut's 0.30 up read 1.088 / 0.525, which is where "barely
above" was lost); beat frequency 4.04 → 4.49 Hz with effort (1.11x); dive and
idle-throttle peak beat 0.000. Sprint (24 u/s): span 0.620, sweep 0.342 rad
(the left wing's own rotation.y −0.542, scale.z 0.55), tail 0.740. Idle
throttle (6.1 u/s): tail 1.549, splay 0.694, full span, held 0.10 forward. A
0.75 pull at idle stalls it (min 4.17 u/s, 56 stalled frames): splay 1.0,
tail 1.55. A firm roll (±3 rad/s measured off the frame) twists the tail
±0.20 into it. A hard pull: peak n 3.4, flex 0.158 rad; level flight 0.0000.
Approach from 10 units at idle: the gear starts at 4.8 units and is 0.74 out
at 3.4 units sinking 4.15 u/s — 0.67 s, about 2.7 beats, from contact (the
first window, 1.8 → 0.9 s, had it out ~4 beats early); a go-around at full
power climbs 9 u/s and the gear is fully up by 17 units.

On the ground the perch tail DROPS now: its tip reads −0.279 against the old
−0.056, because the old rig wrote the perch's `tailPitch` into the twist axis
too — 0.28 rad of twist on every walking bird, which from behind is a tail
rolled onto its edge. This is the one deliberate change to a grounded pose,
and `?aeropose=0` restores it.

Harnesses on the final tree: `tools/birb-walk.mjs` (frozen) ok — fold delta
0.593, sweep 0.650, feet swing and settle; `tools/birb-stunt.mjs` 41/41;
`tools/birb-modes.mjs` (frozen) all five modes ok with a clean console;
`tools/birb-bird-sheet.mjs` ten tiles at 23.9k–37.1k px, and its flap frames
now show the stroke going DOWN at 0.19 where the old sheet's went up.

Unit suite: `tests/aero-pose.test.js`, 34 tests (dive demand < climb demand at
equal speed, U-curve minimum at cruise, the Pionus shape, hand lag and twist
phase, slow spreads / fast sweeps and furls, stall splays, bounded and finite
under 4,000 garbage inputs, the smoother converges monotonically at 120/60/
30/20/10 fps, the phase integrates across effort changes, the same output
object every frame, the freeze rule, the ground fade-out).

## Traps, each of which cost a round or would have

- **A harness freeze is not a stall.** `freeze()` and `birdStudio()` set the
  speed to 0, and the stunt model then reports `isStalled()` and 0.35
  authority — so the bird sheet would have photographed a stalled bird with
  splayed hands. A bird IN THE AIR at under 0.25 u/s is posed as cruise: the
  energy model floors speed at 0.35x cruise and classic writes a cruise every
  frame, so only a harness can produce it.
- **The controller's stall flag lies during every boost.** It compares speed
  with the TARGET, and a boost lifts the target to 2.4x cruise. Measured on a
  pill tap: `isStalled()` reads true for the first 3 frames (0.15 s),
  `liftFactor()` drops 1.00 → 0.20 and `sinkRate()` jumps 0 → 2.6 u/s,
  easing to 1.5 by the end of the 0.6 s boost — so the stunt bird SINKS about
  a unit on every boost. Found, not fixed: it is flight-model behaviour under
  the frozen stunt suite, and it wants its own gate. The pose ignores the flag
  while `boostTimer > 0` (measured: its input read false on every one of
  those frames) and computes its own stall ratio against the base cruise.
- **Parallel transport reads as a pitch rate.** A level bird's frame turns
  nose-down at V/R: measured −0.0894 rad/s against 11/123 = 0.089. A 0.12
  rad/s deadband keeps it out of the load factor.
- **The walk gate's margin is a pose budget.** `tools/birb-walk.mjs` (frozen)
  asks the wing to move more than 0.30 rad on landing. The perch fold is 0.70,
  so the bottom of the airborne CRUISE stroke has to stay under ~0.33 at every
  phase — which is why the glide droop is 0.12, not the old 0.18.
- **The runner's shared setup can knock the bird down.** It flies at 40 units
  over the spawn grove; one base run hit a canopy or a drone, and a falling
  bird's stick is zeroed, so it read pitch 0.0 and a tumble's flapping on BOTH
  holds. Every aero check (and flap-follows-climb) now starts each hold from
  `setRecovery('flying')` and asserts the bird stayed FLYING.
- **`--only aero-pose-*` selected nothing.** The runner matched exact names
  only, so the brief's own command silently ran half its list and still said
  "ok". A trailing `*` is a prefix now.

## What is NOT verified

- **The phone.** Nothing here has been flown on glass. The deep stroke and
  the tuck are the kind of change a thumb and an eye judge in seconds;
  `?aeropose=0` is one tap on the Flags tab for the A/B.
- **The gust input** is wired to 0 until the air-field package lands.
- **Audio** does not read `aeroPose.out` yet.
- **v1/v2 birds** get the rig terms they have (no hand group); only v3 was
  looked at.
- **Cost on device**: one terrain sample and ~15 `Math.exp` per frame, zero
  allocations; not measured on a phone.
