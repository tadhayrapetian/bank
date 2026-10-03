import { db, openDatabase } from '@/core/db/db';
import { loadCaches } from '@/core/boot';
import { clock } from '@/core/clock';
import { asActor, SYSTEM_ACTOR, type Actor } from '@/core/context';
import { ensureCoreLedger, GL, openAccount } from '@/core/banking/accounts';
import { execute } from '@/core/banking/engine';
import { ensureServices, loadServiceCache } from '@/core/ops/system';
import { hashSecret } from '@/core/util/crypto';
import { defaultPreferences } from '@/core/security/auth';
import { toMinor } from '@/core/currency/format';
import { setSettingsCache, DEFAULT_SETTINGS } from '@/core/settings';
import type { Account, User } from '@/core/types';

export async function freshWorld() {
  await openDatabase();
  await Promise.all(db.tables.map((t) => t.clear()));
  setSettingsCache({ ...DEFAULT_SETTINGS, processingSpeed: 'instant' });
  await loadCaches();
  setSettingsCache({ ...DEFAULT_SETTINGS, processingSpeed: 'instant' });
  clock.setInstant(true);
  await asActor(SYSTEM_ACTOR, async () => {
    await ensureServices();
    await loadServiceCache();
    await ensureCoreLedger();
    await db.branches.put({ id: 'BR-VEL', code: 'BR-101', name: 'Vellinghast Main Hall', city: 'Vellinghast', address: '1 Exchequer Sq', hours: '', weekendHours: '', services: ['cash', 'fx', 'atm'], status: 'open', map: { x: 0, y: 0 }, phone: '', managerName: '', cashAccountId: 'GL:CASH:BR-VEL', opened: '1347' });
  });
}

let n = 0;
export async function makeUser(name: string, kyc: User['kycStatus'] = 'verified', roles: User['roles'] = ['client']): Promise<User> {
  n++;
  const u: User = {
    id: `USR-T${n}`, clientId: `ALD-C-9${String(n).padStart(5, '0')}`, kind: roles.includes('client') && roles.length === 1 ? 'client' : 'staff', roles, name,
    email: `t${n}@test.aldermoor`, phone: '+0', address: { line1: '', city: 'Vellinghast', province: '', postal: '', realm: 'Aldermoor' }, registeredAt: new Date().toISOString(),
    status: 'active', passwordHash: await hashSecret('password1', 'salt'), salt: 'salt', twoFactor: { enabled: false }, preferences: defaultPreferences(), kycStatus: kyc,
    segment: 'retail', dailyLimitUSD: 5_000_000, usualRealms: ['ALD'], avatarHue: 0, failedLogins: 0, onboarded: true, branchId: 'BR-VEL',
  };
  await db.users.add(u);
  await db.devices.put({ id: `DEV-${u.id}`, userId: u.id, label: 'test', platform: 'test', fingerprint: 'x', firstSeen: '', lastSeen: '', trusted: 1 });
  return u;
}

export function actorOf(u: User): Actor {
  return { userId: u.id, name: u.name, roles: u.roles, deviceId: `DEV-${u.id}`, ip: '10.0.0.9' };
}

export async function fund(acc: Account, major: number, ccy = acc.currency) {
  const amount = toMinor(major, ccy);
  await asActor(SYSTEM_ACTOR, () =>
    execute({
      draft: { type: 'opening', amount, currency: ccy, toAccountId: acc.id, sender: { name: 'Test' }, recipient: { name: acc.name }, description: 'fund', category: 'income', channel: 'system' },
      screen: false, receipt: false, notifyParties: false,
      plan: () => [{ memo: 'fund', allowOverdraft: true, lines: [{ accountId: GL.CENTRAL, currency: ccy, side: 'D', amount }, { accountId: acc.id, currency: ccy, side: 'C', amount }] }],
    }),
  );
}

export async function accountFor(u: User, currency = 'CRWN', type: Account['type'] = 'current', extra: Record<string, unknown> = {}) {
  return asActor(SYSTEM_ACTOR, () => openAccount({ ownerId: u.id, type, currency, silent: true, ...extra }));
}
