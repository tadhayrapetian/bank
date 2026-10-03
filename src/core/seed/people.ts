/** Fictional people, places and institutions of Aldermoor used for demo data. */
import type { Branch, DeptCode, Employee } from '../types';

export interface ClientSeed {
  key: string;
  name: string;
  honorific: string;
  email: string;
  city: string;
  street: string;
  segment: 'retail' | 'premium' | 'business' | 'minor';
  occupation: string;
  kyc: 'verified' | 'pending' | 'rejected' | 'not_started' | 'expired';
  lang: 'en' | 'ru' | 'hy';
  dob: string;
  realms: string[];
  spender: number; // 0..1 daily probability of a card payment
  income: number; // monthly income, CRWN minor
}

export const CLIENTS: ClientSeed[] = [
  { key: 'aurelia', name: 'Aurelia Thornwood', honorific: 'Dame', email: 'aurelia.thornwood@post.aldermoor', city: 'Vellinghast', street: '14 Lantern Row', segment: 'premium', occupation: 'Master Alchemist', kyc: 'verified', lang: 'en', dob: '1986-03-14', realms: ['ALD', 'MWI', 'VRN', 'CEL'], spender: 0.75, income: 9_800_00 },
  { key: 'corvin', name: 'Corvin Ashgrove', honorific: 'Mr', email: 'corvin.ashgrove@post.aldermoor', city: 'Port Elsinmoor', street: '3 Harbourmaster Steps', segment: 'retail', occupation: 'Cartographer', kyc: 'verified', lang: 'en', dob: '1991-07-02', realms: ['ALD', 'MWI'], spender: 0.45, income: 3_900_00 },
  { key: 'mirela', name: 'Mirela Vossberg', honorific: 'Ms', email: 'mirela.vossberg@post.aldermoor', city: 'Vellinghast', street: '88 Copperleaf Avenue', segment: 'business', occupation: 'Operations Manager', kyc: 'verified', lang: 'ru', dob: '1984-11-23', realms: ['ALD', 'BRK'], spender: 0.4, income: 5_600_00 },
  { key: 'tobiah', name: 'Tobiah Fenwick', honorific: 'Mr', email: 'tobiah.fenwick@post.aldermoor', city: 'Gallowmere', street: '9 Millrace Lane', segment: 'retail', occupation: 'Lamplighter', kyc: 'verified', lang: 'en', dob: '1995-01-30', realms: ['ALD'], spender: 0.5, income: 2_400_00 },
  { key: 'seraphina', name: 'Seraphina Quell', honorific: 'Lady', email: 'seraphina.quell@post.aldermoor', city: 'Brightwater Spa', street: '1 Crescent of Swans', segment: 'premium', occupation: 'Opera Soprano', kyc: 'verified', lang: 'en', dob: '1979-05-18', realms: ['ALD', 'CEL', 'VRN'], spender: 0.6, income: 12_500_00 },
  { key: 'lysander', name: 'Lysander Marrowby', honorific: 'Mr', email: 'lysander.marrowby@post.aldermoor', city: 'Silverbridge', street: '27 Railwright Close', segment: 'retail', occupation: 'Engine Smith', kyc: 'verified', lang: 'en', dob: '1988-09-09', realms: ['ALD'], spender: 0.35, income: 3_300_00 },
  { key: 'ondine', name: 'Ondine Halloway', honorific: 'Mrs', email: 'ondine.halloway@post.aldermoor', city: 'Kestrel Fen', street: '5 Reedcutter Walk', segment: 'retail', occupation: 'Herbalist', kyc: 'verified', lang: 'en', dob: '1993-12-01', realms: ['ALD'], spender: 0.3, income: 2_100_00 },
  { key: 'caspian', name: 'Caspian Dreadmere', honorific: 'Mr', email: 'caspian.dreadmere@post.aldermoor', city: 'Ravensreach', street: '61 Gargoyle Terrace', segment: 'retail', occupation: 'Antiquarian', kyc: 'verified', lang: 'en', dob: '1982-04-27', realms: ['ALD', 'EMB'], spender: 0.4, income: 4_200_00 },
  { key: 'rosalind', name: 'Rosalind Pembrook', honorific: 'Dr', email: 'rosalind.pembrook@post.aldermoor', city: 'Oakhallow', street: '2 Physick Garden', segment: 'premium', occupation: 'Physician', kyc: 'verified', lang: 'en', dob: '1975-08-12', realms: ['ALD', 'GRF'], spender: 0.45, income: 11_000_00 },
  { key: 'evander', name: 'Evander Lisle', honorific: 'Mr', email: 'evander.lisle@post.aldermoor', city: 'Vellinghast', street: '14 Lantern Row', segment: 'retail', occupation: 'Clockwright', kyc: 'verified', lang: 'en', dob: '1985-10-04', realms: ['ALD', 'BRK'], spender: 0.35, income: 4_600_00 },
  { key: 'pip', name: 'Pip Thornwood', honorific: 'Master', email: 'pip.thornwood@post.aldermoor', city: 'Vellinghast', street: '14 Lantern Row', segment: 'minor', occupation: 'Pupil, Vellinghast Academy', kyc: 'verified', lang: 'en', dob: '2012-06-21', realms: ['ALD'], spender: 0.15, income: 0 },
  { key: 'tatev', name: 'Tatev Arzumel', honorific: 'Ms', email: 'tatev.arzumel@post.aldermoor', city: 'Thornbury Cross', street: '40 Apricot Lane', segment: 'retail', occupation: 'Carpet Weaver', kyc: 'verified', lang: 'hy', dob: '1990-02-15', realms: ['ALD', 'TAL'], spender: 0.4, income: 3_100_00 },
  { key: 'mstislav', name: 'Mstislav Korvin-Lebedev', honorific: 'Mr', email: 'mstislav.korvin@post.aldermoor', city: 'Port Elsinmoor', street: '7 Ropewalk Quay', segment: 'business', occupation: 'Shipwright', kyc: 'verified', lang: 'ru', dob: '1977-12-19', realms: ['ALD', 'MWI', 'KAL'], spender: 0.35, income: 7_400_00 },
  { key: 'imogen', name: 'Imogen Starling', honorific: 'Ms', email: 'imogen.starling@post.aldermoor', city: 'Vellinghast', street: '19 Abacus Yard', segment: 'retail', occupation: 'Chartered Accountant', kyc: 'verified', lang: 'en', dob: '1989-03-03', realms: ['ALD'], spender: 0.3, income: 4_800_00 },
  { key: 'barnaby', name: 'Barnaby Whitlock', honorific: 'Mr', email: 'barnaby.whitlock@post.aldermoor', city: 'Vellinghast', street: '33 Tinker Street', segment: 'retail', occupation: 'Laboratory Assistant', kyc: 'verified', lang: 'en', dob: '1998-07-28', realms: ['ALD'], spender: 0.45, income: 2_600_00 },
  { key: 'philippa', name: 'Philippa Greaves', honorific: 'Ms', email: 'philippa.greaves@post.aldermoor', city: 'Hollowmere', street: '12 Ledger Lane', segment: 'retail', occupation: 'Independent Auditor', kyc: 'verified', lang: 'en', dob: '1983-01-11', realms: ['ALD'], spender: 0.25, income: 5_200_00 },
  { key: 'thaddeus', name: 'Thaddeus Cobblestone', honorific: 'Mr', email: 'thaddeus.cobblestone@post.aldermoor', city: 'Gallowmere', street: '81 Cobbler Row', segment: 'retail', occupation: 'Cobbler', kyc: 'pending', lang: 'en', dob: '1970-05-05', realms: ['ALD'], spender: 0.2, income: 1_900_00 },
  { key: 'wilhelmina', name: 'Wilhelmina Thatch', honorific: 'Mrs', email: 'wilhelmina.thatch@post.aldermoor', city: 'Oakhallow', street: '4 Strawbale Court', segment: 'retail', occupation: 'Thatcher', kyc: 'rejected', lang: 'en', dob: '1966-09-30', realms: ['ALD'], spender: 0.15, income: 1_500_00 },
  { key: 'gideon', name: 'Gideon Blackwood', honorific: 'Mr', email: 'gideon.blackwood@post.aldermoor', city: 'Ravensreach', street: '13 Nightjar Alley', segment: 'retail', occupation: 'Curio Trader', kyc: 'verified', lang: 'en', dob: '1987-10-31', realms: ['ALD'], spender: 0.3, income: 3_500_00 },
  { key: 'elodie', name: 'Elodie Fairfax', honorific: 'Miss', email: 'elodie.fairfax@post.aldermoor', city: 'Brightwater Spa', street: '22 Bathhouse Parade', segment: 'retail', occupation: 'Botanical Illustrator', kyc: 'expired', lang: 'en', dob: '1996-04-08', realms: ['ALD', 'CEL'], spender: 0.35, income: 2_900_00 },
  { key: 'hugo', name: 'Hugo Brambleworth', honorific: 'Mr', email: 'hugo.brambleworth@post.aldermoor', city: 'Vellinghast', street: '1 Market Cross', segment: 'business', occupation: 'Grocer', kyc: 'verified', lang: 'en', dob: '1972-02-22', realms: ['ALD'], spender: 0.3, income: 6_300_00 },
  { key: 'sabine', name: 'Sabine Rookwood', honorific: 'Ms', email: 'sabine.rookwood@post.aldermoor', city: 'Silverbridge', street: '50 Signalbox Road', segment: 'retail', occupation: 'Telegraphist', kyc: 'not_started', lang: 'en', dob: '2000-11-11', realms: ['ALD'], spender: 0.2, income: 2_200_00 },
];

