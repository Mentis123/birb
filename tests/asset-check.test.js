import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  decodePng, encodePng, analyse, inferKind, tiling, bakedLight,
  normalSanity, greyscale, isPow2, decodedMb, MEM_BUDGET_MB, THRESHOLDS,
} from '../tools/lib/asset-analysis.mjs';

/**
 * The authored-texture gate is only worth having if it can fail, so this suite
 * builds a texture that violates each rule and watches the corresponding check
 * reject it. Every fixture is generated here — the repo ships no test images.
 *
 * Frequencies are EVEN multiples on purpose: an even number of cycles across
 * the width means each half-width quadrant contains whole cycles, so a good
 * fixture has flat quadrant luminance and the baked-light check has nothing to
 * find. An odd multiple would leave a residual ramp and the "good" fixture
 * would fail a check it was built to pass.
 */
const TAU = Math.PI * 2;

function make(w, h, fn, ch = 3) {
  const data = Buffer.alloc(w * h * ch);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a = 255] = fn(x, y);
      const o = (y * w + x) * ch;
      data[o] = Math.max(0, Math.min(255, Math.round(r)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
      if (ch === 4) data[o + 3] = a;
    }
  }
  return { w, h, ch, data };
}

/** A field that is periodic in both axes, so it tiles by construction. */
const field = (x, y, w, h) =>
  45 * Math.sin(TAU * 4 * x / w) * Math.cos(TAU * 4 * y / h)
  + 25 * Math.sin(TAU * 6 * x / w + TAU * 2 * y / h);

const goodAlbedo = (w = 256, h = 256) => make(w, h, (x, y) => {
  const v = field(x, y, w, h);
  return [120 + v, 104 + v * 0.8, 86 + v * 0.6];
});

// -- the encoder the fixtures rely on -------------------------------------
// If encodePng and decodePng disagree, every result below is measuring the
// codec rather than the texture, and the failures would look like check bugs.

test('encode/decode round-trips every byte', () => {
  for (const ch of [3, 4]) {
    const src = make(64, 32, (x, y) => [x * 3 % 256, y * 7 % 256, (x ^ y) % 256, 255], ch);
    const back = decodePng(encodePng(src));
    assert.equal(back.w, 64);
    assert.equal(back.h, 32);
    assert.equal(back.ch, ch);
    assert.deepEqual([...back.data], [...src.data]);
  }
});

test('decodes a real PNG this repo did not generate', () => {
  // icons/icon-512.png was painted by a separate Python pass. It exercises the
  // adaptive row filters (Sub/Up/Average/Paeth) that the fixtures, written
  // with filter 0, never reach.
  const p = decodePng(fs.readFileSync('icons/icon-512.png'), 'icon-512');
  assert.equal(p.w, 512);
  assert.equal(p.h, 512);
  assert.ok(p.ch === 3 || p.ch === 4);
  assert.equal(p.data.length, p.w * p.h * p.ch);
  // It is a vertical gradient, so it must fail exactly the two checks that
  // measure a vertical discontinuity and a directional luminance ramp.
  const r = analyse(p, 'albedo');
  assert.ok(r.fails.some(f => /does not tile/.test(f)));
  assert.ok(r.fails.some(f => /baked/.test(f)));
});

test('rejects what it cannot read rather than mis-parsing it', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG/);
  const png = encodePng(goodAlbedo(32, 32));
  png[8 + 8 + 8] = 16; // IHDR bit depth -> 16
  assert.throws(() => decodePng(png), /8-bit/);
});

// -- tiling ---------------------------------------------------------------

test('a periodic texture tiles; a seam in one column does not', () => {
  const good = tiling(goodAlbedo());
  assert.ok(good.ratio <= THRESHOLDS.seamRatio, `good fixture ratio ${good.ratio}`);
  assert.ok(good.p90 > 1, 'fixture must have real interior variation to be a fair test');

  const w = 256;
  const h = 256;
  const seamed = make(w, h, (x, y) => {
    const v = x === w - 1 ? 230 : 120 + field(x, y, w, h);
    return [v, v * 0.85, v * 0.7];
  });
  const bad = tiling(seamed);
  assert.ok(bad.ratio > THRESHOLDS.seamRatio, `seamed fixture ratio ${bad.ratio}`);
  assert.ok(analyse(seamed, 'albedo').fails.some(f => /does not tile/.test(f)));
});

