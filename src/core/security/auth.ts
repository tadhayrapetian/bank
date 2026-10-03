/**
 * Authentication: password (PBKDF2) + optional TOTP second factor, device
 * registry, sessions, login history, onboarding registration.
 */
import { db, getMeta, nextCounter, setMeta } from '../db/db';
import { BankError } from '../errors';
import { nowISO, nowMs } from '../clock';
import { uid, randomCode } from '../util/random';
import { hashSecret, newSalt, newTotpSecret, verifySecret, verifyTotp } from '../util/crypto';
import { actor, placeholderIp, setActor, SYSTEM_ACTOR, type Actor, asActor } from '../context';
import { assertService } from '../ops/system';
import { audit } from '../ops/audit';
import { notify, sendMail } from '../comms/notify';
import { getSettings } from '../settings';
import type { Device, Lang, LoginRecord, SessionRecord, ThemeId, User, UserPreferences } from '../types';

const DEVICE_KEY = 'ledgerhall.device';

export function deviceFingerprint(): { id: string; label: string; platform: string } {
  let id = '';
  try {
    id = localStorage.getItem(DEVICE_KEY) ?? '';
    if (!id) {
      id = `DEV-${randomCode(10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
  } catch {
    id = (globalThis as { __ledgerhallDevice?: string }).__ledgerhallDevice ??= `DEV-${randomCode(10)}`;
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'node';
  const platform = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Mac/i.test(ua) ? 'macOS' : /Win/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : 'Unknown';
  const browser = /Firefox/i.test(ua) ? 'Firefox' : /Edg/i.test(ua) ? 'Edge' : /Chrome/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : 'Browser';
  return { id, label: `${browser} on ${platform}`, platform };
}

export function defaultPreferences(lang: Lang = 'en', theme: ThemeId = 'ministry', base = 'CRWN'): UserPreferences {
  return {
    language: lang,
    theme,
    baseCurrency: base,
    sound: true,
    channels: { inapp: true, email: true, sms: false, push: true },
    categories: { payments: true, security: true, documents: true, cards: true, accounts: true, loans: true, deposits: true, system: true },
  };
}

function actorFor(user: User, deviceId: string, sessionId?: string): Actor {
  return { userId: user.id, name: user.name, roles: user.roles, deviceId, sessionId, ip: placeholderIp(user.id + deviceId) };
}

async function recordLogin(userId: string, result: LoginRecord['result'], method: LoginRecord['method']) {
  const dev = deviceFingerprint();
  await db.logins.add({ id: uid('LOG', 12), userId, at: nowISO(), result, deviceId: dev.id, ip: placeholderIp(userId + dev.id), method });
}

async function findUser(identifier: string): Promise<User | undefined> {
  const key = identifier.trim();
  return (
    (await db.users.where('clientId').equals(key.toUpperCase()).first()) ??
    (await db.users.where('email').equals(key.toLowerCase()).first())
  );
}

export type LoginResult = { status: 'ok'; user: User } | { status: 'second_factor'; userId: string };

export async function login(identifier: string, password: string): Promise<LoginResult> {
  assertService('authentication');
  const user = await findUser(identifier);
  if (!user) {
    await asActor(SYSTEM_ACTOR, () => audit({ action: 'auth.login', object: 'user', objectId: identifier, result: 'failure', details: 'unknown identifier' }));
    throw new BankError('INVALID_CREDENTIALS');
  }
  if (user.failedLogins >= 5 || user.status === 'suspended') {
    await recordLogin(user.id, 'locked', 'password');
    throw new BankError('USER_LOCKED');
  }
  const ok = await verifySecret(password, user.salt, user.passwordHash);
  if (!ok) {
    await db.users.update(user.id, { failedLogins: user.failedLogins + 1 });
    await recordLogin(user.id, 'failure', 'password');
    await asActor(SYSTEM_ACTOR, () => audit({ action: 'auth.login', object: 'user', objectId: user.id, result: 'failure', details: `attempt ${user.failedLogins + 1}` }));
    if (user.failedLogins + 1 >= 3) {
      await notify(user.id, { category: 'security', titleKey: 'n.security.failed_logins.title', bodyKey: 'n.security.failed_logins.body', params: { count: user.failedLogins + 1 }, priority: 'high' });
    }
    throw new BankError('INVALID_CREDENTIALS', { attemptsLeft: Math.max(0, 5 - user.failedLogins - 1) });
  }
  if (user.twoFactor.enabled && user.twoFactor.secret) {
    await recordLogin(user.id, 'second_factor', 'password');
    await setMeta('pending2fa', { userId: user.id, at: nowISO() });
    return { status: 'second_factor', userId: user.id };
  }
  return { status: 'ok', user: await startSession(user, 'password') };
}

export async function completeSecondFactor(userId: string, code: string): Promise<User> {
  const pending = await getMeta<{ userId: string } | null>('pending2fa', null);
  if (!pending || pending.userId !== userId) throw new BankError('SECOND_FACTOR_REQUIRED');
  const user = await db.users.get(userId);
  if (!user?.twoFactor.secret) throw new BankError('INVALID_CREDENTIALS');
  if (!(await verifyTotp(user.twoFactor.secret, code, nowMs()))) {
    await recordLogin(userId, 'failure', 'second_factor');
    throw new BankError('VERIFICATION_FAILED', { factor: 'totp' });
  }
  await setMeta('pending2fa', null);
  return startSession(user, 'second_factor');
}

export async function startSession(user: User, method: LoginRecord['method']): Promise<User> {
  const dev = deviceFingerprint();
  const at = nowISO();
  let device = await db.devices.get(dev.id);
  const isNewForUser = !device || device.userId !== user.id;
  if (!device || device.userId !== user.id) {
    const d: Device = { id: dev.id, userId: user.id, label: dev.label, platform: dev.platform, fingerprint: dev.id, firstSeen: at, lastSeen: at, trusted: method === 'onboarding' ? 1 : 0 };
    await db.devices.put(d);
    device = d;
  } else {
    await db.devices.update(dev.id, { lastSeen: at });
  }
  const session: SessionRecord = { id: uid('SES'), userId: user.id, deviceId: dev.id, deviceLabel: dev.label, startedAt: at, lastActive: at, active: 1, ip: placeholderIp(user.id + dev.id), location: 'Vellinghast, Aldermoor' };
  await db.sessions.add(session);
  await db.users.update(user.id, { failedLogins: 0, lastLoginAt: at });
  await setMeta('session', { sessionId: session.id, userId: user.id });
  setActor(actorFor(user, dev.id, session.id));
  await recordLogin(user.id, 'success', method);
  await audit({ action: 'auth.login', object: 'user', objectId: user.id, details: method });
  if (isNewForUser && method !== 'onboarding' && method !== 'switch') {
    await notify(user.id, { category: 'security', titleKey: 'n.security.new_device.title', bodyKey: 'n.security.new_device.body', params: { device: dev.label }, link: '/security', priority: 'high' });
  }
  return (await db.users.get(user.id))!;
}

export async function restoreSession(): Promise<User | null> {
  const s = await getMeta<{ sessionId: string; userId: string } | null>('session', null);
  if (!s) return null;
  const rec = await db.sessions.get(s.sessionId);
  const user = await db.users.get(s.userId);
  if (!rec || !rec.active || !user || user.status === 'suspended') return null;
  await db.sessions.update(rec.id, { lastActive: nowISO() });
  setActor(actorFor(user, rec.deviceId, rec.id));
  return user;
}

export async function logout() {
  const a = actor();
  if (a.sessionId) await db.sessions.update(a.sessionId, { active: 0 });
  if (!a.system) {
    await recordLogin(a.userId, 'logout', 'password');
    await audit({ action: 'auth.logout', object: 'user', objectId: a.userId });
  }
  await setMeta('session', null);
  setActor(SYSTEM_ACTOR);
}

/** Demo convenience: switch to another demo identity (recorded in the audit log). */
export async function switchIdentity(userId: string): Promise<User> {
  const target = await db.users.get(userId);
  if (!target) throw new BankError('NOT_FOUND');
  const prev = actor();
  if (prev.sessionId) await db.sessions.update(prev.sessionId, { active: 0 });
  await audit({ action: 'auth.switch_identity', object: 'user', objectId: userId, details: `from ${prev.userId}` });
  return startSession(target, 'switch');
}

/* ── Security settings ── */

export async function changePassword(oldPw: string, newPw: string) {
  const a = actor();
  const user = await db.users.get(a.userId);
  if (!user) throw new BankError('NOT_FOUND');
  if (!(await verifySecret(oldPw, user.salt, user.passwordHash))) throw new BankError('INVALID_CREDENTIALS');
  if (newPw.length < 8) throw new BankError('VALIDATION', { field: 'password', min: 8 });
  const salt = newSalt();
  await db.users.update(user.id, { salt, passwordHash: await hashSecret(newPw, salt) });
  await audit({ action: 'security.password_change', object: 'user', objectId: user.id });
  await notify(user.id, { category: 'security', titleKey: 'n.security.password.title', bodyKey: 'n.security.password.body', params: {}, priority: 'high' });
  await sendMail(user.id, 'security_alert', { event: 'password_changed' });
}

export async function setAccessPin(pin: string) {
  if (!/^\d{4,6}$/.test(pin)) throw new BankError('INVALID_PIN');
  const a = actor();
  await db.users.update(a.userId, { pinHash: await hashSecret(pin, a.userId) });
  await audit({ action: 'security.pin_set', object: 'user', objectId: a.userId });
}

export async function begin2FA(): Promise<string> {
  const secret = newTotpSecret();
  await setMeta(`totp-setup:${actor().userId}`, secret);
  return secret;
}

export async function confirm2FA(code: string) {
  const a = actor();
  const secret = await getMeta<string | null>(`totp-setup:${a.userId}`, null);
  if (!secret) throw new BankError('INVALID_STATE');
  if (!(await verifyTotp(secret, code, nowMs()))) throw new BankError('VERIFICATION_FAILED', { factor: 'totp' });
  await db.users.update(a.userId, { twoFactor: { enabled: true, secret } });
  await setMeta(`totp-setup:${a.userId}`, null);
  await audit({ action: 'security.2fa_enable', object: 'user', objectId: a.userId });
  await notify(a.userId, { category: 'security', titleKey: 'n.security.2fa_on.title', bodyKey: 'n.security.2fa_on.body', params: {}, priority: 'high' });
}

export async function disable2FA(password: string) {
  const a = actor();
  const user = await db.users.get(a.userId);
  if (!user || !(await verifySecret(password, user.salt, user.passwordHash))) throw new BankError('INVALID_CREDENTIALS');
  await db.users.update(a.userId, { twoFactor: { enabled: false } });
  await audit({ action: 'security.2fa_disable', object: 'user', objectId: a.userId });
  await notify(a.userId, { category: 'security', titleKey: 'n.security.2fa_off.title', bodyKey: 'n.security.2fa_off.body', params: {}, priority: 'high' });
}

export async function setDeviceTrust(deviceId: string, trusted: boolean) {
  const d = await db.devices.get(deviceId);
  if (!d || d.userId !== actor().userId) throw new BankError('PERMISSION_DENIED');
  await db.devices.update(deviceId, { trusted: trusted ? 1 : 0 });
  await audit({ action: trusted ? 'security.device_trust' : 'security.device_untrust', object: 'device', objectId: deviceId });
}

export async function revokeSession(sessionId: string) {
  const s = await db.sessions.get(sessionId);
  if (!s || s.userId !== actor().userId) throw new BankError('PERMISSION_DENIED');
  await db.sessions.update(sessionId, { active: 0 });
  await audit({ action: 'security.session_revoke', object: 'session', objectId: sessionId });
}

export async function setDailyLimit(limitUSD: number) {
  if (!(limitUSD >= 0)) throw new BankError('INVALID_AMOUNT');
  const a = actor();
  await db.users.update(a.userId, { dailyLimitUSD: limitUSD });
  await audit({ action: 'security.daily_limit', object: 'user', objectId: a.userId, details: String(limitUSD) });
}

/** Emergency "seal everything": freeze all own accounts and cards. */
export async function panicFreeze() {
  const a = actor();
  const accs = await db.accounts.where('ownerId').equals(a.userId).filter((x) => x.status === 'active' && !x.hidden).toArray();
  for (const acc of accs) await db.accounts.update(acc.id, { status: 'frozen', frozenReason: 'client emergency freeze' });
  const cards = await db.cards.where('ownerId').equals(a.userId).filter((c) => c.status === 'active').toArray();
  for (const c of cards) await db.cards.update(c.id, { status: 'frozen' });
  await audit({ action: 'security.panic_freeze', object: 'user', objectId: a.userId, details: `${accs.length} accounts, ${cards.length} cards` });
  await notify(a.userId, { category: 'security', titleKey: 'n.security.panic.title', bodyKey: 'n.security.panic.body', params: { accounts: accs.length, cards: cards.length }, priority: 'high' });
  return { accounts: accs.length, cards: cards.length };
}

export async function updateProfile(patch: Partial<Pick<User, 'email' | 'phone' | 'address' | 'occupation' | 'honorific'>>) {
  const a = actor();
  await db.users.update(a.userId, patch);
  await audit({ action: 'profile.update', object: 'user', objectId: a.userId, details: Object.keys(patch).join(',') });
}

export async function updatePreferences(patch: Partial<UserPreferences>) {
  const a = actor();
  if (a.system) return;
  const user = await db.users.get(a.userId);
  if (!user) return;
  await db.users.update(a.userId, { preferences: { ...user.preferences, ...patch } });
}

/* ── Registration (onboarding) ── */

export async function nextClientId(): Promise<string> {
  const n = await nextCounter('client-id', 104700);
  return `ALD-C-${n}`;
}

export interface RegistrationInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  language: Lang;
  baseCurrency: string;
  theme: ThemeId;
  address: User['address'];
  dob?: string;
  occupation?: string;
}

export async function registerClient(input: RegistrationInput): Promise<User> {
  if (!input.name.trim()) throw new BankError('VALIDATION', { field: 'name' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw new BankError('VALIDATION', { field: 'email' });
  if (input.password.length < 8) throw new BankError('VALIDATION', { field: 'password', min: 8 });
  if (await db.users.where('email').equals(input.email.toLowerCase()).first()) throw new BankError('VALIDATION', { field: 'email', reason: 'taken' });
  const salt = newSalt();
  const user: User = {
    id: uid('USR'),
    clientId: await nextClientId(),
    kind: 'client',
    roles: ['client'],
    name: input.name.trim(),
    email: input.email.toLowerCase(),
    phone: input.phone,
    address: input.address,
    dob: input.dob,
    registeredAt: nowISO(),
    status: 'active',
    passwordHash: await hashSecret(input.password, salt),
    salt,
    twoFactor: { enabled: false },
    preferences: defaultPreferences(input.language, input.theme, input.baseCurrency),
    kycStatus: 'not_started',
    segment: 'retail',
    dailyLimitUSD: getSettings().defaultDailyLimitUSD,
    usualRealms: ['ALD'],
    occupation: input.occupation,
    avatarHue: Math.floor(Math.random() * 360),
    failedLogins: 0,
    onboarded: false,
    branchId: 'BR-VEL',
  };
  await db.users.add(user);
  await asActor(SYSTEM_ACTOR, () => audit({ action: 'auth.register', object: 'user', objectId: user.id, details: user.clientId }));
  await sendMail(user.id, 'welcome', { name: user.name, clientId: user.clientId });
  return user;
}

export function generateTempSecret() {
  return newTotpSecret();
}

export function getCurrentUserId() {
  return actor().userId;
}
