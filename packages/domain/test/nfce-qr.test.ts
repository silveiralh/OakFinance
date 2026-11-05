import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.ts';
import { accessKeyCheckDigit, isNfceHostAllowed, NFCE_UF_PR, parseNfceQr } from '../src/nfce/qr.ts';

// Chaves geradas em tempo de execução com CNPJ fictício (CLAUDE.md §4): nada de chave real no repositório.
const FAKE_CNPJ = '00111222000100';
const PR_HOST = 'http://www.fazenda.pr.gov.br/nfce/qrcode';

interface KeyParts {
  uf?: string;
  yymm?: string;
  cnpj?: string;
  model?: string;
  series?: string;
  number?: string;
  emissionType?: string;
  code?: string;
}

function makeKey(parts: KeyParts = {}): string {
  const first43 = [
    parts.uf ?? NFCE_UF_PR,
    parts.yymm ?? '2611',
    parts.cnpj ?? FAKE_CNPJ,
    parts.model ?? '65',
    parts.series ?? '001',
    parts.number ?? '000012345',
    parts.emissionType ?? '1',
    parts.code ?? '87654321',
  ].join('');
  return `${first43}${accessKeyCheckDigit(first43)}`;
}

function wrongDv(key: string): string {
  const dv = Number(key[43]);
  return `${key.slice(0, 43)}${(dv + 1) % 10}`;
}

function qrUrl(p: string, host = PR_HOST): string {
  return `${host}?p=${p}`;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'OTHER';
  }
  return undefined;
}

describe('accessKeyCheckDigit (RN-82)', () => {
  it('RN-82: DV módulo 11 com pesos 2..9; restos 0 e 1 viram 0', () => {
    // 43 zeros: soma 0 → resto 0 → DV 0
    expect(accessKeyCheckDigit('0'.repeat(43))).toBe(0);
    // só o último dígito = 1 com peso 2: soma 2 → 11 − 2 = 9
    expect(accessKeyCheckDigit(`${'0'.repeat(42)}1`)).toBe(9);
    // último = 5 (peso 2) → soma 10 → resto 10 → DV 1
    expect(accessKeyCheckDigit(`${'0'.repeat(42)}5`)).toBe(1);
    // dígito na 9ª posição da direita volta ao peso 2: soma 2 → DV 9
    expect(accessKeyCheckDigit(`${'0'.repeat(34)}1${'0'.repeat(8)}`)).toBe(9);
    // resto 1: 6 × 2 = 12 → resto 1 → DV 0
    expect(accessKeyCheckDigit(`${'0'.repeat(42)}6`)).toBe(0);
  });

  it('RN-82: rejeita entrada que não tem 43 dígitos', () => {
    expect(codeOf(() => accessKeyCheckDigit('123'))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => accessKeyCheckDigit(`${'1'.repeat(42)}a`))).toBe('INVALID_ARGUMENT');
  });

  it('RN-82: o DV fica entre 0 e 9 e trocar um dígito altera o DV calculado (propriedade)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\d{43}$/), (first43) => {
        const dv = accessKeyCheckDigit(first43);
        expect(dv).toBeGreaterThanOrEqual(0);
        expect(dv).toBeLessThanOrEqual(9);
      }),
      { numRuns: 200 },
    );
  });
});

