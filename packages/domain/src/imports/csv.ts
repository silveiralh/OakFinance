// CSV — mapeador configurável e presets (tech §5.10, PRD RN-76). A tokenização (papaparse) fica no app; o domínio
// recebe string[][].
import { isISODate } from '../dates.ts';
import { isValidTxAmount } from '../money.ts';
import { importedDedupKey } from '../reconciliation.ts';
import type { ISODate } from '../types.ts';
import {
  assertImportSize,
  type ImportedRow,
  ordinalKey,
  parseSignedCents,
  tidyText,
} from './common.ts';

export interface CsvProfile {
  id: string;
  name: string;
  delimiter: ',' | ';' | '\t';
  encoding: 'utf-8' | 'windows-1252';
  /** Índice da linha de cabeçalho (−1 = sem cabeçalho; as colunas são então os índices "0", "1"…). */
  headerRow: number;
  columns: {
    date: string;
    description: string;
    amount?: string;
    debit?: string;
    credit?: string;
    externalId?: string;
  };
  dateFormat: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'DD/MM/YY';
  decimal: ',' | '.';
  amountSign: 'expense_negative' | 'expense_positive';
  target: 'account' | 'card';
}

/**
 * Presets da RN-76. Os dois do Nubank são PROVISÓRIOS: confirmar com arquivos reais do cliente (Q1, SETUP-14).
 * 'generico-br' é o ponto de partida do mapeamento manual na UI.
 */
export const CSV_PRESETS: readonly CsvProfile[] = [
  {
    id: 'nubank-fatura',
    name: 'Nubank — fatura',
    delimiter: ',',
    encoding: 'utf-8',
    headerRow: 0,
    columns: { date: 'date', description: 'title', amount: 'amount' },
    dateFormat: 'YYYY-MM-DD',
    decimal: '.',
    amountSign: 'expense_positive',
    target: 'card',
  },
  {
    id: 'nubank-conta',
    name: 'Nubank — conta',
    delimiter: ',',
    encoding: 'utf-8',
    headerRow: 0,
    columns: {
      date: 'Data',
      amount: 'Valor',
      externalId: 'Identificador',
      description: 'Descrição',
    },
    dateFormat: 'DD/MM/YYYY',
    decimal: '.',
    amountSign: 'expense_negative',
    target: 'account',
  },
  {
    id: 'generico-br',
    name: 'Outro banco',
    delimiter: ';',
    encoding: 'utf-8',
    headerRow: 0,
    columns: { date: 'Data', description: 'Descrição', amount: 'Valor' },
    dateFormat: 'DD/MM/YYYY',
    decimal: ',',
    amountSign: 'expense_negative',
    target: 'account',
  },
];

/** Códigos de erro por linha de `mapCsvRows` (as mensagens ficam no i18n do app). */
export type CsvErrorCode =
  | 'CSV_COLUMN_MISSING'
  | 'CSV_AMOUNT_COLUMN_MISSING'
  | 'CSV_DATE_INVALID'
  | 'CSV_AMOUNT_INVALID'
  | 'CSV_AMOUNT_ZERO';

/** Cabeçalho comparado sem acento, sem caixa, sem BOM e sem espaços nas pontas. */
function headerKey(cell: string): string {
  return cell.replace(/^﻿/, '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
}

/** Sugere o preset do Nubank quando o cabeçalho tem exatamente as colunas dele (em qualquer ordem). */
export function sniffCsvProfile(header: readonly string[]): CsvProfile | null {
  const cells = header.map(headerKey).filter((c) => c !== '');
  const set = new Set(cells);
  for (const preset of CSV_PRESETS) {
    if (preset.id === 'generico-br') {
      continue;
    }
    const wanted = Object.values(preset.columns)
      .filter((c): c is string => typeof c === 'string')
      .map(headerKey);
    if (wanted.length === set.size && wanted.every((c) => set.has(c))) {
      return preset;
    }
  }
  return null;
}

function parseCsvDate(raw: string, format: CsvProfile['dateFormat']): ISODate | null {
  const text = raw.trim();
  let date: string | null = null;
  if (format === 'YYYY-MM-DD') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
    date = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  } else if (format === 'DD/MM/YYYY') {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    date = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  } else {
    const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(text);
    date = m ? `20${m[3]}-${m[2]}-${m[1]}` : null;
  }
  return date !== null && isISODate(date) ? date : null;
}

type Resolved = {
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  externalId: number | null;
};

