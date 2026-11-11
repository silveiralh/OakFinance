// I01/I02 (US-45, US-46; RN-79, RN-80): regras puras das telas de conexão. Contratos das funções na tech §6.0;
// o mapeamento de contas segue a tech §6.1.3 passo 5 (vincular, criar pré-preenchido ou ignorar).
import type { LocalRow } from '../../data/db';
import { t } from '../../i18n/pt-BR';

/** `ExternalAccountDTO` de `supabase/functions/_shared/pluggy-link.ts` (o que o `pluggy-link-item` devolve). */
export interface ExternalAccountDTO {
  id: string;
  type: string;
  subtype: string;
  name: string | null;
  numberMasked: string | null;
  accountId: string | null;
  cardId: string | null;
  isIgnored: boolean;
  suggestion: {
    closingDay: number | null;
    dueDay: number | null;
    limitCents: number | null;
  } | null;
}

export interface ConnectTokenResponse {
  connectToken: string;
  connectorIds: number[];
  expiresAt: string;
}

export interface LinkResponse {
  connectionId: string;
  status: string;
  accounts: ExternalAccountDTO[];
}

export interface SyncStats {
  accounts: number;
  inserted: number;
  updated: number;
  deleted: number;
  bills: number;
}

export interface SyncResponse {
  jobRunId: string;
  stats: SyncStats;
}

/** Dias do backfill da primeira sincronização (RN-80). */
export const BACKFILL_DAYS = 90;
/** "Atualizar agora": no máximo 1 vez por hora por conexão (RN-80, limite do `PATCH /items`). */
export const REFRESH_INTERVAL_MIN = 60;
/** "Expira em breve": consentimento a 7 dias ou menos (RN-94). */
export const EXPIRING_DAYS = 7;

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const TZ = 'America/Sao_Paulo';

type Connection = LocalRow<'bank_connections'>;

export function isCredit(account: Pick<ExternalAccountDTO, 'type' | 'subtype'>): boolean {
  return account.type === 'CREDIT' || account.subtype === 'CREDIT_CARD';
}

const INSTITUTIONS: Record<string, string> = { bb: 'Banco do Brasil', nubank: 'Nubank' };

/** Nome do banco para os textos ("O {banco} não respondeu."). */
export function bankName(
  connection: Pick<Connection, 'institution' | 'connector_name'> | null | undefined,
): string {
  const institution = connection?.institution?.toLowerCase() ?? '';
  return INSTITUTIONS[institution] ?? connection?.connector_name ?? 'banco';
}

/** Item ID colado do dashboard da Pluggy (plano B): sem espaços, letras, números e hífens. */
export function normalizeItemId(text: string): string | null {
  const id = text.trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

export type ConnectionState =
  | 'active'
  | 'updating'
  | 'expiring'
  | 'expired'
  | 'reconnect'
  | 'error';

/** Status da Pluggy que pedem reconectar no Meu Pluggy (RN-81: `erro_login`/`expirada`). */
const RECONNECT_STATUS = new Set(['LOGIN_ERROR', 'OUTDATED', 'WAITING_USER_INPUT']);
const RECONNECT_EXECUTION = new Set(['USER_AUTHORIZATION_REVOKED']);
/** Erro temporário com a contagem do `pluggy-sync` (RN-81): até 3 novas tentativas sem avisar. */
const TEMPORARY = /^(UPSTREAM_UNAVAILABLE|UPSTREAM_TIMEOUT)(?::(\d+))?$/;
export const TEMPORARY_RETRIES = 3;

/** Dias inteiros até o fim do consentimento (`null` sem data: por padrão não expira). */
export function daysUntil(iso: string | null, nowMs: number): number | null {
  if (!iso) {
    return null;
  }
  return Math.ceil((Date.parse(iso) - nowMs) / DAY_MS);
}

/** Falhas seguidas do erro temporário (0 se o último erro não for temporário). */
export function temporaryFailures(lastError: string | null): number {
  const match = TEMPORARY.exec(lastError ?? '');
  return match ? Number(match[2] ?? 1) : 0;
}

/**
 * Estado do card (UX §3 I01, RN-81): expirada; precisa reconectar (erro de login ou autorização revogada); erro do
 * banco só depois das 3 novas tentativas do erro temporário (antes disso, sem avisar); atualizando; expira em breve
 * (≤ 7 dias, RN-94); ativa.
 */
export function connectionState(
  connection: Pick<Connection, 'status' | 'consent_expires_at'> &
    Partial<Pick<Connection, 'execution_status' | 'last_error'>>,
  nowMs: number,
): ConnectionState {
  const days = daysUntil(connection.consent_expires_at, nowMs);
  if (days !== null && days <= 0) {
    return 'expired';
  }
  if (
    RECONNECT_STATUS.has(connection.status) ||
    RECONNECT_EXECUTION.has(connection.execution_status ?? '')
  ) {
    return 'reconnect';
  }
  if (temporaryFailures(connection.last_error ?? null) > TEMPORARY_RETRIES) {
    return 'error';
  }
  if (connection.status === 'UPDATING') {
    return 'updating';
  }
  if (days !== null && days <= EXPIRING_DAYS) {
    return 'expiring';
  }
  return 'active';
}

/** O Início mostra o aviso de renovar (tech §6.1.3 passo 8) para estes estados. */
export function needsRenewal(state: ConnectionState): boolean {
  return state === 'expired' || state === 'reconnect' || state === 'expiring';
}

function parts(ms: number) {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    out[p.type] = p.value;
  }
  return out;
}

