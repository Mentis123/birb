# G-FLIGHT-V2 — bank to turn: flight emerges from input, not input from flight

**Date:** 2026-09-13 (night). **Build:** `v71-2026-09-13-flight-v2-attitude` (v2 first landed at `v70-2026-09-13-flight-v2` as a pure-rate law; see "What the review found"). **Decision:** SHIP AS THE A/B (`?flight=v2`, one tap on the Flags tab); v1 stays the default until the phone has flown both.

## The owner's words

> "This all seems like kluky workarounds instead of proper flight like an airplane or bird. Why can't we have proper flight?" … "Yes to the a/b with flight v2."

## Why v1 feels scripted

The quaternion 6DOF physics underneath `src/flight/bird-flight.js` is fine. The input MAPPING on top is the problem:

- stick x drives **yaw** about the planet's up, not roll; a cosmetic bank is painted on the model by `bird-visual.js` and taken back out every frame via `_levelRoll`
- pitch is **clamped** at ±80° with an auto-level term that pulls the nose to the horizon whenever speed > 0.5
- speed is **constant**: `index.html` assigns `flight.speed` from cruise every frame

Those controls cannot produce rolls or loops, so they were bolted on as committed moves (`src/flight/aerobatics.js`) with a stick-edge trigger at 0.94, a 0.55 s dwell, a wind-up, and a camera hold. Each is a workaround for the mapping. v2 replaces the mapping; every one of them goes.

## What v2 is

**Bank to turn, like a wing.** The standard input mapping of every flight game and every aircraft:

| input | v1 | v2 |
|---|---|---|
| stick x | yaw rate about radial up (+ cosmetic bank) | **roll rate** about the bird's forward axis |
| stick y | pitch rate, clamped ±80° | **pitch rate, unlimited** |
| turning | from yaw | **from the bank**: yaw rate = `turnGain * sin(bank)` + direct assist `yawAssist * x` for thumbstick responsiveness |
| roll with no input | levelled at 2.2 rad/s always | **self-righting** at `rightingRate`, scaled down while stick holds bank; never fights input |
| pitch with no input | auto-level to horizon, clamped | **gentle stability** toward horizon by shortest path, scaled down while stick holds pitch; no clamp |
| speed | constant cruise (× boost) | **energy**: `dSpeed/dt = -G_SPEED * sin(pitch) - drag * (speed - cruise)`, clamped to `[minMul, maxMul] * cruise` |

Inverted flight, loops, rolls, split-S, Immelmann — all emergent. Push the stick part way and you hold that bank; centre it and the wings level; pin it to the rail (0.94) and you keep rolling. Pull part way and you hold that climb; pull to the rail and you go over the top. The loop's radius is speed over pitch rate and nothing else.

Angles measured against LOCAL radial (up is radial, never world +Y): `bank = atan2(up·right, up·bodyUp)`, `pitch = asin(up·forward)`.

## What is removed

1. **Aerobatics module** (`src/flight/aerobatics.js`) — no-ops in `index.html`, removed entirely under v2
2. **Stick-edge trigger** (fired when rail held at 0.94 for 0.55 s) — gone; input is continuous
3. **Dwell and wind-up** (`AERO_WINDUP = 0.4`) — gone; roll rate responds immediately
4. **Camera hold** during a move — gone; camera holds velocity heading projected onto the tangent plane, updated every frame
5. **Speed ownership** changes: `index.html` writes `flight.cruise` instead of `flight.speed` in the flying branch; the energy model owns `speed`

## Evidence tools

- **`tests/bird-flight-v2.test.js`:** held roll passes through inverted and closes; bank turns heading, opposite banks turn opposite ways; held pull completes a loop and preserves heading; hands-off from inverted rights within 3 s and from 60° dive levels; dive gains speed and climb loses it, both bounded; no world-+Y dependence
- **`tools/birb-flight-v2.mjs`:** boots `?debug=1&flight=v2&quality=amazing`, drives `__BIRB.setStick(x,y)`, asserts on `__BIRB.flightProbe()` fields (`rollFullDeg`, `pitchFullDeg`, `altitude`, `speed`), verifies crash on inverted contact and landing upright, zero console warnings. Added to `.github/workflows/browser-health.yml`
- **Flags tab:** `src/ui/boot-flags.js` entry `{key:'flight', options:[{value:null,label:'v1'},{value:'v2',label:'v2 (bank to turn)'}]}` for one-tap A/B on phone
- **Contact sheet:** loop and roll from chase camera, then the phone

