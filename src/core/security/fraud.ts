/**
 * Fraud Detection (DEMONSTRATION RULES ONLY).
 * A transparent rule set produces a risk score 0–100 with reasons; thresholds
 * from bank settings map it to Allow / Review / Block. This is not a real risk
 * model and its outputs are not real banking decisions.
 */
import { db } from '../db/db';
import { nowISO, nowMs } from '../clock';
import { uid } from '../util/random';
import { getSettings } from '../settings';
import { toBase } from '../currency/rates';
import { REALMS } from '../institution';
import type { FraudEvent, RiskInfo, TxType } from '../types';

export interface ScreenInput {
  userId: string;
  userName: string;
  amount: number;
  currency: string;
  type: TxType;
  realm?: string;
  deviceId?: string;
  recipientKey?: string; // account number / merchant name
  dailyLimitExceeded?: boolean;
  txId?: string;
}

export const FRAUD_RULES = [
  'unusual_amount', 'large_amount', 'unusual_realm', 'high_risk_realm', 'high_frequency', 'limit_exceeded',
  'round_structuring', 'new_recipient_large', 'new_device',
] as const;

export async function screenTransaction(input: ScreenInput): Promise<RiskInfo> {
  const s = getSettings();
  const reasons: string[] = [];
  let score = 0;
  const amountUSD = toBase(input.amount, input.currency, 'USD');

  const since30 = new Date(nowMs() - 30 * 86_400_000).toISOString();
  const recent = (await db.transactions.where('createdAt').aboveOrEqual(since30).toArray())
    .filter((t) => t.initiatorId === input.userId && t.status === 'completed');
  const usdAmounts = recent.map((t) => toBase(t.amount, t.currency, 'USD')).filter((v) => v > 0);
  const avg = usdAmounts.length ? usdAmounts.reduce((a, b) => a + b, 0) / usdAmounts.length : 0;

  if (avg > 0 && amountUSD > avg * 6 && amountUSD > 50_000) {
    score += 25;
    reasons.push('unusual_amount');
  }
  if (amountUSD >= s.fraudLargeAmountUSD) {
    score += 30;
    reasons.push('large_amount');
  }

  const user = await db.users.get(input.userId);
  if (input.realm && input.realm !== 'ALD') {
    const realm = REALMS.find((r) => r.code === input.realm);
    if (user && !user.usualRealms.includes(input.realm)) {
      score += 15;
      reasons.push('unusual_realm');
    }
    if (realm?.risk === 'high') {
      score += 40;
      reasons.push('high_risk_realm');
    }
  }

  const tenMinAgo = new Date(nowMs() - 10 * 60_000).toISOString();
  const burst = recent.filter((t) => t.createdAt >= tenMinAgo).length;
  if (burst >= 5) {
    score += 25;
    reasons.push('high_frequency');
  }

  if (input.dailyLimitExceeded) {
    score += 35;
    reasons.push('limit_exceeded');
  }

  const major = amountUSD / 100;
  if (major >= 900 && major % 1000 >= 900 && major % 1000 <= 999.99) {
    score += 15;
    reasons.push('round_structuring');
  }

  if (input.recipientKey && amountUSD > 300_000) {
    const known = recent.some((t) => t.recipient.accountNumber === input.recipientKey || t.recipient.name === input.recipientKey);
    if (!known) {
      score += 15;
      reasons.push('new_recipient_large');
    }
  }

  if (input.deviceId && input.userId) {
    const dev = await db.devices.get(input.deviceId);
    if (!dev || dev.userId !== input.userId || !dev.trusted) {
      score += 10;
      reasons.push('new_device');
    }
  }

  score = Math.min(100, score);
  const action: RiskInfo['action'] =
    score >= s.fraudBlockThreshold ? 'block' : score >= s.fraudReviewThreshold ? 'review' : 'allow';

  let eventId: string | undefined;
  if (action !== 'allow' || reasons.length) {
    const ev: FraudEvent = {
      id: uid('FRD'),
      txId: input.txId,
      userId: input.userId,
      userName: input.userName,
      createdAt: nowISO(),
      score,
      reasons,
      action,
      status: action === 'review' ? 'open' : 'auto',
      amount: input.amount,
      currency: input.currency,
      realm: input.realm,
      deviceId: input.deviceId,
    };
    await db.fraud.add(ev);
    eventId = ev.id;
  }
  return { score, reasons, action, eventId };
}
