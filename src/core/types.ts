/**
 * Ledgerhall domain model — the Exchequer of Aldermoor.
 * All monetary amounts are integers in MINOR units of their currency
 * (decimal places come from the Currency Registry).
 * All data is fictional demo data.
 */

export type ISODate = string;

/* ───────────────────────── People & access ───────────────────────── */

export type Role = 'client' | 'teller' | 'manager' | 'accountant' | 'compliance' | 'auditor' | 'admin';
export type UserKind = 'client' | 'staff';
export type Lang = 'en' | 'ru' | 'hy';
export type ThemeId = 'ministry' | 'classic' | 'night' | 'modern';

export type NotificationCategory =
  | 'payments' | 'security' | 'documents' | 'cards' | 'accounts' | 'loans' | 'deposits' | 'system';
export type NotificationChannel = 'inapp' | 'email' | 'sms' | 'push';

export interface UserPreferences {
  language: Lang;
  theme: ThemeId;
  baseCurrency: string;
  sound: boolean;
  channels: Record<NotificationChannel, boolean>;
  categories: Record<NotificationCategory, boolean>;
}

export interface Address {
  line1: string;
  city: string;
  province: string;
  postal: string;
  realm: string;
}

export type UserStatus = 'active' | 'frozen' | 'suspended' | 'closed';
export type KycStatus = 'not_started' | 'pending' | 'verified' | 'rejected' | 'expired';

export interface User {
  id: string;
  clientId: string;
  kind: UserKind;
  roles: Role[];
  name: string;
  honorific?: string;
  email: string;
  phone: string;
  address: Address;
  dob?: string;
  registeredAt: ISODate;
  status: UserStatus;
  passwordHash: string;
  salt: string;
  pinHash?: string;
  twoFactor: { enabled: boolean; secret?: string };
  preferences: UserPreferences;
  kycStatus: KycStatus;
  segment: 'retail' | 'premium' | 'business' | 'minor' | 'staff';
  dailyLimitUSD: number; // minor units of USD
  usualRealms: string[];
  occupation?: string;
  employeeId?: string;
  branchId?: string;
  avatarHue: number;
  familyId?: string;
  failedLogins: number;
  lastLoginAt?: ISODate;
  onboarded: boolean;
}

export interface Device {
  id: string;
  userId: string;
  label: string;
  platform: string;
  fingerprint: string;
  firstSeen: ISODate;
  lastSeen: ISODate;
  trusted: 0 | 1;
}

export interface SessionRecord {
  id: string;
  userId: string;
  deviceId: string;
  deviceLabel: string;
  startedAt: ISODate;
  lastActive: ISODate;
  active: 0 | 1;
  ip: string;
  location: string;
}

export interface LoginRecord {
  id: string;
  userId: string;
  at: ISODate;
  result: 'success' | 'failure' | 'locked' | 'second_factor' | 'logout';
  deviceId: string;
  ip: string;
  method: 'password' | 'onboarding' | 'switch' | 'second_factor';
}

/* ───────────────────────── Accounts & ledger ───────────────────────── */

export type AccountType =
  | 'current' | 'savings' | 'deposit' | 'business' | 'joint' | 'reserve' | 'escrow' | 'vault' | 'temporary'
  | 'credit' | 'loan' | 'internal';

export type AccountStatus = 'active' | 'frozen' | 'closed' | 'pending';

export interface Account {
  id: string;
  number: string;
  name: string;
  type: AccountType;
  ownerId: string; // user id, or 'BANK' for internal accounts
  coOwnerIds: string[];
  trustedIds: string[];
  partyIds: string[];
  currency: string; // primary currency
  pockets: string[]; // all currencies held (multi-currency)
  multiCurrency: boolean;
  status: AccountStatus;
  createdAt: ISODate;
  closedAt?: ISODate;
  branchId: string;
  dailyLimit?: number; // minor units of primary currency
  overdraftLimit: number; // minor units, credit limit for credit accounts
  interestRate?: number; // % p.a. (savings / reserve)
  normal: 'credit' | 'debit';
  glCode?: string;
  companyId?: string;
  familyId?: string;
  purpose?: string;
  expiresAt?: ISODate;
  escrow?: { beneficiaryId?: string; beneficiaryName: string; condition: string; released: boolean };
  frozenReason?: string;
  hidden?: boolean; // internal / loan accounts not listed with everyday accounts
}

