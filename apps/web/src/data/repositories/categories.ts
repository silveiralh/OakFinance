// Categorias (US-27, RN-39..RN-42): faixa obrigatória nas de despesa, nome único entre as vivas (sem diferenciar
// maiúsculas, como o `name_ci` do servidor), sistema bloqueado, arquivar e excluir movendo o uso para um destino.
import type { LocalRow, OakDb, SyncedTable } from '../db';
import { newId } from '../ids';
import { err, ok, type Result } from '../result';
import { writeLocal } from '../storage';
import { deviceId } from '../sync/clock';
import { putInTransaction, saveRow, writeScope } from './rows';

type Category = LocalRow<'categories'>;

export const CATEGORY_NAME_MAX = 40;
export const BUCKETS = ['needs', 'wants', 'savings'] as const;
export type Bucket = (typeof BUCKETS)[number];

export type CategoryNameProblem = 'required' | 'tooLong' | 'duplicate';

export type CategoryError =
  | { code: 'CATEGORY_NAME'; problem: CategoryNameProblem; message: string }
  | { code: 'CATEGORY_SYSTEM'; message: string }
  | { code: 'CATEGORY_NOT_FOUND'; message: string }
  | { code: 'CATEGORY_TARGET'; message: string };

type CategoryResult<T = Category | null> = Result<
  T,
  CategoryError | { code: string; message: string }
>;

function folded(name: string): string {
  return name.trim().toLocaleLowerCase('pt-BR');
}

/** Nome obrigatório, até 40 caracteres e único entre as categorias vivas (a própria não conta). */
export function categoryNameProblem(
  name: string,
  categories: readonly Category[],
  selfId?: string,
): CategoryNameProblem | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'required';
  }
  if (trimmed.length > CATEGORY_NAME_MAX) {
    return 'tooLong';
  }
  const clash = categories.some(
    (c) => c.id !== selfId && c.deleted_at === null && folded(c.name) === folded(trimmed),
  );
  return clash ? 'duplicate' : null;
}

/** Categoria que a pessoa pode editar (as de sistema, como "A classificar", ficam bloqueadas, RN-41). */
export function isEditable(category: Pick<Category, 'is_system'>): boolean {
  return !category.is_system;
}

export interface CategoryInput {
  name: string;
  icon: string | null;
  /** Faixa da despesa (RN-39). Receita não tem faixa. */
  bucket: Bucket;
}

/** Cria uma categoria de despesa com a faixa obrigatória (RN-39). */
export async function createCategory(
  db: OakDb,
  userId: string,
  input: CategoryInput,
  { nowMs = Date.now(), id = newId() }: { nowMs?: number; id?: string } = {},
): Promise<CategoryResult> {
  const all = await db.categories.toArray();
  const problem = categoryNameProblem(input.name, all);
  if (problem) {
    return err({ code: 'CATEGORY_NAME', problem, message: problem });
  }
  const iso = new Date(nowMs).toISOString();
  const row: Category = {
    id,
    user_id: userId,
    name: input.name.trim(),
    name_ci: null,
    kind: 'expense',
    bucket: input.bucket,
    icon: input.icon,
    color: null,
    parent_id: null,
    slug: null,
    is_default: false,
    is_system: false,
    feeds_reserve: false,
    sort_order: all.length,
    archived_at: null,
    created_at: iso,
    updated_at: iso,
    client_updated_at: iso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  };
  return saveRow(db, 'categories', row, { nowMs });
}

async function editable(db: OakDb, id: string): Promise<CategoryResult<Category>> {
  const current = await db.categories.get(id);
  if (!current || current.deleted_at !== null) {
    return err({ code: 'CATEGORY_NOT_FOUND', message: id });
  }
  if (!isEditable(current)) {
    return err({ code: 'CATEGORY_SYSTEM', message: id });
  }
  return ok(current);
}

