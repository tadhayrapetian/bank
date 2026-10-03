/** Account folio: number, status, owners and limits; pockets and holds; every instrument wired to the core; history, ledger and papers. */
import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowLeftRight, Repeat, ScrollText, FileSignature, PencilLine, Gauge, Snowflake, Sun, Coins, UserPlus, DoorClosed,
  Users, Wallet, Lock, Link2, ShieldAlert, BookOpen, History, FileText, LayoutGrid, Building2, UserMinus, CreditCard, PiggyBank, HandCoins,
} from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useAccountsWithBalances, useLive, useUserMap } from '@/hooks/data';
import { useAction } from '@/hooks/useAction';
import { useUI } from '@/state/ui';
import { useSession } from '@/state/session';
import { db } from '@/core/db/db';
import { toBase } from '@/core/currency/rates';
import { currencies } from '@/core/currency/registry';
import { formatAccountNumber } from '@/core/banking/numbers';
import { removeAccountParty, unfreezeAccount } from '@/core/banking/accounts';
import { outgoingToday } from '@/core/banking/engine';
import { confirmAction } from '@/ui/Modal';
import { encodePocket } from '@/ui/pickers';
import { Guilloche } from '@/ui/heraldry';
import { Alert, Avatar, Badge, Button, Empty, KV, Money, Panel, Progress, StatusBadge, Tabs } from '@/ui/primitives';
import type { Account, User } from '@/core/types';
import { AccountDialog, type DialogName } from './AccountDialogs';
import { BalanceHistory } from './BalanceHistory';
import { AccountLedger } from './AccountLedger';
import { AccountHistory, useAccountTransactions } from './AccountHistory';
import { AccountDocuments } from './AccountDocuments';
import { CopyButton, TypeIcon, freezeReasonKey, useAccountAccess } from './shared';

type Tab = 'overview' | 'history' | 'ledger' | 'documents';

export default function AccountDetailPage() {
  const { id = '' } = useParams();
  const { t } = useT();
  const acc = useLive(() => db.accounts.get(id).then((a) => a ?? null), [id], undefined as Account | null | undefined);
  const access = useAccountAccess(acc ?? undefined);
  if (acc === undefined) return <div className="page"><div className="skeleton" style={{ height: 220 }} /></div>;
  if (!acc || acc.type === 'internal') {
    return (
      <div className="page">
        <Empty icon={<BookOpen aria-hidden />} title={t('accounts.notFound.title')} action={<Link className="btn btn-sm" to="/accounts"><ArrowLeft />{t('accounts.backToRegister')}</Link>}>
          {t('accounts.notFound.text', { id })}
        </Empty>
      </div>
    );
  }
  if (!access.canView) {
    return (
      <div className="page">
        <Empty icon={<ShieldAlert aria-hidden />} title={t('accounts.restricted.title')} action={<Link className="btn btn-sm" to="/accounts"><ArrowLeft />{t('accounts.backToRegister')}</Link>}>
          {t('accounts.restricted.text')}
        </Empty>
      </div>
    );
  }
  return <AccountView acc={acc} />;
}

