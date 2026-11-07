// Importar OFX (I03; US-52, RN-65, RN-75, RN-78). Tudo no aparelho: o arquivo é lido, conferido pelo SHA-256
// ("Este arquivo já foi importado em {dd/mm}."), vira linhas (`ofxToImportRows`), passa por uma prévia com o
// conciliador ("N novas · N serão conciliadas · N para decidir · N já existiam") e é gravado tudo-ou-nada numa
// transação Dexie (tabela `imports` + lançamentos com `import_id`). "Desfazer importação" vale por 24 h.
import {
  type ImportedRow,
  type ISODate,
  invoiceForPurchase,
  type OfxStatement,
  ofxToImportRows,
  planMerge,
  type ReconAction,
  reconcile,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { newId } from '../../data/ids';
import { cardFromRow } from '../../data/mappers';
import { putInTransaction, writeScope } from '../../data/repositories/rows';
import type { Result } from '../../data/result';
import { writeLocal } from '../../data/storage';
import { deviceId } from '../../data/sync/clock';
import { itemOf, reconExtras } from '../../data/sync/reconcile-runner';

type TxRow = LocalRow<'transactions'>;
type ImportRow = LocalRow<'imports'>;

/** "Desfazer importação" fica disponível por 24 h (RN-78). */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Destino lembrado por conta do arquivo (`ACCTID` mascarado). */
export const DEST_KEY_PREFIX = 'import.dest.';

export { type ParseOutcome, parseOfxBytes } from './ofx-parse';

/** SHA-256 do arquivo em hexadecimal (chave de "já importado"). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Importação anterior do mesmo arquivo (não desfeita). */
export async function previousImport(db: OakDb, sha: string): Promise<ImportRow | null> {
  const rows = await db.imports.where('file_sha256').equals(sha).toArray();
  return rows.find((r) => r.deleted_at === null && r.status !== 'reverted') ?? null;
}

export type Destination = { kind: 'account'; id: string } | { kind: 'card'; id: string };

export interface ImportPreview {
  total: number;
  fresh: number;
  merged: number;
  suggested: number;
  existing: number;
}

export interface ImportPlan {
  importRow: ImportRow;
  transactions: TxRow[];
  invoices: LocalRow<'invoices'>[];
  preview: ImportPreview;
}

function baseTx(userId: string, nowIso: string): Omit<TxRow, 'id'> {
  return {
    user_id: userId,
    kind: 'expense',
    status: 'posted',
    amount_cents: 1,
    occurred_on: '2026-01-01',
    occurred_at: null,
    description: null,
    description_raw: null,
    notes: null,
    category_id: null,
    category_source: 'none',
    category_rule_id: null,
    payment_method: 'debit',
    account_id: null,
    card_id: null,
    invoice_id: null,
    invoice_pinned: false,
    counterpart_account_id: null,
    counterpart_card_id: null,
    series_id: null,
    installment_number: null,
    installment_count: null,
    recurrence_id: null,
    recurrence_date: null,
    goal_id: null,
    income_expected: false,
    count_before_received: false,
    source: 'ofx',
    external_id: null,
    external_meta: null,
    import_id: null,
    review_state: 'new',
    duplicate_of: null,
    matched_external: false,
    merchant_name: null,
    merchant_cnpj: null,
    nfce_receipt_id: null,
    tags: [],
    created_at: nowIso,
    updated_at: nowIso,
    client_updated_at: nowIso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  };
}

export interface PlanInput {
  userId: string;
  statement: OfxStatement;
  destination: Destination;
  fileName: string;
  sha: string;
  /** O que existe no aparelho (lançamentos, faturas, cartões, recorrências). */
  txs: readonly TxRow[];
  invoices: readonly LocalRow<'invoices'>[];
  cards: readonly LocalRow<'cards'>[];
  recurrences: readonly LocalRow<'recurrences'>[];
  nowMs: number;
  newId?: () => string;
}

/** Prévia e linhas a gravar (sem gravar). */
export function planImport(input: PlanInput): ImportPlan {
  const createId = input.newId ?? newId;
  const nowIso = new Date(input.nowMs).toISOString();
  const importId = createId();
  const target =
    input.destination.kind === 'account'
      ? { accountId: input.destination.id }
      : { cardId: input.destination.id };
  const rows: ImportedRow[] = ofxToImportRows(input.statement, target);
  const alive = input.txs.filter((r) => r.deleted_at === null);
  const known = new Set(
    alive.filter((r) => r.source === 'ofx' && r.external_id).map((r) => r.external_id as string),
  );
  const cardRow =
    input.destination.kind === 'card'
      ? (input.cards.find((c) => c.id === input.destination.id) ?? null)
      : null;
  const card = cardRow ? cardFromRow(cardRow) : null;
  const invoices: LocalRow<'invoices'>[] = [];
  const haveInvoice = new Set(input.invoices.filter((i) => i.deleted_at === null).map((i) => i.id));

  const fresh: TxRow[] = [];
  let existing = 0;
  for (const row of rows) {
    if (known.has(row.externalKey)) {
      existing += 1;
      continue;
    }
    known.add(row.externalKey);
    let invoiceId: string | null = null;
    if (card) {
      const period = invoiceForPurchase(card, row.occurredOn as ISODate);
      invoiceId = period.id;
      if (!haveInvoice.has(period.id)) {
        haveInvoice.add(period.id);
        invoices.push({
          id: period.id,
          user_id: input.userId,
          card_id: card.id,
          reference_month: `${period.referenceMonth}-01`,
          closing_date: period.closingDate,
          due_date: period.dueDate,
          is_manual_dates: false,
          external_bill_id: null,
          external_total_cents: null,
          external_min_payment_cents: null,
          notes: null,
          created_at: nowIso,
          updated_at: nowIso,
          client_updated_at: nowIso,
          deleted_at: null,
          server_version: 0,
          device_id: null,
        });
      }
    }
    const kind = card ? (row.kind === 'expense' ? 'expense' : 'refund') : row.kind;
    fresh.push({
      ...baseTx(input.userId, nowIso),
      id: createId(),
      kind,
      amount_cents: row.amountCents,
      occurred_on: row.occurredOn,
      description: row.description.slice(0, 200) || null,
      description_raw: row.descriptionRaw,
      payment_method: card ? 'credit' : 'debit',
      account_id: card ? null : input.destination.id,
      card_id: card ? card.id : null,
      invoice_id: invoiceId,
      external_id: row.externalKey,
      external_meta: { provider: 'ofx', ...row.extra },
      import_id: importId,
    });
  }

  // Conciliação com o que o usuário já lançou (RN-67/RN-72): mesma regra do conciliador do aparelho.
  const extras = reconExtras(input.invoices, input.recurrences);
  const actions: ReconAction[] = reconcile(
    fresh.map((r) => itemOf(r, extras)),
    alive.map((r) => itemOf(r, extras)),
  );
  const byId = new Map(alive.map((r) => [r.id, r]));
  const out: TxRow[] = [];
  let merged = 0;
  let suggested = 0;
  actions.forEach((action, i) => {
    const row = fresh[i] as TxRow;
    if (action.action === 'auto_merge' || action.action === 'duplicate') {
      const matchId = action.action === 'auto_merge' ? action.matchId : action.ofImportedId;
      out.push({ ...row, review_state: 'merged', duplicate_of: matchId });
      const manual = byId.get(matchId);
      if (action.action === 'auto_merge' && manual) {
        const plan = planMerge(itemOf(row, extras), itemOf(manual, extras), { approx: false });
        out.push({
          ...manual,
          matched_external: true,
          status: plan.manualPatch.status,
          ...(plan.manualPatch.description !== undefined
            ? { description: plan.manualPatch.description }
            : {}),
        });
      }
      merged += 1;
    } else if (action.action === 'suggest') {
      out.push({ ...row, review_state: 'suggested' });
      suggested += 1;
    } else {
      out.push(row);
    }
  });
  const preview: ImportPreview = {
    total: rows.length,
    fresh: fresh.length - merged - suggested,
    merged,
    suggested,
    existing,
  };
  const st = input.statement;
  return {
    importRow: {
      id: importId,
      user_id: input.userId,
      source: 'ofx',
      file_name: input.fileName.slice(0, 200),
      file_sha256: input.sha,
      csv_profile: null,
      account_id: input.destination.kind === 'account' ? input.destination.id : null,
      card_id: input.destination.kind === 'card' ? input.destination.id : null,
      status: 'committed',
      period_start: st.startOn,
      period_end: st.endOn,
      stats: {
        total: preview.total,
        new: preview.fresh,
        duplicates: existing,
        autoMerged: merged,
        suggested,
      },
      error: null,
      created_at: nowIso,
      updated_at: nowIso,
      client_updated_at: nowIso,
      deleted_at: null,
      server_version: 0,
      device_id: null,
    },
    transactions: out,
    invoices,
    preview,
  };
}

/** Grava tudo numa transação (tudo ou nada, RN-78) e lembra o destino para a conta do arquivo. */
export async function commitImport(
  db: OakDb,
  plan: ImportPlan,
  acctIdMasked: string | null,
  nowMs = Date.now(),
): Promise<Result<number>> {
  const device = await deviceId(db);
  return writeLocal(() =>
    db.transaction(
      'rw',
      [...writeScope(['imports', 'invoices', 'transactions']), 'kv'],
      async () => {
        await putInTransaction(db, 'imports', plan.importRow, device, nowMs);
        for (const row of plan.invoices) {
          await putInTransaction(db, 'invoices', row, device, nowMs);
        }
        for (const row of plan.transactions) {
          await putInTransaction(db, 'transactions', row, device, nowMs);
        }
        if (acctIdMasked) {
          const dest = plan.importRow.account_id
            ? { kind: 'account', id: plan.importRow.account_id }
            : { kind: 'card', id: plan.importRow.card_id };
          await db.kv.put({ key: `${DEST_KEY_PREFIX}${acctIdMasked}`, value: dest });
        }
        return plan.transactions.filter((r) => r.import_id === plan.importRow.id).length;
      },
    ),
  );
}

/** Destino usado da última vez para a conta do arquivo (`ACCTID`). */
export async function rememberedDestination(
  db: OakDb,
  acctIdMasked: string | null,
): Promise<Destination | null> {
  if (!acctIdMasked) {
    return null;
  }
  const value = (await db.kv.get(`${DEST_KEY_PREFIX}${acctIdMasked}`))?.value as
    | Destination
    | undefined;
  return value && (value.kind === 'account' || value.kind === 'card') ? value : null;
}

export function canUndo(row: ImportRow, nowMs: number): boolean {
  return (
    row.status === 'committed' &&
    row.deleted_at === null &&
    nowMs - Date.parse(row.created_at) < UNDO_WINDOW_MS
  );
}

/**
 * "Desfazer importação" (RN-78): exclui o que a importação criou; os lançamentos manuais que ela conciliou só
 * perdem o vínculo. A importação fica `reverted` (o mesmo arquivo pode ser importado de novo).
 */
export async function undoImport(
  db: OakDb,
  importId: string,
  nowMs = Date.now(),
): Promise<Result<number>> {
  const device = await deviceId(db);
  const nowIso = new Date(nowMs).toISOString();
  return writeLocal(() =>
    db.transaction('rw', writeScope(['imports', 'transactions']), async () => {
      const row = await db.imports.get(importId);
      if (!row || !canUndo(row, nowMs)) {
        return 0;
      }
      const created = (await db.transactions.toArray()).filter(
        (t) => t.import_id === importId && t.deleted_at === null,
      );
      for (const t of created) {
        if (t.duplicate_of) {
          const manual = await db.transactions.get(t.duplicate_of);
          if (manual?.matched_external) {
            await putInTransaction(
              db,
              'transactions',
              { ...manual, matched_external: false },
              device,
              nowMs,
            );
          }
        }
        await putInTransaction(db, 'transactions', { ...t, deleted_at: nowIso }, device, nowMs);
      }
      await putInTransaction(db, 'imports', { ...row, status: 'reverted' }, device, nowMs);
      return created.length;
    }),
  );
}

/** Importações recentes que ainda podem ser desfeitas. */
export function undoable(rows: readonly ImportRow[], nowMs: number): ImportRow[] {
  return rows
    .filter((r) => canUndo(r, nowMs))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