/** "Atualizado hoje às 07:40" / "Atualizado em 10/11 às 19:40" (UX §3 I01), no fuso do cliente. */
export function updatedText(iso: string | null, nowMs: number): string | null {
  if (!iso) {
    return null;
  }
  const at = parts(Date.parse(iso));
  const now = parts(nowMs);
  const sameDay = at.day === now.day && at.month === now.month && at.year === now.year;
  const when = sameDay
    ? `hoje às ${at.hour}:${at.minute}`
    : `em ${at.day}/${at.month} às ${at.hour}:${at.minute}`;
  return t('conn.updated', { quando: when });
}

/** Minutos desde a última atualização manual e quanto falta para a próxima, ou `null` se já pode. */
export function refreshWait(
  lastManualIso: string | null,
  nowMs: number,
): { ago: number; wait: number } | null {
  if (!lastManualIso) {
    return null;
  }
  const ago = Math.max(0, Math.floor((nowMs - Date.parse(lastManualIso)) / MIN_MS));
  if (ago >= REFRESH_INTERVAL_MIN) {
    return null;
  }
  return { ago, wait: REFRESH_INTERVAL_MIN - ago };
}

/** Texto do erro de uma chamada (código estável da tech §6.0 ou falha da chamada). */
export function errorText(
  failure: { reason: 'timeout' | 'offline' | 'failed'; code?: string },
  banco: string,
): string {
  if (failure.reason === 'offline') {
    return t('conn.needsInternet');
  }
  if (failure.reason === 'timeout' || failure.code === 'UPSTREAM_TIMEOUT') {
    return t('conn.slow');
  }
  switch (failure.code) {
    case 'ITEM_NOT_FOUND':
      return t('conn.itemNotFound');
    case 'ITEM_FOREIGN':
      return t('conn.itemForeign');
    case 'CONNECTOR_NOT_ALLOWED':
      return t('conn.notAllowed');
    case 'UPSTREAM_UNAVAILABLE':
      return t('conn.unavailable', { banco });
    default:
      return t('conn.failed');
  }
}

export type MapChoice =
  | { kind: 'link'; target: string }
  | { kind: 'create'; name: string; closingDay: string; dueDay: string }
  | { kind: 'ignore' };

export interface LinkTarget {
  /** `account:<id>` ou `card:<id>`. */
  value: string;
  label: string;
}

type Named = { id: string; name: string; deleted_at: string | null; archived_at: string | null };

function alive<T extends Named>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.deleted_at === null && r.archived_at === null);
}

