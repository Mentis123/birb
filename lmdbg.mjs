import { chromium, devices } from 'playwright';
import { startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './tools/birb-shot.mjs';
const { server, port } = await startServer(process.cwd());
const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport:{width:390,height:844}, deviceScaleFactor:1 });
await installCdnCache(ctx);
const page = await ctx.newPage();
page.on('pageerror', e=>console.log('PAGEERR:', e.message));
page.on('console', m=>{ if(m.type()!=='log') console.log(m.type().toUpperCase()+':', m.text().slice(0,220)); });
await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`, { waitUntil:'domcontentloaded' });
await startGame(page, 45000);
console.log('landmarks:', JSON.stringify(await page.evaluate(()=>window.__BIRB.landmarks())));
console.log('group present:', await page.evaluate(()=>{
  let found=null; window.__BIRB && null;
  return null;
}));
await browser.close(); server.close();
