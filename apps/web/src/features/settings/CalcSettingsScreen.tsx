// S06 — Disponível para gastar e orçamento (UX §3 S01, US-34, RN-35, RN-43, RN-46, RN-47): percentuais 50/30/20
// (inteiros, soma 100%), mês do cartão, VR/VA, receitas previstas, poupança e faturas que ainda vencem, com a
// prévia do valor do mês calculada com o rascunho antes de salvar.
import {
  type AlertPcts,
  type Bucket,
  formatBRL,
  type ISODate,
  resolveBudgetConfig,
  resolveProfileSettings,
  type SpendableConfig,
  validAlertPcts,
  type YearMonth,
} from '@oakfinance/domain';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../app/auth';
import { maskMoney, useValuesHidden } from '../../app/values';
import type { LocalRow, OakDb } from '../../data/db';
import { useLive } from '../../data/live';
import { saveRow } from '../../data/repositories/rows';
import { seedBudgetId } from '../../data/seeds';
import { t, uiText } from '../../i18n/pt-BR';
import { useToday } from '../../lib/useToday';
import { Button, GlassCard, SegmentedControl, Switch, TextField, useToast } from '../../ui';
import { loadHomeRows } from '../dashboard/data';
import { type HomeRows, homeModel } from '../dashboard/model';
import { MONTH_NAMES } from '../transactions/list';

type Band = Extract<Bucket, 'needs' | 'wants' | 'savings'>;
const BANDS: readonly Band[] = ['needs', 'wants', 'savings'];
const BAND_NAME: Record<Band, string> = {
  needs: uiText.bandNeeds,
  wants: uiText.bandWants,
  savings: uiText.bandSavings,
};

export interface CalcDraft {
  spendable: SpendableConfig;
  /** Percentuais inteiros (0–100). */
  pct: Record<Band, number>;
  /** D-082: limiares de aviso em % (texto do campo, validado por `alertsProblem`). */
  alerts: { attention: string; over: string };
}

/** D-082: os limiares digitados, ou `null` se não forem inteiros com 1 ≤ atenção < passou ≤ 200. */
export function parseAlerts(alerts: CalcDraft['alerts']): AlertPcts | null {
  const toInt = (text: string) =>
    /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
  const attentionPct = toInt(alerts.attention);
  const overPct = toInt(alerts.over);
  return validAlertPcts(attentionPct, overPct) ? { attentionPct, overPct } : null;
}

/** Rascunho a partir do perfil e dos `budgets` do mês. */
export function draftFrom(rows: HomeRows, month: YearMonth): CalcDraft {
  const settings = resolveProfileSettings(rows.profile?.settings ?? {});
  const budget = resolveBudgetConfig(budgetInputs(rows.budgets), month);
  return {
    spendable: settings.spendable,
    alerts: {
      attention: String(settings.alerts.attentionPct),
      over: String(settings.alerts.overPct),
    },
    pct: {
      needs: Math.round(budget.pctBp.needs / 100),
      wants: Math.round(budget.pctBp.wants / 100),
      savings: Math.round(budget.pctBp.savings / 100),
    },
  };
}

function budgetInputs(rows: readonly LocalRow<'budgets'>[]) {
  return rows
    .filter((b) => b.deleted_at === null)
    .map((b) => ({
      month: b.month === null ? null : (b.month.slice(0, 7) as YearMonth),
      scope: b.scope,
      bucket: (BANDS as readonly string[]).includes(b.bucket ?? '') ? (b.bucket as Band) : null,
      pctBp: b.pct_bp,
      alertThresholdsBp: b.alert_thresholds_bp,
    }));
}

/** RN-43: inteiros de 0 a 100 com soma exatamente 100; devolve a soma quando não fecha. */
export function percentProblem(pct: Record<Band, number>): number | null {
  const sum = pct.needs + pct.wants + pct.savings;
  const valid = BANDS.every((b) => Number.isInteger(pct[b]) && pct[b] >= 0 && pct[b] <= 100);
  return valid && sum === 100 ? null : sum;
}

