import type { Page } from '@playwright/test';
import { expect, freshUser, login, test } from './fixtures/base';

// E10 (T-076, US-45/US-46) até a caixa de revisão: conectar pelo widget (FakePluggyConnect do build E2E) → mapear
// as contas (vincular a conta, criar o cartão pré-preenchido) → backfill → "Conferir agora" abre a I05.
// As Edge Functions da Pluggy e a RPC de mapeamento são respondidas pelo teste via `window.__oakE2EPluggyApi`
// (sem os segredos do SETUP-13 elas devolvem 502 no Supabase local); o cartão criado sobe pelo sync de verdade.

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
  // o page.goto recarrega a página: o item do mock e as respostas das funções entram por script de inicialização
  await page.addInitScript((t) => {
    const calls: Array<{ name: string; body: unknown }> = [];
    const w = window as unknown as Record<string, unknown>;
    w.__oakE2EPluggyItem = 'mock-item-nubank';
    w.__oakE2EPluggyCalls = calls;
    w.__oakE2EPluggyApi = {
      respond(name: string, body: unknown) {
        calls.push({ name, body });
        if (name === 'pluggy-connect-token') {
          return {
            connectToken: 'mock-connect-token',
            connectorIds: [200],
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          };
        }
        if (name === 'pluggy-link-item') {
          return {
            connectionId: '8f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
            status: 'UPDATED',
            accounts: [
              {
                id: '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d',
                type: 'BANK',
                subtype: 'CHECKING_ACCOUNT',
                name: `Conta ${t}`,
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
                name: `Cartão ${t}`,
                numberMasked: '0002',
                accountId: null,
                cardId: null,
                isIgnored: false,
                suggestion: { closingDay: 3, dueDay: 10, limitCents: 500000 },
              },
            ],
          };
        }
        if (name === 'pluggy-sync') {
          return {
            jobRunId: '1',
            stats: { accounts: 2, inserted: 2, updated: 0, deleted: 0, bills: 0 },
          };
        }
        return null; // map_external_account
      },
    };
  }, tag);

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
  const calls = (await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__oakE2EPluggyCalls,
  )) as Array<{ name: string; body: Record<string, unknown> }>;
  expect(calls.map((c) => c.name)).toEqual([
    'pluggy-connect-token',
    'pluggy-link-item',
    'map_external_account',
    'map_external_account',
    'pluggy-sync',
  ]);
  expect(calls[1]?.body).toEqual({ itemId: 'mock-item-nubank' });
  expect(calls[2]?.body).toMatchObject({ p_account_id: account, p_is_ignored: false });
  expect(calls[3]?.body).toMatchObject({ p_account_id: null, p_is_ignored: false });
  expect(calls[3]?.body.p_card_id).toEqual(expect.any(String));
  expect(calls[4]?.body).toEqual({
    connectionId: '8f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
    mode: 'backfill',
    days: 90,
  });

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
