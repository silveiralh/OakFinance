import {
  type CategoryRule,
  categorize,
  normalizeDescription,
  ruleMatches,
} from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../src/app/auth';
import type { LocalRow, OakDb } from '../src/data/db';
import { categoryFromRow } from '../src/data/mappers';
import { ensureSeeds } from '../src/data/seeds';
import { applySimilar, correctCategory, undoLearning } from '../src/features/rules/learn';
import { TransactionDetailScreen } from '../src/features/transactions/TransactionDetailScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { tx } from './data/rows';

async function seeded() {
  const auth = fakeAuth('signedIn');
  const user = auth.user;
  if (!user) {
    throw new Error('sem usuário');
  }
  await ensureSeeds(user.db, user.userId);
  const categories = await user.db.categories.toArray();
  const bySlug = (slug: string) => {
    const row = categories.find((c) => c.slug === slug);
    if (!row) {
      throw new Error(slug);
    }
    return row;
  };
  return { auth, db: user.db, userId: user.userId, bySlug };
}

function imported(
  id: string,
  description: string,
  categoryId: string,
  extra: Partial<LocalRow<'transactions'>> = {},
) {
  return tx(id, {
    kind: 'expense',
    status: 'posted',
    description,
    description_raw: description,
    category_id: categoryId,
    category_source: 'none',
    payment_method: 'pix',
    account_id: 'bb',
    card_id: null,
    merchant_cnpj: null,
    review_state: 'new',
    source: 'pluggy',
    deleted_at: null,
    ...extra,
  });
}

async function liveRules(db: OakDb) {
  return (await db.category_rules.toArray()).filter((r) => r.deleted_at === null);
}

