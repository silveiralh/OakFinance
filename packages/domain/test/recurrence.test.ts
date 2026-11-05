import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.ts';
import { invoiceId, recurrenceTxId } from '../src/ids.ts';
import {
  dueAutoPosts,
  materializeOccurrence,
  occurrences,
  projectionEnd,
  projectRecurrences,
  type Recurrence,
} from '../src/recurrence.ts';
import type { Card, Tx } from '../src/types.ts';

const cardA: Card = {
  id: 'cartao-a',
  closingDay: 3,
  dueDay: 10,
  closingDayRule: 'next',
  limitCents: null,
  paymentAccountId: null,
};

function rec(over: Partial<Recurrence> = {}): Recurrence {
  return {
    id: 'rec-aluguel',
    kind: 'expense',
    description: 'Aluguel',
    amountCents: 150000,
    isVariableAmount: false,
    categoryId: 'moradia',
    accountId: 'conta',
    cardId: null,
    paymentMethod: 'pix',
    isFixedIncome: false,
    autoPost: false,
    remind: true,
    pausedAt: null,
    deletedAt: null,
    frequency: 'monthly',
    intervalCount: 1,
    dayOfMonth: 5,
    startOn: '2026-11-05',
    ...over,
  };
}

function realized(r: Recurrence, date: string, over: Partial<Tx> = {}): Tx {
  return { ...materializeOccurrence(r, date, null), deletedAt: null, ...over };
}

