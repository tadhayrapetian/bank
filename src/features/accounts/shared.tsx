/** Shared helpers for the account registry: type order, glyphs, access rules, copy buttons. */
import type { ReactNode } from 'react';
import {
  Landmark, PiggyBank, Lock, Briefcase, Users, Shield, Scale, Vault, Hourglass, CreditCard, HandCoins, BookOpen, Copy,
} from 'lucide-react';
import { useSession } from '@/state/session';
import { useT } from '@/hooks/useT';
import { copyText } from '@/ui/print';
import { toast } from '@/ui/Toasts';
import type { Account, AccountType, HoldReason } from '@/core/types';

/** Order in which account groups appear in the register. */
export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'current', 'savings', 'deposit', 'business', 'joint', 'reserve', 'escrow', 'vault', 'temporary', 'credit', 'loan',
];

const ICONS: Record<AccountType, ReactNode> = {
  current: <Landmark />, savings: <PiggyBank />, deposit: <Lock />, business: <Briefcase />, joint: <Users />,
  reserve: <Shield />, escrow: <Scale />, vault: <Vault />, temporary: <Hourglass />, credit: <CreditCard />, loan: <HandCoins />,
  internal: <BookOpen />,
};

export function TypeIcon({ type }: { type: AccountType }) {
  return <>{ICONS[type]}</>;
}

export const HOLD_REASONS: HoldReason[] = ['card_auth', 'cardless', 'approval', 'check', 'escrow', 'order'];

/** Freeze reasons offered to account holders (stored as codes on the account). */
export const FREEZE_REASONS = ['client_request', 'lost_card', 'suspicious_activity', 'travel'] as const;

export function freezeReasonKey(reason?: string) {
  return (reason ?? 'client_request').trim().replace(/\s+/g, '_');
}

export type AccountRole = 'owner' | 'coOwner' | 'trusted' | 'staff' | 'none';

/** Mirrors the core authorisation rules (core re-checks every operation). */
export function useAccountAccess(acc: Account | undefined) {
  const me = useSession((s) => s.user);
  const perms = useSession((s) => s.perms);
  const id = me?.id ?? '';
  const isOwner = !!acc && acc.ownerId === id;
  const isCo = !!acc && acc.coOwnerIds.includes(id);
  const isTrusted = !!acc && acc.trustedIds.includes(id);
  const staffManage = perms.has('accounts.manage_any') || perms.has('teller.desk');
  const role: AccountRole = isOwner ? 'owner' : isCo ? 'coOwner' : isTrusted ? 'trusted' : perms.has('tx.view_all') || perms.has('accounts.manage_any') ? 'staff' : 'none';
  return {
    role,
    canView: !!acc && (acc.partyIds.includes(id) || perms.has('tx.view_all') || perms.has('accounts.manage_any')),
    canManage: !!acc && (isOwner || isCo || staffManage),
    canOperate: !!acc && (isOwner || isCo || isTrusted || perms.has('teller.desk')),
    canParties: !!acc && (isOwner || perms.has('accounts.manage_any')),
    canUnfreezeCompliance: perms.has('accounts.manage_any'),
    isMine: !!acc && acc.partyIds.includes(id),
  };
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useT();
  return (
    <button
      type="button"
      className="icon-btn acc-copy"
      aria-label={label}
      title={label}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await copyText(value);
        toast({ tone: ok ? 'positive' : 'info', title: ok ? t('common.copied') : value });
      }}
    >
      <Copy />
    </button>
  );
}

/** Date helpers for statement periods (YYYY-MM-DD in bank time). */
export function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}
