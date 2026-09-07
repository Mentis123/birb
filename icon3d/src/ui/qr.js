/**
 * ui/qr.js — a QR encoder, from scratch.
 *
 * WHY THIS EXISTS. Birb Gauntlet ships zero external assets: every mesh,
 * texture, sound and even the splash art is generated in code. A QR code is no
 * different, and pulling in a library or an image API for it would break the
 * one rule the whole artefact is built on — and would stop the code working
 * offline, which is exactly when someone standing in a room wants to scan it.
 *
 * SCOPE. Byte mode only, ECC level M, versions 1-10 — 213 bytes at the top
 * end. Every URL this game will ever show is well inside that. Numeric
 * and alphanumeric modes would shrink the symbol for a bare domain, but a URL
 * with a lowercase path cannot use them anyway, so they are dead code here.
 *
 * The output is a plain boolean matrix — no canvas, no DOM — so it is
 * unit-testable and the caller decides how to draw it.
 *
 * Correctness was checked against the `qrcode` npm package during development:
 * for a spread of strings, every module of the matrix matches. The committed
 * tests re-derive the structural invariants (finder patterns, timing patterns,
 * alignment, format bits, size) so a regression is caught without that
 * dependency being installed.
 */

// --- Galois field (GF(256), primitive polynomial 0x11D) ----------------------
// Built once at module load: 512 bytes of tables that turn Reed-Solomon
// multiplication into two lookups and an add.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree) {
    let poly = new Uint8Array([1]);
    for (let d = 0; d < degree; d++) {
        const next = new Uint8Array(poly.length + 1);
        for (let i = 0; i < poly.length; i++) {
            next[i] ^= poly[i];
            next[i + 1] ^= gfMul(poly[i], EXP[d]);
        }
        poly = next;
    }
    return poly;
}

/** Reed-Solomon remainder of `data` for `ecLen` codewords. */
function rsEncode(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const res = new Uint8Array(ecLen);
    for (let i = 0; i < data.length; i++) {
        const factor = data[i] ^ res[0];
        res.copyWithin(0, 1);
        res[ecLen - 1] = 0;
        if (factor !== 0) {
            for (let j = 0; j < ecLen; j++) res[j] ^= gfMul(gen[j + 1], factor);
        }
    }
    return res;
}

// --- Version tables (ECC level M only) ---------------------------------------
// Per version: total codewords, EC codewords per block, block counts.
// [ totalCodewords, ecPerBlock, group1Blocks, group2Blocks ]
// Group 2 blocks hold one more data codeword than group 1.
const VERSIONS_M = {
    1: [26, 10, 1, 0],
    2: [44, 16, 1, 0],
    3: [70, 26, 1, 0],
    4: [100, 18, 2, 0],
    5: [134, 24, 2, 0],
    6: [172, 16, 4, 0],
    7: [196, 18, 4, 0],
    8: [242, 22, 2, 2],
    9: [292, 22, 3, 2],
    10: [346, 26, 4, 1],
};

