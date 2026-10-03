/**
 * Banking error vocabulary. Every failure the core raises is a BankError with a
 * stable code; the UI translates the code into a title, an explanation and a
 * suggested next step (see i18n keys `errors.<CODE>.*`).
 */

export const ERROR_CODES = [
  'INSUFFICIENT_FUNDS',
  'INVALID_ACCOUNT',
  'INVALID_RECIPIENT',
  'DAILY_LIMIT_EXCEEDED',
  'CURRENCY_UNSUPPORTED',
  'EXCHANGE_FAILED',
  'TRANSACTION_FAILED',
  'ACCOUNT_FROZEN',
  'CARD_BLOCKED',
  'VERIFICATION_FAILED',
  'DOCUMENT_EXPIRED',
  'NETWORK_UNAVAILABLE',
  'PERMISSION_DENIED',
  'INVALID_AMOUNT',
  'INVALID_PIN',
  'KYC_REQUIRED',
  'SAME_ACCOUNT',
  'NOT_FOUND',
  'INVALID_STATE',
  'FRAUD_BLOCKED',
  'CARD_LIMIT_EXCEEDED',
  'CARD_CONTROL_DISABLED',
  'ACCOUNT_NOT_EMPTY',
  'INVALID_CREDENTIALS',
  'USER_LOCKED',
  'SECOND_FACTOR_REQUIRED',
  'VALIDATION',
  'ATM_CASH_UNAVAILABLE',
  'SEPARATION_OF_DUTIES',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class BankError extends Error {
  code: ErrorCode;
  params: Record<string, string | number>;
  constructor(code: ErrorCode, params: Record<string, string | number> = {}, message?: string) {
    super(message ?? code);
    this.name = 'BankError';
    this.code = code;
    this.params = params;
  }
}

export function isBankError(e: unknown): e is BankError {
  return e instanceof Error && (e as BankError).name === 'BankError' && typeof (e as BankError).code === 'string';
}

export function toBankError(e: unknown): BankError {
  if (isBankError(e)) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new BankError('TRANSACTION_FAILED', { detail: msg }, msg);
}

export function assert(cond: unknown, code: ErrorCode, params?: Record<string, string | number>): asserts cond {
  if (!cond) throw new BankError(code, params);
}