export interface BalanceRow {
  accountId: string;
  currency: string;
  balance: number; // credit-normal: Σcredit − Σdebit
  entries: number;
  updatedAt: ISODate;
}

export type HoldReason = 'card_auth' | 'cardless' | 'approval' | 'check' | 'escrow' | 'order';

export interface Hold {
  id: string;
  accountId: string;
  currency: string;
  amount: number;
  reason: HoldReason;
  txId?: string;
  status: 'active' | 'released' | 'captured';
  description: string;
  createdAt: ISODate;
  expiresAt?: ISODate;
}

export interface LedgerEntry {
  id: string;
  journalId: string;
  txId: string;
  accountId: string;
  currency: string;
  side: 'D' | 'C';
  amount: number;
  at: ISODate;
  ref: string;
  memo: string;
}

export interface Journal {
  id: string;
  txId: string;
  ref: string;
  at: ISODate;
  memo: string;
  lineCount: number;
  hash: string;
}

/* ───────────────────────── Transactions ───────────────────────── */

export type TxType =
  | 'transfer' | 'own_transfer' | 'international' | 'fx' | 'card_payment' | 'atm_withdrawal' | 'atm_deposit'
  | 'cash_deposit' | 'cash_withdrawal' | 'check' | 'invoice' | 'loan_disbursement' | 'loan_repayment'
  | 'deposit_open' | 'deposit_topup' | 'deposit_interest' | 'deposit_payout' | 'fee' | 'payroll' | 'recurring'
  | 'subscription' | 'refund' | 'request' | 'qr' | 'link' | 'investment' | 'dividend' | 'tax' | 'insurance'
  | 'opening' | 'reversal' | 'interest' | 'bulk' | 'vault' | 'escrow' | 'adjustment' | 'cash_transfer' | 'claim';

export type TxStatus =
  | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'rejected' | 'expired' | 'reversed';

export type TimelineKey =
  | 'created' | 'validated' | 'screened' | 'review' | 'processing' | 'approved' | 'authorized' | 'settled' | 'completed'
  | 'failed' | 'rejected' | 'cancelled' | 'expired' | 'reversed'
  | 'submitted' | 'compliance_review' | 'intermediary_bank' | 'receiving_bank'
  | 'manager_approval' | 'accountant_review' | 'bank_processing' | 'scheduled' | 'held' | 'released';

export interface TimelineStep {
  step: TimelineKey;
  at: ISODate;
  ok: boolean;
  note?: string;
  actor?: string;
}

export type BudgetCategory =
  | 'income' | 'salary' | 'transfers' | 'groceries' | 'dining' | 'travel' | 'housing' | 'utilities' | 'apothecary'
  | 'education' | 'entertainment' | 'shopping' | 'subscriptions' | 'bills' | 'fees' | 'taxes' | 'insurance'
  | 'investments' | 'savings' | 'loans' | 'cash' | 'business' | 'charity' | 'other';

export type Channel = 'app' | 'atm' | 'branch' | 'card' | 'network' | 'system' | 'qr' | 'link' | 'scheduler';

export interface PartyInfo {
  name: string;
  accountNumber?: string;
  bank?: string;
  bankCode?: string;
  clientId?: string;
  realm?: string;
}

export interface FxInfo {
  id: string;
  midRate: number;
  bankRate: number;
  spreadPct: number;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  targetAmount: number;
}

export interface RiskInfo {
  score: number;
  reasons: string[];
  action: 'allow' | 'review' | 'block';
  eventId?: string;
}

