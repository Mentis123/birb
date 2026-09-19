#!/usr/bin/env node
/**
 * birb-lighting.mjs — palette comparison sheets.
 *
 * The visual brief rates "tune lighting and palette on physical phones" as the
 * highest remaining payoff, and says to do it with side-by-side FIXED views.
 * That is a decision the owner has to make on real glass, but making it is
 * much easier from a set of candidates than from a blank slider.
 *
 * This holds the camera and the world completely still — one browser, one
 * world build, one bird position — and varies ONLY the lighting between
 * frames. Anything else moving between two tiles would make the comparison
 * worthless, which is why it does not re-navigate or re-seed per variant.
 *
 * Two modes, sharing every helper below (VISUAL_UPGRADE_BUILD_PLAN §16.10 asks
 * to reuse this tool, not write a second one):
 *
 *   node tools/birb-lighting.mjs --out docs/visual-upgrade/lighting.png
 *   node tools/birb-lighting.mjs --out l.png --env canyons --view nest
 *       Generic sheet, one biome, the fixed VARIANTS list below.
 *
 *   node tools/birb-lighting.mjs --grades docs/visual-upgrade
 *       The per-biome colour-grade wave: one sheet per biome (forest, canyons,
 *       mountain, city), candidates tailored to that biome's OWN light rig
 *       (world-shell.js ENVIRONMENT_VARIANTS[].lighting), all four biomes in
 *       one browser boot. Writes <dir>/grade-<biome>.png.
 */

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Candidates, each a single coherent intent rather than one slider nudged.
 * `current` must stay first and must stay untouched — a comparison without
 * the status quo in it cannot tell you whether a change is an improvement.
 *
 * The shipping default (index.html + world-shell.js DEFAULT_GRADE) is
 * NeutralToneMapping / exposure 1.12 — "current" below reflects that, not
 * the ACES this repo shipped with in an earlier session.
 */
const VARIANTS = [
  { name: 'current (Neutral 1.12)', note: 'shipped today', settings: {} },
  // Tone mapping is the cheapest cinematic lever there is: one enum, zero
  // per-frame cost, and it decides how the whole frame rolls off into
  // highlight. AgX (Three r160+) holds saturation in bright areas where ACES
  // pushes toward white; Neutral (today's default) is the flattest of the
  // three.
  { name: 'AgX', note: 'r160+ filmic, softer highlights', settings: { tone: 'agx' } },
  { name: 'AgX brighter', note: 'AgX + exposure 1.35', settings: { tone: 'agx', exposure: 1.35 } },
  { name: 'ACES', note: 'filmic, pushes highlights toward white', settings: { tone: 'aces' } },
  { name: 'deeper air', note: 'fog 0.006 to 0.0095', settings: { fog: 0.0095 } },
  { name: 'moodier', note: 'exposure 0.96, rim +50%', settings: { exposure: 0.96, rim: 0.72 } },
];

// Sun position pinned for every capture in this file. The game runs a
// ten-minute (600s) sun cycle (src/environment/sun-cycle.js) and two tiles
// shot a minute apart are lit differently, which would make the comparison
// worthless — see the module header. 150s is a quarter through the cycle:
// elevation lands roughly midway between the cycle's min/max (a readable
// mid-morning angle, not a flat noon or a near-horizon silhouette) and the
// azimuth is off dead-ahead, so the key light rakes the terrain instead of
// sitting behind the camera. Same value for every biome, so a side glance
// between sheets is also comparing like with like.
const PINNED_SUN_SECONDS = 150;

function slug(name) {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

function fmt(n) {
  return Number(n).toFixed(2);
}

/**
 * Freeze the sun at PINNED_SUN_SECONDS. setSunTime alone is not enough: the
 * key light's position/colour only gets recomputed from `seconds` on a frame
 * where the cycle is still enabled (index.html's per-frame sun block), so a
 * disable issued in the same tick as the time jump would freeze the OLD
 * position. Give it a couple of frames to actually move, then latch it.
 */
async function pinSun(page) {
  await page.evaluate((s) => window.__BIRB.setSunTime(s), PINNED_SUN_SECONDS);
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__BIRB.setSunEnabled(false));
}

/**
 * Pin the view: full quality, chosen biome, optional nest landing, bird
 * stopped, pose snapshotted, sun frozen. Shared by both modes so "what makes
 * a tile comparable" lives in exactly one place.
 */
