/**
 * Export / Import / Backup / Restore.
 * Format: plain JSON (no code), with schema version and a SHA-256 checksum over
 * the canonical table contents. Imports are validated before anything is
 * written. The audit log is append-only: restores never overwrite it — they
 * append a record of the restore instead.
 */
import { db, SCHEMA_VERSION, tableNames } from '../db/db';
import { BankError } from '../errors';
import { nowISO } from '../clock';
import { uid } from '../util/random';
import { canonical, sha256 } from '../util/sha256';
import { actor } from '../context';
import { can, requirePermission } from '../security/permissions';
import { audit } from './audit';
import type { Table } from 'dexie';

export const BACKUP_FORMAT = 'ledgerhall-backup';
const EXCLUDED = new Set(['backups', 'audit', 'syslog']);

export interface BackupFile {
  format: string;
  schemaVersion: number;
  exportedAt: string;
  exportedBy: string;
  demo: true;
  tables: Record<string, unknown[]>;
  checksum: string;
}

function dataTables(): string[] {
  return tableNames().filter((t) => !EXCLUDED.has(t));
}

function table(name: string): Table<unknown, unknown> {
  return (db as unknown as Record<string, Table<unknown, unknown>>)[name];
}

export async function buildBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const name of dataTables()) tables[name] = await table(name).toArray();
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowISO(),
    exportedBy: actor().name,
    demo: true,
    tables,
    checksum: sha256(canonical(tables)),
  };
}

export async function exportData(): Promise<string> {
  if (!can('data.export')) throw new BankError('PERMISSION_DENIED');
  const file = await buildBackup();
  await audit({ action: 'data.export', object: 'database', objectId: 'all', details: `${Object.values(file.tables).reduce((s, t) => s + t.length, 0)} records` });
  return JSON.stringify(file);
}

export function validateBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BankError('VALIDATION', { reason: 'not JSON' });
  }
  const f = parsed as BackupFile;
  if (!f || typeof f !== 'object' || f.format !== BACKUP_FORMAT) throw new BankError('VALIDATION', { reason: 'unknown format' });
  if (f.schemaVersion !== SCHEMA_VERSION) throw new BankError('VALIDATION', { reason: `schema ${f.schemaVersion}` });
  if (!f.tables || typeof f.tables !== 'object') throw new BankError('VALIDATION', { reason: 'no tables' });
  const allowed = new Set(dataTables());
  for (const [name, rows] of Object.entries(f.tables)) {
    if (!allowed.has(name)) throw new BankError('VALIDATION', { reason: `unknown table ${name}` });
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) throw new BankError('VALIDATION', { reason: `bad rows in ${name}` });
  }
  if (sha256(canonical(f.tables)) !== f.checksum) throw new BankError('VERIFICATION_FAILED', { reason: 'checksum mismatch' });
  return f;
}

async function writeTables(f: BackupFile) {
  const names = dataTables();
  await db.transaction('rw', names.map((n) => table(n)), async () => {
    for (const n of names) await table(n).clear();
    for (const n of names) {
      const rows = f.tables[n];
      if (rows?.length) await table(n).bulkAdd(rows);
    }
  });
}

export async function importData(text: string) {
  requirePermission('data.restore');
  const f = validateBackup(text);
  await writeTables(f);
  await audit({ action: 'data.import', object: 'database', objectId: 'all', details: `exported ${f.exportedAt} by ${f.exportedBy}` });
  return f;
}

export async function createBackup(label: string) {
  requirePermission('data.restore');
  const file = await buildBackup();
  const payload = JSON.stringify(file);
  const rec = { id: uid('BKP'), createdAt: nowISO(), label: label || 'Manual backup', size: payload.length, checksum: file.checksum, payload };
  await db.backups.add(rec);
  await audit({ action: 'data.backup', object: 'backup', objectId: rec.id, details: rec.label });
  return rec;
}

export async function restoreBackup(id: string) {
  requirePermission('data.restore');
  const rec = await db.backups.get(id);
  if (!rec) throw new BankError('NOT_FOUND');
  const f = validateBackup(rec.payload);
  await writeTables(f);
  await audit({ action: 'data.restore', object: 'backup', objectId: id, details: rec.label });
}

export async function deleteBackup(id: string) {
  requirePermission('data.restore');
  await db.backups.delete(id);
  await audit({ action: 'data.backup_delete', object: 'backup', objectId: id });
}

/** Wipe demo data (the audit log is preserved and records the reset). */
export async function wipeData() {
  const names = dataTables();
  await db.transaction('rw', names.map((n) => table(n)), async () => {
    for (const n of names) await table(n).clear();
  });
  await audit({ action: 'data.reset', object: 'database', objectId: 'all' });
}
