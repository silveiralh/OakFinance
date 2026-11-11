import { readFileSync } from 'node:fs';
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

// Issue #128 / T-087: os dois arquivos do Nubank (cópias anonimizadas dos reais) são reconhecidos pelo preset, mostram a
// prévia sem linha com erro e importam. Uma linha a mais, única por tentativa, muda o arquivo (sem "já foi importado").
const REAL = '../../packages/domain/test/fixtures';

test('E08: o extrato real da conta Nubank (CSV) é reconhecido pelo preset e importa (issue #128)', async ({
  page,
}, info) => {
  await login(page, `e2e-csv-${info.project.name}@example.test`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
  const stamp = Date.now();
  const name = `Conta Nubank E08 ${info.project.name} ${stamp}`;
  await page.evaluate((n) => window.__oakE2E?.addAccount(n), name);
  const text = readFileSync(`${REAL}/nubank-conta-real-anon.csv`, 'utf8');
  const lines = text.trimEnd().split('\n').length;

  await page.goto('/importar');
  await expect(page.getByTestId('screen-I03')).toBeVisible();
  await page.getByTestId('import-file').setInputFiles({
    name: 'NU_extrato.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `${text.trimEnd()}\n29/01/2026,-1.00,e08-${info.project.name}-${stamp},Compra no débito - E08 ${stamp}\n`,
    ),
  });
  await expect(page.getByTestId('csv-detected')).toHaveText('Formato detectado: Nubank — conta');
  await page.getByLabel('Importar para').selectOption({ label: name });
  await expect(page.getByTestId('import-summary')).toContainText(`${lines} lançamentos · `);
  await expect(page.getByTestId('csv-errors')).toHaveCount(0);
  await expect(page.getByTestId('import-error')).toHaveCount(0);
  await page.getByTestId('import-run').click();
  // a prévia sai da tela quando a importação termina e ela aparece entre as recentes
  await expect(page.getByTestId('import-preview')).toHaveCount(0);
  await expect(page.getByTestId('import-recent')).toBeVisible();
});

test('E08: a fatura real do Nubank (CSV com vírgula decimal entre aspas) é lida inteira e importa no cartão (issue #128)', async ({
  page,
}, info) => {
  await login(page, `e2e-csv-${info.project.name}@example.test`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
  const stamp = Date.now();
  const name = `Cartão Nubank E08 ${info.project.name} ${stamp}`;
  await page.evaluate((n) => window.__oakE2E?.addCard(n, 3, 10), name);
  const text = readFileSync(`${REAL}/nubank-fatura-real-anon.csv`, 'utf8');
  const lines = text.trimEnd().split('\n').length;

  await page.goto('/importar');
  await expect(page.getByTestId('screen-I03')).toBeVisible();
  await page.getByTestId('import-file').setInputFiles({
    name: 'Nubank_fatura.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`${text.trimEnd()}\n2026-10-28,Compra E08 ${stamp},"1.234,56"\n`),
  });
  await expect(page.getByTestId('csv-detected')).toHaveText('Formato detectado: Nubank — fatura');
  await page.getByLabel('Importar para').selectOption({ label: name });
  // todas as linhas viram lançamentos: nenhuma fica de fora por valor ilegível
  await expect(page.getByTestId('import-summary')).toContainText(`${lines} lançamentos · `);
  await expect(page.getByTestId('csv-errors')).toHaveCount(0);
  await expect(page.getByTestId('import-error')).toHaveCount(0);
  await page.getByTestId('import-run').click();
  // a prévia sai da tela quando a importação termina e ela aparece entre as recentes
  await expect(page.getByTestId('import-preview')).toHaveCount(0);
  await expect(page.getByTestId('import-recent')).toBeVisible();
});
