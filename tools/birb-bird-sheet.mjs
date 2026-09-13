#!/usr/bin/env node
/**
 * birb-bird-sheet.mjs — the bird alone.
 *
 * docs/realism/BIRD_PLAN.md: "A prop you cannot reliably photograph is a prop
 * nobody reviews." Until this tool existed the bird had only ever been
 * photographed by accident, mid-frame of something else, from whichever
 * angle the flight controller happened to be pointing. This boots ONE
 * browser, drops the bird into `__BIRB.birdStudio(true)` (world, sky,
 * weather, drones and rings hidden; a flat mid-grey background), and walks
 * it through ten fixed views — six static angles, three deterministic flap
 * phases, and one banking-chase frame — compositing them into a single
 * labelled PNG the way birb-sheet.mjs does for the whole world.
 *
 * Usage:
 *   node tools/birb-bird-sheet.mjs --out shot.png
 *   node tools/birb-bird-sheet.mjs --out shot.png --w 400 --h 400 --settle 400
 *
 * Exits non-zero on any page/console error, on a null birdStudio/orbitBird
 * result, on a birdStats() that never appears, OR on a tile whose rendered
 * pixel count falls below MIN_BIRD_PIXELS[id] — a captured PNG is not proof
 * the BIRD is what got rendered into it. This is the fix for a real defect:
 * the tool used to exit 0 on a tile that was entirely the grey studio
 * background (the race between freeze() and birdStudio() landing on the
 * wrong frame, see the comment at the studio evaluate() below), and the
 * shipped Phase-0 evidence sheet was itself one such broken draw — `back`
 * and `left-profile` both empty, `top` a stray sliver — that a summary
 * "same silhouette" read as fine because nothing checked the tiles
 * themselves. A check that only asserts birdStats() is non-null and no
 * console error proves something painted, not what.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Studio background is scene.background = 0x808080 (see birdStudio() in
// index.html) — flat mid-grey, (128,128,128). A pixel is "bird" if any
// channel departs from that by more than TOLERANCE; anti-aliased edge
// pixels sit close to the background and are deliberately excluded rather
// than counted as noise in either direction.
const STUDIO_BG = [0x80, 0x80, 0x80];
const BIRD_PIXEL_TOLERANCE = 24;

// Minimum non-background pixel count per tile, in a 460x460 capture (scales
// with --w/--h below). This is a floor, not a target: on a clean run every
// one of the ten tiles measures 16.8k-87.4k px against this floor (2026-09-13,
// after the freeze()/birdStudio() race fix below) — comfortably above it, by
// design. `edge-on-wing` looks straight down the wing's own span on purpose
// (CLAUDE.md: catches a seam IN the wing, not on its face), so it legitimately
// shows less area than the others and gets its own, lower floor; even so it
// measured 16.9k-42.3k across the same runs, still an order of magnitude
// above its floor. The floor's job is only to catch the failure mode this
// tool actually had — a tile that is the flat grey background and nothing
// else, which measures in the low hundreds or less — not to track how much
// of the frame a good bird fills. WATCHED FAILING: pushing this constant to
// 999999 (so every real tile falls "below floor") reproduces the exit-1 path
// end to end — every tile's problem line printed with its real measured
// count, and the process exited 1 — proving the assertion actually gates the
// run rather than only logging.
const DEFAULT_MIN_BIRD_PIXELS = 1500;
const MIN_BIRD_PIXELS = { 'edge-on-wing': 300 };
const REFERENCE_TILE_PX = 460 * 460;

/**
 * Minimal PNG decoder — just enough to read what Playwright's page.screenshot
 * writes (8-bit, non-interlaced, colour type 2/RGB or 6/RGBA), using only
 * Node's built-in zlib. No new dependency, and no browser round-trip:
 * a first attempt loaded each tile back into a throwaway page as an <img>
 * and read it via canvas getImageData, but Chromium treats every file://
 * document as its own opaque origin, so an about:blank loader page cannot
 * fetch a file:// image (watched failing: `img.onerror`, "image failed to
 * load") and a file:// loader page loading a DIFFERENT file:// image still
 * taints the canvas (watched failing: `SecurityError: ... tainted by
 * cross-origin data` from getImageData) — the shared CHROMIUM_ARGS this
 * tool imports from birb-shot.mjs has no `--allow-file-access-from-files`,
 * and that flag is not this tool's to add (birb-shot.mjs is a pre-existing
 * shared harness other tools also launch through). Decoding in Node instead
 * sidesteps browser same-origin rules entirely.
 */
