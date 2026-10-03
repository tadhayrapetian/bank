/**
 * Seal Registry of the Exchequer. Seal impressions carry their legend in the
 * official language of the Commonwealth; picker labels are translated in the UI
 * (`seal.<id>`). Official seals may only be applied by authorised staff.
 */

export type SealShape = 'round' | 'oval' | 'rect' | 'wax' | 'hex' | 'star';
export type InkId = 'royal' | 'crimson' | 'emerald' | 'violet' | 'black' | 'brass';

export interface SealDef {
  id: string;
  shape: SealShape;
  ink: InkId;
  top?: string;
  bottom?: string;
  center?: string;
  emblem?: 'crest' | 'key' | 'quill' | 'scales' | 'vault' | 'eye' | 'globe' | 'rune' | 'star' | 'crown' | 'tower' | 'oath';
  dated?: boolean;
  code?: string;
  official?: boolean;
  group: 'department' | 'status' | 'archive' | 'wax' | 'arcane';
}

export const INKS: Record<InkId, string> = {
  royal: '#1f3f95',
  crimson: '#a3192b',
  emerald: '#13684a',
  violet: '#5b2b8c',
  black: '#1d1b19',
  brass: '#8a6418',
};

export const SEALS: SealDef[] = [
  { id: 'official_bank_seal', shape: 'round', ink: 'royal', top: 'EXCHEQUER OF ALDERMOOR', bottom: 'OFFICIAL SEAL · MCCCXLVII', emblem: 'crest', official: true, group: 'department', code: 'AEX' },
  { id: 'treasury', shape: 'round', ink: 'brass', top: 'THE GILDED TREASURY', bottom: 'VELLINGHAST', emblem: 'crown', official: true, group: 'department', code: 'TRS' },
  { id: 'finance_department', shape: 'round', ink: 'royal', top: 'COMPTROLLER OF COIN', bottom: 'DEPARTMENT OF FINANCE', emblem: 'scales', official: true, group: 'department', code: 'CMP' },
  { id: 'payment_department', shape: 'round', ink: 'crimson', top: 'AETHERLINE PAYMENTS', bottom: 'DIRECTORATE · PAY', emblem: 'quill', official: true, group: 'department', code: 'PAY' },
  { id: 'currency_department', shape: 'round', ink: 'emerald', top: 'COINAGE & EXCHANGE', bottom: 'BUREAU · FXB', emblem: 'globe', official: true, group: 'department', code: 'FXB' },
  { id: 'vault_department', shape: 'round', ink: 'black', top: 'WARDENS OF THE DEEP VAULTS', bottom: 'UNDERVAULT', emblem: 'vault', official: true, group: 'department', code: 'VLT' },
  { id: 'archive_department', shape: 'round', ink: 'violet', top: 'HALL OF SEALED RECORDS', bottom: 'ARCHIVE ROTUNDA', emblem: 'tower', official: true, group: 'department', code: 'ARC' },
  { id: 'security_department', shape: 'round', ink: 'black', top: 'WARDS & BANKING SECURITY', bottom: 'BASTION WING', emblem: 'eye', official: true, group: 'department', code: 'SEC' },
  { id: 'audit_department', shape: 'round', ink: 'royal', top: 'CHAMBER OF AUDITORS', bottom: 'COUNTING HOUSE', emblem: 'scales', official: true, group: 'department', code: 'AUD' },
  { id: 'international_department', shape: 'round', ink: 'emerald', top: 'CROSS-REALM AFFAIRS', bottom: 'EMBASSY ROW', emblem: 'globe', official: true, group: 'department', code: 'INT' },
  { id: 'lending_chancery', shape: 'round', ink: 'crimson', top: 'LENDING CHANCERY', bottom: 'CHANCERY COURT', emblem: 'key', official: true, group: 'department', code: 'LND' },
  { id: 'deposits_office', shape: 'round', ink: 'brass', top: 'DEPOSITS & ENDOWMENTS', bottom: 'ENDOWMENT HALL', emblem: 'vault', official: true, group: 'department', code: 'DEP' },
  { id: 'compliance_board', shape: 'round', ink: 'violet', top: 'BOARD OF COMPLIANCE', bottom: '& OATHS', emblem: 'oath', official: true, group: 'department', code: 'CPL' },
  { id: 'notary', shape: 'round', ink: 'royal', top: 'NOTARY OF THE COMMONWEALTH', bottom: 'SWORN & ATTESTED', emblem: 'quill', official: true, group: 'department', code: 'NOT' },

  { id: 'verified', shape: 'rect', ink: 'emerald', center: 'VERIFIED', dated: true, group: 'status' },
  { id: 'approved', shape: 'rect', ink: 'emerald', center: 'APPROVED', dated: true, group: 'status' },
  { id: 'paid', shape: 'rect', ink: 'crimson', center: 'PAID', dated: true, group: 'status' },
  { id: 'cancelled', shape: 'rect', ink: 'crimson', center: 'CANCELLED', dated: true, group: 'status' },
  { id: 'confidential', shape: 'rect', ink: 'crimson', center: 'CONFIDENTIAL', group: 'status' },
  { id: 'original', shape: 'rect', ink: 'royal', center: 'ORIGINAL', group: 'status' },
  { id: 'copy', shape: 'rect', ink: 'black', center: 'COPY', group: 'status' },
  { id: 'urgent', shape: 'rect', ink: 'crimson', center: 'URGENT', group: 'status' },
  { id: 'international', shape: 'rect', ink: 'emerald', center: 'INTERNATIONAL', group: 'status' },
  { id: 'certified', shape: 'rect', ink: 'royal', center: 'CERTIFIED', dated: true, group: 'status' },
  { id: 'received', shape: 'rect', ink: 'violet', center: 'RECEIVED', dated: true, group: 'status' },
  { id: 'processed', shape: 'rect', ink: 'royal', center: 'PROCESSED', dated: true, group: 'status' },
  { id: 'rejected', shape: 'rect', ink: 'crimson', center: 'REJECTED', dated: true, group: 'status' },
  { id: 'void', shape: 'rect', ink: 'black', center: 'VOID', group: 'status' },
  { id: 'duplicate', shape: 'rect', ink: 'violet', center: 'DUPLICATE', group: 'status' },

  { id: 'archived', shape: 'oval', ink: 'violet', top: 'ARCHIVED', bottom: 'HALL OF SEALED RECORDS', dated: true, group: 'archive' },
  { id: 'received_oval', shape: 'oval', ink: 'royal', top: 'RECEIVED', bottom: "PETITIONERS' HALL", dated: true, group: 'archive' },
  { id: 'sealed_record', shape: 'oval', ink: 'crimson', top: 'SEALED RECORD', bottom: 'DO NOT UNSEAL', group: 'archive' },
  { id: 'registry_entry', shape: 'oval', ink: 'black', top: 'ENTERED IN REGISTRY', bottom: 'SECRETARIAT', dated: true, group: 'archive' },

  { id: 'wax_crimson', shape: 'wax', ink: 'crimson', emblem: 'crest', group: 'wax', official: true },
  { id: 'wax_emerald', shape: 'wax', ink: 'emerald', emblem: 'key', group: 'wax' },
  { id: 'wax_midnight', shape: 'wax', ink: 'black', emblem: 'rune', group: 'wax' },
  { id: 'wax_gold', shape: 'wax', ink: 'brass', emblem: 'crown', group: 'wax', official: true },
  { id: 'wax_violet', shape: 'wax', ink: 'violet', emblem: 'star', group: 'wax' },

  { id: 'rune_ward', shape: 'hex', ink: 'violet', center: 'WARDED', emblem: 'rune', group: 'arcane' },
  { id: 'interrealm_cleared', shape: 'star', ink: 'emerald', center: 'CLEARED', top: 'INTER-REALM', group: 'arcane' },
  { id: 'oathbound', shape: 'hex', ink: 'crimson', center: 'OATHBOUND', emblem: 'oath', group: 'arcane' },
];

export function sealById(id: string): SealDef | undefined {
  return SEALS.find((s) => s.id === id);
}
