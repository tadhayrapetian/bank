/** Account instruments: rename, daily limit, freeze, parties, currency pockets, closure, statements and documents. */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DoorClosed, FileSignature, ScrollText, Snowflake, UserPlus, Coins, Gauge, PencilLine } from 'lucide-react';
import { Modal, confirmAction } from '@/ui/Modal';
import { Alert, Button, Field, Input, KV, Money, Segmented, Select, Switch, Textarea } from '@/ui/primitives';
import { CurrencySelect, MoneyInput } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { useT, useFmt } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { useLive, useMyAccounts } from '@/hooks/data';
import { db } from '@/core/db/db';
import { toMinor, fromMinor } from '@/core/currency/format';
import { currencies } from '@/core/currency/registry';
import { addDays, now } from '@/core/clock';
import { pocketBalances } from '@/core/banking/ledger';
import { outgoingToday } from '@/core/banking/engine';
import { formatAccountNumber } from '@/core/banking/numbers';
import { addAccountParty, addPocket, closeAccount, freezeAccount, renameAccount, setAccountLimit } from '@/core/banking/accounts';
import { generateDocument, generateStatement, type GeneratedKind } from '@/core/docs/statements';
import type { Account } from '@/core/types';
import { FREEZE_REASONS, isoDay } from './shared';

export type DialogName = 'rename' | 'limit' | 'freeze' | 'party' | 'pocket' | 'close' | 'statement' | 'document';

export function AccountDialog({ which, acc, onClose, params }: { which: DialogName; acc: Account; onClose: () => void; params?: Record<string, string> }) {
  switch (which) {
    case 'rename': return <RenameDialog acc={acc} onClose={onClose} />;
    case 'limit': return <LimitDialog acc={acc} onClose={onClose} />;
    case 'freeze': return <FreezeDialog acc={acc} onClose={onClose} />;
    case 'party': return <PartyDialog acc={acc} onClose={onClose} initialRole={params?.role === 'trusted' ? 'trusted' : 'coOwner'} />;
    case 'pocket': return <PocketDialog acc={acc} onClose={onClose} />;
    case 'close': return <CloseDialog acc={acc} onClose={onClose} />;
    case 'statement': return <StatementDialog acc={acc} onClose={onClose} initialCcy={params?.ccy} />;
    case 'document': return <DocumentDialog acc={acc} onClose={onClose} />;
    default: return null;
  }
}

