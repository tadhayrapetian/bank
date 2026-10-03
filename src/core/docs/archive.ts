/**
 * Hall of Sealed Records — the archive of the Exchequer. Records carry an
 * archive code, a shelf mark and a classification. Clients see their own
 * records and public ones; archivists (`archive.all`) see the whole hall.
 * Sealed records can only be retrieved or unsealed by archivists.
 */
import { db } from '../db/db';
import { nowISO } from '../clock';
import { uid } from '../util/random';
import { archiveCode, caseNumber, shelfMark } from '../banking/numbers';
import { actor } from '../context';
import { BankError } from '../errors';
import { audit } from '../ops/audit';
import { can } from '../security/permissions';
import { getDocumentOrThrow, setDocumentStatus, canSeeDocument } from './documents';
import { notify } from '../comms/notify';
import type { ArchiveRecord, Classification, DeptCode } from '../types';

export const ARCHIVE_KINDS: ArchiveRecord['kind'][] = ['case', 'document', 'transaction', 'application', 'contract', 'correspondence', 'closed_account'];

export function canSeeRecord(r: ArchiveRecord, a = actor()): boolean {
  return a.system || can('archive.all', a) || r.ownerId === a.userId || r.classification === 'public';
}

/** Only archivists open sealed records; owners may retrieve their own unsealed files. */
export function canHandleRecord(r: ArchiveRecord, a = actor()): boolean {
  if (a.system || can('archive.all', a)) return true;
  return r.ownerId === a.userId && r.status !== 'sealed' && r.classification !== 'sealed';
}

export async function getRecordOrThrow(id: string): Promise<ArchiveRecord> {
  const r = await db.archive.get(id);
  if (!r || !canSeeRecord(r)) throw new BankError('NOT_FOUND', { object: 'archive', id });
  return r;
}

