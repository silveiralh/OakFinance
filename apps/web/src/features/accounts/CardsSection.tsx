import { type ISODate, monthLabel, todayIn } from '@oakfinance/domain';
import { Archive, CreditCard, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { isActive } from '../../data/repositories/accounts';
import {
  archiveCard,
  cardInUse,
  createCard,
  draftCard,
  parseDay,
  previewInvoice,
  removeCard,
  unarchiveCard,
} from '../../data/repositories/cards';
import { type MessageKey, t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { AmountInput, Button, EmptyState, GlassCard, Select, Switch, TextField } from '../../ui';
import { editCard, previewCardChange } from '../cards/edit';

const NAME_ERROR: Record<'required' | 'tooLong' | 'duplicate', MessageKey> = {
  required: 'accounts.nameRequired',
  tooLong: 'accounts.nameTooLong',
  duplicate: 'cards.duplicate',
};

/** "Compras de hoje vão para a fatura de dez/2026, que vence em 10/12/2026" (US-10, RN-12). */
export function previewText(
  closingDay: number,
  dueDay: number,
  toNext: boolean,
  today: string,
): string {
  const invoice = previewInvoice(
    draftCard({ closingDay, dueDay, closingDayToNext: toNext }),
    today,
  );
  return t('cards.preview', {
    mês: monthLabel(invoice.referenceMonth),
    data: formatDateBR(invoice.dueDate),
  });
}

/** "{n} itens podem mudar de fatura" (RN-17); nada quando nenhum item muda. */
export function willMoveText(count: number): string | null {
  if (count === 0) {
    return null;
  }
  return count === 1 ? t('cards.willMove.one') : t('cards.willMove.many', { n: count });
}

type CardRow = LocalRow<'cards'>;

/** US-11: editar nome, fechamento, vencimento, regra, limite e conta que paga, com a prévia da RN-17. */
function EditCardForm({
  card,
  payers,
  today,
  onDone,
}: {
  card: CardRow;
  payers: readonly LocalRow<'accounts'>[];
  today: string;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState(card.name);
  const [closing, setClosing] = useState(String(card.closing_day));
  const [due, setDue] = useState(String(card.due_day));
  const [toNext, setToNext] = useState(card.closing_day_rule !== 'same');
  const [limit, setLimit] = useState(card.limit_cents ?? 0);
  const [payer, setPayer] = useState(card.payment_account_id ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const items = useLive(
    user
      ? async () => ({
          invoices: await user.db.invoices.where('card_id').equals(card.id).toArray(),
          transactions: await user.db.transactions.where('card_id').equals(card.id).toArray(),
        })
      : null,
    [user, card.id],
  );
  if (!user) {
    return null;
  }
  const closingDay = parseDay(closing);
  const dueDay = parseDay(due);
  const valid = closingDay !== null && dueDay !== null;
  const input =
    closingDay !== null && dueDay !== null
      ? {
          name,
          closingDay,
          dueDay,
          closingDayToNext: toNext,
          limitCents: limit > 0 ? limit : null,
          paymentAccountId: payer || null,
        }
      : null;
  const count =
    input && items
      ? previewCardChange(
          card,
          input,
          items.invoices,
          items.transactions,
          today as ISODate,
          user.userId,
          new Date().toISOString(),
        ).count
      : 0;
  const warning = willMoveText(count);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!input) {
      return;
    }
    const result = await editCard(user.db, user.userId, card.id, input, today as ISODate);
    if (!result.ok) {
      setNameError(
        result.error.code === 'CARD_NAME' && 'problem' in result.error
          ? t(NAME_ERROR[result.error.problem as 'required'])
          : null,
      );
      return;
    }
    user.engine.notifyWrite();
    onDone();
  };

  return (
    <form
      className="account-form"
      onSubmit={(event) => void submit(event)}
      data-testid={`card-edit-${card.id}`}
    >
      <TextField
        label={t('cards.name')}
        value={name}
        onChange={setName}
        {...(nameError ? { error: nameError } : {})}
      />
      <TextField
        label={t('cards.closing')}
        value={closing}
        onChange={setClosing}
        inputMode="numeric"
        {...(closing !== '' && closingDay === null ? { error: t('cards.invalidDay') } : {})}
      />
      <TextField
        label={t('cards.due')}
        value={due}
        onChange={setDue}
        inputMode="numeric"
        {...(due !== '' && dueDay === null ? { error: t('cards.invalidDay') } : {})}
      />
      <Switch
        label={t('cards.rule')}
        description={t('cards.ruleHint')}
        checked={toNext}
        onChange={setToNext}
      />
      {closingDay !== null && dueDay !== null && (
        <p className="account-meta">{previewText(closingDay, dueDay, toNext, today)}</p>
      )}
      {warning && (
        <p className="account-meta" role="status" data-testid="card-will-move">
          {warning}
        </p>
      )}
      <AmountInput size="compact" label={t('cards.limit')} value={limit} onChange={setLimit} />
      <Select
        label={t('cards.payer')}
        value={payer}
        onChange={setPayer}
        options={[
          { value: '', label: t('cards.noPayer') },
          ...payers.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
      <div className="account-actions">
        <Button variant="ghost" size="sm" onClick={onDone}>
          {t('accounts.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!valid} disabledReason={t('cards.invalidDay')}>
          {t('accounts.save')}
        </Button>
      </div>
    </form>
  );
}

/** S03 — cartões (US-10): dias 1–31, regra do dia do fechamento, prévia da fatura, conta que paga, limite. */
export function CardsSection({
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  today?: string;
}) {
  const { user } = useAuth();
  const cards = useLive(
    user ? () => user.db.cards.filter((row) => row.deleted_at === null).sortBy('sort_order') : null,
    [user],
  );
  const accounts = useLive(user ? () => user.db.accounts.filter(isActive).toArray() : null, [user]);
  const [name, setName] = useState('');
  const [closing, setClosing] = useState('');
  const [due, setDue] = useState('');
  const [toNext, setToNext] = useState(true);
  const [limit, setLimit] = useState(0);
  const [payer, setPayer] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const inUse = useLive(
    user && cards
      ? async () => {
          const used = new Set<string>();
          for (const card of cards) {
            if (await cardInUse(user.db, card.id)) {
              used.add(card.id);
            }
          }
          return used;
        }
      : null,
    [user, cards],
  );

  if (!user) {
    return null;
  }

  const closingDay = parseDay(closing);
  const dueDay = parseDay(due);
  const closingError = closing !== '' && closingDay === null ? t('cards.invalidDay') : undefined;
  const dueError = due !== '' && dueDay === null ? t('cards.invalidDay') : undefined;
  const valid = closingDay !== null && dueDay !== null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (closingDay === null || dueDay === null) {
      return;
    }
    const result = await createCard(user.db, user.userId, {
      name,
      closingDay,
      dueDay,
      closingDayToNext: toNext,
      limitCents: limit > 0 ? limit : null,
      paymentAccountId: payer || null,
    });
    if (!result.ok) {
      setNameError(
        result.error.code === 'CARD_NAME' && 'problem' in result.error
          ? t(NAME_ERROR[result.error.problem as 'required'])
          : null,
      );
      return;
    }
    setNameError(null);
    setName('');
    setClosing('');
    setDue('');
    setToNext(true);
    setLimit(0);
    user.engine.notifyWrite();
  };

  const act = async (id: string, run: () => Promise<{ ok: boolean; error?: { code: string } }>) => {
    const result = await run();
    if (result.ok) {
      setRowError(null);
      user.engine.notifyWrite();
    } else if (result.error?.code === 'CARD_HAS_TRANSACTIONS') {
      setRowError({ id, message: t('accounts.hasTransactions') });
    } else if (result.error?.code === 'CARD_NAME') {
      setRowError({ id, message: t('cards.duplicate') });
    }
  };

  const active = (cards ?? []).filter((row) => row.archived_at === null);
  const archived = (cards ?? []).filter((row) => row.archived_at !== null);
  const payers = (accounts ?? []).filter(
    (row) => row.type === 'checking' || row.type === 'savings',
  );

  return (
    <>
      <GlassCard level={2}>
        {active.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title={t('cards.empty')}
            description={t('onb.cards.title')}
          />
        ) : (
          <ul className="account-list">
            {active.map((card: LocalRow<'cards'>) =>
              editing === card.id ? (
                <li key={card.id} className="account-row" data-testid={`card-${card.id}`}>
                  <EditCardForm
                    card={card}
                    payers={payers}
                    today={today}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={card.id} className="account-row" data-testid={`card-${card.id}`}>
                  <div>
                    <p className="account-name">{card.name}</p>
                    <p className="account-meta">
                      {t('cards.closesDue', { f: card.closing_day, v: card.due_day })}
                    </p>
                    <p className="account-meta">
                      {previewText(
                        card.closing_day,
                        card.due_day,
                        card.closing_day_rule === 'next',
                        today,
                      )}
                    </p>
                    {rowError?.id === card.id && (
                      <p role="alert" className="account-error">
                        {rowError.message}
                      </p>
                    )}
                  </div>
                  <div className="account-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      iconStart={Pencil}
                      onClick={() => setEditing(card.id)}
                    >
                      {t('accounts.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconStart={Archive}
                      onClick={() => void act(card.id, () => archiveCard(user.db, card.id))}
                    >
                      {t('accounts.archive')}
                    </Button>
                    {inUse && !inUse.has(card.id) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        iconStart={Trash2}
                        onClick={() => void act(card.id, () => removeCard(user.db, card.id))}
                      >
                        {t('accounts.delete')}
                      </Button>
                    )}
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </GlassCard>
      {archived.length > 0 && (
        <details className="account-archived">
          <summary>{t('cards.archived')}</summary>
          <ul className="account-list">
            {archived.map((card) => (
              <li key={card.id} className="account-row" data-testid={`card-${card.id}`}>
                <div>
                  <p className="account-name">{card.name}</p>
                  <p className="account-meta">
                    {t('cards.closesDue', { f: card.closing_day, v: card.due_day })}
                  </p>
                  {rowError?.id === card.id && (
                    <p role="alert" className="account-error">
                      {rowError.message}
                    </p>
                  )}
                </div>
                <div className="account-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    iconStart={RotateCcw}
                    onClick={() => void act(card.id, () => unarchiveCard(user.db, card.id))}
                  >
                    {t('accounts.unarchive')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <GlassCard level={2}>
        <form
          className="account-form"
          onSubmit={(event) => void submit(event)}
          data-testid="card-form"
        >
          <TextField
            label={t('cards.name')}
            value={name}
            onChange={setName}
            {...(nameError ? { error: nameError } : {})}
          />
          <TextField
            label={t('cards.closing')}
            value={closing}
            onChange={setClosing}
            inputMode="numeric"
            {...(closingError ? { error: closingError } : {})}
          />
          {closingDay === 31 && <p className="account-meta">{t('cards.day31')}</p>}
          <TextField
            label={t('cards.due')}
            value={due}
            onChange={setDue}
            inputMode="numeric"
            {...(dueError ? { error: dueError } : {})}
          />
          {valid && closingDay === dueDay && (
            <p className="account-meta" role="status">
              {t('cards.sameDay')}
            </p>
          )}
          <Switch
            label={t('cards.rule')}
            description={t('cards.ruleHint')}
            checked={toNext}
            onChange={setToNext}
          />
          {valid && (
            <p className="account-meta" data-testid="card-preview">
              {previewText(closingDay, dueDay, toNext, today)}
            </p>
          )}
          <AmountInput size="compact" label={t('cards.limit')} value={limit} onChange={setLimit} />
          <Select
            label={t('cards.payer')}
            value={payer}
            onChange={setPayer}
            options={[
              { value: '', label: t('cards.noPayer') },
              ...payers.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <Button
            type="submit"
            iconStart={Plus}
            fullWidth
            disabled={!valid}
            disabledReason={t('cards.invalidDay')}
          >
            {t('cards.add')}
          </Button>
        </form>
      </GlassCard>
    </>
  );
}
