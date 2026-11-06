// Seeds por usuário (tech §3.8, RN-40, RN-64): categorias, regras padrão, lembretes, orçamento 50/30/20 e reserva,
// criados no aparelho com ids v5 numa única transação Dexie. Idempotente: linha que já existe — inclusive como
// tombstone (o usuário apagou) — não é recriada.
import {
  DEFAULT_BUDGET_PCT_BP,
  DEFAULT_CATEGORIES,
  DEFAULT_REMINDERS,
  DEFAULT_RESERVE,
  DEFAULT_RULES,
  reserveGoalId,
  seedCategoryId,
  seedReminderId,
  seedRuleId,
} from '@oakfinance/domain';
import { v5 } from 'uuid';
import type { LocalRow, OakDb, SyncedTable } from './db';
import { putInTransaction, writeScope } from './repositories/rows';
import type { Result } from './result';
import { writeLocal } from './storage';
import { deviceId } from './sync/clock';

/** Namespace fixo do orçamento padrão (D-015): um id por faixa e usuário, igual em todos os aparelhos. */
export const NS_SEED_BUDGET = 'fa2f19ee-6637-40fd-8652-25092e5fb561';

export function seedBudgetId(userId: string, bucket: string): string {
  return v5(`${userId}:${bucket}`, NS_SEED_BUDGET);
}

type SeedRow = { table: SyncedTable; row: LocalRow<SyncedTable> };

/** Colunas que o servidor preenche (o push as ignora); localmente ficam com valores neutros até o pull. */
function base(userId: string, iso: string) {
  return {
    user_id: userId,
    created_at: iso,
    updated_at: iso,
    server_version: 0,
    client_updated_at: iso,
    device_id: null,
    deleted_at: null,
  };
}

/** Todas as linhas de seed do usuário, na ordem em que entram na outbox (pais antes dos filhos). */
export function seedRows(userId: string, iso: string): SeedRow[] {
  const rows: SeedRow[] = [];
  const add = <T extends SyncedTable>(table: T, row: LocalRow<T>) =>
    rows.push({ table, row: row as LocalRow<SyncedTable> });
  DEFAULT_CATEGORIES.forEach((category, index) => {
    add('categories', {
      ...base(userId, iso),
      id: seedCategoryId(userId, category.slug),
      slug: category.slug,
      name: category.name,
      name_ci: category.name.toLowerCase(),
      kind: category.kind,
      bucket: category.bucket,
      feeds_reserve: category.feedsReserve,
      is_system: category.isSystem,
      is_default: true,
      icon: category.icon,
      color: null,
      parent_id: null,
      archived_at: null,
      sort_order: index,
    });
  });
  for (const rule of DEFAULT_RULES) {
    add('category_rules', {
      ...base(userId, iso),
      id: seedRuleId(userId, rule.pattern),
      pattern: rule.pattern,
      category_id: seedCategoryId(userId, rule.slug),
      match_field: 'description',
      match_type: 'token_prefix',
      source: 'default',
      priority: 0,
      hits: 0,
      enabled: true,
      last_hit_at: null,
      account_id: null,
      card_id: null,
      payment_method: null,
    });
  }
  for (const reminder of DEFAULT_REMINDERS) {
    add('reminders', {
      ...base(userId, iso),
      id: seedReminderId(userId, reminder.kind),
      kind: reminder.kind,
      enabled: true,
      local_time: reminder.localTime,
      days_before: [...reminder.daysBefore],
      weekday: reminder.weekday,
      skip_if_logged_today: true,
    });
  }
  for (const [bucket, pct] of Object.entries(DEFAULT_BUDGET_PCT_BP)) {
    add('budgets', {
      ...base(userId, iso),
      id: seedBudgetId(userId, bucket),
      month: null,
      scope: 'bucket',
      bucket,
      category_id: null,
      pct_bp: pct,
      limit_cents: null,
      alert_thresholds_bp: [8000, 10000],
    });
  }
  add('goals', {
    ...base(userId, iso),
    id: reserveGoalId(userId),
    kind: 'emergency_reserve',
    name: DEFAULT_RESERVE.name,
    target_mode: DEFAULT_RESERVE.targetMode,
    target_cents: null,
    auto_factor: DEFAULT_RESERVE.autoFactor,
    auto_lookback_months: DEFAULT_RESERVE.autoLookbackMonths,
    initial_saved_cents: 0,
    account_id: null,
    achieved_at: null,
  });
  return rows;
}

const SEED_TABLES: readonly SyncedTable[] = [
  'categories',
  'category_rules',
  'reminders',
  'budgets',
  'goals',
];

/**
 * Cria os seeds que faltam (tech §3.8). Chame **depois** do primeiro pull: assim um seed que o usuário apagou em
 * outro aparelho já chegou como tombstone e não "ressuscita". Devolve quantas linhas foram criadas.
 */
export async function ensureSeeds(
  db: OakDb,
  userId: string,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<Result<number>> {
  const device = await deviceId(db);
  const iso = new Date(nowMs).toISOString();
  return writeLocal(() =>
    db.transaction('rw', writeScope(SEED_TABLES), async () => {
      let created = 0;
      for (const { table, row } of seedRows(userId, iso)) {
        if ((await db.table(table).get(row.id)) === undefined) {
          await putInTransaction(db, table, row, device, nowMs);
          created += 1;
        }
      }
      return created;
    }),
  );
}
