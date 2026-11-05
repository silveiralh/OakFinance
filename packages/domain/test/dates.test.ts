import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  clampDay,
  daysInMonth,
  diffDays,
  isISODate,
  monthOf,
  parseISODate,
  parseYearMonth,
  todayIn,
  weekday,
} from '../src/dates.ts';
import { DomainError } from '../src/errors.ts';

const RUNS = { numRuns: 200 };
const yearMonth = fc
  .record({ y: fc.integer({ min: 1900, max: 2200 }), m: fc.integer({ min: 1, max: 12 }) })
  .map(({ y, m }) => `${y}-${String(m).padStart(2, '0')}`);

describe('dates (RN-02, RN-03)', () => {
  it('RN-03: dia 31 em fevereiro de 2027 vira 28/02/2027', () => {
    expect(clampDay('2027-02', 31)).toBe('2027-02-28');
  });

  it('RN-03: dia 30 em fevereiro de 2028 vira 29/02/2028', () => {
    expect(clampDay('2028-02', 30)).toBe('2028-02-29');
  });

  it('RN-03: dia que existe fica igual', () => {
    expect(clampDay('2026-11', 5)).toBe('2026-11-05');
    expect(() => clampDay('2026-11', 0)).toThrowError(DomainError);
  });

  it('dias no mês, inclusive bissextos de século', () => {
    expect(daysInMonth('2026-11')).toBe(30);
    expect(daysInMonth('2000-02')).toBe(29);
    expect(daysInMonth('2100-02')).toBe(28);
  });

  it('addMonths atravessa anos nos dois sentidos', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-01', -13)).toBe('2024-12');
    expect(() => addMonths('2026-01', 0.5)).toThrowError(DomainError);
  });

  it('addDays, diffDays e monthOf', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(diffDays('2026-11-05', '2026-12-05')).toBe(30);
    expect(diffDays('2026-12-05', '2026-11-05')).toBe(-30);
    expect(monthOf('2026-11-05')).toBe('2026-11');
    expect(() => addDays('2026-11-05', 1.5)).toThrowError(DomainError);
  });

  it('weekday: 0 = domingo', () => {
    expect(weekday('1970-01-01')).toBe(4);
    expect(weekday('2026-11-05')).toBe(4); // quinta-feira
    expect(weekday('2026-11-08')).toBe(0);
    expect(weekday('1969-12-28')).toBe(0);
  });

  it('valida datas e meses', () => {
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('26-11-05')).toBe(false);
    expect(() => parseISODate('2026-04-31')).toThrowError(DomainError);
    expect(() => parseYearMonth('2026-00')).toThrowError(DomainError);
    expect(() => parseYearMonth('2026-1')).toThrowError(DomainError);
  });

  it('RN-02: todayIn usa o fuso America/Sao_Paulo (virada às 03:00 UTC)', () => {
    expect(todayIn('America/Sao_Paulo', new Date(Date.UTC(2026, 10, 1, 2, 59)))).toBe('2026-10-31');
    expect(todayIn('America/Sao_Paulo', new Date(Date.UTC(2026, 10, 1, 3, 0)))).toBe('2026-11-01');
    expect(todayIn('UTC', new Date(Date.UTC(2026, 10, 1, 2, 59)))).toBe('2026-11-01');
  });

  it('propriedade: addMonths(addMonths(m, a), b) === addMonths(m, a + b)', () => {
    fc.assert(
      fc.property(
        yearMonth,
        fc.integer({ min: -600, max: 600 }),
        fc.integer({ min: -600, max: 600 }),
        (m, a, b) => {
          expect(addMonths(addMonths(m, a), b)).toBe(addMonths(m, a + b));
        },
      ),
      RUNS,
    );
  });

  it('propriedade: diffDays(d, addDays(d, n)) === n e clampDay nunca passa do fim do mês', () => {
    fc.assert(
      fc.property(
        yearMonth,
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: -100_000, max: 100_000 }),
        (m, day, n) => {
          const d = clampDay(m, day);
          expect(monthOf(d)).toBe(m);
          expect(Number(d.slice(8))).toBe(Math.min(day, daysInMonth(m)));
          expect(diffDays(d, addDays(d, n))).toBe(n);
        },
      ),
      RUNS,
    );
  });
});
