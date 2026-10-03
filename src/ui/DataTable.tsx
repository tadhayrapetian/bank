/** Ledger-style data table: sortable columns, pagination, row links, mobile card layout, optional CSV export. */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { Button, Empty, Pager } from './primitives';
import { EMBED, downloadText, toCsv } from './print';

export interface Column<R> {
  key: string;
  header: ReactNode;
  render: (row: R) => ReactNode;
  /** Value used for sorting and CSV export. */
  value?: (row: R) => string | number;
  align?: 'left' | 'right';
  /** Hidden on phones (the row becomes a compact card). */
  hideMobile?: boolean;
  width?: number | string;
}

export function DataTable<R>({ rows, columns, rowKey, rowLink, onRowClick, pageSize = 15, empty, caption, initialSort, csvName, dense }: {
  rows: R[];
  columns: Column<R>[];
  rowKey: (row: R) => string;
  rowLink?: (row: R) => string;
  onRowClick?: (row: R) => void;
  pageSize?: number;
  empty?: ReactNode;
  caption?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  /** When set, shows an "Export CSV" button (hidden in the embedded preview). */
  csvName?: string;
  dense?: boolean;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return rows;
    const v = col.value;
    return [...rows].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const shown = sorted.slice(cur * pageSize, (cur + 1) * pageSize);
  const open = rowLink ? (r: R) => navigate(rowLink(r)) : onRowClick;

  const exportCsv = () => {
    const cols = columns.filter((c) => c.value);
    const head = cols.map((c) => (typeof c.header === 'string' ? c.header : c.key));
    downloadText(`${csvName}.csv`, toCsv([head, ...sorted.map((r) => cols.map((c) => c.value!(r)))]), 'text/csv');
  };

  if (!rows.length) return <>{empty ?? <Empty title={t('common.noData')} />}</>;
  return (
    <div>
      {csvName && !EMBED && (
        <div className="row" style={{ justifyContent: 'flex-end', padding: '0 0 8px' }}>
          <Button size="sm" variant="ghost" icon={<Download />} onClick={exportCsv}>CSV</Button>
        </div>
      )}
      <div className="table-wrap">
        <table className={`table responsive${dense ? ' dense' : ''}`}>
          {caption && <caption>{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} className={c.align === 'right' ? 'num' : undefined} style={c.width ? { width: c.width } : undefined} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.value ? (
                      <button type="button" className="th-sort" onClick={() => { setSort({ key: c.key, dir: active && sort!.dir === 'desc' ? 'asc' : 'desc' }); setPage(0); }} title={t('common.sortBy')}>
                        {c.header}
                        {active ? (sort!.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : null}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={rowKey(r)}
                className={open ? 'clickable' : undefined}
                onClick={open ? (e) => { if (!(e.target as HTMLElement).closest('a,button,input,select,label')) open(r); } : undefined}
                onKeyDown={open ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(r); } : undefined}
                tabIndex={open ? 0 : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'num' : undefined} data-hide-mobile={c.hideMobile || undefined}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={cur} pageSize={pageSize} total={sorted.length} onPage={setPage} />
    </div>
  );
}
