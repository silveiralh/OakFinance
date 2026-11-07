import { expect, login, test } from './fixtures/base';

// T-082: E19 — o checklist do P04 bloqueia com pendência; sem pendência, "Fechar mês" grava `month_closings`;
// "Reabrir para revisão" volta ao checklist. (O aviso ao editar um mês fechado no Q01 está no teste de componente.)
// Um usuário por projeto, para os três navegadores não fecharem o mesmo mês ao mesmo tempo.
test('E19: pendência bloqueia, sem pendência fecha e reabre', async ({ page }, info) => {
  await login(page, `e2e-close-${info.project.name}@example.test`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
  const month = await page.evaluate(() =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    })
      .format(new Date())
      .slice(0, 7),
  );
  const account = await page.evaluate(
    (n) => window.__oakE2E?.addAccount(n) ?? '',
    `Conta ${info.project.name}`,
  );
  await page.evaluate(
    ([a]) => window.__oakE2E?.addImported(a as string, 4321, 'COMPRA BANCO E19', 'suggested'),
    [account],
  );

  await page.goto(`/planejar/fechar/${month}`);
  await expect(page.getByTestId('screen-P04')).toBeVisible();
  await expect(page.getByTestId('close-suggested')).toHaveText('1 lançamentos para conferir');
  await expect(page.getByTestId('close-run')).toHaveAttribute('aria-disabled', 'true');

  // resolve a pendência pelo atalho
  await page.getByTestId('close-suggested').getByRole('link').click();
  await expect(page).toHaveURL(/\/conferir$/);
  await page.getByTestId('reconcile-card').getByRole('button', { name: 'Ignorar' }).click();
  await expect(page.getByTestId('reconcile-card')).toHaveCount(0);

  await page.goto(`/planejar/fechar/${month}`);
  await expect(page.getByText('Nenhuma pendência. O mês pode ser fechado.')).toBeVisible();
  await page.getByTestId('close-run').click();
  await expect(page.getByTestId('close-closed')).toBeVisible();
  await page.getByTestId('close-reopen').click();
  await expect(page.getByTestId('close-checklist')).toBeVisible();
});
