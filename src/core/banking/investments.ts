/**
 * Investment Center — DEMONSTRATION MARKET ONLY. Instruments are fictional and
 * prices come from a deterministic simulator; nothing here is market data or
 * investment advice. Cash legs settle through the ledger (Securities Settlement).
 */
import { db } from '../db/db';
import { BankError } from '../errors';
import { nowISO, nowMs } from '../clock';
import { uid, randomDigits, hashSeed, prng } from '../util/random';
import { actor } from '../context';
import { quote, midRate } from '../currency/rates';
import { fromMinor, toMinor } from '../currency/format';
import { execute } from './engine';
import { availableOf } from './ledger';
import { canOperate, getAccountOrThrow, GL } from './accounts';
import { audit } from '../ops/audit';
import { notify } from '../comms/notify';
import type { Holding, Instrument, InvestmentOrder } from '../types';

export const INSTRUMENTS: Instrument[] = [
  { id: 'GRNG', name: 'Gringold Foundry Works', kind: 'stock', currency: 'CRWN', basePrice: 84.2, volatility: 0.28, drift: 0.06, dividendYield: 2.1, exchange: 'Vellinghast Bourse', sector: 'Metallurgy' },
  { id: 'LMPL', name: 'Lamplighters Consolidated', kind: 'stock', currency: 'CRWN', basePrice: 41.75, volatility: 0.18, drift: 0.04, dividendYield: 3.4, exchange: 'Vellinghast Bourse', sector: 'Utilities' },
  { id: 'QLLF', name: 'Quillfeather Press & Paper', kind: 'stock', currency: 'CRWN', basePrice: 22.4, volatility: 0.33, drift: 0.02, dividendYield: 1.2, exchange: 'Vellinghast Bourse', sector: 'Publishing' },
  { id: 'SLVB', name: 'Silverbridge Rail & Carriage', kind: 'stock', currency: 'CRWN', basePrice: 132.6, volatility: 0.22, drift: 0.05, dividendYield: 2.6, exchange: 'Vellinghast Bourse', sector: 'Transport' },
  { id: 'MRTM', name: 'Mortar & Moonstone Apothecaries', kind: 'stock', currency: 'CRWN', basePrice: 57.9, volatility: 0.3, drift: 0.07, dividendYield: 0.9, exchange: 'Vellinghast Bourse', sector: 'Apothecary' },
  { id: 'TDSV', name: 'Tidesilver Shipping Co.', kind: 'stock', currency: 'MSLV', basePrice: 18.3, volatility: 0.36, drift: 0.03, dividendYield: 4.1, exchange: 'Moonward Exchange', sector: 'Shipping' },
  { id: 'CNDH', name: 'Cinderhall Forgeworks', kind: 'stock', currency: 'EMBR', basePrice: 9.42, volatility: 0.41, drift: 0.08, dividendYield: 0, exchange: 'Ember Coast Exchange', sector: 'Industry' },
  { id: 'NMRO', name: 'Northmarch Outfitters Inc.', kind: 'stock', currency: 'USD', basePrice: 63.1, volatility: 0.25, drift: 0.05, dividendYield: 1.5, exchange: 'Northmarch Board', sector: 'Retail' },
  { id: 'BRKC', name: 'Brask Clockmakers Guild', kind: 'stock', currency: 'CHF', basePrice: 211.0, volatility: 0.16, drift: 0.03, dividendYield: 2.2, exchange: 'Brask Börse', sector: 'Precision' },
  { id: 'ATB31', name: 'Aldermoor Treasury Bond 2031', kind: 'bond', currency: 'CRWN', basePrice: 98.6, volatility: 0.04, drift: 0.01, dividendYield: 4.25, exchange: 'Exchequer Bond Desk', sector: 'Sovereign' },
  { id: 'ATB45', name: 'Aldermoor Treasury Bond 2045', kind: 'bond', currency: 'CRWN', basePrice: 92.1, volatility: 0.07, drift: 0.01, dividendYield: 4.9, exchange: 'Exchequer Bond Desk', sector: 'Sovereign' },
  { id: 'VRNB', name: 'Verrine Municipal Bond 2029', kind: 'bond', currency: 'EUR', basePrice: 101.2, volatility: 0.03, drift: 0.005, dividendYield: 3.1, exchange: 'Verrine Exchange', sector: 'Municipal' },
  { id: 'AEXF', name: 'Exchequer Balanced Endowment Fund', kind: 'fund', currency: 'CRWN', basePrice: 15.08, volatility: 0.11, drift: 0.05, dividendYield: 1.8, exchange: 'Exchequer Funds', sector: 'Balanced' },
  { id: 'RLMF', name: 'Realms Growth Fund', kind: 'fund', currency: 'USD', basePrice: 27.6, volatility: 0.17, drift: 0.07, dividendYield: 0.6, exchange: 'Exchequer Funds', sector: 'Equity' },
  { id: 'GOLD', name: 'Gold Bullion (1 oz)', kind: 'metal', currency: 'USD', basePrice: 3810, volatility: 0.15, drift: 0.04, dividendYield: 0, exchange: 'Undervault Bullion Desk', sector: 'Precious metal' },
  { id: 'SILV', name: 'Silver Bullion (1 oz)', kind: 'metal', currency: 'USD', basePrice: 43.6, volatility: 0.22, drift: 0.03, dividendYield: 0, exchange: 'Undervault Bullion Desk', sector: 'Precious metal' },
  { id: 'FXEUR', name: 'EUR Currency Note', kind: 'currency', currency: 'CRWN', basePrice: 0, volatility: 0, drift: 0, dividendYield: 0, exchange: 'Bureau of Coinage & Exchange', sector: 'FX' },
  { id: 'FXMSL', name: 'Moonsilver Currency Note', kind: 'currency', currency: 'CRWN', basePrice: 0, volatility: 0, drift: 0, dividendYield: 0, exchange: 'Bureau of Coinage & Exchange', sector: 'FX' },
  { id: 'PHXF', name: 'Phoenix Feather Futures', kind: 'magical', currency: 'CRWN', basePrice: 312.5, volatility: 0.55, drift: 0.09, dividendYield: 0, exchange: 'Arcane Commodities Hall', sector: 'Arcane commodities' },
  { id: 'DGLX', name: 'Dragonglass Index', kind: 'magical', currency: 'VEIL', basePrice: 1.842, volatility: 0.48, drift: 0.06, dividendYield: 0, exchange: 'Veiled Courts', sector: 'Arcane index' },
  { id: 'MWWR', name: 'Moonwell Water Rights', kind: 'magical', currency: 'MSLV', basePrice: 77.3, volatility: 0.26, drift: 0.04, dividendYield: 3.0, exchange: 'Moonward Exchange', sector: 'Arcane utilities' },
  { id: 'STMB', name: 'Starmetal Bullion Trust', kind: 'magical', currency: 'STAR', basePrice: 145.0, volatility: 0.34, drift: 0.05, dividendYield: 0, exchange: 'Celestine Bourse', sector: 'Arcane metals' },
];

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 9, 1);

