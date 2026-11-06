// C02 — Fatura do mês (US-18): cartão, ‹ mês ›, status em texto, total, "Fecha em … · Vence em …", itens por dia
// (parcelas com "3/10") e os estados aberta, fechada, vencida, paga, futura e vazia.
import {
  addMonths,
  formatBRL,
  type ISODate,
  monthLabel,
  todayIn,
  type YearMonth,
} from '@oakfinance/domain';
import { ChevronLeft, ChevronRight, CreditCard, Receipt, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../app/auth';
import { Amount, useValuesHidden } from '../../app/values';
import { cardFromRow } from '../../data/mappers';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import {
  Badge,
  Button,
  EmptyState,
  GlassCard,
  IconButton,
  invoiceBadge,
  Skeleton,
  TransactionRow,
} from '../../ui';
import { groupByDay } from '../transactions/list';
import { dayLabel, toRow } from '../transactions/TransactionsScreen';
import { invoiceStateLine } from './CardsScreen';
import { useCardsData, useEnsureCardData } from './data';
import { cardOverview, invoiceView, overridesOf, payableInvoices } from './model';
import { PaymentSheet } from './PaymentSheet';

const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function InvoiceScreen({
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  today?: ISODate;
}) {
  const { cartaoId = '', mes = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const hidden = useValuesHidden();
  const data = useCardsData(user);
  useEnsureCardData(user, data, today);
  const cardRow = data?.cards.find((c) => c.id === cartaoId);
  const month = (MONTH.test(mes) ? mes : today.slice(0, 7)) as YearMonth;
  const [paying, setPaying] = useState(false);
  const overview = useMemo(
    () =>
      cardRow && data
        ? cardOverview(
            cardFromRow(cardRow),
            data.txs,
            data.invoices.filter((i) => i.card_id === cardRow.id),
            today,
          )
        : null,
    [cardRow, data, today],
  );
  const view = useMemo(
    () =>
      cardRow && data
        ? invoiceView(
            cardFromRow(cardRow),
            month,
            data.txs,
            overridesOf(data.invoices.filter((i) => i.card_id === cardRow.id)),
            today,
          )
        : null,
    [cardRow, data, month, today],
  );
  const rowsById = useMemo(
    () => new Map((data?.txRows ?? []).map((r) => [r.id, r])),
    [data?.txRows],
  );
  const categories = useMemo(
    () => new Map((data?.categories ?? []).map((c) => [c.id, c])),
    [data?.categories],
  );

  if (!data) {
    return (
      <section className="screen" data-screen="C02" data-testid="screen-C02">
        <Skeleton shape="card" />
      </section>
    );
  }
  if (!cardRow || !view) {
    return (
      <section className="screen" data-screen="C02" data-testid="screen-C02">
        <EmptyState
          variant="error"
          icon={CreditCard}
          title={t('invoice.notFound')}
          description=""
          primaryAction={{ label: t('invoice.back'), onPress: () => void navigate('/cartoes') }}
        />
      </section>
    );
  }
  const badge = invoiceBadge(view.status, view.daysToDue);
  const payViews = [
    ...(overview ? [...overview.previous, overview.current] : []),
    ...(overview?.previous.some((v) => v.period.id === view.period.id) ||
    overview?.current.period.id === view.period.id
      ? []
      : [view]),
  ];
  const payable = payableInvoices(payViews);
  const rows = view.items.flatMap((tx) => {
    const row = rowsById.get(tx.id);
    return row ? [row] : [];
  });
  const groups = groupByDay(rows);
  const state = invoiceStateLine(view, hidden);
  const goMonth = (delta: number) =>
    void navigate(`/cartoes/${cardRow.id}/fatura/${addMonths(month, delta)}`, { replace: true });
  return (
    <section className="screen" data-screen="C02" data-testid="screen-C02">
      <div className="list-month">
        <IconButton icon={ChevronLeft} label={t('list.prevMonth')} onClick={() => goMonth(-1)} />
        <h2 className="list-month-title" data-testid="invoice-month">
          {`${cardRow.name} · ${monthLabel(month)}`}
        </h2>
        <IconButton icon={ChevronRight} label={t('list.nextMonth')} onClick={() => goMonth(1)} />
      </div>
      <GlassCard level={1}>
        <div className="invoice-head" data-testid="invoice-head">
          <Badge tone={badge.tone} icon={badge.icon} label={badge.label} />
          <p className="invoice-head-total" data-testid="invoice-total">
            <Amount text={formatBRL(view.totalCents)} hidden={hidden} />
          </p>
          <p className="detail-note">
            {t('invoice.closesDue', {
              fecha: dm(view.period.closingDate),
              vence: dm(view.period.dueDate),
            })}
          </p>
          {state && (
            <p className="detail-note" data-testid="invoice-state">
              {state}
            </p>
          )}
          {view.status === 'future' && <p className="detail-note">{t('card.future.note')}</p>}
        </div>
      </GlassCard>
      {payable.length > 0 && user && (
        <>
          <div className="invoice-pay">
            <Button fullWidth iconStart={Wallet} onClick={() => setPaying(true)}>
              {t('card.pay.cta')}
            </Button>
          </div>
          <PaymentSheet
            open={paying}
            onClose={() => setPaying(false)}
            user={user}
            card={cardRow}
            accounts={data.accounts}
            categories={data.categories}
            invoices={data.invoices}
            views={payViews}
            today={today}
            hidden={hidden}
          />
        </>
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t('invoice.empty')}
          description={t('invoice.emptyHint', {
            cartão: cardRow.name,
            data: formatDateBR(view.period.periodStart),
          })}
        />
      ) : (
        <div className="list-rows" data-testid="invoice-items">
          {groups.map((group) => (
            <div key={group.date}>
              <h3 className="list-day">
                <span>{dayLabel(group.date, today)}</span>
              </h3>
              {group.rows.map((row) => (
                <TransactionRow
                  key={row.id}
                  data-testid={`tx-${row.id}`}
                  tx={toRow(
                    row,
                    row.category_id ? categories.get(row.category_id) : undefined,
                    today,
                  )}
                  onPress={() => void navigate(`/lancamentos/${row.id}`)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
