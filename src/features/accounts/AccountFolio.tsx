/** One account in the register: a ledger folio card with number, balances, owners and status. */
import { Link } from 'react-router-dom';
import { Coins, Snowflake } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { Badge, StatusBadge } from '@/ui/primitives';
import { formatAccountNumber } from '@/core/banking/numbers';
import type { AccountWithBalances } from '@/hooks/data';
import type { User } from '@/core/types';
import { TypeIcon } from './shared';

export function AccountFolio({ a, users, meId }: { a: AccountWithBalances; users: Map<string, User>; meId?: string }) {
  const { t, tx } = useT();
  const f = useFmt();
  const primary = a.pocketsInfo.find((p) => p.currency === a.currency) ?? a.pocketsInfo[0];
  const others = a.pocketsInfo.filter((p) => p !== primary);
  const owners = [a.ownerId, ...a.coOwnerIds].map((id) => users.get(id)?.name ?? id);
  const role = meId === a.ownerId ? 'owner' : a.coOwnerIds.includes(meId ?? '') ? 'coOwner' : a.trustedIds.includes(meId ?? '') ? 'trusted' : null;
  const figureLabel = a.type === 'loan' ? t('accounts.outstanding') : t('common.balance');
  return (
    <Link to={`/accounts/${a.id}`} className={`acc-folio is-${a.status}`} aria-label={`${a.name} · ${formatAccountNumber(a.number)}`}>
      <div className="acc-folio-head">
        <span className="glyph" aria-hidden><TypeIcon type={a.type} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="acc-folio-name truncate">{a.name}</div>
          <div className="acc-folio-no mono">{formatAccountNumber(a.number)}</div>
        </div>
        <StatusBadge domain="account" status={a.status} />
      </div>
      <div className="acc-folio-figure">
        <span className="stat-label">{figureLabel} · {a.currency}</span>
        <span className={`acc-figure tnum${primary && primary.balance < 0 ? ' neg' : ''}`}>{primary ? f.money(primary.balance, primary.currency, { mask: true }) : '—'}</span>
      </div>
      {others.length > 0 && (
        <div className="acc-pocket-strip" aria-label={t('accounts.pockets')}>
          {others.map((p) => (
            <span key={p.currency} className="acc-pocket-chip"><span className="mono">{p.currency}</span><span className="tnum">{f.money(p.balance, p.currency, { mask: true })}</span></span>
          ))}
        </div>
      )}
      <dl className="acc-folio-grid">
        <div><dt>{t('common.available')}</dt><dd className="tnum">{primary ? f.money(Math.max(0, primary.available), primary.currency, { mask: true }) : '—'}</dd></div>
        <div><dt>{t('common.blocked')}</dt><dd className="tnum">{primary ? f.money(primary.held, primary.currency, { mask: true }) : '—'}</dd></div>
        <div><dt>{t('accounts.opened')}</dt><dd>{f.date(a.createdAt)}</dd></div>
        <div><dt>{a.coOwnerIds.length ? t('accounts.owners') : t('common.owner')}</dt><dd className="truncate" title={owners.join(', ')}>{owners.join(', ')}</dd></div>
      </dl>
      <div className="acc-folio-foot">
        <span className="xsmall muted">{tx(`accountType.${a.type}`)}</span>
        <span className="row" style={{ gap: 6 }}>
          {a.multiCurrency && <Badge tone="info"><Coins size={11} aria-hidden />{t('accounts.multiCurrency')}</Badge>}
          {a.status === 'frozen' && <Badge tone="info"><Snowflake size={11} aria-hidden />{tx(`accounts.freezeReason.${(a.frozenReason ?? 'client_request').replace(/\s+/g, '_')}`, undefined, a.frozenReason)}</Badge>}
          {role && role !== 'owner' && <Badge tone="magic">{t(`accounts.role.${role}`)}</Badge>}
        </span>
      </div>
    </Link>
  );
}
