import { expect, login, test } from './fixtures/base';

// T-068: E12 (parte de movimento) e US-58 — com `reducedMotion: 'reduce'` o app marca `data-motion="reduced"` e as
// regras de movimento reduzido tiram animações e transições de deslocamento; o tema escolhido na S08 fica salvo.
test.use({ reducedMotion: 'reduce' });

test('E12: reducedMotion desliga as animações e o tema Escuro fica salvo no aparelho', async ({
  page,
}) => {
  await login(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-motion', 'reduced');

  const button = page.getByRole('button').filter({ visible: true }).first();
  await expect(button).toBeVisible();
  const style = await button.evaluate((el) => {
    const s = getComputedStyle(el);
    return { animation: s.animationName, transition: s.transitionProperty };
  });
  expect(style.animation).toBe('none');
  expect(style.transition).not.toContain('transform');

  await page.goto('/ajustes/aparencia');
  await expect(page.getByTestId('screen-S08')).toBeVisible();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.locator('label', { hasText: 'Escuro' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(html).toHaveAttribute('data-motion', 'reduced');
  await page.locator('label', { hasText: 'Claro' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});
