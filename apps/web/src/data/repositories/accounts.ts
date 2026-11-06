// Contas (RN-07, US-09): corrente, carteira e benefício (VR/VA). Nome obrigatório, até 40 caracteres e único entre
// as contas ativas (sem diferenciar maiúsculas). Conta com lançamentos não é excluída: é arquivada.
import type { PaymentMethod } from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../db';
import { newId } from '../ids';
import { err, type Result } from '../result';
import { deleteRow, saveRow } from './rows';

export const ACCOUNT_TYPES = ['checking', 'cash', 'meal_voucher', 'food_voucher'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const NAME_MAX = 40;

/** Formas de pagamento que a conta oferece no lançamento (US-09). Benefício é meio imediato, sem formas. */
export function accountMethods(type: string): PaymentMethod[] {
  if (type === 'checking' || type === 'savings') {
    return ['pix', 'debit', 'boleto', 'transfer', 'other'];
  }
  if (type === 'cash') {
    return ['cash'];
  }
  return [];
}

export function isBenefit(type: string): boolean {
  return type === 'meal_voucher' || type === 'food_voucher';
}

export type NameProblem = 'required' | 'tooLong' | 'duplicate';

export function isActive(row: Pick<LocalRow<'accounts'>, 'deleted_at' | 'archived_at'>): boolean {
  return row.deleted_at === null && row.archived_at === null;
}

function folded(name: string): string {
  return name.trim().toLocaleLowerCase('pt-BR');
}

/** RN-07: nome obrigatório, até 40 caracteres, único entre as ativas (a própria conta não conta). */
export function nameProblem(
  name: string,
  accounts: readonly LocalRow<'accounts'>[],
  selfId?: string,
): NameProblem | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'required';
  }
  if (trimmed.length > NAME_MAX) {
    return 'tooLong';
  }
  const clash = accounts.some(
    (row) => row.id !== selfId && isActive(row) && folded(row.name) === folded(trimmed),
  );
  return clash ? 'duplicate' : null;
}

export interface AccountInput {
  name: string;
  type: AccountType;
  institution?: string | null;
  initialBalanceCents?: number;
  initialBalanceOn: string;
}

export type AccountError =
  | { code: 'ACCOUNT_NAME'; problem: NameProblem; message: string }
  | { code: 'ACCOUNT_HAS_TRANSACTIONS'; message: string }
  | { code: 'ACCOUNT_NOT_FOUND'; message: string };

type AccountResult = Result<
  LocalRow<'accounts'> | null,
  AccountError | { code: string; message: string }
>;

async function allAccounts(db: OakDb) {
  return db.accounts.toArray();
}

/** Cria a conta (VR/VA com saldo carimbado: `is_restricted`). */
export async function createAccount(
  db: OakDb,
  userId: string,
  input: AccountInput,
  { nowMs = Date.now(), id = newId() }: { nowMs?: number; id?: string } = {},
): Promise<AccountResult> {
  const problem = nameProblem(input.name, await allAccounts(db));
  if (problem) {
    return err({ code: 'ACCOUNT_NAME', problem, message: problem });
  }
  const iso = new Date(nowMs).toISOString();
  const count = await db.accounts.count();
  const row: LocalRow<'accounts'> = {
    id,
    user_id: userId,
    name: input.name.trim(),
    type: input.type,
    institution: input.institution?.trim() || null,
    initial_balance_cents: input.initialBalanceCents ?? 0,
    initial_balance_on: input.initialBalanceOn,
    is_restricted: isBenefit(input.type),
    include_in_spendable: true,
    color: null,
    icon: null,
    sort_order: count,
    archived_at: null,
    created_at: iso,
    updated_at: iso,
    client_updated_at: iso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  };
  return saveRow(db, 'accounts', row, { nowMs });
}

/** Renomeia ou muda o banco (o tipo não muda: os lançamentos já usam as formas dele). */
export async function updateAccount(
  db: OakDb,
  id: string,
  patch: { name?: string; institution?: string | null },
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<AccountResult> {
  const current = await db.accounts.get(id);
  if (!current || current.deleted_at !== null) {
    return err({ code: 'ACCOUNT_NOT_FOUND', message: id });
  }
  const name = patch.name ?? current.name;
  const problem = nameProblem(name, await allAccounts(db), id);
  if (problem) {
    return err({ code: 'ACCOUNT_NAME', problem, message: problem });
  }
  return saveRow(
    db,
    'accounts',
    {
      ...current,
      name: name.trim(),
      institution: patch.institution === undefined ? current.institution : patch.institution,
    },
    { nowMs },
  );
}

/** Lançamentos vivos que usam a conta (origem ou destino). */
export async function accountUsage(db: OakDb, id: string): Promise<number> {
  const own = await db.transactions
    .where('account_id')
    .equals(id)
    .filter((t) => t.deleted_at === null)
    .count();
  const counterpart = await db.transactions
    .filter((t) => t.deleted_at === null && t.counterpart_account_id === id)
    .count();
  return own + counterpart;
}

/** Arquivar: some do seletor e do lançamento rápido, mantém histórico e totais (RN-07). */
export async function archiveAccount(
  db: OakDb,
  id: string,
  { nowMs = Date.now() } = {},
): Promise<AccountResult> {
  const current = await db.accounts.get(id);
  if (!current || current.deleted_at !== null) {
    return err({ code: 'ACCOUNT_NOT_FOUND', message: id });
  }
  return saveRow(
    db,
    'accounts',
    { ...current, archived_at: new Date(nowMs).toISOString() },
    { nowMs },
  );
}

/** Desarquivar volta a conta para o seletor, se o nome não colidir com uma ativa. */
export async function unarchiveAccount(
  db: OakDb,
  id: string,
  { nowMs = Date.now() } = {},
): Promise<AccountResult> {
  const current = await db.accounts.get(id);
  if (!current || current.deleted_at !== null) {
    return err({ code: 'ACCOUNT_NOT_FOUND', message: id });
  }
  const problem = nameProblem(current.name, await allAccounts(db), id);
  if (problem) {
    return err({ code: 'ACCOUNT_NAME', problem, message: problem });
  }
  return saveRow(db, 'accounts', { ...current, archived_at: null }, { nowMs });
}

/** Excluir só sem lançamentos (RN-07); com lançamentos, `ACCOUNT_HAS_TRANSACTIONS` (a tela oferece arquivar). */
export async function deleteAccount(
  db: OakDb,
  id: string,
  { nowMs = Date.now() } = {},
): Promise<AccountResult> {
  if ((await accountUsage(db, id)) > 0) {
    return err({ code: 'ACCOUNT_HAS_TRANSACTIONS', message: id });
  }
  return deleteRow(db, 'accounts', id, { nowMs });
}
