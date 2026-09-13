import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, BIOMES } from '../tools/birb-textures.mjs';

/**
 * texture-ledger.test.js — the arithmetic behind the GL-texture leak gate.
 *
 * `tools/birb-textures.mjs` needs a browser, four biomes and about 33 seconds to
 * produce a ledger. The part of it that can be WRONG in a quiet, plausible way
 * is not the hooking — a broken hook reports zero and is obvious — it is the
 * decision about which growth is legitimate. Lap 1 populating a session and lap
 * 3 leaking look identical in a single number, and a verdict function that
 * forgave one lap too many would pass a real leak forever while the step stayed
 * green in CI. So the verdict is pure, exported, and tested here without a
 * browser anywhere near it.
 */

test('a flat ledger passes', () => {
  const v = judge([{ lap: 1, live: 16 }, { lap: 2, live: 16 }, { lap: 3, live: 16 }]);
  assert.equal(v.ok, true);
  assert.deepEqual(v.offenders, []);
});

test('lap 1 is allowed to grow — that is the session populating itself', () => {
  // The run really does look like this: 13 live after start, 16 after the first
  // lap has opened all four biomes. Only revisit laps are held to flat, so the
  // first lap's growth is never even a candidate offender — there is no earlier
  // lap to compare it against.
  const v = judge([{ lap: 1, live: 16 }, { lap: 2, live: 16 }]);
  assert.equal(v.ok, true);
  assert.equal(v.growth.length, 1, 'one comparison for two laps, not two');
  assert.equal(v.growth[0].lap, 2);
});

test('steady growth after lap 1 fails, and names every offending lap', () => {
  // The measured signature of the leak with the dispose removed: +4 per lap,
  // one orphaned 1024x512 panorama per biome switch.
  const v = judge([{ lap: 1, live: 19 }, { lap: 2, live: 23 }, { lap: 3, live: 27 }]);
  assert.equal(v.ok, false);
  assert.equal(v.offenders.length, 2);
  assert.deepEqual(v.offenders.map((o) => [o.lap, o.delta]), [[2, 4], [3, 4]]);
});

test('a single late lap of growth fails — a leak need not start at lap 2', () => {
  const v = judge([{ lap: 1, live: 16 }, { lap: 2, live: 16 }, { lap: 3, live: 20 }]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.offenders.map((o) => o.lap), [3]);
});

test('a ledger that SHRINKS passes — disposal outrunning upload is not a leak', () => {
  const v = judge([{ lap: 1, live: 20 }, { lap: 2, live: 16 }, { lap: 3, live: 16 }]);
  assert.equal(v.ok, true);
  assert.equal(v.growth[0].delta, -4);
});

test('tolerance forgives growth up to and including its own value, never past it', () => {
  const ledger = [{ lap: 1, live: 16 }, { lap: 2, live: 18 }];
  assert.equal(judge(ledger, 2).ok, true, '+2 at tolerance 2 passes');
  assert.equal(judge(ledger, 1).ok, false, '+2 at tolerance 1 fails');
  // The default must be zero. A default tolerance is how a leak gate stops
  // being one: four biomes leak four textures a lap, so anything at or above 4
  // would have called the measured regression flat.
  assert.equal(judge(ledger).ok, false, 'the default tolerance must be 0');
});

test('the four on-sphere biomes are all driven', () => {
  // A lap that visited three biomes would still look flat while the fourth's
  // sky leaked on every visit.
  assert.deepEqual([...BIOMES].sort(), ['canyons', 'city', 'forest', 'mountain']);
});
