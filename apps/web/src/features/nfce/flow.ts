// I04 — o fluxo da nota sem tela (T-089; US-54, US-55; RN-83..RN-85): da entrada (QR lido, link colado ou chave
// digitada) ao resultado que a tela mostra. A tela (câmera, foto, Q01 pré-preenchido) usa só este módulo.
import { DomainError, type ISODate, type NfceQr, parseNfceQr } from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import {
  canRetryRead,
  fallbackDraft,
  type NfceDraft,
  nfceCandidate,
  repeatedReceipt,
  storeNameFor,
} from './model';
import { type NfceRead, receiptRows, saveNfce } from './receipts';

type ReceiptRow = LocalRow<'nfce_receipts'>;
type TxRow = LocalRow<'transactions'>;

/** Host usado para a chave digitada (a Edge Function reconstrói a URL de qualquer forma). */
const TYPED_KEY_BASE = 'https://www.fazenda.pr.gov.br/nfce/qrcode?p=';

/**
 * Texto da entrada → URL do QR. Link colado passa como está; 44 dígitos (com espaços, pontos ou traços entre
 * eles) viram a URL do QR v3 online. `null` se não for nenhum dos dois.
 */
export function qrFromInput(text: string): string | null {
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const digits = trimmed.replace(/[\s.-]/g, '');
  return /^\d{44}$/.test(digits) ? `${TYPED_KEY_BASE}${digits}|3|1` : null;
}

/** "1234 5678 …": a chave em grupos de 4, como a I04 mostra. */
export function groupKey(digits: string): string {
  return digits
    .replace(/\D/g, '')
    .slice(0, 44)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

export type NfceOutcome =
  /** US-54: "Este QR code não é de uma nota fiscal (NFC-e)…" */
  | { kind: 'invalid' }
  /** RN-85: "Essa nota já foi lida em {dd/mm}." + Ver lançamento */
  | { kind: 'repeated'; receipt: ReceiptRow; txId: string | null }
  /** RN-83: "Itens da nota adicionados ao lançamento de {valor}." */
  | { kind: 'attached'; receipt: ReceiptRow; tx: TxRow }
  /** RN-83/RN-84: abre o Q01 pré-preenchido; `read` diz se veio completo, parcial ou pendente. */
  | { kind: 'prefill'; receipt: ReceiptRow; draft: NfceDraft; read: NfceRead['status'] };

export interface NfceFlowDeps {
  db: OakDb;
  userId: string;
  read(rawQr: string): Promise<NfceRead>;
  today: ISODate;
  nowMs?: number;
}

function parse(raw: string): NfceQr | null {
  try {
    return parseNfceQr(raw);
  } catch (error) {
    if (error instanceof DomainError) {
      return null;
    }
    throw error;
  }
}

/** Lê a nota e grava o que der; nunca cria lançamento (o Q01 cria, com o meio que o usuário escolher). */
export async function processNfce(input: string, deps: NfceFlowDeps): Promise<NfceOutcome> {
  const raw = qrFromInput(input);
  const qr = raw ? parse(raw) : null;
  if (!raw || !qr) {
    return { kind: 'invalid' };
  }
  const { db } = deps;
  const nowMs = deps.nowMs ?? Date.now();
  const receipts = await db.nfce_receipts.toArray();
  const seen = repeatedReceipt(receipts, qr.accessKey);
  const linked = seen
    ? await db.transactions
        .filter((t) => t.nfce_receipt_id === seen.id && t.deleted_at === null)
        .first()
    : undefined;
  if (seen && (seen.parse_status === 'full' || linked)) {
    return { kind: 'repeated', receipt: seen, txId: linked?.id ?? null };
  }
  const read = await deps.read(raw);
  const rows = receiptRows(deps.userId, qr, read, nowMs, undefined, seen);
  if (read.status === 'full') {
    const issuedOn = (read.receipt.issuedAt?.slice(0, 10) ?? deps.today) as ISODate;
    const candidate = nfceCandidate(
      await db.transactions.toArray(),
      issuedOn,
      read.receipt.totalCents,
    );
    const saved = await saveNfce(db, rows, candidate, nowMs);
    if (!saved.ok) {
      throw saved.error;
    }
    if (candidate) {
      return { kind: 'attached', receipt: saved.value, tx: candidate };
    }
    return {
      kind: 'prefill',
      receipt: saved.value,
      read: 'full',
      draft: {
        description:
          read.receipt.issuerName ??
          storeNameFor(receipts, qr.issuerCnpj) ??
          fallbackDraft(qr, deps.today).description,
        occurredOn: issuedOn,
        amountCents: read.receipt.totalCents,
      },
    };
  }
  const saved = await saveNfce(db, rows, null, nowMs);
  if (!saved.ok) {
    throw saved.error;
  }
  const draft = fallbackDraft(qr, deps.today);
  const known = storeNameFor(receipts, qr.issuerCnpj);
  return {
    kind: 'prefill',
    receipt: saved.value,
    read: read.status,
    draft: known ? { ...draft, description: known } : draft,
  };
}

export interface NfceRetryDeps {
  db: OakDb;
  userId: string;
  read(rawQr: string): Promise<NfceRead>;
  today: ISODate;
  nowMs?: number;
}

/**
 * Lê de novo uma nota parcial ou pendente (RN-84: "Tentar ler a nota de novo" por 7 dias; US-55: a pendente é
 * relida quando a rede volta). A mesma linha é atualizada; se ficar completa, o lançamento ligado a ela recebe a
 * loja e os itens (RN-83). Devolve o novo estado da nota.
 */
export async function rereadNfce(
  receipt: ReceiptRow,
  deps: NfceRetryDeps,
): Promise<ReceiptRow['parse_status']> {
  const qr = parse(receipt.qr_url);
  if (!qr) {
    return receipt.parse_status;
  }
  const read = await deps.read(receipt.qr_url);
  // logo depois de a rede voltar a chamada ainda pode falhar: a pendente continua pendente
  if (
    read.status === 'pending' ||
    (read.status === 'fallback' && read.transient && receipt.parse_status === 'pending')
  ) {
    return 'pending';
  }
  if (read.status === 'fallback' && receipt.parse_status === 'fallback') {
    return 'fallback';
  }
  const { db } = deps;
  const linked = await db.transactions
    .filter((t) => t.nfce_receipt_id === receipt.id && t.deleted_at === null)
    .first();
  const rows = receiptRows(deps.userId, qr, read, deps.nowMs ?? Date.now(), undefined, receipt);
  const saved = await saveNfce(
    db,
    rows,
    read.status === 'full' ? (linked ?? null) : null,
    deps.nowMs,
  );
  if (!saved.ok) {
    throw saved.error;
  }
  return saved.value.parse_status;
}

/** US-55: relê as notas `pending` ainda na janela de 7 dias; diz quantas ficaram completas e quantas seguem pendentes. */
export async function retryPendingNfce(
  deps: NfceRetryDeps,
): Promise<{ full: number; pending: number }> {
  const due = (await deps.db.nfce_receipts.toArray()).filter(
    (r) => r.parse_status === 'pending' && canRetryRead(r, deps.today),
  );
  const result = { full: 0, pending: 0 };
  for (const receipt of due) {
    const status = await rereadNfce(receipt, deps);
    if (status === 'full') {
      result.full += 1;
    } else if (status === 'pending') {
      result.pending += 1;
    }
  }
  return result;
}