function AccountView({ acc }: { acc: Account }) {
  const { t, tx } = useT();
  const f = useFmt();
  const ui = useUI();
  const me = useSession((s) => s.user);
  const access = useAccountAccess(acc);
  const [withBal] = useAccountsWithBalances([acc]);
  const users = useUserMap();
  const [sp, setSp] = useSearchParams();
  const tab = (['overview', 'history', 'ledger', 'documents'].includes(sp.get('tab') ?? '') ? sp.get('tab') : 'overview') as Tab;
  const setTab = (v: Tab) => { const n = new URLSearchParams(sp); if (v === 'overview') n.delete('tab'); else n.set('tab', v); setSp(n, { replace: true }); };
  const [dialog, setDialog] = useState<{ name: DialogName; params?: Record<string, string> } | null>(null);
  const open = (name: DialogName, params?: Record<string, string>) => setDialog({ name, params });
  const { run, busy } = useAction();

  const txs = useAccountTransactions(acc.id);
  const ledgerCount = useLive(async () => (await db.balances.where('accountId').equals(acc.id).toArray()).reduce((s, r) => s + r.entries, 0), [acc.id], 0);
  const docCount = useLive(() => db.documents.where('partyIds').anyOf([...acc.partyIds, acc.ownerId]).distinct().filter((d) => d.links.accountIds.includes(acc.id)).count(), [acc.id, acc.partyIds.join()], 0);

  const pockets = withBal?.pocketsInfo ?? [];
  const primary = pockets.find((p) => p.currency === acc.currency) ?? pockets[0];
  const owner = users.get(acc.ownerId);
  const closed = acc.status === 'closed';
  const frozen = acc.status === 'frozen';
  const active = acc.status === 'active';
  const complianceFreeze = frozen && acc.frozenReason === 'compliance' && !access.canUnfreezeCompliance;
  const isCreditLike = acc.type === 'loan' || acc.type === 'credit';

  const unfreeze = async () => {
    const ok = await confirmAction({ title: t('accounts.unfreezeConfirm.title', { name: acc.name }), body: t('accounts.unfreezeConfirm.body'), confirmLabel: t('common.unfreeze') });
    if (ok) await run(() => unfreezeAccount(acc.id), { success: t('accounts.unfrozen'), sound: 'safe' });
  };

  const instruments: { key: string; label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; why?: string; tone?: 'danger' }[] = [
    {
      key: 'transfer', label: t('accounts.act.transfer'), icon: <ArrowLeftRight />,
      onClick: () => ui.openAction('transfer', { mode: 'own', from: encodePocket({ accountId: acc.id, currency: acc.currency }) }),
      disabled: !access.canOperate || !active || acc.type === 'loan', why: !access.canOperate ? t('accounts.why.operate') : !active ? t('accounts.why.notActive') : acc.type === 'loan' ? t('accounts.why.loan') : undefined,
    },
    ...(acc.multiCurrency ? [{ key: 'exchange', label: t('accounts.act.exchange'), icon: <Repeat />, onClick: () => ui.openAction('exchange'), disabled: !access.canOperate || !active, why: !active ? t('accounts.why.notActive') : undefined }] : []),
    { key: 'statement', label: t('accounts.act.statement'), icon: <ScrollText />, onClick: () => open('statement') },
    { key: 'document', label: t('accounts.act.document'), icon: <FileSignature />, onClick: () => open('document') },
    { key: 'rename', label: t('accounts.act.rename'), icon: <PencilLine />, onClick: () => open('rename'), disabled: !access.canManage || closed, why: closed ? t('accounts.why.closed') : !access.canManage ? t('accounts.why.manage') : undefined },
    { key: 'limit', label: t('accounts.act.limit'), icon: <Gauge />, onClick: () => open('limit'), disabled: !access.canManage || closed || isCreditLike, why: closed ? t('accounts.why.closed') : isCreditLike ? t('accounts.why.loan') : !access.canManage ? t('accounts.why.manage') : undefined },
    frozen
      ? { key: 'unfreeze', label: t('common.unfreeze'), icon: <Sun />, onClick: unfreeze, disabled: !access.canManage || complianceFreeze || busy, why: complianceFreeze ? t('accounts.why.compliance') : !access.canManage ? t('accounts.why.manage') : undefined }
      : { key: 'freeze', label: t('common.freeze'), icon: <Snowflake />, onClick: () => open('freeze'), disabled: !access.canManage || !active, why: !active ? t('accounts.why.notActive') : !access.canManage ? t('accounts.why.manage') : undefined },
    { key: 'pocket', label: t('accounts.act.pocket'), icon: <Coins />, onClick: () => open('pocket'), disabled: !access.canManage || closed || !acc.multiCurrency, why: !acc.multiCurrency ? t('accounts.why.single') : closed ? t('accounts.why.closed') : !access.canManage ? t('accounts.why.manage') : undefined },
    { key: 'party', label: t('accounts.act.party'), icon: <UserPlus />, onClick: () => open('party'), disabled: !access.canParties || closed || isCreditLike, why: closed ? t('accounts.why.closed') : isCreditLike ? t('accounts.why.loan') : !access.canParties ? t('accounts.why.owner') : undefined },
    { key: 'close', label: t('accounts.act.close'), icon: <DoorClosed />, onClick: () => open('close'), disabled: !access.canManage || closed || isCreditLike, why: closed ? t('accounts.why.closed') : isCreditLike ? t('accounts.why.loan') : !access.canManage ? t('accounts.why.manage') : undefined, tone: 'danger' },
  ];

  const totalBase = pockets.reduce((s, p) => s + toBase(p.balance, p.currency, f.base), 0);

  return (
    <div className="page acc-page">
      <nav className="acc-crumbs xsmall" aria-label={t('accounts.crumbs')}>
        <Link to="/accounts"><ArrowLeft size={13} aria-hidden />{t('accounts.title')}</Link>
        <span aria-hidden>/</span>
        <span className="mono">{formatAccountNumber(acc.number)}</span>
      </nav>

      <section className={`panel ornate acc-hero is-${acc.status}`} aria-labelledby="acc-title">
        <div className="acc-hero-pattern" aria-hidden><Guilloche width={900} height={280} opacity={0.07} /></div>
        <div className="acc-hero-id">
          <div className="eyebrow">{t('dept.DEP')}<span className="acc-eyebrow-sep" aria-hidden>·</span>{t('accounts.folio', { id: acc.id })}</div>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="acc-hero-glyph" aria-hidden><TypeIcon type={acc.type} /></span>
            <div className="grow">
              <h1 id="acc-title" className="acc-hero-title">{acc.name}</h1>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <StatusBadge domain="account" status={acc.status} />
                <Badge>{tx(`accountType.${acc.type}`)}</Badge>
                {acc.multiCurrency && <Badge tone="info"><Coins size={11} aria-hidden />{t('accounts.multiCurrency')}</Badge>}
                {access.role !== 'owner' && access.role !== 'none' && <Badge tone="magic">{t(`accounts.role.${access.role}`)}</Badge>}
              </div>
            </div>
          </div>
          <div className="acc-number-plate">
            <div className="stat-label">{t('common.accountNumber')}</div>
            <div className="row-nowrap" style={{ gap: 6 }}>
              <span className="acc-number mono">{formatAccountNumber(acc.number)}</span>
              <CopyButton value={acc.number} label={t('accounts.copyNumber')} />
            </div>
            <div className="xsmall muted mono">{acc.number} · {t('accounts.bankCode')} AEX · {t('accounts.checkDigits', { cd: acc.number.slice(2, 4) })}</div>
          </div>
        </div>
        <div className="acc-hero-figures">
          <div className="stat-label">{acc.type === 'loan' ? t('accounts.outstanding') : t('common.balance')} · {primary?.currency ?? acc.currency}</div>
          <div className={`hero-figure tnum${primary && primary.balance < 0 ? ' neg' : ''}`}>{primary ? f.money(primary.balance, primary.currency, { mask: true }) : '—'}</div>
          <div className="acc-hero-sub">
            <div><span className="stat-label">{t('common.available')}</span><span className="tnum">{primary ? f.money(Math.max(0, primary.available), primary.currency, { mask: true }) : '—'}</span></div>
            <div><span className="stat-label">{t('common.blocked')}</span><span className="tnum">{primary ? f.money(primary.held, primary.currency, { mask: true }) : '—'}</span></div>
            {pockets.length > 1 && <div><span className="stat-label">{t('accounts.allPocketsIn', { base: f.base })}</span><span className="tnum">{f.money(totalBase, f.base, { mask: true })}</span></div>}
          </div>
          <dl className="acc-hero-meta">
            <div><dt>{t('common.holder')}</dt><dd>{owner?.name ?? acc.ownerId}{owner && <span className="mono muted"> · {owner.clientId}</span>}</dd></div>
            <div><dt>{t('accounts.opened')}</dt><dd>{f.dateLong(acc.createdAt)}</dd></div>
            <div><dt>{t('accounts.dailyLimit')}</dt><dd>{acc.dailyLimit ? f.money(acc.dailyLimit, acc.currency) : t('accounts.noLimit')}</dd></div>
          </dl>
        </div>
      </section>

      {closed && <Alert tone="neutral" title={t('accounts.closedBanner.title', { date: f.dateLong(acc.closedAt) })}>{t('accounts.closedBanner.text')}</Alert>}
      {frozen && (
        <Alert tone="info" title={t('accounts.frozenBanner.title')}>
          {t('accounts.frozenBanner.text', { reason: tx(`accounts.freezeReason.${freezeReasonKey(acc.frozenReason)}`, undefined, acc.frozenReason) })}
          {complianceFreeze ? ` ${t('accounts.why.compliance')}` : ''}
        </Alert>
      )}
      {access.role === 'staff' && <Alert tone="magic" title={t('accounts.staffView.title')}>{t('accounts.staffView.text', { name: owner?.name ?? '', client: owner?.clientId ?? '' })}</Alert>}

      <Panel title={t('accounts.instruments')} icon={<LayoutGrid />} sub={t('accounts.instrumentsSub')}>
        <div className="acc-instruments">
          {instruments.map((i) => (
            <button key={i.key} type="button" className={`qa acc-instrument${i.tone === 'danger' ? ' is-danger' : ''}`} onClick={i.onClick} disabled={i.disabled} title={i.disabled ? i.why : undefined} aria-describedby={i.disabled && i.why ? `why-${i.key}` : undefined}>
              <span className="glyph" aria-hidden>{i.icon}</span>
              <span>{i.label}</span>
              {i.disabled && i.why && <span id={`why-${i.key}`} className="sr-only">{i.why}</span>}
            </button>
          ))}
        </div>
      </Panel>

      <Tabs label={t('accounts.sections')} value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: t('common.overview'), icon: <Wallet size={15} aria-hidden /> },
        { value: 'history', label: t('common.history'), count: txs.length, icon: <History size={15} aria-hidden /> },
        { value: 'ledger', label: t('accounts.ledger.tab'), count: ledgerCount, icon: <BookOpen size={15} aria-hidden /> },
        { value: 'documents', label: t('accounts.docs.tab'), count: docCount, icon: <FileText size={15} aria-hidden /> },
      ]} />

      {tab === 'overview' && (
        <div className="grid cols-main">
          <div className="stack-lg">
            <PocketsPanel acc={acc} pockets={pockets} onStatement={(ccy) => open('statement', { ccy })} />
            <BalanceHistory acc={acc} />
          </div>
          <div className="stack-lg">
            <PartiesPanel acc={acc} users={users} meId={me?.id} canEdit={access.canParties && !closed && !isCreditLike} onAdd={(role) => open('party', { role })} />
            <TermsPanel acc={acc} />
            <HoldsPanel acc={acc} />
            <LinkedPanel acc={acc} />
          </div>
        </div>
      )}
      {tab === 'history' && <AccountHistory acc={acc} />}
      {tab === 'ledger' && <AccountLedger acc={acc} />}
      {tab === 'documents' && <AccountDocuments acc={acc} canGenerate onStatement={() => open('statement')} onDocument={() => open('document')} />}

      {dialog && <AccountDialog which={dialog.name} params={dialog.params} acc={acc} onClose={() => setDialog(null)} />}
    </div>
  );
}

