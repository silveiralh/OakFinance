import { expect, login, test } from './fixtures/base';

// T-084: E07 — importação OFX com a fixture sintética do BB: prévia, confirmação, conciliação automática com um
// manual igual e sugestão para um parecido; reimportar o mesmo arquivo avisa e não duplica.
// Um usuário por projeto (o mesmo arquivo nos 3 navegadores daria "já foi importado").
const FIXTURE = '../../packages/domain/test/fixtures/bb-sgml-1252.ofx';

test('E07: importar o OFX do BB concilia, sugere e não duplica ao reimportar', async ({
  page,
}, info) => {
  await login(page, `e2e-import-${info.project.name}@example.test`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
  const name = `Conta E07 ${info.project.name}`;
  const account = await page.evaluate((n) => window.__oakE2E?.addAccount(n) ?? '', name);
  const add = (cents: number, description: string) =>
    page.evaluate(
      ([a, c, d]) =>
        window.__oakE2E?.addExpense(a as string, c as number, d as string, '2026-11-03'),
      [account, cents, description] as const,
    );
  await add(8790, 'Conta de água');
  await add(1300, 'Padaria');

  await page.goto('/importar');
  await expect(page.getByTestId('screen-I03')).toBeVisible();
  await page.getByTestId('import-file').setInputFiles(FIXTURE);
  await page.getByLabel('Importar para').selectOption({ label: name });
  await expect(page.getByTestId('import-summary')).toHaveText(
    '4 lançamentos · 0 já existem (serão ignorados) · 1 parecidos com lançamentos seus (vão para conferência)',
  );
  await expect(page.getByTestId('import-merging')).toHaveText(
    '1 serão conciliados com lançamentos seus',
  );
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('import-recent')).toBeVisible();

  // reimportar: aviso e nada novo
  await page.getByTestId('import-file').setInputFiles(FIXTURE);
  await page.getByLabel('Importar para').selectOption({ label: name });
  await expect(page.getByTestId('import-already')).toContainText(
    'Este arquivo já foi importado em',
  );
  await page.getByRole('button', { name: 'Importar mesmo assim' }).click();
  await expect(page.getByTestId('import-summary')).toHaveText(
    '4 lançamentos · 4 já existem (serão ignorados) · 0 parecidos com lançamentos seus (vão para conferência)',
  );
  await expect(page.getByTestId('import-run')).toHaveAttribute('aria-disabled', 'true');
});
