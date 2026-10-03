/**
 * Business & Family banking: companies with role-based members, staff payroll
 * (mass payouts creating many linked transactions), the payment approval
 * workflow Employee → Manager → Accountant → Bank → Completed, and family groups.
 */
import { db } from '../db/db';
import { BankError } from '../errors';
import { nowISO } from '../clock';
import { uid, randomDigits } from '../util/random';
import { actor } from '../context';
import { bizCan } from '../security/permissions';
import { getAccountOrThrow, openAccount } from './accounts';
import { availableOf, placeHold, releaseHold } from './ledger';
import { transfer, bulkPay, resolveRecipient } from './payments';
import { audit } from '../ops/audit';
import { toBase } from '../currency/rates';
import { notify, sendMail } from '../comms/notify';
import type { Approval, BizRole, Company, CompanyEmployee, Family, FamilyMember, PayrollRun } from '../types';

export async function getCompanyOrThrow(id: string) {
  const c = await db.companies.get(id);
  if (!c) throw new BankError('NOT_FOUND', { object: 'company' });
  return c;
}

/** Register a company and open its first business account (owner = acting client). */
export async function createCompany(input: { name: string; sector: string; currency: string; ownerId?: string }) {
  const a = actor();
  const ownerId = input.ownerId ?? a.userId;
  const owner = await db.users.get(ownerId);
  if (!owner) throw new BankError('NOT_FOUND');
  if (!input.name.trim()) throw new BankError('VALIDATION', { field: 'name' });
  const id = uid('CMP');
  const acc = await openAccount({ ownerId, type: 'business', currency: input.currency, name: `${input.name.trim()} · Operating`, companyId: id, multiCurrency: true });
  const c: Company = {
    id, name: input.name.trim(), registryNo: `CR-ALD-${randomDigits(6)}`, taxId: `TIN-${randomDigits(9)}`, sector: input.sector, ownerId,
    memberIds: [ownerId], members: [{ userId: ownerId, name: owner.name, role: 'owner', addedAt: nowISO() }], accountIds: [acc.id], createdAt: nowISO(),
  };
  await db.companies.add(c);
  await db.users.update(ownerId, { segment: owner.segment === 'premium' ? 'premium' : 'business' });
  await audit({ action: 'business.create', object: 'company', objectId: id, details: c.name });
  return c;
}

export async function openCompanyAccount(companyId: string, type: 'business' | 'reserve' | 'escrow', currency: string, name: string) {
  const c = await getCompanyOrThrow(companyId);
  requireBiz(c, 'manage_members');
  const acc = await openAccount({ ownerId: c.ownerId, type, currency, name: name || `${c.name} · ${type}`, companyId, authorized: true, escrow: type === 'escrow' ? { beneficiaryName: c.name, condition: 'Release on delivery', released: false } : undefined });
  const partyIds = [...new Set([...acc.partyIds, ...c.memberIds])];
  await db.accounts.update(acc.id, { partyIds, trustedIds: c.members.filter((m) => m.role !== 'auditor' && m.userId !== c.ownerId).map((m) => m.userId) });
  await db.companies.update(companyId, { accountIds: [...c.accountIds, acc.id] });
  return acc;
}

export function roleIn(c: Company, userId = actor().userId): BizRole | undefined {
  return c.members.find((m) => m.userId === userId)?.role;
}

function requireBiz(c: Company, ability: string) {
  if (actor().system) return;
  if (!bizCan(roleIn(c), ability)) throw new BankError('PERMISSION_DENIED', { ability });
}

export async function addCompanyMember(companyId: string, clientId: string, role: BizRole) {
  const c = await getCompanyOrThrow(companyId);
  requireBiz(c, 'manage_members');
  const u = await db.users.where('clientId').equals(clientId.trim().toUpperCase()).first();
  if (!u) throw new BankError('INVALID_RECIPIENT', { clientId });
  if (c.memberIds.includes(u.id)) throw new BankError('VALIDATION', { reason: 'already member' });
  await db.companies.update(companyId, { memberIds: [...c.memberIds, u.id], members: [...c.members, { userId: u.id, name: u.name, role, addedAt: nowISO() }] });
  // members get visibility of company accounts
  for (const accId of c.accountIds) {
    const acc = await db.accounts.get(accId);
    if (acc && !acc.partyIds.includes(u.id)) await db.accounts.update(accId, { partyIds: [...acc.partyIds, u.id], trustedIds: role === 'auditor' ? acc.trustedIds : [...acc.trustedIds, u.id] });
  }
  await audit({ action: 'business.member_add', object: 'company', objectId: companyId, details: `${u.clientId} ${role}` });
  await notify(u.id, { category: 'accounts', titleKey: 'n.biz.member.title', bodyKey: 'n.biz.member.body', params: { company: c.name, role }, link: '/business' });
}

