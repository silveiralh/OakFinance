import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { OakDb } from '../../src/data/db';
import {
  accountMethods,
  accountUsage,
  archiveAccount,
  createAccount,
  deleteAccount,
  nameProblem,
  unarchiveAccount,
  updateAccount,
} from '../../src/data/repositories/accounts';
import { tx } from './rows';

const USER = '0a000000-0000-4000-8000-000000000001';
const opened: OakDb[] = [];
function open() {
  const db = new OakDb(`accounts-${opened.length}`);
  opened.push(db);
  return db;
}
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

const input = (
  name: string,
  type: 'checking' | 'cash' | 'meal_voucher' | 'food_voucher' = 'checking',
) => ({
  name,
  type,
  initialBalanceOn: '2026-11-06',
});

describe('contas (RN-07, US-09)', () => {
  it('US-09: conta corrente "BB" do Banco do Brasil oferece Pix, Débito, Boleto, TED/DOC e Outro', async () => {
    const db = open();
    const result = await createAccount(db, USER, {
      ...input('BB'),
      institution: 'Banco do Brasil',
      initialBalanceCents: 152_000,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        name: 'BB',
        type: 'checking',
        institution: 'Banco do Brasil',
        is_restricted: false,
        initial_balance_cents: 152_000,
        _pending: 1,
      },
    });
    expect(accountMethods('checking')).toEqual(['pix', 'debit', 'boleto', 'transfer', 'other']);
    expect(await db.outbox.count()).toBe(1);
  });

  it('US-09: nome repetido entre as ativas, sem diferenciar maiúsculas, é recusado', async () => {
    const db = open();
    await createAccount(db, USER, input('Nubank'));
    expect(await createAccount(db, USER, input('nubank'))).toMatchObject({
      ok: false,
      error: { code: 'ACCOUNT_NAME', problem: 'duplicate' },
    });
    expect(await createAccount(db, USER, input('  NUBANK '))).toMatchObject({ ok: false });
    expect(await db.accounts.count()).toBe(1);
  });

  it('US-09: VR é benefício — meio imediato sem formas, saldo carimbado', async () => {
    const db = open();
    const result = await createAccount(db, USER, input('VR', 'meal_voucher'));
    expect(result).toMatchObject({
      ok: true,
      value: { type: 'meal_voucher', is_restricted: true },
    });
    expect(accountMethods('meal_voucher')).toEqual([]);
    expect(accountMethods('food_voucher')).toEqual([]);
    expect(accountMethods('cash')).toEqual(['cash']);
  });

  it('RN-07: nome obrigatório e até 40 caracteres', () => {
    expect(nameProblem('  ', [])).toBe('required');
    expect(nameProblem('x'.repeat(41), [])).toBe('tooLong');
    expect(nameProblem('x'.repeat(40), [])).toBeNull();
  });

  it('RN-07: arquivada sai da regra de nome único; desarquivar recusa se o nome voltar a colidir', async () => {
    const db = open();
    const first = await createAccount(db, USER, input('Carteira', 'cash'), { id: 'a1' });
    expect(first.ok).toBe(true);
    expect((await archiveAccount(db, 'a1')).ok).toBe(true);
    expect((await createAccount(db, USER, input('carteira', 'cash'), { id: 'a2' })).ok).toBe(true);
    expect(await unarchiveAccount(db, 'a1')).toMatchObject({
      ok: false,
      error: { problem: 'duplicate' },
    });
    expect((await archiveAccount(db, 'a2')).ok).toBe(true);
    expect(await unarchiveAccount(db, 'a1')).toMatchObject({
      ok: true,
      value: { archived_at: null },
    });
  });

  it('RN-07: conta com lançamentos não é excluída (só arquivada); sem lançamentos, exclusão lógica', async () => {
    const db = open();
    await createAccount(db, USER, input('BB'), { id: 'bb' });
    await createAccount(db, USER, input('Nubank'), { id: 'nu' });
    await db.transactions.bulkPut([
      tx('t1', { account_id: 'bb' }),
      tx('t2', { counterpart_account_id: 'nu', kind: 'transfer' }),
      tx('t3', { account_id: 'nu', deleted_at: '2026-11-01T00:00:00.000Z' }),
    ]);
    expect(await accountUsage(db, 'bb')).toBe(1);
    expect(await accountUsage(db, 'nu')).toBe(1);
    expect(await deleteAccount(db, 'bb')).toMatchObject({
      ok: false,
      error: { code: 'ACCOUNT_HAS_TRANSACTIONS' },
    });
    await db.transactions.update('t2', { deleted_at: '2026-11-02T00:00:00.000Z' });
    const removed = await deleteAccount(db, 'nu');
    expect(removed.ok && removed.value?.deleted_at).toBeTruthy();
  });

  it('editar: renomear respeita o nome único; conta inexistente', async () => {
    const db = open();
    await createAccount(db, USER, input('BB'), { id: 'bb' });
    await createAccount(db, USER, input('Nubank'), { id: 'nu' });
    expect(await updateAccount(db, 'bb', { name: 'NUBANK' })).toMatchObject({ ok: false });
    expect(
      await updateAccount(db, 'bb', { name: 'BB Corrente', institution: 'Banco do Brasil' }),
    ).toMatchObject({
      ok: true,
      value: { name: 'BB Corrente', institution: 'Banco do Brasil' },
    });
    expect(await updateAccount(db, 'bb', {})).toMatchObject({
      ok: true,
      value: { name: 'BB Corrente' },
    });
    for (const run of [
      updateAccount(db, 'x', {}),
      archiveAccount(db, 'x'),
      unarchiveAccount(db, 'x'),
    ]) {
      expect(await run).toMatchObject({ ok: false, error: { code: 'ACCOUNT_NOT_FOUND' } });
    }
  });
});
