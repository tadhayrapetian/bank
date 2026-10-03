/** Client ↔ Bank secure messenger with ticket numbers and the Petitioners' Hall clerk. */
import { db, nextCounter } from '../db/db';
import { BankError } from '../errors';
import { nowISO, pause } from '../clock';
import { uid } from '../util/random';
import { actor } from '../context';
import { can } from '../security/permissions';
import { audit } from '../ops/audit';
import { notify } from './notify';
import type { Ticket, TicketTopic } from '../types';

const CLERK = 'Clerk Wren, Petitioners’ Hall';

const KEYWORDS: { re: RegExp; key: string }[] = [
  { re: /limit|лимит|սահման/i, key: 'bot.kw.limit' },
  { re: /freez|frozen|замор|սառեց/i, key: 'bot.kw.freeze' },
  { re: /pin|пин|փին/i, key: 'bot.kw.pin' },
  { re: /fee|commission|комисс|միջնորդ/i, key: 'bot.kw.fee' },
  { re: /statement|выписк|քաղվածք/i, key: 'bot.kw.statement' },
  { re: /international|abroad|swift|междунар|միջազգ/i, key: 'bot.kw.international' },
  { re: /lost|stolen|украл|потерял|կորց/i, key: 'bot.kw.lost' },
];

export async function openTicket(topic: TicketTopic, subject: string, text: string) {
  const a = actor();
  if (!subject.trim() || !text.trim()) throw new BankError('VALIDATION', { field: 'message' });
  const n = await nextCounter('ticket', 10240);
  const t: Ticket = {
    id: uid('TKT'), number: `TKT-${new Date(nowISO()).getUTCFullYear()}-${String(n).padStart(5, '0')}`, userId: a.userId, userName: a.name, topic,
    subject: subject.trim(), status: 'open', createdAt: nowISO(), updatedAt: nowISO(), unreadClient: 0, unreadBank: 1,
  };
  await db.tickets.add(t);
  await db.messages.add({ id: uid('MSG', 12), ticketId: t.id, at: nowISO(), from: 'client', authorName: a.name, text: text.trim() });
  await db.messages.add({ id: uid('MSG', 12), ticketId: t.id, at: nowISO(), from: 'system', authorName: 'Ledgerhall', text: '', textKey: 'bot.opened', params: { number: t.number } });
  await audit({ action: 'ticket.open', object: 'ticket', objectId: t.id, details: t.number });
  void clerkReply(t.id, text);
  return t;
}

export async function sendTicketMessage(ticketId: string, text: string) {
  const t = await db.tickets.get(ticketId);
  if (!t) throw new BankError('NOT_FOUND');
  const a = actor();
  const staff = can('tickets.staff') && t.userId !== a.userId;
  if (!staff && t.userId !== a.userId) throw new BankError('PERMISSION_DENIED');
  if (!text.trim()) throw new BankError('VALIDATION', { field: 'message' });
  await db.messages.add({ id: uid('MSG', 12), ticketId, at: nowISO(), from: staff ? 'bank' : 'client', authorName: a.name, text: text.trim() });
  await db.tickets.update(ticketId, {
    updatedAt: nowISO(),
    status: staff ? 'answered' : 'open',
    unreadClient: staff ? 1 : t.unreadClient,
    unreadBank: staff ? 0 : 1,
  });
  if (staff) {
    await notify(t.userId, { category: 'system', titleKey: 'n.ticket.reply.title', bodyKey: 'n.ticket.reply.body', params: { number: t.number }, link: `/messages?t=${t.id}` });
  } else {
    void clerkReply(ticketId, text);
  }
}

/** Automated first-line reply from the clerk (keyword + topic rules). */
async function clerkReply(ticketId: string, text: string) {
  await pause(1100);
  const t = await db.tickets.get(ticketId);
  if (!t || t.status === 'closed') return;
  const kw = KEYWORDS.find((k) => k.re.test(text));
  const key = kw?.key ?? `bot.topic.${t.topic}`;
  await db.messages.add({ id: uid('MSG', 12), ticketId, at: nowISO(), from: 'bank', authorName: CLERK, text: '', textKey: key, params: { number: t.number } });
  await db.tickets.update(ticketId, { status: 'answered', unreadClient: 1, updatedAt: nowISO() });
}

export async function closeTicket(ticketId: string) {
  const t = await db.tickets.get(ticketId);
  if (!t) throw new BankError('NOT_FOUND');
  const a = actor();
  if (t.userId !== a.userId && !can('tickets.staff')) throw new BankError('PERMISSION_DENIED');
  await db.tickets.update(ticketId, { status: 'closed', updatedAt: nowISO() });
  await db.messages.add({ id: uid('MSG', 12), ticketId, at: nowISO(), from: 'system', authorName: 'Ledgerhall', text: '', textKey: 'bot.closed', params: { number: t.number } });
  await audit({ action: 'ticket.close', object: 'ticket', objectId: ticketId });
}

export async function markTicketRead(ticketId: string, side: 'client' | 'bank') {
  await db.tickets.update(ticketId, side === 'client' ? { unreadClient: 0 } : { unreadBank: 0 });
}
