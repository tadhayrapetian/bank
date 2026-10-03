/** Account lifecycle: open, close, rename, freeze, limits, co-owners, trusted users, pockets. */
import { db } from '../db/db';
import { nowISO, addDays } from '../clock';
import { BankError } from '../errors';
import { uid } from '../util/random';
import { actor } from '../context';
import { can } from '../security/permissions';
import { currencies } from '../currency/registry';
import { audit } from '../ops/audit';
import { notify, sendMail } from '../comms/notify';
import { createDocument } from '../docs/documents';
import { archiveCode, nextAccountNumber, shelfMark } from './numbers';
import { pocketBalances } from './ledger';
import type { Account, AccountType, ArchiveRecord, User } from '../types';

export const CUSTOMER_ACCOUNT_TYPES: AccountType[] = [
  'current', 'savings', 'deposit', 'business', 'joint', 'reserve', 'escrow', 'vault', 'temporary',
];

export const ACCOUNT_RATES: Partial<Record<AccountType, number>> = { savings: 2.4, reserve: 3.1, vault: 0.4 };

export function isCustomerAccount(a: Account) {
  return a.ownerId !== 'BANK' && a.type !== 'internal';
}

export function canView(a: Account, userId = actor().userId) {
  return a.partyIds.includes(userId) || can('tx.view_all') || actor().system;
}

/** Owners and co-owners operate the account; trusted users may initiate payments too. */
export function canOperate(a: Account, userId = actor().userId) {
  if (actor().system) return true;
  if (a.ownerId === userId || a.coOwnerIds.includes(userId) || a.trustedIds.includes(userId)) return true;
  return can('teller.desk');
}

export function canManage(a: Account, userId = actor().userId) {
  if (actor().system) return true;
  return a.ownerId === userId || a.coOwnerIds.includes(userId) || can('accounts.manage_any') || can('teller.desk');
}

export async function getAccountOrThrow(id: string): Promise<Account> {
  const a = await db.accounts.get(id);
  if (!a) throw new BankError('INVALID_ACCOUNT', { account: id });
  return a;
}

export async function findAccountByNumber(num: string): Promise<Account | undefined> {
  return db.accounts.where('number').equals(num.replace(/\s+/g, '').toUpperCase()).first();
}

export interface OpenAccountInput {
  ownerId: string;
  type: AccountType;
  currency: string;
  name?: string;
  branchId?: string;
  multiCurrency?: boolean;
  coOwnerIds?: string[];
  dailyLimit?: number;
  purpose?: string;
  expiresInDays?: number;
  escrow?: Account['escrow'];
  companyId?: string;
  familyId?: string;
  overdraftLimit?: number;
  hidden?: boolean;
  silent?: boolean;
  /** Caller already verified authority (e.g. family owner opening a member account). */
  authorized?: boolean;
}

const BRANCH_NO: Record<string, number> = {};

async function branchNumber(branchId: string): Promise<number> {
  if (BRANCH_NO[branchId]) return BRANCH_NO[branchId];
  const b = await db.branches.get(branchId);
  const n = b ? Number(b.code.replace(/\D/g, '')) || 100 : 100;
  BRANCH_NO[branchId] = n;
  return n;
}

