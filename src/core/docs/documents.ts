/**
 * Document Center core: creation, versioning, signatures (ECDSA P-256 via
 * WebCrypto), seals, verification and lifecycle of every official paper.
 */
import { db, inTx } from '../db/db';
import { nowISO } from '../clock';
import { uid, verificationCode } from '../util/random';
import { canonical, sha256 } from '../util/sha256';
import { generateSigningKeys, signText, verifyText } from '../util/crypto';
import { archiveCode, docNumber, registryNumber } from '../banking/numbers';
import { actor } from '../context';
import { BankError } from '../errors';
import { audit } from '../ops/audit';
import { can } from '../security/permissions';
import { sealById } from './seals';
import type {
  BankDocument, Classification, DocElement, DocSignature, DocType, DocVersion, SignatureKind, Transaction,
} from '../types';

export const DOC_PREFIX: Record<DocType, string> = {
  statement: 'STM', receipt: 'RCP', invoice: 'INV', check: 'CHK', contract: 'CTR', certificate: 'CRT',
  application: 'APP', payment_order: 'PO', deposit_certificate: 'DCR', loan_agreement: 'LAG', notice: 'NTC',
  authorization: 'AUT', memo: 'MEM', archive_record: 'ARR', policy: 'POL', tax: 'TAX', letter: 'LTR',
};

export const DOC_DEPARTMENT: Record<DocType, string> = {
  statement: 'ARC', receipt: 'PAY', invoice: 'PAY', check: 'PAY', contract: 'LND', certificate: 'ADM',
  application: 'CSV', payment_order: 'PAY', deposit_certificate: 'DEP', loan_agreement: 'LND', notice: 'ADM',
  authorization: 'SEC', memo: 'ADM', archive_record: 'ARC', policy: 'TRS', tax: 'TRS', letter: 'CSV',
};

export const BANK_OFFICIAL_KEY = 'BANK-OFFICIAL';

export interface CreateDocInput {
  type: DocType;
  title: string;
  ownerId: string;
  partyIds?: string[];
  data?: Record<string, unknown>;
  body?: string[];
  classification?: Classification;
  department?: string;
  links?: Partial<BankDocument['links']>;
  status?: BankDocument['status'];
  expiresAt?: string;
  caseNo?: string;
  elements?: DocElement[];
  authorName?: string;
  authorId?: string;
  silent?: boolean;
}

export function element(kind: DocElement['kind'], x: number, y: number, w: number, props: DocElement['props'] = {}, rotation = 0, opacity = 0.92): DocElement {
  return { id: uid('EL', 8), kind, x, y, w, rotation, opacity, z: 10, props };
}

export function defaultElements(type: DocType): DocElement[] {
  const els: DocElement[] = [element('qr', 6, 84, 11, { payload: 'verify' }, 0, 1)];
  const seal = (id: string, x: number, y: number, w = 18, rot = -8) => element('seal', x, y, w, { sealId: id, ink: sealById(id)?.ink ?? 'royal', intensity: 0.85 }, rot, 0.88);
  switch (type) {
    case 'receipt':
      els.push(seal('payment_department', 70, 70), seal('processed', 46, 76, 16, 6));
      break;
    case 'statement':
      els.push(seal('archive_department', 72, 78));
      break;
    case 'deposit_certificate':
      els.push(seal('deposits_office', 70, 72, 20), seal('certified', 44, 80, 16, -4), element('seal', 82, 8, 9, { sealId: 'wax_gold', ink: 'brass', intensity: 1 }, 0, 1));
      break;
    case 'loan_agreement':
    case 'contract':
      els.push(seal('lending_chancery', 72, 76, 18));
      break;
    case 'certificate':
      els.push(seal('official_bank_seal', 70, 72, 20), element('seal', 82, 8, 9, { sealId: 'wax_crimson', ink: 'crimson', intensity: 1 }, 0, 1));
      break;
    case 'policy':
      els.push(seal('treasury', 72, 76));
      break;
    case 'tax':
      els.push(seal('treasury', 72, 76), seal('received', 46, 80, 15, 5));
      break;
    case 'invoice':
      els.push(seal('payment_department', 74, 78, 16));
      break;
    default:
      break;
  }
  return els;
}

