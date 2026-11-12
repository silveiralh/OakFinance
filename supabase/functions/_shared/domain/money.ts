// Dinheiro em centavos inteiros (RN-01, tech §5.1). Único arquivo onde texto monetário vira número.
import { DomainError } from './errors.ts';
import type { BasisPoints, Cents } from './types.ts';

/** Faixa válida de um lançamento (RN-01): R$ 0,01 a R$ 999.999,99. */
export const MIN_TX_CENTS: Cents = 1;
export const MAX_TX_CENTS: Cents = 99_999_999;

/** Sinal de menos tipográfico (U+2212) usado nos valores negativos. */
export const MINUS_SIGN = '−';
/** Espaço não separável (U+00A0) entre "R$" e o número: o valor nunca quebra em duas linhas (UXB-004). */
export const NBSP = '\u00a0';

export const HIDDEN_AMOUNT = `R$${NBSP}••••`;

const AMOUNT_RE = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * "1.234,56" | "1234,5" | "12" | "R$ 12,00" → 123456 | 123450 | 1200 | 1200.
 * Aceita só valores não negativos (o tipo do lançamento dá o sentido). Lança DomainError('INVALID_AMOUNT').
 */
export function parseBRL(input: string): Cents {
  const text = input
    .replace(/^\s*R\$/, '')
    .replace(/[\s ]/g, '')
    .trim();
  const match = AMOUNT_RE.exec(text);
  if (!match) {
    throw new DomainError('INVALID_AMOUNT', `valor inválido: "${input}"`);
  }
  const reais = Number((match[1] ?? '').replace(/\./g, ''));
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const cents = reais * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents)) {
    throw new DomainError('INVALID_AMOUNT', 'valor fora da faixa');
  }
  return cents;
}

/** Valor dentro da faixa de um lançamento (RN-01). */
export function isValidTxAmount(c: Cents): boolean {
  return Number.isSafeInteger(c) && c >= MIN_TX_CENTS && c <= MAX_TX_CENTS;
}

function assertSafe(c: number): void {
  if (!Number.isSafeInteger(c)) {
    throw new DomainError('UNSAFE_INTEGER', `não é um inteiro seguro: ${c}`);
  }
}

function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) {
      out += '.';
    }
    out += digits[i];
  }
  return out;
}

/** "R$ 1.234,56" (com U+00A0 depois de "R$"); negativo "−R$ 120,00" (U+2212); `signed` mostra "+" nos positivos; `hidden` → "R$ ••••". */
export function formatBRL(c: Cents, opts: { hidden?: boolean; signed?: boolean } = {}): string {
  if (opts.hidden) {
    return HIDDEN_AMOUNT;
  }
  assertSafe(c);
  const abs = Math.abs(c);
  const reais = Math.floor(abs / 100);
  const cents = abs % 100;
  const body = `R$${NBSP}${groupThousands(String(reais))},${String(cents).padStart(2, '0')}`;
  if (c < 0) {
    return `${MINUS_SIGN}${body}`;
  }
  return opts.signed && c > 0 ? `+${body}` : body;
}

/**
 * Divide `total` em `parts` partes inteiras com soma exata.
 * - sem `remainderTo`: o resto é espalhado (um centavo a mais nas primeiras partes), então max − min ≤ 1;
 * - 'first' / 'last': o resto inteiro vai para a primeira / última parte (RN-21 usa 'first'). Ver D-010.
 */
export function splitEven(total: Cents, parts: number, remainderTo?: 'first' | 'last'): Cents[] {
  assertSafe(total);
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new DomainError('INVALID_ARGUMENT', `partes inválidas: ${parts}`);
  }
  if (total < 0) {
    throw new DomainError('INVALID_ARGUMENT', 'total negativo');
  }
  const base = Math.floor(total / parts);
  const rest = total - base * parts;
  const out: Cents[] = new Array<Cents>(parts).fill(base);
  if (remainderTo === 'first') {
    out[0] = base + rest;
  } else if (remainderTo === 'last') {
    out[parts - 1] = base + rest;
  } else {
    for (let i = 0; i < rest; i++) {
      out[i] = base + 1;
    }
  }
  return out;
}

/** Percentual em basis points com arredondamento meio para cima: floor((base × bp + 5000) / 10000) (RN-44). */
export function applyBp(base: Cents, bp: BasisPoints): Cents {
  assertSafe(base);
  assertSafe(bp);
  const product = base * bp;
  if (Number.isSafeInteger(product)) {
    return Math.floor((product + 5000) / 10000);
  }
  const big = BigInt(base) * BigInt(bp) + 5000n;
  const q = big / 10000n;
  // BigInt divide truncando em direção a zero; corrige para floor quando negativo
  const floored = big < 0n && q * 10000n !== big ? q - 1n : q;
  const result = Number(floored);
  assertSafe(result);
  return result;
}

/** Soma exata; lança DomainError('UNSAFE_INTEGER') se algum valor ou a soma não for inteiro seguro. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertSafe(v);
    total += v;
    assertSafe(total);
  }
  return total;
}
