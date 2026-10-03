/** The account's double-entry ledger: every posting with journal, reference, debit/credit and running balance — and a reconciliation against the balance projection. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive } from '@/hooks/data';
import { db } from '@/core/db/db';
import { ledgerHistory } from '@/core/banking/ledger';
import { DataTable } from '@/ui/DataTable';
import { Badge, Empty, Panel, Select, Stat } from '@/ui/primitives';
import type { Account } from '@/core/types';

export function AccountLedger({ acc }: { acc: Account }) {
  const { t } = useT();
  const f = useFmt();
  const [ccy, setCcy] = useState(acc.currency);
  const cur = acc.pockets.includes(ccy) ? ccy : acc.currency;
  const data = useLive(async () => {
    const [entries, row] = await Promise.all([ledgerHistory(acc.id, cur), db.balances.get([acc.id, cur])]);
    return { entries, projected: row?.balance ?? 0, count: row?.entries ?? 0 };
  }, [acc.id, cur], { entries: [], projected: 0, count: 0 });
  const sign = acc.normal === 'debit' ? -1 : 1;
  const rows = useMemo(() => data.entries.map((e, n) => ({ ...e, n })), [data.entries]);
  const debit = rows.reduce((s, e) => s + (e.side === 'D' ? e.amount : 0), 0);
  const credit = rows.reduce((s, e) => s + (e.side === 'C' ? e.amount : 0), 0);
  const ledgerBal = credit - debit;
  const reconciled = ledgerBal === data.projected && rows.length === data.count;

  return (
    <Panel title={t('accounts.ledger.title')} icon={<BookOpen />} sub={t('accounts.ledger.sub')} flush
      actions={acc.pockets.length > 1 ? (
        <Select aria-label={t('accounts.pocket')} value={cur} onChange={(e) => setCcy(e.target.value)} style={{ width: 'auto', height: 32 }}>
          {acc.pockets.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      ) : undefined}>
      <div className="acc-ledger-proof">
        <Stat label={t('accounts.ledger.debits')} value={f.money(debit, cur)} foot={t('accounts.ledger.entriesN', { n: rows.filter((e) => e.side === 'D').length })} />
        <Stat label={t('accounts.ledger.credits')} value={f.money(credit, cur)} foot={t('accounts.ledger.entriesN', { n: rows.filter((e) => e.side === 'C').length })} />
        <Stat label={t('accounts.ledger.ledgerBalance')} value={f.money(ledgerBal * sign, cur)} foot={acc.normal === 'debit' ? t('accounts.ledger.debitNormal') : t('accounts.ledger.formula')} />
        <div className="stat">
          <div className="stat-label">{t('accounts.ledger.projection')}</div>
          <div className="row" style={{ gap: 8 }}>
            {reconciled
              ? <Badge tone="positive"><CheckCircle2 size={12} aria-hidden />{t('accounts.ledger.reconciled')}</Badge>
              : <Badge tone="negative"><AlertTriangle size={12} aria-hidden />{t('accounts.ledger.drift')}</Badge>}
          </div>
          <div className="stat-foot">{t('accounts.ledger.projectionFoot', { amount: f.money(data.projected * sign, cur), n: data.count })}</div>
        </div>
      </div>
      <DataTable
        rows={rows}
        rowKey={(e) => e.id}
        pageSize={15}
        initialSort={{ key: 'at', dir: 'desc' }}
        csvName={`ledger-${acc.number}-${cur}`}
        dense
        empty={<Empty title={t('accounts.ledger.empty')} />}
        columns={[
          { key: 'at', header: t('common.date'), value: (e) => e.n, render: (e) => <span className="nowrap small">{f.dateTime(e.at)}</span>, hideMobile: true },
          { key: 'journal', header: t('accounts.ledger.journal'), value: (e) => e.journalId, render: (e) => <span className="code-tag">{e.journalId}</span>, hideMobile: true },
          { key: 'ref', header: t('common.reference'), value: (e) => e.ref, render: (e) => (
            <div style={{ minWidth: 0 }}>
              <Link to={`/transactions/${e.txId}`} className="mono small">{e.ref}</Link>
              <div className="xsmall muted truncate" style={{ maxWidth: 280 }}>{e.memo}</div>
              <div className={`acc-show-mobile xsmall ${e.side === 'D' ? 'acc-dr' : 'acc-cr'}`}>{e.side === 'D' ? t('accounts.ledger.dr') : t('accounts.ledger.cr')} {f.money(e.amount, cur)} · {f.dateTime(e.at)}</div>
            </div>
          ) },
          { key: 'debit', header: t('accounts.ledger.debit'), align: 'right', value: (e) => (e.side === 'D' ? e.amount : 0), render: (e) => (e.side === 'D' ? <span className="acc-dr">{f.money(e.amount, cur)}</span> : <span className="muted">—</span>), hideMobile: true },
          { key: 'credit', header: t('accounts.ledger.credit'), align: 'right', value: (e) => (e.side === 'C' ? e.amount : 0), render: (e) => (e.side === 'C' ? <span className="acc-cr">{f.money(e.amount, cur)}</span> : <span className="muted">—</span>), hideMobile: true },
          { key: 'running', header: t('accounts.ledger.running'), align: 'right', value: (e) => e.running * sign, render: (e) => <strong className="tnum">{f.money(e.running * sign, cur)}</strong> },
        ]}
      />
    </Panel>
  );
}
