/**
 * The manifest that guards the oracles needs a guard of its own.
 *
 * `tools/oracle-manifest.txt` exists so that a wave which "fixes" a failing
 * assertion by editing the assertion is LOUD rather than invisible. But the
 * manifest documented its own regeneration as a shell one-liner with the
 * non-tests paths written out literally, and seven oracles were added to the
 * manifest after that line was written without it being updated. Running the
 * documented command on 2026-09-13 would have dropped all seven — including
 * `tools/lib/quality-captures.mjs`, the file `G-A5-DRIFT` is blocked on —
 * as a diff that looks exactly like a routine re-hash.
 *
 * So the regenerator is now a script, and these are the properties that make
 * it safe to run. See docs/perf/gates/G-R5-DRIFT.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { regenerate, withoutProvenance } from '../tools/oracle-manifest-regen.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(REPO_ROOT, 'tools/oracle-manifest.txt');
const read = () => readFileSync(MANIFEST, 'utf8');
const pathsOf = (text) => text.split('\n')
    .map((l) => /^[0-9a-f]{64}  (.+)$/.exec(l))
    .filter(Boolean).map((m) => m[1]);

test('the committed manifest is current — regenerating it changes nothing', () => {
    // Everything but the provenance line, which is self-referential: it
    // names the head the regeneration ran at, which is by construction the
    // commit BEFORE the one the manifest lands in.
    const before = read();
    const after = regenerate(before, { head: 'any', date: 'any' });
    assert.equal(withoutProvenance(after), withoutProvenance(before));
});

test('regeneration is idempotent — the provenance note does not grow a line per run', () => {
    // It did. The replace matched the explanatory lines under `# Generated`
    // with `(?:\n#.*)*` and re-appended the last of them every time.
    const opts = { head: 'abc1234', date: '2026-01-01' };
    const once = regenerate(read(), opts);
    assert.equal(regenerate(once, opts), once);
    const notes = once.split('\n').filter((l) => l.startsWith('# Generated'));
    assert.equal(notes.length, 1, 'exactly one provenance line');
});

test('regeneration is ADDITIVE — it never drops a path that is already listed', () => {
    const before = read();
    const after = regenerate(before, { head: 'abc1234', date: '2026-01-01' });
    const kept = new Set(pathsOf(after));
    for (const p of pathsOf(before)) assert.ok(kept.has(p), `dropped ${p}`);
});

test('the seven oracles the old shell command would have unfrozen are pinned', () => {
    // Each of these is in the manifest and was NOT in the documented
    // `printf` list, so a hand-run regeneration would have silently
    // released it. quality-captures.mjs is the one G-A5-DRIFT is blocked on.
    const listed = new Set(pathsOf(read()));
    for (const p of [
        'tools/req-verify.mjs',
        'tools/birb-quality.mjs',
        'tools/lib/quality-assertions.mjs',
        'tools/lib/quality-captures.mjs',
        'docs/perf/EXPECTED-RED.md',
        'docs/perf/ASSERTIONS.md',
        'src/environment/seeded-random.js',
    ]) assert.ok(listed.has(p), `${p} is no longer pinned`);
});

test('a listed path that is gone from disk is a hard error, never a silent drop', () => {
    const poisoned = read().replace(
        /^([0-9a-f]{64})  tools\/birb-shot\.mjs$/m,
        '$1  tools/this-oracle-was-deleted.mjs',
    );
    assert.match(poisoned, /this-oracle-was-deleted/);
    assert.throws(
        () => regenerate(poisoned, { head: 'abc1234', date: '2026-01-01' }),
        /listed but absent: tools\/this-oracle-was-deleted\.mjs/,
    );
});

test('every tests/** file on disk is pinned — the suite cannot grow unguarded', () => {
    // 45 of 90 test files were unpinned before 2026-09-13, because only the
    // tests that existed when the manifest was first written were ever listed.
    const listed = new Set(pathsOf(read()));
    const onDisk = execFileSync('find', ['tests', '-type', 'f'], { cwd: REPO_ROOT })
        .toString().trim().split('\n');
    const missing = onDisk.filter((p) => !listed.has(p));
    assert.deepEqual(missing, [], `unpinned test files: ${missing.join(', ')}`);
});
