// Análise do mês (US-35, UX §3 P01 em `lg`): os 5 blocos lado a lado, cada um com "Ver como tabela", e o seletor
// de mês. Os gráficos são barras simples (decorativas, `aria-hidden`); a tabela é a versão acessível.
import { formatBRL, type ISODate, monthLabel, type YearMonth } from '@oakfinance/domain';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Amount, useValuesHidden } from '../../app/values';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { Button, GlassCard, Select } from '../../ui';
import type { HomeRows } from '../dashboard/model';
import { analysisMonths, monthAnalysis } from './analysis';

export const WIDE_QUERY = '(min-width: 1024px)';

/** `true` em telas ≥ 1024 px (acompanha a mudança de largura). */
export function useWide(query = WIDE_QUERY): boolean {
  const get = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);
  const [wide, setWide] = useState(get);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) {
      return;
    }
    const onChange = () => setWide(list.matches);
    list.addEventListener?.('change', onChange);
    return () => list.removeEventListener?.('change', onChange);
  }, [query]);
  return wide;
}

function pct(value: number, max: number): string {
  return `${max > 0 ? Math.max(0, Math.min(100, Math.round((value * 100) / max))) : 0}%`;
}

function Block({
  id,
  title,
  chart,
  table,
  empty,
}: {
  id: string;
  title: string;
  chart: ReactNode;
  table: ReactNode;
  empty: boolean;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <GlassCard level={2} className="analysis-block" data-testid={`analysis-${id}`}>
      <h3 id={`analysis-${id}-title`}>{title}</h3>
      {empty ? (
        <p className="account-meta">{t('analysis.empty')}</p>
      ) : (
        <>
          {asTable ? table : <div aria-hidden="true">{chart}</div>}
          {/* T-096: alvo de 48 px (2.5.5) */}
          <Button variant="ghost" onClick={() => setAsTable((v) => !v)}>
            {asTable ? t('analysis.chart') : t('analysis.table')}
          </Button>
        </>
      )}
    </GlassCard>
  );
}

function Bar({
  label,
  value,
  max,
  text,
}: {
  label: string;
  value: number;
  max: number;
  text: ReactNode;
}) {
  return (
    <div className="analysis-bar">
      <span className="analysis-bar-label">{label}</span>
      <span className="analysis-bar-track">
        <span className="analysis-bar-fill" style={{ width: pct(value, max) }} />
      </span>
      <span className="analysis-bar-value money">{text}</span>
    </div>
  );
}