export async function setMemberRole(companyId: string, userId: string, role: BizRole) {
  const c = await getCompanyOrThrow(companyId);
  requireBiz(c, 'manage_members');
  if (c.ownerId === userId) throw new BankError('VALIDATION', { reason: 'owner role is fixed' });
  await db.companies.update(companyId, { members: c.members.map((m) => (m.userId === userId ? { ...m, role } : m)) });
  await audit({ action: 'business.member_role', object: 'company', objectId: companyId, details: `${userId} → ${role}` });
}

export async function removeCompanyMember(companyId: string, userId: string) {
  const c = await getCompanyOrThrow(companyId);
  requireBiz(c, 'manage_members');
  if (c.ownerId === userId) throw new BankError('VALIDATION', { reason: 'owner' });
  await db.companies.update(companyId, { memberIds: c.memberIds.filter((x) => x !== userId), members: c.members.filter((m) => m.userId !== userId) });
  for (const accId of c.accountIds) {
    const acc = await db.accounts.get(accId);
    if (acc) await db.accounts.update(accId, { partyIds: acc.partyIds.filter((p) => p !== userId || p === acc.ownerId), trustedIds: acc.trustedIds.filter((p) => p !== userId) });
  }
  await audit({ action: 'business.member_remove', object: 'company', objectId: companyId, details: userId });
}

/* ── Company staff (payroll register) ── */

export async function addStaff(companyId: string, s: Omit<CompanyEmployee, 'id' | 'companyId' | 'employeeNo' | 'status' | 'hiredAt'>) {
  const c = await getCompanyOrThrow(companyId);
  requireBiz(c, 'manage_staff');
  if (!s.name.trim() || !(s.salary > 0)) throw new BankError('VALIDATION', { field: 'staff' });
  await resolveRecipient({ accountNumber: s.accountNumber }, s.currency);
  const e: CompanyEmployee = { ...s, id: uid('STF'), companyId, employeeNo: `E-${randomDigits(5)}`, status: 'active', hiredAt: nowISO() };
  await db.companyStaff.add(e);
  await audit({ action: 'business.staff_add', object: 'company', objectId: companyId, details: e.name });
  return e;
}

export async function updateStaff(id: string, patch: Partial<Pick<CompanyEmployee, 'position' | 'salary' | 'paymentDay' | 'status' | 'accountNumber'>>) {
  const e = await db.companyStaff.get(id);
  if (!e) throw new BankError('NOT_FOUND');
  const c = await getCompanyOrThrow(e.companyId);
  requireBiz(c, 'manage_staff');
  await db.companyStaff.update(id, patch);
  await audit({ action: 'business.staff_update', object: 'company', objectId: c.id, details: `${e.name} ${JSON.stringify(patch)}` });
}

/* ── Approval workflow ── */

export async function createBusinessPayment(input: { companyId: string; fromAccountId: string; recipientAccount: string; recipientName: string; amount: number; description: string }) {
  const c = await getCompanyOrThrow(input.companyId);
  requireBiz(c, 'create_payment');
  if (!c.accountIds.includes(input.fromAccountId)) throw new BankError('PERMISSION_DENIED');
  if (!(input.amount > 0)) throw new BankError('INVALID_AMOUNT');
  const acc = await getAccountOrThrow(input.fromAccountId);
  await resolveRecipient({ accountNumber: input.recipientAccount }, acc.currency);
  const a = actor();
  const hold = await placeHold({ accountId: acc.id, currency: acc.currency, amount: input.amount, reason: 'approval', description: `Pending approval: ${input.description}` });
  const ap: Approval = {
    id: uid('APR'), number: `AP-${randomDigits(6)}`, companyId: c.id, kind: 'payment', createdBy: a.userId, createdByName: a.name, createdAt: nowISO(),
    status: 'pending_manager', amount: input.amount, currency: acc.currency, description: input.description, fromAccountId: acc.id,
    recipientAccount: input.recipientAccount, recipientName: input.recipientName, steps: [{ stage: 'created', at: nowISO(), by: a.userId, byName: a.name }], holdId: hold.id,
  };
  await db.approvals.add(ap);
  await audit({ action: 'business.payment_create', object: 'approval', objectId: ap.id, details: `${ap.amount} ${ap.currency}` });
  for (const m of c.members.filter((m) => bizCan(m.role, 'approve_manager') && m.userId !== a.userId)) {
    await notify(m.userId, { category: 'payments', titleKey: 'n.biz.approval.title', bodyKey: 'n.biz.approval.body', params: { company: c.name, number: ap.number, amt: ap.amount, ccy: ap.currency }, link: '/business?tab=approvals' });
  }
  return ap;
}

