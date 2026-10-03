/** Bulk payments: many recipients from one account in one batch, validated row by row, with per-row results. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Plus, Trash2, ClipboardList, CheckCircle2, AlertTriangle, XCircle, Send, ShieldCheck, ExternalLink, Loader2 } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useAccountsWithBalances, useLive, useMyAccounts, useMyTransactions } from '@/hooks/data';
import { db } from '@/core/db/db';
import { bulkPay, resolveRecipient, type BulkRow } from '@/core/banking/payments';
import { formatAccountNumber, isValidAccountNumber, normalizeAccountNumber } from '@/core/banking/numbers';
import { toMinor } from '@/core/currency/format';
import { nowISO } from '@/core/clock';
import { BankError } from '@/core/errors';
import { Button, Field, IconButton, Input, Panel, Textarea, StatusBadge, CodeTag, Empty, KV, Alert } from '@/ui/primitives';
import { AccountPicker, decodePocket } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { confirmAction } from '@/ui/Modal';
import { toast } from '@/ui/Toasts';
import { play } from '@/ui/sound';
import type { Transaction } from '@/core/types';

interface Row {
  key: number;
  account: string;
  name: string;
  amount: string;
  description: string;
}

type Check = { state: 'ok' | 'warn' | 'error'; text: string } | undefined;

let seq = 1;
const blank = (): Row => ({ key: seq++, account: '', name: '', amount: '', description: '' });

export function BulkTab() {
  const { t, tx } = useT();
  const f = useFmt();
  const accounts = useMyAccounts();
  const [pocket, setPocket] = useState('');
  const [label, setLabel] = useState('');
  const [rows, setRows] = useState<Row[]>(() => [blank(), blank(), blank()]);
  const [checks, setChecks] = useState<Record<number, Check>>({});
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [validating, setValidating] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ batchId: string; results: { row: BulkRow; tx?: Transaction; error?: string }[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const p = decodePocket(pocket);
  const ccy = p?.currency ?? 'CRWN';
  const src = accounts.find((a) => a.id === p?.accountId);
  const [srcBal] = useAccountsWithBalances(src ? [src] : []);
  const available = srcBal?.pocketsInfo.find((x) => x.currency === ccy)?.available ?? 0;

  const filled = rows.filter((r) => r.account.trim() || r.amount.trim() || r.name.trim());
  const total = filled.reduce((s, r) => s + (toMinor(r.amount || '0', ccy) || 0), 0);
  const update = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setChecks((c) => ({ ...c, [key]: undefined }));
  };

  const localCheck = (r: Row): Check => {
    if (!isValidAccountNumber(r.account)) return { state: 'error', text: t('payments.bulk.errAccount') };
    if (!(toMinor(r.amount || '0', ccy) > 0)) return { state: 'error', text: t('payments.bulk.errAmount') };
    if (src && normalizeAccountNumber(r.account) === src.number) return { state: 'error', text: t('payments.bulk.errSelf') };
    return undefined;
  };

  const validate = async (): Promise<boolean> => {
    setValidating(true);
    const next: Record<number, Check> = {};
    let ok = filled.length > 0;
    for (const r of filled) {
      const local = localCheck(r);
      if (local) { next[r.key] = local; ok = false; continue; }
      try {
        const res = await resolveRecipient({ accountNumber: r.account }, ccy);
        const mismatch = r.name.trim() && res.user.name.toLowerCase() !== r.name.trim().toLowerCase();
        next[r.key] = mismatch ? { state: 'warn', text: t('payments.bulk.rowNameMismatch', { name: res.user.name }) } : { state: 'ok', text: t('payments.bulk.rowOk', { name: res.user.name }) };
        if (!r.name.trim()) setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, name: res.user.name } : x)));
      } catch (e) {
        next[r.key] = { state: 'error', text: e instanceof BankError && e.code === 'INVALID_ACCOUNT' ? t('payments.bulk.errAccount') : t('payments.bulk.errRecipient') };
        ok = false;
      }
    }
    setChecks(next);
    setValidating(false);
    return ok;
  };

  const execute = async () => {
    setError(null);
    if (!p) { setError(new BankError('VALIDATION', { field: 'from' })); return; }
    if (!filled.length) { setError(new BankError('VALIDATION', { field: 'rows' })); return; }
    const ok = await validate();
    if (!ok) return;
    if (total > available) { setError(new BankError('INSUFFICIENT_FUNDS', { available, required: total, currency: ccy })); play('error'); return; }
    const confirmed = await confirmAction({
      title: t('payments.bulk.confirmTitle', { n: filled.length }),
      body: t('payments.bulk.confirmBody', { amt: total, ccy, account: src ? `${src.name} (${formatAccountNumber(src.number)})` : '' }),
      confirmLabel: t('payments.bulk.run', { n: filled.length }),
    });
    if (!confirmed) return;
    setRunning(nowISO());
    try {
      const res = await bulkPay(p.accountId, ccy, filled.map((r) => ({ accountNumber: normalizeAccountNumber(r.account), name: r.name.trim(), amount: toMinor(r.amount, ccy), description: r.description.trim() || label.trim() })), label.trim() || t('payments.bulk.title'));
      setResult(res);
      const okN = res.results.filter((x) => x.tx && x.tx.status === 'completed').length;
      play(okN ? 'payment' : 'error');
      toast({ tone: okN === res.results.length ? 'positive' : 'negative', title: t('payments.bulk.done'), body: t('payments.bulk.resultsSub', { ok: okN, n: res.results.length }) });
    } catch (e) {
      setError(e);
      play('error');
    } finally {
      setRunning(null);
    }
  };

  const applyPaste = () => {
    const parsed = paste.split(/\r?\n/).map((line) => line.split(line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',').map((c) => c.trim())).filter((c) => c[0]);
    const add = parsed.map((c) => ({ ...blank(), account: (c[0] ?? '').toUpperCase(), name: c[1] ?? '', amount: c[2] ?? '', description: c[3] ?? '' }));
    if (!add.length) return;
    setRows((rs) => [...rs.filter((r) => r.account || r.amount || r.name), ...add]);
    setPaste('');
    setShowPaste(false);
    toast({ tone: 'positive', title: t('payments.bulk.pasteAdded', { n: add.length }) });
  };

  const live = useLive(() => (running && p ? db.transactions.where('fromAccountId').equals(p.accountId).filter((x) => x.type === 'bulk' && x.createdAt >= running).toArray() : []), [running, p?.accountId], [] as Transaction[]);

  if (result) {
    const okN = result.results.filter((x) => x.tx?.status === 'completed').length;
    return (
      <Panel title={t('payments.bulk.results', { id: result.batchId })} sub={t('payments.bulk.resultsSub', { ok: okN, n: result.results.length })} icon={<Layers />} flush
        actions={<Button variant="primary" size="sm" icon={<Plus />} onClick={() => { setResult(null); setRows([blank(), blank(), blank()]); setChecks({}); }}>{t('payments.bulk.newBatch')}</Button>}>
        <div className="list">
          {result.results.map((r, i) => (
            <div key={i} className="list-item">
              <span className={`glyph ${r.tx?.status === 'completed' ? 'out' : 'fail'}`}>{r.tx?.status === 'completed' ? <CheckCircle2 /> : <XCircle />}</span>
              <div className="li-main">
                <div className="li-title">{r.tx?.recipient.name ?? r.row.name}</div>
                <div className="li-sub mono">{formatAccountNumber(r.row.accountNumber)}{r.tx ? ` · ${r.tx.ref}` : ''}</div>
                {r.error && <div className="xsmall neg">{tx(`errors.${r.error}.title`, undefined, r.error)} — {tx(`errors.${r.error}.hint`)}</div>}
                {r.tx && r.tx.status !== 'completed' && r.tx.error && <div className="xsmall neg">{tx(`errors.${r.tx.error.code}.title`)}</div>}
              </div>
              <div className="li-end stack-sm" style={{ justifyItems: 'end', gap: 4 }}>
                <strong className="tnum">{f.money(r.row.amount, ccy)}</strong>
                {r.tx ? <Link className="xsmall row" style={{ gap: 4 }} to={`/transactions/${r.tx.id}`}><StatusBadge domain="tx" status={r.tx.status} /><ExternalLink size={11} aria-hidden /></Link> : <StatusBadge domain="tx" status="failed" />}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  return (
    <div className="stack-lg">
      <Panel title={t('payments.bulk.title')} sub={t('payments.bulk.sub')} icon={<Layers />}>
        <div className="stack">
          <div className="form-grid">
            <Field label={t('payments.bulk.from')} htmlFor="bk-from"><AccountPicker id="bk-from" value={pocket} onChange={setPocket} filter={(a) => a.type !== 'deposit' && a.type !== 'credit'} /></Field>
            <Field label={t('payments.bulk.label')} htmlFor="bk-label"><Input id="bk-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('payments.bulk.labelPlaceholder')} maxLength={80} /></Field>
          </div>
          <div className="table-wrap pay-bulk-wrap">
            <table className="table pay-bulk" aria-label={t('payments.bulk.rows')}>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th>{t('payments.bulk.account')}</th>
                  <th>{t('payments.bulk.name')}</th>
                  <th className="num" style={{ width: 150 }}>{t('payments.bulk.amount')} ({ccy})</th>
                  <th>{t('payments.bulk.description')}</th>
                  <th style={{ width: 40 }}><span className="sr-only">{t('common.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const c = checks[r.key];
                  return (
                    <tr key={r.key} className={c ? `chk-${c.state}` : undefined}>
                      <td className="muted tnum" data-label={t('payments.bulk.row')}>{i + 1}</td>
                      <td data-label={t('payments.bulk.account')}>
                        <Input aria-label={`${t('payments.bulk.account')} ${i + 1}`} value={r.account} onChange={(e) => update(r.key, { account: e.target.value.toUpperCase() })} className="mono" placeholder="XA00 AEX0 …" autoComplete="off" invalid={c?.state === 'error'} />
                        {c && <div className={`pay-chk ${c.state}`}>{c.state === 'ok' ? <CheckCircle2 size={12} aria-hidden /> : c.state === 'warn' ? <AlertTriangle size={12} aria-hidden /> : <XCircle size={12} aria-hidden />}{c.text}</div>}
                      </td>
                      <td data-label={t('payments.bulk.name')}><Input aria-label={`${t('payments.bulk.name')} ${i + 1}`} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} /></td>
                      <td data-label={t('payments.bulk.amount')}><Input aria-label={`${t('payments.bulk.amount')} ${i + 1}`} value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value.replace(/[^\d.,]/g, '') })} inputMode="decimal" className="money-input" placeholder="0.00" /></td>
                      <td data-label={t('payments.bulk.description')}><Input aria-label={`${t('payments.bulk.description')} ${i + 1}`} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} maxLength={140} /></td>
                      <td><IconButton label={t('payments.bulk.removeRow', { n: i + 1 })} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))}><Trash2 /></IconButton></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row">
            <Button size="sm" icon={<Plus />} onClick={() => setRows((rs) => [...rs, blank()])}>{t('payments.bulk.addRow')}</Button>
            <Button size="sm" variant="ghost" icon={<ClipboardList />} aria-expanded={showPaste} onClick={() => setShowPaste((v) => !v)}>{t('payments.bulk.paste')}</Button>
          </div>
          {showPaste && (
            <div className="inset stack-sm">
              <Field label={t('payments.bulk.paste')} htmlFor="bk-paste" hint={t('payments.bulk.pasteHint')}>
                <Textarea id="bk-paste" rows={4} className="mono" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'XA11AEX1010000100000; Aurelia Thornwood; 25.00; Stipend'} />
              </Field>
              <div className="row" style={{ justifyContent: 'flex-end' }}><Button size="sm" onClick={applyPaste} disabled={!paste.trim()}>{t('payments.bulk.pasteApply')}</Button></div>
            </div>
          )}
          <div className="pay-bulk-foot">
            <KV items={[
              [t('payments.bulk.total'), <strong className="tnum">{f.money(total, ccy)}</strong>],
              [t('payments.bulk.available'), <span className={`tnum${p && total > available ? ' neg' : ''}`}>{p ? f.money(available, ccy) : '—'}</span>],
              [t('payments.bulk.rows'), filled.length],
            ]} />
            <div className="row">
              <Button icon={validating ? <Loader2 className="sigil-spin" /> : <ShieldCheck />} onClick={() => void validate()} disabled={!filled.length || validating}>{validating ? t('payments.bulk.validating') : t('payments.bulk.validate')}</Button>
              <Button variant="primary" icon={<Send />} loading={!!running} disabled={!filled.length || !p} onClick={() => void execute()}>{t('payments.bulk.run', { n: filled.length })}</Button>
            </div>
          </div>
          {p && total > available && <Alert tone="warning">{t('payments.bulk.errFunds')}</Alert>}
          {running && (
            <div className="inset stack-sm" aria-live="polite">
              <div className="row small"><Loader2 className="sigil-spin" size={14} aria-hidden />{t('common.working')} {live.length}/{filled.length}</div>
              {live.map((x) => <div key={x.id} className="row-between xsmall"><span>{x.recipient.name}</span><StatusBadge domain="tx" status={x.status} /></div>)}
            </div>
          )}
          {error ? <ErrorPanel error={error} /> : null}
        </div>
      </Panel>
      <BulkHistory />
    </div>
  );
}

function BulkHistory() {
  const { t } = useT();
  const f = useFmt();
  const txs = useMyTransactions(0, (x) => x.type === 'bulk' && !!x.batchId);
  const batches = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const x of txs) m.set(x.batchId!, [...(m.get(x.batchId!) ?? []), x]);
    return [...m.entries()].map(([id, list]) => ({ id, list, at: list.reduce((a, x) => (x.createdAt < a ? x.createdAt : a), list[0].createdAt) })).sort((a, b) => b.at.localeCompare(a.at));
  }, [txs]);
  return (
    <Panel title={t('payments.bulk.history')} sub={t('payments.bulk.historySub')} icon={<Layers />} flush>
      {batches.length ? (
        <div className="list">
          {batches.map((b) => {
            const ok = b.list.filter((x) => x.status === 'completed');
            const byCcy = new Map<string, number>();
            for (const x of ok) byCcy.set(x.currency, (byCcy.get(x.currency) ?? 0) + x.amount);
            return (
              <details key={b.id} className="pay-batch">
                <summary className="list-item">
                  <span className="glyph out"><Layers /></span>
                  <div className="li-main">
                    <div className="li-title"><CodeTag>{b.id}</CodeTag></div>
                    <div className="li-sub">{t('payments.bulk.batchLine', { n: b.list.length, date: f.dateTime(b.at) })}</div>
                  </div>
                  <div className="li-end tnum" style={{ fontWeight: 600 }}>{[...byCcy.entries()].map(([c, v]) => f.money(v, c)).join(' · ') || '—'}</div>
                </summary>
                <div className="list">
                  {b.list.map((x) => (
                    <Link key={x.id} to={`/transactions/${x.id}`} className="list-item pay-batch-row">
                      <div className="li-main"><div className="li-title">{x.recipient.name}</div><div className="li-sub">{x.ref} · {x.description}</div></div>
                      <div className="li-end row" style={{ gap: 8 }}><span className="tnum">{f.money(x.amount, x.currency)}</span><StatusBadge domain="tx" status={x.status} /></div>
                    </Link>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      ) : <Empty title={t('payments.bulk.noHistory')} />}
    </Panel>
  );
}
