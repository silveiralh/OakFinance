// P02 — Reserva de emergência (UX §3 P02, US-33, US-65): anel com o percentual, "{valor} guardados de {meta}",
// "Faltam", projeção, meta sugerida (ou provisória) e Ajustar meta, "Sugestão atualizada", Editar valor já guardado,
// Guardar / Registrar uso da reserva e o histórico de aportes e retiradas.
import { formatBRL, type ISODate } from '@oakfinance/domain';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../app/auth';
import { Amount, maskMoney, useValuesHidden } from '../../app/values';
import { useLive } from '../../data/live';
import { emptyStates, t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import {
  AmountInput,
  BottomSheet,
  Button,
  EmptyState,
  GlassCard,
  GoalProgress,
  useToast,
} from '../../ui';
import { loadHomeRows } from '../dashboard/data';
import { ReserveMoveSheet } from './ReserveMoveSheet';
import { markAchieved, reserveView, updateGoal } from './reserve';

type Sheet = 'goal' | 'saved' | 'save' | 'withdraw' | null;

export function ReserveScreen({ today: fixedToday }: { today?: ISODate }) {
  const { user } = useAuth();
  const hidden = useValuesHidden();
  const showToast = useToast();
  const today = useToday(fixedToday);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [value, setValue] = useState(0);
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
  const view = useMemo(
    () => (data?.goal ? reserveView(data.rows, data.goal, today) : null),
    [data, today],
  );

  // RN-56/US-65: o marco "Reserva de emergência completa" é registrado uma única vez
  useEffect(() => {
    if (!user || !view || !view.progress.achieved || view.goal.achieved_at !== null) {
      return;
    }
    void markAchieved(user.db, user.userId, view, {
      title: t('reserve.achieved.title'),
      body: t('reserve.achieved.body', { valor: formatBRL(view.progress.savedCents) }),
    }).then((now) => {
      if (now) {
        user.engine.notifyWrite();
        showToast({ message: t('reserve.achieved.title'), tone: 'info' });
      }
    });
  }, [user, view, showToast]);

  if (!user || !data) {
    return <section className="screen" data-screen="P02" data-testid="screen-P02" />;
  }
  const money = (c: number) => maskMoney(formatBRL(c), hidden);
  const open = (next: Sheet) => {
    if (next === 'goal') {
      setValue(view?.targetCents ?? 0);
    } else if (next === 'saved') {
      setValue(view?.goal.initial_saved_cents ?? 0);
    }
    setSheet(next);
  };
  const saveGoal = async (target: number | null) => {
    if (!view) {
      return;
    }
    await updateGoal(user.db, view.goal, { targetCents: target });
    user.engine.notifyWrite();
    setSheet(null);
    showToast({ message: t('reserve.goalSaved'), tone: 'success' });
  };
  const saveInitial = async () => {
    if (!view) {
      return;
    }
    await updateGoal(user.db, view.goal, { initialSavedCents: value });
    user.engine.notifyWrite();
    setSheet(null);
  };

  const p = view?.progress;
  const target = view?.targetCents ?? null;
  return (
    <section className="screen reserve" data-screen="P02" data-testid="screen-P02">
      {view && p && (
        <GlassCard level={2} className="reserve-summary" data-testid="reserve-summary">
          <GoalProgress
            savedCents={Math.max(0, p.savedCents)}
            goalCents={target}
            variant="ring"
            size="lg"
          />
          {target !== null && target > 0 ? (
            <>
              <p className="reserve-line money" data-testid="reserve-saved">
                {t('reserve.saved', { valor: money(p.savedCents), meta: money(target) })}
              </p>
              {p.savedCents > target ? (
                <p className="reserve-line money">
                  {t('reserve.over', { valor: money(p.savedCents - target) })}
                </p>
              ) : p.achieved ? null : (
                <p className="reserve-line money">
                  {t('reserve.remaining', { valor: money(target - Math.max(0, p.savedCents)) })}
                </p>
              )}
              {p.achieved && (
                <p className="reserve-line money" data-testid="reserve-full">
                  {t('reserve.full', { valor: money(p.savedCents) })}
                </p>
              )}
              {!p.achieved && p.etaMonths !== null && p.etaMonths > 0 && (
                <p className="reserve-hint">{t('reserve.pace', { n: p.etaMonths })}</p>
              )}
            </>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title={emptyStates.reserveNoGoal.title}
              description={emptyStates.reserveNoGoal.text}
              primaryAction={{
                label: emptyStates.reserveNoGoal.actions[0],
                onPress: () => open('goal'),
              }}
              data-testid="reserve-no-goal"
            />
          )}
          {p.savedCents < 0 && (
            <p className="reserve-hint" role="status" data-testid="reserve-negative">
              {t('reserve.negative')}
            </p>
          )}
          <div className="reserve-actions">
            {/* UXB-017: sem meta, o primário é "Definir meta" (no vazio acima); Guardar fica secundário */}
            <Button
              variant={target !== null && target > 0 ? 'primary' : 'secondary'}
              onClick={() => open('save')}
            >
              {t('reserve.save')}
            </Button>
            <Button variant="secondary" onClick={() => open('withdraw')}>
              {t('reserve.withdraw')}
            </Button>
          </div>
        </GlassCard>
      )}

      {view && (
        <GlassCard level={2} className="reserve-goal" data-testid="reserve-goal">
          {view.suggestion === null ? (
            <p className="reserve-hint">{t('reserve.noIncome')}</p>
          ) : view.suggestion.provisional ? (
            // UXB-016: uma frase só, que diz a base da estimativa
            <p className="reserve-hint money" data-testid="reserve-provisional">
              {t('reserve.goalProvisional', { valor: money(view.suggestion.avgNeedsCents) })}
            </p>
          ) : (
            <p className="reserve-hint money">
              {t('reserve.goalHint', { valor: money(view.suggestion.avgNeedsCents) })}
            </p>
          )}
          {view.suggestionChanged && view.suggestion && (
            <div className="reserve-suggestion" data-testid="reserve-suggestion">
              <p className="money">
                {t('reserve.suggestionChanged', { valor: money(view.suggestion.targetCents) })}
              </p>
              <div className="reserve-actions">
                <Button onClick={() => void saveGoal(null)}>{t('reserve.useSuggestion')}</Button>
                <Button variant="ghost" onClick={() => void saveGoal(view.goal.target_cents)}>
                  {t('reserve.keepMine')}
                </Button>
              </div>
            </div>
          )}
          <div className="reserve-actions">
            {/* T-096: alvos de 48 px (UX §8, 2.5.5) */}
            <Button variant="secondary" onClick={() => open('goal')}>
              {t('reserve.adjustGoal')}
            </Button>
            <Button variant="ghost" onClick={() => open('saved')}>
              {t('reserve.editSaved')}
            </Button>
          </div>
        </GlassCard>
      )}

      {view && view.moves.length === 0 ? (
        // UXB-017: o vazio do histórico é só texto; "Guardar" já está no card de cima
        <EmptyState
          icon={ShieldCheck}
          title={emptyStates.reserveNoMoves.title}
          description={emptyStates.reserveNoMoves.text}
          data-testid="reserve-no-moves"
        />
      ) : (
        view && (
          <section className="reserve-history" aria-labelledby="reserve-history">
            <h2 id="reserve-history">{t('reserve.history')}</h2>
            <ul className="glass">
              {view.moves.map((m) => (
                <li key={m.id} data-testid={`reserve-move-${m.id}`}>
                  <span>
                    {m.kind === 'save' ? t('reserve.move.save') : t('reserve.move.withdraw')}
                  </span>
                  <span>{formatDateBR(m.date)}</span>
                  <span className="money">
                    <Amount
                      text={`${m.kind === 'save' ? '+' : '−'}${formatBRL(m.amountCents)}`}
                      hidden={hidden}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      <BottomSheet
        open={sheet === 'goal' || sheet === 'saved'}
        onClose={() => setSheet(null)}
        title={sheet === 'goal' ? t('reserve.adjustGoal') : t('reserve.editSaved')}
        data-testid="reserve-edit"
      >
        <div className="account-form">
          <AmountInput
            size="compact"
            label={sheet === 'goal' ? t('reserve.goalField') : t('reserve.savedField')}
            value={value}
            onChange={setValue}
          />
          <Button
            fullWidth
            disabled={sheet === 'goal' && value <= 0}
            onClick={() => void (sheet === 'goal' ? saveGoal(value) : saveInitial())}
          >
            {t('categories.save')}
          </Button>
          {sheet === 'goal' && view?.suggestion && (
            <Button fullWidth variant="ghost" onClick={() => void saveGoal(null)}>
              {t('reserve.useSuggestion')}
            </Button>
          )}
        </div>
      </BottomSheet>
      {(sheet === 'save' || sheet === 'withdraw') && (
        <ReserveMoveSheet
          kind={sheet === 'save' ? 'save' : 'withdraw'}
          onClose={() => setSheet(null)}
          today={today}
        />
      )}
    </section>
  );
}