export async function createDocument(input: CreateDocInput): Promise<BankDocument> {
  const a = actor();
  const at = nowISO();
  const doc: BankDocument = {
    id: uid('DOC', 10),
    number: await docNumber(DOC_PREFIX[input.type]),
    type: input.type,
    title: input.title,
    version: 1,
    status: input.status ?? 'issued',
    createdAt: at,
    updatedAt: at,
    authorId: input.authorId ?? a.userId,
    authorName: input.authorName ?? a.name,
    ownerId: input.ownerId,
    partyIds: [...new Set([input.ownerId, ...(input.partyIds ?? [])])],
    classification: input.classification ?? 'confidential',
    department: input.department ?? DOC_DEPARTMENT[input.type],
    registryNo: await registryNumber(),
    caseNo: input.caseNo,
    archiveCode: archiveCode(input.department ?? DOC_DEPARTMENT[input.type]),
    verificationCode: verificationCode(),
    data: input.data ?? {},
    body: input.body ?? [],
    elements: input.elements ?? defaultElements(input.type),
    signatures: [],
    links: { txIds: [], accountIds: [], docIds: [], ...input.links },
    expiresAt: input.expiresAt,
    notes: [],
  };
  await inTx([db.documents, db.docVersions], async () => {
    await db.documents.add(doc);
    await db.docVersions.add(snapshotOf(doc, 'Created'));
  });
  if (!input.silent) {
    await audit({ action: 'document.create', object: 'document', objectId: doc.id, details: `${doc.number} ${doc.type}` });
  }
  return doc;
}

function snapshotOf(doc: BankDocument, note: string): DocVersion {
  const { id, ...rest } = doc;
  const a = actor();
  return {
    id: uid('DV', 10),
    docId: id,
    version: doc.version,
    at: doc.updatedAt,
    authorId: a.userId,
    authorName: a.name,
    note,
    snapshot: JSON.parse(JSON.stringify(rest)),
  };
}

export function contentHash(doc: Pick<BankDocument, 'type' | 'number' | 'title' | 'data' | 'body' | 'elements'>): string {
  const textEls = doc.elements
    .filter((e) => e.kind === 'text' || e.kind === 'date' || e.kind === 'docnumber')
    .map((e) => ({ k: e.kind, t: e.props.text ?? '' }));
  return sha256(canonical({ type: doc.type, number: doc.number, title: doc.title, data: doc.data, body: doc.body, text: textEls }));
}

function canEdit(doc: BankDocument) {
  const a = actor();
  return a.system || doc.ownerId === a.userId || doc.authorId === a.userId || can('documents.official');
}

export async function getDocumentOrThrow(id: string) {
  const doc = await db.documents.get(id);
  if (!doc) throw new BankError('NOT_FOUND', { object: 'document', id });
  return doc;
}

/** Save an edited document as a new version. */
export async function saveDocumentVersion(
  id: string,
  patch: Partial<Pick<BankDocument, 'title' | 'body' | 'elements' | 'data' | 'classification' | 'expiresAt'>>,
  note: string,
): Promise<BankDocument> {
  const doc = await getDocumentOrThrow(id);
  if (!canEdit(doc)) throw new BankError('PERMISSION_DENIED', { object: 'document' });
  if (doc.status === 'cancelled') throw new BankError('INVALID_STATE', { status: doc.status });
  const next: BankDocument = { ...doc, ...patch, version: doc.version + 1, updatedAt: nowISO() };
  await inTx([db.documents, db.docVersions], async () => {
    await db.documents.put(next);
    await db.docVersions.add(snapshotOf(next, note || `Version ${next.version}`));
  });
  await audit({ action: 'document.version', object: 'document', objectId: id, details: `v${next.version}: ${note}` });
  return next;
}

