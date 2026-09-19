# Stunt flight — fly the bird like a biplane, behind `?flight=stunt`

**Status: BUILT AND SHIPPED AS THE DEFAULT** (2026-09-19). What actually
landed, with its measurements and its open questions, is
[docs/perf/gates/G-STUNT-0.md](../perf/gates/G-STUNT-0.md) — read that first;
this document is the design reasoning it was built from, kept because the
*why* behind each term is not repeated there.

The owner's brief: *"Plan new joystick control mechanics so the birb can be
controlled like a bi-wing stunt plane, to do stunts and aerobatics. This will
be a total rewrite of the current weird triggered animation rolls and stuff."*
Then, on the plan: *"Make the stunt controller the default, and have a toggle
in the settings to switch which controller. … Please implement full send
live."*

**What differs from the plan below, and why:**

- **It is one class, not two.** `BirdFlightStunt` carries a `model` field and
  delegates to `BirdFlight`'s methods under `classic`. Swapping controller
  OBJECTS live would mean re-pointing every closure that captured `flight`;
  a field does not, and that is what makes the gear toggle work mid-flight.
- **v2 was NOT deleted.** `?flight=v2` still reaches it, because G-FLIGHT-V2
  cites it and `tools/birb-flight-v2.mjs` is a Browser Health step.
  `aerobatics.js` and its test WERE deleted, which is the part the brief asked
  for.
- **Both idle stabilisers are scaled by AUTHORITY**, which the plan did not
  call for. Without it the hammerhead is unreachable — see the gate's table.
- **The phases below were collapsed into one change** at the owner's
  instruction ("full send live"). Phase 4's camera-roll-follow A/B and the
  Stunt Show mode were NOT built.
- **`assist` is wired and defaults to 0 everywhere.** The Zen default of 1
  described in §2.6 is not implemented.

Read [FLIGHT_V2_PLAN.md](FLIGHT_V2_PLAN.md) and
[G-FLIGHT-V2](../perf/gates/G-FLIGHT-V2.md) first. v2 was the first attempt
at this and half of it is right; the plan below says exactly which half and
why the other half has to go.

## 1. What is on the branch today, and what is wrong with each piece

Three flight mappings exist and they are all in `index.html`'s boot path:

| piece | what it does | verdict |
|---|---|---|
| `src/flight/bird-flight.js` (v1, **default**) | stick x = yaw about the radial, a cosmetic bank painted on the model; pitch clamped ±80°; auto-level and `_levelRoll` every frame; constant speed | Physics underneath (parallel transport, terrain floor) is correct and stays. The mapping cannot produce a roll or a loop by construction. |
| `src/flight/aerobatics.js` + `createStickEdgeTrigger` + `AERO_WINDUP` + camera hold (357 lines, plus the trigger, wind-up and hold blocks in `index.html`) | pin the stick to the rail for 1.0–1.4 s and a canned move plays: a swept-angle profile, the stabilisers suspended, the stick ignored, a camera hold, a cooldown | **Delete.** This is the "weird triggered animation" — a move list with a dwell, a wind-up and a rail, each one a workaround for the v1 mapping. It has been retuned three times (G-AERO-FEEL, `fed210b`) and the owner's verdict has not moved. |
| `src/flight/bird-flight-v2.js` (`?flight=v2`, 14 unit tests, 21 live checks) | stick commands an ATTITUDE below the 0.97 rail (bank to 70°, elevation to 70°) and a RATE at it; turn is `turnGain·sin(bank)` about the radial; energy model for speed | **Fold into the new controller and delete the file.** The energy model, the radial-frame angle probes, the every-frame chase camera hold and the crash-by-attitude rule are right and are kept verbatim. The *mapping* is still v1's idea wearing a wing: the bank auto-turns you (so a knife-edge is impossible — 90° of bank yaws at over 100°/s about the radial instead of holding heading), the stick has a hidden mode boundary at 0.97 that only a thumb pressed to the plastic reaches, and with the stick centred the bird levels itself on both axes — inverted flight is a thing you fight for, not a thing you do. |

A stunt plane is none of those. Its defining property is that **the stick
commands rates, the aircraft has no opinion about which way is up, and the
pilot supplies the coordination.** Everything below follows from that.

## 2. The controller: `src/flight/bird-flight-stunt.js`

