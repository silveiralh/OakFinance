// Conciliação e deduplicação (tech §5.9; RN-65..RN-68, RN-72). Regras determinísticas, sem pontuação.
import { v5 } from 'uuid';
import { diffDays } from './dates.ts';
import { DomainError } from './errors.ts';
import type { Cents, ISODate, PaymentMethod, ReviewState, TxKind, TxSource } from './types.ts';

export interface ReconItem {
  id: string;
  kind: TxKind;
  amountCents: Cents;
  occurredOn: ISODate;
  accountId: string | null;
  cardId: string | null;
  description: string | null;
  source: TxSource;
  externalId: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  matchedExternal: boolean;
  reviewState: ReviewState;
  /** Meio do lançamento, quando conhecido (define a janela da RN-66). */
  paymentMethod?: PaymentMethod | null;
  /** `status = 'cancelled'` nunca é candidato (RN-66). */
  cancelled?: boolean;
}

export interface ReconOptions {
  windowDays: {
    card: number;
    debit: number;
    pix: number;
    transfer: number;
    boleto: number;
    recurrence: number;
    nfce: number;
  };
  suggestTolerance: { minCents: Cents; pctBp: number };
  lookbackDays: number;
}

/** Valores da RN-66/RN-67 (D6 do PRD). */
export const DEFAULT_RECON_OPTIONS: ReconOptions = {
  windowDays: { card: 3, debit: 3, pix: 1, transfer: 1, boleto: 1, recurrence: 5, nfce: 1 },
  suggestTolerance: { minCents: 200, pctBp: 200 },
  lookbackDays: 90,
};

export type ReconAction =
  | { importedId: string; action: 'new' }
  | { importedId: string; action: 'auto_merge'; matchId: string }
  | { importedId: string; action: 'suggest'; matchIds: string[]; reason: 'tie' | 'approx' }
  | { importedId: string; action: 'duplicate'; ofImportedId: string };

const MANUAL_SOURCES: ReadonlySet<TxSource> = new Set([
  'manual',
  'nfce',
  'recurrence',
  'installment',
]);
const EXTERNAL_SOURCES: ReadonlySet<TxSource> = new Set(['pluggy', 'ofx', 'csv']);

type Direction = 'out' | 'in';

/** Saída ↔ despesa; entrada ↔ receita/estorno (RN-66). Transferências ficam com a RN-71. */
export function directionOf(kind: TxKind): Direction | null {
  switch (kind) {
    case 'expense':
    case 'adjust_out':
      return 'out';
    case 'income':
    case 'refund':
    case 'adjust_in':
      return 'in';
    default:
      return null;
  }
}

const ONE_DAY_TERMS = /\b(PIX|TED|DOC|BOLETO|TRANSF(ERENCIA)?)\b/;

function inferMethod(item: ReconItem): PaymentMethod | null {
  if (item.paymentMethod) {
    return item.paymentMethod;
  }
  const text = (item.description ?? '').toUpperCase();
  const match = ONE_DAY_TERMS.exec(text);
  if (!match) {
    return null;
  }
  if (match[1] === 'PIX') {
    return 'pix';
  }
  if (match[1] === 'BOLETO') {
    return 'boleto';
  }
  return 'transfer';
}

/** Janela J da RN-66 para o par (importado, lançamento). */
export function matchWindowDays(
  imported: ReconItem,
  manual: ReconItem,
  opts: ReconOptions,
): number {
  const w = opts.windowDays;
  if (imported.source === 'nfce' || manual.source === 'nfce') {
    return w.nfce;
  }
  if (manual.source === 'recurrence') {
    return w.recurrence;
  }
  if (manual.cardId !== null || imported.cardId !== null) {
    return w.card;
  }
  const method = inferMethod(manual) ?? inferMethod(imported);
  switch (method) {
    case 'pix':
      return w.pix;
    case 'transfer':
      return w.transfer;
    case 'boleto':
      return w.boleto;
    default:
      return w.debit;
  }
}

