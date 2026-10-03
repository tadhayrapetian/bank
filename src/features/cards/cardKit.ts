/** Card helpers shared by the card pages: type capabilities, eligible accounts, today's spend. */
import { db } from '@/core/db/db';
import { useLive } from '@/hooks/data';
import { now, startOfDayISO } from '@/core/clock';
import { toBase } from '@/core/currency/rates';
import type { Account, Card, CardControls, CardType } from '@/core/types';

export const CARD_TYPES: CardType[] = ['debit', 'credit', 'premium', 'business', 'virtual', 'vault'];
export const CONTROL_KEYS: (keyof CardControls)[] = ['online', 'contactless', 'atm', 'international', 'magstripe'];

/** Which controls a card type can use at all (virtual cards live online only; vault cards hold bullion, no cash points). */
export function controlSupported(type: CardType, k: keyof CardControls): boolean {
  if (type === 'virtual') return k === 'online' || k === 'international';
  if (type === 'vault') return k !== 'atm';
  return true;
}

export function atmCapable(card: Card) {
  return controlSupported(card.type, 'atm');
}

const PERSONAL: Account['type'][] = ['current', 'savings', 'joint', 'reserve', 'temporary', 'business'];

/** Accounts a card of this type may be linked to (mirrors the rules enforced by issueCard). */
export function eligibleAccount(type: CardType, a: Account) {
  if (a.status !== 'active') return false;
  if (type === 'credit') return a.type === 'credit';
  if (type === 'vault') return a.type === 'vault';
  if (type === 'business') return a.type === 'business';
  return PERSONAL.includes(a.type);
}

export const RETIRED: Card['status'][] = ['blocked', 'replaced', 'expired'];

export function isRetired(c: Card) {
  return RETIRED.includes(c.status);
}

const TYPE_ORDER: Record<CardType, number> = { premium: 0, debit: 1, credit: 2, business: 3, virtual: 4, vault: 5 };

export function sortCards(cards: Card[]) {
  return [...cards].sort((a, b) => Number(isRetired(a)) - Number(isRetired(b)) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || b.createdAt.localeCompare(a.createdAt));
}

export interface CardSpend {
  all: number;
  atm: number;
  count: number;
}

/** Spend today per card, computed the same way the authorizer does (card payments vs ATM cash, in card currency). */
export function useCardSpend(cards: Card[]): Map<string, CardSpend> {
  const ids = cards.map((c) => c.id);
  return useLive(
    async () => {
      const m = new Map<string, CardSpend>();
      if (!ids.length) return m;
      const since = startOfDayISO(now());
      const rows = await db.transactions.where('cardId').anyOf(ids).filter((t) => t.createdAt >= since && ['completed', 'processing', 'pending'].includes(t.status)).toArray();
      for (const c of cards) {
        const mine = rows.filter((t) => t.cardId === c.id);
        m.set(c.id, {
          all: mine.filter((t) => t.type === 'card_payment').reduce((s, t) => s + toBase(t.amount, t.currency, c.currency), 0),
          atm: mine.filter((t) => t.type === 'atm_withdrawal').reduce((s, t) => s + toBase(t.amount, t.currency, c.currency), 0),
          count: mine.length,
        });
      }
      return m;
    },
    [ids.join(), cards.map((c) => c.currency).join()],
    new Map(),
  );
}

export function expiryLabel(c: Card) {
  return `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(2)}`;
}
