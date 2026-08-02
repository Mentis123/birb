import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeQR } from '../gauntlet/src/ui/qr.js';

/**
 * These re-derive the structural invariants of a QR symbol so a regression is
 * caught without needing a reference encoder installed.
 *
 * During development every module of the matrix was compared against the
 * `qrcode` npm package for a spread of strings and matched exactly, including
 * a version-7 symbol (which exercises the version-information blocks). Two real
 * bugs were caught that way and both are pinned below: the two format-info
 * copies were transposed, and version >= 7 reserved the version blocks without
 * ever writing them. Both produce a symbol that LOOKS like a QR code and does
 * not scan, which is exactly the kind of bug an eyeball test misses.
 */

const URL = 'https://birbmobile.vercel.app/gauntlet';

function isFinder(qr, r0, c0) {
    // 7x7: dark ring, light ring, 3x3 dark core.
    for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
            const ring = i === 0 || i === 6 || j === 0 || j === 6;
            const gap = (i === 1 || i === 5 || j === 1 || j === 5) && !ring;
            const core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
            const want = ring || core;
            if (gap && qr.modules[r0 + i][c0 + j]) return false;
            if (qr.modules[r0 + i][c0 + j] !== want) return false;
        }
    }
    return true;
}

test('size follows the version formula', () => {
    const qr = encodeQR(URL);
    assert.equal(qr.size, qr.version * 4 + 17);
    assert.equal(qr.modules.length, qr.size);
    assert.equal(qr.modules[0].length, qr.size);
});

test('all three finder patterns are present and correct', () => {
    const qr = encodeQR(URL);
    const n = qr.size;
    assert.ok(isFinder(qr, 0, 0), 'top-left finder');
    assert.ok(isFinder(qr, 0, n - 7), 'top-right finder');
    assert.ok(isFinder(qr, n - 7, 0), 'bottom-left finder');
});

test('finders are separated by a light border', () => {
    const qr = encodeQR(URL);
    const n = qr.size;
    for (let i = 0; i < 8; i++) {
        assert.equal(qr.modules[7][i], false, `top-left separator row at ${i}`);
        assert.equal(qr.modules[i][7], false, `top-left separator col at ${i}`);
        assert.equal(qr.modules[7][n - 1 - i], false, 'top-right separator');
        assert.equal(qr.modules[n - 1 - i][7], false, 'bottom-left separator');
    }
});

test('timing patterns alternate', () => {
    const qr = encodeQR(URL);
    for (let i = 8; i < qr.size - 8; i++) {
        assert.equal(qr.modules[6][i], i % 2 === 0, `horizontal timing at ${i}`);
        assert.equal(qr.modules[i][6], i % 2 === 0, `vertical timing at ${i}`);
    }
});

test('the dark module is set', () => {
    const qr = encodeQR(URL);
    // Always at (4 * version + 9, 8).
    assert.equal(qr.modules[4 * qr.version + 9][8], true);
});

test('the two format copies agree, bit for bit', () => {
    // The bug this pins: the copies are transposes of one another, and getting
    // them the wrong way round yields a symbol that differs from a correct one
    // ONLY in these strips — it still looks like a QR code and will not scan.
    const qr = encodeQR(URL);
    const n = qr.size;
    for (let i = 0; i < 15; i++) {
        const copy1 = i < 6 ? qr.modules[i][8]
            : i < 8 ? qr.modules[i + 1][8]
                : qr.modules[n - 15 + i][8];
        const copy2 = i < 8 ? qr.modules[8][n - 1 - i]
            : i < 9 ? qr.modules[8][15 - i]
                : qr.modules[8][14 - i];
        assert.equal(copy1, copy2, `format bit ${i} differs between copies`);
    }
});

test('version info is written, not just reserved, for version 7+', () => {
    // 'x' * 120 needs version 7 at ECC M. Reserving these 36 modules without
    // writing them leaves a block a scanner reads as a corrupt version.
    const qr = encodeQR('x'.repeat(120));
    assert.ok(qr.version >= 7, `expected version >= 7, got ${qr.version}`);
    const n = qr.size;
    let dark = 0;
    for (let i = 0; i < 18; i++) {
        const a = Math.floor(i / 3);
        const b = n - 11 + (i % 3);
        // The two blocks must mirror each other.
        assert.equal(qr.modules[a][b], qr.modules[b][a], `version bit ${i} mirror`);
        if (qr.modules[a][b]) dark++;
    }
    assert.ok(dark > 0, 'version block is entirely blank — it was never written');
});

test('version scales with payload length', () => {
    assert.equal(encodeQR('A').version, 1);
    const long = encodeQR('x'.repeat(120)).version;
    const longer = encodeQR('x'.repeat(200)).version;
    assert.ok(longer > long, `${longer} should exceed ${long}`);
});

test('encoding is deterministic', () => {
    const a = encodeQR(URL);
    const b = encodeQR(URL);
    assert.equal(a.mask, b.mask);
    assert.deepEqual(a.modules, b.modules);
});

test('different payloads produce different symbols', () => {
    const a = encodeQR('https://birbmobile.vercel.app/gauntlet');
    const b = encodeQR('https://birbmobile.vercel.app/gauntleu');
    assert.equal(a.size, b.size);
    let diffs = 0;
    for (let r = 0; r < a.size; r++) {
        for (let c = 0; c < a.size; c++) if (a.modules[r][c] !== b.modules[r][c]) diffs++;
    }
    assert.ok(diffs > 10, `only ${diffs} modules differ for a changed payload`);
});

test('a chosen mask is always one of the eight', () => {
    for (const s of ['A', 'hello world', URL, 'x'.repeat(200)]) {
        const qr = encodeQR(s);
        assert.ok(qr.mask >= 0 && qr.mask < 8, `mask ${qr.mask} for "${s}"`);
    }
});

test('unicode is encoded as UTF-8 bytes', () => {
    // Two bytes per character, so this must need more capacity than its
    // character count suggests.
    const qr = encodeQR('é'.repeat(100));
    assert.ok(qr.version >= 6, `expected a large version, got ${qr.version}`);
});

test('the documented capacity is real', () => {
    // 213 bytes is the version-10 ECC-M ceiling the header claims. Both sides
    // of the boundary are checked, because a header comment that overstates
    // capacity is how you ship a QR overlay that throws on a long URL.
    assert.equal(encodeQR('x'.repeat(213)).version, 10);
    assert.throws(() => encodeQR('x'.repeat(214)), /too long/);
});

test('over-long payloads are rejected rather than silently truncated', () => {
    assert.throws(() => encodeQR('x'.repeat(500)), /too long/);
});