export async function openAccount(input: OpenAccountInput): Promise<Account> {
  const a = actor();
  const owner = await db.users.get(input.ownerId);
  if (!owner) throw new BankError('INVALID_RECIPIENT', { clientId: input.ownerId });
  if (!a.system && !input.authorized && a.userId !== owner.id && !can('teller.desk')) throw new BankError('PERMISSION_DENIED');
  if (!currencies.isTransactional(input.currency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: input.currency });
  if (owner.status !== 'active') throw new BankError('ACCOUNT_FROZEN', { client: owner.clientId });
  if (input.type === 'joint' && !(input.coOwnerIds?.length)) throw new BankError('VALIDATION', { field: 'coOwners' });
  if (input.type === 'escrow' && !input.escrow) throw new BankError('VALIDATION', { field: 'escrow' });
  const branchId = input.branchId ?? owner.branchId ?? 'BR-VEL';
  const coOwners = input.coOwnerIds ?? [];
  for (const id of coOwners) if (!(await db.users.get(id))) throw new BankError('INVALID_RECIPIENT', { clientId: id });
  const at = nowISO();
  const acc: Account = {
    id: uid('ACC'),
    number: await nextAccountNumber(await branchNumber(branchId)),
    name: input.name?.trim() || defaultName(input.type, input.currency),
    type: input.type,
    ownerId: owner.id,
    coOwnerIds: coOwners,
    trustedIds: [],
    partyIds: [owner.id, ...coOwners],
    currency: input.currency,
    pockets: [input.currency],
    multiCurrency: !!input.multiCurrency,
    status: 'active',
    createdAt: at,
    branchId,
    dailyLimit: input.dailyLimit,
    overdraftLimit: input.overdraftLimit ?? 0,
    interestRate: ACCOUNT_RATES[input.type],
    normal: input.type === 'loan' ? 'debit' : 'credit',
    companyId: input.companyId,
    familyId: input.familyId,
    purpose: input.purpose,
    expiresAt: input.type === 'temporary' ? addDays(at, input.expiresInDays ?? 30).toISOString() : undefined,
    escrow: input.escrow,
    hidden: input.hidden,
  };
  await db.accounts.add(acc);
  await audit({ action: 'account.open', object: 'account', objectId: acc.id, details: `${acc.type} ${acc.currency} ${acc.number}` });
  if (!input.silent && !input.hidden) {
    const cert = await createDocument({
      type: 'certificate',
      title: 'Certificate of Account Opening',
      ownerId: owner.id,
      partyIds: acc.partyIds,
      data: { kind: 'account_opening', accountId: acc.id, number: acc.number, accountType: acc.type, currency: acc.currency, holder: owner.name, coOwners, branchId },
      links: { accountIds: [acc.id] },
      authorName: 'Office of Deposits & Endowments',
      authorId: 'BANK',
      silent: true,
    });
    for (const p of acc.partyIds) {
      await notify(p, { category: 'accounts', titleKey: 'n.account.opened.title', bodyKey: 'n.account.opened.body', params: { name: acc.name, number: acc.number, ccy: acc.currency }, link: `/accounts/${acc.id}` });
      await sendMail(p, 'account_opened', { name: acc.name, number: acc.number, ccy: acc.currency, type: acc.type }, cert.id);
    }
  }
  return acc;
}

function defaultName(type: AccountType, ccy: string) {
  const names: Partial<Record<AccountType, string>> = {
    current: 'Current', savings: 'Savings', deposit: 'Deposit', business: 'Business', joint: 'Joint', reserve: 'Reserve',
    escrow: 'Escrow', vault: 'Vault', temporary: 'Temporary', credit: 'Credit', loan: 'Loan',
  };
  return `${names[type] ?? 'Account'} · ${ccy}`;
}

export async function renameAccount(id: string, name: string) {
  const acc = await getAccountOrThrow(id);
  if (!canManage(acc)) throw new BankError('PERMISSION_DENIED');
  if (!name.trim()) throw new BankError('VALIDATION', { field: 'name' });
  await db.accounts.update(id, { name: name.trim().slice(0, 60) });
  await audit({ action: 'account.rename', object: 'account', objectId: id, details: name });
}

export async function freezeAccount(id: string, reason = 'client request') {
  const acc = await getAccountOrThrow(id);
  if (!canManage(acc)) throw new BankError('PERMISSION_DENIED');
  if (acc.status !== 'active') throw new BankError('INVALID_STATE', { status: acc.status });
  await db.accounts.update(id, { status: 'frozen', frozenReason: reason });
  await audit({ action: 'account.freeze', object: 'account', objectId: id, details: reason });
  for (const p of acc.partyIds) {
    await notify(p, { category: 'security', titleKey: 'n.account.frozen.title', bodyKey: 'n.account.frozen.body', params: { name: acc.name, number: acc.number }, link: `/accounts/${id}`, priority: 'high' });
  }
}

export async function unfreezeAccount(id: string) {
  const acc = await getAccountOrThrow(id);
  if (!canManage(acc)) throw new BankError('PERMISSION_DENIED');
  if (acc.status !== 'frozen') throw new BankError('INVALID_STATE', { status: acc.status });
  if (acc.frozenReason === 'compliance' && !can('accounts.manage_any')) throw new BankError('PERMISSION_DENIED', { reason: 'compliance freeze' });
  await db.accounts.update(id, { status: 'active', frozenReason: undefined });
  await audit({ action: 'account.unfreeze', object: 'account', objectId: id });
  for (const p of acc.partyIds) {
    await notify(p, { category: 'accounts', titleKey: 'n.account.unfrozen.title', bodyKey: 'n.account.unfrozen.body', params: { name: acc.name, number: acc.number }, link: `/accounts/${id}` });
  }
}

export async function setAccountLimit(id: string, dailyLimit: number | undefined) {
  const acc = await getAccountOrThrow(id);
  if (!canManage(acc)) throw new BankError('PERMISSION_DENIED');
  if (dailyLimit !== undefined && (!Number.isFinite(dailyLimit) || dailyLimit < 0)) throw new BankError('INVALID_AMOUNT');
  await db.accounts.update(id, { dailyLimit });
  await audit({ action: 'account.limit', object: 'account', objectId: id, details: String(dailyLimit ?? 'none') });
}

