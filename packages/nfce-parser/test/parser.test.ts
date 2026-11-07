// T-088: parser defensivo da página da NFC-e (tech §6.2.3; RN-82, RN-84), com fixtures sintéticas (ver fixtures/README.md).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { brlToCents, parseNfcePage, quantityToMilli, textOf } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const page = (name: string) => readFileSync(join(here, 'fixtures', name), 'utf8');

describe('conversões sem ponto flutuante', () => {
  it('valores em reais viram centavos inteiros', () => {
    expect(brlToCents('1.024,90')).toBe(102490);
    expect(brlToCents(' 7,39 ')).toBe(739);
    expect(brlToCents('1,5')).toBe(150);
    expect(brlToCents('12')).toBe(1200);
    expect(brlToCents('abc')).toBeNull();
    expect(brlToCents('1.2,00')).toBeNull();
  });

  it('quantidades viram milésimos', () => {
    expect(quantityToMilli('1,234')).toBe(1234);
    expect(quantityToMilli('2')).toBe(2000);
    expect(quantityToMilli('0,5')).toBe(500);
    expect(quantityToMilli('x')).toBeNull();
  });

  it('texto visível sem tags, scripts e entidades', () => {
    expect(
      textOf(
        '<p>CAF&Eacute; &amp; P&atilde;o<br/>&#233;&#xE9; &nbsp;<script>x()</script>&foo;</p>',
      ),
    ).toBe('CAFÉ & Pão éé &foo;');
  });
});

describe('RN-82: página completa da SEFAZ-PR', () => {
  it('RN-82: lê emitente, CNPJ, emissão, itens por kg, desconto e total que fecha', () => {
    const result = parseNfcePage(page('sintetica-completa.html'));
    expect(result.status).toBe('full');
    if (result.status !== 'full') {
      return;
    }
    const { receipt } = result;
    expect(receipt.issuerName).toBe('MERCADO FICTICIO EXEMPLO LTDA');
    expect(receipt.issuerCnpj).toBe('12345678000100');
    expect(receipt.issuedAt).toBe('2026-11-06T18:42:07');
    expect(receipt.discountCents).toBe(429);
    expect(receipt.totalCents).toBe(106500);
    expect(receipt.items).toEqual([
      {
        description: 'BANANA PRATA KG',
        code: '1001',
        quantityMilli: 1234,
        unit: 'KG',
        unitCents: 599,
        totalCents: 739,
      },
      {
        description: 'CAFÉ TORRADO 500G',
        code: '2002',
        quantityMilli: 2000,
        unit: 'UN',
        unitCents: 1850,
        totalCents: 3700,
      },
      {
        description: 'ARROZ TIPO 1 5KG & CIA',
        code: '3003',
        quantityMilli: 1000,
        unit: 'UN',
        unitCents: 102490,
        totalCents: 102490,
      },
    ]);
  });

  it('tech §6.2.3: sem as classes, procura pelos rótulos e calcula o unitário que faltar', () => {
    const result = parseNfcePage(page('sintetica-rotulos.html'));
    expect(result.status).toBe('full');
    if (result.status !== 'full') {
      return;
    }
    expect(result.receipt.issuerName).toBeNull();
    expect(result.receipt.issuerCnpj).toBeNull();
    expect(result.receipt.issuedAt).toBeNull();
    expect(result.receipt.discountCents).toBe(0);
    expect(result.receipt.totalCents).toBe(1950);
    expect(
      result.receipt.items.map((i) => [
        i.description,
        i.code,
        i.quantityMilli,
        i.unit,
        i.unitCents,
        i.totalCents,
      ]),
    ).toEqual([
      ['PAO FRANCES', '77', 500, 'KG', 1200, 600],
      ['LEITE 1L', '78', 3000, 'UN', 450, 1350],
    ]);
  });

  it('tech §6.2.3: tolerância de 1 centavo por item na conferência do total', () => {
    const html = page('sintetica-rotulos.html').replace('19,50', '19,52');
    expect(parseNfcePage(html).status).toBe('full');
  });
});

describe('RN-84: fallback quando a página não serve', () => {
  it('RN-84: captcha vira NFCE_CAPTCHA', () => {
    expect(parseNfcePage(page('sintetica-captcha.html'))).toEqual({
      status: 'fallback',
      errorCode: 'NFCE_CAPTCHA',
    });
  });

  it('RN-84: página de erro, sem tabela de itens, vira NFCE_LAYOUT', () => {
    expect(parseNfcePage(page('sintetica-erro.html'))).toEqual({
      status: 'fallback',
      errorCode: 'NFCE_LAYOUT',
    });
    expect(parseNfcePage('')).toEqual({ status: 'fallback', errorCode: 'NFCE_LAYOUT' });
  });

  it('RN-84: Σ itens − desconto diferente do total vira NFCE_LAYOUT', () => {
    const html = page('sintetica-completa.html').replace('txtMax">1.065,00', 'txtMax">1.099,00');
    expect(parseNfcePage(html)).toEqual({ status: 'fallback', errorCode: 'NFCE_LAYOUT' });
  });

  it('RN-84: linha de item sem quantidade ou sem total vira NFCE_LAYOUT', () => {
    const noQty = page('sintetica-rotulos.html').replace('Qtde.: 3', 'Quantidade 3');
    expect(parseNfcePage(noQty)).toEqual({ status: 'fallback', errorCode: 'NFCE_LAYOUT' });
    const noTotal = page('sintetica-rotulos.html').replace('Vl. Total 6,00', '');
    expect(parseNfcePage(noTotal)).toEqual({ status: 'fallback', errorCode: 'NFCE_LAYOUT' });
  });

  it('RN-84: sem o total da nota vira NFCE_LAYOUT', () => {
    const html = page('sintetica-rotulos.html').replace('Valor total R$: 19,50', '');
    expect(parseNfcePage(html)).toEqual({ status: 'fallback', errorCode: 'NFCE_LAYOUT' });
  });
});
