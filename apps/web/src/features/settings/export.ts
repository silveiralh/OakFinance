// Exportar lançamentos em CSV (US-59, S10): UTF-8 com BOM, separador ";", decimal "," e as 13 colunas da US-59,
// para abrir no Excel e no Google Planilhas em pt-BR sem configuração. Despesas (e saídas) negativas, receitas
// positivas; transferência com tipo "transferencia".
import {
  addMonths,
  clampDay,
  daysInMonth,
  type ISODate,
  monthLabel,
  type YearMonth,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { listedTransactions } from '../../data/queries';
import { type MessageKey, t, uiText } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { statusLabel } from '../transactions/history';
import { methodLabel } from '../transactions/TransactionsScreen';

export const CSV_COLUMNS = [
  'data',
  'tipo',
  'descricao',
  'categoria',
  'faixa',
  'conta',
  'forma',
  'valor',
  'status',
  'parcela',
  'fatura',
  'origem',
  'observacao',
] as const;

const BOM = '﻿';
const SEP = ';';
const EOL = '\r\n';

const KIND: Readonly<Record<string, string>> = {
  expense: 'despesa',
  income: 'receita',
  transfer: 'transferencia',
  refund: 'estorno',
  adjust_in: 'ajuste',
  adjust_out: 'ajuste',
};

/** Saídas negativas: despesa, transferência (sai da conta de origem) e ajuste de saída. */
const OUTFLOW = new Set(['expense', 'transfer', 'adjust_out']);

const BAND: Readonly<Record<string, string>> = {
  needs: uiText.bandNeeds,
  wants: uiText.bandWants,
  savings: uiText.bandSavings,
};

const ORIGIN: Readonly<Record<string, MessageKey>> = {
  manual: 'detail.origin.manual',
  pluggy: 'detail.origin.pluggy',
  ofx: 'detail.origin.ofx',
  csv: 'detail.origin.csv',
  nfce: 'detail.origin.nfce',
  recurrence: 'detail.origin.recurrence',
  installment: 'detail.origin.installment',
  system: 'detail.origin.system',
};

/** "-45,90" / "1234,56": centavos inteiros, sem separador de milhar (a planilha lê como número). */
export function csvAmount(cents: number, negative: boolean): string {
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
  return negative && abs > 0 ? `-${text}` : text;
}

/**
 * Campo de texto: entre aspas quando tem ";", aspas ou quebra de linha; começo com =, +, -, @ ou tabulação ganha
 * um apóstrofo, para a planilha não interpretar como fórmula.
 */
export function csvText(value: string | null | undefined): string {
  let text = (value ?? '').replace(/\r\n?/g, '\n');
  if (/^[=+\-@\t]/.test(text)) {
    text = `'${text}`;
  }
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface ExportLabels {
  categories: ReadonlyMap<string, Pick<LocalRow<'categories'>, 'name' | 'bucket'>>;
  accounts: ReadonlyMap<string, string>;
  cards: ReadonlyMap<string, string>;
  invoices: ReadonlyMap<string, YearMonth>;
}

/** Uma linha do CSV, na ordem de `CSV_COLUMNS`. */
export function csvLine(tx: LocalRow<'transactions'>, labels: ExportLabels): string {
  const category = tx.category_id ? labels.categories.get(tx.category_id) : undefined;
  const where =
    (tx.card_id ? labels.cards.get(tx.card_id) : undefined) ??
    (tx.account_id ? labels.accounts.get(tx.account_id) : undefined) ??
    '';
  const invoice = tx.invoice_id ? labels.invoices.get(tx.invoice_id) : undefined;
  const origin = ORIGIN[tx.source];
  const cells = [
    formatDateBR(tx.occurred_on as ISODate),
    KIND[tx.kind] ?? tx.kind,
    csvText(tx.description),
    csvText(category?.name),
    BAND[category?.bucket ?? ''] ?? '',
    csvText(where),
    methodLabel(tx.payment_method),
    csvAmount(tx.amount_cents, OUTFLOW.has(tx.kind)),
    statusLabel(tx.status),
    tx.installment_number && tx.installment_count
      ? `${tx.installment_number}/${tx.installment_count}`
      : '',
    invoice ? monthLabel(invoice) : '',
    origin ? t(origin) : '',
    csvText(tx.notes),
  ];
  return cells.join(SEP);
}

/** Conteúdo do arquivo: BOM, cabeçalho e uma linha por lançamento (por data e, no mesmo dia, pela criação). */
export function buildCsv(txs: readonly LocalRow<'transactions'>[], labels: ExportLabels): string {
  const sorted = [...txs].sort(
    (a, b) =>
      a.occurred_on.localeCompare(b.occurred_on) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
  return `${BOM}${[CSV_COLUMNS.join(SEP), ...sorted.map((tx) => csvLine(tx, labels))].join(EOL)}${EOL}`;
}

/** "lancamentos_2026-10_a_2026-11.csv" (US-59). */
export function exportFileName(from: YearMonth, to: YearMonth): string {
  return `lancamentos_${from}_a_${to}.csv`;
}

/** Período do primeiro dia de `from` ao último de `to`. */
export function periodOf(from: YearMonth, to: YearMonth): { from: ISODate; to: ISODate } {
  return { from: clampDay(from, 1), to: clampDay(to, daysInMonth(to)) };
}

/** Meses oferecidos nos seletores: os 24 anteriores, o atual e os 12 seguintes (parcelas e contas futuras). */
export function monthOptions(current: YearMonth): YearMonth[] {
  return Array.from({ length: 37 }, (_, i) => addMonths(current, i - 24));
}

export type ExportResult =
  | { kind: 'empty' }
  | { kind: 'file'; name: string; content: string; count: number };

/** Lê o período no aparelho e monta o arquivo; sem lançamentos, nenhum arquivo (US-59). */
export async function exportTransactions(
  db: OakDb,
  from: YearMonth,
  to: YearMonth,
): Promise<ExportResult> {
  const period = periodOf(from, to);
  const txs = await listedTransactions(db, period.from, period.to);
  if (txs.length === 0) {
    return { kind: 'empty' };
  }
  const [categories, accounts, cards, invoices] = await Promise.all([
    db.categories.toArray(),
    db.accounts.toArray(),
    db.cards.toArray(),
    db.invoices.toArray(),
  ]);
  const labels: ExportLabels = {
    categories: new Map(categories.map((c) => [c.id, c])),
    accounts: new Map(accounts.map((a) => [a.id, a.name])),
    cards: new Map(cards.map((c) => [c.id, c.name])),
    invoices: new Map(invoices.map((i) => [i.id, i.reference_month.slice(0, 7) as YearMonth])),
  };
  return {
    kind: 'file',
    name: exportFileName(from, to),
    content: buildCsv(txs, labels),
    count: txs.length,
  };
}

/** Baixa o arquivo no navegador (Blob + link temporário). */
export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