function Foot({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { t } = useT();
  return <><Button onClick={onClose}>{t('common.cancel')}</Button>{children}</>;
}

/* ── Rename ── */
function RenameDialog({ acc, onClose }: { acc: Account; onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState(acc.name);
  const { run, busy, error } = useAction();
  const submit = () => run(async () => { await renameAccount(acc.id, name); onClose(); }, { success: t('accounts.dlg.rename.done'), sound: 'paper', silentError: true });
  return (
    <Modal open onClose={onClose} title={t('accounts.dlg.rename.title')} eyebrow={formatAccountNumber(acc.number)}
      footer={<Foot onClose={onClose}><Button variant="primary" icon={<PencilLine />} loading={busy} disabled={!name.trim() || name.trim() === acc.name} onClick={submit}>{t('common.save')}</Button></Foot>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name.trim() !== acc.name) void submit(); }}>
        <Field label={t('accounts.dlg.rename.label')} htmlFor="rn-name" hint={t('accounts.dlg.rename.hint')}>
          <Input id="rn-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
      </form>
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── Daily limit ── */
function LimitDialog({ acc, onClose }: { acc: Account; onClose: () => void }) {
  const { t } = useT();
  const f = useFmt();
  const [none, setNone] = useState(!acc.dailyLimit);
  const [amount, setAmount] = useState(acc.dailyLimit ? String(fromMinor(acc.dailyLimit, acc.currency)) : '');
  const used = useLive(() => outgoingToday(acc.id, acc.currency), [acc.id], 0);
  const { run, busy, error } = useAction();
  const minor = toMinor(amount || '0', acc.currency);
  const invalid = !none && !(minor > 0);
  return (
    <Modal open onClose={onClose} title={t('accounts.dlg.limit.title')} eyebrow={t('dept.SEC')}
      footer={<Foot onClose={onClose}><Button variant="primary" icon={<Gauge />} loading={busy} disabled={invalid} onClick={() => run(async () => { await setAccountLimit(acc.id, none ? undefined : minor); onClose(); }, { success: t('accounts.dlg.limit.done'), sound: 'stamp', silentError: true })}>{t('common.save')}</Button></Foot>}>
      <p className="small ink2">{t('accounts.dlg.limit.text')}</p>
      <div className="inset">
        <KV items={[
          [t('accounts.dlg.limit.current'), acc.dailyLimit ? f.money(acc.dailyLimit, acc.currency) : t('accounts.noLimit')],
          [t('accounts.dlg.limit.usedToday'), f.money(used, acc.currency)],
        ]} />
      </div>
      <Switch checked={none} onChange={setNone} label={t('accounts.dlg.limit.none')} />
      {!none && (
        <Field label={t('accounts.dlg.limit.amount', { ccy: acc.currency })} htmlFor="lm-amt" error={invalid && amount ? t('transfer.err.amount') : undefined} hint={t('accounts.dlg.limit.hint')}>
          <MoneyInput id="lm-amt" value={amount} onChange={setAmount} currency={acc.currency} invalid={invalid} autoFocus />
        </Field>
      )}
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── Freeze ── */
function FreezeDialog({ acc, onClose }: { acc: Account; onClose: () => void }) {
  const { t, tx } = useT();
  const [reason, setReason] = useState<string>(FREEZE_REASONS[0]);
  const { run, busy, error } = useAction();
  return (
    <Modal open onClose={onClose} title={t('accounts.dlg.freeze.title')} eyebrow={t('dept.SEC')}
      footer={<Foot onClose={onClose}><Button variant="danger" icon={<Snowflake />} loading={busy} onClick={() => run(async () => { await freezeAccount(acc.id, reason); onClose(); }, { success: t('accounts.dlg.freeze.done'), sound: 'safe', silentError: true })}>{t('common.freeze')}</Button></Foot>}>
      <Alert tone="info" title={t('accounts.dlg.freeze.effectTitle')}>{t('accounts.dlg.freeze.effect')}</Alert>
      <Field label={t('common.reason')} htmlFor="fz-reason">
        <Select id="fz-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {FREEZE_REASONS.map((r) => <option key={r} value={r}>{tx(`accounts.freezeReason.${r}`)}</option>)}
        </Select>
      </Field>
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── Co-owner / trusted person ── */
function PartyDialog({ acc, onClose, initialRole }: { acc: Account; onClose: () => void; initialRole: 'coOwner' | 'trusted' }) {
  const { t, tx } = useT();
  const [role, setRole] = useState<'coOwner' | 'trusted'>(initialRole);
  const [client, setClient] = useState('');
  const { run, busy, error } = useAction();
  const candidate = useLive(() => (client.trim().length >= 6 ? db.users.where('clientId').equals(client.trim().toUpperCase()).first() : undefined), [client], undefined);
  return (
    <Modal open onClose={onClose} title={t('accounts.dlg.party.title')} eyebrow={formatAccountNumber(acc.number)}
      footer={<Foot onClose={onClose}><Button variant="primary" icon={<UserPlus />} loading={busy} disabled={!client.trim()} onClick={() => run(async () => { await addAccountParty(acc.id, client, role === 'coOwner' ? 'owner' : 'trusted'); onClose(); }, { success: t('accounts.dlg.party.done'), sound: 'stamp', silentError: true })}>{t('common.add')}</Button></Foot>}>
      <Segmented label={t('common.role')} value={role} onChange={setRole} options={[{ value: 'coOwner', label: t('accounts.role.coOwner') }, { value: 'trusted', label: t('accounts.role.trusted') }]} />
      <p className="small ink2">{role === 'coOwner' ? t('accounts.dlg.party.coOwnerText') : t('accounts.dlg.party.trustedText')}</p>
      <Field label={t('common.clientId')} htmlFor="pt-client" hint={t('transfer.clientHint')}>
        <Input id="pt-client" value={client} onChange={(e) => setClient(e.target.value.toUpperCase())} placeholder="ALD-C-104710" autoComplete="off" className="mono" />
      </Field>
      {candidate && (
        <div className="inset row-between">
          <span><strong>{candidate.name}</strong> <span className="xsmall muted mono">{candidate.clientId}</span></span>
          {acc.partyIds.includes(candidate.id) ? <span className="xsmall warn-text">{t('accounts.dlg.party.already')}</span> : <span className="xsmall pos">{t('accounts.dlg.party.found')}</span>}
        </div>
      )}
      {role === 'coOwner' && acc.type === 'current' && <Alert tone="warning">{t('accounts.dlg.party.becomesJoint', { joint: tx('accountType.joint') })}</Alert>}
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── New currency pocket ── */
function PocketDialog({ acc, onClose }: { acc: Account; onClose: () => void }) {
  const { t } = useT();
  const [ccy, setCcy] = useState('');
  const { run, busy, error } = useAction();
  const include = useMemo(() => currencies.transactional().map((c) => c.code).filter((c) => !acc.pockets.includes(c)), [acc.pockets]);
  return (
    <Modal open onClose={onClose} title={t('accounts.dlg.pocket.title')} eyebrow={t('dept.FXB')}
      footer={<Foot onClose={onClose}><Button variant="primary" icon={<Coins />} loading={busy} disabled={!ccy} onClick={() => run(async () => { await addPocket(acc.id, ccy); onClose(); }, { success: t('accounts.dlg.pocket.done', { ccy }), sound: 'safe', silentError: true })}>{t('accounts.dlg.pocket.add')}</Button></Foot>}>
      <p className="small ink2">{t('accounts.dlg.pocket.text')}</p>
      <div className="row" style={{ gap: 6 }}>{acc.pockets.map((p) => <span key={p} className="code-tag">{p}</span>)}</div>
      <Field label={t('common.currency')} htmlFor="pk-ccy" hint={ccy ? currencies.get(ccy)?.name : undefined}>
        <CurrencySelect id="pk-ccy" value={ccy} onChange={setCcy} include={include} />
      </Field>
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── Close ── */
function CloseDialog({ acc, onClose }: { acc: Account; onClose: () => void }) {
  const { t, tx } = useT();
  const f = useFmt();
  const nav = useNavigate();
  const mine = useMyAccounts();
  const [sweep, setSweep] = useState('');
  const { run, busy, error } = useAction();
  const check = useLive(async () => {
    const [pockets, holds, deposits] = await Promise.all([
      pocketBalances(acc),
      db.holds.where('accountId').equals(acc.id).filter((h) => h.status === 'active').toArray(),
      db.deposits.where('accountId').equals(acc.id).filter((d) => d.status === 'active').toArray(),
    ]);
    return { pockets, holds, deposits };
  }, [acc.id], null);
  const targets = mine.filter((a) => a.id !== acc.id && a.status === 'active' && !['loan', 'credit', 'deposit'].includes(a.type));
  const positive = check?.pockets.filter((p) => p.balance > 0) ?? [];
  const negative = check?.pockets.filter((p) => p.balance < 0) ?? [];
  const blocked = !check || check.holds.length > 0 || check.deposits.length > 0 || negative.length > 0;
  const needSweep = positive.length > 0;
  const target = targets.find((a) => a.id === sweep);
  const submit = async () => {
    const ok = await confirmAction({ title: t('accounts.dlg.close.confirmTitle', { name: acc.name }), body: needSweep && target ? t('accounts.dlg.close.confirmSweep', { number: formatAccountNumber(target.number) }) : t('accounts.dlg.close.confirmBody'), confirmLabel: t('accounts.dlg.close.action'), danger: true });
    if (!ok) return;
    await run(async () => { await closeAccount(acc.id, needSweep ? sweep : undefined); onClose(); nav(`/accounts/${acc.id}?tab=documents`); }, { success: t('accounts.dlg.close.done'), sound: 'stamp', silentError: true });
  };
  return (
    <Modal open onClose={onClose} title={t('accounts.dlg.close.title')} eyebrow={t('dept.ARC')} size="wide"
      footer={<Foot onClose={onClose}><Button variant="danger" icon={<DoorClosed />} loading={busy} disabled={blocked || (needSweep && !sweep)} onClick={submit}>{t('accounts.dlg.close.action')}</Button></Foot>}>
      <div className="inset stack-sm">
        <div className="alert-title">{t('accounts.dlg.close.ruleTitle')}</div>
        <p className="small ink2">{t('accounts.dlg.close.rule')}</p>
      </div>
      {check && (
        <div className="table-wrap">
          <table className="table dense">
            <caption>{t('accounts.dlg.close.pockets')}</caption>
            <thead><tr><th scope="col">{t('common.currency')}</th><th scope="col" className="num">{t('common.balance')}</th><th scope="col" className="num">{t('common.blocked')}</th></tr></thead>
            <tbody>{check.pockets.map((p) => <tr key={p.currency}><td className="mono">{p.currency}</td><td className="num"><Money minor={p.balance} ccy={p.currency} /></td><td className="num"><Money minor={p.held} ccy={p.currency} /></td></tr>)}</tbody>
          </table>
        </div>
      )}
      {check && check.holds.length > 0 && <Alert tone="negative" title={t('errors.ACCOUNT_NOT_EMPTY.title')}>{t('accounts.dlg.close.holds', { n: check.holds.length })}</Alert>}
      {check && check.deposits.length > 0 && <Alert tone="negative" title={t('errors.INVALID_STATE.title')}>{t('accounts.dlg.close.deposit')}</Alert>}
      {negative.length > 0 && <Alert tone="negative" title={t('errors.ACCOUNT_NOT_EMPTY.title')}>{t('accounts.dlg.close.debt')}</Alert>}
      {!blocked && needSweep && (
        <Field label={t('accounts.dlg.close.sweepTo')} htmlFor="cl-sweep" hint={t('accounts.dlg.close.sweepHint')}>
          <Select id="cl-sweep" value={sweep} onChange={(e) => setSweep(e.target.value)}>
            <option value="">{t('common.selectAccount')}</option>
            {targets.map((a) => <option key={a.id} value={a.id}>{a.name} · {tx(`accountType.${a.type}`)} · {a.currency}{a.multiCurrency ? ` (${t('accounts.multiCurrency')})` : ''} · {formatAccountNumber(a.number).slice(-9)}</option>)}
          </Select>
        </Field>
      )}
      {!blocked && needSweep && target && (
        <Alert tone="info">{positive.map((p) => t('accounts.dlg.close.sweepLine', { amount: f.money(p.balance, p.currency), target: target.multiCurrency || target.currency === p.currency ? p.currency : target.currency })).join(' · ')}</Alert>
      )}
      {!blocked && !needSweep && <Alert tone="positive">{t('accounts.dlg.close.ready')}</Alert>}
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── Statement ── */
function StatementDialog({ acc, onClose, initialCcy }: { acc: Account; onClose: () => void; initialCcy?: string }) {
  const { t } = useT();
  const nav = useNavigate();
  const today = isoDay(now());
  const [ccy, setCcy] = useState(initialCcy && acc.pockets.includes(initialCcy) ? initialCcy : acc.currency);
  const [preset, setPreset] = useState<'30' | '90' | 'year' | 'all'>('30');
  const [from, setFrom] = useState(isoDay(addDays(now(), -30)));
  const [to, setTo] = useState(today);
  const { run, busy, error } = useAction();
  const applyPreset = (p: typeof preset) => {
    setPreset(p);
    setTo(today);
    if (p === '30') setFrom(isoDay(addDays(now(), -30)));
    if (p === '90') setFrom(isoDay(addDays(now(), -90)));
    if (p === 'year') setFrom(`${today.slice(0, 4)}-01-01`);
    if (p === 'all') setFrom(acc.createdAt.slice(0, 10));
  };
  const invalid = !from || !to || from > to;
  return (
    <Modal open onClose={onClose} title={t('accounts.dlg.statement.title')} eyebrow={t('dept.ARC')}
      footer={<Foot onClose={onClose}><Button variant="primary" icon={<ScrollText />} loading={busy} disabled={invalid} onClick={() => run(async () => { const doc = await generateStatement(acc.id, ccy, from, to); onClose(); nav(`/documents/${doc.id}`); }, { success: t('accounts.dlg.statement.done'), sound: 'document', silentError: true })}>{t('generate.generate')}</Button></Foot>}>
      <p className="small ink2">{t('accounts.dlg.statement.text')}</p>
      <Segmented label={t('common.period')} value={preset} onChange={applyPreset} options={[
        { value: '30', label: t('accounts.period.d30') }, { value: '90', label: t('accounts.period.d90') }, { value: 'year', label: t('accounts.period.year') }, { value: 'all', label: t('accounts.period.all') },
      ]} />
      <div className="form-grid">
        <Field label={t('common.from')} htmlFor="st-from"><Input id="st-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t('common.to')} htmlFor="st-to" error={invalid && from && to ? t('accounts.dlg.statement.badPeriod') : undefined}><Input id="st-to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></Field>
        {acc.pockets.length > 1 && (
          <Field label={t('accounts.pocket')} htmlFor="st-ccy" className="full">
            <Select id="st-ccy" value={ccy} onChange={(e) => setCcy(e.target.value)}>{acc.pockets.map((c) => <option key={c} value={c}>{c} · {currencies.get(c)?.name ?? c}</option>)}</Select>
          </Field>
        )}
      </div>
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── Other account documents ── */
const DOC_KINDS: GeneratedKind[] = ['balance_confirmation', 'account_certificate', 'reference_letter', 'authorization', 'payment_order'];

function DocumentDialog({ acc, onClose }: { acc: Account; onClose: () => void }) {
  const { t, tx } = useT();
  const nav = useNavigate();
  const [kind, setKind] = useState<GeneratedKind>('balance_confirmation');
  const [recipient, setRecipient] = useState('');
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal open onClose={onClose} title={t('accounts.dlg.document.title')} eyebrow={t('dept.ARC')}
      footer={<Foot onClose={onClose}><Button variant="primary" icon={<FileSignature />} loading={busy} disabled={kind === 'payment_order' && !(toMinor(amount || '0', acc.currency) > 0)}
        onClick={() => run(async () => {
          const doc = await generateDocument(kind, { accountId: acc.id, recipient: recipient || undefined, text: text || undefined, amount: kind === 'payment_order' ? toMinor(amount, acc.currency) : undefined, currency: acc.currency });
          onClose();
          nav(`/documents/${doc.id}`);
        }, { success: t('generate.done'), sound: 'document', silentError: true })}>{t('generate.generate')}</Button></Foot>}>
      <Field label={t('generate.kind')} htmlFor="ad-kind" hint={tx(`accounts.docHelp.${kind}`)}>
        <Select id="ad-kind" value={kind} onChange={(e) => setKind(e.target.value as GeneratedKind)}>{DOC_KINDS.map((k) => <option key={k} value={k}>{tx(`generate.kinds.${k}`)}</option>)}</Select>
      </Field>
      <Field label={t('generate.addressee')} htmlFor="ad-rec" hint={t('common.optional')}><Input id="ad-rec" value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={120} /></Field>
      {kind === 'payment_order' && <Field label={t('common.amount')} htmlFor="ad-amt"><MoneyInput id="ad-amt" value={amount} onChange={setAmount} currency={acc.currency} /></Field>}
      <Field label={t('generate.text')} htmlFor="ad-text" hint={t('common.optional')}><Textarea id="ad-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} /></Field>
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}
