import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db/db';
import { asActor, SYSTEM_ACTOR } from '@/core/context';
import { freshWorld, makeUser, actorOf, fund, accountFor } from './helpers';
import { balanceOf, availableOf, reconcileBalances, trialBalance, post, placeHold } from '@/core/banking/ledger';
import { transfer, transferOwn } from '@/core/banking/payments';
import { exchange } from '@/core/banking/fx';
import { createCheck, signCheck, issueCheck, presentCheck } from '@/core/banking/checks';
import { applyLoan, acceptAndDisburse, payInstallment, payOffEarly, annuityPayment } from '@/core/banking/loans';
import { openDeposit, accrueDepositsFor, closeDeposit } from '@/core/banking/deposits';
import { freezeAccount, unfreezeAccount, setAccountLimit, closeAccount } from '@/core/banking/accounts';
import { reverseTransaction } from '@/core/banking/engine';
import { createInvoice, sendInvoice, payInvoice } from '@/core/banking/invoices';
import { issueCard, cardPayment, setCardControls } from '@/core/banking/cards';
import { amountInWords, numberToWords } from '@/core/currency/words';
import { toMinor, formatMoney } from '@/core/currency/format';
import { currencies } from '@/core/currency/registry';
import { quote } from '@/core/currency/rates';
import { verifyAuditChain } from '@/core/ops/audit';
import { buildBackup, validateBackup } from '@/core/ops/backup';
import { isValidAccountNumber, makeAccountNumber } from '@/core/banking/numbers';
import { shiftDates } from '@/core/seed/snapshot';
import { verifyDocument, signatureState, saveDocumentVersion } from '@/core/docs/documents';
import { luhnValid } from '@/core/util/random';
import { BankError } from '@/core/errors';
import type { User, Account } from '@/core/types';

