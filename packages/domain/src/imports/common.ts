// Utilidades comuns da importação de arquivos (tech §5.10; PRD RN-75, RN-76). Tudo roda no aparelho.
import { DomainError } from '../errors.ts';
import type { Cents, ISODate } from '../types.ts';

/** RN-75: arquivo até 5 MB e 5.000 transações (vale também para o CSV, UX I03). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5_000;

export interface ImportedRow {
  externalKey: string;
  occurredOn: ISODate;
  amountCents: Cents;
  kind: 'expense' | 'income';
  description: string;
  descriptionRaw: string;
  extra: Record<string, string>;
}

export function assertImportSize(rows: number): void {
  if (rows > MAX_IMPORT_ROWS) {
    throw new DomainError('IMPORT_TOO_LARGE', `mais de ${MAX_IMPORT_ROWS} transações`);
  }
}

/**
 * Valor decimal com sinal → centavos com sinal, só com aritmética inteira (sem parseFloat). `null` se inválido.
 * `decimal = 'auto'`: com "." e "," o último é o decimal; só um deles é o decimal. Separador de milhar = o outro.
 * Aceita "R$", espaços, sinal "+"/"-"/"−" antes ou "-" depois; casas além da 2ª só se forem zeros.
 */
export function parseSignedCents(raw: string, decimal: ',' | '.' | 'auto'): number | null {
  let text = raw.replace(/[\s ]/g, '').replace(/^R\$/i, '');
  let negative = false;
  const lead = /^([+\-−])(.*)$/.exec(text);
  if (lead) {
    negative = lead[1] !== '+';
    text = (lead[2] ?? '').replace(/^R\$/i, '');
  } else if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) {
    return null;
  }
  let sep: ',' | '.' | null = decimal === 'auto' ? null : decimal;
  if (sep === null) {
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    sep = lastDot === -1 && lastComma === -1 ? '.' : lastDot > lastComma ? '.' : ',';
  }
  const thousands = sep === '.' ? ',' : '.';
  const parts = text.split(sep);
  if (parts.length > 2) {
    return null;
  }
  const intRaw = parts[0] ?? '';
  const fracRaw = parts[1] ?? '';
  if (fracRaw.includes(thousands)) {
    return null;
  }
  if (intRaw.includes(thousands) && !new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})+$`).test(intRaw)) {
    return null;
  }
  const intDigits = intRaw.split(thousands).join('');
  if (!/^\d*$/.test(intDigits) || !/^\d*$/.test(fracRaw) || (intDigits === '' && fracRaw === '')) {
    return null;
  }
  if (/[1-9]/.test(fracRaw.slice(2))) {
    return null;
  }
  const cents =
    Number(intDigits === '' ? '0' : intDigits) * 100 + Number(fracRaw.slice(0, 2).padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    return null;
  }
  return negative && cents !== 0 ? -cents : cents;
}

/** Espaços colapsados nas pontas e no meio; usado para a descrição exibida. */
export function tidyText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Chave canônica para contar linhas idênticas no mesmo dia (ordinal da RN-65). */
export function ordinalKey(date: ISODate, signedCents: number, description: string): string {
  return `${date}|${signedCents}|${tidyText(description).toUpperCase()}`;
}
