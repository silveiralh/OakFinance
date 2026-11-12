// S05 — Contas fixas e assinaturas (US-25, RN-26..RN-29, RN-31): ocorrência do mês com "≈ R$ X" no valor
// variável, "atrasada" a partir de D+1, Confirmar com o valor pago e "Pular este mês"; confirmação automática (RN-28)
// ligada por padrão no cartão; cadastro de nova conta fixa.
import { formatBRL, type ISODate, monthOf, type Recurrence } from '@oakfinance/domain';
import { Plus, Repeat } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { UserSession } from '../../app/auth';
import { maskMoney, useValuesHidden } from '../../app/values';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { txFromRow } from '../../data/mappers';
import { parseDay } from '../../data/repositories/cards';
import { saveRow } from '../../data/repositories/rows';
import { t } from '../../i18n/pt-BR';
import {
  AmountInput,
  BottomSheet,
  Button,
  EmptyState,
  GlassCard,
  Select,
  Switch,
  TextField,
  useToast,
} from '../../ui';
import { expenseCategories } from '../quick-entry/model';
import { occurrenceText } from './IncomeScreen';
import {
  approxAmount,
  buildFixedExpense,
  confirmOccurrence,
  projectIncome,
  recurrenceFromRow,
  runAutoPosts,
  skipOccurrence,
} from './model';
import { RecurrenceTools } from './RecurrenceTools';

interface Draft {
  description: string;
  amount: number;
  day: string;
  method: string;
  categoryId: string;
  variable: boolean;
  autoPost: boolean;
}

/** "pix:<conta>" ou "card:<cartão>". */
export function methodTarget(method: string): { accountId: string | null; cardId: string | null } {
  const [kind, id = ''] = method.split(':');
  return kind === 'card'
    ? { accountId: null, cardId: id }
    : { accountId: id || null, cardId: null };
}

