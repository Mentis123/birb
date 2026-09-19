# G-TUCK — re-hashing a frozen oracle to ADD assertions to it

**Date:** 2026-09-13
**Oracle touched:** `tests/bird-pose.test.js` (listed under R5 in `tools/oracle-manifest.txt`)
**Verdict:** re-hash approved. No assertion was weakened or removed.

## Why this needs a decision at all

R5 freezes the oracles so that a later wave cannot "fix" a failing check by
editing the check. `tests/bird-pose.test.js` is on that list, and this change
edits it — so the manifest goes red, which is the manifest working. A re-hash
is only legitimate if the edit strengthens the oracle. Here is the whole diff,
so that claim can be checked rather than taken:

### Kept, byte for byte

```js
assert.ok(perched.fold > 0.5, 'wings must actually fold');
assert.ok(perched.span < 0.7, 'wings must pull in, not just rotate');
assert.ok(perched.tailPitch > 0 && perched.tailSpread < 1);
```

`perchPose(1).fold` moves from 0.95 to 0.70 in this change and still satisfies
the pre-existing bound. Nothing about the existing test was relaxed to let the
new value through — that is the one thing this gate exists to rule out.

### Added

1. A new test pinning the `sweep` term: zero when flying, in `(0.4, 0.7)` when
   perched, with `fold` held in `(0.4, 0.9)` beside it. The band is two-sided
   on purpose. A one-sided `sweep > 0.4` would let a future tune trade all of
   the fold away for sweep, and the capture that produced these numbers shows
   that failing: past about 0.7 rad the wing points astern rather than lying
   along the body and the tuck reads WIDER than no tuck at all.
2. `assert.ok(current.sweep >= previous.sweep)` added to the existing
   monotonicity loop, so the new term cannot jitter mid-landing either.

Net: 23 assertions in the file, up from 20. Every previous bound still holds.

## The measurement behind the numbers

Four fixed-pose captures of the grounded bird (profile, rear-quarter, back),
studio background, tier 0, sun pinned:

| fold | sweep | what the capture shows |
|------|-------|------------------------|
| 0.95 | 0.00  | wing plate hangs below the belly line; rear view is two thin blades either side of the body |
| 0.95 | 0.50  | tighter, but the wing still reads as a separate blade behind the flank |
| **0.70** | **0.65** | **wing absorbed into the body silhouette from every angle; primaries trail past the tail** |
| 0.50 | 0.80  | swings back OUT — the wing is pointing astern, and the back view is wide again |
| 0.30 | 0.60  | barely folded; wings clearly out to the sides |

A fifth variant with the fold applied in the opposite direction (wings raised
rather than dropped) was captured and rejected: it reads as a startled flare,
not a tuck.

## Live guard

`tools/birb-walk.mjs` asserts the pose on the real page — fold delta, sweep
delta, mirror symmetry of the sweep, span pull-in — so the unit test and the
rig cannot drift apart. It runs in Browser Health.
