// ON05 — Renda (UX §3 ON05, US-08, RN-32): valor, dia do crédito (1–31, padrão 5; RN-03 nos meses curtos) e a
// conta. "Continuar" cria a receita fixa mensal; sem conta ainda ("Cadastrar no próximo passo"), a renda fica no
// progresso e é criada no ON06 com a conta do Pix e débito.
import { type ISODate, monthOf } from '@oakfinance/domain';
import type { OakDb } from '../../data/db';
import { useLive } from '../../data/live';
import { isActive } from '../../data/repositories/accounts';
import { saveRow } from '../../data/repositories/rows';
import { t } from '../../i18n/pt-BR';
import { useToday } from '../../lib/useToday';
import { AmountInput, Button, Select, Switch } from '../../ui';
import { buildFixedIncome } from '../recurrences/model';
import { OnbFrame, useOnbStep, useStepDraft } from './OnbFrame';
import type { PendingIncome } from './progress';

export interface IncomeDraft {
  amountCents: number;
  day: string;
  accountId: string;
  variable: boolean;
}

export const DEFAULT_INCOME_DAY = 5;
/** Categoria padrão da renda fixa (seed da RN-40, a mesma da S05). */
const SALARY_SLUG = 'salario';
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

/** Cria a receita fixa do onboarding (categoria Salário, descrição com o nome dela). */
export async function createOnboardingIncome(
  db: OakDb,
  userId: string,
  income: PendingIncome & { accountId: string },
  today: ISODate,
): Promise<boolean> {
  const salary = (await db.categories.toArray()).find(
    (c) => c.slug === SALARY_SLUG && c.deleted_at === null,
  );
  const row = buildFixedIncome({
    userId,
    description: salary?.name ?? 'Salário',
    amountCents: income.amountCents,
    dayOfMonth: income.day,
    accountId: income.accountId,
    categoryId: salary?.id ?? null,
    startOn: `${monthOf(today)}-01` as ISODate,
    nowIso: new Date().toISOString(),
  });
  return (await saveRow(db, 'recurrences', row)).ok;
}

export function IncomeStep({ today: fixedToday }: { today?: ISODate }) {
  const today = useToday(fixedToday);
  const { user, busy, advance } = useOnbStep('income');
  const accounts = useLive(
    user ? () => user.db.accounts.toArray().then((rows) => rows.filter(isActive)) : null,
    [user],
  );
  const [draft, setDraft] = useStepDraft<IncomeDraft>('income', {
    amountCents: 0,
    day: String(DEFAULT_INCOME_DAY),
    accountId: '',
    variable: false,
  });
  const invalid = draft.amountCents <= 0;
  const options = [
    ...(accounts ?? []).map((a) => ({ value: a.id, label: a.name })),
    { value: '', label: t('onb.income.accountLater') },
  ];
  const accountId = (accounts ?? []).some((a) => a.id === draft.accountId) ? draft.accountId : '';

  const save = async () => {
    if (invalid || !user) {
      return;
    }
    const income = { amountCents: draft.amountCents, day: Number(draft.day) || DEFAULT_INCOME_DAY };
    if (accountId) {
      await createOnboardingIncome(user.db, user.userId, { ...income, accountId }, today);
    }
    await advance('done', (s) => {
      const { pendingIncome: _old, ...rest } = s;
      return {
        ...rest,
        variableIncome: draft.variable,
        ...(accountId ? {} : { pendingIncome: income }),
      };
    });
  };

  return (
    <OnbFrame
      step="income"
      title={t('onb.income.title')}
      onSkip={() => void advance('skip')}
      primary={
        <Button
          fullWidth
          disabled={invalid || busy}
          {...(invalid ? { disabledReason: t('onb.income.invalid') } : {})}
          onClick={() => void save()}
          data-testid="onb-continue"
        >
          {t('common.continue')}
        </Button>
      }
    >
      <AmountInput
        size="compact"
        label={t('onb.income.fixed')}
        value={draft.amountCents}
        onChange={(amountCents) => setDraft({ ...draft, amountCents })}
        keypad="native"
        data-testid="onb-income-amount"
      />
      <Select
        label={t('onb.income.day')}
        value={draft.day}
        onChange={(day) => setDraft({ ...draft, day })}
        options={DAYS.map((d) => ({ value: d, label: d }))}
        data-testid="onb-income-day"
      />
      <Select
        label={t('onb.income.account')}
        value={accountId}
        onChange={(value) => setDraft({ ...draft, accountId: value })}
        options={options}
        data-testid="onb-income-account"
      />
      <Switch
        label={t('onb.income.variable')}
        description={t('onb.income.variableHint')}
        checked={draft.variable}
        onChange={(variable) => setDraft({ ...draft, variable })}
        data-testid="onb-income-variable"
      />
    </OnbFrame>
  );
}