export async function decideApproval(id: string, decision: 'approved' | 'rejected', note = '') {
  const ap = await db.approvals.get(id);
  if (!ap) throw new BankError('NOT_FOUND');
  const c = await getCompanyOrThrow(ap.companyId);
  const a = actor();
  const stage = ap.status === 'pending_manager' ? 'manager' : ap.status === 'pending_accountant' ? 'accountant' : null;
  if (!stage) throw new BankError('INVALID_STATE', { status: ap.status });
  requireBiz(c, stage === 'manager' ? 'approve_manager' : 'review_accountant');
  // separation of duties: the creator cannot approve their own payment, and one person cannot sign both stages
  if (!a.system && (ap.createdBy === a.userId || ap.steps.some((s) => s.by === a.userId && s.stage !== 'created'))) {
    throw new BankError('SEPARATION_OF_DUTIES');
  }
  const steps = [...ap.steps, { stage: stage as 'manager' | 'accountant', at: nowISO(), by: a.userId, byName: a.name, decision, note }];
  if (decision === 'rejected') {
    if (ap.holdId) await releaseHold(ap.holdId);
    await db.approvals.update(id, { status: 'rejected', steps });
    if (ap.payrollRunId) await db.payroll.update(ap.payrollRunId, { status: 'rejected' });
    await audit({ action: `business.${stage}_reject`, object: 'approval', objectId: id, details: note });
    await notify(ap.createdBy, { category: 'payments', titleKey: 'n.biz.rejected.title', bodyKey: 'n.biz.rejected.body', params: { number: ap.number, stage }, link: '/business?tab=approvals' });
    return;
  }
  if (stage === 'manager') {
    await db.approvals.update(id, { status: 'pending_accountant', steps });
    await audit({ action: 'business.manager_approve', object: 'approval', objectId: id });
    for (const m of c.members.filter((m) => bizCan(m.role, 'review_accountant') && m.userId !== a.userId && m.userId !== ap.createdBy)) {
      await notify(m.userId, { category: 'payments', titleKey: 'n.biz.approval.title', bodyKey: 'n.biz.review.body', params: { company: c.name, number: ap.number, amt: ap.amount, ccy: ap.currency }, link: '/business?tab=approvals' });
    }
    return;
  }
  // accountant approved → bank processes
  await db.approvals.update(id, { status: 'processing', steps: [...steps, { stage: 'bank', at: nowISO(), byName: 'Directorate of Aetherline Payments' }] });
  await audit({ action: 'business.accountant_approve', object: 'approval', objectId: id });
  if (ap.holdId) await releaseHold(ap.holdId);
  try {
    if (ap.kind === 'payroll' && ap.payrollRunId) {
      await executePayroll(ap.payrollRunId);
    } else {
      const tx = await transfer({
        fromAccountId: ap.fromAccountId, currency: ap.currency, amount: ap.amount, recipient: { accountNumber: ap.recipientAccount! },
        description: `${ap.description} [${ap.number}]`, category: 'business', initiatorId: ap.createdBy, skipScreen: true,
      });
      await db.approvals.update(id, { txId: tx.id });
    }
    const fresh = (await db.approvals.get(id))!;
    await db.approvals.update(id, { status: 'completed', steps: [...fresh.steps, { stage: 'completed', at: nowISO(), byName: 'Exchequer of Aldermoor' }] });
    await notify(ap.createdBy, { category: 'payments', titleKey: 'n.biz.completed.title', bodyKey: 'n.biz.completed.body', params: { number: ap.number, amt: ap.amount, ccy: ap.currency }, link: '/business?tab=approvals' });
  } catch (e) {
    await db.approvals.update(id, { status: 'failed' });
    throw e;
  }
}

export async function cancelApproval(id: string) {
  const ap = await db.approvals.get(id);
  if (!ap) throw new BankError('NOT_FOUND');
  if (ap.createdBy !== actor().userId) throw new BankError('PERMISSION_DENIED');
  if (!['pending_manager', 'pending_accountant'].includes(ap.status)) throw new BankError('INVALID_STATE', { status: ap.status });
  if (ap.holdId) await releaseHold(ap.holdId);
  await db.approvals.update(id, { status: 'cancelled' });
  if (ap.payrollRunId) await db.payroll.update(ap.payrollRunId, { status: 'rejected' });
  await audit({ action: 'business.payment_cancel', object: 'approval', objectId: id });
}

