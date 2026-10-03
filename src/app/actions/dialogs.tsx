/** Quick-action dialogs: receive, request, withdraw (cardless code), pay, check, open account, deposit, document. */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Link2, HandCoins, Banknote, Plus, PiggyBank, FileSignature, ScrollText, ReceiptText, ArrowRight } from 'lucide-react';
import { Modal } from '@/ui/Modal';
import { Button, Field, Input, Select, Textarea, KV, Alert, Switch, Segmented, Badge, Money, Empty, StatusBadge } from '@/ui/primitives';
import { AccountPicker, MoneyInput, CurrencySelect, decodePocket, encodePocket } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { QRCode, qrPayload } from '@/ui/QR';
import { useT, useFmt } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { useLive, useMyAccounts } from '@/hooks/data';
import { useSession } from '@/state/session';
import { db } from '@/core/db/db';
import { toMinor } from '@/core/currency/format';
import { formatAccountNumber } from '@/core/banking/numbers';
import { createPaymentLink, requestMoney, createCardlessCode, payRequest, payLink, getLink } from '@/core/banking/payments';
import { payInvoice } from '@/core/banking/invoices';
import { createCheck } from '@/core/banking/checks';
import { openAccount, CUSTOMER_ACCOUNT_TYPES } from '@/core/banking/accounts';
import { openDeposit, depositRate, projectDeposit, DEPOSIT_TERMS, PRODUCT_RULES } from '@/core/banking/deposits';
import { generateStatement, generateDocument, type GeneratedKind } from '@/core/docs/statements';
import { todayKey, addDays, now } from '@/core/clock';
import { copyText } from '@/ui/print';
import { toast } from '@/ui/Toasts';
import { TxProgress } from './TxProgress';
import type { AccountType, DepositProduct } from '@/core/types';

function useDefaultPocket(filter?: (t: AccountType) => boolean) {
  const accounts = useMyAccounts();
  const [v, setV] = useState('');
  useEffect(() => {
    if (!v && accounts.length) {
      const a = accounts.find((x) => x.status === 'active' && (!filter || filter(x.type)) && x.type === 'current') ?? accounts.find((x) => x.status === 'active');
      if (a) setV(encodePocket({ accountId: a.id, currency: a.currency }));
    }
  }, [accounts, v, filter]);
  return [v, setV, accounts] as const;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useT();
  return (
    <div className="row-between inset" style={{ padding: '8px 12px' }}>
      <div className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
        <span className="xsmall muted">{label}</span>
        <span className="mono truncate">{value}</span>
      </div>
      <Button size="sm" variant="ghost" icon={<Copy />} onClick={async () => { const ok = await copyText(value); toast({ tone: ok ? 'positive' : 'info', title: ok ? t('common.copied') : value }); }}>{t('common.copy')}</Button>
    </div>
  );
}

/* ── Receive ── */
export function ReceiveDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const f = useFmt();
  const me = useSession((s) => s.user);
  const nav = useNavigate();
  const [pocket, setPocket, accounts] = useDefaultPocket();
  const [amount, setAmount] = useState('');
  const p = decodePocket(pocket);
  const acc = accounts.find((a) => a.id === p?.accountId);
  const ccy = p?.currency ?? 'CRWN';
  const minor = amount ? toMinor(amount, ccy) : undefined;
  const payload = acc ? qrPayload('receive', { acct: acc.number, ccy, amt: minor && minor > 0 ? minor : undefined, name: me?.name }) : '';
  const { run, busy } = useAction();
  return (
    <Modal open onClose={onClose} title={t('receive.title')} eyebrow={t('app.network')} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Field label={t('common.account')} htmlFor="rc-acc"><AccountPicker id="rc-acc" value={pocket} onChange={setPocket} /></Field>
          <Field label={t('receive.amountOptional')} htmlFor="rc-amt"><MoneyInput id="rc-amt" value={amount} onChange={setAmount} currency={ccy} /></Field>
          {acc && <CopyRow label={t('common.accountNumber')} value={formatAccountNumber(acc.number)} />}
          {me && <CopyRow label={t('common.clientId')} value={me.clientId} />}
          <Button icon={<Link2 />} loading={busy} disabled={!acc} onClick={() => run(async () => {
            const l = await createPaymentLink({ accountId: acc!.id, amount: minor && minor > 0 ? minor : undefined, currency: ccy, description: t('receive.linkDescription', { name: me?.name ?? '' }), multiUse: !minor, days: 30 });
            onClose();
            nav(`/payments?tab=links&created=${l.code}`);
          }, { success: t('receive.linkCreated') })}>{t('receive.createLink')}</Button>
        </div>
        <div className="panel panel-paper stack" style={{ padding: 16, justifyItems: 'center', textAlign: 'center' }}>
          {payload && <QRCode value={payload} size={210} label={t('receive.qrLabel')} />}
          <div className="small">{me?.name}</div>
          {minor && minor > 0 ? <strong className="tnum">{f.money(minor, ccy)}</strong> : <span className="xsmall">{t('receive.anyAmount')}</span>}
          <div className="xsmall" style={{ color: 'var(--paper-ink-2)' }}>{t('receive.qrHint')}</div>
        </div>
      </div>
    </Modal>
  );
}

