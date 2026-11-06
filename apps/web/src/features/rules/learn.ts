// Regras que aprendem (US-28, RN-57..RN-63): mudar a categoria de um lançamento grava a correção, cria ou atualiza
// a regra 'learned' pela chave do comerciante (termo < 4 caracteres não gera regra) ou soma `hits` quando a escolha
// é a sugerida; "Desfazer" apaga a regra criada (ou restaura a anterior); "Aplicar a mais N parecidos".
import {
  type CategoryRule,
  categorize,
  learnFromCorrection,
  similarUnreviewed,
  UNCLASSIFIED_SLUG,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { newId } from '../../data/ids';
import { categoryFromRow, txFromRow } from '../../data/mappers';
import { deleteRow, saveRow } from '../../data/repositories/rows';
import { ruleFromRow } from '../quick-entry/model';

type TxRow = LocalRow<'transactions'>;
type RuleRow = LocalRow<'category_rules'>;

/** Domínio → linha (mantém as colunas da linha anterior, se houver). */
export function ruleToRow(
  rule: CategoryRule,
  base: RuleRow | undefined,
  userId: string,
  nowIso: string,
): RuleRow {
  return {
    ...(base ?? {
      user_id: userId,
      created_at: nowIso,
      updated_at: nowIso,
      client_updated_at: nowIso,
      deleted_at: null,
      server_version: 0,
      device_id: null,
    }),
    id: rule.id,
    match_field: rule.matchField,
    match_type: rule.matchType,
    pattern: rule.pattern,
    category_id: rule.categoryId,
    account_id: rule.accountId,
    card_id: rule.cardId,
    payment_method: rule.paymentMethod,
    source: rule.source,
    priority: rule.priority,
    hits: rule.hits,
    last_hit_at: rule.lastHitAt,
    enabled: rule.enabled,
  };
}

export interface Correction {
  /** Regra criada ou atualizada (o toast "Regra criada: '{termo}' → {categoria}"). */
  rule: RuleRow | null;
  /** Para o "Desfazer": a regra antes da correção (`null` = a regra é nova e sai). */
  previous: RuleRow | null;
  /** Ids dos não revisados (ou em "A classificar") que casam com a regra. */
  similar: string[];
}

function rulesOf(rows: readonly RuleRow[]): CategoryRule[] {
  return rows
    .filter((r) => r.deleted_at === null)
    .flatMap((r) => {
      try {
        return [ruleFromRow(r)];
      } catch {
        return [];
      }
    });
}

/** Grava a nova categoria do lançamento e aprende com a correção (RN-62/RN-63). */
export async function correctCategory(
  db: OakDb,
  userId: string,
  tx: TxRow,
  categoryId: string,
  nowMs: number = Date.now(),
): Promise<Correction> {
  const nowIso = new Date(nowMs).toISOString();
  const ruleRows = await db.category_rules.toArray();
  const rules = rulesOf(ruleRows);
  const categoryRows = await db.categories.toArray();
  const categories = categoryRows.flatMap((c) => {
    try {
      return [categoryFromRow(c)];
    } catch {
      return [];
    }
  });
  const input = {
    description: tx.description_raw ?? tx.description,
    merchantCnpj: tx.merchant_cnpj,
    paymentMethod: txFromRow(tx).paymentMethod,
    kind: txFromRow(tx).kind,
    accountId: tx.account_id,
    cardId: tx.card_id,
  };
  const previousSuggestion = categorize(input, rules, categories);
  await saveRow(
    db,
    'transactions',
    { ...tx, category_id: categoryId, category_source: 'manual' },
    { nowMs },
  );
  const change = learnFromCorrection(input, categoryId, previousSuggestion, rules, {
    today: nowIso.slice(0, 10),
    newId,
  });
  if (change.bumpHitsOf) {
    const row = ruleRows.find((r) => r.id === change.bumpHitsOf);
    if (row) {
      await saveRow(
        db,
        'category_rules',
        { ...row, hits: row.hits + 1, last_hit_at: nowIso },
        { nowMs },
      );
    }
    return { rule: null, previous: null, similar: [] };
  }
  if (!change.upsert) {
    return { rule: null, previous: null, similar: [] };
  }
  const base = ruleRows.find((r) => r.id === change.upsert?.id);
  const saved = await saveRow(
    db,
    'category_rules',
    ruleToRow(change.upsert, base, userId, nowIso),
    { nowMs },
  );
  if (!saved.ok) {
    return { rule: null, previous: null, similar: [] };
  }
  const unclassified =
    categoryRows.find((c) => c.slug === UNCLASSIFIED_SLUG && c.deleted_at === null)?.id ?? null;
  const txs = (await db.transactions.toArray()).flatMap((r) => {
    try {
      return [txFromRow(r)];
    } catch {
      return [];
    }
  });
  return {
    rule: saved.value,
    previous: base ?? null,
    similar: similarUnreviewed(change.upsert, txs, unclassified).filter((id) => id !== tx.id),
  };
}

/** "Desfazer": apaga a regra nova ou devolve a anterior; a categoria do lançamento continua a escolhida. */
export async function undoLearning(db: OakDb, correction: Correction): Promise<void> {
  if (!correction.rule) {
    return;
  }
  if (correction.previous) {
    await saveRow(db, 'category_rules', correction.previous);
  } else {
    await deleteRow(db, 'category_rules', correction.rule.id);
  }
}

/** "Aplicar a mais N parecidos": a categoria da regra nos lançamentos indicados (que ficam revisados). */
export async function applySimilar(
  db: OakDb,
  rule: RuleRow,
  ids: readonly string[],
  nowMs: number = Date.now(),
): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const row = await db.transactions.get(id);
    if (row && row.deleted_at === null) {
      const result = await saveRow(
        db,
        'transactions',
        {
          ...row,
          category_id: rule.category_id,
          category_source: 'rule',
          category_rule_id: rule.id,
          review_state: row.review_state === 'new' ? 'ok' : row.review_state,
        },
        { nowMs },
      );
      n += result.ok ? 1 : 0;
    }
  }
  return n;
}
