// ON06 — Contas e meios (UX §3 ON06, US-08, RN-07): atalhos Banco do Brasil, Nubank, Carteira, VR, VA e Outra conta
// (checkbox); cada atalho marcado vira uma linha com nome e saldo atual opcional. "Pix e débito saem de qual conta?"
// escolhe a conta corrente que fica como meio padrão do lançamento rápido (e recebe a renda informada no ON05).
import type { ISODate } from '@oakfinance/domain';
import { type AccountType, createAccount } from '../../data/repositories/accounts';
import { writeLocal } from '../../data/storage';
import { type MessageKey, t } from '../../i18n/pt-BR';
import { useToday } from '../../lib/useToday';
import { AmountInput, Button, Select, TextField } from '../../ui';
import { createOnboardingIncome } from './IncomeStep';
import { OnbFrame, useOnbStep, useStepDraft } from './OnbFrame';
import { readOnboarding } from './progress';

/** Mesma chave do lançamento rápido (`QuickEntrySheet`): o último meio usado vira o padrão. */
const LAST_METHOD_KEY = 'quick.lastMethod';

export const ACCOUNT_SHORTCUTS = [
  { id: 'bb', label: 'onb.accounts.bb', type: 'checking', name: 'Banco do Brasil' },
  { id: 'nubank', label: 'onb.accounts.nubank', type: 'checking', name: 'Nubank' },
  { id: 'cash', label: 'accounts.type.cash', type: 'cash', name: 'Carteira' },
  { id: 'vr', label: 'accounts.type.meal', type: 'meal_voucher', name: 'VR' },
  { id: 'va', label: 'accounts.type.food', type: 'food_voucher', name: 'VA' },
  { id: 'other', label: 'onb.accounts.other', type: 'checking', name: '' },
] as const satisfies ReadonlyArray<{
  id: string;
  label: MessageKey;
  type: AccountType;
  name: string;
}>;

export type ShortcutId = (typeof ACCOUNT_SHORTCUTS)[number]['id'];

export interface AccountLine {
  shortcut: ShortcutId;
  name: string;
  balanceCents: number;
}

export interface AccountsDraft {
  lines: AccountLine[];
  /** Atalho da conta do Pix e débito. */
  pixFrom: ShortcutId | '';
}

const shortcutOf = (id: ShortcutId) =>
  ACCOUNT_SHORTCUTS.find((s) => s.id === id) ?? ACCOUNT_SHORTCUTS[5];

/** Liga ou desliga um atalho (a ordem das linhas segue a dos atalhos). */
export function toggleShortcut(draft: AccountsDraft, id: ShortcutId): AccountsDraft {
  const has = draft.lines.some((l) => l.shortcut === id);
  const lines = has
    ? draft.lines.filter((l) => l.shortcut !== id)
    : ACCOUNT_SHORTCUTS.flatMap((s) => {
        const existing = draft.lines.find((l) => l.shortcut === s.id);
        if (existing) {
          return [existing];
        }
        return s.id === id ? [{ shortcut: id, name: s.name, balanceCents: 0 }] : [];
      });
  const checking = lines.filter((l) => shortcutOf(l.shortcut).type === 'checking');
  const pixFrom = checking.some((l) => l.shortcut === draft.pixFrom)
    ? draft.pixFrom
    : (checking[0]?.shortcut ?? '');
  return { lines, pixFrom };
}

