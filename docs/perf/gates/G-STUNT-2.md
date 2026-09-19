# G-STUNT-2 — a knife edge you let go of has to stay on the wing

**Date:** 2026-09-19. **Build:** `v78-2026-09-19-hold-the-bank`.
**Decision:** SHIP. Authorises adding tests to the frozen
`tests/bird-flight-stunt.test.js` (manifest regenerated in this commit).

## The owner's words

> "Stunt controls aren't quite right — if I roll 90 degrees left then put the
> stick in neutral, I should stay pitched sideways, then pulling down/'back'
> on the stick should have me basically turning around to that side… or even
> roll over 180 then 'pull back' to dive."

## What was wrong, measured

The idle righting (`_rightingStep`) ran for any bank inside `rightingLimit`
(120°), at up to 0.7 rad/s. So a knife edge with the stick released was a
knife edge for about a second and a half, and a pull that should have been a
flat turn was taken on a wing that was already rolling back to level — part
turn, part climb. Unit sim, cruise 11, pole site, `tools`-free:

| | before | after |
|---|---|---|
| roll to 88°, hands off 3 s | **‑89.6° → ‑1.2°** (levelled itself) | **‑89.6° → ‑89.6°** |
| then pull 0.5 for 1 s: heading swung | 42.0° | 43.9° |
| …pitch went | 0.0° → **+14.0°** (climbing) | 0.0° → **+0.3°** (a turn) |
| …bank after the pull | ‑74.9° (still unwinding) | ‑89.7° |
| stick 0.5 for 0.35 s (a lazy 23° tilt), hands off 3 s | → 0.0° | → 0.0° |

The inverted case ("roll over 180 then pull back to dive") already worked,
because `rightingLimit` left anything past 120° alone; it now has a test so
it cannot stop working.

## The change

`rightingBand` 0.96 rad (55°) and `rightingFade` 0.35 rad. The righting
strength is multiplied by `clamp((band − |bank|) / fade, 0, 1)`: full under
35°, zero from 55°, linear between. **Continuous in the bank — not a rail.**
Dihedral is a weak term that tidies a lazy tilt; it does not pick a
committed bank up off the wing, and a bank you put in past 55° is now a bank
you keep at any angle: knife edge, inverted, anything between.

`rightingLimit` stays, for `_bankSoftStep` only (the under-stick lateral
stability that makes stick 0.8 hold ~86° instead of rolling on).

What this costs: relaxed flight is unchanged inside the band (the G-STUNT-1
relaxed-flight section is untouched and green), and a bird left at, say,
60° now stays there and sinks at the knife-edge rate rather than tidying
itself up. That is the request.

## Oracle changes (the reason this is a gate)

Three tests ADDED per site to the frozen `tests/bird-flight-stunt.test.js`,
nothing weakened, nothing removed:

1. hands off from a KNIFE EDGE, it stays on the wing (|Δbank| < 4° over 3 s);
2. a pull at the knife edge TURNS the bird (heading > 30°, pitch within 20°,
   and toward the side the bird's own up leans to — the low wing);
3. roll over 180 then pull, and it DIVES (nose < ‑25°, altitude lost).

The 50°-bank levelling test is kept as is: at 0.35 s of half stick the bank
is 23°, inside the band, and it still levels — which is the boundary the
owner did not ask to move.

`tools/birb-stunt.mjs` is not frozen; its levelling check starts from a
23° bank and still passes.
