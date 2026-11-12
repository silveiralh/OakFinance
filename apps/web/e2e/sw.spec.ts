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
  // o + da moldura (o vazio da T01 também tem "Novo lançamento", UX §6.5)
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Novo lançamento' })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL('/lancamentos?novo=despesa');
  await page.evaluate(() => {
    (window as Window & { __marca?: number }).__marca = 1;
  });
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await expect(page.getByText('Nova versão disponível.')).toBeAttached();
  await page.evaluate(() => {
    const w = window as Window & { __swChanged?: boolean };
    w.__swChanged = false;
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        w.__swChanged = true;
      },
      { once: true },
    );
  });
  // o Q01 é modal: o toque em "Atualizar" vem pelo gancho do E2E (mesma função do botão). O que é do app é
  // mandar SKIP_WAITING ao SW em espera: o teste anota as mensagens enviadas a ele e confere.
  await page.evaluate(() => {
    const w = window as Window & { __skipSent?: number };
    w.__skipSent = 0;
    const original = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (this: ServiceWorker, ...args: unknown[]) {
      const data = args[0] as { type?: unknown } | null;
      if (this.state === 'installed' && data?.type === 'SKIP_WAITING') {
        w.__skipSent = (w.__skipSent ?? 0) + 1;
      }
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof original;
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
  await page.evaluate(() => window.__oakE2E?.applyUpdate());
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __skipSent?: number }).__skipSent))
    .toBeGreaterThan(0);
  // Issue #151: o SW em espera recebe o SKIP_WAITING e chama skipWaiting(), mas o Chromium só o ativa quando o SW
  // antigo fica sem trabalho; com a máquina carregada isso às vezes não acontece em minutos (conferido com 8
  // contextos em paralelo: a mensagem chega e o SW novo fica "installed"). O DevTools pede a mesma ativação
  // sem essa espera, e o teste segue esperando o estado certo: o controle da página muda.
  if (!(await page.evaluate(() => (window as Window & { __swChanged?: boolean }).__swChanged))) {
    const cdp = await context.newCDPSession(page);
    // o DevTools precisa conhecer a versão em espera antes do pedido (sem o aviso, segue depois de 5 s)
    const known = new Promise<void>((resolve) => {
      cdp.on('ServiceWorker.workerVersionUpdated', (event) => {
        if (event.versions.some((v) => v.status === 'installed')) {
          resolve();
        }
      });
    });
    await cdp.send('ServiceWorker.enable');
    await Promise.race([known, page.waitForTimeout(5_000)]);
    await cdp.send('ServiceWorker.skipWaiting', { scopeURL: 'http://localhost:4173/' });
    await cdp.detach();
  }
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __swChanged?: boolean }).__swChanged))
    .toBe(true);
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
