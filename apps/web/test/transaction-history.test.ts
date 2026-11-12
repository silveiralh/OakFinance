import { describe, expect, it } from 'vitest';
import {
  describeChanges,
  describeHistory,
  type HistoryNames,
  loadHistory,
  parseHistory,
  restoredRow,
  whenLabel,
} from '../src/features/transactions/history';
import { methodLabel } from '../src/features/transactions/TransactionsScreen';
import { tx } from './data/rows';

const TODAY = '2026-11-06';

const NAMES: HistoryNames = {
  categories: new Map([
    ['lazer', 'Lazer'],
    ['mercado', 'Mercado'],
  ]),
  accounts: new Map([['bb', 'Conta BB']]),
  cards: new Map([['nu', 'Nubank']]),
  method: methodLabel,
};

const base = tx('l1', {
  amount_cents: 4590,
  category_id: 'mercado',
  occurred_on: '2026-11-05',
  description: 'Padaria',
  payment_method: 'pix',
  account_id: 'bb',
  deleted_at: null,
});

function row(overrides: Partial<typeof base> = {}): Record<string, unknown> {
  return { ...base, ...overrides } as unknown as Record<string, unknown>;
}

describe('histórico do lançamento (RN-97, RN-98)', () => {
  it('US-13: editar de R$ 45,90 para R$ 49,50 mostra a versão anterior com data e aparelho', () => {
    const current = { ...base, amount_cents: 4950 };
    const entries = parseHistory([
      {
        op: 'update',
        old_row: row(),
        rejected_row: null,
        old_version: 3,
        device_id: 'este',
        changed_at: '2026-11-06T21:02:00.000Z',
      },
    ]);
    const [item] = describeHistory(entries, current, 'este', NAMES, TODAY);
    expect(item).toMatchObject({
      title: 'Valor alterado de R$\u00a045,90 para R$\u00a049,50',
      when: 'Hoje 18:02',
      device: 'neste aparelho',
      conflict: false,
    });
    expect(item?.version).toMatchObject({ amount_cents: 4590 });
  });

  it('US-04: conflito mostra a versão de R$ 50,00 com o motivo e a opção de restaurar', () => {
    const current = { ...base, amount_cents: 6000 };
    const entries = parseHistory([
      {
        op: 'stale_write',
        old_row: row({ amount_cents: 6000 }),
        rejected_row: row({ amount_cents: 5000 }),
        old_version: 5,
        device_id: 'celular',
        changed_at: '2026-11-06T13:10:00.000Z',
      },
      {
        op: 'update',
        old_row: row(),
        rejected_row: null,
        old_version: 4,
        device_id: 'computador',
        changed_at: '2026-11-06T13:06:00.000Z',
      },
    ]);
    const items = describeHistory(entries, current, 'computador', NAMES, TODAY);
    expect(items[0]).toMatchObject({
      title: 'Versão perdida em conflito',
      lines: ['Valor alterado de R$\u00a060,00 para R$\u00a050,00'],
      device: 'em outro aparelho',
      conflict: true,
    });
    expect(items[0]?.version).toMatchObject({ amount_cents: 5000 });
    // o conflito não muda a linha: a edição anterior compara com a atual
    expect(items[1]).toMatchObject({
      title: 'Valor alterado de R$\u00a045,90 para R$\u00a060,00',
      device: 'neste aparelho',
    });
  });

  it('UX T02: "Categoria alterada de Lazer para Mercado" e várias mudanças na mesma versão', () => {
    expect(describeChanges(row({ category_id: 'lazer' }), row(), NAMES)).toEqual([
      'Categoria alterada de Lazer para Mercado',
    ]);
    expect(
      describeChanges(
        row(),
        row({
          occurred_on: '2026-11-01',
          description: null,
          notes: 'x',
          payment_method: 'credit',
          account_id: null,
          card_id: 'nu',
          status: 'cancelled',
          kind: 'income',
        }),
        NAMES,
      ),
    ).toEqual([
      'Data alterada de 05/11/2026 para 01/11/2026',
      'Descrição alterada de Padaria para Não informado',
      'Observação alterada',
      'Meio de pagamento alterado de Pix para Crédito',
      'Conta alterada de Conta BB para Não informado',
      'Cartão alterado de Não informado para Nubank',
      'Status alterado de Efetivada para Cancelada',
      'Tipo alterado de Despesa para Receita',
    ]);
    expect(describeChanges(row(), row({ tags: ['x'] }), NAMES)).toEqual(['Outros dados alterados']);
    expect(
      describeChanges(row({ _pending: 0 }), row({ amount_cents: 100, _pending: 1 }), NAMES),
    ).toEqual(['Valor alterado de R$\u00a045,90 para R$\u00a01,00']);
    expect(describeChanges(row(), row({ server_version: 9 }), NAMES)).toEqual([
      'Outros dados alterados',
    ]);
  });

  it('RN-99: exclusão e restauração aparecem no histórico sem restaurar versão', () => {
    const entries = parseHistory([
      {
        op: 'restore',
        old_row: row({ deleted_at: 'x' }),
        device_id: null,
        changed_at: '2026-11-05T12:00:00Z',
      },
      { op: 'delete', old_row: row(), device_id: 'este', changed_at: '2026-11-03T12:00:00Z' },
    ]);
    const items = describeHistory(entries, base, 'este', NAMES, TODAY);
    expect(items.map((i) => [i.title, i.when, i.device, i.version])).toEqual([
      ['Lançamento restaurado', 'Ontem 09:00', 'em outro aparelho', null],
      ['Lançamento excluído', '03/11/2026 09:00', 'neste aparelho', null],
    ]);
  });

  it('parseHistory ignora itens fora do formato', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(
      parseHistory([
        null,
        { op: 'x', changed_at: 'y' },
        { op: 'update' },
        { op: 'update', changed_at: '2026-11-06T12:00:00Z', old_row: [1] },
      ]),
    ).toEqual([
      {
        op: 'update',
        oldRow: null,
        rejectedRow: null,
        deviceId: null,
        changedAt: '2026-11-06T12:00:00Z',
      },
    ]);
    expect(whenLabel('não é data', TODAY)).toBe('');
  });

  it('loadHistory chama get_row_history e lança se a RPC falhar', async () => {
    const calls: unknown[] = [];
    const ok = {
      rpc: (fn: string, args: unknown) => {
        calls.push([fn, args]);
        return Promise.resolve({ data: [], error: null });
      },
    };
    await expect(loadHistory(ok, 'l1')).resolves.toEqual([]);
    expect(calls).toEqual([['get_row_history', { p_table: 'transactions', p_row_id: 'l1' }]]);
    const failing = { rpc: () => Promise.resolve({ data: null, error: { code: '500' } }) };
    await expect(loadHistory(failing, 'l1')).rejects.toThrow('HISTORY_FAILED');
  });

  it('RN-97: restaurar traz o conteúdo da versão e mantém id e auditoria da linha atual', () => {
    const current = { ...base, amount_cents: 6000, server_version: 7, deleted_at: null };
    const next = restoredRow(current, row({ amount_cents: 5000, server_version: 5, id: 'outro' }));
    expect(next).toMatchObject({
      id: 'l1',
      amount_cents: 5000,
      server_version: 7,
      deleted_at: null,
    });
    expect(restoredRow(current, { amount_cents: 'não é número' })).toBeNull();
  });
});
