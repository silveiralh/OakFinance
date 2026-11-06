import { existsSync } from 'node:fs';
import { expect, test } from './fixtures/base';

// T-028: snapshot visual dos tokens (regerado na T-100, D-023). Atualizar esta referência exige `needs-owner`.
// As referências vêm do contêiner do CI (o ambiente das sessões não roda WebKit nem baixa artefatos): quando a
// referência do projeto não existe, o teste imprime a captura em base64 no log, entre marcadores, para ser versionada.
test('US-62: styleguide renderiza os tokens e os componentes de dados', async ({
  page,
}, testInfo) => {
  await page.goto('/__styleguide');
  await page.evaluate(() => document.fonts.ready);
  const tokens = page.getByTestId('tokens');
  await expect(tokens).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'No ritmo do mês' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
  const baseline = testInfo.snapshotPath('tokens.png');
  if (!existsSync(baseline)) {
    const shot = await tokens.screenshot({ animations: 'disabled', scale: 'css', caret: 'hide' });
    process.stdout.write(
      `\n----- INICIO ${testInfo.project.name} tokens.png -----\n${shot.toString('base64')}\n----- FIM ${testInfo.project.name} tokens.png -----\n`,
    );
  }
  await expect(tokens).toHaveScreenshot('tokens.png', {
    maxDiffPixelRatio: 0.01,
    animations: 'disabled',
  });
});