function sameOrigin(imported: ReconItem, other: ReconItem): boolean {
  if (imported.source === 'nfce') {
    return true; // NFC-e: qualquer conta (RN-66)
  }
  return imported.accountId === other.accountId && imported.cardId === other.cardId;
}

function withinTolerance(imported: ReconItem, manual: ReconItem, opts: ReconOptions): boolean {
  const diff = Math.abs(imported.amountCents - manual.amountCents);
  if (diff === 0) {
    return false;
  }
  const { minCents, pctBp } = opts.suggestTolerance;
  // max(R$ 2,00; 2% de valor_L) sem arredondar: diff ≤ L × bp / 10000 ⇔ diff × 10000 ≤ L × bp
  return diff <= minCents || diff * 10000 <= manual.amountCents * pctBp;
}

function compareByDate(a: ReconItem, b: ReconItem): number {
  return a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0;
}

/**
 * Decide o destino de cada transação importada (RN-67, RN-72).
 * Processa em ordem de data, com atribuição 1:1: um lançamento conciliado sai da disputa.
 */
export function reconcile(
  imported: readonly ReconItem[],
  existing: readonly ReconItem[],
  opts: ReconOptions = DEFAULT_RECON_OPTIONS,
): ReconAction[] {
  const claimed = new Set<string>();
  // pares RN-72 já feitos nesta rodada: `${idExterno}|${fonteNova}`
  const paired = new Set<string>();
  const order = imported
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compareByDate(a.item, b.item) || a.index - b.index);
  const actions: ReconAction[] = new Array(imported.length);

  for (const { item: t, index } of order) {
    actions[index] = decide(t, existing, opts, claimed, paired);
  }
  return actions;
}

function decide(
  t: ReconItem,
  existing: readonly ReconItem[],
  opts: ReconOptions,
  claimed: Set<string>,
  paired: Set<string>,
): ReconAction {
  const dir = directionOf(t.kind);

  // RN-72: mesma transação vinda de outra fonte externa (NFC-e nunca é duplicata).
  if (t.source !== 'nfce' && EXTERNAL_SOURCES.has(t.source)) {
    const dup = existing
      .filter(
        (e) =>
          EXTERNAL_SOURCES.has(e.source) &&
          e.source !== t.source &&
          e.id !== t.id &&
          e.cancelled !== true &&
          directionOf(e.kind) === dir &&
          e.amountCents === t.amountCents &&
          sameOrigin(t, e) &&
          Math.abs(diffDays(e.occurredOn, t.occurredOn)) <= 1 &&
          !paired.has(`${e.id}|${t.source}`),
      )
      .sort(
        (a, b) =>
          Math.abs(diffDays(a.occurredOn, t.occurredOn)) -
            Math.abs(diffDays(b.occurredOn, t.occurredOn)) || compareByDate(a, b),
      )[0];
    if (dup) {
      paired.add(`${dup.id}|${t.source}`);
      return { importedId: t.id, action: 'duplicate', ofImportedId: dup.id };
    }
  }

  if (dir === null) {
    return { importedId: t.id, action: 'new' };
  }

  const pool = existing.filter(
    (l) =>
      MANUAL_SOURCES.has(l.source) &&
      l.id !== t.id &&
      !l.matchedExternal &&
      l.cancelled !== true &&
      !claimed.has(l.id) &&
      directionOf(l.kind) === dir &&
      sameOrigin(t, l) &&
      diffDays(l.occurredOn, t.occurredOn) <= opts.lookbackDays,
  );

  // RN-67.1/2: valor exato dentro de J; menor |Δdata|; empate → decisão do usuário.
  const exact = pool
    .filter(
      (l) =>
        l.amountCents === t.amountCents &&
        Math.abs(diffDays(l.occurredOn, t.occurredOn)) <= matchWindowDays(t, l, opts),
    )
    .map((l) => ({ l, gap: Math.abs(diffDays(l.occurredOn, t.occurredOn)) }))
    .sort((a, b) => a.gap - b.gap);
  const best = exact[0];
  if (best) {
    const tied = exact.filter((c) => c.gap === best.gap);
    if (tied.length === 1) {
      claimed.add(best.l.id);
      return { importedId: t.id, action: 'auto_merge', matchId: best.l.id };
    }
    return {
      importedId: t.id,
      action: 'suggest',
      matchIds: tied.map((c) => c.l.id).sort(),
      reason: 'tie',
    };
  }

  // RN-67.3: aproximado dentro de J + 2 dias → "É o mesmo?".
  const approx = pool
    .filter(
      (l) =>
        Math.abs(diffDays(l.occurredOn, t.occurredOn)) <= matchWindowDays(t, l, opts) + 2 &&
        withinTolerance(t, l, opts),
    )
    .sort(
      (a, b) =>
        Math.abs(a.amountCents - t.amountCents) - Math.abs(b.amountCents - t.amountCents) ||
        Math.abs(diffDays(a.occurredOn, t.occurredOn)) -
          Math.abs(diffDays(b.occurredOn, t.occurredOn)) ||
        (a.id < b.id ? -1 : 1),
    );
  if (approx.length > 0) {
    return {
      importedId: t.id,
      action: 'suggest',
      matchIds: approx.map((l) => l.id),
      reason: 'approx',
    };
  }

  // RN-67.4
  return { importedId: t.id, action: 'new' };
}

