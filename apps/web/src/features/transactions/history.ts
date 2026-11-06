// Histórico do lançamento na T02 (RN-97, RN-98): lê `get_row_history` (online), descreve cada versão
// ("Categoria alterada de Lazer para Mercado · ontem 18:02 · neste aparelho") e monta a linha de "Restaurar esta
// versão". O servidor grava a versão substituída (`old_row`) e, no conflito, a escrita perdedora (`rejected_row`).
import { formatBRL, type ISODate } from '@oakfinance/domain';
import type { LocalRow } from '../../data/db';
import { MapperError, parseRow } from '../../data/mappers';
import { type MessageKey, t, uiText } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';

type Tx = LocalRow<'transactions'>;

export type HistoryOp = 'update' | 'delete' | 'restore' | 'stale_write';

export interface HistoryEntry {
  op: HistoryOp;
  oldRow: Record<string, unknown> | null;
  rejectedRow: Record<string, unknown> | null;
  deviceId: string | null;
  changedAt: string;
}

/** O que a RPC precisa do cliente do supabase-js. */
export interface HistoryClient {
  rpc(
    fn: 'get_row_history',
    args: { p_table: string; p_row_id: string },
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const OPS = new Set<string>(['update', 'delete', 'restore', 'stale_write']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Valida a resposta da RPC (mais recente primeiro); itens fora do formato são ignorados. */
export function parseHistory(data: unknown): HistoryEntry[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const out: HistoryEntry[] = [];
  for (const item of data) {
    const raw = asRecord(item);
    if (!raw || typeof raw.op !== 'string' || !OPS.has(raw.op)) {
      continue;
    }
    if (typeof raw.changed_at !== 'string') {
      continue;
    }
    out.push({
      op: raw.op as HistoryOp,
      oldRow: asRecord(raw.old_row),
      rejectedRow: asRecord(raw.rejected_row),
      deviceId: typeof raw.device_id === 'string' ? raw.device_id : null,
      changedAt: raw.changed_at,
    });
  }
  return out;
}

/** Chama `get_row_history('transactions', id)`. Lança se a RPC falhar (a tela mostra o erro ou o offline). */
export async function loadHistory(client: HistoryClient, id: string): Promise<HistoryEntry[]> {
  const { data, error } = await client.rpc('get_row_history', {
    p_table: 'transactions',
    p_row_id: id,
  });
  if (error) {
    throw new Error('HISTORY_FAILED');
  }
  return parseHistory(data);
}

/** Nomes para mostrar ids de categoria, conta e cartão. */
export interface HistoryNames {
  categories: ReadonlyMap<string, string>;
  accounts: ReadonlyMap<string, string>;
  cards: ReadonlyMap<string, string>;
  method(value: string | null): string;
}

const KIND_KEY: Readonly<Record<string, MessageKey>> = {
  expense: 'detail.kind.expense',
  income: 'detail.kind.income',
  transfer: 'detail.kind.transfer',
  refund: 'detail.kind.refund',
  adjust_in: 'detail.kind.adjust',
  adjust_out: 'detail.kind.adjust',
};

export function kindLabel(kind: unknown): string {
  const key = typeof kind === 'string' ? KIND_KEY[kind] : undefined;
  return key ? t(key) : t('detail.empty');
}

export function statusLabel(status: unknown): string {
  if (status === 'cancelled') {
    return uiText.stateCancelled;
  }
  if (status === 'pending') {
    return uiText.stateScheduled;
  }
  return t('detail.status.posted');
}

/** Campos comparados, na ordem em que aparecem no histórico. */
const FIELDS = [
  ['amount_cents', 'history.changed.amount'],
  ['category_id', 'history.changed.category'],
  ['occurred_on', 'history.changed.date'],
  ['description', 'history.changed.description'],
  ['notes', 'history.changed.notes'],
  ['payment_method', 'history.changed.method'],
  ['account_id', 'history.changed.account'],
  ['card_id', 'history.changed.card'],
  ['status', 'history.changed.status'],
  ['kind', 'history.changed.kind'],
] as const;

type Field = (typeof FIELDS)[number][0];

/** Colunas que "Restaurar esta versão" traz de volta (o resto — ids, auditoria, vínculos — fica como está). */
export const RESTORABLE = [
  'kind',
  'status',
  'amount_cents',
  'occurred_on',
  'occurred_at',
  'description',
  'notes',
  'category_id',
  'category_source',
  'category_rule_id',
  'payment_method',
  'account_id',
  'card_id',
  'invoice_id',
  'invoice_pinned',
  'counterpart_account_id',
  'counterpart_card_id',
  'income_expected',
  'count_before_received',
  'goal_id',
  'tags',
] as const satisfies readonly (keyof Tx)[];

/** Colunas que o servidor ou a auditoria mudam sozinhos: diferença só nelas não é "outros dados". */
const IGNORED = new Set([
  'updated_at',
  'server_version',
  'client_updated_at',
  'device_id',
  'created_at',
  'deleted_at',
  'user_id',
  'id',
]);

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function display(field: Field, value: unknown, names: HistoryNames): string {
  if (value === null || value === undefined || value === '') {
    return t('detail.empty');
  }
  switch (field) {
    case 'amount_cents':
      return typeof value === 'number' ? formatBRL(value) : t('detail.empty');
    case 'occurred_on':
      return typeof value === 'string' ? formatDateBR(value as ISODate) : t('detail.empty');
    case 'category_id':
      return names.categories.get(String(value)) ?? t('detail.empty');
    case 'account_id':
      return names.accounts.get(String(value)) ?? t('detail.empty');
    case 'card_id':
      return names.cards.get(String(value)) ?? t('detail.empty');
    case 'payment_method':
      return names.method(String(value)) || t('detail.empty');
    case 'status':
      return statusLabel(value);
    case 'kind':
      return kindLabel(value);
    default:
      return String(value);
  }
}

/** Frases de diferença entre duas versões ("Valor alterado de R$ 45,90 para R$ 49,50"). */
export function describeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  names: HistoryNames,
): string[] {
  const lines: string[] = [];
  const compared = new Set<string>();
  for (const [field, key] of FIELDS) {
    compared.add(field);
    if (same(before[field], after[field])) {
      continue;
    }
    lines.push(
      t(key, {
        de: display(field, before[field], names),
        para: display(field, after[field], names),
      }),
    );
  }
  const other = Object.keys({ ...before, ...after }).some(
    (column) =>
      !compared.has(column) && !IGNORED.has(column) && !same(before[column], after[column]),
  );
  if (other || lines.length === 0) {
    lines.push(t('history.changed.other'));
  }
  return lines;
}

/** Uma linha do histórico pronta para a tela. */
export interface HistoryItem {
  key: string;
  title: string;
  lines: string[];
  when: string;
  device: string;
  conflict: boolean;
  /** A versão que "Restaurar esta versão" grava (`null`: nada a restaurar). */
  version: Record<string, unknown> | null;
}

const TIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
});
const DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "Hoje 18:02", "Ontem 18:02" ou "03/11/2026 18:02", no fuso de São Paulo. */
export function whenLabel(changedAt: string, today: ISODate): string {
  const at = new Date(changedAt);
  if (Number.isNaN(at.getTime())) {
    return '';
  }
  const day = DAY.format(at) as ISODate;
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const label =
    day === today
      ? t('list.today')
      : day === yesterday.toISOString().slice(0, 10)
        ? t('list.yesterday')
        : formatDateBR(day);
  return `${label} ${TIME.format(at)}`;
}

