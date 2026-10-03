/**
 * Database layer — IndexedDB via Dexie. Every table is indexed for the
 * queries the app performs (pagination, per-owner lookups, status queues).
 * If the browser blocks IndexedDB, the app falls back to an in-memory
 * IndexedDB implementation so it still works for the session.
 */
import Dexie, { type Table } from 'dexie';
import type * as T from '../types';

export const DB_NAME = 'ledgerhall-exchequer';
export const SCHEMA_VERSION = 1;

export const SCHEMA: Record<string, string> = {
  meta: 'key',
  counters: 'name',
  users: 'id, &clientId, email, kind, status, name',
  devices: 'id, userId, fingerprint',
  sessions: 'id, userId, active',
  logins: 'id, userId, at',
  accounts: 'id, &number, ownerId, type, status, *partyIds, companyId, familyId, currency',
  balances: '[accountId+currency], accountId, currency',
  holds: 'id, accountId, status, txId',
  ledger: 'id, journalId, txId, accountId, [accountId+currency], at',
  journals: 'id, txId, at',
  transactions: 'id, &ref, status, type, createdAt, *partyIds, fromAccountId, toAccountId, batchId, cardId',
  templates: 'id, ownerId',
  scheduled: 'id, ownerId, status, runAt',
  requests: 'id, requesterId, payerId, status, createdAt',
  links: 'id, &code, ownerId, status',
  cardless: 'id, &code, ownerId, status',
  cards: 'id, ownerId, accountId, status, type, last4, companyId',
  documents: 'id, &number, type, ownerId, createdAt, *partyIds',
  docVersions: 'id, docId, [docId+version]',
  checks: 'id, &number, issuerId, payeeId, status, createdAt',
  deposits: 'id, ownerId, status, accountId',
  loans: 'id, ownerId, status, type',
  instruments: 'id, kind',
  holdings: 'id, ownerId, instrumentId, [ownerId+instrumentId]',
  orders: 'id, ownerId, status, instrumentId, createdAt',
  recurring: 'id, ownerId, status, nextRun',
  invoices: 'id, &number, issuerId, recipientId, status, dueDate, *partyIds, companyId',
  subscriptions: 'id, ownerId, status, nextCharge',
  budgets: 'id, ownerId',
  families: 'id, ownerId, *memberIds',
  companies: 'id, ownerId, *memberIds',
  companyStaff: 'id, companyId',
  approvals: 'id, companyId, status, createdAt',
  payroll: 'id, companyId, createdAt',
  taxes: 'id, ownerId, year, status',
  policies: 'id, ownerId, status',
  claims: 'id, policyId, ownerId, status',
  disputes: 'id, ownerId, txId, status',
  fraud: 'id, txId, userId, status, createdAt',
  kyc: 'id, userId, status',
  notifications: 'id, userId, createdAt, [userId+read]',
  outbox: 'id, userId, createdAt',
  mail: 'id, userId, createdAt',
  tickets: 'id, &number, userId, status, updatedAt',
  messages: 'id, ticketId, at',
  branches: 'id, &code, status',
  atms: 'id, branchId, status',
  employees: 'id, &employeeId, department, status, branchId, userId',
  archive: 'id, &code, kind, createdAt, ownerId, department',
  vaults: 'id, &number, ownerId, status, branchId',
  vaultAccess: 'id, vaultId, at',
  audit: '++seq, at, userId, txId',
  syslog: '++seq, at, level, source',
  currencyOverrides: 'code',
  rates: 'code',
  services: 'service',
  backups: 'id, createdAt',
  keys: 'ownerId',
};

