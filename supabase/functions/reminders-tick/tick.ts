// Regras do reminders-tick (tech §6.4.5) sem I/O: o que vira aviso e push para cada usuário e o que fazer com cada
// push devido. O "agora" é sempre injetado. Ligados: lembrete diário (RN-87), fatura fechou (RN-88), vencimento de
// fatura (RN-89) — T-064 — e contas fixas e receitas (RN-90, RN-91, RN-34) — T-091; os outros tipos ficam
// desligados aqui até as tarefas deles.
import {
  DEFAULT_BUDGET_PCT_BP,
  DEFAULT_REMINDERS,
  type DueNotification,
  deliverAt,
  dueNotifications,
  type InvoicePeriod,
  type InvoiceTotals,
  type ISODate,
  invoiceTotals,
  noticeId,
  type PaymentMethod,
  type Recurrence,
  type ReminderKind,
  type ReminderPref,
  resolveProfileSettings,
  stillDue,
  type Tx,
  type YearMonth,
} from '../_shared/domain/index.ts';
import { declarativePayload, type SendResult } from '../_shared/push.ts';

export const TICK_KINDS: readonly ReminderKind[] = [
  'daily_log',
  'invoice_due',
  'invoice_closed',
  'bill_due',
  'bill_overdue',
  'income_unconfirmed',
];
/** Tamanho da janela de avaliação: o pg_cron chama a cada 15 min (RN-86). */
export const WINDOW_MINUTES = 15;
/** Teto de push por usuário por dia local (UX 6.7); os excedentes ficam só na central. */
export const DAILY_PUSH_CAP = 3;
/** Tentativas por push com 429/5xx antes de `failed` (tech §6.4.4). */
export const MAX_ATTEMPTS = 3;

export interface SnapshotInvoice {
  id: string;
  cardId: string;
  referenceMonth: YearMonth;
  closingDate: ISODate;
  dueDate: ISODate;
}

export interface SnapshotTx {
  id: string;
  kind: Tx['kind'];
  status: Tx['status'];
  amountCents: number;
  cardId: string | null;
  counterpartCardId: string | null;
  invoiceId: string | null;
  reviewState: Tx['reviewState'];
}

/** Recorrência ativa com lembrete, como o snapshot devolve (T-091). */
export interface SnapshotRecurrence {
  id: string;
  kind: 'expense' | 'income';
  description: string;
  amountCents: number;
  isVariableAmount: boolean;
  categoryId: string | null;
  accountId: string | null;
  cardId: string | null;
  paymentMethod: PaymentMethod;
  isFixedIncome: boolean;
  autoPost: boolean;
  remind: boolean;
  frequency: Recurrence['frequency'];
  intervalCount: number;
  dayOfMonth: number | null;
  weekday: number | null;
  monthOfYear: number | null;
  startOn: ISODate;
  endOn: ISODate | null;
  maxOccurrences: number | null;
}

/** Lançamento de uma ocorrência próxima ou receita avulsa pendente (RN-91, RN-34). */
export interface SnapshotRecurrenceTx {
  id: string;
  kind: Tx['kind'];
  status: Tx['status'];
  amountCents: number;
  occurredOn: ISODate;
  description: string | null;
  recurrenceId: string | null;
  recurrenceDate: ISODate | null;
  reviewState: Tx['reviewState'];
}

/** Uma linha de `reminders` como o snapshot devolve. */
export interface SnapshotReminder {
  kind: string;
  enabled: boolean;
  localTime: string;
  weekday: number | null;
  daysBefore: number[];
  skipIfLoggedToday: boolean;
}

export interface UserSnapshot {
  userId: string;
  timezone: string;
  settings: unknown;
  hasPush: boolean;
  reminders: SnapshotReminder[];
  cards: Record<string, string>;
  invoices: SnapshotInvoice[];
  txs: SnapshotTx[];
  loggedOn: ISODate[];
  /** T-091 (migração 13); ausente em snapshots antigos. */
  recurrences?: SnapshotRecurrence[];
  recurrenceTxs?: SnapshotRecurrenceTx[];
}

export interface NoticeRow {
  id: string;
  kind: ReminderKind;
  dedupeKey: string;
  title: string;
  body: string;
  navigate: string;
}

export interface OutboxRow {
  kind: ReminderKind;
  dedupeKey: string;
  payload: unknown;
  scheduledFor: string;
}

export interface UserPlan {
  notices: NoticeRow[];
  outbox: OutboxRow[];
}

export interface LocalNow {
  date: ISODate;
  time: string;
}

/** Data e hora locais ('YYYY-MM-DD', 'HH:MM') de um instante no fuso informado. */
export function localParts(instant: Date, timeZone: string): LocalNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

function fieldsAsUtc(local: LocalNow): number {
  const [y, m, d] = local.date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = local.time.split(':').map(Number) as [number, number];
  return Date.UTC(y, m - 1, d, hh, mm);
}

