// Só no build E2E (VITE_E2E=1): ganchos para o Playwright criar alterações locais antes de existir a tela de
// lançamento (E20). Nunca entra no bundle de produção (import dinâmico atrás da constante).
import { type ISODate, invoiceForPurchase, noticeId, todayIn } from '@oakfinance/domain';
import type { LocalRow } from '../../data/db';
import { newId } from '../../data/ids';
import { cardFromRow } from '../../data/mappers';
import { createCard } from '../../data/repositories/cards';
import { deleteRow, saveRow } from '../../data/repositories/rows';
import { pendingCount } from '../../data/sync/outbox';
import { loadHomePeriodRows } from '../../features/dashboard/data';
import { homeModel } from '../../features/dashboard/model';
import { installmentRows, saveInstallmentPurchase } from '../../features/quick-entry/installments';
import { buildInvoice } from '../../features/quick-entry/model';
import { applyUpdate } from '../../lib/sw-update';
import type { UserSession } from '../auth';

declare global {
  interface Window {
    __oakE2E?: {
      userId: string;
      dbName: string;
      addAccount(name: string): Promise<string>;
      /**
       * T-097: grava `n` despesas só no aparelho (direto no Dexie, sem outbox) espalhadas nos últimos 120 dias, para
       * medir o desempenho com volume (RN-51).
       */
      seedTransactions(accountId: string, n: number): Promise<number>;
      /** T-097: ms do recálculo do painel (`homeModel` sobre as linhas locais), mediana de `runs` execuções. */
      measureHome(runs: number): Promise<number>;
      /** Estado da nota NFC-e com a chave dada (E09, T-089), ou `null` se não foi lida. */
      nfceStatus(accessKey: string): Promise<string | null>;
      pending(): Promise<number>;
      accountNames(): Promise<string[]>;
      counts(): Promise<Record<string, number>>;
      syncNow(): Promise<boolean>;
      /**
       * Espera o aparelho ficar parado: uma transação `rw` vazia em `transactions` só começa depois das leituras
       * ao vivo que já estavam na fila (ordem do IndexedDB), como quando a pessoa abre o Q01 e digita.
       */
      idle(): Promise<void>;
      /** Receita avulsa recebida hoje na conta (E02: o mês passa a ter Base). */
      addIncome(accountId: string, cents: number, description: string): Promise<string>;
      /** Aviso na central como o reminders-tick gravaria (E18); devolve o id v5 da dedupe_key. */
      addNotice(dedupeKey: string, title: string, body: string, navigate: string): Promise<string>;
      /** Despesa de hoje "recebida do banco" (I05, T-079): importado `pluggy` com o estado de conferência dado. */
      addImported(
        accountId: string,
        cents: number,
        description: string,
        reviewState: 'new' | 'suggested',
      ): Promise<string>;
      /** Despesa avulsa de hoje na conta (E06/US-14). */
      addExpense(
        accountId: string,
        cents: number,
        description: string,
        date?: string,
      ): Promise<string>;
      /** Edita o valor de um lançamento como o Q01 faria (linha inteira, relógio híbrido). */
      setAmount(id: string, cents: number): Promise<void>;
      amountOf(id: string): Promise<number | null>;
      /** Cartão (S03) com fechamento e vencimento. */
      addCard(name: string, closingDay: number, dueDay: number): Promise<string>;
      /** Compra à vista de hoje no cartão, na fatura da RN-12 (cria a fatura se faltar). */
      addCardExpense(cardId: string, cents: number, description: string): Promise<string>;
      /** Compra parcelada de hoje no cartão (plano, faturas e parcelas, como o Q01). Devolve o id da série. */
      addCardInstallments(
        cardId: string,
        cents: number,
        count: number,
        description: string,
      ): Promise<string>;
      /** Exclusão lógica, como o Excluir da T01/T02. */
      remove(id: string): Promise<void>;
      /** Valor e exclusão da linha local (`null` se não existe). */
      rowState(id: string): Promise<{ amount: number; deleted: boolean } | null>;
      /** Simula o toque em "Atualizar" do G07 (o toast fica inerte atrás do Q01 modal). */
      applyUpdate(): void;
    };
  }
}

const EXPENSE_DEFAULTS = {
  kind: 'expense',
  status: 'posted',
  occurred_at: null,
  description_raw: null,
  notes: null,
  category_id: null,
  category_source: 'none',
  category_rule_id: null,
  payment_method: 'pix',
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
  source: 'manual',
  external_id: null,
  external_meta: null,
  import_id: null,
  review_state: 'ok',
  duplicate_of: null,
  matched_external: false,
  merchant_name: null,
  merchant_cnpj: null,
  nfce_receipt_id: null,
  tags: [] as string[],
  deleted_at: null,
  server_version: 0,
  device_id: null,
} as const;