export interface StaffSeed {
  key: string;
  name: string;
  role: 'teller' | 'manager' | 'accountant' | 'compliance' | 'auditor' | 'admin';
  email: string;
  dept: DeptCode;
  position: string;
  employeeId: string;
}

export const STAFF: StaffSeed[] = [
  { key: 'quill', name: 'Benedikt Quill', role: 'teller', email: 'b.quill@exchequer.aldermoor', dept: 'CSV', position: 'Senior Teller, Vellinghast Main Hall', employeeId: 'EMP-CSV-0112' },
  { key: 'holloway', name: 'Seraphine Holloway', role: 'manager', email: 's.holloway@exchequer.aldermoor', dept: 'TRS', position: 'Branch Manager, Vellinghast', employeeId: 'EMP-TRS-0031' },
  { key: 'fenwright', name: 'Tobias Fenwright', role: 'accountant', email: 't.fenwright@exchequer.aldermoor', dept: 'CMP', position: 'Ledger Accountant', employeeId: 'EMP-CMP-0207' },
  { key: 'morrow', name: 'Ilsa Morrow', role: 'compliance', email: 'i.morrow@exchequer.aldermoor', dept: 'CPL', position: 'Inquisitor-Clerk of Compliance', employeeId: 'EMP-CPL-0009' },
  { key: 'greymark', name: 'Ansel Greymark', role: 'auditor', email: 'a.greymark@exchequer.aldermoor', dept: 'AUD', position: 'Chief Auditor', employeeId: 'EMP-AUD-0001' },
  { key: 'vantress', name: 'Odile Vantress', role: 'admin', email: 'o.vantress@exchequer.aldermoor', dept: 'ADM', position: 'Archivist-General & Systems Steward', employeeId: 'EMP-ADM-0002' },
];

