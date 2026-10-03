/** One transaction as seen by the current user: direction, counterparty, signed amount, status. */
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Repeat, CreditCard, Banknote, Globe, Landmark, ReceiptText, ScrollText, PiggyBank, HandCoins, TrendingUp, XCircle, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT, useFmt } from '@/hooks/useT';
import { StatusBadge } from '@/ui/primitives';
import { directionFor } from '@/core/ops/analytics';
import type { Transaction } from '@/core/types';

const TYPE_ICON: Partial<Record<Transaction['type'], ReactNode>> = {
  fx: <Repeat />, card_payment: <CreditCard />, atm_withdrawal: <Banknote />, atm_deposit: <Banknote />, cash_deposit: <Banknote />, cash_withdrawal: <Banknote />,
  international: <Globe />, own_transfer: <ArrowLeftRight />, invoice: <ReceiptText />, check: <ScrollText />, deposit_open: <PiggyBank />, deposit_interest: <PiggyBank />,
  deposit_payout: <PiggyBank />, loan_disbursement: <HandCoins />, loan_repayment: <HandCoins />, investment: <TrendingUp />, dividend: <TrendingUp />, opening: <Landmark />,
};

export function TxRow({ tx, mine }: { tx: Transaction; mine: Set<string> }) {
  const { tx: tr } = useT();
  const f = useFmt();
  const dir = directionFor(tx, mine);
  const failed = ['failed', 'rejected', 'cancelled', 'expired'].includes(tx.status);
  const pending = tx.status === 'pending' || tx.status === 'processing';
  const counterparty = dir === 'in' ? tx.sender.name : dir === 'out' ? tx.merchant?.name ?? tx.recipient.name : tr(`txType.${tx.type}`);
  const amount = dir === 'in' ? tx.creditAmount ?? tx.amount : tx.amount;
  const ccy = dir === 'in' ? tx.creditCurrency ?? tx.currency : tx.currency;
  const sign = dir === 'in' ? 1 : dir === 'out' ? -1 : 0;
  const icon = failed ? <XCircle /> : pending ? <Clock /> : TYPE_ICON[tx.type] ?? (dir === 'in' ? <ArrowDownLeft /> : <ArrowUpRight />);
  return (
    <Link to={`/transactions/${tx.id}`} className="list-item">
      <span className={`glyph ${failed ? 'fail' : dir}`}>{icon}</span>
      <div className="li-main">
        <div className="li-title">{counterparty}</div>
        <div className="li-sub">{tx.description} · {f.dateTime(tx.createdAt)}</div>
      </div>
      <div className="li-end stack-sm" style={{ justifyItems: 'end', gap: 2 }}>
        <span className={`tnum nowrap ${failed ? 'muted' : sign > 0 ? 'pos' : ''}`} style={{ fontWeight: 600, textDecoration: failed ? 'line-through' : undefined }}>
          {f.money(sign * amount, ccy, { sign: sign !== 0, mask: true })}
        </span>
        {tx.status !== 'completed' ? <StatusBadge domain="tx" status={tx.status} /> : <span className="xsmall muted">{tr(`txType.${tx.type}`)}</span>}
      </div>
    </Link>
  );
}
