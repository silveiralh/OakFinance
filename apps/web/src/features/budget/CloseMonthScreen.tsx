// P04 — Fechar o mês (UX §3 P04; US-36, RN-77): checklist com atalho para cada pendência, "Fechar mês" desativado
// com o motivo enquanto houver pendência, o estado fechado com "Reabrir para revisão". Funciona offline (os dados
// são os do aparelho; o fechamento sincroniza depois).
import { formatBRL, type ISODate, type YearMonth } from '@oakfinance/domain';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { trackUsage } from '../../lib/telemetry';
import { useToday } from '../../lib/useToday';
import { Button, GlassCard, useToast } from '../../ui';
import { loadHomeRows } from '../dashboard/data';
import {
  canClose,
  closeMonth,
  closingChecklist,
  closingOf,
  confirmOpenInvoice,
  monthName,
  monthTitle,
  reopenMonth,
} from './closing';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function CloseMonthScreen({ today: fixedToday }: { today?: ISODate } = {}) {
  const today = useToday(fixedToday);
  const { mes = '' } = useParams();
  const month = (MONTH_RE.test(mes) ? mes : today.slice(0, 7)) as YearMonth;
  const { user } = useAuth();
  const showToast = useToast();
  const data = useLive(
    user
      ? async () => ({
          rows: await loadHomeRows(user.db),
          closings: await user.db.month_closings.toArray(),
        })
      : null,
    [user],
  );
  if (!user || !data) {
    return <section className="screen" data-screen="P04" data-testid="screen-P04" />;
  }
  const name = monthName(month);
  const title = monthTitle(month);
  const list = closingChecklist(data.rows, data.closings, month, today);
  const closing = closingOf(data.closings, month);
  const ready = canClose(list);
  const invoiceMonth = (id: string) =>
    data.rows.invoices.find((inv) => inv.id === id)?.reference_month.slice(0, 7) ?? month;
  const cardOf = (id: string) => data.rows.invoices.find((inv) => inv.id === id)?.card_id ?? '';

  const close = async () => {
    const result = await closeMonth(user.db, user.userId, data.rows, data.closings, month, today);
    if (result.ok) {
      user.engine.notifyWrite();
      void trackUsage(user.db, 'mes_fechado');
      showToast({ message: t('close.done', { mes: title }) });
    }
  };
  const reopen = async () => {
    const result = await reopenMonth(user.db, user.userId, month);
    if (result.ok) {
      user.engine.notifyWrite();
      showToast({ message: t('close.reopened', { mes: title }) });
    }
  };

  const items: Array<{ key: string; text: string; to: string }> = [];
  if (list.suggested > 0) {
    items.push({
      key: 'suggested',
      text: t('close.suggested', { n: list.suggested }),
      to: '/conferir',
    });
  }
  if (list.unreviewed > 0) {
    items.push({
      key: 'unreviewed',
      text: t('close.unreviewed', { n: list.unreviewed }),
      to: '/conferir',
    });
  }
  if (list.unclassified > 0) {
    items.push({
      key: 'unclassified',
      text: t('close.unclassified', { n: list.unclassified }),
      to: '/lancamentos',
    });
  }

  return (
    <section className="screen close-month" data-screen="P04" data-testid="screen-P04">
      <h2>{t('close.title', { mes: name })}</h2>
      {closing?.closed_at ? (
        <GlassCard level={2} className="close-block" data-testid="close-closed">
          <p role="status">
            {t('close.closed', {
              mes: title,
              data: formatDateBR(closing.closed_at.slice(0, 10) as ISODate),
            })}
          </p>
          <Button variant="secondary" onClick={() => void reopen()} data-testid="close-reopen">
            {t('close.reopen')}
          </Button>
        </GlassCard>
      ) : (
        <GlassCard level={2} className="close-block" data-testid="close-checklist">
          {ready ? (
            <p role="status">{t('close.ready')}</p>
          ) : (
            <ul className="close-list">
              {items.map((item) => (
                <li key={item.key} data-testid={`close-${item.key}`}>
                  <Link to={item.to}>{item.text}</Link>
                </li>
              ))}
              {list.openInvoices.map((inv) => (
                <li key={inv.invoiceId} data-testid="close-invoice">
                  <Link
                    to={`/cartoes/${cardOf(inv.invoiceId)}/fatura/${invoiceMonth(inv.invoiceId)}`}
                  >
                    {t('close.invoice', {
                      cartao: inv.cardName,
                      valor: formatBRL(inv.balanceCents),
                    })}
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void confirmOpenInvoice(
                        user.db,
                        user.userId,
                        data.closings,
                        month,
                        inv.invoiceId,
                      ).then((r) => r.ok && user.engine.notifyWrite())
                    }
                  >
                    {t('close.confirmInvoice')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            fullWidth
            disabled={!ready}
            disabledReason={ready ? '' : t('close.blocked')}
            onClick={() => void close()}
            data-testid="close-run"
          >
            {t('close.cta')}
          </Button>
        </GlassCard>
      )}
    </section>
  );
}
