/** Papers filed against this account: statements, certificates, receipts and letters. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ScrollText, FileSignature } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive } from '@/hooks/data';
import { useSession } from '@/state/session';
import { db } from '@/core/db/db';
import { Button, Empty, Pager, Panel, Select, StatusBadge } from '@/ui/primitives';
import type { Account, BankDocument } from '@/core/types';

const PAGE = 12;

export function AccountDocuments({ acc, onStatement, onDocument, canGenerate }: { acc: Account; onStatement: () => void; onDocument: () => void; canGenerate: boolean }) {
  const { t, tx } = useT();
  const f = useFmt();
  const me = useSession((s) => s.user);
  const [type, setType] = useState('');
  const [page, setPage] = useState(0);
  const docs = useLive(async () => {
    const parties = [...new Set([...acc.partyIds, acc.ownerId, me?.id ?? ''])].filter(Boolean);
    const rows = await db.documents.where('partyIds').anyOf(parties).distinct().filter((d) => d.links.accountIds.includes(acc.id)).toArray();
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [acc.id, acc.partyIds.join(), me?.id], [] as BankDocument[]);
  const types = useMemo(() => [...new Set(docs.map((d) => d.type))], [docs]);
  const filtered = type ? docs.filter((d) => d.type === type) : docs;
  const cur = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE) - 1));
  return (
    <Panel title={t('accounts.docs.title')} icon={<FileText />} sub={t('accounts.docs.sub', { n: docs.length })} flush
      actions={canGenerate ? (
        <>
          <Button size="sm" icon={<ScrollText />} onClick={onStatement}>{t('accounts.act.statement')}</Button>
          <Button size="sm" variant="ghost" icon={<FileSignature />} onClick={onDocument}>{t('accounts.act.document')}</Button>
        </>
      ) : undefined}>
      {types.length > 1 && (
        <div className="acc-filterbar acc-filterbar-flat">
          <div className="field">
            <label className="field-label" htmlFor="adoc-type">{t('common.type')}</label>
            <Select id="adoc-type" value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}>
              <option value="">{t('common.all')}</option>
              {types.map((ty) => <option key={ty} value={ty}>{tx(`docGroup.${ty}`)}</option>)}
            </Select>
          </div>
        </div>
      )}
      <div className="list">
        {filtered.slice(cur * PAGE, (cur + 1) * PAGE).map((d) => (
          <Link key={d.id} to={`/documents/${d.id}`} className="list-item">
            <span className="glyph acc-doc-glyph" aria-hidden>{d.type === 'statement' ? <ScrollText /> : <FileText />}</span>
            <div className="li-main">
              <div className="li-title">{d.title}</div>
              <div className="li-sub"><span className="mono">{d.number}</span> · {tx(`docType.${d.type}`)} · {f.dateTime(d.createdAt)}</div>
            </div>
            <div className="li-end stack-sm" style={{ justifyItems: 'end', gap: 3 }}>
              <StatusBadge domain="document" status={d.status} />
              <span className="xsmall muted mono acc-hide-sm">{d.registryNo}</span>
            </div>
          </Link>
        ))}
        {!filtered.length && <Empty title={t('accounts.docs.empty')}>{t('accounts.docs.emptyHint')}</Empty>}
      </div>
      <Pager page={cur} pageSize={PAGE} total={filtered.length} onPage={setPage} />
    </Panel>
  );
}
