/** Aetherline payment network hub: overview, requests, scheduled, payment links, templates, bulk payments, cardless cash. */
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, HandCoins, ScanLine, Activity, Inbox, CalendarClock, Link2, BookMarked, Layers, Banknote } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { useLive, useMe } from '@/hooks/data';
import { useUI } from '@/state/ui';
import { db } from '@/core/db/db';
import { Button, PageHead, Tabs } from '@/ui/primitives';
import { NetworkHero, QuickTransfer, RecentNetworkPayments } from './NetworkOverview';
import { RequestsTab } from './RequestsTab';
import { ScheduledTab } from './ScheduledTab';
import { LinksTab } from './LinksTab';
import { TemplatesTab } from './TemplatesTab';
import { BulkTab } from './BulkTab';
import { CashTab } from './CashTab';

const TABS = ['overview', 'requests', 'scheduled', 'links', 'templates', 'bulk', 'cash'] as const;
type Tab = (typeof TABS)[number];

export default function PaymentsPage() {
  const { t } = useT();
  const me = useMe();
  const openAction = useUI((s) => s.openAction);
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'overview';
  const created = sp.get('created');
  const setTab = (v: Tab) => {
    const n = new URLSearchParams(sp);
    if (v === 'overview') n.delete('tab');
    else n.set('tab', v);
    n.delete('created');
    setSp(n, { replace: true });
  };
  const counts = useLive(async () => {
    if (!me) return { requests: 0, scheduled: 0, links: 0, templates: 0, cash: 0 };
    const [requests, scheduled, links, templates, cash] = await Promise.all([
      db.requests.where('payerId').equals(me.id).filter((r) => r.status === 'pending').count(),
      db.scheduled.where('ownerId').equals(me.id).filter((s) => s.status === 'scheduled').count(),
      db.links.where('ownerId').equals(me.id).filter((l) => l.status === 'active').count(),
      db.templates.where('ownerId').equals(me.id).count(),
      db.cardless.where('ownerId').equals(me.id).filter((c) => c.status === 'active').count(),
    ]);
    return { requests, scheduled, links, templates, cash };
  }, [me?.id], { requests: 0, scheduled: 0, links: 0, templates: 0, cash: 0 });

  return (
    <div className="page pay-page">
      <PageHead
        eyebrow={t('dept.PAY')}
        title={t('payments.title')}
        sub={t('payments.sub')}
        actions={<>
          <Button icon={<ScanLine />} onClick={() => openAction('scan')}>{t('payments.scanQr')}</Button>
          <Button icon={<HandCoins />} onClick={() => openAction('request')}>{t('payments.requestMoney')}</Button>
          <Button variant="primary" icon={<ArrowLeftRight />} onClick={() => openAction('transfer')}>{t('payments.newTransfer')}</Button>
        </>}
      />
      <NetworkHero />
      <div className="pay-tabs">
        <Tabs label={t('payments.title')} value={tab} onChange={setTab} tabs={[
          { value: 'overview', label: t('payments.tabs.overview'), icon: <Activity size={14} aria-hidden /> },
          { value: 'requests', label: t('payments.tabs.requests'), icon: <Inbox size={14} aria-hidden />, count: counts.requests || undefined },
          { value: 'scheduled', label: t('payments.tabs.scheduled'), icon: <CalendarClock size={14} aria-hidden />, count: counts.scheduled || undefined },
          { value: 'links', label: t('payments.tabs.links'), icon: <Link2 size={14} aria-hidden />, count: counts.links || undefined },
          { value: 'templates', label: t('payments.tabs.templates'), icon: <BookMarked size={14} aria-hidden />, count: counts.templates || undefined },
          { value: 'bulk', label: t('payments.tabs.bulk'), icon: <Layers size={14} aria-hidden /> },
          { value: 'cash', label: t('payments.tabs.cash'), icon: <Banknote size={14} aria-hidden />, count: counts.cash || undefined },
        ]} />
      </div>
      <div role="tabpanel" aria-label={t(`payments.tabs.${tab}`)} className="fade-up" key={tab}>
        {tab === 'overview' && (
          <div className="grid cols-main" style={{ alignItems: 'start' }}>
            <RecentNetworkPayments />
            <QuickTransfer />
          </div>
        )}
        {tab === 'requests' && <RequestsTab />}
        {tab === 'scheduled' && <ScheduledTab />}
        {tab === 'links' && <LinksTab created={created} onCreated={(code) => { const n = new URLSearchParams(sp); n.set('tab', 'links'); n.set('created', code); setSp(n, { replace: true }); }} />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'bulk' && <BulkTab />}
        {tab === 'cash' && <CashTab />}
      </div>
    </div>
  );
}
