// Sino do topo do Início (UX §3 H01 e H02): leva à central e mostra quantos avisos não lidos há.
import { Bell } from 'lucide-react';
import { Link } from 'react-router';
import { useLive } from '../data/live';
import { unreadCount } from '../features/notices/model';
import { t } from '../i18n/pt-BR';
import { useAuth } from './auth';

export function NoticesBell() {
  const { user } = useAuth();
  const count = useLive(
    user ? async () => unreadCount(await user.db.notices.toArray(), new Date()) : null,
    [user],
  );
  const n = count ?? 0;
  return (
    <Link
      to="/avisos"
      className="icon-btn notices-bell"
      aria-label={t('notices.bell', { n })}
      data-testid="notices-bell"
    >
      <Bell size={24} aria-hidden="true" />
      {n > 0 && (
        <span className="notices-count" aria-hidden="true" data-testid="notices-count">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}
