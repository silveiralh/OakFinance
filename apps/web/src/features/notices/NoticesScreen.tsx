// H02 — Central de avisos (UX §3 H02, US-37): ícone do tipo, título, texto, data relativa e ponto "não lido"; tocar
// abre a tela de destino e marca como lido; "Marcar todos como lidos". Funciona offline com o que está no aparelho.
import { addDays, todayIn } from '@oakfinance/domain';
import {
  Bell,
  CalendarDays,
  CreditCard,
  Landmark,
  PenLine,
  Repeat,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { t, uiText } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { Button, EmptyState } from '../../ui';
import { localDate, markAllRead, markRead, type Notice, visibleNotices } from './model';

const ICON: Record<string, typeof Bell> = {
  invoice_due: CreditCard,
  invoice_closed: CreditCard,
  bill_due: Repeat,
  bill_overdue: Repeat,
  income_unconfirmed: Repeat,
  budget_threshold: TrendingUp,
  daily_log: PenLine,
  weekly_summary: CalendarDays,
  bank_connection: Landmark,
  reserve_full: ShieldCheck,
};

/** "Hoje", "Ontem" ou dd/mm/aaaa (data do aviso no fuso de São Paulo). */
export function noticeWhen(notice: Notice, now: Date): string {
  const day = localDate(notice.created_at);
  const today = todayIn('America/Sao_Paulo', now);
  if (day === today) {
    return t('list.today');
  }
  return day === addDays(today, -1) ? t('list.yesterday') : formatDateBR(day);
}

export function NoticesScreen({ now }: { now?: Date }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const rows = useLive(user ? () => user.db.notices.toArray() : null, [user]);
  if (!user || !rows) {
    return <section className="screen" data-screen="H02" data-testid="screen-H02" />;
  }
  const at = now ?? new Date();
  const list = visibleNotices(rows, at);
  const open = async (notice: Notice) => {
    await markRead(user.db, notice);
    user.engine.notifyWrite();
    void navigate(notice.navigate || '/');
  };
  const readAll = async () => {
    await markAllRead(user.db, rows, at);
    user.engine.notifyWrite();
  };
  return (
    <section className="screen notices" data-screen="H02" data-testid="screen-H02">
      {list.length === 0 ? (
        <EmptyState icon={Bell} title={t('notices.empty')} description={uiText.noticesEmptyHint} />
      ) : (
        <>
          {list.some((n) => n.read_at === null) && (
            <Button variant="ghost" onClick={() => void readAll()} data-testid="notices-read-all">
              {t('notices.readAll')}
            </Button>
          )}
          <ul className="glass notices-list">
            {list.map((n) => {
              const Glyph = ICON[n.kind] ?? Bell;
              const unread = n.read_at === null;
              return (
                <li key={n.id} data-testid={`notice-${n.id}`} data-unread={unread}>
                  <button type="button" className="notice" onClick={() => void open(n)}>
                    <span className="notice-icon" aria-hidden="true">
                      <Glyph size={20} />
                    </span>
                    <span className="notice-text">
                      <span className="notice-title">{n.title}</span>
                      <span className="notice-body">{n.body}</span>
                      <span className="notice-when">{noticeWhen(n, at)}</span>
                    </span>
                    {unread && (
                      <span className="notice-dot">
                        <span className="sr-only">{t('notices.unread')}</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
