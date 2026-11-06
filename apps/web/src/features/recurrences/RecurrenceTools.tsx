// Mudar valor (Só esta / Esta e as próximas) e Encerrar a partir desta (US-26, RN-30), nas receitas e contas fixas
// da S05.
import type { ISODate, ProjectedOccurrence, Recurrence } from '@oakfinance/domain';
import { useState } from 'react';
import type { UserSession } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import {
  AmountInput,
  BottomSheet,
  Button,
  DateChip,
  SegmentedControl,
  Select,
  useToast,
} from '../../ui';
import { editOneOccurrence, endRecurrence, splitRecurrence } from './model';

export interface RecurrenceToolsProps {
  user: UserSession;
  rec: Recurrence;
  row: LocalRow<'recurrences'>;
  /** Ocorrências ainda não lançadas (a do mês e as próximas). */
  open: readonly ProjectedOccurrence[];
  today: ISODate;
}

export function RecurrenceTools({ user, rec, row, open, today }: RecurrenceToolsProps) {
  const showToast = useToast();
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [date, setDate] = useState<ISODate | ''>('');
  const [amount, setAmount] = useState(0);
  const [scope, setScope] = useState<'one' | 'next'>('next');
  const [endOn, setEndOn] = useState<ISODate>(today);

  const startEdit = () => {
    const first = open[0];
    setDate(first?.date ?? '');
    setAmount(first?.amountCents ?? rec.amountCents);
    setScope('next');
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!date || amount <= 0) {
      return;
    }
    const result =
      scope === 'one'
        ? await editOneOccurrence(user.db, user.userId, rec, date, amount, today)
        : await splitRecurrence(user.db, row, date, amount);
    if (result.ok) {
      user.engine.notifyWrite();
      setEditing(false);
      showToast({ message: t('fixed.updated'), tone: 'success' });
    }
  };

  const saveEnd = async () => {
    const result = await endRecurrence(user.db, row, endOn);
    if (result.ok) {
      user.engine.notifyWrite();
      setEnding(false);
      showToast({ message: t('fixed.ended') });
    }
  };

  return (
    <>
      <div className="detail-actions">
        {open.length > 0 && (
          <Button variant="ghost" size="sm" onClick={startEdit}>
            {t('fixed.editValue')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEndOn(today);
            setEnding(true);
          }}
        >
          {t('tx.recurrence.endFromHere')}
        </Button>
      </div>
      <BottomSheet
        open={editing}
        onClose={() => setEditing(false)}
        title={t('fixed.editTitle', { descrição: rec.description })}
        data-testid="recurrence-edit"
      >
        <div className="account-form">
          <Select
            label={t('fixed.occurrence')}
            value={date}
            onChange={(value) => setDate(value as ISODate)}
            options={open.map((o) => ({ value: o.date, label: formatDateBR(o.date) }))}
          />
          <AmountInput label={t('fixed.amount')} value={amount} onChange={setAmount} />
          <SegmentedControl
            label={t('series.scope')}
            value={scope}
            onChange={setScope}
            options={[
              { value: 'one', label: t('tx.scope.recOne') },
              { value: 'next', label: t('tx.scope.recNext') },
            ]}
          />
          <Button fullWidth disabled={!date || amount <= 0} onClick={() => void saveEdit()}>
            {t('fixed.save')}
          </Button>
        </div>
      </BottomSheet>
      <BottomSheet
        open={ending}
        onClose={() => setEnding(false)}
        title={t('fixed.endTitle', { descrição: rec.description })}
        data-testid="recurrence-end"
      >
        <div className="account-form">
          <p className="detail-note">{t('fixed.endHint')}</p>
          <DateChip
            label={t('fixed.endOn')}
            value={endOn}
            onChange={(value) => setEndOn(value as ISODate)}
            today={today}
          />
          <Button variant="danger" fullWidth onClick={() => void saveEnd()}>
            {t('tx.recurrence.endFromHere')}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
