import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAME_MODES,
  DRONE_HUNTER_DURATION,
  COMBO_MAX,
  formatTime,
  createMiniGameState,
  resetMiniGameState,
  ringRushWon,
  droneHunterRemaining,
  droneHunterTimeUp,
  turretDefenseLost,
  nextWaveSpawnCount,
  applyKillScore,
  decayCombo,
  evaluateBest,
} from '../src/game/game-modes.js';

test('GAME_MODES enum values preserved verbatim', () => {
  assert.equal(GAME_MODES.CASUAL, 'casual');
  assert.equal(GAME_MODES.RING_RUSH, 'ring_rush');
  assert.equal(GAME_MODES.DRONE_HUNTER, 'drone_hunter');
  assert.equal(GAME_MODES.TURRET_DEFENSE, 'turret_defense');
  assert.equal(GAME_MODES.ZEN, 'zen');
});

test('formatTime formats M:SS.cc', () => {
  assert.equal(formatTime(0), '0:00.00');
  assert.equal(formatTime(5.5), '0:05.50');
  assert.equal(formatTime(65.25), '1:05.25');
  assert.equal(formatTime(125.5), '2:05.50');
});

test('createMiniGameState matches the documented defaults', () => {
  const s = createMiniGameState();
  assert.equal(s.active, false);
  assert.equal(s.ringsTotal, 10);
  assert.equal(s.combo, 1);
  assert.equal(s.wave, 1);
  assert.equal(s.lives, 3);
  assert.equal(s.waveSpawnCount, 3);
  assert.equal(s.started, false);
  assert.equal(s.waveComplete, false);
});

test('resetMiniGameState activates the run, zeroes counters, preserves ringsTotal', () => {
  const s = createMiniGameState();
  s.ringsTotal = 18;           // synced from real ring count by caller
  s.active = false;
  s.score = 999;
  s.combo = 4;
  s.wave = 7;
  s.lives = 0;
  s.waveComplete = true;
  const out = resetMiniGameState(s);
  assert.equal(out, s);        // mutates in place (zero-alloc)
  assert.equal(s.active, true);
  assert.equal(s.score, 0);
  assert.equal(s.combo, 1);
  assert.equal(s.wave, 1);
  assert.equal(s.lives, 3);
  assert.equal(s.waveSpawnCount, 3);
  assert.equal(s.waveComplete, false);
  // ringsTotal is intentionally NOT reset (the early-end-race fix)
  assert.equal(s.ringsTotal, 18);
});

test('Ring Rush win condition fires only when all spawned rings are collected', () => {
  const s = createMiniGameState();
  s.ringsTotal = 18;
  s.ringsCollected = 10;
  assert.equal(ringRushWon(s), false); // the old bug: 10 of 18 must NOT win
  s.ringsCollected = 18;
  assert.equal(ringRushWon(s), true);
  s.ringsCollected = 19;
  assert.equal(ringRushWon(s), true);  // >= guard
});

test('Drone Hunter 60s timer: remaining + time-up', () => {
  assert.equal(DRONE_HUNTER_DURATION, 60);
  assert.equal(droneHunterRemaining(0), 60);
  assert.equal(droneHunterRemaining(45), 15);
  assert.equal(droneHunterRemaining(75), 0); // clamps
  const s = createMiniGameState();
  s.time = 59.9;
  assert.equal(droneHunterTimeUp(s), false);
  s.time = 60;
  assert.equal(droneHunterTimeUp(s), true);
});

test('Turret Defense loss when lives hit zero', () => {
  const s = createMiniGameState();
  s.lives = 1;
  assert.equal(turretDefenseLost(s), false);
  s.lives = 0;
  assert.equal(turretDefenseLost(s), true);
  s.lives = -1;
  assert.equal(turretDefenseLost(s), true);
});

test('Turret Defense wave curve: wave N spawns 2 + N drones', () => {
  assert.equal(nextWaveSpawnCount(1), 3);
  assert.equal(nextWaveSpawnCount(2), 4);
  assert.equal(nextWaveSpawnCount(5), 7);
  assert.equal(nextWaveSpawnCount(10), 12);
});

test('applyKillScore: score scales by combo, combo bumps +0.25 capped at 5', () => {
  const s = createMiniGameState();
  // combo starts at 1: 100 * 1 = 100, combo -> 1.25
  let r = applyKillScore(s, 100);
  assert.equal(s.score, 100);
  assert.equal(s.combo, 1.25);
  assert.equal(s.comboTimer, 3);
  assert.deepEqual(r, { oldComboFloor: 1, newComboFloor: 1 });
  // push combo up to a floor crossing (1.75 -> 2.0)
  applyKillScore(s, 0); // 1.5
  applyKillScore(s, 0); // 1.75
  r = applyKillScore(s, 0); // 2.0
  assert.equal(s.combo, 2.0);
  assert.deepEqual(r, { oldComboFloor: 1, newComboFloor: 2 });
});

test('applyKillScore caps combo at COMBO_MAX', () => {
  const s = createMiniGameState();
  for (let i = 0; i < 100; i++) applyKillScore(s, 0);
  assert.equal(s.combo, COMBO_MAX);
  assert.equal(COMBO_MAX, 5);
});

test('decayCombo ticks the window and resets combo to 1 on lapse', () => {
  const s = createMiniGameState();
  s.combo = 3;
  s.comboTimer = 3;
  assert.equal(decayCombo(s, 1), false);
  assert.equal(s.comboTimer, 2);
  assert.equal(s.combo, 3);
  assert.equal(decayCombo(s, 2.5), true); // crosses zero
  assert.equal(s.combo, 1);
  // no-op when comboTimer already <= 0
  assert.equal(decayCombo(s, 1), false);
});

test('evaluateBest: Ring Rush (lower time is better)', () => {
  // no prior best -> any time is a record
  let r = evaluateBest(null, 12.5, { lowerIsBetter: true, parse: parseFloat });
  assert.deepEqual(r, { isNewBest: true, bestValue: 12.5 });
  // beats the saved best
  r = evaluateBest('20', 12.5, { lowerIsBetter: true, parse: parseFloat });
  assert.deepEqual(r, { isNewBest: true, bestValue: 12.5 });
  // does not beat
  r = evaluateBest('10', 12.5, { lowerIsBetter: true, parse: parseFloat });
  assert.deepEqual(r, { isNewBest: false, bestValue: 10 });
});

test('evaluateBest: Drone Hunter / Turret (higher is better)', () => {
  let r = evaluateBest(null, 500, { lowerIsBetter: false, parse: parseInt });
  assert.deepEqual(r, { isNewBest: true, bestValue: 500 });
  r = evaluateBest('300', 500, { lowerIsBetter: false, parse: parseInt });
  assert.deepEqual(r, { isNewBest: true, bestValue: 500 });
  r = evaluateBest('900', 500, { lowerIsBetter: false, parse: parseInt });
  assert.deepEqual(r, { isNewBest: false, bestValue: 900 });
  // wave best of 0 saved as "0" -> beating it returns the run
  r = evaluateBest('0', 1, { lowerIsBetter: false, parse: parseInt });
  assert.deepEqual(r, { isNewBest: true, bestValue: 1 });
});
