import { expect, login, test } from './fixtures/base';

// T-086: E08 — CSV pelo assistente de colunas (perfil genérico): prévia das primeiras linhas, importação e o
// mapeamento lembrado para a conta na próxima vez.
const CSV = 'Dt;Hist;Vlr\n03/11/2026;MERCADO EXEMPLO;-45,90\n04/11/2026;SALARIO EXEMPLO;3000,00\n';

test('E08: CSV desconhecido pelo assistente de colunas, com o perfil salvo para a conta', async ({
  page,
}, info) => {
  await login(page, `e2e-csv-${info.project.name}@example.test`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
  // conta nova a cada tentativa (uma repetição não encontra a importação da anterior)
  const name = `Conta E08 ${info.project.name} ${Date.now()}`;
  await page.evaluate((n) => window.__oakE2E?.addAccount(n), name);
  const file = (suffix: string) => ({
    name: `banco-${suffix}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(`${CSV}${suffix === 'b' ? '05/11/2026;PADARIA EXEMPLO;-7,00\n' : ''}`),
  });

  await page.goto('/importar');
  await expect(page.getByTestId('screen-I03')).toBeVisible();
  await page.getByTestId('import-file').setInputFiles(file('a'));
  await expect(page.getByTestId('column-mapper')).toBeVisible();
  await expect(page.getByTestId('csv-detected')).toHaveCount(0);
  await page.getByLabel('Importar para').selectOption({ label: name });
  await expect(page.getByTestId('csv-preview').locator('tr')).toHaveCount(2);
  await expect(page.getByTestId('import-summary')).toHaveText(
    '2 lançamentos · 0 já existem (serão ignorados) · 0 parecidos com lançamentos seus (vão para conferência)',
  );
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('import-recent')).toBeVisible();

  // outro arquivo do mesmo banco: o mapeamento salvo é usado
  await page.getByTestId('import-file').setInputFiles(file('b'));
  await page.getByLabel('Importar para').selectOption({ label: name });
  await expect(page.getByTestId('csv-detected')).toHaveText('Formato detectado: Outro banco');
  await expect(page.getByTestId('import-summary')).toHaveText(
    '3 lançamentos · 2 já existem (serão ignorados) · 0 parecidos com lançamentos seus (vão para conferência)',
  );
});
