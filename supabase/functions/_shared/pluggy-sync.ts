// `pluggy-sync` (tech §6.0 [CONTRATO] e §6.1.4; US-46, RN-19, RN-65, RN-80). Por conexão: abre `job_runs`,
// atualiza o item e as contas, importa as transações de cada conta mapeada (novas com id determinístico; existentes
// só nas colunas do provedor), atualiza as faturas pelo `/bills` e fecha o `job_runs`. Funções puras e o
// armazenamento por injeção: o `index.ts` liga o Supabase com a chave secreta, sempre com `user_id` explícito.
import type { BankConnector, ProviderBill, ProviderTransaction } from './connectors/types.ts';
import {
  addDays,
  type Card,
  type Category,
  type CategoryRule,
  type ISODate,
  monthOf,
  todayIn,
} from './domain/index.ts';
import { AppError } from './errors.ts';
import { type CorsConfig, handleError, jsonResponse, preflight, readJson } from './http.ts';
import {
  categoryFor,
  type IngestTarget,
  type InvoiceRef,
  invoiceForProviderTx,
  invoiceRow,
  newTransactionRow,
  providerPatch,
  SERVER_DEVICE,
} from './ingest.ts';
import { type Caller, enforceRate, fromProvider, requireCaller } from './pluggy-functions.ts';

const TIME_ZONE = 'America/Sao_Paulo';
export const DEFAULT_BACKFILL_DAYS = 90;
export const MAX_BACKFILL_DAYS = 365;
/** RN-80: janela de sobreposição do incremental. */
export const OVERLAP_DAYS = 10;
/** RN-80: "Atualizar agora" (PATCH /items) no máximo 1 vez por hora por conexão. */
export const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
/** Status do item que param a sincronização sem apagar nada (tech §6.1.4 passo 2). */
export const BLOCKING_STATUS = new Set(['LOGIN_ERROR']);
export const BLOCKING_EXECUTION = new Set(['USER_AUTHORIZATION_REVOKED']);

export interface ConnectionRow {
  id: string;
  user_id: string;
  external_item_id: string;
  is_active: boolean;
  deleted_at: string | null;
  last_manual_refresh_at: string | null;
  /** Último erro (T-077: `UPSTREAM_UNAVAILABLE`, `UPSTREAM_UNAVAILABLE:2`… conta as tentativas do erro temporário). */
  last_error?: string | null;
}

/** RN-81: erro temporário (5xx da Pluggy) tenta de novo em 1 h, até 3 vezes, sem avisar (pg_cron `pluggy-retry`). */
export const TEMPORARY_RETRIES = 3;
const TEMPORARY = /^(UPSTREAM_UNAVAILABLE|UPSTREAM_TIMEOUT)(?::(\d+))?$/;

/** Falhas seguidas do erro temporário registrado em `last_error` (0 se não for temporário). */
export function temporaryFailures(lastError: string | null | undefined): number {
  const match = TEMPORARY.exec(lastError ?? '');
  return match ? Number(match[2] ?? 1) : 0;
}

/**
 * `last_error` depois de uma falha com `code`: o erro temporário guarda a contagem (`CODE`, `CODE:2`, `CODE:3`,
 * `CODE:4`); a 1ª falha e as 3 novas tentativas. Outros erros ficam com o código.
 */
export function nextLastError(code: string, previous: string | null | undefined): string {
  if (code !== 'UPSTREAM_UNAVAILABLE' && code !== 'UPSTREAM_TIMEOUT') {
    return code;
  }
  const n = temporaryFailures(previous) + 1;
  return n === 1 ? code : `${code}:${n}`;
}

export interface ExternalAccountRow {
  id: string;
  user_id: string;
  external_account_id: string;
  account_id: string | null;
  card_id: string | null;
  is_ignored: boolean;
  last_tx_date: string | null;
  deleted_at: string | null;
}

export interface ExistingTx {
  id: string;
  external_id: string;
  amount_cents: number;
  occurred_on: string;
  occurred_at: string | null;
  status: string;
  description_raw: string | null;
  external_meta: unknown;
  invoice_id: string | null;
  invoice_pinned: boolean;
  review_state?: string;
  duplicate_of?: string | null;
  deleted_at?: string | null;
}

