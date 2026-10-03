/**
 * Audit trail — append-only, hash-chained. Each record stores the hash of the
 * previous one, so any tampering breaks the chain (see verifyAuditChain).
 * There is intentionally no delete operation anywhere in the codebase.
 */
import { db, inTx } from '../db/db';
import { actor, primaryRole } from '../context';
import { nowISO } from '../clock';
import { canonical, sha256 } from '../util/sha256';
import { uid } from '../util/random';
import type { AuditRecord, SysLog } from '../types';

export interface AuditInput {
  action: string;
  object: string;
  objectId: string;
  result?: AuditRecord['result'];
  txId?: string;
  details?: string;
}

const GENESIS = '0'.repeat(64);

export function auditHashPayload(r: Omit<AuditRecord, 'hash' | 'seq'>): string {
  return canonical({
    id: r.id, at: r.at, userId: r.userId, userName: r.userName, role: r.role, action: r.action, object: r.object,
    objectId: r.objectId, result: r.result, txId: r.txId, device: r.device, ip: r.ip, details: r.details,
    prevHash: r.prevHash,
  });
}

export async function audit(input: AuditInput): Promise<AuditRecord> {
  const a = actor();
  return inTx([db.audit], async () => {
    const last = await db.audit.orderBy('seq').last();
    const base: Omit<AuditRecord, 'hash' | 'seq'> = {
      id: uid('AUD', 12),
      at: nowISO(),
      userId: a.userId,
      userName: a.name,
      role: a.system ? 'system' : primaryRole(a.roles),
      action: input.action,
      object: input.object,
      objectId: input.objectId,
      result: input.result ?? 'success',
      txId: input.txId,
      device: a.deviceId,
      ip: a.ip,
      details: input.details,
      prevHash: last?.hash ?? GENESIS,
    };
    const rec: AuditRecord = { ...base, hash: sha256(auditHashPayload(base)) };
    rec.seq = await db.audit.add(rec);
    return rec;
  });
}

export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
  let prev = GENESIS;
  let checked = 0;
  let brokenAt: number | undefined;
  await db.audit.orderBy('seq').each((r) => {
    if (brokenAt !== undefined) return;
    const { hash, seq, ...rest } = r;
    const expected = sha256(auditHashPayload(rest));
    if (r.prevHash !== prev || expected !== hash) brokenAt = seq;
    prev = hash;
    checked++;
  });
  return { ok: brokenAt === undefined, checked, brokenAt };
}

export async function syslog(level: SysLog['level'], source: string, message: string) {
  try {
    await db.syslog.add({ at: nowISO(), level, source, message });
  } catch {
    /* logging must never break operations */
  }
}