export class LedgerhallDB extends Dexie {
  meta!: Table<T.MetaRow, string>;
  counters!: Table<T.Counter, string>;
  users!: Table<T.User, string>;
  devices!: Table<T.Device, string>;
  sessions!: Table<T.SessionRecord, string>;
  logins!: Table<T.LoginRecord, string>;
  accounts!: Table<T.Account, string>;
  balances!: Table<T.BalanceRow, [string, string]>;
  holds!: Table<T.Hold, string>;
  ledger!: Table<T.LedgerEntry, string>;
  journals!: Table<T.Journal, string>;
  transactions!: Table<T.Transaction, string>;
  templates!: Table<T.TransferTemplate, string>;
  scheduled!: Table<T.ScheduledTransfer, string>;
  requests!: Table<T.MoneyRequest, string>;
  links!: Table<T.PaymentLink, string>;
  cardless!: Table<T.CardlessCode, string>;
  cards!: Table<T.Card, string>;
  documents!: Table<T.BankDocument, string>;
  docVersions!: Table<T.DocVersion, string>;
  checks!: Table<T.Check, string>;
  deposits!: Table<T.Deposit, string>;
  loans!: Table<T.Loan, string>;
  instruments!: Table<T.Instrument, string>;
  holdings!: Table<T.Holding, string>;
  orders!: Table<T.InvestmentOrder, string>;
  recurring!: Table<T.RecurringPayment, string>;
  invoices!: Table<T.Invoice, string>;
  subscriptions!: Table<T.Subscription, string>;
  budgets!: Table<T.Budget, string>;
  families!: Table<T.Family, string>;
  companies!: Table<T.Company, string>;
  companyStaff!: Table<T.CompanyEmployee, string>;
  approvals!: Table<T.Approval, string>;
  payroll!: Table<T.PayrollRun, string>;
  taxes!: Table<T.TaxRecord, string>;
  policies!: Table<T.InsurancePolicy, string>;
  claims!: Table<T.InsuranceClaim, string>;
  disputes!: Table<T.Dispute, string>;
  fraud!: Table<T.FraudEvent, string>;
  kyc!: Table<T.KycRecord, string>;
  notifications!: Table<T.AppNotification, string>;
  outbox!: Table<T.OutboxMessage, string>;
  mail!: Table<T.MailItem, string>;
  tickets!: Table<T.Ticket, string>;
  messages!: Table<T.TicketMessage, string>;
  branches!: Table<T.Branch, string>;
  atms!: Table<T.Atm, string>;
  employees!: Table<T.Employee, string>;
  archive!: Table<T.ArchiveRecord, string>;
  vaults!: Table<T.Vault, string>;
  vaultAccess!: Table<T.VaultAccess, string>;
  audit!: Table<T.AuditRecord, number>;
  syslog!: Table<T.SysLog, number>;
  currencyOverrides!: Table<T.CurrencyOverride, string>;
  rates!: Table<T.RateRecord, string>;
  services!: Table<T.ServiceStatus, string>;
  backups!: Table<T.BackupRecord, string>;
  keys!: Table<T.KeyRecord, string>;

  constructor(name = DB_NAME, options?: ConstructorParameters<typeof Dexie>[1]) {
    super(name, options);
    this.version(SCHEMA_VERSION).stores(SCHEMA);
  }
}

/** Live binding: importers always see the current database instance. */
export let db = new LedgerhallDB();
let persistent = true;

export function isPersistent() {
  return persistent;
}

/** Open the database; fall back to in-memory IndexedDB if storage is blocked. */
export async function openDatabase(): Promise<{ persistent: boolean }> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    await db.open();
    persistent = true;
  } catch {
    const fake = await import('fake-indexeddb');
    db = new LedgerhallDB(DB_NAME, { indexedDB: fake.indexedDB, IDBKeyRange: fake.IDBKeyRange });
    await db.open();
    persistent = false;
  }
  return { persistent };
}

/** Names of all tables, for backup / restore. */
export function tableNames(): string[] {
  return Object.keys(SCHEMA);
}

export async function getMeta<V>(key: string, fallback: V): Promise<V> {
  const row = await db.meta.get(key);
  return row ? (row.value as V) : fallback;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

/**
 * Run `fn` atomically. Inside an ambient transaction the work simply joins it
 * (no nested sub-transaction, so a thrown business error never aborts the
 * outer unit of work); otherwise a new read-write transaction is opened.
 */
export function inTx<T>(tables: Table<any, any>[], fn: () => Promise<T>): Promise<T> {
  if (Dexie.currentTransaction) return fn();
  return db.transaction('rw', tables, fn);
}

/**
 * Execute a whole business operation as ONE IndexedDB transaction across all
 * tables (used for batch processing such as seeding and end-of-day runs).
 * Business errors are captured so the records describing a failed operation
 * (its timeline, audit entry, notification) still commit, then re-thrown.
 */
export async function unitOfWork<T>(fn: () => Promise<T>): Promise<T> {
  if (Dexie.currentTransaction) return fn();
  const r = await db.transaction('rw', db.tables, async () => {
    try {
      return { ok: true as const, value: await fn() };
    } catch (error) {
      return { ok: false as const, error };
    }
  });
  if (!r.ok) throw r.error;
  return r.value;
}

/** Sequential human-readable numbers (document numbers, check numbers, case numbers). */
export async function nextCounter(name: string, start = 1): Promise<number> {
  return inTx([db.counters], async () => {
    const row = await db.counters.get(name);
    const value = (row?.value ?? start - 1) + 1;
    await db.counters.put({ name, value });
    return value;
  });
}
