// The bird picker's resolution rules (src/flight/species/species-select.js):
// URL > saved > default, the Pionus A/B flags untouched, invalid values
// harmless, and the default boot path pinned to the Pionus with no species
// builder loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPECIES, DEFAULT_SPECIES, SPECIES_STORAGE_KEY, SPECIES_LABELS,
  resolveSpecies, readSavedSpecies, writeSavedSpecies, nextSpecies, birdParam, isSpecies,
} from '../src/flight/species/species-select.js';

function store(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    map: m,
  };
}

test('three species, birb first and the default, stored under birb.species', () => {
  assert.deepEqual([...SPECIES], ['birb', 'crow', 'owl']);
  assert.equal(DEFAULT_SPECIES, 'birb');
  assert.equal(SPECIES_STORAGE_KEY, 'birb.species');
  assert.deepEqual({ ...SPECIES_LABELS }, { birb: 'Birb', crow: 'Crow', owl: 'Clockwork Owl' });
});

test('no URL, nothing saved: the Pionus (v3)', () => {
  assert.deepEqual(resolveSpecies('', store()), { species: 'birb', source: 'default', variant: 'v3' });
  assert.deepEqual(resolveSpecies('?debug=1', null), { species: 'birb', source: 'default', variant: 'v3' });
});

test('the saved choice applies when the URL says nothing', () => {
  assert.deepEqual(resolveSpecies('?debug=1', store({ 'birb.species': 'owl' })), { species: 'owl', source: 'saved', variant: 'v3' });
  assert.deepEqual(resolveSpecies('', store({ 'birb.species': 'crow' })), { species: 'crow', source: 'saved', variant: 'v3' });
});

test('?bird=crow|owl|birb wins over the saved choice', () => {
  const s = store({ 'birb.species': 'owl' });
  assert.equal(resolveSpecies('?bird=crow', s).species, 'crow');
  assert.equal(resolveSpecies('?debug=1&bird=birb', s).species, 'birb');
  assert.equal(resolveSpecies('?bird=owl&debug=1', store({ 'birb.species': 'crow' })).species, 'owl');
  assert.equal(resolveSpecies('?bird=crow', s).source, 'url');
});

test('the URL override is not written back', () => {
  const s = store({ 'birb.species': 'owl' });
  resolveSpecies('?bird=crow', s);
  assert.equal(s.getItem('birb.species'), 'owl');
  const empty = store();
  resolveSpecies('?bird=owl', empty);
  assert.equal(empty.map.size, 0);
});

test('?bird=v1|v2|v3 keep working exactly as the Pionus A/B: species birb, that variant, even over a saved crow', () => {
  const s = store({ 'birb.species': 'crow' });
  for (const v of ['v1', 'v2', 'v3']) {
    assert.deepEqual(resolveSpecies(`?bird=${v}`, s), { species: 'birb', source: 'url', variant: v });
    assert.deepEqual(resolveSpecies(`?debug=1&bird=${v}&x=1`, s), { species: 'birb', source: 'url', variant: v });
  }
});

test('index.html still resolves the A/B variant with its own, unchanged regex', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes("((/[?&]bird=(v1|v2|v3)(?:&|$)/.exec(window.location?.search || '') || [])[1] || 'v3')"),
    'the v1/v2/v3 selector line must be byte-identical');
});

test('invalid values fall back: a bad URL value is ignored, a bad saved value is absent', () => {
  assert.deepEqual(resolveSpecies('?bird=eagle', store()), { species: 'birb', source: 'default', variant: 'v3' });
  assert.equal(resolveSpecies('?bird=eagle', store({ 'birb.species': 'owl' })).species, 'owl');
  assert.equal(resolveSpecies('?bird=', store()).species, 'birb');
  assert.equal(resolveSpecies('', store({ 'birb.species': 'v1' })).species, 'birb');
  assert.equal(resolveSpecies('', store({ 'birb.species': 'CROW' })).species, 'birb');
  assert.equal(readSavedSpecies(store({ 'birb.species': '' })), null);
});

test('case and encoding of the URL value are tolerated', () => {
  assert.equal(birdParam('?bird=Crow'), 'crow');
  assert.equal(resolveSpecies('?bird=OWL', store()).species, 'owl');
  assert.equal(birdParam('?bird=%63row'), 'crow');
  assert.equal(birdParam('?x=1'), null);
});

test('a storage that throws never breaks the boot', () => {
  const evil = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(resolveSpecies('', evil), { species: 'birb', source: 'default', variant: 'v3' });
  assert.equal(writeSavedSpecies(evil, 'crow'), false);
});

test('writeSavedSpecies stores only the three ids', () => {
  const s = store();
  assert.equal(writeSavedSpecies(s, 'owl'), true);
  assert.equal(s.getItem('birb.species'), 'owl');
  assert.equal(writeSavedSpecies(s, 'v2'), false);
  assert.equal(writeSavedSpecies(s, 'eagle'), false);
  assert.equal(s.getItem('birb.species'), 'owl');
});

test('the settings cycle: birb -> crow -> owl -> birb', () => {
  assert.equal(nextSpecies('birb'), 'crow');
  assert.equal(nextSpecies('crow'), 'owl');
  assert.equal(nextSpecies('owl'), 'birb');
  assert.equal(nextSpecies('nonsense'), 'crow');
  for (const s of SPECIES) assert.ok(isSpecies(s));
  assert.ok(!isSpecies('v3'));
});

// ---- the default path is the Pionus, and builds nothing new --------------

