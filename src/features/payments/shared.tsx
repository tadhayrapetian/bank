/** Helpers shared by the Aetherline payments pages. */
import { useEffect, useMemo } from 'react';
import { Copy } from 'lucide-react';
import { Button, Select } from '@/ui/primitives';
import { EMBED, copyText } from '@/ui/print';
import { toast } from '@/ui/Toasts';
import { useT, useFmt } from '@/hooks/useT';
import { useAccountsWithBalances, useMyAccounts } from '@/hooks/data';
import type { PaymentLink, TxType } from '@/core/types';

/** Shareable address of a payment link (the in-app route when running embedded). */
export function linkUrl(code: string): string {
  if (EMBED || typeof location === 'undefined') return `/pay/${code}`;
  return `${location.origin}${location.pathname}#/pay/${code}`;
}

/** A link past its expiry is shown as expired even before the end-of-day job files it. */
export function linkStatus(l: PaymentLink, nowIso: string): PaymentLink['status'] {
  return l.status === 'active' && l.expiresAt < nowIso ? 'expired' : l.status;
}

/** Transaction types that travel over the Aetherline network. */
export const NETWORK_TYPES: TxType[] = ['transfer', 'own_transfer', 'international', 'request', 'link', 'qr', 'bulk', 'recurring', 'invoice', 'payroll'];

export const TX_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'rejected', 'expired', 'reversed'] as const;

export function useMyAccountIds(): Set<string> {
  const accounts = useMyAccounts({ includeClosed: true, includeHidden: true });
  return useMemo(() => new Set(accounts.map((a) => a.id)), [accounts]);
}

/** Pockets of the user's operable accounts in one currency, with available balances. */
export function usePocketsIn(currency: string | undefined) {
  const accounts = useMyAccounts();
  const usable = accounts.filter((a) => a.type !== 'loan' && a.status !== 'closed' && (!currency || a.pockets.includes(currency)));
  const withBal = useAccountsWithBalances(usable);
  return useMemo(() => withBal.flatMap((a) => a.pocketsInfo.filter((p) => p.currency === currency).map((p) => ({ account: a, pocket: p }))), [withBal, currency]);
}

export function CurrencyPocketSelect({ currency, value, onChange, id, invalid }: { currency: string; value: string; onChange: (accountId: string) => void; id?: string; invalid?: boolean }) {
  const { t, tx } = useT();
  const f = useFmt();
  const pockets = usePocketsIn(currency);
  useEffect(() => {
    if (!value && pockets.length) {
      const best = [...pockets].filter((p) => p.account.status === 'active').sort((a, b) => b.pocket.available - a.pocket.available)[0];
      if (best) onChange(best.account.id);
    }
  }, [pockets, value, onChange]);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      <option value="">{t('common.selectAccount')}</option>
      {pockets.map(({ account: a, pocket: p }) => (
        <option key={a.id} value={a.id} disabled={a.status === 'frozen'}>
          {a.name} · {tx(`accountType.${a.type}`)} — {f.money(p.available, p.currency)}{a.status === 'frozen' ? ` (${tx('status.account.frozen')})` : ''}
        </option>
      ))}
    </Select>
  );
}

export function CopyButton({ value, label, done, size = 'sm', variant = 'ghost' }: { value: string; label: string; done?: string; size?: 'sm' | 'md'; variant?: 'ghost' | 'default' }) {
  const { t } = useT();
  return (
    <Button size={size} variant={variant} icon={<Copy />} onClick={async () => {
      const ok = await copyText(value);
      toast({ tone: ok ? 'positive' : 'info', title: ok ? done ?? t('common.copied') : value });
    }}>{label}</Button>
  );
}
