// The bird transaction (src/flight/species/bird-transaction.js): how the bird
// on the anchor is replaced, by a swap or a re-LOD. Proved here against a fake
// world whose every resource knows whether it is alive, with a failure
// injected at EVERY stage the harness can name (__BIRB.speciesFault) and at
// every hook directly:
//   before the mount   'stage', 'feathers', 'mount' (and any build/feathers/
//                      mount throw): the old bird keeps flying, every staged
//                      resource is disposed, the error reaches the caller
//                      (which keeps the saved choice)
//   a sky              'sky': lights only, one warning, the swap goes on
//   after the mount    'dispose', 'audio', 'sync' (and any teardown/audio/
//                      sync throw): the new bird flies, fully handed over,
//                      with one warning, and the steps after still run
// Also: the re-LOD retry gate, the shared PMREM generator's failed compile,
// and that index.html is wired to all of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBirdTransaction, createRetierGate, BIRD_FAULT_STAGES } from '../src/flight/species/bird-transaction.js';
import { sharedBirdPmrem } from '../src/flight/plumage.js';

// ------------------------------------------------------------ the fake world

function makeWorld({ from = 'birb', breaks = {} } = {}) {
  const live = new Set();
  const log = [];
  const res = (name) => {
    const r = {
      name,
      disposed: false,
      dispose() {
        if (breaks.dispose && breaks.dispose(name)) { log.push('throw dispose ' + name); throw new Error('broken dispose ' + name); }
        assert.ok(!r.disposed, 'disposed twice: ' + name);
        r.disposed = true;
        live.delete(r);
        log.push('dispose ' + name);
      },
    };
    live.add(r);
    return r;
  };
  let n = 0;
  // A bird as the page would build it: a Pionus has a model, a sky, authored
  // feathers and rim handles; a crow/owl a species bird (owning its model)
  // and a sky.
  const build = (species) => {
    const tag = species + '#' + (++n);
    if (breaks.build === species) throw new Error('broken build ' + tag);
    const model = res(tag + ' model');
    log.push('build ' + tag);
    if (species === 'birb') return { tag, model, sb: null, rim: ['rim ' + tag] };
    const sb = { model, dispose() { if (breaks.sbDispose) throw new Error('broken sb dispose'); model.dispose(); log.push('sb dispose ' + tag); } };
    return { tag, model, sb, rim: null };
  };
  const sky = (tag) => {
    if (breaks.sky) throw new Error('broken sky ' + tag);
    return res(tag + ' sky');
  };
  const feathers = (tag) => {
    if (breaks.feathers) throw new Error('broken feathers ' + tag);
    const sheets = res(tag + ' feathers');
    return () => sheets.dispose();
  };

  const page = { anchor: [], species: from, sb: null, env: null, feathers: null, rim: [], audio: [], syncs: 0, warnings: [], settles: 0 };
  // The boot bird, mounted.
  const first = build(from);
  page.anchor = [first.model];
  page.sb = first.sb;
  page.env = sky(first.tag);
  page.feathers = from === 'birb' ? feathers(first.tag) : null;
  page.rim = first.rim ? first.rim.slice() : [];
  page.bootResources = new Set(live);

  const hooks = {
    build(staged) {
      const b = build(staged.species);
      staged.tag = b.tag;
      staged.sb = b.sb;
      staged.model = b.model;
      // The Pionus pushes its rim handles into the shared list while it
      // builds; settle() must put the outgoing bird's back.
      if (b.rim) { staged.rim = b.rim; page.rim.push(...b.rim); }
    },
    sky: (staged) => sky(staged.tag),
    skyWarning: (staged) => (staged.sb ? '[species] bird sky failed' : '[plumage] bird sky failed'),
    feathers: (staged) => (staged.sb ? null : feathers(staged.tag)),
    settle() { page.settles += 1; page.rim = page.rimBefore.slice(); },
    outgoing: () => ({ sb: page.sb, model: page.anchor[0] || null, env: page.env, feathers: page.feathers }),
    mount(model) {
      page.anchor = [];
      if (breaks.mount && model !== breaks.mountSpare) throw new Error('broken mount');
      page.anchor = [model];
      log.push('mount ' + model.name);
    },
    mounted: () => page.anchor[0] || null,
    handover(staged) {
      page.sb = staged.sb;
      page.env = staged.env;
      page.feathers = staged.feathers;
      page.rim = staged.rim ? staged.rim.slice() : [];
      page.species = staged.species;
      log.push('handover ' + staged.species);
    },
    disposeModel: (model) => model.dispose(),
    audio(species) { if (breaks.audio) throw new Error('broken audio'); page.audio.push(species); log.push('audio ' + species); },
    sync() { if (breaks.sync) throw new Error('broken sync'); page.syncs += 1; log.push('sync'); },
    warn(message) { page.warnings.push(message); },
  };
  const tx = createBirdTransaction(hooks);
  // index.html's stageBird: remember the live rim handles, then stage.
  const swap = (to, quality = 'high') => {
    page.rimBefore = page.rim.slice();
    return tx.commit(tx.stage(to, quality));
  };
  return { tx, page, live, log, swap, hooks };
}