/* ── Payroll ── */

export async function preparePayroll(companyId: string, fromAccountId: string, period: string) {
  const c = await getCompanyOrThrow(companyId);
  requireBiz(c, 'run_payroll');
  if (!c.accountIds.includes(fromAccountId)) throw new BankError('PERMISSION_DENIED');
  const acc = await getAccountOrThrow(fromAccountId);
  const staff = (await db.companyStaff.where('companyId').equals(companyId).toArray()).filter((s) => s.status === 'active' && s.currency === acc.currency);
  if (!staff.length) throw new BankError('VALIDATION', { field: 'staff' });
  const total = staff.reduce((s, e) => s + e.salary, 0);
  const avail = await availableOf(acc.id, acc.currency);
  if (avail < total) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: total, currency: acc.currency });
  const a = actor();
  const run: PayrollRun = {
    id: uid('PAY'), number: `PR-${period}-${randomDigits(4)}`, companyId, period, createdAt: nowISO(), status: 'pending_approval', fromAccountId,
    lines: staff.map((e) => ({ employeeId: e.id, name: e.name, amount: e.salary, currency: e.currency, accountNumber: e.accountNumber, status: 'queued' as const })),
    total, currency: acc.currency,
  };
  const hold = await placeHold({ accountId: acc.id, currency: acc.currency, amount: total, reason: 'approval', description: `Payroll ${period} pending approval` });
  const ap: Approval = {
    id: uid('APR'), number: `AP-${randomDigits(6)}`, companyId, kind: 'payroll', createdBy: a.userId, createdByName: a.name, createdAt: nowISO(),
    status: 'pending_manager', amount: total, currency: acc.currency, description: `Payroll ${period} (${staff.length} employees)`, fromAccountId,
    payrollRunId: run.id, steps: [{ stage: 'created', at: nowISO(), by: a.userId, byName: a.name }], holdId: hold.id,
  };
  run.approvalId = ap.id;
  await db.payroll.add(run);
  await db.approvals.add(ap);
  await audit({ action: 'payroll.prepare', object: 'payroll', objectId: run.id, details: `${staff.length} lines, ${total} ${acc.currency}` });
  return { run, approval: ap };
}

export async function executePayroll(runId: string) {
  const run = await db.payroll.get(runId);
  if (!run) throw new BankError('NOT_FOUND');
  await db.payroll.update(runId, { status: 'processing' });
  const { batchId, results } = await bulkPay(
    run.fromAccountId, run.currency,
    run.lines.map((l) => ({ accountNumber: l.accountNumber, name: l.name, amount: l.amount, description: `Salary ${run.period} — ${l.name}` })),
    `Payroll ${run.period}`, 'business',
  );
  const lines = run.lines.map((l, i) => ({ ...l, txId: results[i]?.tx?.id, status: results[i]?.tx ? ('completed' as const) : ('failed' as const) }));
  const ok = lines.every((l) => l.status === 'completed');
  await db.payroll.update(runId, { lines, batchId, status: ok ? 'completed' : 'failed' });
  for (const l of lines.filter((x) => x.txId)) await db.transactions.update(l.txId!, { type: 'payroll', category: 'salary' });
  const c = await db.companies.get(run.companyId);
  if (c) await sendMail(c.ownerId, 'payroll_completed', { company: c.name, period: run.period, count: lines.filter((l) => l.status === 'completed').length, amt: run.total, ccy: run.currency });
  await audit({ action: 'payroll.execute', object: 'payroll', objectId: runId, details: `${lines.filter((l) => l.status === 'completed').length}/${lines.length}` });
  return { batchId, lines };
}

/* ── Family banking ── */

export async function getFamilyOrThrow(id: string) {
  const f = await db.families.get(id);
  if (!f) throw new BankError('NOT_FOUND', { object: 'family' });
  return f;
}

export async function createFamily(name: string) {
  const a = actor();
  const existing = await db.families.where('ownerId').equals(a.userId).first();
  if (existing) return existing;
  const user = await db.users.get(a.userId);
  const f: Family = {
    id: uid('FAM'), name: name || `${user?.name ?? 'Family'} household`, ownerId: a.userId, memberIds: [a.userId],
    members: [{ userId: a.userId, name: user?.name ?? a.name, relation: 'self', role: 'owner', dailyLimit: 0, currency: 'CRWN', permissions: { transfers: true, cardPayments: true, atm: true, international: true, online: true }, addedAt: nowISO() }],
    createdAt: nowISO(),
  };
  await db.families.add(f);
  await db.users.update(a.userId, { familyId: f.id });
  await audit({ action: 'family.create', object: 'family', objectId: f.id });
  return f;
}

