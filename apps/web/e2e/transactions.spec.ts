import { expect, login, test } from './fixtures/base';

// T-043: T01 com o mês, o resumo, os chips e a busca (US-15, US-63).

test('US-15: a lista abre no mês atual, filtra por chip e a busca sem resultado mostra o vazio', async ({
  page,
}) => {
  await login(page, 'e2e-a@example.test');
  await page.goto('/lancamentos');
  await expect(page.getByTestId('screen-T01')).toBeVisible();
  // A T01 continua desenhando (no WebKit ela chegou a parar os quadros): quadros, tamanho do documento e posição do chip em quadros seguidos.
  const probe = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const samples: string[] = [];
        const chip = document.querySelector('.list-chip');
        let n = 0;
        const tick = () => {
          const r = chip?.getBoundingClientRect();
          samples.push(
            `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight} y${Math.round(window.scrollY)} s${window.visualViewport?.scale} chip${r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}` : '-'}`,
          );
          n += 1;
          if (n < 6) {
            requestAnimationFrame(tick);
          } else {
            resolve(samples.join(' | '));
          }
        };
        requestAnimationFrame(tick);
        setTimeout(() => resolve(`sem quadros (${n}): ${samples.join(' | ')}`), 3000);
      }),
  );
  expect(probe, 'a T01 precisa desenhar quadros').not.toMatch(/^sem quadros/);
  await expect(page.getByTestId('list-summary')).toContainText('Entradas');
  const expenses = page.getByRole('button', { name: 'Despesas', exact: true });
  await expenses.click();
  await expect(expenses).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('list-total')).toContainText('Total filtrado:');
  await page.getByLabel('Buscar lançamentos').fill('zzzz sem resultado');
  await expect(page.getByText('Nenhum resultado para "zzzz sem resultado"')).toBeVisible();
  const month = await page.getByTestId('list-month').textContent();
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(page.getByTestId('list-month')).not.toHaveText(month ?? '');
});
