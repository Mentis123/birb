// tools/species-frame-budget.mjs's verdict, on hand-made rows: the two
// budgets (SCENE = renderer.info over the frame's renders, CLAUDE.md's
// "<100 draw calls, <80k triangles"; SHADOW-INCLUSIVE = every draw WebGL
// received, the shadow map included), the 78k Ultra-forest headroom and who
// owns a breach of it (the species, or the world), and the distributions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verdict, worldBreaches, speciesHeadroomBreaches, distributions, spread, LIMITS, PIONUS_TRIANGLES,
} from '../tools/species-frame-budget.mjs';
import { BIRD_BUDGET } from '../src/flight/bird-contract.js';

const row = (o = {}) => Object.assign({
  species: 'crow', quality: 'ultra', renderTier: 0, scenario: 'forest-spawn', bootSeed: 1,
  frameTriangles: 76000, frameDrawCalls: 30, glTriangles: 110000, glDrawCalls: 42,
  birdTriangles: 2604, birdDrawCalls: 7, worldTriangles: 76000 - 2604, errors: [], warnings: [],
}, o);

test('a row inside both budgets passes', () => {
  assert.deepEqual(verdict([row()]), []);
});

test('REGRESSION: the scene total passes, the shadow-inclusive total breaches — the verdict fails', () => {
  // 77k in renderer.info, but three drew the shadow map before it reset:
  // the frame actually handed WebGL 121k triangles.
  const r = row({ frameTriangles: 77000, worldTriangles: 77000 - 2604, glTriangles: 121000 });
  assert.ok(r.frameTriangles < LIMITS.triangles && r.frameTriangles <= LIMITS.forestUltra, 'the scene gate alone would pass it');
  const fails = verdict([r]);
  assert.equal(fails.length, 1, fails.join('\n'));
  assert.match(fails[0], /shadow-inclusive 121000 tris >= 120000/);
  // Draws too.
  assert.match(verdict([row({ glDrawCalls: 100 })])[0], /shadow-inclusive 100 draws >= 100/);
});

test('a row with no GL count cannot pass: unjudged is a failure', () => {
  assert.match(verdict([row({ glTriangles: null })])[0], /no shadow-inclusive \(GL\) count/);
});

test('a GL count BELOW the scene count is a counter that missed the frame: a failure, not a pass', () => {
  // Seen on a v88 mountain row (14,844 against 30,748) before GL_COUNTER
  // bracketed the game's own rAF callbacks.
  assert.match(verdict([row({ scenario: 'biome-mountain', frameTriangles: 30748, worldTriangles: 28164, glTriangles: 14844 })])[0],
    /shadow-inclusive 14844 < scene 30748: the GL counter missed the frame/);
});

test('the scene budget is still gated on its own (80k / 100)', () => {
  const fails = verdict([row({ frameTriangles: 80000, worldTriangles: 77396, glTriangles: 110000, scenario: 'boost' })]);
  assert.ok(fails.some((f) => /scene 80000 tris >= 80000/.test(f)), fails.join('\n'));
  assert.match(verdict([row({ frameDrawCalls: 100 })])[0], /scene 100 draws >= 100/);
});

test('the 78k headroom: a crow/owl over it where the Pionus would fit is the SPECIES\' breach — failed on the fixed seeds, on random boots with strictHeadroom', () => {
  // world 75,500: the Pionus reads 77,018, the crow 78,104.
  const r = row({ frameTriangles: 75500 + 2604, worldTriangles: 75500 });
  assert.deepEqual(verdict([r]), [], 'a random boot: listed, not failed, by default');
  assert.deepEqual(speciesHeadroomBreaches([r]).map((b) => [b.id, b.over, b.pionusWouldRead]), [['crow/ultra/forest-spawn@seed1', 104, 77018]]);
  const strict = verdict([r], { strictHeadroom: true });
  assert.equal(strict.length, 1);
  assert.match(strict[0], /crow\/ultra\/forest-spawn@seed1: Ultra forest 78104 tris > 78000 where the Pionus would read 77018/);
  assert.deepEqual(worldBreaches([r]), []);
  // The fixed-seed forest always fails.
  assert.equal(verdict([Object.assign({}, r, { scenario: 'forest-seeds', bootSeed: null })]).length, 1);
});

test("the 78k headroom: a world over it BY ITSELF is the world's breach — reported, not a species failure", () => {
  // world 76,700: the Pionus would read 78,218 there.
  const crow = row({ frameTriangles: 76700 + 2604, worldTriangles: 76700 });
  assert.deepEqual(verdict([crow], { strictHeadroom: true }), [], 'held to 80k, not to the headroom, even strict');
  assert.deepEqual(speciesHeadroomBreaches([crow]), []);
  const birb = row({ species: 'birb', frameTriangles: 76700 + PIONUS_TRIANGLES, worldTriangles: 76700, birdTriangles: PIONUS_TRIANGLES, birdDrawCalls: 9 });
  assert.deepEqual(verdict([birb]), [], 'the Pionus is never failed for its world');
  const wb = worldBreaches([crow, birb]);
  assert.equal(wb.length, 2);
  assert.deepEqual(wb.map((b) => [b.species, b.worldTriangles, b.pionusWouldRead]), [['crow', 76700, 78218], ['birb', 76700, 78218]]);
  // Not an Ultra forest row: no headroom at all.
  assert.deepEqual(worldBreaches([row({ scenario: 'boost', frameTriangles: 79000, worldTriangles: 76396 })]), []);
});

