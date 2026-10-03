/**
 * Lending Chancery: Apply → Review → Approval → Agreement → Disbursement →
 * Repayment (scheduled annuity) → Early payoff / Closure; credit lines with
 * draw/repay; overdue tracking; credit history. Decisions are DEMO scoring rules.
 */
import { db } from '../db/db';
import { BankError } from '../errors';
import { nowISO, addMonths, todayKey } from '../clock';
import { uid, randomDigits } from '../util/random';
import { actor } from '../context';
import { can, requirePermission } from '../security/permissions';
import { currencies } from '../currency/registry';
import { toBase } from '../currency/rates';
import { execute } from './engine';
import { availableOf, balanceOf } from './ledger';
import { canOperate, getAccountOrThrow, GL, openAccount } from './accounts';
import { createDocument, signDocument } from '../docs/documents';
import { archiveCode, shelfMark } from './numbers';
import { audit } from '../ops/audit';
import { notify, sendMail } from '../comms/notify';
import type { Loan, LoanInstallment, LoanType } from '../types';

export const LOAN_PRODUCTS: Record<LoanType, { rate: number; maxCRWN: number; minTerm: number; maxTerm: number; instant?: boolean }> = {
  personal: { rate: 11.9, maxCRWN: 60_000_00, minTerm: 6, maxTerm: 60 },
  business: { rate: 9.5, maxCRWN: 600_000_00, minTerm: 12, maxTerm: 84 },
  mortgage: { rate: 6.2, maxCRWN: 2_500_000_00, minTerm: 60, maxTerm: 360 },
  emergency: { rate: 15.9, maxCRWN: 5_000_00, minTerm: 1, maxTerm: 12, instant: true },
  credit_line: { rate: 13.5, maxCRWN: 40_000_00, minTerm: 12, maxTerm: 36 },
};

export function loanRate(type: LoanType, currency: string, score = 75) {
  const base = LOAN_PRODUCTS[type].rate;
  const def = currencies.get(currency);
  const adj = currency === 'CRWN' ? 0 : def?.kind === 'magical' ? 1.2 : ['USD', 'EUR', 'CHF', 'GBP'].includes(currency) ? -0.8 : 0.9;
  const riskAdj = score >= 85 ? -0.7 : score >= 70 ? 0 : 1.5;
  return Math.round((base + adj + riskAdj) * 100) / 100;
}

export function annuityPayment(amount: number, rate: number, months: number): number {
  const r = rate / 100 / 12;
  if (r === 0) return Math.ceil(amount / months);
  return Math.ceil((amount * r) / (1 - Math.pow(1 + r, -months)));
}

export function buildSchedule(amount: number, rate: number, months: number, start: string): LoanInstallment[] {
  const pay = annuityPayment(amount, rate, months);
  const r = rate / 100 / 12;
  let bal = amount;
  const out: LoanInstallment[] = [];
  for (let n = 1; n <= months; n++) {
    const interest = Math.round(bal * r);
    let principal = pay - interest;
    if (n === months || principal > bal) principal = bal;
    bal -= principal;
    out.push({ n, dueDate: addMonths(start, n).toISOString().slice(0, 10), principal, interest, total: principal + interest, paid: 0, status: 'upcoming' });
  }
  if (out.length) out[0].status = 'due';
  return out;
}

export function loanQuote(type: LoanType, amount: number, months: number, currency: string, score = 75) {
  const rate = loanRate(type, currency, score);
  if (type === 'credit_line') return { rate, payment: Math.round((amount * rate) / 100 / 12), totalInterest: 0, schedule: [] as LoanInstallment[] };
  const schedule = buildSchedule(amount, rate, months, nowISO());
  const totalInterest = schedule.reduce((s, i) => s + i.interest, 0);
  return { rate, payment: annuityPayment(amount, rate, months), totalInterest, schedule };
}

export async function getLoanOrThrow(id: string) {
  const l = await db.loans.get(id);
  if (!l) throw new BankError('NOT_FOUND', { object: 'loan' });
  return l;
}

