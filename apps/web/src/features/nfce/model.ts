// I04 — regras do fluxo da nota (T-089; RN-83, RN-84, RN-85, US-54, US-55), sem tela: candidato a enriquecer,
// nota repetida, rascunho do fallback e a janela de 7 dias do "Tentar ler a nota de novo".
import { diffDays, type ISODate, type NfceQr } from '@oakfinance/domain';
import type { LocalRow } from '../../data/db';

type TxRow = LocalRow<'transactions'>;
type ReceiptRow = LocalRow<'nfce_receipts'>;

/** RN-83: janela J do candidato (RN-66 com J = 1 dia). */
export const NFCE_MATCH_DAYS = 1;
/** RN-84: "Tentar ler a nota de novo" fica disponível por 7 dias. */
export const NFCE_RETRY_DAYS = 7;

/** "12345678000190" → "12.345.678/0001-90". */
export function formatCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) {
    return cnpj;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** RN-85: a mesma chave já lida (e não excluída). */
export function repeatedReceipt(
  receipts: readonly ReceiptRow[],
  accessKey: string,
): ReceiptRow | null {
  return receipts.find((r) => r.access_key === accessKey && r.deleted_at === null) ?? null;
}

/**
 * RN-83: lançamento candidato a receber os itens — despesa, valor exato, |Δdata| ≤ 1 dia, qualquer conta ou
 * cartão, ainda sem nota. O mais próximo da data vence; empate, o criado antes.
 */
export function nfceCandidate(
  txs: readonly TxRow[],
  issuedOn: ISODate,
  totalCents: number,
): TxRow | null {
  const matches = txs
    .filter(
      (t) =>
        t.deleted_at === null &&
        t.kind === 'expense' &&
        t.amount_cents === totalCents &&
        t.nfce_receipt_id === null &&
        Math.abs(diffDays(issuedOn, t.occurred_on)) <= NFCE_MATCH_DAYS,
    )
    .sort(
      (a, b) =>
        Math.abs(diffDays(issuedOn, a.occurred_on)) - Math.abs(diffDays(issuedOn, b.occurred_on)) ||
        a.created_at.localeCompare(b.created_at),
    );
  return matches[0] ?? null;
}

export interface NfceDraft {
  description: string;
  occurredOn: ISODate;
  /** `null` = o usuário digita o valor (RN-84). */
  amountCents: number | null;
}

/**
 * RN-84: o que a chave e o QR permitem — CNPJ formatado como descrição, o dia e o valor do QR de contingência; sem
 * eles, a data de hoje (dentro do mês da chave, quando der) e o valor em branco.
 */
export function fallbackDraft(qr: NfceQr, today: ISODate): NfceDraft {
  const description = formatCnpj(qr.issuerCnpj);
  if (qr.contingency) {
    const day = String(qr.contingency.day).padStart(2, '0');
    return {
      description,
      occurredOn: `${qr.issuedYearMonth}-${day}` as ISODate,
      amountCents: qr.contingency.totalCents,
    };
  }
  return { description, occurredOn: today, amountCents: null };
}

/** RN-84: a nota parcial pode ser lida de novo até 7 dias depois de lida. */
export function canRetryRead(receipt: ReceiptRow, today: ISODate): boolean {
  if (receipt.parse_status === 'full' || receipt.deleted_at !== null) {
    return false;
  }
  const readOn = receipt.created_at.slice(0, 10) as ISODate;
  return diffDays(readOn, today) <= NFCE_RETRY_DAYS;
}

/** RN-83: nome da loja lembrado pelo CNPJ (a nota completa mais recente). */
export function storeNameFor(receipts: readonly ReceiptRow[], cnpj: string): string | null {
  const named = receipts
    .filter((r) => r.issuer_cnpj === cnpj && r.issuer_name && r.deleted_at === null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return named[0]?.issuer_name ?? null;
}
