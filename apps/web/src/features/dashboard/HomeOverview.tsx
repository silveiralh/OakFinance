// H01 — Início (UX §3 H01, US-30): herói "Disponível para gastar" (RN-47..RN-50) no cartão preto da D-023, atalhos,
// Próximos 7 dias, 50/30/20, Reserva, Conferir e os últimos lançamentos. Tudo calculado com os dados locais a cada
// mudança (RN-51); à meia-noite de São Paulo o dia (e na virada, o mês) muda sem recarregar (RN-48).
import { formatBRL, type ISODate, reserveProgress, type YearMonth } from '@oakfinance/domain';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Landmark, List, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { Amount, useValuesHidden } from '../../app/values';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { txFromRow } from '../../data/mappers';
import { shellText, t, uiText } from '../../i18n/pt-BR';
import { useToday } from '../../lib/useToday';
import { EmptyState, PaceIndicator, TransactionRow } from '../../ui';
import { MONTH_NAMES, monthTitle } from '../transactions/list';
import { toRow } from '../transactions/TransactionsScreen';
import { FormulaSheet } from './FormulaSheet';
import {
  BudgetCard,
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

/** "R$ 75,62 por dia até 30/11". */
function lastDayLabel(month: YearMonth, daysLeft: number, today: ISODate): string {
  const day = Number(today.slice(8, 10)) + daysLeft - 1;
  return `${String(day).padStart(2, '0')}/${month.slice(5, 7)}`;
}

export function HomeOverview({ today: fixedToday, now }: { today?: ISODate; now?: Date }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const hidden = useValuesHidden();
  const today = useToday(fixedToday);
  const [formulaOpen, setFormulaOpen] = useState(false);
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
  const s = model?.spendable;
  const noIncome = s?.status === 'no_income';
  const available = s?.availableCents ?? 0;
  return (
    <div className="home" data-testid="home-overview">
      {greeting && <p className="home-greeting">{greeting}</p>}
      <section
        className="home-card glass"
        data-tone="dark"
        aria-labelledby="home-hero"
        data-testid="home-hero"
        data-status={s?.status}
        data-available={s && !noIncome ? available : undefined}
      >
        <h2 id="home-hero" className="sr-only">
          {s && !noIncome
            ? t('home.hero.heading', { valor: formatBRL(available, { hidden }) })
            : t('home.formula.total')}
        </h2>
        <div className="home-card-head">
          <p className="home-card-month">{t('home.hero.label', { mês: monthName(month) })}</p>
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
        {s && noIncome && (
          <>
            <p className="home-card-empty">{t('home.hero.noIncome')}</p>
            <div className="home-card-ctas">
              <Link to="/ajustes/renda" className="home-pill-link" data-tone="accent">
                {t('home.hero.noIncomeCta')}
              </Link>
              <Link to="?novo=receita" className="home-pill-link">
                {t('home.hero.noIncomeAlt')}
              </Link>
            </div>
            <p className="home-card-label money" data-testid="home-hero-money">
              {t('home.hero.noIncomeSpent', {
                valor: formatBRL(model?.spentAndUpcomingCents ?? 0, { hidden }),
              })}
            </p>
          </>
        )}
        {s && !noIncome && (
          <>
            <p className="home-card-value money" data-testid="home-hero-money">
              <Amount text={formatBRL(available)} hidden={hidden} />
            </p>
            {available > 0 && s.daysLeft > 0 && (
              <p className="home-card-label money" data-testid="home-per-day">
                {t('home.hero.perDay', {
                  valor: formatBRL(s.perDayCents, { hidden }),
                  data: lastDayLabel(month, s.daysLeft, today),
                })}
              </p>
            )}
            <PaceIndicator
              className="home-pace"
              state={s.status}
              amountCents={Math.abs(available)}
              data-testid="home-pace"
            />
            {s.status === 'over' && (
              <Link to="/planejar/orcamento" className="home-card-link">
                {t('home.hero.adjust')}
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            )}
          </>
        )}
        {s && model?.config.cardAttribution === 'invoice_due_month' && (
          <Link to="/planejar/futuro" className="home-card-link" data-testid="home-future-card">
            {t('home.futureCard', { valor: formatBRL(s.futureCardCents, { hidden }) })}
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        )}
        {s && (
          <button
            type="button"
            className="home-card-link"
            onClick={() => setFormulaOpen(true)}
            data-testid="home-how"
          >
            {t('home.hero.how')}
          </button>
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
            title={t('list.empty', { mês: monthName(month) })}
            description={uiText.homeEmptyHint}
            primaryAction={{
              label: uiText.newEntry,
              onPress: () => void navigate('?novo=despesa'),
            }}
          />
        </div>
      )}
      {extras && <ReviewCard pending={extras.review} />}
      {model && <UpcomingCard model={model} hidden={hidden} />}
      {model && <BudgetCard model={model} hidden={hidden} />}
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
      {model && (
        <FormulaSheet
          model={model}
          hidden={hidden}
          open={formulaOpen}
          onClose={() => setFormulaOpen(false)}
        />
      )}
    </div>
  );
}