/* ── Request money ── */
export function RequestDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [pocket, setPocket] = useDefaultPocket();
  const [client, setClient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const { run, busy, error } = useAction();
  const p = decodePocket(pocket);
  const ccy = p?.currency ?? 'CRWN';
  return (
    <Modal open onClose={onClose} title={t('request.title')} eyebrow={t('app.network')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<HandCoins />} loading={busy} disabled={!p || !client || !amount}
        onClick={() => run(async () => { await requestMoney({ toAccountId: p!.accountId, payerClientId: client, amount: toMinor(amount, ccy), currency: ccy, note }); onClose(); }, { success: t('request.sent'), sound: 'paper', silentError: true })}>{t('request.send')}</Button></>}>
      <div className="form-grid">
        <Field label={t('request.payer')} htmlFor="rq-c" hint={t('transfer.clientHint')}><Input id="rq-c" value={client} onChange={(e) => setClient(e.target.value.toUpperCase())} placeholder="ALD-C-104701" /></Field>
        <Field label={t('common.amount')} htmlFor="rq-a"><MoneyInput id="rq-a" value={amount} onChange={setAmount} currency={ccy} /></Field>
        <Field label={t('request.into')} htmlFor="rq-acc" className="full"><AccountPicker id="rq-acc" value={pocket} onChange={setPocket} /></Field>
        <Field label={t('common.note')} htmlFor="rq-n" className="full"><Input id="rq-n" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} /></Field>
      </div>
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── Withdraw: cardless cash code ── */
export function WithdrawDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const f = useFmt();
  const nav = useNavigate();
  const me = useSession((s) => s.user);
  const [pocket, setPocket] = useDefaultPocket();
  const [amount, setAmount] = useState('100');
  const { run, busy, error } = useAction();
  const codes = useLive(() => (me ? db.cardless.where('ownerId').equals(me.id).filter((c) => c.status === 'active').toArray() : []), [me?.id], []);
  const p = decodePocket(pocket);
  const ccy = p?.currency ?? 'CRWN';
  return (
    <Modal open onClose={onClose} title={t('withdraw.title')} eyebrow={t('nav.atm')} footer={<><Button onClick={onClose}>{t('common.close')}</Button><Button onClick={() => { onClose(); nav('/atm'); }} icon={<ArrowRight />}>{t('withdraw.goAtm')}</Button></>}>
      <p className="ink2 small">{t('withdraw.text')}</p>
      <div className="form-grid">
        <Field label={t('common.account')} htmlFor="wd-acc" className="full"><AccountPicker id="wd-acc" value={pocket} onChange={setPocket} /></Field>
        <Field label={t('common.amount')} htmlFor="wd-a"><MoneyInput id="wd-a" value={amount} onChange={setAmount} currency={ccy} /></Field>
        <div className="field" style={{ alignSelf: 'end' }}>
          <Button variant="primary" icon={<Banknote />} loading={busy} disabled={!p} onClick={() => run(() => createCardlessCode(p!.accountId, ccy, toMinor(amount, ccy)), { success: t('withdraw.created'), sound: 'card', silentError: true })}>{t('withdraw.create')}</Button>
        </div>
      </div>
      {error ? <ErrorPanel error={error} /> : null}
      {codes.length > 0 && (
        <div className="stack-sm">
          <div className="rule">{t('withdraw.activeCodes')}</div>
          {codes.map((c) => (
            <div key={c.id} className="row-between inset">
              <div><div className="mono" style={{ fontSize: '1.4rem', letterSpacing: '0.2em' }}>{c.code.replace(/(\d{4})(\d{4})/, '$1 $2')}</div><div className="xsmall muted">{t('withdraw.validUntil', { date: f.dateTime(c.expiresAt) })}</div></div>
              <Money minor={c.amount} ccy={c.currency} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ── Pay: invoices, requests, payment links ── */
export function PayDialog({ onClose, params }: { onClose: () => void; params?: Record<string, string> }) {
  const { t } = useT();
  const f = useFmt();
  const me = useSession((s) => s.user);
  const [tab, setTab] = useState<'invoices' | 'requests' | 'link'>(params?.link ? 'link' : 'invoices');
  const [pocket, setPocket] = useDefaultPocket();
  const [code, setCode] = useState(params?.link ?? '');
  const [txId, setTxId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { run, busy, error } = useAction();
  const invoices = useLive(() => (me ? db.invoices.where('recipientId').equals(me.id).filter((i) => i.status === 'sent' || i.status === 'overdue').toArray() : []), [me?.id], []);
  const requests = useLive(() => (me ? db.requests.where('payerId').equals(me.id).filter((r) => r.status === 'pending').toArray() : []), [me?.id], []);
  const link = useLive(() => (code.trim().length >= 6 ? getLink(code) : undefined), [code], undefined);
  const p = decodePocket(pocket);
  const go = (fn: () => Promise<unknown>) => { setRunning(true); void run(fn, { sound: 'payment', silentError: true }); };
  return (
    <Modal open onClose={onClose} title={t('pay.title')} eyebrow={t('app.network')} size="wide" footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      {running ? (
        <TxProgress txId={txId} error={error} />
      ) : (
        <>
          <Segmented label={t('pay.title')} value={tab} onChange={setTab} options={[{ value: 'invoices', label: `${t('pay.invoices')} (${invoices.length})` }, { value: 'requests', label: `${t('pay.requests')} (${requests.length})` }, { value: 'link', label: t('pay.link') }]} />
          <Field label={t('pay.payFrom')} htmlFor="pay-from"><AccountPicker id="pay-from" value={pocket} onChange={setPocket} /></Field>
          {tab === 'invoices' && (invoices.length ? (
            <div className="list panel">
              {invoices.map((i) => (
                <div key={i.id} className="list-item">
                  <span className="glyph"><ReceiptText /></span>
                  <div className="li-main"><div className="li-title">{i.issuerName} · {i.number}</div><div className="li-sub">{t('common.due')} {f.date(i.dueDate)}</div></div>
                  <StatusBadge domain="invoice" status={i.status} />
                  <Money minor={i.total} ccy={i.currency} />
                  <Button size="sm" variant="primary" loading={busy} disabled={!p} onClick={() => go(() => payInvoice(i.id, p!.accountId, setTxId))}>{t('common.pay')}</Button>
                </div>
              ))}
            </div>
          ) : <Empty title={t('pay.noInvoices')} />)}
          {tab === 'requests' && (requests.length ? (
            <div className="list panel">
              {requests.map((r) => (
                <div key={r.id} className="list-item">
                  <span className="glyph"><HandCoins /></span>
                  <div className="li-main"><div className="li-title">{r.requesterName}</div><div className="li-sub">“{r.note}” · {f.date(r.createdAt)}</div></div>
                  <Money minor={r.amount} ccy={r.currency} />
                  <Button size="sm" variant="primary" loading={busy} disabled={!p} onClick={() => go(() => payRequest(r.id, p!.accountId, setTxId))}>{t('common.pay')}</Button>
                </div>
              ))}
            </div>
          ) : <Empty title={t('pay.noRequests')} />)}
          {tab === 'link' && (
            <div className="stack">
              <Field label={t('pay.linkCode')} htmlFor="pay-code" hint={t('pay.linkHint')}><Input id="pay-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="PL-XXXXXXXX" className="mono" /></Field>
              {link && (
                <div className="inset row-between">
                  <div><div style={{ fontWeight: 600 }}>{link.ownerName}</div><div className="small ink2">{link.description}</div></div>
                  <div className="row">{link.amount ? <Money minor={link.amount} ccy={link.currency} /> : <Badge>{t('pay.openAmount')}</Badge>}<StatusBadge domain="link" status={link.status} /></div>
                </div>
              )}
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Button variant="primary" disabled={!link || link.status !== 'active' || !p || !link.amount} loading={busy} onClick={() => go(() => payLink(link!.code, p!.accountId, undefined, setTxId))}>{t('common.pay')}</Button>
              </div>
              {link && !link.amount && <Alert tone="info">{t('pay.openAmountHint')}</Alert>}
            </div>
          )}
          {error ? <ErrorPanel error={error} /> : null}
        </>
      )}
    </Modal>
  );
}

/* ── Create check (draft) ── */
export function CheckDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const nav = useNavigate();
  const [pocket, setPocket, accounts] = useDefaultPocket();
  const [payee, setPayee] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [kind, setKind] = useState<'personal' | 'cashier'>('personal');
  const { run, busy, error } = useAction();
  const p = decodePocket(pocket);
  const acc = accounts.find((a) => a.id === p?.accountId);
  const ccy = acc?.currency ?? 'CRWN';
  return (
    <Modal open onClose={onClose} title={t('checks.createTitle')} eyebrow={t('nav.checks')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<ScrollText />} loading={busy} disabled={!acc || !payee.trim() || !amount}
        onClick={() => run(async () => { const c = await createCheck({ accountId: acc!.id, payeeName: payee, payeeClientId: payeeId || undefined, amount: toMinor(amount, ccy), purpose, kind }); onClose(); nav(`/checks/${c.id}`); }, { success: t('checks.draftCreated'), sound: 'paper', silentError: true })}>{t('checks.createDraft')}</Button></>}>
      <Segmented label={t('common.type')} value={kind} onChange={setKind} options={[{ value: 'personal', label: t('checks.personalCheck') }, { value: 'cashier', label: t('checks.cashierCheck') }]} />
      {kind === 'cashier' && <Alert tone="info">{t('checks.cashierNote')}</Alert>}
      <div className="form-grid">
        <Field label={t('checks.drawnOn')} htmlFor="ck-acc" className="full" hint={t('checks.drawnOnHint')}><AccountPicker id="ck-acc" value={pocket} onChange={(v) => { const d = decodePocket(v); const a = accounts.find((x) => x.id === d?.accountId); setPocket(a ? encodePocket({ accountId: a.id, currency: a.currency }) : v); }} /></Field>
        <Field label={t('checks.payee')} htmlFor="ck-payee" required><Input id="ck-payee" value={payee} onChange={(e) => setPayee(e.target.value)} /></Field>
        <Field label={t('checks.payeeClient')} htmlFor="ck-pid" hint={t('checks.payeeClientHint')}><Input id="ck-pid" value={payeeId} onChange={(e) => setPayeeId(e.target.value.toUpperCase())} placeholder={t('common.optional')} /></Field>
        <Field label={t('common.amount')} htmlFor="ck-amt" required><MoneyInput id="ck-amt" value={amount} onChange={setAmount} currency={ccy} /></Field>
        <Field label={t('common.purpose')} htmlFor="ck-p"><Input id="ck-p" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
      </div>
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── Open account ── */
export function OpenAccountDialog({ onClose }: { onClose: () => void }) {
  const { t, tx } = useT();
  const nav = useNavigate();
  const me = useSession((s) => s.user);
  const [type, setType] = useState<AccountType>('current');
  const [ccy, setCcy] = useState('CRWN');
  const [name, setName] = useState('');
  const [multi, setMulti] = useState(false);
  const [coOwner, setCoOwner] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [condition, setCondition] = useState('');
  const [days, setDays] = useState('30');
  const [limit, setLimit] = useState('');
  const [created, setCreated] = useState<{ id: string; number: string } | null>(null);
  const { run, busy, error } = useAction();
  const types = CUSTOMER_ACCOUNT_TYPES.filter((x) => x !== 'deposit');
  const submit = () => run(async () => {
    let coOwnerIds: string[] | undefined;
    if (type === 'joint') {
      const u = await db.users.where('clientId').equals(coOwner.trim().toUpperCase()).first();
      if (!u) throw new (await import('@/core/errors')).BankError('INVALID_RECIPIENT', { clientId: coOwner });
      coOwnerIds = [u.id];
    }
    const a = await openAccount({
      ownerId: me!.id, type, currency: ccy, name, multiCurrency: multi, coOwnerIds,
      escrow: type === 'escrow' ? { beneficiaryName: beneficiary, condition, released: false } : undefined,
      expiresInDays: type === 'temporary' ? Number(days) || 30 : undefined,
      dailyLimit: limit ? toMinor(limit, ccy) : undefined,
    });
    setCreated({ id: a.id, number: a.number });
  }, { success: t('openAccount.created'), sound: 'stamp', silentError: true });
  return (
    <Modal open onClose={onClose} title={t('openAccount.title')} eyebrow={t('dept.DEP')}
      footer={created ? <><Button onClick={onClose}>{t('common.close')}</Button><Button variant="primary" onClick={() => { onClose(); nav(`/accounts/${created.id}`); }}>{t('openAccount.open')}</Button></> : <><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<Plus />} loading={busy} onClick={submit} disabled={!ccy || (type === 'joint' && !coOwner) || (type === 'escrow' && (!beneficiary || !condition))}>{t('openAccount.confirm')}</Button></>}>
      {created ? (
        <Alert tone="positive" title={t('openAccount.doneTitle')}>{t('openAccount.doneText', { number: formatAccountNumber(created.number) })}</Alert>
      ) : (
        <div className="form-grid">
          <Field label={t('openAccount.type')} htmlFor="oa-type"><Select id="oa-type" value={type} onChange={(e) => setType(e.target.value as AccountType)}>{types.map((x) => <option key={x} value={x}>{tx(`accountType.${x}`)}</option>)}</Select></Field>
          <Field label={t('common.currency')} htmlFor="oa-ccy"><CurrencySelect id="oa-ccy" value={ccy} onChange={setCcy} /></Field>
          <Field label={t('openAccount.name')} htmlFor="oa-name" className="full"><Input id="oa-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${tx(`accountType.${type}`)} · ${ccy}`} /></Field>
          <Field label={t('openAccount.dailyLimit')} htmlFor="oa-lim" hint={t('common.optional')}><MoneyInput id="oa-lim" value={limit} onChange={setLimit} currency={ccy} /></Field>
          <div className="field" style={{ alignSelf: 'end' }}><Switch checked={multi} onChange={setMulti} label={t('openAccount.multi')} /></div>
          {type === 'joint' && <Field label={t('openAccount.coOwner')} htmlFor="oa-co" className="full" required><Input id="oa-co" value={coOwner} onChange={(e) => setCoOwner(e.target.value.toUpperCase())} placeholder="ALD-C-104710" /></Field>}
          {type === 'escrow' && <><Field label={t('openAccount.beneficiary')} htmlFor="oa-ben" required><Input id="oa-ben" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} /></Field><Field label={t('openAccount.condition')} htmlFor="oa-cond" required><Input id="oa-cond" value={condition} onChange={(e) => setCondition(e.target.value)} /></Field></>}
          {type === 'temporary' && <Field label={t('openAccount.days')} htmlFor="oa-days"><Input id="oa-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></Field>}
          <div className="full"><Alert tone="info">{tx(`openAccount.typeHelp.${type}`)}</Alert></div>
        </div>
      )}
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── Open term deposit ── */
export function DepositDialog({ onClose }: { onClose: () => void }) {
  const { t, tx } = useT();
  const f = useFmt();
  const nav = useNavigate();
  const [pocket, setPocket] = useDefaultPocket();
  const [product, setProduct] = useState<DepositProduct>('fixed');
  const [term, setTerm] = useState(12);
  const [amount, setAmount] = useState('1000');
  const [renew, setRenew] = useState(false);
  const { run, busy, error } = useAction();
  const p = decodePocket(pocket);
  const ccy = p?.currency ?? 'CRWN';
  const minor = toMinor(amount || '0', ccy);
  const rate = depositRate(product, term, ccy);
  const proj = useMemo(() => projectDeposit(minor, rate, term), [minor, rate, term]);
  return (
    <Modal open onClose={onClose} title={t('deposits.openTitle')} eyebrow={t('dept.DEP')} size="wide"
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<PiggyBank />} loading={busy} disabled={!p || !(minor > 0)}
        onClick={() => run(async () => { const d = await openDeposit({ sourceAccountId: p!.accountId, currency: ccy, amount: minor, product, termMonths: term, autoRenew: renew }); onClose(); nav(`/deposits/${d.id}`); }, { success: t('deposits.opened'), sound: 'safe', silentError: true })}>{t('deposits.open')}</Button></>}>
      <div className="grid cols-3">
        {(['fixed', 'growth', 'flex'] as DepositProduct[]).map((pr) => (
          <button key={pr} type="button" className="qa" aria-pressed={product === pr} style={{ justifyItems: 'start', textAlign: 'left', borderColor: product === pr ? 'var(--accent)' : undefined }} onClick={() => setProduct(pr)}>
            <strong>{tx(`depositProduct.${pr}`)}</strong>
            <span className="muted">{tx(`depositProductDesc.${pr}`)}</span>
            <Badge tone="magic">{depositRate(pr, term, ccy)}% {t('common.perAnnum')}</Badge>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <Field label={t('deposits.fundFrom')} htmlFor="dp-from" className="full"><AccountPicker id="dp-from" value={pocket} onChange={setPocket} /></Field>
        <Field label={t('common.amount')} htmlFor="dp-amt"><MoneyInput id="dp-amt" value={amount} onChange={setAmount} currency={ccy} /></Field>
        <Field label={t('common.term')} htmlFor="dp-term"><Select id="dp-term" value={term} onChange={(e) => setTerm(Number(e.target.value))}>{DEPOSIT_TERMS.map((m) => <option key={m} value={m}>{t('common.months', { n: m })}</option>)}</Select></Field>
        <div className="full"><Switch checked={renew} onChange={setRenew} label={t('deposits.autoRenew')} /></div>
      </div>
      <div className="inset">
        <KV items={[
          [t('common.rate'), `${rate}% ${t('common.perAnnum')}`],
          [t('deposits.expectedIncome'), <strong className="tnum">{f.money(proj.total, ccy)}</strong>],
          [t('deposits.atMaturity'), f.money(proj.final, ccy)],
          [t('deposits.maturityDate'), f.dateLong(addDays(now(), Math.round(term * 30.44)).toISOString())],
          [t('deposits.topUps'), PRODUCT_RULES[product].topUp ? t('common.yes') : t('common.no')],
          [t('deposits.earlyPenalty'), `${PRODUCT_RULES[product].penaltyPct}%`],
        ]} />
        <div className="xsmall muted mt-2">{t('deposits.taxNote')}</div>
      </div>
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}

/* ── Generate document ── */
export function DocumentDialog({ onClose, params }: { onClose: () => void; params?: Record<string, string> }) {
  const { t, tx } = useT();
  const nav = useNavigate();
  const [kind, setKind] = useState<'statement' | GeneratedKind>((params?.kind as 'statement') ?? 'statement');
  const [pocket, setPocket] = useDefaultPocket();
  const monthAgo = addDays(now(), -30).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(todayKey());
  const [recipient, setRecipient] = useState('');
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const { run, busy, error } = useAction();
  const p = decodePocket(pocket);
  const kinds: ('statement' | GeneratedKind)[] = ['statement', 'balance_confirmation', 'account_certificate', 'payment_order', 'authorization', 'reference_letter', 'memo'];
  return (
    <Modal open onClose={onClose} title={t('generate.title')} eyebrow={t('dept.ARC')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<FileSignature />} loading={busy} disabled={!p && kind !== 'memo'}
        onClick={() => run(async () => {
          const doc = kind === 'statement' ? await generateStatement(p!.accountId, p!.currency, from, to) : await generateDocument(kind, { accountId: p?.accountId, recipient, text, amount: amount ? toMinor(amount, p?.currency ?? 'CRWN') : undefined, currency: p?.currency });
          onClose();
          nav(`/documents/${doc.id}`);
        }, { success: t('generate.done'), sound: 'document', silentError: true })}>{t('generate.generate')}</Button></>}>
      <Field label={t('generate.kind')} htmlFor="gd-kind"><Select id="gd-kind" value={kind} onChange={(e) => setKind(e.target.value as GeneratedKind)}>{kinds.map((k) => <option key={k} value={k}>{tx(`generate.kinds.${k}`)}</option>)}</Select></Field>
      {kind !== 'memo' && <Field label={t('common.account')} htmlFor="gd-acc"><AccountPicker id="gd-acc" value={pocket} onChange={setPocket} /></Field>}
      {kind === 'statement' && (
        <div className="form-grid">
          <Field label={t('common.from')} htmlFor="gd-from"><Input id="gd-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('common.to')} htmlFor="gd-to"><Input id="gd-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      )}
      {kind !== 'statement' && kind !== 'memo' && <Field label={t('generate.addressee')} htmlFor="gd-rec"><Input id="gd-rec" value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>}
      {kind === 'payment_order' && <Field label={t('common.amount')} htmlFor="gd-amt"><MoneyInput id="gd-amt" value={amount} onChange={setAmount} currency={p?.currency ?? 'CRWN'} /></Field>}
      {kind !== 'statement' && <Field label={t('generate.text')} htmlFor="gd-text"><Textarea id="gd-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} /></Field>}
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}
