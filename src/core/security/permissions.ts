/** Authorization layer — role → permission matrix and checks. */
import type { BizRole, Role } from '../types';
import { BankError } from '../errors';
import { actor, type Actor } from '../context';

export const PERMISSIONS = [
  'banking.self',
  'data.export',
  'teller.desk',
  'accounts.manage_any',
  'tx.view_all',
  'tx.reverse',
  'fraud.review',
  'kyc.review',
  'loans.review',
  'disputes.review',
  'claims.review',
  'audit.view',
  'admin.panel',
  'users.manage',
  'employees.manage',
  'branches.manage',
  'currencies.manage',
  'rates.manage',
  'settings.manage',
  'status.manage',
  'notifications.broadcast',
  'documents.official',
  'archive.all',
  'vaults.manage',
  'cash.manage',
  'clock.manage',
  'data.restore',
  'tickets.staff',
  'payments.ops',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  client: ['banking.self', 'data.export'],
  teller: ['banking.self', 'data.export', 'teller.desk', 'documents.official', 'tickets.staff', 'tx.view_all', 'archive.all'],
  manager: [
    'banking.self', 'data.export', 'teller.desk', 'documents.official', 'tickets.staff', 'tx.view_all', 'tx.reverse',
    'accounts.manage_any', 'loans.review', 'disputes.review', 'claims.review', 'branches.manage', 'vaults.manage',
    'cash.manage', 'archive.all', 'payments.ops', 'admin.panel',
  ],
  accountant: ['banking.self', 'data.export', 'tx.view_all', 'loans.review', 'rates.manage', 'archive.all', 'payments.ops', 'admin.panel'],
  compliance: [
    'banking.self', 'data.export', 'tx.view_all', 'fraud.review', 'kyc.review', 'disputes.review', 'audit.view', 'archive.all',
    'admin.panel', 'payments.ops',
  ],
  auditor: ['banking.self', 'data.export', 'tx.view_all', 'audit.view', 'archive.all', 'admin.panel'],
  admin: [...PERMISSIONS],
};

export function permissionsOf(roles: Role[]): Set<Permission> {
  const s = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) s.add(p);
  return s;
}

export function can(p: Permission, a: Actor = actor()): boolean {
  if (a.system) return true;
  return permissionsOf(a.roles).has(p);
}

export function requirePermission(p: Permission, a: Actor = actor()) {
  if (!can(p, a)) throw new BankError('PERMISSION_DENIED', { permission: p });
}

export function isStaff(a: Actor = actor()): boolean {
  return a.system || a.roles.some((r) => r !== 'client');
}

/* Business roles (company membership) */
export const BIZ_ABILITIES: Record<BizRole, string[]> = {
  owner: ['view', 'create_payment', 'approve_manager', 'review_accountant', 'manage_staff', 'run_payroll', 'manage_members', 'reports', 'cards'],
  manager: ['view', 'create_payment', 'approve_manager', 'manage_staff', 'run_payroll', 'reports', 'cards'],
  accountant: ['view', 'create_payment', 'review_accountant', 'run_payroll', 'reports'],
  employee: ['view', 'create_payment'],
  auditor: ['view', 'reports'],
};

export function bizCan(role: BizRole | undefined, ability: string): boolean {
  if (!role) return false;
  return BIZ_ABILITIES[role].includes(ability);
}