export interface Transaction {
  id: string;
  ref: string;
  type: TxType;
  status: TxStatus;
  stage?: TimelineKey;
  createdAt: ISODate;
  updatedAt: ISODate;
  completedAt?: ISODate;
  initiatorId: string;
  partyIds: string[];
  fromAccountId?: string;
  toAccountId?: string;
  sender: PartyInfo;
  recipient: PartyInfo;
  amount: number;
  currency: string;
  creditAmount?: number;
  creditCurrency?: string;
  fee: number;
  feeCurrency: string;
  fx?: FxInfo;
  description: string;
  purpose?: string;
  userRef?: string;
  channel: Channel;
  category: BudgetCategory;
  merchant?: { name: string; mcc: string; realm: string };
  cardId?: string;
  batchId?: string;
  parentId?: string;
  relatedTxIds: string[];
  timeline: TimelineStep[];
  error?: { code: string; params?: Record<string, string | number> };
  risk?: RiskInfo;
  documentIds: string[];
  journalIds: string[];
  holdId?: string;
  realm?: string;
  deviceId?: string;
  intl?: IntlInfo;
  meta?: Record<string, unknown>;
}

export interface IntlInfo {
  bankName: string;
  bankCode: string;
  realm: string;
  recipientAccount: string;
  estimatedHours: number;
  correspondent: string;
  stageTimes: Partial<Record<TimelineKey, ISODate>>;
  nextStageAt?: ISODate;
}

export interface TransferTemplate {
  id: string;
  ownerId: string;
  name: string;
  fromAccountId: string;
  currency: string;
  amount?: number;
  recipientAccount: string;
  recipientName: string;
  description: string;
  createdAt: ISODate;
  uses: number;
}

export interface ScheduledTransfer {
  id: string;
  ownerId: string;
  fromAccountId: string;
  currency: string;
  amount: number;
  recipientAccount: string;
  recipientName: string;
  description: string;
  runAt: ISODate;
  status: 'scheduled' | 'executed' | 'failed' | 'cancelled';
  txId?: string;
  createdAt: ISODate;
  error?: string;
}

export interface MoneyRequest {
  id: string;
  number: string;
  requesterId: string;
  requesterName: string;
  toAccountId: string;
  payerId?: string;
  payerName: string;
  amount: number;
  currency: string;
  note: string;
  status: 'pending' | 'paid' | 'declined' | 'cancelled' | 'expired';
  createdAt: ISODate;
  paidAt?: ISODate;
  txId?: string;
}

export interface PaymentLink {
  id: string;
  code: string;
  ownerId: string;
  ownerName: string;
  accountId: string;
  amount?: number;
  currency: string;
  description: string;
  status: 'active' | 'paid' | 'expired' | 'cancelled';
  multiUse: boolean;
  createdAt: ISODate;
  expiresAt: ISODate;
  payments: { at: ISODate; txId: string; payerName: string; amount: number }[];
  invoiceId?: string;
}

export interface CardlessCode {
  id: string;
  code: string;
  ownerId: string;
  accountId: string;
  currency: string;
  amount: number;
  holdId: string;
  status: 'active' | 'used' | 'expired' | 'cancelled';
  createdAt: ISODate;
  expiresAt: ISODate;
  txId?: string;
}

/* ───────────────────────── Cards ───────────────────────── */

export type CardType = 'debit' | 'credit' | 'virtual' | 'business' | 'premium' | 'vault';
export type CardStatus = 'active' | 'frozen' | 'blocked' | 'expired' | 'replaced' | 'pending';

export interface CardControls {
  online: boolean;
  contactless: boolean;
  atm: boolean;
  international: boolean;
  magstripe: boolean;
}

