#!/usr/bin/env node
/**
 * make-sky.mjs — write placeholder equirectangular skies from the game's own
 * four-stop gradient.
 *
 * These are NOT the authored art. They exist so the sky-texture path can be
 * built, tested and measured before any authored panorama arrives -- the rule
 * this track learned three times over: prove the consumer before the asset.
 * They are also the honest fallback if authored skies never land, since they
 * reproduce exactly what the dome already paints.
 *
 *   node tools/make-sky.mjs --out assets/env --size 1024
 *
 * Drop a real 2:1 panorama over one of these and nothing else has to change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { encodePng } from './lib/asset-analysis.mjs';
import { skyRadianceAt, rowUpComponent } from '../src/environment/sky-environment.js';

// The shipped per-biome skies, from src/environment/world-shell.js.
const BIOMES = {
  forest:   { top: 0x397da7, mid: 0x91bdb9, horizon: 0xffe0a1, bottom: 0x3c665d },
  canyons:  { top: 0x756eaa, mid: 0xdca68e, horizon: 0xffd4a1, bottom: 0x644959 },
  mountain: { top: 0x3d74ad, mid: 0x9dc0d4, horizon: 0xe3d3ae, bottom: 0x44637e },
  city:     { top: 0x283a75, mid: 0x748da9, horizon: 0xe5b7a0, bottom: 0x283c55 },
};

/** Linear -> sRGB, because a PNG is a picture and the gradient is radiance. */
const lin2srgb = (v) => {
  const c = Math.max(0, Math.min(1, v));
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
};

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const outDir = argOf('--out', 'assets/env');
const width = Number(argOf('--size', 1024));
const height = width >> 1;

fs.mkdirSync(outDir, { recursive: true });
for (const [name, sky] of Object.entries(BIOMES)) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    // Row 0 of a PNG is the TOP, while the equirect convention three uses puts
    // v = 0 at the nadir. Flip here, or every sky ships upside down.
    const rgb = skyRadianceAt(rowUpComponent(height - 1 - y, height), sky);
    const px = [lin2srgb(rgb[0]), lin2srgb(rgb[1]), lin2srgb(rgb[2])];
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      data[i] = px[0]; data[i + 1] = px[1]; data[i + 2] = px[2];
    }
  }
  const file = path.join(outDir, `${name}_sky.png`);
  fs.writeFileSync(file, encodePng({ w: width, h: height, ch: 3, data }));
  console.log(`wrote ${file}  ${width}x${height}`);
}
console.log('\nplaceholders only — an authored panorama replaces one of these with no code change');
