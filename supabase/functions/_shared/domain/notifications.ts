// Lembretes devidos (tech §5.11 e §6.4.5; PRD RN-86..RN-94; textos do UX §6.7). Usado pelo reminders-tick.
// Puro: recebe "agora" no fuso do usuário e o estado do mês; a deduplicação é pelo dedupeKey ([CONTRATO]).
import { type BudgetConfig, bucketBudget, categoryBudgets, type MonthInput } from './budget.ts';
import { addDays, diffDays, parseISODate, parseYearMonth, weekday } from './dates.ts';
import { DEFAULT_REMINDERS, type DefaultReminder } from './defaults.ts';
import { recurrenceTxId } from './ids.ts';
import type { InvoicePeriod, InvoiceTotals } from './invoices.ts';
import { countsForTotals } from './invoices.ts';
import { formatBRL } from './money.ts';
import { projectRecurrences, type Recurrence } from './recurrence.ts';
import { type SpendableConfig, spendableThisMonth } from './spendable.ts';
import type { Bucket, Cents, ISODate, YearMonth } from './types.ts';

export type ReminderKind = DefaultReminder['kind'];

export interface ReminderPref {
  kind: ReminderKind;
  enabled: boolean;
  localTime: string; // 'HH:MM'
  weekday: number | null; // 0 = domingo (weekly_summary)
  daysBefore: number[]; // D − n; negativo = depois (D+1 = −1)
  skipIfLoggedToday: boolean;
}

export interface DueNotification {
  kind: ReminderKind;
  dedupeKey: string;
  title: string;
  body: string;
  navigate: string;
  badge?: number;
  /** Dia a que o aviso se refere (daily_log adiado pelo silêncio é revalidado com ele, US-39). */
  refDate?: ISODate;
}

/** Conexão do Open Finance (bank_connections), com o status da Pluggy. */
export interface BankConnectionState {
  id: string;
  bankName: string;
  status: string; // UPDATED | UPDATING | OUTDATED | LOGIN_ERROR | WAITING_USER_INPUT
  consentExpiresOn: ISODate | null;
}

export interface DueNotificationsInput {
  nowLocal: { date: ISODate; time: string }; // já no fuso do usuário
  windowMinutes: number; // 15 (o tamanho do tick)
  prefs: readonly ReminderPref[];
  month: MonthInput;
  budget: BudgetConfig;
  spendable: SpendableConfig;
  invoices: readonly (InvoicePeriod & { totals: InvoiceTotals })[];
  recurrences: readonly Recurrence[];
  hideValues: boolean;
  /** Nomes para os textos: cartões, categorias e contas. */
  labels?: {
    cards?: Readonly<Record<string, string>>;
    categories?: Readonly<Record<string, string>>;
  };
  /** Datas locais (created_at) em que o usuário criou lançamento manual; sem isso, usa occurredOn dos manuais. */
  loggedOn?: readonly ISODate[];
  /** Limites por categoria do mês (RN-45/RN-92). */
  categoryLimits?: ReadonlyArray<{
    categoryId: string;
    limitCents: Cents;
    alertThresholdsBp: readonly number[];
  }>;
  connections?: readonly BankConnectionState[];
}

export const TITLE_MAX = 40;
export const BODY_MAX = 120;

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const BUCKET_NAMES: Readonly<Record<Bucket, string>> = {
  needs: 'Necessidades',
  wants: 'Desejos',
  savings: 'Poupança',
};

/** "dez/2026" (UX 6.7, #18). */
export function monthLabel(m: YearMonth): string {
  const { year, month } = parseYearMonth(m);
  return `${MONTHS[month - 1]}/${year}`;
}

/** "dd/mm". */
export function dayMonth(d: ISODate): string {
  const { month, day } = parseISODate(d);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}

function minutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

/**
 * Dia a que pertence um horário `localTime` que caiu na janela (agora − window, agora]; `null` se não caiu.
 * Atravessa a meia-noite (horário 23:55 avaliado às 00:05 pertence ao dia anterior).
 */
