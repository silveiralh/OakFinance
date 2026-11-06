// RN-28: depois do primeiro sync que der certo na sessão, confirma sozinhas as ocorrências vencidas com confirmação
// automática (o pull já trouxe as que outro aparelho confirmou; o id v5 evita duplicata).
import { todayIn } from '@oakfinance/domain';
import { useEffect, useRef } from 'react';
import { txFromRow } from '../data/mappers';
import { recurrenceFromRow, runAutoPosts } from '../features/recurrences/model';
import { useAuth } from './auth';
import { useSyncSnapshot } from './SyncStatus';

export function AutoPosts() {
  const { user } = useAuth();
  const snapshot = useSyncSnapshot();
  const done = snapshot?.phase === 'done';
  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !done || ran.current === user.userId) {
      return;
    }
    ran.current = user.userId;
    void (async () => {
      const recs = (await user.db.recurrences.toArray()).flatMap((r) => {
        const rec = r.deleted_at === null ? recurrenceFromRow(r) : null;
        return rec ? [rec] : [];
      });
      if (!recs.some((r) => r.autoPost)) {
        return;
      }
      const txs = (await user.db.transactions.toArray())
        .filter((r) => r.recurrence_id !== null)
        .flatMap((r) => {
          try {
            return [txFromRow(r)];
          } catch {
            return [];
          }
        });
      const today = todayIn('America/Sao_Paulo', new Date());
      if ((await runAutoPosts(user.db, user.userId, recs, txs, today)) > 0) {
        user.engine.notifyWrite();
      }
    })();
  }, [user, done]);
  return null;
}
