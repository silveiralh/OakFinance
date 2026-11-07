// T-066: exportar lançamentos em CSV (US-59; RN-01 valores em centavos, RN-02 datas no fuso de São Paulo).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import { DataScreen } from '../src/features/settings/DataScreen';
import {
  buildCsv,
  CSV_COLUMNS,
  csvAmount,
  csvText,
  exportFileName,
  exportTransactions,
  monthOptions,
  periodOf,
} from '../src/features/settings/export';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const HEADER =
  'data;tipo;descricao;categoria;faixa;conta;forma;valor;status;parcela;fatura;origem;observacao';

async function seeded(): Promise<AuthValue> {
  const auth = fakeAuth();
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  await db.categories.bulkPut([
    makeRow('categories', {
      id: 'mercado',
      name: 'Mercado',
      bucket: 'needs',
      kind: 'expense',
      deleted_at: null,
    }),
    makeRow('categories', {
      id: 'salario',
      name: 'Salário',
      bucket: 'income',
      kind: 'income',
      deleted_at: null,
    }),
    makeRow('categories', {
      id: 'lazer',
      name: 'Lazer',
      bucket: 'wants',
      kind: 'expense',
      deleted_at: null,
    }),
  ]);
  await db.accounts.put(
    makeRow('accounts', { id: 'bb', name: 'Banco do Brasil', type: 'checking', deleted_at: null }),
  );
  await db.cards.put(
    makeRow('cards', { id: 'nu', name: 'Nubank', closing_day: 3, due_day: 10, deleted_at: null }),
  );
  await db.invoices.put(
    makeRow('invoices', {
      id: 'fat-dez',
      card_id: 'nu',
      reference_month: '2026-12-01',
      closing_date: '2026-12-03',
      due_date: '2026-12-10',
      deleted_at: null,
    }),
  );
  await db.transactions.bulkPut([
    tx('t1', {
      kind: 'expense',
      amount_cents: 4_590,
      occurred_on: '2026-10-05',
      description: 'Padaria São José',
      category_id: 'mercado',
      account_id: 'bb',
      payment_method: 'pix',
      source: 'manual',
      created_at: '2026-10-05T12:00:00.000Z',
    }),
    tx('t2', {
      kind: 'income',
      amount_cents: 500_000,
      occurred_on: '2026-10-05',
      description: 'Salário',
      category_id: 'salario',
      account_id: 'bb',
      payment_method: 'transfer',
      source: 'recurrence',
      recurrence_id: 'r1',
      recurrence_date: '2026-10-05',
      created_at: '2026-10-05T13:00:00.000Z',
    }),
    tx('t3', {
      kind: 'expense',
      amount_cents: 33_333,
      occurred_on: '2026-11-20',
      description: 'TV; "50 polegadas"',
      category_id: 'lazer',
      account_id: null,
      card_id: 'nu',
      invoice_id: 'fat-dez',
      payment_method: 'credit',
      series_id: 's1',
      installment_number: 2,
      installment_count: 3,
      source: 'installment',
      notes: 'linha 1\nlinha 2',
      created_at: '2026-11-20T10:00:00.000Z',
    }),
    tx('t4', {
      kind: 'transfer',
      amount_cents: 123_456,
      occurred_on: '2026-11-30',
      description: '=pagamento',
      category_id: null,
      account_id: 'bb',
      counterpart_card_id: 'nu',
      payment_method: 'transfer',
      status: 'pending',
      source: 'manual',
      created_at: '2026-11-30T10:00:00.000Z',
    }),
    // fora do período e excluído
    tx('t5', { occurred_on: '2026-12-01', amount_cents: 100, account_id: 'bb' }),
    tx('t6', {
      occurred_on: '2026-10-10',
      amount_cents: 100,
      account_id: 'bb',
      deleted_at: '2026-10-11T00:00:00Z',
    }),
  ]);
  return auth;
}

