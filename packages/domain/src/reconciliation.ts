// Conciliação e deduplicação (tech §5.9; RN-19, RN-65..RN-72). Regras determinísticas, sem pontuação.
import { v5 } from 'uuid';
import { merchantKey, normalizeDescription, tokenPrefixMatch } from './categorization.ts';
import { addMonths, clampDay, diffDays, monthOf, parseISODate } from './dates.ts';
import { DomainError } from './errors.ts';
import { type InstallmentPlanInput, MAX_INSTALLMENTS, MIN_INSTALLMENTS } from './installments.ts';
import {
  type InvoiceDates,
  type InvoicePeriod,
  type InvoiceStatus,
  type InvoiceTotals,
  invoiceForPurchase,
  invoicePeriod,
} from './invoices.ts';
import type {
  Card,
  Cents,
  ISODate,
  PaymentMethod,
  ReviewState,
  Tx,
  TxKind,
  TxSource,
  YearMonth,
} from './types.ts';

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
  /** Ocorrência de recorrência com valor variável (RN-70). */
  isVariableAmount?: boolean;
  /** `recurrences.match_pattern` ("termo de conciliação", RN-70), já normalizado pela RN-57. */
  matchPattern?: string | null;
  /** Mês da fatura informado pelo banco (RN-19) ou calculado pelo chamador; usado na RN-69. */
  invoiceMonth?: YearMonth | null;
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

  // RN-70: recorrência com valor variável casa pelo termo de conciliação dentro de J (5 dias).
  const normalized = normalizeDescription(t.description ?? '');
  const variable = pool
    .filter(
      (l) =>
        l.source === 'recurrence' &&
        l.isVariableAmount === true &&
        typeof l.matchPattern === 'string' &&
        tokenPrefixMatch(l.matchPattern, normalized) &&
        Math.abs(diffDays(l.occurredOn, t.occurredOn)) <= matchWindowDays(t, l, opts),
    )
    .map((l) => ({ l, gap: Math.abs(diffDays(l.occurredOn, t.occurredOn)) }))
    .sort((a, b) => a.gap - b.gap);
  const nearest = variable[0];
  if (nearest) {
    const tied = variable.filter((c) => c.gap === nearest.gap);
    if (tied.length === 1) {
      claimed.add(nearest.l.id);
      return { importedId: t.id, action: 'auto_merge', matchId: nearest.l.id };
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
 * aceito por aproximação ou recorrência de valor variável (RN-70) → valor do banco; fatura informada pelo banco
 * prevalece (RN-19).
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
  // RN-70: na recorrência de valor variável, a ocorrência assume o valor do banco.
  const variable = manual.source === 'recurrence' && manual.isVariableAmount === true;
  if ((opts.approx || variable) && imported.amountCents !== manual.amountCents) {
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

// ─── RN-19: fatura informada pelo banco ──────────────────────────────────────────────────────────

/**
 * RN-19: se o banco informa a fatura (mês do vencimento), o item vai para ela com `invoicePinned`, mesmo que a
 * RN-12 dê outro resultado; sem referência, vale a RN-12.
 */
export function invoiceForImported(
  card: Card,
  occurredOn: ISODate,
  bankReferenceMonth: YearMonth | null,
  overrides: readonly InvoiceDates[] = [],
): { invoice: InvoicePeriod; invoicePinned: boolean } {
  if (bankReferenceMonth !== null) {
    return { invoice: invoicePeriod(card, bankReferenceMonth, overrides), invoicePinned: true };
  }
  return { invoice: invoiceForPurchase(card, occurredOn, overrides), invoicePinned: false };
}

// ─── RN-69: parcelas importadas ──────────────────────────────────────────────────────────────────

/** Regex literal da RN-69. */
export const INSTALLMENT_MARKER_RE = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/g;

export interface InstallmentMarker {
  number: number;
  count: number;
}

function validMarker(k: number, n: number): InstallmentMarker | null {
  // 1 ≤ k ≤ n ≤ 48 (RN-69); "1/1" não é série (mínimo de 2 parcelas, RN-20).
  return Number.isInteger(k) &&
    Number.isInteger(n) &&
    k >= 1 &&
    k <= n &&
    n >= MIN_INSTALLMENTS &&
    n <= MAX_INSTALLMENTS
    ? { number: k, count: n }
    : null;
}

function markerInText(
  text: string,
): (InstallmentMarker & { index: number; length: number }) | null {
  let found: (InstallmentMarker & { index: number; length: number }) | null = null;
  // o último k/n válido vence: bancos põem a parcela no fim ("05/11 LOJA X 02/10")
  for (const m of text.matchAll(INSTALLMENT_MARKER_RE)) {
    const marker = validMarker(Number(m[1]), Number(m[2]));
    if (marker) {
      found = { ...marker, index: m.index, length: m[0].length };
    }
  }
  return found;
}

/** RN-69: metadado de parcela do agregador; na falta dele, o padrão `k/n` da descrição. */
export function installmentMarkerOf(
  item: Pick<ReconItem, 'description' | 'installmentNumber' | 'installmentCount'>,
): InstallmentMarker | null {
  if (item.installmentNumber !== null && item.installmentCount !== null) {
    return validMarker(item.installmentNumber, item.installmentCount);
  }
  const found = markerInText(item.description ?? '');
  return found ? { number: found.number, count: found.count } : null;
}

function monthsBetween(a: YearMonth, b: YearMonth): number {
  const pa = parseISODate(`${a}-01`);
  const pb = parseISODate(`${b}-01`);
  return pb.year * 12 + pb.month - (pa.year * 12 + pa.month);
}

export interface ImportedSeriesCandidate {
  id: string;
  cardId: string | null;
  count: number;
  totalCents: Cents;
  purchaseDate: ISODate;
  /** Mês da fatura da 1ª parcela (F1), quando conhecido. */
  firstInvoiceMonth?: YearMonth | null;
  firstInstallmentCents?: Cents | null;
}

function installmentValue(plan: ImportedSeriesCandidate, k: number): Cents | null {
  if (!Number.isSafeInteger(plan.totalCents) || plan.totalCents < plan.count) {
    return null;
  }
  const first = plan.firstInstallmentCents ?? null;
  if (first !== null) {
    if (k === 1) {
      return first;
    }
    const rest = plan.totalCents - first;
    if (rest < plan.count - 1) {
      return null;
    }
    const base = Math.floor(rest / (plan.count - 1));
    return k === 2 ? rest - base * (plan.count - 2) : base;
  }
  const base = Math.floor(plan.totalCents / plan.count);
  return k === 1 ? plan.totalCents - base * (plan.count - 1) : base; // RN-21: resto na 1ª
}

/**
 * Distância (em meses) entre a fatura da parcela k da série e a da transação; `null` fora da tolerância.
 * Com F1 e o mês da fatura do banco: ±1 (RN-69). Sem eles: o banco pode repetir a data da compra (até 3 dias) ou
 * mandar a data do lançamento da parcela; F1 fica entre o mês da compra e o 2º seguinte, daí −1..+3 meses.
 */
function seriesGap(imported: ReconItem, plan: ImportedSeriesCandidate, k: number): number | null {
  const bankMonth = imported.invoiceMonth ?? null;
  if (bankMonth !== null && plan.firstInvoiceMonth) {
    const gap = Math.abs(monthsBetween(addMonths(plan.firstInvoiceMonth, k - 1), bankMonth));
    return gap <= 1 ? gap : null;
  }
  if (Math.abs(diffDays(plan.purchaseDate, imported.occurredOn)) <= 3) {
    return 0;
  }
  const expected = addMonths(monthOf(plan.purchaseDate), k - 1);
  const gap = monthsBetween(expected, bankMonth ?? monthOf(imported.occurredOn));
  return gap >= -1 && gap <= 3 ? Math.abs(gap) : null;
}

/**
 * RN-69 (1º item): série do mesmo cartão, mesmo n, com a parcela k de valor exato (tolerância R$ 0,01) na mesma
 * fatura ±1. A parcela a conciliar é `installmentTxId(seriesId, k)`. Várias séries → menor distância de fatura,
 * menor diferença de valor, compra mais recente.
 */
export function linkImportedInstallment(
  imported: ReconItem,
  plans: readonly ImportedSeriesCandidate[],
): { seriesId: string } | null {
  const marker = installmentMarkerOf(imported);
  if (marker === null || imported.cardId === null) {
    return null;
  }
  const k = marker.number;
  const ranked = plans
    .filter((p) => p.cardId === imported.cardId && p.count === marker.count)
    .map((p) => {
      const value = installmentValue(p, k);
      const diff =
        value === null ? Number.POSITIVE_INFINITY : Math.abs(value - imported.amountCents);
      return { p, diff, gap: diff <= 1 ? seriesGap(imported, p, k) : null };
    })
    .filter((c): c is { p: ImportedSeriesCandidate; diff: number; gap: number } => c.gap !== null)
    .sort(
      (a, b) =>
        a.gap - b.gap ||
        a.diff - b.diff ||
        (a.p.purchaseDate > b.p.purchaseDate ? -1 : a.p.purchaseDate < b.p.purchaseDate ? 1 : 0) ||
        (a.p.id < b.p.id ? -1 : 1),
    );
  const best = ranked[0];
  return best ? { seriesId: best.p.id } : null;
}

export interface ImportedInstallmentPlan extends InstallmentPlanInput {
  /** k > 1: as parcelas anteriores não são criadas (selo "importada parcialmente", RN-69). */
  partiallyImported: boolean;
}

function shiftMonths(d: ISODate, n: number): ISODate {
  return clampDay(addMonths(monthOf(d), n), parseISODate(d).day);
}

/**
 * RN-69 (2º e 3º itens): sem série, cria o plano da série a partir da parcela k. k = 1 → série completa;
 * k > 1 → parcelas k..n ("importada parcialmente"). Total = valor × n, ou o total do agregador pela RN-21.
 * A data da compra recua k − 1 meses para a parcela k cair na fatura da transação (RN-22).
 */
export function importedInstallmentPlan(
  imported: ReconItem,
  seriesId: string,
  opts: { totalCents?: Cents | null; categoryId?: string | null; purchaseDate?: ISODate } = {},
): ImportedInstallmentPlan | null {
  const marker = installmentMarkerOf(imported);
  if (marker === null || (imported.cardId === null && imported.accountId === null)) {
    return null;
  }
  const { number: k, count: n } = marker;
  const fromBank = opts.totalCents ?? null;
  const totalCents =
    fromBank !== null && Number.isSafeInteger(fromBank) && fromBank >= n
      ? fromBank
      : imported.amountCents * n;
  const raw = imported.description ?? '';
  const inText = markerInText(raw);
  const description =
    (inText ? `${raw.slice(0, inText.index)} ${raw.slice(inText.index + inText.length)}` : raw)
      .replace(/\s+/g, ' ')
      .trim() || raw.trim();
  const anchor = shiftMonths(imported.occurredOn, -(k - 1));
  const card = imported.cardId !== null;
  return {
    seriesId,
    cardId: card ? imported.cardId : null,
    accountId: card ? null : imported.accountId,
    purchaseDate: opts.purchaseDate ?? anchor,
    ...(card ? {} : { firstDueOn: anchor }),
    totalCents,
    count: n,
    startInstallment: k,
    description,
    categoryId: opts.categoryId ?? null,
    partiallyImported: k > 1,
  };
}

// ─── RN-71: pagamento de fatura, créditos no cartão e transferências ─────────────────────────────

/** Termos da RN-71 (1º item). */
export const INVOICE_PAYMENT_TERMS: readonly string[] = [
  'FATURA',
  'NUBANK',
  'NU PAGAMENTOS',
  'CARTAO',
  'OUROCARD',
];
/** Termos da RN-71 (2º item). */
export const CARD_PAYMENT_RECEIVED_TERMS: readonly string[] = [
  'PAGAMENTO RECEBIDO',
  'PAGAMENTO EFETUADO',
];

/**
 * Normalização da RN-57 (etapas 1–3 e 6) sem tirar stopwords nem tokens com dígito: as stopwords da RN-58
 * apagariam justamente "CARTAO", "NU", "PAGAMENTO" e "RECEBIDO".
 */
function plainText(raw: string | null): string {
  return ` ${(raw ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()} `;
}

function hasTerm(raw: string | null, terms: readonly string[]): boolean {
  const text = plainText(raw);
  return terms.some((term) => text.includes(` ${term} `));
}

function aliveTx(tx: Tx): boolean {
  return tx.deletedAt === null && tx.status !== 'cancelled';
}

const PAYABLE: ReadonlySet<InvoiceStatus> = new Set(['closed', 'overdue', 'partial']);

export type PayableInvoice = InvoicePeriod & { totals: InvoiceTotals; status: InvoiceStatus };

/**
 * RN-71 (1º item): saída na conta com valor igual ao total ou ao saldo de uma fatura closed/overdue/partial, com
 * fechamento ≤ data ≤ vencimento + 5 → pagamento automático; descrição com FATURA/NUBANK/NU PAGAMENTOS/CARTAO/
 * OUROCARD → pagamento automático se o valor for exato, senão sugestão ("Pagamento da fatura de <mês>?").
 * Com a descrição, o valor exato vale também depois do vencimento + 5 (fatura vencida); a sugestão só aponta
 * fatura cuja janela contém a data. Duas faturas com o mesmo valor exato → sugestão.
 */
export function detectInvoicePayments(
  imported: readonly Tx[],
  invoices: readonly PayableInvoice[],
): Array<{ txId: string; invoiceId: string; auto: boolean }> {
  const payable = invoices.filter((inv) => PAYABLE.has(inv.status));
  const result: Array<{ txId: string; invoiceId: string; auto: boolean }> = [];
  for (const tx of imported) {
    if (!aliveTx(tx) || tx.kind !== 'expense' || tx.accountId === null || tx.cardId !== null) {
      continue;
    }
    const d = tx.occurredOn;
    const termed = hasTerm(tx.description, INVOICE_PAYMENT_TERMS);
    const inWindow = (inv: PayableInvoice) => inv.closingDate <= d && diffDays(inv.dueDate, d) <= 5;
    const exact = (inv: PayableInvoice) => {
      const total = inv.totals.chargesCents - inv.totals.creditsCents;
      return tx.amountCents === total || tx.amountCents === inv.totals.balanceCents;
    };
    const rank = (a: PayableInvoice, b: PayableInvoice) =>
      Number(inWindow(b)) - Number(inWindow(a)) ||
      Math.abs(diffDays(a.dueDate, d)) - Math.abs(diffDays(b.dueDate, d)) ||
      (a.id < b.id ? -1 : 1);
    const exactHits = payable
      .filter((inv) => exact(inv) && (inWindow(inv) || (termed && inv.closingDate <= d)))
      .sort(rank);
    const first = exactHits[0];
    if (first) {
      result.push({ txId: tx.id, invoiceId: first.id, auto: exactHits.length === 1 });
      continue;
    }
    if (termed) {
      const near = payable.filter(inWindow).sort(rank)[0];
      if (near) {
        result.push({ txId: tx.id, invoiceId: near.id, auto: false });
      }
    }
  }
  return result;
}

/**
 * Efeito da RN-71 (1º item) no lançamento: vira transferência para o cartão na fatura paga, sem categoria
 * (não conta como despesa). Sugestão fica `suggested` (não conta até a decisão).
 */
export function invoicePaymentPatch(
  match: { invoiceId: string; auto: boolean },
  invoice: Pick<InvoicePeriod, 'id' | 'cardId'>,
): Pick<Tx, 'kind' | 'counterpartCardId' | 'invoiceId' | 'categoryId' | 'reviewState'> {
  if (match.invoiceId !== invoice.id) {
    throw new DomainError('INVALID_ARGUMENT', 'fatura diferente da detectada');
  }
  return {
    kind: 'transfer',
    counterpartCardId: invoice.cardId,
    invoiceId: invoice.id,
    categoryId: null,
    reviewState: match.auto ? 'ok' : 'suggested',
  };
}

/**
 * RN-71 (2º item): entrada no cartão "Pagamento recebido"/"PAGAMENTO EFETUADO" → `ignored` (o pagamento já é a
 * saída da conta corrente). Devolve os ids.
 */
export function detectIgnoredCardCredits(imported: readonly Tx[]): string[] {
  return imported
    .filter(
      (tx) =>
        aliveTx(tx) &&
        tx.cardId !== null &&
        (tx.kind === 'income' || tx.kind === 'refund') &&
        hasTerm(tx.description, CARD_PAYMENT_RECEIVED_TERMS),
    )
    .map((tx) => tx.id);
}

/**
 * RN-71 (3º item): saída numa conta e entrada do mesmo valor em OUTRA conta do usuário, |Δdata| ≤ janela →
 * sugestão de transferência. Pareamento 1:1 em ordem de data, pela menor |Δdata|.
 */
export function detectInternalTransfers(
  txs: readonly Tx[],
  opts: { windowDays: number } = { windowDays: 1 },
): Array<{ outId: string; inId: string }> {
  const usable = (tx: Tx) =>
    aliveTx(tx) &&
    tx.accountId !== null &&
    tx.cardId === null &&
    tx.duplicateOf === null &&
    tx.reviewState !== 'merged' &&
    tx.reviewState !== 'ignored';
  const byDate = (a: Tx, b: Tx) =>
    a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : a.id < b.id ? -1 : 1;
  const outs = txs.filter((tx) => usable(tx) && tx.kind === 'expense').sort(byDate);
  const ins = txs.filter((tx) => usable(tx) && tx.kind === 'income').sort(byDate);
  const used = new Set<string>();
  const pairs: Array<{ outId: string; inId: string }> = [];
  for (const out of outs) {
    const match = ins
      .filter(
        (inc) =>
          !used.has(inc.id) &&
          inc.accountId !== out.accountId &&
          inc.amountCents === out.amountCents &&
          Math.abs(diffDays(out.occurredOn, inc.occurredOn)) <= opts.windowDays,
      )
      .sort(
        (a, b) =>
          Math.abs(diffDays(out.occurredOn, a.occurredOn)) -
            Math.abs(diffDays(out.occurredOn, b.occurredOn)) || byDate(a, b),
      )[0];
    if (match) {
      used.add(match.id);
      pairs.push({ outId: out.id, inId: match.id });
    }
  }
  return pairs;
}

/** RN-70: termo de conciliação gravado na 1ª conciliação manual aceita (2 primeiros tokens, RN-62). */
export function matchPatternFor(description: string | null): string | null {
  const key = merchantKey(normalizeDescription(description ?? ''));
  return key === '' ? null : key;
}
