// tests/boot-flags.test.js — the Flags tab's URL arithmetic.
//
// The panel only navigates; everything it navigates TO is computed here, so
// a flag that reads back wrong or a reload that drops `?goto=` is a unit
// failure rather than a phone report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOT_FLAGS, bootFlagByKey, readBootFlag, withBootFlag, withoutBootFlags, anyBootFlagSet,
} from '../src/ui/boot-flags.js';

test('every flag has a unique key, a kind the panel renders, and a group', () => {
  const keys = new Set();
  for (const flag of BOOT_FLAGS) {
    assert.ok(!keys.has(flag.key), `duplicate key ${flag.key}`);
    keys.add(flag.key);
    assert.ok(['toggle', 'select'].includes(flag.kind), `${flag.key}: kind ${flag.kind}`);
    assert.ok(flag.group, `${flag.key}: no group`);
    assert.ok(flag.label, `${flag.key}: no label`);
    if (flag.kind === 'select') {
      assert.ok(Array.isArray(flag.options) && flag.options.length >= 2, `${flag.key}: options`);
      assert.equal(flag.options[0].value, null, `${flag.key}: first option must be the default (null)`);
    }
    if (flag.parent) assert.ok(bootFlagByKey(flag.parent), `${flag.key}: parent ${flag.parent} is not a flag`);
  }
});

test('the table names the opt-outs the game actually reads', () => {
  // Transcribed from the readers, not from CLAUDE.md: authored-textures.js's
  // regexes are `(bark|authored)=0` etc., and the city facade's is `city`,
  // which CLAUDE.md's own note spells `concrete`. The table has to follow the
  // code, because the code is what the reload will do.
  for (const key of ['authored', 'bark', 'stone', 'canyon', 'granite', 'snow', 'city', 'ground', 'groundbump',
    'feathers', 'feathernormals', 'skytex', 'smooth', 'leaves', 'snowline', 'levelturn', 'pionus', 'wing', 'bird', 'ibl', 'flight']) {
    assert.ok(bootFlagByKey(key), `no flag for ?${key}`);
  }
  for (const child of ['bark', 'stone', 'canyon', 'granite', 'snow', 'city', 'ground', 'groundbump', 'feathers']) {
    assert.equal(bootFlagByKey(child).parent, 'authored', `${child} must be a child of ?authored=0`);
  }
  assert.equal(bootFlagByKey('feathernormals').parent, undefined, 'feathernormals has its own reader with no authored parent');
});

test('a toggle reads ON by default and OFF at =0, with the leading ? optional', () => {
  assert.deepEqual(readBootFlag('', 'smooth'), { on: true, forcedOff: false });
  assert.deepEqual(readBootFlag('?debug=1', 'smooth'), { on: true, forcedOff: false });
  assert.deepEqual(readBootFlag('?smooth=0', 'smooth'), { on: false, forcedOff: false });
  assert.deepEqual(readBootFlag('debug=1&smooth=0', 'smooth'), { on: false, forcedOff: false });
  // `=1` is noise the game does not read; it is still ON.
  assert.deepEqual(readBootFlag('?smooth=1', 'smooth'), { on: true, forcedOff: false });
});

test('a child reads forced off while its parent is off', () => {
  assert.deepEqual(readBootFlag('?authored=0', 'bark'), { on: false, forcedOff: true });
  // Its own explicit =0 is not "forced" — it would stay off if the parent came back.
  assert.deepEqual(readBootFlag('?authored=0&bark=0', 'bark'), { on: false, forcedOff: false });
  assert.deepEqual(readBootFlag('?bark=0', 'authored'), { on: true, forcedOff: false });
});

test('a select reads its value, and an unknown value reads as the default', () => {
  assert.deepEqual(readBootFlag('', 'wing'), { value: null });
  assert.deepEqual(readBootFlag('?wing=slim', 'wing'), { value: 'slim' });
  assert.deepEqual(readBootFlag('?wing=banana', 'wing'), { value: null });
  assert.deepEqual(readBootFlag('?skytex=0.5', 'skytex'), { value: '0.5' });
  assert.deepEqual(readBootFlag('?bird=v2', 'bird'), { value: 'v2' });
});

