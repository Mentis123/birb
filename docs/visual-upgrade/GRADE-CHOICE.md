# Per-biome colour grade — pick one, Claude ships it

> **Evidence superseded, 10 September 2026:** the sheets and preview status
> below describe the grade wave before main's `e724235` tone-mapping fix.
> They must be regenerated on current main before choosing numerical grades.
> `docs/perf/gates/G-GRADE.md` records why the older comparisons were not
> reliable evidence of their advertised tone/exposure changes. The current
> executive direction is [../realism/README.md](../realism/README.md): retain
> Neutral as the baseline, build coherent per-biome lighting, then validate
> fresh comparisons on the primary iPhone. Historical content follows.

This is the "needs an owner on a real phone" item from
`docs/VISUAL_UPGRADE_BUILD_PLAN.md` §16.10. The grade *system* is built
(`world-shell.js`'s `grade` block per biome, wired through `index.html`'s
`applyColorGrade`/`qualitySettings`) — every biome ships at the exact same
default today (`Neutral` tone mapping, exposure `1.12`, bloom knee `0.78`).
Nothing changes until you pick something. This file is how you do that.

## 1. Look at the four sheets, on your phone

- `grade-forest.png`
- `grade-canyons.png`
- `grade-mountain.png`
- `grade-city.png`

Each sheet is one biome, 7 tiles: `current` (untouched, first), `AgX` /
`AgX brighter`, `ACES` / `ACES darker`, and one `Warm` / one `Cool` candidate
built from that biome's *own* light rig (read the caption under each tile —
it names the exact tone/exposure/multipliers used, so nothing here is a guess
you have to trust). Camera, world, bird and the sun's position are pinned
identically across every tile in a sheet — the only thing that changes
between tiles is the grade.

**R6 applies: this is not the final word.** These renders came out of a
headless Chromium (SwiftShader), not your phone's real display pipeline. A
colour is not a device claim any more than a frame time is. Use the sheets to
narrow to a favourite per biome, then sanity-check the winner live (step 3)
before it ships.

## 2. Where to look at it live (optional, but worth doing before committing)

As of this write-up, the branch with the grade system
(`claude/ultracode-sub-agents-plan-c9qmba`) is deployed at:

**https://birb-oqtjf9alx-mentis123s-projects.vercel.app/?debug=1**

(Production `birbmobile.vercel.app` does **not** have this yet — the grade
wave hasn't merged to `main`.) Preview URLs are per-commit and this branch is
still moving, so if that link 404s or looks stale, ask Claude for the current
one (`list_deployments` on the `birb` Vercel project, branch
`claude/ultracode-sub-agents-plan-c9qmba`, most recent `READY`).

**There is now an on-device panel control for this** — three-finger tap to
open the dev-quality panel, switch to the "Look" tab, and scroll to the
**Grade** section: `Tone mapping` (Neutral/AgX/ACES), `Exposure`, `Bloom
threshold`, `Next candidate` (cycles the exact 7-tile set the sheet for the
CURRENT biome shows — same names, same settings) and `Copy grade` (puts
`{biome, tone, exposure, bloomThreshold}` on the clipboard as one JSON line,
ready to paste back into a message — that is how your pick gets to Claude
without retyping numbers off the screen). Each biome's grade is independent
on the panel too: fly to a different biome and the Grade section shows THAT
biome's own setting, not whatever you left the last one on.

No keyboard needed, but the debug console still works if you'd rather drive
it that way (Safari's Web Inspector from a Mac, connected over USB):

```js
// try a candidate live, in motion, on the real biome you're looking at
__BIRB.setLighting({ tone: 'agx', exposure: 1.34 })
// or, e.g., the forest "warm" candidate from the sheet:
__BIRB.setLighting({ tone: 'neutral', exposure: 1.21, key: <see sheet caption>, rim: <see sheet caption> })
// back to shipping default any time:
__BIRB.resetOverrides()
```

This whole step is genuinely optional — the sheets alone are enough evidence
to choose from if you'd rather not fly it live.

## 3. Send back your pick, per biome

Each biome's grade is independent — mix and match freely, or leave any of
them on `current` (no change). Just name the tile, e.g.:

> forest: Warm — sunrise breaks through
> canyons: current
> mountain: AgX brighter
> city: Cool — blue hour, neon wins

Or, if you dialled it in live on the panel, paste the `Copy grade` button's
JSON line for each biome instead — either form names the same thing.

## 4. What happens next (Claude does this)

1. For each biome you changed, its exact `{ tone, exposure }` (read off the
   winning tile's caption) gets written into that biome's `grade` block in
   `src/environment/world-shell.js` (`ENVIRONMENT_VARIANTS[...].grade`).
   `DEFAULT_GRADE` itself does not move — it's the fallback for whichever
   biomes you leave on `current`.
2. **`bloomThreshold` stays at `0.78` for every candidate above** — none of
   these sheets touch it. If your winning grade makes something that's
   supposed to glow (a nest's anchor light, the sun disc, a ring) look either
   blown-out white or dead and grey, that's a bloom-knee problem, not a
   picture problem, and per CLAUDE.md's own recorded miss ("a forest ring at
   three times its brightness still lands at 0.79 against a 0.78 knee") it
   has to be *measured* for that specific tone curve, not assumed —
   `__BIRB.setBloom({view:1})` renders the bright-pass buffer directly so you
   can see exactly what does and doesn't cross the knee under the new grade.
   Flag it and Claude will re-tune that biome's `bloomThreshold` alongside
   its tone/exposure.
3. `node tools/birb-shaders.mjs`, `node tools/birb-modes.mjs`,
   `node tools/birb-quality.mjs --check all` and `npm test` all get re-run —
   a tone-mapping change forces every material to recompile, and a shader
   that fails to compile draws nothing while the page still paints, so this
   is not optional.
4. Commit, push, and — once you're happy — merge to `main` so it reaches
   `birbmobile.vercel.app`.

## Reference: how the sheets were made

`node tools/birb-lighting.mjs --grades docs/visual-upgrade` (added to the
existing tool per the brief — no second tool). One browser boot, all four
biomes; camera/world/bird pinned by snapshot+restore, sun pinned via
`setSunTime`+`setSunEnabled(false)` (the game runs a 10-minute sun cycle, so
two tiles shot a minute apart would be lit differently), tier pinned to 0 (a
comparison between two degraded frames is worthless). Re-run it any time —
it's stateless and safe to regenerate.
