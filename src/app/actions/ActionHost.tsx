/** Renders the active quick action as a dialog. */
import { useUI } from '@/state/ui';
import { useT } from '@/hooks/useT';
import { Modal } from '@/ui/Modal';
import { TransferDialog } from './TransferDialog';
import { ExchangeForm } from './ExchangeDialog';
import { ScanDialog } from './ScanDialog';
import { ReceiveDialog, RequestDialog, WithdrawDialog, PayDialog, CheckDialog, OpenAccountDialog, DepositDialog, DocumentDialog } from './dialogs';

export function ActionHost() {
  const { t } = useT();
  const action = useUI((s) => s.action);
  const close = useUI((s) => s.closeAction);
  if (!action) return null;
  const key = action.name + JSON.stringify(action.params ?? {});
  switch (action.name) {
    case 'transfer':
      return <TransferDialog key={key} onClose={close} params={action.params} />;
    case 'exchange':
      return <Modal key={key} open onClose={close} title={t('exchange.title')} eyebrow={t('dept.FXB')} size="wide"><ExchangeForm onDone={close} initialTo={action.params?.to} /></Modal>;
    case 'receive':
      return <ReceiveDialog key={key} onClose={close} />;
    case 'request':
      return <RequestDialog key={key} onClose={close} />;
    case 'withdraw':
      return <WithdrawDialog key={key} onClose={close} />;
    case 'pay':
      return <PayDialog key={key} onClose={close} params={action.params} />;
    case 'check':
      return <CheckDialog key={key} onClose={close} />;
    case 'openAccount':
      return <OpenAccountDialog key={key} onClose={close} />;
    case 'deposit':
      return <DepositDialog key={key} onClose={close} />;
    case 'scan':
      return <ScanDialog key={key} onClose={close} />;
    case 'document':
      return <DocumentDialog key={key} onClose={close} params={action.params} />;
    default:
      return null;
  }
}
