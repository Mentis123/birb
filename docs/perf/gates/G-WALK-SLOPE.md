# G-WALK-SLOPE — the walk gate measured a hill and called it a takeoff

**Date:** 2026-09-14. **Build:** `v73-2026-09-14-walk-slope`.
**Decision:** APPLIED — `tools/birb-walk.mjs` is frozen in
`tools/oracle-manifest.txt`, and this is the R5 record of the edit.

## What happened

Browser Health's walk gate failed on the v72 tree:

```
the bird left the surface while walking: radius 105.857 -> 108.608
```

Nothing in that tree touches the grounded path. Every index.html change was
gated on `flightV2` or inert under v1 (`v2ForgetHeading` zeroes a vector);
`src/flight/aerobatics.js`'s trigger is `reset()` on every frame the bird is
not FLYING. The harness itself was unchanged.

Re-run three times on the same tree: **pass, pass, pass.**

| run | radius at grounding | walked | verdict |
|---|---|---|---|
| the failure | 105.857 | 2.45 | radius 105.857 -> 108.608 (+2.75) |
| 1 | 104.969 | 2.52 | ok |
| 2 | 104.958 | 2.63 | ok |
| 3 | 105.009 | 2.52 | ok |

The failing run LANDED 0.85 units higher than the three that passed, and then
walked uphill. The world is unseeded, so the landing spot — and the local
slope under it — differ every run.

## Why the check could not tell the difference

`check(Math.abs(afterWalk.radius - beforeWalk.radius) < 2.5, 'the bird left
the surface while walking')` measured the RAW RADIUS. On this planet the
terrain is carved down from the baseline and rolls, so a bird walking 2.5
units up a slope gains radius while never leaving the ground: a 2.75-unit
rise over 2.45 units of travel is a 48-degree slope, steep but ordinary on
carved ground. The quantity the check's own message names — "left the
surface" — is the CLEARANCE above the ground, which the harness had no way
to read: `__BIRB.birdPose()` exposed `position` and `radius` and nothing
about the terrain under them.

## The fix

1. `birdPose()` gains `aboveGround`, sampled through `sampleTerrainHeight`
   — the same function the flight floor (`_floorAt`) and the landing check
   (`checkGroundCollision`) use, so all three agree about where the ground is.
2. The walk check compares clearance before and after, tolerance 1.0 unit,
   and prints both clearance and radius so a future failure says which
   changed. It also fails loudly if `aboveGround` is absent, rather than
   passing vacuously on a build that does not report it.

Walking up any slope now holds the clearance constant; only actually leaving
the surface moves it.

## What is NOT fixed

The unseeded landing spot. `P2.1e` (a seeded world RNG) was never shipped
(G2a finding 4.2), so every browser harness in this repo lands somewhere
different each run. That is a much larger change than this gate; the fix
here removes the one place where that variance could flip a verdict, and
does not pretend to remove the variance.
