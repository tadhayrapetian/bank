/**
 * The Sovereign Commonwealth of Aldermoor — institutional reference data.
 * Entirely fictional. Display names are translated in the UI via i18n keys
 * `dept.<CODE>`; the English forms here are used on official paper.
 */
import type { BudgetCategory, DeptCode } from './types';

export const STATE = {
  name: 'Sovereign Commonwealth of Aldermoor',
  capital: 'Vellinghast',
  bank: 'Exchequer of Aldermoor',
  bankShort: 'AEX',
  network: 'Aetherline',
  motto: 'FIDES · ARCANUM · AURUM',
  founded: 1347,
};

export const DEPARTMENTS: Record<DeptCode, { name: string; seat: string; head: string }> = {
  TRS: { name: 'The Gilded Treasury', seat: 'Vellinghast, Treasury Spire', head: 'Lord Treasurer Castellan Reyne' },
  CMP: { name: 'Office of the Comptroller of Coin', seat: 'Vellinghast, Hall of Scales', head: 'Comptroller Wilhelmina Orrery' },
  PAY: { name: 'Directorate of Aetherline Payments', seat: 'Vellinghast, Wire Court', head: 'Director Lucan Fairweather' },
  FXB: { name: 'Bureau of Coinage & Exchange', seat: 'Port Elsinmoor, Exchange Arcade', head: 'Bureau Master Ottoline Crane' },
  VLT: { name: 'Wardens of the Deep Vaults', seat: 'Undervault of Vellinghast', head: 'Warden-Superior Hadrian Kell' },
  ARC: { name: 'Hall of Sealed Records', seat: 'Vellinghast, Archive Rotunda', head: 'Archivist-General Odile Vantress' },
  SEC: { name: 'Office of Wards & Banking Security', seat: 'Vellinghast, Bastion Wing', head: 'Ward-Captain Isembard Thorne' },
  AUD: { name: 'Chamber of Auditors', seat: 'Vellinghast, Counting House', head: 'Chief Auditor Ansel Greymark' },
  INT: { name: 'Office of Cross-Realm Affairs', seat: 'Port Elsinmoor, Embassy Row', head: 'Envoy Marisol Duvane' },
  LND: { name: 'Lending Chancery', seat: 'Vellinghast, Chancery Court', head: 'Chancellor Perpetua Ashby' },
  DEP: { name: 'Office of Deposits & Endowments', seat: 'Vellinghast, Endowment Hall', head: 'Keeper Florian Mabry' },
  CPL: { name: 'Board of Compliance & Oaths', seat: 'Vellinghast, Oath Chamber', head: 'Inquisitor-Clerk Ilsa Morrow' },
  CSV: { name: "Petitioners' Hall", seat: 'All branches', head: 'Steward Rosalind Pell' },
  ADM: { name: 'Secretariat of the Exchequer', seat: 'Vellinghast, Secretariat', head: 'Secretary Barnaby Quillon' },
};

export const DEPT_CODES = Object.keys(DEPARTMENTS) as DeptCode[];

/** Neighbouring realms (for international transfers, merchants and fraud geography). */
export const REALMS: { code: string; name: string; currency: string; risk: 'low' | 'medium' | 'high' }[] = [
  { code: 'ALD', name: 'Sovereign Commonwealth of Aldermoor', currency: 'CRWN', risk: 'low' },
  { code: 'MWI', name: 'Moonward Isles', currency: 'MSLV', risk: 'low' },
  { code: 'EMB', name: 'Free Cities of the Ember Coast', currency: 'EMBR', risk: 'medium' },
  { code: 'KAL', name: 'Highland Thanedom of Kaldrun', currency: 'RUNE', risk: 'medium' },
  { code: 'CEL', name: 'Celestine Archipelago', currency: 'STAR', risk: 'low' },
  { code: 'GRF', name: 'Duchy of Griffonmere', currency: 'GRFN', risk: 'low' },
  { code: 'VRN', name: 'Republic of Verrine', currency: 'EUR', risk: 'low' },
  { code: 'NMR', name: 'Northmarch Confederacy', currency: 'USD', risk: 'low' },
  { code: 'QRT', name: 'Sultanate of Qareth', currency: 'AED', risk: 'medium' },
  { code: 'BRK', name: 'Free City of Brask', currency: 'CHF', risk: 'low' },
  { code: 'PEL', name: 'Pellucid Isles', currency: 'GBP', risk: 'medium' },
  { code: 'MIR', name: 'Mirefen Marches', currency: 'MIRE', risk: 'high' },
  { code: 'OSK', name: 'Oskarven Dominion', currency: 'JPY', risk: 'medium' },
  { code: 'TAL', name: 'Talvenor Steppes', currency: 'AMD', risk: 'medium' },
  { code: 'SHD', name: 'Shadowfen Protectorate', currency: 'RUB', risk: 'high' },
];

export function realmName(code: string | undefined) {
  return REALMS.find((r) => r.code === code)?.name ?? code ?? '—';
}

