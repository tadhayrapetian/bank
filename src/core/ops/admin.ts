/** Administration: users, staff, branches, currencies, exchange rates, settings, broadcasts. */
import { db, setMeta } from '../db/db';
import { BankError } from '../errors';
import { nowISO } from '../clock';
import { randomCode } from '../util/random';
import { hashSecret, newSalt } from '../util/crypto';
import { actor } from '../context';
import { requirePermission } from '../security/permissions';
import { currencies } from '../currency/registry';
import { loadAnchors, perUSDAt } from '../currency/rates';
import { getSettings, setSettingsCache, type BankSettings } from '../settings';
import { audit, syslog } from './audit';
import { notify, sendMail } from '../comms/notify';
import type { CurrencyDef } from '../currency/types';
import type { Branch, Employee, Role, User } from '../types';

export async function setUserStatus(userId: string, status: User['status']) {
  requirePermission('users.manage');
  if (userId === actor().userId) throw new BankError('VALIDATION', { reason: 'self' });
  await db.users.update(userId, { status, ...(status === 'active' ? { failedLogins: 0 } : {}) });
  if (status !== 'active') await db.sessions.where('userId').equals(userId).modify({ active: 0 });
  await audit({ action: 'admin.user_status', object: 'user', objectId: userId, details: status });
  await notify(userId, { category: 'security', titleKey: 'n.admin.user_status.title', bodyKey: 'n.admin.user_status.body', params: { status }, priority: 'high' });
}

export async function setUserRoles(userId: string, roles: Role[]) {
  requirePermission('users.manage');
  if (!roles.length) throw new BankError('VALIDATION', { field: 'roles' });
  const u = await db.users.get(userId);
  if (!u) throw new BankError('NOT_FOUND');
  await db.users.update(userId, { roles, kind: roles.some((r) => r !== 'client') ? 'staff' : 'client' });
  await audit({ action: 'admin.user_roles', object: 'user', objectId: userId, details: roles.join(',') });
}

export async function resetUserPassword(userId: string): Promise<string> {
  requirePermission('users.manage');
  const temp = `Temp-${randomCode(6)}`;
  const salt = newSalt();
  await db.users.update(userId, { salt, passwordHash: await hashSecret(temp, salt), failedLogins: 0 });
  await audit({ action: 'admin.password_reset', object: 'user', objectId: userId });
  await sendMail(userId, 'security_alert', { event: 'password_reset' });
  return temp;
}

export async function setEmployee(id: string, patch: Partial<Pick<Employee, 'status' | 'permissions' | 'position' | 'branchId' | 'department'>>) {
  requirePermission('employees.manage');
  await db.employees.update(id, patch);
  await audit({ action: 'admin.employee_update', object: 'employee', objectId: id, details: JSON.stringify(patch) });
}

export async function setBranchStatus(id: string, status: Branch['status']) {
  requirePermission('branches.manage');
  await db.branches.update(id, { status });
  await audit({ action: 'admin.branch_status', object: 'branch', objectId: id, details: status });
}

export async function setAtmStatus(id: string, status: 'online' | 'offline' | 'maintenance') {
  requirePermission('branches.manage');
  await db.atms.update(id, { status });
  await audit({ action: 'admin.atm_status', object: 'atm', objectId: id, details: status });
}

/* ── Currency registry & rates ── */

export async function setCurrencyEnabled(code: string, enabled: boolean) {
  requirePermission('currencies.manage');
  const row = await db.currencyOverrides.get(code);
  await db.currencyOverrides.put({ code, enabled, custom: row?.custom });
  currencies.setEnabled(code, enabled);
  await audit({ action: 'admin.currency_toggle', object: 'currency', objectId: code, details: enabled ? 'enabled' : 'disabled' });
}

export async function registerCurrency(def: CurrencyDef, perUSD: number) {
  requirePermission('currencies.manage');
  if (!/^[A-Z]{3,4}$/.test(def.code)) throw new BankError('VALIDATION', { field: 'code' });
  if (currencies.has(def.code) && !currencies.isCustom(def.code)) throw new BankError('VALIDATION', { field: 'code', reason: 'exists' });
  if (!(perUSD > 0)) throw new BankError('VALIDATION', { field: 'rate' });
  if (!(def.decimals >= 0 && def.decimals <= 6)) throw new BankError('VALIDATION', { field: 'decimals' });
  const full: CurrencyDef = { ...def, defaultPerUSD: perUSD };
  await db.currencyOverrides.put({ code: def.code, enabled: true, custom: full });
  currencies.register(full, true);
  await db.rates.put({ code: def.code, perUSD, updatedAt: nowISO(), source: 'manual' });
  loadAnchors(await db.rates.toArray());
  await audit({ action: 'admin.currency_register', object: 'currency', objectId: def.code, details: def.name });
}

export async function setRate(code: string, perUSD: number) {
  requirePermission('rates.manage');
  if (!(perUSD > 0)) throw new BankError('VALIDATION', { field: 'rate' });
  if (code === 'USD') throw new BankError('VALIDATION', { reason: 'USD is the quotation base' });
  await db.rates.put({ code, perUSD, updatedAt: nowISO(), source: 'manual' });
  loadAnchors(await db.rates.toArray());
  await audit({ action: 'admin.rate_set', object: 'rate', objectId: code, details: String(perUSD) });
}

export async function resetRates() {
  requirePermission('rates.manage');
  await db.rates.clear();
  loadAnchors([]);
  await audit({ action: 'admin.rates_reset', object: 'rate', objectId: 'all' });
}

/** Optional: pull reference rates from a public endpoint. Falls back with NETWORK_UNAVAILABLE. */
export async function fetchLiveRates(): Promise<number> {
  requirePermission('rates.manage');
  let data: { rates?: Record<string, number> };
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch (e) {
    await syslog('warn', 'rates', `Live rate fetch failed: ${e instanceof Error ? e.message : e}`);
    throw new BankError('NETWORK_UNAVAILABLE', { service: 'rates' });
  }
  const at = nowISO();
  let n = 0;
  for (const [code, v] of Object.entries(data.rates ?? {})) {
    if (currencies.has(code) && v > 0 && code !== 'USD') {
      await db.rates.put({ code, perUSD: v, updatedAt: at, source: 'live' });
      n++;
    }
  }
  loadAnchors(await db.rates.toArray());
  await audit({ action: 'admin.rates_live', object: 'rate', objectId: 'all', details: `${n} rates` });
  return n;
}

export function currentPerUSD(code: string) {
  return perUSDAt(code);
}

/* ── Settings & broadcasts ── */

export async function updateSettings(patch: Partial<BankSettings>) {
  requirePermission('settings.manage');
  const next = { ...getSettings(), ...patch };
  await setMeta('settings', next);
  setSettingsCache(next);
  await audit({ action: 'admin.settings', object: 'settings', objectId: 'bank', details: Object.keys(patch).join(',') });
}

export async function broadcast(text: string, priority: 'normal' | 'high' = 'normal') {
  requirePermission('notifications.broadcast');
  if (!text.trim()) throw new BankError('VALIDATION', { field: 'text' });
  const clients = await db.users.filter((u) => u.status === 'active').toArray();
  for (const u of clients) {
    await notify(u.id, { category: 'system', titleKey: 'n.broadcast.title', bodyKey: 'n.broadcast.body', params: { text: text.trim() }, priority });
    await sendMail(u.id, 'broadcast', { text: text.trim() });
  }
  await audit({ action: 'admin.broadcast', object: 'notification', objectId: 'all', details: `${clients.length} recipients` });
  return clients.length;
}
