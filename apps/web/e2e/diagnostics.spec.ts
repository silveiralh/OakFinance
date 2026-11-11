import { expect, login, test } from './fixtures/base';

// T-071: S11 Diagnóstico (US-64, tech §7.3) — depois do sync do login, mostra a versão, o aparelho, o último
// envio e recebimento, nenhuma rejeitada e os eventos da telemetria (RN-104: `usage.app_aberto`).
test('US-64: o Diagnóstico mostra os dados do sync e os últimos eventos', async ({ page }) => {
  await login(page);
  await page.goto('/ajustes');
  // no WebKit o primeiro toque logo depois do goto às vezes chega antes do roteador assumir (issue #119):
  // repete o toque até a URL mudar
  await expect(async () => {
    await page.getByRole('button', { name: 'Diagnóstico' }).click();
    await expect(page).toHaveURL(/\/ajustes\/diagnostico$/, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByTestId('screen-S11')).toBeVisible();
  await expect(page.getByTestId('diag-version')).not.toHaveText('');
  await expect(page.getByTestId('diag-device')).not.toHaveText('…');
  await expect(page.getByTestId('diag-last-pull')).not.toHaveText('Nunca', { timeout: 20_000 });
  await expect(page.getByTestId('diag-last-push')).not.toHaveText('Nunca');
  await expect(page.getByTestId('diag-rejected-none')).toBeVisible();
  await expect(page.getByTestId('diag-events')).toContainText('usage.app_aberto');
});