export interface SyncStats {
  accounts: number;
  inserted: number;
  updated: number;
  deleted: number;
  bills: number;
}

export interface SyncStore {
  connection(id: string): Promise<ConnectionRow | null>;
  updateConnection(id: string, userId: string, patch: Record<string, unknown>): Promise<void>;
  startRun(userId: string, connectionId: string): Promise<number>;
  finishRun(
    run: number,
    status: 'ok' | 'partial' | 'error',
    stats: SyncStats,
    error?: string,
  ): Promise<void>;
  externalAccounts(connectionId: string, userId: string): Promise<ExternalAccountRow[]>;
  updateExternalAccount(id: string, userId: string, patch: Record<string, unknown>): Promise<void>;
  card(id: string, userId: string): Promise<Card | null>;
  invoices(cardId: string, userId: string): Promise<InvoiceRef[]>;
  insertInvoice(row: Record<string, unknown>): Promise<void>;
  updateInvoice(id: string, userId: string, patch: Record<string, unknown>): Promise<void>;
  categories(userId: string): Promise<Category[]>;
  rules(userId: string): Promise<CategoryRule[]>;
  /** RN-80: dia em que o usuário começou a usar o app (onboarding), no fuso de São Paulo. */
  startedOn(userId: string): Promise<ISODate | null>;
  existingTransactions(userId: string, externalIds: readonly string[]): Promise<ExistingTx[]>;
  insertTransactions(rows: readonly Record<string, unknown>[]): Promise<void>;
  updateTransaction(id: string, userId: string, patch: Record<string, unknown>): Promise<void>;
}

export interface SyncInput {
  connectionId: string;
  mode: 'incremental' | 'backfill';
  days?: number;
  refresh?: boolean;
  /** Só estes ids do provedor (webhook `transactions/created|updated`); sem `/bills`. Nunca vem do corpo HTTP. */
  ids?: readonly string[];
}

export interface SyncDeps {
  connector(): BankConnector;
  store: SyncStore;
  now: () => Date;
}

/** RN-80: backfill = hoje − dias (padrão 90, máx. 365); incremental = min(última data − 10, hoje − 10). */
export function dateFromFor(
  mode: SyncInput['mode'],
  today: ISODate,
  lastTxDate: string | null,
  days: number = DEFAULT_BACKFILL_DAYS,
): ISODate {
  if (mode === 'backfill' || lastTxDate === null) {
    const span = mode === 'backfill' ? days : DEFAULT_BACKFILL_DAYS;
    return addDays(today, -Math.min(Math.max(Math.trunc(span), 1), MAX_BACKFILL_DAYS));
  }
  const fromLast = addDays(lastTxDate as ISODate, -OVERLAP_DAYS);
  const fromToday = addDays(today, -OVERLAP_DAYS);
  return fromLast < fromToday ? fromLast : fromToday;
}

/** "Atualizado há 10 min. Tente de novo em 50 min." (US-46) ou `null` quando já pode atualizar. */
export function refreshBlockedMessage(lastRefreshAt: string | null, now: Date): string | null {
  if (!lastRefreshAt) {
    return null;
  }
  const elapsed = now.getTime() - new Date(lastRefreshAt).getTime();
  if (Number.isNaN(elapsed) || elapsed >= REFRESH_INTERVAL_MS || elapsed < 0) {
    return null;
  }
  const ago = Math.floor(elapsed / 60_000);
  const wait = Math.max(1, Math.ceil((REFRESH_INTERVAL_MS - elapsed) / 60_000));
  return `Atualizado há ${ago} min. Tente de novo em ${wait} min.`;
}

function maxDate(a: string | null, b: string): string {
  return a === null || b > a ? b : a;
}

