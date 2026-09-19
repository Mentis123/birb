/**
 * src/environment/grade-candidates.js — the per-biome colour-grade
 * candidate GENERATOR, shared between the offline sheet tool
 * (`tools/birb-lighting.mjs --grades`) and the live workbench's "Next
 * candidate" control (`src/ui/dev-quality-panel.js`, wired in index.html).
 *
 * VISUAL_UPGRADE_BUILD_PLAN §16.10's own instruction is "reuse
 * tools/birb-lighting.mjs, don't write a second [sheet] tool" — this module
 * is not that tool and does not replace it. `tools/birb-lighting.mjs` still
 * owns the browser automation, the sheet composition and its own copy of
 * `gradeCandidatesFor` (it is on `tools/oracle-manifest.txt` — this file does
 * not import it, and it does not import this file). What lives here is the
 * pure candidate-GENERATING function, ported so the live panel can offer the
 * exact same named set the sheet renders without a browser bundle ever
 * reaching for `playwright`/`fs`/`path` (the sheet tool's own imports, which
 * do not resolve outside Node).
 *
 * `gradeCandidatesFor(biome, baseline)` is a pure function: given the
 * biome's OWN current lighting numbers (exposure/key/rim/fill — the same
 * shape a lighting snapshot / `__BIRB.setLighting({})` returns), it produces
 * candidates that amplify or contrast that biome's OWN rig rather than
 * applying one generic recipe to four different light rigs. Every biome
 * gets: current (untouched) / AgX / AgX brighter / ACES / ACES darker / a
 * warm intent / a cool intent — see the per-biome branches below for the
 * reasoning, cited against world-shell.js ENVIRONMENT_VARIANTS' actual hex
 * values (warm/cool amplifies the rig's own bias where one exists; where it
 * doesn't, that direction is the deliberate CONTRAST candidate instead).
 *
 * `tests/grade-candidates.test.js` extracts `tools/birb-lighting.mjs`'s own
 * copy of this function (by source, without importing that file — it pulls
 * in `playwright`, which is not always installed) and diffs its output
 * against this one for a set of sample biomes/baselines, so the two cannot
 * silently drift apart.
 */

/** Two-decimal formatting for the candidate `note` strings — matches the
 * sheet tool's own `fmt()` so a note reads identically in both places. */
export function fmtGradeNumber(n) {
  return Number(n).toFixed(2);
}

export function gradeCandidatesFor(biome, baseline) {
  const exp = baseline.exposure;
  const key = baseline.key;
  const rim = baseline.rim;
  const fill = baseline.fill;
  const fmt = fmtGradeNumber;

  const common = [
    { name: 'current (Neutral 1.12)', note: 'shipped today, untouched', settings: {} },
    { name: 'AgX', note: `tone agx, exposure ${fmt(exp)}`, settings: { tone: 'agx' } },
    { name: 'AgX brighter', note: `tone agx, exposure ${fmt(exp * 1.2)}`, settings: { tone: 'agx', exposure: exp * 1.2 } },
    { name: 'ACES', note: `tone aces, exposure ${fmt(exp)}`, settings: { tone: 'aces' } },
    { name: 'ACES darker', note: `tone aces, exposure ${fmt(exp * 0.85)} (ACES pushes highlights toward white; pulled back to compensate)`, settings: { tone: 'aces', exposure: exp * 0.85 } },
  ];

  // Warm/cool intent per biome, read off its own rig colours (comments cite
  // the hex from world-shell.js so the reasoning can be checked against it):
  let warm;
  let cool;
  if (biome === 'forest') {
    // Cool dawn: key 0xffdfab (warm gold) piercing a rig that is otherwise
    // blue (ambient 0xd4f1ff, rim 0x78b6ff, fill 0x9fc8ff, glow 0x63d0ff).
    warm = {
      name: 'Warm — sunrise breaks through',
      note: `key ×1.2, rim ×0.75, exposure ${fmt(exp * 1.08)} — the gold wins over the blue chill`,
      settings: { tone: 'neutral', exposure: exp * 1.08, key: key * 1.2, rim: rim * 0.75 },
    };
    cool = {
      name: 'Cool — misty blue dawn',
      note: `key ×0.8, rim ×1.35, fill ×1.2, exposure ${fmt(exp * 0.94)} — lean into the existing chill`,
      settings: { tone: 'neutral', exposure: exp * 0.94, key: key * 0.8, rim: rim * 1.35, fill: fill * 1.2 },
    };
  } else if (biome === 'canyons') {
    // Hot: nearly every light in the rig is already warm (key 0xffbe85, rim
    // 0xff7f4f, fill 0xffc9a4, ambient 0xffd5b0, glow 0xffa05e) — there is no
    // cool light source to lean on, so "cool" here is the deliberate
    // contrast candidate (shade falling over the rock), not an amplification.
    warm = {
      name: 'Warm — midday furnace',
      note: `key ×1.15, rim ×1.2, exposure ${fmt(exp * 1.1)} — amplifies the rig's own heat`,
      settings: { tone: 'neutral', exposure: exp * 1.1, key: key * 1.15, rim: rim * 1.2 },
    };
    cool = {
      name: 'Cool — canyon shade',
      note: `key ×0.75, rim ×0.8, exposure ${fmt(exp * 0.9)}, cold sky-bounce added — the contrast candidate; the rig has no cool light of its own`,
      settings: { tone: 'neutral', exposure: exp * 0.9, key: key * 0.75, rim: rim * 0.8, hemiSky: 0x8fb3d6 },
    };
  } else if (biome === 'mountain') {
    // Pale and cold already (key 0xeaf4ff, rim 0x81c5ff, fill 0x99c9ff,
    // ambient 0xa9cdf0, glow 0x88d1ff) — "cool" amplifies that; "warm" is the
    // contrast candidate (alpenglow), since the rig has no warm source.
    warm = {
      name: 'Warm — alpenglow',
      note: `key ×1.25, rim ×0.8, exposure ${fmt(exp * 1.12)}, warm sky-bounce added — the contrast candidate`,
      settings: { tone: 'neutral', exposure: exp * 1.12, key: key * 1.25, rim: rim * 0.8, hemiSky: 0xf1ddc0 },
    };
    cool = {
      name: 'Cool — deeper glacier',
      note: `rim ×1.3, fill ×1.15, exposure ${fmt(exp * 0.92)} — amplifies the rig's own cold blue shadow`,
      settings: { tone: 'neutral', exposure: exp * 0.92, rim: rim * 1.3, fill: fill * 1.15 },
    };
  } else {
    // city — dusk: key 0xf0e2d8 (warmish) against a neon-blue rim/fill/glow
    // (0x4fb7ff / 0x9bd5ff / 0x7fd8ff). Both directions already exist in the
    // rig — warm amplifies the fading daylight, cool amplifies the neon.
    warm = {
      name: 'Warm — golden hour',
      note: `key ×1.25, rim ×0.7, exposure ${fmt(exp * 1.08)} — daylight still winning over the neon`,
      settings: { tone: 'neutral', exposure: exp * 1.08, key: key * 1.25, rim: rim * 0.7 },
    };
    cool = {
      name: 'Cool — blue hour, neon wins',
      note: `key ×0.75, rim ×1.35, fill ×1.15, exposure ${fmt(exp * 0.94)}`,
      settings: { tone: 'neutral', exposure: exp * 0.94, key: key * 0.75, rim: rim * 1.35, fill: fill * 1.15 },
    };
  }

  return [...common, warm, cool];
}