const names = (live) => [...live].map((r) => r.name).sort();

const ABORT = ['stage', 'feathers', 'mount'];
const ROUTES = [['birb', 'crow'], ['crow', 'owl'], ['owl', 'birb'], ['crow', 'birb']];

// ------------------------------------------------ the fault at EVERY stage

test('the harness can name exactly these stages, and an unknown one arms nothing', () => {
  assert.deepEqual([...BIRD_FAULT_STAGES], ['stage', 'sky', 'feathers', 'mount', 'dispose', 'audio', 'sync']);
  const { tx } = makeWorld();
  assert.equal(tx.fault('sky'), 'sky');
  assert.equal(tx.fault('nonsense'), null);
  assert.equal(tx.fault(null), null);
});

for (const stage of ABORT) {
  test(`fault '${stage}': the old bird keeps flying, everything staged is disposed, the caller gets the error`, () => {
    for (const [from, to] of ROUTES) {
      const { tx, page, live, swap } = makeWorld({ from });
      const before = { anchor: page.anchor[0], sb: page.sb, env: page.env, feathers: page.feathers, rim: page.rim.slice() };
      tx.fault(stage);
      assert.throws(() => swap(to), new RegExp(`injected ${stage} fault`), `${from}->${to}`);
      assert.equal(page.anchor.length, 1, `${from}->${to}: one bird on the anchor`);
      assert.equal(page.anchor[0], before.anchor, `${from}->${to}: the ${from} flies`);
      assert.equal(page.species, from);
      assert.equal(page.sb, before.sb);
      assert.equal(page.env, before.env);
      assert.equal(page.feathers, before.feathers);
      assert.deepEqual(page.rim, before.rim, 'the outgoing rim handles are back');
      assert.deepEqual(names(live), names(page.bootResources), `${from}->${to}: only the ${from}'s resources alive`);
      assert.ok([...page.bootResources].every((r) => !r.disposed), 'nothing of the flying bird was disposed');
      assert.deepEqual(page.audio, [], 'no voice switch');
      assert.equal(page.syncs, 0);
      assert.deepEqual(page.warnings, [], 'the transaction itself does not warn: the caller does, once');
      assert.equal(tx.armed(), null, 'the fault fired once');
      // ...and the next swap is clean.
      swap(to);
      assert.equal(page.species, to);
      assert.deepEqual(page.warnings, []);
    }
  });
}

test("fault 'sky': lights only, ONE warning, and the swap completes", () => {
  for (const [from, to] of ROUTES) {
    const { tx, page, live, swap } = makeWorld({ from });
    tx.fault('sky');
    swap(to);
    assert.equal(page.species, to, `${from}->${to}`);
    assert.equal(page.env, null, 'no sky');
    assert.deepEqual(page.warnings, [to === 'birb' ? '[plumage] bird sky failed' : '[species] bird sky failed']);
    assert.ok(names(live).every((n) => n.startsWith(to + '#')), `${from}->${to}: only the ${to} alive: ${names(live)}`);
    assert.ok(!names(live).some((n) => n.endsWith(' sky')));
    if (to === 'birb') assert.ok(page.feathers, 'the Pionus still gets its feathers');
    assert.deepEqual(page.audio, [to]);
    assert.equal(page.syncs, 1);
  }
});

