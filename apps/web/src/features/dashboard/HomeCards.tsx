// Cards do H01 abaixo do herói (UX §3 H01, itens 3–6): Próximos 7 dias, 50/30/20, Reserva e Conferir.
import { diffDays, formatBRL, type ISODate } from '@oakfinance/domain';
import {
  CalendarClock,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CreditCard,
  Inbox,
  Repeat,
  TriangleAlert,
} from 'lucide-react';
import { Link } from 'react-router';
import { Amount } from '../../app/values';
import { t, uiText } from '../../i18n/pt-BR';
import { BudgetRing, GoalProgress, ProgressBar } from '../../ui';
import type { HomeModel, Outflow } from './model';

/** "Hoje", "Amanhã" ou "Em {n} dias". */
export function relativeDay(date: ISODate, today: ISODate): string {
  const n = diffDays(today, date);
  if (n <= 0) {
    return t('list.today');
  }
  return n === 1 ? t('home.upcoming.tomorrow') : t('home.upcoming.inDays', { n });
}

const KIND_ICON: Record<Outflow['kind'], typeof CreditCard> = {
  invoice: CreditCard,
  fixed: Repeat,
  scheduled: CalendarClock,
};

function SectionHead({
  id,
  title,
  href,
  link,
}: {
  id: string;
  title: string;
  href: string;
  link: string;
}) {
  return (
    <div className="home-section-head">
      <h2 id={id}>{title}</h2>
      <Link to={href} className="home-see-all">
        {link}
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function UpcomingCard({ model, hidden }: { model: HomeModel; hidden: boolean }) {
  return (
    <section className="home-block" aria-labelledby="home-upcoming" data-testid="home-upcoming">
      <SectionHead
        id="home-upcoming"
        title={t('home.upcoming.title')}
        href="/planejar/futuro"
        link={t('home.upcoming.all')}
      />
      <div className="glass home-list">
        {model.upcoming.length === 0 ? (
          <p className="home-recent-empty">{t('home.upcoming.empty')}</p>
        ) : (
          <ul className="home-upcoming">
            {model.upcoming.map((item) => {
              const Glyph = KIND_ICON[item.kind];
              return (
                <li key={item.key}>
                  <Link to={item.href} className="home-upcoming-item">
                    <span className="home-upcoming-icon" aria-hidden="true">
                      <Glyph size={20} />
                    </span>
                    <span className="home-upcoming-text">
                      <span>{item.label}</span>
                      <span className="home-upcoming-when">
                        {relativeDay(item.date, model.today)}
                      </span>
                    </span>
                    <span className="money">
                      <Amount text={formatBRL(item.amountCents)} hidden={hidden} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

const BANDS = [
  ['needs', uiText.bandNeeds],
  ['wants', uiText.bandWants],
  ['savings', uiText.bandSavings],
] as const;

export function BudgetCard({ model, hidden }: { model: HomeModel; hidden: boolean }) {
  const bands = BANDS.map(([key]) => ({
    key,
    spentCents: model.buckets[key].spentCents + model.buckets[key].committedCents,
    plannedCents: model.buckets[key].targetCents,
  }));
  return (
    <section className="home-block" aria-labelledby="home-budget" data-testid="home-budget">
      <SectionHead
        id="home-budget"
        title={t('home.budget.title')}
        href="/planejar/orcamento"
        link={t('home.seeAll')}
      />
      <Link to="/planejar/orcamento" className="glass home-list home-budget">
        <BudgetRing bands={bands} incomeCents={model.spendable.income.totalCents} size="sm" />
        <dl className="home-budget-lines">
          {BANDS.map(([key, name], i) => (
            <div key={key}>
              <dt>{name}</dt>
              <dd className="money">
                <Amount
                  text={t('home.budget.line', {
                    gasto: formatBRL(bands[i]?.spentCents ?? 0),
                    meta: formatBRL(bands[i]?.plannedCents ?? 0),
                  })}
                  hidden={hidden}
                />
              </dd>
            </div>
          ))}
        </dl>
      </Link>
    </section>
  );
}

const HEALTH_ICON = { on_track: CircleCheck, attention: TriangleAlert, over: CircleAlert } as const;

/**
 * "Saúde do mês" (D-081): uma barra por faixa do 50/30/20 sobre a renda; Necessidades e Desejos comparam o gasto
 * efetivado com a meta (teto), Poupança compara os aportes com a meta (mínimo). O estado vai em texto e ícone.
 */
export function HealthCard({ model, hidden }: { model: HomeModel; hidden: boolean }) {
  const noIncome = model.spendable.income.totalCents <= 0;
  return (
    <section className="home-block" aria-labelledby="home-health" data-testid="home-health">
      <SectionHead
        id="home-health"
        title={t('home.health.title')}
        href="/planejar/orcamento"
        link={t('home.health.adjust')}
      />
      <div className="glass home-list home-health">
        {noIncome ? (
          <div className="home-health-empty" data-testid="home-health-no-income">
            <p>{t('home.health.noIncome')}</p>
            <Link to="/ajustes/renda" className="home-pill-link" data-tone="accent">
              {t('home.hero.noIncomeCta')}
            </Link>
          </div>
        ) : (
          <ul className="home-health-bands">
            {BANDS.map(([key, name]) => {
              const b = model.buckets[key];
              const state = model.health[key];
              const Glyph = HEALTH_ICON[state];
              return (
                <li
                  key={key}
                  data-band={key}
                  data-health={state}
                  data-testid={`home-health-${key}`}
                >
                  <div className="home-health-head">
                    <span className="home-health-name">{name}</span>
                    <span className="home-health-state" data-health={state}>
                      <Glyph size={16} aria-hidden="true" />
                      {t(`home.health.${state}`)}
                    </span>
                  </div>
                  <ProgressBar
                    label={name}
                    valueCents={b.spentCents}
                    maxCents={Math.max(1, b.targetCents)}
                    tone={`band-${key}`}
                    size="xs"
                  />
                  <p className="home-health-line money">
                    <Amount
                      text={t('home.health.line', {
                        gasto: formatBRL(b.spentCents),
                        meta: formatBRL(b.targetCents),
                      })}
                      hidden={hidden}
                    />
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <Link to="/planejar/orcamento" className="home-card-link home-health-adjust">
          {t('home.health.adjust')}
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

export interface ReserveSummary {
  savedCents: number;
  targetCents: number | null;
}

export function ReserveCard({ reserve, hidden }: { reserve: ReserveSummary; hidden: boolean }) {
  const pct =
    reserve.targetCents && reserve.targetCents > 0 && reserve.savedCents > 0
      ? Math.min(100, Math.floor((reserve.savedCents * 100) / reserve.targetCents))
      : 0;
  return (
    <section className="home-block" aria-labelledby="home-reserve" data-testid="home-reserve">
      <SectionHead
        id="home-reserve"
        title={t('home.reserve.title')}
        href="/planejar/reserva"
        link={t('home.seeAll')}
      />
      <div className="glass home-list home-reserve">
        <GoalProgress
          savedCents={Math.max(0, reserve.savedCents)}
          goalCents={reserve.targetCents}
          variant="bar"
          size="sm"
          showLabel={false}
        />
        {reserve.targetCents !== null && reserve.targetCents > 0 && (
          <p className="money">
            <Amount
              text={t('home.reserve.progress', {
                valor: formatBRL(Math.max(0, reserve.savedCents)),
                meta: formatBRL(reserve.targetCents),
                p: pct,
              })}
              hidden={hidden}
            />
          </p>
        )}
        <Link to="/planejar/reserva" className="home-pill-link">
          {t('home.reserve.cta')}
        </Link>
      </div>
    </section>
  );
}

export function ReviewCard({ pending }: { pending: ReadonlyArray<{ bank: string; n: number }> }) {
  if (pending.length === 0) {
    return null;
  }
  return (
    <section className="home-block" data-testid="home-review">
      {pending.map(({ bank, n }) => (
        <Link key={bank} to="/conferir" className="glass home-list home-review">
          <Inbox size={20} aria-hidden="true" />
          <span>{t('home.review.banner', { n, banco: bank })}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      ))}
    </section>
  );
}
