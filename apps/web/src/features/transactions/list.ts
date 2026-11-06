// Regras puras da lista de lançamentos (T01, US-15): mês, filtros combináveis, busca sem acento e por valor,
// grupos por dia com totais e o resumo Entradas · Saídas · Guardado.
import { addMonths, type ISODate, parseBRL, type YearMonth } from '@oakfinance/domain';
import type { LocalRow } from '../../data/db';

type Tx = LocalRow<'transactions'>;
type Category = LocalRow<'categories'>;

export const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** "novembro 2026". */
export function monthTitle(month: YearMonth): string {
  const [year, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${year}`;
}

export function monthRange(month: YearMonth): { from: ISODate; to: ISODate } {
  const next = addMonths(month, 1);
  const [year, m] = next.split('-').map(Number);
  const last = new Date(Date.UTC(year ?? 0, (m ?? 1) - 1, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Minúsculas e sem acento ("Farmácia" → "farmacia"). */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export type Chip =
  | 'all'
  | 'expense'
  | 'income'
  | 'cards'
  | 'pix'
  | 'cash'
  | 'vouchers'
  | 'review'
  | 'forecast'
  | 'late';

export const CHIPS: readonly Chip[] = [
  'all',
  'expense',
  'income',
  'cards',
  'pix',
  'cash',
  'vouchers',
  'review',
  'forecast',
  'late',
];

export type StatusFilter = 'posted' | 'forecast' | 'late' | 'cancelled';

export interface ListFilters {
  chip: Chip;
  accountId: string | null;
  band: string | null;
  categoryId: string | null;
  status: StatusFilter | null;
  query: string;
}

export const NO_FILTERS: ListFilters = {
  chip: 'all',
  accountId: null,
  band: null,
  categoryId: null,
  status: null,
  query: '',
};

function chipMatches(tx: Tx, chip: Chip, today: ISODate): boolean {
  switch (chip) {
    case 'all':
      return true;
    case 'expense':
      return tx.kind === 'expense';
    case 'income':
      return tx.kind === 'income';
    case 'cards':
      return tx.card_id !== null;
    case 'pix':
      return tx.payment_method === 'pix';
    case 'cash':
      return tx.payment_method === 'cash';
    case 'vouchers':
      return tx.payment_method === 'meal_voucher' || tx.payment_method === 'food_voucher';
    case 'review':
      return tx.review_state === 'new' || tx.review_state === 'suggested';
    case 'forecast':
      return tx.status === 'pending';
    case 'late':
      return tx.status === 'pending' && tx.occurred_on < today;
  }
}

function statusMatches(tx: Tx, status: StatusFilter, today: ISODate): boolean {
  if (status === 'forecast') {
    return tx.status === 'pending';
  }
  if (status === 'late') {
    return tx.status === 'pending' && tx.occurred_on < today;
  }
  return tx.status === status;
}

/** "45,90" ou "R$ 45,90" → 4590; texto comum → `null`. */
export function queryAmount(query: string): number | null {
  if (!/\d/.test(query) || /[a-z]/i.test(query.replace(/^\s*r\$/i, ''))) {
    return null;
  }
  try {
    return parseBRL(query);
  } catch {
    return null;
  }
}

/** Aplica os chips, o painel Filtros e a busca (todos combinados, US-15). */
export function filterTransactions(
  rows: readonly Tx[],
  filters: ListFilters,
  categories: ReadonlyMap<string, Category>,
  today: ISODate,
): Tx[] {
  const query = fold(filters.query);
  const amount = queryAmount(filters.query);
  return rows.filter((tx) => {
    if (tx.deleted_at !== null || !chipMatches(tx, filters.chip, today)) {
      return false;
    }
    if (
      filters.accountId &&
      tx.account_id !== filters.accountId &&
      tx.card_id !== filters.accountId &&
      tx.counterpart_account_id !== filters.accountId
    ) {
      return false;
    }
    const category = tx.category_id ? categories.get(tx.category_id) : undefined;
    if (filters.band && category?.bucket !== filters.band) {
      return false;
    }
    if (filters.categoryId && tx.category_id !== filters.categoryId) {
      return false;
    }
    if (filters.status && !statusMatches(tx, filters.status, today)) {
      return false;
    }
    if (query === '') {
      return true;
    }
    if (amount !== null) {
      return tx.amount_cents === amount;
    }
    return [tx.description, tx.merchant_name, tx.notes, category?.name]
      .filter((text): text is string => Boolean(text))
      .some((text) => fold(text).includes(query));
  });
}

/** Valor com sinal para os totais: saída negativa, entrada positiva; transferência não conta. */
export function signedCents(tx: Pick<Tx, 'kind' | 'amount_cents'>): number {
  if (tx.kind === 'income' || tx.kind === 'refund' || tx.kind === 'adjust_in') {
    return tx.amount_cents;
  }
  if (tx.kind === 'expense' || tx.kind === 'adjust_out') {
    return -tx.amount_cents;
  }
  return 0;
}

export interface DayGroup {
  date: ISODate;
  rows: Tx[];
  inCents: number;
  outCents: number;
}

/** Grupos por dia, do mais recente ao mais antigo, com entradas e saídas do dia (US-15). */
export function groupByDay(rows: readonly Tx[]): DayGroup[] {
  const groups = new Map<ISODate, DayGroup>();
  for (const tx of rows) {
    let group = groups.get(tx.occurred_on);
    if (!group) {
      group = { date: tx.occurred_on, rows: [], inCents: 0, outCents: 0 };
      groups.set(tx.occurred_on, group);
    }
    group.rows.push(tx);
    if (tx.status !== 'cancelled') {
      const value = signedCents(tx);
      if (value > 0) {
        group.inCents += value;
      } else {
        group.outCents -= value;
      }
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((group) => ({
      ...group,
      rows: group.rows.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }));
}

export interface MonthSummary {
  inCents: number;
  outCents: number;
  savedCents: number;
}

/** Resumo do mês: entradas, saídas (despesas − estornos) e guardado (despesas na faixa Poupança). */
export function monthSummary(
  rows: readonly Tx[],
  categories: ReadonlyMap<string, Category>,
): MonthSummary {
  const out: MonthSummary = { inCents: 0, outCents: 0, savedCents: 0 };
  for (const tx of rows) {
    if (tx.deleted_at !== null || tx.status === 'cancelled') {
      continue;
    }
    const bucket = tx.category_id ? categories.get(tx.category_id)?.bucket : undefined;
    if (tx.kind === 'income') {
      out.inCents += tx.amount_cents;
    } else if (tx.kind === 'expense' && bucket === 'savings') {
      out.savedCents += tx.amount_cents;
    } else if (tx.kind === 'expense') {
      out.outCents += tx.amount_cents;
    } else if (tx.kind === 'refund') {
      out.outCents -= tx.amount_cents;
    }
  }
  return out;
}

/** Total do que está filtrado (entradas − saídas). */
export function filteredTotal(rows: readonly Tx[]): number {
  return rows.reduce((sum, tx) => (tx.status === 'cancelled' ? sum : sum + signedCents(tx)), 0);
}

/** Janela de linhas visíveis para a lista virtualizada (altura fixa por linha). */
export function visibleWindow(
  total: number,
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  overscan = 8,
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start, end };
}
