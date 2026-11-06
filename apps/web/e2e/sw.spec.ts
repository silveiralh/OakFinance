import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-030: PWA e Service Worker. O Playwright só controla Service Worker no Chromium (android e desktop); no WebKit
// (iphone) estes cenários conferem o que dá para conferir sem SW: manifest, ícones e a meta do iPhone.

/** Espera o SW ativo e recarrega uma vez, para a página passar a ser controlada por ele. */
async function controlledBySw(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}

test('US-03: manifest instalável, apple-touch-icon e título no iPhone', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'OakFinance',
  );
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({
    name: 'OakFinance',
    short_name: 'OakFinance',
    display: 'standalone',
    start_url: '/?origem=pwa',
  });
  for (const icon of [
    ...manifest.icons.map((i: { src: string }) => i.src),
    '/apple-touch-icon.png',
  ]) {
    const response = await request.get(icon);
    expect(response.status(), icon).toBe(200);
    expect(response.headers()['content-type'], icon).toBe('image/png');
  }
});

test('US-03: depois do primeiro acesso, o app abre sem rede em menos de 1,5 s', async ({
  page,
  context,
  browserName,
}) => {
  if (browserName !== 'chromium') {
    await login(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início');
    return;
  }
  await login(page);
  await controlledBySw(page, '/');
  await context.setOffline(true);
  const started = Date.now();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início');
  expect(Date.now() - started).toBeLessThan(1500);
  // link direto também sai do precache (NavigationRoute)
  await page.goto('/cartoes/c1/fatura/2026-11');
  await expect(page).toHaveTitle('Fatura do mês · OakFinance');
  await context.setOffline(false);
});

test('E15: nova versão → "Atualizar" → recarrega sem perder o lançamento em digitação', async ({
  page,
  context,
  browserName,
}) => {
  if (browserName !== 'chromium') {
    await login(page);
    await page.goto('/lancamentos');
    await expect(page.getByText('Nova versão disponível.')).toHaveCount(0);
    return;
  }
  await login(page);
  await controlledBySw(page, '/lancamentos');
  // o vite preview devolve um sw.js com outros bytes para este contexto (cookie), como num deploy novo
  await context.addCookies([{ name: 'oak-sw-bump', value: '1', url: 'http://localhost:4173' }]);
  await page.getByRole('button', { name: 'Novo lançamento' }).click();
  await expect(page).toHaveURL('/lancamentos?novo=despesa');
  await page.evaluate(() => {
    (window as Window & { __marca?: number }).__marca = 1;
  });
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await expect(page.getByText('Nova versão disponível.')).toBeAttached();
  const changed = page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        });
      }),
  );
  // o Q01 é modal: o toque em "Atualizar" vem pelo gancho do E2E (mesma função do botão)
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
  await page.evaluate(() => window.__oakE2E?.applyUpdate());
  await changed;
  // com o lançamento aberto a página não recarrega
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as Window & { __marca?: number }).__marca)).toBe(1);
  // fechou o sheet: agora recarrega na versão nova
  const reloaded = page.waitForEvent('load');
  await page.goBack();
  await reloaded;
  await expect(page).toHaveURL('/lancamentos');
  expect(
    await page.evaluate(() => (window as Window & { __marca?: number }).__marca),
  ).toBeUndefined();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lançamentos');
});
