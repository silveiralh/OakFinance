import { expect, login, test } from './fixtures/base';

// T-029: AppShell, rotas e CSP. O `vite preview` serve o `_headers` gerado no build (tech §7.1), então a CSP é a
// de produção (sem `upgrade-insecure-requests`/HSTS, que exigem TLS) e a fixture base reprova qualquer violação.

test('E14: a CSP de produção é servida e nenhuma tela viola a política ao navegar', async ({
  page,
}) => {
  await login(page);
  const response = await page.goto('/');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  await expect(page).toHaveTitle('Início · OakFinance');

  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(nav).toBeVisible();
  for (const [label, path, title] of [
    ['Lançamentos', '/lancamentos', 'Lançamentos'],
    ['Cartões', '/cartoes', 'Cartões e faturas'],
    ['Planejar', '/planejar/orcamento', 'Orçamento 50/30/20'],
    ['Início', '/', 'Início'],
  ] as const) {
    await nav.getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(path);
    await expect(page).toHaveTitle(`${title} · OakFinance`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  }
});

test('US-62: landmarks da moldura e link direto servido pelo fallback do SPA', async ({ page }) => {
  await login(page);
  await page.goto('/cartoes/c1/fatura/2026-11');
  await expect(page).toHaveTitle('Fatura do mês · OakFinance');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('main#conteudo')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toHaveAttribute(
    'href',
    '#conteudo',
  );
  await page.goto('/caminho-que-nao-existe');
  await expect(page).toHaveURL('/');
});

test('o + abre o lançamento rápido como sheet sobre a tela atual (?novo=despesa)', async ({
  page,
}) => {
  await login(page);
  await page.goto('/lancamentos');
  // o + da moldura (o vazio da T01 também tem "Novo lançamento", UX §6.5)
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Novo lançamento' })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL('/lancamentos?novo=despesa');
});

test('US-64: G09 mostra "Tentar novamente" e o código do erro, sem perder a moldura', async ({
  page,
}) => {
  await login(page);
  await page.goto('/__erro');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Não foi possível carregar esta tela.');
  await expect(alert).toContainText('Seus dados estão seguros.');
  await expect(page.getByTestId('screen-error')).toContainText(/E-[0-9A-Z]{6}/);
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar esta tela.');
});
