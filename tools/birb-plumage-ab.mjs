#!/usr/bin/env node
/**
 * birb-plumage-ab.mjs — the bird, twice, at the SAME pose: the A/B the
 * physical plumage (src/flight/plumage.js) was tuned and judged on.
 *
 * tools/birb-bird-sheet.mjs is the sheet for LOOKING at the bird, and it is
 * not an A/B: two of its runs photograph two different birds. Its pose is
 * whatever the flight model left at freeze, the stunt model sinks and can
 * land the bird mid-sheet, and the idle flap rig runs its own cadence — so a
 * plumage=0 run against a plumage=0 run measured up to 35% apart in mean
 * luminance per tile and 49 degrees apart in hue (2026-09-23). A difference
 * you cannot separate from your own control is not a measurement.
 *
 * So this boots each side with `flight=classic` (no sink), teleports to one
 * fixed place, restores one fixed quaternion, freezes, pins the tier, the sun
 * time, bloom off and the flap phase, then walks the same views the bird sheet
 * uses. Each run's tiles go to <out>/<label>/, and the table is measured over
 * ONE mask per view — the union of every run's non-grey pixels, UI overlays
 * excluded — so a shading change cannot move pixels in and out of the set it
 * is measured on. The control is a second boot of side A.
 *
 *   node tools/birb-plumage-ab.mjs --out shots/plumage          # A=plumage=0, B=default, A2 control
 *   node tools/birb-plumage-ab.mjs --out d --a "plumage=0" --b "" --env canyons
 *   node tools/birb-plumage-ab.mjs --out d --set '{"vane":{"roughness":0.5}}'   # tune B live
 *
 * Exits 1 on a page/console error or warning, or on a tile with no bird in it.
 * Needs: npm install --no-save playwright https-proxy-agent
 *        git checkout -- node_modules/three/index.js
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';
import { decodePng, encodePng } from './lib/asset-analysis.mjs';
import { levelQuat } from './birb-realism.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The bird sheet's own views (tools/birb-bird-sheet.mjs), plus the chase
// stand-off from both rear quarters — the only angle the game shows it from.
export const VIEWS = [
  { id: 'front', az: Math.PI, el: 0, dist: 3.2 },
  { id: 'back', az: 0, el: 0, dist: 3.2 },
  { id: 'left-profile', az: -Math.PI / 2, el: 0, dist: 3.2 },
  { id: 'top', az: 0, el: Math.PI / 2, dist: 3.4 },
  { id: 'three-quarter-rear-chase', az: Math.PI / 4, el: 0.35, dist: 4.2 },
  { id: 'chase-left', az: -Math.PI / 4, el: 0.35, dist: 4.2 },
  { id: 'chase-high', az: 0.2, el: 0.6, dist: 4.2 },
  { id: 'edge-on-wing', az: Math.PI / 2, el: -0.08, dist: 1.9 },
  { id: 'below', az: 0.3, el: -0.7, dist: 3.4 },
  { id: 'flap-top-of-stroke', az: Math.PI / 4, el: 0.35, dist: 4.2, phase: 0 },
  { id: 'flap-mid-downstroke', az: Math.PI / 4, el: 0.35, dist: 4.2, phase: 0.19 },
];
// `--world`: the same pinned pose with the world, the sky and the lights the
// game actually renders around the bird — for LOOKING at it in context. The
// studio's flat grey is what makes the table above measurable; it is not what
// a player sees behind a reflective bird.
export const WORLD_VIEWS = [
  { id: 'world-chase', az: Math.PI / 4, el: 0.35, dist: 4.2 },
  { id: 'world-chase-left', az: -Math.PI / 4, el: 0.35, dist: 4.2 },
  { id: 'world-chase-high', az: 0.2, el: 0.6, dist: 4.2 },
  { id: 'world-profile', az: -Math.PI / 2, el: 0.12, dist: 3.2 },
];
// No banked view: a held stick yaws the frozen bird at a wall-clock rate, so
// the light would land differently on every run. The bank is a pose, not a
// material, and the bird sheet already photographs it.

// Studio grey is 0x808080; the harness's own bird-pixel rule.
const inUi = (x, y, w, h) => ((x / w > 0.68 && y / h < 0.33) || y / h > 0.77);
const isBird = (p, i) => {
  const o = i * p.ch; const d = p.data;
  return Math.abs(d[o] - 128) > 24 || Math.abs(d[o + 1] - 128) > 24 || Math.abs(d[o + 2] - 128) > 24;
};
const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

/** Linear sRGB (D65) to CIELAB. */
function labOf(R, G, B) {
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X); const fy = f(Y); const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * Mean sRGB luma, mean linear luminance, and the mean CIELAB colour: its
 * lightness, its chroma and its HUE ANGLE. Hue is read off the mean a*b*
 * vector, which is stable where the hue of a near-grey mean RGB is not; below
 * a chroma of 3 there is no hue worth comparing and it reads as null.
 */