/**
 * Descreve as entradas (mais recente primeiro). A versão que substituiu a de uma edição é a `old_row` da entrada
 * mais nova que mudou a linha (conflito não muda), ou a linha atual.
 */
export function describeHistory(
  entries: readonly HistoryEntry[],
  current: Tx,
  ownDevice: string | null,
  names: HistoryNames,
  today: ISODate,
): HistoryItem[] {
  let after: Record<string, unknown> = current as unknown as Record<string, unknown>;
  return entries.map((entry, index) => {
    const device =
      entry.deviceId !== null && entry.deviceId === ownDevice
        ? t('history.here')
        : t('history.elsewhere');
    const base = {
      key: `${entry.changedAt}-${index}`,
      when: whenLabel(entry.changedAt, today),
      device,
    };
    if (entry.op === 'stale_write') {
      const lost = entry.rejectedRow;
      return {
        ...base,
        title: t('history.conflict'),
        lines: lost && entry.oldRow ? describeChanges(entry.oldRow, lost, names) : [],
        conflict: true,
        version: lost,
      };
    }
    const before = entry.oldRow;
    const newer = after;
    if (before) {
      after = before;
    }
    if (entry.op === 'delete' || entry.op === 'restore') {
      return {
        ...base,
        title: t(entry.op === 'delete' ? 'history.deleted' : 'history.restored'),
        lines: [],
        conflict: false,
        version: null,
      };
    }
    const lines = before ? describeChanges(before, newer, names) : [];
    return {
      ...base,
      title: lines[0] ?? t('history.changed.other'),
      lines: lines.slice(1),
      conflict: false,
      version: before,
    };
  });
}

/**
 * Linha que "Restaurar esta versão" grava: a atual com as colunas de conteúdo da versão escolhida e viva de novo.
 * `null` se a versão não for uma linha válida de `transactions`.
 */
export function restoredRow(current: Tx, version: Record<string, unknown>): Tx | null {
  let parsed: Tx;
  try {
    parsed = parseRow('transactions', { ...current, ...version, id: current.id });
  } catch (error) {
    if (error instanceof MapperError) {
      return null;
    }
    throw error;
  }
  const next: Record<string, unknown> = { ...current, deleted_at: null };
  for (const column of RESTORABLE) {
    next[column] = parsed[column];
  }
  return next as unknown as Tx;
}