async function pinScene(page, { env, view }, problems) {
  const ok = await page.evaluate((id) => window.__BIRB.setEnvironment(id), env);
  if (!ok) { console.error(`unknown environment: ${env}`); process.exit(2); }
  await page.waitForTimeout(1200);
  // A tone/exposure/bloomThreshold request made via setLighting (below)
  // routes through qualitySettings' PANEL request, which by design
  // (CONTRACT §7.1: "a panel request outranks the biome's own grade and
  // survives the switch") persists across the NEXT setEnvironment call too.
  // That is correct for an actual panel session; here it means biome N+1's
  // "current" tile would silently inherit biome N's last-applied exposure
  // instead of its own true default. resetOverrides() clears the requested
  // trackers and reapplies THIS biome's own grade, so every biome's sheet
  // starts from its own real shipping default, not whatever the previous
  // biome's last variant left behind.
  //
  // resetOverrides() ALSO calls adaptiveTier.unpin() (it is the same "back to
  // shipping" reset the dev panel's Resume Auto uses) — so pinTier(0) has to
  // run AFTER it, not before, or every biome past the first gets captured at
  // whatever DPR the adaptive sampler drifts to instead of full quality
  // ("Full quality, or the comparison is between two degraded frames").
  await page.evaluate(() => window.__BIRB.resetOverrides());
  await page.evaluate(() => window.__BIRB.pinTier(0));
  await pinSun(page);
  if (view === 'nest') {
    await page.evaluate(() => window.__BIRB.forceNest());
    await page.waitForFunction('window.__BIRB.stats().nesting === "nested"', null, { timeout: 20000 })
      .catch(() => problems.push(`${env}: landing never completed`));
  }
  // Pin the viewpoint by SNAPSHOT, not by asking the bird to stop. Zeroing
  // speed does not hold — the flight system rewrites it every frame — and a
  // sheet whose tiles differ by viewpoint as well as by light is worse than
  // no sheet, because the difference it shows is not the one it claims.
  await page.evaluate(() => window.__BIRB.setSprint(false));
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__BIRB.capturePose());
}

/**
 * Run one variant list against the already-pinned scene, writing one PNG per
 * tile into tileDir. Returns the tile records composeSheet() renders.
 */
async function captureVariants(page, tileDir, variants) {
  // Capture the baseline settings so each variant is applied to the same
  // starting point rather than accumulating onto the previous one.
  const baseline = await page.evaluate(() => window.__BIRB.setLighting({}));

  const tiles = [];
  for (const variant of variants) {
    await page.evaluate((b) => window.__BIRB.setLighting(b), baseline);
    await page.evaluate((s) => window.__BIRB.setLighting(s), variant.settings);
    // Put the bird back, then let the damped chase camera reconverge on it,
    // so every tile is shot from the same place.
    await page.evaluate(() => window.__BIRB.restorePose());
    await page.waitForTimeout(140);
    await page.evaluate(() => window.__BIRB.restorePose());
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__BIRB.restorePose());
    await page.waitForTimeout(220);
    const file = path.join(tileDir, `${slug(variant.name)}-${tiles.length}.png`);
    await page.screenshot({ path: file });
    const stats = await page.evaluate(() => window.__BIRB.stats());
    const qualityLabel = stats ? (stats.pinned ? `tier ${stats.tier} (pinned)` : `tier ${stats.tier} (adaptive)`) : 'unknown';
    tiles.push({ ...variant, file, qualityLabel });
    console.log(`  ${variant.name}: ${variant.note}  [quality: ${qualityLabel}]`);
  }
  return tiles;
}

/** Compose a set of already-captured tiles into one labelled sheet PNG. */
async function composeSheet(context, tiles, { title, subtitle, footer, cols = 3, tileWidth, outPath }) {
  const tileDir = path.dirname(tiles[0].file);
  const sheet = path.join(tileDir, `sheet-${Date.now()}.html`);
  fs.writeFileSync(sheet, `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#12151b;font:13px/1.45 system-ui,sans-serif;color:#dfe6f0}
    h1{font-size:15px;margin:14px 12px 2px;font-weight:600}
    p{margin:0 12px 10px;color:#8b97a8}
    .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;padding:0 12px 14px}
    figure{margin:0}
    img{width:100%;display:block;border-radius:6px;border:1px solid #2b3240}
    figcaption{padding:5px 2px 0}
    b{color:#9fd7ff}
    span{color:#8b97a8}
    footer{margin:0 12px 16px;color:#5c6b7c;font-size:12px;border-top:1px solid #232a35;padding-top:8px}
  </style>
  <h1>${title}</h1>
  <p>${subtitle}</p>
  <div class="grid">${tiles.map((t) => `<figure>
    <img src="file://${t.file}">
    <figcaption><b>${t.name}</b><br><span>${t.note}</span><br><span style="font-size:12px;color:#6b7c8a">${t.qualityLabel}</span></figcaption>
  </figure>`).join('')}</div>
  ${footer ? `<footer>${footer}</footer>` : ''}`);

  const sheetPage = await context.newPage();
  await sheetPage.setViewportSize({ width: cols * (tileWidth + 12) + 24, height: 200 });
  await sheetPage.goto('file://' + sheet, { waitUntil: 'load' });
  await sheetPage.waitForTimeout(400);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sheetPage.screenshot({ path: outPath, fullPage: true });
  await sheetPage.close();
  console.log(`sheet: ${outPath}`);
}