test('a flat texture is not called seamed by a divide-by-almost-zero', () => {
  // interior variation ~0 and a 1-value seam is a ratio of infinity without the
  // denominator floor, which would reject every plain colour swatch.
  const flat = make(64, 64, (x) => (x === 63 ? [129, 129, 129] : [128, 128, 128]));
  assert.ok(tiling(flat).ratio <= THRESHOLDS.seamRatio);
});

// -- baked lighting -------------------------------------------------------

test('a lit albedo is rejected, an unlit one is not', () => {
  assert.ok(bakedLight(goodAlbedo()).spreadPct <= THRESHOLDS.bakedSpreadPct);

  const w = 256;
  const h = 256;
  // A soft band of light across the upper half, falling to nothing well before
  // either edge — so the texture still WRAPS cleanly and only the lighting
  // check has grounds to complain. That isolation is the point.
  //
  // It must be ASYMMETRIC about the midline. The first attempt used a cosine
  // ramp, which is symmetric, so the top and bottom halves had identical means
  // and the quadrant spread was 1.7% — a fixture built to be rejected that the
  // check was right to accept.
  const lit = make(w, h, (x, y) => {
    const t = y / h - 0.25;
    const shade = 0.3 + 0.7 * Math.exp(-(t * t) / (2 * 0.08 * 0.08));
    const v = (120 + field(x, y, w, h)) * shade;
    return [v, v * 0.85, v * 0.7];
  });
  const b = bakedLight(lit);
  assert.ok(b.spreadPct > THRESHOLDS.bakedSpreadPct, `lit fixture spread ${b.spreadPct}%`);
  const r = analyse(lit, 'albedo');
  assert.ok(r.fails.some(f => /baked/.test(f)));
  assert.ok(!r.fails.some(f => /does not tile/.test(f)), 'lit fixture must still tile, or the test proves nothing');
});

// -- normal maps ----------------------------------------------------------

const goodNormal = (w = 256, h = 256) => make(w, h, (x, y) => {
  const dx = Math.sin(TAU * 4 * x / w) * 28;
  const dy = Math.sin(TAU * 4 * y / h) * 28;
  return [128 + dx, 128 + dy, 240 + 10 * Math.cos(TAU * 2 * x / w)];
});

test('a normal map passes; a height field posing as one does not', () => {
  const n = normalSanity(goodNormal());
  assert.ok(n.meanB >= THRESHOLDS.normalMeanB, `good normal meanB ${n.meanB}`);
  assert.equal(analyse(goodNormal(), 'normal').fails.length, 0);

  const heightField = make(256, 256, (x, y) => {
    const v = 128 + field(x, y, 256, 256);
    return [v, v, v];
  });
  assert.ok(analyse(heightField, 'normal').fails.some(f => /height\/bump/.test(f)));
});

test('a normal map biased off centre is rejected', () => {
  const biased = make(256, 256, (x, y) => {
    const dx = Math.sin(TAU * 4 * x / 256) * 20;
    return [175 + dx, 128, 245];
  });
  assert.ok(analyse(biased, 'normal').fails.some(f => /near 128/.test(f)));
});

// -- single-channel maps --------------------------------------------------

test('a roughness map must be greyscale', () => {
  const grey = make(256, 256, (x, y) => {
    const v = 150 + field(x, y, 256, 256) * 0.5;
    return [v, v, v];
  });
  assert.ok(greyscale(grey) <= THRESHOLDS.greyDivergence);
  assert.equal(analyse(grey, 'roughness').fails.length, 0);

  const coloured = make(256, 256, (x, y) => {
    const v = 150 + field(x, y, 256, 256) * 0.5;
    return [v, v * 0.6, v * 0.35];
  });
  assert.ok(analyse(coloured, 'roughness').fails.some(f => /not greyscale/.test(f)));
});

test('a packed map must carry three different channels', () => {
  const packed = make(256, 256, (x, y) => [
    120 + field(x, y, 256, 256) * 0.4,          // occlusion
    170 + Math.sin(TAU * 8 * x / 256) * 40,     // roughness
    20,                                          // metalness: dielectric
  ]);
  assert.equal(analyse(packed, 'packed').fails.length, 0);

  const fake = make(256, 256, (x, y) => {
    const v = 150 + field(x, y, 256, 256) * 0.5;
    return [v, v, v];
  });
  const fakeFails = analyse(fake, 'packed').fails;
  assert.ok(fakeFails.some(f => /effectively greyscale/.test(f)));
  assert.equal(fakeFails.length, 1, 'the greyscale finding must be the only one, or the fixture is testing two things');
});