let alice: User, bob: User, aliceAcc: Account, bobAcc: Account;

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect((e as BankError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

beforeEach(async () => {
  await freshWorld();
  alice = await makeUser('Alice Ashwood');
  bob = await makeUser('Bob Brindle');
  aliceAcc = await accountFor(alice, 'CRWN', 'current', { multiCurrency: true });
  bobAcc = await accountFor(bob);
  await fund(aliceAcc, 1000);
  await fund(bobAcc, 50);
});

describe('currency registry', () => {
  it('contains every active ISO 4217 code and separate magical currencies', () => {
    const iso = currencies.iso();
    expect(iso.filter((c) => c.kind === 'fiat' && c.status === 'active').length).toBeGreaterThanOrEqual(150);
    for (const code of ['USD', 'EUR', 'JPY', 'AMD', 'RUB', 'XCG', 'ZWG', 'SLE', 'VES', 'XAU', 'XDR']) expect(currencies.has(code)).toBe(true);
    expect(currencies.get('BGN')?.status).toBe('withdrawn');
    expect(currencies.magical().every((c) => c.code.length === 4)).toBe(true);
    expect(currencies.isTransactional('MIRE')).toBe(false);
  });

  it('formats and parses minor units by decimals', () => {
    expect(toMinor('1 234,56', 'EUR')).toBe(123456);
    expect(toMinor('1234', 'JPY')).toBe(1234);
    expect(toMinor('1.234', 'BHD')).toBe(1234);
    expect(formatMoney(123456, 'USD', { locale: 'en-GB' })).toBe('$1,234.56');
    expect(formatMoney(-500, 'EUR', { locale: 'en-GB' })).toBe('−€5.00');
  });

  it('writes amounts in words in three languages', () => {
    expect(numberToWords(1234, 'en')).toBe('one thousand two hundred thirty-four');
    expect(numberToWords(2021, 'ru')).toBe('две тысячи двадцать один');
    expect(numberToWords(1001, 'ru')).toBe('одна тысяча один');
    expect(numberToWords(21, 'hy')).toBe('քսանմեկ');
    expect(numberToWords(1500, 'hy')).toBe('հազար հինգ հարյուր');
    expect(amountInWords(123456, 'USD', 'en')).toContain('One thousand two hundred thirty-four and 56/100');
  });
});

describe('identifiers', () => {
  it('generates mod-97 valid account numbers and rejects typos', () => {
    const n = makeAccountNumber(101, 1234567);
    expect(isValidAccountNumber(n)).toBe(true);
    const typo = n.slice(0, -1) + ((Number(n.slice(-1)) + 1) % 10);
    expect(isValidAccountNumber(typo)).toBe(false);
  });
  it('generates Luhn-valid card numbers', async () => {
    const card = await asActor(SYSTEM_ACTOR, () => issueCard({ accountId: aliceAcc.id, type: 'debit', pin: '1234', silent: true }));
    expect(luhnValid(card.number)).toBe(true);
    expect(card.number.startsWith('941')).toBe(true);
  });
});

describe('ledger & transfers', () => {
  it('moves money only through balanced journals', async () => {
    const tx = await asActor(actorOf(alice), () => transfer({ fromAccountId: aliceAcc.id, currency: 'CRWN', amount: toMinor(100, 'CRWN'), recipient: { accountNumber: bobAcc.number }, skipScreen: true }));
    expect(tx.status).toBe('completed');
    expect(await balanceOf(aliceAcc.id, 'CRWN')).toBe(90000);
    expect(await balanceOf(bobAcc.id, 'CRWN')).toBe(15000);
    const tb = await trialBalance();
    for (const r of tb) expect(r.debit).toBe(r.credit);
    expect((await reconcileBalances()).drift).toEqual([]);
    expect(tx.timeline.map((s) => s.step)).toEqual(['created', 'validated', 'processing', 'approved', 'settled', 'completed']);
    expect(tx.documentIds.length).toBe(1);
    const notes = await db.notifications.toArray();
    expect(notes.some((n) => n.userId === bob.id && n.titleKey === 'n.tx.in.title')).toBe(true);
    expect((await db.audit.toArray()).some((a) => a.txId === tx.id)).toBe(true);
  });

  it('rejects unbalanced journals', async () => {
    await expectCode(post({ txId: 'X', ref: 'X', memo: 'x', lines: [{ accountId: aliceAcc.id, currency: 'CRWN', side: 'D', amount: 5 }] }), 'TRANSACTION_FAILED');
  });

  it('enforces insufficient funds, invalid recipients and frozen accounts', async () => {
    await expectCode(asActor(actorOf(bob), () => transfer({ fromAccountId: bobAcc.id, currency: 'CRWN', amount: toMinor(500, 'CRWN'), recipient: { accountNumber: aliceAcc.number }, skipScreen: true })), 'INSUFFICIENT_FUNDS');
    await expectCode(asActor(actorOf(bob), () => transfer({ fromAccountId: bobAcc.id, currency: 'CRWN', amount: 100, recipient: { accountNumber: 'XA00AEX1010000000000' }, skipScreen: true })), 'INVALID_ACCOUNT');
    await expectCode(asActor(actorOf(bob), () => transfer({ fromAccountId: bobAcc.id, currency: 'CRWN', amount: 100, recipient: { clientId: 'ALD-C-000000' }, skipScreen: true })), 'INVALID_RECIPIENT');
    await asActor(actorOf(bob), () => freezeAccount(bobAcc.id));
    await expectCode(asActor(actorOf(bob), () => transfer({ fromAccountId: bobAcc.id, currency: 'CRWN', amount: 100, recipient: { accountNumber: aliceAcc.number }, skipScreen: true })), 'ACCOUNT_FROZEN');
    await asActor(actorOf(bob), () => unfreezeAccount(bobAcc.id));
    const failed = await db.transactions.where('status').anyOf('failed', 'rejected').toArray();
    expect(failed.length).toBeGreaterThanOrEqual(2);
  });

  it('enforces account daily limits', async () => {
    await asActor(actorOf(alice), () => setAccountLimit(aliceAcc.id, toMinor(150, 'CRWN')));
    await asActor(actorOf(alice), () => transfer({ fromAccountId: aliceAcc.id, currency: 'CRWN', amount: toMinor(100, 'CRWN'), recipient: { accountNumber: bobAcc.number }, skipScreen: true }));
    await expectCode(asActor(actorOf(alice), () => transfer({ fromAccountId: aliceAcc.id, currency: 'CRWN', amount: toMinor(100, 'CRWN'), recipient: { accountNumber: bobAcc.number }, skipScreen: true })), 'DAILY_LIMIT_EXCEEDED');
  });

  it('respects holds in the available balance', async () => {
    await placeHold({ accountId: aliceAcc.id, currency: 'CRWN', amount: toMinor(950, 'CRWN'), reason: 'approval', description: 't' });
    expect(await availableOf(aliceAcc.id, 'CRWN')).toBe(toMinor(50, 'CRWN'));
    await expectCode(asActor(actorOf(alice), () => transfer({ fromAccountId: aliceAcc.id, currency: 'CRWN', amount: toMinor(60, 'CRWN'), recipient: { accountNumber: bobAcc.number }, skipScreen: true })), 'INSUFFICIENT_FUNDS');
  });

  it('reverses a completed transaction with a mirror journal', async () => {
    const tx = await asActor(actorOf(alice), () => transfer({ fromAccountId: aliceAcc.id, currency: 'CRWN', amount: toMinor(10, 'CRWN'), recipient: { accountNumber: bobAcc.number }, skipScreen: true }));
    await asActor(SYSTEM_ACTOR, () => reverseTransaction(tx.id, 'test'));
    expect((await db.transactions.get(tx.id))!.status).toBe('reversed');
    expect(await balanceOf(aliceAcc.id, 'CRWN')).toBe(100000);
  });

  it('closes an account by sweeping its balance', async () => {
    const extra = await accountFor(alice, 'CRWN', 'savings');
    await fund(extra, 12);
    await asActor(actorOf(alice), () => closeAccount(extra.id, aliceAcc.id));
    expect((await db.accounts.get(extra.id))!.status).toBe('closed');
    expect(await balanceOf(aliceAcc.id, 'CRWN')).toBe(101200);
    expect(await db.archive.where('kind').equals('closed_account').count()).toBe(1);
  });
});

describe('foreign exchange', () => {
  it('creates debit, credit, FX position and fee entries with an FX id', async () => {
    const tx = await asActor(actorOf(alice), () => exchange({ fromAccountId: aliceAcc.id, fromCurrency: 'CRWN', toAccountId: aliceAcc.id, toCurrency: 'USD', amount: toMinor(100, 'CRWN') }));
    expect(tx.fx?.id).toMatch(/^FX-/);
    const lines = await db.ledger.where('txId').equals(tx.id).toArray();
    expect(lines.length).toBe(6);
    const q = quote('CRWN', 'USD', toMinor(100, 'CRWN'));
    expect(await balanceOf(aliceAcc.id, 'USD')).toBe(tx.creditAmount);
    expect(Math.abs((tx.creditAmount ?? 0) - q.targetAmount)).toBeLessThanOrEqual(1);
    expect(await balanceOf('GL:FEES', 'CRWN')).toBe(tx.fee);
  });
});

describe('cards', () => {
  it('authorizes, holds and settles a card payment; honours controls', async () => {
    const card = await asActor(SYSTEM_ACTOR, () => issueCard({ accountId: aliceAcc.id, type: 'debit', pin: '1234', silent: true }));
    const tx = await asActor(actorOf(alice), () => cardPayment({ cardId: card.id, merchant: 'Shop', mcc: '5411', realm: 'ALD', amount: toMinor(20, 'CRWN'), currency: 'CRWN', channel: 'contactless', category: 'groceries', settleNow: true }));
    expect(tx.status).toBe('completed');
    expect(tx.timeline.map((t) => t.step)).toContain('authorized');
    expect(await balanceOf(aliceAcc.id, 'CRWN')).toBe(98000);
    await asActor(actorOf(alice), () => setCardControls(card.id, { ...card.controls, online: false }));
    await expectCode(asActor(actorOf(alice), () => cardPayment({ cardId: card.id, merchant: 'Web', mcc: '5999', realm: 'ALD', amount: 100, currency: 'CRWN', channel: 'online', category: 'shopping', settleNow: true })), 'CARD_CONTROL_DISABLED');
  });
});

describe('checks', () => {
  it('runs create → sign → issue → present → pay', async () => {
    const ch = await asActor(actorOf(alice), () => createCheck({ accountId: aliceAcc.id, payeeName: bob.name, payeeClientId: bob.clientId, amount: toMinor(25, 'CRWN'), purpose: 'test' }));
    await expectCode(asActor(actorOf(alice), () => issueCheck(ch.id)), 'VERIFICATION_FAILED');
    await asActor(actorOf(alice), () => signCheck(ch.id, 'electronic'));
    await asActor(actorOf(alice), () => issueCheck(ch.id));
    await expectCode(asActor(actorOf(bob), () => presentCheck(ch.number, 'WRONG-CODE-0000', bobAcc.id)), 'VERIFICATION_FAILED');
    await asActor(actorOf(bob), () => presentCheck(ch.number, ch.verificationCode, bobAcc.id));
    expect((await db.checks.get(ch.id))!.status).toBe('paid');
    expect(await balanceOf(bobAcc.id, 'CRWN')).toBe(7500);
  });
});

describe('documents & signatures', () => {
  it('detects tampering after signing and verifies by code', async () => {
    const tx = await asActor(actorOf(alice), () => transfer({ fromAccountId: aliceAcc.id, currency: 'CRWN', amount: 100, recipient: { accountNumber: bobAcc.number }, skipScreen: true }));
    const docId = tx.documentIds[0];
    const signed = await asActor(actorOf(alice), async () => {
      const { signDocument } = await import('@/core/docs/documents');
      return signDocument(docId, 'electronic');
    });
    expect((await signatureState(signed)).state).toBe('verified');
    const v = await verifyDocument(signed.number, signed.verificationCode);
    expect(v.ok).toBe(true);
    const tampered = await asActor(actorOf(alice), () => saveDocumentVersion(docId, { title: 'Forged receipt' }, 'edit'));
    expect((await signatureState(tampered)).state).toBe('invalid');
    expect((await verifyDocument(signed.number, 'AAAA-BBBB-CCCC')).error).toBe('VERIFICATION_FAILED');
  });
});

describe('loans & deposits', () => {
  it('approves, disburses, repays and closes a loan', async () => {
    const loan = await asActor(actorOf(alice), () => applyLoan({ type: 'personal', amount: toMinor(600, 'CRWN'), termMonths: 6, currency: 'CRWN', purpose: 'test', payoutAccountId: aliceAcc.id, monthlyIncome: toMinor(5000, 'CRWN') }));
    expect(loan.status).toBe('approved');
    const active = await asActor(actorOf(alice), () => acceptAndDisburse(loan.id));
    expect(active.status).toBe('active');
    expect(active.schedule.length).toBe(6);
    expect(await balanceOf(aliceAcc.id, 'CRWN')).toBe(toMinor(1600, 'CRWN'));
    await asActor(actorOf(alice), () => payInstallment(loan.id, aliceAcc.id));
    await asActor(actorOf(alice), () => payOffEarly(loan.id, aliceAcc.id));
    const closed = (await db.loans.get(loan.id))!;
    expect(closed.status).toBe('closed');
    expect(closed.outstanding).toBe(0);
    expect(Math.abs(await balanceOf(closed.loanAccountId!, 'CRWN'))).toBe(0);
    expect(annuityPayment(120000, 12, 12)).toBe(10662);
  });

  it('accrues deposit interest daily and pays out at closure', async () => {
    const dep = await asActor(actorOf(alice), () => openDeposit({ sourceAccountId: aliceAcc.id, currency: 'CRWN', amount: toMinor(500, 'CRWN'), product: 'flex', termMonths: 12 }));
    const later = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    await asActor(SYSTEM_ACTOR, () => accrueDepositsFor(later));
    const d = (await db.deposits.get(dep.id))!;
    expect(d.accrued).toBeGreaterThan(0);
    await asActor(actorOf(alice), () => closeDeposit(dep.id));
    expect((await db.deposits.get(dep.id))!.status).toBe('closed');
    expect(await balanceOf(aliceAcc.id, 'CRWN')).toBeGreaterThan(toMinor(1000, 'CRWN'));
  });
});

describe('invoices', () => {
  it('creates, sends and settles an invoice through a payment', async () => {
    const inv = await asActor(actorOf(alice), () => createInvoice({ issuerAccountId: aliceAcc.id, recipientClientId: bob.clientId, recipientName: '', items: [{ description: 'Potion', quantity: 2, price: 1000, taxRate: 10, discount: 0 }], dueDate: '2099-01-01', notes: '' }));
    expect(inv.total).toBe(2200);
    await asActor(actorOf(alice), () => sendInvoice(inv.id));
    await asActor(actorOf(bob), () => payInvoice(inv.id, bobAcc.id));
    expect((await db.invoices.get(inv.id))!.status).toBe('paid');
  });
});

describe('audit & backup', () => {
  it('keeps a valid hash chain and detects tampering', async () => {
    expect((await verifyAuditChain()).ok).toBe(true);
    const first = await db.audit.orderBy('seq').first();
    await db.audit.update(first!.seq!, { details: 'tampered' });
    expect((await verifyAuditChain()).ok).toBe(false);
  });

  it('validates backup checksums', async () => {
    const b = await buildBackup();
    const text = JSON.stringify(b);
    expect(validateBackup(text).checksum).toBe(b.checksum);
    const broken = JSON.parse(text);
    broken.tables.users[0].name = 'Mallory';
    expect(() => validateBackup(JSON.stringify(broken))).toThrow();
  });

  it('shifts snapshot dates by whole days', () => {
    const out = shiftDates({ at: '2026-01-31T10:00:00.000Z', day: '2026-01-31', dob: '1990-01-01', text: 'x' }, 2 * 86_400_000);
    expect(out).toEqual({ at: '2026-02-02T10:00:00.000Z', day: '2026-02-02', dob: '1990-01-01', text: 'x' });
  });
});