export function MonthAnalysis({ rows, today }: { rows: HomeRows; today: ISODate }) {
  const hidden = useValuesHidden();
  const months = analysisMonths(today);
  const [month, setMonth] = useState<YearMonth>(months[0] as YearMonth);
  const view = useMemo(
    () => monthAnalysis(rows, month, today, t('analysis.noCategory')),
    [rows, month, today],
  );
  const money = (cents: number) => <Amount text={formatBRL(cents)} hidden={hidden} />;
  const maxCategory = Math.max(0, ...view.byCategory.map((c) => c.spentCents));
  const maxBand = Math.max(0, ...view.bands.flatMap((b) => [b.spentCents, b.targetCents]));
  const lastPoint = view.daily.at(-1);
  const maxDaily = Math.max(lastPoint?.actualCents ?? 0, lastPoint?.idealCents ?? 0);
  const maxCompare = Math.max(0, ...view.compare.flatMap((c) => [c.currentCents, c.previousCents]));
  const th = (key: Parameters<typeof t>[0]) => <th scope="col">{t(key)}</th>;

  return (
    <section className="analysis" aria-labelledby="analysis-title" data-testid="month-analysis">
      <header className="analysis-head">
        <h2 id="analysis-title">{t('analysis.title')}</h2>
        <Select
          label={t('analysis.month')}
          value={month}
          onChange={(m) => setMonth(m as YearMonth)}
          options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
          data-testid="analysis-month"
        />
      </header>
      <p className="account-meta" data-testid="analysis-current">
        {monthLabel(view.month)}
      </p>
      <div className="analysis-grid">
        <Block
          id="categories"
          title={t('analysis.byCategory')}
          empty={view.byCategory.length === 0}
          chart={view.byCategory.map((c) => (
            <Bar
              key={c.id}
              label={c.name}
              value={c.spentCents}
              max={maxCategory}
              text={money(c.spentCents)}
            />
          ))}
          table={
            <table>
              <caption className="sr-only">{t('analysis.byCategory')}</caption>
              <thead>
                <tr>
                  {th('analysis.col.category')}
                  {th('analysis.col.spent')}
                </tr>
              </thead>
              <tbody>
                {view.byCategory.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="money">{money(c.spentCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
        <Block
          id="bands"
          title={t('analysis.bands')}
          empty={false}
          chart={view.bands.map((b) => (
            <Bar
              key={b.bucket}
              label={b.name}
              value={b.spentCents}
              max={maxBand}
              text={
                <>
                  {money(b.spentCents)} / {money(b.targetCents)}
                </>
              }
            />
          ))}
          table={
            <table>
              <caption className="sr-only">{t('analysis.bands')}</caption>
              <thead>
                <tr>
                  {th('analysis.col.band')}
                  {th('analysis.col.spent')}
                  {th('analysis.col.target')}
                </tr>
              </thead>
              <tbody>
                {view.bands.map((b) => (
                  <tr key={b.bucket}>
                    <td>{b.name}</td>
                    <td className="money">{money(b.spentCents)}</td>
                    <td className="money">{money(b.targetCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
        <Block
          id="daily"
          title={t('analysis.daily')}
          empty={view.daily.length === 0}
          chart={
            <div className="analysis-days">
              {view.daily.map((d) => (
                <span key={d.day} className="analysis-day">
                  <span
                    className="analysis-day-ideal"
                    style={{ height: pct(d.idealCents, maxDaily) }}
                  />
                  <span
                    className="analysis-day-actual"
                    style={{ height: pct(d.actualCents, maxDaily) }}
                  />
                </span>
              ))}
            </div>
          }
          table={
            <table>
              <caption className="sr-only">{t('analysis.daily')}</caption>
              <thead>
                <tr>
                  {th('analysis.col.day')}
                  {th('analysis.actual')}
                  {th('analysis.ideal')}
                </tr>
              </thead>
              <tbody>
                {view.daily.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td className="money">{money(d.actualCents)}</td>
                    <td className="money">{money(d.idealCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
        <Block
          id="compare"
          title={t('analysis.compare')}
          empty={view.compare.length === 0}
          chart={view.compare.map((c) => (
            <Bar
              key={c.id}
              label={c.name}
              value={c.currentCents}
              max={maxCompare}
              text={
                <>
                  {money(c.currentCents)} ({c.diffCents >= 0 ? '+' : '−'}
                  {money(Math.abs(c.diffCents))})
                </>
              }
            />
          ))}
          table={
            <table>
              <caption className="sr-only">{t('analysis.compare')}</caption>
              <thead>
                <tr>
                  {th('analysis.col.category')}
                  {th('analysis.col.current')}
                  {th('analysis.col.previous')}
                  {th('analysis.col.diff')}
                </tr>
              </thead>
              <tbody>
                {view.compare.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="money">{money(c.currentCents)}</td>
                    <td className="money">{money(c.previousCents)}</td>
                    <td className="money">
                      {c.diffCents < 0 ? '−' : ''}
                      {money(Math.abs(c.diffCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
        <Block
          id="top"
          title={t('analysis.top')}
          empty={view.top.length === 0}
          chart={view.top.map((e) => (
            <Bar
              key={e.id}
              label={e.description || e.category}
              value={e.amountCents}
              max={view.top[0]?.amountCents ?? 0}
              text={money(e.amountCents)}
            />
          ))}
          table={
            <table>
              <caption className="sr-only">{t('analysis.top')}</caption>
              <thead>
                <tr>
                  {th('analysis.col.date')}
                  {th('analysis.col.description')}
                  {th('analysis.col.category')}
                  {th('analysis.col.amount')}
                </tr>
              </thead>
              <tbody>
                {view.top.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateBR(e.date)}</td>
                    <td>{e.description}</td>
                    <td>{e.category}</td>
                    <td className="money">{money(e.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </div>
    </section>
  );
}
