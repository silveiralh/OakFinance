// Banco local por usuário (tech §4.1 e §4.2 [CONTRATO]): `oakfinance_<userId>`, com as mesmas colunas do Postgres
// (snake_case) e os campos locais começando com `_`.
import { Dexie, type Table } from 'dexie';
import type { Database } from './db-types';

type PublicTables = Database['public']['Tables'];

/** Tabelas sincronizadas que existem no aparelho (as 19 da tech §4.2). */
export const SYNCED_TABLES = [
  'profiles',
  'accounts',
  'cards',
  'invoices',
  'categories',
  'category_rules',
  'installment_plans',
  'recurrences',
  'budgets',
  'goals',
  'imports',
  'nfce_receipts',
  'transactions',
  'receipt_items',
  'reminders',
  'notices',
  'month_closings',
  'bank_connections',
  'external_accounts',
] as const satisfies readonly (keyof PublicTables)[];

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/** Linha como no Postgres + `_pending` (1 enquanto a mutação está na outbox). */
export type LocalRow<T extends SyncedTable> = PublicTables[T]['Row'] & { _pending?: 0 | 1 };

export type OutboxState = 'queued' | 'inflight' | 'rejected';

/** Entrada da outbox (tech §4.4 [CONTRATO]); coalescência e envio chegam na T-032/T-033. */
export interface OutboxEntry {
  seq?: number; // autoincremento local (ordem de aplicação)
  mutation_id: string; // UUID v7, chave de idempotência
  table: SyncedTable;
  row_id: string;
  row: Record<string, unknown>; // linha COMPLETA (todas as colunas graváveis)
  state: OutboxState;
  attempts: number;
  last_error?: string;
  created_at: string;
}

export type SyncStateKey =
  | 'cursor'
  | 'device_id'
  | 'last_push_at'
  | 'last_pull_at'
  | 'server_offset_ms'
  | 'hlc_last';

export interface SyncStateEntry {
  key: SyncStateKey;
  value: string | number | null;
}

export interface KvEntry {
  key: string;
  value: unknown;
}

/** Nome do banco local do usuário. */
export function dbName(userId: string): string {
  return `oakfinance_${userId}`;
}

export class OakDb extends Dexie {
  declare profiles: Table<LocalRow<'profiles'>, string>;
  declare accounts: Table<LocalRow<'accounts'>, string>;
  declare cards: Table<LocalRow<'cards'>, string>;
  declare invoices: Table<LocalRow<'invoices'>, string>;
  declare categories: Table<LocalRow<'categories'>, string>;
  declare category_rules: Table<LocalRow<'category_rules'>, string>;
  declare installment_plans: Table<LocalRow<'installment_plans'>, string>;
  declare recurrences: Table<LocalRow<'recurrences'>, string>;
  declare budgets: Table<LocalRow<'budgets'>, string>;
  declare goals: Table<LocalRow<'goals'>, string>;
  declare imports: Table<LocalRow<'imports'>, string>;
  declare nfce_receipts: Table<LocalRow<'nfce_receipts'>, string>;
  declare transactions: Table<LocalRow<'transactions'>, string>;
  declare receipt_items: Table<LocalRow<'receipt_items'>, string>;
  declare reminders: Table<LocalRow<'reminders'>, string>;
  declare notices: Table<LocalRow<'notices'>, string>;
  declare month_closings: Table<LocalRow<'month_closings'>, string>;
  declare bank_connections: Table<LocalRow<'bank_connections'>, string>;
  declare external_accounts: Table<LocalRow<'external_accounts'>, string>;
  declare outbox: Table<OutboxEntry, number>;
  declare sync_state: Table<SyncStateEntry, SyncStateKey>;
  declare kv: Table<KvEntry, string>;

  constructor(userId: string) {
    super(dbName(userId));
    this.version(1).stores({
      profiles: 'id',
      accounts: 'id, deleted_at',
      cards: 'id, deleted_at',
      invoices: 'id, card_id, reference_month, [card_id+reference_month]',
      categories: 'id, parent_id, slug',
      category_rules: 'id, category_id',
      installment_plans: 'id, card_id',
      recurrences: 'id',
      budgets: 'id, month',
      goals: 'id, kind',
      imports: 'id, file_sha256',
      nfce_receipts: 'id, access_key, parse_status',
      transactions:
        'id, occurred_on, invoice_id, category_id, account_id, card_id, series_id, recurrence_id, review_state, [source+external_id]',
      receipt_items: 'id, receipt_id',
      reminders: 'id, kind',
      notices: 'id, read_at, created_at',
      month_closings: 'id, month',
      bank_connections: 'id',
      external_accounts: 'id, connection_id',
      outbox: '++seq, &mutation_id, [table+row_id], state', // state: queued | inflight | rejected
      sync_state: 'key', // 'cursor', 'device_id', 'last_push_at', 'last_pull_at', 'server_offset_ms', 'hlc_last'
      kv: 'key', // conveniências locais (aba lembrada, rascunho do lançamento)
    });
  }
}

/** Apaga o banco local do usuário (logout, RN-100). */
export function deleteUserDb(userId: string): Promise<void> {
  return Dexie.delete(dbName(userId));
}
