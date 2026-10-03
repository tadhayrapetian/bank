/** Account statements and other generated official documents, computed from the ledger. */
import { db } from '../db/db';
import { BankError } from '../errors';
import { nowISO } from '../clock';
import { actor } from '../context';
import { canView } from '../banking/accounts';
import { createDocument } from './documents';
import { sendMail, notify } from '../comms/notify';
import { pocketBalances } from '../banking/ledger';
import type { BankDocument, DocType } from '../types';

export async function generateStatement(accountId: string, currency: string, from: string, to: string): Promise<BankDocument> {
  const acc = await db.accounts.get(accountId);
  if (!acc) throw new BankError('INVALID_ACCOUNT');
  if (!canView(acc)) throw new BankError('PERMISSION_DENIED');
  if (from > to) throw new BankError('VALIDATION', { field: 'period' });
  const entries = await db.ledger.where('[accountId+currency]').equals([accountId, currency]).sortBy('at');
  const fromISO = from + 'T00:00:00.000Z';
  const toISO = to + 'T23:59:59.999Z';
  let opening = 0;
  const lines: { at: string; ref: string; memo: string; debit: number; credit: number; balance: number; txId: string }[] = [];
  let running = 0;
  for (const e of entries) {
    const delta = e.side === 'C' ? e.amount : -e.amount;
    if (e.at < fromISO) {
      opening += delta;
      running = opening;
      continue;
    }
    if (e.at > toISO) break;
    running += delta;
    lines.push({ at: e.at, ref: e.ref, memo: e.memo, debit: e.side === 'D' ? e.amount : 0, credit: e.side === 'C' ? e.amount : 0, balance: running, txId: e.txId });
  }
  const sign = acc.normal === 'debit' ? -1 : 1;
  const owner = await db.users.get(acc.ownerId);
  const totals = lines.reduce((t, l) => ({ debit: t.debit + l.debit, credit: t.credit + l.credit }), { debit: 0, credit: 0 });
  const doc = await createDocument({
    type: 'statement',
    title: 'Statement of Account',
    ownerId: acc.ownerId,
    partyIds: acc.partyIds,
    classification: 'confidential',
    data: {
      accountId: acc.id, number: acc.number, name: acc.name, accountType: acc.type, currency, holder: owner?.name, clientId: owner?.clientId,
      from, to, opening: opening * sign, closing: (lines.length ? lines[lines.length - 1].balance : opening) * sign, totals, lines: lines.map((l) => ({ ...l, balance: l.balance * sign })),
      generatedAt: nowISO(),
    },
    links: { accountIds: [acc.id], txIds: [...new Set(lines.map((l) => l.txId))].slice(0, 200) },
    authorName: 'Hall of Sealed Records',
    authorId: 'BANK',
  });
  const a = actor();
  if (!a.system) {
    await notify(a.userId, { category: 'documents', titleKey: 'n.doc.ready.title', bodyKey: 'n.doc.ready.body', params: { title: doc.title, number: doc.number }, link: `/documents/${doc.id}` });
    await sendMail(a.userId, 'statement_ready', { number: acc.number, from, to }, doc.id);
  }
  return doc;
}

export type GeneratedKind = 'balance_confirmation' | 'account_certificate' | 'payment_order' | 'authorization' | 'memo' | 'reference_letter';

/** Quick generator used by the "Generate Document" action. */
export async function generateDocument(kind: GeneratedKind, opts: { accountId?: string; text?: string; recipient?: string; amount?: number; currency?: string }) {
  const a = actor();
  const user = await db.users.get(a.userId);
  const acc = opts.accountId ? await db.accounts.get(opts.accountId) : undefined;
  if (acc && !canView(acc)) throw new BankError('PERMISSION_DENIED');
  const map: Record<GeneratedKind, { type: DocType; title: string }> = {
    balance_confirmation: { type: 'certificate', title: 'Confirmation of Balance' },
    account_certificate: { type: 'certificate', title: 'Certificate of Account Holding' },
    payment_order: { type: 'payment_order', title: 'Payment Order' },
    authorization: { type: 'authorization', title: 'Letter of Authorization' },
    memo: { type: 'memo', title: 'Internal Memorandum' },
    reference_letter: { type: 'letter', title: 'Bank Reference Letter' },
  };
  const m = map[kind];
  const balances = acc ? await pocketBalances(acc) : [];
  const doc = await createDocument({
    type: m.type,
    title: m.title,
    ownerId: a.userId,
    classification: kind === 'memo' ? 'internal' : 'confidential',
    data: { kind, holder: user?.name, clientId: user?.clientId, accountId: acc?.id, number: acc?.number, accountName: acc?.name, balances, recipient: opts.recipient, amount: opts.amount, currency: opts.currency, issuedAt: nowISO() },
    body: opts.text ? opts.text.split(/\n+/).filter(Boolean) : [],
    links: { accountIds: acc ? [acc.id] : [] },
  });
  await notify(a.userId, { category: 'documents', titleKey: 'n.doc.ready.title', bodyKey: 'n.doc.ready.body', params: { title: doc.title, number: doc.number }, link: `/documents/${doc.id}` });
  return doc;
}