export interface Card {
  id: string;
  type: CardType;
  number: string;
  last4: string;
  holderName: string;
  ownerId: string;
  accountId: string;
  currency: string;
  expMonth: number;
  expYear: number;
  cvv: string;
  pinHash: string;
  pinSalt: string;
  pinAttempts: number;
  status: CardStatus;
  limits: { daily: number; perTx: number; atmDaily: number };
  controls: CardControls;
  wallet: { added: boolean; token?: string; device?: string; addedAt?: ISODate };
  createdAt: ISODate;
  replacesId?: string;
  replacedById?: string;
  companyId?: string;
  design: 'emerald' | 'burgundy' | 'obsidian' | 'brass' | 'ivory' | 'midnight';
  network: 'SIGIL';
}

/* ───────────────────────── Documents ───────────────────────── */

export type DocType =
  | 'statement' | 'receipt' | 'invoice' | 'check' | 'contract' | 'certificate' | 'application' | 'payment_order'
  | 'deposit_certificate' | 'loan_agreement' | 'notice' | 'authorization' | 'memo' | 'archive_record' | 'policy'
  | 'tax' | 'letter';

export type DocStatus = 'draft' | 'issued' | 'signed' | 'cancelled' | 'expired' | 'archived';
export type Classification = 'public' | 'internal' | 'confidential' | 'sealed';

export type DocElementKind = 'text' | 'signature' | 'seal' | 'qr' | 'barcode' | 'date' | 'docnumber';

export interface DocElement {
  id: string;
  kind: DocElementKind;
  x: number; // % of page width
  y: number; // % of page height
  w: number; // % of page width
  rotation: number;
  opacity: number;
  z: number;
  props: Record<string, string | number | boolean>;
}

export type SignatureKind = 'electronic' | 'handwritten' | 'official';

export interface DocSignature {
  id: string;
  kind: SignatureKind;
  signerId: string;
  signerName: string;
  signerRole?: string;
  at: ISODate;
  contentHash: string;
  signature?: string;
  publicKey?: JsonWebKey;
  strokes?: string;
}

export interface BankDocument {
  id: string;
  number: string;
  type: DocType;
  title: string;
  version: number;
  status: DocStatus;
  createdAt: ISODate;
  updatedAt: ISODate;
  authorId: string;
  authorName: string;
  ownerId: string;
  partyIds: string[];
  classification: Classification;
  department: string;
  registryNo: string;
  caseNo?: string;
  archiveCode: string;
  verificationCode: string;
  data: Record<string, unknown>;
  body: string[];
  elements: DocElement[];
  signatures: DocSignature[];
  links: { txIds: string[]; accountIds: string[]; docIds: string[] };
  expiresAt?: ISODate;
  notes: { at: ISODate; author: string; text: string }[];
}

export interface DocVersion {
  id: string;
  docId: string;
  version: number;
  at: ISODate;
  authorId: string;
  authorName: string;
  note: string;
  snapshot: Omit<BankDocument, 'id'>;
}

/* ───────────────────────── Checks ───────────────────────── */

export type CheckStatus =
  | 'draft' | 'issued' | 'presented' | 'processing' | 'paid' | 'cancelled' | 'rejected' | 'expired';

export interface Check {
  id: string;
  number: string;
  kind: 'personal' | 'cashier';
  issuerId: string;
  issuerName: string;
  accountId: string;
  payeeName: string;
  payeeId?: string;
  amount: number;
  currency: string;
  date: ISODate;
  purpose: string;
  status: CheckStatus;
  signature?: DocSignature;
  seals: string[];
  verificationCode: string;
  documentId?: string;
  createdAt: ISODate;
  issuedAt?: ISODate;
  presentedAt?: ISODate;
  paidAt?: ISODate;
  expiresAt: ISODate;
  depositAccountId?: string;
  txId?: string;
  holdId?: string;
  rejectReason?: string;
  timeline: TimelineStep[];
}

/* ───────────────────────── Deposits, loans, investments ───────────────────────── */

export type DepositProduct = 'fixed' | 'growth' | 'flex';
export type DepositStatus = 'active' | 'matured' | 'closed' | 'closed_early';