function bucketRow(
  rows: readonly LocalRow<'budgets'>[],
  userId: string,
  band: Band,
  pct: number,
  iso: string,
): LocalRow<'budgets'> {
  const current = rows.find(
    (b) => b.deleted_at === null && b.scope === 'bucket' && b.bucket === band && b.month === null,
  );
  return current
    ? { ...current, pct_bp: pct * 100 }
    : {
        id: seedBudgetId(userId, band),
        user_id: userId,
        scope: 'bucket',
        bucket: band,
        category_id: null,
        month: null,
        pct_bp: pct * 100,
        limit_cents: null,
        alert_thresholds_bp: [8000, 10000],
        created_at: iso,
        updated_at: iso,
        client_updated_at: iso,
        deleted_at: null,
        server_version: 0,
        device_id: null,
      };
}

/** As linhas como ficariam depois de salvar (para a prévia e para gravar). */
export function applyDraft(rows: HomeRows, draft: CalcDraft, userId: string): HomeRows {
  const iso = new Date().toISOString();
  const updated = BANDS.map((band) => bucketRow(rows.budgets, userId, band, draft.pct[band], iso));
  const ids = new Set(updated.map((r) => r.id));
  const raw =
    rows.profile && typeof rows.profile.settings === 'object' && rows.profile.settings !== null
      ? (rows.profile.settings as Record<string, unknown>)
      : {};
  return {
    ...rows,
    budgets: [...rows.budgets.filter((b) => !ids.has(b.id)), ...updated],
    profile: rows.profile
      ? {
          ...rows.profile,
          settings: {
            ...raw,
            spendable: { ...draft.spendable },
            alerts: { ...(parseAlerts(draft.alerts) ?? resolveProfileSettings(raw).alerts) },
          } as LocalRow<'profiles'>['settings'],
        }
      : rows.profile,
  };
}

export async function saveDraft(
  db: OakDb,
  rows: HomeRows,
  draft: CalcDraft,
  userId: string,
): Promise<void> {
  const next = applyDraft(rows, draft, userId);
  if (next.profile) {
    await saveRow(db, 'profiles', next.profile);
  }
  for (const band of BANDS) {
    const row = next.budgets.find(
      (b) => b.deleted_at === null && b.scope === 'bucket' && b.bucket === band && b.month === null,
    );
    const before = rows.budgets.find((b) => b.id === row?.id);
    if (row && before?.pct_bp !== row.pct_bp) {
      await saveRow(db, 'budgets', row);
    }
  }
}

