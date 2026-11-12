import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.ts';
import {
  applyBp,
  formatBRL,
  HIDDEN_AMOUNT,
  isValidTxAmount,
  MAX_TX_CENTS,
  MINUS_SIGN,
  parseBRL,
  splitEven,
  sumCents,
} from '../src/money.ts';

const RUNS = { numRuns: 200 };

describe('parseBRL (RN-01)', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,5', 123450],
    ['12', 1200],
    ['R$ 12,00', 1200],
    ['R$ 1.000.000,01', 100000001],
    ['0,01', 1],
    ['  7,9 ', 790],
  ])('RN-01: "%s" vira %i centavos', (input, cents) => {
    expect(parseBRL(input)).toBe(cents);
  });

  it.each(['', 'abc', '12,345', '1.23,00', '-5,00', '12.5', 'R$', '1,2,3', '9'.repeat(20)])(
    'RN-01: "%s" é recusado com INVALID_AMOUNT',
    (input) => {
      expect(() => parseBRL(input)).toThrowError(DomainError);
      try {
        parseBRL(input);
      } catch (error) {
        expect((error as DomainError).code).toBe('INVALID_AMOUNT');
      }
    },
  );

  it('RN-01: faixa de um lançamento é R$ 0,01 a R$ 999.999,99', () => {
    expect(isValidTxAmount(1)).toBe(true);
    expect(isValidTxAmount(MAX_TX_CENTS)).toBe(true);
    expect(isValidTxAmount(0)).toBe(false);
    expect(isValidTxAmount(MAX_TX_CENTS + 1)).toBe(false);
    expect(isValidTxAmount(1.5)).toBe(false);
  });
});

describe('formatBRL (RN-01)', () => {
  it('RN-01: formato pt-BR com milhar e vírgula', () => {
    expect(formatBRL(123456)).toBe('R$\u00a01.234,56');
    expect(formatBRL(0)).toBe('R$\u00a00,00');
    expect(formatBRL(5)).toBe('R$\u00a00,05');
    expect(formatBRL(100000000)).toBe('R$\u00a01.000.000,00');
  });

  it('RN-01: negativo usa o sinal de menos U+2212', () => {
    expect(formatBRL(-12000)).toBe(`${MINUS_SIGN}R$\u00a0120,00`);
    expect(formatBRL(-12000).charCodeAt(0)).toBe(0x2212);
  });

  it('signed mostra "+" só nos positivos', () => {
    expect(formatBRL(100, { signed: true })).toBe('+R$\u00a01,00');
    expect(formatBRL(0, { signed: true })).toBe('R$\u00a00,00');
    expect(formatBRL(-100, { signed: true })).toBe(`${MINUS_SIGN}R$\u00a01,00`);
  });

  it('UXB-004: o espaço depois de "R$" é não separável (U+00A0) e o parse aceita os dois espaços', () => {
    expect(formatBRL(727000)).toBe('R$\u00a07.270,00');
    expect(formatBRL(727000)).not.toContain('R$ ');
    expect(parseBRL(formatBRL(727000))).toBe(727000);
    expect(parseBRL('R$ 7.270,00')).toBe(727000);
  });

  it('valores ocultos viram "R$ ••••"', () => {
    expect(formatBRL(123456, { hidden: true })).toBe(HIDDEN_AMOUNT);
    expect(HIDDEN_AMOUNT).toBe('R$\u00a0••••');
  });

  it('recusa valor que não é inteiro seguro', () => {
    expect(() => formatBRL(1.5)).toThrowError(DomainError);
  });

  it('propriedade: parseBRL(formatBRL(c)) === c', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (c) => {
        expect(parseBRL(formatBRL(c))).toBe(c);
      }),
      RUNS,
    );
  });
});

describe('splitEven', () => {
  it('RN-21: resto inteiro na primeira parcela', () => {
    expect(splitEven(10000, 3, 'first')).toEqual([3334, 3333, 3333]);
    expect(splitEven(100000, 10, 'first')).toEqual(new Array(10).fill(10000));
    expect(splitEven(9999, 2, 'first')).toEqual([5000, 4999]);
    expect(splitEven(10, 3, 'first')).toEqual([4, 3, 3]);
  });

  it('resto na última parte', () => {
    expect(splitEven(11, 3, 'last')).toEqual([3, 3, 5]);
  });

  it('sem remainderTo, espalha o resto (um centavo nas primeiras)', () => {
    expect(splitEven(11, 3)).toEqual([4, 4, 3]);
    expect(splitEven(0, 2)).toEqual([0, 0]);
  });

  it('recusa partes inválidas e total negativo', () => {
    expect(() => splitEven(100, 0)).toThrowError(DomainError);
    expect(() => splitEven(100, 1.5)).toThrowError(DomainError);
    expect(() => splitEven(-1, 2)).toThrowError(DomainError);
  });

  it('propriedade: soma exata em todos os modos e max − min ≤ 1 no modo espalhado', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 48 }),
        fc.constantFrom<'first' | 'last' | undefined>('first', 'last', undefined),
        (total, parts, mode) => {
          const out = splitEven(total, parts, mode);
          expect(out).toHaveLength(parts);
          expect(out.reduce((a, b) => a + b, 0)).toBe(total);
          if (mode === undefined) {
            expect(Math.max(...out) - Math.min(...out)).toBeLessThanOrEqual(1);
          }
        },
      ),
      RUNS,
    );
  });
});

describe('applyBp (RN-44)', () => {
  it('RN-44: arredonda meio centavo para cima', () => {
    expect(applyBp(1001, 5000)).toBe(501); // 500,5 → 501
    expect(applyBp(1003, 5000)).toBe(502); // 501,5 → 502
    expect(applyBp(1000, 3333)).toBe(333);
    expect(applyBp(0, 5000)).toBe(0);
    expect(applyBp(242000, 10000)).toBe(242000);
  });

  it('usa BigInt quando o produto passa do inteiro seguro', () => {
    expect(applyBp(Number.MAX_SAFE_INTEGER - 1, 10000)).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(applyBp(-(2 ** 50), 10000)).toBe(-(2 ** 50));
    expect(applyBp(-(2 ** 50) - 1, 5000)).toBe(-(2 ** 49));
  });

  it('propriedade: igual ao arredondamento meio para cima exato', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 10000 }),
        (base, bp) => {
          const exact = (BigInt(base) * BigInt(bp) + 5000n) / 10000n;
          expect(applyBp(base, bp)).toBe(Number(exact));
        },
      ),
      RUNS,
    );
  });
});

describe('sumCents', () => {
  it('soma exata', () => {
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(sumCents([])).toBe(0);
  });

  it('lança UNSAFE_INTEGER para fração ou estouro', () => {
    expect(() => sumCents([1.5])).toThrowError(DomainError);
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrowError(DomainError);
  });
});