// -- shape and budget -----------------------------------------------------

test('non power-of-two dimensions are rejected', () => {
  assert.ok(isPow2(256) && isPow2(1) && !isPow2(300) && !isPow2(0));
  const npot = make(300, 256, () => [128, 128, 128]);
  assert.ok(analyse(npot, 'albedo').fails.some(f => /powers of two/.test(f)));
  assert.equal(analyse(goodAlbedo(256, 128), 'albedo').fails.length, 0);
});

test('a sky must be 2:1 equirectangular', () => {
  assert.equal(analyse(make(512, 256, () => [100, 120, 160]), 'sky').fails.length, 0);
  assert.ok(analyse(make(512, 512, () => [100, 120, 160]), 'sky').fails.some(f => /2:1/.test(f)));
});

test('decoded cost counts the mip chain, and the budget is a real constraint', () => {
  // RGBA8 1024x1024 is 4 MB; the mip chain adds a third.
  assert.ok(Math.abs(decodedMb(1024, 1024) - 4 * 4 / 3) < 0.001);
  // Six 1024 maps is 32 MB, which the 24 MB budget must reject — otherwise the
  // budget is decorative and an author would learn nothing from it.
  assert.ok(decodedMb(1024, 1024) * 6 > MEM_BUDGET_MB);
  // Six 512 maps is 8 MB, which must fit, or the budget forbids the set the
  // handoff document actually asks for.
  assert.ok(decodedMb(512, 512) * 6 < MEM_BUDGET_MB);
});

// -- kind inference -------------------------------------------------------

test('kind is inferred from the filename suffix, normal before albedo', () => {
  assert.equal(inferKind('bark_albedo.png'), 'albedo');
  assert.equal(inferKind('bark_basecolor.png'), 'albedo');
  assert.equal(inferKind('bark_normal.png'), 'normal');
  // "_color_normal" must read as a normal map, not an albedo: a normal map
  // scored as an albedo would be tested for baked lighting and pass, and the
  // check that actually matters would never run.
  assert.equal(inferKind('bark_color_normal.png'), 'normal');
  assert.equal(inferKind('bark_rough.png'), 'roughness');
  assert.equal(inferKind('bark_ao.png'), 'roughness');
  // A packed map must NOT be scored as a roughness map: it would fail the
  // greyscale check for doing precisely what packing is for.
  assert.equal(inferKind('bark_orm.png'), 'packed');
  assert.equal(inferKind('dusk_sky.png'), 'sky');
  assert.equal(inferKind('mystery.png'), 'albedo', 'unknown names get the strictest check set');
});

// -- the tool itself, end to end ------------------------------------------
// The checks above prove the measurements. These prove the thing an author
// actually runs: correct exit codes, so CI can depend on it.

test('the CLI accepts a good set, rejects a bad one, and tolerates an empty root', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'birb-assets-'));
  const run = (dir) => {
    try {
      execFileSync(process.execPath, ['tools/asset-check.mjs', dir], { encoding: 'utf8', stdio: 'pipe' });
      return 0;
    } catch (err) {
      return err.status;
    }
  };

  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  assert.equal(run(empty), 0, 'an empty asset root must not fail CI before the first texture exists');

  const good = path.join(root, 'good');
  fs.mkdirSync(good);
  fs.writeFileSync(path.join(good, 'bark_albedo.png'), encodePng(goodAlbedo()));
  fs.writeFileSync(path.join(good, 'bark_normal.png'), encodePng(goodNormal()));
  assert.equal(run(good), 0, 'a conforming set must pass');

  const bad = path.join(root, 'bad');
  fs.mkdirSync(bad);
  // A left-to-right ramp: does not tile AND has the light baked in.
  fs.writeFileSync(path.join(bad, 'rock_albedo.png'), encodePng(
    make(256, 256, (x) => { const v = 60 + (x / 256) * 160; return [v, v * 0.9, v * 0.8]; })));
  assert.equal(run(bad), 1, 'a texture that does not tile must be rejected');

  // A missing path is still an operator error, not an empty asset root.
  assert.equal(run(path.join(root, 'nope')), 2);

  fs.rmSync(root, { recursive: true, force: true });
});