test('the flight flag defaults to STUNT (null) and offers classic and v2', () => {
  // The default moved from v1 to the stunt model on 2026-09-19
  // (docs/realism/STUNT_FLIGHT_PLAN.md, gate G-STUNT-0), so `null` — the
  // absent flag — is now stunt, and the old default is reachable as
  // `classic`. The panel's convention is unchanged: null is whatever the
  // game boots with no flag at all.
  const flag = bootFlagByKey('flight');
  assert.ok(flag, 'no flag for ?flight');
  assert.equal(flag.kind, 'select');
  assert.deepEqual(flag.options.map((o) => o.value), [null, 'classic', 'v2']);
  assert.deepEqual(readBootFlag('', 'flight'), { value: null });
  assert.deepEqual(readBootFlag('?flight=classic', 'flight'), { value: 'classic' });
  assert.deepEqual(readBootFlag('?flight=v2', 'flight'), { value: 'v2' });
  // Same convention as every other select: an unknown value is the default,
  // not an error — the reload is what the panel navigates to, and the game's
  // own `/[?&]flight=(v1|classic|v2|stunt)(?:&|$)/` regex falls back to the
  // stunt default for anything it does not recognise.
  assert.deepEqual(readBootFlag('?flight=v9', 'flight'), { value: null });
  assert.equal(withBootFlag('', 'flight', 'classic'), 'flight=classic');
  assert.equal(withBootFlag('?flight=v2', 'flight', null), '');
});

test('withBootFlag turns a toggle off by writing =0 and on by REMOVING the key', () => {
  assert.equal(withBootFlag('', 'smooth', false), 'smooth=0');
  assert.equal(withBootFlag('?smooth=0', 'smooth', true), '');
  assert.equal(withBootFlag('?smooth=1', 'smooth', true), '');
});

test('withBootFlag keeps every other parameter — debug, goto, env, other flags', () => {
  const next = withBootFlag('?debug=1&goto=stone-arch&env=forest&leaves=0', 'smooth', false);
  const p = new URLSearchParams(next);
  assert.equal(p.get('debug'), '1');
  assert.equal(p.get('goto'), 'stone-arch');
  assert.equal(p.get('env'), 'forest');
  assert.equal(p.get('leaves'), '0');
  assert.equal(p.get('smooth'), '0');
});

test('withBootFlag sets a select value and removes it for the default', () => {
  assert.equal(withBootFlag('', 'wing', 'slim'), 'wing=slim');
  assert.equal(withBootFlag('?wing=slim', 'wing', null), '');
  assert.equal(withBootFlag('?wing=slim', 'wing', 'stocky'), 'wing=stocky');
  // An option the flag does not offer is treated as the default, never written.
  assert.equal(withBootFlag('', 'wing', 'banana'), '');
});

test('a round trip through withBootFlag reads back as written', () => {
  for (const flag of BOOT_FLAGS) {
    if (flag.kind === 'toggle') {
      const off = withBootFlag('?debug=1', flag.key, false);
      assert.equal(readBootFlag(off, flag.key).on, false, `${flag.key} off`);
      const on = withBootFlag(off, flag.key, true);
      assert.equal(readBootFlag(on, flag.key).on, true, `${flag.key} on`);
      assert.equal(on, 'debug=1', `${flag.key} on leaves only debug`);
    } else {
      for (const opt of flag.options) {
        const s = withBootFlag('?debug=1', flag.key, opt.value);
        assert.equal(readBootFlag(s, flag.key).value, opt.value, `${flag.key}=${opt.value}`);
      }
    }
  }
});

test('withoutBootFlags strips every flag and nothing else; anyBootFlagSet notices one', () => {
  const s = '?debug=1&smooth=0&wing=slim&goto=x&authored=0';
  assert.equal(withoutBootFlags(s), 'debug=1&goto=x');
  assert.equal(anyBootFlagSet(s), true);
  assert.equal(anyBootFlagSet('?debug=1&goto=x'), false);
  assert.equal(anyBootFlagSet(''), false);
});