export const BRANCHES: Omit<Branch, 'cashAccountId'>[] = [
  { id: 'BR-VEL', code: 'BR-101', name: 'Vellinghast Main Hall', city: 'Vellinghast', address: '1 Exchequer Square, Vellinghast', hours: 'Mon–Fri 09:00–18:00', weekendHours: 'Sat 10:00–14:00', services: ['cash', 'fx', 'vaults', 'loans', 'business', 'notary', 'safe_deposit', 'atm'], status: 'open', map: { x: 488, y: 318 }, phone: '+0 (101) 400-1000', managerName: 'Seraphine Holloway', opened: '1347' },
  { id: 'BR-ELS', code: 'BR-102', name: 'Port Elsinmoor Harbour', city: 'Port Elsinmoor', address: '12 Customs Quay, Port Elsinmoor', hours: 'Mon–Fri 08:00–17:00', weekendHours: 'Sat 09:00–13:00', services: ['cash', 'fx', 'international', 'atm', 'business'], status: 'open', map: { x: 196, y: 402 }, phone: '+0 (102) 400-2000', managerName: 'Desmond Tarrow', opened: '1502' },
  { id: 'BR-THB', code: 'BR-103', name: 'Thornbury Cross', city: 'Thornbury Cross', address: '4 Market Cross, Thornbury', hours: 'Mon–Fri 09:00–17:00', weekendHours: 'Closed', services: ['cash', 'atm', 'loans'], status: 'open', map: { x: 640, y: 222 }, phone: '+0 (103) 400-3000', managerName: 'Agnes Pellow', opened: '1688' },
  { id: 'BR-GLM', code: 'BR-104', name: 'Gallowmere Lakeside', city: 'Gallowmere', address: '27 Lakeshore Road, Gallowmere', hours: 'Mon–Fri 09:30–16:30', weekendHours: 'Closed', services: ['cash', 'atm'], status: 'limited', map: { x: 352, y: 196 }, phone: '+0 (104) 400-4000', managerName: 'Rufus Crane', opened: '1751' },
  { id: 'BR-RVR', code: 'BR-105', name: 'Ravensreach Keep', city: 'Ravensreach', address: '2 Keep Gate, Ravensreach', hours: 'Mon–Fri 09:00–17:00', weekendHours: 'Sat 10:00–13:00', services: ['cash', 'vaults', 'safe_deposit', 'atm'], status: 'open', map: { x: 780, y: 128 }, phone: '+0 (105) 400-5000', managerName: 'Morwenna Black', opened: '1599' },
  { id: 'BR-SLB', code: 'BR-106', name: 'Silverbridge Station', city: 'Silverbridge', address: '9 Platform Way, Silverbridge', hours: 'Mon–Sat 08:00–20:00', weekendHours: 'Sun 10:00–16:00', services: ['cash', 'fx', 'atm'], status: 'open', map: { x: 600, y: 430 }, phone: '+0 (106) 400-6000', managerName: 'Cyrus Halden', opened: '1861' },
  { id: 'BR-OAK', code: 'BR-107', name: 'Oakhallow Green', city: 'Oakhallow', address: '15 Village Green, Oakhallow', hours: 'Tue–Fri 10:00–16:00', weekendHours: 'Closed', services: ['cash', 'loans'], status: 'open', map: { x: 418, y: 520 }, phone: '+0 (107) 400-7000', managerName: 'Bryony Ash', opened: '1904' },
  { id: 'BR-BRW', code: 'BR-108', name: 'Brightwater Spa Pavilion', city: 'Brightwater Spa', address: '3 Pump Room Walk, Brightwater', hours: 'Mon–Fri 10:00–18:00', weekendHours: 'Sat–Sun 11:00–15:00', services: ['cash', 'fx', 'vaults', 'premium', 'atm'], status: 'open', map: { x: 760, y: 470 }, phone: '+0 (108) 400-8000', managerName: 'Lucian Merriweather', opened: '1823' },
  { id: 'BR-KFN', code: 'BR-109', name: 'Kestrel Fen Outpost', city: 'Kestrel Fen', address: 'Causeway House, Kestrel Fen', hours: 'Mon, Wed, Fri 10:00–15:00', weekendHours: 'Closed', services: ['cash', 'atm'], status: 'maintenance', map: { x: 262, y: 590 }, phone: '+0 (109) 400-9000', managerName: 'Hester Reed', opened: '1955' },
  { id: 'BR-HLM', code: 'BR-110', name: 'Hollowmere Archive Annex', city: 'Hollowmere', address: '8 Scriptorium Hill, Hollowmere', hours: 'Mon–Fri 09:00–17:00', weekendHours: 'Closed', services: ['archive', 'notary', 'documents', 'atm'], status: 'open', map: { x: 880, y: 300 }, phone: '+0 (110) 400-0110', managerName: 'Odile Vantress', opened: '1420' },
];

