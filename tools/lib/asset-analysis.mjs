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
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
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
  return { w, h, ch, data };
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
  if (/_rough|_ao|_metal|_gloss/.test(b)) return 'roughness';
  if (/sky|_env|equirect/.test(b)) return 'sky';
  if (/_albedo|_basecolor|_color|_colour|_diff/.test(b)) return 'albedo';
  return 'albedo';
}

/**
 * Run every check that applies to `kind` and return { fails, notes }.
 * `fails` non-empty means the asset is rejected. This function says NOTHING
 * about whether the texture looks right — that is an eye's job, on purpose.
 */
export function analyse(p, kind) {
  const fails = [];
  const notes = [];
  const mb = decodedMb(p.w, p.h);

  if (!isPow2(p.w) || !isPow2(p.h)) {
    fails.push(`dimensions ${p.w}x${p.h} are not powers of two — a repeating texture cannot be mipped at NPOT, and an unmipped ground texture aliases into noise at distance`);
  }
  notes.push(`${p.w}x${p.h}, ${p.ch === 4 ? 'RGBA' : 'RGB'}, ~${mb.toFixed(2)} MB decoded with mips`);

  if (kind === 'albedo' || kind === 'roughness' || kind === 'normal' || kind === 'packed') {
    const t = tiling(p);
    notes.push(`seam ratio ${t.ratio}x (x ${t.seamX}, y ${t.seamY}; interior mean ${t.interior}, p90 ${t.p90})`);
    if (t.ratio > THRESHOLDS.seamRatio) {
      fails.push(`does not tile: the wrap seam is ${t.ratio}x the steepest ordinary transition in the image (p90 ${t.p90}). On terrain this repeats as a visible grid`);
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
  }
  if (kind === 'roughness') {
    const g = greyscale(p);
    notes.push(`channel divergence ${g}`);
    if (g > THRESHOLDS.greyDivergence) {
      fails.push(`not greyscale (mean channel divergence ${g}) — a roughness map carries one channel; colour here means the generator returned a picture, not a material property`);
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
  }
  return { kind, mb, fails, notes };
}
