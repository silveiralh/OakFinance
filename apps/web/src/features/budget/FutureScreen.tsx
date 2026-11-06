// P03 — Futuro: parcelas e contas fixas (UX §3 P03): barras dos próximos 12 meses (parcelas sólidas, contas fixas
// listradas), "Comprometido nos próximos 3 meses", tabela alternativa e a lista por mês (toque na parcela → T02).
import { formatBRL, type ISODate, monthLabel, todayIn } from '@oakfinance/domain';
import { CalendarClock, CreditCard, Repeat } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { Amount, maskMoney, useValuesHidden } from '../../app/values';
import { useLive } from '../../data/live';
import { txFromRow } from '../../data/mappers';
import { t } from '../../i18n/pt-BR';
import { Button, EmptyState, GlassCard } from '../../ui';
import { recurrenceFromRow } from '../recurrences/model';
import { committedNext, futureMonths } from './future';

export function FutureScreen({
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  today?: ISODate;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const hidden = useValuesHidden();
  const [table, setTable] = useState(false);
  const data = useLive(
    user
      ? async () => ({
          txRows: await user.db.transactions.toArray(),
          invoices: await user.db.invoices.toArray(),
          recurrences: await user.db.recurrences.toArray(),
          cards: await user.db.cards.toArray(),
        })
      : null,
    [user],
  );
  const months = useMemo(() => {
    if (!data) {
      return null;
    }
    const recs = data.recurrences
      .filter((r) => r.deleted_at === null)
      .flatMap((r) => {
        const rec = recurrenceFromRow(r);
        return rec ? [rec] : [];
      });
    const txs = data.txRows
      .filter((r) => r.recurrence_id !== null)
      .flatMap((r) => {
        try {
          return [txFromRow(r)];
        } catch {
          return [];
        }
      });
    return futureMonths({
      today,
      txRows: data.txRows,
      invoices: data.invoices,
      recurrences: recs,
      txs,
    });
  }, [data, today]);

  if (!months || !data) {
    return <section className="screen" data-screen="P03" data-testid="screen-P03" />;
  }
  const cardName = new Map(data.cards.map((c) => [c.id, c.name]));
  const max = Math.max(1, ...months.map((m) => m.totalCents));
  const empty = months.every((m) => m.items.length === 0);
  const money = (c: number) => maskMoney(formatBRL(c), hidden);

  return (
    <section className="screen" data-screen="P03" data-testid="screen-P03">
      {empty ? (
        <EmptyState
          icon={CalendarClock}
          title={t('future.empty')}
          description={t('future.emptyHint')}
        />
      ) : (
        <>
          <GlassCard level={1}>
            <p className="cards-line" data-testid="future-summary">
              {t('future.summary', { valor: money(committedNext(months)) })}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setTable((v) => !v)}>
              {table ? t('future.chart') : t('future.table')}
            </Button>
            {table ? (
              <table className="future-table" data-testid="future-table">
                <thead>
                  <tr>
                    <th scope="col">{t('future.month')}</th>
                    <th scope="col">{t('future.installments')}</th>
                    <th scope="col">{t('future.fixed')}</th>
                    <th scope="col">{t('future.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month}>
                      <th scope="row">{monthLabel(m.month)}</th>
                      <td>{money(m.installmentsCents)}</td>
                      <td>{money(m.fixedCents)}</td>
                      <td>{money(m.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ul className="future-bars" aria-hidden="true" data-testid="future-bars">
                {months.map((m) => (
                  <li key={m.month}>
                    <span className="future-bar-label">{monthLabel(m.month)}</span>
                    <span className="future-bar">
                      <span
                        className="future-seg"
                        data-kind="installment"
                        style={{ width: `${(m.installmentsCents / max) * 100}%` }}
                      />
                      <span
                        className="future-seg"
                        data-kind="fixed"
                        style={{ width: `${(m.fixedCents / max) * 100}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
          {months
            .filter((m) => m.items.length > 0)
            .map((m) => (
              <GlassCard key={m.month} level={1} title={monthLabel(m.month)} headingLevel={2}>
                <ul className="cards-invoices" data-testid={`future-${m.month}`}>
                  {m.items.map((item) => {
                    const Icon = item.kind === 'installment' ? CreditCard : Repeat;
                    const label = [
                      item.description,
                      item.kind === 'installment'
                        ? item.detail
                        : t('future.every', { dia: item.detail }),
                      <Amount key="v" text={formatBRL(item.amountCents)} hidden={hidden} />,
                      item.cardId ? cardName.get(item.cardId) : null,
                    ];
                    return (
                      <li key={item.key}>
                        <button
                          type="button"
                          className="cards-invoice"
                          onClick={() =>
                            void navigate(
                              item.txId ? `/lancamentos/${item.txId}` : '/ajustes/renda',
                            )
                          }
                        >
                          <Icon size={20} aria-hidden="true" />
                          <span className="cards-invoice-month">
                            {label.filter(Boolean).map((part, i) => (
                              <span key={typeof part === 'string' ? `${i}-${part}` : i}>
                                {i > 0 ? ' · ' : ''}
                                {part}
                              </span>
                            ))}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </GlassCard>
            ))}
        </>
      )}
    </section>
  );
}
