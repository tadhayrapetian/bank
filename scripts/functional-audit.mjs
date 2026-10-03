/**
 * Functional audit of the whole interface.
 *  1. Static scan: TODO/FIXME, "Coming soon", Lorem Ipsum, stubs, window.confirm/alert/prompt.
 *  2. Browser crawl (dev or preview server): every route, as a client, a manager and an administrator,
 *     at desktop and phone widths. Reports console errors, stub pages, horizontal overflow,
 *     dead buttons (no click handler, not a submit button), links without href,
 *     raw translation keys and "undefined/NaN/[object Object]" leaking into the page.
 *   node scripts/functional-audit.mjs [--url http://localhost:5173/] [--quick] [--lang ru]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] ?? true : d; };
const BASE = opt('url', 'http://localhost:5173/');
const QUICK = argv.includes('--quick');
const LANG = opt('lang', 'en');
const OUT = opt('out', 'audit-report.json');

const issues = [];
const add = (kind, where, detail) => issues.push({ kind, where, detail });

// ── 1. Static scan ──
const banned = [
  [/\bTODO\b|\bFIXME\b|(?<!')\bXXX\b(?!')/, 'todo'],
  [/coming soon/i, 'coming-soon'],
  [/lorem ipsum/i, 'lorem'],
  [/STUB-PAGE|data-stub/, 'stub'],
  [/window\.(confirm|alert|prompt)\s*\(|(?<![.\w])(alert|confirm|prompt)\s*\(/, 'native-dialog'],
];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'data') walk(p); continue; }
    if (!/\.(tsx?|css)$/.test(e.name)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      for (const [re, kind] of banned) if (re.test(line) && !/confirmAction|onConfirm|confirmLabel|\bconfirm[A-Z]|confirm\(\s*\)|'confirm'|"confirm"|confirmSend/.test(line)) add(kind, `${p}:${i + 1}`, line.trim().slice(0, 120));
    });
  }
})('src');
console.log(`static scan: ${issues.length} issues`);

// ── 2. Crawl ──
const routes = [...fs.readFileSync('src/app/routes.ts', 'utf8').matchAll(/path: '([^']+)'/g)].map((m) => m[1]).filter((p) => p !== '*');
const identities = QUICK ? ['Aurelia'] : ['Aurelia', 'Holloway', 'Vantress'];
const widths = QUICK ? [1440] : [1440, 390];

const browser = await chromium.launch();
for (const who of identities) {
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    let current = '';
    page.on('console', (m) => { if (m.type() === 'error') add('console', `${who}@${width} ${current}`, m.text().slice(0, 300)); });
    page.on('pageerror', (e) => add('pageerror', `${who}@${width} ${current}`, e.message.slice(0, 300)));
    await page.goto(BASE);
    await page.waitForSelector('.gate, .app', { timeout: 90000 });
    if (await page.locator('.app').count() === 0) {
      const skip = page.getByRole('button', { name: /Skip and explore/i });
      if (await skip.count()) await skip.click();
      else await page.locator('.list-item', { hasText: 'Aurelia' }).first().click();
      await page.waitForSelector('.app', { timeout: 30000 });
    }
    await page.evaluate(async ({ name, lang }) => {
      const { db } = await import('/src/core/db/db.ts');
      const { switchIdentity } = await import('/src/core/security/auth.ts');
      const { useSession } = await import('/src/state/session.ts');
      const { useUI } = await import('/src/state/ui.ts');
      const u = (await db.users.toArray()).find((x) => x.name.includes(name));
      useSession.getState().setUser(await switchIdentity(u.id));
      useUI.getState().setLang(lang);
    }, { name: who, lang: LANG });
    const ids = await page.evaluate(async () => {
      const { db } = await import('/src/core/db/db.ts');
      const { useSession } = await import('/src/state/session.ts');
      const me = useSession.getState().user;
      const acc = (await db.accounts.toArray()).find((a) => a.ownerId === me.id) ?? (await db.accounts.toCollection().first());
      const pick = async (table, filter) => ((await db[table].toArray()).find(filter ?? (() => true)) ?? {}).id;
      return {
        accounts: acc?.id, transactions: await pick('transactions', (t) => t.sender?.userId === me.id || t.recipient?.userId === me.id),
        cards: await pick('cards', (c) => c.ownerId === me.id), checks: await pick('checks'), documents: await pick('documents', (d) => d.ownerId === me.id),
        editor: await pick('documents', (d) => d.ownerId === me.id), deposits: await pick('deposits'), loans: await pick('loans'), invoices: await pick('invoices'),
        disputes: await pick('disputes'), pay: (await db.links.toCollection().first())?.code,
      };
    });
    for (const r of routes) {
      const seg = r.split('/')[1];
      const url = r.includes(':') ? r.replace(/:(id|code)/, ids[seg] ?? 'missing') : r;
      current = url;
      await page.evaluate((h) => (location.hash = h), '#' + url);
      await page.waitForTimeout(QUICK ? 700 : 1100);
      const res = await page.evaluate(() => {
        const out = { stub: !!document.querySelector('[data-stub]'), overflow: document.documentElement.scrollWidth - window.innerWidth, dead: [], noHref: [], raw: [], junk: [] };
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        const props = (el) => { const k = Object.keys(el).find((x) => x.startsWith('__reactProps$')); return k ? el[k] : null; };
        for (const b of document.querySelectorAll('button, [role="button"]')) {
          if (!visible(b) || b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
          const p = props(b);
          const form = b.closest('form');
          const ok = p && (p.onClick || p.onMouseDown || p.onPointerDown || p.onKeyDown) || (b.type === 'submit' && form && props(form)?.onSubmit) || b.closest('label') || (b.type === 'submit' && form);
          if (!ok) out.dead.push((b.getAttribute('aria-label') || b.textContent || b.outerHTML).trim().slice(0, 60));
        }
        for (const a of document.querySelectorAll('a')) if (visible(a) && !a.getAttribute('href') && !props(a)?.onClick) out.noHref.push((a.textContent || '').trim().slice(0, 60));
        const walker = document.createTreeWalker(document.querySelector('.main') ?? document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const s = n.textContent.trim();
          if (!s) continue;
          if (/^[a-z][a-zA-Z]*(\.[a-zA-Z0-9_]+){1,5}$/.test(s) && !/\.(pdf|png|json|csv|txt)$/.test(s)) out.raw.push(s);
          if (/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/.test(s)) out.junk.push(s.slice(0, 80));
        }
        return out;
      });
      const where = `${who}@${width} ${url}`;
      if (res.stub) add('stub-page', where, '');
      if (res.overflow > 1) add('h-overflow', where, `${res.overflow}px`);
      res.dead.forEach((d) => add('dead-button', where, d));
      res.noHref.forEach((d) => add('link-no-href', where, d));
      [...new Set(res.raw)].forEach((d) => add('raw-key', where, d));
      [...new Set(res.junk)].forEach((d) => add('junk-text', where, d));
    }
    console.log(`crawled ${routes.length} routes as ${who} @ ${width}px`);
    await ctx.close();
  }
}
await browser.close();

const byKind = issues.reduce((m, i) => ((m[i.kind] = (m[i.kind] ?? 0) + 1), m), {});
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, lang: LANG, at: new Date().toISOString(), summary: byKind, issues }, null, 2));
console.log('summary:', byKind);
for (const i of issues.slice(0, 80)) console.log(`  [${i.kind}] ${i.where} ${i.detail}`);
if (issues.length > 80) console.log(`  … ${issues.length - 80} more in ${OUT}`);
process.exit(issues.length ? 1 : 0);
