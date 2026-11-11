// Leitura das tabelas locais que o Início, a P01 e os avisos de orçamento usam (recalculadas a cada mudança, RN-51).
import { addMonths, type ISODate, monthOf, type YearMonth } from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import type { HomeRows } from './model';

/** Tudo: quem precisa do histórico inteiro (Reserva P02, Fechar o mês P04, ReserveMoveSheet, S06, onboarding). */
export async function loadHomeRows(db: OakDb): Promise<HomeRows> {
  return {
    txRows: await db.transactions.toArray(),
    ...(await loadOtherRows(db)),
  };
}

async function loadOtherRows(db: OakDb): Promise<Omit<HomeRows, 'txRows'>> {
  return {
    recurrences: await db.recurrences.toArray(),
    cards: await db.cards.toArray(),
    accounts: await db.accounts.toArray(),
    categories: await db.categories.toArray(),
    invoices: await db.invoices.toArray(),
    budgets: await db.budgets.toArray(),
    profile: (await db.profiles.toCollection().first()) ?? null,
  };
}

/** Meses além do número de parcelas em que uma série ainda pode cair numa fatura (fechamento e vencimento). */
const SERIES_SLACK_MONTHS = 2;

/**
 * T-102: só os lançamentos que o mês de hoje (M) usa, pelos índices do Dexie, em vez de todo o histórico. O resultado de
 * `homeModel`, `budgetView` e `budgetAlerts` é o mesmo da leitura completa (teste de propriedade em
 * `test/dashboard-period.test.ts`):
 * - `occurred_on` desde o 1º dia de M − 1 (a projeção das recorrências no cartão começa no mês anterior, RN-46) até
 *   qualquer data à frente (agendados, "Próximos 7 dias");
 * - os lançamentos das faturas com mês de referência ≥ M − 1 (abertas, fechadas, a pagar e futuras): as parcelas
 *   guardam a data da compra (RN-22) e os pagamentos são transferências com `invoice_id`;
 * - os das séries de parcelas que ainda podem cair em M ou depois (atribuição por mês da compra);
 * - os das recorrências (ocorrências realizadas e as datas previstas da RN-38).
 * As demais tabelas são pequenas e vêm inteiras.
 */
export async function loadHomePeriodRows(db: OakDb, today: ISODate): Promise<HomeRows> {
  const other = await loadOtherRows(db);
  const prev = addMonths(today.slice(0, 7) as YearMonth, -1);
  const from = `${prev}-01`;
  const invoiceIds = (
    await db.invoices.where('reference_month').aboveOrEqual(prev).primaryKeys()
  ).map(String);
  const seriesIds = (await db.installment_plans.toArray())
    .filter(
      (p) =>
        addMonths(
          monthOf(p.purchase_date as ISODate),
          p.installments_count + SERIES_SLACK_MONTHS,
        ) >= prev,
    )
    .map((p) => p.id);
  const recurrenceIds = other.recurrences.map((r) => r.id);
  const byId = new Map<string, LocalRow<'transactions'>>();
  const add = (rows: readonly LocalRow<'transactions'>[]) => {
    for (const r of rows) {
      byId.set(r.id, r);
    }
  };
  add(await db.transactions.where('occurred_on').aboveOrEqual(from).toArray());
  if (invoiceIds.length > 0) {
    add(await db.transactions.where('invoice_id').anyOf(invoiceIds).toArray());
  }
  if (seriesIds.length > 0) {
    add(await db.transactions.where('series_id').anyOf(seriesIds).toArray());
  }
  if (recurrenceIds.length > 0) {
    add(await db.transactions.where('recurrence_id').anyOf(recurrenceIds).toArray());
  }
  return { txRows: [...byId.values()], ...other };
}

/** Os `n` lançamentos mais recentes (data desc., e no mesmo dia o criado por último), sem ler o histórico. */
export async function loadRecentRows(db: OakDb, n: number): Promise<LocalRow<'transactions'>[]> {
  const head = await db.transactions
    .orderBy('occurred_on')
    .reverse()
    .filter((r) => r.deleted_at === null)
    .limit(n)
    .toArray();
  const last = head.at(-1);
  if (!last) {
    return [];
  }
  // no dia de corte, o desempate é pelo created_at: lê o dia inteiro
  const tail = await db.transactions.where('occurred_on').aboveOrEqual(last.occurred_on).toArray();
  return tail
    .filter((r) => r.deleted_at === null)
    .sort((a, b) =>
      a.occurred_on === b.occurred_on
        ? b.created_at.localeCompare(a.created_at)
        : a.occurred_on < b.occurred_on
          ? 1
          : -1,
    )
    .slice(0, n);
}

/** Importados a revisar ("novo" ou "sugerido"), pelo índice de `review_state`. */
export function loadReviewRows(db: OakDb): Promise<LocalRow<'transactions'>[]> {
  return db.transactions
    .where('review_state')
    .anyOf('new', 'suggested')
    .filter((r) => r.deleted_at === null && r.source !== 'manual')
    .toArray();
}