async function resolveClient(clientIdOrId: string): Promise<User> {
  const key = clientIdOrId.trim();
  const u = (await db.users.get(key)) ?? (await db.users.where('clientId').equals(key.toUpperCase()).first());
  if (!u || u.kind !== 'client' && u.kind !== 'staff') throw new BankError('INVALID_RECIPIENT', { clientId: key });
  return u;
}

export async function addAccountParty(id: string, clientId: string, role: 'owner' | 'trusted') {
  const acc = await getAccountOrThrow(id);
  if (acc.ownerId !== actor().userId && !can('accounts.manage_any') && !actor().system) throw new BankError('PERMISSION_DENIED');
  const u = await resolveClient(clientId);
  if (acc.partyIds.includes(u.id)) throw new BankError('VALIDATION', { field: 'clientId', reason: 'already linked' });
  const patch: Partial<Account> =
    role === 'owner'
      ? { coOwnerIds: [...acc.coOwnerIds, u.id], partyIds: [...acc.partyIds, u.id], type: acc.type === 'current' ? 'joint' : acc.type }
      : { trustedIds: [...acc.trustedIds, u.id], partyIds: [...acc.partyIds, u.id] };
  await db.accounts.update(id, patch);
  await audit({ action: `account.add_${role}`, object: 'account', objectId: id, details: u.clientId });
  await notify(u.id, { category: 'accounts', titleKey: 'n.account.party.title', bodyKey: 'n.account.party.body', params: { name: acc.name, number: acc.number, role }, link: `/accounts/${id}` });
  return u;
}

export async function removeAccountParty(id: string, userId: string) {
  const acc = await getAccountOrThrow(id);
  if (acc.ownerId !== actor().userId && !can('accounts.manage_any')) throw new BankError('PERMISSION_DENIED');
  if (userId === acc.ownerId) throw new BankError('VALIDATION', { reason: 'owner' });
  await db.accounts.update(id, {
    coOwnerIds: acc.coOwnerIds.filter((x) => x !== userId),
    trustedIds: acc.trustedIds.filter((x) => x !== userId),
    partyIds: acc.partyIds.filter((x) => x !== userId),
  });
  await audit({ action: 'account.remove_party', object: 'account', objectId: id, details: userId });
}

export async function addPocket(id: string, currency: string) {
  const acc = await getAccountOrThrow(id);
  if (!canManage(acc)) throw new BankError('PERMISSION_DENIED');
  if (!acc.multiCurrency) throw new BankError('INVALID_STATE', { reason: 'single currency account' });
  if (!currencies.isTransactional(currency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency });
  if (acc.pockets.includes(currency)) return;
  await db.accounts.update(id, { pockets: [...acc.pockets, currency] });
  await audit({ action: 'account.add_pocket', object: 'account', objectId: id, details: currency });
}

/** Close an account. Remaining funds must be zero or swept to another own account first. */
export async function closeAccount(id: string, sweepToAccountId?: string) {
  const acc = await getAccountOrThrow(id);
  if (!canManage(acc)) throw new BankError('PERMISSION_DENIED');
  if (acc.status === 'closed') throw new BankError('INVALID_STATE', { status: acc.status });
  const activeHolds = await db.holds.where('accountId').equals(id).filter((h) => h.status === 'active').count();
  if (activeHolds) throw new BankError('ACCOUNT_NOT_EMPTY', { holds: activeHolds });
  const linkedDeposit = await db.deposits.where('accountId').equals(id).filter((d) => d.status === 'active').count();
  if (linkedDeposit) throw new BankError('INVALID_STATE', { reason: 'active deposit' });
  let pockets = await pocketBalances(acc);
  if (pockets.some((p) => p.balance !== 0)) {
    if (!sweepToAccountId) throw new BankError('ACCOUNT_NOT_EMPTY', { balance: pockets.find((p) => p.balance !== 0)!.balance });
    const { transferOwn } = await import('./payments');
    for (const p of pockets.filter((x) => x.balance > 0)) {
      const target = await getAccountOrThrow(sweepToAccountId);
      await transferOwn({ fromAccountId: id, toAccountId: sweepToAccountId, currency: p.currency, amount: p.balance, description: `Closure sweep of ${acc.number}`, targetCurrency: target.multiCurrency || target.currency === p.currency ? p.currency : target.currency, allowFrozen: true });
    }
    pockets = await pocketBalances(acc);
    if (pockets.some((p) => p.balance !== 0)) throw new BankError('ACCOUNT_NOT_EMPTY');
  }
  const at = nowISO();
  await db.accounts.update(id, { status: 'closed', closedAt: at });
  // cards linked to a closed account are retired
  await db.cards.where('accountId').equals(id).modify((c) => {
    if (c.status === 'active' || c.status === 'frozen') c.status = 'blocked';
  });
  const owner = await db.users.get(acc.ownerId);
  const doc = await createDocument({
    type: 'certificate',
    title: 'Certificate of Account Closure',
    ownerId: acc.ownerId,
    partyIds: acc.partyIds,
    data: { kind: 'account_closure', accountId: acc.id, number: acc.number, accountType: acc.type, currency: acc.currency, holder: owner?.name, closedAt: at },
    links: { accountIds: [acc.id] },
    authorName: 'Hall of Sealed Records',
    authorId: 'BANK',
    silent: true,
  });
  const rec: ArchiveRecord = {
    id: uid('ARR'),
    code: archiveCode('ARC'),
    kind: 'closed_account',
    title: `Closed account ${acc.number}`,
    summary: `${acc.name} (${acc.type}, ${acc.currency}) held by ${owner?.name ?? acc.ownerId} — closed ${at.slice(0, 10)}.`,
    createdAt: at,
    ownerId: acc.ownerId,
    department: 'ARC',
    classification: 'confidential',
    refs: { accountId: acc.id, docId: doc.id },
    tags: ['account', acc.type, acc.currency],
    shelf: shelfMark(),
    status: 'filed',
  };
  await db.archive.add(rec);
  await audit({ action: 'account.close', object: 'account', objectId: id, details: acc.number });
  for (const p of acc.partyIds) {
    await sendMail(p, 'account_closed', { name: acc.name, number: acc.number }, doc.id);
    await notify(p, { category: 'accounts', titleKey: 'n.account.closed.title', bodyKey: 'n.account.closed.body', params: { name: acc.name, number: acc.number }, link: `/accounts/${id}` });
  }
}