for (const stage of ['dispose', 'audio', 'sync']) {
  test(`fault '${stage}': the new bird is mounted and handed over, ONE warning, and every other step still runs`, () => {
    for (const [from, to] of ROUTES) {
      const { tx, page, live, swap, log } = makeWorld({ from });
      tx.fault(stage);
      swap(to);
      assert.equal(page.anchor.length, 1);
      assert.ok(page.anchor[0].name.startsWith(to + '#'), `${from}->${to}: the ${to} is on the anchor`);
      assert.equal(page.species, to);
      assert.ok(page.env && page.env.name.startsWith(to + '#'), 'its sky handed over');
      assert.equal(!!page.sb, to !== 'birb');
      assert.equal(!!page.feathers, to === 'birb');
      assert.equal(page.warnings.length, 1, `${from}->${to}: ${page.warnings}`);
      assert.match(page.warnings[0], stage === 'dispose' ? /tear down/ : stage === 'audio' ? /flight audio/ : /shadow lever/);
      // The injected teardown fault fires once the teardown has run: the
      // outgoing bird is gone either way.
      assert.ok(names(live).every((n) => n.startsWith(to + '#')), `${from}->${to}: ${names(live)}`);
      assert.deepEqual(page.audio, stage === 'audio' ? [] : [to]);
      assert.equal(page.syncs, stage === 'sync' ? 0 : 1);
      assert.equal(tx.armed(), null);
      // The order: build, mount, hand over, THEN the outgoing teardown.
      const at = (s) => log.findIndex((l) => l.startsWith(s));
      assert.ok(at('build ' + to) < at('mount ') && at('mount ') < at('handover') && at('handover') < log.findIndex((l, i) => i > at('handover') && l.startsWith('dispose')));
    }
  });
}

// ------------------------------------------- the hooks themselves throwing

test('a build that throws: nothing mounted, nothing left alive, the rim handles restored', () => {
  for (const [from, to] of ROUTES) {
    const { page, live, swap } = makeWorld({ from, breaks: { build: to } });
    const rim = page.rim.slice();
    assert.throws(() => swap(to), /broken build/);
    assert.equal(page.species, from);
    assert.deepEqual(names(live), names(page.bootResources));
    assert.deepEqual(page.rim, rim);
    assert.equal(page.settles, 1);
  }
});

test('a staged sky that throws keeps the bird on its lights; a feathers hook that throws aborts and disposes the staged sky and model', () => {
  {
    const breaks = {};
    const { page, live, swap } = makeWorld({ from: 'crow', breaks });
    breaks.sky = true; // after the boot bird's own sky
    swap('birb');
    assert.equal(page.species, 'birb');
    assert.equal(page.env, null);
    assert.deepEqual(page.warnings, ['[plumage] bird sky failed']);
    assert.deepEqual(names(live).filter((n) => !n.startsWith('birb#')), []);
  }
  {
    const { page, live, swap } = makeWorld({ from: 'crow', breaks: { feathers: true } });
    assert.throws(() => swap('birb'), /broken feathers/);
    assert.equal(page.species, 'crow');
    assert.deepEqual(names(live), names(page.bootResources), 'the staged Pionus and its sky are gone');
  }
});

test('a mount that takes the old bird off the anchor and THEN throws puts the old bird back', () => {
  for (const [from, to] of ROUTES) {
    const w = makeWorld({ from, breaks: { mount: true } });
    const old = w.page.anchor[0];
    w.hooks.mount = ((mount) => (model) => {
      // Clears the anchor, then fails, unless it is putting `old` back.
      w.page.anchor = [];
      if (model !== old) throw new Error('broken mount');
      w.page.anchor = [model];
      void mount;
    })(w.hooks.mount);
    assert.throws(() => w.swap(to), /broken mount/);
    assert.deepEqual(w.page.anchor, [old], `${from}->${to}: the old bird is back on the anchor`);
    assert.equal(w.page.species, from);
    assert.deepEqual(names(w.live), names(w.page.bootResources), 'everything staged disposed');
  }
});

