// S05 — Renda e contas fixas (US-23): receitas fixas com a ocorrência do mês (Confirmar com o valor real ou "Não
// recebi este mês") e as próximas projetadas (RN-27); cadastro de nova receita fixa.
import {
  formatBRL,
  type ISODate,
  monthLabel,
  monthOf,
  type ProjectedOccurrence,
  type Recurrence,
  todayIn,
} from '@oakfinance/domain';
import { Briefcase, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../../app/auth';
import { maskMoney, useValuesHidden } from '../../app/values';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { txFromRow } from '../../data/mappers';
import { parseDay } from '../../data/repositories/cards';
import { saveRow } from '../../data/repositories/rows';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import {
  AmountInput,
  BottomSheet,
  Button,
  EmptyState,
  GlassCard,
  Select,
  TextField,
  useToast,
} from '../../ui';
import { ExpensesSection } from './ExpensesSection';
import {
  buildFixedIncome,
  confirmOccurrence,
  projectIncome,
  recurrenceFromRow,
  skipOccurrence,
} from './model';

export const SALARY_SLUG = 'salario';
const UPCOMING = 3;

interface Draft {
  description: string;
  amount: number;
  day: string;
  accountId: string;
  categoryId: string;
}

/** Problema do cadastro (o primeiro que faltar). */
export function fixedIncomeProblem(draft: Draft): string | null {
  if (draft.description.trim() === '') {
    return t('fixed.missingDescription');
  }
  if (draft.amount <= 0) {
    return t('fixed.missingAmount');
  }
  if (parseDay(draft.day) === null) {
    return t('cards.invalidDay');
  }
  if (!draft.accountId) {
    return t('fixed.missingAccount');
  }
  return null;
}

export function occurrenceText(
  occ: ProjectedOccurrence,
  tx: LocalRow<'transactions'> | undefined,
  today: ISODate,
  hidden: boolean,
  opts: { kind?: 'income' | 'expense'; approxCents?: number | null } = {},
): string {
  const expense = opts.kind === 'expense';
  if (tx?.status === 'cancelled') {
    return t(expense ? 'fixed.skippedMonth' : 'fixed.skipped', {
      mês: monthLabel(monthOf(occ.date)),
    });
  }
  if (tx) {
    const valor = maskMoney(formatBRL(tx.amount_cents), hidden);
    return t(expense ? 'fixed.paid' : 'fixed.received', { data: formatDateBR(occ.date), valor });
  }
  // RN-31: valor variável aparece como "≈ R$ X" (última efetivada ou o cadastrado)
  const amount = maskMoney(formatBRL(opts.approxCents ?? occ.amountCents), hidden);
  const valor =
    opts.approxCents !== undefined && opts.approxCents !== null
      ? t('fixed.approx', { valor: amount })
      : amount;
  return occ.date < today
    ? t('fixed.late', { data: formatDateBR(occ.date), valor })
    : t('fixed.expected', { data: formatDateBR(occ.date), valor });
}

export function IncomeScreen({
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  today?: ISODate;
}) {
  const { user } = useAuth();
  const showToast = useToast();
  const hidden = useValuesHidden();
  const data = useLive(
    user
      ? async () => ({
          recurrences: await user.db.recurrences.toArray(),
          transactions: (await user.db.transactions.toArray()).filter(
            (r) => r.recurrence_id !== null,
          ),
          accounts: (await user.db.accounts.toArray()).filter(
            (a) => a.deleted_at === null && a.archived_at === null,
          ),
          categories: (await user.db.categories.toArray()).filter(
            (c) => c.deleted_at === null && c.archived_at === null && c.kind === 'income',
          ),
        })
      : null,
    [user],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ rec: Recurrence; date: ISODate } | null>(null);
  const [amount, setAmount] = useState(0);

  const recs = useMemo(
    () =>
      (data?.recurrences ?? [])
        .filter((r) => r.deleted_at === null && r.is_fixed_income && r.kind === 'income')
        .flatMap((r) => {
          const rec = recurrenceFromRow(r);
          return rec ? [rec] : [];
        }),
    [data?.recurrences],
  );
  const txs = useMemo(
    () =>
      (data?.transactions ?? []).flatMap((r) => {
        try {
          return [txFromRow(r)];
        } catch {
          return [];
        }
      }),
    [data?.transactions],
  );
  const projected = useMemo(() => projectIncome(recs, txs, today), [recs, txs, today]);

  if (!user || !data) {
    return <section className="screen" data-screen="S05" data-testid="screen-S05" />;
  }
  const rowById = new Map(data.transactions.map((r) => [r.id, r]));
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));

  const openNew = () => {
    setError(null);
    const salary = data.categories.find((c) => c.slug === SALARY_SLUG) ?? data.categories[0];
    setDraft({
      description: '',
      amount: 0,
      day: today.slice(8, 10).replace(/^0/, ''),
      accountId: data.accounts[0]?.id ?? '',
      categoryId: salary?.id ?? '',
    });
  };

  const saveNew = async () => {
    if (!draft) {
      return;
    }
    const problem = fixedIncomeProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const nowIso = new Date().toISOString();
    const row = buildFixedIncome({
      userId: user.userId,
      description: draft.description,
      amountCents: draft.amount,
      dayOfMonth: parseDay(draft.day) ?? 1,
      accountId: draft.accountId,
      categoryId: draft.categoryId || null,
      startOn: `${monthOf(today)}-01` as ISODate,
      nowIso,
    });
    const result = await saveRow(user.db, 'recurrences', row);
    if (!result.ok) {
      return;
    }
    user.engine.notifyWrite();
    setDraft(null);
    showToast({ message: t('fixed.saved'), tone: 'success' });
  };

  const confirm = async () => {
    if (!confirming || amount <= 0) {
      return;
    }
    const result = await confirmOccurrence(
      user.db,
      user.userId,
      confirming.rec,
      confirming.date,
      amount,
    );
    if (!result.ok) {
      return;
    }
    user.engine.notifyWrite();
    setConfirming(null);
    showToast({ message: t('fixed.confirmed'), tone: 'success' });
  };

  const skip = async (rec: Recurrence, date: ISODate) => {
    const result = await skipOccurrence(user.db, user.userId, rec, date);
    if (result.ok) {
      user.engine.notifyWrite();
      showToast({ message: t('fixed.notReceivedToast') });
    }
  };

  return (
    <section className="screen" data-screen="S05" data-testid="screen-S05">
      <div className="detail-actions">
        <Button iconStart={Plus} onClick={openNew}>
          {t('fixed.new')}
        </Button>
      </div>
      {recs.length === 0 ? (
        <EmptyState icon={Briefcase} title={t('fixed.empty')} description={t('fixed.emptyHint')} />
      ) : (
        recs.map((rec) => {
          const mine = projected.filter((o) => o.recurrenceId === rec.id);
          const current = mine.find((o) => monthOf(o.date) === monthOf(today));
          const next = mine.filter((o) => o !== current).slice(0, UPCOMING);
          const currentTx = current?.realizedTxId ? rowById.get(current.realizedTxId) : undefined;
          return (
            <GlassCard key={rec.id} level={1} title={rec.description} headingLevel={2}>
              <div className="cards-current" data-testid={`fixed-${rec.id}`}>
                <p className="detail-note">
                  {t('fixed.every', {
                    valor: maskMoney(formatBRL(rec.amountCents), hidden),
                    dia: rec.dayOfMonth ?? '',
                    conta: (rec.accountId && accountName.get(rec.accountId)) || '',
                  })}
                </p>
                {current && (
                  <>
                    <p className="cards-line" data-testid="fixed-current">
                      {occurrenceText(current, currentTx, today, hidden)}
                    </p>
                    {!currentTx && (
                      <div className="detail-actions">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setAmount(current.amountCents);
                            setConfirming({ rec, date: current.date });
                          }}
                        >
                          {t('fixed.confirm')}
                        </Button>
                        <Button variant="ghost" onClick={() => void skip(rec, current.date)}>
                          {t('fixed.notReceived')}
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {next.length > 0 && (
                  <>
                    <p className="cards-line">{t('fixed.upcoming')}</p>
                    <ul className="cards-invoices" data-testid="fixed-upcoming">
                      {next.map((o) => (
                        <li key={o.date} className="detail-note">
                          {occurrenceText(
                            o,
                            o.realizedTxId ? rowById.get(o.realizedTxId) : undefined,
                            today,
                            hidden,
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </GlassCard>
          );
        })
      )}
      <ExpensesSection user={user} today={today} />
      <BottomSheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={t('fixed.new')}
        data-testid="fixed-sheet"
      >
        {draft &&
          (data.accounts.length === 0 ? (
            <p className="detail-note">{t('fixed.noAccount')}</p>
          ) : (
            <div className="account-form">
              <TextField
                label={t('fixed.description')}
                value={draft.description}
                onChange={(description) => setDraft({ ...draft, description })}
              />
              <AmountInput
                label={t('fixed.amount')}
                value={draft.amount}
                onChange={(cents) => setDraft({ ...draft, amount: cents })}
                size="compact"
              />
              <TextField
                label={t('fixed.day')}
                value={draft.day}
                inputMode="numeric"
                onChange={(day) => setDraft({ ...draft, day })}
              />
              <Select
                label={t('fixed.account')}
                value={draft.accountId}
                onChange={(accountId) => setDraft({ ...draft, accountId })}
                options={data.accounts.map((a) => ({ value: a.id, label: a.name }))}
              />
              <Select
                label={t('fixed.category')}
                value={draft.categoryId}
                onChange={(categoryId) => setDraft({ ...draft, categoryId })}
                options={data.categories.map((c) => ({ value: c.id, label: c.name }))}
              />
              {error && (
                <p className="detail-note" role="alert">
                  {error}
                </p>
              )}
              <Button fullWidth onClick={() => void saveNew()}>
                {t('fixed.save')}
              </Button>
            </div>
          ))}
      </BottomSheet>
      <BottomSheet
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={t('fixed.confirmTitle', { descrição: confirming?.rec.description ?? '' })}
        data-testid="confirm-sheet"
      >
        <div className="account-form">
          <p className="detail-note">{t('fixed.confirmHint')}</p>
          <AmountInput label={t('fixed.amount')} value={amount} onChange={setAmount} />
          <Button fullWidth disabled={amount <= 0} onClick={() => void confirm()}>
            {t('fixed.confirm')}
          </Button>
        </div>
      </BottomSheet>
    </section>
  );
}