function smooth(seed: string, t: number, vol: number): number {
  const r = prng(hashSeed(seed));
  const comps = [700, 160, 45, 11, 2.6, 0.6];
  let s = 0;
  const d = t / DAY;
  comps.forEach((p, i) => {
    const ph = r() * Math.PI * 2;
    s += Math.sin((2 * Math.PI * d) / p + ph) * (1 / (i + 1.2));
  });
  const noise = (prng(hashSeed(seed + Math.floor(t / 3_600_000)))() - 0.5) * 0.15;
  return vol * 0.6 * (s + noise);
}

/** Simulated price at time t (decimal, in instrument currency). */
export function priceAt(inst: Instrument, t: number = nowMs()): number {
  if (inst.kind === 'currency') {
    const ccy = inst.id === 'FXEUR' ? 'EUR' : 'MSLV';
    return midRate(ccy, inst.currency, t);
  }
  const years = (t - EPOCH) / (365 * DAY);
  const v = inst.basePrice * Math.exp(inst.drift * years + smooth(inst.id, t, inst.volatility) - smooth(inst.id, EPOCH, inst.volatility));
  return Math.max(0.0001, v);
}

export function priceHistory(inst: Instrument, days: number, points = 90, end = nowMs()) {
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const t = end - days * DAY + (days * DAY * i) / points;
    out.push({ t, v: priceAt(inst, t) });
  }
  return out;
}

