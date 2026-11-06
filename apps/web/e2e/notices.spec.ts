import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-062: Central de avisos (E18, US-37). O aviso é gravado por outro aparelho do mesmo usuário (como o
// reminders-tick gravaria em `notices`) e chega pelo sync: o sino conta, a central abre a tela certa e marca lido,
// e sem rede a central continua com o que já sincronizou. (O job de E2E não recebe a chave de serviço do Supabase
// local, então a Admin API não está disponível aqui; ver D-045.)

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

async function synced(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.syncNow()), { timeout: 20_000 })
    .toBe(true);
}

test('E18: notices — aviso de outro aparelho aparece no sino, abre a tela certa, fica lido e funciona offline', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const stamp = Date.now();

  // "tick": outro contexto grava o aviso e sincroniza
  const other = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const tick = await other.newPage();
  await login(tick, 'e2e-a@example.test');
  await hooks(tick);
  const id = await tick.evaluate(
    (key) =>
      window.__oakE2E?.addNotice(
        key,
        'Internet vence amanhã',
        'R$ 100,00 em 25/11.',
        '/planejar/futuro',
      ) ?? '',
    `e2e:${stamp}`,
  );
  await synced(tick);
  await other.close();

  await synced(page);
  await page.goto('/');
  await hooks(page);
  const bell = page.getByTestId('notices-bell');
  await expect(bell).toHaveAccessibleName(/^Avisos, [1-9]\d* não lidos$/);
  await bell.click();
  await expect(page).toHaveURL('/avisos');
  const item = page.getByTestId(`notice-${id}`);
  await expect(item).toContainText('Internet vence amanhã');
  await expect(item).toContainText('Não lido');

  // sem rede a central mostra o que já está no aparelho
  await page.context().setOffline(true);
  await expect(page.getByTestId('g01')).toBeVisible();
  await expect(item).toContainText('R$ 100,00 em 25/11.');
  await item.getByRole('button').click();
  await expect(page).toHaveURL('/planejar/futuro');
  await page.goBack();
  await expect(page.getByTestId(`notice-${id}`)).not.toContainText('Não lido');
  await page.context().setOffline(false);
});
