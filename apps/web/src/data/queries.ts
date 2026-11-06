// Filtros obrigatórios das leituras da UI (tech §4.2): nada excluído aparece, e os agregados ignoram o que foi
// cancelado ou ainda espera decisão na conferência (RN-05, RN-67).
import type { ISODate } from '@oakfinance/domain';
import type { LocalRow, OakDb, SyncedTable } from './db';

/** `review_state` que não entra em totais: vinculado a outro, ignorado ou sugestão pendente. */
export const EXCLUDED_FROM_TOTALS = ['merged', 'ignored', 'suggested'] as const;

export function isLive(row: { deleted_at: string | null }): boolean {
  return row.deleted_at === null;
}

type TotalsFields = Pick<LocalRow<'transactions'>, 'deleted_at' | 'review_state' | 'status'>;

/** Conta nos agregados (painel, orçamento, faturas): vivo, não cancelado e já decidido na conferência. */
export function countsInTotals(tx: TotalsFields): boolean {
  return (
    isLive(tx) &&
    tx.status !== 'cancelled' &&
    !(EXCLUDED_FROM_TOTALS as readonly string[]).includes(tx.review_state)
  );
}

/** Linhas não excluídas de uma tabela (listas e seletores). Todas as tabelas sincronizadas têm `deleted_at`. */
export function liveRows<T extends SyncedTable>(db: OakDb, table: T): Promise<LocalRow<T>[]> {
  return db
    .table<LocalRow<T>, string>(table)
    .filter((row) => isLive(row))
    .toArray();
}

/** Lançamentos do período (datas inclusivas) que aparecem nas listas. */
export function listedTransactions(
  db: OakDb,
  from: ISODate,
  to: ISODate,
): Promise<LocalRow<'transactions'>[]> {
  return db.transactions
    .where('occurred_on')
    .between(from, to, true, true)
    .filter(isLive)
    .sortBy('occurred_on');
}

/** Lançamentos do período que entram nos agregados. */
export function transactionsForTotals(
  db: OakDb,
  from: ISODate,
  to: ISODate,
): Promise<LocalRow<'transactions'>[]> {
  return db.transactions
    .where('occurred_on')
    .between(from, to, true, true)
    .filter(countsInTotals)
    .toArray();
}