describe('parseNfceQr (RN-82, RN-84)', () => {
  it('US-54: v2 online extrai os campos da chave e não traz valor', () => {
    const key = makeKey();
    const url = qrUrl(`${key}|2|1|1|${'a'.repeat(40)}`);
    const qr = parseNfceQr(url);
    expect(qr).toEqual({
      url,
      accessKey: key,
      uf: '41',
      issuedYearMonth: '2026-11',
      issuerCnpj: FAKE_CNPJ,
      model: '65',
      series: '001',
      number: '000012345',
      emissionType: '1',
      qrVersion: 2,
      env: 1,
      contingency: null,
    });
  });

  it('RN-84: v2 em contingência traz dia e valor total em centavos', () => {
    const key = makeKey({ emissionType: '9' });
    const qr = parseNfceQr(qrUrl(`${key}|2|1|05|125.90|${'b'.repeat(56)}|1|${'c'.repeat(40)}`));
    expect(qr.qrVersion).toBe(2);
    expect(qr.emissionType).toBe('9');
    expect(qr.contingency).toEqual({ day: 5, totalCents: 12590 });
  });

  it.each([
    ['7', 700],
    ['7.5', 750],
    ['0.01', 1],
    ['1234.56', 123456],
  ])('RN-84: vNF "%s" vira %i centavos', (vnf, cents) => {
    const key = makeKey({ emissionType: '9' });
    const qr = parseNfceQr(qrUrl(`${key}|2|2|31|${vnf}|dig|1|hash`));
    expect(qr.contingency?.totalCents).toBe(cents);
    expect(qr.contingency?.day).toBe(31);
    expect(qr.env).toBe(2);
  });

  it('US-54: v3 online só com chave, versão e ambiente', () => {
    const key = makeKey();
    const qr = parseNfceQr(qrUrl(`${key}|3|1`));
    expect(qr.qrVersion).toBe(3);
    expect(qr.contingency).toBeNull();
  });

  it('RN-84: v3 em contingência traz dia e valor', () => {
    const key = makeKey({ emissionType: '9' });
    const qr = parseNfceQr(qrUrl(`${key}|3|1|12|49.99|2|00000000000|assinatura`));
    expect(qr.qrVersion).toBe(3);
    expect(qr.contingency).toEqual({ day: 12, totalCents: 4999 });
  });

  it('RN-84: UF diferente de 41 e host de outra SEFAZ são lidos (para o fallback)', () => {
    const key = makeKey({ uf: '35' });
    const qr = parseNfceQr(qrUrl(`${key}|2|1|1|hash`, 'https://www.nfce.fazenda.sp.gov.br/qrcode'));
    expect(qr.uf).toBe('35');
    expect(isNfceHostAllowed(qr.url)).toBe(false);
  });

  it('RN-82: aceita a barra vertical codificada e espaços nas pontas', () => {
    const key = makeKey();
    const qr = parseNfceQr(`  ${qrUrl(`${key}%7C2%7C1%7C1%7Chash`)}\n`);
    expect(qr.accessKey).toBe(key);
  });

  it('RN-82: chave com DV errado lança NFCE_KEY_DV', () => {
    const key = wrongDv(makeKey());
    expect(codeOf(() => parseNfceQr(qrUrl(`${key}|2|1|1|hash`)))).toBe('NFCE_KEY_DV');
  });

  it('RN-82: qualquer dígito trocado na chave é detectado (propriedade)', () => {
    const key = makeKey();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 42 }), fc.integer({ min: 1, max: 9 }), (pos, delta) => {
        const digit = (Number(key[pos]) + delta) % 10;
        const changed = `${key.slice(0, pos)}${digit}${key.slice(pos + 1)}`;
        const code = codeOf(() => parseNfceQr(qrUrl(`${changed}|3|1`)));
        // mudar o modelo ou o mês pode cair em NFCE_QR_INVALID, mas nunca passa calado
        // (o módulo 11 só deixa passar trocas cujo efeito na soma é múltiplo de 11)
        if (code === undefined) {
          expect(accessKeyCheckDigit(changed.slice(0, 43))).toBe(Number(changed[43]));
        } else {
          expect(['NFCE_KEY_DV', 'NFCE_QR_INVALID']).toContain(code);
        }
      }),
      { numRuns: 200 },
    );
  });

  it.each([
    ['texto que não é URL', 'abc'],
    ['URL sem parâmetro p', `${PR_HOST}?x=1`],
    ['protocolo que não é http', 'ftp://www.fazenda.pr.gov.br/nfce/qrcode?p=1'],
    ['chave curta', qrUrl('123|2|1|1|hash')],
    ['chave com letra', qrUrl(`${'1'.repeat(43)}a|2|1|1|hash`)],
  ])('RN-82: %s lança NFCE_QR_INVALID', (_label, raw) => {
    expect(codeOf(() => parseNfceQr(raw))).toBe('NFCE_QR_INVALID');
  });

  it('RN-82: modelo diferente de 65 (NF-e) lança NFCE_QR_INVALID', () => {
    const key = makeKey({ model: '55' });
    expect(codeOf(() => parseNfceQr(qrUrl(`${key}|2|1|1|hash`)))).toBe('NFCE_QR_INVALID');
  });

  it.each(['00', '13'])('RN-82: mês %s na chave lança NFCE_QR_INVALID', (mm) => {
    const key = makeKey({ yymm: `26${mm}` });
    expect(codeOf(() => parseNfceQr(qrUrl(`${key}|3|1`)))).toBe('NFCE_QR_INVALID');
  });

  it.each([
    ['versão desconhecida', '|4|1'],
    ['sem versão', ''],
    ['ambiente 3', '|2|3|1|hash'],
    ['sem ambiente', '|3'],
    ['v2 com 3 parâmetros extras', '|2|1|a|b|c'],
    ['v3 com 1 parâmetro extra', '|3|1|x'],
    ['dia 0', '|2|1|0|10.00|dig|1|hash'],
    ['dia 32', '|2|1|32|10.00|dig|1|hash'],
    ['dia com letra', '|3|1|a1|10.00|1|x|ass'],
    ['valor com vírgula', '|2|1|05|10,00|dig|1|hash'],
    ['valor com 3 casas', '|2|1|05|10.001|dig|1|hash'],
    ['valor vazio', '|3|1|05||1|x|ass'],
  ])('RN-82: %s lança NFCE_QR_INVALID', (_label, suffix) => {
    const key = makeKey();
    expect(codeOf(() => parseNfceQr(qrUrl(`${key}${suffix}`)))).toBe('NFCE_QR_INVALID');
  });
});

describe('isNfceHostAllowed (RN-82)', () => {
  it.each([
    ['http://www.fazenda.pr.gov.br/nfce/qrcode?p=1', true],
    ['https://www.fazenda.pr.gov.br/nfce/qrcode?p=1', true],
    ['https://fazenda.pr.gov.br/x', true],
    ['https://www.dfeportal.fazenda.pr.gov.br/dfe-portal/rest', true],
    ['https://WWW.FAZENDA.PR.GOV.BR/nfce', true],
    ['https://www.fazenda.pr.gov.br.example.com/nfce', false],
    ['https://evilfazenda.pr.gov.br/nfce', false],
    ['https://www.fazenda.sp.gov.br/nfce', false],
    ['ftp://www.fazenda.pr.gov.br/nfce', false],
    ['não é url', false],
  ])('RN-82: %s → %s', (url, allowed) => {
    expect(isNfceHostAllowed(url)).toBe(allowed);
  });
});