/** Demonstration credit scoring — transparent rules, not a real credit model. */
export async function scoreApplicant(ownerId: string, type: LoanType, amount: number, months: number, currency: string, monthlyIncome: number) {
  const reasons: string[] = [];
  let score = 60;
  const user = await db.users.get(ownerId);
  if (user?.kycStatus === 'verified') { score += 15; reasons.push('kyc_verified'); } else { score -= 25; reasons.push('kyc_missing'); }
  const loans = await db.loans.where('ownerId').equals(ownerId).toArray();
  const active = loans.filter((l) => ['active', 'overdue'].includes(l.status));
  const late = loans.reduce((s, l) => s + l.latePayments, 0);
  if (late > 2) { score -= 20; reasons.push('late_history'); } else if (loans.some((l) => l.status === 'closed')) { score += 8; reasons.push('good_history'); }
  if (active.length >= 3) { score -= 15; reasons.push('many_loans'); }
  const rate = loanRate(type, currency);
  const payment = type === 'credit_line' ? Math.round((amount * rate) / 100 / 12) : annuityPayment(amount, rate, months);
  const existing = active.reduce((s, l) => s + toBase(l.payment, l.currency, currency), 0);
  const income = toBase(monthlyIncome, 'CRWN', currency);
  const dti = income > 0 ? (payment + existing) / income : 9;
  if (dti < 0.3) { score += 15; reasons.push('low_dti'); } else if (dti < 0.5) { reasons.push('moderate_dti'); } else { score -= 25; reasons.push('high_dti'); }
  const maxInCcy = toBase(LOAN_PRODUCTS[type].maxCRWN, 'CRWN', currency);
  if (amount > maxInCcy) { score -= 40; reasons.push('above_product_max'); }
  if (type === 'emergency') score += 5;
  return { score: Math.max(0, Math.min(100, score)), reasons, payment, dti };
}

export async function applyLoan(input: { type: LoanType; amount: number; termMonths: number; currency: string; purpose: string; payoutAccountId: string; monthlyIncome: number; collateral?: string }) {
  const payout = await getAccountOrThrow(input.payoutAccountId);
  if (!canOperate(payout)) throw new BankError('PERMISSION_DENIED');
  if (!currencies.isTransactional(input.currency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: input.currency });
  if (!(input.amount > 0)) throw new BankError('INVALID_AMOUNT');
  const prod = LOAN_PRODUCTS[input.type];
  if (input.termMonths < prod.minTerm || input.termMonths > prod.maxTerm) throw new BankError('VALIDATION', { field: 'term', min: prod.minTerm, max: prod.maxTerm });
  if (!payout.pockets.includes(input.currency) && !payout.multiCurrency) throw new BankError('CURRENCY_UNSUPPORTED', { currency: input.currency, account: payout.number });
  const owner = await db.users.get(payout.ownerId);
  const at = nowISO();
  const q = loanQuote(input.type, input.amount, input.termMonths, input.currency);
  const loan: Loan = {
    id: uid('LN'),
    number: `LN-${randomDigits(7)}`,
    ownerId: payout.ownerId,
    type: input.type,
    currency: input.currency,
    amount: input.amount,
    rate: q.rate,
    termMonths: input.termMonths,
    payment: q.payment,
    status: 'applied',
    purpose: input.purpose,
    appliedAt: at,
    schedule: [],
    outstanding: 0,
    payoutAccountId: payout.id,
    latePayments: 0,
    repayments: [],
    collateral: input.collateral,
    monthlyIncome: input.monthlyIncome,
    creditLimit: input.type === 'credit_line' ? input.amount : undefined,
  };
  await db.loans.add(loan);
  await createDocument({
    type: 'application', title: 'Loan Application', ownerId: loan.ownerId, department: 'LND',
    data: { kind: 'loan', loanId: loan.id, number: loan.number, loanType: loan.type, amount: loan.amount, currency: loan.currency, termMonths: loan.termMonths, purpose: loan.purpose, income: loan.monthlyIncome, applicant: owner?.name },
    silent: true,
  });
  await audit({ action: 'loan.apply', object: 'loan', objectId: loan.id, details: `${loan.type} ${loan.amount} ${loan.currency}` });
  return decideLoan(loan.id);
}