/**
 * Per-biome candidates, built from that biome's OWN light rig
 * (src/environment/world-shell.js ENVIRONMENT_VARIANTS[].lighting) rather
 * than one generic list — "amplify the intent already in the rig, don't
 * fight it" (task brief). `baseline` is this biome's setLighting({}) read-
 * back, so the multipliers below ride on the biome's actual authored
 * intensities instead of a number that only happens to suit one biome.
 *
 * Every biome gets: current (untouched) / AgX x2 / ACES x2 / warm / cool.
 * Warm and cool both keep tone:'neutral' (today's curve) deliberately — the
 * variable under test in those two tiles is the light BALANCE, not the tone
 * curve, so mixing the two would no longer be "a single coherent intent".
 */
function gradeCandidatesFor(biome, baseline) {
  const exp = baseline.exposure;
  const key = baseline.key;
  const rim = baseline.rim;
  const fill = baseline.fill;

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

const BIOME_LABELS = { forest: 'Forest', canyons: 'Canyons', mountain: 'Mountains', city: 'City' };

async function runGradeMode(page, context, outDir, { view, width }, problems) {
  const written = [];
  for (const env of ['forest', 'canyons', 'mountain', 'city']) {
    console.log(`-- ${env} --`);
    await pinScene(page, { env, view }, problems);
    const baseline = await page.evaluate(() => window.__BIRB.setLighting({}));
    const variants = gradeCandidatesFor(env, baseline);
    const tileDir = fs.mkdtempSync(path.join(os.tmpdir(), `birb-grade-${env}-`));
    const tiles = await captureVariants(page, tileDir, variants);
    const outPath = path.join(outDir, `grade-${env}.png`);
    await composeSheet(context, tiles, {
      title: `${BIOME_LABELS[env]} — colour-grade candidates (${view} view)`,
      subtitle: 'Same world, same camera, same bird, same frozen sun. Only the grade differs. "current" is what ships today.',
      footer: 'To pick one: tell Claude the exact tile name shown above (e.g. "canyons: AgX brighter"). See docs/visual-upgrade/GRADE-CHOICE.md for how this gets committed.',
      tileWidth: width,
      outPath,
    });
    written.push(outPath);
  }
  return written;
}

async function main() {
  const args = parseArgs(process.argv);
  const gradesDir = args.grades ? String(args.grades) : null;
  if (!args.out && !gradesDir) {
    console.error('usage: birb-lighting.mjs --out <png> [--env forest] [--view flight|nest]');
    console.error('   or: birb-lighting.mjs --grades <dir> [--view flight|nest]');
    process.exit(2);
  }
  const env = String(args.env || 'forest');
  const view = String(args.view || 'flight');
  const width = Number(args.w || 390);
  const height = Number(args.h || 620);

  const tileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birb-light-'));
  const { server, port } = await startServer(REPO_ROOT);
  const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  });
  await installCdnCache(context);

  const problems = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push('page: ' + String((e && e.message) || e)));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`, { waitUntil: 'domcontentloaded' });
  await startGame(page, 45000);

  if (gradesDir) {
    const written = await runGradeMode(page, context, path.resolve(REPO_ROOT, gradesDir), { view, width }, problems);
    await browser.close();
    server.close();
    console.log(`wrote ${written.length} sheet(s):\n  ` + written.join('\n  '));
    if (problems.length) console.error('PROBLEMS:\n  ' + problems.join('\n  '));
    process.exit(problems.length ? 1 : 0);
  }

  await pinScene(page, { env, view }, problems);
  const tiles = await captureVariants(page, tileDir, VARIANTS);
  const outPath = path.resolve(REPO_ROOT, args.out);
  await composeSheet(context, tiles, {
    title: `Lighting candidates — ${env}, ${view} view`,
    subtitle: 'Same world, same camera, same bird, same frozen sun. Only the light differs. "current" is what ships today.',
    tileWidth: width,
    outPath,
  });

  await browser.close();
  server.close();
  console.log(`lighting sheet: ${outPath}`);
  if (problems.length) console.error('PROBLEMS:\n  ' + problems.join('\n  '));
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