export function CalcSettingsScreen({ today: fixedToday }: { today?: ISODate }) {
  const { user } = useAuth();
  const hidden = useValuesHidden();
  const showToast = useToast();
  const today = useToday(fixedToday);
  const month = today.slice(0, 7) as YearMonth;
  const rows = useLive(user ? () => loadHomeRows(user.db) : null, [user]);
  const [draft, setDraft] = useState<CalcDraft | null>(null);
  useEffect(() => {
    if (rows && draft === null) {
      setDraft(draftFrom(rows, month));
    }
  }, [rows, draft, month]);
  const preview = useMemo(
    () => (rows && draft && user ? homeModel(applyDraft(rows, draft, user.userId), today) : null),
    [rows, draft, user, today],
  );
  if (!user || !rows || !draft) {
    return <section className="screen" data-screen="S06" data-testid="screen-S06" />;
  }
  const sum = percentProblem(draft.pct);
  const alertsOk = parseAlerts(draft.alerts) !== null;
  const setAlert = (key: 'attention' | 'over', value: string) =>
    setDraft({ ...draft, alerts: { ...draft.alerts, [key]: value } });
  const set = (change: Partial<SpendableConfig>) =>
    setDraft({ ...draft, spendable: { ...draft.spendable, ...change } });
  const setPct = (band: Band, value: number) =>
    setDraft({ ...draft, pct: { ...draft.pct, [band]: value } });
  const save = async () => {
    if (sum !== null || !alertsOk) {
      return;
    }
    await saveDraft(user.db, rows, draft, user.userId);
    user.engine.notifyWrite();
    showToast({ message: t('calc.saved'), tone: 'success' });
  };
  const monthName = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? '';
  const s = preview?.spendable;
  return (
    <section className="screen calc" data-screen="S06" data-testid="screen-S06">
      <GlassCard level={2} className="calc-block">
        <fieldset className="calc-pcts">
          <legend>{t('calc.percentages')}</legend>
          {BANDS.map((band) => (
            <label key={band} className="calc-pct">
              <span>{BAND_NAME[band]}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={draft.pct[band]}
                aria-valuetext={t('calc.pct', { p: draft.pct[band] })}
                onChange={(e) => setPct(band, Number(e.target.value))}
                data-testid={`calc-pct-${band}`}
              />
              <output>{t('calc.pct', { p: draft.pct[band] })}</output>
            </label>
          ))}
          {sum !== null && (
            <p className="calc-error" role="alert" data-testid="calc-sum-error">
              {t('budget.sumError', { x: sum })}
            </p>
          )}
        </fieldset>
      </GlassCard>
      <GlassCard level={2} className="calc-block">
        {/* UXC-008: a pergunta fica visível (como na S08); sem ela as opções não fazem sentido */}
        <p className="appearance-label" aria-hidden="true" data-testid="calc-card-month-label">
          {t('calc.cardMonth')}
        </p>
        <SegmentedControl
          label={t('calc.cardMonth')}
          value={draft.spendable.cardAttribution}
          onChange={(cardAttribution) => set({ cardAttribution })}
          options={[
            { value: 'invoice_due_month', label: t('calc.cardMonth.due') },
            { value: 'purchase_month', label: t('calc.cardMonth.purchase') },
          ]}
        />
        <Switch
          label={t('calc.restricted')}
          checked={draft.spendable.includeRestrictedAccounts}
          onChange={(includeRestrictedAccounts) => set({ includeRestrictedAccounts })}
        />
        <Switch
          label={t('calc.expected')}
          description={t('calc.expectedHint')}
          checked={draft.spendable.includeExpectedIncome}
          onChange={(includeExpectedIncome) => set({ includeExpectedIncome })}
        />
        <Switch
          label={t('calc.savings', { p: draft.pct.savings })}
          checked={draft.spendable.savingsMode === 'target'}
          onChange={(on) => set({ savingsMode: on ? 'target' : 'none' })}
        />
        <Switch
          label={t('calc.upcoming')}
          checked={draft.spendable.includeUpcoming}
          onChange={(includeUpcoming) => set({ includeUpcoming })}
          {...(draft.spendable.includeUpcoming ? {} : { description: t('calc.upcomingOff') })}
        />
      </GlassCard>
      <GlassCard level={2} className="calc-block" title={t('calc.alerts.title')} headingLevel={2}>
        <p className="account-meta">{t('calc.alerts.hint')}</p>
        <TextField
          label={t('calc.alerts.attention')}
          inputMode="numeric"
          value={draft.alerts.attention}
          onChange={(value) => setAlert('attention', value)}
          data-testid="calc-alert-attention"
        />
        <TextField
          label={t('calc.alerts.over')}
          inputMode="numeric"
          value={draft.alerts.over}
          onChange={(value) => setAlert('over', value)}
          data-testid="calc-alert-over"
          {...(alertsOk ? {} : { error: t('calc.alerts.error') })}
        />
      </GlassCard>
      <p className="calc-preview money" role="status" data-testid="calc-preview">
        {s && s.status !== 'no_income'
          ? t('calc.preview', {
              valor: maskMoney(formatBRL(s.availableCents), hidden),
              mês: monthName,
            })
          : t('calc.previewNoIncome')}
      </p>
      <Button
        fullWidth
        disabled={sum !== null || !alertsOk}
        onClick={() => void save()}
        data-testid="calc-save"
      >
        {t('calc.save')}
      </Button>
    </section>
  );
}