export function AccountsStep({ today: fixedToday }: { today?: ISODate }) {
  const today = useToday(fixedToday);
  const { user, busy, advance } = useOnbStep('accounts');
  const [draft, setDraft] = useStepDraft<AccountsDraft>('accounts', { lines: [], pixFrom: '' });
  const checking = draft.lines.filter((l) => shortcutOf(l.shortcut).type === 'checking');
  const none = draft.lines.length === 0;
  const unnamed = draft.lines.some((l) => l.name.trim() === '');

  const save = async () => {
    if (!user || none || unnamed) {
      return;
    }
    const created = new Map<ShortcutId, string>();
    for (const line of draft.lines) {
      const s = shortcutOf(line.shortcut);
      const result = await createAccount(user.db, user.userId, {
        name: line.name,
        type: s.type,
        institution: s.type === 'checking' && s.id !== 'other' ? s.name : null,
        initialBalanceCents: line.balanceCents,
        initialBalanceOn: today,
      });
      if (result.ok && result.value) {
        created.set(line.shortcut, result.value.id);
      }
    }
    const pixAccount = draft.pixFrom ? created.get(draft.pixFrom) : undefined;
    const incomeAccount = pixAccount ?? [...created.values()][0];
    if (pixAccount) {
      await writeLocal(() => user.db.kv.put({ key: LAST_METHOD_KEY, value: `pix:${pixAccount}` }));
    }
    // a renda do ON05 sem conta vai para a conta do Pix (ou a primeira criada)
    const profile = await user.db.profiles.toCollection().first();
    const pending = readOnboarding(profile?.onboarding).pendingIncome;
    const linked =
      pending !== undefined &&
      incomeAccount !== undefined &&
      (await createOnboardingIncome(
        user.db,
        user.userId,
        { ...pending, accountId: incomeAccount },
        today,
      ));
    await advance('done', (s) => {
      if (!linked) {
        return s;
      }
      const { pendingIncome: _done, ...rest } = s;
      return rest;
    });
  };

  return (
    <OnbFrame
      step="accounts"
      title={t('onb.accounts.title')}
      onSkip={() => void advance('skip')}
      primary={
        <Button
          fullWidth
          disabled={none || unnamed || busy}
          {...(none ? { disabledReason: t('onb.accounts.none') } : {})}
          onClick={() => void save()}
          data-testid="onb-continue"
        >
          {t('common.continue')}
        </Button>
      }
    >
      <fieldset className="onb-group">
        <legend className="sr-only">{t('onb.accounts.title')}</legend>
        <div className="onb-chips">
          {ACCOUNT_SHORTCUTS.map((s) => {
            const checked = draft.lines.some((l) => l.shortcut === s.id);
            return (
              <label key={s.id} className="chip onb-chip" data-selected={checked}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => setDraft(toggleShortcut(draft, s.id))}
                  data-testid={`onb-account-${s.id}`}
                />
                {t(s.label)}
              </label>
            );
          })}
        </div>
      </fieldset>
      {draft.lines.map((line, i) => (
        <fieldset
          key={line.shortcut}
          className="onb-line"
          data-testid={`onb-line-${line.shortcut}`}
        >
          <legend className="sr-only">{t(shortcutOf(line.shortcut).label)}</legend>
          <TextField
            label={t('accounts.name')}
            value={line.name}
            onChange={(name) =>
              setDraft({
                ...draft,
                lines: draft.lines.map((l, j) => (j === i ? { ...l, name } : l)),
              })
            }
            data-testid={`onb-line-${line.shortcut}-name`}
          />
          <AmountInput
            size="compact"
            label={t('onb.accounts.balance')}
            value={line.balanceCents}
            onChange={(balanceCents) =>
              setDraft({
                ...draft,
                lines: draft.lines.map((l, j) => (j === i ? { ...l, balanceCents } : l)),
              })
            }
            keypad="native"
            data-testid={`onb-line-${line.shortcut}-balance`}
          />
        </fieldset>
      ))}
      {checking.length > 1 && (
        <Select
          label={t('onb.accounts.pixFrom')}
          value={draft.pixFrom}
          onChange={(value) => setDraft({ ...draft, pixFrom: value as ShortcutId })}
          options={checking.map((l) => ({
            value: l.shortcut,
            label: l.name || t('onb.accounts.other'),
          }))}
          data-testid="onb-accounts-pix"
        />
      )}
    </OnbFrame>
  );
}
