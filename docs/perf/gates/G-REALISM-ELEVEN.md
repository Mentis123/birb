# G-REALISM-ELEVEN — "visual realism to 11" (2026-10-19)

**Owner's direction:** "I just want visual realism to 11."

## Decision

An **Ultra boot** (the shipping default, and where Auto starts) builds every
finished realism package. Every other boot preset builds none of them unless
the URL forces one. `src/ui/realism-defaults.js` makes that call and is
unit-tested (`tests/realism-eleven.test.js`).

| Package | Flag (`=1` forces on, `=0` off) | Status before | What it does |
|---|---|---|---|
| Ambient occlusion | `?ao=` | **new** | Screen-space AO from the scene's depth texture, three half-res passes (`src/effects/ambient-occlusion.js`) |
| Eye adaptation | `?autoexp=` | opt-in since wave 3 | Exposure follows the frame within ±1.5 EV |
| Local tone mapping | `?localtm=` | opt-in since wave 3 | Exposure fusion lifts the darkest decile |
| Hex-tiled ground | `?hextile=` | opt-in since wave 2 | The forest ground map stops repeating |
| Erosion | `?erosion=` | opt-in since wave 3 | Stream-power rivers carved into forest, canyons and mountain |
| Foliage light | `?foliage=` | **new** | Leaf-clump mottling, darker crown undersides, sun THROUGH the crown edge (`addFoliageLight`, visual-style.js) |

`?realism=0` (a toggle on the Flags tab) is the Ultra before: no package is
on unless forced by its own `=1`.

**Water** changed at every preset (it is one shader, not a pass): the
reflection is a gradient (zenith `uSky`, horizon = the scene's fog colour,
the far bank below the horizon) instead of one flat colour, the fresnel is
Schlick with water's F0 instead of a curve capped at 0.55, and two short
ripple octaves near the eye break the sun into glitter. `?water=classic` is
the shader before, verbatim (`FRAG_CLASSIC` in water.js).

The post-pass stages (AO, the eye) are also switched by the LIVE preset:
`applyQualityPreset` calls `bloomPass.setRealismEnabled(preset.id ===
'ultra' || forced)`, so stepping down from Ultra (by hand or from the Auto
chip) sheds their passes at once without rebuilding anything.

## Why the frozen oracles are untouched

Every frozen harness boots `&quality=amazing` (G-ULTRA-DEFAULT). On those
boots `realismOn` is false for every package: no program, pass or texture
changes. The only edits to frozen-listed files are the manifest's own
regeneration for the NEW test file `tests/realism-eleven.test.js` (the
additive rule in oracle-manifest.txt). The Flags-tab option VALUES for
`autoexp`, `localtm`, `hextile` and `erosion` stay `[null, '1']`, which
`tests/exposure.test.js`, `tests/hex-tiling.test.js` and
`tests/erosion.test.js` pin; only their labels changed ("Ultra default" /
"On (any preset)").

The Ultra path is covered by `tools/birb-default.mjs` (passes: Ultra at its
ceiling, reversible) and `tools/birb-shaders.mjs` (boots with no flag, so it
compiles AO, the eye, foliage and the new water at Ultra).

## Measured (this sandbox, SwiftShader — not a phone)

- **Cost, Ultra, forest, 1280x720:** 3.0 s per frame with the set, 2.1 s
  with `?realism=0` (10 vs 14 frames in 30 s). +40% under software
  rendering, which counts every fragment; the phone's number is unmeasured,
  and the Auto chip (48/38 fps) is what offers the step down that sheds
  AO and the eye.
- **Boot to `__BIRB_READY`, Ultra:** 37.7 s vs 34.0 s here (erosion bake
  and more programs). CI's runner is faster; `birb-shaders.mjs`'s 30 s
  wait timed out in THIS sandbox, where the `?realism=0` boot is already at
  34 s, i.e. over it too.
- **World audit on eroded worlds:** forest / canyons / mountain at seeds
  16160, 2, 7 — all 9 PASS (`__BIRB.auditWorld()` with `?erosion=1`).
- **AO correctness** was settled on an isolated box/sphere/wall scene
  before tuning in the game. Three defects were found that way and fixed.
  1. The sky's G channel was stored as 1e5 in a HALF float target, which
     became Inf, then NaN in the blur: a black sky.
  2. Taps unprojected at their own uv with the depth of the nearest texel.
     That produced horizontal bands of false occlusion on every grazing
     hillside.
  3. A half-res centre on a full-res texel boundary could snap onto its own
     neighbour. That gave a NaN normal and a broken line down the screen.

## Measured on the owner's iPhone (2026-10-21, `?quality=ultra`)

| Link | fps |
|---|---|
| `?realism=0&water=classic` (the Ultra before) | ~40 |
| the realism set, `?ao=0` | ~40, occasional dips |
| the realism set with AO at HALF resolution (v90) | 25-30 |

So AO alone cost 10-15 fps, and Ultra itself was never at 60 on this phone:
it renders at native 3x DPR. AO moved to QUARTER resolution per axis (1/16
of the pixels) in v91. The isolated test scene shows the same contact and
crease shading, a little softer. A DPR cap for Ultra on phones (3x to 2x,
~55% fewer pixels for everything) is proposed and waits on the owner,
because native DPR at Ultra was his call (G-ULTRA-DEFAULT).

**v91 retest: 25-45 fps.** The owner, on the DPR cap: "We don't need more
resolution. It's a small screen. We need ways for it to seem more realistic
otherwise." v92 caps Ultra at 2x DPR on phones (`ULTRA_MOBILE_DPR_CAP` in
index.html; desktop keeps native). That is 44% of a 3x phone's pixels, for
every Ultra pass. `tools/birb-default.mjs` (not frozen) now expects 2x on its
emulated 3x iPhone.

## Not measured

The phone: the cost of AO, the eye and foliage on an iPhone 16 Pro, and
whether the eroded worlds' bake fits its boot.