export const EMPLOYEES: Omit<Employee, 'id' | 'userId'>[] = [
  { employeeId: 'EMP-TRS-0001', name: 'Castellan Reyne', department: 'TRS', position: 'Lord Treasurer', status: 'active', permissions: ['treasury.all', 'approve.large'], branchId: 'BR-VEL', email: 'c.reyne@exchequer.aldermoor', since: '1998-02-01', grade: 'I' },
  { employeeId: 'EMP-TRS-0031', name: 'Seraphine Holloway', department: 'TRS', position: 'Branch Manager, Vellinghast', status: 'active', permissions: ['branch.manage', 'loans.review', 'cash.manage'], branchId: 'BR-VEL', email: 's.holloway@exchequer.aldermoor', since: '2011-09-12', grade: 'III' },
  { employeeId: 'EMP-CMP-0004', name: 'Wilhelmina Orrery', department: 'CMP', position: 'Comptroller of Coin', status: 'active', permissions: ['finance.all'], branchId: 'BR-VEL', email: 'w.orrery@exchequer.aldermoor', since: '2003-04-20', grade: 'I' },
  { employeeId: 'EMP-CMP-0207', name: 'Tobias Fenwright', department: 'CMP', position: 'Ledger Accountant', status: 'active', permissions: ['ledger.view', 'rates.manage'], branchId: 'BR-VEL', email: 't.fenwright@exchequer.aldermoor', since: '2016-01-04', grade: 'IV' },
  { employeeId: 'EMP-PAY-0010', name: 'Lucan Fairweather', department: 'PAY', position: 'Director of Aetherline Payments', status: 'active', permissions: ['payments.all'], branchId: 'BR-VEL', email: 'l.fairweather@exchequer.aldermoor', since: '2007-06-30', grade: 'II' },
  { employeeId: 'EMP-PAY-0145', name: 'Nell Ambersmith', department: 'PAY', position: 'Clearing Officer', status: 'active', permissions: ['payments.ops'], branchId: 'BR-VEL', email: 'n.ambersmith@exchequer.aldermoor', since: '2019-03-11', grade: 'V' },
  { employeeId: 'EMP-FXB-0003', name: 'Ottoline Crane', department: 'FXB', position: 'Bureau Master of Exchange', status: 'active', permissions: ['rates.manage', 'fx.all'], branchId: 'BR-ELS', email: 'o.crane@exchequer.aldermoor', since: '2005-10-01', grade: 'II' },
  { employeeId: 'EMP-FXB-0088', name: 'Jasper Kettleby', department: 'FXB', position: 'Currency Dealer', status: 'on_leave', permissions: ['fx.trade'], branchId: 'BR-ELS', email: 'j.kettleby@exchequer.aldermoor', since: '2020-02-17', grade: 'V' },
  { employeeId: 'EMP-VLT-0002', name: 'Hadrian Kell', department: 'VLT', position: 'Warden-Superior of the Deep Vaults', status: 'active', permissions: ['vaults.manage'], branchId: 'BR-VEL', email: 'h.kell@exchequer.aldermoor', since: '1996-11-11', grade: 'II' },
  { employeeId: 'EMP-VLT-0057', name: 'Greta Underhill', department: 'VLT', position: 'Vault Warden', status: 'active', permissions: ['vaults.escort'], branchId: 'BR-RVR', email: 'g.underhill@exchequer.aldermoor', since: '2014-08-08', grade: 'VI' },
  { employeeId: 'EMP-ARC-0001', name: 'Odile Vantress', department: 'ARC', position: 'Archivist-General & Systems Steward', status: 'active', permissions: ['archive.all', 'admin.all'], branchId: 'BR-HLM', email: 'o.vantress@exchequer.aldermoor', since: '2001-01-15', grade: 'I' },
  { employeeId: 'EMP-ARC-0071', name: 'Felix Parchmore', department: 'ARC', position: 'Keeper of Sealed Records', status: 'active', permissions: ['archive.manage'], branchId: 'BR-HLM', email: 'f.parchmore@exchequer.aldermoor', since: '2012-05-21', grade: 'IV' },
  { employeeId: 'EMP-SEC-0006', name: 'Isembard Thorne', department: 'SEC', position: 'Ward-Captain of Banking Security', status: 'active', permissions: ['security.all', 'fraud.review'], branchId: 'BR-VEL', email: 'i.thorne@exchequer.aldermoor', since: '2009-07-07', grade: 'II' },
  { employeeId: 'EMP-SEC-0119', name: 'Rhosyn Vale', department: 'SEC', position: 'Fraud Analyst', status: 'active', permissions: ['fraud.review'], branchId: 'BR-VEL', email: 'r.vale@exchequer.aldermoor', since: '2021-04-12', grade: 'V' },
  { employeeId: 'EMP-AUD-0001', name: 'Ansel Greymark', department: 'AUD', position: 'Chief Auditor', status: 'active', permissions: ['audit.view', 'audit.export'], branchId: 'BR-VEL', email: 'a.greymark@exchequer.aldermoor', since: '2004-03-03', grade: 'II' },
  { employeeId: 'EMP-INT-0012', name: 'Marisol Duvane', department: 'INT', position: 'Envoy for Cross-Realm Affairs', status: 'active', permissions: ['international.all'], branchId: 'BR-ELS', email: 'm.duvane@exchequer.aldermoor', since: '2010-12-01', grade: 'II' },
  { employeeId: 'EMP-LND-0005', name: 'Perpetua Ashby', department: 'LND', position: 'Chancellor of Lending', status: 'active', permissions: ['loans.review', 'loans.approve'], branchId: 'BR-VEL', email: 'p.ashby@exchequer.aldermoor', since: '2006-09-15', grade: 'II' },
  { employeeId: 'EMP-LND-0090', name: 'Osric Hale', department: 'LND', position: 'Credit Assessor', status: 'active', permissions: ['loans.review'], branchId: 'BR-THB', email: 'o.hale@exchequer.aldermoor', since: '2018-10-29', grade: 'V' },
  { employeeId: 'EMP-DEP-0008', name: 'Florian Mabry', department: 'DEP', position: 'Keeper of Deposits', status: 'active', permissions: ['deposits.all'], branchId: 'BR-VEL', email: 'f.mabry@exchequer.aldermoor', since: '2008-02-14', grade: 'III' },
  { employeeId: 'EMP-CPL-0009', name: 'Ilsa Morrow', department: 'CPL', position: 'Inquisitor-Clerk of Compliance', status: 'active', permissions: ['kyc.review', 'fraud.review', 'disputes.review'], branchId: 'BR-VEL', email: 'i.morrow@exchequer.aldermoor', since: '2013-06-06', grade: 'III' },
  { employeeId: 'EMP-CSV-0112', name: 'Benedikt Quill', department: 'CSV', position: 'Senior Teller, Vellinghast Main Hall', status: 'active', permissions: ['teller.desk', 'documents.official'], branchId: 'BR-VEL', email: 'b.quill@exchequer.aldermoor', since: '2017-03-20', grade: 'V' },
  { employeeId: 'EMP-CSV-0140', name: 'Marigold Penhallow', department: 'CSV', position: 'Teller, Port Elsinmoor', status: 'active', permissions: ['teller.desk'], branchId: 'BR-ELS', email: 'm.penhallow@exchequer.aldermoor', since: '2022-01-10', grade: 'VI' },
  { employeeId: 'EMP-CSV-0151', name: 'Rosalind Pell', department: 'CSV', position: "Steward of the Petitioners' Hall", status: 'active', permissions: ['tickets.staff'], branchId: 'BR-VEL', email: 'r.pell@exchequer.aldermoor', since: '2015-11-02', grade: 'III' },
  { employeeId: 'EMP-ADM-0002', name: 'Barnaby Quillon', department: 'ADM', position: 'Secretary of the Exchequer', status: 'active', permissions: ['admin.all'], branchId: 'BR-VEL', email: 'b.quillon@exchequer.aldermoor', since: '1999-05-01', grade: 'I' },
  { employeeId: 'EMP-ADM-0044', name: 'Wren Calloway', department: 'ADM', position: 'Systems Clerk', status: 'suspended', permissions: ['systems.ops'], branchId: 'BR-HLM', email: 'w.calloway@exchequer.aldermoor', since: '2023-07-19', grade: 'VI' },
];

