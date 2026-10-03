/**
 * Check system: Create → Sign → Stamp → Issue → Present → Process → Pay
 * (or Cancel / Reject / Expire). Personal checks are paid from the issuer's
 * account at presentment; cashier's checks are pre-funded into the
 * "Cashier's Checks Outstanding" GL account at issue.
 */
import { db, nextCounter } from '../db/db';
import { BankError } from '../errors';
import { nowISO, addDays } from '../clock';
import { uid, verificationCode } from '../util/random';
import { actor } from '../context';
import { can } from '../security/permissions';
import { usdTo } from '../currency/rates';
import { execute } from './engine';
import { availableOf } from './ledger';
import { canOperate, getAccountOrThrow, GL } from './accounts';
import { createDocument, saveDocumentVersion, signDocument, signatureState, element } from '../docs/documents';
import { sealById } from '../docs/seals';
import { audit } from '../ops/audit';
import { notify, sendMail } from '../comms/notify';
import { getSettings } from '../settings';
import type { Check, SignatureKind, TimelineKey } from '../types';

async function step(check: Check, s: TimelineKey, ok = true, note?: string, patch: Partial<Check> = {}) {
  await db.checks.update(check.id, { ...patch, timeline: [...check.timeline, { step: s, at: nowISO(), ok, note, actor: actor().name }] });
}

export async function getCheckOrThrow(id: string) {
  const c = await db.checks.get(id);
  if (!c) throw new BankError('NOT_FOUND', { object: 'check' });
  return c;
}

export async function createCheck(input: { accountId: string; payeeName: string; payeeClientId?: string; amount: number; purpose: string; kind?: Check['kind']; date?: string; validityDays?: number }) {
  const acc = await getAccountOrThrow(input.accountId);
  if (!canOperate(acc)) throw new BankError('PERMISSION_DENIED');
  if (!(input.amount > 0)) throw new BankError('INVALID_AMOUNT');
  if (!input.payeeName.trim()) throw new BankError('INVALID_RECIPIENT', { field: 'payee' });
  let payeeId: string | undefined;
  if (input.payeeClientId?.trim()) {
    const u = await db.users.where('clientId').equals(input.payeeClientId.trim().toUpperCase()).first();
    if (!u) throw new BankError('INVALID_RECIPIENT', { clientId: input.payeeClientId });
    payeeId = u.id;
  }
  const issuer = await db.users.get(acc.ownerId);
  const n = await nextCounter('check-number', 400100);
  const kind = input.kind ?? 'personal';
  if (kind === 'cashier' && !can('teller.desk') && !actor().system) {
    // clients may request a cashier's check; it is issued by the bank with an official signature later
  }
  const at = nowISO();
  const check: Check = {
    id: uid('CHQ'),
    number: String(n).padStart(8, '0'),
    kind,
    issuerId: acc.ownerId,
    issuerName: issuer?.name ?? 'Client',
    accountId: acc.id,
    payeeName: input.payeeName.trim(),
    payeeId,
    amount: input.amount,
    currency: acc.currency,
    date: input.date ?? at,
    purpose: input.purpose,
    status: 'draft',
    seals: [],
    verificationCode: verificationCode(),
    createdAt: at,
    expiresAt: addDays(at, input.validityDays ?? getSettings().checkValidityDays).toISOString(),
    timeline: [{ step: 'created', at, ok: true, actor: actor().name }],
  };
  const doc = await createDocument({
    type: 'check', title: kind === 'cashier' ? "Cashier's Check" : 'Bank Check', ownerId: acc.ownerId,
    partyIds: payeeId ? [payeeId] : [], status: 'draft', classification: 'confidential', department: 'PAY',
    data: { checkId: check.id, number: check.number, kind, amount: check.amount, currency: check.currency, payee: check.payeeName, issuer: check.issuerName, accountNumber: acc.number, purpose: check.purpose, date: check.date },
    links: { accountIds: [acc.id] }, elements: [], expiresAt: check.expiresAt, silent: true,
  });
  check.documentId = doc.id;
  // check documents share the check's verification code so either can be verified
  await db.documents.update(doc.id, { verificationCode: check.verificationCode });
  await db.checks.add(check);
  await audit({ action: 'check.create', object: 'check', objectId: check.id, details: `${check.number} ${check.amount} ${check.currency}` });
  return check;
}

