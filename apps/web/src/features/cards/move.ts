// "Mover para outra fatura" na T02 (RN-18): só para item de cartão cuja fatura não está paga.
import type { InvoicePeriod, ISODate, YearMonth } from '@oakfinance/domain';
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
  const own = invoiceRows.find((r) => r.id === txRow.invoice_id);
  const view = own
    ? invoiceView(
        card,
        own.reference_month.slice(0, 7) as YearMonth,
        txs,
        overridesOf(invoiceRows),
        today,
      )
    : null;
  const targets = moveTargets(card, tx, txs, invoiceRows, today);
  return { allowed: canMove(view) && targets.length > 0, targets };
}
