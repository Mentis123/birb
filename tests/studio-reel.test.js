// tests/studio-reel.test.js — the studio's portrait reel (2026-10-23).
//
// frame-clock.js is the virtual time base a frame-exact recording runs on;
// studioFrameSize turns ?aspect=9:16&res=1080 into the drawing buffer the
// encoder gets. The live path (boot, record, download) is a headless run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameClock, clockNow } from '../src/ui/frame-clock.js';
import { getShot } from '../src/camera/shots.js';

test('the frame clock advances exactly 1/fps per frame, starting where it was started', () => {
  const c = createFrameClock();
  c.start(30, 1000);
  assert.equal(c.advance(), 1000);
  assert.equal(c.frame, 0);
  for (let i = 0; i < 30; i++) c.advance();
  assert.ok(Math.abs(c.ms - 2000) < 1e-9, 'thirty frames are one second');
  assert.equal(c.frame, 30);
});

test('a stalled clock re-runs the same instant and marks the frame stale', () => {
  const c = createFrameClock();
  let stall = false;
  c.start(60, 0, { stall: () => stall });
  c.advance(); c.advance();
  const ms = c.ms;
  stall = true;
  assert.equal(c.advance(), ms);
  assert.equal(c.fresh, false);
  assert.equal(c.frame, 1);
  stall = false;
  c.advance();
  assert.equal(c.fresh, true);
  assert.ok(Math.abs(c.ms - (ms + 1000 / 60)) < 1e-9);
});

test('clockNow follows the frame clock only while it is active', () => {
  const c = createFrameClock();
  globalThis.__birbFrameClock = c;
  c.start(30, 123456);
  c.advance();
  assert.equal(clockNow(), 123456);
  c.stop();
  assert.notEqual(clockNow(), 123456);
  delete globalThis.__birbFrameClock;
});

test('the reel shot is 15 s, forest, and lights itself', () => {
  const s = getShot('reel-forest');
  assert.ok(s);
  assert.equal(s.world, 'forest');
  assert.equal(s.keys[s.keys.length - 1].t, 15);
  assert.ok(Number.isFinite(s.sun.elevation) && Number.isFinite(s.sun.bearing));
});

test('studioFrameSize: 9:16 at 1080 is 1080x1920; even sizes; nonsense is null', async () => {
  // studio.js touches the DOM only inside installStudio; the size helper is pure.
  const { studioFrameSize } = await import('../src/ui/studio.js');
  const p = (q) => new URLSearchParams(q);
  assert.deepEqual(studioFrameSize(p('aspect=9:16')), { width: 1080, height: 1920, ar: 9 / 16 });
  assert.deepEqual(studioFrameSize(p('aspect=9:16&res=720')), { width: 720, height: 1280, ar: 9 / 16 });
  const odd = studioFrameSize(p('aspect=9:16&res=271'));
  assert.equal(odd.width % 2, 0); assert.equal(odd.height % 2, 0);
  assert.equal(studioFrameSize(p('')), null);
  assert.equal(studioFrameSize(p('aspect=banana')), null);
});
