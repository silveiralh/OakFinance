// T01 — Lista de lançamentos (US-15): mês, resumo, chips, painel Filtros, busca, grupos por dia e ações da linha.
import {
  addMonths,
  formatBRL,
  type ISODate,
  MINUS_SIGN,
  todayIn,
  type YearMonth,
} from '@oakfinance/domain';
import { CaretLeft, CaretRight, MagnifyingGlass, Receipt } from '@phosphor-icons/react';
import { type UIEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { deleteRow, restoreRow } from '../../data/repositories/rows';
import { type MessageKey, t, uiText } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import {
  Dialog,
  EmptyState,
  GlassCard,
  IconButton,
  type RowTx,
  Select,
  TextField,
  TransactionRow,
  useToast,
} from '../../ui';
import { categoryIcon } from '../quick-entry/icons';
import {
  CHIPS,
  type Chip,
  type DayGroup,
  filteredTotal,
  filterTransactions,
  groupByDay,
  type ListFilters,
  monthRange,
  monthSummary,
  monthTitle,
  NO_FILTERS,
  type StatusFilter,
  visibleWindow,
} from './list';

type Tx = LocalRow<'transactions'>;
type Category = LocalRow<'categories'>;

const CHIP_LABEL: Record<Chip, MessageKey> = {
  all: 'list.filter.all',
  expense: 'list.filter.expense',
  income: 'list.filter.income',
  cards: 'list.filter.cards',
  pix: 'list.filter.pix',
  cash: 'list.filter.cash',
  vouchers: 'list.filter.vouchers',
  review: 'list.filter.review',
  forecast: 'list.filter.forecast',
  late: 'list.filter.late',
};

const STATUS_LABEL: Record<StatusFilter, string> = {
  posted: t('list.filter.all'),
  forecast: uiText.stateForecast,
  late: uiText.stateLate,
  cancelled: uiText.stateCancelled,
};

const BANDS = [
  ['needs', uiText.bandNeeds],
  ['wants', uiText.bandWants],
  ['savings', uiText.bandSavings],
] as const;

/** Altura de uma entrada da lista virtualizada (cabeçalho do dia ou linha), em px. */
const ROW_HEIGHT = 72;
const VIEWPORT = 720;

function signed(cents: number): string {
  if (cents < 0) {
    return `${MINUS_SIGN}${formatBRL(-cents)}`;
  }
  return cents > 0 ? `+${formatBRL(cents)}` : formatBRL(0);
}

/** "Hoje", "Ontem" ou dd/mm/aaaa. */
export function dayLabel(date: ISODate, today: ISODate): string {
  if (date === today) {
    return t('list.today');
  }
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  return date === y.toISOString().slice(0, 10) ? t('list.yesterday') : formatDateBR(date);
}

function rowState(tx: Tx, today: ISODate): RowTx['state'] {
  if (tx.status === 'cancelled') {
    return 'cancelled';
  }
  if (tx.status !== 'pending') {
    return undefined;
  }
  if (tx.occurred_on < today) {
    return 'late';
  }
  if (tx.kind === 'income') {
    return tx.count_before_received ? 'forecast' : 'to_receive';
  }
  return 'scheduled';
}

function toRow(tx: Tx, category: Category | undefined, today: ISODate): RowTx {
  const kind =
    tx.kind === 'income' || tx.kind === 'refund' || tx.kind === 'adjust_in'
      ? 'income'
      : tx.kind === 'transfer'
        ? 'transfer'
        : category?.bucket === 'savings'
          ? 'saving'
          : 'expense';
  const band = category?.bucket;
  const state = rowState(tx, today);
  return {
    id: tx.id,
    kind,
    amountCents: tx.amount_cents,
    ...(tx.description ? { description: tx.description } : {}),
    category: {
      name: category?.name ?? '',
      icon: categoryIcon(category?.icon ?? null),
      band:
        band === 'needs' || band === 'wants' || band === 'savings' || band === 'income'
          ? band
          : 'none',
    },
    method: tx.payment_method ?? '',
    when: formatDateBR(tx.occurred_on),
    ...(tx.installment_number && tx.installment_count
      ? { installment: { n: tx.installment_number, total: tx.installment_count } }
      : {}),
    syncState: tx._pending ? 'pending' : 'synced',
    ...(state ? { state } : {}),
    needsReview: tx.review_state === 'new' || tx.review_state === 'suggested',
  };
}

type Entry = { type: 'day'; group: DayGroup } | { type: 'row'; tx: Tx };

function flatten(groups: readonly DayGroup[]): Entry[] {
  return groups.flatMap((group) => [
    { type: 'day', group } as Entry,
    ...group.rows.map((tx) => ({ type: 'row', tx }) as Entry),
  ]);
}

export function TransactionsScreen({
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  today?: ISODate;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const [month, setMonth] = useState<YearMonth>(today.slice(0, 7) as YearMonth);
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);
  const [panel, setPanel] = useState(false);
  const [acting, setActing] = useState<Tx | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const { from, to } = monthRange(month);
  const data = useLive(
    user
      ? async () => ({
          rows: await user.db.transactions
            .where('occurred_on')
            .between(from, to, true, true)
            .toArray(),
          categories: await user.db.categories.toArray(),
          accounts: [
            ...(await user.db.accounts.toArray()),
            ...(await user.db.cards.toArray()),
          ].filter((a) => a.deleted_at === null),
        })
      : null,
    [user, from, to],
  );
  const categories = useMemo(
    () => new Map((data?.categories ?? []).map((c) => [c.id, c])),
    [data?.categories],
  );
  const live = useMemo(() => (data?.rows ?? []).filter((r) => r.deleted_at === null), [data?.rows]);
  const filtered = useMemo(
    () => filterTransactions(live, filters, categories, today),
    [live, filters, categories, today],
  );
  const entries = useMemo(() => flatten(groupByDay(filtered)), [filtered]);
  const summary = monthSummary(live, categories);
  const narrowed = filters !== NO_FILTERS && JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const set = (patch: Partial<ListFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const windowed = visibleWindow(entries.length, scrollTop, VIEWPORT, ROW_HEIGHT);

  const remove = async (tx: Tx) => {
    setActing(null);
    if (!user) {
      return;
    }
    const result = await deleteRow(user.db, 'transactions', tx.id);
    if (!result.ok) {
      return;
    }
    user.engine.notifyWrite();
    showToast({
      message: t('toast.deleted'),
      action: {
        label: t('toast.undo'),
        onPress: () => {
          void restoreRow(user.db, 'transactions', tx.id).then(() => user.engine.notifyWrite());
        },
      },
    });
  };

  const title = monthTitle(month);
  return (
    <section className="screen" data-screen="T01" data-testid="screen-T01">
      <div className="list-month">
        <IconButton
          icon={CaretLeft}
          label={t('list.prevMonth')}
          onClick={() => setMonth(addMonths(month, -1))}
        />
        <h2 className="list-month-title" data-testid="list-month">
          {title}
        </h2>
        <IconButton
          icon={CaretRight}
          label={t('list.nextMonth')}
          onClick={() => setMonth(addMonths(month, 1))}
        />
      </div>
      <GlassCard level={1}>
        <dl className="list-summary" data-testid="list-summary">
          <div>
            <dt>{t('list.summary.in')}</dt>
            <dd>{formatBRL(summary.inCents)}</dd>
          </div>
          <div>
            <dt>{t('list.summary.out')}</dt>
            <dd>{formatBRL(summary.outCents)}</dd>
          </div>
          <div>
            <dt>{t('list.summary.saved')}</dt>
            <dd>{formatBRL(summary.savedCents)}</dd>
          </div>
        </dl>
      </GlassCard>
      <TextField
        label={t('list.search')}
        value={filters.query}
        onChange={(query) => set({ query })}
        prefixIcon={MagnifyingGlass}
      />
      <fieldset className="quick-chips list-chips">
        <legend className="sr-only">{t('list.filters')}</legend>
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="chip glass"
            data-level="1"
            aria-pressed={filters.chip === chip}
            onClick={() => set({ chip })}
          >
            {t(CHIP_LABEL[chip])}
          </button>
        ))}
        <button
          type="button"
          className="chip glass"
          data-level="1"
          aria-expanded={panel}
          onClick={() => setPanel((open) => !open)}
        >
          {t('list.filters')}
        </button>
      </fieldset>
      {panel && (
        <GlassCard level={2} data-testid="list-panel">
          <div className="account-form">
            <Select
              label={t('list.filter.account')}
              value={filters.accountId ?? ''}
              onChange={(v) => set({ accountId: v || null })}
              options={[
                { value: '', label: t('list.filter.any') },
                ...(data?.accounts ?? []).map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
            <Select
              label={t('list.filter.band')}
              value={filters.band ?? ''}
              onChange={(v) => set({ band: v || null })}
              options={[
                { value: '', label: t('list.filter.any') },
                ...BANDS.map(([value, label]) => ({ value, label })),
              ]}
            />
            <Select
              label={t('list.filter.category')}
              value={filters.categoryId ?? ''}
              onChange={(v) => set({ categoryId: v || null })}
              options={[
                { value: '', label: t('list.filter.any') },
                ...(data?.categories ?? [])
                  .filter((c) => c.deleted_at === null)
                  .map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Select
              label={t('list.filter.status')}
              value={filters.status ?? ''}
              onChange={(v) => set({ status: (v || null) as StatusFilter | null })}
              options={[
                { value: '', label: t('list.filter.any') },
                ...(['forecast', 'late', 'cancelled'] as const).map((value) => ({
                  value,
                  label: STATUS_LABEL[value],
                })),
              ]}
            />
          </div>
        </GlassCard>
      )}
      {narrowed && (
        <p className="list-total" data-testid="list-total" aria-live="polite">
          {t('list.filteredTotal', { valor: signed(filteredTotal(filtered)) })}
        </p>
      )}
      {data && entries.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={
            filters.query.trim()
              ? t('list.noResult', { termo: filters.query.trim() })
              : t('list.empty', { mês: title })
          }
          description=""
        />
      ) : (
        <div
          className="list-scroll"
          data-testid="list-scroll"
          onScroll={(event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div style={{ height: windowed.start * ROW_HEIGHT }} aria-hidden="true" />
          {entries.slice(windowed.start, windowed.end).map((entry) =>
            entry.type === 'day' ? (
              <h3 key={`d-${entry.group.date}`} className="list-day" data-testid="list-day">
                <span>{dayLabel(entry.group.date, today)}</span>
                <span className="list-day-total">
                  {[
                    entry.group.inCents ? `+${formatBRL(entry.group.inCents)}` : '',
                    entry.group.outCents ? `${MINUS_SIGN}${formatBRL(entry.group.outCents)}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </h3>
            ) : (
              <TransactionRow
                key={entry.tx.id}
                data-testid={`tx-${entry.tx.id}`}
                tx={toRow(
                  entry.tx,
                  entry.tx.category_id ? categories.get(entry.tx.category_id) : undefined,
                  today,
                )}
                onPress={() => void navigate(`?editar=${entry.tx.id}`)}
                onActions={() => setActing(entry.tx)}
              />
            ),
          )}
          <div
            style={{ height: Math.max(0, entries.length - windowed.end) * ROW_HEIGHT }}
            aria-hidden="true"
          />
        </div>
      )}
      <Dialog
        open={acting !== null}
        title={acting?.description || uiText.actions}
        description={t('list.actionsHint')}
        options={[
          { value: 'edit', label: t('list.edit') },
          { value: 'delete', label: t('list.delete'), tone: 'danger' },
        ]}
        onChoose={(value) => {
          const tx = acting;
          if (!tx) {
            return;
          }
          if (value === 'edit') {
            setActing(null);
            void navigate(`?editar=${tx.id}`);
          } else {
            void remove(tx);
          }
        }}
        onCancel={() => setActing(null)}
      />
    </section>
  );
}