test('forest-seeds is judged SEED BY SEED: a species breach at one seed is not hidden by a heavier world at another', () => {
  // Seed A: world 75,500 -> crow 78,084 (Pionus 77,018: the species broke it).
  // Seed B: world 76,600 -> crow 79,184 (Pionus 78,118: the world's). The
  // row's max (B) alone would file the row as a world breach and pass.
  const bird = 2584;
  const r = row({
    scenario: 'forest-seeds', bootSeed: null, birdTriangles: bird,
    frameTriangles: 76600 + bird, worldTriangles: 76600,           // the row's max: seed 2
    perSeed: [
      { seed: 1, frameTriangles: 75500 + bird, birdTriangles: bird, frameDrawCalls: 30, glTriangles: 110000, glDrawCalls: 40 },
      { seed: 2, frameTriangles: 76600 + bird, birdTriangles: bird, frameDrawCalls: 30, glTriangles: 111000, glDrawCalls: 40 },
    ],
  });
  const fails = verdict([r]);
  assert.equal(fails.length, 1, fails.join('\n'));
  assert.match(fails[0], /crow\/ultra\/forest-seeds@world1: Ultra forest 78084 tris > 78000 where the Pionus would read 77018/);
  assert.deepEqual(worldBreaches([r]).map((b) => b.id), ['crow/ultra/forest-seeds@world2']);
  assert.deepEqual(speciesHeadroomBreaches([r]).map((b) => b.id), ['crow/ultra/forest-seeds@world1']);
});

test('nothing measured is not a pass, and a missing bird count fails BIRD_BUDGET', () => {
  assert.match(verdict([]).join(), /no rows/);
  assert.match(verdict([row({ birdTriangles: null })]).join(), /BIRD_BUDGET 4000 \(or missing\)/);
  // Rows from older JSON without errors/warnings arrays are judged, not thrown on.
  const old = row();
  delete old.errors; delete old.warnings;
  assert.deepEqual(verdict([old]), []);
});

test('BIRD_BUDGET is gated on the crow and the owl, reported on the Pionus', () => {
  assert.match(verdict([row({ birdTriangles: 4001 })]).join(), /BIRD_BUDGET/);
  assert.deepEqual(verdict([row({ species: 'birb', birdTriangles: PIONUS_TRIANGLES, birdDrawCalls: 9, frameTriangles: 75000, worldTriangles: 75000 - PIONUS_TRIANGLES })]), []);
});

test('the 120k shadow-inclusive limit is the worst Pionus frame measured plus the bird budget drawn twice', () => {
  const worstPionusInclusive = 113768; // v86, random boot, Ultra forest spawn
  assert.ok(worstPionusInclusive + 2 * (BIRD_BUDGET.maxTriangles - PIONUS_TRIANGLES) <= LIMITS.inclusive.triangles);
  assert.equal(LIMITS.inclusive.drawCalls, LIMITS.drawCalls);
});

test('spread: min / median / p95 / max by nearest rank, non-numbers ignored', () => {
  const v = Array.from({ length: 20 }, (_, i) => 100 + i);
  assert.deepEqual(spread(v), { n: 20, min: 100, median: 109, p95: 118, max: 119 });
  assert.deepEqual(spread([5, null, NaN, 3]), { n: 2, min: 3, median: 3, p95: 5, max: 5 });
  assert.equal(spread([]), null);
});

test('distributions: one group per species x quality x scenario; forest-seeds counts every world seed', () => {
  const rows = [
    row({ bootSeed: 1, frameTriangles: 76000 }), row({ bootSeed: 2, frameTriangles: 77000, glTriangles: 112000 }),
    row({
      scenario: 'forest-seeds', bootSeed: null, frameTriangles: 77500,
      perSeed: [{ seed: 1, frameTriangles: 77000, frameDrawCalls: 29, glTriangles: 111000, glDrawCalls: 40, birdTriangles: 2604 },
        { seed: 2, frameTriangles: 77500, frameDrawCalls: 30, glTriangles: 111500, glDrawCalls: 41, birdTriangles: 2604 }],
    }),
  ];
  const d = distributions(rows);
  assert.deepEqual(Object.keys(d), ['crow/ultra/forest-spawn', 'crow/ultra/forest-seeds']);
  assert.deepEqual(d['crow/ultra/forest-spawn'].scene, { n: 2, min: 76000, median: 76000, p95: 77000, max: 77000 });
  assert.deepEqual(d['crow/ultra/forest-spawn'].inclusive, { n: 2, min: 110000, median: 110000, p95: 112000, max: 112000 });
  assert.equal(d['crow/ultra/forest-seeds'].samples, 2);
  assert.deepEqual(d['crow/ultra/forest-seeds'].world, { n: 2, min: 74396, median: 74396, p95: 74896, max: 74896 });
});
