/**
 * keyart.js — the splash / title hero image, painted in code.
 *
 * VYOM ships zero external assets, and that rule does not get a carve-out for
 * marketing art. This paints the key art onto a 2D canvas at load: sky gradient,
 * the planet limb, a canyon cut, silhouetted pines, the sun, and a hero bird in
 * flight with two rivals behind it.
 *
 * It runs before Three.js has even been fetched, so the splash is up instantly
 * on a cold load instead of waiting on the CDN.
 */

import { CSS } from '../core/palette.js';
import { makeRng } from '../core/rng.js';

/**
 * Paint the key art into a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} width   CSS pixels
 * @param {number} height  CSS pixels
 * @param {number} [dpr]
 */
export function paintKeyArt(canvas, width, height, dpr = Math.min(devicePixelRatio || 1, 2)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const rng = makeRng(0x5eed);

    // --- sky ------------------------------------------------------------
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, CSS.skyZenith);
    sky.addColorStop(0.52, CSS.skyMid);
    sky.addColorStop(1, CSS.skyHorizon);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // --- sun: hard disc + banded halo, graphic not photographic ---------
    const sunX = width * 0.74;
    const sunY = height * 0.24;
    const sunR = Math.min(width, height) * 0.085;
    // Banded halo: a few hard-edged rings, not an alpha gradient. A soft radial
    // falloff reads as a lens artifact; concentric steps read as drawn light.
    const HALO = [[2.05, 0.10], [1.62, 0.16], [1.28, 0.26]];
    for (let i = 0; i < HALO.length; i++) {
        ctx.globalAlpha = HALO[i][1];
        ctx.fillStyle = CSS.sunHalo;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR * HALO[i][0], 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = CSS.sunCore;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    // --- cel clouds: flat-bottomed shapes with a hard terminator ---------
    for (let i = 0; i < 5; i++) {
        const cw = width * (0.22 + rng() * 0.20);
        const cx = rng() * (width + cw) - cw * 0.5;
        const cy = height * (0.09 + rng() * 0.24);
        celCloud(ctx, cx, cy, cw, cw * 0.22, 3 + Math.floor(rng() * 2), rng);
    }

    // --- planet limb -----------------------------------------------------
    // A very large circle whose top edge becomes the horizon curve.
    // Radius kept close to the frame width so the limb visibly CURVES. Make it
    // much larger and the horizon flattens into an ordinary hillside, which
    // loses the one thing that says "you are racing around a small planet".
    const planetR = width * 0.95;
    const planetCX = width * 0.5;
    const planetCY = height * 0.72 + planetR;

    ctx.save();
    ctx.beginPath();
    ctx.arc(planetCX, planetCY, planetR, 0, Math.PI * 2);
    ctx.clip();

    const ground = ctx.createLinearGradient(0, height * 0.62, 0, height);
    ground.addColorStop(0, CSS.meadowLit);
    ground.addColorStop(0.5, CSS.meadowMid);
    ground.addColorStop(1, CSS.meadowDeep);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, width, height);

    // Canyon: a cut receding to the horizon, narrow far and wide near, so it
    // reads as carved DOWN into the ground rather than piled up on top of it.
    const rim = height * 0.745;
    const quad = (ax, ay, bx, by, cx2, cy2, dx, dy, fill) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(width * ax, ay);
        ctx.lineTo(width * bx, by);
        ctx.lineTo(width * cx2, cy2);
        ctx.lineTo(width * dx, dy);
        ctx.closePath();
        ctx.fill();
    };

    // Two walls and a floor, not one flat wedge. Without separately shaded
    // walls the cut reads as a brown road painted on the grass rather than a
    // canyon carved into it. The sun sits to the right, so the LEFT wall (whose
    // face turns toward it) is the lit one.
    quad(0.455, rim, 0.478, rim, 0.30, height, 0.06, height, CSS.canyonLit);
    quad(0.512, rim, 0.535, rim, 0.92, height, 0.66, height, CSS.canyonMid);
    quad(0.478, rim, 0.512, rim, 0.66, height, 0.30, height, CSS.canyonDeep);

    // Ink the rim so the opening reads as an edge you could fall over.
    ctx.strokeStyle = CSS.ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1.5, width * 0.004);
    ctx.beginPath();
    ctx.moveTo(width * 0.06, height);
    ctx.lineTo(width * 0.455, rim);
    ctx.lineTo(width * 0.535, rim);
    ctx.lineTo(width * 0.92, height);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // pines along the ridge, skipping the canyon mouth
    for (let i = 0; i < 30; i++) {
        const px = rng() * width;
        const t = rng();
        const py = rim - height * 0.055 + t * height * 0.05;
        const ph = height * (0.035 + (1 - t) * 0.035);
        const gap = Math.abs(px - width * 0.5) / width;
        if (gap < 0.06 + t * 0.28) continue; // don't grow trees in mid-air
        ctx.fillStyle = t > 0.5 ? CSS.pineDeep : CSS.pineLit;
        ctx.beginPath();
        ctx.moveTo(px, py - ph);
        ctx.lineTo(px + ph * 0.34, py);
        ctx.lineTo(px - ph * 0.34, py);
        ctx.closePath();
        ctx.fill();
    }

    // The racing ribbon: sweeps in from the left rim and dives into the cut.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? CSS.ribbon : CSS.ribbonEdge;
        ctx.lineWidth = pass === 0 ? Math.max(4, width * 0.016) : Math.max(1.5, width * 0.005);
        ctx.beginPath();
        ctx.moveTo(width * -0.05, rim + height * 0.045);
        ctx.bezierCurveTo(
            width * 0.24, rim - height * 0.015,
            width * 0.40, rim + height * 0.005,
            width * 0.495, rim + height * 0.012
        );
        ctx.bezierCurveTo(
            width * 0.53, rim + height * 0.09,
            width * 0.56, rim + height * 0.16,
            width * 0.60, height
        );
        ctx.stroke();
    }
    ctx.restore();

    // horizon ink line, so the planet reads as illustrated
    ctx.strokeStyle = CSS.ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(2, width * 0.004);
    ctx.beginPath();
    ctx.arc(planetCX, planetCY, planetR, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // --- birds ------------------------------------------------------------
    drawBird(ctx, width * 0.36, height * 0.42, Math.min(width, height) * 0.16, CSS.birdPlayer, CSS.beak, CSS.ink, -0.22);
    drawBird(ctx, width * 0.60, height * 0.54, Math.min(width, height) * 0.085, CSS.birdRival1, CSS.beak, CSS.ink, 0.12);
    drawBird(ctx, width * 0.20, height * 0.58, Math.min(width, height) * 0.065, CSS.birdRival2, CSS.beak, CSS.ink, 0.30);

    // --- speed lines ------------------------------------------------------
    ctx.strokeStyle = CSS.speedLine;
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
        const ly = height * (0.20 + rng() * 0.45);
        const lx = width * (0.02 + rng() * 0.55);
        const ll = width * (0.04 + rng() * 0.12);
        ctx.globalAlpha = 0.18 + rng() * 0.30;
        ctx.lineWidth = Math.max(1.5, width * 0.0035);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + ll, ly - ll * 0.18);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    return canvas;
}

