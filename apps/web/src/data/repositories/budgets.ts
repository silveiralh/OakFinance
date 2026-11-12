// Limite mensal por categoria (US-32, RN-45, RN-92): `budgets` com `scope = 'category'`. O limite padrão vale para
// todos os meses (`month = null`); um registro do mês, se existir, prevalece.
import { categoryThresholdsBp, DEFAULT_THRESHOLDS_BP, type YearMonth } from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../db';
import { newId } from '../ids';
import { deleteRow, saveRow } from './rows';

type Budget = LocalRow<'budgets'>;

function categoryRows(budgets: readonly Budget[], categoryId: string): Budget[] {
  return budgets.filter(
    (b) =>
      b.deleted_at === null &&
      b.scope === 'category' &&
      b.category_id === categoryId &&
      b.limit_cents !== null,
  );
}

/** Limite da categoria no mês: o registro do mês, senão o padrão; `null` sem limite. */
export function categoryLimit(
  budgets: readonly Budget[],
  categoryId: string,
  month: YearMonth | null = null,
): Budget | null {
  const rows = categoryRows(budgets, categoryId);
  const own = month ? rows.find((b) => b.month?.slice(0, 7) === month) : undefined;
  return own ?? rows.find((b) => b.month === null) ?? null;
}

/** Limites vigentes no mês para `categoryBudgets` (só os maiores que zero). */
export function monthLimits(
  budgets: readonly Budget[],
  month: YearMonth,
  /** D-082: limiares do perfil; limites com o padrão (80%/100%) passam a usá-los. */
  profileThresholdsBp?: readonly number[],
): Array<{ categoryId: string; limitCents: number; alertThresholdsBp: number[] }> {
  const ids = new Set(
    budgets
      .filter((b) => b.deleted_at === null && b.scope === 'category' && b.category_id !== null)
      .map((b) => b.category_id as string),
  );
  return [...ids].flatMap((categoryId) => {
    const row = categoryLimit(budgets, categoryId, month);
    return row && (row.limit_cents ?? 0) > 0
      ? [
          {
            categoryId,
            limitCents: row.limit_cents as number,
            alertThresholdsBp: profileThresholdsBp
              ? [...categoryThresholdsBp(row.alert_thresholds_bp, profileThresholdsBp)]
              : row.alert_thresholds_bp,
          },
        ]
      : [];
  });
}

/** Define (ou tira, com 0) o limite padrão da categoria. */
export async function setCategoryLimit(
  db: OakDb,
  userId: string,
  categoryId: string,
  limitCents: number,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<void> {
  const current = categoryLimit(await db.budgets.toArray(), categoryId);
  if (limitCents <= 0) {
    if (current) {
      await deleteRow(db, 'budgets', current.id, { nowMs });
    }
    return;
  }
  if (current?.limit_cents === limitCents) {
    return;
  }
  const iso = new Date(nowMs).toISOString();
  const row: Budget = current
    ? { ...current, limit_cents: limitCents }
    : {
        id: newId(),
        user_id: userId,
        scope: 'category',
        bucket: null,
        category_id: categoryId,
        month: null,
        pct_bp: null,
        limit_cents: limitCents,
        alert_thresholds_bp: [...DEFAULT_THRESHOLDS_BP],
        created_at: iso,
        updated_at: iso,
        client_updated_at: iso,
        deleted_at: null,
        server_version: 0,
        device_id: null,
      };
  await saveRow(db, 'budgets', row, { nowMs });
}
