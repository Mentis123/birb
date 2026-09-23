#!/usr/bin/env node
/**
 * birb-realism.mjs — the realism checks, on the real page.
 *
 * One runner, many small checks. Each check is a module in
 * `tools/realism-checks/` that exports:
 *
 *   export const name = 'flap-follows-climb';
 *   export const query = '';            // optional extra boot flags, e.g. 'hextile=1'
 *   export default async function run(ctx) { ctx.check(ok, 'label'); }
 *
 * Checks that share a `query` share one browser boot, so adding a check
 * costs frames, not boots. Every boot also fails on ANY console error or
 * warning, the same rule tools/birb-modes.mjs applies: a shader that fails
 * to compile draws nothing and the page still paints, so the console is the
 * only place that failure shows up.
 *
 * FRAMES, NEVER MILLISECONDS. SwiftShader runs this page at a few frames a
 * second; every helper here waits on rendered frames.
 *
 * It boots `quality=amazing` for the same reason tools/birb-stunt.mjs does:
 * an Ultra frame is 2.6 s under SwiftShader and these checks count frames.
 * Checks that need an Ultra lever (shadows) turn it on themselves.
 *
 *   node tools/birb-realism.mjs                 # every check
 *   node tools/birb-realism.mjs --only a,b      # just these (by name)
 *   node tools/birb-realism.mjs --list
 *
 * Needs: npm install --no-save playwright https-proxy-agent
 *        git checkout -- node_modules/three/index.js
 */

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame,
} from './birb-shot.mjs';
import { decodePng } from './lib/asset-analysis.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_DIR = path.join(REPO_ROOT, 'tools', 'realism-checks');

const argv = process.argv.slice(2);
const argOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const only = (argOf('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const outDir = argOf('--out');   // optional: save every ctx.shot() here

async function loadChecks() {
  const files = fs.existsSync(CHECK_DIR)
    ? fs.readdirSync(CHECK_DIR).filter((f) => f.endsWith('.mjs')).sort()
    : [];
  const checks = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(CHECK_DIR, f)).href);
    if (typeof mod.default !== 'function') continue;
    checks.push({ name: mod.name || f.replace(/\.mjs$/, ''), query: mod.query || '', run: mod.default, file: f });
  }
  return checks;
}

