/** Account-pocket picker, currency picker and money input. */
import { useId, useMemo, useState } from 'react';
import { currencies, MAJOR_CODES } from '@/core/currency/registry';
import { useT, useFmt } from '@/hooks/useT';
import { useMyAccounts, useAccountsWithBalances } from '@/hooks/data';
import { formatAccountNumber } from '@/core/banking/numbers';
import { Select, Input } from './primitives';
import type { Account } from '@/core/types';

export interface PocketRef {
  accountId: string;
  currency: string;
}

export function encodePocket(p: PocketRef) {
  return `${p.accountId}::${p.currency}`;
}

export function decodePocket(v: string): PocketRef | null {
  const [accountId, currency] = v.split('::');
  return accountId && currency ? { accountId, currency } : null;
}

/** Lists every pocket of the user's operable accounts, with available balances. */
export function AccountPicker({ value, onChange, filter, id, includeAllCurrencies, invalid, placeholder }: {
  value: string; onChange: (v: string) => void; filter?: (a: Account) => boolean; id?: string; includeAllCurrencies?: string; invalid?: boolean; placeholder?: string;
}) {
  const { t, tx } = useT();
  const f = useFmt();
  const accounts = useMyAccounts();
  const usable = accounts.filter((a) => a.type !== 'loan' && a.status !== 'closed' && (!filter || filter(a)));
  const withBal = useAccountsWithBalances(usable);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      <option value="">{placeholder ?? t('common.selectAccount')}</option>
      {withBal.map((a) => (
        <optgroup key={a.id} label={`${a.name} · ${tx(`accountType.${a.type}`)}${a.status === 'frozen' ? ` (${tx('status.account.frozen')})` : ''}`}>
          {a.pocketsInfo.map((p) => (
            <option key={p.currency} value={encodePocket({ accountId: a.id, currency: p.currency })} disabled={a.status === 'frozen'}>
              {p.currency} — {f.money(p.available, p.currency)} · {formatAccountNumber(a.number).slice(-9)}
            </option>
          ))}
          {includeAllCurrencies && a.multiCurrency && !a.pockets.includes(includeAllCurrencies) && (
            <option value={encodePocket({ accountId: a.id, currency: includeAllCurrencies })}>{includeAllCurrencies} — {t('pickers.newPocket')}</option>
          )}
        </optgroup>
      ))}
    </Select>
  );
}

/** Currency select over the registry. Transactional only by default; major currencies first. */
export function CurrencySelect({ value, onChange, id, all, include, invalid }: { value: string; onChange: (v: string) => void; id?: string; all?: boolean; include?: string[]; invalid?: boolean }) {
  const { t, tx } = useT();
  const list = useMemo(() => {
    const pool = (all ? currencies.all() : currencies.transactional()).filter((c) => !include || include.includes(c.code));
    const majors = MAJOR_CODES.map((c) => pool.find((x) => x.code === c)).filter(Boolean) as typeof pool;
    const magical = pool.filter((c) => c.kind === 'magical' && !MAJOR_CODES.includes(c.code));
    const metals = pool.filter((c) => c.kind === 'metal' && !MAJOR_CODES.includes(c.code));
    const rest = pool.filter((c) => !MAJOR_CODES.includes(c.code) && c.kind !== 'magical' && c.kind !== 'metal');
    return { majors, magical, metals, rest };
  }, [all, include]);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      <option value="">{t('common.selectCurrency')}</option>
      <optgroup label={t('pickers.frequent')}>{list.majors.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</optgroup>
      {list.magical.length > 0 && <optgroup label={tx('region.magical')}>{list.magical.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</optgroup>}
      {list.metals.length > 0 && <optgroup label={tx('currencyKind.metal')}>{list.metals.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</optgroup>}
      <optgroup label={t('pickers.allIso')}>{list.rest.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</optgroup>
    </Select>
  );
}

/** Decimal amount input bound to a currency's decimal places. Emits the raw string. */
export function MoneyInput({ value, onChange, currency, id, invalid, autoFocus }: { value: string; onChange: (v: string) => void; currency: string; id?: string; invalid?: boolean; autoFocus?: boolean }) {
  const d = currencies.decimals(currency || 'CRWN');
  const fallbackId = useId();
  const [touched, setTouched] = useState(false);
  return (
    <div className="input-group">
      <Input
        id={id ?? fallbackId}
        className="money-input"
        inputMode="decimal"
        autoComplete="off"
        placeholder={d ? `0.${'0'.repeat(d)}` : '0'}
        value={value}
        invalid={invalid && touched}
        autoFocus={autoFocus}
        onBlur={() => setTouched(true)}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.,\s]/g, '');
          onChange(v);
        }}
      />
      <span className="input-addon">{currency || '—'}</span>
    </div>
  );
}