Extends `BirdFlight` exactly the way v2 does, and for the same reason: one
definition of parallel transport, the carve-down-only floor (`_floorAt`),
`_deflectAlongTerrain` and the pre-allocated pose. Only `tick()`/`update()`
are replaced. Up is the local radial everywhere; there is no world +Y in the
file.

### 2.1 Axes

| input | maps to | notes |
|---|---|---|
| stick x | **roll rate** about the bird's forward (local −Z) | `rate = rollMax · expo(x)`; stick right = right wing DOWN (negative rotation about +Z; the sign trap recorded three times in CLAUDE.md — the unit test checks the wing-tip position, never the sign of an Euler) |
| stick y | **pitch rate** about the bird's right (local +X) | unlimited: a loop is a 360° pitch |
| rudder (right thumb, §3) | **yaw rate** about the bird's own up (local +Y) | the bird's up, NOT the radial — that is what a rudder is. v1 yaws about the radial because it has no roll; a stunt plane with a rudder about the radial would skid sideways in a knife-edge instead of holding it. |
| throttle (right thumb, §3) | target speed, `[idle, full] × cruise` | springs back to cruise on release — no latched state to get stuck in |
| BOOST pill tap | the existing 0.6 s × 2.4 burst | unchanged |

**There is no auto-yaw from bank.** A turn is bank-then-pull, like the
aeroplane, and like Rogue Squadron, Pilotwings and Ace Combat's expert
mapping. On a thumbstick that is one motion — push the stick to the
diagonal and the bird banks and pulls into the turn together. What
turns the bird is the lift vector, i.e. pitching about the bird's own right
while banked; nothing else is needed and nothing else is added.

### 2.2 The two thumbstick problems, and their answers

G-FLIGHT-V2's adversarial review refuted the first pure-rate cut (v70) with
two findings and they have to be answered head-on, not by bringing the rail
back.

**F2 — "an ordinary hard turn at raw 0.6–0.8 rolled the bird onto its
back."** v70's roll rate was LINEAR in the stick, so raw 0.7 was 70% of a
200°/s roll. Three things make a pure-rate roll axis live on a thumb:

1. **Cubic expo on roll, on top of `INPUT_SHAPE`'s 0.2.** `expo(x) = x·(0.35 + 0.65·x²)`: half stick is 34% of the rate, 0.7 is 47%, and the last 30% of travel holds half the authority. Small deflections are trim; the rail is the roll.
2. **Bank holds while the stick is off-centre on ANY axis.** Righting (2.3) runs only with the whole stick idle. A player who has rolled to 60° and is pulling through the turn with x relaxed keeps 60° — v70 scaled righting by `1 − |x|`, so every intermediate bank decayed under the thumb and the only fix was to hold more stick, which rolled it over.
3. **Roll rate eases under load.** `rollMul = 1 − gRollDamp · |pull|` (`gRollDamp` 0.45): a wing being pulled hard rolls slower, which is true of the aeroplane and which turns a diagonal stick from a corkscrew into a banked turn. Measured target: the diagonal (0.7, 0.7) held for 2 s reaches a bank of 60–90°, not 180°.

**F3 — "a bird teleported nose-up hung there."** Idle stability has full
authority at the vertical in the new controller because it is a rate toward
the horizon along the shortest path with a floor on its magnitude, not
`sin(2p)`. And unlike v2 it never runs while the stick is off-centre — a
hands-off hang at the vertical is a stall (2.5), not a fixed point.

### 2.3 Idle behaviour: a stable biplane, not an autopilot

With the stick inside the deadzone on BOTH axes, and only then:

- **Roll rights toward upright at `righting` (0.7 rad/s) only while `|bank| < 120°`.** Past that the bird is closer to inverted than upright and STAYS inverted. Inverted level flight is a stunt; a controller that rolls you out of it is v2.
- **Pitch settles toward the horizon at `pitchTrim` (0.5 rad/s)**, shortest path. From inverted that means the nose comes to the inverted horizon, which is what an inverted biplane does when you let go (it also sinks, 2.4, which is the tell).
- Zen mode multiplies both by `ZEN_TUNING`, same as today, and Zen is where the `assist` knob (2.6) defaults on.

### 2.4 Energy, lift and sink

v2's energy model is kept as is: `dSpeed = (−gSpeed·sin(pitch) − drag·(speed − target))·dt`, bounded to `[minMul, maxMul]·cruise`, `target` = throttle × cruise × boost. Two things are added, and they are the whole reason a stunt plane feels like one:

