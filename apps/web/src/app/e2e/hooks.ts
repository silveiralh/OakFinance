// Só no build E2E (VITE_E2E=1): ganchos para o Playwright criar alterações locais antes de existir a tela de
// lançamento (E20). Nunca entra no bundle de produção (import dinâmico atrás da constante).
import type { LocalRow } from '../../data/db';
import { newId } from '../../data/ids';
import { saveRow } from '../../data/repositories/rows';
import { pendingCount } from '../../data/sync/outbox';
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
    };
  }
}

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
  };
  return () => {
    delete window.__oakE2E;
  };
}
