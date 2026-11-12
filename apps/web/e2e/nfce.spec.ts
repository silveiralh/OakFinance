import type { Page } from '@playwright/test';
import { expect, freshUser, login, test } from './fixtures/base';

// T-089: E09 (tech §8.4) nos casos de fallback e offline — QR injetado pelo stub do detector (foto) ou chave digitada.
// A resposta do `nfce-fetch` vem do gancho do build E2E (`window.__oakE2ENfce`, como o FakePluggyConnect): página
// quebrada → `fallback`; depois `full`. A checagem de rede do app continua valendo. O `full` com itens da SEFAZ real
// fica para a T-090 (SETUP-14). Chaves com DV válido geradas aqui, a cada execução (nada versionado). Usuário próprio
// por projeto: uma nota pendente do e2e-a seria relida (e regravada) pelos outros cenários dele.

declare global {
  interface Window {
    __oakE2ENfce?: () => unknown;
    __nfceAnswer?: unknown;
  }
}

/** DV da chave de acesso (módulo 11, pesos 2..9 da direita para a esquerda). */
function withCheckDigit(first43: string): string {
  let sum = 0;
  let weight = 2;
  for (let i = first43.length - 1; i >= 0; i -= 1) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return `${first43}${rest < 2 ? 0 : 11 - rest}`;
}

/** Chave do PR com número aleatório (cada execução lê uma nota nova). */
function randomKey(): string {
  const number = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  return withCheckDigit(`412611${'12345678000100'}65001${number}1${'0000000'}1`.slice(0, 43));
}

const linkOf = (key: string) =>
  `https://www.fazenda.pr.gov.br/nfce/qrcode?p=${key}|2|1|1|ABCDEF0123456789`;

const BROKEN = { status: 'fallback', qr: {}, receipt: null, errorCode: 'NFCE_LAYOUT' };

const FULL = {
  status: 'full',
  qr: {},
  receipt: {
    issuerName: 'SUPERMERCADO EXEMPLO',
    issuerCnpj: '12345678000100',
    issuedAt: null,
    items: [
      {
        description: 'ARROZ 5KG',
        code: null,
        quantityMilli: 1000,
        unit: 'UN',
        unitCents: 2590,
        totalCents: 2590,
      },
    ],
    discountCents: 0,
    totalCents: 2590,
  },
};

/** O `nfce-fetch` do build E2E responde `answer` (trocável com `answerNfce`). */
async function fakeNfce(page: Page, answer: unknown) {
  await page.addInitScript((initial) => {
    window.__nfceAnswer = initial;
    window.__oakE2ENfce = () => window.__nfceAnswer;
  }, answer);
}

async function answerNfce(page: Page, answer: unknown) {
  await page.evaluate((next) => {
    window.__nfceAnswer = next;
  }, answer);
}

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

const statusOf = (page: Page, key: string) =>
  page.evaluate((k) => window.__oakE2E?.nfceStatus(k) ?? null, key);

test('E09: página quebrada cai no fallback, que pede o valor no Q01', async ({ page }, info) => {
  await fakeNfce(page, BROKEN);
  // conta própria: a do E09 offline aprende o emitente da nota e o Q01 sugeriria o nome no lugar do CNPJ
  await login(page, freshUser('nfce-fallback', info));
  await hooks(page);
  const key = randomKey();
  await page.goto('/nota');
  await expect(page.getByTestId('screen-I04')).toBeVisible();
  await expect(
    page.getByText('A câmera é usada só para ler o QR code da nota. Nenhuma foto é guardada.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Digitar chave' }).click();
  await page.getByLabel('Digitar chave').fill(key);
  await page.getByTestId('nfce-submit').click();
  await expect(page.getByTestId('nfce-outcome')).toContainText(
    'Não foi possível carregar os detalhes da nota. Complete o valor para continuar.',
  );
  await expect.poll(() => statusOf(page, key)).toBe('fallback');
  await page.getByTestId('nfce-use').click();
  const sheet = page.getByTestId('quick-entry');
  await expect(sheet.getByTestId('quick-from-note')).toHaveText('Dados da nota fiscal');
  await expect(sheet.getByRole('textbox', { name: 'Valor' })).toHaveValue('R$ 0,00');
  await expect(sheet.getByLabel('Descrição')).toHaveValue('12.345.678/0001-00');
});

test('E09: offline a nota fica pendente e é lida quando a rede volta', async ({ page }, info) => {
  test.setTimeout(90_000);
  await fakeNfce(page, BROKEN);
  const key = randomKey();
  // QR injetado: o stub do detector devolve o link desta execução para qualquer foto
  await page.addInitScript((link) => {
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      static getSupportedFormats() {
        return Promise.resolve(['qr_code']);
      }
      detect() {
        return Promise.resolve([{ rawValue: link }]);
      }
    };
  }, linkOf(key));
  await login(page, `e2e-nfce-${info.project.name}@example.test`);
  await hooks(page);
  await page.goto('/nota');
  await expect(page.getByTestId('screen-I04')).toBeVisible();

  await page.context().setOffline(true);
  // o WebKit muda o `navigator.onLine` um pouco depois
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByTestId('nfce-photo').setInputFiles({
    name: 'nota.png',
    mimeType: 'image/png',
    buffer: Buffer.from('foto de teste'),
  });
  await expect(page.getByTestId('nfce-outcome')).toContainText(
    'Nota salva. Os itens serão buscados quando a conexão voltar.',
  );
  await expect.poll(() => statusOf(page, key)).toBe('pending');

  await answerNfce(page, FULL);
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await expect.poll(() => statusOf(page, key), { timeout: 30_000 }).toBe('full');
});