test('a teardown that throws part-way: every other piece of the outgoing bird is still released, one warning, audio and sync run', () => {
  // The Pionus going out: its sky's dispose throws, its feathers and model
  // are still released.
  {
    const { page, live, swap } = makeWorld({ from: 'birb', breaks: { dispose: (n) => n.startsWith('birb#1 sky') } });
    swap('crow');
    assert.equal(page.species, 'crow');
    assert.deepEqual(names(live).filter((n) => n.startsWith('birb#')), ['birb#1 sky'], 'only the broken piece is left');
    assert.equal(page.warnings.length, 1);
    assert.match(page.warnings[0], /tear down/);
    assert.deepEqual(page.audio, ['crow']);
    assert.equal(page.syncs, 1);
  }
  // A crow going out whose own dispose throws.
  {
    const { page, live, swap } = makeWorld({ from: 'crow', breaks: { sbDispose: true } });
    swap('owl');
    assert.equal(page.species, 'owl');
    assert.ok(!names(live).some((n) => n.endsWith(' sky') && n.startsWith('crow#')), 'the crow\'s sky still released');
    assert.equal(page.warnings.length, 1);
    assert.deepEqual(page.audio, ['owl']);
    assert.equal(page.syncs, 1);
  }
});

test('an audio switch or a sync that throws: the new bird flies, one warning each, the other still runs', () => {
  for (const which of ['audio', 'sync']) {
    const { page, swap } = makeWorld({ from: 'birb', breaks: { [which]: true } });
    swap('owl');
    assert.equal(page.species, 'owl');
    assert.equal(page.anchor[0].name, 'owl#2 model');
    assert.equal(page.warnings.length, 1, which);
    assert.equal(page.syncs, which === 'sync' ? 0 : 1);
    assert.deepEqual(page.audio, which === 'audio' ? [] : ['owl']);
  }
});

test('a clean swap: no warnings, the old bird entirely released, the new one entirely alive', () => {
  for (const [from, to] of ROUTES) {
    const { page, live, swap } = makeWorld({ from });
    swap(to);
    assert.deepEqual(page.warnings, []);
    assert.ok(names(live).every((n) => n.startsWith(to + '#')));
    assert.equal(names(live).length, to === 'birb' ? 3 : 2, 'model + sky (+ feathers)');
    assert.equal(page.settles, 1);
  }
});

// ------------------------------------------------------ the re-LOD gate

test('re-LOD gate: a failure blocks only that species at that tier', () => {
  const g = createRetierGate();
  assert.equal(g.allows('crow', 'low'), true);
  g.failed('crow', 'low');
  assert.deepEqual(g.blocked(), { species: 'crow', tier: 'low' });
  // The same request, over and over (every wobble of the tier): blocked.
  for (let i = 0; i < 5; i++) assert.equal(g.allows('crow', 'low'), false);
  // The tier moves (even back to the bird's own): unblocked, and low may be
  // tried again later.
  assert.equal(g.allows('crow', 'mid'), true);
  assert.equal(g.blocked(), null);
  assert.equal(g.allows('crow', 'low'), true);
  // A different bird asking for the failed tier is a different request.
  g.failed('crow', 'low');
  assert.equal(g.allows('owl', 'low'), true);
  assert.equal(g.blocked(), null);
});

test('re-LOD gate: a user action (picker, setSpecies, a quality preset) lifts it, and says whether it did', () => {
  const g = createRetierGate();
  assert.equal(g.reset(), false, 'nothing to lift');
  g.failed('owl', 'mid');
  assert.equal(g.allows('owl', 'mid'), false);
  assert.equal(g.reset(), true);
  assert.equal(g.allows('owl', 'mid'), true);
});

