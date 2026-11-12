import { expect, login, test } from './fixtures/base';

// Issue #150 (regressão da T-118/T-120): no celular, o avatar do menu da conta, o título, o olho de ocultar valores
// e o sino do Início ficavam uns por cima dos outros. Nas 4 abas principais, a 320 px e a 360 px, as caixas do
// título e de cada botão do topo não se cruzam e cada alvo tem pelo menos 48 px (DoD 6).

type Box = { x: number; y: number; width: number; height: number };

const ROOTS = [
  { path: '/', screen: 'H01' },
  { path: '/lancamentos', screen: 'T01' },
  { path: '/cartoes', screen: 'C01' },
  { path: '/planejar/orcamento', screen: 'P01' },
] as const;

function overlaps(a: Box, b: Box): boolean {
  const tol = 0.5; // arredondamento de subpixel: bordas encostadas não contam
  return (
    a.x + a.width - tol > b.x &&
    b.x + b.width - tol > a.x &&
    a.y + a.height - tol > b.y &&
    b.y + b.height - tol > a.y
  );
}

test('issue #150: topo das abas principais sem sobreposição a 320 e 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await login(page);

  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 740 });
    for (const root of ROOTS) {
      await page.goto(root.path);
      await expect(page.getByTestId(`screen-${root.screen}`)).toBeVisible();
      const banner = page.getByRole('banner');
      const avatar = banner.getByRole('button', { name: 'Abrir menu da conta' });
      await expect(avatar).toBeVisible();
      if (root.screen === 'H01') {
        await expect(banner.getByTestId('hide-values')).toBeVisible();
        await expect(banner.getByTestId('notices-bell')).toBeVisible();
      }

      const title = banner.getByRole('heading', { level: 1 });
      // A caixa do texto, não a do `<h1>` (que pode esticar na coluna do meio)
      const titleBox = await title.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const own = el.getBoundingClientRect();
        const left = Math.max(text.left, own.left);
        const right = Math.min(text.right, own.right);
        return { x: left, y: own.top, width: Math.max(0, right - left), height: own.height };
      });
      expect(titleBox.width, `título visível em ${root.path} a ${width} px`).toBeGreaterThan(0);

      const controls = banner.locator('button, a');
      const count = await controls.count();
      const boxes: { name: string; box: Box }[] = [];
      for (let i = 0; i < count; i++) {
        const control = controls.nth(i);
        if (!(await control.isVisible())) {
          continue;
        }
        const box = await control.boundingBox();
        if (!box) {
          continue;
        }
        const name =
          (await control.getAttribute('aria-label')) ??
          ((await control.textContent()) ?? '').trim();
        expect(
          box.width,
          `largura de "${name}" em ${root.path} a ${width} px`,
        ).toBeGreaterThanOrEqual(48);
        expect(
          box.height,
          `altura de "${name}" em ${root.path} a ${width} px`,
        ).toBeGreaterThanOrEqual(48);
        expect(box.x, `"${name}" dentro da tela`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `"${name}" dentro da tela`).toBeLessThanOrEqual(width + 0.5);
        expect(
          overlaps(box, titleBox),
          `"${name}" sobre o título em ${root.path} a ${width} px`,
        ).toBe(false);
        for (const other of boxes) {
          expect(
            overlaps(box, other.box),
            `"${name}" sobre "${other.name}" em ${root.path} a ${width} px`,
          ).toBe(false);
        }
        boxes.push({ name, box });
      }
      expect(boxes.length, `botões do topo em ${root.path}`).toBeGreaterThanOrEqual(
        root.screen === 'H01' ? 3 : 1,
      );
    }
  }
});
