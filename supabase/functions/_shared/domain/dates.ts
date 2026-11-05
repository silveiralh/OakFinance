// Datas civis como texto (RN-02, RN-03, tech §2.3): 'YYYY-MM-DD' e 'YYYY-MM', sem Date.
// todayIn é a ÚNICA função com Date, e só a borda a usa.
import { DomainError } from './errors.ts';
import type { ISODate, YearMonth } from './types.ts';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

function pad(n: number, size: number): string {
  return String(n).padStart(size, '0');
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function monthDays(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

export function parseYearMonth(ym: YearMonth): { year: number; month: number } {
  const match = MONTH_RE.exec(ym);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12) {
    throw new DomainError('INVALID_DATE', `mês inválido: "${ym}"`);
  }
  return { year, month };
}

export function parseISODate(d: ISODate): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(d);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  if (!match || month < 1 || month > 12 || day < 1 || day > monthDays(year, month)) {
    throw new DomainError('INVALID_DATE', `data inválida: "${d}"`);
  }
  return { year, month, day };
}

export function isISODate(d: string): boolean {
  try {
    parseISODate(d);
    return true;
  } catch {
    return false;
  }
}

export function toISODate(year: number, month: number, day: number): ISODate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function toYearMonth(year: number, month: number): YearMonth {
  return `${pad(year, 4)}-${pad(month, 2)}`;
}

/** Dias desde 1970-01-01 (algoritmo days_from_civil, calendário gregoriano proléptico). */
function toEpochDays(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromEpochDays(z: number): ISODate {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return toISODate(year, month, day);
}

export function daysInMonth(ym: YearMonth): number {
  const { year, month } = parseYearMonth(ym);
  return monthDays(year, month);
}

/** Dia D no mês: min(D, último dia) (RN-03). ('2027-02', 31) → '2027-02-28'. */
export function clampDay(ym: YearMonth, day: number): ISODate {
  const { year, month } = parseYearMonth(ym);
  if (!Number.isInteger(day) || day < 1) {
    throw new DomainError('INVALID_ARGUMENT', `dia inválido: ${day}`);
  }
  return toISODate(year, month, Math.min(day, monthDays(year, month)));
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const { year, month } = parseYearMonth(ym);
  if (!Number.isInteger(n)) {
    throw new DomainError('INVALID_ARGUMENT', `meses inválidos: ${n}`);
  }
  const index = year * 12 + (month - 1) + n;
  return toYearMonth(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1);
}

export function addDays(d: ISODate, n: number): ISODate {
  const { year, month, day } = parseISODate(d);
  if (!Number.isInteger(n)) {
    throw new DomainError('INVALID_ARGUMENT', `dias inválidos: ${n}`);
  }
  return fromEpochDays(toEpochDays(year, month, day) + n);
}

export function monthOf(d: ISODate): YearMonth {
  const { year, month } = parseISODate(d);
  return toYearMonth(year, month);
}

/** b − a, em dias. */
export function diffDays(a: ISODate, b: ISODate): number {
  const pa = parseISODate(a);
  const pb = parseISODate(b);
  return toEpochDays(pb.year, pb.month, pb.day) - toEpochDays(pa.year, pa.month, pa.day);
}

/** 0 = domingo … 6 = sábado. */
export function weekday(d: ISODate): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const { year, month, day } = parseISODate(d);
  // 1970-01-01 foi quinta-feira (4)
  return ((((toEpochDays(year, month, day) + 4) % 7) + 7) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** "Hoje" no fuso informado (RN-02). ÚNICA função do domínio que recebe um Date. */
export function todayIn(timeZone: string, now: Date): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return toISODate(get('year'), get('month'), get('day'));
}
