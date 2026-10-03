/**
 * Notification hub: in-app notifications plus simulated e-mail, SMS and push
 * deliveries (outbox), and official letters in the bank Mailbox.
 * Text is stored as i18n keys + params so it renders in the reader's language.
 */
import { db } from '../db/db';
import { nowISO } from '../clock';
import { uid } from '../util/random';
import { caseNumber } from '../banking/numbers';
import type { AppNotification, MailItem, NotificationCategory, NotificationChannel } from '../types';

export interface NotifyInput {
  category: NotificationCategory;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, string | number>;
  link?: string;
  priority?: AppNotification['priority'];
}

/** Listeners for live "push" toasts in the UI. */
type PushListener = (n: AppNotification) => void;
const pushListeners = new Set<PushListener>();
export function onPush(fn: PushListener) {
  pushListeners.add(fn);
  return () => {
    pushListeners.delete(fn);
  };
}

let muted = false;
/** Seeding writes history without firing live push toasts. */
export function setNotificationsMuted(v: boolean) {
  muted = v;
}

export async function notify(userId: string, input: NotifyInput): Promise<AppNotification | null> {
  if (!userId || userId === 'BANK' || userId === 'SYSTEM') return null;
  const user = await db.users.get(userId);
  if (!user) return null;
  const prefs = user.preferences;
  // Security notifications are always delivered.
  if (input.category !== 'security' && prefs.categories && prefs.categories[input.category] === false) return null;
  const channels: NotificationChannel[] = ['inapp'];
  for (const ch of ['email', 'sms', 'push'] as const) {
    if (prefs.channels?.[ch] || (input.category === 'security' && ch !== 'push')) channels.push(ch);
  }
  const n: AppNotification = {
    id: uid('NTF', 12),
    userId,
    category: input.category,
    titleKey: input.titleKey,
    bodyKey: input.bodyKey,
    params: input.params ?? {},
    createdAt: nowISO(),
    read: 0,
    link: input.link,
    channels,
    priority: input.priority ?? 'normal',
  };
  await db.notifications.add(n);
  const outbox = channels
    .filter((c): c is 'email' | 'sms' | 'push' => c !== 'inapp')
    .map((channel) => ({
      id: uid('OUT', 12),
      userId,
      channel,
      to: channel === 'email' ? user.email : channel === 'sms' ? user.phone : `device:${user.clientId}`,
      titleKey: n.titleKey,
      bodyKey: n.bodyKey,
      params: n.params,
      createdAt: n.createdAt,
      notificationId: n.id,
    }));
  if (outbox.length) await db.outbox.bulkAdd(outbox);
  if (!muted) for (const l of pushListeners) l(n);
  return n;
}

export async function markNotificationRead(id: string, read = true) {
  await db.notifications.update(id, { read: read ? 1 : 0 });
}

export async function markAllRead(userId: string) {
  await db.notifications.where('[userId+read]').equals([userId, 0]).modify({ read: 1 });
}

/* ── Official letters ── */

export type MailTemplate =
  | 'welcome' | 'account_opened' | 'account_closed' | 'payment_completed' | 'document_ready' | 'security_alert'
  | 'deposit_opened' | 'deposit_matured' | 'loan_approved' | 'loan_rejected' | 'loan_closed' | 'card_issued' | 'kyc_verified'
  | 'kyc_rejected' | 'invoice_received' | 'check_paid' | 'check_rejected' | 'dispute_update' | 'statement_ready'
  | 'vault_access' | 'international_completed' | 'policy_issued' | 'claim_update' | 'tax_notice' | 'payroll_completed'
  | 'broadcast';

const TEMPLATE_DEPT: Record<MailTemplate, string> = {
  welcome: 'CSV', account_opened: 'DEP', account_closed: 'ARC', payment_completed: 'PAY', document_ready: 'ARC',
  security_alert: 'SEC', deposit_opened: 'DEP', deposit_matured: 'DEP', loan_approved: 'LND', loan_rejected: 'LND',
  loan_closed: 'LND', card_issued: 'PAY', kyc_verified: 'CPL', kyc_rejected: 'CPL', invoice_received: 'PAY',
  check_paid: 'PAY', check_rejected: 'PAY', dispute_update: 'CPL', statement_ready: 'ARC', vault_access: 'VLT',
  international_completed: 'INT', policy_issued: 'TRS', claim_update: 'TRS', tax_notice: 'TRS',
  payroll_completed: 'PAY', broadcast: 'ADM',
};

export async function sendMail(
  userId: string,
  template: MailTemplate,
  params: Record<string, string | number> = {},
  attachmentDocId?: string,
): Promise<MailItem | null> {
  if (!userId || userId === 'BANK' || userId === 'SYSTEM') return null;
  const department = TEMPLATE_DEPT[template];
  const mail: MailItem = {
    id: uid('MAIL', 12),
    userId,
    folder: 'inbox',
    read: 0,
    createdAt: nowISO(),
    template,
    params,
    department,
    caseNo: await caseNumber(department),
    attachmentDocId,
  };
  await db.mail.add(mail);
  return mail;
}

export async function setMailRead(id: string, read: boolean) {
  await db.mail.update(id, { read: read ? 1 : 0 });
}

export async function archiveMail(id: string, archived = true) {
  await db.mail.update(id, { folder: archived ? 'archive' : 'inbox' });
}