export async function restoreDocumentVersion(id: string, version: number) {
  const v = await db.docVersions.where('[docId+version]').equals([id, version]).first();
  if (!v) throw new BankError('NOT_FOUND', { object: 'version' });
  const { title, body, elements, data, classification } = v.snapshot;
  return saveDocumentVersion(id, { title, body, elements, data, classification }, `Restored from v${version}`);
}

async function keysFor(ownerId: string) {
  let k = await db.keys.get(ownerId);
  if (!k) {
    const pair = await generateSigningKeys();
    k = { ownerId, ...pair, createdAt: nowISO() };
    await db.keys.put(k);
  }
  return k;
}

export async function signDocument(
  id: string,
  kind: SignatureKind,
  opts: { strokes?: string; place?: { x: number; y: number; w: number } } = {},
): Promise<BankDocument> {
  const a = actor();
  const doc = await getDocumentOrThrow(id);
  if (doc.status === 'cancelled' || doc.status === 'expired') throw new BankError('DOCUMENT_EXPIRED', { status: doc.status });
  if (kind === 'official' && !can('documents.official')) throw new BankError('PERMISSION_DENIED', { action: 'official signature' });
  if (kind !== 'official' && !canEdit(doc) && !doc.partyIds.includes(a.userId)) {
    throw new BankError('PERMISSION_DENIED', { object: 'document' });
  }
  if (kind === 'handwritten' && !opts.strokes) throw new BankError('VALIDATION', { field: 'signature' });
  const hash = contentHash(doc);
  const keyOwner = kind === 'official' ? BANK_OFFICIAL_KEY : a.userId;
  const keys = await keysFor(keyOwner);
  const sig: DocSignature = {
    id: uid('SIG', 10),
    kind,
    signerId: a.userId,
    signerName: a.name,
    signerRole: kind === 'official' ? 'Officer of the Exchequer' : undefined,
    at: nowISO(),
    contentHash: hash,
    signature: await signText(keys.privateKey, `${doc.id}|${hash}|${kind}|${a.userId}`),
    publicKey: keys.publicKey,
    strokes: opts.strokes,
  };
  const place = opts.place ?? { x: 8 + doc.signatures.length * 30, y: 68, w: 26 };
  const sigEl = element('signature', place.x, place.y, place.w, { signatureId: sig.id }, 0, 1);
  const next: BankDocument = {
    ...doc,
    signatures: [...doc.signatures, sig],
    elements: [...doc.elements, sigEl],
    status: doc.status === 'draft' || doc.status === 'issued' ? 'signed' : doc.status,
    version: doc.version + 1,
    updatedAt: nowISO(),
  };
  await inTx([db.documents, db.docVersions], async () => {
    await db.documents.put(next);
    await db.docVersions.add(snapshotOf(next, `Signed (${kind}) by ${a.name}`));
  });
  await audit({ action: `document.sign.${kind}`, object: 'document', objectId: id, details: doc.number });
  return next;
}

export type SignatureState = 'unsigned' | 'verified' | 'invalid';

export async function verifySignature(doc: BankDocument, sig: DocSignature): Promise<boolean> {
  if (!sig.signature || !sig.publicKey) return false;
  if (contentHash(doc) !== sig.contentHash) return false;
  return verifyText(sig.publicKey, `${doc.id}|${sig.contentHash}|${sig.kind}|${sig.signerId}`, sig.signature);
}

export async function signatureState(doc: BankDocument): Promise<{ state: SignatureState; results: Record<string, boolean> }> {
  if (!doc.signatures.length) return { state: 'unsigned', results: {} };
  const results: Record<string, boolean> = {};
  for (const s of doc.signatures) results[s.id] = await verifySignature(doc, s);
  return { state: Object.values(results).every(Boolean) ? 'verified' : 'invalid', results };
}

export type Validity = 'valid' | 'expired' | 'cancelled' | 'draft' | 'archived';

export function validityOf(doc: BankDocument, atISO = nowISO()): Validity {
  if (doc.status === 'cancelled') return 'cancelled';
  if (doc.status === 'expired' || (doc.expiresAt && doc.expiresAt < atISO)) return 'expired';
  if (doc.status === 'draft') return 'draft';
  if (doc.status === 'archived') return 'archived';
  return 'valid';
}

