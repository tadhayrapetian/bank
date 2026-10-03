/** Daily closing balance of one pocket, rebuilt from the ledger, with a table alternative. */
import { useMemo, useState } from 'react';
import { LineChart as LineIcon } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive } from '@/hooks/data';
import { db } from '@/core/db/db';
import { ledgerHistory } from '@/core/banking/ledger';
import { now } from '@/core/clock';
import { ChartFrame, LineChart } from '@/ui/charts';
import { Empty, Panel, Segmented, Select, Stat } from '@/ui/primitives';
import type { Account } from '@/core/types';

type Period = '30' | '90' | '365' | 'all';
const DAY = 86_400_000;

export function BalanceHistory({ acc }: { acc: Account }) {
  const { t } = useT();
  const f = useFmt();
  const [ccy, setCcy] = useState(acc.currency);
  const [period, setPeriod] = useState<Period>('90');
  const cur = acc.pockets.includes(ccy) ? ccy : acc.currency;
  const entries = useLive(async () => {
    await db.balances.get([acc.id, cur]); // re-run when the projection changes
    return ledgerHistory(acc.id, cur);
  }, [acc.id, cur], []);
  const sign = acc.normal === 'debit' ? -1 : 1;

  const points = useMemo(() => {
    const end = Math.floor(now().getTime() / DAY) * DAY + DAY - 1;
    const firstAt = entries.length ? Date.parse(entries[0].at) : Date.parse(acc.createdAt);
    const span = period === 'all' ? Math.max(1, Math.ceil((end - firstAt) / DAY)) : Number(period);
    const start = end - span * DAY;
    let i = 0;
    let running = 0;
    while (i < entries.length && Date.parse(entries[i].at) <= start) running = entries[i++].running;
    const out: { t: number; v: number }[] = [];
    for (let d = 1; d <= span; d++) {
      const dayEnd = start + d * DAY;
      while (i < entries.length && Date.parse(entries[i].at) <= dayEnd) running = entries[i++].running;
      out.push({ t: dayEnd, v: running * sign });
    }
    return out;
  }, [entries, period, sign, acc.createdAt]);

  const stats = useMemo(() => {
    if (!points.length) return null;
    const vals = points.map((p) => p.v);
    return { open: vals[0], close: vals[vals.length - 1], min: Math.min(...vals), max: Math.max(...vals) };
  }, [points]);

  const tableRows = useMemo(() => {
    const step = points.length > 60 ? 7 : 1;
    const picked = points.filter((_, i) => (points.length - 1 - i) % step === 0);
    return picked.reverse().slice(0, 60);
  }, [points]);

  return (
    <Panel title={t('accounts.chart.title')} icon={<LineIcon />} sub={t('accounts.chart.sub')}
      actions={acc.pockets.length > 1 ? (
        <Select aria-label={t('accounts.pocket')} value={cur} onChange={(e) => setCcy(e.target.value)} style={{ width: 'auto', height: 32 }}>
          {acc.pockets.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      ) : undefined}>
      {!entries.length ? (
        <Empty title={t('accounts.chart.empty')}>{t('accounts.chart.emptyHint')}</Empty>
      ) : (
        <div className="stack">
          <Segmented label={t('common.period')} value={period} onChange={setPeriod} options={[
            { value: '30', label: t('accounts.period.d30') }, { value: '90', label: t('accounts.period.d90') }, { value: '365', label: t('accounts.period.d365') }, { value: 'all', label: t('accounts.period.all') },
          ]} />
          {stats && (
            <div className="acc-chart-stats">
              <Stat label={t('accounts.chart.opening')} value={f.money(stats.open, cur, { mask: true })} />
              <Stat label={t('accounts.chart.closing')} value={f.money(stats.close, cur, { mask: true })} />
              <Stat label={t('accounts.chart.change')} value={<span className={stats.close - stats.open >= 0 ? 'pos' : 'neg'}>{f.money(stats.close - stats.open, cur, { sign: true, mask: true })}</span>} />
              <Stat label={t('accounts.chart.range')} value={<span className="small">{f.money(stats.min, cur, { compact: true, mask: true })} – {f.money(stats.max, cur, { compact: true, mask: true })}</span>} />
            </div>
          )}
          <ChartFrame
            title={`${cur} · ${t('accounts.chart.daily')}`}
            table={
              <table className="table dense">
                <caption>{t('accounts.chart.tableCaption', { ccy: cur })}</caption>
                <thead><tr><th scope="col">{t('common.date')}</th><th scope="col" className="num">{t('accounts.chart.closing')}</th></tr></thead>
                <tbody>{tableRows.map((p) => <tr key={p.t}><td>{f.date(new Date(p.t).toISOString())}</td><td className="num">{f.money(p.v, cur)}</td></tr>)}</tbody>
              </table>
            }
          >
            <LineChart
              series={[{ id: cur, label: cur, points }]}
              height={220}
              ariaLabel={t('accounts.chart.aria', { ccy: cur })}
              yFormat={(v) => f.money(v, cur, { compact: true })}
              xFormat={(x) => f.date(new Date(x).toISOString())}
              zero
            />
          </ChartFrame>
        </div>
      )}
    </Panel>
  );
}