export function measureTile(png, mask) {
  let n = 0; let luma = 0; let lin = 0; let sL = 0; let sa = 0; let sb = 0; let hi = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const o = i * png.ch; const r = png.data[o]; const g = png.data[o + 1]; const b = png.data[o + 2];
    const R = toLin(r); const G = toLin(g); const B = toLin(b);
    n += 1; luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lin += 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const [L, A, Bb] = labOf(R, G, B);
    sL += L; sa += A; sb += Bb;
    if (r > 245 || g > 245 || b > 245) hi += 1;
  }
  const a = sa / n; const bb = sb / n; const chroma = Math.hypot(a, bb);
  let hue = Math.atan2(bb, a) * 180 / Math.PI; if (hue < 0) hue += 360;
  return { n, luma: luma / n, lin: lin / n, L: sL / n, a, b: bb, chroma, hue: chroma >= 3 ? hue : null, clip: hi / n };
}

/**
 * Per-pixel colour comparison of two pixel-aligned tiles (same pose, same
 * geometry): over pixels whose CIELAB chroma is at least 8 in BOTH, the
 * chroma-weighted mean hue shift (signed and absolute, degrees) and the chroma
 * ratio. The bird is five colours at once — bronze, violet, teal, red, pink —
 * so the hue of its MEAN colour is close to grey and says nothing; whether
 * each feather kept its own hue is the question.
 */
export function comparePixels(pa, pb, mask) {
  let w = 0; let sh = 0; let sah = 0; let ca = 0; let cb = 0; let n = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const oa = i * pa.ch; const ob = i * pb.ch;
    const A = labOf(toLin(pa.data[oa]), toLin(pa.data[oa + 1]), toLin(pa.data[oa + 2]));
    const B = labOf(toLin(pb.data[ob]), toLin(pb.data[ob + 1]), toLin(pb.data[ob + 2]));
    const cA = Math.hypot(A[1], A[2]); const cB = Math.hypot(B[1], B[2]);
    if (cA < 8 || cB < 8) continue;
    let dh = (Math.atan2(B[2], B[1]) - Math.atan2(A[2], A[1])) * 180 / Math.PI;
    if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
    const wt = Math.min(cA, cB);
    w += wt; sh += wt * dh; sah += wt * Math.abs(dh); ca += cA; cb += cB; n += 1;
  }
  return { n, hueShift: w ? sh / w : 0, absHueShift: w ? sah / w : 0, chromaRatio: ca ? cb / ca : 1 };
}

