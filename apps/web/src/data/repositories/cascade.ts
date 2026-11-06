// Exclusão em cascata no repositório, não no banco (tech §4.4): tudo na mesma transação Dexie, como mutações
// separadas na outbox. Cartão → faturas e transações; série → parcelas; recibo → itens.
import type { LocalRow, OakDb, SyncedTable } from '../db';
import type { Result } from '../result';
import { writeLocal } from '../storage';
import { deviceId } from '../sync/clock';
import { putInTransaction, type WriteOptions, writeScope } from './rows';

interface Child {
  table: SyncedTable;
  ids: string[];
}

async function cascadeDelete(
  db: OakDb,
  parent: { table: SyncedTable; id: string },
  children: (db: OakDb) => Promise<Child[]>,
  tables: readonly SyncedTable[],
  nowMs: number,
): Promise<Result<number>> {
  const device = await deviceId(db);
  const deletedAt = new Date(nowMs).toISOString();
  return writeLocal(() =>
    db.transaction('rw', writeScope([parent.table, ...tables]), async () => {
      let count = 0;
      const remove = async (table: SyncedTable, id: string) => {
        const row = (await db.table(table).get(id)) as LocalRow<SyncedTable> | undefined;
        if (row && row.deleted_at === null) {
          await putInTransaction(db, table, { ...row, deleted_at: deletedAt }, device, nowMs);
          count += 1;
        }
      };
      for (const child of await children(db)) {
        for (const id of child.ids) {
          await remove(child.table, id);
        }
      }
      await remove(parent.table, parent.id);
      return count;
    }),
  );
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

/** Exclui o cartão, as faturas e as transações dele. Devolve quantas linhas foram excluídas. */
export function deleteCard(
  db: OakDb,
  cardId: string,
  { nowMs = Date.now() }: WriteOptions = {},
): Promise<Result<number>> {
  return cascadeDelete(
    db,
    { table: 'cards', id: cardId },
    async (d) => [
      {
        table: 'transactions',
        ids: ids(await d.transactions.where('card_id').equals(cardId).toArray()),
      },
      { table: 'invoices', ids: ids(await d.invoices.where('card_id').equals(cardId).toArray()) },
    ],
    ['transactions', 'invoices'],
    nowMs,
  );
}

/** Exclui a série de parcelas (`installment_plans`) e as parcelas dela (`transactions.series_id`). */
export function deleteSeries(
  db: OakDb,
  seriesId: string,
  { nowMs = Date.now() }: WriteOptions = {},
): Promise<Result<number>> {
  return cascadeDelete(
    db,
    { table: 'installment_plans', id: seriesId },
    async (d) => [
      {
        table: 'transactions',
        ids: ids(await d.transactions.where('series_id').equals(seriesId).toArray()),
      },
    ],
    ['transactions'],
    nowMs,
  );
}

/** Exclui o recibo da NFC-e e os itens dele. */
export function deleteReceipt(
  db: OakDb,
  receiptId: string,
  { nowMs = Date.now() }: WriteOptions = {},
): Promise<Result<number>> {
  return cascadeDelete(
    db,
    { table: 'nfce_receipts', id: receiptId },
    async (d) => [
      {
        table: 'receipt_items',
        ids: ids(await d.receipt_items.where('receipt_id').equals(receiptId).toArray()),
      },
    ],
    ['receipt_items'],
    nowMs,
  );
}
