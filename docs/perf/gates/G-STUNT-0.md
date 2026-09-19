# G-STUNT-0 — the stunt flight model ships as the default; triggered aerobatics are deleted

**Date:** 2026-09-19. **Build:** `v74-2026-09-19-stunt-flight`.
**Decision:** SHIP AS THE DEFAULT, with a live Classic toggle in the gear menu.
**Plan:** [docs/realism/STUNT_FLIGHT_PLAN.md](../../realism/STUNT_FLIGHT_PLAN.md).

## The owner's words

> "Plan new joystick control mechanics so the birb can be controlled like a
> bi-wing stunt plane, to do stunts and aerobatics. This will be a total
> rewrite of the current weird triggered animation rolls and stuff."

and then, on the plan:

> "Make the stunt controller the default, and have a toggle in the settings to
> switch which controller. … Please implement full send live — I'm the only
> one who uses this page atm."

## What shipped

`src/flight/bird-flight-stunt.js` extends `BirdFlight`, so parallel
transport, `_floorAt` and `_deflectAlongTerrain` keep ONE definition across
every model. The law:

| input | maps to |
|---|---|
| stick x | **roll rate** about the bird's forward, cubic expo, eased by authority and by how hard the wing is being pulled |
| stick y | **pitch rate** about the bird's right, unlimited — a loop is a 360-degree pitch |
| BOOST pill, dragged sideways | **rudder**, about the BIRD'S OWN up |
| BOOST pill, dragged up/down | **throttle**, 0.55–1.35 of cruise |
| BOOST pill, tapped | the boost, exactly as before |

and **nothing turns the bird except the lift vector**. There is no auto-yaw
from bank. That single omission is what separates this from v2: v2's
`turnGain * sin(bank)` means 90 degrees of bank yaws you at over 100 deg/s
about the radial, so a knife edge cannot hold a heading and is not a
manoeuvre you can fly.

Added on top of v2's energy model:

- **Lift** `(speed/cruise)² · (bodyUp·up)` — 1 level at cruise, half in a
  60-degree bank, zero in a knife edge, NEGATIVE inverted.
- **Sink** `gSink · (1 − lift)`, clamped ≥ 0, applied to POSITION along the
  negative radial and never to the orientation. That difference between where
  the bird looks and where it goes is what a knife edge IS.
- **Authority** `clamp(speed/cruise, 0.35, 1.2)` on every commanded rate and
  on both idle stabilisers.
- **A stall**: below `stallMul · cruise` the nose weathervanes toward the
  velocity at `stallRate`.

Deleted: `src/flight/aerobatics.js`, `tests/aerobatics.test.js`, the
stick-edge trigger, `AERO_WINDUP`, the wind-up scaling in the visual block,
the per-frame aerobatics block in `index.html`, and the `__BIRB.aero` /
`aeroState` hooks. `bird-flight-v2.js` is KEPT and reachable at `?flight=v2`,
because `G-FLIGHT-V2` cites it and `tools/birb-flight-v2.mjs` is a Browser
Health step.

## The three things that were got wrong first, and measured

**1. A half-loop check that consumed the accumulator made a full loop
undetectable.** The first trick detector tested for a half turn before a full
one and zeroed the accumulator at PI — and a loop necessarily passes through
PI on its way to 2PI, so `loop` could never fire at all. A full turn now
fires on completion and resets the accumulator while the axis keeps running
(three held loops are three toasts); half turns are classified only once the
axis has been quiet for `settle`, which is what the end of a figure actually
looks like. `tests/stunt-detector.test.js` opens with that case.

**2. The hammerhead was unreachable because the pitch trim was not an
aerodynamic term.** Hands-off, the trim dragged the nose back to the horizon
at a flat 0.5 rad/s whatever the airspeed, so the bird was always level again
before the energy model could bleed it below stall. Measured, from a
near-vertical pull with the stick released:

| | min speed | stalled? |
|---|---|---|
| trim unscaled, `gSpeed` 6.0 | 6.30 | no |
| trim × authority, `gSpeed` 7.5 | 4.45 | **yes** |
| trim × authority, `gSpeed` 7.5, idle throttle | 3.85 | **yes** |

Stall threshold is `0.5 × cruise` = 5.5. Both stabilisers are scaled by
authority now — a wing with no air over it does not right itself either —
and `pitchTrim` came down to 0.4. That one change is the whole hammerhead:
pull to the vertical, let go, and the terms do it, with no move list, no
trigger and no dwell.

**3. The roll sign, and how it was checked.** This codebase has got a roll
sign wrong three separate times (the bank with no bank in it, the aerobatic
roll that rolled the wrong way, the inside-out bird), and every one of them
was arguable from the source and decisive the moment something evaluated a
position. The sign tests here assert where the **wing tip** ends up, never
the sign of an angle.

## Answering the v70 refutation without bringing back a rail