export async function signCheck(id: string, kind: SignatureKind, strokes?: string) {
  const c = await getCheckOrThrow(id);
  if (c.status !== 'draft') throw new BankError('INVALID_STATE', { status: c.status });
  if (c.issuerId !== actor().userId && !can('teller.desk') && !actor().system) throw new BankError('PERMISSION_DENIED');
  if (c.kind === 'cashier' && kind !== 'official') throw new BankError('PERMISSION_DENIED', { reason: 'official signature required' });
  const doc = await signDocument(c.documentId!, kind, { strokes, place: { x: 62, y: 64, w: 28 } });
  const sig = doc.signatures[doc.signatures.length - 1];
  await step(c, 'approved', true, `signed:${kind}`, { signature: sig });
  return sig;
}

export async function stampCheck(id: string, sealId: string) {
  const c = await getCheckOrThrow(id);
  const seal = sealById(sealId);
  if (!seal) throw new BankError('NOT_FOUND', { object: 'seal' });
  if (seal.official && !can('documents.official')) throw new BankError('PERMISSION_DENIED', { reason: 'official seal' });
  const doc = await db.documents.get(c.documentId!);
  if (!doc) throw new BankError('NOT_FOUND');
  const el = element('seal', 40 + Math.random() * 10, 50 + Math.random() * 10, seal.shape === 'rect' ? 16 : 17, { sealId, ink: seal.ink, intensity: 0.85, date: nowISO().slice(0, 10) }, -14 + Math.random() * 28, 0.85);
  await saveDocumentVersion(doc.id, { elements: [...doc.elements, el] }, `Seal ${sealId}`);
  await db.checks.update(id, { seals: [...c.seals, sealId] });
  await audit({ action: 'check.stamp', object: 'check', objectId: id, details: sealId });
}

export async function issueCheck(id: string) {
  const c = await getCheckOrThrow(id);
  if (c.status !== 'draft') throw new BankError('INVALID_STATE', { status: c.status });
  if (!c.signature) throw new BankError('VERIFICATION_FAILED', { reason: 'unsigned' });
  const acc = await getAccountOrThrow(c.accountId);
  if (acc.status !== 'active') throw new BankError('ACCOUNT_FROZEN', { account: acc.number });
  let txId: string | undefined;
  if (c.kind === 'cashier') {
    const fee = usdTo(getSettings().cashierCheckFeeUSD, c.currency);
    const tx = await execute({
      draft: {
        type: 'check', amount: c.amount, currency: c.currency, fee, fromAccountId: acc.id, sender: { name: c.issuerName, accountNumber: acc.number },
        recipient: { name: `Cashier's check ${c.number} → ${c.payeeName}` }, description: `Funding of cashier's check ${c.number}`,
        category: 'transfers', channel: 'branch', refPrefix: 'CHQ', meta: { checkId: c.id },
      },
      validate: async () => {
        const avail = await availableOf(acc.id, c.currency);
        if (avail < c.amount + fee) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: c.amount + fee, currency: c.currency });
      },
      screen: false,
      plan: () => [{ memo: `Cashier's check ${c.number}`, lines: [
        { accountId: acc.id, currency: c.currency, side: 'D', amount: c.amount },
        { accountId: GL.CHECKS, currency: c.currency, side: 'C', amount: c.amount },
        ...(fee ? [{ accountId: acc.id, currency: c.currency, side: 'D' as const, amount: fee }, { accountId: GL.FEES, currency: c.currency, side: 'C' as const, amount: fee }] : []),
      ] }],
    });
    txId = tx.id;
  }
  const fresh = await getCheckOrThrow(id);
  await step(fresh, 'submitted', true, 'issued', { status: 'issued', issuedAt: nowISO(), txId });
  await db.documents.update(c.documentId!, { status: 'issued' });
  await audit({ action: 'check.issue', object: 'check', objectId: id, details: c.number });
  if (c.payeeId) {
    await notify(c.payeeId, { category: 'payments', titleKey: 'n.check.received.title', bodyKey: 'n.check.received.body', params: { name: c.issuerName, amt: c.amount, ccy: c.currency, number: c.number, code: c.verificationCode }, link: '/checks?tab=received' });
  }
}