/** Importa as transações de uma conta mapeada; devolve a maior data vista. */
async function syncAccount(
  ctx: {
    userId: string;
    connector: BankConnector;
    store: SyncStore;
    stats: SyncStats;
    nowIso: string;
    today: ISODate;
    input: SyncInput;
    categories: Category[];
    rules: CategoryRule[];
    startedOn: ISODate | null;
  },
  account: ExternalAccountRow,
): Promise<void> {
  const { userId, connector, store, stats, nowIso } = ctx;
  let target: IngestTarget;
  let invoices: InvoiceRef[] = [];
  let bills: ProviderBill[] = [];
  if (account.card_id) {
    const card = await store.card(account.card_id, userId);
    if (!card) {
      return;
    }
    target = { kind: 'card', card };
    invoices = await store.invoices(card.id, userId);
    bills = await connector.listBills(account.external_account_id);
  } else if (account.account_id) {
    target = { kind: 'account', accountId: account.account_id };
  } else {
    return;
  }

  const dateFrom = dateFromFor(ctx.input.mode, ctx.today, account.last_tx_date, ctx.input.days);
  let last = account.last_tx_date;
  const ids = ctx.input.ids;
  const source: AsyncIterable<ProviderTransaction[]> | ProviderTransaction[][] = ids
    ? [await connector.getTransactionsByIds(account.external_account_id, [...ids])]
    : connector.listTransactions(account.external_account_id, { dateFrom });
  for await (const page of source) {
    if (page.length === 0) {
      continue;
    }
    const existing = new Map(
      (
        await store.existingTransactions(
          userId,
          page.map((tx) => tx.id),
        )
      ).map((tx) => [tx.external_id, tx]),
    );
    const fresh: Record<string, unknown>[] = [];
    for (const tx of page) {
      last = maxDate(last, tx.occurredOn);
      const invoice =
        target.kind === 'card'
          ? await ensureInvoice(store, userId, target.card, tx, invoices, bills, nowIso)
          : null;
      const before = existing.get(tx.id);
      if (before) {
        const patch = providerPatch(before, tx, invoice, nowIso);
        if (patch) {
          await store.updateTransaction(before.id, userId, patch);
          stats.updated += 1;
        }
        continue;
      }
      fresh.push(
        newTransactionRow({
          userId,
          tx,
          target,
          category: categoryFor(tx, target, ctx.rules, ctx.categories),
          invoice,
          startedOn: ctx.startedOn,
          nowIso,
        }),
      );
    }
    if (fresh.length > 0) {
      await store.insertTransactions(fresh);
      stats.inserted += fresh.length;
    }
  }

  if (target.kind === 'card' && !ids) {
    await syncBills(store, userId, target.card, bills, invoices, nowIso);
    stats.bills += bills.length;
  }
  await store.updateExternalAccount(account.id, userId, {
    last_tx_date: last,
    ...(ctx.input.mode === 'backfill' && !ids ? { backfill_done_at: nowIso } : {}),
    client_updated_at: nowIso,
    device_id: SERVER_DEVICE,
  });
}

/** Fatura do item no cartão (RN-12/RN-19), criando a que faltar com id v5 (tech §6.1.4). */
async function ensureInvoice(
  store: SyncStore,
  userId: string,
  card: Card,
  tx: ProviderTransaction,
  invoices: InvoiceRef[],
  bills: readonly ProviderBill[],
  nowIso: string,
): Promise<{ id: string; pinned: boolean }> {
  const found = invoiceForProviderTx(card, tx, invoices, bills);
  if (found.existingId) {
    return { id: found.existingId, pinned: found.invoicePinned };
  }
  const bill = bills.find((b) => monthOf(b.dueDate) === found.invoice.referenceMonth);
  const row = invoiceRow(userId, found.invoice, nowIso, bill);
  await store.insertInvoice(row);
  invoices.push({
    id: found.invoice.id,
    card_id: card.id,
    reference_month: String(row.reference_month),
    closing_date: found.invoice.closingDate,
    due_date: String(row.due_date),
    external_bill_id: (row.external_bill_id as string | null) ?? null,
    deleted_at: null,
  });
  return { id: found.invoice.id, pinned: found.invoicePinned };
}

/**
 * Passo 5: cada bill do banco vai para a fatura do mês do vencimento (ou a já ligada ao `billId`), com total,
 * mínimo e o vencimento do banco, que prevalece sobre o calculado.
 */
