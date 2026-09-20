# G-STUNT-4 — the roll axis has no ceiling

**Date:** 2026-09-20. **Build:** `v80-2026-09-20-roll-through`.
**Decision:** SHIP. Authorises rewriting three and adding three tests in the
frozen `tests/bird-flight-stunt.test.js` (manifest regenerated in this commit).

## The owner's words

> "When I bank to the left, it's like it locks up just before it goes into
> the vertical… I should be able to fly straight, push to the left, and have
> my birb rotate around, rolling to the left, and just continue to spin
> around on that axis. Push left, roll past 90, push right and roll back,
> stay neutral there and fly sideways. Then pull back and it bends me around
> to that side. I feel like there might be things we need to remove that are
> still getting in the way — triggers and animations, forcing it into a roll
> versus having it naturally continue to rotate around."

## What was in the way — one term, and it was a ceiling

Nothing scripted survives from the triggered era: `aerobatics.js` is deleted
(G-STUNT-0), the chase camera holds a continuous level heading with no event
(no wind-up, no dwell), and the model's cosmetic lean under stunt is 0.12 rad.
What remained was **`_bankSoftStep`**, the lateral stability G-STUNT-1 added
so a lazy stick would not be a slow barrel roll. It ran to `rightingLimit`
(120°) clamped at `bankSoftMax` **3.4 rad/s — more than the roll command at
any stick under 0.85** — so it was a ceiling: stick 0.8 pinned the bird at
86° and only a thumb pressed to the plastic rolled through. The input
pipeline is a raw clamp, and G-FLIGHT-V2 measured an ordinary hard push on
this stick at raw 0.6–0.8. **The owner was sitting at the ceiling.** "Locks
up just before the vertical" is that table, felt.

## How every real sim does it

DCS, X-Plane, IL-2, War Thunder (sim), KSP: the stick deflects an aileron,
which is a roll **rate** once roll damping (Clp, the largest derivative on a
wing) settles it; nothing restores bank; you hold a bank by centring; small
inputs are made fine with expo, not with an attitude hold. Arcade titles
that auto-level (Ace Combat) do it on RELEASE, never against a held stick.
The one thing none of them has is a rate that a held stick cannot beat.

## The change

`_bankSoftStep` fades out over the same band as the idle righting —
**full under 35° of bank, gone by 55°** (`rightingBand` / `rightingFade`,
one concept: the dihedral band). Below it a gentle stick still settles at a
relaxed bank, because that is what G-STUNT-1 was for; above it there is no
ceiling anywhere.

Held for 10 s, unit sim:

| stick | before (G-STUNT-1) | after |
|---|---|---|
| 0.2 | ~15° held | **19° held** |
| 0.3 | 25° held | **24° held** |
| 0.4 | ~33° held | **31° held** |
| 0.5 | 42° held | rolls: 668° swept |
| 0.7 | 69° held | rolls: 1355° swept |
| 0.8 | **86° held — the lock-up** | rolls: 1804° swept |
| 1.0 | rolls | rolls: 2961° swept |

The owner's sequence, verbatim: roll left to **112°**, release → **held 112°**
for 2 s; roll right back to **88°**, neutral → **held 88°** for 3 s; pull 0.6
for 2 s → heading swung **116°** at bank 88°, pitch 3°. Live page: rolled
past the vertical and past inverted on a held 0.7, and the release-hold and
the flat turn both pass on the real input path.

## What this trades, stated plainly

The boundary between "a turn" and "a roll" is now about **0.45** of stick,
not 0.85. G-FLIGHT-V2's refutation of v70 — "an ordinary hard turn reads
0.6–0.8 and a linear rate put the bird on its back" — is still true of the
numbers and is **no longer a defect**: the owner has asked, in those words,
for a firm stick to keep rotating. A relaxed bank is still one gentle stick
away (0.2–0.4 hold 19–31° and cost no altitude, the G-STUNT-1 relaxed-flight
section is untouched and green), and Classic is two taps away in the gear
menu. If a 0.5 thumb turns out to roll people who meant to turn, the knob is
`rightingBand`, and it is one number.

## Oracle changes (the reason this is a gate)

In the frozen `tests/bird-flight-stunt.test.js`, per site:

- REWRITTEN "an ordinary hard turn does not roll the bird over" → "a gentle
  diagonal stick is a banked turn" (0.4 diagonal holds 15–60°). Its old
  assertion (0.7 stays under 130°) contradicts the request and was removed
  knowingly — see the trade above.
- REWRITTEN "a held bank tracks the stick, gently to steeply" → tracks under
  the band (0.2/0.3/0.4 monotonic, none a roll) and a 0.6 stick rolls round.
- REWRITTEN the knife-edge entry in the lift test to roll-and-centre, since
  there is no ceiling to lean on.
- ADDED "a firm stick rolls THROUGH the vertical and keeps going" (0.7 passes
  95°, passes 170°, sweeps > 360°).
- ADDED the owner's sequence (roll past 90, hold; roll back, hold; still on
  the wing).

Mutation-tested by restoring the ceiling: **6 failures**, each naming it.
`tools/birb-stunt.mjs` gained the roll-through on the live page.
