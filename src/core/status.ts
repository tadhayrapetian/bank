/**
 * Status Registry — one normalised vocabulary for every object in the system.
 * Each status has a domain, a tone (for consistent badges), a terminal flag and
 * allowed transitions. UI renders statuses only through this registry.
 */

export type Tone = 'positive' | 'negative' | 'warning' | 'neutral' | 'info' | 'magic';

export interface StatusDef {
  tone: Tone;
  terminal?: boolean;
}

export type StatusDomain =
  | 'tx' | 'account' | 'card' | 'document' | 'check' | 'invoice' | 'loan' | 'installment' | 'deposit' | 'kyc' | 'dispute'
  | 'subscription' | 'recurring' | 'service' | 'fraud' | 'request' | 'link' | 'order' | 'policy' | 'claim' | 'approval'
  | 'payroll' | 'ticket' | 'vault' | 'branch' | 'atm' | 'employee' | 'user' | 'tax' | 'scheduled' | 'archive' | 'hold'
  | 'currency' | 'cardless';

const S = (tone: Tone, terminal = false): StatusDef => ({ tone, terminal });

export const STATUS_REGISTRY: Record<StatusDomain, Record<string, StatusDef>> = {
  tx: {
    pending: S('warning'), processing: S('info'), completed: S('positive', true), failed: S('negative', true),
    cancelled: S('neutral', true), rejected: S('negative', true), expired: S('neutral', true), reversed: S('magic', true),
  },
  account: { active: S('positive'), frozen: S('info'), closed: S('neutral', true), pending: S('warning') },
  card: {
    active: S('positive'), frozen: S('info'), blocked: S('negative'), expired: S('neutral', true),
    replaced: S('neutral', true), pending: S('warning'),
  },
  document: {
    draft: S('neutral'), issued: S('info'), signed: S('positive'), cancelled: S('negative', true),
    expired: S('neutral', true), archived: S('magic'),
  },
  check: {
    draft: S('neutral'), issued: S('info'), presented: S('warning'), processing: S('info'), paid: S('positive', true),
    cancelled: S('neutral', true), rejected: S('negative', true), expired: S('neutral', true),
  },
  invoice: { draft: S('neutral'), sent: S('info'), paid: S('positive', true), cancelled: S('neutral', true), overdue: S('negative') },
  loan: {
    applied: S('warning'), under_review: S('info'), approved: S('positive'), rejected: S('negative', true),
    active: S('positive'), closed: S('neutral', true), overdue: S('negative'), defaulted: S('negative'),
  },
  installment: { upcoming: S('neutral'), due: S('warning'), paid: S('positive', true), overdue: S('negative'), partial: S('info') },
  deposit: { active: S('positive'), matured: S('magic'), closed: S('neutral', true), closed_early: S('warning', true) },
  kyc: { not_started: S('neutral'), pending: S('warning'), verified: S('positive'), rejected: S('negative'), expired: S('neutral') },
  dispute: {
    opened: S('warning'), under_review: S('info'), evidence_required: S('warning'), resolved: S('positive', true),
    rejected: S('negative', true), refunded: S('magic', true),
  },
  subscription: { active: S('positive'), paused: S('warning'), cancelled: S('neutral', true) },
  recurring: { active: S('positive'), paused: S('warning'), completed: S('neutral', true), cancelled: S('neutral', true) },
  service: { operational: S('positive'), degraded: S('warning'), maintenance: S('info'), offline: S('negative') },
  fraud: { allow: S('positive'), review: S('warning'), block: S('negative'), open: S('warning'), cleared: S('positive', true), confirmed: S('negative', true), auto: S('neutral', true) },
  request: { pending: S('warning'), paid: S('positive', true), declined: S('negative', true), cancelled: S('neutral', true), expired: S('neutral', true) },
  link: { active: S('positive'), paid: S('magic', true), expired: S('neutral', true), cancelled: S('neutral', true) },
  order: { open: S('info'), filled: S('positive', true), cancelled: S('neutral', true), rejected: S('negative', true) },
  policy: { active: S('positive'), pending: S('warning'), expired: S('neutral', true), cancelled: S('neutral', true), lapsed: S('negative') },
  claim: { submitted: S('warning'), under_review: S('info'), approved: S('positive'), denied: S('negative', true), paid: S('magic', true) },
  approval: {
    pending_manager: S('warning'), pending_accountant: S('warning'), processing: S('info'), completed: S('positive', true),
    rejected: S('negative', true), cancelled: S('neutral', true), failed: S('negative', true),
  },
  payroll: {
    pending_approval: S('warning'), processing: S('info'), completed: S('positive', true), failed: S('negative', true),
    rejected: S('negative', true),
  },
  ticket: { open: S('warning'), answered: S('positive'), awaiting_client: S('info'), closed: S('neutral', true) },
  vault: { sealed: S('positive'), open: S('magic'), locked: S('negative'), audit: S('warning') },
  branch: { open: S('positive'), closed: S('neutral'), maintenance: S('info'), limited: S('warning') },
  atm: { online: S('positive'), offline: S('negative'), maintenance: S('info'), low_cash: S('warning') },
  employee: { active: S('positive'), on_leave: S('info'), suspended: S('negative'), retired: S('neutral', true) },
  user: { active: S('positive'), frozen: S('info'), suspended: S('negative'), closed: S('neutral', true) },
  tax: { due: S('warning'), paid: S('positive', true), filed: S('info'), assessed: S('neutral') },
  scheduled: { scheduled: S('info'), executed: S('positive', true), failed: S('negative', true), cancelled: S('neutral', true) },
  archive: { filed: S('neutral'), sealed: S('magic'), retrieved: S('info') },
  hold: { active: S('warning'), released: S('neutral', true), captured: S('positive', true) },
  currency: { active: S('positive'), withdrawn: S('neutral'), non_transactional: S('info'), suspended: S('negative') },
  cardless: { active: S('info'), used: S('positive', true), expired: S('neutral', true), cancelled: S('neutral', true) },
};

