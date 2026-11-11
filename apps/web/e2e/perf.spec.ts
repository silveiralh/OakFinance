import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-097: desempenho com 5.000 lançamentos no aparelho (RN-51, US-15, US-30; tech §8.4, DoD 7): recálculo do painel
// < 200 ms, painel < 1,5 s com dados locais, lista do mês e busca, e o lançamento rápido grava em < 200 ms. Os
// lançamentos entram direto no banco local (sem fila), num usuário só deste cenário.

const VOLUME = 5000;

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

async function seeded(page: Page, project: string) {
  await login(page, `e2e-perf-${project}@example.test`);
  await hooks(page);
  const account = await page.evaluate(
    (n) => window.__oakE2E?.addAccount(n) ?? '',
    `Conta volume ${Date.now()}`,
  );
  await page.evaluate((a) => window.__oakE2E?.addIncome(a, 900000, 'Renda volume'), account);
  expect(
    await page.evaluate(([a, n]) => window.__oakE2E?.seedTransactions(a, n), [account, VOLUME] as [
      string,
      number,
    ]),
  ).toBe(VOLUME);
  return account;
}

test('RN-51: com 5.000 lançamentos, o painel recalcula em menos de 200 ms e abre em menos de 1,5 s', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await seeded(page, info.project.name);
  const median = await page.evaluate(() => window.__oakE2E?.measureHome(7) ?? Number.NaN);
  expect(median, `recálculo mediano: ${median.toFixed(1)} ms`).toBeLessThan(200);

  // painel com os dados locais (DoD 7)
  const started = Date.now();
  await page.goto('/');
  await expect(page.getByTestId('home-hero')).toHaveAttribute('data-available', /^-?\d+$/, {
    timeout: 10_000,
  });
  const elapsed = Date.now() - started;
  expect(elapsed, `painel em ${elapsed} ms`).toBeLessThan(1500);
});

test('US-15: com 5.000 lançamentos, a lista do mês abre e a busca filtra sem travar; o lançamento grava em menos de 200 ms', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const account = await seeded(page, info.project.name);
  const started = Date.now();
  await page.goto('/lancamentos');
  await expect(page.getByTestId('screen-T01')).toBeVisible();
  await expect(page.getByText('Volume 0', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  const listMs = Date.now() - started;
  expect(listMs, `lista em ${listMs} ms`).toBeLessThan(1500);

  // um lançamento com nome único no meio do volume
  // nome único por tentativa: uma repetição no mesmo usuário não encontra o lançamento da anterior
  const unique = `Padaria Esquina ${Date.now().toString(36)}`;
  await page.evaluate(([a, d]) => window.__oakE2E?.addExpense(a, 2590, d), [account, unique] as [
    string,
    string,
  ]);
  const searchStarted = Date.now();
  await page.getByLabel('Buscar lançamentos').fill(unique.toLowerCase());
  await expect(page.getByText(unique, { exact: true })).toBeVisible();
  await expect(page.getByText('Volume 0', { exact: true })).toHaveCount(0);
  const searchMs = Date.now() - searchStarted;
  expect(searchMs, `busca em ${searchMs} ms`).toBeLessThan(1500);

  // lançamento rápido: gravar no aparelho com o volume (UX §3 Q01: salvando < 100 ms; teto 200 ms). A gravação
  // é medida com o app parado, como quando a pessoa abre o Q01 e digita: o sync da escrita anterior (push, pull e
  // a releitura ao vivo da T01) termina antes. Uma escrita no meio de um sync espera a transação dele (HANDOFF §5).
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.syncNow()), { timeout: 20_000 })
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.__oakE2E?.pending())).toBe(0);
  const saves = await page.evaluate(async (a) => {
    const settle = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 300)));
      });
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      // a releitura ao vivo das 5.000 linhas depois do sync pode passar de 300 ms no WebKit; a medição começa
      // quando ela termina (issue #119: a 1ª gravação esperava a leitura da T01 e media 264 a 425 ms)
      await settle();
      await window.__oakE2E?.idle();
      await settle();
      const t0 = performance.now();
      await window.__oakE2E?.addExpense(a, 1234 + i, `Rápido com volume ${i}`);
      times.push(performance.now() - t0);
      // o sync disparado pela gravação termina antes da próxima medição
      await window.__oakE2E?.syncNow();
    }
    return times;
  }, account);
  for (const saveMs of saves) {
    expect(saveMs, `gravações em ${saves.map((ms) => ms.toFixed(1)).join(', ')} ms`).toBeLessThan(
      200,
    );
  }
});
