import type { Page, Route } from '@playwright/test';
import { expect, freshUser, login, test } from './fixtures/base';

// E10 (T-076, US-45/US-46) até a caixa de revisão: conectar pelo widget (FakePluggyConnect do build E2E) → mapear
// as contas (vincular a conta, criar o cartão pré-preenchido) → backfill → "Conferir agora" abre a I05.
// As Edge Functions da Pluggy e a RPC de mapeamento são respondidas pelo teste (sem os segredos do SETUP-13 elas
// devolvem 502 no Supabase local); o cartão criado sobe pelo sync de verdade antes da RPC.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'content-type': 'application/json',
};

function reply(route: Route, body: unknown) {
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: CORS, body: '' });
  }
  return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(body) });
}

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

test('E10: conectar, mapear, buscar 90 dias e abrir a caixa de revisão', async ({ page }, info) => {
  await login(page, freshUser('open-finance', info));
  await hooks(page);
  const tag = `${info.project.name}-${Date.now()}`;
  const account = await page.evaluate((n) => window.__oakE2E?.addAccount(n) ?? '', `Conta ${tag}`);
  // o que o backfill traria: um lançamento novo do banco na conta vinculada
  await page.evaluate(([a, d]) => window.__oakE2E?.addImported(a, 4990, d, 'new'), [
    account,
    `MERCADO BANCO ${tag}`,
  ] as [string, string]);
  await page.evaluate(() => {
    window.__oakE2EPluggyItem = 'mock-item-nubank';
  });

  const linked: unknown[] = [];
  const mapped: unknown[] = [];
  const synced: unknown[] = [];
  await page.route('**/functions/v1/pluggy-connect-token', (route) =>
    reply(route, {
      connectToken: 'mock-connect-token',
      connectorIds: [200],
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  );
  await page.route('**/functions/v1/pluggy-link-item', (route) => {
    if (route.request().method() === 'POST') {
      linked.push(route.request().postDataJSON());
    }
    return reply(route, {
      connectionId: '8f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
      status: 'UPDATED',
      accounts: [
        {
          id: '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d',
          type: 'BANK',
          subtype: 'CHECKING_ACCOUNT',
          name: `Conta ${tag}`,
          numberMasked: '0001',
          accountId: null,
          cardId: null,
          isIgnored: false,
          suggestion: null,
        },
        {
          id: '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e',
          type: 'CREDIT',
          subtype: 'CREDIT_CARD',
          name: `Cartão ${tag}`,
          numberMasked: '0002',
          accountId: null,
          cardId: null,
          isIgnored: false,
          suggestion: { closingDay: 3, dueDay: 10, limitCents: 500000 },
        },
      ],
    });
  });
  await page.route('**/rest/v1/rpc/map_external_account', (route) => {
    if (route.request().method() === 'POST') {
      mapped.push(route.request().postDataJSON());
    }
    return reply(route, null);
  });
  await page.route('**/functions/v1/pluggy-sync', (route) => {
    if (route.request().method() === 'POST') {
      synced.push(route.request().postDataJSON());
    }
    return reply(route, {
      jobRunId: '1',
      stats: { accounts: 2, inserted: 2, updated: 0, deleted: 0, bills: 0 },
    });
  });

  await page.goto('/ajustes/conexoes');
  await expect(page.getByTestId('screen-I01')).toBeVisible();
  await page.getByRole('button', { name: 'Conectar banco' }).click();
  await expect(page.getByTestId('screen-I02')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Autorizar (teste)' }).click();

  const mapping = page.getByTestId('connect-mapping');
  await expect(mapping).toBeVisible();
  await expect(mapping.getByLabel(`Conta ${tag} · 0001`)).toHaveValue(`account:${account}`);
  await expect(mapping.getByLabel(`Cartão ${tag} · 0002`)).toHaveValue('create');
  await expect(mapping.getByLabel('Dia de fechamento')).toHaveValue('3');
  await expect(mapping.getByLabel('Dia de vencimento')).toHaveValue('10');
  await page.getByRole('button', { name: 'Salvar e importar' }).click();

  const result = page.getByTestId('connect-result');
  await expect(result).toBeVisible({ timeout: 20_000 });
  await expect(result.getByText(/^2 lançamentos importados\./)).toBeVisible();
  expect(linked).toEqual([{ itemId: 'mock-item-nubank' }]);
  expect(mapped).toHaveLength(2);
  expect(mapped[0]).toMatchObject({ p_account_id: account, p_is_ignored: false });
  expect(mapped[1]).toMatchObject({ p_account_id: null, p_is_ignored: false });
  expect(synced).toEqual([
    { connectionId: '8f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', mode: 'backfill', days: 90 },
  ]);

  await result.getByRole('button', { name: 'Conferir agora' }).click();
  await expect(page.getByTestId('screen-I05')).toBeVisible();
  await expect(page.getByText(`MERCADO BANCO ${tag}`)).toBeVisible();
});

test('US-45: sem rede, "Conectar banco" fica indisponível com "Precisa de internet"', async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto('/ajustes/conexoes');
  await expect(page.getByTestId('screen-I01')).toBeVisible();
  await context.setOffline(true);
  const connect = page.getByRole('button', { name: /Conectar banco/ });
  await expect(connect).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('Precisa de internet').first()).toBeVisible();
  await context.setOffline(false);
});
