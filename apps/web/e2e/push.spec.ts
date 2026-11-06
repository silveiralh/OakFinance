import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-063: estados de UI do push (US-38) com Notification e PushManager simulados. O build do E2E usa uma chave
// pública VAPID gerada no próprio build; a inscrição simulada vai de verdade para a RPC upsert_push_subscription.

async function stubPush(page: Page, answer: NotificationPermission) {
  await page.addInitScript((reply) => {
    let current: PushSubscription | null = null;
    const FakeNotification = {
      permission: 'default' as NotificationPermission,
      requestPermission() {
        FakeNotification.permission = reply;
        return Promise.resolve(reply);
      },
    };
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true });
    if ('PushManager' in window) {
      PushManager.prototype.getSubscription = () => Promise.resolve(current);
      PushManager.prototype.subscribe = () => {
        current = {
          endpoint: `https://push.example.test/e2e/${Date.now()}`,
          toJSON: () => ({ keys: { p256dh: 'p256dh-e2e', auth: 'auth-e2e' } }),
          unsubscribe: () => {
            current = null;
            return Promise.resolve(true);
          },
        } as unknown as PushSubscription;
        return Promise.resolve(current);
      };
    }
  }, answer);
}

test('push — permitir ativa os lembretes deste aparelho (Android e computador) ou mostra o guia no iPhone', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await stubPush(page, 'granted');
  await login(page, 'e2e-a@example.test');
  await page.goto('/ajustes/lembretes');
  const state = page.getByTestId('push-state');
  if (testInfo.project.name === 'iphone') {
    await expect(state).toHaveText('Instale o app para receber lembretes');
    await expect(page.getByRole('link', { name: 'Ver como instalar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ativar lembretes' })).toHaveCount(0);
    return;
  }
  await expect(state).toHaveText('Lembretes desativados neste aparelho.');
  await page.getByRole('button', { name: 'Ativar lembretes' }).click();
  await expect(state).toHaveText('Lembretes ativos neste aparelho.');
  await expect(page.getByRole('button', { name: 'Enviar notificação de teste' })).toBeVisible();
  await page.getByRole('button', { name: 'Desativar neste aparelho' }).click();
  await expect(state).toHaveText('Lembretes desativados neste aparelho.');
});

test('push — negar a permissão explica como reativar e os avisos continuam na central', async ({
  page,
}, testInfo) => {
  await stubPush(page, 'denied');
  await login(page, 'e2e-a@example.test');
  await page.goto('/ajustes/lembretes');
  if (testInfo.project.name === 'iphone') {
    // no iPhone fora da Tela de Início não há botão de permissão: só o guia e a central
    await expect(page.getByText('Os avisos continuam na central.')).toBeVisible();
    return;
  }
  await page.getByRole('button', { name: 'Ativar lembretes' }).click();
  await expect(page.getByTestId('push-state')).toHaveText(
    /^Notificações bloqueadas\. Para reativar/,
  );
  await expect(page.getByText('Os avisos continuam na central.')).toBeVisible();
});