export function firedOn(
  nowLocal: { date: ISODate; time: string },
  localTime: string,
  windowMinutes: number,
): ISODate | null {
  const now = minutes(nowLocal.time);
  const at = minutes(localTime);
  if (Number.isNaN(now) || Number.isNaN(at)) {
    return null;
  }
  const gap = now - at;
  if (gap >= 0 && gap < windowMinutes) {
    return nowLocal.date;
  }
  if (gap + 1440 >= 0 && gap + 1440 < windowMinutes) {
    return addDays(nowLocal.date, -1);
  }
  return null;
}

/**
 * Silêncio (RN-86, padrão 22:00–08:00): push que cairia nele vai para o fim do silêncio. Devolve quando entregar.
 * Intervalo que atravessa a meia-noite (start > end) e intervalo no mesmo dia são aceitos.
 */
export function deliverAt(
  nowLocal: { date: ISODate; time: string },
  quietHours: { start: string; end: string },
): { date: ISODate; time: string } {
  const now = minutes(nowLocal.time);
  const start = minutes(quietHours.start);
  const end = minutes(quietHours.end);
  if (start === end) {
    return nowLocal;
  }
  if (start < end) {
    return now >= start && now < end ? { date: nowLocal.date, time: quietHours.end } : nowLocal;
  }
  if (now >= start) {
    return { date: addDays(nowLocal.date, 1), time: quietHours.end };
  }
  return now < end ? { date: nowLocal.date, time: quietHours.end } : nowLocal;
}

/** US-39: o daily_log adiado só sai se continuar sem lançamento manual no dia de referência. */
export function stillDue(n: DueNotification, loggedOn: readonly ISODate[]): boolean {
  return n.kind !== 'daily_log' || n.refDate === undefined || !loggedOn.includes(n.refDate);
}

function prefOf(prefs: readonly ReminderPref[], kind: ReminderKind): ReminderPref {
  const found = prefs.find((p) => p.kind === kind);
  if (found) {
    return found;
  }
  const d = DEFAULT_REMINDERS.find((r) => r.kind === kind) as DefaultReminder;
  return {
    kind,
    enabled: true,
    localTime: d.localTime,
    weekday: d.weekday,
    daysBefore: [...d.daysBefore],
    skipIfLoggedToday: true,
  };
}