export function instrument(id: string) {
  const i = INSTRUMENTS.find((x) => x.id === id);
  if (!i) throw new BankError('NOT_FOUND', { object: 'instrument' });
  return i;
}

export async function placeOrder(input: { instrumentId: string; side: 'buy' | 'sell'; kind: 'market' | 'limit'; quantity: number; limitPrice?: number; accountId: string }) {
  const inst = instrument(input.instrumentId);
  const acc = await getAccountOrThrow(input.accountId);
  if (!canOperate(acc)) throw new BankError('PERMISSION_DENIED');
  if (!(input.quantity > 0)) throw new BankError('INVALID_AMOUNT');
  if (input.kind === 'limit' && !(input.limitPrice && input.limitPrice > 0)) throw new BankError('VALIDATION', { field: 'limitPrice' });
  const a = actor();
  const order: InvestmentOrder = {
    id: uid('ORD'), number: `OR-${randomDigits(7)}`, ownerId: acc.ownerId, instrumentId: inst.id, side: input.side, kind: input.kind,
    quantity: input.quantity, limitPrice: input.limitPrice, status: 'open', accountId: acc.id, createdAt: nowISO(),
  };
  if (input.side === 'sell') {
    const h = await db.holdings.where('[ownerId+instrumentId]').equals([acc.ownerId, inst.id]).first();
    if (!h || h.quantity < input.quantity) throw new BankError('INSUFFICIENT_FUNDS', { instrument: inst.id, held: h?.quantity ?? 0 });
  }
  await db.orders.add(order);
  await audit({ action: 'invest.order', object: 'order', objectId: order.id, details: `${order.side} ${order.quantity} ${inst.id} ${order.kind}` });
  if (input.kind === 'market') return fillOrder(order.id);
  void a;
  return order;
}

export async function cancelOrder(id: string) {
  const o = await db.orders.get(id);
  if (!o || o.status !== 'open') throw new BankError('INVALID_STATE');
  if (o.ownerId !== actor().userId && !actor().system) throw new BankError('PERMISSION_DENIED');
  await db.orders.update(id, { status: 'cancelled' });
  await audit({ action: 'invest.cancel', object: 'order', objectId: id });
}

export async function fillOrder(id: string): Promise<InvestmentOrder> {
  const o = await db.orders.get(id);
  if (!o || o.status !== 'open') throw new BankError('INVALID_STATE');
  const inst = instrument(o.instrumentId);
  const price = priceAt(inst);
  const acc = await getAccountOrThrow(o.accountId);
  const grossInst = toMinor(price * o.quantity, inst.currency);
  const settleCcy = acc.pockets.includes(inst.currency) ? inst.currency : acc.currency;
  const q = settleCcy === inst.currency ? null : quote(inst.currency, settleCcy, grossInst);
  const amount = q ? q.targetAmount : grossInst;
  const owner = await db.users.get(o.ownerId);
  try {
    const tx = await execute({
      draft: {
        type: 'investment', amount, currency: settleCcy, fromAccountId: o.side === 'buy' ? acc.id : undefined, toAccountId: o.side === 'sell' ? acc.id : undefined,
        sender: o.side === 'buy' ? { name: owner?.name ?? 'Client', accountNumber: acc.number } : { name: inst.exchange },
        recipient: o.side === 'buy' ? { name: inst.exchange } : { name: owner?.name ?? 'Client', accountNumber: acc.number },
        description: `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.quantity} × ${inst.name} @ ${price.toFixed(4)} ${inst.currency} (demo market)`,
        category: 'investments', channel: 'app', refPrefix: 'INV', meta: { orderId: o.id, instrumentId: inst.id, price }, partyIds: [o.ownerId],
      },
      validate: async () => {
        if (o.side === 'buy') {
          const avail = await availableOf(acc.id, settleCcy);
          if (avail < amount) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: amount, currency: settleCcy });
        }
      },
      screen: false,
      plan: () => [{ memo: `Securities ${o.number}`, lines: o.side === 'buy'
        ? [{ accountId: acc.id, currency: settleCcy, side: 'D', amount }, { accountId: GL.SECURITIES, currency: settleCcy, side: 'C', amount }]
        : [{ accountId: GL.SECURITIES, currency: settleCcy, side: 'D', amount }, { accountId: acc.id, currency: settleCcy, side: 'C', amount }],
        allowOverdraft: o.side === 'sell' }],
    });
    const h = await db.holdings.where('[ownerId+instrumentId]').equals([o.ownerId, inst.id]).first();
    if (o.side === 'buy') {
      if (h) {
        const qty = h.quantity + o.quantity;
        await db.holdings.update(h.id, { quantity: qty, avgCost: (h.avgCost * h.quantity + price * o.quantity) / qty });
      } else {
        const nh: Holding = { id: uid('HLDG'), ownerId: o.ownerId, instrumentId: inst.id, quantity: o.quantity, avgCost: price, realized: 0, dividends: 0 };
        await db.holdings.add(nh);
      }
    } else if (h) {
      await db.holdings.update(h.id, { quantity: h.quantity - o.quantity, realized: h.realized + (price - h.avgCost) * o.quantity });
    }
    await db.orders.update(o.id, { status: 'filled', filledAt: nowISO(), fillPrice: price, txId: tx.id });
  } catch (e) {
    await db.orders.update(o.id, { status: 'rejected', reason: e instanceof BankError ? e.code : 'TRANSACTION_FAILED' });
    throw e;
  }
  return (await db.orders.get(o.id))!;
}

