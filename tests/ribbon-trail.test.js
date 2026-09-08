import test from 'node:test';
import assert from 'node:assert/strict';
import { RIBBON_DEFAULTS, ribbonProfile, rampIntensity } from '../src/effects/ribbon-trail.js';

test('the head is at full strength and the tail reaches zero', () => {
  const head = ribbonProfile(0, 1, 0, 0);
  assert.ok(head.alpha > 0.8, `head alpha ${head.alpha}`);
  assert.ok(head.halfWidth > 0.9, `head width ${head.halfWidth}`);
  // A ribbon whose tail stops at a non-zero alpha ends in a visible straight
  // cut, because the eye finds the last drawn row.
  const tail = ribbonProfile(1, 1, RIBBON_DEFAULTS.life, RIBBON_DEFAULTS.reach);
  assert.equal(tail.alpha, 0);
  assert.equal(tail.halfWidth, 0);
});

test('alpha never increases along the ribbon', () => {
  let previous = Infinity;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const { alpha } = ribbonProfile(t, 1, t * RIBBON_DEFAULTS.life, t * RIBBON_DEFAULTS.reach);
    assert.ok(alpha <= previous + 1e-9, `alpha rose at t=${t}: ${alpha} > ${previous}`);
    previous = alpha;
  }
});

test('arc length bounds the ribbon regardless of frame rate', () => {
  // The defect this guards: fading by buffer POSITION makes the visible length
  // (points x per-frame travel), so the same code gave about five units at
  // 60fps and seventy in a 2fps harness. Arc length is measured off the
  // geometry and cannot be fooled by either.
  //
  // A point one buffer step from the head, in a slow frame that moved the
  // wingtip a long way, must already be gone.
  const slowFrame = ribbonProfile(1 / 19, 1, 0.02, RIBBON_DEFAULTS.reach * 1.5);
  assert.equal(slowFrame.alpha, 0);
  // The same buffer position in a fast frame is still very much alive.
  const fastFrame = ribbonProfile(1 / 19, 1, 0.02, 0.12);
  assert.ok(fastFrame.alpha > 0.7, `fast-frame alpha ${fastFrame.alpha}`);
});

test('age alone terminates the trail of a bird that has stopped', () => {
  const stale = ribbonProfile(0.2, 1, RIBBON_DEFAULTS.life * 1.2, 0);
  assert.equal(stale.alpha, 0);
});

test('intensity ramps in and out over the configured times, and clamps', () => {
  // Attack: from nothing to full takes `attack` seconds, not one frame.
  let v = rampIntensity(0, 1, RIBBON_DEFAULTS.attack / 2);
  assert.ok(v > 0.4 && v < 0.6, `half an attack should be about half: ${v}`);
  v = rampIntensity(0, 1, RIBBON_DEFAULTS.attack * 2);
  assert.equal(v, 1, 'must not overshoot the target');
  // Release is slower than attack, so the ribbon does not snap off.
  const decayed = rampIntensity(1, 0, RIBBON_DEFAULTS.attack);
  assert.ok(decayed > 0.5, `release should be gentler than attack: ${decayed}`);
  assert.equal(rampIntensity(0.2, 0, 10), 0, 'must not undershoot the target');
});