/**
 * A cel cloud: flat bottom, a few big lobes on top, and a HARD terminator
 * between lit and shaded halves. The hard edge is the whole point — a soft
 * radial blob reads as photographic haze and breaks the art direction.
 */
function celCloud(ctx, cx, cy, w, h, lobes, rng) {
    // The silhouette is the union of a few overlapping discs, filled as ONE
    // path so there are no internal seams between lobes.
    const discs = [];
    for (let i = 0; i < lobes; i++) {
        const t = lobes === 1 ? 0.5 : i / (lobes - 1);
        discs.push({
            x: cx - w / 2 + w * t,
            y: cy + (i % 2 === 0 ? -h * 0.12 : h * 0.08),
            r: h * (0.62 + 0.46 * Math.abs(Math.sin(i * 2.7 + lobes))),
        });
    }
    const tracePath = () => {
        ctx.beginPath();
        for (let i = 0; i < discs.length; i++) {
            const d = discs[i];
            ctx.moveTo(d.x + d.r, d.y);
            ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        }
    };

    ctx.save();
    tracePath();
    ctx.fillStyle = CSS.cloudShade;
    ctx.fill();

    // Clip to the silhouette, then fill the SAME silhouette shifted up. The
    // terminator is therefore the shape's own lower outline — a wavy line that
    // follows the lobes. (Filling a straight-bottomed band instead gives the
    // cloud a hard horizontal edge that reads as a bar; shading each lobe with
    // its own disc gives visible circles. This is the version that reads.)
    tracePath();
    ctx.clip();
    ctx.translate(0, -h * 0.42);
    tracePath();
    ctx.fillStyle = CSS.cloudLit;
    ctx.fill();
    ctx.restore();
}

/**
 * A chibi bird in a banked glide — the same silhouette language as the 3D
 * model: round body, big eye, prominent beak, swept wings.
 */
function drawBird(ctx, x, y, size, body, beakColor, ink, tilt) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(2, size * 0.055);

    // far wing — swept back and slightly down, reading behind the body
    ctx.fillStyle = shade(body, -0.24);
    ctx.beginPath();
    ctx.moveTo(-size * 0.02, -size * 0.06);
    ctx.quadraticCurveTo(-size * 0.38, -size * 0.62, -size * 0.90, -size * 0.50);
    ctx.quadraticCurveTo(-size * 0.48, -size * 0.22, -size * 0.14, size * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // body
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.52, size * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // near wing — raised and swept back at the top of the downstroke
    ctx.fillStyle = shade(body, 0.14);
    ctx.beginPath();
    ctx.moveTo(size * 0.14, -size * 0.10);
    ctx.quadraticCurveTo(-size * 0.08, -size * 0.88, -size * 0.66, -size * 0.96);
    ctx.quadraticCurveTo(-size * 0.34, -size * 0.50, -size * 0.06, -size * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // tail fan
    ctx.fillStyle = shade(body, -0.14);
    ctx.beginPath();
    ctx.moveTo(-size * 0.44, size * 0.00);
    ctx.lineTo(-size * 0.94, -size * 0.10);
    ctx.lineTo(-size * 1.00, size * 0.14);
    ctx.lineTo(-size * 0.84, size * 0.30);
    ctx.lineTo(-size * 0.40, size * 0.20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // beak
    ctx.fillStyle = beakColor;
    ctx.beginPath();
    ctx.moveTo(size * 0.44, -size * 0.02);
    ctx.lineTo(size * 0.82, size * 0.07);
    ctx.lineTo(size * 0.44, size * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // eye
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(size * 0.24, -size * 0.12, size * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(size * 0.29, -size * 0.12, size * 0.075, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

/** Lighten (+) or darken (-) a #rrggbb string. */
function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const f = amount < 0 ? 0 : 255;
    const p = Math.abs(amount);
    const r = Math.round(((n >> 16) & 255) * (1 - p) + f * p);
    const g = Math.round(((n >> 8) & 255) * (1 - p) + f * p);
    const b = Math.round((n & 255) * (1 - p) + f * p);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
