/**
 * Does every shader in every environment actually COMPILE?
 *
 * This exists because two shaders in one session failed to compile and
 * neither failure looked like a failure. Three logs the error and then
 * quietly draws nothing for the material, so the page renders, the frame
 * looks plausible, the screenshot harness exits zero — and an entire system
 * is missing. Once it was the weather (a variable named `half`, which is a
 * reserved word in GLSL ES); once it was the ground of the city (a varying
 * declared twice by two injections that both wanted it).
 *
 * The tell in both cases was a stream of `useProgram: program not valid`
 * warnings, which is the one thing this checks for. Every environment is
 * visited, because a material that only exists in one biome is exactly the
 * kind that goes unchecked.
 *
 * Exits non-zero on any shader error, any page error, or any console error.
 */
import { chromium } from 'playwright';
import {
  startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame,
} from './birb-shot.mjs';

const ENVIRONMENTS = ['forest', 'canyons', 'mountain', 'city'];

async function main() {
    const { server, port } = await startServer(process.cwd());
    const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    await installCdnCache(context);
    const page = await context.newPage();

    const problems = [];
    page.on('console', (m) => {
        const text = m.text();
        if (m.type() === 'error' || /program not valid|Shader Error|not compiled/i.test(text)) {
            problems.push(`${m.type()}: ${text.slice(0, 600)}`);
        }
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

    await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`);
    await startGame(page);

    // This boots at the PRODUCTION default (Ultra: VSM shadow maps, 4x MSAA
    // on the scene target, full-resolution post, the high ground mesh) on
    // purpose — the shadow-depth and multisample programs only exist on that
    // path, and a shader gate that runs at a lighter preset never compiles
    // them. It is the one harness that stays at Ultra; the others boot at
    // `?quality=amazing` (see docs/perf/gates/G-ULTRA-DEFAULT.md).
    for (const env of ENVIRONMENTS) {
        const before = problems.length;
        await page.evaluate((id) => window.__BIRB.setEnvironment(id), env);
        // FRAMES, never milliseconds. A program is only compiled when
        // something is drawn with it, so the biome has to actually render
        // before its errors can exist — and at the Ultra default a
        // SwiftShader frame is about 2.6 s, so the old fixed 2200 ms wait
        // could switch biomes before a single frame of the previous one had
        // drawn, and report "ok" for materials that were never submitted.
        // Three frames: the first is the switch, the next two are the
        // biome's own materials (and the shadow pass) at least once each.
        await page.evaluate(() => new Promise((resolve) => {
            let n = 0;
            const tick = () => { n += 1; if (n >= 3) resolve(); else requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
        }));
        console.log(`  ${env}: ${problems.length === before ? 'ok' : `${problems.length - before} problem(s)`}`);
    }

    await browser.close();
    server.close();

    if (problems.length) {
        console.error('SHADER / CONSOLE PROBLEMS:\n  ' + problems.slice(0, 12).join('\n  '));
        console.error(`FAILED: ${problems.length} problem(s). A shader that fails to compile `
            + 'renders as nothing at all, so the page will still look fine.');
        process.exit(1);
    }
    console.log(`all shaders compile in ${ENVIRONMENTS.length} environments`);
    process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
