// T-120 (D-081): Início pelo gasto do mês — saldo nas contas e saúde de cada faixa do 50/30/20.
import { describe, expect, it } from 'vitest';
import type { BucketStatus } from '../src/budget.ts';
import { accountBalance, accountsBalance, bandHealth } from '../src/home.ts';
import type { Tx } from '../src/types.ts';

let n = 0;
function tx(over: Partial<Tx>): Tx {
  n += 1;
  return {
    id: `tx-${n}`,
    kind: 'expense',
    status: 'posted',
    countBeforeReceived: false,
    invoicePinned: false,
    amountCents: 1000,
    occurredOn: '2026-11-05',
    description: null,
    categoryId: null,
    paymentMethod: 'pix',
    accountId: 'bb',
    cardId: null,
    invoiceId: null,
    counterpartAccountId: null,
    counterpartCardId: null,
    seriesId: null,
    installmentNumber: null,
    installmentCount: null,
    recurrenceId: null,
    recurrenceDate: null,
    goalId: null,
    incomeExpected: false,
    source: 'manual',
    externalId: null,
    reviewState: 'ok',
    duplicateOf: null,
    merchantCnpj: null,
    deletedAt: null,
    ...over,
  };
}

const BB = { id: 'bb', initialBalanceCents: 100_000, initialBalanceOn: '2026-11-01' };
const NU = { id: 'nu', initialBalanceCents: 20_000, initialBalanceOn: '2026-11-01' };

function status(over: Partial<BucketStatus>): BucketStatus {
  return {
    bucket: 'needs',
    targetCents: 240_000,
    spentCents: 0,
    committedCents: 0,
    remainingCents: 240_000,
    usageBp: 0,
    level: 'ok',
    ...over,
  };
}

describe('D-081: saldo nas contas', () => {
  it('US-30 (D-081): saldo = inicial + entradas − saídas efetivadas até hoje', () => {
    const txs = [
      tx({ kind: 'income', amountCents: 500_000, occurredOn: '2026-11-05' }),
      tx({ kind: 'expense', amountCents: 4_590, occurredOn: '2026-11-06' }),
      tx({ kind: 'refund', amountCents: 590, occurredOn: '2026-11-07' }),
      tx({ kind: 'adjust_out', amountCents: 1_000, occurredOn: '2026-11-08' }),
    ];
    expect(accountBalance(BB, txs, '2026-11-10')).toBe(100_000 + 500_000 - 4_590 + 590 - 1_000);
  });

  it('US-30 (D-081): previstas, futuras, canceladas, apagadas e anteriores ao saldo inicial não contam', () => {
    const txs = [
      tx({ status: 'pending', amountCents: 9_999 }),
      tx({ occurredOn: '2026-11-20', amountCents: 9_999 }),
      tx({ status: 'cancelled', amountCents: 9_999 }),
      tx({ deletedAt: '2026-11-06T00:00:00Z', amountCents: 9_999 }),
      tx({ occurredOn: '2026-10-31', amountCents: 9_999 }),
    ];
    expect(accountBalance(BB, txs, '2026-11-10')).toBe(100_000);
  });

  it('US-30 (D-081): transferência sai de uma conta e entra na outra; pagamento de fatura só sai', () => {
    const txs = [
      tx({ kind: 'transfer', amountCents: 30_000, accountId: 'bb', counterpartAccountId: 'nu' }),
      tx({ kind: 'transfer', amountCents: 10_000, accountId: 'bb', counterpartCardId: 'card' }),
    ];
    expect(accountBalance(BB, txs, '2026-11-10')).toBe(100_000 - 30_000 - 10_000);
    expect(accountBalance(NU, txs, '2026-11-10')).toBe(20_000 + 30_000);
    expect(accountsBalance([BB, NU], txs, '2026-11-10')).toBe(120_000 - 10_000);
  });

  it('US-30 (D-081): compra no cartão não mexe no saldo das contas', () => {
    const txs = [tx({ accountId: null, cardId: 'card', amountCents: 50_000 })];
    expect(accountsBalance([BB, NU], txs, '2026-11-10')).toBe(120_000);
  });
});

describe('D-081: saúde do mês por faixa', () => {
  it('RN-44 (D-081): Necessidades e Desejos — no caminho, atenção (80%) e passou do planejado (100%)', () => {
    expect(bandHealth(status({ level: 'ok', usageBp: 5_000 }), '2026-11-10')).toBe('on_track');
    expect(bandHealth(status({ level: 'warning', usageBp: 8_000 }), '2026-11-10')).toBe(
      'attention',
    );
    expect(
      bandHealth(status({ bucket: 'wants', level: 'over', usageBp: 10_500 }), '2026-11-10'),
    ).toBe('over');
  });

  it('RN-44 (D-081): Poupança é mínimo — nunca passa do planejado; abaixo da meta só avisa no fim do mês', () => {
    const savings = (spent: number) =>
      status({ bucket: 'savings', targetCents: 96_000, spentCents: spent, level: 'over' });
    expect(bandHealth(savings(0), '2026-11-10')).toBe('on_track');
    expect(bandHealth(savings(10_000), '2026-11-26')).toBe('attention');
    expect(bandHealth(savings(96_000), '2026-11-30')).toBe('on_track');
    expect(bandHealth(savings(150_000), '2026-11-30')).toBe('on_track');
    expect(bandHealth({ ...savings(0), targetCents: 0 }, '2026-11-30')).toBe('on_track');
  });
});