export async function cancelCheck(id: string, reason = 'cancelled by issuer') {
  const c = await getCheckOrThrow(id);
  if (!['draft', 'issued'].includes(c.status)) throw new BankError('INVALID_STATE', { status: c.status });
  if (c.issuerId !== actor().userId && !can('teller.desk') && !actor().system) throw new BankError('PERMISSION_DENIED');
  if (c.kind === 'cashier' && c.status === 'issued') {
    await execute({
      draft: {
        type: 'refund', amount: c.amount, currency: c.currency, toAccountId: c.accountId, sender: { name: "Cashier's Checks Outstanding" },
        recipient: { name: c.issuerName }, description: `Cancellation of cashier's check ${c.number}`, category: 'transfers', channel: 'system', refPrefix: 'CHQ',
        partyIds: [c.issuerId],
      },
      screen: false,
      plan: () => [{ memo: `Cancel check ${c.number}`, allowOverdraft: true, lines: [
        { accountId: GL.CHECKS, currency: c.currency, side: 'D', amount: c.amount },
        { accountId: c.accountId, currency: c.currency, side: 'C', amount: c.amount },
      ] }],
    });
  }
  await step(c, 'cancelled', false, reason, { status: 'cancelled' });
  await db.documents.update(c.documentId!, { status: 'cancelled' });
  await audit({ action: 'check.cancel', object: 'check', objectId: id, details: reason });
}

export async function findCheckByNumber(number: string) {
  return db.checks.where('number').equals(number.trim().padStart(8, '0')).first();
}

/** Payee presents a check for deposit; the bank processes and pays or rejects it. */
export async function presentCheck(number: string, code: string, depositAccountId: string) {
  const c = await findCheckByNumber(number);
  if (!c) throw new BankError('NOT_FOUND', { object: 'check', number });
  const norm = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (norm(c.verificationCode) !== norm(code)) {
    await audit({ action: 'check.present', object: 'check', objectId: c.id, result: 'failure', details: 'verification code mismatch' });
    throw new BankError('VERIFICATION_FAILED', { object: 'check' });
  }
  if (c.status === 'expired' || c.expiresAt < nowISO()) {
    if (c.status === 'issued') await step(c, 'expired', false, undefined, { status: 'expired' });
    throw new BankError('DOCUMENT_EXPIRED', { number: c.number });
  }
  if (c.status !== 'issued') throw new BankError('INVALID_STATE', { status: c.status });
  const dep = await getAccountOrThrow(depositAccountId);
  if (!canOperate(dep)) throw new BankError('PERMISSION_DENIED');
  await step(c, 'review', true, 'presented', { status: 'presented', presentedAt: nowISO(), depositAccountId: dep.id, payeeId: c.payeeId ?? dep.ownerId });
  return processCheck(c.id);
}

