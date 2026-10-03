/** Permission guard for staff pages: explains the missing authority and offers identities that hold it. */
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useSession, useCan } from '@/state/session';
import { useT } from '@/hooks/useT';
import { useLive } from '@/hooks/data';
import { db } from '@/core/db/db';
import { ROLE_PERMISSIONS, permissionsOf, type Permission } from '@/core/security/permissions';
import { switchIdentity } from '@/core/security/auth';
import { primaryRole } from '@/core/context';
import { Avatar, Badge } from './primitives';

export function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const ok = useCan(perm);
  const { t, tx } = useT();
  const setUser = useSession((s) => s.setUser);
  const holders = useLive(() => (ok ? [] : db.users.where('kind').equals('staff').toArray().then((us) => us.filter((u) => permissionsOf(u.roles).has(perm)))), [ok, perm], []);
  if (ok) return <>{children}</>;
  const roles = Object.entries(ROLE_PERMISSIONS).filter(([, ps]) => ps.includes(perm)).map(([r]) => tx(`role.${r}`));
  return (
    <div className="page">
      <div className="panel ornate" style={{ maxWidth: 640, margin: '5vh auto', padding: 28, display: 'grid', gap: 12 }}>
        <div className="row" style={{ gap: 10 }}><ShieldAlert style={{ color: 'var(--warn)' }} aria-hidden /><strong className="eyebrow">{t('guard.eyebrow')}</strong></div>
        <h1 style={{ fontSize: '1.7rem' }}>{t('guard.title')}</h1>
        <p className="ink2">{t('guard.text', { perm, roles: roles.join(', ') })}</p>
        {holders.length > 0 && (
          <div className="stack-sm">
            <div className="stat-label">{t('guard.switchTo')}</div>
            <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
              {holders.map((u) => (
                <button key={u.id} type="button" className="list-item" onClick={async () => setUser(await switchIdentity(u.id))}>
                  <Avatar name={u.name} hue={u.avatarHue} />
                  <div className="li-main"><div className="li-title">{u.name}</div><div className="li-sub">{u.clientId}</div></div>
                  <Badge tone="magic">{tx(`role.${primaryRole(u.roles)}`)}</Badge>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
