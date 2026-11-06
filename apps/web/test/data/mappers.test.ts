import { describe, expect, it } from 'vitest';
import {
  accountFromRow,
  accountToRow,
  cardFromRow,
  cardToRow,
  categoryFromRow,
  categoryToRow,
  MapperError,
  parseRow,
  toServerRow,
  txFromRow,
  txToRow,
} from '../../src/data/mappers';
import { makeRow, tx } from './rows';

describe('mappers: Row (snake_case) ↔ domínio (camelCase)', () => {
  it('transação: ida e volta preserva todas as colunas, inclusive as que o domínio não usa', () => {
    const row = tx('t1', {
      card_id: 'c1',
      invoice_id: 'i1',
      installment_number: 2,
      installment_count: 3,
      payment_method: 'credit',
      notes: 'nota local',
      tags: ['casa'],
      _pending: 1,
    });
    const domain = txFromRow(row);
    expect(domain).toMatchObject({
      id: 't1',
      kind: 'expense',
      amountCents: 1000,
      occurredOn: '2026-11-05',
      paymentMethod: 'credit',
      cardId: 'c1',
      invoiceId: 'i1',
      installmentNumber: 2,
      installmentCount: 3,
      reviewState: 'ok',
      deletedAt: null,
    });
    expect(txToRow(domain, row)).toEqual(row);
    const edited = txToRow({ ...domain, amountCents: 2550, categoryId: 'cat' }, row);
    expect(edited.amount_cents).toBe(2550);
    expect(edited.category_id).toBe('cat');
    expect(edited.notes).toBe('nota local');
  });

  it('valor fora dos check do banco é erro, não silêncio', () => {
    expect(() => txFromRow(tx('t1', { kind: 'gift' }))).toThrow(MapperError);
    expect(() => txFromRow(tx('t1', { review_state: 'talvez' }))).toThrow(/review_state/);
  });

  it('cartão, conta e categoria: ida e volta', () => {
    const card = makeRow('cards', {
      id: 'c1',
      closing_day: 3,
      due_day: 10,
      closing_day_rule: 'same',
      limit_cents: 500000,
    });
    expect(cardFromRow(card)).toEqual({
      id: 'c1',
      closingDay: 3,
      dueDay: 10,
      closingDayRule: 'same',
      limitCents: 500000,
      paymentAccountId: null,
    });
    expect(cardToRow(cardFromRow(card), card)).toEqual(card);
    expect(() => cardFromRow({ ...card, closing_day_rule: 'antes' })).toThrow(MapperError);

    const account = makeRow('accounts', {
      id: 'a1',
      type: 'checking',
      is_restricted: true,
      initial_balance_cents: -1500,
    });
    expect(accountFromRow(account)).toMatchObject({
      isRestricted: true,
      initialBalanceCents: -1500,
    });
    expect(accountToRow(accountFromRow(account), account)).toEqual(account);

    const category = makeRow('categories', {
      id: 'k1',
      kind: 'expense',
      bucket: 'savings',
      feeds_reserve: true,
      slug: 'reserva',
    });
    expect(categoryFromRow(category)).toMatchObject({ bucket: 'savings', feedsReserve: true });
    expect(categoryToRow(categoryFromRow(category), category)).toEqual(category);
    expect(() => categoryFromRow({ ...category, bucket: 'luxo' })).toThrow(MapperError);
  });

  it('parseRow valida a linha do servidor e descarta campos locais e colunas desconhecidas', () => {
    const row = tx('t1');
    const parsed = parseRow('transactions', { ...row, _pending: 1, coluna_nova: 'x' });
    expect(parsed).toEqual(row);
    expect(() => parseRow('transactions', { ...row, amount_cents: 10.5 })).toThrow(
      /transactions: amount_cents/,
    );
    expect(() => parseRow('cards', { id: 'c1' })).toThrow(MapperError);
  });

  it('toServerRow tira os campos locais (_…)', () => {
    const row = tx('t1', { _pending: 1 });
    const server = toServerRow(row);
    expect(server).not.toHaveProperty('_pending');
    expect(server.amount_cents).toBe(1000);
  });
});