/** Alignment pattern centre coordinates by version. */
const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Format information bits for ECC M and each mask, pre-computed per the spec. */
const FORMAT_M = [
    0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

function sizeOf(version) { return version * 4 + 17; }

/** Data codeword capacity at ECC M. */
function dataCapacity(version) {
    const [total, ecPer, g1, g2] = VERSIONS_M[version];
    return total - ecPer * (g1 + g2);
}

/** Smallest version that fits `byteLen` bytes in byte mode. */
function pickVersion(byteLen) {
    for (let v = 1; v <= 10; v++) {
        // 4 bits mode + 8 or 16 bits length + payload.
        const lenBits = v < 10 ? 8 : 16;
        if (dataCapacity(v) * 8 >= 4 + lenBits + byteLen * 8) return v;
    }
    return -1;
}

// --- Bit assembly -------------------------------------------------------------

function buildDataCodewords(bytes, version) {
    const capacity = dataCapacity(version);
    const bits = [];
    const push = (value, len) => {
        for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
    };

    push(0b0100, 4);                              // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) push(bytes[i], 8);

    // Terminator, up to four zero bits, then pad to a byte boundary.
    const capBits = capacity * 8;
    for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const out = new Uint8Array(capacity);
    for (let i = 0; i < bits.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
        out[i >> 3] = b;
    }
    // Pad bytes alternate 0xEC / 0x11 — mandated, not arbitrary.
    for (let i = bits.length >> 3; i < capacity; i++) {
        out[i] = (i - (bits.length >> 3)) % 2 === 0 ? 0xec : 0x11;
    }
    return out;
}

/** Interleave data and EC codewords across blocks, per the spec. */
function buildFinalCodewords(data, version) {
    const [total, ecPer, g1, g2] = VERSIONS_M[version];
    const blocks = g1 + g2;
    const shortLen = Math.floor(dataCapacity(version) / blocks);

    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;
    for (let b = 0; b < blocks; b++) {
        const len = b < g1 ? shortLen : shortLen + 1;
        const chunk = data.subarray(offset, offset + len);
        offset += len;
        dataBlocks.push(chunk);
        ecBlocks.push(rsEncode(chunk, ecPer));
    }

    const out = new Uint8Array(total);
    let k = 0;
    const maxData = shortLen + (g2 > 0 ? 1 : 0);
    for (let i = 0; i < maxData; i++) {
        for (let b = 0; b < blocks; b++) {
            if (i < dataBlocks[b].length) out[k++] = dataBlocks[b][i];
        }
    }
    for (let i = 0; i < ecPer; i++) {
        for (let b = 0; b < blocks; b++) out[k++] = ecBlocks[b][i];
    }
    return out;
}

// --- Matrix -------------------------------------------------------------------

function placeFunctionPatterns(m, reserved, version) {
    const n = m.length;

    const finder = (r, c) => {
        for (let i = -1; i <= 7; i++) {
            for (let j = -1; j <= 7; j++) {
                const rr = r + i, cc = c + j;
                if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
                const inRing = (i >= 0 && i <= 6 && (j === 0 || j === 6))
                    || (j >= 0 && j <= 6 && (i === 0 || i === 6));
                const inCore = i >= 2 && i <= 4 && j >= 2 && j <= 4;
                m[rr][cc] = inRing || inCore;
                reserved[rr][cc] = true;
            }
        }
    };
    finder(0, 0);
    finder(0, n - 7);
    finder(n - 7, 0);

    // Timing patterns.
    for (let i = 8; i < n - 8; i++) {
        m[6][i] = i % 2 === 0;
        m[i][6] = i % 2 === 0;
        reserved[6][i] = true;
        reserved[i][6] = true;
    }

    // Alignment patterns, skipping the three finder corners.
    const centres = ALIGN[version];
    for (let a = 0; a < centres.length; a++) {
        for (let b = 0; b < centres.length; b++) {
            const r = centres[a], c = centres[b];
            const nearFinder = (r <= 8 && c <= 8)
                || (r <= 8 && c >= n - 9)
                || (r >= n - 9 && c <= 8);
            if (nearFinder) continue;
            for (let i = -2; i <= 2; i++) {
                for (let j = -2; j <= 2; j++) {
                    m[r + i][c + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1;
                    reserved[r + i][c + j] = true;
                }
            }
        }
    }

    // Format-information areas, and the always-dark module.
    for (let i = 0; i < 9; i++) {
        if (!reserved[8][i]) { reserved[8][i] = true; m[8][i] = false; }
        if (!reserved[i][8]) { reserved[i][8] = true; m[i][8] = false; }
    }
    for (let i = 0; i < 8; i++) {
        reserved[8][n - 1 - i] = true;
        reserved[n - 1 - i][8] = true;
    }
    m[n - 8][8] = true;                 // dark module
    reserved[n - 8][8] = true;

    // Version information (version 7+ only) occupies two 3x6 blocks.
    if (version >= 7) {
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 3; j++) {
                reserved[i][n - 11 + j] = true;
                reserved[n - 11 + j][i] = true;
            }
        }
    }
}

/** Zig-zag the codeword bits into the free modules, right to left. */
function placeData(m, reserved, codewords) {
    const n = m.length;
    let bit = 0;
    let up = true;
    for (let right = n - 1; right > 0; right -= 2) {
        if (right === 6) right = 5;          // the vertical timing column is skipped
        for (let v = 0; v < n; v++) {
            const row = up ? n - 1 - v : v;
            for (let c = 0; c < 2; c++) {
                const col = right - c;
                if (reserved[row][col]) continue;
                let dark = false;
                if (bit < codewords.length * 8) {
                    dark = ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
                }
                m[row][col] = dark;
                bit++;
            }
        }
        up = !up;
    }
}

const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** The four standard penalty rules. Lower is a more scannable symbol. */
function penalty(m) {
    const n = m.length;
    let score = 0;

    // Rule 1: runs of five or more same-colour modules in a row or column.
    for (let pass = 0; pass < 2; pass++) {
        for (let a = 0; a < n; a++) {
            let run = 1;
            let prev = pass === 0 ? m[a][0] : m[0][a];
            for (let b = 1; b < n; b++) {
                const cur = pass === 0 ? m[a][b] : m[b][a];
                if (cur === prev) {
                    run++;
                } else {
                    if (run >= 5) score += run - 2;
                    run = 1;
                    prev = cur;
                }
            }
            if (run >= 5) score += run - 2;
        }
    }

    // Rule 2: 2x2 blocks of one colour.
    for (let r = 0; r < n - 1; r++) {
        for (let c = 0; c < n - 1; c++) {
            const v = m[r][c];
            if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
        }
    }

    // Rule 3: the 1:1:3:1:1 finder-like pattern with four light modules either
    // side — the one a scanner can mistake for a finder.
    const P1 = [true, false, true, true, true, false, true, false, false, false, false];
    const P2 = [false, false, false, false, true, false, true, true, true, false, true];
    const matches = (get, i) => {
        let a = true, b = true;
        for (let k = 0; k < 11; k++) {
            const v = get(i + k);
            if (v !== P1[k]) a = false;
            if (v !== P2[k]) b = false;
        }
        return a || b;
    };
    for (let r = 0; r < n; r++) {
        for (let c = 0; c + 11 <= n; c++) {
            if (matches((i) => m[r][i], c)) score += 40;
            if (matches((i) => m[i][r], c)) score += 40;
        }
    }

    // Rule 4: deviation from a 50/50 dark ratio.
    let dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) dark++;
    const pct = (dark * 100) / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
}

