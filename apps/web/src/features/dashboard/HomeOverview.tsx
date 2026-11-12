// H01 — Início (UX §3 H01, US-30, D-081): herói "Gasto em {mês}" no cartão preto da D-023 com o saldo nas contas e o
// que ainda vai sair, atalhos, Próximos 7 dias, Saúde do mês, Reserva, Conferir e os últimos lançamentos. Tudo calculado com os dados locais a cada
// mudança (RN-51); à meia-noite de São Paulo o dia (e na virada, o mês) muda sem recarregar (RN-48).
import { formatBRL, type ISODate, reserveProgress, type YearMonth } from '@oakfinance/domain';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Landmark, List, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { Amount, useValuesHidden } from '../../app/values';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { txFromRow } from '../../data/mappers';
import { emptyStates, fill, shellText, t, uiText } from '../../i18n/pt-BR';
import { useToday } from '../../lib/useToday';
import { EmptyState, TransactionRow } from '../../ui';
import { MONTH_NAMES, monthTitle } from '../transactions/list';
import { toRow } from '../transactions/TransactionsScreen';
import {
  HealthCard,
  ReserveCard,
  type ReserveSummary,
  ReviewCard,
  UpcomingCard,
} from './HomeCards';
import { dayPeriod, firstName, type HomeRows, homeModel } from './model';

const RECENT = 3;

function monthName(month: YearMonth): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? '';
}

