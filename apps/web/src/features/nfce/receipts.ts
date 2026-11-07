// I04 — chamada do `nfce-fetch` e gravação da nota no aparelho (T-089; tech §6.2.3 itens 4 a 6; RN-83, RN-84).
// Sem estado no servidor: o recibo, os itens e o vínculo com o lançamento vão pelo sync normal.
import type { NfceQr } from '@oakfinance/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocalRow, OakDb } from '../../data/db';
import { newId } from '../../data/ids';
import { putInTransaction, writeScope } from '../../data/repositories/rows';
import type { Result } from '../../data/result';
import { writeLocal } from '../../data/storage';
import { deviceId } from '../../data/sync/clock';
import { type InvokeOptions, invokeFunction } from '../../lib/functions';
import { formatCnpj } from './model';

type ReceiptRow = LocalRow<'nfce_receipts'>;
type ItemRow = LocalRow<'receipt_items'>;
type TxRow = LocalRow<'transactions'>;

/** Versão do parser gravada na nota (muda quando a T-090 confirmar os seletores). */
export const NFCE_PARSER_VERSION = 'sintetico-1';

export type NfceErrorCode = 'NFCE_UNAVAILABLE' | 'NFCE_LAYOUT' | 'NFCE_CAPTCHA' | 'NFCE_TIMEOUT';

export interface NfceReceiptDTO {
  issuerName: string | null;
  issuerCnpj: string | null;
  issuedAt: string | null;
  items: {
    description: string;
    code: string | null;
    quantityMilli: number;
    unit: string | null;
    unitCents: number;
    totalCents: number;
  }[];
  discountCents: number;
  totalCents: number;
}

/** Resposta do `nfce-fetch` (tech §6.0 [CONTRATO]). */
export interface NfceFetchResponse {
  status: 'full' | 'fallback';
  qr: NfceQr;
  receipt: NfceReceiptDTO | null;
  errorCode?: NfceErrorCode;
}

/** Leitura no aparelho: completa, parcial (fallback) ou pendente (sem rede, tenta de novo depois). */
export type NfceRead =
  | { status: 'full'; receipt: NfceReceiptDTO }
  /** `transient`: a chamada falhou (rede instável, timeout), não foi a SEFAZ que respondeu. */
  | { status: 'fallback'; errorCode: NfceErrorCode; transient?: boolean }
  | { status: 'pending' };

/**
 * Só no build E2E (E09): o Playwright troca a resposta do `nfce-fetch` por `window.__oakE2ENfce()` (como o
 * `FakePluggyConnect`, tech §8.4). A checagem de rede do `invokeFunction` continua valendo. Some do build de
 * produção (constante falsa).
 */
function e2eClient(): Pick<SupabaseClient, 'functions'> | null {
  if (import.meta.env.VITE_E2E !== '1') {
    return null;
  }
  const fake = (globalThis as { __oakE2ENfce?: () => unknown }).__oakE2ENfce;
  if (typeof fake !== 'function') {
    return null;
  }
  return {
    functions: { invoke: () => Promise.resolve({ data: fake(), error: null }) },
  } as unknown as Pick<SupabaseClient, 'functions'>;
}

/** Chama o `nfce-fetch`; sem rede vira `pending` e falha da chamada vira `fallback` (US-55). */
export async function readNfce(
  client: Pick<SupabaseClient, 'functions'>,
  rawQr: string,
  options: InvokeOptions = {},
): Promise<NfceRead> {
  const result = await invokeFunction<NfceFetchResponse>(
    e2eClient() ?? client,
    'nfce-fetch',
    { qr: rawQr },
    options,
  );
  if (!result.ok) {
    if (result.reason === 'offline') {
      return { status: 'pending' };
    }
    return {
      status: 'fallback',
      errorCode: result.reason === 'timeout' ? 'NFCE_TIMEOUT' : 'NFCE_UNAVAILABLE',
      transient: true,
    };
  }
  const { data } = result;
  if (data.status === 'full' && data.receipt) {
    return { status: 'full', receipt: data.receipt };
  }
  return { status: 'fallback', errorCode: data.errorCode ?? 'NFCE_UNAVAILABLE' };
}