/** Instante UTC de uma data e hora locais no fuso (duas passadas cobrem a troca de horário de verão). */
export function zonedToUtc(local: LocalNow, timeZone: string): Date {
  const target = fieldsAsUtc(local);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const offset = fieldsAsUtc(localParts(new Date(guess), timeZone)) - guess;
    guess = target - offset;
  }
  return new Date(guess);
}

/** Preferências do domínio: só os tipos desta tarefa ficam como o usuário configurou; os outros, desligados. */
export function tickPrefs(rows: readonly SnapshotReminder[]): ReminderPref[] {
  return DEFAULT_REMINDERS.map((d) => {
    const row = rows.find((r) => r.kind === d.kind);
    const base: ReminderPref = {
      kind: d.kind,
      enabled: true,
      localTime: d.localTime,
      weekday: d.weekday,
      daysBefore: [...d.daysBefore],
      skipIfLoggedToday: true,
    };
    const pref: ReminderPref = row
      ? {
          kind: d.kind,
          enabled: row.enabled,
          localTime: row.localTime,
          weekday: row.weekday,
          daysBefore: [...row.daysBefore],
          skipIfLoggedToday: row.skipIfLoggedToday,
        }
      : base;
    return TICK_KINDS.includes(d.kind) ? pref : { ...pref, enabled: false };
  });
}

/** Lançamento mínimo para `invoiceTotals` (só os campos que o saldo usa vêm do banco). */
export function toTx(row: SnapshotTx): Tx {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    countBeforeReceived: false,
    invoicePinned: false,
    amountCents: row.amountCents,
    occurredOn: '1970-01-01',
    description: null,
    categoryId: null,
    paymentMethod: row.cardId !== null ? 'credit' : 'transfer',
    accountId: null,
    cardId: row.cardId,
    invoiceId: row.invoiceId,
    counterpartAccountId: null,
    counterpartCardId: row.counterpartCardId,
    seriesId: null,
    installmentNumber: null,
    installmentCount: null,
    recurrenceId: null,
    recurrenceDate: null,
    goalId: null,
    incomeExpected: false,
    source: 'manual',
    externalId: null,
    reviewState: row.reviewState,
    duplicateOf: null,
    merchantCnpj: null,
    deletedAt: null,
  };
}

/** Recorrência do domínio (sem lembrete ou pausada nem chega do snapshot). */
export function toRecurrence(row: SnapshotRecurrence): Recurrence {
  return {
    id: row.id,
    kind: row.kind,
    description: row.description,
    amountCents: row.amountCents,
    isVariableAmount: row.isVariableAmount,
    categoryId: row.categoryId,
    accountId: row.accountId,
    cardId: row.cardId,
    paymentMethod: row.paymentMethod,
    isFixedIncome: row.isFixedIncome,
    autoPost: row.autoPost,
    remind: row.remind,
    pausedAt: null,
    deletedAt: null,
    frequency: row.frequency,
    intervalCount: row.intervalCount,
    ...(row.dayOfMonth !== null ? { dayOfMonth: row.dayOfMonth } : {}),
    ...(row.weekday !== null ? { weekday: row.weekday } : {}),
    ...(row.monthOfYear !== null ? { monthOfYear: row.monthOfYear } : {}),
    startOn: row.startOn,
    endOn: row.endOn,
    maxOccurrences: row.maxOccurrences,
  };
}

/** Lançamento da ocorrência para saber se ela ainda está prevista (RN-91) e as receitas avulsas (RN-34). */
export function recurrenceTx(row: SnapshotRecurrenceTx): Tx {
  return {
    ...toTx({
      id: row.id,
      kind: row.kind,
      status: row.status,
      amountCents: row.amountCents,
      cardId: null,
      counterpartCardId: null,
      invoiceId: null,
      reviewState: row.reviewState,
    }),
    occurredOn: row.occurredOn,
    description: row.description,
    recurrenceId: row.recurrenceId,
    recurrenceDate: row.recurrenceDate,
  };
}

/** Faturas com o saldo (RN-89: "não paga" = saldo > 0, inclusive quando o Open Finance registrou o pagamento). */
export function invoicesWithTotals(
  snap: Pick<UserSnapshot, 'invoices' | 'txs'>,
): (InvoicePeriod & { totals: InvoiceTotals })[] {
  const txs = snap.txs.map(toTx);
  return snap.invoices.map((inv) => ({
    ...inv,
    // o período não é usado pelos lembretes de fatura; o snapshot não traz as datas de início/fim
    periodStart: inv.closingDate,
    periodEnd: inv.closingDate,
    totals: invoiceTotals(inv.id, txs),
  }));
}