G-FLIGHT-V2's adversarial review refuted a pure-rate law (F2): the only
sustainable bank was below shaped 0.29, an ordinary hard turn on this stick
is raw 0.6–0.8, so the first hard turn asked for would have rolled the bird
onto its back. v2's answer was an attitude command below a 0.97 rail. This
model's answer is three terms, and none of them is a mode boundary:

1. **Cubic expo** (`rollExpo` 0.35): half stick is 34% of the rate and 0.7 is
   47%. Asserted directly in the unit suite.
2. **Righting runs only with the WHOLE stick idle.** v70 scaled it by
   `1 − |x|`, so every intermediate bank decayed under the thumb and the only
   cure was more stick, which rolled it over. A bank you put in stays in —
   there is a test that establishes a bank, then pulls through a turn with a
   whisper of aileron, and requires the bank to survive.
3. **Roll rate eases under load** (`gRollDamp` 0.45): a diagonal stick is a
   banked turn, not a corkscrew. Measured: (0.7, 0.7) held for two seconds
   banks 25–130 degrees rather than rolling continuously.

F3 (the `sin(2p)` term that left a teleported nose-up bird hanging) is
answered the same way v2 answered it — shortest-path error with full
authority at the vertical — and has its own test at both sites.

## Evidence

- **`tests/bird-flight-stunt.test.js`** — 41 checks, every behavioural one run
  at a pole AND at the equator, because a term written against world +Y
  passes at the pole and is wrong everywhere else.
- **`tests/stunt-pad.test.js`** — 11 checks, most of them about tap-versus-drag.
  The boost is the control the game already had; if two axes on the pill cost
  a reliable tap, the pad is a net loss however good the rudder is.
- **`tests/stunt-detector.test.js`** — 16 checks, opening with the full-loop
  case above.
- **`tools/birb-stunt.mjs`** — the live page, booted with **no flight flag**,
  which is the point: it asserts the PRODUCTION DEFAULT is the stunt model. A
  harness passing `?flight=stunt` would still pass on a build whose default had
  silently reverted. It drives the stick and the pad through `__BIRB`, taps the
  real pill to prove the boost survived, reads the camera hold back off the
  LIVE rig (a hold that arrives at the parked follow rig is indistinguishable
  from one that does not work), toggles the model live, and treats console
  warnings as failures.

## Gate decision: the frozen oracles this change touches

Per the manifest's own rule, each of these is authorised here and the manifest
is regenerated in the same commit as the change it blesses.

1. **`tests/aerobatics.test.js` is deleted.** It is the test for a module that
   no longer exists. Keeping it would mean keeping `aerobatics.js`, which is
   the thing the owner asked to remove.
2. **`tools/birb-walk.mjs`, `tools/birb-modes.mjs` and `tools/birb-quality.mjs`
   gain `&flight=classic`.** Every assertion in them was written and frozen
   against v1's flight behaviour — a clamped pitch, no roll in the flight
   frame, no sink. Pinning them RESTORES the state they were frozen against,
   exactly as `&quality=amazing` does for the Ultra default (G-ULTRA-DEFAULT).
   This is a boot-line change only; not one threshold or assertion was edited.
3. **Three new test files are added to the manifest** by regeneration:
   `bird-flight-stunt`, `stunt-pad`, `stunt-detector`.

`tools/lib/quality-captures.mjs` and every quality threshold are untouched.

## Not frozen, but worth recording

`node_modules/three/index.js` — the repo's tracked hand-written stub — gained
`Vector3.add`, `Vector3.cross` and `Vector3.distanceTo`. Real three has had
all three forever; the stub did not, and each absence surfaced as a TypeError
inside a controller rather than as a missing-method error at import. Same
reason `Quaternion.conjugate`/`invert` were added there on 2026-09-13.

## What is NOT known

1. **The phone.** No number in this gate comes from a real device. Everything
   above is the unit suite and a SwiftShader page. The stunt model is the
   default on the owner's explicit call, and Classic is two taps away in the
   gear menu, which is what makes that an acceptable default.
2. **Whether a pure-rate stick is the right feel on a thumb.** The three terms
   above answer the measured v70 failure; they do not prove the result is
   *nice*. That is the phone's verdict, and the gear toggle is the A/B.
3. **The pad's thresholds.** 12 px and 180 ms for tap-versus-drag, 70 px for
   full deflection, are chosen from what a thumb does on a phone held
   one-handed and have not been measured on one. If a tap starts reading as a
   drag, `tapSlop` is the number.
4. **Sink against the terrain floor.** A knife edge held over rising ground
   now meets the floor, which is a clamp rather than a landing. The unit suite
   proves the floor holds and that the invariant is not violated; what that
   feels like at speed is unmeasured.
5. **`assist` is wired and defaults to 0 everywhere.** The Zen default of 1
   described in the plan is NOT implemented.
