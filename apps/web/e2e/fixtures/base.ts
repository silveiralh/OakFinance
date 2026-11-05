import { test as base, expect } from '@playwright/test';

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
