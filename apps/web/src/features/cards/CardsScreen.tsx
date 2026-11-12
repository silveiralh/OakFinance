// C01 — Cartões e faturas (US-18): carrossel com a fatura atual de cada cartão, próximas 3 faturas, anteriores com
// status em texto e limite usado do cartão selecionado.
import { formatBRL, type ISODate, monthLabel, todayIn } from '@oakfinance/domain';
import { ChevronLeft, ChevronRight, CreditCard, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { Amount, maskMoney, useValuesHidden } from '../../app/values';
import { cardFromRow } from '../../data/mappers';
import { emptyStates, t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import {
  Badge,
  Button,
  EmptyState,
  GlassCard,
  IconButton,
  InvoiceCard,
  invoiceBadge,
  ProgressBar,
  Skeleton,
} from '../../ui';
import { brandColor, useCardsData, useEnsureCardData } from './data';
import { cardOverview, type InvoiceView } from './model';

const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Linha de estado da fatura: "Fecha em 03/12 (18 dias)", "{valor} em aberto" ou "Sem valor a pagar". */
export function invoiceStateLine(view: InvoiceView, hidden: boolean): string {
  if (view.status === 'open' || view.status === 'future') {
    return view.daysToClose === 0
      ? t('invoice.closesToday')
      : t('invoice.closesIn', { data: dm(view.period.closingDate), n: view.daysToClose });
  }
  if (view.status === 'paid') {
    return view.remainingCents === 0 && view.totalCents <= 0 ? t('invoice.noBalance') : '';
  }
  return t('invoice.remaining', { valor: maskMoney(formatBRL(view.remainingCents), hidden) });
}

export function invoiceHref(cardId: string, view: InvoiceView): string {
  return `/cartoes/${cardId}/fatura/${view.period.referenceMonth}`;
}

export function CardsScreen({
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  today?: ISODate;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const hidden = useValuesHidden();
  const data = useCardsData(user);
  useEnsureCardData(user, data, today);
  // seleção pelo id do cartão: a lista pode mudar de ordem quando o sync traz outro cartão
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const overviews = useMemo(
    () =>
      (data?.cards ?? []).map((row) => ({
        row,
        overview: cardOverview(
          cardFromRow(row),
          data?.txs ?? [],
          (data?.invoices ?? []).filter((i) => i.card_id === row.id),
          today,
        ),
      })),
    [data, today],
  );
  // a seleção implícita (primeiro cartão) vira explícita: se o sync trouxer um cartão que entra antes na ordem, a
  // C01 continua no mesmo cartão e "Ver fatura" não abre a fatura de outro (E04 instável no iphone)
  const firstId = overviews[0]?.row.id ?? null;
  useEffect(() => {
    if (selectedId === null && firstId !== null) {
      setSelectedId(firstId);
    }
  }, [selectedId, firstId]);

  if (!data) {
    return (
      <section className="screen" data-screen="C01" data-testid="screen-C01">
        <Skeleton shape="card" />
      </section>
    );
  }
  if (overviews.length === 0) {
    return (
      <section className="screen" data-screen="C01" data-testid="screen-C01">
        <EmptyState
          icon={CreditCard}
          title={emptyStates.cards.title}
          description={emptyStates.cards.text}
          primaryAction={{
            label: emptyStates.cards.actions[0],
            onPress: () => void navigate('/ajustes/contas?adicionar=cartao'),
          }}
        />
      </section>
    );
  }
  const found = overviews.findIndex((o) => o.row.id === selectedId);
  const index = Math.max(found, 0);
  const select = (i: number) => setSelectedId(overviews[i]?.row.id ?? null);
  const active = overviews[index];
  if (!active) {
    return null;
  }
  const { row, overview } = active;
  const go = (view: InvoiceView, cardId = row.id) => void navigate(invoiceHref(cardId, view));
  return (
    <section className="screen" data-screen="C01" data-testid="screen-C01">
      <div className="cards-carousel" data-testid="cards-carousel">
        {overviews.map(({ row: card, overview: o }, i) => (
          <section
            key={card.id}
            className="cards-slide"
            aria-roledescription="cartão"
            aria-label={t('invoice.cardLabel', {
              cartão: card.name,
              mês: monthLabel(o.current.period.referenceMonth),
              valor: maskMoney(formatBRL(o.current.totalCents), hidden),
              data: dm(o.current.period.dueDate),
            })}
            data-selected={i === index}
          >
            <InvoiceCard
              card={{
                name: card.name,
                brandColor: brandColor(card.color),
                ...(card.last4 ? { last4: card.last4 } : {}),
              }}
              invoice={{
                month: o.current.period.referenceMonth,
                totalCents: o.current.totalCents,
                remainingCents: o.current.remainingCents,
                closesOn: o.current.period.closingDate,
                dueOn: o.current.period.dueDate,
                status: o.current.status,
              }}
              daysToDue={o.current.daysToDue}
              {...(o.limitCents !== null && o.usedCents !== null
                ? { limitCents: o.limitCents, usedCents: Math.max(0, o.usedCents) }
                : {})}
              // UXB-025: tocar no cartão já selecionado abre a fatura atual dele
              onPress={() => (i === index ? go(o.current, card.id) : select(i))}
              data-testid={`card-${card.id}`}
            />
          </section>
        ))}
      </div>
      {overviews.length > 1 && (
        <div className="cards-nav">
          <IconButton
            icon={ChevronLeft}
            label={t('invoice.prevCard')}
            onClick={() => select(Math.max(0, index - 1))}
          />
          <IconButton
            icon={ChevronRight}
            label={t('invoice.nextCard')}
            onClick={() => select(Math.min(overviews.length - 1, index + 1))}
          />
        </div>
      )}
      {/* UXB-011: nome e total já estão no cartão acima; aqui ficam o estado, o limite e "Ver fatura" */}
      <GlassCard
        level={1}
        title={t('invoice.title', { mês: monthLabel(overview.current.period.referenceMonth) })}
        headingLevel={2}
      >
        <div className="cards-current" data-testid="cards-current">
          <p className="cards-line" data-testid="cards-state">
            {invoiceStateLine(overview.current, hidden)}
          </p>
          {overview.limitCents !== null && overview.usedCents !== null && (
            <ProgressBar
              label={t('invoice.limitUsed', {
                usado: maskMoney(formatBRL(Math.max(0, overview.usedCents)), hidden),
                limite: maskMoney(formatBRL(overview.limitCents), hidden),
              })}
              valueText={t('invoice.limitUsed', {
                usado: maskMoney(formatBRL(Math.max(0, overview.usedCents)), hidden),
                limite: maskMoney(formatBRL(overview.limitCents), hidden),
              })}
              valueCents={Math.max(0, overview.usedCents)}
              maxCents={overview.limitCents}
              size="sm"
            />
          )}
          <Button variant="secondary" onClick={() => go(overview.current)}>
            {t('invoice.open')}
          </Button>
        </div>
      </GlassCard>
      <GlassCard level={1} title={t('invoice.upcoming')} headingLevel={2}>
        <InvoiceList
          views={overview.upcoming}
          hidden={hidden}
          onOpen={go}
          testId="cards-upcoming"
        />
      </GlassCard>
      {overview.previous.length > 0 && (
        <GlassCard level={1} title={t('invoice.previous')} headingLevel={2}>
          <InvoiceList
            views={overview.previous}
            hidden={hidden}
            onOpen={go}
            testId="cards-previous"
          />
        </GlassCard>
      )}
      <Button
        variant="ghost"
        iconStart={Plus}
        onClick={() => void navigate('/ajustes/contas?adicionar=cartao')}
      >
        {t('cards.add')}
      </Button>
    </section>
  );
}

function InvoiceList({
  views,
  hidden,
  onOpen,
  testId,
}: {
  views: readonly InvoiceView[];
  hidden: boolean;
  onOpen: (view: InvoiceView) => void;
  testId: string;
}) {
  return (
    <ul className="cards-invoices" data-testid={testId}>
      {views.map((view) => {
        const badge = invoiceBadge(view.status, view.daysToDue);
        return (
          <li key={view.period.id}>
            <button type="button" className="cards-invoice" onClick={() => onOpen(view)}>
              <span className="cards-invoice-month">
                {t('invoice.row', {
                  mês: monthLabel(view.period.referenceMonth),
                  data: formatDateBR(view.period.dueDate),
                })}
              </span>
              <Badge tone={badge.tone} icon={badge.icon} label={badge.label} />
              <span className="cards-invoice-total">
                <Amount text={formatBRL(view.totalCents)} hidden={hidden} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
