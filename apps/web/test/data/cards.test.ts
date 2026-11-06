import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { OakDb } from '../../src/data/db';
import {
  archiveCard,
  cardNameProblem,
  cardUsage,
  createCard,
  draftCard,
  parseDay,
  previewInvoice,
  removeCard,
  toCard,
} from '../../src/data/repositories/cards';
import { makeRow, tx } from './rows';

const USER = '0c000000-0000-4000-8000-000000000001';
const opened: OakDb[] = [];
function open() {
  const db = new OakDb(`cards-${opened.length}`);
  opened.push(db);
  return db;
}
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

describe('cartões (US-10, RN-09..RN-12)', () => {
  it('US-10: "Nubank" fecha 3 e vence 10 — em 05/11/2026 a compra vai para a fatura de dez/2026, vence 10/12/2026', async () => {
    const db = open();
    const result = await createCard(
      db,
      USER,
      { name: 'Nubank', closingDay: 3, dueDay: 10 },
      { id: 'nu' },
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        closing_day: 3,
        due_day: 10,
        closing_day_rule: 'next',
        limit_cents: null,
        _pending: 1,
      },
    });
    const row = await db.cards.get('nu');
    if (!row) {
      throw new Error('cartão não gravado');
    }
    const card = toCard(row);
    expect(previewInvoice(card, '2026-11-05')).toMatchObject({
      referenceMonth: '2026-12',
      dueDate: '2026-12-10',
    });
  });

  it('RN-09: a regra padrão manda a compra do dia do fechamento para a próxima fatura; trocando, fica na que fecha', () => {
    const next = draftCard({ closingDay: 3, dueDay: 10 });
    const same = draftCard({ closingDay: 3, dueDay: 10, closingDayToNext: false });
    expect(next.closingDayRule).toBe('next');
    expect(previewInvoice(next, '2026-11-03').referenceMonth).toBe('2026-12');
    expect(previewInvoice(same, '2026-11-03').referenceMonth).toBe('2026-11');
  });

  it('US-10: dias 0 ou 32 são inválidos e não salvam', async () => {
    expect(parseDay('0')).toBeNull();
    expect(parseDay('32')).toBeNull();
    expect(parseDay('3,5')).toBeNull();
    expect(parseDay(' 31 ')).toBe(31);
    expect(parseDay('1')).toBe(1);
    const db = open();
    expect(await createCard(db, USER, { name: 'X', closingDay: 0, dueDay: 10 })).toMatchObject({
      ok: false,
      error: { code: 'CARD_DAY', field: 'closing', message: 'Escolha um dia entre 1 e 31.' },
    });
    expect(await createCard(db, USER, { name: 'X', closingDay: 3, dueDay: 32 })).toMatchObject({
      ok: false,
      error: { field: 'due' },
    });
    expect(await db.cards.count()).toBe(0);
  });

  it('limite, conta que paga e nome único entre os ativos', async () => {
    const db = open();
    expect(
      await createCard(db, USER, {
        name: 'Ourocard',
        closingDay: 28,
        dueDay: 5,
        limitCents: 500_000,
        paymentAccountId: 'bb',
      }),
    ).toMatchObject({ ok: true, value: { limit_cents: 500_000, payment_account_id: 'bb' } });
    expect(
      await createCard(db, USER, { name: 'ourocard', closingDay: 1, dueDay: 8 }),
    ).toMatchObject({
      ok: false,
      error: { code: 'CARD_NAME', problem: 'duplicate' },
    });
    expect(cardNameProblem('', [])).toBe('required');
    expect(cardNameProblem('x'.repeat(41), [])).toBe('tooLong');
  });

  it('RN-07: cartão com lançamentos só arquiva; sem lançamentos, exclui com as faturas', async () => {
    const db = open();
    await createCard(db, USER, { name: 'Nubank', closingDay: 3, dueDay: 10 }, { id: 'nu' });
    await db.invoices.put(makeRow('invoices', { id: 'i1', card_id: 'nu' }));
    await db.transactions.put(tx('t1', { card_id: 'nu' }));
    expect(await cardUsage(db, 'nu')).toBe(1);
    expect(await removeCard(db, 'nu')).toMatchObject({
      ok: false,
      error: { code: 'CARD_HAS_TRANSACTIONS' },
    });
    expect((await archiveCard(db, 'nu')).ok).toBe(true);
    expect(await archiveCard(db, 'x')).toMatchObject({
      ok: false,
      error: { code: 'CARD_NOT_FOUND' },
    });
    await db.transactions.update('t1', { deleted_at: '2026-11-05T00:00:00.000Z' });
    expect(await removeCard(db, 'nu')).toEqual({ ok: true, value: 2 });
    expect((await db.invoices.get('i1'))?.deleted_at).not.toBeNull();
  });
});
