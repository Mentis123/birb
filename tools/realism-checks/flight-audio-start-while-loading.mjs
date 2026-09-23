/**
 * Tap-to-Start while the game is still downloading.
 *
 * The Start button is wired near the top of the module script and its first
 * act was `unlockAudio()` — a const declared AFTER the module's import
 * awaits. Measured with three.js's core module held in flight for 15 s: a tap
 * in that window threw "Cannot access 'unlockAudio' before initialization",
 * the handler died before its own "scene still loading" branch, so the button
 * never said Loading…, nothing was queued, the game never started by itself,
 * and the boot watchdog recorded the ReferenceError as its `reason` — so the
 * next tap, or the 25 s timer, offered to clear the cache of a game that was
 * loading perfectly well. That is the "hitting start doesn't start" shape,
 * and the only way to see it is to tap during the download.
 *
 * This check owns its own browser context (it needs a route in place before
 * the page loads, which the runner's shared boot cannot give it): it holds
 * three.core.mjs, taps Start the moment the Title is up, and asserts the tap
 * is queued, nothing throws, and the game starts itself when the module
 * lands. Game time is not involved; the waits are for a download.
 */
import { devices } from 'playwright';
import { installCdnCache } from '../birb-shot.mjs';

export const name = 'flight-audio-start-while-loading';

const HOLD_MS = 12000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run(ctx) {
  const origin = new URL(ctx.page.url()).origin;
  const browser = ctx.page.context().browser();
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
  });
  try {
    await installCdnCache(context);
    let released = false;
    await context.route(/esm\.sh\/three@0\.183\.2\/es2022\/build\/three\.core\.mjs/, async (route) => {
      await wait(HOLD_MS);
      released = true;
      await route.fallback();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('page: ' + String((e && e.message) || e)));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`);
    });
    await page.goto(`${origin}/index.html?debug=1&quality=amazing`, { waitUntil: 'domcontentloaded' });

    // Click through the splashes as fast as a thumb can.
    const t0 = Date.now();
    let titleUp = false;
    while (Date.now() - t0 < HOLD_MS - 2000) {
      titleUp = await page.evaluate(() => {
        const s = document.querySelector('[data-title-start]');
        const sc = document.querySelector('[data-title-screen]');
        return !!s && !sc?.hidden;
      });
      if (titleUp) break;
      await page.evaluate(() => {
        document.querySelector('[data-splash-screen]')?.click();
        document.querySelector('[data-vibe-splash]')?.click();
      });
      await wait(200);
    }
    ctx.check(titleUp && !released, `the Title is up while three.js is still downloading (${Date.now() - t0} ms)`);

    await page.click('[data-title-start]', { timeout: 10000 });
    await wait(300);
    const tapped = await page.evaluate(() => ({
      text: document.querySelector('[data-title-start]').textContent,
      disabled: document.querySelector('[data-title-start]').disabled,
      boot: window.__birbBootState ? window.__birbBootState() : null,
    }));
    ctx.check(tapped.text.includes('Loading') && tapped.disabled,
      `the early tap is taken: the button reads "${tapped.text}" and is disabled`);
    ctx.check(tapped.boot && tapped.boot.reason === '',
      `nothing threw, so the boot watchdog has no reason to offer a cache wipe (reason "${tapped.boot && tapped.boot.reason}")`);

    // The module lands; the queued start must run without another tap.
    await page.waitForFunction('window.__BIRB_READY === true', null, { timeout: 120000 });
    await page.waitForFunction(
      'window.__BIRB && window.__BIRB.stats().elapsed > 0.5', null, { timeout: 120000 },
    ).catch(() => {});
    const started = await page.evaluate(() => ({
      mainShown: !document.querySelector('[data-game-main]')?.hidden,
      titleHidden: !!document.querySelector('[data-title-screen]')?.hidden,
      elapsed: window.__BIRB.stats().elapsed,
      banner: !!document.querySelector('[data-boot-recovery]'),
      audio: window.__BIRB.flightAudio ? window.__BIRB.flightAudio() : { state: 'n/a' },
    }));
    ctx.check(started.mainShown && started.titleHidden && started.elapsed > 0.5,
      `the game started itself once loaded (main shown ${started.mainShown}, title hidden ${started.titleHidden}, elapsed ${started.elapsed})`);
    ctx.check(!started.banner, 'no "did not finish loading" banner');
    // The flight audio could not be built inside that tap (it did not exist
    // yet); it is built on the next gesture. Report, do not assert, what the
    // late start left it as.
    ctx.log(`flight audio after a late start: ${started.audio.state}`);
    ctx.check(errors.length === 0, `no console errors or warnings in the late-start boot (${errors.slice(0, 3).join(' | ') || 0})`);
  } finally {
    await context.close();
  }
}