/** Renomear, trocar ícone e trocar faixa (efeito retroativo em todos os meses, RN-42: os totais derivam da faixa). */
export async function updateCategory(
  db: OakDb,
  id: string,
  patch: Partial<CategoryInput>,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<CategoryResult> {
  const found = await editable(db, id);
  if (!found.ok) {
    return found;
  }
  const current = found.value;
  if (patch.name !== undefined) {
    const problem = categoryNameProblem(patch.name, await db.categories.toArray(), id);
    if (problem) {
      return err({ code: 'CATEGORY_NAME', problem, message: problem });
    }
  }
  return saveRow(
    db,
    'categories',
    {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.bucket !== undefined && current.kind === 'expense' ? { bucket: patch.bucket } : {}),
    },
    { nowMs },
  );
}

/** Arquivar tira do seletor e mantém o histórico (RN-42); desarquivar devolve. */
export async function setArchived(
  db: OakDb,
  id: string,
  archived: boolean,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<CategoryResult> {
  const found = await editable(db, id);
  if (!found.ok) {
    return found;
  }
  return saveRow(
    db,
    'categories',
    { ...found.value, archived_at: archived ? new Date(nowMs).toISOString() : null },
    { nowMs },
  );
}

/** Tabelas que apontam para a categoria e são movidas para o destino ao excluir (RN-42). */
const MOVED = [
  'transactions',
  'recurrences',
  'category_rules',
  'installment_plans',
  'receipt_items',
] as const satisfies readonly SyncedTable[];

export interface CategoryUsage {
  transactions: number;
  recurrences: number;
  rules: number;
  total: number;
}

async function referencing(db: OakDb, table: SyncedTable, id: string) {
  return (await db.table(table).toArray()).filter(
    (row: { category_id?: string | null; deleted_at: string | null }) =>
      row.category_id === id && row.deleted_at === null,
  ) as { id: string; category_id: string | null; deleted_at: string | null }[];
}

/** Uso da categoria: lançamentos, recorrências, regras (e parcelamentos e itens de nota no total). */
export async function categoryUsage(db: OakDb, id: string): Promise<CategoryUsage> {
  const counts = await Promise.all(MOVED.map(async (t) => (await referencing(db, t, id)).length));
  const [transactions = 0, recurrences = 0, rules = 0] = counts;
  return { transactions, recurrences, rules, total: counts.reduce((a, b) => a + b, 0) };
}

/**
 * Exclui a categoria (RN-42). Sem uso, só exclui. Com uso, exige o destino (outra categoria viva, não de sistema, do
 * mesmo tipo) e move lançamentos, recorrências, regras, parcelamentos e itens de nota antes, na mesma transação.
 * Limites mensais da categoria (`budgets`) saem com ela.
 */
export async function deleteCategory(
  db: OakDb,
  id: string,
  targetId: string | null,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<CategoryResult<number>> {
  const found = await editable(db, id);
  if (!found.ok) {
    return found;
  }
  const usage = await categoryUsage(db, id);
  if (usage.total > 0) {
    const target = targetId ? await db.categories.get(targetId) : undefined;
    if (
      !target ||
      target.id === id ||
      target.deleted_at !== null ||
      target.is_system ||
      target.kind !== found.value.kind
    ) {
      return err({ code: 'CATEGORY_TARGET', message: id });
    }
  }
  const device = await deviceId(db);
  const iso = new Date(nowMs).toISOString();
  return writeLocal(() =>
    db.transaction('rw', writeScope(['categories', 'budgets', ...MOVED]), async () => {
      let moved = 0;
      if (targetId && usage.total > 0) {
        for (const table of MOVED) {
          for (const row of await referencing(db, table, id)) {
            const full = (await db.table(table).get(row.id)) as LocalRow<SyncedTable>;
            await putInTransaction(
              db,
              table,
              { ...full, category_id: targetId } as LocalRow<SyncedTable>,
              device,
              nowMs,
            );
            moved += 1;
          }
        }
      }
      for (const budget of await db.budgets.toArray()) {
        if (budget.category_id === id && budget.deleted_at === null) {
          await putInTransaction(db, 'budgets', { ...budget, deleted_at: iso }, device, nowMs);
        }
      }
      await putInTransaction(db, 'categories', { ...found.value, deleted_at: iso }, device, nowMs);
      return moved;
    }),
  );
}
