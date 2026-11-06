import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-046: ocultar valores (E13, US-57, RN-103).

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

const MONEY = /R\$\s?\d/;

/** Nenhum valor desenhado na tela (texto renderizado: o que está oculto por CSS não conta). */
async function noMoney(page: Page, where: string) {
  await expect(page.locator('body'), where).not.toContainText(MONEY, { useInnerText: true });
}

test('E13: hide-values — o olho esconde todo "R$ <dígito>" nas telas principais e o Q01 mostra o que se digita', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // usuário B: a preferência vai para a conta e não pode afetar os testes do A que rodam em paralelo
  await login(page, 'e2e-b@example.test');
  await hooks(page);
  const stamp = Date.now();
  const account = await page.evaluate(
    (n) => window.__oakE2E?.addAccount(n) ?? '',
    `Conta olho ${stamp}`,
  );
  const id = await page.evaluate(([a, d]) => window.__oakE2E?.addExpense(a, 4590, d) ?? '', [
    account,
    `Olho ${stamp}`,
  ] as [string, string]);

  // a preferência vai para a conta: sincroniza e, se uma tentativa anterior deixou oculto, volta a mostrar
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.syncNow()), { timeout: 20_000 })
    .toBe(true);
  await page.goto('/');
  const toggle = page.getByTestId('hide-values');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-pressed')) === 'true') {
    await toggle.click();
  }
  await expect(page.getByTestId('home-out')).toHaveText(MONEY);
  const eye = page.getByRole('button', { name: 'Ocultar valores' });
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await eye.click();
  await expect(page.getByRole('button', { name: 'Mostrar valores' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('html')).toHaveAttribute('data-values', 'hidden');
  await expect(page.getByTestId('home-out')).toContainText('R$ ••••');
  await noMoney(page, '/');

  for (const path of ['/lancamentos', `/lancamentos/${id}`, '/cartoes', '/planejar']) {
    await page.goto(path);
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.locator('main [data-screen]')).toBeAttached();
    await noMoney(page, path);
  }

  // lembrado neste aparelho depois de recarregar
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-values', 'hidden');
  await expect(page.getByTestId('home-out')).toContainText('R$ ••••');

  // o valor em digitação continua visível
  await page.goto('/?novo=despesa');
  const keypad = page.getByRole('group', { name: 'Teclado numérico' });
  await keypad.getByRole('button', { name: '1', exact: true }).click();
  await keypad.getByRole('button', { name: '2', exact: true }).click();
  await keypad.getByRole('button', { name: '3', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('R$ 1,23');

  // volta a mostrar para não afetar os outros testes deste usuário
  await page.goto('/');
  await page.getByRole('button', { name: 'Mostrar valores' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-values', 'shown');
});