export interface Deposit {
  id: string;
  number: string;
  ownerId: string;
  accountId: string;
  payoutAccountId: string;
  product: DepositProduct;
  currency: string;
  principal: number;
  rate: number;
  termMonths: number;
  openedAt: ISODate;
  maturityDate: ISODate;
  status: DepositStatus;
  accrued: number; // minor units, fractional accrual carried in accruedFraction
  accruedFraction: number;
  interestPaid: number;
  lastAccrualDate: string; // yyyy-mm-dd
  topUpAllowed: boolean;
  earlyPenaltyPct: number;
  certificateId?: string;
  autoRenew: boolean;
  closedAt?: ISODate;
  payoutTxId?: string;
}

export type LoanType = 'personal' | 'business' | 'mortgage' | 'emergency' | 'credit_line';
export type LoanStatus =
  | 'applied' | 'under_review' | 'approved' | 'rejected' | 'active' | 'closed' | 'overdue' | 'defaulted';

export interface LoanInstallment {
  n: number;
  dueDate: string;
  principal: number;
  interest: number;
  total: number;
  paid: number;
  status: 'upcoming' | 'due' | 'paid' | 'overdue' | 'partial';
  paidAt?: ISODate;
}

export interface Loan {
  id: string;
  number: string;
  ownerId: string;
  type: LoanType;
  currency: string;
  amount: number;
  rate: number;
  termMonths: number;
  payment: number;
  status: LoanStatus;
  purpose: string;
  appliedAt: ISODate;
  decidedAt?: ISODate;
  disbursedAt?: ISODate;
  closedAt?: ISODate;
  schedule: LoanInstallment[];
  outstanding: number;
  loanAccountId?: string;
  payoutAccountId: string;
  agreementDocId?: string;
  decision?: { score: number; reasons: string[]; by: string };
  creditLimit?: number;
  latePayments: number;
  repayments: { at: ISODate; amount: number; principal: number; interest: number; txId: string; early?: boolean }[];
  collateral?: string;
  monthlyIncome: number;
}

export type InstrumentKind = 'stock' | 'bond' | 'fund' | 'metal' | 'currency' | 'magical';

export interface Instrument {
  id: string;
  name: string;
  kind: InstrumentKind;
  currency: string;
  basePrice: number;
  volatility: number;
  drift: number;
  dividendYield: number;
  exchange: string;
  sector: string;
}

export interface Holding {
  id: string;
  ownerId: string;
  instrumentId: string;
  quantity: number;
  avgCost: number; // price per unit, decimal in instrument currency
  realized: number; // decimal
  dividends: number; // decimal
}

export interface InvestmentOrder {
  id: string;
  number: string;
  ownerId: string;
  instrumentId: string;
  side: 'buy' | 'sell';
  kind: 'market' | 'limit';
  quantity: number;
  limitPrice?: number;
  status: 'open' | 'filled' | 'cancelled' | 'rejected';
  accountId: string;
  createdAt: ISODate;
  filledAt?: ISODate;
  fillPrice?: number;
  txId?: string;
  reason?: string;
}