export async function addFamilyMember(familyId: string, clientId: string, relation: string, role: FamilyMember['role'], dailyLimit: number, currency: string) {
  const f = await getFamilyOrThrow(familyId);
  if (f.ownerId !== actor().userId) throw new BankError('PERMISSION_DENIED');
  const u = await db.users.where('clientId').equals(clientId.trim().toUpperCase()).first();
  if (!u) throw new BankError('INVALID_RECIPIENT', { clientId });
  if (f.memberIds.includes(u.id)) throw new BankError('VALIDATION', { reason: 'already member' });
  const m: FamilyMember = { userId: u.id, name: u.name, relation, role, dailyLimit, currency, permissions: { transfers: role !== 'child', cardPayments: true, atm: role !== 'child', international: false, online: true }, addedAt: nowISO() };
  await db.families.update(familyId, { memberIds: [...f.memberIds, u.id], members: [...f.members, m] });
  await db.users.update(u.id, { familyId, ...(dailyLimit > 0 ? { dailyLimitUSD: toBase(dailyLimit, currency, 'USD') } : {}) });
  await audit({ action: 'family.member_add', object: 'family', objectId: familyId, details: `${u.clientId} ${role}` });
  await notify(u.id, { category: 'accounts', titleKey: 'n.family.added.title', bodyKey: 'n.family.added.body', params: { name: f.name }, link: '/family' });
}

export async function updateFamilyMember(familyId: string, userId: string, patch: Partial<Pick<FamilyMember, 'dailyLimit' | 'permissions' | 'relation' | 'role'>>) {
  const f = await getFamilyOrThrow(familyId);
  if (f.ownerId !== actor().userId) throw new BankError('PERMISSION_DENIED');
  const members = f.members.map((m) => (m.userId === userId ? { ...m, ...patch, permissions: { ...m.permissions, ...(patch.permissions ?? {}) } } : m));
  await db.families.update(familyId, { members });
  const m = members.find((x) => x.userId === userId);
  if (m && patch.dailyLimit !== undefined) {
    // family limit is enforced as the member's personal daily outgoing limit (USD-equivalent via CRWN rate approx.)
    await db.users.update(userId, { dailyLimitUSD: toBase(m.dailyLimit, m.currency, 'USD') });
  }
  // card controls follow family permissions
  if (m && patch.permissions) {
    const cards = await db.cards.where('ownerId').equals(userId).toArray();
    for (const c of cards) {
      await db.cards.update(c.id, { controls: { ...c.controls, atm: m.permissions.atm, online: m.permissions.online, international: m.permissions.international } });
    }
  }
  await audit({ action: 'family.member_update', object: 'family', objectId: familyId, details: `${userId} ${JSON.stringify(patch)}` });
}

export async function removeFamilyMember(familyId: string, userId: string) {
  const f = await getFamilyOrThrow(familyId);
  if (f.ownerId !== actor().userId) throw new BankError('PERMISSION_DENIED');
  if (userId === f.ownerId) throw new BankError('VALIDATION', { reason: 'owner' });
  await db.families.update(familyId, { memberIds: f.memberIds.filter((x) => x !== userId), members: f.members.filter((m) => m.userId !== userId) });
  await db.users.update(userId, { familyId: undefined });
  await audit({ action: 'family.member_remove', object: 'family', objectId: familyId, details: userId });
}

/** Owner opens a separate account for a member; owner stays co-owner for oversight. */
export async function openFamilyAccount(familyId: string, memberUserId: string, currency: string) {
  const f = await getFamilyOrThrow(familyId);
  if (f.ownerId !== actor().userId) throw new BankError('PERMISSION_DENIED');
  const m = f.members.find((x) => x.userId === memberUserId);
  if (!m) throw new BankError('NOT_FOUND');
  const acc = await openAccount({ ownerId: memberUserId, type: 'current', currency, name: `${m.name.split(' ')[0]}'s allowance · ${currency}`, familyId, coOwnerIds: [], silent: false, authorized: true });
  await db.accounts.update(acc.id, { trustedIds: [f.ownerId], partyIds: [...acc.partyIds, f.ownerId] });
  await db.families.update(familyId, { members: f.members.map((x) => (x.userId === memberUserId ? { ...x, accountId: acc.id } : x)) });
  await audit({ action: 'family.account_open', object: 'family', objectId: familyId, details: acc.number });
  return acc;
}