/** Semana ISO "2026-W46" (segunda a domingo). */
export function isoWeek(d: ISODate): string {
  const wd = weekday(d); // 0 = domingo
  const thursday = addDays(d, 3 - ((wd + 6) % 7));
  const { year } = parseISODate(thursday);
  const week = Math.floor(diffDays(`${year}-01-01`, thursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function money(c: Cents, hide: boolean): string {
  return formatBRL(c, { hidden: hide });
}

/** Garante os limites do UX 6.7 (título ≤ 40, corpo ≤ 120) para nomes longos. */
function withinLimits(title: string, body: string): { title: string; body: string } {
  return {
    title: title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title,
    body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX - 1)}…` : body,
  };
}

function note(
  kind: ReminderKind,
  dedupeKey: string,
  title: string,
  body: string,
  navigate: string,
  extra: Partial<Pick<DueNotification, 'badge' | 'refDate'>> = {},
): DueNotification {
  return { kind, dedupeKey, ...withinLimits(title, body), navigate, ...extra };
}

const IMMEDIATE = (rec: Recurrence) => rec.cardId === null && rec.paymentMethod !== 'credit';

/** Calcula os avisos devidos neste tick (RN-86..RN-94). O silêncio e o teto diário ficam com o envio. */
export function dueNotifications(input: DueNotificationsInput): DueNotification[] {
  const out: DueNotification[] = [];
  const hide = input.hideValues;
  const cardName = (id: string) => input.labels?.cards?.[id] ?? 'do cartão';
  const pref = (kind: ReminderKind) => prefOf(input.prefs, kind);
  const fired = (p: ReminderPref) =>
    p.enabled ? firedOn(input.nowLocal, p.localTime, input.windowMinutes) : null;
  const txs = input.month.txs;

  // RN-89: fatura não paga às 09:00 de D−3 e D0, com o valor restante (UX #1 e #2).
  const due = pref('invoice_due');
  const dueDay = fired(due);
  if (dueDay !== null) {
    for (const inv of input.invoices) {
      const d = diffDays(dueDay, inv.dueDate);
      if (!due.daysBefore.includes(d) || inv.totals.balanceCents <= 0) {
        continue;
      }
      const card = cardName(inv.cardId);
      const value = money(inv.totals.balanceCents, hide);
      const url = `/cartoes/${inv.cardId}/fatura/${inv.referenceMonth}`;
      out.push(
        d === 0
          ? note(
              'invoice_due',
              `invoice_due:${inv.id}:d0`,
              `Fatura ${card} vence hoje`,
              `${value}. Após pagar, registre o pagamento no app.`,
              url,
            )
          : note(
              'invoice_due',
              `invoice_due:${inv.id}:d${d}`,
              d === 1 ? `Fatura ${card} vence amanhã` : `Fatura ${card} vence em ${d} dias`,
              `${value} com vencimento em ${dayMonth(inv.dueDate)}.`,
              url,
            ),
      );
    }
  }

  // RN-88: no dia do fechamento, às 09:00, se total > 0 (UX #18).
  const closedDay = fired(pref('invoice_closed'));
  if (closedDay !== null) {
    for (const inv of input.invoices) {
      const total = inv.totals.chargesCents - inv.totals.creditsCents;
      if (inv.closingDate !== closedDay || total <= 0) {
        continue;
      }
      out.push(
        note(
          'invoice_closed',
          `invoice_closed:${inv.id}`,
          `Fatura ${cardName(inv.cardId)} de ${monthLabel(inv.referenceMonth)} fechou`,
          `Total de ${money(total, hide)}, com vencimento em ${dayMonth(inv.dueDate)}.`,
          `/cartoes/${inv.cardId}/fatura/${inv.referenceMonth}`,
        ),
      );
    }
  }

  // RN-90/RN-91: contas fixas de despesa em meio imediato, sem confirmação automática; receitas não confirmadas.
  const pending = (recId: string, date: ISODate) => {
    const tx = txs.find(
      (t) => t.recurrenceId === recId && t.recurrenceDate === date && t.deletedAt === null,
    );
    return tx === undefined || (tx.status === 'pending' && tx.reviewState !== 'ignored');
  };
  const occurrencesOn = (date: ISODate) =>
    projectRecurrences(input.recurrences, { from: date, to: date }, txs, input.month.cards);
  const recById = new Map(input.recurrences.map((r) => [r.id, r]));
  const amountText = (rec: Recurrence, cents: Cents) =>
    rec.isVariableAmount && !hide ? `≈ ${money(cents, hide)}` : money(cents, hide);

  const bill = pref('bill_due');
  const billDay = fired(bill);
  if (billDay !== null) {
    for (const d of bill.daysBefore) {
      const date = addDays(billDay, d);
      for (const occ of occurrencesOn(date)) {
        const rec = recById.get(occ.recurrenceId) as Recurrence;
        if (rec.kind !== 'expense' || rec.autoPost || !IMMEDIATE(rec) || !pending(rec.id, date)) {
          continue;
        }
        const when = d === 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : `vence em ${d} dias`;
        out.push(
          note(
            'bill_due',
            `bill_due:${rec.id}:${date}:d${d}`,
            `${rec.description} ${when}`,
            `${amountText(rec, occ.amountCents)} em ${dayMonth(date)}.`,
            `/lancamentos/${occ.realizedTxId ?? recurrenceTxId(rec.id, date)}`,
          ),
        );
      }
    }
  }

  const overdue = pref('bill_overdue');
  const overdueDay = fired(overdue);
  if (overdueDay !== null) {
    for (const d of overdue.daysBefore) {
      const date = addDays(overdueDay, d);
      for (const occ of occurrencesOn(date)) {
        const rec = recById.get(occ.recurrenceId) as Recurrence;
        if (rec.kind !== 'expense' || rec.autoPost || !IMMEDIATE(rec) || !pending(rec.id, date)) {
          continue;
        }
        out.push(
          note(
            'bill_overdue',
            `bill_overdue:${rec.id}:${date}`,
            `Confirmar ${rec.description}`,
            `Venceu em ${dayMonth(date)}. Confirme o pagamento ou pule este mês.`,
            `/lancamentos/${occ.realizedTxId ?? recurrenceTxId(rec.id, date)}`,
          ),
        );
      }
    }
  }

  const income = pref('income_unconfirmed');
  const incomeDay = fired(income);
  if (incomeDay !== null) {
    for (const d of income.daysBefore) {
      const date = addDays(incomeDay, d);
      const seen = new Set<string>();
      for (const occ of occurrencesOn(date)) {
        const rec = recById.get(occ.recurrenceId) as Recurrence;
        if (rec.kind !== 'income' || rec.autoPost || !pending(rec.id, date)) {
          continue;
        }
        if (occ.realizedTxId) {
          seen.add(occ.realizedTxId);
        }
        out.push(
          note(
            'income_unconfirmed',
            `income_unconfirmed:${rec.id}:${date}`,
            `Confirmar ${rec.description}`,
            `Prevista para ${dayMonth(date)}. Confirme o valor recebido ou mude a data.`,
            `/lancamentos/${occ.realizedTxId ?? recurrenceTxId(rec.id, date)}`,
          ),
        );
      }
      // Receitas avulsas "A receber"/"Prevista" (RN-34) ainda pendentes.
      for (const tx of txs) {
        if (
          tx.kind !== 'income' ||
          tx.status !== 'pending' ||
          tx.deletedAt !== null ||
          tx.occurredOn !== date ||
          tx.recurrenceId !== null ||
          seen.has(tx.id)
        ) {
          continue;
        }
        out.push(
          note(
            'income_unconfirmed',
            `income_unconfirmed:${tx.id}:${date}`,
            `Confirmar ${tx.description?.trim() || 'receita'}`,
            `Prevista para ${dayMonth(date)}. Confirme o valor recebido ou mude a data.`,
            `/lancamentos/${tx.id}`,
          ),
        );
      }
    }
  }

  // RN-92: em todo tick; só o maior limiar cruzado de cada faixa/categoria (o menor já saiu ou ficou para trás).
  if (pref('budget_threshold').enabled) {
    out.push(...budgetNotes(input));
  }

  // RN-87: no horário (padrão 20:00), se não houve lançamento manual no dia.
  const daily = pref('daily_log');
  const dailyDay = fired(daily);
  const logged = loggedDays(input);
  if (dailyDay !== null && !(daily.skipIfLoggedToday && logged.has(dailyDay))) {
    out.push(
      note(
        'daily_log',
        `daily_log:${dailyDay}`,
        'Registrar gastos de hoje',
        'Nenhum lançamento hoje. Registre agora para manter o mês atualizado.',
        '/?novo=despesa',
        { refDate: dailyDay },
      ),
    );
  }

  // RN-93: resumo semanal no dia e hora configurados (padrão domingo 19:00).
  const weekly = pref('weekly_summary');
  const weeklyDay = fired(weekly);
  if (weeklyDay !== null && (weekly.weekday === null || weekday(weeklyDay) === weekly.weekday)) {
    out.push(weeklyNote(input, weeklyDay, logged));
  }

  // RN-94: conexão expirada ou com erro de login (uma vez por estado) e consentimento a ≤ 7 dias (uma vez).
  if (pref('bank_connection').enabled) {
    for (const c of input.connections ?? []) {
      const state = connectionAttention(c, input.nowLocal.date);
      if (state !== null) {
        out.push(
          note(
            'bank_connection',
            `bank:${c.id}:${state}`,
            `Conexão com o ${c.bankName} precisa de atenção`,
            'Renove para continuar recebendo lançamentos automaticamente.',
            '/ajustes/conexoes',
          ),
        );
      }
    }
  }
  return out;
}

const ATTENTION = new Set(['OUTDATED', 'LOGIN_ERROR', 'WAITING_USER_INPUT']);

function connectionAttention(c: BankConnectionState, today: ISODate): string | null {
  if (c.consentExpiresOn !== null && c.consentExpiresOn <= today) {
    return 'expired';
  }
  const status = c.status.toUpperCase();
  if (ATTENTION.has(status)) {
    return status.toLowerCase();
  }
  if (c.consentExpiresOn !== null && diffDays(today, c.consentExpiresOn) <= 7) {
    return 'expiring';
  }
  return null;
}

function loggedDays(input: DueNotificationsInput): Set<ISODate> {
  if (input.loggedOn) {
    return new Set(input.loggedOn);
  }
  return new Set(
    input.month.txs
      .filter((t) => t.source === 'manual' && t.deletedAt === null)
      .map((t) => t.occurredOn),
  );
}

function budgetNotes(input: DueNotificationsInput): DueNotification[] {
  const month = input.month;
  const base = spendableThisMonth(month, input.budget, input.spendable).income.totalCents;
  if (base <= 0) {
    return []; // RN-92: não se aplica com Base(M) = 0
  }
  const hide = input.hideValues;
  const out: DueNotification[] = [];
  const emit = (
    ref: string,
    name: string,
    usageBp: number,
    consumed: Cents,
    target: Cents,
    thresholds: readonly number[],
  ) => {
    const crossed = [...thresholds].sort((a, b) => b - a).find((t) => usageBp >= t);
    if (crossed === undefined || target <= 0) {
      return;
    }
    const key = `budget:${ref}:${month.month}:${crossed}`;
    if (crossed >= 10000) {
      out.push(
        note(
          'budget_threshold',
          key,
          `${name} acima do planejado`,
          `${money(Math.max(0, consumed - target), hide)} acima do previsto para ${monthLabel(month.month)}. Veja onde ajustar.`,
          '/planejar/orcamento',
        ),
      );
      return;
    }
    out.push(
      note(
        'budget_threshold',
        key,
        `${name} atingiu ${Math.floor(crossed / 100)}% do planejado`,
        `Restam ${money(Math.max(0, target - consumed), hide)} até o fim do mês.`,
        '/planejar/orcamento',
      ),
    );
  };
  const buckets = bucketBudget(month, input.budget, base);
  for (const bucket of ['needs', 'wants'] as const) {
    const s = buckets[bucket];
    emit(
      bucket,
      BUCKET_NAMES[bucket],
      s.usageBp,
      s.spentCents + s.committedCents,
      s.targetCents,
      input.budget.alertThresholdsBp,
    );
  }
  const limits = input.categoryLimits ?? [];
  const byId = new Map(limits.map((l) => [l.categoryId, l]));
  for (const c of categoryBudgets(month, limits)) {
    const name = input.labels?.categories?.[c.categoryId] ?? 'Categoria';
    emit(
      c.categoryId,
      name,
      c.usageBp,
      c.spentCents,
      c.limitCents,
      byId.get(c.categoryId)?.alertThresholdsBp ?? [],
    );
  }
  return out;
}

function weeklyNote(
  input: DueNotificationsInput,
  day: ISODate,
  logged: ReadonlySet<ISODate>,
): DueNotification {
  const monday = addDays(day, -((weekday(day) + 6) % 7));
  const sunday = addDays(monday, 6);
  const inWeek = (d: ISODate) => d >= monday && d <= sunday;
  const key = `weekly:${isoWeek(day)}`;
  const days = [...logged].filter(inWeek).length;
  if (days === 0) {
    return note(
      'weekly_summary',
      key,
      'Resumo da semana',
      'Nenhum lançamento nesta semana. Registre seus gastos para manter o mês em dia.',
      '/?novo=despesa',
    );
  }
  const hide = input.hideValues;
  let total = 0;
  const byCategory = new Map<string, number>();
  for (const t of input.month.txs) {
    if (
      t.kind !== 'expense' ||
      t.status !== 'posted' ||
      !countsForTotals(t) ||
      !inWeek(t.occurredOn) ||
      t.occurredOn > day
    ) {
      continue;
    }
    total += t.amountCents;
    if (t.categoryId !== null) {
      byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + t.amountCents);
    }
  }
  const names = input.labels?.categories ?? {};
  const top = [...byCategory.entries()]
    .filter(([id]) => names[id] !== undefined)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([id]) => names[id] as string);
  const available = spendableThisMonth(input.month, input.budget, input.spendable).availableCents;
  const tail = `Dias com lançamento: ${days}/7. Disponível: ${money(available, hide)}.`;
  // corta categorias se o corpo passar de 120 caracteres
  const bodyWith = (n: number) =>
    `${money(total, hide)} em gastos${n > 0 ? `, maiores: ${top.slice(0, n).join(', ')}` : ''}. ${tail}`;
  let n = top.length;
  while (n > 0 && bodyWith(n).length > BODY_MAX) {
    n--;
  }
  return note('weekly_summary', key, 'Resumo da semana', bodyWith(n), '/');
}