**Lift.** `lift = (speed / cruise)² · (bodyUp · up)`. At cruise, upright, it is 1 and cancels gravity. Slower it is less; banked it is less by the cosine (a 60° bank carries half the lift, so a level turn wants back-stick — the pilot's job); in a knife-edge it is zero; inverted it is negative.

**Sink.** `sink = gSink · (1 − lift)`, clamped `≥ 0`, applied to POSITION along −radial (never to the orientation). `gSink` 4 units/s: a knife-edge sinks at 4 against a cruise of 11, inverted at cruise sinks at 8 unless the pilot pushes forward. Recoverable, and legible from the chase camera.

The floor already handles sink correctly: it is a minimum radius and carve-down-only, and a downward term cannot ratchet anything upward, so the gravity-less-floor invariant (CLAUDE.md, "Fly-INTO-valleys") is untouched. The pose's `velocity` becomes `forward·speed − up·sink`, and that vector — not `forward` — is what the camera (§4) and the trick detector (§6) read.

### 2.5 Authority and the stall: the hammerhead for free

`authority = clamp(speed / cruise, 0.35, 1.2)` multiplies the pitch and yaw rates (roll less: `0.6 + 0.4·authority`). Below `stallMul` (0.5 × cruise) a **weathervane** term rotates the nose toward the velocity vector at `stallRate` (2.0 rad/s), scaled by how far below stall the speed is.

That is one term, and it produces the signature biplane stunt with no move list: pull to the vertical at idle throttle, the energy model bleeds speed at `gSpeed` per second of `sin(90°)`, authority fades, the nose falls through toward the velocity — which by then is straight down — and the bird is in a vertical dive picking speed back up. With a touch of rudder at the top it pivots instead of falling: a hammerhead. Without rudder it is a tail-slide into a dive. Both are correct.

### 2.6 One knob for the casual player: `assist`

A single 0..1 blend, default 0 in Casual and every mini-game, default 1 in Zen, exposed on the Flags tab and in settings as **Stunt assist**:

- at 1: righting and pitch trim run at `(1 − |stick|)` strength even with the stick held (v2's behaviour), the roll rate is halved, lift is clamped ≥ 0.6 so nothing sinks fast;
- at 0: the biplane above.

This is the only place v2's law survives, and it is a scalar on the same code path — not a second controller, not a rail.

### 2.7 Tuning table (`FLIGHT_STUNT_DEFAULTS`, `?stunttune=key:value`)

| key | start | why |
|---|---|---|
| `rollMax` | 5.2 rad/s (300°/s) | a full roll in 1.2 s at the rail; a Pitts does 240–400 |
| `rollExpo` | 0.35 | linear share at the centre of the cubic |
| `gRollDamp` | 0.45 | roll rate at full pull is 55% |
| `pitchMax` | 2.6 rad/s (150°/s) | loop in 2.4 s; radius speed/rate ≈ 4.2 at cruise, ~11 units across with the energy dip |
| `yawMax` | 1.2 rad/s | rudder; enough to hold a knife-edge heading and pivot a hammerhead, not enough to flat-turn |
| `righting` / `pitchTrim` | 0.7 / 0.5 rad/s | idle only, §2.3 |
| `rightingLimit` | 2.09 rad (120°) | past this the idle bird stays inverted |
| `gSpeed` / `drag` / `minMul` / `maxMul` | 6.0 / 0.9 / 0.35 / 1.9 | v2's, with a lower floor so a stall exists |
| `gSink` | 4.0 units/s | §2.4 |
| `stallMul` / `stallRate` | 0.5 / 2.0 rad/s | §2.5 |
| `throttleIdle` / `throttleFull` | 0.55 / 1.35 × cruise | right thumb range |
| `deadzone` | 0.08 | matches `INPUT_SHAPE` |

The phone decides the numbers. Every one is reported back by `flightProbe().tuning`, as v2's are.

## 3. Input: the right thumb already exists

The whole argument against free flight in `aerobatics.js` was "there is no spare input — one stick, one pill, both under a thumb." The pill IS the second thumb. Today it does one thing on tap. It becomes a **pad**:

- **tap** — boost, exactly as now (grounded: take off, as now);
- **drag up / down** while held — throttle, `[idle, full]`, springing back to cruise on release;
- **drag left / right** while held — rudder, springing back to zero.

`src/flight/stunt-pad.js`: a pure state object (`{ throttle, rudder, boostTap }`) with a DOM adapter, unit-tested without the DOM the way `touch-input.js`'s state is. Tap-vs-drag is decided by a 12 px / 180 ms threshold, and a drag that began as a tap never fires the boost — measured on the phone before the number is kept.

The left stick is unchanged: nipplejs `dynamic` in `.touch-controls__zone`. Check at build time whether that zone spans the pill's corner — if it does, the pad must claim its touches first (`pointerdown` with `stopPropagation` on the pill's own element), or a drag on the pill spawns a second stick.

Desktop: `Q`/`E` rudder, `Shift`/`Ctrl` throttle, in `createKeyboardInput`.

Not doing: gyro rudder (iOS permission prompt, unreliable in the wrapper), a third on-screen control, and any gesture that needs explaining. The owner's test for the trigger still applies to the pad: if he cannot tell whether it is working, it is not.

## 4. Camera: keep v2's frame, read velocity, add a little roll

v2's every-frame `bCam.setHold` (heading = tangent projection, ~0.08 s smoothing, frozen when the tangent is short, `distanceMul = 1 + 0.6·|sin pitch|`) is the right rig and moves into the stunt block unchanged, with three changes:

1. **Heading comes from the VELOCITY tangent, not forward's.** With sink and a stall the two differ, and through a hammerhead the velocity reverses smoothly while forward snaps — a camera on forward flips at the top.
2. **A small roll follow.** `camera.up = normalize(mix(radial, bodyUp, k))`, `k` 0.15. G-AERO-FEEL recorded that a camera that rolls WITH the bird hides the roll entirely, so `k` stays small and is A/B'd by capture at 0 / 0.15 / 0.3 before it ships; the point is that a knife-edge should tilt the horizon a few degrees so the pilot feels the edge.
3. **Look-ahead along velocity**, so a sinking knife-edge frames where the bird is going.

`bird-visual.js`'s cosmetic bank drops to v2's 0.12 / 0.08 rad under the stunt controller, or it double-banks.

## 5. Ground, nest and knockdown

- **Crash rule**: v2's, generalised. Contact with `bodyUp·up < 0.25` (75° off upright) or `speed > 1.4·cruise` with the nose down is the existing knockdown (`FALLING`); upright and unhurried lands. The sink term makes an actual glide-in possible for the first time.
- **Landing band** (the G-FLIGHT-V2 finding, "a level bird cannot land"): with sink in the model, contact is `aboveGround < 0.3 && sink > 0.5 && upright && speed < 1.2·cruise`, evaluated BEFORE the floor clamp lifts the bird back. It is a strict inequality on a quantity that now moves, not a coin toss at a shared boundary. This is the one change that touches v1's world, so it lives behind the flag until the default flips (§8).
- **Nesting** takes control of the bird before `tick()` (`nestingControlsBird`) and is unaffected. The stunt block, like v2's, releases the camera hold and zeroes the pad while nested, grounded or falling.
- The knockdown's fall is not gravity and is not replaced by it; `FALLING` still pushes below the floor each frame, ramping 1× → 3×.

## 6. Naming the stunt: `src/flight/stunt-detector.js`

Pure module, no THREE: it consumes the per-frame probe (`bank`, `pitch`, `heading`, `speed`, `aboveGround`, `simTime`) and emits events when a figure closes:

| figure | detected as |
|---|---|
| Roll | bank sweeps 360° within 2.5 s, pitch stays within ±30° |
| Loop | pitch sweeps 360° within 5 s, heading within ±25° of entry |
| Immelmann | first half of a loop, then a half roll to upright within 1.5 s |
| Split-S | half roll to inverted, then the lower half of a loop |
| Hammerhead | pitch > 75° with speed < stall, then heading reversed within 2 s |
| Knife-edge | `|bank|` within 15° of 90° held 1.5 s, heading drift < 20° |
| Inverted | bank within 30° of 180° held 2 s |
| Low pass | `aboveGround < 2` for 1 s at speed > cruise, upright |

Each fires `statusMetric` ("Hammerhead!"), a haptic tick and a chime; Casual keeps a session tally on the results card. A **Stunt Show** mode (a scored 60 s of figures, combo for chaining them) is one row in `game-modes.js`' table and is NOT in this plan's scope — the detector is, because it is also the evidence tool: the live harness asserts "the detector saw a loop" instead of re-deriving one from angles.

## 7. Bird pose

`bird-pose.js` gains three targets, cosmetic and blended in the existing `perchBlend` style: primaries sweep back with speed (fast dive = swept, stall = fully spread), the tail fans with `|pull|`, and the wing-tip **bank dip stays same-signed** (the antisymmetric fix from `04463fe` — the test that checks `leftTip`/`rightTip` against each other is the guard). No rig contract change; `tests/bird-contract.test.js` stays green.

## 8. Phases and gates

Every phase lands behind `?flight=stunt`, on the Flags tab, with `docs/perf/gates/G-STUNT-<n>.md` recording what was measured on the sim clock (`flightProbe().simTime` — frames, never milliseconds; the harness runs at 3 fps under SwiftShader).

| phase | builds | gate (measured, not eyeballed) |
|---|---|---|
| **0 — mapping** | `bird-flight-stunt.js` with §2.1–2.3 and v2's energy; `index.html` construction, cruise handover, crash rule, camera block; `tests/bird-flight-stunt.test.js` | roll 360° in ≤ 1.3 s and closes to < 2°; loop closes, heading kept; (0.7, 0.7) held 2 s banks 60–90°; centred stick from 60° bank levels in < 3 s; from 170° stays inverted; 90° bank + no rudder holds heading within 10°/s (the v2 law turns at over 100°/s there); zero allocs over 1000 ticks; same results at the pole and the equator |
| **1 — lift, sink, stall** | §2.4–2.5 | knife-edge sinks 3–5 u/s; inverted at cruise sinks and forward stick holds it; vertical at idle stalls and the nose falls through inside 2.5 s; floor holds through a loop under |
| **2 — the pad** | `stunt-pad.js`, keyboard rudder/throttle, boost preserved | tap still boosts (the harness taps and asserts `boostTimer`); a drag never boosts; hammerhead with rudder reverses heading within 25° of 180° |
| **3 — ground** | landing band, generalised crash rule, `tools/birb-stunt.mjs` in Browser Health | glide-in lands (GROUNDED) on ≥ 9/10 runs from a fixed pose; inverted contact is FALLING; `birb-walk` stays green under v1 |
| **4 — read** | camera roll follow A/B, pose targets, detector + toasts | capture sheet of all eight figures from the chase camera, each tile non-blank and the detector naming it; the `k` A/B chosen by capture |
| **5 — flip** | default → stunt; `?flight=v1` kept as the escape; delete `aerobatics.js`, its test, the trigger, `AERO_WINDUP`, the wind-up scaling in the visual block, `bird-flight-v2.js` + its test + tool; `sw.js` `CORE_ASSETS` updated; CLAUDE.md entry | `BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js` green; the three R5-frozen boot lines are inspected — they pin `quality=amazing`, not a flight model, so they inherit the default and must be re-measured, or pinned to `flight=v1`, before the flip; phone A/B on the Flags tab, both ways, blind |

Phase 0 is the one that decides anything; if it does not feel like a biplane with the stick alone, phases 1–4 do not rescue it.

## 9. What must not change

- v1 stays exactly as it is until phase 5 and remains the pinned oracle (`tests/bird-flight.test.js`); the walk, nesting and knockdown paths run v1's floor.
- Parallel transport, `_floorAt`, `_deflectAlongTerrain` — inherited, never re-derived.
- Up is radial. The rudder axis is the bird's up; the sink axis is the radial; nothing is world +Y.
- Zero allocation in `tick()`/`update()`/the pad/the detector — `_` scratch, one pre-allocated event object.
- `sw.js` `CORE_ASSETS` gains every new `src/flight/*` module in the same commit it is imported; the build-identity test is the check `npm test` skips.
- `tools/lib/quality-captures.mjs` is hash-frozen under R5 and is not edited for this.
- No new gesture that needs a tooltip.

## 10. Open questions for the owner (not blocking phase 0)

1. **Assist default in Casual**: the plan says 0 (the biplane). If the first phone flight says the first-time player can't hold a turn, the alternative is 0.5 in Casual and 0 in Ring Rush / Drone Hunter, not a rail.
2. **Throttle spring vs latch**: spring is planned. A latched throttle makes a sustained idle-power stall easier and a "stuck slow" complaint likelier.
3. **Stunt Show mode**: worth a row in the modes table once the detector exists; not planned here.
