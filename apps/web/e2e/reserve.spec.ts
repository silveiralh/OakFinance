import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-060: P02 Reserva de emergência (US-33, RN-36, RN-54). Os números exatos (sugestão, meta manual, progresso de
// 13%, resgate e marco) rodam em `test/reserve.test.tsx`; aqui, guardar e resgatar pela tela com o Supabase local.

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

async function typeAmount(page: Page, digits: string) {
  const input = page.getByTestId('reserve-move').locator('.amount-input');
  await expect(input).toBeVisible();
  for (const d of digits) {
    await input.press(d);
  }
}

test('reserve — guardar e registrar uso da reserva pela P02 entram no histórico', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const stamp = Date.now();
  await page.evaluate((n) => window.__oakE2E?.addAccount(n) ?? '', `Conta reserva ${stamp}`);
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.syncNow()), { timeout: 20_000 })
    .toBe(true);

  await page.goto('/planejar/reserva');
  await hooks(page);
  await expect(page.getByTestId('reserve-goal')).toBeVisible();

  // valores únicos por execução (os 3 projetos usam o mesmo usuário); a fila de toasts não é confiável aqui
  const saveCents = 1000 + (stamp % 8000);
  const outCents = 100 + (stamp % 800);
  const brl = (c: number) => `R$ ${Math.floor(c / 100)},${String(c % 100).padStart(2, '0')}`;
  const summary = page.getByTestId('reserve-summary');
  await summary.getByRole('button', { name: 'Guardar' }).click();
  await typeAmount(page, String(saveCents));
  await page.getByTestId('reserve-move-submit').click();
  await expect(page.getByTestId('reserve-move')).toBeHidden();

  await summary.getByRole('button', { name: 'Registrar uso da reserva' }).click();
  await typeAmount(page, String(outCents));
  await page.getByTestId('reserve-move-submit').click();
  await expect(page.getByTestId('reserve-move')).toBeHidden();

  const history = page.getByRole('region', { name: 'Aportes e retiradas' });
  await expect(history.getByText(`+${brl(saveCents)}`)).toBeVisible();
  await expect(history.getByText(`\u2212${brl(outCents)}`)).toBeVisible();
});
