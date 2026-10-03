/** Unknown route: an archive slip explaining that the registry holds no such page. */
import { Link, useLocation } from 'react-router-dom';
import { Home, Search } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { useUI } from '@/state/ui';
import { Crest } from '@/ui/heraldry';

export default function NotFoundPage() {
  const { t } = useT();
  const loc = useLocation();
  return (
    <div className="page">
      <div className="panel paper" style={{ maxWidth: 640, margin: '6vh auto', padding: 32, textAlign: 'center', display: 'grid', gap: 14, justifyItems: 'center' }}>
        <Crest size={72} />
        <div className="eyebrow">{t('notFound.eyebrow')}</div>
        <h1>{t('notFound.title')}</h1>
        <p className="ink2">{t('notFound.text', { path: loc.pathname })}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-primary" to="/"><Home />{t('notFound.home')}</Link>
          <button type="button" className="btn" onClick={() => useUI.getState().openPalette()}><Search />{t('notFound.search')}</button>
        </div>
      </div>
    </div>
  );
}