describe('CSV (US-59)', () => {
  it('US-59: nome do arquivo e período de 01/10/2026 a 30/11/2026', () => {
    expect(exportFileName('2026-10', '2026-11')).toBe('lancamentos_2026-10_a_2026-11.csv');
    expect(periodOf('2026-10', '2026-11')).toEqual({ from: '2026-10-01', to: '2026-11-30' });
    expect(periodOf('2028-02', '2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    const months = monthOptions('2026-11');
    expect(months[0]).toBe('2024-11');
    expect(months.at(-1)).toBe('2027-11');
  });

  it('RN-01: valor com vírgula decimal, sem milhar; despesa negativa e receita positiva', () => {
    expect(csvAmount(4_590, true)).toBe('-45,90');
    expect(csvAmount(500_000, false)).toBe('5000,00');
    expect(csvAmount(5, false)).toBe('0,05');
    expect(csvAmount(0, true)).toBe('0,00');
  });

  it('texto com ";", aspas ou quebra de linha vai entre aspas; fórmula ganha apóstrofo', () => {
    expect(csvText('Padaria São José')).toBe('Padaria São José');
    expect(csvText('TV; "50"')).toBe('"TV; ""50"""');
    expect(csvText('a\r\nb')).toBe('"a\nb"');
    expect(csvText('=SOMA(A1)')).toBe("'=SOMA(A1)");
    expect(csvText('-10')).toBe("'-10");
    expect(csvText(null)).toBe('');
  });

  it('US-59 "Exportar período": conteúdo exato do arquivo (BOM, ";", "," e as 13 colunas)', async () => {
    const auth = await seeded();
    const result = await exportTransactions(auth.user?.db as never, '2026-10', '2026-11');
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') {
      return;
    }
    expect(result.name).toBe('lancamentos_2026-10_a_2026-11.csv');
    expect(result.count).toBe(4);
    expect(CSV_COLUMNS.join(';')).toBe(HEADER);
    expect(result.content).toBe(
      [
        `﻿${HEADER}`,
        '05/10/2026;despesa;Padaria São José;Mercado;Necessidades;Banco do Brasil;Pix;-45,90;Efetivada;;;Manual;',
        '05/10/2026;receita;Salário;Salário;;Banco do Brasil;TED/DOC;5000,00;Efetivada;;;Conta fixa;',
        '20/11/2026;despesa;"TV; ""50 polegadas""";Lazer;Desejos;Nubank;Crédito;-333,33;Efetivada;2/3;dez/2026;Compra parcelada;"linha 1\nlinha 2"',
        "30/11/2026;transferencia;'=pagamento;;;Banco do Brasil;TED/DOC;-1234,56;Agendada;;;Manual;",
        '',
      ].join('\r\n'),
    );
  });

  it('US-59 "Abre no Excel/Sheets em pt-BR": UTF-8 com BOM preserva os acentos', async () => {
    const auth = await seeded();
    const result = await exportTransactions(auth.user?.db as never, '2026-10', '2026-10');
    if (result.kind !== 'file') {
      throw new Error('sem arquivo');
    }
    const bytes = new TextEncoder().encode(result.content);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8').decode(bytes)).toContain('São José');
  });

  it('ordena por data e, no mesmo dia, pela criação', () => {
    const labels = {
      categories: new Map(),
      accounts: new Map(),
      cards: new Map(),
      invoices: new Map(),
    };
    const rows = [
      tx('b', { occurred_on: '2026-10-02', created_at: '2026-10-02T10:00:00Z', amount_cents: 200 }),
      tx('a', { occurred_on: '2026-10-02', created_at: '2026-10-02T09:00:00Z', amount_cents: 100 }),
      tx('c', { occurred_on: '2026-10-01', created_at: '2026-10-03T09:00:00Z', amount_cents: 300 }),
    ];
    const lines = buildCsv(rows, labels).split('\r\n').slice(1, 4);
    expect(lines.map((l) => l.split(';')[7])).toEqual(['-3,00', '-1,00', '-2,00']);
  });
});

describe('S10 — Dados e privacidade', () => {
  function renderData(auth: AuthValue, download = vi.fn()) {
    const router = createMemoryRouter([
      { path: '*', element: <DataScreen today="2026-11-15" download={download} /> },
    ]);
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    return download;
  }

  it('US-59: exporta outubro a novembro e baixa o arquivo', async () => {
    const download = renderData(await seeded());
    fireEvent.change(await screen.findByLabelText('De'), { target: { value: '2026-10' } });
    fireEvent.click(screen.getByTestId('export-run'));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [name, content] = download.mock.calls[0] as [string, string];
    expect(name).toBe('lancamentos_2026-10_a_2026-11.csv');
    expect(content.split('\r\n')).toHaveLength(6);
    expect(await screen.findByText('Arquivo gerado.')).toBeInTheDocument();
  });

  it('US-59 "Sem lançamentos no período": aviso e nenhum arquivo', async () => {
    const download = renderData(await seeded());
    fireEvent.change(await screen.findByLabelText('De'), { target: { value: '2025-01' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2025-02' } });
    fireEvent.click(screen.getByTestId('export-run'));
    expect(await screen.findByText('Não há lançamentos nesse período')).toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });

  it('mês final antes do inicial: erro e botão desativado', async () => {
    const download = renderData(await seeded());
    fireEvent.change(await screen.findByLabelText('Até'), { target: { value: '2026-09' } });
    expect(
      screen.getByText('O mês final precisa ser igual ou depois do inicial.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('export-run'));
    expect(download).not.toHaveBeenCalled();
  });
});
