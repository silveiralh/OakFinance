import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow, OakDb } from '../src/data/db';
import { categoryLimit } from '../src/data/repositories/budgets';
import {
  categoryNameProblem,
  categoryUsage,
  createCategory,
  deleteCategory,
  setArchived,
  updateCategory,
} from '../src/data/repositories/categories';
import { ensureSeeds } from '../src/data/seeds';
import { CategoriesScreen, groupCategories } from '../src/features/categories/CategoriesScreen';
import { expenseCategories } from '../src/features/quick-entry/model';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

async function seeded(): Promise<{ auth: AuthValue; db: OakDb; userId: string }> {
  const auth = fakeAuth('signedIn');
  const user = auth.user;
  if (!user) {
    throw new Error('sem usuário');
  }
  await ensureSeeds(user.db, user.userId);
  return { auth, db: user.db, userId: user.userId };
}

async function bySlug(db: OakDb, slug: string): Promise<LocalRow<'categories'>> {
  const row = (await db.categories.toArray()).find((c) => c.slug === slug);
  if (!row) {
    throw new Error(slug);
  }
  return row;
}

function mount(auth: AuthValue) {
  const router = createMemoryRouter([{ path: '*', element: <CategoriesScreen /> }]);
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

describe('categories (US-27, RN-39..RN-42)', () => {
  it('US-27: lista inicial com as faixas da RN-40 e as de sistema "A classificar" e "Saldo credor da fatura anterior"', async () => {
    const { db } = await seeded();
    const groups = groupCategories(await db.categories.toArray());
    const names = (bucket: string) =>
      groups.bands.find((b) => b.bucket === bucket)?.rows.map((r) => r.name) ?? [];
    expect(names('needs')).toContain('Pets');
    expect(names('wants')).toContain('Viagens');
    expect(names('savings').length).toBeGreaterThan(0);
    expect(groups.system.map((c) => c.name)).toEqual(
      expect.arrayContaining(['A classificar', 'Saldo credor da fatura anterior']),
    );
    // RN-39: toda categoria de despesa da lista tem uma das três faixas
    for (const band of groups.bands) {
      expect(band.rows.every((r) => r.kind === 'expense' && r.bucket === band.bucket)).toBe(true);
    }
  });

  it('US-27: "A classificar" não pode ser renomeada, excluída nem escolhida no lançamento manual (RN-41)', async () => {
    const { db } = await seeded();
    const unclassified = await bySlug(db, 'a-classificar');
    const renamed = await updateCategory(db, unclassified.id, { name: 'Outra' });
    expect(renamed.ok ? null : renamed.error.code).toBe('CATEGORY_SYSTEM');
    const removed = await deleteCategory(db, unclassified.id, null);
    expect(removed.ok ? null : removed.error.code).toBe('CATEGORY_SYSTEM');
    expect(expenseCategories(await db.categories.toArray()).map((c) => c.id)).not.toContain(
      unclassified.id,
    );
  });

  it('US-27: trocar "Pets" de Necessidades para Desejos avisa "Isso muda os totais de todos os meses" e grava ao confirmar', async () => {
    const { auth, db } = await seeded();
    mount(auth);
    const needs = await screen.findByTestId('categories-needs');
    fireEvent.click(within(needs).getByRole('button', { name: 'Pets' }));
    const sheet = await screen.findByTestId('category-sheet');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Desejos' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    const dialog = await screen.findByTestId('band-dialog');
    expect(dialog).toHaveTextContent('Isso muda os totais de todos os meses');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trocar faixa' }));
    await waitFor(async () => expect((await bySlug(db, 'pets')).bucket).toBe('wants'));
    expect(await screen.findByText('Categoria salva.')).toBeInTheDocument();
    expect(
      within(await screen.findByTestId('categories-wants')).getByText('Pets'),
    ).toBeInTheDocument();
  });

  it('US-32: a folha da categoria de despesa grava o limite mensal (R$ 400,00) em budgets', async () => {
    const { auth, db } = await seeded();
    mount(auth);
    const wants = await screen.findByTestId('categories-wants');
    fireEvent.click(within(wants).getByRole('button', { name: 'Restaurantes e delivery' }));
    const sheet = await screen.findByTestId('category-sheet');
    const input = within(sheet).getByRole('textbox', { name: 'Limite mensal (opcional)' });
    for (const d of '40000') {
      fireEvent.keyDown(input, { key: d });
    }
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    const restaurantes = await bySlug(db, 'restaurantes-delivery');
    await waitFor(async () =>
      expect(categoryLimit(await db.budgets.toArray(), restaurantes.id)?.limit_cents).toBe(40000),
    );
    // T-125 (UXC-019): a linha mostra o limite e a seta de que abre a edição
    await waitFor(() =>
      expect(
        within(screen.getByTestId('categories-wants')).getByRole('button', {
          name: /^Restaurantes e delivery/,
        }),
      ).toHaveTextContent('Restaurantes e deliveryLimite R$ 400,00'),
    );
  });

  it('US-27: excluir "Viagens" com 4 lançamentos pede o destino e move lançamentos, recorrências e regras', async () => {
    const { auth, db } = await seeded();
    const viagens = await bySlug(db, 'viagens');
    const lazer = await bySlug(db, 'lazer');
    for (const id of ['v1', 'v2', 'v3', 'v4']) {
      await db.transactions.put(tx(id, { category_id: viagens.id, deleted_at: null }));
    }
    await db.recurrences.put(
      makeRow('recurrences', { id: 'r1', category_id: viagens.id, deleted_at: null }),
    );
    await db.category_rules.put(
      makeRow('category_rules', { id: 'g1', category_id: viagens.id, deleted_at: null }),
    );
    await db.budgets.put(
      makeRow('budgets', { id: 'b1', category_id: viagens.id, deleted_at: null }),
    );
    expect(await categoryUsage(db, viagens.id)).toMatchObject({
      transactions: 4,
      recurrences: 1,
      rules: 1,
      total: 6,
    });
    const refused = await deleteCategory(db, viagens.id, null);
    expect(refused.ok ? null : refused.error.code).toBe('CATEGORY_TARGET');

    mount(auth);
    const wants = await screen.findByTestId('categories-wants');
    fireEvent.click(within(wants).getByRole('button', { name: 'Viagens' }));
    fireEvent.click(
      within(await screen.findByTestId('category-sheet')).getByRole('button', { name: 'Excluir' }),
    );
    const sheet = await screen.findByTestId('delete-sheet');
    // o <dialog> entra no DOM antes do showModal(): espera o botão ficar acessível (mesmo padrão do cards-edit)
    const confirm = await within(sheet).findByRole('button', { name: 'Mover e excluir' });
    expect(sheet).toHaveTextContent('6 itens usam esta categoria. Escolha para onde movê-los.');
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(within(sheet).getByLabelText('Mover para'), { target: { value: lazer.id } });
    fireEvent.click(confirm);
    await waitFor(async () =>
      expect((await db.categories.get(viagens.id))?.deleted_at).not.toBeNull(),
    );
    const moved = await db.transactions.where('id').anyOf(['v1', 'v2', 'v3', 'v4']).toArray();
    expect(moved.every((r) => r.category_id === lazer.id && r._pending === 1)).toBe(true);
    expect((await db.recurrences.get('r1'))?.category_id).toBe(lazer.id);
    expect((await db.category_rules.get('g1'))?.category_id).toBe(lazer.id);
    expect((await db.budgets.get('b1'))?.deleted_at).not.toBeNull();
    expect(await screen.findByText('Categoria excluída.')).toBeInTheDocument();
  });

  it('RN-39/RN-42: criar com faixa, nome único sem diferenciar maiúsculas, arquivar e excluir sem uso', async () => {
    const { auth, db, userId } = await seeded();
    const all = await db.categories.toArray();
    expect(categoryNameProblem('  ', all)).toBe('required');
    expect(categoryNameProblem('x'.repeat(41), all)).toBe('tooLong');
    expect(categoryNameProblem('pets', all)).toBe('duplicate');
    const created = await createCategory(db, userId, {
      name: 'Jardinagem',
      icon: 'Gift',
      bucket: 'wants',
    });
    if (!created.ok || !created.value) {
      throw new Error('não criou');
    }
    expect(created.value).toMatchObject({ kind: 'expense', bucket: 'wants', is_system: false });
    expect(
      (await createCategory(db, userId, { name: 'JARDINAGEM', icon: null, bucket: 'needs' })).ok,
    ).toBe(false);
    await setArchived(db, created.value.id, true);
    expect(expenseCategories(await db.categories.toArray()).map((c) => c.name)).not.toContain(
      'Jardinagem',
    );
    expect(groupCategories(await db.categories.toArray()).archived.map((c) => c.name)).toEqual([
      'Jardinagem',
    ]);
    await setArchived(db, created.value.id, false);
    const removed = await deleteCategory(db, created.value.id, null);
    expect(removed.ok).toBe(true);

    // pela tela: nova categoria com ícone e nome repetido
    mount(auth);
    fireEvent.click(await screen.findByRole('button', { name: 'Nova categoria' }));
    const sheet = await screen.findByTestId('category-sheet');
    fireEvent.change(within(sheet).getByLabelText('Nome da categoria'), {
      target: { value: 'Pets' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(sheet).findByText('Você já tem uma categoria com esse nome'),
    ).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Nome da categoria'), {
      target: { value: 'Hobbies' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Presente' }));
    expect(within(sheet).getByRole('button', { name: 'Presente' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () =>
      expect((await db.categories.toArray()).find((c) => c.name === 'Hobbies')).toMatchObject({
        icon: 'Gift',
        bucket: 'needs',
      }),
    );
    expect(
      within(await screen.findByTestId('categories-system')).getAllByLabelText(
        'Categoria do sistema: não pode ser editada.',
      ).length,
    ).toBeGreaterThan(0);
  });
});
