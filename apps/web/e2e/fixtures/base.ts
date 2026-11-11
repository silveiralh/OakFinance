import { test as base, expect, type Page, type TestInfo } from '@playwright/test';

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
 * E-mail de um usuário que só este cenário, neste projeto e nesta tentativa usa (`seed.sql`, índices 0 a 9).
 * O nightly roda com `--repeat-each=3` e uma nova tentativa: quem conta a fila ou depende do que a conta já
 * aprendeu não pode herdar os dados da repetição anterior.
 */
export function freshUser(
  scenario:
    | 'inbox'
    | 'nfce-fallback'
    | 'a11y-reflow'
    | 'analysis'
    | 'close'
    | 'hide-values'
    | 'open-finance',
  info: Pick<TestInfo, 'project' | 'repeatEachIndex' | 'retry'>,
): string {
  const n = info.repeatEachIndex * 2 + info.retry;
  if (n > 9) {
    throw new Error(`freshUser: índice ${n} fora do seed.sql (0 a 9)`);
  }
  return `e2e-${scenario}-${info.project.name}-${n}@example.test`;
}

/**
 * Entra pelo formulário de teste do build E2E (Supabase local com e-mail e senha, tech §8.4). O usuário é da
 * allowlist de teste do `seed.sql`; na primeira vez o formulário cria a conta.
 */
export async function login(page: Page, email = 'e2e-a@example.test') {
  await page.goto('/entrar');
  const form = page.locator('form[data-e2e-login]');
  await form.locator('input[type="email"]').fill(email);
  await form.getByRole('button', { name: 'Entrar (teste)' }).click();
  // na primeira vez o formulário cria a conta, o que pode passar de 5 s no começo de um shard
  await expect(page).toHaveURL('/', { timeout: 20_000 });
  await expect(page.getByTestId('app-shell')).toBeVisible();
}
