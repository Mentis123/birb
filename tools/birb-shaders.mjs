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

    for (const env of ENVIRONMENTS) {
        const before = problems.length;
        await page.evaluate((id) => window.__BIRB.setEnvironment(id), env);
        // Long enough for every material in the biome to be submitted at
        // least once: a program is only compiled when something is drawn with
        // it, so a short wait can miss the material that is broken.
        await page.waitForTimeout(2200);
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
