import test from 'node:test';
import assert from 'node:assert/strict';

import { clampTargetSize } from '../src/effects/bloom-pass.js';

// A real browser reported, on a URL that works fine in this repo's harness:
//   GL_INVALID_VALUE: glRenderbufferStorage: Desired resource size is greater
//     than max renderbuffer size
//   GL_INVALID_FRAMEBUFFER_OPERATION: glClear: Framebuffer is incomplete:
//     Attachment has zero size
// which is one failure, not two: a renderbuffer whose allocation is rejected
// keeps its previous 0x0 size, and every draw into that framebuffer then
// fails. Not reproducible here -- SwiftShader, MAX_RENDERBUFFER_SIZE 8192,
// largest size this game ever asks for measured at 612x1258, no GL errors --
// so the pass now clamps instead of trusting its inputs.

test('a render-target dimension is floored into [1, limit]', () => {
  assert.equal(clampTargetSize(612.7, 8192), 612);
  assert.equal(clampTargetSize(1, 8192), 1);
  assert.equal(clampTargetSize(8192, 8192), 8192);
  assert.equal(clampTargetSize(8193, 8192), 8192);
  assert.equal(clampTargetSize(100000, 8192), 8192);
});

test('non-finite and sub-pixel sizes come back as 1, never as NaN', () => {
  // This is the case the obvious clamp misses: Math.max(1, NaN) is NaN, so
  // `Math.max(1, Math.floor(width * ratio))` hands GL a non-finite size the
  // moment `ratio` is undefined -- which a device-toolbar toggle can do.
  assert.equal(Number.isNaN(Math.max(1, Number.NaN)), true, 'the trap this guards');

  for (const bad of [Number.NaN, undefined, null, Infinity, -Infinity, 0, -5, 0.4, '']) {
    const out = clampTargetSize(Number(bad) * 1, 8192);
    assert.ok(Number.isInteger(out) && out >= 1, `${String(bad)} produced ${out}`);
  }
  assert.equal(clampTargetSize(Number.NaN, 8192), 1);
  // Infinity is garbage, not "as big as possible": 1 is the safe reading.
  assert.equal(clampTargetSize(Infinity, 8192), 1);
});

test('a missing or nonsense GL limit falls back rather than disabling the clamp', () => {
  // getParameter can return null on a lost context. Returning Infinity there
  // would leave the guard in place and doing nothing.
  for (const limit of [undefined, null, 0, -1, Number.NaN]) {
    assert.equal(clampTargetSize(999999, limit), 4096, `limit ${String(limit)}`);
  }
});
