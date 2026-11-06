// RN-05: despesa avulsa agendada (prevista) passa a efetivada quando a data chega, na abertura do app.
import { type ISODate, todayIn } from '@oakfinance/domain';
import type { LocalRow, OakDb } from './db';
import { saveRow } from './repositories/rows';

type Tx = LocalRow<'transactions'>;

/** Despesas manuais avulsas (fora de série e recorrência) agendadas com data até hoje. */
export function dueScheduledExpenses(rows: readonly Tx[], today: ISODate): Tx[] {
  return rows.filter(
    (row) =>
      row.kind === 'expense' &&
      row.status === 'pending' &&
      row.deleted_at === null &&
      row.recurrence_id === null &&
      row.series_id === null &&
      row.source === 'manual' &&
      row.occurred_on <= today,
  );
}

export async function promoteDueExpenses(
  db: OakDb,
  today: string = todayIn('America/Sao_Paulo', new Date()),
): Promise<number> {
  let promoted = 0;
  for (const row of dueScheduledExpenses(await db.transactions.toArray(), today)) {
    if ((await saveRow(db, 'transactions', { ...row, status: 'posted' })).ok) {
      promoted += 1;
    }
  }
  return promoted;
}
