// tests/sw-modules.test.js — the service worker must never serve a NEW shell
// with OLD modules.
//
// The first load after every deploy did exactly that: index.html is a
// navigation (networkFirst) and the modules were staleWhileRevalidate, so the
// fresh shell asked a cached visual-style.js for an export it predated and the
// game died at top level on the title screen ("pionusPlumageRequested is not
// a function", 2026-09-14). A test that reads the worker's own text is the
// only kind that can run here — there is no service-worker runtime under
// node — so this pins the STRATEGY, the way build-identity pins the version.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('same-origin .js requests go network first, with the core cache as the offline fallback', () => {
  const branch = /if \(sameOrigin && url\.pathname\.endsWith\('\.js'\)\) \{\s*event\.respondWith\((\w+)\(request\)\);/m.exec(sw);
  assert.ok(branch, 'the .js branch of the fetch handler is missing');
  assert.equal(branch[1], 'networkFirstModule', `modules are routed through ${branch[1]}`);
  assert.ok(!/staleWhileRevalidate/.test(sw), 'staleWhileRevalidate is the strategy that skewed shell and modules; it must not come back');
  const fn = /async function networkFirstModule\(request\) \{([\s\S]*?)\n\}/.exec(sw);
  assert.ok(fn, 'networkFirstModule is not defined');
  const body = fn[1];
  assert.ok(/await fetch\(request\)/.test(body), 'it must try the network first');
  assert.ok(/caches\.match\(request/.test(body), 'it must fall back to the cache when the network fails');
  assert.ok(/CORE_CACHE/.test(body), 'a fresh module must be written to the core cache so the offline set stays current');
  // The order matters: fetch before match.
  assert.ok(body.indexOf('await fetch(request)') < body.indexOf('caches.match(request'), 'network before cache, not the other way round');
});

test('navigations stay network first, so shell and modules come from the same deploy', () => {
  assert.ok(/if \(request\.mode === 'navigate'\) \{\s*event\.respondWith\(networkFirst\(request\)\);/m.test(sw));
});
