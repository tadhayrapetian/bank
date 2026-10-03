/**
 * Demo world generator. Builds ~100 days of history for the Exchequer of
 * Aldermoor by calling the REAL banking services under a frozen, back-dated
 * clock — so every balance is derived from ledger journals, every operation
 * has its timeline, receipts, notifications and audit records.
 * All people, accounts, cards and documents are fictional.
 */
import { db, setMeta } from '../db/db';
import { clock, todayKey } from '../clock';
import { asActor, placeholderIp, SYSTEM_ACTOR, type Actor } from '../context';
import { hashSecret, newSalt } from '../util/crypto';
import { prng, pick, uid } from '../util/random';
import { DEFAULT_SETTINGS, setSettingsCache } from '../settings';
import { ensureServices, loadServiceCache } from '../ops/system';
import { syslog } from '../ops/audit';
import { setNotificationsMuted, sendMail } from '../comms/notify';
import { ensureCoreLedger, ensureInternalAccount, GL, openAccount } from '../banking/accounts';
import { execute } from '../banking/engine';
import { exchange } from '../banking/fx';
import { transfer, transferOwn, saveTemplate, scheduleTransfer, requestMoney, payRequest, declineRequest, createPaymentLink, payLink } from '../banking/payments';
import { submitInternational, advanceInternational } from '../banking/international';
import { issueCard, cardPayment, freezeCard, replaceCard } from '../banking/cards';
import { atmWithdraw, tellerCashDeposit, tellerCashWithdrawal, tellerAcceptDocument } from '../banking/cash';
import { createCheck, signCheck, stampCheck, issueCheck, presentCheck, cancelCheck } from '../banking/checks';
import { openDeposit, closeDeposit } from '../banking/deposits';
import { applyLoan, acceptAndDisburse, drawCreditLine, payOffEarly, getLoanOrThrow } from '../banking/loans';
import { INSTRUMENTS, placeOrder } from '../banking/investments';
import { createInvoice, sendInvoice, payInvoice, cancelInvoice } from '../banking/invoices';
import { createRecurring, addSubscription, setBudget } from '../banking/recurring';
import { createCompany, openCompanyAccount, addCompanyMember, addStaff, createBusinessPayment, decideApproval, preparePayroll, createFamily, addFamilyMember, openFamilyAccount } from '../banking/business';
import { buyPolicy, fileClaim, decideClaim, openDispute, setDisputeStatus, submitKyc, rentVault, openVault, depositVaultItem, closeVault, fileDeclaration } from '../banking/services';
import { openTicket, sendTicketMessage } from '../comms/messenger';
import { generateStatement, generateDocument } from '../docs/statements';
import { createDocument, signDocument } from '../docs/documents';
import { syntheticSignature } from '../docs/strokes';
import { runEndOfDay } from '../ops/scheduler';
import { defaultPreferences } from '../security/auth';
import { MERCHANTS, SUBSCRIPTION_SERVICES } from '../institution';
import { archiveCode, shelfMark } from '../banking/numbers';
import { ARCHIVE_CASES, BRANCHES, CLIENTS, EMPLOYEES, STAFF } from './people';
import { toMinor } from '../currency/format';
import type { Account, Card, User } from '../types';

export const DEMO_PASSWORD = 'aldermoor';
export const STAFF_PASSWORD = 'exchequer';
export const DEMO_PIN = '1234';

const H = 3_600_000;
const D = 86_400_000;
export const HISTORY_DAYS = 100;

export interface SeedProgress {
  (pct: number, label: string): void;
}

