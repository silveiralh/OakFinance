// Resumo da última sincronização de cada conexão (UX §3 I01), guardado no `kv` do aparelho.
import type { OakDb } from '../../data/db';
import { writeLocal } from '../../data/storage';
import { type SyncSummary, syncSummary } from './model';

export const SUMMARY_KEY_PREFIX = 'conn:summary:';

export async function readSummary(db: OakDb, connectionId: string): Promise<SyncSummary | null> {
  const entry = await db.kv.get(`${SUMMARY_KEY_PREFIX}${connectionId}`);
  const value = entry?.value as Partial<SyncSummary> | undefined;
  if (!value || typeof value.fresh !== 'number') {
    return null;
  }
  return { fresh: value.fresh, linked: value.linked ?? 0, review: value.review ?? 0 };
}

/** Conta os lançamentos do Open Finance criados desde `sinceIso` nos destinos da conexão e guarda o resumo. */
export async function summarizeSince(
  db: OakDb,
  connectionId: string,
  sinceIso: string,
): Promise<SyncSummary> {
  const externals = await db.external_accounts
    .where('connection_id')
    .equals(connectionId)
    .toArray();
  const accounts = new Set(externals.flatMap((e) => (e.account_id ? [e.account_id] : [])));
  const cards = new Set(externals.flatMap((e) => (e.card_id ? [e.card_id] : [])));
  const rows = await db.transactions.filter((row) => row.source === 'pluggy').toArray();
  const summary = syncSummary(rows, sinceIso, { accounts, cards });
  await writeLocal(() =>
    db.kv.put({ key: `${SUMMARY_KEY_PREFIX}${connectionId}`, value: summary }),
  );
  return summary;
}
