// P01 — Orçamento 50/30/20 (UX §3 P01, US-31, US-32): anel com a renda do mês, uma linha por faixa (valor, meta,
// percentual, barra, "já foi" / "vai sair" e status), categorias da faixa com limite opcional e o grupo "Sem faixa".
import { formatBRL, type ISODate, UNCLASSIFIED_SLUG } from '@oakfinance/domain';
import { ChartPie, ChevronDown, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { maskMoney, useValuesHidden } from '../../app/values';
import { useLive } from '../../data/live';
import { emptyStates, t } from '../../i18n/pt-BR';
import { useToday } from '../../lib/useToday';
import { BudgetRing, EmptyState, GlassCard, ProgressBar } from '../../ui';
import { loadHomeRows } from '../dashboard/data';
import { BAND_NAME, type BandView, budgetView, type CategoryLine } from './budget';
import { MonthAnalysis, useWide } from './MonthAnalysis';

const TONE = { needs: 'band-needs', wants: 'band-wants', savings: 'band-savings' } as const;

/** Status da faixa (UX §3 P01): Dentro do planejado / Restam {valor} até o limite / {valor} acima do planejado. */
export function bandStatus(band: BandView, hidden: boolean): string | null {
  const { status } = band;
  if (band.bucket === 'savings' || status.targetCents <= 0) {
    return null;
  }
  const consumed = status.spentCents + status.committedCents;
  if (status.level === 'over') {
    return t('budget.over', { valor: formatBRL(consumed - status.targetCents, { hidden }) });
  }
  if (status.level === 'warning') {
    return t('budget.near', { valor: formatBRL(status.remainingCents, { hidden }) });
  }
  return t('budget.within');
}

function CategoryRow({ line, hidden }: { line: CategoryLine; hidden: boolean }) {
  const used = line.spentCents + line.committedCents;
  return (
    <li className="budget-category" data-testid={`budget-category-${line.id}`}>
      <Link to={`/lancamentos?categoria=${line.id}`} className="budget-category-name">
        {line.name}
      </Link>
      <p className="budget-category-split money">
        {`${t('budget.spent', { valor: maskMoney(formatBRL(line.spentCents), hidden) })} · ${t(
          'budget.committed',
          { valor: maskMoney(formatBRL(line.committedCents), hidden) },
        )}`}
      </p>
      {line.limitCents !== null && (
        <>
          <p className="budget-category-limit money">
            {line.level === 'over' && <TriangleAlert size={16} aria-hidden="true" />}
            {t('budget.limitLine', {
              gasto: formatBRL(used, { hidden }),
              limite: formatBRL(line.limitCents, { hidden }),
            })}
          </p>
          <ProgressBar
            valueCents={used}
            maxCents={line.limitCents}
            size="xs"
            label={line.name}
            valueText={t('budget.limitLine', {
              gasto: formatBRL(used, { hidden }),
              limite: formatBRL(line.limitCents, { hidden }),
            })}
          />
        </>
      )}
    </li>
  );
}

function BandCard({
  band,
  hidden,
  open,
  onToggle,
}: {
  band: BandView;
  hidden: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { status, bucket } = band;
  const consumed = status.spentCents + status.committedCents;
  const pct = status.targetCents > 0 ? Math.floor((consumed * 100) / status.targetCents) : 0;
  const line =
    bucket === 'savings'
      ? t('budget.saved', {
          valor: formatBRL(status.spentCents, { hidden }),
          meta: formatBRL(status.targetCents, { hidden }),
        })
      : t('budget.line', {
          gasto: formatBRL(consumed, { hidden }),
          meta: formatBRL(status.targetCents, { hidden }),
          p: Math.max(0, pct),
        });
  const statusText = bandStatus(band, hidden);
  const listId = `budget-${bucket}-categories`;
  return (
    <GlassCard level={2} className="budget-band" data-testid={`budget-${bucket}`}>
      <button
        type="button"
        className="budget-band-head"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
      >
        <span className="budget-band-dot" data-band={bucket} aria-hidden="true" />
        <span className="budget-band-name">{BAND_NAME[bucket]}</span>
        <ChevronDown size={20} aria-hidden="true" data-open={open} />
      </button>
      <p className="budget-band-line money">{line}</p>
      <ProgressBar
        valueCents={bucket === 'savings' ? status.spentCents : consumed}
        maxCents={status.targetCents}
        tone={TONE[bucket]}
        size="md"
        label={BAND_NAME[bucket]}
        valueText={line}
      />
      <p className="budget-band-split money">
        {`${t('budget.spent', { valor: maskMoney(formatBRL(status.spentCents), hidden) })} · ${t(
          'budget.committed',
          { valor: maskMoney(formatBRL(status.committedCents), hidden) },
        )}`}
      </p>
      {statusText && (
        <p className="budget-band-status" data-level={status.level}>
          {status.level !== 'ok' && <TriangleAlert size={16} aria-hidden="true" />}
          {statusText}
        </p>
      )}
      {open && (
        <ul id={listId} className="budget-categories">
          {band.categories.map((c) => (
            <CategoryRow key={c.id} line={c} hidden={hidden} />
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

export function BudgetScreen({ today: fixedToday }: { today?: ISODate }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const wide = useWide();
  const hidden = useValuesHidden();
  const today = useToday(fixedToday);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const data = useLive(user ? () => loadHomeRows(user.db) : null, [user]);
  const view = useMemo(() => (data ? budgetView(data, today) : null), [data, today]);
  if (!view || !data) {
    return <section className="screen" data-screen="P01" data-testid="screen-P01" />;
  }
  const unclassified = data.categories.find(
    (c) => c.slug === UNCLASSIFIED_SLUG && c.deleted_at === null,
  );
  const ring = view.bands.map((b) => ({
    key: b.bucket,
    spentCents:
      b.bucket === 'savings' ? b.status.spentCents : b.status.spentCents + b.status.committedCents,
    plannedCents: b.status.targetCents,
  }));
  const toggle = (bucket: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(bucket)) {
        next.delete(bucket);
      } else {
        next.add(bucket);
      }
      return next;
    });
  return (
    <section className="screen budget" data-screen="P01" data-testid="screen-P01">
      <GlassCard level={2} className="budget-summary">
        {/* UXB-015: a renda só no centro do anel, com rótulo; sem renda, o centro fica vazio */}
        <BudgetRing
          bands={ring}
          incomeCents={view.incomeCents}
          size="lg"
          showLegend={false}
          centerLabel={t('budget.income')}
          showCenter={view.incomeCents > 0}
          amountTestId="budget-income"
        />
        {view.incomeCents <= 0 && (
          <EmptyState
            icon={ChartPie}
            title={emptyStates.budgetNoIncome.title}
            description={emptyStates.budgetNoIncome.text}
            primaryAction={{
              label: emptyStates.budgetNoIncome.actions[0],
              onPress: () => void navigate('/ajustes/renda'),
            }}
            data-testid="budget-no-income"
          />
        )}
      </GlassCard>
      {/* UXB-015: sem renda, o vazio é a única chamada (as faixas zeradas não dizem nada) */}
      {view.incomeCents > 0 &&
        view.bands.map((band) => (
          <BandCard
            key={band.bucket}
            band={band}
            hidden={hidden}
            open={open.has(band.bucket)}
            onToggle={() => toggle(band.bucket)}
          />
        ))}
      {view.unbucketed.count > 0 && (
        <GlassCard level={2} className="budget-band" data-testid="budget-unbucketed">
          <p className="budget-band-name">{t('budget.unbucketed.title')}</p>
          <p className="budget-band-line">
            {view.unbucketed.count === 1
              ? t('budget.unbucketed.one')
              : t('budget.unbucketed.count', { n: view.unbucketed.count })}
          </p>
          <Link
            to={
              unclassified
                ? `/lancamentos?categoria=${unclassified.id}`
                : '/lancamentos?filtro=review'
            }
            className="home-pill-link"
          >
            {t('budget.unbucketed.cta')}
          </Link>
        </GlassCard>
      )}
      <Link to="/ajustes/calculo" className="budget-adjust">
        {t('budget.adjust')}
      </Link>
      {wide && <MonthAnalysis rows={data} today={today} />}
    </section>
  );
}