/** Correspondent banks in other realms. Routing codes are fictional (CRBC format). */
export const FOREIGN_BANKS = [
  { code: 'LUNE-VRN-01', name: 'Banque Lunaire de Verrine', realm: 'VRN', hours: 18 },
  { code: 'KSTR-NMR-04', name: 'Kestrel Hollow Savings & Trust', realm: 'NMR', hours: 24 },
  { code: 'ISKV-QRT-02', name: 'Iskander-Vahl Treasury Bank', realm: 'QRT', hours: 36 },
  { code: 'HLBR-BRK-07', name: 'Hollen & Brask Handelsbank', realm: 'BRK', hours: 12 },
  { code: 'PELM-PEL-03', name: 'Pellucid Isles Mutual', realm: 'PEL', hours: 30 },
  { code: 'TIDE-MWI-01', name: 'Tidesilver Bank of the Moonward Isles', realm: 'MWI', hours: 8 },
  { code: 'CNDR-EMB-05', name: 'Cinderhall Merchant Bank', realm: 'EMB', hours: 20 },
  { code: 'RUNH-KAL-02', name: 'Runehold Thanes’ Treasury', realm: 'KAL', hours: 40 },
  { code: 'ASTR-CEL-09', name: 'Astral Reach Bank of Celestine', realm: 'CEL', hours: 16 },
  { code: 'GRYF-GRF-01', name: 'Griffonmere Ducal Bank', realm: 'GRF', hours: 10 },
  { code: 'OSKV-OSK-06', name: 'Oskarven Imperial Ledger House', realm: 'OSK', hours: 32 },
  { code: 'TLVN-TAL-02', name: 'Talvenor Caravan Bank', realm: 'TAL', hours: 44 },
  { code: 'NGHT-SHD-01', name: 'Shadowfen Night Ledger', realm: 'SHD', hours: 48 },
  { code: 'MIRF-MIR-01', name: 'Mirefen Bog-Trust (sanctioned)', realm: 'MIR', hours: 72 },
];

export const INTERMEDIARIES = ['Veiled Courts Clearing House', 'Northmarch Correspondent Exchange', 'Ember Coast Settlement Guild'];

export interface MerchantDef {
  name: string;
  mcc: string;
  category: BudgetCategory;
  realm: string;
  currency: string;
  min: number;
  max: number;
}

export const MERCHANTS: MerchantDef[] = [
  { name: 'Quillfeather Stationers', mcc: '5943', category: 'shopping', realm: 'ALD', currency: 'CRWN', min: 4, max: 60 },
  { name: 'The Gilded Kettle Tearoom', mcc: '5812', category: 'dining', realm: 'ALD', currency: 'CRWN', min: 6, max: 45 },
  { name: 'Brambleworth Grocers', mcc: '5411', category: 'groceries', realm: 'ALD', currency: 'CRWN', min: 12, max: 140 },
  { name: 'Mortar & Moonstone Apothecary', mcc: '5912', category: 'apothecary', realm: 'ALD', currency: 'CRWN', min: 8, max: 90 },
  { name: 'Vellinghast Lamplighters Co.', mcc: '4900', category: 'utilities', realm: 'ALD', currency: 'CRWN', min: 40, max: 160 },
  { name: 'Silverbridge Rail & Carriage', mcc: '4112', category: 'travel', realm: 'ALD', currency: 'CRWN', min: 15, max: 220 },
  { name: 'The Wandering Lantern Theatre', mcc: '7922', category: 'entertainment', realm: 'ALD', currency: 'CRWN', min: 18, max: 80 },
  { name: 'Hollowmere Books & Scrolls', mcc: '5942', category: 'education', realm: 'ALD', currency: 'CRWN', min: 9, max: 75 },
  { name: 'Tidesilver Ferry Line', mcc: '4111', category: 'travel', realm: 'MWI', currency: 'MSLV', min: 30, max: 300 },
  { name: 'Cinderhall Forge Market', mcc: '5999', category: 'shopping', realm: 'EMB', currency: 'EMBR', min: 5, max: 120 },
  { name: 'Hotel Astraea, Celestine', mcc: '7011', category: 'travel', realm: 'CEL', currency: 'STAR', min: 90, max: 700 },
  { name: 'Brask Clockmakers Guild', mcc: '5944', category: 'shopping', realm: 'BRK', currency: 'CHF', min: 60, max: 900 },
  { name: 'Verrine Café des Lunes', mcc: '5814', category: 'dining', realm: 'VRN', currency: 'EUR', min: 5, max: 40 },
  { name: 'Northmarch Outfitters', mcc: '5651', category: 'shopping', realm: 'NMR', currency: 'USD', min: 25, max: 260 },
  { name: 'Shadowfen Night Bazaar', mcc: '5999', category: 'shopping', realm: 'SHD', currency: 'RUB', min: 900, max: 25000 },
];

export const SUBSCRIPTION_SERVICES = [
  { service: 'The Moonward Gazette', plan: 'Daily edition', amount: 9.5, currency: 'CRWN', period: 'monthly' as const, hue: 210 },
  { service: 'Spellstream Theatre Pass', plan: 'Premium', amount: 14, currency: 'CRWN', period: 'monthly' as const, hue: 280 },
  { service: 'Quillcast Audio Chronicles', plan: 'Family', amount: 11.9, currency: 'CRWN', period: 'monthly' as const, hue: 30 },
  { service: 'Alchemist’s Monthly Review', plan: 'Scholar', amount: 89, currency: 'CRWN', period: 'yearly' as const, hue: 140 },
  { service: 'Lanternlight Cloud Ledger', plan: 'Business', amount: 24, currency: 'USD', period: 'monthly' as const, hue: 45 },
  { service: 'Griffonmere Riding Club', plan: 'Weekend', amount: 6, currency: 'GRFN', period: 'weekly' as const, hue: 0 },
  { service: 'Celestine Star Charts', plan: 'Navigator', amount: 5.5, currency: 'STAR', period: 'monthly' as const, hue: 190 },
];

export const CATEGORY_LIST: BudgetCategory[] = [
  'income', 'salary', 'transfers', 'groceries', 'dining', 'travel', 'housing', 'utilities', 'apothecary', 'education',
  'entertainment', 'shopping', 'subscriptions', 'bills', 'fees', 'taxes', 'insurance', 'investments', 'savings', 'loans',
  'cash', 'business', 'charity', 'other',
];

export const EXPENSE_CATEGORIES: BudgetCategory[] = CATEGORY_LIST.filter((c) => !['income', 'salary'].includes(c));