export function installE2eHooks(user: UserSession): () => void {
  window.__oakE2E = {
    userId: user.userId,
    dbName: user.db.name,
    async seedTransactions(accountId: string, n: number) {
      const today = todayIn('America/Sao_Paulo', new Date());
      const base = Date.parse(`${today}T12:00:00Z`);
      const now = new Date().toISOString();
      const rows = Array.from({ length: n }, (_, i) => ({
        ...EXPENSE_DEFAULTS,
        tags: [],
        id: newId(),
        user_id: user.userId,
        amount_cents: 100 + (i % 9000),
        occurred_on: new Date(base - (i % 120) * 86_400_000).toISOString().slice(0, 10),
        description: `Volume ${i}`,
        account_id: accountId,
        created_at: now,
        updated_at: now,
        client_updated_at: now,
        server_version: 1,
      })) satisfies LocalRow<'transactions'>[];
      await user.db.transactions.bulkPut(rows);
      return rows.length;
    },
    async measureHome(runs: number) {
      const today = todayIn('America/Sao_Paulo', new Date()) as ISODate;
      // RN-51: o recálculo (a leitura do banco local fica fora, como no painel ao vivo)
      const rows = await loadHomePeriodRows(user.db, today);
      const times: number[] = [];
      for (let i = 0; i < runs; i++) {
        const started = performance.now();
        homeModel(rows, today);
        times.push(performance.now() - started);
      }
      times.sort((a, b) => a - b);
      return times[Math.floor(times.length / 2)] ?? Number.NaN;
    },
    async nfceStatus(accessKey: string) {
      const receipt = (await user.db.nfce_receipts.toArray()).find(
        (r) => r.access_key === accessKey && r.deleted_at === null,
      );
      return receipt?.parse_status ?? null;
    },
    async addAccount(name: string) {
      const id = newId();
      const row = {
        id,
        user_id: user.userId,
        name,
        type: 'checking',
        initial_balance_cents: 0,
        initial_balance_on: '2026-11-01',
        is_restricted: false,
        include_in_spendable: true,
        sort_order: 0,
        archived_at: null,
        color: null,
        icon: null,
        institution: null,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        server_version: 0,
        client_updated_at: new Date().toISOString(),
        device_id: null,
      } satisfies LocalRow<'accounts'>;
      await saveRow(user.db, 'accounts', row);
      user.engine.notifyWrite();
      return id;
    },
    async addExpense(accountId: string, cents: number, description: string, date?: string) {
      const id = newId();
      const now = new Date().toISOString();
      const row = {
        ...EXPENSE_DEFAULTS,
        tags: [],
        id,
        user_id: user.userId,
        amount_cents: cents,
        occurred_on: date ?? todayIn('America/Sao_Paulo', new Date()),
        description,
        account_id: accountId,
        created_at: now,
        updated_at: now,
        client_updated_at: now,
      } satisfies LocalRow<'transactions'>;
      await saveRow(user.db, 'transactions', row);
      user.engine.notifyWrite();
      return id;
    },
    async addImported(
      accountId: string,
      cents: number,
      description: string,
      reviewState: 'new' | 'suggested',
    ) {
      const id = newId();
      const now = new Date().toISOString();
      const row = {
        ...EXPENSE_DEFAULTS,
        tags: [],
        id,
        user_id: user.userId,
        amount_cents: cents,
        occurred_on: todayIn('America/Sao_Paulo', new Date()),
        description,
        description_raw: description,
        account_id: accountId,
        payment_method: 'debit',
        source: 'pluggy',
        external_id: `e2e-${id}`,
        review_state: reviewState,
        created_at: now,
        updated_at: now,
        client_updated_at: now,
      } satisfies LocalRow<'transactions'>;
      await saveRow(user.db, 'transactions', row);
      user.engine.notifyWrite();
      return id;
    },
    async addIncome(accountId: string, cents: number, description: string) {
      const id = newId();
      const now = new Date().toISOString();
      await saveRow(user.db, 'transactions', {
        ...EXPENSE_DEFAULTS,
        kind: 'income',
        tags: [],
        id,
        user_id: user.userId,
        amount_cents: cents,
        occurred_on: todayIn('America/Sao_Paulo', new Date()),
        description,
        account_id: accountId,
        created_at: now,
        updated_at: now,
        client_updated_at: now,
      });
      user.engine.notifyWrite();
      return id;
    },
    async addNotice(dedupeKey: string, title: string, body: string, navigate: string) {
      const id = noticeId(user.userId, dedupeKey);
      const now = new Date().toISOString();
      await saveRow(user.db, 'notices', {
        id,
        user_id: user.userId,
        kind: 'bill_due',
        dedupe_key: dedupeKey,
        title,
        body,
        navigate,
        read_at: null,
        created_at: now,
        updated_at: now,
        client_updated_at: now,
        deleted_at: null,
        server_version: 0,
        device_id: null,
      });
      user.engine.notifyWrite();
      return id;
    },
    async setAmount(id: string, cents: number) {
      const current = await user.db.transactions.get(id);
      if (!current) {
        throw new Error('lançamento não encontrado');
      }
      await saveRow(user.db, 'transactions', { ...current, amount_cents: cents });
      user.engine.notifyWrite();
    },
    amountOf: async (id: string) => (await user.db.transactions.get(id))?.amount_cents ?? null,
    async addCard(name: string, closingDay: number, dueDay: number) {
      const id = newId();
      const result = await createCard(user.db, user.userId, { name, closingDay, dueDay }, { id });
      if (!result.ok) {
        throw new Error('cartão inválido');
      }
      user.engine.notifyWrite();
      return id;
    },
    async addCardExpense(cardId: string, cents: number, description: string) {
      const card = await user.db.cards.get(cardId);
      if (!card) {
        throw new Error('cartão não encontrado');
      }
      const today = todayIn('America/Sao_Paulo', new Date());
      const period = invoiceForPurchase(cardFromRow(card), today);
      const now = new Date().toISOString();
      if (!(await user.db.invoices.get(period.id))) {
        await saveRow(user.db, 'invoices', buildInvoice(period, user.userId, now));
      }
      const id = newId();
      await saveRow(user.db, 'transactions', {
        ...EXPENSE_DEFAULTS,
        tags: [],
        id,
        user_id: user.userId,
        amount_cents: cents,
        occurred_on: today,
        description,
        account_id: null,
        card_id: cardId,
        invoice_id: period.id,
        payment_method: 'credit',
        created_at: now,
        updated_at: now,
        client_updated_at: now,
      });
      user.engine.notifyWrite();
      return id;
    },
    async addCardInstallments(cardId: string, cents: number, count: number, description: string) {
      const card = await user.db.cards.get(cardId);
      if (!card) {
        throw new Error('cartão não encontrado');
      }
      const today = todayIn('America/Sao_Paulo', new Date());
      const now = new Date().toISOString();
      const seriesId = newId();
      const rows = installmentRows({
        seriesId,
        userId: user.userId,
        card,
        invoices: await user.db.invoices.where('card_id').equals(cardId).toArray(),
        base: {
          ...EXPENSE_DEFAULTS,
          tags: [],
          id: seriesId,
          user_id: user.userId,
          amount_cents: cents,
          occurred_on: today,
          description,
          account_id: null,
          card_id: cardId,
          payment_method: 'credit',
          created_at: now,
          updated_at: now,
          client_updated_at: now,
        },
        amountCents: cents,
        count,
        mode: 'total',
        purchaseDate: today,
        nowIso: now,
      });
      await saveInstallmentPurchase(user.db, rows);
      user.engine.notifyWrite();
      return seriesId;
    },
    async remove(id: string) {
      await deleteRow(user.db, 'transactions', id);
      user.engine.notifyWrite();
    },
    async rowState(id: string) {
      const row = await user.db.transactions.get(id);
      return row ? { amount: row.amount_cents, deleted: row.deleted_at !== null } : null;
    },
    pending: () => pendingCount(user.db),
    accountNames: async () => (await user.db.accounts.toArray()).map((row) => row.name),
    counts: async () => ({
      categories: await user.db.categories.count(),
      category_rules: await user.db.category_rules.count(),
      reminders: await user.db.reminders.count(),
      budgets: await user.db.budgets.count(),
      goals: await user.db.goals.count(),
      transactions: await user.db.transactions.count(),
      pending: await pendingCount(user.db),
      rejected: await user.db.outbox.where('state').equals('rejected').count(),
    }),
    syncNow: async () => (await user.engine.syncNow()).ok,
    idle: () => user.db.transaction('rw', user.db.transactions, () => undefined),
    applyUpdate,
  };
  return () => {
    delete window.__oakE2E;
  };
}