/* ───────────────────────── Payments in time ───────────────────────── */

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringPayment {
  id: string;
  ownerId: string;
  fromAccountId: string;
  currency: string;
  amount: number;
  recipientAccount: string;
  recipientName: string;
  frequency: Frequency;
  startDate: string;
  endDate?: string;
  nextRun: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  description: string;
  category: BudgetCategory;
  runs: { at: ISODate; txId?: string; status: TxStatus; error?: string }[];
  createdAt: ISODate;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  price: number;
  taxRate: number;
  discount: number;
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'cancelled' | 'overdue';

export interface Invoice {
  id: string;
  number: string;
  issuerId: string;
  issuerName: string;
  issuerAccountId: string;
  recipientId?: string;
  recipientName: string;
  recipientEmail?: string;
  items: InvoiceItem[];
  currency: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  dueDate: string;
  createdAt: ISODate;
  sentAt?: ISODate;
  paidAt?: ISODate;
  status: InvoiceStatus;
  notes: string;
  linkCode?: string;
  documentId?: string;
  txId?: string;
  companyId?: string;
  partyIds: string[];
}

export interface Subscription {
  id: string;
  ownerId: string;
  service: string;
  plan: string;
  amount: number;
  currency: string;
  accountId: string;
  cardId?: string;
  period: 'weekly' | 'monthly' | 'yearly';
  nextCharge: string;
  status: 'active' | 'paused' | 'cancelled';
  startedAt: ISODate;
  category: BudgetCategory;
  charges: { at: ISODate; txId?: string; status: TxStatus }[];
  hue: number;
}

export interface Budget {
  id: string;
  ownerId: string;
  category: BudgetCategory;
  monthlyLimit: number;
  currency: string;
}

/* ───────────────────────── Households & business ───────────────────────── */

export interface FamilyMember {
  userId: string;
  name: string;
  relation: string;
  role: 'owner' | 'adult' | 'child';
  dailyLimit: number;
  currency: string;
  permissions: { transfers: boolean; cardPayments: boolean; atm: boolean; international: boolean; online: boolean };
  accountId?: string;
  addedAt: ISODate;
}

export interface Family {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  members: FamilyMember[];
  createdAt: ISODate;
}

export type BizRole = 'owner' | 'manager' | 'accountant' | 'employee' | 'auditor';

export interface Company {
  id: string;
  name: string;
  registryNo: string;
  taxId: string;
  sector: string;
  ownerId: string;
  memberIds: string[];
  members: { userId: string; name: string; role: BizRole; addedAt: ISODate }[];
  accountIds: string[];
  createdAt: ISODate;
}

export interface CompanyEmployee {
  id: string;
  companyId: string;
  employeeNo: string;
  name: string;
  position: string;
  salary: number;
  currency: string;
  paymentDay: number;
  accountNumber: string;
  status: 'active' | 'terminated';
  hiredAt: ISODate;
}

export type ApprovalStage = 'created' | 'manager' | 'accountant' | 'bank' | 'completed';
export type ApprovalStatus =
  | 'pending_manager' | 'pending_accountant' | 'processing' | 'completed' | 'rejected' | 'cancelled' | 'failed';

export interface Approval {
  id: string;
  number: string;
  companyId: string;
  kind: 'payment' | 'payroll';
  createdBy: string;
  createdByName: string;
  createdAt: ISODate;
  status: ApprovalStatus;
  amount: number;
  currency: string;
  description: string;
  fromAccountId: string;
  recipientAccount?: string;
  recipientName?: string;
  payrollRunId?: string;
  steps: { stage: ApprovalStage; at: ISODate; by?: string; byName?: string; decision?: 'approved' | 'rejected'; note?: string }[];
  txId?: string;
  holdId?: string;
}

export interface PayrollRun {
  id: string;
  number: string;
  companyId: string;
  period: string;
  createdAt: ISODate;
  status: 'pending_approval' | 'processing' | 'completed' | 'failed' | 'rejected';
  fromAccountId: string;
  lines: { employeeId: string; name: string; amount: number; currency: string; accountNumber: string; txId?: string; status: TxStatus | 'queued' }[];
  total: number;
  currency: string;
  batchId?: string;
  approvalId?: string;
}

/* ───────────────────────── Government-side services ───────────────────────── */

export interface TaxRecord {
  id: string;
  number: string;
  ownerId: string;
  year: number;
  kind: 'withholding' | 'declaration' | 'payment' | 'property' | 'business';
  amount: number;
  currency: string;
  status: 'due' | 'paid' | 'filed' | 'assessed';
  dueDate: string;
  paidAt?: ISODate;
  txId?: string;
  documentId?: string;
  description: string;
}

export type InsuranceProduct = 'home' | 'travel' | 'device' | 'business' | 'life';

export interface InsurancePolicy {
  id: string;
  number: string;
  ownerId: string;
  product: InsuranceProduct;
  insured: string;
  coverage: number;
  premium: number;
  currency: string;
  period: 'monthly' | 'yearly';
  startDate: string;
  endDate: string;
  nextPremium: string;
  status: 'active' | 'pending' | 'expired' | 'cancelled' | 'lapsed';
  accountId: string;
  documentId?: string;
  createdAt: ISODate;
}

export interface InsuranceClaim {
  id: string;
  number: string;
  policyId: string;
  ownerId: string;
  description: string;
  amount: number;
  currency: string;
  status: 'submitted' | 'under_review' | 'approved' | 'denied' | 'paid';
  createdAt: ISODate;
  timeline: TimelineStep[];
  payoutTxId?: string;
}

export type DisputeReason =
  | 'unknown_transaction' | 'wrong_amount' | 'duplicate_payment' | 'card_issue' | 'merchant_dispute' | 'transfer_problem';
export type DisputeStatus = 'opened' | 'under_review' | 'evidence_required' | 'resolved' | 'rejected' | 'refunded';

export interface Dispute {
  id: string;
  number: string;
  ownerId: string;
  txId: string;
  reason: DisputeReason;
  description: string;
  amount: number;
  currency: string;
  status: DisputeStatus;
  createdAt: ISODate;
  updatedAt: ISODate;
  timeline: { status: DisputeStatus; at: ISODate; by: string; note?: string }[];
  evidence: { at: ISODate; by: string; text: string }[];
  refundTxId?: string;
}

export interface FraudEvent {
  id: string;
  txId?: string;
  userId: string;
  userName: string;
  createdAt: ISODate;
  score: number;
  reasons: string[];
  action: 'allow' | 'review' | 'block';
  status: 'open' | 'cleared' | 'confirmed' | 'auto';
  reviewedBy?: string;
  reviewedAt?: ISODate;
  amount: number;
  currency: string;
  realm?: string;
  deviceId?: string;
}

export type KycDocType = 'passport' | 'national_id' | 'address_proof' | 'business_doc';

export interface KycRecord {
  id: string;
  userId: string;
  docType: KycDocType;
  docNumber: string;
  issuedBy: string;
  issueDate: string;
  expiryDate: string;
  status: KycStatus;
  submittedAt: ISODate;
  reviewedAt?: ISODate;
  reviewedBy?: string;
  reason?: string;
  fileName?: string;
  fileData?: string;
}

/* ───────────────────────── Communications ───────────────────────── */

export interface AppNotification {
  id: string;
  userId: string;
  category: NotificationCategory;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
  createdAt: ISODate;
  read: 0 | 1;
  link?: string;
  channels: NotificationChannel[];
  priority: 'low' | 'normal' | 'high';
}

export interface OutboxMessage {
  id: string;
  userId: string;
  channel: 'email' | 'sms' | 'push';
  to: string;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
  createdAt: ISODate;
  notificationId: string;
}

export interface MailItem {
  id: string;
  userId: string;
  folder: 'inbox' | 'archive';
  read: 0 | 1;
  createdAt: ISODate;
  template: string;
  params: Record<string, string | number>;
  department: string;
  caseNo: string;
  attachmentDocId?: string;
  savedDocId?: string;
}

export type TicketTopic = 'payments' | 'cards' | 'accounts' | 'documents' | 'technical';

export interface Ticket {
  id: string;
  number: string;
  userId: string;
  userName: string;
  topic: TicketTopic;
  subject: string;
  status: 'open' | 'answered' | 'awaiting_client' | 'closed';
  createdAt: ISODate;
  updatedAt: ISODate;
  unreadClient: 0 | 1;
  unreadBank: 0 | 1;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  at: ISODate;
  from: 'client' | 'bank' | 'system';
  authorName: string;
  text: string;
  textKey?: string;
  params?: Record<string, string | number>;
}

/* ───────────────────────── Institution ───────────────────────── */

export interface Branch {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
  hours: string;
  weekendHours: string;
  services: string[];
  status: 'open' | 'closed' | 'maintenance' | 'limited';
  map: { x: number; y: number };
  phone: string;
  managerName: string;
  cashAccountId: string;
  opened: string;
}

export interface Atm {
  id: string;
  code: string;
  branchId: string;
  name: string;
  status: 'online' | 'offline' | 'maintenance' | 'low_cash';
  currencies: string[];
  cashAccountId: string;
}

export type DeptCode =
  | 'TRS' | 'CMP' | 'PAY' | 'FXB' | 'VLT' | 'ARC' | 'SEC' | 'AUD' | 'INT' | 'LND' | 'DEP' | 'CPL' | 'CSV' | 'ADM';

export interface Employee {
  id: string;
  employeeId: string;
  name: string;
  department: DeptCode;
  position: string;
  status: 'active' | 'on_leave' | 'suspended' | 'retired';
  permissions: string[];
  branchId: string;
  userId?: string;
  email: string;
  since: string;
  grade: string;
}

export interface ArchiveRecord {
  id: string;
  code: string;
  kind: 'case' | 'document' | 'transaction' | 'application' | 'contract' | 'correspondence' | 'closed_account';
  title: string;
  summary: string;
  createdAt: ISODate;
  ownerId?: string;
  department: DeptCode;
  classification: Classification;
  refs: { docId?: string; txId?: string; accountId?: string; loanId?: string };
  tags: string[];
  shelf: string;
  status: 'filed' | 'sealed' | 'retrieved';
}

export interface Vault {
  id: string;
  number: string;
  ownerId: string;
  ownerName: string;
  level: 1 | 2 | 3 | 4 | 5;
  size: 'S' | 'M' | 'L' | 'XL';
  branchId: string;
  status: 'sealed' | 'open' | 'locked' | 'audit';
  contents: { id: string; item: string; description: string; value?: number; currency?: string; addedAt: ISODate }[];
  rentFee: number;
  rentCurrency: string;
  accountId?: string;
  combinationHash: string;
  combinationSalt: string;
  failedAttempts: number;
  createdAt: ISODate;
  wards: string[];
}

export interface VaultAccess {
  id: string;
  vaultId: string;
  at: ISODate;
  userId: string;
  userName: string;
  action: 'open' | 'close' | 'deposit_item' | 'withdraw_item' | 'failed_attempt' | 'audit' | 'lock' | 'unlock' | 'rent';
  result: 'success' | 'failure';
  note?: string;
}

/* ───────────────────────── Audit & system ───────────────────────── */

export interface AuditRecord {
  seq?: number;
  id: string;
  at: ISODate;
  userId: string;
  userName: string;
  role: string;
  action: string;
  object: string;
  objectId: string;
  result: 'success' | 'failure' | 'denied';
  txId?: string;
  device: string;
  ip: string;
  details?: string;
  prevHash: string;
  hash: string;
}

export interface SysLog {
  seq?: number;
  at: ISODate;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

export type ServiceId =
  | 'payments' | 'transfers' | 'exchange' | 'cards' | 'atm' | 'documents' | 'notifications' | 'authentication';
export type ServiceState = 'operational' | 'degraded' | 'maintenance' | 'offline';

export interface ServiceStatus {
  service: ServiceId;
  status: ServiceState;
  message: string;
  updatedAt: ISODate;
  history: { at: ISODate; status: ServiceState }[];
}

export interface RateRecord {
  code: string;
  perUSD: number;
  updatedAt: ISODate;
  source: 'demo' | 'manual' | 'live';
}

export interface CurrencyOverride {
  code: string;
  enabled: boolean;
  custom?: import('./currency/types').CurrencyDef;
}

export interface BackupRecord {
  id: string;
  createdAt: ISODate;
  label: string;
  size: number;
  checksum: string;
  payload: string;
}

export interface KeyRecord {
  ownerId: string;
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
  createdAt: ISODate;
}

export interface Counter {
  name: string;
  value: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}