function resolveColumns(
  rows: readonly string[][],
  profile: CsvProfile,
): Resolved | { missing: 'CSV_COLUMN_MISSING' | 'CSV_AMOUNT_COLUMN_MISSING' } {
  const header = profile.headerRow >= 0 ? (rows[profile.headerRow] ?? []) : null;
  const index = (name: string | undefined): number | null => {
    if (name === undefined || name.trim() === '') {
      return null;
    }
    if (header === null) {
      const n = Number(name);
      return Number.isInteger(n) && n >= 0 ? n : null;
    }
    const at = header.map(headerKey).indexOf(headerKey(name));
    return at === -1 ? null : at;
  };
  const c = profile.columns;
  const date = index(c.date);
  const description = index(c.description);
  if (date === null || description === null) {
    return { missing: 'CSV_COLUMN_MISSING' };
  }
  const amount = index(c.amount);
  const debit = index(c.debit);
  const credit = index(c.credit);
  if (amount === null && debit === null && credit === null) {
    return { missing: 'CSV_AMOUNT_COLUMN_MISSING' };
  }
  if (
    (c.externalId !== undefined && index(c.externalId) === null) ||
    (c.amount && amount === null)
  ) {
    return { missing: 'CSV_COLUMN_MISSING' };
  }
  return { date, description, amount, debit, credit, externalId: index(c.externalId) };
}

/** Valor com sinal (negativo = saída) a partir da coluna única ou do par débito/crédito; `null` se inválido. */
function signedAmount(row: readonly string[], cols: Resolved, profile: CsvProfile): number | null {
  if (cols.amount !== null) {
    const v = parseSignedCents(row[cols.amount] ?? '', profile.decimal);
    if (v === null) {
      return null;
    }
    return profile.amountSign === 'expense_positive' ? -v : v;
  }
  const debitRaw = cols.debit !== null ? (row[cols.debit] ?? '').trim() : '';
  const creditRaw = cols.credit !== null ? (row[cols.credit] ?? '').trim() : '';
  const debit = debitRaw === '' ? 0 : parseSignedCents(debitRaw, profile.decimal);
  const credit = creditRaw === '' ? 0 : parseSignedCents(creditRaw, profile.decimal);
  if (debit === null || credit === null || (debit !== 0 && credit !== 0)) {
    return null;
  }
  return debit !== 0 ? -Math.abs(debit) : Math.abs(credit);
}

/**
 * Interpreta as linhas pelo perfil (RN-76). Erros vêm por linha (1 = primeira linha do arquivo) e a linha com erro
 * fica de fora; coluna obrigatória ausente vira um único erro na linha do cabeçalho. Linhas vazias são puladas.
 */
export function mapCsvRows(
  rows: readonly string[][],
  profile: CsvProfile,
): { rows: ImportedRow[]; errors: Array<{ line: number; code: CsvErrorCode }> } {
  const firstData = profile.headerRow + 1;
  assertImportSize(rows.slice(firstData).filter((r) => r.some((c) => c.trim() !== '')).length);
  const cols = resolveColumns(rows, profile);
  if ('missing' in cols) {
    return { rows: [], errors: [{ line: Math.max(profile.headerRow, 0) + 1, code: cols.missing }] };
  }
  const out: ImportedRow[] = [];
  const errors: Array<{ line: number; code: CsvErrorCode }> = [];
  const seen = new Map<string, number>();
  for (let i = firstData; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const line = i + 1;
    if (!row.some((c) => c.trim() !== '')) {
      continue;
    }
    const date = parseCsvDate(row[cols.date] ?? '', profile.dateFormat);
    if (date === null) {
      errors.push({ line, code: 'CSV_DATE_INVALID' });
      continue;
    }
    const signed = signedAmount(row, cols, profile);
    if (signed === null || (signed !== 0 && !isValidTxAmount(Math.abs(signed)))) {
      errors.push({ line, code: 'CSV_AMOUNT_INVALID' });
      continue;
    }
    if (signed === 0) {
      errors.push({ line, code: 'CSV_AMOUNT_ZERO' });
      continue;
    }
    const descriptionRaw = row[cols.description] ?? '';
    const description = tidyText(descriptionRaw);
    const externalId = cols.externalId !== null ? (row[cols.externalId] ?? '').trim() : '';
    const key = ordinalKey(date, signed, description);
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    const extra: Record<string, string> = { line: String(line) };
    if (externalId !== '') {
      extra.externalId = externalId;
    }
    out.push({
      externalKey: importedDedupKey('csv', {
        ...(externalId !== '' ? { externalId } : {}),
        date,
        amountCents: signed,
        description,
        ordinal,
      }),
      occurredOn: date,
      amountCents: Math.abs(signed),
      kind: signed < 0 ? 'expense' : 'income',
      description,
      descriptionRaw,
      extra,
    });
  }
  return { rows: out, errors };
}