/** Automated first-line decision; borderline cases go to manual review. */
export async function decideLoan(id: string) {
  const loan = await getLoanOrThrow(id);
  if (loan.status !== 'applied') return loan;
  const s = await scoreApplicant(loan.ownerId, loan.type, loan.amount, loan.termMonths, loan.currency, loan.monthlyIncome);
  const decision = { score: s.score, reasons: s.reasons, by: 'Chancery scoring automaton (demo)' };
  const rate = loanRate(loan.type, loan.currency, s.score);
  const payment = loan.type === 'credit_line' ? Math.round((loan.amount * rate) / 100 / 12) : annuityPayment(loan.amount, rate, loan.termMonths);
  if (s.score >= 70) {
    await db.loans.update(id, { decision, rate, payment });
    return approveLoan(id, true);
  }
  if (s.score >= 50 && !LOAN_PRODUCTS[loan.type].instant) {
    await db.loans.update(id, { status: 'under_review', decision, rate, payment, decidedAt: nowISO() });
    await audit({ action: 'loan.review', object: 'loan', objectId: id, details: `score ${s.score}` });
    await notify(loan.ownerId, { category: 'loans', titleKey: 'n.loan.review.title', bodyKey: 'n.loan.review.body', params: { number: loan.number }, link: `/loans/${id}` });
    return (await db.loans.get(id))!;
  }
  await db.loans.update(id, { decision });
  return rejectLoan(id, s.reasons.join(', '), true);
}

export async function approveLoan(id: string, automated = false) {
  if (!automated) requirePermission('loans.review');
  const loan = await getLoanOrThrow(id);
  if (!['applied', 'under_review'].includes(loan.status)) throw new BankError('INVALID_STATE', { status: loan.status });
  const owner = await db.users.get(loan.ownerId);
  const agreement = await createDocument({
    type: 'loan_agreement', title: loan.type === 'credit_line' ? 'Credit Line Agreement' : 'Loan Agreement', ownerId: loan.ownerId,
    department: 'LND', classification: 'confidential', status: 'issued',
    data: {
      loanId: loan.id, number: loan.number, loanType: loan.type, amount: loan.amount, currency: loan.currency, rate: loan.rate,
      termMonths: loan.termMonths, payment: loan.payment, borrower: owner?.name, clientId: owner?.clientId, purpose: loan.purpose,
      collateral: loan.collateral,
    },
    body: [
      'The Lending Chancery of the Exchequer of Aldermoor (the "Lender") agrees to advance the principal stated herein to the Borrower, who undertakes to repay it with interest in accordance with the attached schedule.',
      'Repayments fall due monthly on the anniversary of disbursement and are debited from the Borrower’s designated account. Late instalments are recorded in the Borrower’s credit history.',
      'The Borrower may repay the outstanding principal early at any time without penalty. This agreement is governed by the Charter of the Commonwealth of Aldermoor.',
    ],
    authorName: 'Lending Chancery', authorId: 'BANK', silent: true,
  });
  if (can('documents.official') || actor().system) {
    try { await signDocument(agreement.id, 'official'); } catch { /* official signature best effort */ }
  }
  await db.loans.update(id, { status: 'approved', decidedAt: nowISO(), agreementDocId: agreement.id });
  await audit({ action: 'loan.approve', object: 'loan', objectId: id, details: automated ? 'automated' : `by ${actor().name}` });
  await notify(loan.ownerId, { category: 'loans', titleKey: 'n.loan.approved.title', bodyKey: 'n.loan.approved.body', params: { number: loan.number, amt: loan.amount, ccy: loan.currency }, link: `/loans/${id}`, priority: 'high' });
  await sendMail(loan.ownerId, 'loan_approved', { number: loan.number, amt: loan.amount, ccy: loan.currency, rate: loan.rate }, agreement.id);
  return (await db.loans.get(id))!;
}

export async function rejectLoan(id: string, reason: string, automated = false) {
  if (!automated) requirePermission('loans.review');
  const loan = await getLoanOrThrow(id);
  if (!['applied', 'under_review', 'approved'].includes(loan.status)) throw new BankError('INVALID_STATE', { status: loan.status });
  await db.loans.update(id, { status: 'rejected', decidedAt: nowISO() });
  await audit({ action: 'loan.reject', object: 'loan', objectId: id, details: reason });
  await notify(loan.ownerId, { category: 'loans', titleKey: 'n.loan.rejected.title', bodyKey: 'n.loan.rejected.body', params: { number: loan.number }, link: `/loans/${id}` });
  await sendMail(loan.ownerId, 'loan_rejected', { number: loan.number, reason });
  return (await db.loans.get(id))!;
}

