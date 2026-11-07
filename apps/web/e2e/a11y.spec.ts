import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-096: E12 completo (UX §8, WCAG 2.1 AA) — axe sem violações sérias ou críticas nas telas da UX §8, nos temas
// claro e escuro com transparência sólida; sem rolagem horizontal de 360 a 1440 px (360 px = zoom de 200% numa
// janela de 720 px, 1.4.10); controles com pelo menos 48 px (2.5.5) e foco visível (2.4.7).
// `label-content-name-mismatch` fica de fora: a UX §5.19 manda o rótulo completo da linha de lançamento
// ("Despesa de −R$ 32,90, Padaria, …"), que diz o mesmo que o texto visível em outra ordem (D-071).

test.use({ reducedMotion: 'reduce' });

/** Telas da UX §8 que existem como rota (Q01 é a sheet `?novo=despesa`; T02, C02 e P04 precisam de id). */
const SCREENS = [
  { id: 'H01', path: '/' },
  { id: 'H02', path: '/avisos' },
  { id: 'Q01', path: '/?novo=despesa' },
  { id: 'T01', path: '/lancamentos' },
  { id: 'C01', path: '/cartoes' },
  { id: 'P01', path: '/planejar/orcamento' },
  { id: 'P02', path: '/planejar/reserva' },
  { id: 'P03', path: '/planejar/futuro' },
  { id: 'I03', path: '/importar' },
  { id: 'I05', path: '/conferir' },
  { id: 'S06', path: '/ajustes/calculo' },
  { id: 'S10', path: '/ajustes/dados' },
] as const;

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

/** Conta, renda e uma despesa: as telas mostram conteúdo, não só o estado vazio. */
async function seed(page: Page) {
  await hooks(page);
  const account = await page.evaluate(
    (n) => window.__oakE2E?.addAccount(n) ?? '',
    `Conta a11y ${Date.now()}`,
  );
  await page.evaluate((a) => window.__oakE2E?.addIncome(a, 500000, 'Renda a11y'), account);
  await page.evaluate(([a, d]) => window.__oakE2E?.addExpense(a, 4590, d), [
    account,
    'Mercado a11y',
  ] as [string, string]);
  return account;
}

async function open(page: Page, path: string, theme: 'light' | 'dark') {
  await page.goto(path);
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.glass = 'solid';
  }, theme);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  // a tela termina de carregar os dados locais
  await page.waitForLoadState('networkidle');
}

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['label-content-name-mismatch'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`E12: axe sem violações sérias nas telas da UX §8 (${theme === 'light' ? 'claro' : 'escuro'}, transparência sólida)`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await login(page, 'e2e-a@example.test');
    await seed(page);
    // primeira visita aquece a moldura (fontes e ícones); as medições vêm depois
    await open(page, '/lancamentos', theme);
    const found: string[] = [];
    for (const screen of SCREENS) {
      await open(page, screen.path, theme);
      found.push(...(await seriousViolations(page)).map((v) => `${screen.id} ${v}`));
    }
    expect(found).toEqual([]);
  });
}

test('E12: de 360 a 1440 px, nenhuma tela rola na horizontal (1.4.10)', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'e2e-a@example.test');
  await seed(page);
  const overflow: string[] = [];
  for (const width of [360, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const screen of SCREENS) {
      await open(page, screen.path, 'light');
      const extra = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (extra > 0) {
        overflow.push(`${screen.id} @${width}px: +${extra}px`);
      }
    }
  }
  expect(overflow).toEqual([]);
});

test('E12: controles com pelo menos 48 px e foco visível (2.5.5, 2.4.7)', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'e2e-a@example.test');
  await seed(page);
  const small: string[] = [];
  for (const screen of SCREENS.filter((s) => s.id !== 'Q01')) {
    await open(page, screen.path, 'light');
    small.push(
      ...(
        await page.evaluate(() =>
          [...document.querySelectorAll('main button, main a[href], nav button, nav a[href]')]
            // o Switch (52×32) fica numa linha de 48 px que toda ela liga e desliga (UX §5.14)
            .filter((el) => !el.closest('.switch-row') && !el.classList.contains('sr-only'))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && (r.width < 48 || r.height < 48);
            })
            .map((el) => {
              const r = el.getBoundingClientRect();
              return `${(el.textContent ?? '').trim().slice(0, 30) || el.getAttribute('aria-label')} ${Math.round(r.width)}×${Math.round(r.height)}`;
            }),
        )
      ).map((s) => `${screen.id}: ${s}`),
    );
  }
  expect(small).toEqual([]);

  // foco visível: os primeiros controles alcançados pelo Tab ganham contorno ou anel (sombra diferente da normal)
  await open(page, '/', 'light');
  const missing: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const result = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) {
        return null;
      }
      const focused = getComputedStyle(el);
      const outline = focused.outlineStyle !== 'none' && focused.outlineWidth !== '0px';
      const shadow = focused.boxShadow;
      const name = `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 20) || el.getAttribute('aria-label')}`;
      el.blur();
      const plain = getComputedStyle(el).boxShadow;
      el.focus({ focusVisible: true } as FocusOptions);
      return outline || shadow !== plain ? null : name;
    });
    if (result) {
      missing.push(result);
    }
  }
  expect(missing).toEqual([]);
});