export const ARCHIVE_CASES = [
  { kind: 'case', dept: 'CPL', title: 'Inquiry into the Mirefen Hexpenny suspension', summary: 'Board of Compliance file on the suspension of the Mirefen Hexpenny pending a warding inquiry. Correspondence with the Veiled Courts attached.', tags: ['currency', 'sanctions'] },
  { kind: 'case', dept: 'SEC', title: 'Counterfeit Crown notes — Gallowmere ring', summary: 'Security case: 214 counterfeit 50-Crown notes recovered at Gallowmere Lakeside. Notes destroyed under seal.', tags: ['counterfeit', 'cash'] },
  { kind: 'case', dept: 'VLT', title: 'Undervault flooding of Hall C (1911)', summary: 'Historic record of the Undervault flood; inventory of salvaged deposit boxes and claims settled by the Treasury.', tags: ['vaults', 'historic'] },
  { kind: 'correspondence', dept: 'INT', title: 'Correspondent agreement — Banque Lunaire de Verrine', summary: 'Renewal of the nostro arrangement with Banque Lunaire de Verrine; settlement windows and cut-off times.', tags: ['international', 'nostro'] },
  { kind: 'contract', dept: 'TRS', title: 'Bullion custody charter with the Undervault', summary: 'Charter governing custody of sovereign bullion reserves in the Undervault of Vellinghast.', tags: ['treasury', 'bullion'] },
  { kind: 'document', dept: 'ARC', title: 'Founding Charter of the Exchequer (1347)', summary: 'Facsimile of the founding charter, sealed by the first Lord Treasurer. Original held in the Archive Rotunda.', tags: ['charter', 'historic'] },
  { kind: 'application', dept: 'LND', title: 'Guild loan scheme for lamplighters', summary: 'Application from the Lamplighters Guild for a collective credit scheme; approved with a 2% guild guarantee.', tags: ['loans', 'guild'] },
  { kind: 'case', dept: 'AUD', title: 'Annual audit of the Fee & Commission ledger', summary: 'Chamber of Auditors report: fee income reconciled against journals; no exceptions noted.', tags: ['audit', 'ledger'] },
  { kind: 'correspondence', dept: 'CSV', title: 'Petition regarding Kestrel Fen opening hours', summary: 'Residents of Kestrel Fen petition for extended hours during the reed harvest.', tags: ['branch', 'petition'] },
  { kind: 'transaction', dept: 'PAY', title: 'Largest single Aetherline settlement of the year', summary: 'Settlement record of a 4.2 million Crown transfer between the Treasury and the Silverbridge Rail Board.', tags: ['payments', 'record'] },
  { kind: 'case', dept: 'FXB', title: 'Moonsilver tide anomaly', summary: 'Bureau of Coinage note on the unusual Moonsilver Mark appreciation during the twin full moons.', tags: ['fx', 'magical'] },
  { kind: 'document', dept: 'ADM', title: 'Seal registry — register of official impressions', summary: 'Register of every official seal in use, with ink colours, custodians and retirement dates.', tags: ['seals', 'registry'] },
  { kind: 'contract', dept: 'DEP', title: 'Endowment of the Vellinghast Academy', summary: 'Perpetual endowment deed for the Vellinghast Academy scholarship fund.', tags: ['endowment', 'education'] },
  { kind: 'case', dept: 'SEC', title: 'Ward breach attempt at Ravensreach Keep', summary: 'Failed attempt to tamper with the rune seals of vault UV-4; wards held; incident closed.', tags: ['vaults', 'security'] },
  { kind: 'correspondence', dept: 'INT', title: 'Note verbale from the Sultanate of Qareth', summary: 'Diplomatic note on harmonising cross-realm transfer references.', tags: ['international', 'diplomacy'] },
] as const;