export function ExpensesSection({ user, today }: { user: UserSession; today: ISODate }) {
  const showToast = useToast();
  const hidden = useValuesHidden();
  const data = useLive(
    async () => ({
      recurrences: await user.db.recurrences.toArray(),
      transactions: (await user.db.transactions.toArray()).filter((r) => r.recurrence_id !== null),
      accounts: (await user.db.accounts.toArray()).filter(
        (a) => a.deleted_at === null && a.archived_at === null,
      ),
      cards: (await user.db.cards.toArray()).filter(
        (c) => c.deleted_at === null && c.archived_at === null,
      ),
      categories: await user.db.categories.toArray(),
    }),
    [user],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ rec: Recurrence; date: ISODate } | null>(null);
  const [amount, setAmount] = useState(0);

  const recs = useMemo(
    () =>
      (data?.recurrences ?? [])
        .filter((r) => r.deleted_at === null && r.kind === 'expense')
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

  // RN-28: confirmação automática das ocorrências vencidas (uma vez por abertura da tela)
  const posted = useRef(false);
  useEffect(() => {
    if (!data || posted.current) {
      return;
    }
    posted.current = true;
    void runAutoPosts(user.db, user.userId, recs, txs, today).then((n) => {
      if (n > 0) {
        user.engine.notifyWrite();
      }
    });
  }, [data, recs, txs, today, user]);

  if (!data) {
    return null;
  }
  const rowById = new Map(data.transactions.map((r) => [r.id, r]));
  const recRows = new Map(data.recurrences.map((r) => [r.id, r]));
  const methods = [
    ...data.accounts
      .filter((a) => a.type === 'checking' || a.type === 'savings')
      .map((a) => ({ value: `pix:${a.id}`, label: `${t('accounts.method.pix')} · ${a.name}` })),
    ...data.cards.map((c) => ({
      value: `card:${c.id}`,
      label: `${t('accounts.method.credit')} · ${c.name}`,
    })),
  ];
  const categories = expenseCategories(data.categories);

  const openNew = () => {
    setError(null);
    const method = methods[0]?.value ?? '';
    setDraft({
      description: '',
      amount: 0,
      day: today.slice(8, 10).replace(/^0/, ''),
      method,
      categoryId: categories[0]?.id ?? '',
      variable: false,
      autoPost: method.startsWith('card:'),
    });
  };

  const saveNew = async () => {
    if (!draft) {
      return;
    }
    const day = parseDay(draft.day);
    const problem =
      draft.description.trim() === ''
        ? t('fixed.missingDescription')
        : draft.amount <= 0
          ? t('fixed.missingAmount')
          : day === null
            ? t('cards.invalidDay')
            : !draft.method
              ? t('fixed.missingAccount')
              : null;
    if (problem || day === null) {
      setError(problem);
      return;
    }
    const target = methodTarget(draft.method);
    const result = await saveRow(
      user.db,
      'recurrences',
      buildFixedExpense({
        userId: user.userId,
        description: draft.description,
        amountCents: draft.amount,
        dayOfMonth: day,
        accountId: target.accountId,
        cardId: target.cardId,
        categoryId: draft.categoryId || null,
        variable: draft.variable,
        autoPost: draft.autoPost,
        startOn: `${monthOf(today)}-01` as ISODate,
        nowIso: new Date().toISOString(),
      }),
    );
    if (!result.ok) {
      return;
    }
    user.engine.notifyWrite();
    setDraft(null);
    showToast({ message: t('fixed.expenseSaved'), tone: 'success' });
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
    if (result.ok) {
      user.engine.notifyWrite();
      setConfirming(null);
    }
  };

  const skip = async (rec: Recurrence, date: ISODate) => {
    const result = await skipOccurrence(user.db, user.userId, rec, date);
    if (result.ok) {
      user.engine.notifyWrite();
      showToast({ message: t('fixed.skipToast') });
    }
  };

  return (
    <>
      <h2 className="list-month-title">{t('fixed.expenses')}</h2>
      {recs.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title={t('fixed.expensesEmpty')}
          description={t('fixed.expensesEmptyHint')}
          primaryAction={{ label: t('fixed.newExpense'), onPress: openNew }}
        />
      ) : (
        recs.map((rec) => {
          const mine = projected.filter((o) => o.recurrenceId === rec.id);
          const current = mine.find((o) => monthOf(o.date) === monthOf(today));
          const currentTx = current?.realizedTxId ? rowById.get(current.realizedTxId) : undefined;
          const approx = rec.isVariableAmount ? approxAmount(rec, txs) : null;
          const next = mine.filter((o) => o !== current).slice(0, 3);
          return (
            <GlassCard key={rec.id} level={1} title={rec.description} headingLevel={3}>
              <div className="cards-current" data-testid={`expense-${rec.id}`}>
                {current && (
                  <>
                    <p className="cards-line" data-testid="expense-current">
                      {occurrenceText(current, currentTx, today, hidden, {
                        kind: 'expense',
                        approxCents: approx,
                      })}
                    </p>
                    {(!currentTx || currentTx.status === 'pending') && (
                      <div className="detail-actions">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setAmount(approx ?? current.amountCents);
                            setConfirming({ rec, date: current.date });
                          }}
                        >
                          {t('fixed.confirm')}
                        </Button>
                        <Button variant="ghost" onClick={() => void skip(rec, current.date)}>
                          {t('tx.recurrence.skip')}
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {recRows.get(rec.id) && (
                  <RecurrenceTools
                    user={user}
                    rec={rec}
                    row={recRows.get(rec.id) as LocalRow<'recurrences'>}
                    open={mine.filter(
                      (o) =>
                        o.realizedTxId === null ||
                        rowById.get(o.realizedTxId)?.status === 'pending',
                    )}
                    today={today}
                  />
                )}
                {next.length > 0 && (
                  <ul className="cards-invoices" data-testid="expense-upcoming">
                    {next.map((o) => (
                      <li key={o.date} className="detail-note">
                        {occurrenceText(
                          o,
                          o.realizedTxId ? rowById.get(o.realizedTxId) : undefined,
                          today,
                          hidden,
                          { kind: 'expense', approxCents: approx },
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </GlassCard>
          );
        })
      )}
      {recs.length > 0 && (
        <div className="detail-actions">
          <Button iconStart={Plus} variant="secondary" onClick={openNew}>
            {t('fixed.newExpense')}
          </Button>
        </div>
      )}
      <BottomSheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={t('fixed.newExpense')}
        data-testid="expense-sheet"
      >
        {draft && (
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
              label={t('fixed.method')}
              value={draft.method}
              onChange={(method) =>
                setDraft({ ...draft, method, autoPost: method.startsWith('card:') })
              }
              options={methods}
            />
            <Select
              label={t('fixed.category')}
              value={draft.categoryId}
              onChange={(categoryId) => setDraft({ ...draft, categoryId })}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <Switch
              label={t('fixed.variable')}
              checked={draft.variable}
              onChange={(variable) => setDraft({ ...draft, variable })}
            />
            <Switch
              label={t('fixed.autoPost')}
              checked={draft.autoPost}
              onChange={(autoPost) => setDraft({ ...draft, autoPost })}
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
        )}
      </BottomSheet>
      <BottomSheet
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={t('fixed.confirmTitle', { descrição: confirming?.rec.description ?? '' })}
        data-testid="expense-confirm-sheet"
      >
        <div className="account-form">
          <p className="detail-note">{t('fixed.confirmPaid')}</p>
          <AmountInput label={t('fixed.amount')} value={amount} onChange={setAmount} />
          <p className="detail-note">{maskMoney(formatBRL(amount), hidden)}</p>
          <Button fullWidth disabled={amount <= 0} onClick={() => void confirm()}>
            {t('fixed.confirm')}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
