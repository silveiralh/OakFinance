import { expect, test } from './fixtures/base';

// T-037, E16: instalação guiada. Com o user agent do iPhone fora do modo instalado, o guia do Safari vem antes do
// login; aberto pelo ícone (standalone), o guia não aparece.
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

test.use({ userAgent: IPHONE });

test('E16: iPhone no Safari → "Começar" abre o guia "Compartilhar → Adicionar à Tela de Início" antes do login', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL('/boas-vindas');
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page).toHaveURL('/instalar?p=ios');
  await expect(page).toHaveTitle('Instalar no iPhone · OakFinance');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Instale o OakFinance no iPhone',
  );
  const steps = page.getByRole('listitem');
  await expect(steps.nth(0)).toContainText('Compartilhar');
  await expect(steps.nth(1)).toContainText('Adicionar à Tela de Início');
  await expect(steps.nth(2)).toContainText('Adicionar');
  await page.getByRole('button', { name: 'Continuar no navegador por enquanto' }).click();
  await expect(page).toHaveURL('/entrar');
});

test('E16: em display-mode standalone (aberto pelo ícone) o guia fica oculto', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  });
  await page.goto('/boas-vindas');
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page).toHaveURL('/entrar');
  await page.goto('/instalar?p=ios');
  await expect(page).toHaveURL('/entrar');
  await expect(page.getByText('Adicionar à Tela de Início')).toHaveCount(0);
});
