// ON07b — Reserva (UX §3 ON07b, US-08, RN-52, RN-55): quanto já está guardado (padrão R$ 0,00) e a meta sugerida
// (provisória sem histórico); "Definir outra meta" abre o valor manual. Funciona offline (grava local).
import { formatBRL, type ISODate } from '@oakfinance/domain';
import { useState } from 'react';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { useToday } from '../../lib/useToday';
import { AmountInput, Button } from '../../ui';
import { reserveView, updateGoal } from '../budget/reserve';
import { loadHomeRows } from '../dashboard/data';
import { OnbFrame, useOnbStep, useStepDraft } from './OnbFrame';

export interface ReserveDraft {
  savedCents: number;
  /** `null`: meta automática (sugerida). */
  targetCents: number | null;
}

/** Texto da meta sugerida (UX §3 ON07b). */
export function suggestionText(
  suggestion: { targetCents: number; provisional: boolean } | null,
): string {
  if (!suggestion) {
    return t('onb.reserve.noIncome');
  }
  const valor = formatBRL(suggestion.targetCents);
  return suggestion.provisional
    ? t('onb.reserve.provisional', { valor })
    : t('onb.reserve.suggested', { valor });
}

export function ReserveStep({ today: fixedToday }: { today?: ISODate }) {
  const today = useToday(fixedToday);
  const { user, busy, advance } = useOnbStep('reserve');
  const data = useLive(
    user
      ? async () => {
          const rows = await loadHomeRows(user.db);
          const goal = (
            await user.db.goals.where('kind').equals('emergency_reserve').toArray()
          ).find((g) => g.deleted_at === null);
          return { rows, goal: goal ?? null };
        }
      : null,
    [user],
  );
  const [draft, setDraft] = useStepDraft<ReserveDraft>('reserve', {
    savedCents: 0,
    targetCents: null,
  });
  const [custom, setCustom] = useState(draft.targetCents !== null);
  const view = data?.goal ? reserveView(data.rows, data.goal, today) : null;

  const save = async () => {
    if (user && data?.goal) {
      await updateGoal(user.db, data.goal, {
        initialSavedCents: draft.savedCents,
        ...(custom && draft.targetCents !== null && draft.targetCents > 0
          ? { targetCents: draft.targetCents }
          : {}),
      });
    }
    await advance('done');
  };

  return (
    <OnbFrame
      step="reserve"
      title={t('onb.reserve.title')}
      onSkip={() => void advance('skip')}
      primary={
        <Button
          fullWidth
          disabled={busy || data === undefined}
          onClick={() => void save()}
          data-testid="onb-continue"
        >
          {t('common.continue')}
        </Button>
      }
    >
      <AmountInput
        size="compact"
        label={t('onb.reserve.saved')}
        value={draft.savedCents}
        onChange={(savedCents) => setDraft({ ...draft, savedCents })}
        keypad="native"
        data-testid="onb-reserve-saved"
      />
      <p className="account-meta" data-testid="onb-reserve-suggestion">
        {suggestionText(view?.suggestion ?? null)}
      </p>
      {custom ? (
        <AmountInput
          size="compact"
          label={t('onb.reserve.target')}
          value={draft.targetCents ?? 0}
          onChange={(targetCents) => setDraft({ ...draft, targetCents })}
          keypad="native"
          data-testid="onb-reserve-target"
        />
      ) : (
        <Button variant="ghost" onClick={() => setCustom(true)} data-testid="onb-reserve-custom">
          {t('onb.reserve.custom')}
        </Button>
      )}
    </OnbFrame>
  );
}