/** All records visible to the acting user, newest first. */
export async function listArchive(): Promise<ArchiveRecord[]> {
  const a = actor();
  const rows = can('archive.all', a) || a.system ? await db.archive.toArray() : await db.archive.filter((r) => canSeeRecord(r, a)).toArray();
  return rows.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

/** File a document with the Hall of Sealed Records and mark it archived. */
export async function archiveDocument(docId: string, note?: string): Promise<ArchiveRecord> {
  const doc = await getDocumentOrThrow(docId);
  if (!canSeeDocument(doc)) throw new BankError('PERMISSION_DENIED', { object: 'document' });
  if (doc.status === 'archived') {
    const existing = await db.archive.filter((r) => r.refs.docId === docId).first();
    if (existing) return existing;
  }
  if (doc.status === 'draft') throw new BankError('INVALID_STATE', { status: doc.status });
  await setDocumentStatus(docId, 'archived', note ? `Archived: ${note}` : 'Filed with the Hall of Sealed Records');
  const rec: ArchiveRecord = {
    id: uid('ARR'),
    code: doc.archiveCode || archiveCode('ARC'),
    kind: doc.type === 'contract' || doc.type === 'loan_agreement' ? 'contract' : doc.type === 'application' ? 'application' : doc.type === 'letter' || doc.type === 'notice' ? 'correspondence' : 'document',
    title: `${doc.title} ${doc.number}`,
    summary: note?.trim() || `${doc.title} (${doc.number}, v${doc.version + 1}) filed by ${actor().name}.`,
    createdAt: nowISO(),
    ownerId: doc.ownerId,
    department: (doc.department as DeptCode) || 'ARC',
    classification: doc.classification,
    refs: { docId: doc.id, txId: doc.links.txIds[0], accountId: doc.links.accountIds[0] },
    tags: ['document', doc.type],
    shelf: shelfMark(),
    status: doc.classification === 'sealed' ? 'sealed' : 'filed',
  };
  // archive codes are unique; documents that share a code with an earlier record get a fresh one
  if (await db.archive.where('code').equals(rec.code).count()) rec.code = archiveCode(rec.department);
  await db.archive.add(rec);
  await audit({ action: 'archive.file', object: 'archive', objectId: rec.id, details: `${rec.code} ← ${doc.number}` });
  return rec;
}

async function setStatus(id: string, status: ArchiveRecord['status'], patch: Partial<ArchiveRecord> = {}, action: string, details?: string) {
  await db.archive.update(id, { ...patch, status });
  await audit({ action, object: 'archive', objectId: id, details });
}

/** Take a record off its shelf for reading. Sealed records require an archivist. */
export async function retrieveRecord(id: string, reason = ''): Promise<void> {
  const r = await getRecordOrThrow(id);
  if (!canHandleRecord(r)) throw new BankError('PERMISSION_DENIED', { reason: r.status === 'sealed' ? 'sealed record' : 'not owner' });
  if (r.status === 'retrieved') throw new BankError('INVALID_STATE', { status: r.status });
  await setStatus(id, 'retrieved', {}, 'archive.retrieve', `${r.code}${reason ? ` — ${reason}` : ''}`);
  if (r.ownerId && r.ownerId !== actor().userId && r.ownerId !== 'SYSTEM') {
    await notify(r.ownerId, { category: 'documents', titleKey: 'archive.notice.retrievedTitle', bodyKey: 'archive.notice.retrievedBody', params: { code: r.code, name: actor().name }, link: `/archive?id=${id}` });
  }
}

/** Return a retrieved record to its shelf. */
export async function refileRecord(id: string): Promise<void> {
  const r = await getRecordOrThrow(id);
  if (!canHandleRecord(r)) throw new BankError('PERMISSION_DENIED');
  if (r.status !== 'retrieved') throw new BankError('INVALID_STATE', { status: r.status });
  await setStatus(id, r.classification === 'sealed' ? 'sealed' : 'filed', {}, 'archive.refile', r.code);
}

/** Place a record under seal (archivists only). */
export async function sealRecord(id: string, reason = ''): Promise<void> {
  if (!can('archive.all')) throw new BankError('PERMISSION_DENIED', { permission: 'archive.all' });
  const r = await getRecordOrThrow(id);
  if (r.status === 'sealed') throw new BankError('INVALID_STATE', { status: r.status });
  await setStatus(id, 'sealed', { classification: 'sealed' }, 'archive.seal', `${r.code}${reason ? ` — ${reason}` : ''}`);
}

/** Lift the seal of a record (archivists only); it becomes confidential. */
export async function unsealRecord(id: string, reason = ''): Promise<void> {
  if (!can('archive.all')) throw new BankError('PERMISSION_DENIED', { permission: 'archive.all' });
  const r = await getRecordOrThrow(id);
  if (r.status !== 'sealed' && r.classification !== 'sealed') throw new BankError('INVALID_STATE', { status: r.status });
  await setStatus(id, 'filed', { classification: 'confidential' }, 'archive.unseal', `${r.code}${reason ? ` — ${reason}` : ''}`);
}

/** Open a new case file (archivists only). */
export async function fileCase(input: {
  title: string;
  summary: string;
  kind?: ArchiveRecord['kind'];
  department: DeptCode;
  classification: Classification;
  tags?: string[];
  ownerId?: string;
}): Promise<ArchiveRecord> {
  if (!can('archive.all')) throw new BankError('PERMISSION_DENIED', { permission: 'archive.all' });
  if (!input.title.trim()) throw new BankError('VALIDATION', { field: 'title' });
  const kind = input.kind ?? 'case';
  const caseNo = kind === 'case' ? await caseNumber(input.department) : undefined;
  const rec: ArchiveRecord = {
    id: uid('ARR'),
    code: archiveCode(input.department),
    kind,
    title: input.title.trim(),
    summary: [caseNo, input.summary.trim()].filter(Boolean).join(' — '),
    createdAt: nowISO(),
    ownerId: input.ownerId,
    department: input.department,
    classification: input.classification,
    refs: {},
    tags: (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
    shelf: shelfMark(),
    status: input.classification === 'sealed' ? 'sealed' : 'filed',
  };
  await db.archive.add(rec);
  await audit({ action: 'archive.open_case', object: 'archive', objectId: rec.id, details: `${rec.code} ${caseNo ?? ''}`.trim() });
  return rec;
}

/** Access history of a record, from the audit trail (newest first). */
export async function recordHistory(id: string, limit = 30) {
  const rows = await db.audit.filter((r) => r.object === 'archive' && r.objectId === id).toArray();
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
