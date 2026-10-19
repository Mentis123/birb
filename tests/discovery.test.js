import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscovery, loadFound, FOUND_KEY, DWELL_SECONDS } from '../src/ui/discovery.js';
import { pinOpacity } from '../src/ui/pins-layer.js';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
const arch = { id: 'stone-arch', label: 'Stone arch', position: { x: 0, y: 120, z: 0 }, viewDistance: 40 };
const near = { x: 10, y: 125, z: 0 };
const far = { x: 300, y: 0, z: 0 };

test('a place is found after a dwell near it AND in view, then remembered', () => {
  const st = memoryStorage();
  const d = createDiscovery({ storage: st });
  // Steps of 0.25 s, the most one frame may count (a stall is clamped).
  for (let i = 0; i < 4; i++) assert.deepEqual(d.update(0.25, 'forest', [arch], near, () => true), []);
  const got = d.update(0.25, 'forest', [arch], near, () => true);
  assert.equal(got.length, 1);
  assert.equal(arch.found, true);
  assert.deepEqual(JSON.parse(st.getItem(FOUND_KEY)), { forest: ['stone-arch'] });
  const again = createDiscovery({ storage: st });
  assert.equal(again.isFound('forest', 'stone-arch'), true, 'persisted across a reload');
  assert.equal(again.total(), 1);
  arch.found = false;
});

test('far away, or out of view, or a glance: not found', () => {
  const d = createDiscovery({ storage: memoryStorage() });
  for (let i = 0; i < 10; i++) assert.deepEqual(d.update(0.25, 'forest', [arch], far, () => true), []);
  for (let i = 0; i < 10; i++) assert.deepEqual(d.update(0.25, 'forest', [arch], near, () => false), []);
  // Glances do not add up: leaving resets the dwell.
  for (let i = 0; i < 6; i++) {
    d.update(0.25, 'forest', [arch], near, () => true);
    d.update(0.25, 'forest', [arch], near, () => true);
    d.update(0.1, 'forest', [arch], far, () => true);
  }
  assert.equal(d.isFound('forest', 'stone-arch'), false);
});

test('a stalled frame cannot complete a dwell by itself', () => {
  const d = createDiscovery({ storage: memoryStorage() });
  assert.deepEqual(d.update(30, 'forest', [arch], near, () => true), []);
});

test('progress and flags are per biome', () => {
  const d = createDiscovery({ storage: memoryStorage({ [FOUND_KEY]: JSON.stringify({ forest: ['stone-arch'], city: ['broadcast-mast'] }) }) });
  const lms = [{ id: 'stone-arch' }, { id: 'waterfall' }];
  assert.deepEqual(d.progress('forest', lms), { found: 1, total: 2 });
  assert.deepEqual(d.progress('canyons', lms), { found: 0, total: 2 });
  d.flag('forest', lms);
  assert.deepEqual(lms.map((l) => l.found), [true, false]);
  d.reset();
  assert.equal(d.total(), 0);
});

test('corrupt storage is ignored, not thrown', () => {
  assert.deepEqual(loadFound(memoryStorage({ [FOUND_KEY]: '{not json' })), {});
  assert.deepEqual(loadFound(memoryStorage({ [FOUND_KEY]: '[1,2]' })), {});
  assert.deepEqual(loadFound(memoryStorage({ [FOUND_KEY]: JSON.stringify({ forest: ['a', 3, null] }) })), { forest: ['a'] });
  assert.deepEqual(loadFound(null), {});
});

test('pin opacity: full near, faded at the edge, gone beyond', () => {
  assert.equal(pinOpacity(10, 100), 1);
  assert.ok(pinOpacity(85, 100) > 0 && pinOpacity(85, 100) < 1);
  assert.equal(pinOpacity(120, 100), 0);
  assert.equal(pinOpacity(10, 0), 0);
});
