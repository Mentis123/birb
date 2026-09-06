import { chromium, devices } from 'playwright';
import { startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './tools/birb-shot.mjs';
const { server, port } = await startServer(process.cwd());
const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport:{width:390,height:844}, deviceScaleFactor:1 });
await installCdnCache(ctx);
const page = await ctx.newPage();
const errs=[]; page.on('pageerror', e=>errs.push('page: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errs.push('console: '+m.text().slice(0,140)); });
await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`, { waitUntil:'domcontentloaded' });
await startGame(page, 45000);
console.log('modes:', JSON.stringify(await page.evaluate(()=>window.__BIRB.modes())));
for (const mode of await page.evaluate(()=>window.__BIRB.modes())) {
  const active = await page.evaluate(m=>window.__BIRB.startMode(m), mode);
  await page.waitForTimeout(2500);
  const st = await page.evaluate(()=>window.__BIRB.modeState());
  console.log(`${mode}: active=${active} ->`, JSON.stringify(st));
  await page.evaluate(()=>window.__BIRB.endMode(false));
  await page.waitForTimeout(900);
}
console.log('errors:', errs.length?errs:'none');
await browser.close(); server.close();
