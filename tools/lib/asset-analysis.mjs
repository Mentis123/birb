/**
 * asset-analysis.mjs — the mechanical half of authored-texture acceptance.
 *
 * Everything in here takes bytes and returns numbers. No filesystem, no CLI, no
 * reporting: that is tools/asset-check.mjs. Split this way because the whole
 * point of the gate is that it can FAIL, and a check nobody has watched fail is
 * decoration. tests/asset-check.test.js synthesises a bad texture of each kind
 * and asserts the corresponding check rejects it.
 *
 * Zero dependencies beyond node:zlib — this repo installs nothing to run tests.
 */
import zlib from 'node:zlib';

/**
 * Decode an 8-bit truecolour PNG (colour type 2 or 6) from a Buffer.
 *
 * Deliberately narrow. Every generator emits one of these two, and a reader
 * that quietly mis-parses a palette or 16-bit image would hand every downstream
 * check garbage while reporting numbers that look plausible.
 */
export function decodePng(buf, label = 'buffer') {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${label}: not a PNG`);
  let off = 8;
  let ihdr = null;
  const idat = [];
  const chunks = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, length: len, data: type === 'gAMA' && len === 4 ? data.readUInt32BE(0) : null });
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error(`${label}: no IHDR`);
  if (ihdr.depth !== 8) throw new Error(`${label}: only 8-bit supported, got ${ihdr.depth}-bit`);
  if (ihdr.interlace) throw new Error(`${label}: interlaced PNG unsupported`);
  const ch = ihdr.colorType === 2 ? 3 : ihdr.colorType === 6 ? 4 : 0;
  if (!ch) throw new Error(`${label}: colour type ${ihdr.colorType} unsupported (need 2 or 6)`);
  if (!idat.length) throw new Error(`${label}: no IDAT`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width: w, height: h } = ihdr;
  const stride = w * ch;
  if (raw.length < (stride + 1) * h) throw new Error(`${label}: truncated image data`);
  const data = Buffer.alloc(stride * h);
  let pos = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) throw new Error(`${label}: unknown row filter ${filter}`);
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data, chunks };
}

/**
 * Encode 8-bit RGB/RGBA as a PNG. Used by the tests to build fixtures, and by
 * anything that wants to write a probe image. Filter 0 throughout: correctness
 * over compression, and it keeps the encoder small enough to trust by reading.
 */
export function encodePng({ w, h, ch, data }) {
  const stride = w * ch;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), body.length + 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = ch === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const lum = (p, i) => 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];

/**
 * Does it tile? Compare the wrap seam against ordinary interior variation.
 *
 * A texture that tiles has no more discontinuity across its wrap than between
 * any two adjacent interior columns. One that does not shows a hard line — and
 * on a hillside that line repeats every few metres, which is the single most
 * recognisable "this is a generated texture" artefact.
 *
 * The baseline is the texture's OWN interior variation, not a constant: a busy
 * rock and a smooth sand have very different adjacent-column steps, and a fixed
 * threshold would pass one while failing the other.
 */
export function tiling(p) {
  const { w, h, ch } = p;
  const colDiff = (x0, x1) => {
    let s = 0;
    for (let y = 0; y < h; y += 1) s += Math.abs(lum(p, (y * w + x0) * ch) - lum(p, (y * w + x1) * ch));
    return s / h;
  };
  const rowDiff = (y0, y1) => {
    let s = 0;
    for (let x = 0; x < w; x += 1) s += Math.abs(lum(p, (y0 * w + x) * ch) - lum(p, (y1 * w + x) * ch));
    return s / w;
  };

  // Baseline over EVERY adjacent pair, then the 90th percentile — not the mean.
  //
  // The seam is one sample and the baseline is a distribution, so comparing a
  // single sample against a mean asks "is the seam worse than typical", which
  // any texture whose steepest gradient happens to land on the wrap will fail.
  // A sinusoid sampled that way measured 3.05x and was rejected while tiling
  // perfectly. The honest question is whether the seam is worse than the worst
  // ORDINARY transition in the image, so the denominator is p90.
  const steps = [];
  for (let x = 0; x + 1 < w; x += 1) steps.push(colDiff(x, x + 1));
  for (let y = 0; y + 1 < h; y += 1) steps.push(rowDiff(y, y + 1));
  steps.sort((a, b) => a - b);
  const p90 = steps.length ? steps[Math.min(steps.length - 1, Math.floor(steps.length * 0.9))] : 0;
  const mean = steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : 0;

  const seamX = colDiff(w - 1, 0);
  const seamY = rowDiff(h - 1, 0);
  const worst = Math.max(seamX, seamY);
  // A flat texture has a baseline of ~0 and any seam is infinitely worse in
  // ratio terms, which is a false alarm. Floor the denominator at one 8-bit
  // code value: a seam under a single step is invisible whatever the ratio.
  const ratio = worst / Math.max(p90, 1);
  return {
    interior: +mean.toFixed(3),
    p90: +p90.toFixed(3),
    seamX: +seamX.toFixed(3),
    seamY: +seamY.toFixed(3),
    ratio: +ratio.toFixed(2),
  };
}

/**
 * Is the sun baked in? Mean luminance per quadrant, looking for a directional
 * ramp. An albedo is a material's colour with the lighting REMOVED; a strong
 * gradient means the generator drew a lit photograph, which fights the single
 * coherent light the renderer applies and reads as "the materials look wrong"
 * while every other check passes.
 */
export function bakedLight(p) {
  const { w, h, ch } = p;
  const q = [0, 0, 0, 0];
  const c = [0, 0, 0, 0];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const k = (y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1);
      q[k] += lum(p, (y * w + x) * ch);
      c[k] += 1;
    }
  }
  const m = q.map((s, i) => s / Math.max(1, c[i]));
  const mean = m.reduce((a, b) => a + b, 0) / 4;
  const spread = Math.max(...m) - Math.min(...m);
  return { quadrants: m.map(v => +v.toFixed(1)), spreadPct: +((spread / Math.max(1, mean)) * 100).toFixed(1) };
}

/** A tangent-space normal map is mostly +Z: mean near (128, 128, ~255). */
export function normalSanity(p) {
  const { w, h, ch } = p;
  const n = w * h;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < n; i += 1) {
    const o = i * ch;
    r += p.data[o];
    g += p.data[o + 1];
    b += p.data[o + 2];
  }
  return { meanR: +(r / n).toFixed(1), meanG: +(g / n).toFixed(1), meanB: +(b / n).toFixed(1) };
}

/** A roughness/metalness/AO map carries ONE channel of information. */
export function greyscale(p) {
  const { w, h, ch } = p;
  const n = w * h;
  let d = 0;
  for (let i = 0; i < n; i += 1) {
    const o = i * ch;
    d += Math.max(Math.abs(p.data[o] - p.data[o + 1]), Math.abs(p.data[o + 1] - p.data[o + 2]));
  }
  return +(d / n).toFixed(2);
}

/**
 * Does a single-channel map earn its texture unit, or is it a constant wearing
 * a texture's filename?
 *
 * three samples roughness from the G channel (`roughnessFactor *=
 * texelRoughness.g`), so that is the channel to histogram. The delivered pine
 * bark spans 0.137 across 37 of 256 values, which under this game's light rig
 * moves the brightest specular pixel by under three output code values -- and
 * this repo's own recorded legibility floor is that a ~0.1 per-channel
 * difference is "measurably present, visually absent".
 */
export function channelSpan(p, channel = 1) {
  const { w, h, ch } = p;
  const n = w * h;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i += 1) hist[p.data[i * ch + channel]] += 1;
  let seen = 0;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v += 1) {
    if (hist[v]) seen += 1;
    acc += hist[v];
    if (acc <= n * 0.01) lo = v;
  }
  acc = 0;
  for (let v = 255; v >= 0; v -= 1) {
    acc += hist[v];
    if (acc <= n * 0.01) hi = v;
  }
  return { p1: lo, p99: hi, span01: +((hi - lo) / 255).toFixed(4), distinct: seen };
}

/**
 * Is the image a copy or a mirror of a sub-image of itself?
 *
 * The wrap-seam check is blind to this and worse than blind: a MIRROR-TILED
 * fake -- the cheap way to make anything seamless -- scores a seam ratio of
 * exactly 0, a PERFECT result, better than the genuinely tileable pine bark's
 * 1.25. Measured, not supposed. Compare each self-map against the spread
 * between unrelated regions; a real texture sits near 1, a fake at 0.
 */
export function selfDuplication(p) {
  const { w, h, ch } = p;
  const L = (x, y) => lum(p, (((y % h) + h) % h * w + ((x % w) + w) % w) * ch);
  const step = Math.max(1, Math.floor(Math.min(w, h) / 96));
  const mad = (map) => {
    let s = 0;
    let n = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const [sx, sy] = map(x, y);
        s += Math.abs(L(x, y) - L(sx, sy));
        n += 1;
      }
    }
    return n ? s / n : 0;
  };
  const candidates = {
    halfX: (x, y) => [x + (w >> 1), y],
    halfY: (x, y) => [x, y + (h >> 1)],
    quarterX: (x, y) => [x + (w >> 2), y],
    quarterY: (x, y) => [x, y + (h >> 2)],
    mirrorX: (x, y) => [w - 1 - x, y],
    mirrorY: (x, y) => [x, h - 1 - y],
  };
  // Baseline: what an unrelated region of the SAME texture looks like. Using a
  // constant would fail a busy rock and pass a smooth sand, the same mistake
  // the tiling check avoids.
  const offsets = [[37, 91], [113, 29], [61, 157], [149, 73], [23, 199], [181, 47]];
  const baselines = offsets.map(([dx, dy]) => mad((x, y) => [x + dx, y + dy])).sort((a, b) => a - b);
  const baseline = baselines[baselines.length >> 1];
  const scores = {};
  let worstKey = null;
  let worst = Infinity;
  for (const [k, f] of Object.entries(candidates)) {
    const r = baseline > 0 ? mad(f) / baseline : 1;
    scores[k] = +r.toFixed(3);
    if (r < worst) { worst = r; worstKey = k; }
  }
  return { baseline: +baseline.toFixed(2), scores, worst: +worst.toFixed(3), worstKey };
}

/**
 * Green-up (OpenGL, what three.js wants) or green-down (DirectX)?
 *
 * This is the classic silent bug: a flipped green channel renders as plausible
 * material with every hollow lit as a ridge, and it passes every structural
 * check -- mean RGB, bias and unit length are all unchanged by the flip. It
 * becomes mechanically decidable the moment the matching albedo is present,
 * because the normal was derived from something and the albedo's luminance is
 * a serviceable stand-in for that height field.
 *
 * The downsample is load-bearing: the delivered pair correlates +0.298 at 512
 * and +0.871 at 128, because relief is low frequency and 1:1 buries the signal
 * in unrelated grain.
 */
export function normalConvention(normal, albedo, size = 128) {
  const grid = (p, fn) => {
    const out = new Float64Array(size * size);
    const sx = p.w / size;
    const sy = p.h / size;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) out[y * size + x] = fn(Math.floor(x * sx), Math.floor(y * sy), p);
    }
    return out;
  };
  const A = grid(albedo, (x, y, p) => lum(p, (y * p.w + x) * p.ch));
  const nx = grid(normal, (x, y, p) => p.data[(y * p.w + x) * p.ch] - 128);
  const ny = grid(normal, (x, y, p) => p.data[(y * p.w + x) * p.ch + 1] - 128);
  const at = (g, x, y) => g[((y % size) + size) % size * size + (((x % size) + size) % size)];
  const dRow = new Float64Array(size * size);
  const dCol = new Float64Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      dRow[y * size + x] = at(A, x, y + 1) - at(A, x, y - 1);
      dCol[y * size + x] = at(A, x + 1, y) - at(A, x - 1, y);
    }
  }
  const corr = (a, b) => {
    const n = a.length;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < n; i += 1) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let cov = 0;
    let va = 0;
    let vb = 0;
    for (let i = 0; i < n; i += 1) {
      const da = a[i] - ma;
      const db = b[i] - mb;
      cov += da * db; va += da * da; vb += db * db;
    }
    return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
  };
  return { rG: +corr(dRow, ny).toFixed(3), rR: +corr(dCol, nx).toFixed(3) };
}

/**
 * Decoded vector length. Quantising a true unit vector to 8 bits moves each
 * component by at most 1/255, so the worst honest length is sqrt(3)/255 over
 * unit = 1.0068. Anything meaningfully longer was never a unit vector, which
 * means the "normal map" was painted or generated as an image rather than
 * derived as a vector field.
 *
 * One-sided on purpose. SHORT vectors are ordinary -- lerping toward
 * (128,128,255) is the standard way to dial a normal map's strength down --
 * and this file's own hand-built goodNormal fixture is 16% short.
 */
export function normalLength(p) {
  const { w, h, ch } = p;
  const n = w * h;
  let max = 0;
  let long = 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const o = i * ch;
    const x = p.data[o] / 127.5 - 1;
    const y = p.data[o + 1] / 127.5 - 1;
    const z = p.data[o + 2] / 127.5 - 1;
    const len = Math.sqrt(x * x + y * y + z * z);
    sum += len;
    if (len > max) max = len;
    if (len > THRESHOLDS.normalLongCeil) long += 1;
  }
  return { mean: +(sum / n).toFixed(4), max: +max.toFixed(4), longFrac: +(long / n).toFixed(5) };
}

/**
 * Ancillary PNG chunks that make the browser hand the GPU different pixels
 * from the ones this tool measured.
 *
 * TextureLoader decodes through an HTMLImageElement, and the browser applies an
 * embedded colour profile BEFORE texImage2D. So an iCCP on a normal map
 * transforms R and G on the way to the GPU while every number here still reads
 * 127.7/128.1/243.9. Same shape as a feature gated on a probe that returns
 * undefined: nothing is wrong with the file, and the pixels are not what you
 * measured. An editor writes one the moment somebody opens the file to look.
 */
export function ancillary(p, kind) {
  const skip = new Set(['IHDR', 'IDAT', 'IEND', 'PLTE']);
  const present = p.chunks.filter((c) => !skip.has(c.type));
  const fails = [];
  const notes = [];
  const isData = kind === 'normal' || kind === 'roughness' || kind === 'mask' || kind === 'packed';
  for (const c of present) {
    if (c.type === 'iCCP') {
      fails.push(`carries an embedded ICC profile (iCCP, ${c.length} B). The browser applies it before the pixels reach the GPU, so what ships is not what this tool measured`);
    } else if (c.type === 'gAMA' && c.data !== null && c.data !== 45455) {
      fails.push(`gAMA is ${c.data}, not the sRGB 45455 -- the decoder will re-gamma every texel`);
    } else if ((c.type === 'gAMA' || c.type === 'sRGB') && isData) {
      fails.push(`a ${kind} map carries ${c.type}: it is DATA, not a picture, and any colour management applied to it corrupts the values`);
    } else if (c.type === 'cHRM') {
      fails.push('carries cHRM (custom chromaticities), which re-maps the primaries on decode');
    } else {
      notes.push(c.type);
    }
  }
  return { fails, present: present.map((c) => c.type), benign: notes };
}

export const isPow2 = (v) => v > 0 && (v & (v - 1)) === 0;

/** Decoded cost of one texture in MB, RGBA8 plus the 1/3 the mip chain adds. */
export const decodedMb = (w, h) => (w * h * 4 * 4 / 3) / (1024 * 1024);

/** Whole authored set, decoded, with mips. Justified in docs/realism/AUTHORED_ASSETS.md. */
export const MEM_BUDGET_MB = 24;

export const THRESHOLDS = {
  seamRatio: 3,       // wrap seam vs interior adjacent-column step
  bakedSpreadPct: 18, // quadrant luminance spread for an albedo
  normalMeanB: 200,   // below this it is not a tangent-space normal map
  normalBias: 24,     // |mean R or G - 128|
  greyDivergence: 3,  // mean channel divergence for a single-channel map
  minMapSpan: 0.20,   // p1-p99 of a roughness map; below this a scalar is honest
  spanWarn: 0.30,     // between minMapSpan and this, pass but say so
  selfDup: 0.12,      // self-map difference as a fraction of the unrelated-region baseline
  conventionR: 0.30,  // |correlation| below this abstains rather than judging
  normalLongCeil: 1.015,  // sqrt(3)/255 over unit is 1.0068; this is 2.2x that
  normalLongFrac: 0.0025,
};

/**
 * Kind from the filename suffix, so a directory sweep needs no flags.
 * Order matters: "_normal" must be tested before the generic albedo fallback,
 * and a file named neither is treated as an albedo (the strictest set).
 */
export function inferKind(basename) {
  const b = basename.toLowerCase();
  if (/_normal|_nrm/.test(b)) return 'normal';
  // A packed map is checked differently from a single-channel one, so it must
  // be matched FIRST: scored as a roughness map an ORM fails the greyscale
  // check for doing exactly what it is supposed to do.
  if (/_orm|_arm|_packed/.test(b)) return 'packed';
  // Occlusion and metalness are LEGITIMATELY near-constant -- AO on a convex
  // surface, metalness on a dielectric -- so they keep the greyscale check and
  // skip the dynamic-range one. Roughness and gloss have no such excuse.
  if (/_ao|_metal/.test(b)) return 'mask';
  if (/_rough|_gloss/.test(b)) return 'roughness';
  if (/sky|_env|equirect/.test(b)) return 'sky';
  if (/_albedo|_basecolor|_color|_colour|_diff/.test(b)) return 'albedo';
  return 'albedo';
}

/**
 * Run every check that applies to `kind` and return { fails, notes }.
 * `fails` non-empty means the asset is rejected. This function says NOTHING
 * about whether the texture looks right — that is an eye's job, on purpose.
 */
export function analyse(p, kind, siblings = {}) {
  const fails = [];
  const notes = [];
  const mb = decodedMb(p.w, p.h);

  if (!isPow2(p.w) || !isPow2(p.h)) {
    fails.push(`dimensions ${p.w}x${p.h} are not powers of two — a repeating texture cannot be mipped at NPOT, and an unmipped ground texture aliases into noise at distance`);
  }
  notes.push(`${p.w}x${p.h}, ${p.ch === 4 ? 'RGBA' : 'RGB'}, ~${mb.toFixed(2)} MB decoded with mips`);

  if (kind === 'albedo' || kind === 'roughness' || kind === 'mask' || kind === 'normal' || kind === 'packed') {
    const t = tiling(p);
    notes.push(`seam ratio ${t.ratio}x (x ${t.seamX}, y ${t.seamY}; interior mean ${t.interior}, p90 ${t.p90})`);
    if (t.ratio > THRESHOLDS.seamRatio) {
      fails.push(`does not tile: the wrap seam is ${t.ratio}x the steepest ordinary transition in the image (p90 ${t.p90}). On terrain this repeats as a visible grid`);
    }
    // The seam check cannot see this and is worse than blind to it: a
    // mirror-tiled fake scores a seam ratio of exactly 0, which is a PERFECT
    // result, better than a genuinely tileable texture's 1.25. Measured.
    if (t.p90 >= 2) {
      const d = selfDuplication(p);
      notes.push(`self-duplication ${d.worst} (worst: ${d.worstKey}; baseline ${d.baseline})`);
      if (d.worst < THRESHOLDS.selfDup) {
        fails.push(`the image is a ${/mirror/.test(d.worstKey) ? 'MIRROR' : 'copy'} of itself under ${d.worstKey} (${d.worst} of the unrelated-region baseline). Mirror-tiling is the cheap way to fake a seamless texture and it scores a PERFECT seam ratio; what it actually produces is a Rorschach lattice`);
      }
    }
  }
  if (kind === 'albedo') {
    const b = bakedLight(p);
    notes.push(`quadrant luminance ${b.quadrants.join('/')} — spread ${b.spreadPct}%`);
    if (b.spreadPct > THRESHOLDS.bakedSpreadPct) {
      fails.push(`lighting looks baked into the albedo (${b.spreadPct}% quadrant spread). An albedo is colour with the light REMOVED; a baked gradient fights the renderer's own light and reads as "the materials look wrong"`);
    }
  }
  if (kind === 'normal') {
    const n = normalSanity(p);
    notes.push(`mean RGB ${n.meanR}/${n.meanG}/${n.meanB}`);
    if (n.meanB < THRESHOLDS.normalMeanB) {
      fails.push(`mean blue ${n.meanB} is too low for a tangent-space normal map (flat is 255; a detailed one still means well above ${THRESHOLDS.normalMeanB}). Is this a height/bump image rather than a normal map?`);
    }
    if (Math.abs(n.meanR - 128) > THRESHOLDS.normalBias || Math.abs(n.meanG - 128) > THRESHOLDS.normalBias) {
      fails.push(`mean R/G ${n.meanR}/${n.meanG} should sit near 128 — a biased normal map tilts every surface in one direction`);
    }
    const len = normalLength(p);
    notes.push(`decoded length mean ${len.mean}, max ${len.max}, ${(len.longFrac * 100).toFixed(2)}% over ${THRESHOLDS.normalLongCeil}`);
    if (len.longFrac > THRESHOLDS.normalLongFrac) {
      fails.push(`${(len.longFrac * 100).toFixed(2)}% of texels decode to vectors longer than ${THRESHOLDS.normalLongCeil}, which 8-bit quantisation of a unit vector cannot produce (its worst case is 1.0068). This was painted or generated as an image, not derived as a vector field`);
    }
    // Green-up vs green-down is the classic silent bug and it is invisible to
    // every check above — the flip changes no mean, no bias, no length. It
    // becomes decidable the moment the sibling albedo is on hand.
    if (siblings.albedo) {
      const c = normalConvention(p, siblings.albedo);
      notes.push(`convention vs sibling albedo: rG ${c.rG}, rR ${c.rR}`);
      if (c.rG <= -THRESHOLDS.conventionR) {
        fails.push(`GREEN-DOWN (DirectX) normal map: rG ${c.rG} against the sibling albedo. three.js expects green-up, so every hollow will light as a ridge — which looks plausible, which is why nothing else here can catch it. Invert the green channel`);
      } else if (c.rR >= THRESHOLDS.conventionR) {
        fails.push(`X axis inverted or R/G swapped: rR ${c.rR} against the sibling albedo, expected negative`);
      } else if (Math.abs(c.rG) < THRESHOLDS.conventionR) {
        notes.push('NOTE: convention undecidable — the albedo does not track the relief closely enough to judge. Not a failure');
      }
    }
  }
  if (kind === 'roughness' || kind === 'mask') {
    const g = greyscale(p);
    notes.push(`channel divergence ${g}`);
    if (g > THRESHOLDS.greyDivergence) {
      fails.push(`not greyscale (mean channel divergence ${g}) — a single-channel map carries one channel; colour here means the generator returned a picture, not a material property`);
    }
  }
  if (kind === 'roughness') {
    // three samples roughness from G. A map with no range is a constant that
    // costs a texture unit and 1.33 MB; `material.roughness = x` costs neither.
    // Masks are exempt: AO on a convex surface and metalness on a dielectric
    // are legitimately flat, which is why inferKind splits them off.
    const c = channelSpan(p, 1);
    notes.push(`dynamic range ${c.span01} (p1 ${c.p1}, p99 ${c.p99}, ${c.distinct} distinct values)`);
    if (c.span01 < THRESHOLDS.minMapSpan) {
      fails.push(`dynamic range ${c.span01} is below the ${THRESHOLDS.minMapSpan} a map needs to beat a constant: the typical pair of points differs by less roughness than any light in this game makes visible. Ship a scalar and save the texture`);
    } else if (c.span01 < THRESHOLDS.spanWarn) {
      notes.push(`NOTE: ${c.span01} is thin — above the floor, but check it against a scalar before shipping`);
    }
  }
  if (kind === 'packed') {
    // The point of packing is that the three channels carry DIFFERENT things.
    // The failure mode is a generator that returns a greyscale image and calls
    // it ORM, which loses two of the three maps silently: the renderer reads
    // occlusion where roughness should be and everything comes out uniform.
    const g = greyscale(p);
    notes.push(`channel divergence ${g} (packed: occlusion R, roughness G, metalness B)`);
    if (g <= THRESHOLDS.greyDivergence) {
      fails.push(`packed map is effectively greyscale (channel divergence ${g}) — R, G and B are meant to be three different maps. This one carries the same image three times, so two of the three channels are lost`);
    }
  }
  if (kind === 'sky') {
    if (Math.abs(p.w / p.h - 2) > 0.02) fails.push(`equirectangular sky must be 2:1, got ${p.w}x${p.h}`);
    // An equirectangular map wraps in LONGITUDE only. The left and right edges
    // are the same meridian, so a discontinuity there is a vertical seam
    // standing in the sky and in every reflection of it. The poles are top and
    // bottom rows and legitimately differ, so the y seam is not checked.
    const t = tiling(p);
    notes.push(`longitude wrap ${(t.seamX / Math.max(t.p90, 1)).toFixed(2)}x (seam ${t.seamX}, p90 ${t.p90})`);
    if (t.seamX / Math.max(t.p90, 1) > THRESHOLDS.seamRatio) {
      fails.push(`the longitude wrap is ${(t.seamX / Math.max(t.p90, 1)).toFixed(2)}x the steepest ordinary step: the left and right edges are the same meridian, so this is a vertical seam standing in the sky and in every reflection of it`);
    }
  }
  if (p.chunks) {
    const a = ancillary(p, kind);
    if (a.present.length) notes.push(`ancillary chunks: ${a.present.join(' ')}`);
    fails.push(...a.fails);
  }
  return { kind, mb, fails, notes };
}
