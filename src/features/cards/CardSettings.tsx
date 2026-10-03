/** Card limits (per payment, daily, ATM) and usage controls. */
import { useEffect, useState } from 'react';
import { Gauge, SlidersHorizontal, Save, RotateCcw } from 'lucide-react';
import { Panel, Button, Field, Switch, Progress, Alert } from '@/ui/primitives';
import { MoneyInput } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { useT, useFmt } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { toMinor, fromMinor } from '@/core/currency/format';
import { DEFAULT_LIMITS, setCardControls, setCardLimits } from '@/core/banking/cards';
import type { Card, CardControls } from '@/core/types';
import { CONTROL_KEYS, controlSupported, type CardSpend } from './cardKit';

type LimitKey = keyof Card['limits'];
const LIMIT_KEYS: LimitKey[] = ['perTx', 'daily', 'atmDaily'];

export function LimitsPanel({ card, spend }: { card: Card; spend?: CardSpend }) {
  const { t } = useT();
  const f = useFmt();
  const ccy = card.currency;
  const asText = (v: number) => String(fromMinor(v, ccy));
  const [vals, setVals] = useState<Record<LimitKey, string>>({ perTx: asText(card.limits.perTx), daily: asText(card.limits.daily), atmDaily: asText(card.limits.atmDaily) });
  const key = JSON.stringify(card.limits);
  useEffect(() => {
    setVals({ perTx: asText(card.limits.perTx), daily: asText(card.limits.daily), atmDaily: asText(card.limits.atmDaily) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, card.id]);
  const { run, busy, error } = useAction();
  const atmOk = controlSupported(card.type, 'atm');
  const parsed: Record<LimitKey, number> = {
    perTx: vals.perTx.trim() ? toMinor(vals.perTx, ccy) : NaN,
    daily: vals.daily.trim() ? toMinor(vals.daily, ccy) : NaN,
    atmDaily: atmOk ? (vals.atmDaily.trim() ? toMinor(vals.atmDaily, ccy) : NaN) : 0,
  };
  const valid = LIMIT_KEYS.every((k) => Number.isInteger(parsed[k]) && parsed[k] >= 0);
  const changed = LIMIT_KEYS.some((k) => parsed[k] !== card.limits[k]);
  const editable = card.status !== 'replaced' && card.status !== 'blocked';
  const used: Record<LimitKey, number | undefined> = { perTx: undefined, daily: spend?.all ?? 0, atmDaily: spend?.atm ?? 0 };
  return (
    <Panel title={t('cards.limits.title')} icon={<Gauge />} sub={t('cards.limits.sub')}>
      <div className="stack">
        {LIMIT_KEYS.map((k) => {
          const disabled = !editable || (k === 'atmDaily' && !atmOk);
          return (
            <div key={k} className="sg-limit-row">
              <Field label={t(`cards.limits.${k}`)} htmlFor={`lim-${k}`} hint={k === 'atmDaily' && !atmOk ? t('cards.limits.noAtm') : t(`cards.limits.${k}Hint`)}>
                {disabled && k === 'atmDaily' ? <div className="input" aria-disabled style={{ display: 'flex', alignItems: 'center' }}>{f.money(0, ccy)}</div> : <MoneyInput id={`lim-${k}`} value={vals[k]} currency={ccy} onChange={(v) => setVals((s) => ({ ...s, [k]: v }))} />}
              </Field>
              {used[k] !== undefined && (
                <div className="sg-limit-used">
                  <div className="row-between xsmall"><span className="muted">{t('cards.limits.usedToday')}</span><span className="tnum">{f.money(used[k]!, ccy)}</span></div>
                  <Progress value={used[k]!} max={card.limits[k] || 1} label={t('cards.limits.usedToday')} />
                </div>
              )}
            </div>
          );
        })}
        {valid && parsed.perTx > parsed.daily && <Alert tone="warning">{t('cards.limits.perTxAboveDaily')}</Alert>}
        <ErrorPanel error={error} />
        <div className="row">
          <Button variant="primary" icon={<Save />} loading={busy} disabled={!editable || !valid || !changed} onClick={() => run(() => setCardLimits(card.id, parsed), { success: t('cards.limits.saved'), sound: 'paper', silentError: true })}>{t('cards.limits.save')}</Button>
          <Button variant="ghost" icon={<RotateCcw />} disabled={!editable} onClick={() => {
            const d = DEFAULT_LIMITS[card.type];
            setVals({ perTx: asText(d.perTx), daily: asText(d.daily), atmDaily: asText(d.atmDaily) });
          }}>{t('cards.limits.defaults')}</Button>
        </div>
      </div>
    </Panel>
  );
}

export function ControlsPanel({ card, id }: { card: Card; id?: string }) {
  const { t, tx } = useT();
  const { run, busy, error } = useAction();
  const editable = card.status !== 'replaced' && card.status !== 'blocked';
  const toggle = (k: keyof CardControls, v: boolean) =>
    run(() => setCardControls(card.id, { ...card.controls, [k]: v }), { success: t(v ? 'cards.controls.on' : 'cards.controls.off', { control: tx(`cards.controls.${k}`) }), sound: 'card', silentError: true });
  return (
    <Panel id={id} title={t('cards.controls.title')} icon={<SlidersHorizontal />} sub={t('cards.controls.sub')}>
      <div className="sg-controls">
        {CONTROL_KEYS.map((k) => {
          const supported = controlSupported(card.type, k);
          return (
            <div key={k} className={`sg-control${supported ? '' : ' unsupported'}`}>
              <Switch checked={supported && card.controls[k]} disabled={!supported || !editable || busy} onChange={(v) => void toggle(k, v)} label={<strong>{tx(`cards.controls.${k}`)}</strong>} />
              <div className="xsmall muted">{supported ? tx(`cards.controls.${k}Desc`) : tx(`cards.controls.unsupported.${card.type}`)}</div>
            </div>
          );
        })}
      </div>
      <ErrorPanel error={error} />
    </Panel>
  );
}
