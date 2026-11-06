// H02 — Central de avisos (US-37, RN-86): os avisos de `notices` (do reminders-tick e do aparelho), do mais recente
// ao mais antigo; lidos há mais de 60 dias somem; tocar marca como lido.
import { addDays, type ISODate, todayIn } from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { saveRow } from '../../data/repositories/rows';

export type Notice = LocalRow<'notices'>;

export const READ_RETENTION_DAYS = 60;
const TIME_ZONE = 'America/Sao_Paulo';

/** Data local (São Paulo) de um instante ISO. */
export function localDate(iso: string): ISODate {
  return todayIn(TIME_ZONE, new Date(iso));
}

/** Visíveis: não excluídos e não lidos há mais de 60 dias, do mais recente ao mais antigo. */
export function visibleNotices(rows: readonly Notice[], now: Date): Notice[] {
  const limit = addDays(todayIn(TIME_ZONE, now), -READ_RETENTION_DAYS);
  return rows
    .filter((n) => n.deleted_at === null && (n.read_at === null || localDate(n.read_at) >= limit))
    .sort((a, b) =>
      a.created_at === b.created_at
        ? a.id.localeCompare(b.id)
        : a.created_at < b.created_at
          ? 1
          : -1,
    );
}

export function unreadCount(rows: readonly Notice[], now: Date): number {
  return visibleNotices(rows, now).filter((n) => n.read_at === null).length;
}

export async function markRead(db: OakDb, notice: Notice, nowIso = new Date().toISOString()) {
  if (notice.read_at !== null) {
    return;
  }
  await saveRow(db, 'notices', { ...notice, read_at: nowIso });
}

export async function markAllRead(db: OakDb, rows: readonly Notice[], now = new Date()) {
  const iso = now.toISOString();
  for (const n of visibleNotices(rows, now)) {
    if (n.read_at === null) {
      await saveRow(db, 'notices', { ...n, read_at: iso });
    }
  }
}