test('species-select.js is pure and imports nothing (it is the only species module on every boot)', () => {
  const src = readFileSync(new URL('../src/flight/species/species-select.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'no static imports');
  assert.ok(!/import\s*\(/.test(src), 'no dynamic imports');
  assert.ok(!/\b(document|window)\b\./.test(src), 'no DOM');
});

test('index.html: the species builder is imported lazily and only off the birb path', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // No static import of the builder anywhere.
  assert.ok(!/import\s*\{[^}]*\}\s*from\s*['"]\.\/src\/flight\/species\/species-bird\.js['"]/.test(html));
  const boot = html.indexOf("if (birbSpecies === 'birb') {");
  assert.ok(boot > 0, 'the boot branches on the resolved species');
  const birbArm = html.slice(boot, html.indexOf('} else {', boot));
  const order = ['makePionusModel()', 'positionBirbModel(pionus)', 'makePionusSky(pionus)', 'makePionusFeathers(pionus)']
    .map((s) => birbArm.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])),
    `the birb arm builds and mounts the Pionus, then its plumage sky and feathers, in that order (${order})`);
  assert.ok(!birbArm.includes('species-bird.js') && !birbArm.includes('createSpeciesBird'),
    'the birb arm neither imports nor constructs a species bird');
  // Every import of the builder sits behind a non-birb condition.
  const imports = [...html.matchAll(/import\('\.\/src\/flight\/species\/species-bird\.js'\)/g)].map((m) => m.index);
  assert.ok(imports.length >= 1);
  for (const at of imports) {
    const before = html.slice(Math.max(0, at - 400), at);
    assert.ok(/\} else \{|id !== 'birb'/.test(before), 'species-bird.js is only imported for a crow or an owl');
  }
});

const bodyOf = (html, header) => {
  const at = html.indexOf(header);
  assert.ok(at > 0, header);
  return html.slice(at, html.indexOf('\n    };', at));
};

test('index.html: a swap and a re-LOD STAGE the incoming bird complete, then COMMIT, then tear down the old one', () => {
  // The procedural feather textures are refcounted; teardown first would drop
  // them to zero and regenerate all ten on every swap and every re-tier. And
  // a build that throws must leave the outgoing bird flying.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // STAGE never touches the anchor; it unwinds everything it made on a throw.
  const stage = bodyOf(html, 'const stageBird = (id, quality) => {');
  assert.ok(!stage.includes('mountBirbModel(') && !stage.includes('birbAnchor.clear') && !stage.includes('positionBirbModel('),
    'staging builds off the anchor');
  for (const s of ['makePionusModel()', 'makePionusSky(', 'makePionusFeathers(', 'makeSpeciesBird(', 'makeBirdSky(', 'prepareBirbModel(']) {
    assert.ok(stage.includes(s), `staging includes ${s} (the Pionus's post-build hooks too)`);
  }
  const unwind = stage.slice(stage.indexOf('} catch (err) {'));
  for (const s of ['staged.feathers()', 'staged.env.dispose()', 'staged.sb.dispose()', 'disposeBirdObject(staged.model)', 'throw err']) {
    assert.ok(unwind.includes(s), `a failed stage unwinds: ${s}`);
  }
  // COMMIT mounts first, hands the references over, then disposes the old.
  const commit = bodyOf(html, 'const commitBird = (staged) => {');
  const mount = commit.indexOf('mountBirbModel(staged.model)');
  assert.ok(mount > 0 && commit.indexOf('outEnv.dispose()') > mount && commit.indexOf('outSb.dispose()') > mount
    && commit.indexOf('disposeBirdObject(outModel)') > mount, 'the outgoing bird is torn down after the new one is mounted');
  assert.ok(commit.indexOf('syncSwappedBird();') > commit.indexOf('outSb.dispose()'), 'the mounted bird inherits shadows/rim');
  // The swap: stage, commit, and only then persist the choice.
  const swap = bodyOf(html, 'const setBirdSpecies = async');
  const st = swap.indexOf('stageBird(');
  const cm = swap.indexOf('commitBird(staged)');
  const save = swap.indexOf('writeSavedSpecies(', cm);
  assert.ok(st > 0 && cm > st && save > cm, `stage ${st} < commit ${cm} < persist ${save}`);
  assert.ok(/try \{[\s\S]*\} catch \(err\) \{[\s\S]*console\.warn/.test(swap), 'the swap never rejects');
  // The re-LOD is the same transaction.
  assert.ok(bodyOf(html, 'runSpeciesRetier = () => {').includes('commitBird(stageBird('));
});

test('index.html: nothing is built inside renderFrame; the species hook does nothing while the Pionus flies', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const at = html.indexOf('speciesBird.update(_speciesFrame)');
  assert.ok(at > 0);
  const guard = html.lastIndexOf('if (speciesBird) {', at);
  assert.ok(guard > 0 && at - guard < 1200, 'the update sits inside if (speciesBird)');
  // The re-LOD is a deferred task, requested by the tier controller and run
  // between frames: renderFrame itself constructs no bird and bakes no probe.
  const frame = bodyOf(html, 'const renderFrame = (time = 0) => {');
  for (const s of ['stageBird(', 'commitBird(', 'makeSpeciesBird(', 'createSpeciesBird(', 'createBirdEnvironment(', 'makeBirdSky(', 'runSpeciesRetier(', 'respeciesForTier(']) {
    assert.ok(!frame.includes(s), `renderFrame must not call ${s}`);
  }
  const sched = bodyOf(html, 'const scheduleSpeciesRetier = () => {');
  assert.ok(sched.includes('setTimeout(') && sched.includes('speciesRetierQueued'), 'one coalesced task');
  const applyTier = html.slice(html.indexOf('function applyTier(newTier) {'), html.indexOf('return {', html.indexOf('function applyTier(newTier) {')));
  assert.ok(applyTier.includes('scheduleSpeciesRetier();'), 'every tier change asks for it');
});