/** Scheduler hook: fill limit orders whose price condition is met. */
export async function processLimitOrders() {
  const open = await db.orders.where('status').equals('open').toArray();
  let filled = 0;
  for (const o of open) {
    const p = priceAt(instrument(o.instrumentId));
    if ((o.side === 'buy' && p <= (o.limitPrice ?? 0)) || (o.side === 'sell' && p >= (o.limitPrice ?? Infinity))) {
      try {
        await fillOrder(o.id);
        filled++;
        await notify(o.ownerId, { category: 'payments', titleKey: 'n.invest.filled.title', bodyKey: 'n.invest.filled.body', params: { number: o.number, inst: o.instrumentId }, link: '/investments' });
      } catch {
        /* rejected orders are recorded */
      }
    }
  }
  return filled;
}

/** Quarterly dividends for dividend-paying instruments (paid on the 1st of Jan/Apr/Jul/Oct). */
export async function payDividends(dayKey: string) {
  if (!/-(01|04|07|10)-01$/.test(dayKey)) return 0;
  const holdings = (await db.holdings.toArray()).filter((h) => h.quantity > 0);
  let paid = 0;
  for (const h of holdings) {
    const inst = INSTRUMENTS.find((i) => i.id === h.instrumentId);
    if (!inst || !inst.dividendYield) continue;
    const per = (priceAt(inst) * inst.dividendYield) / 100 / 4;
    const amountDec = per * h.quantity;
    const accs = (await db.accounts.where('ownerId').equals(h.ownerId).toArray()).filter((a) => a.status === 'active' && a.type === 'current');
    const acc = accs.find((a) => a.pockets.includes(inst.currency)) ?? accs[0];
    if (!acc) continue;
    const ccy = acc.pockets.includes(inst.currency) ? inst.currency : acc.currency;
    const minorInst = toMinor(amountDec, inst.currency);
    const amount = ccy === inst.currency ? minorInst : quote(inst.currency, ccy, minorInst).targetAmount;
    if (amount <= 0) continue;
    await execute({
      draft: { type: 'dividend', amount, currency: ccy, toAccountId: acc.id, sender: { name: inst.name }, recipient: { name: acc.name, accountNumber: acc.number }, description: `Dividend ${inst.name} (${h.quantity} units, demo)`, category: 'income', channel: 'system', refPrefix: 'DIV', partyIds: [h.ownerId] },
      screen: false,
      plan: () => [{ memo: 'Dividend', allowOverdraft: true, lines: [{ accountId: GL.SECURITIES, currency: ccy, side: 'D', amount }, { accountId: acc.id, currency: ccy, side: 'C', amount }] }],
    });
    await db.holdings.update(h.id, { dividends: h.dividends + fromMinor(amount, ccy) });
    paid++;
  }
  return paid;
}
