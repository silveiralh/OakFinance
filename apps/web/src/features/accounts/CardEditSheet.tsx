// Editar cartão na S03 (US-11, RN-17): mesma validação do cadastro; mudar datas ou a regra mostra antes
// "{n} itens podem mudar de fatura" e só então recalcula as faturas abertas e futuras.
import type { ISODate } from '@oakfinance/domain';
import { useEffect, useState } from 'react';
import type { UserSession } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { cardFromRow } from '../../data/mappers';
import { changeCandidates, datesChanged, updateCard } from '../../data/repositories/card-edit';
import { type CardInput, parseDay } from '../../data/repositories/cards';
import { t } from '../../i18n/pt-BR';
import {
  AmountInput,
  BottomSheet,
  Button,
  Dialog,
  Select,
  Switch,
  TextField,
  useToast,
} from '../../ui';
import { previewText } from './CardsSection';

export interface CardEditSheetProps {
  user: UserSession;
  card: LocalRow<'cards'> | null;
  payers: readonly LocalRow<'accounts'>[];
  today: ISODate;
  onClose: () => void;
}

export function CardEditSheet({ user, card, payers, today, onClose }: CardEditSheetProps) {
  const showToast = useToast();
  const [name, setName] = useState('');
  const [closing, setClosing] = useState('');
  const [due, setDue] = useState('');
  const [toNext, setToNext] = useState(true);
  const [limit, setLimit] = useState(0);
  const [payer, setPayer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<number | null>(null);

  useEffect(() => {
    if (!card) {
      return;
    }
    setName(card.name);
    setClosing(String(card.closing_day));
    setDue(String(card.due_day));
    setToNext(card.closing_day_rule !== 'same');
    setLimit(card.limit_cents ?? 0);
    setPayer(card.payment_account_id ?? '');
    setError(null);
    setWarning(null);
  }, [card]);

  if (!card) {
    return null;
  }
  const closingDay = parseDay(closing);
  const dueDay = parseDay(due);
  const valid = closingDay !== null && dueDay !== null;
  const input: CardInput | null = valid
    ? {
        name,
        closingDay,
        dueDay,
        closingDayToNext: toNext,
        limitCents: limit > 0 ? limit : null,
        paymentAccountId: payer || null,
      }
    : null;

  const persist = async (data: CardInput) => {
    const result = await updateCard(user.db, card.id, data, today);
    if (!result.ok) {
      setWarning(null);
      setError(
        result.error.code === 'CARD_NAME'
          ? t(
              'problem' in result.error && result.error.problem === 'duplicate'
                ? 'cards.duplicate'
                : 'accounts.nameRequired',
            )
          : t('cards.invalidDay'),
      );
      return;
    }
    user.engine.notifyWrite();
    setWarning(null);
    onClose();
    showToast({ message: t('cards.updated'), tone: 'success' });
  };

  const save = async () => {
    if (!input) {
      return;
    }
    if (datesChanged(card, input)) {
      const [txRows, invoiceRows] = await Promise.all([
        user.db.transactions.where('card_id').equals(card.id).toArray(),
        user.db.invoices.where('card_id').equals(card.id).toArray(),
      ]);
      const n = changeCandidates(cardFromRow(card), txRows, invoiceRows, today).length;
      if (n > 0) {
        setWarning(n);
        return;
      }
    }
    await persist(input);
  };

  return (
    <>
      <BottomSheet
        open={warning === null}
        onClose={onClose}
        title={t('cards.editTitle')}
        data-testid="card-edit-sheet"
      >
        <div className="account-form">
          <TextField
            label={t('cards.name')}
            value={name}
            onChange={setName}
            {...(error ? { error } : {})}
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
          {valid && (
            <p className="account-meta" data-testid="card-edit-preview">
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
            fullWidth
            disabled={!valid}
            disabledReason={t('cards.invalidDay')}
            onClick={() => void save()}
          >
            {t('cards.saveChanges')}
          </Button>
        </div>
      </BottomSheet>
      <Dialog
        open={warning !== null}
        title={t('cards.moveWarning', { n: warning ?? 0 })}
        description={t('cards.moveHint')}
        confirmLabel={t('cards.moveConfirm')}
        onConfirm={() => input && void persist(input)}
        onCancel={() => setWarning(null)}
        data-testid="card-move-dialog"
      />
    </>
  );
}
