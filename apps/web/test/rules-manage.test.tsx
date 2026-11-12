import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { ruleFromRow } from '../src/features/quick-entry/model';
import { RulesScreen, sortRules, wouldMatch } from '../src/features/rules/RulesScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-06';

function rule(id: string, pattern: string, overrides: Partial<LocalRow<'category_rules'>> = {}) {
  return makeRow('category_rules', {
    id,
    pattern,
    match_field: 'description',
    match_type: 'token_prefix',
    category_id: 'saude',
    account_id: null,
    card_id: null,
    payment_method: null,
    source: 'learned',
    priority: 0,
    hits: 0,
    last_hit_at: null,
    enabled: true,
    deleted_at: null,
    ...overrides,
  });
}

function spent(id: string, description: string, date: string) {
  return tx(id, {
    kind: 'expense',
    description,
    description_raw: description,
    occurred_on: date,
    category_id: 'saude',
    payment_method: 'pix',
    account_id: 'bb',
    card_id: null,
    merchant_cnpj: null,
    deleted_at: null,
  });
}

async function setup(): Promise<AuthValue> {
  const auth = fakeAuth('signedIn');
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem banco');
  }
  await db.categories.bulkPut([
    makeRow('categories', {
      id: 'saude',
      name: 'Saúde',
      kind: 'expense',
      bucket: 'needs',
      is_system: false,
      deleted_at: null,
      archived_at: null,
    }),
    makeRow('categories', {
      id: 'lazer',
      name: 'Lazer',
      kind: 'expense',
      bucket: 'wants',
      is_system: false,
      deleted_at: null,
      archived_at: null,
    }),
  ]);
  await db.accounts.put(makeRow('accounts', { id: 'bb', name: 'BB', deleted_at: null }));
  return auth;
}

function mount(auth: AuthValue) {
  const router = createMemoryRouter([{ path: '*', element: <RulesScreen today={TODAY} /> }]);
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

describe('rules — gerenciar (US-29, RN-59, RN-60)', () => {
  it('US-29: lista com termo, categoria, conta, origem, acertos e último uso, ordenada por último uso', async () => {
    expect(
      sortRules([
        rule('a', 'POSTO', { last_hit_at: '2026-11-01T10:00:00.000Z' }),
        rule('b', 'UNIMED PARANA', { last_hit_at: '2026-11-05T10:00:00.000Z' }),
        rule('c', 'ZAFFARI'),
        rule('d', 'APAGADA', { deleted_at: '2026-11-02T10:00:00.000Z' }),
      ]).map((r) => r.id),
    ).toEqual(['b', 'a', 'c']);
    const auth = await setup();
    await auth.user?.db.category_rules.bulkPut([
      rule('b', 'UNIMED PARANA', {
        hits: 3,
        last_hit_at: '2026-11-05T10:00:00.000Z',
        account_id: 'bb',
      }),
      rule('c', 'ZAFFARI', { source: 'manual', category_id: 'lazer' }),
    ]);
    mount(auth);
    const items = within(await screen.findByTestId('rules-list')).getAllByRole('button');
    // UXC-013: termo → categoria na primeira linha; a meta, parte por parte, na segunda
    const parts = (item: HTMLElement | undefined) =>
      Array.from(within(item as HTMLElement).getByTestId('rule-meta').children).map(
        (el) => el.textContent,
      );
    expect(items[0]?.querySelector('.rule-row-title')?.textContent).toBe('UNIMED PARANA → Saúde');
    expect(parts(items[0])).toEqual(['BB', 'Aprendida', '3 acertos', 'último uso 05/11/2026']);
    expect(items[1]?.querySelector('.rule-row-title')?.textContent).toBe('ZAFFARI → Lazer');
    // sem acertos, a meta fica "Manual · sem uso" (sem "0 acertos")
    expect(parts(items[1])).toEqual(['Manual', 'sem uso']);
  });

  it('US-29: editar o termo para "UNIMED" mostra "Casaria com 7 lançamentos dos últimos 90 dias"', async () => {
    const auth = await setup();
    const db = auth.user?.db;
    const rows = [
      ...Array.from({ length: 7 }, (_, i) =>
        spent(`u${i}`, `UNIMED ${i % 2 ? 'PARANA' : 'CURITIBA'} ${i}`, '2026-10-0' + (i + 1)),
      ),
      spent('velho', 'UNIMED PARANA 9', '2026-07-01'),
      spent('outro', 'FARMACIA SAO JOAO', '2026-11-01'),
    ];
    await db?.transactions.bulkPut(rows);
    expect(wouldMatch({ ...ruleFromRow(rule('x', 'UNIMED')) }, rows, TODAY)).toHaveLength(7);
    await db?.category_rules.put(rule('b', 'UNIMED PARANA'));
    mount(auth);
    fireEvent.click(within(await screen.findByTestId('rules-list')).getByRole('button'));
    const sheet = await screen.findByTestId('rule-sheet');
    expect(within(sheet).getByTestId('rule-preview')).toHaveTextContent(
      'Casaria com 3 lançamentos dos últimos 90 dias',
    );
    fireEvent.change(within(sheet).getByLabelText('Termo'), { target: { value: 'UNIMED' } });
    expect(within(sheet).getByTestId('rule-preview')).toHaveTextContent(
      'Casaria com 7 lançamentos dos últimos 90 dias',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () =>
      expect(await db?.category_rules.get('b')).toMatchObject({
        pattern: 'UNIMED',
        source: 'manual',
      }),
    );
  });

  it('US-29: apagar a regra não muda os lançamentos já categorizados', async () => {
    const auth = await setup();
    const db = auth.user?.db;
    await db?.transactions.put(spent('u1', 'UNIMED PARANA 1', '2026-11-01'));
    await db?.category_rules.put(rule('b', 'UNIMED PARANA'));
    mount(auth);
    fireEvent.click(within(await screen.findByTestId('rules-list')).getByRole('button'));
    fireEvent.click(
      within(await screen.findByTestId('rule-sheet')).getByRole('button', { name: 'Apagar' }),
    );
    await waitFor(async () =>
      expect((await db?.category_rules.get('b'))?.deleted_at).not.toBeNull(),
    );
    expect((await db?.transactions.get('u1'))?.category_id).toBe('saude');
    expect(await screen.findByText('Nenhuma regra criada')).toBeInTheDocument();
  });

  it('criar regra manual; termo curto é recusado', async () => {
    const auth = await setup();
    const db = auth.user?.db;
    mount(auth);
    expect(await screen.findByText('Nenhuma regra criada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nova regra' }));
    const sheet = await screen.findByTestId('rule-sheet');
    fireEvent.change(within(sheet).getByLabelText('Termo'), { target: { value: 'BAR' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(await within(sheet).findByText('Use pelo menos 4 caracteres.')).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Termo'), { target: { value: 'Drogaria Raia' } });
    fireEvent.change(within(sheet).getByLabelText('Categoria'), { target: { value: 'saude' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () =>
      expect((await db?.category_rules.toArray())?.[0]).toMatchObject({
        pattern: 'DROGARIA RAIA',
        source: 'manual',
        category_id: 'saude',
      }),
    );
  });
});