export function HomeOverview({ today: fixedToday, now }: { today?: ISODate; now?: Date }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const hidden = useValuesHidden();
  const today = useToday(fixedToday);
  const data = useLive(
    user
      ? async () => {
          const rows: HomeRows & {
            goals: LocalRow<'goals'>[];
          } = {
            txRows: await user.db.transactions.toArray(),
            recurrences: await user.db.recurrences.toArray(),
            cards: await user.db.cards.toArray(),
            accounts: await user.db.accounts.toArray(),
            categories: await user.db.categories.toArray(),
            invoices: await user.db.invoices.toArray(),
            budgets: await user.db.budgets.toArray(),
            profile: (await user.db.profiles.toCollection().first()) ?? null,
            goals: await user.db.goals.where('kind').equals('emergency_reserve').toArray(),
          };
          return rows;
        }
      : null,
    [user],
  );
  const model = useMemo(() => (data ? homeModel(data, today) : null), [data, today]);
  const extras = useMemo(() => {
    if (!data) {
      return null;
    }
    const live = data.txRows.filter((r) => r.deleted_at === null);
    const recent = [...live]
      .sort((a, b) =>
        a.occurred_on === b.occurred_on
          ? b.created_at.localeCompare(a.created_at)
          : a.occurred_on < b.occurred_on
            ? 1
            : -1,
      )
      .slice(0, RECENT);
    const goal = data.goals.find((g) => g.deleted_at === null);
    let reserve: ReserveSummary | null = null;
    if (goal) {
      const txs = live
        .filter((r) => r.goal_id === goal.id)
        .flatMap((r) => {
          try {
            return [txFromRow(r)];
          } catch {
            return [];
          }
        });
      const progress = reserveProgress(
        {
          id: goal.id,
          targetMode: goal.target_mode === 'manual' ? 'manual' : 'auto',
          targetCents: goal.target_cents,
          autoFactor: goal.auto_factor,
          autoLookbackMonths: goal.auto_lookback_months,
          initialSavedCents: goal.initial_saved_cents,
        },
        txs,
        [],
        today,
      );
      reserve = { savedCents: progress.savedCents, targetCents: goal.target_cents };
    }
    const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
    const review = new Map<string, number>();
    for (const r of live) {
      if (r.source !== 'manual' && (r.review_state === 'new' || r.review_state === 'suggested')) {
        const bank = (r.account_id && accountName.get(r.account_id)) || '';
        review.set(bank, (review.get(bank) ?? 0) + 1);
      }
    }
    const categories = new Map(data.categories.map((c) => [c.id, c]));
    return {
      recent,
      reserve,
      categories,
      review: [...review].map(([bank, n]) => ({ bank, n })),
    };
  }, [data, today]);

  const month = today.slice(0, 7) as YearMonth;
  const name = firstName(data?.profile?.display_name);
  const greeting = name ? t(`home.greeting.${dayPeriod(now ?? new Date())}`, { nome: name }) : null;
  const actions = [
    { key: 'expense', label: t('quick.type.expense'), icon: ArrowUpRight, href: '?novo=despesa' },
    { key: 'income', label: t('quick.type.income'), icon: ArrowDownLeft, href: '?novo=receita' },
    { key: 'list', label: shellText.screens.T01, icon: List, href: '/lancamentos' },
    { key: 'accounts', label: shellText.screens.S03, icon: Landmark, href: '/ajustes/contas' },
  ] as const;
  // D-081: o herói é o gasto do mês (GR da RN-47: efetivadas pelo mês de impacto, menos estornos)
  const spent = model?.spendable.spentCents ?? 0;
  return (
    <div className="home" data-testid="home-overview">
      {greeting && <p className="home-greeting">{greeting}</p>}
      <section
        className="home-card glass"
        data-tone="dark"
        aria-labelledby="home-hero"
        data-testid="home-hero"
        data-spent={model ? spent : undefined}
      >
        <h2 id="home-hero" className="sr-only">
          {t('home.spent.heading', {
            mês: monthName(month),
            valor: formatBRL(spent, { hidden }),
          })}
        </h2>
        <div className="home-card-head">
          <p className="home-card-month">{t('home.spent.label', { mês: monthName(month) })}</p>
          <button
            type="button"
            className="home-card-new"
            onClick={() => void navigate('?novo=despesa')}
          >
            <span className="home-card-new-icon" aria-hidden="true">
              <Plus size={20} />
            </span>
            {uiText.newEntry}
          </button>
        </div>
        {model && (
          <>
            <p className="home-card-value money" data-testid="home-hero-money">
              <Amount text={formatBRL(spent)} hidden={hidden} />
            </p>
            <p className="home-card-label money" data-testid="home-upcoming-month">
              {t('home.upcomingMonth', {
                valor: formatBRL(model.spendable.upcoming.totalCents, { hidden }),
              })}
            </p>
            <Link
              to="/ajustes/contas"
              className="home-card-link home-balance"
              data-testid="home-balance"
              data-balance={model.balanceCents}
            >
              <span>{t('home.balance')}</span>
              <span className="money">
                <Amount text={formatBRL(model.balanceCents)} hidden={hidden} />
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </>
        )}
      </section>
      <nav className="home-actions" aria-label={uiText.actions}>
        {actions.map(({ key, label, icon: Glyph, href }, index) => (
          <Link
            key={key}
            to={href}
            className="home-action"
            data-accent={index === actions.length - 1 ? 'true' : undefined}
          >
            <Glyph size={24} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      {model && !model.monthHasEntries && (
        <div className="glass home-list" data-testid="home-month-empty">
          <EmptyState
            icon={List}
            title={fill(emptyStates.homeMonth.title, { mês: monthName(month) })}
            description={emptyStates.homeMonth.text}
            primaryAction={{
              label: emptyStates.homeMonth.actions[0],
              onPress: () => void navigate('?novo=despesa'),
            }}
          />
        </div>
      )}
      {extras && <ReviewCard pending={extras.review} />}
      {model && <UpcomingCard model={model} hidden={hidden} />}
      {model && <HealthCard model={model} hidden={hidden} />}
      {extras && (
        <ReserveCard
          reserve={extras.reserve ?? { savedCents: 0, targetCents: null }}
          hidden={hidden}
        />
      )}
      {extras && (
        <section className="home-recent" aria-labelledby="home-recent">
          <div className="home-section-head">
            <h2 id="home-recent">{t('home.recent')}</h2>
            <Link to="/lancamentos" className="home-see-all">
              {t('home.seeAll')}
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="glass home-recent-list">
            {extras.recent.length === 0 && (
              <p className="home-recent-empty">{t('list.empty', { mês: monthTitle(month) })}</p>
            )}
            {extras.recent.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={toRow(
                  tx,
                  tx.category_id ? extras.categories.get(tx.category_id) : undefined,
                  today,
                )}
                onPress={() => void navigate(`?editar=${tx.id}`)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
