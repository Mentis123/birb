# G-STUNT-1 — the stunt model was not relaxing to fly, and both causes were mine

**Date:** 2026-09-19 (later the same day). **Build:** `v75-2026-09-19-stunt-feel`.
**Decision:** SHIP. Fixes the regression [G-STUNT-0](G-STUNT-0.md) introduced.

## The owner's words

> "It's like it stalls way too much when trying to fly up and it's no longer
> a fun relaxing experience."

## Two causes, both measured, both mine

### 1. The climb bleed was linear, so an ordinary climb stalled

`gSpeed` was raised from v2's 6.0 to 7.5 in G-STUNT-0 for exactly one reason:
to make a sustained vertical fall below stall so the hammerhead would exist.
It worked, and it also did this — equilibrium speed against climb angle at
`gSpeed` 7.5, `drag` 0.9, cruise 11, stall 5.5:

| climb | settles at | |
|---|---|---|
| 30° | 6.83 | |
| 40° | 5.64 | |
| **45°** | **5.11** | **STALL** |
| 60° | 3.78 | STALL |
| 90° | 2.67 | STALL |

A 45-degree climb is not a manoeuvre, it is what anybody does to gain height.
**A global parameter was tuned to make one edge-case figure reachable, and it
broke the common case** — which is the generalisable mistake here, not the
number.

The fix is shape, not magnitude: `gSpeed` 6.5 and the climb half of the term
**cubed** (`climbExp` 3.0; dives stay linear, because a dive should feel
pulled down). The penalty moves into the steep end where it belongs:

| climb | settles at | |
|---|---|---|
| 30° | 10.10 | |
| 45° | 8.45 | |
| 60° | 6.31 | |
| 70° | 5.01 | STALL |
| 90° | 3.78 | STALL |

### 2. Pitch and roll were pure rates, so neither input had a resting point

The subtler half, and the one that made it "not relaxing" rather than merely
difficult. A rate control does not hold an attitude — it keeps rotating. Held
for ten seconds, measured on the shipped build:

- **stick 0.3 up** took the bird to **90 degrees**, vertical, and it stalled
  there. Two seconds of a gentle nudge was enough.
- **stick 0.3 sideways** rolled a full **365 degrees** and shed **34 units**
  of altitude through the inverted part of the revolution. What the player
  meant as a lazy turn was a slow barrel roll.

Both axes now carry a **saturating stability term**: beyond a comfort angle
the bird is pushed back toward it, at a rate clamped so a firm input still
overpowers it. Held angles, measured:

| stick | climb | bank |
|---|---|---|
| 0.3 | 38° | 24° |
| 0.5 | 46° | 40° |
| 0.7 | 59° | 66° |
| 0.8 | over the top | 83° |
| 0.85+ | loops | rolls |

**This is not v2's rail.** v2 switched mode at a hard 0.97 threshold; this is
a saturation, continuous in the stick, with the held angle varying smoothly
all the way up. It is also what an elevator or aileron overpowering an
aircraft's own stability actually does. Both terms switch off once the bird
is committed (past the vertical for pitch, past `rightingLimit` for roll), so
a loop still closes and inverted flight is still something you hold.

The bank ceiling is deliberately 91 degrees: **a knife edge has to be a bank
you can hold, or it is not a manoeuvre.** The first value capped it at 72 and
the knife edge became unreachable — caught by a probe, not by a test.

### And a third, smaller one: everything sank all the time

`sink = gSink * (1 - lift)` with no deadband meant ANY departure from
level-at-cruise lost height: a bird at 90% of cruise sank 0.76 units/s and a
gentle 30-degree bank sank 0.54. `sinkSlack` 0.15 makes a gentle bank and a
slightly-slow bird free, while a 60-degree bank still costs 1.4, a knife edge
3.4 and inverted the full 8. The cost lands on committed attitudes and
nowhere else.

`stallRate` also came down 2.0 → 1.4: a stall the player did not ask for
should read as the nose going heavy, not as the bird being snatched away.

## The hammerhead now costs a deliberate act, and that is correct

At full power a hard pull-up is a **climb** — that is the whole fix, and there
is a test asserting it. The hammerhead is flown with the **throttle back**,
which is how one is actually flown and is exactly what the pad on the BOOST
pill is for. Measured, pull to vertical and release:

| | min speed | stalls? |
|---|---|---|
| full power | 5.67 | no |
| idle throttle | 3.85 | **yes** |

## Relaxed flight, measured over ten seconds

| input | altitude | speed | bank |
|---|---|---|---|
| hands off | 200 → 200 | 11.0 | 0° |
| gentle climb (0.4) | 200 → **246** | 8.9 | 0° |
| gentle turn (0.3) | 200 → 200 | 11.0 | 24° |
| turn + climb (0.35, 0.35) | 200 → **243** | 9.1 | 27° |

Before this change the same gentle turn lost 34 units and the same climb
stalled.

## Evidence

`tests/bird-flight-stunt.test.js` is 52 checks now, with a new **relaxed
flight** section run at both sites: an ordinary climb never stalls at any
gentle stick over ten seconds; a held up-stick settles at a climb rather than
the vertical; a gentle climb gains height; a gentle turn holds a bank without
rolling or sinking; and the bank ladder is monotonic in the stick all the way
to a knife edge. **A future tuning pass that raises the climb penalty to make
some stunt reachable has to fail these first.**

Seven existing checks were rewritten because they encoded the old law's
inputs — a 0.45 stick no longer reaches a knife edge, and 0.7 s of full pull
no longer passes the vertical. Two were made tuning-independent while being
rewritten: the roll check now measures the SWEPT angle from the controller's
own deltas instead of the bank at a fixed second, and the pitch-clamp check
measures full-circle pitch instead of an `asin` that folds at 90.

`tools/birb-stunt.mjs` is 23/23 on the live page, unchanged.

## What is NOT known

The phone, again. Every number here is the unit suite. The shape of the fix
is measured and the regression is pinned, but whether 24 degrees of bank at a
third of stick is the *right* amount is a question only flying it answers.
`?stunttune=bankSoft:3,pitchComfort:0.7` retunes any of it without a deploy.
