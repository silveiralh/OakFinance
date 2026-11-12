// Guardar (Q01 em modo Guardar, `?novo=guardar`, RN-54) e Registrar uso da reserva (resgate, RN-36): valor e conta;
// grava o lançamento com o `goal_id` da reserva e confirma com o toast da US-65.
import { formatBRL, type ISODate, MAX_TX_CENTS, todayIn } from '@oakfinance/domain';
import { useState } from 'react';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import {
  AmountInput,
  appendDigits,
  BottomSheet,
  Button,
  NumericKeypad,
  preferredKeypad,
  Select,
  useToast,
} from '../../ui';
import { loadHomeRows } from '../dashboard/data';
import { percentAfter, reserveView, saveReserveMove } from './reserve';

export function ReserveMoveSheet({
  kind,
  onClose,
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  kind: 'save' | 'withdraw';
  onClose: () => void;
  today?: ISODate;
}) {
  const { user } = useAuth();
  const showToast = useToast();
  const [amount, setAmount] = useState(0);
  const [keypad] = useState(preferredKeypad);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const data = useLive(
    user
      ? async () => ({
          rows: await loadHomeRows(user.db),
          goal:
            (await user.db.goals.where('kind').equals('emergency_reserve').toArray()).find(
              (g) => g.deleted_at === null,
            ) ?? null,
        })
      : null,
    [user],
  );
  const accounts = (data?.rows.accounts ?? []).filter(
    (a) => a.deleted_at === null && a.archived_at === null && a.type !== 'credit_card',
  );
  const chosen = accountId ?? accounts[0]?.id ?? null;
  const title = kind === 'save' ? t('reserve.saveTitle') : t('reserve.withdraw');
  const missing =
    amount <= 0
      ? t('quick.missing.amount')
      : !chosen
        ? t('quick.missing.method')
        : !data?.goal
          ? t('reserve.noGoal')
          : null;

  const submit = async () => {
    if (!user || !data?.goal || !chosen || missing) {
      return;
    }
    setBusy(true);
    const reserveCategory = data.rows.categories.find(
      (c) => c.slug === 'reserva-emergencia' && c.deleted_at === null,
    );
    const otherIncome = data.rows.categories.find(
      (c) => c.slug === 'outras-receitas' && c.deleted_at === null,
    );
    const view = reserveView(data.rows, data.goal, today);
    await saveReserveMove(user.db, user.userId, {
      kind,
      goalId: data.goal.id,
      accountId: chosen,
      amountCents: amount,
      date: today,
      categoryId: kind === 'save' ? (reserveCategory?.id ?? null) : (otherIncome?.id ?? null),
      description: kind === 'save' ? t('home.reserve.title') : t('reserve.move.withdraw'),
    });
    user.engine.notifyWrite();
    const p = percentAfter(view, kind === 'save' ? amount : -amount);
    showToast({
      message:
        kind === 'save'
          ? t('reserve.saveDone', { valor: formatBRL(amount), p })
          : t('reserve.withdrawDone', { valor: formatBRL(amount), p }),
      tone: 'success',
    });
    onClose();
  };

  return (
    <BottomSheet open onClose={onClose} title={title} data-testid="reserve-move">
      {/* UX2A-005: o mesmo arranjo do Q01 — conta em cima e valor, teclado e botão num rodapé fixo */}
      <div className="quick-entry">
        {accounts.length > 0 && (
          <Select
            label={kind === 'save' ? t('reserve.fromAccount') : t('reserve.toAccount')}
            value={chosen ?? ''}
            onChange={setAccountId}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        )}
        {missing && amount > 0 && (
          <p className="detail-note" role="alert">
            {missing}
          </p>
        )}
        <div className="quick-footer" data-testid="reserve-move-footer">
          <AmountInput
            label={t('reserve.amount')}
            value={amount}
            onChange={setAmount}
            autoFocus
            keypad={keypad}
            showKeypad={false}
          />
          {keypad === 'custom' && (
            <NumericKeypad
              onDigit={(d) => setAmount((v) => appendDigits(v, d, MAX_TX_CENTS))}
              onBackspace={() => setAmount((v) => Math.floor(v / 10))}
              onClear={() => setAmount(0)}
            />
          )}
          <Button
            size="lg"
            fullWidth
            disabled={Boolean(missing) || busy}
            onClick={() => void submit()}
            data-testid="reserve-move-submit"
          >
            {kind === 'save' ? t('reserve.save') : t('reserve.confirm')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
