// T02 — vínculo de conferência (UX §3 T02; US-51, RN-73): "Vinculado a: {descrição} · Não é o mesmo" no manual
// conciliado (ou no importado vinculado a ele) e "Não é duplicada" na transação marcada como duplicada de outra
// fonte.
import { useState } from 'react';
import { useAuth } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { Button, GlassCard, useToast } from '../../ui';
import { categoryContext, manualHistory, notDuplicate, unlinkRestoring } from './model';

type TxRow = LocalRow<'transactions'>;
const IMPORTED = new Set(['pluggy', 'ofx', 'csv']);

export function LinkActions({ tx }: { tx: TxRow }) {
  const { user, client } = useAuth();
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const other = useLive(
    user
      ? async () => {
          if (tx.review_state === 'merged' && tx.duplicate_of) {
            return (await user.db.transactions.get(tx.duplicate_of)) ?? null;
          }
          if (tx.matched_external) {
            const rows = await user.db.transactions.toArray();
            return rows.find((r) => r.duplicate_of === tx.id && r.deleted_at === null) ?? null;
          }
          return null;
        }
      : null,
    [user, tx.id, tx.duplicate_of, tx.matched_external, tx.review_state],
  );
  if (!user || !other) {
    return null;
  }
  const duplicate = IMPORTED.has(tx.source) && IMPORTED.has(other.source);
  const imported = IMPORTED.has(tx.source) ? tx : other;
  const manual = imported === tx ? other : tx;
  const run = async () => {
    setBusy(true);
    try {
      const ctx = await categoryContext(user.db);
      const result = duplicate
        ? await notDuplicate(user.db, imported, ctx)
        : await unlinkRestoring(
            user.db,
            imported,
            manual,
            await manualHistory(client, manual.id),
            ctx,
          );
      if (result.ok) {
        user.engine.notifyWrite();
        showToast({
          message: t(duplicate ? 'review.separated' : 'review.unlinked'),
          tone: 'success',
        });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <GlassCard level={1} className="detail-link" data-testid="detail-link">
      <p>
        {t(duplicate ? 'detail.duplicateOf' : 'detail.linkedTo', {
          descricao: other.description ?? other.description_raw ?? '',
        })}
      </p>
      <Button variant="secondary" loading={busy} onClick={() => void run()}>
        {t(duplicate ? 'detail.notDuplicate' : 'tx.unlink')}
      </Button>
    </GlassCard>
  );
}