export async function seedDemo(progress: SeedProgress = () => {}) {
  const realNow = Date.now() + clock.getOffset();
  const today0 = Date.UTC(new Date(realNow).getUTCFullYear(), new Date(realNow).getUTCMonth(), new Date(realNow).getUTCDate());
  const START = today0 - HISTORY_DAYS * D;
  const R = prng(20261002);
  const warnings: string[] = [];
  const at = (d: number, h = 10, m = 0) => clock.freeze(START + d * D + h * H + m * 60_000);
  const dayKeyOf = (d: number) => new Date(START + d * D).toISOString().slice(0, 10);
  const users: Record<string, User> = {};
  const acc: Record<string, Account> = {};
  const card: Record<string, Card> = {};
  const actorOf = (u: User): Actor => ({ userId: u.id, name: u.name, roles: u.roles, deviceId: `DEV-SEED-${u.clientId}`, ip: placeholderIp(u.id) });
  const as = <T,>(key: string, fn: () => Promise<T>) => asActor(actorOf(users[key]), fn);
  const safe = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code ?? (e instanceof Error ? e.message : String(e));
      warnings.push(`${label}: ${code}`);
      return undefined;
    }
  };
  const amt = (major: number, ccy = 'CRWN') => toMinor(major, ccy);

  clock.setInstant(true);
  setNotificationsMuted(true);
  try {
    await asActor(SYSTEM_ACTOR, async () => {
      progress(2, 'seed.charter');
      at(0, 6);
      await setMeta('settings', DEFAULT_SETTINGS);
      setSettingsCache(DEFAULT_SETTINGS);
      await ensureServices();
      await loadServiceCache();
      await ensureCoreLedger();
      await db.instruments.bulkPut(INSTRUMENTS);

      /* ── Branches, vault cash, ATMs ── */
      progress(5, 'seed.branches');
      let gl = 10;
      for (const b of BRANCHES) {
        const cash = await ensureInternalAccount(GL.cash(b.id), `Cash vault — ${b.name}`, 'debit', `11${gl++}`, b.id);
        await db.branches.put({ ...b, cashAccountId: cash.id });
        const atmCount = b.services.includes('atm') ? (b.id === 'BR-VEL' || b.id === 'BR-ELS' ? 2 : 1) : 0;
        for (let i = 1; i <= atmCount; i++) {
          const id = `ATM-${b.code.replace('BR-', '')}-${i}`;
          const a = await ensureInternalAccount(GL.atm(id), `ATM ${id} cassettes`, 'debit', `12${gl++}`, b.id);
          await db.atms.put({ id, code: id, branchId: b.id, name: `${b.name} ATM ${i}`, status: b.status === 'maintenance' ? 'maintenance' : 'online', currencies: b.services.includes('fx') ? ['CRWN', 'USD', 'EUR'] : ['CRWN'], cashAccountId: a.id });
        }
      }
      const reserve: [string, number][] = [['CRWN', 80_000_000], ['USD', 12_000_000], ['EUR', 9_000_000], ['GBP', 3_000_000], ['CHF', 2_000_000], ['JPY', 400_000_000], ['MSLV', 6_000_000], ['EMBR', 900_000], ['STAR', 2_000_000], ['GRFN', 3_000_000], ['XAU', 4_000], ['AMD', 900_000_000], ['RUB', 40_000_000], ['VEIL', 20_000]];
      await execute({
        draft: { type: 'opening', amount: amt(80_000_000), currency: 'CRWN', sender: { name: 'Exchequer Capital' }, recipient: { name: 'Central Bullion Reserve' }, description: 'Founding capital of the Exchequer reserves', category: 'other', channel: 'system', refPrefix: 'GEN' },
        screen: false, receipt: false, notifyParties: false,
        plan: () => [{ memo: 'Founding reserves', allowOverdraft: true, lines: reserve.flatMap(([c, v]) => [
          { accountId: GL.CENTRAL, currency: c, side: 'D' as const, amount: amt(v, c) },
          { accountId: GL.EQUITY, currency: c, side: 'C' as const, amount: amt(v, c) },
        ]) }],
      });
      for (const b of await db.branches.toArray()) {
        const lines = [
          { c: 'CRWN', v: b.id === 'BR-VEL' ? 900_000 : 250_000 },
          ...(b.services.includes('fx') ? [{ c: 'USD', v: 60_000 }, { c: 'EUR', v: 50_000 }] : []),
        ];
        await execute({
          draft: { type: 'cash_transfer', amount: amt(lines[0].v), currency: 'CRWN', fromAccountId: GL.CENTRAL, toAccountId: b.cashAccountId, sender: { name: 'Central Bullion Reserve' }, recipient: { name: b.name }, description: `Cash allocation to ${b.name}`, category: 'cash', channel: 'branch', refPrefix: 'CMS' },
          screen: false, receipt: false, notifyParties: false,
          plan: () => [{ memo: 'Branch cash allocation', allowOverdraft: true, lines: lines.flatMap((l) => [
            { accountId: b.cashAccountId, currency: l.c, side: 'D' as const, amount: amt(l.v, l.c) },
            { accountId: GL.CENTRAL, currency: l.c, side: 'C' as const, amount: amt(l.v, l.c) },
          ]) }],
        });
      }
      for (const atm of await db.atms.toArray()) {
        const b = (await db.branches.get(atm.branchId))!;
        const crwn = atm.branchId === 'BR-GLM' ? 1_500 : 60_000;
        await execute({
          draft: { type: 'cash_transfer', amount: amt(crwn), currency: 'CRWN', fromAccountId: b.cashAccountId, toAccountId: atm.cashAccountId, sender: { name: b.name }, recipient: { name: `ATM ${atm.code}` }, description: `Cassette load ${atm.code}`, category: 'cash', channel: 'branch', refPrefix: 'CMS' },
          screen: false, receipt: false, notifyParties: false,
          plan: () => [{ memo: 'ATM cassette load', allowOverdraft: true, lines: [
            { accountId: atm.cashAccountId, currency: 'CRWN', side: 'D', amount: amt(crwn) },
            { accountId: b.cashAccountId, currency: 'CRWN', side: 'C', amount: amt(crwn) },
            ...atm.currencies.filter((c) => c !== 'CRWN').flatMap((c) => [
              { accountId: atm.cashAccountId, currency: c, side: 'D' as const, amount: amt(8_000, c) },
              { accountId: b.cashAccountId, currency: c, side: 'C' as const, amount: amt(8_000, c) },
            ]),
          ] }],
        });
      }

      /* ── People ── */
      progress(10, 'seed.people');
      let clientNo = 104700;
      for (const c of CLIENTS) {
        const salt = newSalt();
        const u: User = {
          id: `USR-${c.key.toUpperCase()}`, clientId: `ALD-C-${++clientNo}`, kind: 'client', roles: ['client'], name: c.name, honorific: c.honorific,
          email: c.email, phone: `+0 (7${String(clientNo).slice(-2)}) ${String(100 + (clientNo % 900)).padStart(3, '0')}-${String(1000 + ((clientNo * 37) % 9000)).slice(0, 4)}`,
          address: { line1: c.street, city: c.city, province: 'Vale of ' + c.city.split(' ')[0], postal: `AL${10 + (clientNo % 89)} ${(clientNo % 9) + 1}QX`, realm: 'Sovereign Commonwealth of Aldermoor' },
          dob: c.dob, registeredAt: new Date(START - (400 + Math.floor(R() * 3000)) * D).toISOString(), status: 'active', passwordHash: await hashSecret(DEMO_PASSWORD, salt), salt,
          twoFactor: { enabled: false }, preferences: { ...defaultPreferences(c.lang, 'ministry', 'CRWN') }, kycStatus: c.kyc, segment: c.segment,
          dailyLimitUSD: c.segment === 'premium' ? 15_000_000 : c.segment === 'minor' ? 5_000 : DEFAULT_SETTINGS.defaultDailyLimitUSD, usualRealms: c.realms, occupation: c.occupation,
          avatarHue: Math.floor(R() * 360), failedLogins: 0, onboarded: true, branchId: pick(R, BRANCHES).id,
        };
        if (c.key === 'aurelia') u.branchId = 'BR-VEL';
        await db.users.add(u);
        users[c.key] = u;
        await db.devices.put({ id: `DEV-SEED-${u.clientId}`, userId: u.id, label: 'Exchequer Ledger-Slate (home)', platform: 'Arcane Slate', fingerprint: `DEV-SEED-${u.clientId}`, firstSeen: u.registeredAt, lastSeen: u.registeredAt, trusted: 1 });
        if (c.kyc !== 'not_started') {
          const issue = c.kyc === 'expired' ? '2014-03-01' : '2021-05-10';
          const exp = c.kyc === 'expired' ? '2024-03-01' : '2031-05-10';
          await db.kyc.add({
            id: uid('KYC'), userId: u.id, docType: 'passport', docNumber: `ALD-P-${String(7_300_000 + clientNo * 7).slice(-7)}`, issuedBy: 'Passport Office of Aldermoor',
            issueDate: issue, expiryDate: exp, status: c.kyc === 'pending' ? 'pending' : c.kyc, submittedAt: new Date(START - 300 * D).toISOString(),
            reviewedAt: c.kyc === 'pending' ? undefined : new Date(START - 290 * D).toISOString(), reviewedBy: c.kyc === 'pending' ? undefined : 'Ilsa Morrow',
            reason: c.kyc === 'rejected' ? 'Photograph does not match the bearer; please resubmit.' : undefined, fileName: 'passport-scan.demo',
          });
          if (c.kyc === 'verified') {
            await db.kyc.add({
              id: uid('KYC'), userId: u.id, docType: 'address_proof', docNumber: `UTIL-${clientNo}`, issuedBy: 'Vellinghast Lamplighters Co.', issueDate: '2026-01-05',
              expiryDate: '2027-01-05', status: 'verified', submittedAt: new Date(START - 280 * D).toISOString(), reviewedAt: new Date(START - 279 * D).toISOString(), reviewedBy: 'Ilsa Morrow', fileName: 'lamp-bill.demo',
            });
          }
        }
      }
      let staffNo = 2000;
      for (const s of STAFF) {
        const salt = newSalt();
        const u: User = {
          id: `USR-${s.key.toUpperCase()}`, clientId: `ALD-S-${++staffNo}`, kind: 'staff', roles: [s.role, 'client'], name: s.name, email: s.email, phone: `+0 (101) 400-${staffNo}`,
          address: { line1: 'Exchequer Square 1', city: 'Vellinghast', province: 'Crown Vale', postal: 'AL1 1EX', realm: 'Sovereign Commonwealth of Aldermoor' },
          registeredAt: new Date(START - 2000 * D).toISOString(), status: 'active', passwordHash: await hashSecret(STAFF_PASSWORD, salt), salt, twoFactor: { enabled: false },
          preferences: defaultPreferences('en', s.role === 'admin' ? 'night' : 'ministry', 'CRWN'), kycStatus: 'verified', segment: 'staff', dailyLimitUSD: DEFAULT_SETTINGS.defaultDailyLimitUSD,
          usualRealms: ['ALD'], occupation: s.position, employeeId: s.employeeId, branchId: s.key === 'vantress' ? 'BR-HLM' : 'BR-VEL', avatarHue: Math.floor(R() * 360), failedLogins: 0, onboarded: true,
        };
        await db.users.add(u);
        users[s.key] = u;
        await db.devices.put({ id: `DEV-SEED-${u.clientId}`, userId: u.id, label: 'Exchequer Clerk Terminal', platform: 'Arcane Slate', fingerprint: `DEV-SEED-${u.clientId}`, firstSeen: u.registeredAt, lastSeen: u.registeredAt, trusted: 1 });
      }
      await setMeta('counter-seeded', true);
      await db.counters.put({ name: 'client-id', value: clientNo });
      for (const e of EMPLOYEES) {
        const userId = Object.values(users).find((u) => u.employeeId === e.employeeId)?.id;
        await db.employees.add({ ...e, id: uid('EMP'), userId });
      }

      /* ── Accounts & opening balances ── */
      progress(16, 'seed.accounts');
      const open = async (key: string, name: string, type: Account['type'], ccy: string, balances: [string, number][], extra: Partial<Parameters<typeof openAccount>[0]> = {}) => {
        const u = users[key];
        const a = await openAccount({ ownerId: u.id, type, currency: ccy, name, branchId: u.branchId, silent: key !== 'aurelia', multiCurrency: balances.length > 1 || extra.multiCurrency, ...extra });
        for (const [c, v] of balances) {
          if (!v) continue;
          await execute({
            draft: { type: 'opening', amount: amt(v, c), currency: c, toAccountId: a.id, sender: { name: 'Old Ledger migration' }, recipient: { name: u.name, accountNumber: a.number }, description: 'Opening balance migrated from the Old Ledger', category: 'income', channel: 'system', refPrefix: 'MIG' },
            screen: false, receipt: false, notifyParties: false,
            plan: () => [{ memo: 'Opening balance', allowOverdraft: true, lines: [{ accountId: GL.CENTRAL, currency: c, side: 'D', amount: amt(v, c) }, { accountId: a.id, currency: c, side: 'C', amount: amt(v, c) }] }],
          });
        }
        return a;
      };
      at(0, 8);
      acc.aMain = await open('aurelia', 'Crown Current', 'current', 'CRWN', [['CRWN', 18_500], ['USD', 2_400], ['EUR', 1_150]], { multiCurrency: true });
      acc.aSav = await open('aurelia', 'Lantern Savings', 'savings', 'CRWN', [['CRWN', 42_000]]);
      acc.aUsd = await open('aurelia', 'Northmarch Dollar Account', 'current', 'USD', [['USD', 6_800]]);
      acc.aReserve = await open('aurelia', 'Rainy-Day Reserve', 'reserve', 'CRWN', [['CRWN', 25_000]]);
      acc.aVault = await open('aurelia', 'Undervault Gold', 'vault', 'XAU', [['XAU', 12.5]]);
      acc.aTemp = await open('aurelia', 'Moonward Travel Purse', 'temporary', 'MSLV', [['MSLV', 900]], { expiresInDays: 140 });
      acc.aCredit = await open('aurelia', 'SIGIL Crimson Credit', 'credit', 'CRWN', [], { overdraftLimit: amt(5_000) });
      acc.eMain = await open('evander', 'Everyday Current', 'current', 'CRWN', [['CRWN', 6_200]]);
      acc.aJoint = await open('aurelia', 'Household Joint', 'joint', 'CRWN', [['CRWN', 7_300]], { coOwnerIds: [users.evander.id] });
      acc.hMain = await open('hugo', 'Current', 'current', 'CRWN', [['CRWN', 6_800]]);
      acc.aEscrow = await open('aurelia', 'Annex Purchase Escrow', 'escrow', 'CRWN', [['CRWN', 15_000]], { escrow: { beneficiaryId: users.hugo.id, beneficiaryName: users.hugo.name, condition: 'Release on registration of title to the Lantern Row annex', released: false } });
      acc.cMain = await open('corvin', 'Current', 'current', 'CRWN', [['CRWN', 4_100]]);
      acc.cSav = await open('corvin', 'Savings', 'savings', 'CRWN', [['CRWN', 9_000]]);
      acc.mMain = await open('mirela', 'Current', 'current', 'CRWN', [['CRWN', 7_800]]);
      acc.mChf = await open('mirela', 'Brask Franc Account', 'current', 'CHF', [['CHF', 3_200]]);
      acc.tMain = await open('tobiah', 'Current', 'current', 'CRWN', [['CRWN', 640]]);
      acc.sMain = await open('seraphina', 'Premier Current', 'current', 'CRWN', [['CRWN', 31_000], ['STAR', 2_000]], { multiCurrency: true });
      acc.sSav = await open('seraphina', 'Premier Savings', 'savings', 'CRWN', [['CRWN', 120_000]]);
      acc.lMain = await open('lysander', 'Current', 'current', 'CRWN', [['CRWN', 3_900]]);
      acc.oMain = await open('ondine', 'Current', 'current', 'CRWN', [['CRWN', 2_300]]);
      acc.caMain = await open('caspian', 'Current', 'current', 'CRWN', [['CRWN', 5_600]]);
      acc.caEmb = await open('caspian', 'Ember Coast Account', 'current', 'EMBR', [['EMBR', 1_200]]);
      acc.rMain = await open('rosalind', 'Current', 'current', 'CRWN', [['CRWN', 22_000]]);
      acc.rGrf = await open('rosalind', 'Griffonmere Ducat Account', 'savings', 'GRFN', [['GRFN', 4_000]]);
      acc.taMain = await open('tatev', 'Current', 'current', 'CRWN', [['CRWN', 3_300]]);
      acc.taAmd = await open('tatev', 'Talvenor Dram Account', 'current', 'AMD', [['AMD', 1_450_000]]);
      acc.msMain = await open('mstislav', 'Current', 'current', 'CRWN', [['CRWN', 9_400]]);
      acc.msBiz = await open('mstislav', 'Korvin-Lebedev Shipwrights', 'business', 'CRWN', [['CRWN', 48_000]]);
      acc.iMain = await open('imogen', 'Current', 'current', 'CRWN', [['CRWN', 4_500]]);
      acc.bMain = await open('barnaby', 'Current', 'current', 'CRWN', [['CRWN', 1_900]]);
      acc.pMain = await open('philippa', 'Current', 'current', 'CRWN', [['CRWN', 6_100]]);
      acc.thMain = await open('thaddeus', 'Current', 'current', 'CRWN', [['CRWN', 1_200]]);
      acc.wMain = await open('wilhelmina', 'Current', 'current', 'CRWN', [['CRWN', 800]]);
      acc.gMain = await open('gideon', 'Current', 'current', 'CRWN', [['CRWN', 5_000], ['USD', 8_000]], { multiCurrency: true });
      acc.elMain = await open('elodie', 'Current', 'current', 'CRWN', [['CRWN', 2_700]]);
      acc.hBiz = await open('hugo', 'Brambleworth Grocers', 'business', 'CRWN', [['CRWN', 35_000]]);
      acc.sbMain = await open('sabine', 'Current', 'current', 'CRWN', [['CRWN', 450]]);
      for (const s of STAFF) acc[`staff_${s.key}`] = await open(s.key, 'Salary Account', 'current', 'CRWN', [['CRWN', 3_000 + Math.floor(R() * 4_000)]]);

      /* ── Company & family ── */
      progress(22, 'seed.business');
      const company = await as('aurelia', () => createCompany({ name: 'Thornwood & Vale Alchemical Works', sector: 'Alchemy & apothecary supplies', currency: 'CRWN' }));
      acc.biz = (await db.accounts.get(company.accountIds[0]))!;
      await as('aurelia', async () => {
        await addCompanyMember(company.id, users.mirela.clientId, 'manager');
        await addCompanyMember(company.id, users.imogen.clientId, 'accountant');
        await addCompanyMember(company.id, users.barnaby.clientId, 'employee');
        await addCompanyMember(company.id, users.philippa.clientId, 'auditor');
        acc.bizReserve = await openCompanyAccount(company.id, 'reserve', 'CRWN', 'Thornwood & Vale · Reserve');
        acc.bizUsd = await openCompanyAccount(company.id, 'business', 'USD', 'Thornwood & Vale · Northmarch Dollars');
      });
      for (const [a, ccy, v] of [[acc.biz, 'CRWN', 85_000], [acc.bizReserve, 'CRWN', 40_000], [acc.bizUsd, 'USD', 12_000]] as [Account, string, number][]) {
        await execute({
          draft: { type: 'opening', amount: amt(v, ccy), currency: ccy, toAccountId: a.id, sender: { name: 'Old Ledger migration' }, recipient: { name: a.name, accountNumber: a.number }, description: 'Opening balance migrated from the Old Ledger', category: 'income', channel: 'system', refPrefix: 'MIG' },
          screen: false, receipt: false, notifyParties: false,
          plan: () => [{ memo: 'Opening balance', allowOverdraft: true, lines: [{ accountId: GL.CENTRAL, currency: ccy, side: 'D', amount: amt(v, ccy) }, { accountId: a.id, currency: ccy, side: 'C', amount: amt(v, ccy) }] }],
        });
      }
      await as('aurelia', async () => {
        for (const [k, pos, sal] of [['barnaby', 'Laboratory Assistant', 2_600], ['imogen', 'Company Accountant', 4_800], ['mirela', 'Operations Manager', 5_600], ['lysander', 'Retort Engineer', 3_300], ['ondine', 'Herbal Supplier Liaison', 2_100], ['elodie', 'Label Illustrator', 2_900]] as [string, string, number][]) {
          const target = Object.values(acc).find((a) => a.ownerId === users[k].id && a.type === 'current')!;
          await addStaff(company.id, { name: users[k].name, position: pos, salary: amt(sal), currency: 'CRWN', paymentDay: 28, accountNumber: target.number });
        }
      });

      /* ── Cards ── */
      progress(26, 'seed.cards');
      const issue = async (key: string, a: Account, type: Card['type'], extra: Partial<Parameters<typeof issueCard>[0]> = {}) =>
        issueCard({ accountId: a.id, type, pin: DEMO_PIN, ownerId: users[key].id, silent: key !== 'aurelia', ...extra });
      card.aDebit = await issue('aurelia', acc.aMain, 'debit');
      card.aPremium = await issue('aurelia', acc.aMain, 'premium');
      card.aVirtual = await issue('aurelia', acc.aMain, 'virtual');
      card.aCredit = await issue('aurelia', acc.aCredit, 'credit');
      card.aVault = await issue('aurelia', acc.aVault, 'vault');
      card.aBiz = await issue('aurelia', acc.biz, 'business', { companyId: company.id });
      for (const [k, a] of [['evander', acc.eMain], ['corvin', acc.cMain], ['mirela', acc.mMain], ['tobiah', acc.tMain], ['seraphina', acc.sMain], ['lysander', acc.lMain], ['ondine', acc.oMain], ['caspian', acc.caMain], ['rosalind', acc.rMain], ['tatev', acc.taMain], ['mstislav', acc.msMain], ['imogen', acc.iMain], ['barnaby', acc.bMain], ['philippa', acc.pMain], ['thaddeus', acc.thMain], ['wilhelmina', acc.wMain], ['gideon', acc.gMain], ['elodie', acc.elMain], ['hugo', acc.hMain], ['sabine', acc.sbMain]] as [string, Account][]) {
        card[`${k}Debit`] = await issue(k, a, 'debit');
      }
      card.sPremium = await issue('seraphina', acc.sMain, 'premium');
      card.msBiz = await issue('mstislav', acc.msBiz, 'business');
      // international usage enabled for well-travelled clients
      for (const k of ['aDebit', 'sPremium', 'seraphinaDebit', 'caspianDebit', 'mstislavDebit']) {
        const c = card[k];
        await db.cards.update(c.id, { controls: { ...c.controls, international: true } });
        card[k] = (await db.cards.get(c.id))!;
      }

      /* ── Family ── */
      await as('aurelia', async () => {
        const fam = await createFamily('Thornwood–Lisle Household');
        await addFamilyMember(fam.id, users.evander.clientId, 'spouse', 'adult', 0, 'CRWN');
        await addFamilyMember(fam.id, users.pip.clientId, 'son', 'child', amt(25), 'CRWN');
        acc.pipMain = await openFamilyAccount(fam.id, users.pip.id, 'CRWN');
        card.pipDebit = await issueCard({ accountId: acc.pipMain.id, type: 'debit', pin: DEMO_PIN, ownerId: users.pip.id, holderName: 'PIP THORNWOOD', silent: true });
      });
      await as('aurelia', () => transfer({ fromAccountId: acc.aMain.id, currency: 'CRWN', amount: amt(120), recipient: { accountNumber: acc.pipMain.number }, description: 'First allowance', skipScreen: true }));

      /* ── Standing arrangements: subscriptions, recurring, templates, budgets ── */
      progress(30, 'seed.standing');
      const subs: [string, Account, number, number][] = [['aurelia', acc.aMain, 0, 3], ['aurelia', acc.aMain, 1, 5], ['aurelia', acc.aMain, 3, 9], ['aurelia', acc.aMain, 6, 12], ['aurelia', acc.biz, 4, 7], ['corvin', acc.cMain, 2, 4], ['seraphina', acc.sMain, 1, 6], ['mirela', acc.mMain, 0, 8], ['evander', acc.eMain, 5, 2], ['rosalind', acc.rMain, 3, 11]];
      for (const [k, a, idx, day] of subs) {
        const s = SUBSCRIPTION_SERVICES[idx];
        await as(k, () => addSubscription({ service: s.service, plan: s.plan, amount: amt(s.amount, s.currency), currency: s.currency, accountId: a.id, period: s.period, startDate: dayKeyOf(day), hue: s.hue }));
      }
      const pausedSub = await db.subscriptions.where('ownerId').equals(users.rosalind.id).first();
      at(0, 9);
      await as('aurelia', async () => {
        await createRecurring({ fromAccountId: acc.aMain.id, currency: 'CRWN', amount: amt(1_450), recipientAccount: acc.hMain.number, recipientName: 'Brambleworth Estates (H. Brambleworth)', frequency: 'monthly', startDate: dayKeyOf(1), description: 'Rent — Lantern Row studio', category: 'housing' });
        await createRecurring({ fromAccountId: acc.aMain.id, currency: 'CRWN', amount: amt(15), recipientAccount: acc.pipMain.number, recipientName: 'Pip Thornwood', frequency: 'weekly', startDate: dayKeyOf(4), description: 'Pocket money', category: 'transfers' });
        await createRecurring({ fromAccountId: acc.aMain.id, currency: 'CRWN', amount: amt(500), recipientAccount: acc.aSav.number, recipientName: 'Lantern Savings', frequency: 'monthly', startDate: dayKeyOf(2), description: 'Monthly savings sweep', category: 'savings' });
        await createRecurring({ fromAccountId: acc.aMain.id, currency: 'CRWN', amount: amt(40), recipientAccount: acc.rMain.number, recipientName: 'Dr Rosalind Pembrook', frequency: 'monthly', startDate: dayKeyOf(HISTORY_DAYS + 10), endDate: dayKeyOf(HISTORY_DAYS + 200), description: 'Physician retainer', category: 'apothecary' });
        await saveTemplate({ name: 'Rent — Brambleworth Estates', fromAccountId: acc.aMain.id, currency: 'CRWN', amount: amt(1_450), recipientAccount: acc.hMain.number, recipientName: users.hugo.name, description: 'Rent' });
        await saveTemplate({ name: 'Pip pocket money', fromAccountId: acc.aMain.id, currency: 'CRWN', amount: amt(20), recipientAccount: acc.pipMain.number, recipientName: users.pip.name, description: 'Pocket money' });
        await saveTemplate({ name: 'Evander — joint top-up', fromAccountId: acc.aMain.id, currency: 'CRWN', recipientAccount: acc.eMain.number, recipientName: users.evander.name, description: 'Household' });
        for (const [cat, v] of [['groceries', 600], ['dining', 300], ['travel', 800], ['entertainment', 150], ['subscriptions', 80], ['apothecary', 120], ['shopping', 400], ['housing', 1_500]] as const) await setBudget(cat, amt(v), 'CRWN');
      });
      await as('tatev', () => createRecurring({ fromAccountId: acc.taMain.id, currency: 'CRWN', amount: amt(120), recipientAccount: acc.msMain.number, recipientName: users.mstislav.name, frequency: 'monthly', startDate: dayKeyOf(6), description: 'Loom repayment', category: 'other' }));
      await as('corvin', () => saveTemplate({ name: "Mother's allowance", fromAccountId: acc.cMain.id, currency: 'CRWN', amount: amt(200), recipientAccount: acc.oMain.number, recipientName: users.ondine.name, description: 'Allowance' }));

      /* ── Day-by-day history ── */
      const spenders = CLIENTS.filter((c) => c.spender > 0 && card[`${c.key}Debit`]);
      const externalEmployers: Record<string, string> = {
        aurelia: 'Royal Academy of Alchemy', corvin: 'Royal Cartographic Society', tobiah: 'Vellinghast Lamplighters Co.', seraphina: 'Brightwater Opera House',
        caspian: 'Ravensreach Antiquarian Society', rosalind: 'Oakhallow Infirmary', evander: 'Brask Clockmakers Guild', tatev: 'Thornbury Weavers Cooperative',
        mstislav: 'Elsinmoor Admiralty Yard', philippa: 'Chamber of Auditors (contract)', thaddeus: 'Gallowmere Cobblers Guild', wilhelmina: 'Oakhallow Parish',
        gideon: 'Nightjar Curios', hugo: 'Brambleworth Grocers (owner draw)', sabine: 'Aldermoor Telegraph Office',
      };
      const salaryAcct: Record<string, Account> = {
        aurelia: acc.aMain, corvin: acc.cMain, tobiah: acc.tMain, seraphina: acc.sMain, caspian: acc.caMain, rosalind: acc.rMain, evander: acc.eMain, tatev: acc.taMain,
        mstislav: acc.msMain, philippa: acc.pMain, thaddeus: acc.thMain, wilhelmina: acc.wMain, gideon: acc.gMain, hugo: acc.hMain, sabine: acc.sbMain,
      };
      const externalCredit = (a: Account, v: number, sender: string, desc: string, cat: 'salary' | 'income' | 'business' = 'salary', ccy = 'CRWN') =>
        execute({
          draft: { type: 'transfer', amount: v, currency: ccy, toAccountId: a.id, sender: { name: sender, bank: 'Aetherline participant' }, recipient: { name: a.name, accountNumber: a.number }, description: desc, category: cat, channel: 'network', refPrefix: 'AEL' },
          screen: false, receipt: true,
          plan: () => [{ memo: desc, allowOverdraft: true, lines: [{ accountId: GL.NOSTRO, currency: ccy, side: 'D', amount: v }, { accountId: a.id, currency: ccy, side: 'C', amount: v }] }],
        });

      const atmVel = (await db.atms.where('branchId').equals('BR-VEL').first())!;
      const atmEls = (await db.atms.where('branchId').equals('BR-ELS').first())!;
      const loanIds: Record<string, string> = {};
      const queue: { d: number; h: number; label: string; fn: () => Promise<unknown> }[] = [];
      const defer = (d: number, h: number, label: string, fn: () => Promise<unknown>) => queue.push({ d, h, label, fn });
      let gideonDrain: string | null = null;
      let invoiceNo = 0;
      const sig = (k: string) => syntheticSignature(users[k].name);
      const checkFlow = async (issuer: string, from: Account, payee: string, payeeAcc: Account | null, payeeName: string, v: number, purpose: string, presentAfter: number | null, d: number, extra: { seal?: string; validity?: number; hand?: boolean } = {}) => {
        at(d, 11, Math.floor(R() * 50));
        const ch = await as(issuer, () => createCheck({ accountId: from.id, payeeName, payeeClientId: payee ? users[payee].clientId : undefined, amount: amt(v), purpose, validityDays: extra.validity }));
        await as(issuer, () => signCheck(ch.id, extra.hand === false ? 'electronic' : 'handwritten', extra.hand === false ? undefined : sig(issuer)));
        if (extra.seal) await as(issuer, () => stampCheck(ch.id, extra.seal!));
        await as(issuer, () => issueCheck(ch.id));
        if (presentAfter !== null && payeeAcc) {
          defer(d + presentAfter, 14, 'check.present', () => as(payee, () => presentCheck(ch.number, ch.verificationCode, payeeAcc.id)));
        }
        return ch;
      };

      for (let d = 1; d < HISTORY_DAYS; d++) {
        if (d % 10 === 0) progress(32 + Math.round((d / HISTORY_DAYS) * 52), 'seed.history');
        const date = new Date(START + d * D);
        const dom = date.getUTCDate();
        for (const ev of queue.filter((q) => q.d === d).sort((a, b) => a.h - b.h)) {
          at(d, ev.h, Math.floor(R() * 50));
          await safe(ev.label, ev.fn);
        }
        if (gideonDrain && dayKeyOf(d + 1) === gideonDrain) {
          at(d, 20);
          await safe('gideon drain', async () => {
            const { availableOf } = await import('../banking/ledger');
            const avail = await availableOf(acc.gMain.id, 'CRWN');
            if (avail > amt(20)) await as('gideon', () => exchange({ fromAccountId: acc.gMain.id, fromCurrency: 'CRWN', toAccountId: acc.gMain.id, toCurrency: 'USD', amount: Math.floor((avail - amt(20)) / 1.004) }));
          });
        }

        // salaries & income on the 25th
        if (dom === 25) {
          for (const [k, a] of Object.entries(salaryAcct)) {
            const c = CLIENTS.find((x) => x.key === k)!;
            at(d, 7, Math.floor(R() * 50));
            await safe('salary', () => externalCredit(a, Math.round(c.income * (0.95 + R() * 0.1)), externalEmployers[k], `Salary — ${externalEmployers[k]}`, k === 'hugo' || k === 'mstislav' ? 'business' : 'salary'));
          }
          at(d, 7, 55);
          await safe('biz revenue', () => externalCredit(acc.biz, amt(26_000 + Math.floor(R() * 9_000)), 'Apothecaries Guild of Aldermoor', 'Wholesale settlement — Apothecaries Guild', 'business'));
          await safe('hugo revenue', () => externalCredit(acc.hBiz, amt(14_000 + Math.floor(R() * 5_000)), 'Market Board of Vellinghast', 'Market stall takings', 'business'));
          await safe('ms revenue', () => externalCredit(acc.msBiz, amt(19_000 + Math.floor(R() * 6_000)), 'Elsinmoor Admiralty Yard', 'Hull commission', 'business'));
        }

        // payroll: prepared on the 26th, approved by manager & accountant on the 27th
        if (dom === 26) {
          at(d, 9);
          const prep = await safe('payroll.prepare', () => as('aurelia', () => preparePayroll(company.id, acc.biz.id, date.toISOString().slice(0, 7))));
          if (prep) {
            defer(d + 1, 10, 'payroll.mgr', () => as('mirela', () => decideApproval(prep.approval.id, 'approved', 'Headcount verified')));
            defer(d + 1, 15, 'payroll.acc', () => as('imogen', () => decideApproval(prep.approval.id, 'approved', 'Amounts agree to register')));
          }
        }

        // card spending
        for (const c of spenders) {
          if (R() > c.spender * (c.key === 'aurelia' ? 0.7 : 0.16)) continue;
          const cd = card[`${c.key}Debit`];
          if (!cd || cd.status !== 'active') continue;
          const local = R() < 0.82 || !c.realms.length || !cd.controls.international;
          const pool = MERCHANTS.filter((m) => (local ? m.realm === 'ALD' : c.realms.includes(m.realm) && m.realm !== 'ALD'));
          const m = pick(R, pool.length ? pool : MERCHANTS.filter((x) => x.realm === 'ALD'));
          const value = m.min + R() * (m.max - m.min);
          at(d, 9 + Math.floor(R() * 11), Math.floor(R() * 59));
          await safe('card', () => as(c.key, () => cardPayment({ cardId: (c.key === 'aurelia' && R() < 0.3 ? card.aPremium : cd).id, merchant: m.name, mcc: m.mcc, realm: m.realm, amount: amt(Math.round(value * 100) / 100, m.currency), currency: m.currency, channel: pick(R, ['contactless', 'chip', 'online'] as const), category: m.category, settleNow: true })));
        }
        if (d % 9 === 3) {
          at(d, 19, 12);
          await safe('credit card', () => as('aurelia', () => cardPayment({ cardId: card.aCredit.id, merchant: 'Hotel Astraea, Celestine', mcc: '7011', realm: 'ALD', amount: amt(180 + Math.floor(R() * 260)), currency: 'CRWN', channel: 'online', category: 'travel', settleNow: true })));
        }

        // peer transfers
        if (d % 4 === 1) {
          const [x, y] = [pick(R, spenders), pick(R, spenders)];
          if (x.key !== y.key && salaryAcct[x.key] && salaryAcct[y.key]) {
            at(d, 12, Math.floor(R() * 59));
            await safe('p2p', () => as(x.key, () => transfer({ fromAccountId: salaryAcct[x.key].id, currency: 'CRWN', amount: amt(15 + Math.floor(R() * 260)), recipient: { accountNumber: salaryAcct[y.key].number }, description: pick(R, ['Dinner at the Gilded Kettle', 'Theatre tickets', 'Share of the carriage', 'Birthday gift', 'Book club dues', 'Borrowed lantern oil']), category: 'transfers' })));
          }
        }
        if (d % 6 === 2) {
          at(d, 18, 30);
          await safe('a2e', () => as('aurelia', () => transfer({ fromAccountId: acc.aMain.id, currency: 'CRWN', amount: amt(80 + Math.floor(R() * 150)), recipient: { accountNumber: acc.aJoint.number }, description: 'Household joint top-up', category: 'transfers' })));
        }

        // scripted events
        await safe(`day ${d}`, async () => { switch (d) {
          case 1:
            at(d, 11);
            await as('aurelia', () => openDeposit({ sourceAccountId: acc.aSav.id, currency: 'CRWN', amount: amt(20_000), product: 'fixed', termMonths: 12 }));
            at(d, 12);
            await as('mstislav', () => openDeposit({ sourceAccountId: acc.msBiz.id, currency: 'CRWN', amount: amt(15_000), product: 'fixed', termMonths: 3 }));
            break;
          case 2:
            at(d, 10);
            await as('aurelia', () => exchange({ fromAccountId: acc.aMain.id, fromCurrency: 'CRWN', toAccountId: acc.aMain.id, toCurrency: 'USD', amount: amt(2_000) }));
            await as('seraphina', async () => {
              const l = await applyLoan({ type: 'mortgage', amount: amt(380_000), termMonths: 240, currency: 'CRWN', purpose: 'Purchase of Swan Crescent townhouse', payoutAccountId: acc.sMain.id, monthlyIncome: amt(12_500), collateral: '1 Crescent of Swans, Brightwater Spa' });
              loanIds.seraphina = l.id;
              if (l.status === 'approved') await acceptAndDisburse(l.id);
            });
            break;
          case 3:
            at(d, 10);
            await as('seraphina', () => openDeposit({ sourceAccountId: acc.sSav.id, currency: 'CRWN', amount: amt(60_000), product: 'fixed', termMonths: 24 }));
            await as('hugo', async () => {
              const l = await applyLoan({ type: 'business', amount: amt(45_000), termMonths: 36, currency: 'CRWN', purpose: 'Cold-cellar extension for the grocery', payoutAccountId: acc.hBiz.id, monthlyIncome: amt(14_000) });
              loanIds.hugo = l.id;
              if (l.status === 'approved') await acceptAndDisburse(l.id);
            });
            break;
          case 4:
            at(d, 9);
            await as('evander', () => openDeposit({ sourceAccountId: acc.eMain.id, currency: 'CRWN', amount: amt(2_000), product: 'fixed', termMonths: 3 }));
            break;
          case 5:
            at(d, 13);
            await as('aurelia', async () => {
              const l = await applyLoan({ type: 'personal', amount: amt(12_000), termMonths: 24, currency: 'CRWN', purpose: 'Distillation apparatus for the home laboratory', payoutAccountId: acc.aMain.id, monthlyIncome: amt(9_800) });
              loanIds.aurelia = l.id;
              if (l.status === 'approved') await acceptAndDisburse(l.id);
            });
            await safe('atm', () => as('aurelia', () => atmWithdraw(atmVel.id, card.aDebit.id, amt(300))));
            await as('aurelia', async () => {
              const v = await rentVault(3, 'M', 'BR-VEL', '314159', acc.aMain.id);
              await openVault(v.id, '314159');
              await depositVaultItem(v.id, 'Grandmother’s brass astrolabe', 'Heirloom, engraved 1789', amt(4_200), 'CRWN');
              await depositVaultItem(v.id, 'Deed to 14 Lantern Row', 'Original sealed deed', undefined, undefined);
              await depositVaultItem(v.id, 'Phial of phoenix ash', 'Certified by the Arcane Commodities Hall', amt(900), 'CRWN');
              await closeVault(v.id);
            });
            await checkFlow('rosalind', acc.rMain, 'philippa', null, users.philippa.name, 150, 'Audit of surgery accounts', null, d, { validity: 30 });
            break;
          case 6:
            at(d, 11);
            await as('rosalind', () => openDeposit({ sourceAccountId: acc.rMain.id, currency: 'CRWN', amount: amt(10_000), product: 'flex', termMonths: 12 }));
            await as('seraphina', async () => {
              const v = await rentVault(4, 'L', 'BR-BRW', '882211', acc.sMain.id);
              await openVault(v.id, '882211');
              await depositVaultItem(v.id, 'Opera diamond tiara', 'Worn at the Midwinter Gala', amt(68_000), 'CRWN');
              await depositVaultItem(v.id, 'Sheet music manuscripts', 'Autograph scores, 12 folios');
              await closeVault(v.id);
            });
            break;
          case 7:
            at(d, 16);
            await as('aurelia', () => transferOwn({ fromAccountId: acc.aMain.id, toAccountId: acc.aReserve.id, currency: 'CRWN', amount: amt(1_000), description: 'Top up the reserve' }));
            await as('aurelia', async () => {
              await buyPolicy('home', 'yearly', acc.aMain.id, '14 Lantern Row, Vellinghast');
              await buyPolicy('travel', 'monthly', acc.aMain.id, 'Aurelia Thornwood — Moonward Isles travel');
            });
            break;
          case 8:
            at(d, 10);
            await as('aurelia', async () => {
              const l = await applyLoan({ type: 'credit_line', amount: amt(8_000), termMonths: 24, currency: 'CRWN', purpose: 'Working credit line', payoutAccountId: acc.aMain.id, monthlyIncome: amt(9_800) });
              loanIds.aureliaLine = l.id;
              if (l.status === 'approved') await acceptAndDisburse(l.id);
            });
            await as('tatev', () => openDeposit({ sourceAccountId: acc.taAmd.id, currency: 'AMD', amount: amt(500_000, 'AMD'), product: 'fixed', termMonths: 12 }));
            break;
          case 9:
            at(d, 10, 30);
            await as('aurelia', () => exchange({ fromAccountId: acc.aMain.id, fromCurrency: 'USD', toAccountId: acc.aMain.id, toCurrency: 'EUR', amount: amt(500, 'USD') }));
            break;
          case 10:
            await as('corvin', async () => {
              at(d, 9);
              await openDeposit({ sourceAccountId: acc.cSav.id, currency: 'CRWN', amount: amt(5_000), product: 'fixed', termMonths: 6 });
              const l = await applyLoan({ type: 'personal', amount: amt(6_000), termMonths: 18, currency: 'CRWN', purpose: 'Surveying instruments', payoutAccountId: acc.cMain.id, monthlyIncome: amt(3_900) });
              loanIds.corvin = l.id;
              if (l.status === 'approved') await acceptAndDisburse(l.id);
            });
            await checkFlow('aurelia', acc.aMain, 'corvin', acc.cMain, users.corvin.name, 250, 'Map commission — Moonward coastline', 2, d, { seal: 'original' });
            at(d, 15);
            await as('quill', () => tellerCashDeposit('BR-VEL', acc.hBiz.id, 'CRWN', amt(2_400), 'Hugo Brambleworth'));
            break;
          case 12:
            at(d, 11);
            await as('caspian', () => openDeposit({ sourceAccountId: acc.caEmb.id, currency: 'EMBR', amount: amt(800, 'EMBR'), product: 'fixed', termMonths: 6 }));
            await as('mstislav', async () => {
              const l = await applyLoan({ type: 'business', amount: amt(70_000), termMonths: 48, currency: 'CRWN', purpose: 'New slipway at Ropewalk Quay', payoutAccountId: acc.msBiz.id, monthlyIncome: amt(19_000) });
              loanIds.mstislav = l.id;
              if (l.status === 'approved') await acceptAndDisburse(l.id);
            });
            break;
          case 14:
            at(d, 10);
            await as('aurelia', () => openDeposit({ sourceAccountId: acc.aUsd.id, currency: 'USD', amount: amt(2_000, 'USD'), product: 'growth', termMonths: 6 }));
            await as('aurelia', async () => {
              await placeOrder({ instrumentId: 'GRNG', side: 'buy', kind: 'market', quantity: 40, accountId: acc.aMain.id });
              await placeOrder({ instrumentId: 'ATB31', side: 'buy', kind: 'market', quantity: 40, accountId: acc.aMain.id });
              await placeOrder({ instrumentId: 'AEXF', side: 'buy', kind: 'market', quantity: 200, accountId: acc.aMain.id });
              await placeOrder({ instrumentId: 'PHXF', side: 'buy', kind: 'market', quantity: 5, accountId: acc.aMain.id });
              await placeOrder({ instrumentId: 'GOLD', side: 'buy', kind: 'market', quantity: 0.5, accountId: acc.aUsd.id });
            });
            break;
          case 15:
            at(d, 10);
            await safe('g.dep', () => as('gideon', () => openDeposit({ sourceAccountId: acc.gMain.id, currency: 'USD', amount: amt(3_000, 'USD'), product: 'fixed', termMonths: 6 })));
            await as('lysander', async () => {
              const l = await applyLoan({ type: 'personal', amount: amt(3_000), termMonths: 12, currency: 'CRWN', purpose: 'Workshop lathe', payoutAccountId: acc.lMain.id, monthlyIncome: amt(3_300) });
              loanIds.lysander = l.id;
              if (l.status === 'approved') await acceptAndDisburse(l.id);
            });
            await safe('s.brkc', () => as('seraphina', () => placeOrder({ instrumentId: 'BRKC', side: 'buy', kind: 'market', quantity: 20, accountId: acc.sMain.id })));
            await safe('s.stmb', () => as('seraphina', () => placeOrder({ instrumentId: 'STMB', side: 'buy', kind: 'market', quantity: 6, accountId: acc.sMain.id })));
            await safe('s.atb45', () => as('seraphina', () => placeOrder({ instrumentId: 'ATB45', side: 'buy', kind: 'market', quantity: 200, accountId: acc.sMain.id })));
            await safe('s.life', () => as('seraphina', () => buyPolicy('life', 'yearly', acc.sMain.id, 'Lady Seraphina Quell')));
            break;
          case 16:
            at(d, 11);
            await as('hugo', () => buyPolicy('business', 'monthly', acc.hBiz.id, 'Brambleworth Grocers premises'));
            await as('corvin', () => buyPolicy('device', 'monthly', acc.cMain.id, 'Brass theodolite No. 7'));
            break;
          case 20:
            await checkFlow('aurelia', acc.aMain, 'hugo', acc.hMain, users.hugo.name, 1_200, 'Annex survey deposit', 1, d, { seal: 'certified' });
            at(d, 10);
            await as('philippa', () => openDeposit({ sourceAccountId: acc.pMain.id, currency: 'CRWN', amount: amt(4_000), product: 'fixed', termMonths: 12 }));
            await safe('gideon loan', () => as('gideon', async () => {
              const l = await applyLoan({ type: 'personal', amount: amt(5_000), termMonths: 12, currency: 'CRWN', purpose: 'Stock for the curio shop', payoutAccountId: acc.gMain.id, monthlyIncome: amt(3_500) });
              loanIds.gideon = l.id;
              if (l.status === 'approved') {
                const active = await acceptAndDisburse(l.id);
                gideonDrain = active.schedule[1]?.dueDate ?? null;
              }
            }));
            break;
          case 22:
            await checkFlow('seraphina', acc.sMain, 'rosalind', acc.rMain, users.rosalind.name, 3_000, 'Gala charity pledge', 2, d);
            break;
          case 25:
            at(d, 13);
            await as('imogen', () => openDeposit({ sourceAccountId: acc.iMain.id, currency: 'CRWN', amount: amt(3_000), product: 'growth', termMonths: 12 }));
            break;
          case 30:
            at(d, 11);
            await as('aurelia', async () => {
              const tx = await submitInternational({ fromAccountId: acc.aMain.id, fromCurrency: 'EUR', currency: 'EUR', amount: amt(800, 'EUR'), recipientName: 'Atelier Verre-Lune', recipientAccount: 'VRN 4471 0099 2210', bankCode: 'LUNE-VRN-01', purpose: 'Glassware for the laboratory', reference: 'PO-1187' });
              for (let i = 0; i < 6; i++) { at(d, 12 + i * 2); await advanceInternational(tx.id); }
            });
            await as('hugo', () => openDeposit({ sourceAccountId: acc.hMain.id, currency: 'CRWN', amount: amt(3_000), product: 'flex', termMonths: 12 }));
            break;
          case 33:
            at(d, 10);
            await as('aurelia', () => exchange({ fromAccountId: acc.aMain.id, fromCurrency: 'CRWN', toAccountId: acc.aTemp.id, toCurrency: 'MSLV', amount: amt(1_500) }));
            await as('aurelia', () => drawCreditLine(loanIds.aureliaLine, acc.aMain.id, amt(1_800)));
            break;
          case 38:
            at(d, 11);
            await as('aurelia', () => placeOrder({ instrumentId: 'GRNG', side: 'sell', kind: 'market', quantity: 10, accountId: acc.aMain.id }));
            break;
          case 40:
            at(d, 9);
            await as('tobiah', async () => {
              const l = await applyLoan({ type: 'emergency', amount: amt(2_000), termMonths: 3, currency: 'CRWN', purpose: 'Roof repair after the storm', payoutAccountId: acc.tMain.id, monthlyIncome: amt(2_400) });
              loanIds.tobiah = l.id;
              if (l.status === 'approved') await acceptAndDisburse(l.id);
            });
            await safe('check.cancel', async () => {
              const ch = await as('caspian', () => createCheck({ accountId: acc.caMain.id, payeeName: users.gideon.name, payeeClientId: users.gideon.clientId, amount: amt(600), purpose: 'Curio lot 17' }));
              await as('caspian', () => signCheck(ch.id, 'electronic'));
              await as('caspian', () => issueCheck(ch.id));
              await as('caspian', () => cancelCheck(ch.id, 'Lot withdrawn from sale'));
            });
            at(d, 14);
            await as('quill', () => tellerCashWithdrawal('BR-VEL', acc.thMain.id, 'CRWN', amt(200), true));
            card.corvinDebit = await as('corvin', () => replaceCard(card.corvinDebit.id, 'lost', DEMO_PIN));
            break;
          case 45:
            at(d, 10);
            await as('quill', () => tellerAcceptDocument(users.rosalind.id, 'Notarised last will and testament', 'Sealed envelope lodged for safekeeping in the Hall of Sealed Records.'));
            await safe('freeze', () => as('caspian', () => freezeCard(card.caspianDebit.id)));
            card.caspianDebit = (await db.cards.get(card.caspianDebit.id))!;
            break;
          case 47:
            await safe('atm', () => { at(d, 18); return as('aurelia', () => atmWithdraw(atmVel.id, card.aDebit.id, amt(200))); });
            await safe('atm2', () => { at(d, 18, 20); return as('corvin', async () => atmWithdraw(atmEls.id, (await db.cards.where('ownerId').equals(users.corvin.id).filter((c) => c.status === 'active').first())!.id, amt(100))); });
            break;
          case 50:
            at(d, 10);
            await safe('biz.pay', async () => {
              const ap = await as('barnaby', () => createBusinessPayment({ companyId: company.id, fromAccountId: acc.biz.id, recipientAccount: acc.hBiz.number, recipientName: 'Brambleworth Grocers', amount: amt(2_400), description: 'Herb supply — quarter' }));
              at(d, 12); await as('mirela', () => decideApproval(ap.id, 'approved'));
              at(d, 16); await as('imogen', () => decideApproval(ap.id, 'approved'));
            });
            await safe('cashier check', async () => {
              const ch = await as('mstislav', () => createCheck({ accountId: acc.msBiz.id, payeeName: 'Port Elsinmoor Shipyards', amount: amt(10_000), purpose: 'Timber for the new slipway', kind: 'cashier' }));
              await as('quill', () => signCheck(ch.id, 'official'));
              await as('quill', () => stampCheck(ch.id, 'official_bank_seal'));
              await as('mstislav', () => issueCheck(ch.id));
            });
            break;
          case 55:
            at(d, 10);
            await as('seraphina', async () => {
              const tx = await submitInternational({ fromAccountId: acc.sMain.id, fromCurrency: 'CRWN', currency: 'STAR', amount: amt(1_500, 'STAR'), recipientName: 'Celestine Conservatory of Song', recipientAccount: 'CEL-0042-77-1903', bankCode: 'ASTR-CEL-09', purpose: 'Masterclass tuition', reference: 'MC-2026' });
              for (let i = 0; i < 6; i++) { at(d, 11 + i * 2); await advanceInternational(tx.id); }
            });
            break;
          case 60:
            at(d, 10);
            await safe('bounce', () => checkFlow('tobiah', acc.tMain, 'lysander', acc.lMain, users.lysander.name, 9_900, 'Workshop share', 1, d));
            await as('lysander', () => payOffEarly(loanIds.lysander, acc.lMain.id)).catch(() => undefined);
            await as('aurelia', async () => {
              const pol = await db.policies.where('ownerId').equals(users.aurelia.id).filter((p) => p.product === 'travel').first();
              if (pol) {
                const cl = await fileClaim(pol.id, 'Luggage lost on the Tidesilver ferry', amt(640));
                await asActor(actorOf(users.holloway), async () => { await decideClaim(cl.id, 'under_review'); await decideClaim(cl.id, 'approved'); await decideClaim(cl.id, 'paid'); });
              }
            });
            break;
          case 61:
            at(d, 10);
            await safe('fx', () => as('aurelia', () => exchange({ fromAccountId: acc.aMain.id, fromCurrency: 'EUR', toAccountId: acc.aMain.id, toCurrency: 'CRWN', amount: amt(300, 'EUR') })));
            break;
          case 64:
            at(d, 10);
            await safe('reversal', async () => {
              const tx = await as('aurelia', () => transfer({ fromAccountId: acc.aMain.id, currency: 'CRWN', amount: amt(300), recipient: { accountNumber: acc.cMain.number }, description: 'Survey fee (sent twice by mistake)', category: 'transfers' }));
              at(d, 15);
              const { reverseTransaction } = await import('../banking/engine');
              await asActor(actorOf(users.holloway), () => reverseTransaction(tx.id, 'Duplicate payment confirmed by both parties'));
            });
            break;
          case 66:
            at(d, 19);
            await safe('auth expiry', async () => {
              const tx = await as('aurelia', () => cardPayment({ cardId: card.aVirtual.id, merchant: 'Lanternlight Cloud Ledger', mcc: '5734', realm: 'ALD', amount: amt(24), currency: 'CRWN', channel: 'online', category: 'subscriptions', settleNow: false }));
              const { expireCardAuthorization } = await import('../banking/cards');
              await expireCardAuthorization(tx.id);
            });
            break;
          case 65:
            at(d, 11);
            await safe('claim', async () => {
              const pol = await db.policies.where('ownerId').equals(users.corvin.id).first();
              if (pol) {
                const cl = await as('corvin', () => fileClaim(pol.id, 'Theodolite lens cracked during survey', amt(380)));
                await asActor(actorOf(users.holloway), () => decideClaim(cl.id, 'under_review'));
              }
            });
            break;
          case 70:
            at(d, 10);
            await safe('biz.reject', async () => {
              const ap = await as('barnaby', () => createBusinessPayment({ companyId: company.id, fromAccountId: acc.biz.id, recipientAccount: acc.gMain.number, recipientName: 'Nightjar Curios', amount: amt(9_999), description: 'Unverified supplier — rare reagents' }));
              at(d, 13); await as('mirela', () => decideApproval(ap.id, 'rejected', 'Supplier not on the approved register'));
            });
            await safe('dispute.dup', async () => {
              const tx = (await db.transactions.where('partyIds').equals(users.aurelia.id).filter((t) => t.type === 'card_payment' && t.status === 'completed').reverse().sortBy('createdAt'))[0];
              if (tx) {
                const dsp = await as('aurelia', () => openDispute(tx.id, 'duplicate_payment', 'Charged twice by the merchant for one purchase.'));
                await asActor(actorOf(users.morrow), async () => { await setDisputeStatus(dsp.id, 'under_review'); await setDisputeStatus(dsp.id, 'refunded', 'Merchant confirmed duplicate'); });
              }
            });
            await safe('atm', () => as('aurelia', () => atmWithdraw(atmVel.id, card.aDebit.id, amt(400))));
            await safe('intl cancel', () => as('aurelia', async () => {
              const tx = await submitInternational({ fromAccountId: acc.aMain.id, fromCurrency: 'CRWN', currency: 'GRFN', amount: amt(200, 'GRFN'), recipientName: 'Griffonmere Riding Academy', recipientAccount: 'GRF-118-22-0047', bankCode: 'GRYF-GRF-01', purpose: 'Riding lessons for Pip' });
              const { cancelInternational } = await import('../banking/international');
              await cancelInternational(tx.id);
            }));
            break;
          case 72:
            at(d, 11);
            await safe('dispute.unknown', async () => {
              const tx = (await db.transactions.where('partyIds').equals(users.corvin.id).filter((t) => t.type === 'card_payment' && t.status === 'completed').toArray())[0];
              if (tx) {
                const dsp = await as('corvin', () => openDispute(tx.id, 'unknown_transaction', 'I do not recognise this purchase.'));
                await asActor(actorOf(users.morrow), () => setDisputeStatus(dsp.id, 'under_review'));
              }
            });
            break;
          case 74:
            at(d, 10);
            await safe('fx grfn', () => as('aurelia', () => exchange({ fromAccountId: acc.aMain.id, fromCurrency: 'CRWN', toAccountId: acc.aMain.id, toCurrency: 'GRFN', amount: amt(1_000) })));
            break;
          case 75:
            at(d, 11);
            await safe('dispute.merchant', async () => {
              const tx = (await db.transactions.where('partyIds').equals(users.caspian.id).filter((t) => t.status === 'completed' && !!t.fromAccountId).toArray()).pop();
              if (tx) {
                const dsp = await as('caspian', () => openDispute(tx.id, 'merchant_dispute', 'Goods not delivered as described.'));
                await asActor(actorOf(users.morrow), async () => { await setDisputeStatus(dsp.id, 'under_review'); await setDisputeStatus(dsp.id, 'evidence_required', 'Please provide the merchant correspondence'); });
              }
            });
            break;
          case 78:
            at(d, 15);
            await safe('ms intl', () => as('mstislav', async () => {
              const tx = await submitInternational({ fromAccountId: acc.msMain.id, fromCurrency: 'CRWN', currency: 'MSLV', amount: amt(2_000, 'MSLV'), recipientName: 'Tidesilver Rope & Canvas', recipientAccount: 'MWI-7781-0021', bankCode: 'TIDE-MWI-01', purpose: 'Sailcloth order' });
              for (let i = 0; i < 6; i++) { at(d, 16 + i); await advanceInternational(tx.id); }
            }));
            break;
          case 80:
            at(d, 10);
            await safe('dispute.amount', async () => {
              const tx = (await db.transactions.where('partyIds').equals(users.seraphina.id).filter((t) => t.status === 'completed' && t.type === 'card_payment').toArray())[0];
              if (tx) {
                const dsp = await as('seraphina', () => openDispute(tx.id, 'wrong_amount', 'Receipt shows a smaller total.'));
                await asActor(actorOf(users.morrow), async () => { await setDisputeStatus(dsp.id, 'under_review'); await setDisputeStatus(dsp.id, 'rejected', 'Merchant receipt matches the charge'); });
              }
            });
            await safe('hugo close deposit', async () => {
              const dep = await db.deposits.where('ownerId').equals(users.hugo.id).first();
              if (dep) await as('hugo', () => closeDeposit(dep.id));
            });
            break;
          case 82:
            at(d, 10);
            await as('aurelia', () => placeOrder({ instrumentId: 'SLVB', side: 'buy', kind: 'limit', quantity: 15, limitPrice: 118, accountId: acc.aMain.id }));
            await as('aurelia', () => placeOrder({ instrumentId: 'MRTM', side: 'buy', kind: 'market', quantity: 25, accountId: acc.aMain.id }));
            break;
          case 85:
            at(d, 10);
            await as('aurelia', () => openTicket('cards', 'Contactless declined in the Moonward Isles', 'My premium card was declined for contactless payment on the Tidesilver ferry. International payments should be enabled — can you check the card controls?'));
            await as('ondine', async () => {
              const l = await applyLoan({ type: 'personal', amount: amt(9_000), termMonths: 24, currency: 'CRWN', purpose: 'Greenhouse for rare herbs', payoutAccountId: acc.oMain.id, monthlyIncome: amt(800) });
              loanIds.ondine = l.id;
            });
            break;
          case 86:
            at(d, 12);
            await safe('link', async () => {
              const link = await as('aurelia', () => createPaymentLink({ accountId: acc.aMain.id, amount: amt(75), currency: 'CRWN', description: 'Seat at the Saturday alchemy workshop', multiUse: true, days: 30 }));
              at(d, 15); await as('rosalind', () => payLink(link.code, acc.rMain.id));
              defer(d + 1, 9, 'link.pay', () => as('philippa', () => payLink(link.code, acc.pMain.id)));
            });
            await as('hugo', () => createPaymentLink({ accountId: acc.hBiz.id, amount: amt(38.5), currency: 'CRWN', description: 'Weekly vegetable crate', multiUse: true, days: 60 }));
            break;
          case 88:
            at(d, 10);
            await as('corvin', () => openTicket('payments', 'Transfer reference missing', 'My transfer to Ondine shows no reference. Can the reference be added to the receipt?'));
            await safe('caspian loan', () => as('caspian', async () => {
              const l = await applyLoan({ type: 'personal', amount: amt(4_000), termMonths: 12, currency: 'CRWN', purpose: 'Restoration of a clockwork automaton', payoutAccountId: acc.caMain.id, monthlyIncome: amt(4_200) });
              loanIds.caspian = l.id;
            }));
            await safe('wilhelmina loan', () => as('wilhelmina', () => applyLoan({ type: 'personal', amount: amt(15_000), termMonths: 36, currency: 'CRWN', purpose: 'New roof thatching business', payoutAccountId: acc.wMain.id, monthlyIncome: amt(1_500) })));
            break;
          case 90:
            at(d, 11);
            await as('tatev', () => openTicket('accounts', 'Դրամով հաշվի քաղվածք', 'Բարև Ձեզ, խնդրում եմ ուղարկել իմ դրամային հաշվի ամսական քաղվածքը։'));
            await as('mirela', () => openTicket('documents', 'Нужна справка о счёте', 'Здравствуйте! Подскажите, как получить справку о наличии счёта для посольства Браска?'));
            break;
          case 91:
            at(d, 9);
            await safe('reply', async () => {
              const t = await db.tickets.where('userId').equals(users.aurelia.id).first();
              if (t) await as('quill', () => sendTicketMessage(t.id, 'Good morning, Dame Aurelia. Contactless abroad requires both "International" and "Contactless" controls; your premium card had International switched off. I have noted it on your file — you can enable it yourself under Cards → Controls.'));
            });
            break;
          case 93:
            at(d, 10);
            await safe('gideon vault', () => as('gideon', async () => {
              const v = await rentVault(2, 'S', 'BR-RVR', '777000', acc.gMain.id);
              for (const code of ['111111', '222222', '333333']) await openVault(v.id, code).catch(() => undefined);
            }));
            await safe('caspian vault', () => as('caspian', async () => {
              const v = await rentVault(5, 'XL', 'BR-RVR', '13371337', acc.caMain.id);
              await openVault(v.id, '13371337');
              await depositVaultItem(v.id, 'Sealed reliquary', 'Do not open without two wardens');
              await depositVaultItem(v.id, 'Map of the Drowned Coast', 'Vellum, 1620', amt(12_000), 'CRWN');
              await closeVault(v.id);
            }));
            await safe('rosalind vault', () => as('rosalind', async () => {
              const v = await rentVault(2, 'S', 'BR-OAK', '4242', acc.rMain.id);
              await openVault(v.id, '4242');
              await depositVaultItem(v.id, 'Physician’s licence', 'Original, sealed');
              await closeVault(v.id);
            }));
            await safe('ms vault', () => as('mstislav', () => rentVault(1, 'M', 'BR-ELS', '1856', acc.msMain.id)));
            break;
          case 95:
            at(d, 10);
            await as('thaddeus', () => submitKyc({ docType: 'national_id', docNumber: 'ALD-ID-5512093', issuedBy: 'Gallowmere Registry', issueDate: '2024-02-02', expiryDate: '2034-02-02', fileName: 'id-card-front.demo' }));
            await safe('draft check', async () => {
              const ch = await as('aurelia', () => createCheck({ accountId: acc.aMain.id, payeeName: users.elodie.name, payeeClientId: users.elodie.clientId, amount: amt(180), purpose: 'Illustrated labels — first batch' }));
              void ch;
            });
            await as('aurelia', () => fileDeclaration(2025, amt(98_000), 'CRWN'));
            break;
          case 96:
            at(d, 10);
            await safe('biz pending acc', async () => {
              const ap = await as('barnaby', () => createBusinessPayment({ companyId: company.id, fromAccountId: acc.biz.id, recipientAccount: acc.msBiz.number, recipientName: 'Korvin-Lebedev Shipwrights', amount: amt(5_800), description: 'Copper retorts and condensers' }));
              defer(d + 1, 11, 'biz.mgr', () => as('mirela', () => decideApproval(ap.id, 'approved', 'Quote reviewed')));
            });
            await safe('dispute.open', async () => {
              const tx = (await db.transactions.where('partyIds').equals(users.rosalind.id).filter((t) => t.status === 'completed' && t.type === 'transfer').toArray()).pop();
              if (tx) await as('rosalind', () => openDispute(tx.id, 'transfer_problem', 'The recipient says the funds have not arrived.'));
            });
            break;
          case 97:
            await checkFlow('aurelia', acc.aMain, 'tatev', null, users.tatev.name, 420, 'Hand-woven carpet for the study', null, d, { seal: 'urgent' });
            at(d, 12);
            await as('elodie', () => submitKyc({ docType: 'passport', docNumber: 'ALD-P-9022178', issuedBy: 'Passport Office of Aldermoor', issueDate: '2026-08-01', expiryDate: '2036-08-01', fileName: 'passport-renewed.demo' }));
            break;
          case 98:
            at(d, 22, 40);
            await safe('gideon review', () => as('gideon', () => submitInternational({ fromAccountId: acc.gMain.id, fromCurrency: 'USD', currency: 'RUB', amount: amt(310_000, 'RUB'), recipientName: 'Night Bazaar Consignments', recipientAccount: 'SHD-000-445-9', bankCode: 'NGHT-SHD-01', purpose: 'Purchase of curios' })));
            at(d, 23, 5);
            await safe('gideon block', () => as('gideon', () => submitInternational({ fromAccountId: acc.gMain.id, fromCurrency: 'USD', currency: 'USD', amount: amt(7_900, 'USD'), recipientName: 'Night Bazaar Consignments', recipientAccount: 'SHD-000-445-9', bankCode: 'NGHT-SHD-01', purpose: 'Urgent settlement' })));
            await safe('shadow card', () => as('caspian', async () => {
              const c = await db.cards.where('ownerId').equals(users.caspian.id).filter((x) => x.status === 'active').first();
              if (c) await cardPayment({ cardId: c.id, merchant: 'Shadowfen Night Bazaar', mcc: '5999', realm: 'SHD', amount: amt(2_400, 'RUB'), currency: 'RUB', channel: 'online', category: 'shopping', settleNow: true });
            }));
            break;
          case 99:
            at(d, 9);
            await safe('req', async () => {
              await as('corvin', () => requestMoney({ toAccountId: acc.cMain.id, payerClientId: users.aurelia.clientId, amount: amt(45), currency: 'CRWN', note: 'Your share of dinner at the Gilded Kettle' }));
              const r2 = await as('aurelia', () => requestMoney({ toAccountId: acc.aMain.id, payerClientId: users.evander.clientId, amount: amt(60), currency: 'CRWN', note: 'Theatre tickets — Wandering Lantern' }));
              await as('evander', () => payRequest(r2.id, acc.eMain.id));
              const r3 = await as('tatev', () => requestMoney({ toAccountId: acc.taMain.id, payerClientId: users.caspian.clientId, amount: amt(300), currency: 'CRWN', note: 'Carpet repair' }));
              await as('caspian', () => declineRequest(r3.id));
            });
            await safe('biz pending mgr', () => as('imogen', () => createBusinessPayment({ companyId: company.id, fromAccountId: acc.biz.id, recipientAccount: acc.hBiz.number, recipientName: 'Brambleworth Grocers', amount: amt(760), description: 'Staff canteen provisions' })));
            break;
        } });

        // personal checks between clients
        if (d % 7 === 4 && d >= 11 && d <= 88) {
          const pair = pick(R, [['seraphina', acc.sMain, 'rosalind', acc.rMain], ['mstislav', acc.msMain, 'tatev', acc.taMain], ['rosalind', acc.rMain, 'corvin', acc.cMain], ['hugo', acc.hMain, 'tobiah', acc.tMain], ['philippa', acc.pMain, 'barnaby', acc.bMain], ['caspian', acc.caMain, 'elodie', acc.elMain]] as const);
          await safe('check', () => checkFlow(pair[0], pair[1], pair[2], pair[3], users[pair[2]].name, 40 + Math.floor(R() * 600), pick(R, ['Settlement of account', 'Commissioned work', 'Loan returned with thanks', 'Deposit on goods', 'Guild dues']), 1 + Math.floor(R() * 3), d, { hand: R() < 0.5 }));
        }

        // invoices sprinkled through history
        if (d % 4 === 1 && d < 97) {
          const scenario = invoiceNo++ % 6;
          at(d, 10, 15);
          await safe('invoice', async () => {
            const issuerIsBiz = scenario % 2 === 0;
            const recipientKey = pick(R, ['mstislav', 'hugo', 'caspian', 'seraphina', 'rosalind']);
            const inv = await as(issuerIsBiz ? 'aurelia' : 'hugo', () => createInvoice({
              issuerAccountId: issuerIsBiz ? acc.biz.id : acc.hBiz.id,
              companyId: issuerIsBiz ? company.id : undefined,
              recipientClientId: users[issuerIsBiz ? recipientKey : 'aurelia'].clientId,
              recipientName: users[issuerIsBiz ? recipientKey : 'aurelia'].name,
              items: issuerIsBiz
                ? [{ description: 'Alchemical hull sealant (barrel)', quantity: 1 + Math.floor(R() * 4), price: amt(240), taxRate: 12, discount: 0 }, { description: 'Retort cleaning service', quantity: 1, price: amt(85), taxRate: 12, discount: 10 }]
                : [{ description: 'Weekly provisions crate', quantity: 4, price: amt(38.5), taxRate: 5, discount: 0 }, { description: 'Delivery to Lantern Row', quantity: 4, price: amt(4), taxRate: 0, discount: 0 }],
              dueDate: dayKeyOf(d + (scenario === 3 ? 5 : scenario === 5 ? 40 : 21)),
              notes: 'Payable via Aetherline link or QR. Thank you for your custom.',
            }));
            if (scenario === 4 && d > 70) return; // remains a draft
            await as(issuerIsBiz ? 'aurelia' : 'hugo', () => sendInvoice(inv.id));
            if (scenario === 2 && d > 50) {
              await as(issuerIsBiz ? 'aurelia' : 'hugo', () => cancelInvoice(inv.id));
              return;
            }
            if (scenario === 5 && d > 70) return; // sent, awaiting payment
            if (scenario !== 3 && d < 92) {
              const payer = issuerIsBiz ? recipientKey : 'aurelia';
              const payerAcc = issuerIsBiz ? salaryAcct[recipientKey] : acc.aMain;
              defer(d + 2, 11, 'invoice.pay', () => as(payer, () => payInvoice(inv.id, payerAcc.id)));
            }
          });
        }

        // end of day batch
        clock.freeze(START + d * D + 23 * H + 50 * 60_000);
        await runEndOfDay(dayKeyOf(d));
      }

      /* ── Final touches at "today" ── */
      progress(86, 'seed.documents');
      clock.freeze(START + HISTORY_DAYS * D + 15 * 60_000);
      // pending approval by the chancery
      if (loanIds.caspian) {
        const l = await getLoanOrThrow(loanIds.caspian);
        if (l.status === 'approved') void l; // client can sign & receive funds in the demo
      }
      await as('aurelia', async () => {
        const last = new Date(START + (HISTORY_DAYS - 31) * D).toISOString().slice(0, 10);
        await generateStatement(acc.aMain.id, 'CRWN', last, todayKey());
        await generateStatement(acc.aSav.id, 'CRWN', dayKeyOf(0), todayKey());
        await generateDocument('balance_confirmation', { accountId: acc.aMain.id, recipient: 'Embassy of the Republic of Verrine' });
        await generateDocument('reference_letter', { accountId: acc.aMain.id, recipient: 'Guild of Master Alchemists', text: 'The Exchequer confirms that Dame Aurelia Thornwood has held accounts in good standing since 2015.' });
        await generateDocument('payment_order', { accountId: acc.aMain.id, recipient: 'Royal Academy of Alchemy', amount: amt(320), currency: 'CRWN', text: 'Annual membership dues of the Royal Academy of Alchemy.' });
        await generateDocument('authorization', { accountId: acc.aJoint.id, recipient: users.evander.name, text: 'I authorise Mr Evander Lisle to collect statements of the Household Joint account on my behalf.' });
        const escrowDoc = await createDocument({
          type: 'contract', title: 'Escrow Agreement', ownerId: users.aurelia.id, partyIds: [users.hugo.id], department: 'LND',
          data: { kind: 'escrow', accountId: acc.aEscrow.id, number: acc.aEscrow.number, depositor: users.aurelia.name, beneficiary: users.hugo.name, amount: amt(15_000), currency: 'CRWN', condition: 'Release on registration of title to the Lantern Row annex' },
          body: ['The Exchequer of Aldermoor shall hold the escrowed sum in the named escrow account and release it to the Beneficiary upon presentation of the registered title deed.', 'Either party may refer a dispute to the Chancery Court of Vellinghast.'],
          links: { accountIds: [acc.aEscrow.id] },
        });
        await signDocument(escrowDoc.id, 'handwritten', { strokes: sig('aurelia'), place: { x: 8, y: 70, w: 26 } });
      });
      await as('hugo', async () => {
        const esc = await db.documents.where('type').equals('contract').first();
        if (esc) await signDocument(esc.id, 'electronic', { place: { x: 40, y: 70, w: 26 } });
      });
      await as('vantress', async () => {
        await generateDocument('memo', { text: 'The Night Archive will be closed for re-warding on the first Moonday of next month.\nAll sealed records requested for that day must be retrieved in advance.' });
        const notice = await createDocument({ type: 'notice', title: 'Notice of Revised Fee Schedule', ownerId: users.vantress.id, classification: 'public', department: 'ADM', data: { kind: 'fees', effective: dayKeyOf(HISTORY_DAYS + 30) }, body: ['With effect from the date stated, the commission on cross-realm transfers is set at 0.40% (minimum 8.00 USD equivalent).', 'Exchange spreads remain unchanged. Domestic Aetherline transfers remain free of charge.'] });
        await signDocument(notice.id, 'official');
      });
      for (const c of ARCHIVE_CASES) {
        await db.archive.add({
          id: uid('ARR'), code: archiveCode(c.dept), kind: c.kind, title: c.title, summary: c.summary, createdAt: new Date(START - Math.floor(R() * 4000) * D).toISOString(),
          department: c.dept, classification: c.kind === 'case' ? 'sealed' : 'internal', refs: {}, tags: [...c.tags], shelf: shelfMark(), status: c.kind === 'case' ? 'sealed' : 'filed',
        });
      }
      for (const t of await db.transactions.where('status').equals('completed').filter((t) => t.amount >= amt(10_000) && t.type !== 'opening' && t.type !== 'cash_transfer').limit(8).toArray()) {
        await db.archive.add({ id: uid('ARR'), code: archiveCode('PAY'), kind: 'transaction', title: `Settled: ${t.description}`, summary: `${t.ref} — ${t.sender.name} → ${t.recipient.name}`, createdAt: t.createdAt, ownerId: t.initiatorId, department: 'PAY', classification: 'confidential', refs: { txId: t.id }, tags: ['transaction', t.type], shelf: shelfMark(), status: 'filed' });
      }
      for (const l of await db.loans.toArray()) {
        if (l.status === 'rejected' || l.status === 'under_review') {
          await db.archive.add({ id: uid('ARR'), code: archiveCode('LND'), kind: 'application', title: `Loan application ${l.number}`, summary: `${l.type} ${l.amount / 100} ${l.currency} — ${l.status}`, createdAt: l.appliedAt, ownerId: l.ownerId, department: 'LND', classification: 'confidential', refs: { loanId: l.id }, tags: ['loan', l.status], shelf: shelfMark(), status: 'filed' });
        }
      }
      if (pausedSub) await db.subscriptions.update(pausedSub.id, { status: 'paused' });
      // an expired card for demonstration
      await db.cards.update(card.wilhelminaDebit.id, { expMonth: 6, expYear: 2026, status: 'expired' });
      // two-factor enabled for one staff member to demonstrate the flow
      await db.users.update(users.greymark.id, { twoFactor: { enabled: true, secret: 'JBSWY3DPEHPK3PXP' } });
      await asActor(SYSTEM_ACTOR, () => sendMail(users.aurelia.id, 'security_alert', { event: 'new_device' }));
      await syslog('info', 'seed', `Demo world forged: ${HISTORY_DAYS} days of history. Warnings: ${warnings.length}`);
      for (const w of warnings.slice(0, 40)) await syslog('warn', 'seed', w);

      // future-dated items (after "now")
      const NOW = START + HISTORY_DAYS * D + 30 * 60_000;
      clock.freeze(NOW);
      await as('aurelia', async () => {
        const runAt = new Date(NOW + 5 * D).toISOString();
        await scheduleTransfer({ fromAccountId: acc.aMain.id, currency: 'CRWN', amount: amt(250), recipientAccount: acc.eMain.number, recipientName: users.evander.name, description: 'Anniversary dinner fund', runAt });
      });
      await as('corvin', async () => {
        const runAt = new Date(NOW + 9 * D).toISOString();
        await scheduleTransfer({ fromAccountId: acc.cMain.id, currency: 'CRWN', amount: amt(200), recipientAccount: acc.oMain.number, recipientName: users.ondine.name, description: "Mother's allowance", runAt });
      });
      await db.taxes.add({ id: uid('TAXR'), number: `PRP-${new Date(NOW).getUTCFullYear()}-0414`, ownerId: users.aurelia.id, year: new Date(NOW).getUTCFullYear(), kind: 'property', amount: amt(640), currency: 'CRWN', status: 'due', dueDate: new Date(NOW + 20 * D).toISOString().slice(0, 10), description: 'Hearth & window tax — 14 Lantern Row (simulated)' });
      await db.taxes.add({ id: uid('TAXR'), number: `BIZ-${new Date(NOW).getUTCFullYear()}-0091`, ownerId: users.aurelia.id, year: new Date(NOW).getUTCFullYear(), kind: 'business', amount: amt(2_150), currency: 'CRWN', status: 'due', dueDate: new Date(NOW + 45 * D).toISOString().slice(0, 10), description: 'Guild trade levy — Thornwood & Vale (simulated)' });
      // live international transfer progressing in real time
      await safe('live intl', () => as('aurelia', () => submitInternational({ fromAccountId: acc.aMain.id, fromCurrency: 'CRWN', currency: 'CHF', amount: amt(450, 'CHF'), recipientName: 'Brask Clockmakers Guild', recipientAccount: 'BRK 0021 4410 77', bankCode: 'HLBR-BRK-07', purpose: 'Repair of the laboratory regulator clock', reference: 'INV-BRK-7781' })));
    });
  } finally {
    clock.unfreeze();
    clock.setInstant(false);
    setNotificationsMuted(false);
  }
  const anchorDay = new Date(START + HISTORY_DAYS * D).toISOString().slice(0, 10);
  await setMeta('lastEOD', new Date(START + (HISTORY_DAYS - 1) * D).toISOString().slice(0, 10));
  await setMeta('seeded', { at: new Date(START + HISTORY_DAYS * D).toISOString(), version: 1, warnings: warnings.length, anchorDay, source: 'live' });
  progress(100, 'seed.done');
  return { warnings, anchorDay };
}