/** Borrower signs the agreement electronically; funds are disbursed. */
export async function acceptAndDisburse(id: string) {
  const loan = await getLoanOrThrow(id);
  if (loan.status !== 'approved') throw new BankError('INVALID_STATE', { status: loan.status });
  if (loan.ownerId !== actor().userId && !actor().system) throw new BankError('PERMISSION_DENIED');
  if (loan.agreementDocId) await signDocument(loan.agreementDocId, 'electronic');
  const payout = await getAccountOrThrow(loan.payoutAccountId);
  const loanAcc = await openAccount({ ownerId: loan.ownerId, type: loan.type === 'credit_line' ? 'credit' : 'loan', currency: loan.currency, name: `${loan.number} · ${loan.type}`, hidden: loan.type !== 'credit_line', silent: true, overdraftLimit: loan.type === 'credit_line' ? loan.amount : 0 });
  if (loan.type === 'credit_line') {
    await db.loans.update(id, { status: 'active', loanAccountId: loanAcc.id, disbursedAt: nowISO(), outstanding: 0 });
    await audit({ action: 'loan.credit_line_open', object: 'loan', objectId: id });
    return (await db.loans.get(id))!;
  }
  const owner = await db.users.get(loan.ownerId);
  const tx = await execute({
    draft: {
      type: 'loan_disbursement', amount: loan.amount, currency: loan.currency, fromAccountId: loanAcc.id, toAccountId: payout.id,
      sender: { name: 'Lending Chancery', accountNumber: loanAcc.number }, recipient: { name: owner?.name ?? 'Client', accountNumber: payout.number },
      description: `Disbursement of ${loan.number}`, category: 'loans', channel: 'system', refPrefix: 'LND', meta: { loanId: loan.id },
    },
    screen: false,
    plan: () => [{ memo: `Disbursement ${loan.number}`, allowOverdraft: true, lines: [
      { accountId: loanAcc.id, currency: loan.currency, side: 'D', amount: loan.amount },
      { accountId: payout.id, currency: loan.currency, side: 'C', amount: loan.amount },
    ] }],
  });
  const schedule = buildSchedule(loan.amount, loan.rate, loan.termMonths, nowISO());
  await db.loans.update(id, { status: 'active', loanAccountId: loanAcc.id, disbursedAt: nowISO(), schedule, outstanding: loan.amount, payment: schedule[0]?.total ?? loan.payment });
  await audit({ action: 'loan.disburse', object: 'loan', objectId: id, txId: tx.id });
  return (await db.loans.get(id))!;
}

async function repayment(loan: Loan, fromAccountId: string, principal: number, interest: number, label: string, early = false) {
  const from = await getAccountOrThrow(fromAccountId);
  const owner = await db.users.get(loan.ownerId);
  const total = principal + interest;
  const tx = await execute({
    draft: {
      type: 'loan_repayment', amount: total, currency: loan.currency, fromAccountId: from.id, toAccountId: loan.loanAccountId,
      sender: { name: owner?.name ?? 'Client', accountNumber: from.number }, recipient: { name: 'Lending Chancery', accountNumber: loan.number },
      description: label, category: 'loans', channel: 'app', refPrefix: 'LND', meta: { loanId: loan.id, principal, interest },
      partyIds: [loan.ownerId],
    },
    validate: async () => {
      const avail = await availableOf(from.id, loan.currency);
      if (avail < total) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: total, currency: loan.currency });
    },
    screen: false,
    plan: () => [{ memo: label, lines: [
      { accountId: from.id, currency: loan.currency, side: 'D', amount: total },
      ...(principal > 0 ? [{ accountId: loan.loanAccountId!, currency: loan.currency, side: 'C' as const, amount: principal }] : []),
      ...(interest > 0 ? [{ accountId: GL.INT_INC, currency: loan.currency, side: 'C' as const, amount: interest }] : []),
    ] }],
  });
  const fresh = await getLoanOrThrow(loan.id);
  await db.loans.update(loan.id, {
    outstanding: fresh.outstanding - principal,
    repayments: [...fresh.repayments, { at: nowISO(), amount: total, principal, interest, txId: tx.id, early }],
  });
  return tx;
}

export async function payInstallment(id: string, fromAccountId: string) {
  const loan = await getLoanOrThrow(id);
  if (!['active', 'overdue'].includes(loan.status)) throw new BankError('INVALID_STATE', { status: loan.status });
  if (loan.ownerId !== actor().userId && !actor().system) throw new BankError('PERMISSION_DENIED');
  const inst = loan.schedule.find((i) => i.status !== 'paid');
  if (!inst) throw new BankError('INVALID_STATE', { reason: 'nothing due' });
  const remaining = inst.total - inst.paid;
  const principalPart = Math.max(0, inst.principal - Math.max(0, inst.paid - inst.interest));
  const interestPart = remaining - principalPart;
  const tx = await repayment(loan, fromAccountId, principalPart, interestPart, `Instalment ${inst.n}/${loan.termMonths} of ${loan.number}`);
  const fresh = await getLoanOrThrow(id);
  const schedule = fresh.schedule.map((i) => (i.n === inst.n ? { ...i, paid: i.total, status: 'paid' as const, paidAt: nowISO() } : i));
  const nextIdx = schedule.findIndex((i) => i.status !== 'paid');
  if (nextIdx >= 0 && schedule[nextIdx].status === 'upcoming') schedule[nextIdx] = { ...schedule[nextIdx], status: 'due' };
  const stillOverdue = schedule.some((i) => i.status === 'overdue');
  const closed = nextIdx < 0;
  await db.loans.update(id, { schedule, status: closed ? 'closed' : stillOverdue ? 'overdue' : 'active', closedAt: closed ? nowISO() : undefined });
  if (closed) await onLoanClosed(id);
  return tx;
}

