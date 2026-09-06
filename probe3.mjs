import { chromium } from 'playwright';
import { startServer, findChromium, installCdnCache, CHROMIUM_ARGS } from './tools/birb-shot.mjs';
const { server, port } = await startServer(process.cwd());
const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
const ctx = await browser.newContext({ viewport:{width:1280,height:800}, deviceScaleFactor:1 });
await installCdnCache(ctx);
const page = await ctx.newPage();
page.on('pageerror', e=>console.log('PAGEERR:', e.message));
page.on('console', m=>{ if(m.type()==='error') console.log('CONSOLE:', m.text().slice(0,150)); });
await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(4000);
console.log(JSON.stringify(await page.evaluate(() => ({
  splash: !!document.querySelector('[data-splash-screen]'),
  splashVisible: document.querySelector('[data-splash-screen]') ? getComputedStyle(document.querySelector('[data-splash-screen]')).opacity : null,
  vibe: !!document.querySelector('[data-vibe-splash]'),
  titleHidden: document.querySelector('[data-title-screen]')?.hidden,
  ready: window.__BIRB_READY,
}))));
await browser.close(); server.close();