async function syncBills(
  store: SyncStore,
  userId: string,
  card: Card,
  bills: readonly ProviderBill[],
  invoices: InvoiceRef[],
  nowIso: string,
): Promise<void> {
  for (const bill of bills) {
    const month = monthOf(bill.dueDate);
    const current =
      invoices.find((inv) => inv.deleted_at === null && inv.external_bill_id === bill.id) ??
      invoices.find((inv) => inv.deleted_at === null && inv.reference_month.slice(0, 7) === month);
    if (!current) {
      const found = invoiceForProviderTx(
        card,
        { occurredOn: bill.dueDate, billId: bill.id },
        invoices,
        [bill],
      );
      const row = invoiceRow(userId, found.invoice, nowIso, bill);
      await store.insertInvoice(row);
      invoices.push({
        id: found.invoice.id,
        card_id: card.id,
        reference_month: String(row.reference_month),
        closing_date: found.invoice.closingDate,
        due_date: bill.dueDate,
        external_bill_id: bill.id,
        deleted_at: null,
      });
      continue;
    }
    // o vencimento real do banco prevalece, desde que continue depois do fechamento (check do banco)
    const dueDate = bill.dueDate > current.closing_date ? bill.dueDate : current.due_date;
    await store.updateInvoice(current.id, userId, {
      external_bill_id: bill.id,
      external_total_cents: bill.totalCents,
      external_min_payment_cents: bill.minimumPaymentCents,
      due_date: dueDate,
      is_manual_dates: false,
      client_updated_at: nowIso,
      device_id: SERVER_DEVICE,
    });
    current.external_bill_id = bill.id;
    current.due_date = dueDate;
  }
}

export interface SyncResult {
  jobRunId: number;
  stats: SyncStats;
  /** O item precisa de reconexão (LOGIN_ERROR ou autorização revogada): nada foi importado. */
  blocked: boolean;
}

