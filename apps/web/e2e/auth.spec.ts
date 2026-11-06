import { expect, login, test } from './fixtures/base';

// T-034: login, guarda de rota, G14 e saída com alterações pendentes (E20). O Google OAuth não é automatizável:
// o build E2E entra por e-mail e senha no Supabase local (tech §8.4).

test('US-01: sem sessão, o app abre nas boas-vindas e não mostra as telas do app', async ({
  page,
}) => {
  await page.goto('/lancamentos');
  await expect(page).toHaveURL('/boas-vindas');
  await expect(page.getByTestId('app-shell')).toHaveCount(0);
});

test('US-01: depois do login, /entrar leva ao Início', async ({ page }) => {
  await login(page);
  await page.goto('/entrar');
  await expect(page).toHaveURL('/');
  await expect(page).toHaveTitle('Início · OakFinance');
});

test('G14: retorno do Google recusado pelo hook mostra "Este app é de uso privado."', async ({
  page,
}) => {
  await page.goto(
    '/auth/callback?error=server_error&error_description=Este%20app%20%C3%A9%20de%20uso%20privado.',
  );
  await expect(page).toHaveURL('/entrar?erro=privado');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Este app é de uso privado.');
  await expect(alert).toContainText('Esta conta Google não tem acesso.');
  await expect(page.getByRole('button', { name: 'Entrar com outra conta' })).toBeVisible();
});

test('E20: sair com alterações pendentes avisa, "Enviar e sair" envia e apaga o banco local', async ({
  page,
  context,
}) => {
  await login(page, 'e2e-b@example.test');
  await page.goto('/ajustes');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configurações');
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
  const dbName = await page.evaluate(() => window.__oakE2E?.dbName ?? '');
  expect(dbName).toMatch(/^oakfinance_/);

  await context.setOffline(true);
  await page.evaluate(() => window.__oakE2E?.addAccount('Conta do E2E'));
  await expect.poll(() => page.evaluate(() => window.__oakE2E?.pending())).toBe(1);

  await page.getByRole('button', { name: 'Sair' }).click();
  const dialog = page.getByTestId('g16');
  await expect(dialog).toContainText('Há 1 alterações que ainda não foram para a nuvem.');
  await expect(dialog.getByRole('button', { name: 'Sair e descartar' })).toBeVisible();

  await context.setOffline(false);
  await dialog.getByRole('button', { name: 'Enviar e sair' }).click();
  await expect(page).toHaveURL('/entrar');
  const names = await page.evaluate(async () =>
    (await indexedDB.databases()).map((db) => db.name ?? ''),
  );
  expect(names).not.toContain(dbName);

  // entrando de novo, a conta enviada volta do servidor
  await login(page, 'e2e-b@example.test');
  await page.goto('/ajustes');
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.accountNames()), { timeout: 15_000 })
    .toContain('Conta do E2E');
});