export interface MergePlan {
  importedPatch: { reviewState: 'merged'; duplicateOf: string };
  manualPatch: {
    matchedExternal: true;
    status: 'posted';
    amountCents?: Cents;
    description?: string;
    invoiceId?: string;
    invoicePinned?: true;
  };
}

/**
 * RN-68: o manual mantém categoria, descrição, notas e data; recebe a descrição do banco só se vazia;
 * aceito por aproximação → valor do banco; fatura informada pelo banco prevalece (RN-19).
 */
export function planMerge(
  imported: ReconItem,
  manual: ReconItem,
  opts: { approx: boolean; bankInvoiceId?: string },
): MergePlan {
  const manualPatch: MergePlan['manualPatch'] = { matchedExternal: true, status: 'posted' };
  if ((manual.description ?? '').trim() === '' && (imported.description ?? '').trim() !== '') {
    manualPatch.description = imported.description ?? '';
  }
  if (opts.approx && imported.amountCents !== manual.amountCents) {
    manualPatch.amountCents = imported.amountCents;
  }
  if (opts.bankInvoiceId) {
    manualPatch.invoiceId = opts.bankInvoiceId;
    manualPatch.invoicePinned = true;
  }
  return { importedPatch: { reviewState: 'merged', duplicateOf: manual.id }, manualPatch };
}

/** Namespace fixo das chaves de linha importada sem id (gerado em 06/11/2026). [CONTRATO] */
export const NS_IMPORT_ROW = 'c9e7ce99-5d5e-4bf4-a6e3-dc95e0a2b303';

function canonicalText(text: string): string {
  return text.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}

/** Chave de deduplicação na mesma fonte (RN-65). */
export function importedDedupKey(
  source: 'ofx' | 'csv' | 'pluggy',
  parts: {
    fitId?: string;
    externalId?: string;
    date: ISODate;
    amountCents: Cents;
    description: string;
    ordinal: number;
  },
): string {
  if (source === 'pluggy') {
    if (!parts.externalId) {
      throw new DomainError('INVALID_ARGUMENT', 'transação da Pluggy sem id');
    }
    return parts.externalId;
  }
  if (source === 'ofx' && parts.fitId && parts.fitId.trim() !== '') {
    // o BB pode repetir FITID entre lançamentos diferentes
    return `${parts.fitId.trim()}|${parts.date}|${parts.amountCents}`;
  }
  if (source === 'csv' && parts.externalId && parts.externalId.trim() !== '') {
    return `${parts.externalId.trim()}|${parts.date}|${parts.amountCents}`;
  }
  if (!Number.isInteger(parts.ordinal) || parts.ordinal < 0) {
    throw new DomainError('INVALID_ARGUMENT', 'ordinal da linha inválido');
  }
  const name = [
    source,
    parts.date,
    parts.amountCents,
    canonicalText(parts.description),
    parts.ordinal,
  ].join('|');
  return v5(name, NS_IMPORT_ROW);
}
