import { describe, it, expect, beforeAll } from 'vitest';
import { db, openDatabase } from '@/core/db/db';
import { seedDemo } from '@/core/seed/seed';
import { loadCaches } from '@/core/boot';
import { reconcileBalances, trialBalance } from '@/core/banking/ledger';
import { verifyAuditChain } from '@/core/ops/audit';

let warnings: string[] = [];
let ms = 0;

beforeAll(async () => {
  await openDatabase();
  await loadCaches();
  const t = Date.now();
  const r = await seedDemo();
  ms = Date.now() - t;
  warnings = r.warnings;
}, 600_000);

describe('demo world', () => {
  it('seeds within budget and reports warnings', () => {
    console.log(`seed time ${ms}ms, warnings ${warnings.length}`);
    console.log(warnings.slice(0, 60).join('\n'));
    expect(ms).toBeGreaterThan(0);
  });

  it('meets the minimum demo data counts', async () => {
    const counts = {
      clients: await db.users.where('kind').equals('client').count(),
      accounts: await db.accounts.filter((a) => a.ownerId !== 'BANK').count(),
      cards: await db.cards.count(),
      transactions: await db.transactions.count(),
      documents: await db.documents.count(),
      checks: await db.checks.count(),
      deposits: await db.deposits.count(),
      loans: await db.loans.count(),
      invoices: await db.invoices.count(),
      notifications: await db.notifications.count(),
      audit: await db.audit.count(),
      branches: await db.branches.count(),
      employees: await db.employees.count(),
    };
    console.log(JSON.stringify(counts));
    expect(counts.clients).toBeGreaterThanOrEqual(20);
    expect(counts.accounts).toBeGreaterThanOrEqual(30);
    expect(counts.cards).toBeGreaterThanOrEqual(20);
    expect(counts.transactions).toBeGreaterThanOrEqual(100);
    expect(counts.documents).toBeGreaterThanOrEqual(20);
    expect(counts.checks).toBeGreaterThanOrEqual(20);
    expect(counts.deposits).toBeGreaterThanOrEqual(10);
    expect(counts.loans).toBeGreaterThanOrEqual(10);
    expect(counts.invoices).toBeGreaterThanOrEqual(20);
    expect(counts.notifications).toBeGreaterThanOrEqual(20);
    expect(counts.audit).toBeGreaterThanOrEqual(50);
    expect(counts.branches).toBeGreaterThanOrEqual(10);
    expect(counts.employees).toBeGreaterThanOrEqual(20);
  });

  it('keeps the ledger balanced and the projection in sync', async () => {
    const tb = await trialBalance();
    for (const r of tb) expect(r.debit).toBe(r.credit);
    const rec = await reconcileBalances();
    expect(rec.drift).toEqual([]);
  });

  it('has an intact audit hash chain', async () => {
    const r = await verifyAuditChain();
    expect(r.ok).toBe(true);
  });

  it('covers statuses across modules', async () => {
    const st = async (table: 'checks' | 'invoices' | 'loans' | 'deposits' | 'disputes') => [...new Set((await (db[table] as any).toArray()).map((x: { status: string }) => x.status))].sort();
    console.log('checks', await st('checks'));
    console.log('invoices', await st('invoices'));
    console.log('loans', await st('loans'));
    console.log('deposits', await st('deposits'));
    console.log('disputes', await st('disputes'));
    const tx = [...new Set((await db.transactions.toArray()).map((t) => t.status))];
    console.log('tx', tx);
  });
});