export async function payOffEarly(id: string, fromAccountId: string) {
  const loan = await getLoanOrThrow(id);
  if (!['active', 'overdue'].includes(loan.status) || loan.type === 'credit_line') throw new BankError('INVALID_STATE', { status: loan.status });
  if (loan.ownerId !== actor().userId && !actor().system) throw new BankError('PERMISSION_DENIED');
  const inst = loan.schedule.find((i) => i.status !== 'paid');
  const interest = inst ? Math.max(0, inst.interest - inst.paid) : 0;
  const tx = await repayment(loan, fromAccountId, loan.outstanding, interest, `Early repayment of ${loan.number}`, true);
  const fresh = await getLoanOrThrow(id);
  await db.loans.update(id, {
    status: 'closed', closedAt: nowISO(), outstanding: 0,
    schedule: fresh.schedule.map((i) => (i.status === 'paid' ? i : { ...i, status: 'paid' as const, paid: i.total, paidAt: nowISO() })),
  });
  await onLoanClosed(id);
  return tx;
}

async function onLoanClosed(id: string) {
  const loan = await getLoanOrThrow(id);
  if (loan.loanAccountId) await db.accounts.update(loan.loanAccountId, { status: 'closed', closedAt: nowISO() });
  await db.archive.add({
    id: uid('ARR'), code: archiveCode('LND'), kind: 'contract', title: `Discharged loan ${loan.number}`,
    summary: `${loan.type} loan of ${loan.amount / 100} ${loan.currency} repaid in full on ${nowISO().slice(0, 10)}.`, createdAt: nowISO(),
    ownerId: loan.ownerId, department: 'LND', classification: 'confidential', refs: { docId: loan.agreementDocId, loanId: loan.id },
    tags: ['loan', loan.type, 'closed'], shelf: shelfMark(), status: 'filed',
  });
  await audit({ action: 'loan.close', object: 'loan', objectId: id });
  await notify(loan.ownerId, { category: 'loans', titleKey: 'n.loan.closed.title', bodyKey: 'n.loan.closed.body', params: { number: loan.number }, link: `/loans/${id}` });
  await sendMail(loan.ownerId, 'loan_closed', { number: loan.number }, loan.agreementDocId);
}

/* ── Credit lines ── */

export async function drawCreditLine(id: string, toAccountId: string, amount: number) {
  const loan = await getLoanOrThrow(id);
  if (loan.type !== 'credit_line' || loan.status !== 'active' || !loan.loanAccountId) throw new BankError('INVALID_STATE');
  const line = await getAccountOrThrow(loan.loanAccountId);
  const to = await getAccountOrThrow(toAccountId);
  if (!canOperate(to)) throw new BankError('PERMISSION_DENIED');
  const owner = await db.users.get(loan.ownerId);
  const tx = await execute({
    draft: {
      type: 'loan_disbursement', amount, currency: loan.currency, fromAccountId: line.id, toAccountId: to.id,
      sender: { name: `Credit line ${loan.number}`, accountNumber: line.number }, recipient: { name: owner?.name ?? 'Client', accountNumber: to.number },
      description: `Draw on credit line ${loan.number}`, category: 'loans', channel: 'app', refPrefix: 'LND', meta: { loanId: loan.id },
    },
    validate: async () => {
      const avail = await availableOf(line.id, loan.currency);
      if (avail < amount) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: amount, currency: loan.currency });
    },
    screen: false,
    plan: () => [{ memo: `Draw ${loan.number}`, lines: [
      { accountId: line.id, currency: loan.currency, side: 'D', amount },
      { accountId: to.id, currency: loan.currency, side: 'C', amount },
    ] }],
  });
  await db.loans.update(id, { outstanding: -(await balanceOf(line.id, loan.currency)) });
  return tx;
}

