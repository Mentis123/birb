# Flight v2 — proper flight, behind `?flight=v2`

**Status:** brief for the build (2026-09-13, night). The owner's words:

> "This all seems like klugy workarounds instead of proper flight like an
> airplane or bird. Why can't we have proper flight?" … "Yes to the a/b with
> flight v2."

## Why the current flight is what it is

`src/flight/bird-flight.js` (v1) is a quaternion 6DOF controller on a
sphere with parallel transport — the physics underneath is fine. What makes
it feel scripted is the INPUT MAPPING on top of it:

- stick x is **yaw** about the planet's up, with a *cosmetic* bank painted
  on the model by `src/flight/bird-visual.js` (the flight frame never rolls
  on purpose; `_levelRoll` takes roll back out every frame);
- pitch is **clamped** at 80 degrees and an auto-level term pulls the nose
  to the horizon whenever speed > 0.5;
- speed is **constant**: `index.html` assigns `flight.speed` from cruise
  every frame (boost multiplies it).

Rolls and loops could never come out of those controls, so they were added
as committed moves (`src/flight/aerobatics.js`) with a stick-edge trigger,
a dwell, a wind-up and a camera hold. Each of those is a workaround for the
mapping. v2 replaces the mapping; every one of them goes.

## What v2 is

**Bank to turn, like a wing.** The standard mapping of every flight game
and every aircraft:

| input | v1 | v2 |
|---|---|---|
| stick x | yaw rate about radial up (+ cosmetic bank) | **a bank to hold** (up to 70°) reached at the roll rate; at the rail (0.94) a **roll rate** |
| stick y | pitch rate, clamped ±80° | **an elevation to hold** (up to 70°); at the rail a **pitch rate, unlimited** — the loop |
| turning | from yaw | **from the bank**: yaw rate about radial up = `turnGain * sin(bank)`, plus a small direct assist `yawAssist * x` so a thumbstick still feels responsive |
| roll with no input | levelled at 2.2 rad/s always | **self-righting toward upright** at `rightingRate` (a bird's dihedral), scaled down while the stick holds a bank; never fights a held input |
| pitch with no input | auto-level to horizon, clamp | **gentle pitch stability** toward the horizon by the shortest path, scaled down while the stick holds pitch; no clamp |
| speed | constant cruise (× boost) | **energy**: `dSpeed/dt = -G_SPEED * sin(pitch) - drag * (speed - cruise)`, clamped to `[minMul, maxMul] * cruise`. Diving gains, climbing bleeds, hands-off returns to cruise |

Angles are measured against the LOCAL radial (this is a sphere; up is
radial, never world +Y — the rule every other system here follows):
`bank = atan2(up·right, up·bodyUp)`, `pitch = asin(up·forward)`.

Inverted flight, loops, rolls, split-S, Immelmann — all emergent. The stick
commands an ATTITUDE below the rail and a RATE at it (the adversarial review
measured why: a pure rate on a thumbstick made the only sustainable bank one
below shaped 0.29, so an ordinary hard turn at raw 0.6-0.8 rolled the bird onto
its back). Push the stick part way and you hold that bank; centre it and the
wings level; pin it to the rail (0.94, the same edge the old trigger measured)
and you keep rolling. Pull part way and you hold that climb; pull to the rail
and you go over the top. The loop's radius is speed over pitch rate and nothing
else.

## Interface contract (what index.html needs from a controller)

Read `index.html` at the `new BirdFlight(` site (~9362) and every
`flight.` use (`grep -n "flight\." index.html`). v2 must be a drop-in:

- `position` (Vector3, world), `quaternion` (Quaternion, world; forward is
  local −Z, up local +Y, right local +X), `speed`, `baseSpeed`, `throttle`,
  `sphereRadius`, `sphereCenter`, `terrainHeightAt`, `birdRadius`,
  `zenMode`, `setZenMode()`, `setSpeed()`, `setThrottle()`, `reset()`,
  `getPosition()`, `tick(input, delta) -> { position, quaternion, velocity }`
  (same pre-allocated pose object pattern; `input` is `{ x, y, active }`).
- `aerobatic()`, `endAerobatic()`, `aerobaticActive` — present as no-ops /
  `false`, so the per-frame block in index.html needs no branch for them.
- **Speed ownership changes.** index.html writes `flight.speed = cruise (× boost)`
  every frame in the flying branch (search `flight.speed = boostTimer > 0`).
  For v2 that line must set `flight.cruise` (a v2 property) instead, and
  leave `flight.speed` to the energy model. Boost raises cruise; the energy
  model chases it. Grounded/falling branches still write `speed` directly
  (walking speed, resume speed) — v2 honours a direct write by treating it as
  both speed and cruise for that frame.
- `flightRecovery` knockdown/launch code copies `flight.position` /
  `pose.position` around (~11095-11163) — unchanged.

## Integration points in index.html (all behind the flag)

1. **Construction.** `const flightV2 = /[?&]flight=v2(?:&|$)/.test(location.search)`;
   `const flight = flightV2 ? new BirdFlightV2(THREE, {...same options...}) : new BirdFlight(THREE, {...})`.
   Import `BirdFlightV2` alongside `BirdFlight` (top-level `await import`
   block near line 3500; ADD `./src/flight/bird-flight-v2.js` to `sw.js`
   `CORE_ASSETS` — `BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js`
   is the oracle that catches a missing entry).
2. **Aerobatics off.** Under v2 do not construct `aerobatics`/`aeroTrigger`
   (they are `null`-guarded already) and set `_aeroWindup = 0`.
3. **Visual rig.** `bird-visual.js` banks the model by `input.x`. Under v2
   the flight frame rolls for real, so construct `BirdVisual` with
   `maxBankAngle` ≈ 0.12 rad and `maxPitchTilt` ≈ 0.08 rad (a small
   aileron/elevator lean), not 63/36 degrees, or the bird double-banks.
4. **Camera.** `BirdCamera` (`src/flight/bird-camera.js`, the LIVE rig)
   stands behind the bird along the bird's own forward — which in a loop
   swings under and around. Under v2 hold it every frame along the
   **velocity heading projected onto the tangent plane** with radial up:
   `bCam.setHold({ weight: 1, heading, distanceMul })` where `heading` is
   the tangent projection of forward, SMOOTHED (exponential, ~0.25 s) and
   frozen when the tangent component is short (|tangent| < 0.25, i.e. the
   bird is near vertical) so the frame does not flip at the top of a loop;
   `distanceMul = 1 + 0.6 * |sin(pitch)|` so a loop stays in frame. The hold
   already exists (`_hold` in bird-camera.js); no new camera code paths.
5. **Ground contact by attitude.** `checkGroundCollision` (~11142) grounds
   the bird on contact. Under v2, contact with `bodyUp·radial < 0.5` or
   `speed > 1.4 * cruise` is a CRASH: route it into the existing knockdown
   (the FALLING state `flightRecovery` already implements) instead of
   GROUNDED. Upright and slow lands as before. The nesting approach takes
   control of the bird anyway and is unaffected.
6. **Probe.** `__BIRB.flightProbe()` gains `controller: 'v1'|'v2'`, and for
   v2 `bankDeg`, `cruise`, `energy: speed / cruise`. `__BIRB.setStick(x, y)`
   already exists and drives `resolvedInput`.
7. **Flags tab.** `src/ui/boot-flags.js`: `{ key: 'flight', group: 'Flight',
   kind: 'select', options: [{value:null,label:'v1'},{value:'v2',label:'v2 (bank to turn)'}] }`
   so the A/B is one tap on the phone.

## Tuning start points (all in one `FLIGHT_V2_DEFAULTS` table; the phone decides)

> **Superseded on the same night.** The table below is the pure-rate first
> cut that the adversarial review measured and rejected (G-FLIGHT-V2, "What
> the review found"). The shipped table is `FLIGHT_V2_DEFAULTS` in
> `src/flight/bird-flight-v2.js`: `edge 0.94`, `maxBank 1.22`,
> `maxPitchHold 1.22`, `bankGain 2.0`, `pitchGain 2.0`, `turnGain 2.0`,
> `rollRate 3.5`, `pitchRate 2.1`, `yawAssist 0.35`, energy unchanged.
> `rightingRate`, `rightingSoftBank` and `pitchStability` no longer exist —
> the bank and pitch commands ARE the stability. `?v2tune=key:value` overrides
> any of them at boot.

```
rollRate      3.5 rad/s   (200°/s — a full roll in 1.8 s at full stick)
pitchRate     2.1 rad/s   (120°/s — a loop in 3 s)
turnGain      1.6 rad/s   (yaw rate at 90° bank; at 45° bank ≈ 65°/s, close to v1's 135°/s * sin? — measure)
yawAssist     0.35 rad/s  (direct yaw per unit stick, so small inputs turn without waiting for the bank)
rightingRate  1.4 rad/s   (toward upright, × (1 - |x|) so a held stick is never fought)
pitchStability 0.6 rad/s  (toward the horizon by the shortest path, × (1 - |y|))
G_SPEED       6.0 units/s² (dive gain / climb loss; at 60° down that is +5.2 units/s each second)
drag          0.9 /s      (return toward cruise)
minMul 0.55  maxMul 1.9   (of cruise; the floor keeps a vertical climb from stalling to zero)
```

Deadzone: treat |x|,|y| < 0.08 as zero for the stability scaling.

## What must NOT change

- v1 is untouched and stays the default. Every harness (`birb-walk`, the
  quality oracles, `birb-modes`) runs v1. `tests/bird-flight.test.js` stays
  green as is.
- Zero allocation in `tick()`/`update()`: scratch objects with `_` prefix.
- Parallel transport and the terrain FLOOR (`_floorAt`, `_deflectAlongTerrain`)
  are reused verbatim — copy them or share them; do not reinvent them.
- The rule "up is radial": no world +Y anywhere in v2.

## Evidence required before it can become the default

- `tests/bird-flight-v2.test.js`: a held roll passes through inverted and
  closes; bank turns the heading, opposite banks turn opposite ways; a held
  pull completes a loop and the heading is preserved; hands-off from
  inverted rights itself within 3 s and hands-off from a 60° dive levels;
  a dive gains speed and a climb loses it, both bounded; the floor holds
  through a loop under; no world-+Y dependence (same test at a pole and at
  the equator).
- `tools/birb-flight-v2.mjs`: boots `?debug=1&flight=v2&quality=amazing`,
  drives `setStick`, and asserts the same things on the live page with
  `flightProbe()` (rollFullDeg / pitchFullDeg / altitude / speed), plus a
  crash on inverted contact and a landing upright, plus zero console
  warnings. Added to `.github/workflows/browser-health.yml`.
- A contact sheet of the loop and the roll from the chase camera, then the
  phone.
