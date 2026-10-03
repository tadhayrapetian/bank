/** Bank-wide operating parameters (fee schedule, limits, processing speed). Persisted in meta. */

export interface BankSettings {
  fxSpreadMajorPct: number;
  fxSpreadMinorPct: number;
  fxSpreadMagicalPct: number;
  fxFeePct: number;
  intlFeePct: number;
  intlFeeMinUSD: number; // minor USD
  transferFee: number; // minor CRWN-equivalent? flat fee for Aetherline external transfers (in tx currency minor of 1 unit)
  atmForeignFeeUSD: number; // minor USD
  checkFeeUSD: number;
  bounceFeeUSD: number;
  cashierCheckFeeUSD: number;
  vaultRentMultiplier: number;
  processingSpeed: 'instant' | 'fast' | 'realistic';
  intlStageSeconds: number;
  cardSettlementSeconds: number;
  fraudReviewThreshold: number;
  fraudBlockThreshold: number;
  fraudLargeAmountUSD: number; // minor USD
  defaultDailyLimitUSD: number; // minor USD
  checkValidityDays: number;
  withholdingTaxPct: number;
  bankName: string;
}

export const DEFAULT_SETTINGS: BankSettings = {
  fxSpreadMajorPct: 0.6,
  fxSpreadMinorPct: 1.2,
  fxSpreadMagicalPct: 1.8,
  fxFeePct: 0.25,
  intlFeePct: 0.4,
  intlFeeMinUSD: 800,
  transferFee: 0,
  atmForeignFeeUSD: 250,
  checkFeeUSD: 0,
  bounceFeeUSD: 1500,
  cashierCheckFeeUSD: 500,
  vaultRentMultiplier: 1,
  processingSpeed: 'fast',
  intlStageSeconds: 25,
  cardSettlementSeconds: 45,
  fraudReviewThreshold: 45,
  fraudBlockThreshold: 75,
  fraudLargeAmountUSD: 2_000_000,
  defaultDailyLimitUSD: 5_000_000,
  checkValidityDays: 180,
  withholdingTaxPct: 10,
  bankName: 'Exchequer of Aldermoor',
};

let current: BankSettings = { ...DEFAULT_SETTINGS };

export function getSettings(): BankSettings {
  return current;
}

export function setSettingsCache(s: Partial<BankSettings>) {
  current = { ...DEFAULT_SETTINGS, ...s };
}

/** Milliseconds for one visual processing step in the transaction pipeline. */
export function stepDelay(): number {
  switch (current.processingSpeed) {
    case 'instant':
      return 0;
    case 'realistic':
      return 900;
    default:
      return 260;
  }
}