/** Linhas da nota (recibo + itens) para a leitura dada. */
export function receiptRows(
  userId: string,
  qr: NfceQr,
  read: NfceRead,
  nowMs: number,
  makeId: () => string = newId,
  existing: ReceiptRow | null = null,
): { receipt: ReceiptRow; items: ItemRow[] } {
  const nowIso = new Date(nowMs).toISOString();
  const full = read.status === 'full' ? read.receipt : null;
  const id = existing?.id ?? makeId();
  const receipt: ReceiptRow = {
    ...(existing ?? {
      created_at: nowIso,
      server_version: 0,
      device_id: null,
      deleted_at: null,
    }),
    id,
    user_id: userId,
    access_key: qr.accessKey,
    qr_url: qr.url,
    qr_version: qr.qrVersion,
    uf: qr.uf,
    issuer_cnpj: full?.issuerCnpj ?? qr.issuerCnpj,
    issuer_name: full?.issuerName ?? existing?.issuer_name ?? null,
    issued_on: full?.issuedAt ? full.issuedAt.slice(0, 10) : (existing?.issued_on ?? null),
    total_cents: full?.totalCents ?? qr.contingency?.totalCents ?? null,
    discount_cents: full?.discountCents ?? null,
    items_count: full ? full.items.length : null,
    parse_status: read.status,
    error_code: read.status === 'fallback' ? read.errorCode : null,
    fetched_at: read.status === 'pending' ? null : nowIso,
    parser_version: full ? NFCE_PARSER_VERSION : null,
    updated_at: nowIso,
    client_updated_at: nowIso,
  } as ReceiptRow;
  const items: ItemRow[] = (full?.items ?? []).map(
    (item, index) =>
      ({
        id: makeId(),
        user_id: userId,
        receipt_id: id,
        line_no: index + 1,
        description: item.description,
        code: item.code,
        quantity_milli: item.quantityMilli,
        unit: item.unit,
        unit_price_cents: item.unitCents,
        total_cents: item.totalCents,
        category_id: null,
        created_at: nowIso,
        updated_at: nowIso,
        client_updated_at: nowIso,
        server_version: 0,
        device_id: null,
        deleted_at: null,
      }) as ItemRow,
  );
  return { receipt, items };
}

/**
 * Grava a nota e, quando houver, o vínculo com o lançamento (RN-83: anexa loja e itens, preenche a descrição se
 * vazia). Tudo numa transação.
 */
export async function saveNfce(
  db: OakDb,
  rows: { receipt: ReceiptRow; items: ItemRow[] },
  tx: TxRow | null,
  nowMs = Date.now(),
): Promise<Result<ReceiptRow>> {
  const device = await deviceId(db);
  return writeLocal(() =>
    db.transaction(
      'rw',
      writeScope(['nfce_receipts', 'receipt_items', 'transactions']),
      async () => {
        const saved = await putInTransaction(db, 'nfce_receipts', rows.receipt, device, nowMs);
        for (const item of rows.items) {
          await putInTransaction(db, 'receipt_items', item, device, nowMs);
        }
        if (tx) {
          // a descrição vazia ou só com o CNPJ (rascunho da RN-84) recebe o nome da loja
          const current = tx.description?.trim() ?? '';
          const placeholder =
            current === '' ||
            (rows.receipt.issuer_cnpj !== null && current === formatCnpj(rows.receipt.issuer_cnpj));
          const description = placeholder
            ? (rows.receipt.issuer_name ?? tx.description)
            : tx.description;
          await putInTransaction(
            db,
            'transactions',
            {
              ...tx,
              nfce_receipt_id: saved.id,
              merchant_cnpj: rows.receipt.issuer_cnpj,
              description,
            },
            device,
            nowMs,
          );
        }
        return saved;
      },
    ),
  );
}
