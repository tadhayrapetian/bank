/** System Status Center: per-service operational state that real operations obey. */
import { db } from '../db/db';
import { nowISO } from '../clock';
import { BankError } from '../errors';
import { audit, syslog } from './audit';
import { requirePermission } from '../security/permissions';
import type { ServiceId, ServiceState, ServiceStatus } from '../types';

export const SERVICES: ServiceId[] = [
  'payments', 'transfers', 'exchange', 'cards', 'atm', 'documents', 'notifications', 'authentication',
];

const cache = new Map<ServiceId, ServiceState>();

export async function loadServiceCache() {
  const rows = await db.services.toArray();
  cache.clear();
  for (const r of rows) cache.set(r.service, r.status);
}

export function serviceState(s: ServiceId): ServiceState {
  return cache.get(s) ?? 'operational';
}

/** Throws NETWORK_UNAVAILABLE when a service is offline or in maintenance. */
export function assertService(s: ServiceId) {
  const st = serviceState(s);
  if (st === 'offline' || st === 'maintenance') throw new BankError('NETWORK_UNAVAILABLE', { service: s, state: st });
}

export function isDegraded(s: ServiceId) {
  return serviceState(s) === 'degraded';
}

export async function ensureServices() {
  const existing = await db.services.count();
  if (existing) return;
  const at = nowISO();
  await db.services.bulkPut(
    SERVICES.map((service) => ({ service, status: 'operational' as const, message: '', updatedAt: at, history: [{ at, status: 'operational' as const }] })),
  );
  await loadServiceCache();
}

export async function setServiceStatus(service: ServiceId, status: ServiceState, message = '') {
  requirePermission('status.manage');
  const row = await db.services.get(service);
  const at = nowISO();
  const next: ServiceStatus = {
    service,
    status,
    message,
    updatedAt: at,
    history: [...(row?.history ?? []), { at, status }].slice(-60),
  };
  await db.services.put(next);
  cache.set(service, status);
  await audit({ action: 'system.status', object: 'service', objectId: service, details: `${status} ${message}` });
  await syslog(status === 'operational' ? 'info' : 'warn', 'status', `${service} → ${status}${message ? ': ' + message : ''}`);
}