/** Advance N RENDERED frames. The only unit of time this harness trusts. */
const frames = (page, n) => page.evaluate((count) => new Promise((resolve) => {
  let seen = 0;
  const step = () => { seen += 1; if (seen >= count) resolve(seen); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), n);

/** Quaternion [x,y,z,w] whose local +Y is `up` and local -Z is forward,
 *  pitched nose-down by `pitch` radians. Plain numbers, no THREE needed. */
export function levelQuat(U, pitch = 0) {
  const up = U.map((v) => v / Math.hypot(...U));
  const h = Math.abs(up[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = h[0] * up[0] + h[1] * up[1] + h[2] * up[2];
  let f = [h[0] - d * up[0], h[1] - d * up[1], h[2] - d * up[2]];
  const fl = Math.hypot(...f); f = f.map((v) => v / fl);
  const c = Math.cos(pitch); const s = Math.sin(pitch);
  const f2 = f.map((v, i) => c * v - s * up[i]);
  const u2 = f.map((v, i) => s * v + c * up[i]);
  const r = [f2[1] * u2[2] - f2[2] * u2[1], f2[2] * u2[0] - f2[0] * u2[2], f2[0] * u2[1] - f2[1] * u2[0]];
  const m = [r, u2, f2.map((v) => -v)];
  const [m00, m10, m20] = m[0]; const [m01, m11, m21] = m[1]; const [m02, m12, m22] = m[2];
  const tr = m00 + m11 + m22; let x; let y; let z; let w;
  if (tr > 0) { const S = 0.5 / Math.sqrt(tr + 1); w = 0.25 / S; x = (m21 - m12) * S; y = (m02 - m20) * S; z = (m10 - m01) * S; }
  else if (m00 > m11 && m00 > m22) { const S = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / S; x = 0.25 * S; y = (m01 + m10) / S; z = (m02 + m20) / S; }
  else if (m11 > m22) { const S = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / S; x = (m01 + m10) / S; y = 0.25 * S; z = (m12 + m21) / S; }
  else { const S = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / S; x = (m02 + m20) / S; y = (m12 + m21) / S; z = 0.25 * S; }
  return [x, y, z, w];
}

/** Quaternion [x,y,z,w] with local +Y along `up` and local -Z along the
 *  tangent part of `forward`, pitched nose-down by `pitch` radians. */
export function quatFromUpForward(U, F, pitch = 0) {
  const up = U.map((v) => v / Math.hypot(...U));
  const d = F[0] * up[0] + F[1] * up[1] + F[2] * up[2];
  let f = [F[0] - d * up[0], F[1] - d * up[1], F[2] - d * up[2]];
  const fl = Math.hypot(...f);
  if (fl < 1e-6) return levelQuat(U, pitch);
  f = f.map((v) => v / fl);
  // Rotate the helper frame so levelQuat's forward lands on f: build directly.
  const c = Math.cos(pitch); const s = Math.sin(pitch);
  const f2 = f.map((v, i) => c * v - s * up[i]);
  const u2 = f.map((v, i) => s * v + c * up[i]);
  const r = [f2[1] * u2[2] - f2[2] * u2[1], f2[2] * u2[0] - f2[0] * u2[2], f2[0] * u2[1] - f2[1] * u2[0]];
  const m = [r, u2, f2.map((v) => -v)];
  const [m00, m10, m20] = m[0]; const [m01, m11, m21] = m[1]; const [m02, m12, m22] = m[2];
  const tr = m00 + m11 + m22; let x; let y; let z; let w;
  if (tr > 0) { const S = 0.5 / Math.sqrt(tr + 1); w = 0.25 / S; x = (m21 - m12) * S; y = (m02 - m20) * S; z = (m10 - m01) * S; }
  else if (m00 > m11 && m00 > m22) { const S = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / S; x = 0.25 * S; y = (m01 + m10) / S; z = (m02 + m20) / S; }
  else if (m11 > m22) { const S = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / S; x = (m01 + m10) / S; y = 0.25 * S; z = (m12 + m21) / S; }
  else { const S = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / S; x = (m02 + m20) / S; y = (m12 + m21) / S; z = 0.25 * S; }
  return [x, y, z, w];
}

const toLinear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

/** Mean luminance of rows [y0,y1) (fractions of height). sRGB 0-255 by
 *  default; `linear: true` returns linear 0-1 so shares add. */
export function lum(png, y0 = 0, y1 = 1, { linear = false, x0 = 0, x1 = 1 } = {}) {
  const { w, h, ch, data } = png; let s = 0; let n = 0;
  for (let y = Math.floor(h * y0); y < Math.floor(h * y1); y += 2) {
    for (let x = Math.floor(w * x0); x < Math.floor(w * x1); x += 2) {
      const i = (y * w + x) * ch;
      if (linear) s += 0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1]) + 0.0722 * toLinear(data[i + 2]);
      else s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n += 1;
    }
  }
  return n ? s / n : 0;
}

export function stats(a) {
  const m = a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length || 1));
  return { mean: m, sd, min: Math.min(...a), max: Math.max(...a) };
}

