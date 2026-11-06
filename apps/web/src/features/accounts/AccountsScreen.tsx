import { todayIn } from '@oakfinance/domain';
import { Archive, ArrowCounterClockwise, Bank, Plus, Trash } from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import {
  ACCOUNT_TYPES,
  type AccountType,
  accountMethods,
  archiveAccount,
  createAccount,
  deleteAccount,
  isActive,
  type NameProblem,
  unarchiveAccount,
} from '../../data/repositories/accounts';
import { type MessageKey, t } from '../../i18n/pt-BR';
import { AmountInput, Button, EmptyState, GlassCard, Select, TextField } from '../../ui';

const TYPE_LABEL: Record<AccountType, MessageKey> = {
  checking: 'accounts.type.checking',
  cash: 'accounts.type.cash',
  meal_voucher: 'accounts.type.meal',
  food_voucher: 'accounts.type.food',
};

const METHOD_LABEL: Record<string, MessageKey> = {
  pix: 'accounts.method.pix',
  debit: 'accounts.method.debit',
  boleto: 'accounts.method.boleto',
  transfer: 'accounts.method.transfer',
  other: 'accounts.method.other',
  cash: 'accounts.method.cash',
};

const NAME_ERROR: Record<NameProblem, MessageKey> = {
  required: 'accounts.nameRequired',
  tooLong: 'accounts.nameTooLong',
  duplicate: 'accounts.duplicate',
};

/** "Formas: Pix, Débito…" ou, no benefício, "Meio imediato, sem formas" (US-09). */
export function methodsLabel(type: string): string {
  const methods = accountMethods(type);
  if (methods.length === 0) {
    return t('accounts.immediate');
  }
  return t('accounts.methods', {
    formas: methods.map((m) => t(METHOD_LABEL[m] ?? 'accounts.method.other')).join(', '),
  });
}

function typeLabel(type: string): string {
  return type in TYPE_LABEL ? t(TYPE_LABEL[type as AccountType]) : type;
}

function AccountRow({
  account,
  onArchive,
  onUnarchive,
  onDelete,
  error,
}: {
  account: LocalRow<'accounts'>;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  error: string | null;
}) {
  const archived = account.archived_at !== null;
  return (
    <li className="account-row" data-testid={`account-${account.id}`}>
      <div>
        <p className="account-name">{account.name}</p>
        <p className="account-meta">
          {typeLabel(account.type)}
          {account.institution ? ` · ${account.institution}` : ''}
        </p>
        <p className="account-meta">{methodsLabel(account.type)}</p>
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
      </div>
      <div className="account-actions">
        {archived ? (
          <Button variant="ghost" size="sm" iconStart={ArrowCounterClockwise} onClick={onUnarchive}>
            {t('accounts.unarchive')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" iconStart={Archive} onClick={onArchive}>
              {t('accounts.archive')}
            </Button>
            <Button variant="ghost" size="sm" iconStart={Trash} onClick={onDelete}>
              {t('accounts.delete')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** S03 — contas (RN-07, US-09): criar, arquivar, desarquivar e excluir (só sem lançamentos). */
export function AccountsScreen() {
  const { user } = useAuth();
  const accounts = useLive(
    user
      ? () => user.db.accounts.filter((row) => row.deleted_at === null).sortBy('sort_order')
      : null,
    [user],
  );
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [institution, setInstitution] = useState('');
  const [balance, setBalance] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  if (!user) {
    return null;
  }

  const after = (ok: boolean) => {
    if (ok) {
      user.engine.notifyWrite();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await createAccount(user.db, user.userId, {
      name,
      type,
      institution,
      initialBalanceCents: balance,
      initialBalanceOn: todayIn('America/Sao_Paulo', new Date()),
    });
    if (!result.ok) {
      setNameError(
        result.error.code === 'ACCOUNT_NAME' && 'problem' in result.error
          ? t(NAME_ERROR[result.error.problem as NameProblem])
          : null,
      );
      return;
    }
    setNameError(null);
    setName('');
    setInstitution('');
    setBalance(0);
    after(true);
  };

  const act = async (id: string, run: () => ReturnType<typeof archiveAccount>) => {
    const result = await run();
    if (result.ok) {
      setRowError(null);
      after(true);
      return;
    }
    const message =
      result.error.code === 'ACCOUNT_HAS_TRANSACTIONS'
        ? t('accounts.hasTransactions')
        : result.error.code === 'ACCOUNT_NAME' && 'problem' in result.error
          ? t(NAME_ERROR[result.error.problem as NameProblem])
          : null;
    setRowError(message ? { id, message } : null);
  };

  const active = (accounts ?? []).filter(isActive);
  const archived = (accounts ?? []).filter((row) => row.archived_at !== null);
  const row = (account: LocalRow<'accounts'>) => (
    <AccountRow
      key={account.id}
      account={account}
      error={rowError?.id === account.id ? rowError.message : null}
      onArchive={() => void act(account.id, () => archiveAccount(user.db, account.id))}
      onUnarchive={() => void act(account.id, () => unarchiveAccount(user.db, account.id))}
      onDelete={() => void act(account.id, () => deleteAccount(user.db, account.id))}
    />
  );

  return (
    <section className="screen" data-screen="S03" data-testid="screen-S03">
      <GlassCard level={2}>
        {active.length === 0 ? (
          <EmptyState
            icon={Bank}
            title={t('accounts.empty')}
            description={t('onb.accounts.title')}
          />
        ) : (
          <ul className="account-list">{active.map(row)}</ul>
        )}
      </GlassCard>
      <GlassCard level={2}>
        <form className="account-form" onSubmit={(event) => void submit(event)}>
          <TextField
            label={t('accounts.name')}
            value={name}
            onChange={setName}
            {...(nameError ? { error: nameError } : {})}
          />
          <Select
            label={t('accounts.type')}
            value={type}
            onChange={(value) => setType(value as AccountType)}
            options={ACCOUNT_TYPES.map((value) => ({ value, label: t(TYPE_LABEL[value]) }))}
          />
          <TextField
            label={t('accounts.institution')}
            value={institution}
            onChange={setInstitution}
          />
          <AmountInput
            size="compact"
            label={t('accounts.balance')}
            value={balance}
            onChange={setBalance}
          />
          <Button type="submit" iconStart={Plus} fullWidth>
            {t('accounts.add')}
          </Button>
        </form>
      </GlassCard>
      {archived.length > 0 && (
        <details className="account-archived">
          <summary>{t('accounts.archived')}</summary>
          <ul className="account-list">{archived.map(row)}</ul>
        </details>
      )}
    </section>
  );
}
