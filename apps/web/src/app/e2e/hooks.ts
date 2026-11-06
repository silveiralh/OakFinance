// Só no build E2E (VITE_E2E=1): ganchos para o Playwright criar alterações locais antes de existir a tela de
// lançamento (E20). Nunca entra no bundle de produção (import dinâmico atrás da constante).
import { todayIn } from '@oakfinance/domain';
import type { LocalRow } from '../../data/db';
import { newId } from '../../data/ids';
import { saveRow } from '../../data/repositories/rows';
import { pendingCount } from '../../data/sync/outbox';
import { applyUpdate } from '../../lib/sw-update';
import type { UserSession } from '../auth';

declare global {
  interface Window {
    __oakE2E?: {
      userId: string;
      dbName: string;
      addAccount(name: string): Promise<string>;
      pending(): Promise<number>;
      accountNames(): Promise<string[]>;
      counts(): Promise<Record<string, number>>;
      syncNow(): Promise<boolean>;
      /** Despesa avulsa de hoje na conta (E06/US-14). */
      addExpense(accountId: string, cents: number, description: string): Promise<string>;
      /** Edita o valor de um lançamento como o Q01 faria (linha inteira, relógio híbrido). */
      setAmount(id: string, cents: number): Promise<void>;
      amountOf(id: string): Promise<number | null>;
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
    async addExpense(accountId: string, cents: number, description: string) {
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
        account_id: accountId,
        created_at: now,
        updated_at: now,
        client_updated_at: now,
      } satisfies LocalRow<'transactions'>;
      await saveRow(user.db, 'transactions', row);
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
    applyUpdate,
  };
  return () => {
    delete window.__oakE2E;
  };
}