test('index.html: the re-LOD asks the gate (before its no-change test), records a failure in it, and user actions reset it', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('speciesRetierFailed'), 'the session-wide latch is gone');
  assert.ok(html.includes('const speciesRetierGate = createRetierGate();'));
  const retier = html.slice(html.indexOf('runSpeciesRetier = () => {'), html.indexOf('\n    };', html.indexOf('runSpeciesRetier = () => {')));
  const allows = retier.indexOf('if (!speciesRetierGate.allows(speciesBird.species, want)) return;');
  const same = retier.indexOf('if (want === speciesBird.quality) return;');
  assert.ok(allows > 0 && same > allows, 'a tier back to the bird\'s own lifts the block too');
  const fail = retier.slice(retier.indexOf('} catch (err) {'));
  assert.ok(fail.includes('speciesRetierGate.failed(speciesBird.species, want);'));
  // The picker / setSpecies, and a quality preset.
  const swap = html.slice(html.indexOf('const setBirdSpecies = async'), html.indexOf('const setBirdSpecies = async') + 900);
  assert.ok(swap.includes('if (speciesRetierGate.reset()) scheduleSpeciesRetier();'));
  const preset = html.slice(html.indexOf('function applyQualityPreset(index'), html.indexOf('function readQualityPresetState()'));
  assert.ok(preset.includes('if (speciesRetierGate.reset()) scheduleSpeciesRetier();'));
  // The gate exists before applyQualityPreset can first run (restoreQualityPreset).
  assert.ok(html.indexOf('const speciesRetierGate = createRetierGate();') < html.indexOf('\n    restoreQualityPreset();'));
});

test('index.html: __BIRB.speciesFault names a stage of THE transaction; true is the old "stage" fault', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes("speciesFault: (stage = 'stage') => birdTransaction.fault(stage === true ? 'stage' : stage === false ? null : stage),"));
  assert.ok(/var \{ createBirdTransaction, createRetierGate \} =\s*await import\("\.\/src\/flight\/species\/bird-transaction\.js"\);/.test(html));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./src/flight/species/bird-transaction.js',"), 'precached: it is on every boot');
});

// --------------------------------------------- the shared PMREM generator

function pmremThree() {
  const log = { made: 0, compiled: 0, disposed: 0, failCompile: 0 };
  class PMREMGenerator {
    constructor() { log.made += 1; this.disposed = false; }
    compileEquirectangularShader() {
      if (log.failCompile > 0) { log.failCompile -= 1; throw new Error('injected compile'); }
      log.compiled += 1;
    }
    dispose() { this.disposed = true; log.disposed += 1; }
  }
  return { THREE: { PMREMGenerator }, log };
}

test('sharedBirdPmrem: a compile that throws disposes the new generator, caches nothing, and rethrows; the next call succeeds', () => {
  const { THREE, log } = pmremThree();
  const renderer = {};
  log.failCompile = 2;
  assert.throws(() => sharedBirdPmrem(THREE, renderer), /injected compile/);
  assert.deepEqual({ made: log.made, disposed: log.disposed, compiled: log.compiled }, { made: 1, disposed: 1, compiled: 0 });
  // Not cached: the next call tries again (and here fails again, the same way).
  assert.throws(() => sharedBirdPmrem(THREE, renderer), /injected compile/);
  assert.deepEqual({ made: log.made, disposed: log.disposed }, { made: 2, disposed: 2 });
  // The fault is gone: a working generator, compiled once, cached from now on.
  const g = sharedBirdPmrem(THREE, renderer);
  assert.equal(g.disposed, false);
  assert.equal(sharedBirdPmrem(THREE, renderer), g);
  assert.deepEqual({ made: log.made, disposed: log.disposed, compiled: log.compiled }, { made: 3, disposed: 2, compiled: 1 });
});

test('index.html: a failed generator reaches the sky fallback (lights only, one warning), never the bird build', () => {
  // bakeBirdSky calls sharedBirdPmrem INSIDE its try, so a compile failure is
  // the sky's failure: the transaction's sky step warns and the swap goes on;
  // at boot makeBirdSky warns and returns null.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bake = html.slice(html.indexOf('const bakeBirdSky = (materials) => {'), html.indexOf('const makeBirdSky = '));
  const tryAt = bake.indexOf('try {');
  assert.ok(tryAt > 0 && bake.indexOf('sharedBirdPmrem(THREE, renderer)') > tryAt);
  assert.ok(bake.includes('throw err;'));
});