export async function findDocument(idOrNumber: string): Promise<BankDocument | undefined> {
  const key = idOrNumber.trim();
  return (await db.documents.get(key)) ?? (await db.documents.where('number').equals(key.toUpperCase()).first());
}

export interface VerificationResult {
  ok: boolean;
  doc?: BankDocument;
  signature?: SignatureState;
  validity?: Validity;
  error?: 'NOT_FOUND' | 'VERIFICATION_FAILED' | 'DOCUMENT_EXPIRED';
}

export async function verifyDocument(idOrNumber: string, code: string): Promise<VerificationResult> {
  const doc = await findDocument(idOrNumber);
  if (!doc) {
    await audit({ action: 'document.verify', object: 'document', objectId: idOrNumber, result: 'failure', details: 'not found' });
    return { ok: false, error: 'NOT_FOUND' };
  }
  const norm = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (norm(doc.verificationCode) !== norm(code)) {
    await audit({ action: 'document.verify', object: 'document', objectId: doc.id, result: 'failure', details: 'code mismatch' });
    return { ok: false, error: 'VERIFICATION_FAILED' };
  }
  const { state } = await signatureState(doc);
  const validity = validityOf(doc);
  await audit({ action: 'document.verify', object: 'document', objectId: doc.id, details: `${state}/${validity}` });
  return {
    ok: validity === 'valid' && state !== 'invalid',
    doc,
    signature: state,
    validity,
    error: validity === 'expired' ? 'DOCUMENT_EXPIRED' : undefined,
  };
}

export async function setDocumentStatus(id: string, status: BankDocument['status'], note?: string) {
  const doc = await getDocumentOrThrow(id);
  if (!canEdit(doc)) throw new BankError('PERMISSION_DENIED', { object: 'document' });
  const next = { ...doc, status, version: doc.version + 1, updatedAt: nowISO() };
  await inTx([db.documents, db.docVersions], async () => {
    await db.documents.put(next);
    await db.docVersions.add(snapshotOf(next, note ?? `Status → ${status}`));
  });
  await audit({ action: `document.${status}`, object: 'document', objectId: id, details: doc.number });
  return next;
}

export async function addDocumentNote(id: string, text: string) {
  const doc = await getDocumentOrThrow(id);
  const a = actor();
  await db.documents.update(id, { notes: [...doc.notes, { at: nowISO(), author: a.name, text }] });
  await audit({ action: 'document.note', object: 'document', objectId: id });
}

/** Payment receipt for a completed transaction. */
export async function issueReceipt(tx: Transaction): Promise<BankDocument> {
  return createDocument({
    type: 'receipt',
    title: 'Payment Receipt',
    ownerId: tx.initiatorId,
    partyIds: tx.partyIds,
    classification: 'confidential',
    data: {
      txId: tx.id, ref: tx.ref, txType: tx.type, amount: tx.amount, currency: tx.currency, fee: tx.fee,
      feeCurrency: tx.feeCurrency, creditAmount: tx.creditAmount, creditCurrency: tx.creditCurrency,
      sender: tx.sender, recipient: tx.recipient, description: tx.description, fx: tx.fx, channel: tx.channel,
      completedAt: tx.completedAt ?? tx.updatedAt, status: tx.status, purpose: tx.purpose, merchant: tx.merchant,
    },
    links: { txIds: [tx.id], accountIds: [tx.fromAccountId, tx.toAccountId].filter(Boolean) as string[] },
    authorName: 'Directorate of Aetherline Payments',
    authorId: 'BANK',
    silent: true,
  });
}

export async function linkDocuments(a: string, b: string) {
  const da = await getDocumentOrThrow(a);
  const dbb = await getDocumentOrThrow(b);
  await db.documents.update(a, { links: { ...da.links, docIds: [...new Set([...da.links.docIds, b])] } });
  await db.documents.update(b, { links: { ...dbb.links, docIds: [...new Set([...dbb.links.docIds, a])] } });
}
