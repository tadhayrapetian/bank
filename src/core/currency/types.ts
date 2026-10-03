export type CurrencyKind = 'fiat' | 'fund' | 'metal' | 'special' | 'magical';
export type CurrencyStatus = 'active' | 'withdrawn' | 'non_transactional' | 'suspended';
export type Region =
  | 'europe' | 'americas' | 'asia' | 'africa' | 'oceania' | 'middle_east' | 'supranational' | 'magical';

export interface CurrencyDef {
  code: string;
  numeric?: string;
  name: string;
  symbol: string;
  /** Operational decimal places used for minor units in this system. */
  decimals: number;
  /** ISO 4217 minor unit as published (null = "N.A."). */
  isoMinor: number | null;
  countries: string[];
  kind: CurrencyKind;
  status: CurrencyStatus;
  position: 'prefix' | 'suffix';
  /** Default demo rate: units of this currency per 1 USD. null = no rate. */
  defaultPerUSD: number | null;
  region: Region;
  note?: string;
  replacedBy?: string;
  withdrawnYear?: number;
}
