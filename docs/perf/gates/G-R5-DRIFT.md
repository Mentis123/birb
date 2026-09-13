# G-R5-DRIFT — two frozen oracles drifted, and the regeneration step could drop seven more

**Status: DECIDED and APPLIED.** Both drifted files are blessed and the manifest
is regenerated. The regeneration step itself was the larger finding and is now a
script with tests.

Raised 2026-09-13 during the pre-merge sweep for `54332ef`, when
`sha256sum -c tools/oracle-manifest.txt` exited 1.

## What was red

```
tests/bird-pose.test.js: FAILED
tools/birb-shot.mjs: FAILED
sha256sum: WARNING: 2 computed checksums did NOT match
```

Neither was touched by the commit being prepared. Both drifted earlier on this
branch — `8aac774` (the wing twist and lagging hand) and `1c810b7` (`--query`,
and the two harness flakes that turned out to be clocks) — and shipped without
the manifest being consulted. R5 says implementers must not edit these files, so
the drift needed a decision, not a quiet re-hash.

The manifest's header claimed it was generated at `63959d6`. It was not: it has
been regenerated three times since (`9888147`, `a77fb36`, `f3a362c`, `1ae2e66`,
`e724235`), and the provenance line was never updated. **`e724235` is the real
baseline** and every diff below is measured from it.

## Finding 1 — `tests/bird-pose.test.js`: additive, blessed

```
 tests/bird-pose.test.js | 82 +++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 82 insertions(+)
```

**Zero deletions. Not one existing line changed.** Five tests were appended for
fields the wing rig grew (`twist`, `handAngle`):

- the wing twists, and the twist leads the sweep rather than tracking it
- pronation on the downstroke, supination on the recovery
- twist is bounded — a wing that rotates past a right angle is a propeller
- the hand LAGS the shoulder, which is the whole point of having one
- every beat field stays finite and periodic, including the new ones

This is the case R5 explicitly permits. No assertion was weakened; the file got
strictly harder to pass. **Blessed.**

## Finding 2 — `tools/birb-shot.mjs`: one relaxed timeout, and it still fails

Two changes. The first is purely additive (`--query`, so a flagged path stays
scriptable instead of being smuggled through `--page index.html?bark=1`, which
appends a second `?` and leaves `__BIRB` undefined while the flag's own regex
still matches).

The second is the one that needed arguing, because it **relaxes** a bound:

```js
-    await page.click('[data-title-start]', { timeout: 5000 });
+    await page.click('[data-title-start]', { timeout });
```

Relaxing a timeout is exactly the shape of "fix the assertion, not the defect".
It is not that here, on three grounds, the third measured:

1. **The old value produced false reds, not true ones.** `birb-quality.mjs`
   failed roughly one run in three with a TimeoutError and **zero assertions
   run** — a red that reads like a product regression and carries no evidence
   either way. Measured: the click handler itself is 2.6 ms, so there is no
   hitch under the player's thumb; the two frames after it cost 2.1 s compiling
   the world's shaders under SwiftShader, and Playwright's action budget covers
   the page settling around a click, not just its dispatch.
2. **It is still bounded.** `timeout` defaults to 30000 and every wait in
   `startGame` shares it, including the `deadline` on the splash loop and the
   `elapsed > 0.5` frame-advance check that is the actual "the game started"
   gate. That check was not touched.
3. **Mutation-tested.** Making the start button unclickable
   (`pointerEvents = 'none'` immediately before the click) still fails:

   | mutation | `--wait` | exit | elapsed |
   |---|---|---|---|
   | start button unclickable | 20000 | **1** | 28 s |

   The relaxed budget makes a genuine hang a *slower* red, not an absent one.
   That is the line between relaxing a flaky harness bound and deleting
   evidence. **Blessed.**

## Finding 3 — the regeneration command had fallen seven oracles behind

This is the one worth keeping. The manifest documented its own regeneration as:

```sh
cd /path/to/birb && { find tests -type f | sort; \
  printf '%s\n' tools/birb-shot.mjs tools/birb-sheet.mjs tools/birb-lighting.mjs \
                tools/birb-modes.mjs tools/birb-shaders.mjs docs/perf/CONTRACT.md; \
} | xargs sha256sum
```

Six non-tests paths, written out by hand. Later waves added **seven more** to the
manifest and nobody updated that `printf`. Running the documented command as
written would have silently unfrozen:

| dropped | what it guards |
|---|---|
| `tools/lib/quality-captures.mjs` | **the file `G-A5-DRIFT` is blocked on** |
| `tools/lib/quality-assertions.mjs` | the A1–A12 assertions themselves |
| `tools/birb-quality.mjs` | the quality board's driver |
| `tools/req-verify.mjs` | the requirement register's semantic guard |
| `docs/perf/EXPECTED-RED.md` | the superseded RED manifest |
| `docs/perf/ASSERTIONS.md` | the assertion register |
| `src/environment/seeded-random.js` | the seeded generator |

It would have landed as a diff that looks exactly like a routine re-hash. **That
is this manifest's own failure mode, displaced one level up: an oracle deleted
rather than a defect fixed.** A guard whose documented maintenance procedure
quietly disarms it is worse than no guard, because it is trusted.

Separately, **45 of 90 files under `tests/` were pinned to nothing at all** —
only the tests that existed when the manifest was first written were ever
listed, so half the suite could be rewritten without a whisper.

## What was applied

- **`tools/oracle-manifest-regen.mjs`** replaces the shell one-liner. It is
  ADDITIVE by construction: it re-hashes exactly the paths already listed and
  keeps them in their existing sections, adds any `tests/**` file nothing pins
  yet, preserves every comment and section header byte for byte, and treats a
  listed-but-absent path as a **hard error**. Deleting an oracle now has to be
  deliberate — remove the line by hand, in the commit that removes the file.
  `--check` exits 1 if the manifest is stale, for CI.
- **The manifest**: regenerated additively, 58 → 104 paths. Nothing dropped; the
  45 unpinned test files and the new `tests/oracle-manifest.test.js` are in.
  The header now points at the script and records why the old command is gone.
- **The provenance line** is derived from `HEAD` and is a single line, so it
  cannot go stale silently again. It is now `54332ef`, not `63959d6`.
- **`tests/oracle-manifest.test.js`** — six tests pinning the properties above:
  the committed manifest is current, regeneration is idempotent and additive,
  the seven near-dropped oracles are listed, a vanished path throws, and every
  `tests/**` file on disk is pinned.

### Two bugs found while writing the script

The provenance line is self-referential. It records the head the regeneration
ran at, which is by construction the commit *before* the one the manifest
lands in — so a `--check` that compared it byte for byte would go red on the
very next commit and stay red. `withoutProvenance()` masks that one line for
the comparison; the hashes are what is checked. Verified by rewriting the SHA
to `deadbee` and confirming `--check` still exits 0.



The first provenance replace matched the explanatory lines under `# Generated`
with `(?:\n#.*)*` and re-appended the note's last line on every run, so the
script was not idempotent and the manifest grew a line per regeneration. Caught
by running it twice — which is why "regeneration is idempotent" is one of the
six tests, and why provenance is one line with the prose kept in static header
text no regex touches.

## Verification

| check | result |
|---|---|
| `sha256sum -c tools/oracle-manifest.txt` | exit **0** |
| `node tools/oracle-manifest-regen.mjs --check` | exit **0** |
| `node --test tests/oracle-manifest.test.js` | 6 pass / 0 fail |
| drop-guard mutation (delete a pinned oracle) | exit **1**, names the file, manifest unmodified |
| harness mutation (unclickable start button) | exit **1** in 28 s |
