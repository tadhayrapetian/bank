/**
 * Global search across the institution. Uses indexed lookups for exact
 * identifiers (references, numbers, IDs) and bounded scans for free text,
 * scoped by permission (clients only see their own records).
 */
import { db } from '../db/db';
import { actor } from '../context';
import { can } from '../security/permissions';

export type SearchKind =
  | 'user' | 'account' | 'card' | 'transaction' | 'document' | 'check' | 'invoice' | 'payment' | 'case' | 'employee' | 'branch';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  link: string;
  score: number;
}

function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const idx = t.indexOf(q);
  if (idx >= 0) return 60 - Math.min(30, idx);
  return 0;
}

function best(q: string, ...fields: (string | undefined)[]) {
  return Math.max(0, ...fields.filter(Boolean).map((f) => score(f!, q)));
}

export async function globalSearch(query: string, limitPerKind = 6): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const a = actor();
  const all = can('tx.view_all');
  const uid = a.userId;
  const hits: SearchHit[] = [];
  const push = (h: SearchHit) => h.score > 0 && hits.push(h);
  const qNoSpace = q.replace(/\s+/g, '');

  // Users
  if (all) {
    const users = await db.users.filter((u) => best(q, u.name, u.clientId, u.email) > 0).limit(limitPerKind).toArray();
    users.forEach((u) => push({ kind: 'user', id: u.id, title: u.name, subtitle: `${u.clientId} · ${u.email}`, link: `/admin?section=users&id=${u.id}`, score: best(q, u.name, u.clientId, u.email) }));
  }

  // Accounts
  const accs = await (all ? db.accounts.toCollection() : db.accounts.where('partyIds').equals(uid))
    .filter((x) => !x.hidden && best(qNoSpace, x.number.toLowerCase(), x.name.toLowerCase().replace(/\s+/g, '')) + best(q, x.name) > 0)
    .limit(limitPerKind).toArray();
  accs.forEach((x) => push({ kind: 'account', id: x.id, title: x.name, subtitle: `${x.number} · ${x.currency} · ${x.type}`, link: `/accounts/${x.id}`, score: Math.max(best(qNoSpace, x.number.toLowerCase()), best(q, x.name)) }));

  // Cards
  const cards = await (all ? db.cards.toCollection() : db.cards.where('ownerId').equals(uid))
    .filter((c) => best(q, c.last4, c.holderName, c.type) > 0).limit(limitPerKind).toArray();
  cards.forEach((c) => push({ kind: 'card', id: c.id, title: `SIGIL ${c.type} •${c.last4}`, subtitle: `${c.holderName} · ${c.status}`, link: `/cards/${c.id}`, score: best(q, c.last4, c.holderName, c.type) }));

  // Transactions — exact ref via index first
  const byRef = await db.transactions.where('ref').equalsIgnoreCase(query.trim()).toArray();
  const txPool = byRef.length ? byRef : await (all ? db.transactions.orderBy('createdAt').reverse() : db.transactions.where('partyIds').equals(uid))
    .filter((t) => best(q, t.ref, t.id, t.description, t.recipient.name, t.sender.name, t.merchant?.name) > 0)
    .limit(limitPerKind * 2).toArray();
  txPool.filter((t) => all || t.partyIds.includes(uid)).slice(0, limitPerKind).forEach((t) => {
    const s = best(q, t.ref, t.id, t.description, t.recipient.name, t.sender.name, t.merchant?.name);
    const isPayment = ['transfer', 'international', 'request', 'link', 'qr', 'invoice', 'recurring', 'bulk', 'payroll'].includes(t.type);
    push({ kind: isPayment ? 'payment' : 'transaction', id: t.id, title: t.description, subtitle: `${t.ref} · ${t.status}`, link: `/transactions/${t.id}`, score: s || 90 });
  });

  // Documents
  const docs = await (all ? db.documents.toCollection() : db.documents.where('partyIds').equals(uid))
    .filter((d) => best(q, d.number, d.id, d.title, d.registryNo, d.archiveCode, d.verificationCode) > 0).limit(limitPerKind).toArray();
  docs.forEach((d) => push({ kind: 'document', id: d.id, title: `${d.title} ${d.number}`, subtitle: `${d.type} · v${d.version} · ${d.status}`, link: `/documents/${d.id}`, score: best(q, d.number, d.id, d.title, d.registryNo, d.archiveCode) }));

  // Checks
  const checks = await db.checks.filter((c) => (all || c.issuerId === uid || c.payeeId === uid) && best(q, c.number, c.payeeName, c.issuerName, c.purpose) > 0).limit(limitPerKind).toArray();
  checks.forEach((c) => push({ kind: 'check', id: c.id, title: `Check № ${c.number}`, subtitle: `${c.issuerName} → ${c.payeeName} · ${c.status}`, link: `/checks/${c.id}`, score: best(q, c.number, c.payeeName, c.issuerName, c.purpose) }));

  // Invoices
  const invs = await (all ? db.invoices.toCollection() : db.invoices.where('partyIds').equals(uid))
    .filter((i) => best(q, i.number, i.recipientName, i.issuerName) > 0).limit(limitPerKind).toArray();
  invs.forEach((i) => push({ kind: 'invoice', id: i.id, title: `Invoice ${i.number}`, subtitle: `${i.issuerName} → ${i.recipientName} · ${i.status}`, link: `/invoices/${i.id}`, score: best(q, i.number, i.recipientName, i.issuerName) }));

  // Cases (archive, disputes, tickets)
  const arch = await db.archive.filter((r) => (all || r.ownerId === uid) && best(q, r.code, r.title, r.summary) > 0).limit(limitPerKind).toArray();
  arch.forEach((r) => push({ kind: 'case', id: r.id, title: r.title, subtitle: `${r.code} · ${r.kind}`, link: `/archive?id=${r.id}`, score: best(q, r.code, r.title) }));
  const disputes = await db.disputes.filter((d) => (all || d.ownerId === uid) && best(q, d.number, d.description) > 0).limit(3).toArray();
  disputes.forEach((d) => push({ kind: 'case', id: d.id, title: `Dispute ${d.number}`, subtitle: `${d.reason} · ${d.status}`, link: `/disputes/${d.id}`, score: best(q, d.number, d.description) }));
  const tickets = await db.tickets.filter((t) => (all || t.userId === uid) && best(q, t.number, t.subject) > 0).limit(3).toArray();
  tickets.forEach((t) => push({ kind: 'case', id: t.id, title: `${t.number} ${t.subject}`, subtitle: `${t.topic} · ${t.status}`, link: `/messages?t=${t.id}`, score: best(q, t.number, t.subject) }));

  // Employees & branches (public directory)
  const emps = await db.employees.filter((e) => best(q, e.name, e.employeeId, e.position, e.department) > 0).limit(limitPerKind).toArray();
  emps.forEach((e) => push({ kind: 'employee', id: e.id, title: e.name, subtitle: `${e.employeeId} · ${e.position}`, link: `/employees?id=${e.id}`, score: best(q, e.name, e.employeeId, e.position) }));
  const branches = await db.branches.filter((b) => best(q, b.name, b.code, b.city, b.address) > 0).limit(limitPerKind).toArray();
  branches.forEach((b) => push({ kind: 'branch', id: b.id, title: b.name, subtitle: `${b.code} · ${b.city}`, link: `/branches?id=${b.id}`, score: best(q, b.name, b.code, b.city) }));

  return hits.sort((x, y) => y.score - x.score);
}