/** Allowed transitions for lifecycle-driven domains. */
export const TRANSITIONS: Partial<Record<StatusDomain, Record<string, string[]>>> = {
  tx: {
    pending: ['processing', 'cancelled', 'rejected', 'failed', 'expired', 'completed'],
    processing: ['completed', 'failed', 'rejected', 'cancelled', 'pending'],
    completed: ['reversed'],
  },
  check: {
    draft: ['issued', 'cancelled'],
    issued: ['presented', 'cancelled', 'expired'],
    presented: ['processing', 'rejected'],
    processing: ['paid', 'rejected'],
  },
  invoice: { draft: ['sent', 'cancelled'], sent: ['paid', 'cancelled', 'overdue'], overdue: ['paid', 'cancelled'] },
  loan: {
    applied: ['under_review', 'approved', 'rejected'],
    under_review: ['approved', 'rejected'],
    approved: ['active', 'rejected'],
    active: ['closed', 'overdue'],
    overdue: ['active', 'closed', 'defaulted'],
    defaulted: ['closed'],
  },
  dispute: {
    opened: ['under_review', 'rejected'],
    under_review: ['evidence_required', 'resolved', 'rejected', 'refunded'],
    evidence_required: ['under_review', 'rejected'],
    resolved: [],
  },
  account: { active: ['frozen', 'closed'], frozen: ['active', 'closed'], pending: ['active', 'closed'] },
  card: { active: ['frozen', 'blocked', 'expired', 'replaced'], frozen: ['active', 'blocked', 'replaced'], blocked: ['replaced'], pending: ['active'] },
  kyc: { not_started: ['pending'], pending: ['verified', 'rejected'], verified: ['expired', 'pending'], rejected: ['pending'], expired: ['pending'] },
};

export function statusDef(domain: StatusDomain, status: string): StatusDef {
  return STATUS_REGISTRY[domain]?.[status] ?? { tone: 'neutral' };
}

export function canTransition(domain: StatusDomain, from: string, to: string): boolean {
  const t = TRANSITIONS[domain];
  if (!t) return true;
  return (t[from] ?? []).includes(to);
}

export function isTerminal(domain: StatusDomain, status: string) {
  return !!statusDef(domain, status).terminal;
}