function makeCtx(page, state) {
  let shotIndex = 0;
  const ctx = {
    page,
    frames: (n) => frames(page, n),
    log: (...m) => console.log('      ', ...m),
    check(ok, label) {
      state.checks += 1;
      if (!ok) state.failures += 1;
      console.log(`${ok ? 'ok  ' : 'FAIL'}  [${state.current}] ${label}`);
      return ok;
    },
    levelQuat,
    quatFromUpForward,
    lum,
    stats,
    /** Level (or pitched) pose `above` units over the ground at direction U,
     *  frozen, camera settled. Deterministic: same args, same frame. */
    async place({ U = [1, 0.08, 0.05], above = 22, pitch = 0, settle = 8, quat = null } = {}) {
      const q = quat || levelQuat(U, pitch);
      await page.evaluate(({ U, q, above }) => {
        const B = window.__BIRB;
        B.setStick?.(0, 0);
        const pos = B.teleport(U[0], U[1], U[2], above);
        B.restorePose({ position: pos, quaternion: q });
        B.freeze(true);
      }, { U, q, above });
      await frames(page, settle);
    },
    async unfreeze() { await page.evaluate(() => window.__BIRB.freeze(false)); },
    async shot(label = 'shot') {
      const buf = await page.screenshot();
      if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        shotIndex += 1;
        fs.writeFileSync(path.join(outDir, `${state.current}-${String(shotIndex).padStart(2, '0')}-${label}.png`), buf);
      }
      return decodePng(buf, label);
    },
    /** Hold the stick for n frames, sampling fn() in the page each frame. */
    async hold({ x = 0, y = 0, rudder = 0, throttle = 1 }, n, sampleSrc = null) {
      return page.evaluate(async ({ x, y, rudder, throttle, n, sampleSrc }) => {
        const B = window.__BIRB;
        B.setStick(x, y);
        B.setPad?.(rudder, throttle);
        // eslint-disable-next-line no-new-func
        const sample = sampleSrc ? new Function('B', sampleSrc) : null;
        const out = [];
        for (let i = 0; i < n; i += 1) {
          await new Promise((r) => requestAnimationFrame(r));
          if (sample) out.push(sample(B));
        }
        B.setStick(0, 0);
        B.setPad?.(null);
        return out;
      }, { x, y, rudder, throttle, n, sampleSrc });
    },
  };
  return ctx;
}

async function main() {
  const all = await loadChecks();
  if (argv.includes('--list')) {
    for (const c of all) console.log(`${c.name}${c.query ? `  (?${c.query})` : ''}  — ${c.file}`);
    return;
  }
  const selected = only.length ? all.filter((c) => only.includes(c.name)) : all;
  if (!selected.length) {
    console.log(only.length ? `no check named ${only.join(', ')}` : 'no checks in tools/realism-checks/');
    process.exitCode = only.length ? 1 : 0;
    return;
  }
  const byQuery = new Map();
  for (const c of selected) {
    if (!byQuery.has(c.query)) byQuery.set(c.query, []);
    byQuery.get(c.query).push(c);
  }

  const state = { checks: 0, failures: 0, current: '' };
  const { server, port } = await startServer(REPO_ROOT);
  const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
  try {
    for (const [query, checks] of byQuery) {
      const context = await browser.newContext({
        ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
      });
      await installCdnCache(context);
      const page = await context.newPage();
      const warnings = [];
      page.on('pageerror', (e) => warnings.push('page: ' + String((e && e.message) || e)));
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') warnings.push(`${m.type()}: ${m.text().slice(0, 240)}`);
      });
      const url = `http://127.0.0.1:${port}/index.html?debug=1&quality=amazing${query ? `&${query}` : ''}`;
      console.log(`\n# boot ${url.replace(/^http:\/\/127\.0\.0\.1:\d+/, '')}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await startGame(page, 90000);
      await frames(page, 20);
      const levelPose = await page.evaluate(() => window.__BIRB.capturePose());
      for (const c of checks) {
        state.current = c.name;
        await page.evaluate((p) => {
          const B = window.__BIRB;
          B.setStick?.(0, 0); B.setPad?.(null); B.freeze?.(false);
          if (p) B.restorePose(p);
          B.setAltitude?.(40);
        }, levelPose);
        await frames(page, 10);
        const ctx = makeCtx(page, state);
        try {
          await c.run(ctx);
        } catch (e) {
          ctx.check(false, `threw: ${String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')}`);
        }
      }
      state.current = `boot ${query || 'default'}`;
      const cleanConsole = warnings.length === 0;
      if (!cleanConsole) for (const w of warnings.slice(0, 12)) console.log('      ' + w);
      makeCtx(page, state).check(cleanConsole, `no console errors or warnings (${warnings.length})`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${state.failures ? 'FAILED' : 'ok'}: ${state.checks - state.failures}/${state.checks} realism checks passed`);
  process.exitCode = state.failures ? 1 : 0;
}

// Only when run as a script: check modules may import the helpers above
// without re-entering the runner.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