export async function repayCreditLine(id: string, fromAccountId: string, amount: number) {
  const loan = await getLoanOrThrow(id);
  if (loan.type !== 'credit_line' || !loan.loanAccountId) throw new BankError('INVALID_STATE');
  const drawn = -(await balanceOf(loan.loanAccountId, loan.currency));
  const pay = Math.min(amount, drawn);
  if (pay <= 0) throw new BankError('INVALID_AMOUNT');
  const from = await getAccountOrThrow(fromAccountId);
  const owner = await db.users.get(loan.ownerId);
  const tx = await execute({
    draft: {
      type: 'loan_repayment', amount: pay, currency: loan.currency, fromAccountId: from.id, toAccountId: loan.loanAccountId,
      sender: { name: owner?.name ?? 'Client', accountNumber: from.number }, recipient: { name: `Credit line ${loan.number}` },
      description: `Repayment of credit line ${loan.number}`, category: 'loans', channel: 'app', refPrefix: 'LND', meta: { loanId: loan.id },
    },
    validate: async () => {
      const avail = await availableOf(from.id, loan.currency);
      if (avail < pay) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: pay, currency: loan.currency });
    },
    screen: false,
    plan: () => [{ memo: `Repay ${loan.number}`, lines: [
      { accountId: from.id, currency: loan.currency, side: 'D', amount: pay },
      { accountId: loan.loanAccountId!, currency: loan.currency, side: 'C', amount: pay },
    ] }],
  });
  await db.loans.update(id, { outstanding: -(await balanceOf(loan.loanAccountId, loan.currency)), repayments: [...loan.repayments, { at: nowISO(), amount: pay, principal: pay, interest: 0, txId: tx.id }] });
  return tx;
}

/** End-of-day: auto-debit due instalments; mark overdue; charge credit-line interest monthly. */
export async function processLoanDues(dayKey: string) {
  const loans = await db.loans.where('status').anyOf('active', 'overdue').toArray();
  for (const loan of loans) {
    if (loan.type === 'credit_line') {
      if (loan.disbursedAt && dayKey.slice(8) === loan.disbursedAt.slice(8, 10) && loan.loanAccountId) {
        const drawn = -(await balanceOf(loan.loanAccountId, loan.currency));
        const interest = Math.round((drawn * loan.rate) / 100 / 12);
        if (interest > 0) {
          await execute({
            draft: { type: 'interest', amount: interest, currency: loan.currency, fromAccountId: loan.loanAccountId, sender: { name: `Credit line ${loan.number}` }, recipient: { name: 'Lending Chancery' }, description: `Monthly interest on ${loan.number}`, category: 'loans', channel: 'system', refPrefix: 'INT', partyIds: [loan.ownerId] },
            screen: false, receipt: false,
            plan: () => [{ memo: 'Credit line interest', allowOverdraft: true, lines: [{ accountId: loan.loanAccountId!, currency: loan.currency, side: 'D', amount: interest }, { accountId: GL.INT_INC, currency: loan.currency, side: 'C', amount: interest }] }],
          });
        }
      }
      continue;
    }
    for (const inst of loan.schedule) {
      if (inst.status === 'paid' || inst.dueDate > dayKey) continue;
      try {
        await payInstallment(loan.id, loan.payoutAccountId);
      } catch {
        const fresh = await getLoanOrThrow(loan.id);
        if (fresh.schedule.find((i) => i.n === inst.n)?.status !== 'overdue') {
          await db.loans.update(loan.id, {
            status: 'overdue',
            latePayments: fresh.latePayments + 1,
            schedule: fresh.schedule.map((i) => (i.n === inst.n ? { ...i, status: 'overdue' as const } : i)),
          });
          await audit({ action: 'loan.overdue', object: 'loan', objectId: loan.id, result: 'failure', details: `instalment ${inst.n}` });
          await notify(loan.ownerId, { category: 'loans', titleKey: 'n.loan.overdue.title', bodyKey: 'n.loan.overdue.body', params: { number: loan.number, n: inst.n, amt: inst.total, ccy: loan.currency }, link: `/loans/${loan.id}`, priority: 'high' });
        }
      }
      break;
    }
  }
}

export function nextInstallment(loan: Loan) {
  return loan.schedule.find((i) => i.status !== 'paid');
}

export function isDue(i: LoanInstallment) {
  return i.dueDate <= todayKey();
}