/** Destinos possíveis: cartões para a conta de crédito, contas para as demais. */
export function linkTargets(
  account: Pick<ExternalAccountDTO, 'type' | 'subtype'>,
  accounts: readonly Named[],
  cards: readonly Named[],
): LinkTarget[] {
  return isCredit(account)
    ? alive(cards).map((c) => ({ value: `card:${c.id}`, label: c.name }))
    : alive(accounts).map((a) => ({ value: `account:${a.id}`, label: a.name }));
}

function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLocaleLowerCase('pt-BR');
}

/** Nome sugerido para "Criar nova": o nome da conta no banco, ou o banco com o tipo. */
export function suggestedName(account: ExternalAccountDTO, banco: string): string {
  const base = account.name?.trim() || `${banco} ${isCredit(account) ? 'cartão' : 'conta'}`;
  return base.slice(0, 40);
}

/**
 * Escolha inicial de cada conta do banco: o mapeamento já gravado; senão vincular ao destino com o mesmo nome
 * (ou o nome do banco); senão criar nova, pré-preenchida (tech §6.1.3 passo 5).
 */
export function defaultChoice(
  account: ExternalAccountDTO,
  targets: readonly LinkTarget[],
  banco: string,
): MapChoice {
  if (account.isIgnored) {
    return { kind: 'ignore' };
  }
  const mappedValue = account.cardId
    ? `card:${account.cardId}`
    : account.accountId
      ? `account:${account.accountId}`
      : null;
  if (mappedValue && targets.some((x) => x.value === mappedValue)) {
    return { kind: 'link', target: mappedValue };
  }
  const wanted = [account.name ?? '', banco].map(folded).filter(Boolean);
  const same = targets.find((x) => wanted.includes(folded(x.label)));
  if (same) {
    return { kind: 'link', target: same.value };
  }
  return {
    kind: 'create',
    name: suggestedName(account, banco),
    closingDay: String(account.suggestion?.closingDay ?? ''),
    dueDay: String(account.suggestion?.dueDay ?? ''),
  };
}

/** Argumentos da RPC `map_external_account` para uma escolha já resolvida (o "criar" vira o id criado). */
export function mapArgs(
  externalId: string,
  resolved: { kind: 'account' | 'card'; id: string } | null,
): { p_id: string; p_account_id: string | null; p_card_id: string | null; p_is_ignored: boolean } {
  return {
    p_id: externalId,
    p_account_id: resolved?.kind === 'account' ? resolved.id : null,
    p_card_id: resolved?.kind === 'card' ? resolved.id : null,
    p_is_ignored: resolved === null,
  };
}

/** O banco liberou só a conta, sem o cartão (UX §3 I02): aviso com a saída pela fatura em CSV. */
export function cardMissing(accounts: readonly ExternalAccountDTO[], institution: string | null) {
  return institution?.toLowerCase() === 'nubank' && !accounts.some(isCredit);
}

export interface SyncSummary {
  fresh: number;
  linked: number;
  review: number;
}

/**
 * Resumo depois de uma sincronização: "{n} novas · {m} vinculadas · {k} para conferir" (UX §3 I01). Conta os
 * lançamentos do Open Finance criados desde `sinceIso` nos destinos da conexão.
 */
export function syncSummary(
  rows: readonly LocalRow<'transactions'>[],
  sinceIso: string,
  targets: { accounts: ReadonlySet<string>; cards: ReadonlySet<string> },
): SyncSummary {
  const out: SyncSummary = { fresh: 0, linked: 0, review: 0 };
  for (const row of rows) {
    const inTarget =
      (row.account_id !== null && targets.accounts.has(row.account_id)) ||
      (row.card_id !== null && targets.cards.has(row.card_id));
    if (row.source !== 'pluggy' || !inTarget || row.created_at < sinceIso) {
      continue;
    }
    if (row.review_state === 'merged' || row.duplicate_of !== null) {
      out.linked += 1;
    } else if (row.review_state === 'suggested') {
      out.review += 1;
    } else if (row.deleted_at === null) {
      out.fresh += 1;
    }
  }
  return out;
}