describe('rules — regras que aprendem (US-28, RN-57..RN-63)', () => {
  it('US-28: "UNIMED PARANA 0001" em "A classificar" corrigido para Saúde cria "UNIMED PARANA" → Saúde e acha os parecidos', async () => {
    const { db, userId, bySlug } = await seeded();
    const unclassified = bySlug('a-classificar');
    const saude = bySlug('saude');
    await db.transactions.bulkPut([
      imported('u1', 'UNIMED PARANA 0001', unclassified.id),
      imported('u2', 'UNIMED PARANA 0002', unclassified.id),
      imported('outro', 'PADARIA SOL', unclassified.id),
    ]);
    const row = await db.transactions.get('u1');
    const correction = await correctCategory(db, userId, row as LocalRow<'transactions'>, saude.id);
    expect(correction.rule).toMatchObject({
      pattern: 'UNIMED PARANA',
      category_id: saude.id,
      source: 'learned',
      match_type: 'token_prefix',
    });
    expect(await db.transactions.get('u1')).toMatchObject({
      category_id: saude.id,
      category_source: 'manual',
    });
    expect(correction.similar).toEqual(['u2']);
    expect(
      await applySimilar(db, correction.rule as LocalRow<'category_rules'>, correction.similar),
    ).toBe(1);
    expect(await db.transactions.get('u2')).toMatchObject({
      category_id: saude.id,
      review_state: 'ok',
    });
  });

  it('US-28: "Desfazer" apaga a regra criada e a categoria do lançamento continua Saúde', async () => {
    const { db, userId, bySlug } = await seeded();
    const saude = bySlug('saude');
    await db.transactions.put(imported('u1', 'UNIMED PARANA 0001', bySlug('a-classificar').id));
    const before = (await liveRules(db)).length;
    const correction = await correctCategory(
      db,
      userId,
      (await db.transactions.get('u1')) as never,
      saude.id,
    );
    expect((await liveRules(db)).length).toBe(before + 1);
    await undoLearning(db, correction);
    expect((await liveRules(db)).length).toBe(before);
    expect((await db.transactions.get('u1'))?.category_id).toBe(saude.id);
  });

  it('US-28: corrigir de novo a mesma chave atualiza a regra; Desfazer restaura a anterior', async () => {
    const { db, userId, bySlug } = await seeded();
    await db.transactions.bulkPut([
      imported('u1', 'UNIMED PARANA 0001', bySlug('a-classificar').id),
      imported('u2', 'UNIMED PARANA 0002', bySlug('a-classificar').id),
    ]);
    const first = await correctCategory(
      db,
      userId,
      (await db.transactions.get('u1')) as never,
      bySlug('saude').id,
    );
    const second = await correctCategory(
      db,
      userId,
      (await db.transactions.get('u2')) as never,
      bySlug('lazer').id,
    );
    expect(second.rule?.id).toBe(first.rule?.id);
    expect(second.rule?.category_id).toBe(bySlug('lazer').id);
    await undoLearning(db, second);
    expect((await db.category_rules.get(first.rule?.id ?? ''))?.category_id).toBe(
      bySlug('saude').id,
    );
  });

  it('US-28: escolher a categoria sugerida soma hits na regra', async () => {
    const { db, userId, bySlug } = await seeded();
    const rules = await liveRules(db);
    const posto = rules.find((r) => r.pattern === 'POSTO');
    if (!posto) {
      throw new Error('seed POSTO');
    }
    await db.transactions.put(imported('p1', 'AUTO POSTO SAO JOSE', bySlug('lazer').id));
    const correction = await correctCategory(
      db,
      userId,
      (await db.transactions.get('p1')) as never,
      posto.category_id,
    );
    expect(correction.rule).toBeNull();
    expect(await db.category_rules.get(posto.id)).toMatchObject({ hits: posto.hits + 1 });
    expect((await db.category_rules.get(posto.id))?.last_hit_at).not.toBeNull();
  });

  it('US-28: precedência — "POSTO SHELL SELECT MOURAO" fica com a regra de termo mais longo', async () => {
    const { db, bySlug } = await seeded();
    const categories = (await db.categories.toArray()).map(categoryFromRow);
    const rule = (id: string, pattern: string, categoryId: string): CategoryRule => ({
      id,
      matchField: 'description',
      matchType: 'token_prefix',
      pattern,
      categoryId,
      accountId: null,
      cardId: null,
      paymentMethod: null,
      source: 'learned',
      priority: 0,
      hits: 0,
      lastHitAt: null,
      enabled: true,
    });
    const result = categorize(
      { description: 'POSTO SHELL SELECT MOURAO', kind: 'expense' },
      [
        rule('a', 'POSTO', bySlug('combustivel').id),
        rule('b', 'POSTO SHELL SELECT', bySlug('lazer').id),
      ],
      categories,
    );
    expect(result?.categoryId).toBe(bySlug('lazer').id);
    expect(
      ruleMatches(
        rule('c', 'POSTO', 'x'),
        { description: 'IMPOSTO MUNICIPAL', kind: 'expense' },
        normalizeDescription('IMPOSTO MUNICIPAL'),
      ),
    ).toBe(false);
  });

  it('US-28: termo curto — corrigir "BAR" não cria regra', async () => {
    const { db, userId, bySlug } = await seeded();
    await db.transactions.put(imported('b1', 'BAR', bySlug('a-classificar').id));
    const before = (await liveRules(db)).length;
    const correction = await correctCategory(
      db,
      userId,
      (await db.transactions.get('b1')) as never,
      bySlug('lazer').id,
    );
    expect(correction.rule).toBeNull();
    expect((await liveRules(db)).length).toBe(before);
    expect((await db.transactions.get('b1'))?.category_id).toBe(bySlug('lazer').id);
  });
});

describe('T02 — Mudar categoria (UX §3 T02)', () => {
  it('US-28: o toast "Regra criada: \'UNIMED PARANA\' → Saúde" oferece Desfazer e a T02 oferece "Aplicar a mais 1 parecidos"', async () => {
    const { auth, db, bySlug } = await seeded();
    await db.transactions.bulkPut([
      imported('u1', 'UNIMED PARANA 0001', bySlug('a-classificar').id),
      imported('u2', 'UNIMED PARANA 0002', bySlug('a-classificar').id),
    ]);
    const router = createMemoryRouter(
      [{ path: '/lancamentos/:id', element: <TransactionDetailScreen today="2026-11-06" /> }],
      { initialEntries: ['/lancamentos/u1'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Mudar categoria' }));
    const sheet = await screen.findByTestId('category-correction');
    fireEvent.change(within(sheet).getByLabelText('Categoria'), {
      target: { value: bySlug('saude').id },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText("Regra criada: 'UNIMED PARANA' → Saúde")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('apply-similar'));
    await waitFor(async () =>
      expect((await db.transactions.get('u2'))?.category_id).toBe(bySlug('saude').id),
    );
  });
});
