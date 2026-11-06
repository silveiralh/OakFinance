// Formatação de datas para a interface (DoD: dd/mm/aaaa). Datas chegam como 'YYYY-MM-DD' (tech §2.3).
import type { ISODate } from '@oakfinance/domain';

/** '2026-12-10' → '10/12/2026'. */
export function formatDateBR(date: ISODate): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
