import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowFalloff } from '../src/effects/contact-shadow.js';

test('the shadow is strongest on the ground and fades as the bird climbs', () => {
  const ground = shadowFalloff(0);
  const low = shadowFalloff(5);
  const high = shadowFalloff(20);
  assert.ok(ground.opacity > low.opacity, 'must fade with altitude');
  assert.ok(low.opacity > high.opacity, 'must keep fading');
  assert.ok(ground.opacity > 0.4, `a landed bird needs a real shadow, got ${ground.opacity}`);
});

test('the shadow is gone entirely before it would look wrong', () => {
  // Past the falloff distance it must be exactly zero, not merely small: the
  // update path skips the transform below 0.02 and a nonzero tail would leave
  // a stale disc parked wherever the bird last was.
  assert.equal(shadowFalloff(34).opacity, 0);
  assert.equal(shadowFalloff(200).opacity, 0);
  assert.equal(shadowFalloff(1e9).opacity, 0);
});

test('the falloff is tuned for the altitudes this world actually produces', () => {
  // The continental carve puts real ground up to 46 units below the base
  // radius, so ordinary cruising sits 8-15 units over terrain. The first
  // tuning faded out by 14 units and the shadow was invisible in normal play.
  assert.ok(shadowFalloff(8).opacity > 0.2, 'must survive an ordinary cruise height');
  assert.ok(shadowFalloff(14).opacity > 0.1, 'must not vanish at mid altitude');
});

test('the disc spreads with altitude but never balloons', () => {
  assert.equal(shadowFalloff(0).scale, 1);
  assert.ok(shadowFalloff(20).scale > shadowFalloff(5).scale);
  // A penumbra widens; a decal that doubles in size reads as a growing hole.
  assert.ok(shadowFalloff(34).scale < 2, `scale ran away: ${shadowFalloff(34).scale}`);
});

test('altitude below ground clamps rather than inverting the shadow', () => {
  // Terrain sampling and the bird's own radius disagree by a hair on slopes,
  // so a slightly negative altitude is normal and must not brighten anything.
  assert.deepEqual(shadowFalloff(-2), shadowFalloff(0));
});

test('a non-finite altitude hides the shadow instead of throwing', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null]) {
    const result = shadowFalloff(bad);
    assert.equal(result.opacity, 0, `${bad} should hide the shadow`);
    assert.ok(Number.isFinite(result.scale));
  }
});