async function captureRun(browser, port, { label, query, env, set, outDir, U, pitch, world = false }) {
  const context = await browser.newContext({ viewport: { width: 460, height: 460 }, deviceScaleFactor: 1 });
  await installCdnCache(context);
  // Tap-to-Start asks for NATIVE fullscreen on desktop and falls back to a
  // CSS fullscreen when refused. From a synthetic click Chromium refuses it
  // most of the time — not every time. Granted, the canvas is laid out at
  // 460x396, so that boot frames the same bird smaller and higher and a pixel
  // A/B against it compares two different images; leaving fullscreen
  // afterwards is worse (a 388x334 canvas), and a request that RESOLVES
  // without doing anything skips the CSS fallback (388x269).
  // tools/birb-bird-sheet.mjs has the same exposure. So every boot is refused,
  // which is the path the good runs took: the CSS fallback, 460x460.
  await context.addInitScript(() => {
    const refuse = function () { return Promise.reject(new Error('harness: native fullscreen refused')); };
    Element.prototype.requestFullscreen = refuse;
    if (Element.prototype.webkitRequestFullscreen) Element.prototype.webkitRequestFullscreen = refuse;
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page: ${String((e && e.message) || e)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    problems.push(`${m.type()}: ${m.text().slice(0, 240)}`);
  });
  const q = ['debug=1', 'quality=amazing', 'flight=classic', query, env ? `env=${env}` : ''].filter(Boolean).join('&');
  await page.goto(`http://127.0.0.1:${port}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
  await startGame(page, 120000);
  const frames = (n) => page.evaluate((count) => new Promise((resolve) => {
    let seen = 0; const step = () => { seen += 1; if (seen >= count) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), n);
  // (Fullscreen is stubbed out before the page loads; see captureRun's
  // addInitScript.) Insist on a canvas that fills the viewport anyway.
  const css = await page.evaluate(() => window.__BIRB.glLimits().cssSize);
  if (css[0] !== 460 || css[1] !== 460) problems.push(`canvas is ${css.join('x')}, not 460x460`);
  await frames(20);
  // The world is seeded per boot unless pinned, and a teleport into a cloud
  // or a crown collider is a knockdown: the first control run of this tool
  // photographed a bird tumbling toward the ground in one boot of the two.
  // Pin the seed, rebuild, and stand the bird well above the cruise layer.
  await page.evaluate((e) => { const B = window.__BIRB; B.worldSeed(16160); B.setEnvironment(e); }, env || 'forest');
  await frames(12);
  // setSunTime only moves the clock; the key light is re-aimed and re-tinted
  // inside the render loop, and only while the cycle is ENABLED. Set the time
  // and pause in one call and the light keeps whatever hour the boot's random
  // start time gave it — which is what made the first pinned control pair
  // come back 10-20% apart in every view.
  await page.evaluate(() => { const B = window.__BIRB; B.setSunTime(0.35); B.setSunEnabled(true); });
  await frames(3);
  const quat = levelQuat(U, pitch);
  const setup = await page.evaluate(({ U, quat, set, world }) => {
    const B = window.__BIRB;
    B.pinTier(0);
    B.setSunEnabled(false);
    B.setBloom({ enabled: false });
    B.setStick(0, 0);
    const pos = B.teleport(U[0], U[1], U[2], 70);
    B.restorePose({ position: pos, quaternion: quat });
    B.freeze(true);
    B.flapPhase(0.62);
    // The studio latch is what stops the flight loop rewriting the speed each
    // frame; `world: true` keeps the latch and the world both.
    const studio = B.birdStudio(true, { world });
    const plumage = B.plumage ? B.plumage(set ? { set } : {}) : null;
    return { studio: !!studio?.applied, plumage, pose: B.capturePose() };
  }, { U, quat, set, world });
  if (!setup.studio) problems.push('birdStudio(true) did not apply');
  // Settle on FRAMES, and enough of them that every time-smoothed term (the
  // speed-sense FOV, the glide sweep, the pose blends) has converged: they
  // integrate real delta, so a boot whose frames are slower (a physical
  // shader is more work) otherwise photographs the same bird at a different
  // point of the same transition. The first A/B of this tool compared a bird
  // against itself 0.0% apart and against the plumage build at a visibly
  // different FOV and wing pose, from exactly this.
  await frames(90);
  const dir = path.join(outDir, label);
  fs.mkdirSync(dir, { recursive: true });
  const fovs = [];
  for (const v of (world ? WORLD_VIEWS : VIEWS)) {
    await page.evaluate((view) => {
      const B = window.__BIRB;
      B.flapPhase(view.phase ?? 0.62);
      B.orbitBird(view.az, view.el, view.dist);
    }, v);
    await frames(6);
    await page.evaluate((view) => window.__BIRB.orbitBird(view.az, view.el, view.dist), v);
    await frames(2);
    await page.screenshot({ path: path.join(dir, `${v.id}.png`) });
    // A tile of a bird that moved is a photograph of a different bird.
    const now = await page.evaluate(() => ({
      pose: window.__BIRB.capturePose(), recovery: window.__BIRB.stats().recovery, fov: window.__BIRB.cameraProbe?.()?.fov ?? null,
    }));
    fovs.push(now.fov);
    const drift = Math.hypot(...now.pose.position.map((c, i) => c - setup.pose.position[i]));
    if (drift > 1e-3 || now.recovery !== 'flying') {
      problems.push(`${label}/${v.id}: the bird moved ${drift.toFixed(3)} units (recovery ${now.recovery})`);
    }
  }
  await context.close();
  return { label, query, problems, plumage: setup.plumage, fovs };
}

function sideBySide(outFile, runs, outDir, views, scale = 2) {
  const blocks = [];
  for (const v of views) {
    const pngs = runs.map((r) => decodePng(fs.readFileSync(path.join(outDir, r.label, `${v.id}.png`)), v.id));
    const { w, h } = pngs[0];
    let x0 = w; let y0 = h; let x1 = 0; let y1 = 0;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (inUi(x, y, w, h)) continue;
      if (pngs.some((p) => isBird(p, y * w + x))) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    if (x1 < x0) continue;
    x0 = Math.max(0, x0 - 6); y0 = Math.max(0, y0 - 6); x1 = Math.min(w - 1, x1 + 6); y1 = Math.min(h - 1, y1 + 6);
    blocks.push({ pngs, x0, y0, cw: x1 - x0 + 1, ch: y1 - y0 + 1 });
  }
  const gap = 6;
  const W = Math.max(...blocks.map((b) => (b.cw * scale + gap) * runs.length)) + gap;
  const H = blocks.reduce((s, b) => s + b.ch * scale + gap, gap);
  const data = Buffer.alloc(W * H * 3, 18);
  let oy = gap;
  for (const b of blocks) {
    b.pngs.forEach((p, k) => {
      const ox = gap + k * (b.cw * scale + gap);
      for (let y = 0; y < b.ch * scale; y += 1) for (let x = 0; x < b.cw * scale; x += 1) {
        const si = ((b.y0 + Math.floor(y / scale)) * p.w + (b.x0 + Math.floor(x / scale))) * p.ch;
        const di = ((oy + y) * W + (ox + x)) * 3;
        data[di] = p.data[si]; data[di + 1] = p.data[si + 1]; data[di + 2] = p.data[si + 2];
      }
    });
    oy += b.ch * scale + gap;
  }
  fs.writeFileSync(outFile, encodePng({ w: W, h: H, ch: 3, data }));
}

function worldSheet(outFile, runs, outDir) {
  const gap = 6; const crop = { x0: 0.18, y0: 0.2, x1: 0.82, y1: 0.8 }; const scale = 2;
  const rows = WORLD_VIEWS.map((v) => runs.map((r) => decodePng(fs.readFileSync(path.join(outDir, r.label, `${v.id}.png`)), v.id)));
  const { w, h } = rows[0][0];
  const cx0 = Math.floor(w * crop.x0); const cy0 = Math.floor(h * crop.y0);
  const cw = Math.floor(w * (crop.x1 - crop.x0)); const chh = Math.floor(h * (crop.y1 - crop.y0));
  const W = gap + runs.length * (cw * scale + gap); const H = gap + rows.length * (chh * scale + gap);
  const data = Buffer.alloc(W * H * 3, 18);
  rows.forEach((pngs, r) => pngs.forEach((p, k) => {
    const ox = gap + k * (cw * scale + gap); const oy = gap + r * (chh * scale + gap);
    for (let y = 0; y < chh * scale; y += 1) for (let x = 0; x < cw * scale; x += 1) {
      const si = ((cy0 + Math.floor(y / scale)) * p.w + (cx0 + Math.floor(x / scale))) * p.ch;
      const di = ((oy + y) * W + (ox + x)) * 3;
      data[di] = p.data[si]; data[di + 1] = p.data[si + 1]; data[di + 2] = p.data[si + 2];
    }
  }));
  fs.writeFileSync(outFile, encodePng({ w: W, h: H, ch: 3, data }));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.out) {
    console.error('usage: birb-plumage-ab.mjs --out <dir> [--a "plumage=0"] [--b ""] [--env forest] [--set JSON] [--no-control]');
    process.exit(2);
  }
  const outDir = path.resolve(REPO_ROOT, args.out);
  const aQuery = args.a === undefined ? 'plumage=0' : String(args.a === true ? '' : args.a);
  const bQuery = args.b === undefined ? '' : String(args.b === true ? '' : args.b);
  const env = typeof args.env === 'string' ? args.env : null;
  const set = typeof args.set === 'string' ? JSON.parse(args.set) : null;
  const world = !!args.world;
  const views = world ? WORLD_VIEWS : VIEWS;
  // Near the spawn pole, where the shipping light rig is the one it was tuned
  // for; not ON it, so the env rotation is exercised rather than the identity.
  const U = [0.1, 0.99, -0.1];
  // --baseline <dir>: reuse a previous run's A tiles instead of booting A
  // again (a tuning loop runs B alone; the control proves A is repeatable).
  const baseline = typeof args.baseline === 'string' ? path.resolve(REPO_ROOT, args.baseline) : null;
  if (baseline) {
    fs.mkdirSync(path.join(outDir, 'A'), { recursive: true });
    for (const v of views) fs.copyFileSync(path.join(baseline, 'A', `${v.id}.png`), path.join(outDir, 'A', `${v.id}.png`));
  }
  const specs = [
    ...(baseline ? [] : [{ label: 'A', query: aQuery, set: null }]),
    { label: 'B', query: bQuery, set },
  ];
  if (!args['no-control'] && !baseline) specs.push({ label: 'A2', query: aQuery, set: null });

  const runs = [];
  if (args['measure-only']) {
    // Re-measure tiles already on disk (no boots): every <out>/<label> dir.
    for (const label of ['B', 'A2']) {
      if (fs.existsSync(path.join(outDir, label))) runs.push({ label, query: '', problems: [], plumage: null });
    }
  } else {
    const { server, port } = await startServer(REPO_ROOT);
    const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
    try {
      for (const s of specs) {
        console.log(`# run ${s.label}: ?${['flight=classic', s.query, env ? `env=${env}` : ''].filter(Boolean).join('&')}${s.set ? `  set ${JSON.stringify(s.set)}` : ''}`);
        runs.push(await captureRun(browser, port, { ...s, env, outDir, U, pitch: 0, world }));
      }
    } finally {
      await browser.close();
      server.close();
    }
  }

  if (baseline || args['measure-only']) runs.unshift({ label: 'A', query: aQuery, problems: [], plumage: null });
  const problems = [];
  for (const r of runs) for (const p of r.problems) problems.push(`${r.label}: ${p}`);
  if (world) {
    // No grey background to find the bird against: the frames are for the
    // eye. Central crops, side by side, plus the control's whole-frame drift.
    worldSheet(path.join(outDir, 'world-side-by-side.png'), runs, outDir);
    console.log(`world side-by-side: ${path.join(outDir, 'world-side-by-side.png')}  (${runs.map((r) => r.label).join(' | ')})`);
    if (problems.length) console.error(`PROBLEMS:\n  ${problems.join('\n  ')}`);
    process.exit(problems.length ? 1 : 0);
  }
  const totals = runs.map(() => ({ lin: 0, luma: 0, k: 0 }));
  console.log('\nview                        pixels  ' + runs.map((r) => `${r.label.padEnd(2)} lin / L* / C* / hue`).join('   |   '));
  for (const v of VIEWS) {
    const pngs = runs.map((r) => decodePng(fs.readFileSync(path.join(outDir, r.label, `${v.id}.png`)), v.id));
    const { w, h } = pngs[0];
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i += 1) {
      if (inUi(i % w, Math.floor(i / w), w, h)) continue;
      if (pngs.some((p) => isBird(p, i))) mask[i] = 1;
    }
    const ms = pngs.map((p) => measureTile(p, mask));
    if (ms[0].n < 300) problems.push(`${v.id}: only ${ms[0].n} bird pixels — no bird in the tile`);
    const cells = ms.map((m, i) => {
      totals[i].lin += m.lin; totals[i].luma += m.luma; totals[i].k += 1;
      const hue = m.hue === null ? '  -' : m.hue.toFixed(0).padStart(3);
      let cell = `${m.lin.toFixed(4)} L*${m.L.toFixed(1)} C*${m.chroma.toFixed(1).padStart(4)} h${hue}`;
      if (i > 0) {
        const px = comparePixels(pngs[0], pngs[i], mask);
        totals[i].abs = (totals[i].abs || 0) + px.absHueShift;
        totals[i].chroma = (totals[i].chroma || 0) + px.chromaRatio;
        cell += ` (${((m.lin / ms[0].lin - 1) * 100).toFixed(1).padStart(5)}%, px hue ${px.hueShift.toFixed(1).padStart(5)}/|${px.absHueShift.toFixed(1)}|, C* x${px.chromaRatio.toFixed(2)})`;
      }
      return cell;
    });
    console.log(`${v.id.padEnd(26)} ${String(ms[0].n).padStart(7)}  ${cells.join(' | ')}`);
  }
  const means = totals.map((t) => ({ lin: t.lin / t.k, luma: t.luma / t.k }));
  console.log(`\nmean over views: ${means.map((m, i) => `${runs[i].label} lin ${m.lin.toFixed(4)} luma ${m.luma.toFixed(1)}${i ? ` (${((m.lin / means[0].lin - 1) * 100).toFixed(1)}%, per-pixel |hue shift| ${(totals[i].abs / totals[i].k).toFixed(1)} deg, chroma x${(totals[i].chroma / totals[i].k).toFixed(2)})` : ''}`).join(' | ')}`);
  sideBySide(path.join(outDir, 'side-by-side.png'), runs, outDir, VIEWS);
  console.log(`side-by-side: ${path.join(outDir, 'side-by-side.png')}  (${runs.map((r) => r.label).join(' | ')})`);
  for (const r of runs) if (r.fovs) console.log(`${r.label} camera fov per view: ${r.fovs.map((f) => (Number.isFinite(f) ? f.toFixed(2) : f)).join(' ')}`);
  if (runs[1]?.plumage) console.log(`B plumage: ${JSON.stringify({ contour: runs[1].plumage.contour, vane: runs[1].plumage.vane, zenith: runs[1].plumage.zenith })}`);
  if (problems.length) console.error(`PROBLEMS:\n  ${problems.join('\n  ')}`);
  process.exit(problems.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
