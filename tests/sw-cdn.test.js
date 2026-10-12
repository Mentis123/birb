// tests/sw-cdn.test.js — the esm.sh modules every boot imports must be in the
// service worker's caches after ONE online visit, not two.
//
// The page imports three, BufferGeometryUtils and nipplejs from esm.sh at
// boot, and sw.js registers on window load — so on a first visit those
// requests never pass through the worker and runtime caching never sees them.
// tools/species-offline-check.mjs --only first-visit measured the result: one
// online visit, the HTTP cache cleared (what an evicting phone does), offline
// -> `https://esm.sh/three@0.183.2` answered the worker's 504 and the game
// never reached the title. The fix is CDN_MODULES, crawled into RUNTIME_CACHE
// at install. There is no service-worker runtime under node, so this pins the
// LIST against the code and runs the crawler's import parser on real esm.sh
// stub text; the headless tool is the end-to-end proof.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');

const cdnModules = () => {
  const m = /const CDN_MODULES = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(m, 'sw.js has no CDN_MODULES list');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
});

// Every esm.sh URL the game's code names, with where it was found.
const esmUrlsInCode = () => {
  const found = new Map();
  for (const file of [join(ROOT, 'index.html'), ...walk(join(ROOT, 'src'))]) {
    for (const m of readFileSync(file, 'utf8').matchAll(/["'](https:\/\/esm\.sh\/[^"'\s]+)["']/g)) {
      if (!found.has(m[1])) found.set(m[1], file.slice(ROOT.length));
    }
  }
  return found;
};

// Gated imports that are deliberately NOT precached, each with its reason.
const NOT_PRECACHED = {
  // Behind ?glb=1 only (index.html's GLB A/B gate), like ./birb.glb itself,
  // which CORE_ASSETS also leaves to the runtime cache.
  'https://esm.sh/three@0.183.2/examples/jsm/loaders/GLTFLoader.js': '?glb=1 A/B only',
};

test('every esm.sh module the code imports is in CDN_MODULES (or explicitly gated out)', () => {
  const list = new Set(cdnModules());
  const missing = [...esmUrlsInCode()].filter(([url]) => !list.has(url) && !(url in NOT_PRECACHED));
  assert.deepEqual(missing, [], 'an esm.sh import absent from CDN_MODULES dies on the first offline launch after one visit');
});

test('CDN_MODULES has no dead entries: each is imported by the code', () => {
  const inCode = esmUrlsInCode();
  for (const url of cdnModules()) assert.ok(inCode.has(url), `${url} is precached but nothing imports it`);
});

