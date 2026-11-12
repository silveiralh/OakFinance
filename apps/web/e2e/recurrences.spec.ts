import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-054: conta fixa na S05 (E05, US-25, RN-26..RN-28, RN-31).

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

test('E05: recurrences — o aluguel aparece a vencer e sai do "a vencer" ao ser confirmado', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const stamp = Date.now();
  await page.evaluate((n) => window.__oakE2E?.addAccount(n), `Conta aluguel ${stamp}`);
  const name = `Aluguel ${stamp % 100_000}`;

  await page.goto('/ajustes/renda');
  const sheet = page.getByTestId('expense-sheet');
  // Issue #151: no WebKit o toque em "Nova conta fixa" logo depois do carregamento às vezes não abria a folha
  // (a tela ainda montava as seções de cima e o botão mudava de lugar) e o teste esperava 90 s pelo campo.
  // Toca de novo enquanto a folha não estiver aberta, e só segue com ela aberta.
  await expect(async () => {
    if (!(await sheet.isVisible())) {
      await page.getByRole('button', { name: 'Nova conta fixa' }).click({ timeout: 5_000 });
    }
    await expect(sheet.getByLabel('Descrição')).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await sheet.getByLabel('Descrição').fill(name);
  const amount = sheet.getByLabel('Valor', { exact: true });
  for (const d of '110000') {
    await amount.press(d);
  }
  await sheet.getByLabel('Dia do mês').fill('28');
  await sheet.getByLabel('Pago com').selectOption({ label: `Pix · Conta aluguel ${stamp}` });
  await sheet.getByRole('button', { name: 'Salvar' }).click();

  const card = page
    .getByRole('heading', { name, level: 3 })
    .locator('xpath=ancestor::*[.//*[@data-testid="expense-current"]][1]');
  const current = card.getByTestId('expense-current');
  await expect(current).toHaveText(
    /^(Prevista para|Atrasada desde) 28\/\d{2}\/\d{4} · R\$\s1\.100,00$/,
  );
  await card.getByRole('button', { name: 'Confirmar' }).click();
  const confirm = page.getByTestId('expense-confirm-sheet');
  await confirm.getByRole('button', { name: 'Confirmar' }).click();
  await expect(current).toHaveText(/^Paga em 28\/\d{2}\/\d{4} · R\$\s1\.100,00$/);
  await expect(card.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
});
