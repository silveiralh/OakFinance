import { test as base, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

/**
 * Fixture base de todos os E2E (tech §8.4, E14):
 * - fuso America/Sao_Paulo e locale pt-BR fixos;
 * - qualquer `securitypolicyviolation` durante o teste reprova o cenário.
 */
export const test = base.extend<{ cspGuard: undefined }>({
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  cspGuard: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (event) => {
          window.__cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      await use(undefined);
      if (page.isClosed() || page.url() === 'about:blank') {
        return;
      }
      const violations = await page.evaluate(() => window.__cspViolations ?? []);
      expect(violations, 'violações de CSP').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Entra pelo formulário de teste do build E2E (Supabase local com e-mail e senha, tech §8.4). O usuário é da
 * allowlist de teste do `seed.sql`; na primeira vez o formulário cria a conta.
 */
export async function login(page: Page, email = 'e2e-a@example.test') {
  await page.goto('/entrar');
  const form = page.locator('form[data-e2e-login]');
  await form.locator('input[type="email"]').fill(email);
  await form.getByRole('button', { name: 'Entrar (teste)' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}