/** Bank-side GL accounts (fees, FX position, clearing, cash vaults …). */
export async function ensureInternalAccount(id: string, name: string, normal: 'debit' | 'credit', glCode: string, branchId = 'BR-VEL') {
  const existing = await db.accounts.get(id);
  if (existing) return existing;
  const acc: Account = {
    id, number: `GL${glCode}`, name, type: 'internal', ownerId: 'BANK', coOwnerIds: [], trustedIds: [], partyIds: [],
    currency: 'CRWN', pockets: ['CRWN'], multiCurrency: true, status: 'active', createdAt: nowISO(), branchId,
    overdraftLimit: 0, normal, glCode, hidden: true,
  };
  await db.accounts.put(acc);
  return acc;
}

export const GL = {
  EQUITY: 'GL:EQUITY',
  CENTRAL: 'GL:CENTRAL',
  FEES: 'GL:FEES',
  FX: 'GL:FX',
  CLEARING: 'GL:CLEARING',
  NOSTRO: 'GL:NOSTRO',
  INT_EXP: 'GL:INTEXP',
  INT_INC: 'GL:INTINC',
  SECURITIES: 'GL:SECURITIES',
  DISPUTES: 'GL:DISPUTES',
  CARDS: 'GL:CARDS',
  TAX: 'GL:TAX',
  INSURANCE: 'GL:INSURANCE',
  CHECKS: 'GL:CHECKS',
  SUSPENSE: 'GL:SUSPENSE',
  cash: (branchId: string) => `GL:CASH:${branchId}`,
  atm: (atmId: string) => `GL:ATM:${atmId}`,
};

export async function ensureCoreLedger() {
  await ensureInternalAccount(GL.EQUITY, 'Exchequer Capital & Reserves', 'credit', '1000');
  await ensureInternalAccount(GL.CENTRAL, 'Central Bullion Reserve (Undervault)', 'debit', '1100');
  await ensureInternalAccount(GL.FEES, 'Fee & Commission Income', 'credit', '4100');
  await ensureInternalAccount(GL.FX, 'Foreign Exchange Position', 'credit', '2600');
  await ensureInternalAccount(GL.CLEARING, 'Cross-Realm Clearing (Suspense)', 'credit', '2300');
  await ensureInternalAccount(GL.NOSTRO, 'Nostro — Correspondent Banks', 'debit', '1300');
  await ensureInternalAccount(GL.INT_EXP, 'Interest Expense on Deposits', 'debit', '5100');
  await ensureInternalAccount(GL.INT_INC, 'Interest Income on Loans', 'credit', '4200');
  await ensureInternalAccount(GL.SECURITIES, 'Securities Settlement', 'debit', '1500');
  await ensureInternalAccount(GL.DISPUTES, 'Disputes & Chargebacks', 'debit', '1800');
  await ensureInternalAccount(GL.CARDS, 'SIGIL Card Scheme Settlement', 'debit', '1400');
  await ensureInternalAccount(GL.TAX, 'Revenue Office Collection', 'credit', '2700');
  await ensureInternalAccount(GL.INSURANCE, 'Wardstone Mutual Premiums', 'credit', '2800');
  await ensureInternalAccount(GL.CHECKS, "Cashier's Checks Outstanding", 'credit', '2400');
  await ensureInternalAccount(GL.SUSPENSE, 'General Suspense', 'credit', '2900');
}