/** Avisos devidos agora para o usuário (só os tipos de `TICK_KINDS`). */
export function dueForUser(snap: UserSnapshot, now: Date): DueNotification[] {
  const settings = resolveProfileSettings(snap.settings);
  const nowLocal = localParts(now, snap.timezone);
  const recurrences = (snap.recurrences ?? []).filter((r) => r.remind).map(toRecurrence);
  const recTxs = (snap.recurrenceTxs ?? []).map(recurrenceTx);
  const due = dueNotifications({
    nowLocal,
    windowMinutes: WINDOW_MINUTES,
    prefs: tickPrefs(snap.reminders),
    month: {
      month: nowLocal.date.slice(0, 7) as YearMonth,
      today: nowLocal.date,
      txs: recTxs,
      recurrences,
      cards: [],
      accounts: [],
      categories: [],
      invoiceMonthById: new Map(),
      attribution: settings.spendable.cardAttribution,
      includeRestrictedAccounts: settings.spendable.includeRestrictedAccounts,
    },
    budget: { pctBp: { ...DEFAULT_BUDGET_PCT_BP }, alertThresholdsBp: [] },
    spendable: settings.spendable,
    invoices: invoicesWithTotals(snap),
    recurrences,
    hideValues: settings.hideValues,
    labels: { cards: snap.cards },
    loggedOn: snap.loggedOn,
  });
  return due.filter((n) => TICK_KINDS.includes(n.kind));
}

/**
 * Plano do usuário: todo aviso vai para a central (RN-86); o push só entra na fila com inscrição ativa e VAPID
 * configurado. No silêncio, o push fica para o fim dele (08:00), e o aviso é criado na hora.
 */
export function planUser(
  snap: UserSnapshot,
  now: Date,
  options: { pushEnabled: boolean; appOrigin: string },
): UserPlan {
  const due = dueForUser(snap, now);
  const notices = due.map((n) => ({
    id: noticeId(snap.userId, n.dedupeKey),
    kind: n.kind,
    dedupeKey: n.dedupeKey,
    title: n.title,
    body: n.body,
    navigate: n.navigate,
  }));
  if (!options.pushEnabled || !snap.hasPush || due.length === 0) {
    return { notices, outbox: [] };
  }
  const nowLocal = localParts(now, snap.timezone);
  const at = deliverAt(nowLocal, resolveProfileSettings(snap.settings).quietHours);
  const scheduledFor =
    at.date === nowLocal.date && at.time === nowLocal.time ? now : zonedToUtc(at, snap.timezone);
  const outbox = due.map((n) => ({
    kind: n.kind,
    dedupeKey: n.dedupeKey,
    payload: JSON.parse(
      declarativePayload(
        {
          title: n.title,
          body: n.body,
          navigate: n.navigate,
          tag: n.dedupeKey,
          ...(n.badge !== undefined ? { badge: n.badge } : {}),
        },
        options.appOrigin,
      ),
    ),
    scheduledFor: scheduledFor.toISOString(),
  }));
  return { notices, outbox };
}

export interface ClaimedEntry {
  id: string;
  userId: string;
  kind: string;
  dedupeKey: string;
  payload: unknown;
  attempts: number;
}

export interface SendContext {
  subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[];
  sentToday: number;
  loggedOn: ISODate[];
}

export type SendDecision = { action: 'send' } | { action: 'skip'; reason: string };

/** Dia de referência do daily_log ('daily_log:2026-12-07'). */
export function refDateOf(dedupeKey: string): ISODate | undefined {
  const m = /^daily_log:(\d{4}-\d{2}-\d{2})$/.exec(dedupeKey);
  return m?.[1];
}

/** Antes de enviar: daily_log adiado que já não vale (US-39), sem inscrição ou teto do dia (UX 6.7). */
export function sendDecision(entry: ClaimedEntry, ctx: SendContext): SendDecision {
  if (entry.kind === 'daily_log') {
    const refDate = refDateOf(entry.dedupeKey);
    const note = {
      kind: 'daily_log' as const,
      dedupeKey: entry.dedupeKey,
      title: '',
      body: '',
      navigate: '/',
      ...(refDate ? { refDate } : {}),
    };
    if (!stillDue(note, ctx.loggedOn)) {
      return { action: 'skip', reason: 'logged' };
    }
  }
  if (ctx.subscriptions.length === 0) {
    return { action: 'skip', reason: 'no_subscription' };
  }
  if (ctx.sentToday >= DAILY_PUSH_CAP) {
    return { action: 'skip', reason: 'daily_cap' };
  }
  return { action: 'send' };
}

export interface EntryOutcome {
  status: 'sent' | 'failed' | 'pending';
  error?: string;
}

/** Depois de enviar: entregue a alguma inscrição → sent; só 429/5xx → tenta de novo até 3 vezes; senão failed. */
export function entryOutcome(results: readonly SendResult[], attempts: number): EntryOutcome {
  if (results.some((r) => r.outcome === 'sent')) {
    return { status: 'sent' };
  }
  if (results.some((r) => r.outcome === 'retry')) {
    return attempts < MAX_ATTEMPTS
      ? { status: 'pending' }
      : { status: 'failed', error: 'retry_exhausted' };
  }
  return {
    status: 'failed',
    error: results.every((r) => r.outcome === 'gone') ? 'gone' : 'rejected',
  };
}

/** `Urgency: high` para o vencimento no dia (tech §6.4.3). */
export function urgencyOf(entry: Pick<ClaimedEntry, 'kind' | 'dedupeKey'>): 'normal' | 'high' {
  return entry.kind === 'invoice_due' && entry.dedupeKey.endsWith(':d0') ? 'high' : 'normal';
}