/** Sincroniza uma conexão já validada para `userId`. */
export async function runSync(
  connection: ConnectionRow,
  input: SyncInput,
  deps: SyncDeps,
): Promise<SyncResult> {
  const { store } = deps;
  const userId = connection.user_id;
  const now = deps.now();
  const nowIso = now.toISOString();
  const stats: SyncStats = { accounts: 0, inserted: 0, updated: 0, deleted: 0, bills: 0 };
  let connector: BankConnector;
  try {
    connector = deps.connector();
  } catch {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Open Finance não configurado.');
  }
  const run = await store.startRun(userId, connection.id);
  try {
    if (input.refresh) {
      await connector.requestRefresh(connection.external_item_id);
      await store.updateConnection(connection.id, userId, { last_manual_refresh_at: nowIso });
    }
    const item = await connector.getItem(connection.external_item_id);
    const blocked =
      BLOCKING_STATUS.has(item.status) || BLOCKING_EXECUTION.has(item.executionStatus ?? '');
    await store.updateConnection(connection.id, userId, {
      status: item.status,
      execution_status: item.executionStatus,
      consent_expires_at: item.consentExpiresAt,
      provider_updated_at: item.updatedAt,
      last_synced_at: nowIso,
      ...(blocked ? { last_error: item.executionStatus ?? item.status } : {}),
      client_updated_at: nowIso,
      device_id: SERVER_DEVICE,
    });
    if (blocked) {
      await store.finishRun(run, 'partial', stats, item.executionStatus ?? item.status);
      return { jobRunId: run, stats, blocked: true };
    }

    const providerAccounts = await connector.listAccounts(connection.external_item_id);
    const rows = await store.externalAccounts(connection.id, userId);
    for (const pa of providerAccounts) {
      const row = rows.find((r) => r.external_account_id === pa.id);
      if (row) {
        await store.updateExternalAccount(row.id, userId, {
          balance_cents: pa.balanceCents,
          credit_limit_cents: pa.credit?.limitCents ?? null,
          available_limit_cents: pa.credit?.availableLimitCents ?? null,
          balance_close_date: pa.credit?.closeDate ?? null,
          balance_due_date: pa.credit?.dueDate ?? null,
          client_updated_at: nowIso,
          device_id: SERVER_DEVICE,
        });
      }
    }
    const [categories, rules, startedOn] = await Promise.all([
      store.categories(userId),
      store.rules(userId),
      store.startedOn(userId),
    ]);
    const ctx = {
      userId,
      connector,
      store,
      stats,
      nowIso,
      today: todayIn(TIME_ZONE, now),
      input,
      categories,
      rules,
      startedOn,
    };
    const providerIds = new Set(providerAccounts.map((a) => a.id));
    for (const account of rows) {
      const mapped = (account.account_id || account.card_id) && !account.is_ignored;
      if (!mapped || account.deleted_at !== null || !providerIds.has(account.external_account_id)) {
        continue;
      }
      stats.accounts += 1;
      await syncAccount(ctx, account);
    }
    await store.updateConnection(connection.id, userId, {
      last_success_at: nowIso,
      last_error: null,
      client_updated_at: nowIso,
      device_id: SERVER_DEVICE,
    });
    await store.finishRun(run, 'ok', stats);
    return { jobRunId: run, stats, blocked: false };
  } catch (error) {
    const appError = fromProvider(error);
    const code = appError instanceof AppError ? appError.code : 'INTERNAL';
    await store
      .updateConnection(connection.id, userId, {
        last_error: nextLastError(code, connection.last_error),
        last_synced_at: nowIso,
        client_updated_at: nowIso,
        device_id: SERVER_DEVICE,
      })
      .catch(() => undefined);
    await store.finishRun(run, 'error', stats, code);
    throw appError;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corpo do `pluggy-sync`: `{ connectionId, mode, days?, refresh? }`. */
export function readSyncInput(body: unknown): SyncInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const { connectionId, mode, days, refresh } = raw;
  if (typeof connectionId !== 'string' || !UUID_RE.test(connectionId)) {
    throw new AppError('BAD_REQUEST', 'connectionId inválido.');
  }
  if (mode !== 'incremental' && mode !== 'backfill') {
    throw new AppError('BAD_REQUEST', 'mode inválido.');
  }
  if (
    days !== undefined &&
    (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_BACKFILL_DAYS)
  ) {
    throw new AppError('BAD_REQUEST', 'days inválido.');
  }
  if (refresh !== undefined && typeof refresh !== 'boolean') {
    throw new AppError('BAD_REQUEST', 'refresh inválido.');
  }
  return {
    connectionId,
    mode,
    ...(days !== undefined ? { days: days as number } : {}),
    ...(refresh !== undefined ? { refresh: refresh as boolean } : {}),
  };
}

export interface SyncHandlerDeps extends SyncDeps {
  cors: CorsConfig;
  /** A requisição traz a chave secreta do projeto (pg_cron, auth 'secret')? */
  isSecret(request: Request): boolean;
  caller(authorization: string): Promise<Caller | null>;
}

/**
 * `pluggy-sync` `{ connectionId, mode, days?, refresh? }` → `{ jobRunId, stats }`. Pelo app (token do usuário): só a
 * própria conexão, 6 chamadas/h e `refresh` no máximo 1×/h por conexão (US-46). Pelo pg_cron (chave secreta):
 * qualquer conexão ativa, sem `refresh`.
 */
export async function handlePluggySync(request: Request, deps: SyncHandlerDeps): Promise<Response> {
  const early = preflight(request, deps.cors);
  if (early) {
    return early;
  }
  try {
    if (request.method !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED');
    }
    const secret = deps.isSecret(request);
    const caller = secret ? null : await requireCaller(request, deps.caller);
    const input = readSyncInput(await readJson(request));
    if (caller) {
      await enforceRate(caller, 'pluggy-sync');
    }
    const connection = await deps.store.connection(input.connectionId);
    if (
      !connection ||
      connection.deleted_at !== null ||
      !connection.is_active ||
      (caller !== null && connection.user_id !== caller.userId)
    ) {
      throw new AppError('NOT_FOUND');
    }
    const effective: SyncInput = secret ? { ...input, refresh: false } : input;
    if (effective.refresh) {
      const blocked = refreshBlockedMessage(connection.last_manual_refresh_at, deps.now());
      if (blocked) {
        throw new AppError('REFRESH_TOO_SOON', blocked);
      }
    }
    const result = await runSync(connection, effective, deps);
    return jsonResponse({ jobRunId: result.jobRunId, stats: result.stats }, request, deps.cors);
  } catch (error) {
    return handleError(error, request, deps.cors);
  }
}
