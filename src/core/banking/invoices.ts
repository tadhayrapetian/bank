/** Invoices: Create → Send → (Receive) → Pay → Settlement, plus Cancel and Overdue. */
import { db } from '../db/db';
import { BankError } from '../errors';
import { nowISO, todayKey } from '../clock';
import { uid } from '../util/random';
import { actor } from '../context';
import { docNumber } from './numbers';
import { canOperate, getAccountOrThrow } from './accounts';
import { createPaymentLink, transfer } from './payments';
import { createDocument } from '../docs/documents';
import { audit } from '../ops/audit';
import { notify, sendMail } from '../comms/notify';
import type { Invoice, InvoiceItem } from '../types';

export function invoiceTotals(items: InvoiceItem[]) {
  let subtotal = 0, tax = 0, discount = 0;
  for (const it of items) {
    const line = Math.round(it.quantity * it.price);
    const disc = Math.round((line * it.discount) / 100);
    const taxed = Math.round(((line - disc) * it.taxRate) / 100);
    subtotal += line;
    discount += disc;
    tax += taxed;
  }
  return { subtotal, tax, discount, total: subtotal - discount + tax };
}

export async function getInvoiceOrThrow(id: string) {
  const inv = await db.invoices.get(id);
  if (!inv) throw new BankError('NOT_FOUND', { object: 'invoice' });
  return inv;
}

export async function createInvoice(input: { issuerAccountId: string; recipientClientId?: string; recipientName: string; recipientEmail?: string; items: Omit<InvoiceItem, 'id'>[]; dueDate: string; notes: string; companyId?: string }) {
  const acc = await getAccountOrThrow(input.issuerAccountId);
  if (!canOperate(acc)) throw new BankError('PERMISSION_DENIED');
  if (!input.items.length || input.items.some((i) => !(i.quantity > 0) || !(i.price >= 0) || !i.description.trim())) throw new BankError('VALIDATION', { field: 'items' });
  let recipientId: string | undefined;
  let recipientName = input.recipientName.trim();
  if (input.recipientClientId?.trim()) {
    const u = await db.users.where('clientId').equals(input.recipientClientId.trim().toUpperCase()).first();
    if (!u) throw new BankError('INVALID_RECIPIENT', { clientId: input.recipientClientId });
    if (u.id === acc.ownerId) throw new BankError('SAME_ACCOUNT');
    recipientId = u.id;
    recipientName = recipientName || u.name;
  }
  if (!recipientName) throw new BankError('INVALID_RECIPIENT');
  const items = input.items.map((i) => ({ ...i, id: uid('IT', 6) }));
  const totals = invoiceTotals(items);
  const issuer = input.companyId ? await db.companies.get(input.companyId) : undefined;
  const owner = await db.users.get(acc.ownerId);
  const inv: Invoice = {
    id: uid('IVC'), number: await docNumber('INV'), issuerId: acc.ownerId, issuerName: issuer?.name ?? owner?.name ?? 'Client', issuerAccountId: acc.id,
    recipientId, recipientName, recipientEmail: input.recipientEmail, items, currency: acc.currency, ...totals, dueDate: input.dueDate,
    createdAt: nowISO(), status: 'draft', notes: input.notes, companyId: input.companyId, partyIds: [acc.ownerId, ...(recipientId ? [recipientId] : [])],
  };
  await db.invoices.add(inv);
  await audit({ action: 'invoice.create', object: 'invoice', objectId: inv.id, details: `${inv.number} ${inv.total} ${inv.currency}` });
  return inv;
}

export async function sendInvoice(id: string) {
  const inv = await getInvoiceOrThrow(id);
  if (inv.issuerId !== actor().userId && !actor().system) throw new BankError('PERMISSION_DENIED');
  if (inv.status !== 'draft') throw new BankError('INVALID_STATE', { status: inv.status });
  const link = await createPaymentLink({ accountId: inv.issuerAccountId, amount: inv.total, currency: inv.currency, description: `Invoice ${inv.number}`, multiUse: false, days: 120, invoiceId: inv.id });
  const doc = await createDocument({
    type: 'invoice', title: 'Invoice', ownerId: inv.issuerId, partyIds: inv.partyIds, classification: 'confidential',
    data: { invoiceId: inv.id, number: inv.number, issuer: inv.issuerName, recipient: inv.recipientName, items: inv.items, subtotal: inv.subtotal, tax: inv.tax, discount: inv.discount, total: inv.total, currency: inv.currency, dueDate: inv.dueDate, linkCode: link.code, notes: inv.notes },
    links: { accountIds: [inv.issuerAccountId] }, silent: true,
  });
  await db.invoices.update(id, { status: 'sent', sentAt: nowISO(), linkCode: link.code, documentId: doc.id });
  await audit({ action: 'invoice.send', object: 'invoice', objectId: id, details: inv.number });
  if (inv.recipientId) {
    await notify(inv.recipientId, { category: 'payments', titleKey: 'n.invoice.received.title', bodyKey: 'n.invoice.received.body', params: { name: inv.issuerName, number: inv.number, amt: inv.total, ccy: inv.currency, due: inv.dueDate }, link: `/invoices/${id}`, priority: 'high' });
    await sendMail(inv.recipientId, 'invoice_received', { name: inv.issuerName, number: inv.number, amt: inv.total, ccy: inv.currency, due: inv.dueDate }, doc.id);
  }
  return (await db.invoices.get(id))!;
}