describe('occurrences (RN-26, RN-03)', () => {
  it('RN-03: mensal dia 31 a partir de 31/01/2027 → 31/01, 28/02, 31/03, 30/04', () => {
    expect(
      occurrences(rec({ dayOfMonth: 31, startOn: '2027-01-31' }), {
        from: '2027-01-01',
        to: '2027-04-30',
      }),
    ).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });

  it('semanal às quintas, a cada 2 semanas', () => {
    expect(
      occurrences(
        rec({ frequency: 'weekly', weekday: 4, intervalCount: 2, startOn: '2026-11-02' }),
        {
          from: '2026-11-01',
          to: '2026-12-31',
        },
      ),
    ).toEqual(['2026-11-05', '2026-11-19', '2026-12-03', '2026-12-17', '2026-12-31']);
  });

  it('anual em 29/02 → 28/02 nos anos não bissextos', () => {
    expect(
      occurrences(
        rec({ frequency: 'yearly', monthOfYear: 2, dayOfMonth: 29, startOn: '2028-02-29' }),
        {
          from: '2028-01-01',
          to: '2032-12-31',
        },
      ),
    ).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  it('maxOccurrences: 3 encerra depois da 3ª, contando desde o início', () => {
    const rule = rec({ maxOccurrences: 3 });
    expect(occurrences(rule, { from: '2026-01-01', to: '2027-12-31' })).toEqual([
      '2026-11-05',
      '2026-12-05',
      '2027-01-05',
    ]);
    expect(occurrences(rule, { from: '2027-01-01', to: '2027-12-31' })).toEqual(['2027-01-05']);
  });

  it('respeita início (dia já passado no mês), fim e intervalo', () => {
    expect(
      occurrences(rec({ startOn: '2026-11-10' }), { from: '2026-11-01', to: '2027-01-31' }),
    ).toEqual(['2026-12-05', '2027-01-05']);
    expect(
      occurrences(rec({ endOn: '2026-12-31' }), { from: '2026-11-01', to: '2027-03-31' }),
    ).toEqual(['2026-11-05', '2026-12-05']);
    expect(
      occurrences(rec({ intervalCount: 3 }), { from: '2026-11-01', to: '2027-12-31' }),
    ).toEqual(['2026-11-05', '2027-02-05', '2027-05-05', '2027-08-05', '2027-11-05']);
  });

  it('regra incompleta é recusada', () => {
    const range = { from: '2026-11-01', to: '2026-12-31' };
    expect(() => occurrences(rec({ dayOfMonth: undefined as never }), range)).toThrowError(
      DomainError,
    );
    expect(() => occurrences(rec({ frequency: 'weekly' }), range)).toThrowError(DomainError);
    expect(() => occurrences(rec({ frequency: 'yearly' }), range)).toThrowError(DomainError);
    expect(() => occurrences(rec({ intervalCount: 0 }), range)).toThrowError(DomainError);
  });
});

describe('projeção (RN-27, RN-29)', () => {
  it('RN-27: projeta até o último dia de M+12', () => {
    expect(projectionEnd('2026-11-05')).toBe('2027-11-30');
    const occ = projectRecurrences(
      [rec()],
      { from: '2026-11-01', to: projectionEnd('2026-11-05') },
      [],
      [],
    );
    expect(occ).toHaveLength(13);
    expect(occ.at(-1)?.date).toBe('2027-11-05');
  });

  it('RN-27: ocorrência realizada aponta o lançamento e usa o valor real', () => {
    const r = rec({ isVariableAmount: true });
    const tx = realized(r, '2026-11-05', { amountCents: 140000 });
    const [first, second] = projectRecurrences(
      [r],
      { from: '2026-11-01', to: '2026-12-31' },
      [tx],
      [],
    );
    expect(first).toMatchObject({ date: '2026-11-05', realizedTxId: tx.id, amountCents: 140000 });
    expect(second).toMatchObject({ date: '2026-12-05', realizedTxId: null, amountCents: 150000 });
    const deleted = { ...tx, deletedAt: 'x' };
    expect(
      projectRecurrences([r], { from: '2026-11-01', to: '2026-11-30' }, [deleted], [])[0]
        ?.realizedTxId,
    ).toBeNull();
  });

  it('pausadas e excluídas não projetam', () => {
    const range = { from: '2026-11-01', to: '2027-01-31' };
    expect(projectRecurrences([rec({ pausedAt: '2026-11-01T00:00:00Z' })], range, [], [])).toEqual(
      [],
    );
    expect(projectRecurrences([rec({ deletedAt: '2026-11-01T00:00:00Z' })], range, [], [])).toEqual(
      [],
    );
  });

  it('RN-29: ocorrência no cartão mostra a fatura da data; lista ordenada por data', () => {
    const streaming = rec({
      id: 'rec-streaming',
      cardId: cardA.id,
      accountId: null,
      paymentMethod: 'credit',
      dayOfMonth: 15,
      amountCents: 3990,
      startOn: '2026-11-15',
    });
    const occ = projectRecurrences(
      [streaming, rec()],
      { from: '2026-11-01', to: '2026-11-30' },
      [],
      [cardA],
    );
    expect(occ.map((o) => [o.recurrenceId, o.date, o.invoiceReferenceMonth])).toEqual([
      ['rec-aluguel', '2026-11-05', null],
      ['rec-streaming', '2026-11-15', '2026-12'],
    ]);
  });
});

describe('materialização (RN-27, RN-28, RN-29)', () => {
  it('RN-29: streaming no cartão em 15/11/2026 vira item da fatura de dez/2026 com id v5', () => {
    const streaming = rec({
      id: 'rec-streaming',
      cardId: cardA.id,
      accountId: null,
      paymentMethod: 'credit',
      dayOfMonth: 15,
    });
    const tx = materializeOccurrence(streaming, '2026-11-15', cardA);
    expect(tx).toMatchObject({
      id: recurrenceTxId('rec-streaming', '2026-11-15'),
      invoiceId: invoiceId(cardA.id, '2026-12'),
      recurrenceId: 'rec-streaming',
      recurrenceDate: '2026-11-15',
      source: 'recurrence',
      cardId: cardA.id,
      description: 'Aluguel',
    });
    expect(materializeOccurrence(streaming, '2026-11-15', cardA).id).toBe(tx.id);
    expect(() => materializeOccurrence(streaming, '2026-11-15', null)).toThrowError(DomainError);
  });

  it('RN-28: valor real informado na confirmação de conta variável', () => {
    expect(materializeOccurrence(rec(), '2026-11-05', null, [], 12345).amountCents).toBe(12345);
  });

  it('RN-28: dueAutoPosts lista ocorrências vencidas com confirmação automática ainda não realizadas', () => {
    const auto = rec({ id: 'rec-auto', autoPost: true, startOn: '2026-10-05' });
    const manual = rec({ id: 'rec-manual', startOn: '2026-10-05' });
    const paused = rec({ id: 'rec-pausada', autoPost: true, pausedAt: 'x', startOn: '2026-10-05' });
    const done = realized(auto, '2026-10-05');
    expect(dueAutoPosts([auto, manual, paused], [done], '2026-11-05')).toEqual([
      { recurrenceId: 'rec-auto', date: '2026-11-05' },
    ]);
    expect(dueAutoPosts([auto], [], '2026-11-04', 10)).toEqual([]);
  });
});
