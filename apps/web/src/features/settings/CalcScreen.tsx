// S06 — Disponível para gastar e orçamento (UX §3 S01, US-34): percentuais 50/30/20 (sliders com o valor em texto,
// soma obrigatória de 100%, RN-43), mês das compras no cartão (RN-46), VR/VA (RN-35), receitas previstas, poupança e
// saídas que ainda vencem, com a prévia do Disponível do mês recalculada a cada mudança (RN-47).
import { type Bucket, formatBRL, type ISODate, type YearMonth } from '@oakfinance/domain';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../app/auth';
import { Amount, useValuesHidden } from '../../app/values';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { useToday } from '../../lib/useToday';
import { Button, GlassCard, SegmentedControl, Switch, useToast } from '../../ui';
import { BAND_NAME } from '../budget/budget';
import { loadHomeRows } from '../dashboard/data';
import { MONTH_NAMES } from '../transactions/list';
import {
  BUCKETS,
  type CalcDraft,
  calcDraft,
  calcPreview,
  clampPercent,
  percentSum,
  saveCalcSettings,
} from './calc';

function monthName(month: YearMonth): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? '';
}

function PercentSlider({
  bucket,
  value,
  onChange,
}: {
  bucket: Bucket;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = `calc-pct-${bucket}`;
  const text = t('calc.pct.value', { p: value });
  return (
    <div className="calc-slider" data-testid={id}>
      <div className="calc-slider-label">
        <label htmlFor={id}>{BAND_NAME[bucket]}</label>
        <span className="calc-slider-value" aria-hidden="true">
          {text}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-valuetext={text}
        onChange={(e) => onChange(clampPercent(Number(e.target.value)))}
      />
    </div>
  );
}

export function CalcScreen({ today: fixedToday }: { today?: ISODate }) {
  const { user } = useAuth();
  const showToast = useToast();
  const hidden = useValuesHidden();
  const today = useToday(fixedToday);
  const rows = useLive(user ? () => loadHomeRows(user.db) : null, [user]);
  const saved = useMemo(() => (rows ? calcDraft(rows, today) : null), [rows, today]);
  const [draft, setDraft] = useState<CalcDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // o rascunho começa nos valores salvos; uma mudança vinda de outro aparelho só entra se nada foi editado aqui
  useEffect(() => {
    if (saved && draft === null) {
      setDraft(saved);
    }
  }, [saved, draft]);

  const current = draft ?? saved;
  const preview = useMemo(
    () => (rows && current ? calcPreview(rows, today, current) : null),
    [rows, today, current],
  );
  if (!rows || !current || !preview) {
    return <section className="screen" data-screen="S06" aria-busy="true" />;
  }
  const month = today.slice(0, 7) as YearMonth;
  const sum = percentSum(current.pct);
  const sumError = sum === 100 ? null : t('budget.sumError', { x: sum });

  const update = (next: Partial<CalcDraft['config']>) =>
    setDraft({ ...current, config: { ...current.config, ...next } });
  const setPct = (bucket: Bucket, value: number) =>
    setDraft({ ...current, pct: { ...current.pct, [bucket]: value } });

  const save = async () => {
    if (!user || busy) {
      return;
    }
    if (sumError) {
      setError(sumError);
      return;
    }
    setBusy(true);
    const result = await saveCalcSettings(user.db, user.userId, current, month);
    setBusy(false);
    if (!result.ok) {
      setError(
        result.error === 'invalidPercents'
          ? t('budget.sumError', { x: sum })
          : result.error === 'noProfile'
            ? t('calc.noProfile')
            : result.error.message,
      );
      return;
    }
    setError(null);
    user.engine.notifyWrite();
    showToast({ message: t('calc.saved'), tone: 'success' });
  };

  return (
    <section className="screen calc" data-screen="S06" data-testid="screen-S06">
      <GlassCard level={2} className="calc-preview" data-testid="calc-preview">
        <p className="calc-preview-line" aria-live="polite">
          {(() => {
            const [before = '', after = ''] = t('calc.preview', { mês: monthName(month) }).split(
              '{valor}',
            );
            return (
              <>
                {before}
                <strong className="money" data-testid="calc-preview-money">
                  <Amount text={formatBRL(preview.availableCents)} hidden={hidden} />
                </strong>
                {after}
              </>
            );
          })()}
        </p>
        {preview.availableCents > 0 && (
          <p className="calc-preview-day money">
            {t('calc.perDay', { valor: formatBRL(preview.perDayCents, { hidden }) })}
          </p>
        )}
      </GlassCard>

      <GlassCard level={2} className="calc-group">
        <fieldset className="calc-percents">
          <legend>{t('calc.pct.title')}</legend>
          <p className="field-hint">{t('calc.pct.hint')}</p>
          {BUCKETS.map((bucket) => (
            <PercentSlider
              key={bucket}
              bucket={bucket}
              value={current.pct[bucket]}
              onChange={(value) => setPct(bucket, value)}
            />
          ))}
        </fieldset>
        {sumError && (
          <p className="field-error" role="alert" data-testid="calc-sum-error">
            {sumError}
          </p>
        )}
      </GlassCard>

      <GlassCard level={2} className="calc-group">
        <p className="calc-group-title" aria-hidden="true">
          {t('calc.card.title')}
        </p>
        <SegmentedControl
          label={t('calc.card.title')}
          value={current.config.cardAttribution}
          onChange={(cardAttribution) => update({ cardAttribution })}
          options={[
            { value: 'invoice_due_month', label: t('calc.card.due') },
            { value: 'purchase_month', label: t('calc.card.purchase') },
          ]}
          data-testid="calc-card"
        />
      </GlassCard>

      <GlassCard level={2} className="calc-group">
        <Switch
          label={t('calc.restricted')}
          description={t('calc.restricted.hint')}
          checked={current.config.includeRestrictedAccounts}
          onChange={(includeRestrictedAccounts) => update({ includeRestrictedAccounts })}
          data-testid="calc-restricted"
        />
        <Switch
          label={t('calc.expected')}
          description={t('calc.expected.hint')}
          checked={current.config.includeExpectedIncome}
          onChange={(includeExpectedIncome) => update({ includeExpectedIncome })}
          data-testid="calc-expected"
        />
        <Switch
          label={t('calc.savings', { p: current.pct.savings })}
          checked={current.config.savingsMode === 'target'}
          onChange={(on) => update({ savingsMode: on ? 'target' : 'none' })}
          data-testid="calc-savings"
        />
        <Switch
          label={t('calc.upcoming')}
          checked={current.config.includeUpcoming}
          onChange={(includeUpcoming) => update({ includeUpcoming })}
          data-testid="calc-upcoming"
        />
        {!current.config.includeUpcoming && (
          <p className="calc-warning" role="status" data-testid="calc-upcoming-off">
            <TriangleAlert size={16} aria-hidden="true" />
            {t('calc.upcoming.off')}
          </p>
        )}
      </GlassCard>

      {error && error !== sumError && (
        <p className="field-error" role="alert" data-testid="calc-error">
          {error}
        </p>
      )}
      <div className="detail-actions">
        <Button onClick={() => void save()} disabled={busy} data-testid="calc-save">
          {t('calc.save')}
        </Button>
      </div>
    </section>
  );
}
