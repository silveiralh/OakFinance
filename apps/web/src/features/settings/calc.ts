// S06 — Ajustes do cálculo (US-34, RN-35, RN-43, RN-46, RN-47): rascunho dos percentuais 50/30/20 e das preferências
// do "Disponível para gastar", prévia do valor com o rascunho e gravação (profiles.settings.spendable + budgets).
import {
  type Bucket,
  type ISODate,
  type SpendableBreakdown,
  type SpendableConfig,
  spendableThisMonth,
  type YearMonth,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { putInTransaction, writeScope } from '../../data/repositories/rows';
import { err, type Result } from '../../data/result';
import { seedBudgetId } from '../../data/seeds';
import { writeLocal } from '../../data/storage';
import { deviceId } from '../../data/sync/clock';
import { type HomeRows, monthContext, monthInputFromRows } from '../dashboard/model';

export const BUCKETS: readonly Bucket[] = ['needs', 'wants', 'savings'];

/** Percentuais inteiros de 0 a 100 (RN-43). */
export type Percents = Record<Bucket, number>;

export interface CalcDraft {
  pct: Percents;
  config: SpendableConfig;
}

/** Valores em vigor no mês de hoje (o rascunho começa igual a eles). */
export function calcDraft(rows: HomeRows, today: ISODate): CalcDraft {
  const { config, budget } = monthContext(rows, today);
  return {
    pct: {
      needs: Math.round(budget.pctBp.needs / 100),
      wants: Math.round(budget.pctBp.wants / 100),
      savings: Math.round(budget.pctBp.savings / 100),
    },
    config: { ...config },
  };
}

/** RN-43: inteiro de 0 a 100 (o resto é recortado). */
export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
}

export function percentSum(pct: Percents): number {
  return pct.needs + pct.wants + pct.savings;
}

/** RN-43: a soma deve ser exatamente 100. */
export function percentsValid(pct: Percents): boolean {
  return (
    BUCKETS.every((b) => Number.isInteger(pct[b]) && pct[b] >= 0 && pct[b] <= 100) &&
    percentSum(pct) === 100
  );
}

/** Prévia do Disponível do mês com o rascunho (mesma fórmula do H01, RN-47). */
export function calcPreview(rows: HomeRows, today: ISODate, draft: CalcDraft): SpendableBreakdown {
  const { month, budget } = monthContext(rows, today);
  const input = monthInputFromRows(
    rows,
    month,
    today,
    draft.config.cardAttribution,
    draft.config.includeRestrictedAccounts,
  );
  return spendableThisMonth(
    input,
    {
      ...budget,
      pctBp: {
        needs: draft.pct.needs * 100,
        wants: draft.pct.wants * 100,
        savings: draft.pct.savings * 100,
      },
    },
    draft.config,
  );
}

function settingsRecord(profile: LocalRow<'profiles'>): Record<string, unknown> {
  const raw = profile.settings;
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** Linha padrão (month = null) da faixa: a que existe, senão a do id fixo do seed (D-015). */
function bucketRow(
  budgets: readonly LocalRow<'budgets'>[],
  userId: string,
  bucket: Bucket,
  pctBp: number,
  iso: string,
): LocalRow<'budgets'> {
  const alive = budgets.find(
    (b) => b.deleted_at === null && b.scope === 'bucket' && b.bucket === bucket && b.month === null,
  );
  if (alive) {
    return { ...alive, pct_bp: pctBp };
  }
  const id = seedBudgetId(userId, bucket);
  const tomb = budgets.find((b) => b.id === id);
  return {
    ...(tomb ?? {
      user_id: userId,
      scope: 'bucket',
      bucket,
      category_id: null,
      month: null,
      limit_cents: null,
      alert_thresholds_bp: [8000, 10000],
      created_at: iso,
      server_version: 0,
      device_id: null,
    }),
    id,
    updated_at: iso,
    client_updated_at: iso,
    deleted_at: null,
    pct_bp: pctBp,
  } as LocalRow<'budgets'>;
}

export type SaveCalcError = 'invalidPercents' | 'noProfile';

/**
 * Grava numa única transação as preferências (`profiles.settings.spendable`, preservando os outros campos) e os
 * percentuais padrão de cada faixa (`budgets`, scope 'bucket', month = null). Só grava a faixa que mudou. Se o mês
 * de hoje tiver um registro próprio da faixa (que prevalece sobre o padrão), ele recebe o mesmo percentual, para o
 * valor salvo ser o da prévia.
 */
export async function saveCalcSettings(
  db: OakDb,
  userId: string,
  draft: CalcDraft,
  month: YearMonth,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<Result<true> | Result<never, SaveCalcError>> {
  if (!percentsValid(draft.pct)) {
    return err<SaveCalcError>('invalidPercents');
  }
  const profile = await db.profiles.toCollection().first();
  if (!profile) {
    return err<SaveCalcError>('noProfile');
  }
  const budgets = await db.budgets.toArray();
  const iso = new Date(nowMs).toISOString();
  const device = await deviceId(db);
  return writeLocal(() =>
    db.transaction('rw', writeScope(['profiles', 'budgets']), async () => {
      await putInTransaction(
        db,
        'profiles',
        { ...profile, settings: { ...settingsRecord(profile), spendable: { ...draft.config } } },
        device,
        nowMs,
      );
      for (const bucket of BUCKETS) {
        const pctBp = draft.pct[bucket] * 100;
        const current = budgets.find(
          (b) =>
            b.deleted_at === null &&
            b.scope === 'bucket' &&
            b.bucket === bucket &&
            b.month === null,
        );
        if (current?.pct_bp === pctBp) {
          continue;
        }
        await putInTransaction(
          db,
          'budgets',
          bucketRow(budgets, userId, bucket, pctBp, iso),
          device,
          nowMs,
        );
      }
      const own = budgets.filter(
        (b) =>
          b.deleted_at === null &&
          b.scope === 'bucket' &&
          b.bucket !== null &&
          b.month?.slice(0, 7) === month &&
          b.pct_bp !== draft.pct[b.bucket as Bucket] * 100,
      );
      for (const row of own) {
        await putInTransaction(
          db,
          'budgets',
          { ...row, pct_bp: draft.pct[row.bucket as Bucket] * 100 },
          device,
          nowMs,
        );
      }
      return true as const;
    }),
  );
}
