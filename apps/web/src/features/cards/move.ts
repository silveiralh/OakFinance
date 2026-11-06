// "Mover para outra fatura" na T02 (RN-18): só para item de cartão cuja fatura não está paga.
import type { InvoicePeriod, ISODate, YearMonth } from '@oakfinance/domain';
import { addMonths, currentOpenInvoice, invoicePeriod } from '@oakfinance/domain';
import type { LocalRow } from '../../data/db';
import { cardFromRow, txFromRow } from '../../data/mappers';
import { canMove, invoiceView, moveTargets, overridesOf } from './model';

export interface MovePlan {
  allowed: boolean;
  targets: InvoicePeriod[];
}

export function movePlan(
  cardRow: LocalRow<'cards'>,
  txRow: LocalRow<'transactions'>,
  cardTxRows: readonly LocalRow<'transactions'>[],
  invoiceRows: readonly LocalRow<'invoices'>[],
  today: ISODate,
): MovePlan | null {
  if (txRow.card_id === null || txRow.invoice_id === null || txRow.kind === 'transfer') {
    return null;
  }
  let card: ReturnType<typeof cardFromRow>;
  try {
    card = cardFromRow(cardRow);
  } catch {
    return null; // cartão com dados inválidos: sem a ação
  }
  const txs = cardTxRows.flatMap((row) => {
    try {
      return [txFromRow(row)];
    } catch {
      return [];
    }
  });
  const tx = txFromRow(txRow);
  const overrides = overridesOf(invoiceRows);
  const own = invoiceRows.find((r) => r.id === txRow.invoice_id);
  const month = own
    ? (own.reference_month.slice(0, 7) as YearMonth)
    : monthOfInvoice(card, txRow.invoice_id, today);
  const view = month ? invoiceView(card, month, txs, overrides, today) : null;
  const targets = moveTargets(card, tx, txs, invoiceRows, today);
  return { allowed: canMove(view) && targets.length > 0, targets };
}

/** Mês da fatura pelo id v5 (a linha da fatura pode ainda não ter chegado), procurando 24 meses em volta de hoje. */
function monthOfInvoice(
  card: ReturnType<typeof cardFromRow>,
  invoiceId: string,
  today: ISODate,
): YearMonth | null {
  const base = currentOpenInvoice(card, today).referenceMonth;
  for (let i = -24; i <= 24; i += 1) {
    const m = addMonths(base, i);
    if (invoicePeriod(card, m).id === invoiceId) {
      return m;
    }
  }
  return null;
}
