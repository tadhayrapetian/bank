/**
 * Dev smoke tool: boots Ledgerhall in Chromium, signs in as a demo identity,
 * visits routes, saves screenshots and reports console/page errors.
 *   node scripts/shot.mjs --as Aurelia --routes /,/accounts --out shots [--width 1440] [--height 900] [--lang ru] [--full]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);
const base = args.url ?? 'http://localhost:5173/';
const who = args.as ?? 'Aurelia';
const routes = (args.routes ?? '/').split(',');
const out = args.out ?? 'shots';
const width = Number(args.width ?? 1440);
const height = Number(args.height ?? 900);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text().slice(0, 400)}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

await page.goto(base);
await page.waitForSelector('.gate, .app', { timeout: 60000 });
if (args.lang) await page.evaluate((l) => localStorage.setItem('ledgerhall.ui', JSON.stringify({ ...JSON.parse(localStorage.getItem('ledgerhall.ui') ?? '{}'), lang: l })), args.lang);
if (await page.locator('.app').count() === 0) {
  const skip = page.getByRole('button', { name: /Skip and explore/i });
  if (await skip.count()) await skip.click();
  else await page.locator('.list-item', { hasText: who }).first().click();
  await page.waitForSelector('.app', { timeout: 30000 });
}
if (who !== 'Aurelia' && !(await page.locator('.topbar').innerText()).includes(who)) {
  await page.evaluate(async (name) => {
    const { switchIdentity } = await import('/src/core/security/auth.ts');
    const { db } = await import('/src/core/db/db.ts');
    const u = (await db.users.toArray()).find((x) => x.name.includes(name));
    const { useSession } = await import('/src/state/session.ts');
    useSession.getState().setUser(await switchIdentity(u.id));
  }, who);
}
if (args.lang) await page.evaluate(async (l) => (await import('/src/state/ui.ts')).useUI.getState().setLang(l), args.lang);

for (const r of routes) {
  await page.evaluate((h) => (location.hash = h), '#' + r);
  await page.waitForTimeout(Number(args.wait ?? 1200));
  const name = (r === '/' ? 'dashboard' : r.replace(/^\//, '').replace(/[/?=&]/g, '_')) + (args.suffix ?? '');
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: args.full === 'true' });
  const stub = await page.locator('[data-stub]').count();
  console.log(`${r} → ${name}.png${stub ? ' (STUB)' : ''}`);
}
if (problems.length) console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n'));
else console.log('no console errors');
await browser.close();
