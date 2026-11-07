// S07 — preferências por tipo de lembrete (T-093; US-44, RN-86, RN-87, RN-93). As linhas de `reminders` (seeds
// do onboarding) sincronizam como qualquer tabela; o `reminders-tick` lê `enabled`, `local_time` e `weekday` no
// tick seguinte. A janela de silêncio fica em `profiles.settings.quietHours`.
import {
  DEFAULT_REMINDERS,
  type ReminderKind,
  resolveProfileSettings,
  seedReminderId,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { saveRow } from '../../data/repositories/rows';
import type { MessageKey } from '../../i18n/pt-BR';

type ReminderRow = LocalRow<'reminders'>;

/** Os grupos da S07 (UX §3 S01) e os tipos de `reminders` que cada um liga. */
export const PREF_GROUPS = [
  {
    id: 'invoice_due',
    label: 'reminders.invoiceDue',
    hint: 'reminders.invoiceDueHint',
    kinds: ['invoice_due'],
  },
  {
    id: 'invoice_closed',
    label: 'reminders.invoiceClosed',
    hint: 'reminders.invoiceClosedHint',
    kinds: ['invoice_closed'],
  },
  {
    id: 'bill_due',
    label: 'reminders.billDue',
    hint: 'reminders.billDueHint',
    kinds: ['bill_due'],
  },
  {
    id: 'late',
    label: 'reminders.late',
    hint: 'reminders.lateHint',
    kinds: ['bill_overdue', 'income_unconfirmed'],
  },
  {
    id: 'budget',
    label: 'reminders.budget',
    hint: 'reminders.budgetHint',
    kinds: ['budget_threshold'],
  },
  { id: 'daily', label: 'reminders.daily', hint: 'reminders.dailyHint', kinds: ['daily_log'] },
  {
    id: 'weekly',
    label: 'reminders.weekly',
    hint: 'reminders.weeklyHint',
    kinds: ['weekly_summary'],
  },
  {
    id: 'bank',
    label: 'reminders.bank',
    hint: 'reminders.bankHint',
    kinds: ['bank_connection'],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: MessageKey;
  hint: MessageKey;
  kinds: readonly ReminderKind[];
}>;

export type PrefGroupId = (typeof PREF_GROUPS)[number]['id'];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "20:00:00" (Postgres) ou "20:00" → "20:00". */
export function hhmm(value: string): string {
  return value.slice(0, 5);
}

/** Linha do tipo (a do seed, se existir; senão uma nova com o padrão). */
function rowFor(rows: readonly ReminderRow[], kind: ReminderKind, userId: string): ReminderRow {
  const found = rows.find((r) => r.kind === kind && r.deleted_at === null);
  if (found) {
    return found;
  }
  const d = DEFAULT_REMINDERS.find((r) => r.kind === kind) as (typeof DEFAULT_REMINDERS)[number];
  const now = new Date().toISOString();
  return {
    id: seedReminderId(userId, kind),
    user_id: userId,
    kind,
    enabled: true,
    local_time: d.localTime,
    days_before: [...d.daysBefore],
    weekday: d.weekday,
    skip_if_logged_today: true,
    created_at: now,
    updated_at: now,
    client_updated_at: now,
    server_version: 0,
    device_id: null,
    deleted_at: null,
  } as ReminderRow;
}

/** Ligado se algum tipo do grupo estiver ligado (sem linha, vale o padrão: ligado). */
export function groupEnabled(rows: readonly ReminderRow[], group: PrefGroupId): boolean {
  const kinds = (PREF_GROUPS.find((g) => g.id === group)?.kinds ?? []) as readonly string[];
  const own = rows.filter((r) => r.deleted_at === null && kinds.includes(r.kind));
  return own.length === 0 || own.some((r) => r.enabled);
}

/** Horário e dia do tipo (com o padrão quando não há linha). */
export function scheduleOf(
  rows: readonly ReminderRow[],
  kind: 'daily_log' | 'weekly_summary',
): { time: string; weekday: number | null } {
  const row = rows.find((r) => r.kind === kind && r.deleted_at === null);
  const d = DEFAULT_REMINDERS.find((r) => r.kind === kind);
  return {
    time: hhmm(row?.local_time ?? d?.localTime ?? '09:00'),
    weekday: row ? row.weekday : (d?.weekday ?? null),
  };
}

async function saveChanged(db: OakDb, rows: ReminderRow[]): Promise<number> {
  let changed = 0;
  for (const row of rows) {
    const result = await saveRow(db, 'reminders', row);
    changed += result.ok ? 1 : 0;
  }
  return changed;
}

/** Liga ou desliga todos os tipos do grupo; devolve quantas linhas mudaram. */
export async function setGroupEnabled(
  db: OakDb,
  userId: string,
  group: PrefGroupId,
  enabled: boolean,
): Promise<number> {
  const rows = await db.reminders.toArray();
  const kinds = (PREF_GROUPS.find((g) => g.id === group)?.kinds ?? []) as readonly ReminderKind[];
  return saveChanged(
    db,
    kinds
      .map((kind) => rowFor(rows, kind, userId))
      // muda o que estiver diferente; tipo sem linha (perfil antigo) ganha a linha
      .filter((row) => row.enabled !== enabled || !rows.some((r) => r.id === row.id))
      .map((row) => ({ ...row, enabled })),
  );
}

/** Muda o horário (e o dia, no resumo) do tipo; horário fora de HH:MM é ignorado. */
export async function setSchedule(
  db: OakDb,
  userId: string,
  kind: 'daily_log' | 'weekly_summary',
  patch: { time?: string; weekday?: number },
): Promise<boolean> {
  if (patch.time !== undefined && !HHMM.test(patch.time)) {
    return false;
  }
  if (
    patch.weekday !== undefined &&
    !(Number.isInteger(patch.weekday) && patch.weekday >= 0 && patch.weekday <= 6)
  ) {
    return false;
  }
  const row = rowFor(await db.reminders.toArray(), kind, userId);
  const result = await saveRow(db, 'reminders', {
    ...row,
    ...(patch.time !== undefined ? { local_time: patch.time } : {}),
    ...(patch.weekday !== undefined ? { weekday: patch.weekday } : {}),
  });
  return result.ok;
}

/** Janela de silêncio do perfil (RN-86; padrão 22:00–08:00). */
export function quietHoursOf(settings: unknown): { start: string; end: string } {
  return resolveProfileSettings(settings).quietHours;
}

export async function setQuietHours(
  db: OakDb,
  patch: { start?: string; end?: string },
): Promise<boolean> {
  if (Object.values(patch).some((v) => v !== undefined && !HHMM.test(v))) {
    return false;
  }
  const profile = await db.profiles.toCollection().first();
  if (!profile) {
    return false;
  }
  const raw = profile.settings;
  const settings = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  const current = quietHoursOf(settings);
  const result = await saveRow(db, 'profiles', {
    ...profile,
    settings: {
      ...settings,
      quietHours: { ...current, ...patch },
    } as LocalRow<'profiles'>['settings'],
  });
  return result.ok;
}