function decodePng(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error(`${filePath}: not a PNG (bad signature)`);

  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf.readUInt8(dataStart + 8);
      colorType = buf.readUInt8(dataStart + 9);
      interlace = buf.readUInt8(dataStart + 12);
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataStart + len));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + len + 4; // skip data + CRC
  }
  if (!width || !height) throw new Error(`${filePath}: no IHDR found`);
  if (interlace !== 0) throw new Error(`${filePath}: interlaced PNGs unsupported`);
  if (bitDepth !== 8) throw new Error(`${filePath}: only 8-bit PNGs supported (got ${bitDepth})`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`${filePath}: unsupported PNG colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = channels; // bytes per pixel at 8-bit depth
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * stride;
    const prevRowStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const raw8 = raw[rawOffset + x];
      const a = x >= bpp ? pixels[rowStart + x - bpp] : 0;
      const b = y > 0 ? pixels[prevRowStart + x] : 0;
      const c = (y > 0 && x >= bpp) ? pixels[prevRowStart + x - bpp] : 0;
      let value;
      switch (filterType) {
        case 0: value = raw8; break;
        case 1: value = raw8 + a; break;
        case 2: value = raw8 + b; break;
        case 3: value = raw8 + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          value = raw8 + pred;
          break;
        }
        default: throw new Error(`${filePath}: unsupported PNG filter type ${filterType}`);
      }
      pixels[rowStart + x] = value & 0xff;
    }
    rawOffset += stride;
  }
  return { width, height, channels, pixels };
}

/**
 * Counts pixels in a saved tile PNG that depart from the flat studio
 * background by more than BIRD_PIXEL_TOLERANCE in any channel.
 */
function countBirdPixels(filePath) {
  const { width, height, channels, pixels } = decodePng(filePath);
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
    if (
      Math.abs(r - STUDIO_BG[0]) > BIRD_PIXEL_TOLERANCE ||
      Math.abs(g - STUDIO_BG[1]) > BIRD_PIXEL_TOLERANCE ||
      Math.abs(b - STUDIO_BG[2]) > BIRD_PIXEL_TOLERANCE
    ) {
      count += 1;
    }
  }
  return { count, width, height };
}

// Bird-relative azimuth/elevation for __BIRB.orbitBird(az, el, dist), radians.
// az=0 sits directly behind the bird looking at its back (its own chase
// framing); +az sweeps toward one side. See orbitBird's own comment in
// index.html for the exact basis (local +X nose, +Y up).
const ANGLES = [
  { id: 'front', az: Math.PI, el: 0, dist: 3.2 },
  { id: 'back', az: 0, el: 0, dist: 3.2 },
  { id: 'left-profile', az: -Math.PI / 2, el: 0, dist: 3.2 },
  { id: 'top', az: 0, el: Math.PI / 2, dist: 3.4 },
  // Three-quarter rear IS the chase view: behind, above and a little to one
  // side, matching the horizon-derived pitch the real follow camera uses
  // (CLAUDE.md, 2026-09-06: "the perch camera rests at a horizon-derived
  // pitch, not level"). Reused below for the flap and banking frames because
  // the rig contract's whole point is that the chase camera is the bird's
  // only customer.
  { id: 'three-quarter-rear-chase', az: Math.PI / 4, el: 0.35, dist: 4.2 },
  // "Edge-on to the wing": close along the wing's own span axis, so the
  // plate reads as a thin line rather than the broad top surface `top`
  // already shows above. This is the view that catches a seam or a hole IN
  // the wing rather than on its face.
  { id: 'edge-on-wing', az: Math.PI / 2, el: -0.08, dist: 1.9 },
];

const CHASE = ANGLES.find((a) => a.id === 'three-quarter-rear-chase');

// wingBeat(phase01) in src/flight/bird-pose.js: 0 is the top of the
// downstroke (wings raised, about to dive), ~0.19 is the deepest point of
// the downstroke, and anything past 0.38 is the slower recovery draw-in.
const FLAP_FRAMES = [
  { id: 'flap-top-of-stroke', phase: 0 },
  { id: 'flap-mid-downstroke', phase: 0.19 },
  { id: 'flap-recovery', phase: 0.7 },
];

async function main() {
  const args = parseArgs(process.argv);
  if (!args.out) {
    console.error('usage: birb-bird-sheet.mjs --out <png> [--w 460] [--h 460] [--settle 260]');
    process.exit(2);
  }
  const width = Number(args.w || 460);
  const height = Number(args.h || 460);
  const dpr = Number(args.dpr || 1);
  const settle = Number(args.settle || 260);
  const readyTimeout = Number(args.wait || 45000);

  const tileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birb-bird-sheet-'));
  const { server, port } = await startServer(REPO_ROOT);
  const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
  // Desktop context on purpose: the touch joystick and boost pill are page
  // overlays with nothing to do with the bird model, and only clutter a
  // studio shot meant to be reviewed for seams and dropped parts.
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    reducedMotion: 'no-preference',
  });
  await installCdnCache(context);

  const problems = [];
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('page: ' + String((e && e.message) || e)));

  // --query passthrough (docs/realism/BIRD_PLAN.md Phase 1): lets a caller
  // A/B the flagged v2 bird (`--query bird=v2`) through this same harness
  // instead of a second, drifting copy of it. Stripped of leading ?/& the
  // same way birb-shot.mjs's own --query does, and for the same reason —
  // baking it into a path instead would double the `?` and silently strand
  // the flag outside the query string entirely.
  const extraQuery = String(args.query === true ? '' : (args.query || '')).replace(/^[?&]+/, '');
  await page.goto(
    `http://127.0.0.1:${port}/index.html?debug=1${extraQuery ? '&' + extraQuery : ''}`,
    { waitUntil: 'domcontentloaded' },
  );
  await startGame(page, readyTimeout);

  // Determinism: pin quality, kill the day/night cycle, stop the bird's own
  // flight, and enter the studio — ALL IN ONE page.evaluate, not split across
  // round trips. freeze() alone does not hold the bird still (its own doc
  // comment says the flight system rewrites speed every frame); it is
  // birdStudio(true) latching that suppresses that rewrite (index.html,
  // search __birbStudioSaved). Two separate evaluate() calls gave the render
  // loop frames to run BETWEEN them, and on whichever frame landed there the
  // bird was still flying at full cruise speed when birdStudio(true) then
  // locked that speed in for the rest of the capture — verified (adversarial
  // review, 2026-09-13): 1 of 6 trials of `freeze` then `birdStudio` in two
  // round trips moved the bird 8.9 units before the guard took; 0 of 6 moved
  // with both calls in one evaluate(). birdStudio(true) itself now also
  // zeros flight.speed/boostTimer when it latches (belt + suspenders — see
  // its comment in index.html), so this fix holds even if a future caller
  // still splits the calls.
  const studio = await page.evaluate(() => {
    window.__BIRB.pinTier(0);
    window.__BIRB.setSunEnabled(false);
    window.__BIRB.setSunTime(0.35);
    // Bloom's light-shaft term radiates from the sun's SCREEN-SPACE position
    // regardless of setSunEnabled(false) (that only hides the disc), so a
    // studio shot looking anywhere near the sun renders a visible radial
    // burst across the "neutral" background. It has nothing to do with the
    // bird, so it is off for this tool, not tuned around.
    window.__BIRB.setBloom({ enabled: false });
    window.__BIRB.freeze(true);
    return window.__BIRB.birdStudio(true);
  });
  if (!studio || studio.applied !== true) problems.push(`birdStudio(true) returned ${JSON.stringify(studio)}`);
  else console.log('  birdStudio:', JSON.stringify(studio));

  const tiles = [];
  // Scale each tile's pixel floor by its actual capture area vs the
  // 460x460 reference the floors above were measured against, so --w/--h
  // (and --dpr) don't silently loosen or tighten the gate.
  const tileAreaScale = (width * dpr * height * dpr) / REFERENCE_TILE_PX;

  async function captureTile(id, setup) {
    await setup();
    await page.waitForTimeout(settle);
    const stats = await page.evaluate(() => window.__BIRB.birdStats());
    if (!stats) problems.push(`${id}: birdStats() returned null — bird anchor missing?`);
    const file = path.join(tileDir, `${id}.png`);
    await page.screenshot({ path: file });
    const pixels = countBirdPixels(file);
    const floor = Math.round((MIN_BIRD_PIXELS[id] ?? DEFAULT_MIN_BIRD_PIXELS) * tileAreaScale);
    if (pixels.count < floor) {
      problems.push(
        `${id}: only ${pixels.count} non-background px (floor ${floor}) — tile looks empty/near-empty, not a bird`,
      );
    }
    tiles.push({ file, label: id, stats, pixels });
    console.log(
      `  ${id}: ${stats ? `${stats.drawCalls} calls, ${stats.triangles} tris` : 'NO STATS'}` +
      `, ${pixels.count}px (floor ${floor})`,
    );
  }

  for (const a of ANGLES) {
    await captureTile(a.id, async () => {
      const pose = await page.evaluate((angle) => window.__BIRB.orbitBird(angle.az, angle.el, angle.dist), a);
      if (!pose) problems.push(`${a.id}: orbitBird() returned null`);
    });
  }

  for (const f of FLAP_FRAMES) {
    await captureTile(f.id, async () => {
      const forced = await page.evaluate((phase) => window.__BIRB.flapPhase(phase), f.phase);
      if (forced === null) problems.push(`${f.id}: flapPhase() did not take`);
      const pose = await page.evaluate((angle) => window.__BIRB.orbitBird(angle.az, angle.el, angle.dist), CHASE);
      if (!pose) problems.push(`${f.id}: orbitBird() returned null`);
    });
  }
  await page.evaluate(() => window.__BIRB.flapPhase(null));

  await captureTile('bank-chase', async () => {
    // A strong yaw input drives the banking wing-dip (index.html's wing rig,
    // "Left turn (negative yaw): left wing dips down..."); freeze() already
    // zeroed the stick override, so this has to come after it.
    await page.evaluate(() => window.__BIRB.setStick(0.85, 0));
    const pose = await page.evaluate((angle) => window.__BIRB.orbitBird(angle.az, angle.el, angle.dist), CHASE);
    if (!pose) problems.push('bank-chase: orbitBird() returned null');
  });
  await page.evaluate(() => window.__BIRB.setStick(null));

  // Composite by rendering the tiles into a grid page and shooting that —
  // same approach as birb-sheet.mjs, no image library needed and the labels
  // come out as real text.
  const cols = Math.min(4, tiles.length);
  const sheet = path.join(tileDir, 'sheet.html');
  fs.writeFileSync(sheet, `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#12151b;font:13px/1.4 system-ui,sans-serif;color:#dfe6f0}
    .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;padding:12px}
    figure{margin:0}
    img{width:100%;display:block;border-radius:6px;border:1px solid #2b3240;background:#808080}
    figcaption{padding:5px 2px 0;font-variant-numeric:tabular-nums}
    b{color:#9fd7ff;font-weight:600}
    span{color:#8b97a8}
  </style><div class="grid">${tiles.map((t) => `<figure>
    <img src="file://${t.file}">
    <figcaption><b>${t.label}</b><br><span>${t.stats ? `${t.stats.drawCalls} calls · ${(t.stats.triangles / 1000).toFixed(2)}k tris` : 'NO STATS'} · ${t.pixels.count}px</span></figcaption>
  </figure>`).join('')}</div>`);

  const sheetPage = await context.newPage();
  await sheetPage.setViewportSize({ width: cols * (width + 12) + 12, height: 100 });
  await sheetPage.goto('file://' + sheet, { waitUntil: 'load' });
  await sheetPage.waitForTimeout(400);
  const outPath = path.resolve(REPO_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sheetPage.screenshot({ path: outPath, fullPage: true });

  await browser.close();
  server.close();

  console.log(`sheet: ${outPath}  (${tiles.length} views)`);
  if (problems.length) console.error('PROBLEMS:\n  ' + problems.join('\n  '));
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
