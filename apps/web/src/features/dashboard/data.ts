// Leitura das tabelas locais que o Início, a P01 e os avisos de orçamento usam (recalculadas a cada mudança, RN-51).
import type { OakDb } from '../../data/db';
import type { HomeRows } from './model';

export async function loadHomeRows(db: OakDb): Promise<HomeRows> {
  return {
    txRows: await db.transactions.toArray(),
    recurrences: await db.recurrences.toArray(),
    cards: await db.cards.toArray(),
    accounts: await db.accounts.toArray(),
    categories: await db.categories.toArray(),
    invoices: await db.invoices.toArray(),
    budgets: await db.budgets.toArray(),
    profile: (await db.profiles.toCollection().first()) ?? null,
  };
}
