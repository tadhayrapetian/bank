/** Navigation map of Ledgerhall: every module, its route, icon and required permission. */
import {
  LayoutDashboard, LineChart, CalendarDays, Bell, Mailbox, MessageSquare, Landmark, ArrowLeftRight, Globe, Repeat, Coins, QrCode, CreditCard,
  ScrollText, CalendarClock, ReceiptText, Ticket, PieChart, PiggyBank, HandCoins, History, TrendingUp, Umbrella, Scale, Users, Briefcase,
  FolderOpen, PenTool, Stamp, ShieldCheck, Archive, Vault, Banknote, Building2, Gavel, Fingerprint, Shield, UserCog, Activity, Store, Siren,
  BookOpen, Settings, Wallet, Contact,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { Permission } from '@/core/security/permissions';
import type { TKey } from '@/i18n';

export interface NavItem {
  path: string;
  label: TKey;
  icon: ComponentType<{ size?: number | string }>;
  perm?: Permission;
  badge?: 'notifications' | 'mail' | 'messages' | 'requests' | 'approvals' | 'fraud';
}

export interface NavGroup {
  label: TKey;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'nav.groups.overview',
    items: [
      { path: '/', label: 'nav.dashboard', icon: LayoutDashboard },
      { path: '/analytics', label: 'nav.analytics', icon: LineChart },
      { path: '/calendar', label: 'nav.calendar', icon: CalendarDays },
      { path: '/notifications', label: 'nav.notifications', icon: Bell, badge: 'notifications' },
      { path: '/mailbox', label: 'nav.mailbox', icon: Mailbox, badge: 'mail' },
      { path: '/messages', label: 'nav.messages', icon: MessageSquare, badge: 'messages' },
    ],
  },
  {
    label: 'nav.groups.money',
    items: [
      { path: '/accounts', label: 'nav.accounts', icon: Landmark },
      { path: '/transactions', label: 'nav.transactions', icon: BookOpen },
      { path: '/payments', label: 'nav.payments', icon: ArrowLeftRight, badge: 'requests' },
      { path: '/international', label: 'nav.international', icon: Globe },
      { path: '/exchange', label: 'nav.exchange', icon: Repeat },
      { path: '/currencies', label: 'nav.currencies', icon: Coins },
      { path: '/qr', label: 'nav.qr', icon: QrCode },
      { path: '/cards', label: 'nav.cards', icon: CreditCard },
      { path: '/checks', label: 'nav.checks', icon: ScrollText },
      { path: '/recurring', label: 'nav.recurring', icon: CalendarClock },
      { path: '/invoices', label: 'nav.invoices', icon: ReceiptText },
      { path: '/subscriptions', label: 'nav.subscriptions', icon: Ticket },
      { path: '/budget', label: 'nav.budget', icon: PieChart },
    ],
  },
  {
    label: 'nav.groups.growth',
    items: [
      { path: '/deposits', label: 'nav.deposits', icon: PiggyBank },
      { path: '/loans', label: 'nav.loans', icon: HandCoins },
      { path: '/credit', label: 'nav.credit', icon: History },
      { path: '/investments', label: 'nav.investments', icon: TrendingUp },
      { path: '/insurance', label: 'nav.insurance', icon: Umbrella },
      { path: '/tax', label: 'nav.tax', icon: Scale },
    ],
  },
  {
    label: 'nav.groups.households',
    items: [
      { path: '/family', label: 'nav.family', icon: Users },
      { path: '/business', label: 'nav.business', icon: Briefcase, badge: 'approvals' },
    ],
  },
  {
    label: 'nav.groups.papers',
    items: [
      { path: '/documents', label: 'nav.documents', icon: FolderOpen },
      { path: '/editor', label: 'nav.editor', icon: PenTool },
      { path: '/seals', label: 'nav.seals', icon: Stamp },
      { path: '/verify', label: 'nav.verify', icon: ShieldCheck },
      { path: '/archive', label: 'nav.archive', icon: Archive },
      { path: '/vaults', label: 'nav.vaults', icon: Vault },
    ],
  },
  {
    label: 'nav.groups.services',
    items: [
      { path: '/atm', label: 'nav.atm', icon: Banknote },
      { path: '/branches', label: 'nav.branches', icon: Building2 },
      { path: '/employees', label: 'nav.employees', icon: UserCog },
      { path: '/disputes', label: 'nav.disputes', icon: Gavel },
      { path: '/kyc', label: 'nav.kyc', icon: Fingerprint },
      { path: '/security', label: 'nav.security', icon: Shield },
      { path: '/profile', label: 'nav.profile', icon: Contact },
      { path: '/status', label: 'nav.status', icon: Activity },
      { path: '/settings', label: 'nav.settings', icon: Settings },
    ],
  },
  {
    label: 'nav.groups.staff',
    items: [
      { path: '/teller', label: 'nav.teller', icon: Store, perm: 'teller.desk' },
      { path: '/cash', label: 'nav.cash', icon: Wallet, perm: 'cash.manage' },
      { path: '/fraud', label: 'nav.fraud', icon: Siren, perm: 'fraud.review', badge: 'fraud' },
      { path: '/audit', label: 'nav.audit', icon: History, perm: 'audit.view' },
      { path: '/admin', label: 'nav.admin', icon: Gavel, perm: 'admin.panel' },
    ],
  },
];

export const ALL_NAV: NavItem[] = NAV.flatMap((g) => g.items);