## Measured

Tuning start points (all in `FLIGHT_V2_DEFAULTS` table; the phone decides the final values):

| parameter | start value | rationale |
|---|---|---|
| rollRate | 3.5 rad/s | at the rail: 2.35 s for 360° on the sim clock (1.80 by arithmetic; the bank command is still settling the first frames and the measure lags the quaternion), inverted at 1.10 s. v70's pure-rate law: 2.05 s |
| pitchRate | 2.1 rad/s | 3.33 s over / 3.67 s under at the rail, on the sim clock |
| turnGain | 1.6 rad/s | yaw rate at 90° bank; at 45° bank ≈ 65°/s |
| yawAssist | 0.35 rad/s | direct yaw per unit stick for thumbstick feel |
| rightingRate | 1.4 rad/s | 1.38 s from inverted to |bank| < 12° (bankGain 2.0 with the roll-rate clamp; v70's righting term: 2.42 s) |
| pitchStability | 0.6 rad/s | the evidence tool re-levels from a 1 s half-stick dive inside its 5 s window every run; the unit suite levels from exactly VERTICAL in under 3 s (v70 hung there — F3) |
| G_SPEED | 6.0 units/s² | +1.2 (11.4 -> 12.5 at a half-stick 25° dive); the tool's full-stick-for-1-s dive: 9.2 -> 11.5 |
| drag | 0.9 /s | -2.0 (12.5 -> 10.5 at a half-stick 24° climb); the tool's climb half: 11.9 -> 10.4 |
| minMul / maxMul | 0.55 / 1.9 | floor prevents stall, ceiling limits dive |
| deadzone | 0.08 | treat \|x\|,\|y\| < 0.08 as zero for stability scaling |

Flight envelope measurements (from the phone):

| measurement | value |
|---|---|
| loop altitude span (≈ diameter) | 12.5 over, 15.3 under (v1's committed loop: 11.7; v1's first raised-cosine loop: ~3.5) |
| loop speed range | 7.4–13.8 over, 8.2–14.4 under (energy: slow at the top, fast at the bottom) |
| loop-under minimum clearance | 73.3 above ground from a 90 start in the tool; 83.0 in the sheet (dip 7–17 depending on entry speed) |
| held bank at raw stick 0.25 / 0.33 | 11.1° / 16.5° in-game (the input pipeline's deadzone 0.08 and expo 0.2 shape the stick first); by the law, shaped 0.5 holds 37°, just inside the rail holds 70°, and the rail rolls. Under v70's pure-rate law the SAME sticks read 14.5° / 23.6° and anything past shaped 0.29 rolled inverted |
| heading rate at those banks | 36 / −18 °/s as measured — NOT trustworthy (the sign flips between runs): the sheet flies from spawn, which is the +Y pole, where `flightProbe().headingDeg`'s pole reference is ill-conditioned. By the law: 127 °/s at the 70° maximum held bank, about 80 at a half-stick 37° (v1 pinned: 135). Re-measure away from the pole before quoting |

## What the review found (v70 -> v71, same night)

An adversarial review of the v70 controller (pure roll rate and pitch rate
on both axes, self-righting scaled by 1−|x|) confirmed, with reproductions:

- **F1** the ground-contact crash rule fired on a level, upright, hands-off
  bird for 0.68 s after every boost (target 26.4 -> 11 in one frame with
  the speed still 19: speed/cruise 1.75). The speed half now also requires
  the nose down (`fwd·up < −0.2`).
- **F2** the only sustainable bank was below shaped 0.29 (raw 0.40), and an
  ordinary hard turn on this stick is raw 0.6–0.8 — so the first hard turn
  the owner asked for would have rolled the bird onto its back, with a
  sustained turn ceiling of ~65 °/s against v1's 144. Structural fix: the
  stick commands an ATTITUDE below the rail (bank up to 70°, elevation up to
  70°, reached at the rate clamps) and a RATE at it (0.94, the edge the old
  trigger measured). `rightingRate`/`rightingSoftBank`/`pitchStability` are
  gone; `bankGain`/`pitchGain` 2.0 are the stability.
- **F3** the pitch stability was `sin(2p)`: zero at the vertical, a
  teleported nose-up bird hung there and the camera heading froze with it.
  The pitch command has full authority at 90° (unit test: levels from
  vertical in under 3 s).
- **F4** two option-object literals per frame in the camera block — hoisted.
- **F5** the tool's "upright lands" check ran on a bird already grounded by
  the crash scenario's fall — it now takes off again and asserts FLYING at
  the drop.
- **F6** a held pitch had a trim band of ~12% of the stick — any stick holds
  an angle now.
- **F7/F8** the camera heading lagged every turn by ~16° (τ 0.25 -> 0.08 s)
  and survived teleports, landmark seeks and biome switches (zeroed there).

Kept from the review's "could not break" list: the sign conventions at the
pole, the equator and an oblique site, parallel transport, zero allocations
in the controller over 1000 ticks, and the speed-ownership handover.

## What is NOT known

1. **The phone.** No flight v2 numbers come from a real device yet. SwiftShader at the Okay preset runs the math; the frame rate is what limits how finely a maneuver can be sampled. The chase-camera frames captured here (`v2-loop-over-*.png`, `v2-roll-*.png`, SwiftShader) show a level horizon with the bird inverted mid-frame and the hold reading weight 1 / distanceMul 1.33–1.39 through both loops.

2. **Bank-to-turn as intent.** On a thumbstick, a held bank means "turn this way" — but the turn emerges over a second or so as the aircraft yaws. The question: does a thumbstick player read continuous bank as "I'm turning" (intuitive, aircraft-like) or "something is wrong, I'm overbanked and stuck" (fight-y, v1-like)? Only the phone A/B answers it.

3. **The tuning table is a starting point.** The values are chosen to make a 1.8 s roll and a 3 s loop at cruise speed, matching the feel v1 had. They are not measured against the phone and may not be balanced — a 90° bank might feel sluggish or twitchy compared to a 45° bank. The Flags tab and `__BIRB.flightProbe()` make it cheap to sweep them.

## A level bird cannot land, and that is older than v2 (2026-09-14)

Found while making `tools/birb-flight-v2.mjs`'s upright-landing check
deterministic. It is a property of the SHIPPED game, v1 included:

- `_floorAt()` = `sphereRadius + sampleTerrainHeight(dir) + birdRadius`.
- `checkGroundCollision()` = collision when
  `radius < sphereRadius + terrainFloorDir(dir) + entityRadius`.
- `sampleTerrainHeight` IS `terrainFloorDir`, and `index.html` passes the
  same `FLIGHT_RECOVERY_CONFIG.birdRadius` (0.6) to both.
- `flight.tick()` clamps to the floor BEFORE the landing check reads the
  position.

So a flying bird sits at exactly the boundary — `birdPose().aboveGround`
reads 0.600 — and the strict `<` is decided by float rounding. Placing the
bird below the surface does not help: the clamp lifts it back within one
frame. Measured, a level bird grounded on about one run in three inside 60
frames; `tools/birb-walk.mjs` is reliable only because it polls 120.

Landing in this game therefore happens through the knockdown (FALLING
pushes below the floor every frame) or through the nest. A glide onto flat
ground meets an invisible floor instead.

Out of scope tonight — a landing band changes v1 for every mode and has to
respect the gravity-less-floor invariant — so the tool asserts the half
that IS this feature's business and IS reachable: upright, unhurried
contact must never be read as a CRASH. That check would have caught the
boost bug the review found (F1). Whether it also GROUNDS is printed, not
asserted.
