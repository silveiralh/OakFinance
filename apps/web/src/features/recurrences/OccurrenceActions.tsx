// T02 para lembretes de contas fixas e receitas (T-091; US-41, RN-90, RN-91, RN-34; UX 6.7 #3, #19, #20): o aviso
// abre `/lancamentos/<id v5 da ocorrência>`. Se a ocorrência ainda não virou lançamento, a T02 a acha pelas
// recorrências; prevista, mostra Confirmar (valor real) e Pular este mês (despesa) ou Confirmar, Mudar data e Não
// vai cair (receita).
import {
  addDays,
  type ISODate,
  projectRecurrences,
  type Recurrence,
  recurrenceTxId,
} from '@oakfinance/domain';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { UserSession } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { txFromRow } from '../../data/mappers';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { AmountInput, Button, GlassCard, useToast } from '../../ui';
import {
  approxAmount,
  confirmOccurrence,
  holdOccurrence,
  recurrenceFromRow,
  skipOccurrence,
} from './model';

type TxRow = LocalRow<'transactions'>;

/** Janela em que o id do aviso é procurado (o aviso sai de D−3 a D+1). */
const SEARCH_DAYS = 45;

export interface FoundOccurrence {
  rec: Recurrence;
  date: ISODate;
  tx: TxRow | null;
}

/** Ocorrência pelo id do lançamento: o lançamento dela ou o id v5 de uma ocorrência só projetada. */
export function findOccurrence(
  id: string,
  recurrences: readonly LocalRow<'recurrences'>[],
  tx: TxRow | null,
  today: ISODate,
): FoundOccurrence | null {
  if (tx) {
    if (!tx.recurrence_id || !tx.recurrence_date) {
      return null;
    }
    const row = recurrences.find((r) => r.id === tx.recurrence_id);
    const rec = row ? recurrenceFromRow(row) : null;
    return rec ? { rec, date: tx.recurrence_date as ISODate, tx } : null;
  }
  const range = { from: addDays(today, -SEARCH_DAYS), to: addDays(today, SEARCH_DAYS) };
  for (const row of recurrences) {
    const rec = recurrenceFromRow(row);
    if (!rec) {
      continue;
    }
    const hit = projectRecurrences([rec], range, [], []).find(
      (o) => recurrenceTxId(rec.id, o.date) === id,
    );
    if (hit) {
      return { rec, date: hit.date, tx: null };
    }
  }
  return null;
}

/** Busca a ocorrência ao vivo (recorrências e o lançamento do id). */
export function useOccurrence(user: UserSession | null, id: string, today: ISODate) {
  return useLive(
    user
      ? async () => {
          const tx = (await user.db.transactions.get(id)) ?? null;
          const found = findOccurrence(
            id,
            await user.db.recurrences.toArray(),
            tx && tx.deleted_at === null ? tx : null,
            today,
          );
          if (!found) {
            return null;
          }
          const history = (await user.db.transactions.toArray())
            .filter((r) => r.recurrence_id === found.rec.id && r.deleted_at === null)
            .map(txFromRow);
          return { ...found, approx: approxAmount(found.rec, history) };
        }
      : null,
    [user, id, today],
  );
}

export function OccurrenceActions({
  user,
  occurrence,
  approx,
  today,
}: {
  user: UserSession;
  occurrence: FoundOccurrence;
  approx: number;
  today: ISODate;
}) {
  const { rec, date, tx } = occurrence;
  const navigate = useNavigate();
  const showToast = useToast();
  const [amount, setAmount] = useState(tx?.amount_cents ?? approx);
  const [busy, setBusy] = useState(false);
  if (tx && tx.status !== 'pending') {
    return null;
  }
  const income = rec.kind === 'income';
  const done = async (run: () => Promise<{ ok: boolean }>, message?: string) => {
    setBusy(true);
    try {
      const result = await run();
      if (result.ok) {
        user.engine.notifyWrite();
        if (message) {
          showToast({ message });
        }
      }
      return result.ok;
    } finally {
      setBusy(false);
    }
  };
  const confirm = () =>
    void done(() => confirmOccurrence(user.db, user.userId, rec, date, amount), t('toast.saved'));
  const skip = () =>
    void done(() => skipOccurrence(user.db, user.userId, rec, date), t('fixed.skipToast'));
  const changeDate = () =>
    void done(() => holdOccurrence(user.db, user.userId, rec, date, amount)).then((ok) => {
      if (ok) {
        void navigate(`?editar=${recurrenceTxId(rec.id, date)}`);
      }
    });
  return (
    <GlassCard
      level={2}
      title={t('income.confirm.title', { descrição: rec.description })}
      headingLevel={2}
      data-testid="occurrence-actions"
    >
      <p className="detail-note">
        {income
          ? t('occurrence.expectedOn', { data: formatDateBR(date) })
          : date < today
            ? t('occurrence.overdue', { data: formatDateBR(date) })
            : t('occurrence.dueOn', { data: formatDateBR(date) })}
      </p>
      <AmountInput
        value={amount}
        onChange={setAmount}
        size="compact"
        label={t('detail.field.amount')}
        keypad="native"
      />
      <div className="detail-actions">
        <Button onClick={confirm} loading={busy} disabled={amount <= 0}>
          {income ? t('income.confirm.ok') : t('fixed.confirm')}
        </Button>
        {income ? (
          <>
            <Button variant="ghost" onClick={changeDate} disabled={busy}>
              {t('income.confirm.changeDate')}
            </Button>
            <Button variant="ghost" onClick={skip} disabled={busy}>
              {t('income.confirm.wontCome')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={skip} disabled={busy}>
            {t('tx.recurrence.skip')}
          </Button>
        )}
      </div>
    </GlassCard>
  );
}
