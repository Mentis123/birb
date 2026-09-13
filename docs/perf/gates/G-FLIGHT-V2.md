# G-FLIGHT-V2 — bank to turn: flight emerges from input, not input from flight

**Date:** 2026-09-13 (night). **Build:** TBD. **Decision:** SHIP AS THE A/B (`?flight=v2`, one tap on the Flags tab); v1 stays the default until the phone has flown both.

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

Inverted flight, loops, rolls, split-S, Immelmann — all emergent. Hold the stick over and you keep rolling. Centre it and you hold the bank. Pull and hold and you go over the top. The loop's radius is speed over pitch rate and nothing else.

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
| rollRate | 3.5 rad/s | 2.05 s for 360° on the sim clock (1.80 by arithmetic; the extra is the first frames the bank measure lags the quaternion). Inverted at 1.23 s |
| pitchRate | 2.1 rad/s | 3.73 s over / 3.72 s under, on the sim clock |
| turnGain | 1.6 rad/s | yaw rate at 90° bank; at 45° bank ≈ 65°/s |
| yawAssist | 0.35 rad/s | direct yaw per unit stick for thumbstick feel |
| rightingRate | 1.4 rad/s | 2.42 s from inverted to |bank| < 12° |
| pitchStability | 0.6 rad/s | not isolated; the evidence tool re-levels from a 60° dive inside its 5 s window every run |
| G_SPEED | 6.0 units/s² | +1.0 (12.2 -> 13.2 at half stick, pitch -39°); full stick from cruise: 9.4 -> 11.8 |
| drag | 0.9 /s | -1.9 (12.4 -> 10.5 at half stick, pitch +30°); the tool's climb half: 12.7 -> 10.8 |
| minMul / maxMul | 0.55 / 1.9 | floor prevents stall, ceiling limits dive |
| deadzone | 0.08 | treat \|x\|,\|y\| < 0.08 as zero for stability scaling |

Flight envelope measurements (from the phone):

| measurement | value |
|---|---|
| loop altitude span (≈ diameter) | 12.4 over, 13.5 under (v1's committed loop: 11.7; v1's first raised-cosine loop: ~3.5) |
| loop speed range | 7.4–13.8 over, 8.2–14.3 under (energy: slow at the top, fast at the bottom) |
| loop-under minimum clearance | 73.0 above ground from a 90 start (dip ~17) |
| sustained bank at raw stick 0.25 / 0.33 | 14.5° / 23.6° in-game (the input pipeline's deadzone and expo shape the stick before the controller sees it; the controller alone gives 32° / 43° at those values) |
| heading rate at those banks | 35 / 27 °/s as measured — NOT trustworthy: the sheet flies from spawn, which is the +Y pole, where `flightProbe().headingDeg`'s pole reference is ill-conditioned. Re-measure away from the pole before quoting a turn rate |

## What is NOT known

1. **The phone.** No flight v2 numbers come from a real device yet. SwiftShader at the Okay preset runs the math; the frame rate is what limits how finely a maneuver can be sampled. The chase-camera frames captured here (`v2-loop-over-*.png`, `v2-roll-*.png`, SwiftShader) show a level horizon with the bird inverted mid-frame and the hold reading weight 1 / distanceMul 1.33–1.39 through both loops.

2. **Bank-to-turn as intent.** On a thumbstick, a held bank means "turn this way" — but the turn emerges over a second or so as the aircraft yaws. The question: does a thumbstick player read continuous bank as "I'm turning" (intuitive, aircraft-like) or "something is wrong, I'm overbanked and stuck" (fight-y, v1-like)? Only the phone A/B answers it.

3. **The tuning table is a starting point.** The values are chosen to make a 1.8 s roll and a 3 s loop at cruise speed, matching the feel v1 had. They are not measured against the phone and may not be balanced — a 90° bank might feel sluggish or twitchy compared to a 45° bank. The Flags tab and `__BIRB.flightProbe()` make it cheap to sweep them.