test('install crawls CDN_MODULES into RUNTIME_CACHE alongside the core precache', () => {
  const install = /self\.addEventListener\('install', \(event\) => \{([\s\S]*?)\n\}\);/.exec(sw);
  assert.ok(install, 'install handler missing');
  assert.ok(/precacheCdn\(\)/.test(install[1]), 'install must run precacheCdn()');
  assert.ok(install[1].indexOf('precacheCdn()') < install[1].indexOf('skipWaiting'), 'the crawl must finish before the worker activates');
  const fn = /async function precacheCdn\(\) \{([\s\S]*?)\n\}/.exec(sw);
  assert.ok(fn, 'precacheCdn is not defined');
  assert.ok(/caches\.open\(RUNTIME_CACHE\)/.test(fn[1]), 'CDN modules belong in the runtime cache, which activate keeps');
  assert.ok(/CDN_MODULES\.map\(visit\)/.test(fn[1]) && /esmImports\(/.test(fn[1]), 'it must follow each entry\'s imports');
});

// precacheCdn itself, lifted out of sw.js and run against fake caches/fetch.
// AbortSignal is undefined in the sandbox (the bound must not need
// AbortSignal.timeout), timeoutMs shrinks the 20 s deadline so a stall test
// runs in milliseconds, and the sandbox's timers are tracked: `live` holds
// every timer set and not yet cleared or fired.
function loadCrawler({ fetch, timeoutMs }) {
  const pick = (re, what) => { const m = re.exec(sw); assert.ok(m, `${what} missing`); return m[0]; };
  const limit = pick(/const CDN_FETCH_TIMEOUT_MS = \d+;/, 'CDN_FETCH_TIMEOUT_MS');
  const parts = [
    pick(/const CDN_MODULES = \[[\s\S]*?\];/, 'CDN_MODULES'),
    pick(/function esmImports\(text, base\) \{[\s\S]*?\n\}/, 'esmImports'),
    timeoutMs === undefined ? limit : `const CDN_FETCH_TIMEOUT_MS = ${timeoutMs};`,
    pick(/async function withDeadline\(ms, work\) \{[\s\S]*?\n\}/, 'withDeadline'),
    pick(/async function precacheCdn\(\) \{[\s\S]*?\n\}/, 'precacheCdn'),
  ];
  const stored = new Map();
  const caches = { open: async () => ({ put: async (url, res) => { await res.text(); stored.set(url, res); } }) };
  const timers = { set: 0, live: new Set() };
  const setTimer = (fn, ms) => {
    timers.set += 1;
    const id = setTimeout(() => { timers.live.delete(id); fn(); }, ms);
    timers.live.add(id);
    return id;
  };
  const clearTimer = (id) => { timers.live.delete(id); clearTimeout(id); };
  // eslint-disable-next-line no-new-func
  const precacheCdn = new Function('caches', 'fetch', 'AbortSignal', 'AbortController', 'setTimeout', 'clearTimeout',
    'RUNTIME_CACHE', 'RUNTIME_CACHEABLE_HOSTS', `${parts.join('\n')}; return precacheCdn;`)(
    caches, fetch, undefined, globalThis.AbortController, setTimer, clearTimer, 'runtime', new Set(['esm.sh', 'cdn.esm.sh']));
  return { precacheCdn, stored, timers };
}

// precacheCdn must settle well inside this, or the test fails rather than hangs.
const within = (promise, ms, what) => {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} not bounded`)), ms); })])
    .finally(() => clearTimeout(t));
};

test('precacheCdn follows the entries\' imports into the runtime cache', async () => {
  const bodies = {
    'https://esm.sh/three@0.183.2': 'export * from "/three@0.183.2/es2022/three.mjs";',
    'https://esm.sh/three@0.183.2/es2022/three.mjs': 'import{a}from"/three@0.183.2/es2022/build/three.core.mjs";',
  };
  const fetch = async (url) => new Response(bodies[url] ?? '/* leaf */', { status: 200 });
  const { precacheCdn, stored } = loadCrawler({ fetch });
  await precacheCdn();
  for (const url of [...cdnModules(), 'https://esm.sh/three@0.183.2/es2022/three.mjs', 'https://esm.sh/three@0.183.2/es2022/build/three.core.mjs']) {
    assert.ok(stored.has(url), `${url} cached`);
  }
});

test('the CDN deadline is a real bound, 20 s or so', () => {
  const m = /const CDN_FETCH_TIMEOUT_MS = (\d+);/.exec(sw);
  assert.ok(m, 'CDN_FETCH_TIMEOUT_MS missing');
  assert.ok(Number(m[1]) > 0 && Number(m[1]) <= 60000, `timeout ${m[1]}`);
});

test('precacheCdn is bounded: a CDN that stalls times out and install goes on, nothing cached', async () => {
  // A fetch that never answers on its own, only to its abort signal — what a
  // stalled third-party host looks like. Without a signal, install would wait
  // on it until the browser killed the event and the deploy never activated.
  let signals = 0;
  const fetch = (url, init) => new Promise((_, reject) => {
    assert.ok(init && init.signal, `${url} fetched without an abort signal`);
    signals += 1;
    init.signal.addEventListener('abort', () => reject(new Error('timed out')));
  });
  const { precacheCdn, stored, timers } = loadCrawler({ fetch, timeoutMs: 5 });
  await within(precacheCdn(), 2000, 'precacheCdn');
  assert.equal(signals, cdnModules().length);
  assert.equal(stored.size, 0);
  assert.equal(timers.live.size, 0);
});

test('precacheCdn is bounded without AbortSignal.timeout, even when fetch ignores its signal', async () => {
  // The sandbox has no AbortSignal at all, and this fetch never settles, abort
  // or not: only the deadline's own timer can end the wait.
  const aborted = [];
  const fetch = (url, init) => {
    init.signal.addEventListener('abort', () => aborted.push(url));
    return new Promise(() => {});
  };
  const { precacheCdn, stored, timers } = loadCrawler({ fetch, timeoutMs: 10 });
  await within(precacheCdn(), 2000, 'precacheCdn');
  assert.deepEqual(aborted.sort(), [...cdnModules()].sort(), 'each stalled fetch is aborted at the deadline');
  assert.equal(stored.size, 0);
  assert.equal(timers.live.size, 0);
});

test('precacheCdn is bounded when headers arrive but the body stalls', async () => {
  // 200 and headers, then a body stream that never delivers or closes. The
  // deadline must cover cache.put and the text() read, not just the headers.
  const stall = () => new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { status: 200 });
  const fetch = async () => stall();
  const { precacheCdn, stored, timers } = loadCrawler({ fetch, timeoutMs: 10 });
  await within(precacheCdn(), 2000, 'precacheCdn');
  assert.equal(stored.size, 0, 'a module whose body never finished is skipped');
  assert.equal(timers.live.size, 0);
});

test('precacheCdn clears every deadline timer when the crawl succeeds', async () => {
  const fetch = async () => new Response('/* leaf */', { status: 200 });
  const { precacheCdn, stored, timers } = loadCrawler({ fetch });
  await precacheCdn();
  assert.equal(stored.size, cdnModules().length);
  assert.equal(timers.set, cdnModules().length, 'one deadline per module');
  assert.equal(timers.live.size, 0, 'a 20 s timer left running after success');
});

test('a failing module is skipped, the rest are still cached', async () => {
  const [bad, ...good] = cdnModules();
  const fetch = async (url) => {
    if (url === bad) throw new TypeError('Failed to fetch');
    return new Response('/* leaf */', { status: 200 });
  };
  const { precacheCdn, stored, timers } = loadCrawler({ fetch });
  await precacheCdn();
  assert.deepEqual([...stored.keys()].sort(), good.sort());
  assert.equal(timers.live.size, 0);
});

// The crawler's parser, run on the stub and bundle heads esm.sh actually
// served for these pins (captured 2026-10-09 from inside headless Chrome).
test('esmImports follows esm.sh stubs and bundle-relative imports, and nothing else', () => {
  const src = /function esmImports\(text, base\) \{[\s\S]*?\n\}/.exec(sw);
  assert.ok(src, 'esmImports is not defined');
  // eslint-disable-next-line no-new-func
  const esmImports = new Function('RUNTIME_CACHEABLE_HOSTS', `${src[0]}; return esmImports;`)(new Set(['esm.sh', 'cdn.esm.sh']));
  const three = '/* esm.sh - three@0.183.2 */\nimport "/three@0.183.2/es2022/build/three.core.mjs";\nexport * from "/three@0.183.2/es2022/three.mjs";\n';
  assert.deepEqual(esmImports(three, 'https://esm.sh/three@0.183.2'), [
    'https://esm.sh/three@0.183.2/es2022/build/three.core.mjs',
    'https://esm.sh/three@0.183.2/es2022/three.mjs',
  ]);
  const nipple = '/* esm.sh - nipplejs@0.10.1 */\nexport * from "/nipplejs@0.10.1/es2022/nipplejs.mjs";\nexport { default } from "/nipplejs@0.10.1/es2022/nipplejs.mjs";\n';
  assert.deepEqual(esmImports(nipple, 'https://esm.sh/nipplejs@0.10.1'), [
    'https://esm.sh/nipplejs@0.10.1/es2022/nipplejs.mjs', 'https://esm.sh/nipplejs@0.10.1/es2022/nipplejs.mjs',
  ]);
  const bgu = 'import{BufferAttribute as F,Vector3 as I}from"../../../three.mjs";function ut(t){throw new Error("x")}';
  assert.deepEqual(esmImports(bgu, 'https://esm.sh/three@0.183.2/es2022/examples/jsm/utils/BufferGeometryUtils.mjs'),
    ['https://esm.sh/three@0.183.2/es2022/three.mjs']);
  // Another host, or a string that is not a module path, is not followed.
  assert.deepEqual(esmImports('import "https://unpkg.com/x.js"; const s = "from x";', 'https://esm.sh/a'), []);
});