export async function processCheck(id: string) {
  let c = await getCheckOrThrow(id);
  if (c.status !== 'presented') throw new BankError('INVALID_STATE', { status: c.status });
  await step(c, 'processing', true, undefined, { status: 'processing' });
  c = await getCheckOrThrow(id);
  const doc = await db.documents.get(c.documentId!);
  const sig = doc ? await signatureState(doc) : { state: 'unsigned' as const };
  const issuerAcc = await getAccountOrThrow(c.accountId);
  const dep = await getAccountOrThrow(c.depositAccountId!);
  const reject = async (reason: string, bounce: boolean) => {
    await step(c, 'rejected', false, reason, { status: 'rejected', rejectReason: reason });
    await db.documents.update(c.documentId!, { status: 'cancelled' });
    if (bounce && c.kind === 'personal') {
      const fee = usdTo(getSettings().bounceFeeUSD, c.currency);
      try {
        await execute({
          draft: { type: 'fee', amount: fee, currency: c.currency, fromAccountId: issuerAcc.id, sender: { name: c.issuerName, accountNumber: issuerAcc.number }, recipient: { name: 'Exchequer of Aldermoor' }, description: `Returned check fee ${c.number}`, category: 'fees', channel: 'system', refPrefix: 'FEE', partyIds: [c.issuerId] },
          screen: false, receipt: false,
          plan: () => [{ memo: 'Returned check fee', allowOverdraft: true, lines: [{ accountId: issuerAcc.id, currency: c.currency, side: 'D', amount: fee }, { accountId: GL.FEES, currency: c.currency, side: 'C', amount: fee }] }],
        });
      } catch {
        /* fee best-effort */
      }
    }
    await audit({ action: 'check.reject', object: 'check', objectId: id, result: 'failure', details: reason });
    for (const u of [c.issuerId, c.payeeId].filter(Boolean) as string[]) {
      await sendMail(u, 'check_rejected', { number: c.number, reason, amt: c.amount, ccy: c.currency }, c.documentId);
      await notify(u, { category: 'payments', titleKey: 'n.check.rejected.title', bodyKey: 'n.check.rejected.body', params: { number: c.number, reason }, link: `/checks/${id}`, priority: 'high' });
    }
    throw new BankError(reason === 'insufficient_funds' ? 'INSUFFICIENT_FUNDS' : 'VERIFICATION_FAILED', { reason, check: c.number });
  };
  if (sig.state !== 'verified') return reject(sig.state === 'unsigned' ? 'unsigned' : 'signature_invalid', false);
  if (c.kind === 'personal') {
    if (issuerAcc.status !== 'active') return reject('account_frozen', false);
    const avail = await availableOf(issuerAcc.id, c.currency);
    if (avail < c.amount) return reject('insufficient_funds', true);
  }
  const payee = await db.users.get(dep.ownerId);
  const tx = await execute({
    draft: {
      type: 'check', amount: c.amount, currency: c.currency, fromAccountId: c.kind === 'personal' ? issuerAcc.id : undefined, toAccountId: dep.id,
      sender: { name: c.issuerName, accountNumber: issuerAcc.number }, recipient: { name: payee?.name ?? c.payeeName, accountNumber: dep.number },
      description: `Check № ${c.number} — ${c.purpose}`, category: 'transfers', channel: 'branch', refPrefix: 'CHQ',
      partyIds: [c.issuerId, dep.ownerId], meta: { checkId: c.id },
      creditCurrency: dep.pockets.includes(c.currency) || dep.multiCurrency ? c.currency : dep.currency,
    },
    screen: false,
    plan: () => {
      const src = c.kind === 'personal' ? issuerAcc.id : GL.CHECKS;
      return [{ memo: `Check ${c.number}`, allowOverdraft: c.kind !== 'personal', lines: [
        { accountId: src, currency: c.currency, side: 'D', amount: c.amount },
        { accountId: dep.id, currency: c.currency, side: 'C', amount: c.amount },
      ] }];
    },
  });
  c = await getCheckOrThrow(id);
  await step(c, 'completed', true, undefined, { status: 'paid', paidAt: nowISO(), txId: tx.id });
  if (doc) {
    const paidSeal = element('seal', 30, 38, 18, { sealId: 'paid', ink: 'crimson', intensity: 0.9, date: nowISO().slice(0, 10) }, -14, 0.88);
    await db.documents.update(doc.id, { elements: [...(await db.documents.get(doc.id))!.elements, paidSeal] });
  }
  await audit({ action: 'check.pay', object: 'check', objectId: id, txId: tx.id, details: c.number });
  await sendMail(c.issuerId, 'check_paid', { number: c.number, amt: c.amount, ccy: c.currency, name: c.payeeName }, c.documentId);
  return tx;
}

export async function expireChecks() {
  const now = nowISO();
  const due = (await db.checks.where('status').equals('issued').toArray()).filter((c) => c.expiresAt < now);
  for (const c of due) {
    await step(c, 'expired', false, 'validity elapsed', { status: 'expired' });
    await db.documents.update(c.documentId!, { status: 'expired' });
  }
  return due.length;
}
