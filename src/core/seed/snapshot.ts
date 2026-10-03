/**
 * Demo-world snapshots. The demo world is forged by `seedDemo()` — every
 * operation runs through the real banking services — once at build time; the
 * result ships compressed with the app and is imported on first launch.
 *
 * On import every timestamp is moved forward by whole days so the history
 * always ends "today"; the audit hash chain is then re-anchored and document
 * signatures are re-issued with the same keys so verification stays valid.
 */
import { db, SCHEMA_VERSION, tableNames, setMeta } from '../db/db';
import { canonical, sha256 } from '../util/sha256';
import { auditHashPayload } from '../ops/audit';
import { contentHash } from '../docs/documents';
import { signText } from '../util/crypto';
import { todayKey, daysBetween } from '../clock';
import type { Table } from 'dexie';
import type { AuditRecord, BankDocument, Check, KeyRecord } from '../types';

export const SNAPSHOT_FORMAT = 'ledgerhall-snapshot';
const SKIP_TABLES = new Set(['backups', 'sessions']);
const SKIP_META = new Set(['session', 'pending2fa']);
const NO_SHIFT_KEYS = new Set(['dob', 'since', 'opened', 'issueDate', 'expiryDate']);

export interface Snapshot {
  format: string;
  schemaVersion: number;
  anchorDay: string;
  createdAt: string;
  tables: Record<string, unknown[]>;
}

function table(name: string): Table<unknown, unknown> {
  return (db as unknown as Record<string, Table<unknown, unknown>>)[name];
}

export async function exportSnapshot(anchorDay: string): Promise<Snapshot> {
  const tables: Record<string, unknown[]> = {};
  for (const name of tableNames()) {
    if (SKIP_TABLES.has(name)) continue;
    let rows = await table(name).toArray();
    if (name === 'meta') rows = (rows as { key: string }[]).filter((r) => !SKIP_META.has(r.key));
    if (name === 'outbox') rows = (rows as { createdAt: string }[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 400);
    tables[name] = rows;
  }
  return { format: SNAPSHOT_FORMAT, schemaVersion: SCHEMA_VERSION, anchorDay, createdAt: new Date().toISOString(), tables };
}

const ISO_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;
const ISO_D = /^(\d{4})-(\d{2})-(\d{2})$/;

function shiftString(s: string, deltaMs: number): string {
  if (ISO_DT.test(s)) return new Date(Date.parse(s) + deltaMs).toISOString();
  if (ISO_D.test(s)) return new Date(Date.parse(s + 'T00:00:00Z') + deltaMs).toISOString().slice(0, 10);
  return s;
}

/** Deep-shift every ISO date / datetime string by `deltaMs` (whole days). */
export function shiftDates<T>(value: T, deltaMs: number, key = ''): T {
  if (deltaMs === 0) return value;
  if (typeof value === 'string') return (NO_SHIFT_KEYS.has(key) ? value : shiftString(value, deltaMs)) as T;
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, deltaMs, key)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = shiftDates(v, deltaMs, k);
    return out as T;
  }
  return value;
}

export async function decodeSnapshot(base64Gzip: string): Promise<Snapshot> {
  const bin = atob(base64Gzip);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  return JSON.parse(text) as Snapshot;
}

export async function importSnapshot(snap: Snapshot, progress: (pct: number, label: string) => void = () => {}) {
  if (snap.format !== SNAPSHOT_FORMAT || snap.schemaVersion !== SCHEMA_VERSION) throw new Error('Incompatible demo snapshot');
  const deltaDays = daysBetween(snap.anchorDay, todayKey());
  const deltaMs = deltaDays * 86_400_000;
  progress(20, 'seed.shift');
  const tables: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(snap.tables)) tables[name] = shiftDates(rows, deltaMs);

  // Re-anchor the audit hash chain after shifting timestamps.
  const audit = (tables.audit ?? []) as AuditRecord[];
  audit.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  let prev = '0'.repeat(64);
  for (const r of audit) {
    r.prevHash = prev;
    const { hash: _h, seq: _s, ...rest } = r;
    void _h; void _s;
    r.hash = sha256(auditHashPayload(rest));
    prev = r.hash;
  }

  progress(40, 'seed.import');
  const names = Object.keys(tables).filter((n) => tableNames().includes(n));
  await db.transaction('rw', names.map((n) => table(n)), async () => {
    await Promise.all(names.map((n) => table(n).clear()));
    await Promise.all(names.filter((n) => tables[n].length).map((n) => table(n).bulkAdd(tables[n])));
  });

  // Documents whose signed content contains dates are re-signed with the original keys.
  progress(75, 'seed.signatures');
  if (deltaDays !== 0) {
    const keys = new Map(((await db.keys.toArray()) as KeyRecord[]).map((k) => [k.ownerId, k]));
    const docs = (await db.documents.toArray()).filter((d) => d.signatures.length);
    const updated: BankDocument[] = [];
    for (const d of docs) {
      const hash = contentHash(d);
      const sigs = [];
      for (const s of d.signatures) {
        const owner = s.kind === 'official' ? 'BANK-OFFICIAL' : s.signerId;
        const k = keys.get(owner);
        if (!k) {
          sigs.push(s);
          continue;
        }
        sigs.push({ ...s, contentHash: hash, signature: await signText(k.privateKey, `${d.id}|${hash}|${s.kind}|${s.signerId}`) });
      }
      updated.push({ ...d, signatures: sigs });
    }
    await db.documents.bulkPut(updated);
    const byId = new Map(updated.map((d) => [d.id, d]));
    const checks = (await db.checks.toArray()) as Check[];
    const fixed = checks.filter((c) => c.signature && c.documentId && byId.has(c.documentId)).map((c) => {
      const doc = byId.get(c.documentId!)!;
      return { ...c, signature: doc.signatures.find((s) => s.id === c.signature!.id) ?? c.signature };
    });
    if (fixed.length) await db.checks.bulkPut(fixed);
  }
  await setMeta('seeded', { at: new Date().toISOString(), version: 1, anchorDay: todayKey(), source: 'snapshot', shiftedDays: deltaDays, checksum: sha256(canonical(snap.anchorDay)) });
  progress(100, 'seed.done');
  return { deltaDays };
}