export async function payInvoice(id: string, fromAccountId: string, onCreated?: (txId: string) => void) {
  const inv = await getInvoiceOrThrow(id);
  if (!['sent', 'overdue'].includes(inv.status)) throw new BankError('INVALID_STATE', { status: inv.status });
  const a = actor();
  if (inv.recipientId && inv.recipientId !== a.userId && !a.system) throw new BankError('PERMISSION_DENIED');
  const target = await getAccountOrThrow(inv.issuerAccountId);
  const tx = await transfer({
    fromAccountId, currency: inv.currency, amount: inv.total, recipient: { accountNumber: target.number },
    description: `Settlement of invoice ${inv.number} (${inv.issuerName})`, type: 'invoice', category: 'bills', onCreated,
    meta: { invoiceId: inv.id },
  });
  await db.invoices.update(id, { status: 'paid', paidAt: nowISO(), txId: tx.id, partyIds: [...new Set([...inv.partyIds, a.userId])] });
  if (inv.linkCode) {
    const link = await db.links.where('code').equals(inv.linkCode).first();
    if (link) await db.links.update(link.id, { status: 'paid', payments: [...link.payments, { at: nowISO(), txId: tx.id, payerName: a.name, amount: inv.total }] });
  }
  if (inv.documentId) {
    const doc = await db.documents.get(inv.documentId);
    if (doc) {
      const { element } = await import('../docs/documents');
      await db.documents.update(doc.id, { elements: [...doc.elements, element('seal', 40, 42, 18, { sealId: 'paid', ink: 'crimson', intensity: 0.9, date: nowISO().slice(0, 10) }, -12, 0.9)], links: { ...doc.links, txIds: [...doc.links.txIds, tx.id] } });
    }
  }
  await audit({ action: 'invoice.pay', object: 'invoice', objectId: id, txId: tx.id });
  await notify(inv.issuerId, { category: 'payments', titleKey: 'n.invoice.paid.title', bodyKey: 'n.invoice.paid.body', params: { number: inv.number, amt: inv.total, ccy: inv.currency, name: a.name }, link: `/invoices/${id}` });
  return tx;
}

export async function cancelInvoice(id: string) {
  const inv = await getInvoiceOrThrow(id);
  if (inv.issuerId !== actor().userId && !actor().system) throw new BankError('PERMISSION_DENIED');
  if (!['draft', 'sent', 'overdue'].includes(inv.status)) throw new BankError('INVALID_STATE', { status: inv.status });
  await db.invoices.update(id, { status: 'cancelled' });
  if (inv.linkCode) {
    const link = await db.links.where('code').equals(inv.linkCode).first();
    if (link) await db.links.update(link.id, { status: 'cancelled' });
  }
  if (inv.documentId) await db.documents.update(inv.documentId, { status: 'cancelled' });
  await audit({ action: 'invoice.cancel', object: 'invoice', objectId: id });
  if (inv.recipientId) await notify(inv.recipientId, { category: 'payments', titleKey: 'n.invoice.cancelled.title', bodyKey: 'n.invoice.cancelled.body', params: { number: inv.number, name: inv.issuerName } });
}

export async function markOverdueInvoices() {
  const today = todayKey();
  const due = (await db.invoices.where('status').equals('sent').toArray()).filter((i) => i.dueDate < today);
  for (const inv of due) {
    await db.invoices.update(inv.id, { status: 'overdue' });
    await notify(inv.issuerId, { category: 'payments', titleKey: 'n.invoice.overdue.title', bodyKey: 'n.invoice.overdue.body', params: { number: inv.number }, link: `/invoices/${inv.id}` });
    if (inv.recipientId) await notify(inv.recipientId, { category: 'payments', titleKey: 'n.invoice.overdue.title', bodyKey: 'n.invoice.overdue_payer.body', params: { number: inv.number, name: inv.issuerName }, link: `/invoices/${inv.id}`, priority: 'high' });
  }
  return due.length;
}
