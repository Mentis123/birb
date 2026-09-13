#!/usr/bin/env node
/**
 * oracle-manifest-regen.mjs — regenerate tools/oracle-manifest.txt in place.
 *
 * WHY THIS IS A SCRIPT AND NOT A SHELL ONE-LINER IN THE HEADER.
 *
 * The manifest used to document its own regeneration as a `find tests -type f`
 * plus a literal `printf` list of six non-tests paths. Later waves added seven
 * more oracles to the manifest and nobody updated that printf, so by
 * 2026-09-13 running the documented command would have DROPPED
 * tools/req-verify.mjs, tools/birb-quality.mjs, tools/lib/quality-assertions.mjs,
 * tools/lib/quality-captures.mjs, docs/perf/EXPECTED-RED.md,
 * docs/perf/ASSERTIONS.md and src/environment/seeded-random.js from the freeze
 * — silently, in a diff that looks like a routine re-hash.
 *
 * That is precisely the failure this manifest exists to catch, displaced one
 * level up: an oracle deleted rather than a defect fixed. So the rule here is
 * ADDITIVE ONLY:
 *
 *   - every path already listed is re-hashed and kept, in its existing section;
 *   - every file under tests/ that nothing pins yet is added to the tests block;
 *   - a listed path that no longer exists on disk is a hard error, not a
 *     silent drop. Deleting an oracle has to be deliberate: remove the line by
 *     hand, in the commit that removes the file, with the gate decision beside it.
 *
 * Comment blocks, section headers and ordering are preserved verbatim; only the
 * hash lines and the provenance line are rewritten.
 *
 * Usage:
 *   node tools/oracle-manifest-regen.mjs           # rewrite in place
 *   node tools/oracle-manifest-regen.mjs --check   # exit 1 if it would change anything
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(REPO_ROOT, 'tools/oracle-manifest.txt');
const HASH_LINE = /^[0-9a-f]{64}  .+$/;

const sha256 = (rel) => createHash('sha256')
    .update(readFileSync(path.join(REPO_ROOT, rel)))
    .digest('hex');

function walk(dir, out = []) {
    for (const entry of readdirSync(path.join(REPO_ROOT, dir))) {
        const rel = `${dir}/${entry}`;
        if (statSync(path.join(REPO_ROOT, rel)).isDirectory()) walk(rel, out);
        else out.push(rel);
    }
    return out;
}

export function regenerate(text, { head = 'unknown', date = 'unknown' } = {}) {
    // Split into alternating comment runs and hash runs so every comment,
    // section header and blank line survives byte for byte.
    const blocks = [];
    for (const line of text.split('\n')) {
        const m = line.match(/^([0-9a-f]{64})  (.+)$/);
        const kind = m ? 'hash' : 'text';
        if (!blocks.length || blocks.at(-1).kind !== kind) blocks.push({ kind, items: [] });
        blocks.at(-1).items.push(m ? m[2] : line);
    }

    const listed = blocks.filter((b) => b.kind === 'hash').flatMap((b) => b.items);
    const gone = listed.filter((p) => !existsSync(path.join(REPO_ROOT, p)));
    if (gone.length) {
        throw new Error(
            `listed but absent: ${gone.join(', ')}\n` +
            'Refusing to drop an oracle silently. Remove the line by hand, in the commit ' +
            'that removes the file, with the gate decision beside it.',
        );
    }

    const unpinned = walk('tests').filter((p) => !listed.includes(p)).sort();

    let addedTo = false;
    const out = [];
    for (const block of blocks) {
        if (block.kind === 'text') { out.push(...block.items); continue; }
        let items = block.items;
        if (!addedTo && items.every((p) => p.startsWith('tests/'))) {
            items = [...new Set([...items, ...unpinned])].sort();
            addedTo = true;
        }
        out.push(...items.map((p) => `${sha256(p)}  ${p}`));
    }
    if (!addedTo) throw new Error('no all-tests/ hash block to extend');

    // ONE line, replaced wholesale. An earlier version of this matched the
    // explanatory note under it as well, with `(?:\n#.*)*` — which re-appended
    // the note's last line on every run, so the script was not idempotent and
    // the manifest grew a line per regeneration. Provenance is one line; prose
    // lives in the static header above, where no regex touches it.
    const stamped = out.join('\n').replace(
        /^# Generated .*$/m,
        `# Generated ${date} at commit ${head} by tools/oracle-manifest-regen.mjs.`,
    );
    if (!/^# Generated /m.test(stamped)) throw new Error('provenance line vanished');
    return stamped;
}

// Provenance is informational and self-referential: the manifest cannot know
// the SHA of the commit it lands in, so the line always names the PREVIOUS
// head. Comparing it would make `--check` go red on the very next commit.
// Compare everything else.
export const withoutProvenance = (text) => text.replace(/^# Generated .*$/m, '# Generated <ignored>');

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const before = readFileSync(MANIFEST, 'utf8');
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
    // Date from the commit, not the wall clock: a regeneration is provenance
    // for a tree, and two runs over the same tree should agree.
    const date = execFileSync('git', ['log', '-1', '--format=%cs'], { cwd: REPO_ROOT }).toString().trim();
    const after = regenerate(before, { head, date });
    if (process.argv.includes('--check')) {
        if (withoutProvenance(after) !== withoutProvenance(before)) {
            console.error('oracle-manifest.txt is out of date — run: node tools/oracle-manifest-regen.mjs');
            process.exit(1);
        }
        console.log('oracle-manifest.txt is current');
        process.exit(0);
    }
    writeFileSync(MANIFEST, after);
    const count = after.split('\n').filter((l) => HASH_LINE.test(l)).length;
    console.log(`oracle-manifest.txt regenerated — ${count} paths pinned`);
}
