import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerfAdvisor, PERF_LEVELS, PERF_ADVISOR_DEFAULTS, nextLighterPreset } from '../src/game/perf-advisor.js';

const STEP = 250; // the frame sampler's window

// Feed `fps` every 250 ms from `t0` for `ms`; returns the end time and every level seen.
function run(advisor, fps, t0, ms) {
  const seen = [];
  let t = t0;
  for (; t < t0 + ms; t += STEP) {
    if (advisor.sample(typeof fps === 'function' ? fps(t) : fps, t)) seen.push(advisor.getLevel());
  }
  return { t, seen };
}

test('a steady 60 never raises the chip', () => {
  const a = createPerfAdvisor();
  const { seen } = run(a, 60, 0, 120000);
  assert.deepEqual(seen, []);
  assert.equal(a.getLevel(), PERF_LEVELS.OK);
});

test('the boot grace ignores a cold start', () => {
  const a = createPerfAdvisor();
  // 3.5 s of 10 fps compiling shaders, then a healthy game.
  const { t } = run(a, 10, 0, 3500);
  run(a, 60, t, 30000);
  assert.equal(a.getLevel(), PERF_LEVELS.OK);
});

test('a sustained sag to 44 turns yellow, not red, and not instantly', () => {
  const a = createPerfAdvisor();
  let { t } = run(a, 60, 0, 10000);
  const start = t;
  let yellowAt = null;
  for (; t < start + 15000; t += STEP) {
    if (a.sample(44, t) && a.getLevel() === PERF_LEVELS.WARN && yellowAt === null) yellowAt = t - start;
  }
  assert.ok(yellowAt !== null, 'went yellow');
  assert.ok(yellowAt >= PERF_ADVISOR_DEFAULTS.enterHoldMs, `held at least the enter hold (${yellowAt} ms)`);
  assert.ok(yellowAt < 8000, `but within a few seconds (${yellowAt} ms)`);
});

test('one hitch cannot trip it', () => {
  const a = createPerfAdvisor();
  let { t } = run(a, 60, 0, 10000);
  ({ t } = run(a, 8, t, 500)); // half a second of a terrible frame rate
  const { seen } = run(a, 60, t, 30000);
  assert.deepEqual(seen, []);
  assert.equal(a.getLevel(), PERF_LEVELS.OK);
});

test('an ignored yellow that recovers resolves', () => {
  const a = createPerfAdvisor();
  let { t } = run(a, 60, 0, 6000);
  ({ t } = run(a, 44, t, 8000));
  assert.equal(a.getLevel(), PERF_LEVELS.WARN);
  ({ t } = run(a, 60, t, 15000));
  assert.equal(a.getLevel(), PERF_LEVELS.OK);
});

test('an ignored yellow that does not recover turns red', () => {
  const a = createPerfAdvisor();
  let { t } = run(a, 60, 0, 6000);
  ({ t } = run(a, 44, t, 8000));
  assert.equal(a.getLevel(), PERF_LEVELS.WARN);
  run(a, 44, t, PERF_ADVISOR_DEFAULTS.escalateMs + 1000);
  assert.equal(a.getLevel(), PERF_LEVELS.BAD);
});

test('the 48-54 band holds yellow (hysteresis, no flicker)', () => {
  const a = createPerfAdvisor({ escalateMs: Infinity });
  let { t } = run(a, 60, 0, 6000);
  ({ t } = run(a, 44, t, 8000));
  const { seen } = run(a, (tt) => (Math.floor(tt / 1000) % 2 ? 50 : 52), t, 60000);
  assert.deepEqual(seen, []);
  assert.equal(a.getLevel(), PERF_LEVELS.WARN);
});

test('a collapse goes straight to red', () => {
  const a = createPerfAdvisor();
  let { t } = run(a, 60, 0, 6000);
  const { seen } = run(a, 25, t, 10000);
  assert.equal(a.getLevel(), PERF_LEVELS.BAD);
  assert.equal(seen[seen.length - 1], PERF_LEVELS.BAD);
});

test('red resolves once the frame rate truly recovers', () => {
  const a = createPerfAdvisor();
  let { t } = run(a, 60, 0, 6000);
  ({ t } = run(a, 25, t, 10000));
  assert.equal(a.getLevel(), PERF_LEVELS.BAD);
  run(a, 59, t, 20000);
  assert.equal(a.getLevel(), PERF_LEVELS.OK);
});

test('reset (the player stepped down) clears and re-graces', () => {
  const a = createPerfAdvisor();
  let { t } = run(a, 60, 0, 6000);
  ({ t } = run(a, 30, t, 10000));
  assert.notEqual(a.getLevel(), PERF_LEVELS.OK);
  a.reset();
  assert.equal(a.getLevel(), PERF_LEVELS.OK);
  // The next preset's own compile hitch sits inside the grace.
  ({ t } = run(a, 15, t, 3000));
  run(a, 60, t, 20000);
  assert.equal(a.getLevel(), PERF_LEVELS.OK);
});

test('a pause or gap holds everything and re-graces', () => {
  const a = createPerfAdvisor();
  let { t } = run(a, 60, 0, 6000);
  ({ t } = run(a, 44, t, 2500)); // not yet held long enough
  a.sample(0, t, false);          // paused
  t += 60000;                     // a minute later
  ({ t } = run(a, 44, t, 2500));
  assert.equal(a.getLevel(), PERF_LEVELS.OK, 'the sag before the pause did not count');
});

test('force pins a level for captures and releases cleanly', () => {
  const a = createPerfAdvisor();
  assert.equal(a.force(PERF_LEVELS.BAD), PERF_LEVELS.BAD);
  run(a, 60, 0, 30000);
  assert.equal(a.getLevel(), PERF_LEVELS.BAD);
  a.force(null);
  assert.equal(a.getLevel(), PERF_LEVELS.OK);
  assert.equal(a.force('nonsense'), PERF_LEVELS.OK);
});

test('nextLighterPreset stops at the lightest', () => {
  assert.equal(nextLighterPreset(0, 4), 1);
  assert.equal(nextLighterPreset(2, 4), 3);
  assert.equal(nextLighterPreset(3, 4), -1);
  assert.equal(nextLighterPreset(-1, 4), -1);
});