/* ── Pockets ── */
function PocketsPanel({ acc, pockets, onStatement }: { acc: Account; pockets: { currency: string; balance: number; held: number; available: number }[]; onStatement: (ccy: string) => void }) {
  const { t } = useT();
  const f = useFmt();
  return (
    <Panel title={t('accounts.pockets')} icon={<Coins />} sub={acc.multiCurrency ? t('accounts.pocketsSubMulti', { n: pockets.length }) : t('accounts.pocketsSubSingle')} flush>
      <div className="table-wrap">
        <table className="table acc-pockets-table">
          <thead>
            <tr>
              <th scope="col">{t('common.currency')}</th>
              <th scope="col" className="num">{t('common.balance')}</th>
              <th scope="col" className="num">{t('common.blocked')}</th>
              <th scope="col" className="num">{t('common.available')}</th>
              <th scope="col" className="num acc-hide-sm">{t('accounts.inBase', { base: f.base })}</th>
              <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {pockets.map((p) => (
              <tr key={p.currency}>
                <td>
                  <div className="row-nowrap" style={{ gap: 8 }}>
                    <span className="code-tag">{p.currency}</span>
                    <span className="small ink2 truncate acc-hide-sm">{currencies.get(p.currency)?.name ?? p.currency}</span>
                    {p.currency === acc.currency && <Badge plain>{t('accounts.primary')}</Badge>}
                  </div>
                </td>
                <td className="num"><strong className={p.balance < 0 ? 'neg' : ''}>{f.money(p.balance, p.currency, { mask: true })}</strong></td>
                <td className="num">{p.held ? <span className="warn-text">{f.money(p.held, p.currency, { mask: true })}</span> : <span className="muted">—</span>}</td>
                <td className="num">{f.money(Math.max(0, p.available), p.currency, { mask: true })}</td>
                <td className="num muted acc-hide-sm">{f.money(toBase(p.balance, p.currency, f.base), f.base, { mask: true })}</td>
                <td className="right"><Button size="sm" variant="ghost" icon={<ScrollText />} onClick={() => onStatement(p.currency)} aria-label={t('accounts.statementFor', { ccy: p.currency })}><span className="acc-hide-sm">{t('accounts.statementShort')}</span></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="acc-ledger-note xsmall muted">{t('accounts.pocketsNote')}</div>
    </Panel>
  );
}

/* ── Owners & trusted persons ── */
function PartiesPanel({ acc, users, meId, canEdit, onAdd }: { acc: Account; users: Map<string, User>; meId?: string; canEdit: boolean; onAdd: (role: 'coOwner' | 'trusted') => void }) {
  const { t } = useT();
  const { run } = useAction();
  const people: { id: string; role: 'owner' | 'coOwner' | 'trusted' }[] = [
    { id: acc.ownerId, role: 'owner' },
    ...acc.coOwnerIds.map((id) => ({ id, role: 'coOwner' as const })),
    ...acc.trustedIds.map((id) => ({ id, role: 'trusted' as const })),
  ];
  const remove = async (u: User | undefined, id: string) => {
    const ok = await confirmAction({ title: t('accounts.parties.removeTitle', { name: u?.name ?? id }), body: t('accounts.parties.removeBody'), confirmLabel: t('common.remove'), danger: true });
    if (ok) await run(() => removeAccountParty(acc.id, id), { success: t('accounts.parties.removed'), sound: 'paper' });
  };
  return (
    <Panel title={t('accounts.parties.title')} icon={<Users />} sub={t('accounts.parties.sub')} flush
      footer={canEdit ? (
        <>
          <Button size="sm" icon={<UserPlus />} onClick={() => onAdd('coOwner')}>{t('accounts.parties.addCoOwner')}</Button>
          <Button size="sm" variant="ghost" icon={<UserPlus />} onClick={() => onAdd('trusted')}>{t('accounts.parties.addTrusted')}</Button>
        </>
      ) : undefined}>
      <div className="list">
        {people.map((p) => {
          const u = users.get(p.id);
          return (
            <div key={p.role + p.id} className="list-item">
              <Avatar name={u?.name ?? p.id} hue={u?.avatarHue} />
              <div className="li-main">
                <div className="li-title">{u?.name ?? p.id}{p.id === meId ? <span className="muted"> ({t('common.you')})</span> : null}</div>
                <div className="li-sub"><span className="mono">{u?.clientId ?? '—'}</span> · {t(`accounts.roleHelp.${p.role}`)}</div>
              </div>
              <div className="li-end row" style={{ gap: 6 }}>
                <Badge tone={p.role === 'owner' ? 'positive' : p.role === 'coOwner' ? 'info' : 'magic'}>{t(`accounts.role.${p.role}`)}</Badge>
                {canEdit && p.role !== 'owner' && (
                  <button type="button" className="icon-btn" aria-label={t('accounts.parties.remove', { name: u?.name ?? p.id })} title={t('accounts.parties.remove', { name: u?.name ?? p.id })} onClick={() => remove(u, p.id)}><UserMinus /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ── Terms, limits, conditions ── */
function TermsPanel({ acc }: { acc: Account }) {
  const { t, tx } = useT();
  const f = useFmt();
  const branch = useLive(() => db.branches.get(acc.branchId), [acc.branchId], undefined);
  const used = useLive(async () => { await db.transactions.count(); return outgoingToday(acc.id, acc.currency); }, [acc.id, acc.currency], 0);
  const items: [ReactNode, ReactNode][] = [
    [t('common.type'), tx(`accountType.${acc.type}`)],
    [t('accounts.primaryCurrency'), <span><span className="code-tag">{acc.currency}</span> {currencies.get(acc.currency)?.name}</span>],
    [t('accounts.dailyLimit'), acc.dailyLimit ? (
      <div className="stack-sm" style={{ gap: 4 }}>
        <span className="tnum">{t('accounts.limitUsage', { used: f.money(used, acc.currency), limit: f.money(acc.dailyLimit, acc.currency) })}</span>
        <Progress value={used} max={acc.dailyLimit} label={t('accounts.dailyLimit')} />
      </div>
    ) : <span className="muted">{t('accounts.noLimit')}</span>],
  ];
  if (acc.overdraftLimit) items.push([acc.type === 'credit' ? t('accounts.creditLimit') : t('accounts.overdraft'), f.money(acc.overdraftLimit, acc.currency)]);
  if (acc.interestRate) items.push([t('common.rate'), `${f.pct(acc.interestRate)} ${t('common.perAnnum')}`]);
  items.push([t('accounts.opened'), f.dateTime(acc.createdAt)]);
  items.push([t('common.branch'), branch ? <Link to={`/branches?id=${branch.id}`}>{branch.name} <span className="mono muted">{branch.code}</span></Link> : acc.branchId]);
  if (acc.expiresAt) items.push([t('common.expires'), <span className={acc.expiresAt < new Date().toISOString() ? 'warn-text' : ''}>{f.dateLong(acc.expiresAt)}</span>]);
  if (acc.escrow) {
    items.push([t('accounts.escrow.beneficiary'), acc.escrow.beneficiaryName]);
    items.push([t('accounts.escrow.condition'), acc.escrow.condition]);
    items.push([t('accounts.escrow.state'), acc.escrow.released ? <Badge tone="positive">{t('accounts.escrow.released')}</Badge> : <Badge tone="warning">{t('accounts.escrow.held')}</Badge>]);
  }
  if (acc.purpose) items.push([t('common.purpose'), acc.purpose]);
  if (acc.status === 'frozen') items.push([t('accounts.frozenReason'), tx(`accounts.freezeReason.${freezeReasonKey(acc.frozenReason)}`, undefined, acc.frozenReason)]);
  if (acc.closedAt) items.push([t('accounts.closedAt'), f.dateTime(acc.closedAt)]);
  items.push([t('accounts.internalId'), <span className="code-tag">{acc.id}</span>]);
  return (
    <Panel title={t('accounts.terms')} icon={<Building2 />}>
      <KV items={items} />
    </Panel>
  );
}

/* ── Holds ── */
function HoldsPanel({ acc }: { acc: Account }) {
  const { t, tx } = useT();
  const f = useFmt();
  const [showAll, setShowAll] = useState(false);
  const holds = useLive(() => db.holds.where('accountId').equals(acc.id).toArray().then((r) => r.sort((a, b) => b.createdAt.localeCompare(a.createdAt))), [acc.id], []);
  const active = holds.filter((h) => h.status === 'active');
  const past = holds.filter((h) => h.status !== 'active');
  const list = showAll ? holds : active;
  return (
    <Panel title={t('accounts.holds.title')} icon={<Lock />} sub={t('accounts.holds.sub', { n: active.length })} flush
      actions={past.length ? <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? t('accounts.holds.activeOnly') : t('accounts.holds.showPast', { n: past.length })}</Button> : undefined}>
      <div className="list">
        {list.map((h) => (
          <div key={h.id} className="list-item">
            <span className={`glyph${h.status === 'active' ? ' acc-hold-active' : ''}`} aria-hidden><Lock /></span>
            <div className="li-main">
              <div className="li-title">{tx(`accounts.holdReason.${h.reason}`, undefined, h.reason)}</div>
              <div className="li-sub">{h.description} · {f.dateTime(h.createdAt)}{h.expiresAt ? ` · ${t('accounts.holds.until', { date: f.dateTime(h.expiresAt) })}` : ''}</div>
              {h.txId && <Link className="xsmall" to={`/transactions/${h.txId}`}>{t('common.openTransaction')} →</Link>}
            </div>
            <div className="li-end stack-sm" style={{ justifyItems: 'end', gap: 3 }}>
              <Money minor={h.amount} ccy={h.currency} mask />
              <StatusBadge domain="hold" status={h.status} />
            </div>
          </div>
        ))}
        {!list.length && <Empty title={t('accounts.holds.none')}>{t('accounts.holds.noneHint')}</Empty>}
      </div>
    </Panel>
  );
}

/* ── Linked cards, deposits, loans ── */
function LinkedPanel({ acc }: { acc: Account }) {
  const { t, tx } = useT();
  const f = useFmt();
  const data = useLive(async () => {
    const [cards, deposits, loans] = await Promise.all([
      db.cards.where('accountId').equals(acc.id).filter((c) => c.status !== 'replaced').toArray(),
      db.deposits.where('ownerId').equals(acc.ownerId).filter((d) => d.accountId === acc.id || d.payoutAccountId === acc.id).toArray(),
      db.loans.where('ownerId').equals(acc.ownerId).filter((l) => l.loanAccountId === acc.id || l.payoutAccountId === acc.id).toArray(),
    ]);
    return { cards, deposits, loans };
  }, [acc.id, acc.ownerId], { cards: [], deposits: [], loans: [] });
  const n = data.cards.length + data.deposits.length + data.loans.length;
  if (!n) return null;
  return (
    <Panel title={t('accounts.linked.title')} icon={<Link2 />} flush>
      <div className="list">
        {data.cards.map((c) => (
          <Link key={c.id} to={`/cards/${c.id}`} className="list-item">
            <span className="glyph" aria-hidden><CreditCard /></span>
            <div className="li-main"><div className="li-title">{tx(`cardType.${c.type}`)} SIGIL •{c.last4}</div><div className="li-sub">{c.holderName} · {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}</div></div>
            <StatusBadge domain="card" status={c.status} />
          </Link>
        ))}
        {data.deposits.map((d) => (
          <Link key={d.id} to={`/deposits/${d.id}`} className="list-item">
            <span className="glyph" aria-hidden><PiggyBank /></span>
            <div className="li-main"><div className="li-title">{tx(`depositProduct.${d.product}`)} · <span className="mono">{d.number}</span></div><div className="li-sub">{d.accountId === acc.id ? t('accounts.linked.depositHeld') : t('accounts.linked.depositPayout')} · {f.date(d.maturityDate)}</div></div>
            <StatusBadge domain="deposit" status={d.status} />
          </Link>
        ))}
        {data.loans.map((l) => (
          <Link key={l.id} to={`/loans/${l.id}`} className="list-item">
            <span className="glyph" aria-hidden><HandCoins /></span>
            <div className="li-main"><div className="li-title">{tx(`loanType.${l.type}`)} · <span className="mono">{l.number}</span></div><div className="li-sub">{l.loanAccountId === acc.id ? t('accounts.linked.loanBook') : t('accounts.linked.loanPayout')}</div></div>
            <StatusBadge domain="loan" status={l.status} />
          </Link>
        ))}
      </div>
    </Panel>
  );
}
