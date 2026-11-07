// I05 — Conferir importados (UX §3 I05; US-49, RN-67, RN-68, RN-73, RN-74): "Para decidir" (um ReconcileCard
// por vez), "Novos do banco" (categoria editável, OK e "Marcar todos como revisados") e "Vinculados
// automaticamente" (últimos 7 dias, "Não é o mesmo"). Sem nada pendente, o vazio da UX §6.5.
import type { ISODate } from '@oakfinance/domain';
import { CheckCircle, EqualNot } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { emptyStates, t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import { Button, EmptyState, GlassCard, MoneyText, useToast } from '../../ui';
import { CategoryCorrection } from '../rules/CategoryCorrection';
import { methodLabel } from '../transactions/TransactionsScreen';
import {
  categoryContext,
  type Decision,
  decideDifferent,
  decideSame,
  differences,
  ignoreImported,
  inboxCount,
  inboxGroups,
  manualHistory,
  markAllReviewed,
  markReviewed,
  unlinkRestoring,
} from './model';

type TxRow = LocalRow<'transactions'>;

function TxSummary({ row, label }: { row: TxRow; label: string }) {
  return (
    <div className="reconcile-side">
      <p className="account-meta">{label}</p>
      <MoneyText value={row.amount_cents} kind="expense" size="body" />
      <p>{row.description ?? row.description_raw ?? ''}</p>
      <p className="account-meta">
        {formatDateBR(row.occurred_on as ISODate)} · {methodLabel(row.payment_method)}
      </p>
    </div>
  );
}

function ReconcileCard({
  decision,
  onDone,
}: {
  decision: Decision;
  onDone: (message: string) => void;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user) {
    return null;
  }
  const { imported, manual } = decision;
  const run = async (work: () => Promise<{ ok: boolean }>, message: string) => {
    setBusy(true);
    try {
      if ((await work()).ok) {
        user.engine.notifyWrite();
        onDone(message);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <GlassCard level={2} className="reconcile-card" data-testid="reconcile-card">
      <div className="reconcile-sides">
        {manual ? (
          <TxSummary row={manual} label={t('review.manual')} />
        ) : (
          <p className="reconcile-side">{t('review.noCandidate')}</p>
        )}
        <TxSummary row={imported} label={t('review.imported')} />
      </div>
      {manual && (
        <ul className="reconcile-diffs" data-testid="reconcile-diffs">
          {differences(manual, imported).map((text) => (
            <li key={text}>
              <EqualNot size={16} aria-hidden="true" /> {text}
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        {manual && (
          <Button
            fullWidth
            loading={busy}
            onClick={() =>
              void run(() => decideSame(user.db, imported, manual), t('review.merged'))
            }
          >
            {t('review.same')}
          </Button>
        )}
        <Button
          variant="secondary"
          fullWidth
          loading={busy}
          onClick={() => void run(() => decideDifferent(user.db, imported), t('review.kept'))}
        >
          {t('review.different')}
        </Button>
        <Button
          variant="ghost"
          fullWidth
          loading={busy}
          onClick={() => void run(() => ignoreImported(user.db, imported), t('review.ignored'))}
        >
          {t('review.ignore')}
        </Button>
      </div>
    </GlassCard>
  );
}

export function InboxScreen({ today: fixedToday }: { today?: ISODate } = {}) {
  const today = useToday(fixedToday);
  const { user, client } = useAuth();
  const showToast = useToast();
  const [blocked, setBlocked] = useState<number | null>(null);
  const data = useLive(
    user
      ? async () => ({
          txs: await user.db.transactions.toArray(),
          invoices: await user.db.invoices.toArray(),
          recurrences: await user.db.recurrences.toArray(),
          categories: await user.db.categories.toArray(),
        })
      : null,
    [user],
  );
  const groups = useMemo(
    () =>
      data
        ? inboxGroups(data.txs, { today, invoices: data.invoices, recurrences: data.recurrences })
        : null,
    [data, today],
  );
  if (!user || !data || !groups) {
    return <section className="screen" data-screen="I05" data-testid="screen-I05" />;
  }
  const count = inboxCount(groups);
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  const done = (message: string) => {
    setBlocked(null);
    showToast({ message, tone: 'success' });
  };

  if (count === 0 && groups.auto.length === 0) {
    return (
      <section className="screen" data-screen="I05" data-testid="screen-I05">
        <EmptyState
          variant="done"
          icon={CheckCircle}
          title={emptyStates.inbox.title}
          description={emptyStates.inbox.text}
          data-testid="inbox-empty"
        />
      </section>
    );
  }

  const first = groups.pending[0];
  const reviewAll = async () => {
    const result = await markAllReviewed(user.db, groups.fresh, data.categories);
    if (result.kind === 'blocked') {
      setBlocked(result.unclassified);
      return;
    }
    user.engine.notifyWrite();
    done(t('review.allDone', { n: result.n }));
  };

  return (
    <section className="screen inbox" data-screen="I05" data-testid="screen-I05">
      <p role="status" className="inbox-count" data-testid="inbox-count">
        {t('review.count', { n: count })}
      </p>

      {first && (
        <section className="home-block" data-testid="inbox-pending">
          <h2>{t('review.pending')}</h2>
          <ReconcileCard key={first.imported.id} decision={first} onDone={done} />
        </section>
      )}

      {groups.fresh.length > 0 && (
        <GlassCard level={2} className="inbox-fresh" data-testid="inbox-fresh">
          <h2>{t('review.fresh')}</h2>
          <ul className="inbox-list">
            {groups.fresh.map((row) => (
              <li key={row.id} data-testid="inbox-fresh-item">
                <TxSummary row={row} label={categoryName.get(row.category_id ?? '') ?? ''} />
                <CategoryCorrection user={user} tx={row} categories={data.categories} />
                <Button
                  variant="secondary"
                  onClick={() =>
                    void markReviewed(user.db, row).then((r) => {
                      if (r.ok) {
                        user.engine.notifyWrite();
                      }
                    })
                  }
                >
                  {t('review.ok')}
                </Button>
              </li>
            ))}
          </ul>
          <Button fullWidth onClick={() => void reviewAll()} data-testid="inbox-review-all">
            {t('review.allReviewed')}
          </Button>
          {blocked !== null && (
            <p role="alert" data-testid="inbox-blocked">
              {t('review.allBlocked', { n: blocked })}
            </p>
          )}
        </GlassCard>
      )}

      {groups.auto.length > 0 && (
        <details className="glass inbox-auto" data-testid="inbox-auto">
          <summary>{t('review.auto')}</summary>
          <ul className="inbox-list">
            {groups.auto.map(({ imported, manual }) => (
              <li key={imported.id}>
                <TxSummary row={manual} label={t('review.manual')} />
                <Button
                  variant="ghost"
                  onClick={() =>
                    void Promise.all([manualHistory(client, manual.id), categoryContext(user.db)])
                      .then(([history, ctx]) =>
                        unlinkRestoring(user.db, imported, manual, history, ctx),
                      )
                      .then((r) => {
                        if (r.ok) {
                          user.engine.notifyWrite();
                          done(t('review.unlinked'));
                        }
                      })
                  }
                >
                  {t('tx.unlink')}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