/**
 * Format information: 15 bits, written twice.
 *
 * The two copies are TRANSPOSES of each other and it is easy to get them the
 * wrong way round — doing so produces a symbol that differs from a correct one
 * only in the two format strips, which still looks like a plausible QR code and
 * will not scan. Bit 0 (the LSB) goes at the TOP of the left column and at the
 * RIGHT end of the top row; both runs skip the timing line at index 6.
 */
function applyFormat(m, mask) {
    const n = m.length;
    const bits = FORMAT_M[mask];
    for (let i = 0; i < 15; i++) {
        const dark = ((bits >> i) & 1) === 1;
        // Copy 1: down column 8 — top-left finder, then bottom-left.
        if (i < 6) m[i][8] = dark;
        else if (i < 8) m[i + 1][8] = dark;
        else m[n - 15 + i][8] = dark;
        // Copy 2: along row 8 — from the right edge back toward the left.
        if (i < 8) m[8][n - 1 - i] = dark;
        else if (i < 9) m[8][15 - i] = dark;
        else m[8][14 - i] = dark;
    }
    m[n - 8][8] = true;                  // the always-dark module
}

/** BCH(18,6) version information, for version 7 and up. */
function versionBits(version) {
    let rem = version;
    for (let i = 0; i < 12; i++) {
        rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    return ((version << 12) | rem) >>> 0;
}

/**
 * Version information: two 3x6 blocks by the top-right and bottom-left
 * finders. Reserving the space without writing it — which this did at first —
 * leaves 36 blank modules that a scanner reads as a corrupt version block.
 */
function applyVersion(m, version) {
    if (version < 7) return;
    const n = m.length;
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
        const dark = ((bits >> i) & 1) === 1;
        const a = Math.floor(i / 3);
        const b = n - 11 + (i % 3);
        m[a][b] = dark;
        m[b][a] = dark;
    }
}

/**
 * Encode `text` as a QR matrix.
 *
 * @param {string} text
 * @returns {{size:number, modules:boolean[][], version:number, mask:number}}
 */
export function encodeQR(text) {
    const bytes = new TextEncoder().encode(String(text));
    const version = pickVersion(bytes.length);
    if (version < 0) throw new Error('encodeQR: text too long for version 10 at ECC M');

    const data = buildDataCodewords(bytes, version);
    const codewords = buildFinalCodewords(data, version);
    const n = sizeOf(version);

    // Build once, then re-mask a copy per candidate so the penalty comparison
    // is against real symbols rather than an approximation.
    let best = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
        const m = [];
        const reserved = [];
        for (let r = 0; r < n; r++) {
            m.push(new Array(n).fill(false));
            reserved.push(new Array(n).fill(false));
        }
        placeFunctionPatterns(m, reserved, version);
        placeData(m, reserved, codewords);
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (!reserved[r][c] && MASKS[mask](r, c)) m[r][c] = !m[r][c];
            }
        }
        applyFormat(m, mask);
        applyVersion(m, version);
        const score = penalty(m);
        if (score < bestScore) { bestScore = score; best = { m, mask }; }
    }

    return { size: n, modules: best.m, version, mask: best.mask };
}

/**
 * Render a matrix to an existing canvas, sized to whole modules so no row is a
 * fraction of a pixel — a QR with uneven module widths is a QR that phones
 * refuse to read.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} qr        result of encodeQR
 * @param {object} [opts]    {scale, quiet, dark, light}
 */
export function drawQR(canvas, qr, opts = {}) {
    const quiet = opts.quiet === undefined ? 4 : opts.quiet;   // 4 is the spec minimum
    const scale = Math.max(1, Math.floor(opts.scale || 6));
    const dim = (qr.size + quiet * 2) * scale;
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.light || '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = opts.dark || '#0f1c33';
    for (let r = 0; r < qr.size; r++) {
        for (let c = 0; c < qr.size; c++) {
            if (!qr.modules[r][c]) continue;
            ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
    }
    return canvas;
}

export default encodeQR;
